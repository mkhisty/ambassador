"""ASI:One agent for turning Ambassador's sponsor pipeline into reviewed drafts."""

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from openai import OpenAI
from uagents import Agent, Context, Protocol
from uagents.experimental.chat_agent.protocol import build_llm_message_history
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    TextContent,
    chat_protocol_spec,
)


ROOT = Path(__file__).resolve().parent
CRM = json.loads((ROOT / "leads.json").read_text(encoding="utf-8"))
EVENT = CRM["event"]
LEADS = CRM["leads"]
client = OpenAI(base_url=os.environ["ASI1_BASE_URL"], api_key=os.environ["ASI1_API_KEY"])

agent = Agent(name="ambassador_sponsor_ops")
chat = Protocol(spec=chat_protocol_spec)

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "pipeline",
            "description": "Inspect sponsor pipeline, recommend next steps, or list qualified leads.",
            "parameters": {"type": "object", "properties": {"stage": {"type": "string"}}, "additionalProperties": False},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "prepare_draft",
            "description": "Create a personalized pending outreach draft for one qualified sponsor. Never sends it.",
            "parameters": {"type": "object", "properties": {"lead_id": {"type": "string"}}, "required": ["lead_id"], "additionalProperties": False},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "save_preview",
            "description": "Save an exact pending draft as an offline preview after organizer approval by ID. Never contacts anyone.",
            "parameters": {"type": "object", "properties": {"draft_id": {"type": "string"}}, "required": ["draft_id"], "additionalProperties": False},
        },
    },
]

SYSTEM = """You are Ambassador, an event sponsorship operations agent. Use pipeline to inspect the supplied CRM and identify a qualified next step. Use prepare_draft only when user asks for a draft, and only for a lead whose CRM status is exactly ready. Never contact a sponsor, promise benefits or terms, invent evidence, or treat a preview as delivery. Every draft needs explicit organizer approval by its exact ID before save_preview. Keep all facts grounded in CRM and event data. All fixture contacts and figures are fictional."""


def _drafts(ctx):
    return json.loads(ctx.storage.get("drafts") or "{}")


def pipeline(stage=""):
    rows = [lead for lead in LEADS if not stage or lead["status"].lower() == stage.lower()]
    counts = {}
    for lead in LEADS:
        counts[lead["status"]] = counts.get(lead["status"], 0) + 1
    return {"stages": counts, "leads": rows, "event": EVENT,
            "note": "Fictional demo CRM. Only ready leads qualify for first outreach."}


def make_draft(lead, instruction=""):
    prompt = (
        "Write concise sponsorship outreach grounded only in this JSON. Return JSON object with "
        "subject and body. Do not invent audience size, deadlines, promises, benefits, or prior contact. "
        "Ask one relevant next question. Clearly mark as mock if the event is mock.\n"
        + json.dumps({"event": EVENT, "lead": lead, "organizer_instructions": instruction})
    )
    result = client.chat.completions.create(
        model="asi1-mini", messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"}, max_tokens=500,
    )
    content = json.loads(result.choices[0].message.content)
    if not isinstance(content.get("subject"), str) or not isinstance(content.get("body"), str):
        raise ValueError("Draft model returned invalid subject/body.")
    return {"subject": content["subject"][:200], "body": content["body"][:4000]}


@chat.on_message(ChatMessage)
async def handle_message(ctx: Context, sender: str, msg: ChatMessage):
    await ctx.send(sender, ChatAcknowledgement(timestamp=datetime.now(timezone.utc), acknowledged_msg_id=msg.msg_id))
    text = msg.text()
    if not text:
        return
    try:
        history = [{"role": "system", "content": SYSTEM},
                   {"role": "system", "content": "Current event and CRM snapshot:\n" + json.dumps(pipeline())}]
        history.extend(build_llm_message_history(ctx)[-10:])
        response = client.chat.completions.create(
            model="asi1-mini", messages=history, tools=TOOLS,
            tool_choice="auto", max_tokens=900,
        ).choices[0].message
        if not response.tool_calls:
            answer = response.content or "Ask me to inspect the sponsor pipeline or prepare a draft."
        else:
            call = response.tool_calls[0]
            args = json.loads(call.function.arguments or "{}")
            if call.function.name == "pipeline":
                answer = json.dumps(pipeline(args.get("stage", "")), indent=2)
            elif call.function.name == "prepare_draft":
                lead = next((item for item in LEADS if item["id"] == args.get("lead_id")), None)
                if not lead or lead["status"] != "ready":
                    answer = "No draft created: choose a lead whose CRM status is ready."
                else:
                    drafts = _drafts(ctx)
                    if any(d["sender"] == sender and d["lead_id"] == lead["id"] and d["status"] == "pending" for d in drafts.values()):
                        answer = "Pending draft already exists for this sponsor. Ask to show pending drafts or approve its exact ID."
                    else:
                        draft = make_draft(lead, text)
                        draft_id = "d-" + uuid4().hex[:12]
                        drafts[draft_id] = {**draft, "lead_id": lead["id"], "sender": sender,
                                            "status": "pending", "created": datetime.now(timezone.utc).isoformat()}
                        ctx.storage.set("drafts", json.dumps(drafts))
                        answer = (f"Draft {draft_id} · pending · {lead['company']}\nTo: {lead['contact']} <{lead['address']}>\n"
                                  f"Subject: {draft['subject']}\n\n{draft['body']}\n\n"
                                  f"Review this exact draft. To save offline preview, explicitly approve {draft_id}. Nothing will be sent.")
            elif call.function.name == "save_preview":
                drafts = _drafts(ctx)
                draft_id = args.get("draft_id", "")
                draft = drafts.get(draft_id)
                if not draft or draft["sender"] != sender:
                    answer = "Draft not found for this conversation."
                elif draft["status"] != "pending":
                    answer = f"Draft {draft_id} is {draft['status']}; it cannot be approved again."
                elif datetime.now(timezone.utc) - datetime.fromisoformat(draft["created"]) > timedelta(hours=24):
                    draft["status"] = "expired"
                    ctx.storage.set("drafts", json.dumps(drafts))
                    answer = "Draft expired. Prepare a new draft."
                elif draft_id.lower() not in text.lower():
                    answer = f"Approval must name exact draft ID: approve {draft_id}."
                else:
                    draft["status"] = "preview_saved"
                    draft["approved"] = datetime.now(timezone.utc).isoformat()
                    ctx.storage.set("drafts", json.dumps(drafts))
                    answer = (f"Offline preview saved for {draft['lead_id']} ({draft_id}).\n"
                              f"Subject: {draft['subject']}\n\n{draft['body']}\n\nNo message sent; use Ambassador's organizer channel for delivery.")
            else:
                answer = "That action is unavailable. I can inspect the pipeline or prepare an approved, offline outreach preview."
    except Exception as exc:
        ctx.logger.exception("Ambassador request failed")
        answer = f"I couldn't complete that action: {type(exc).__name__}. Try again or inspect the pipeline."
    await ctx.send(sender, ChatMessage(timestamp=datetime.now(timezone.utc), msg_id=uuid4(),
                                      content=[TextContent(type="text", text=answer)]))


@chat.on_message(ChatAcknowledgement)
async def handle_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    pass


agent.include(chat, publish_manifest=True)
