#!/usr/bin/env python3
"""Photon/widget communication. Agent behavior lives in get_response.py."""

import json
import hashlib
import os
import secrets
import shutil
import subprocess
import sys
import time
import threading
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

# Hermes's isolated relaunch does not include this script's directory.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from widget import ReviewStore, start_widget_server
import get_response
from fetch_context import context_settings, fetch_context
from calendar_tools import calendar_proposal, create_approved_event

HOME = Path.home() / ".hermes"
SDK_SIDECAR = HOME / "hermes-agent/plugins/platforms/photon/sidecar/index.mjs"
SIDECAR = Path(__file__).resolve().parent / "widget-sidecar.mjs"
URL = "http://127.0.0.1:8791"
REVIEW_STATE = Path(__file__).with_name('data') / 'reviews.json'

def message_text(content):
    if not isinstance(content, dict):
        return ""
    if content.get("type") == "text":
        return (content.get("text") or "").strip()
    if content.get("type") == "reply":
        return message_text(content.get("content"))
    if content.get("type") == "group":
        return "\n".join(filter(None, (
            message_text(item.get("content")) for item in content.get("items", [])
        )))
    return ""


def post(token, path, body, timeout=30):
    req = urllib.request.Request(
        URL + path,
        data=json.dumps(body).encode(),
        headers={"x-hermes-sidecar-token": token, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        result = json.load(response)
    if result.get("ok") is False:
        raise RuntimeError(result.get("error") or "Photon request failed")
    return result


def record_outcome(event, event_id, text, provider_message_id=None):
    """Write accepted messages/replies back without affecting Photon delivery."""
    base, token = context_settings()
    body = {
        'eventId': event_id,
        'phoneNumber': event.get('sender', {}).get('id'),
        'contactPhone': event.get('recipientPhone') or event.get('sender', {}).get('id'),
        'direction': 'outbound' if provider_message_id else 'inbound',
        'text': text,
        'providerMessageId': provider_message_id,
        'reviewId': event.get('reviewId'),
    }
    request = urllib.request.Request(
        base + '/api/agent/outreach',
        data=json.dumps(body).encode(),
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        result = json.load(response)
    if not result.get('ok'):
        raise RuntimeError(result.get('error') or 'Workspace write-back failed')
    return result


def post_website(path, body, timeout=30):
    base, token = context_settings()
    request = urllib.request.Request(base + path, data=json.dumps(body).encode(),
                                     headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        result = json.load(response)
    if result.get('ok') is False:
        raise RuntimeError(result.get('error') or 'Website request failed')
    return result


def listen(token, reviews, public_url):
    req = urllib.request.Request(URL + "/inbound", headers={"x-hermes-sidecar-token": token})
    with urllib.request.urlopen(req, timeout=None) as stream:
        for line in stream:
            if not line.strip():
                continue
            try:
                event = json.loads(line)
                text = message_text(event.get("content"))
                if not text:
                    continue
                if reviews.has_message(event.get('messageId')):
                    continue
                contact_phone = event.get('sender', {}).get('id')
                owner_phone = reviews.organizer_for_contact_phone(contact_phone)
                if owner_phone:
                    event = dict(event)
                    event['replyFromPhone'] = contact_phone
                    event['recipientPhone'] = contact_phone
                    event['sender'] = {'id': owner_phone}
                    event['organizerPhone'] = owner_phone
                    event['organizerSpaceId'] = reviews.organizer_space_for(owner_phone)
                try:
                    message_hash = hashlib.sha256(str(event.get('messageId', '')).encode()).hexdigest()
                    record_outcome(event, 'in-' + message_hash, text)
                except Exception as exc:
                    print(f'Workspace inbound write-back failed: {exc}', flush=True)
                reply, _, email = get_response.get_response_with_context(text, event.get('sender', {}).get('id'))
                if email and calendar_proposal.get():
                    raise RuntimeError('One request cannot create both an email and Calendar proposal. Ask for one action at a time.')
                if email:
                    post_website('/api/agent/google/gmail/drafts', {
                        'phoneNumber': event['sender']['id'], 'reviewId': email['reviewId'], 'proposal': email,
                    })
                review_id, created = reviews.create_once(reply, event, calendar_event=calendar_proposal.get(), email_proposal=email)
                if not created:
                    continue
                post(token, "/send-app", {
                    "reviewId": review_id,
                    "spaceId": event.get('organizerSpaceId') or event["space"]["id"],
                    "url": public_url + "/review/" + review_id,
                    "kind": "calendar" if calendar_proposal.get() else "email" if email else "message",
                })
                reviews.mark_card_sent(review_id)
            except Exception as exc:
                print(f"Reply failed: {exc}", flush=True)
    raise ConnectionError("Photon stream closed")


def recover_review_cards(token, reviews, public_url):
    for review_id, item in reviews.unsent_cards():
        event = item['event']
        try:
            post(token, '/send-app', {
                'reviewId': review_id,
                'spaceId': event.get('space', {}).get('id'),
                'organizerPhone': event.get('sender', {}).get('id'),
                'url': public_url + '/review/' + review_id,
                'kind': 'calendar' if item.get('calendar_event') else 'email' if item.get('email_proposal') else 'message',
            })
            reviews.mark_card_sent(review_id)
        except Exception as exc:
            print(f'Review card recovery failed: {exc}', flush=True)


def create_due_followup_reviews(token, reviews, public_url, *, now=None, owner_phone=None):
    zone = ZoneInfo(os.environ.get('AMBASSADOR_TIMEZONE', 'America/New_York'))
    now = now or datetime.now(zone)
    due = now.date().isoformat()
    created = 0
    for account_phone in ([owner_phone] if owner_phone else reviews.organizer_phones()):
        snapshot = fetch_context(account_phone)
        workspace = json.loads((snapshot / 'workspace.json').read_text(encoding='utf-8'))
        for contact in workspace.get('contacts', []):
            if contact.get('channel') != 'imessage' or not contact.get('nextAction') or not contact.get('nextDate'):
                continue
            if contact['nextDate'] > due:
                continue
            recipient_phone = contact.get('phone')
            if not isinstance(recipient_phone, str) or not recipient_phone.startswith('+'):
                continue
            label = contact.get('contact') or contact.get('company') or 'there'
            body = f"Hi {label}, following up on {contact['nextAction']}. Let me know if you'd like to discuss."
            stable = f"followup:{account_phone}:{contact.get('id', '')}:{contact['nextDate']}"
            message_id = 'followup-' + hashlib.sha256(stable.encode()).hexdigest()
            event = {
                'kind': 'followup', 'messageId': message_id,
                'sender': {'id': account_phone}, 'recipientPhone': recipient_phone,
                'space': {'id': '', 'type': 'dm', 'phone': recipient_phone},
                'contactId': contact.get('id'), 'contactName': label,
                'dueDate': contact['nextDate'], 'content': {'type': 'text', 'text': body},
            }
            review_id, was_created = reviews.create_once(body, event, recipient_phone=recipient_phone)
            if was_created:
                created += 1
            if was_created or any(key == review_id for key, _ in reviews.unsent_cards()):
                post(token, '/send-app', {
                    'reviewId': review_id, 'spaceId': '', 'organizerPhone': account_phone,
                    'url': public_url + '/review/' + review_id, 'kind': 'message',
                })
                reviews.mark_card_sent(review_id)
    return created


def followup_scheduler(token, reviews, public_url):
    state_path = Path(__file__).with_name('data') / 'followup-checks.json'
    try:
        checked = json.loads(state_path.read_text(encoding='utf-8')) if state_path.exists() else {}
    except (OSError, ValueError):
        checked = {}
    interval = 15
    while True:
        try:
            zone = ZoneInfo(os.environ.get('AMBASSADOR_TIMEZONE', 'America/New_York'))
            now = datetime.now(zone)
            hour = int(os.environ.get('AMBASSADOR_FOLLOWUP_HOUR', '9'))
            interval = max(5, min(1440, int(os.environ.get('AMBASSADOR_FOLLOWUP_POLL_MINUTES', '15'))))
            if not 0 <= hour <= 23:
                raise ValueError('AMBASSADOR_FOLLOWUP_HOUR must be between 0 and 23.')
            date = now.date().isoformat()
            if now.hour >= hour:
                for phone in reviews.organizer_phones():
                    if checked.get(phone) == date:
                        continue
                    try:
                        create_due_followup_reviews(token, reviews, public_url, now=now, owner_phone=phone)
                        checked[phone] = date
                        temporary = state_path.with_suffix('.tmp')
                        temporary.write_text(json.dumps(checked), encoding='utf-8')
                        os.replace(temporary, state_path)
                    except Exception as exc:
                        print(f'Due follow-up scheduler failed: {exc}', flush=True)
        except Exception as exc:
            print(f'Due follow-up scheduler configuration failed: {exc}', flush=True)
        time.sleep(interval * 60)


def main():
    # Hermes may replace this process with its managed Python runtime.
    # Do that before starting servers or the sidecar.
    get_response.load_hermes()
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent / '.env.local', override=False)
    env = os.environ.copy()
    public_url = env.get("WIDGET_PUBLIC_URL", "").rstrip("/")
    if not public_url.startswith("https://"):
        raise SystemExit("Set WIDGET_PUBLIC_URL to your public HTTPS widget URL (see README.md).")
    auth_file = HOME / "auth.json"
    auth = json.loads(auth_file.read_text()) if auth_file.exists() else {}
    project = next(iter(auth.get("credential_pool", {}).get("photon_project", [])), {})
    env.setdefault("PHOTON_PROJECT_ID", project.get("spectrum_project_id") or project.get("project_id") or "")
    env.setdefault("PHOTON_PROJECT_SECRET", project.get("project_secret") or "")
    if not env["PHOTON_PROJECT_ID"] or not env["PHOTON_PROJECT_SECRET"]:
        raise SystemExit("Run hermes photon setup first.")
    nodes = sorted((HOME / "tools").glob("node-*/bin/node"))
    node = str(nodes[-1]) if nodes else shutil.which("node")
    if not node or not SDK_SIDECAR.is_file():
        raise SystemExit("Run hermes photon install-sidecar first.")
    token = secrets.token_hex(16)
    env.update(PHOTON_SIDECAR_PORT="8791", PHOTON_SIDECAR_BIND="127.0.0.1",
               PHOTON_SIDECAR_TOKEN=token, PHOTON_TELEMETRY="false",
               PHOTON_SDK_SIDECAR=str(SDK_SIDECAR))
    env["PATH"] = str(Path(node).parent) + os.pathsep + env.get("PATH", "")
    def send_approved(event, text, review_id):
        result = post(token, '/send-message', {
            'reviewId': review_id,
            'spaceId': event['space']['id'],
                    'organizerPhone': event.get('organizerPhone'),
            'recipientPhone': event.get('recipientPhone'),
            'text': text,
        })
        event = dict(event)
        event['reviewId'] = review_id
        try:
            record_outcome(event, 'out-' + review_id, text, result.get('messageId'))
        except Exception as exc:
            print(f'Workspace write-back failed after Photon accepted message: {exc}', flush=True)
        return {'messageId': result.get('messageId')}

    def send_approved_email(review_id, phone_number, proposal):
        return post_website('/api/agent/google/gmail/send', {
            'phoneNumber': phone_number, 'reviewId': review_id, 'proposal': proposal,
        })

    def reject_email(review_id, phone_number, proposal):
        return post_website('/api/agent/google/gmail/drafts', {
            'phoneNumber': phone_number, 'reviewId': review_id,
            'proposal': proposal, 'decision': 'rejected',
        })

    reviews = ReviewStore(emit=get_response.handle_decision, state_path=REVIEW_STATE,
                          on_message_approve=send_approved,
                          on_email_approve=send_approved_email,
                          on_email_reject=reject_email,
                          on_decision=lambda review_id, result: post(token, '/update-app', {
                              'reviewId': review_id, 'action': result['action'],
                          }), on_calendar_approve=create_approved_event)
    server = start_widget_server(reviews, env.get("WIDGET_BIND", "127.0.0.1"),
                                 int(env.get("WIDGET_PORT", "8792")))
    proc = None
    try:
        proc = subprocess.Popen([node, str(SIDECAR)], cwd=SIDECAR.parent, env=env)
        deadline = time.monotonic() + 30
        while True:
            if proc.poll() is not None:
                raise SystemExit(f"Photon sidecar exited ({proc.returncode}).")
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise SystemExit("Photon sidecar did not start within 30 seconds.")
            try:
                post(token, "/healthz", {}, timeout=min(1, remaining))
                break
            except (urllib.error.URLError, OSError):
                time.sleep(0.4)
        print("Listening. Ctrl-C to stop.", flush=True)
        recover_review_cards(token, reviews, public_url)
        threading.Thread(target=followup_scheduler, args=(token, reviews, public_url), daemon=True).start()
        while proc.poll() is None:
            try:
                listen(token, reviews, public_url)
            except (urllib.error.URLError, OSError) as exc:
                print(f"Reconnecting: {exc}", flush=True)
                time.sleep(2)
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()
        server.server_close()
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()


if __name__ == "__main__":
    main()
