# Ambassador Sponsor Ops Agent

![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

ASI:One-discoverable Agentverse agent for event sponsorship operations. It inspects Ambassador's sponsor pipeline, picks qualified next steps, prepares evidence-grounded personalized outreach, and saves an organizer-approved offline preview with an auditable status. It does not contact sponsors or make commitments.

The bundled leads are fictional demo data from `messaging-integration/demo/fixtures.json`. Live outreach remains in Ambassador's organizer-approved Spectrum/email integration. Agent Storage holds draft state across hosted invocations and scopes each draft to the approving sender.

## Agentverse setup

1. Create a Hosted Agent in Agentverse and name it **Ambassador Sponsor Ops**.
2. Add `agent.py` and `leads.json` in the hosted code editor from this folder.
3. Enable Agent Chat Protocol. Agentverse supplies `ASI1_API_KEY` and `ASI1_BASE_URL`.
4. Set description: `Turns event sponsorship requests into qualified next steps and organizer-approved outreach previews. Reads pipeline, prepares personalized drafts, and saves exact-ID approvals without sending messages.`
5. Set handle `ambassador-sponsor-ops`, add keywords `event sponsorship`, `sponsor outreach`, `event operations`, `relationship management`, and categorize under Innovation Lab.
6. Start the agent, test `Which qualified sponsors need action?`, then `Draft outreach for lead-012`, review it, and approve its exact draft ID to save offline preview.

## Local run

Python 3.10+; install `requirements.txt`, set `ASI1_API_KEY` and `ASI1_BASE_URL` from an ASI:One developer account, then run `python agent.py`. Hosted Agentverse injects those variables automatically.

## Demo flow

`inspect pipeline → identify ready leads → prepare personalized draft → organizer reviews exact ID → save offline preview`

All fixture records are fictional. The preview is not delivered. Live delivery uses the existing Ambassador approval and channel workflow.
