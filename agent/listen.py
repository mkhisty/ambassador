#!/usr/bin/env python3
"""Photon/widget communication. Agent behavior lives in get_response.py."""

import json
import argparse
import hashlib
import os
import secrets
import queue
import shutil
import subprocess
import sys
import time
import threading
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# Hermes's isolated relaunch does not include this script's directory.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from widget import ReviewStore, EmailApprovalError, start_widget_server
import get_response
from fetch_context import context_settings, normalize_phone, NoRedirect, read_api, read_document, website_headers
from calendar_tools import calendar_proposal, create_approved_event
from email_templates import expanded_emails
from gmail_inbox import inbox_loop
from diagnostics import verbose_enabled, verbose_headers, verbose_log, fingerprint, error_info

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
    started = time.monotonic()
    verbose_log('photon.request', path=path, review=fingerprint(body.get('reviewId')))
    req = urllib.request.Request(
        URL + path,
        data=json.dumps(body).encode(),
        headers={"x-hermes-sidecar-token": token, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        result = json.load(response)
    if result.get("ok") is False:
        raise RuntimeError(result.get("error") or "Photon request failed")
    verbose_log('photon.response', path=path, elapsed_ms=round((time.monotonic()-started)*1000), message_id=result.get('messageId'))
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
        headers={**website_headers(token), 'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        result = json.load(response)
    if not result.get('ok'):
        raise RuntimeError(result.get('error') or 'Workspace write-back failed')
    return result


def post_website(path, body, timeout=30):
    started = time.monotonic()
    verbose_log('website.request', path=path, review=fingerprint(body.get('reviewId')))
    base, token = context_settings()
    request = urllib.request.Request(base + path, data=json.dumps(body).encode(),
                                     headers={**website_headers(token), 'Content-Type': 'application/json', **verbose_headers()})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            result = json.load(response)
        verbose_log('website.response', path=path, elapsed_ms=round((time.monotonic()-started)*1000),
                    outcome=result.get('status'), diagnostics=result.get('diagnostics'))
    except urllib.error.HTTPError as error:
        error.response_body = error.read(30000)
        error.close()
        try:
            failure = json.loads(error.response_body)
        except (ValueError, OSError):
            failure = {'error': 'Non-JSON HTTP error response'}
        verbose_log('website.failed', path=path, http_status=error.code,
                    elapsed_ms=round((time.monotonic()-started)*1000), failure=failure)
        raise
    except Exception as error:
        verbose_log('website.failed', path=path, error=error_info(error))
        raise
    if result.get('ok') is False:
        raise RuntimeError(result.get('error') or 'Website request failed')
    return result


def send_response(token, reviews, event, text, response_id):
    """Deliver conversational text to the account owner, without a review widget."""
    key, created = reviews.begin_reply(event, text, response_id)
    if not created:
        return
    try:
        delivery = post(token, '/send-message', {
            'reviewId': key,
            'spaceId': event.get('organizerSpaceId') or event.get('space', {}).get('id'),
            'recipientPhone': event['sender']['id'],
            'text': text,
        })
        reviews.finish_reply(key, delivery)
    except Exception:
        reviews.finish_reply(key)
        raise


def send_approved_email(review_id, phone_number, proposal):
    if proposal.get('recipients'):
        messages = expanded_emails(proposal, review_id)
        outcomes = []
        for index, (child_id, message) in enumerate(messages):
            try:
                result = send_approved_email(child_id, phone_number, message)
                if result.get('status') != 'accepted' or not result.get('messageId'):
                    raise EmailApprovalError('Gmail acceptance was not confirmed.')
                outcomes.append({'recipient': message['recipient'], **result})
            except Exception as error:
                outcomes.append({'recipient': message['recipient'],
                                 'status': getattr(error, 'status', 'uncertain')})
                outcomes.extend({'recipient': remaining['recipient'], 'status': 'not_sent'}
                                for _, remaining in messages[index + 1:])
                accepted = sum(row['status'] == 'accepted' for row in outcomes)
                failure = EmailApprovalError(
                    f'{accepted} of {len(messages)} emails accepted by Gmail. Sending stopped; review recipient results before any retry.',
                    'partial' if accepted else getattr(error, 'status', 'uncertain'))
                failure.results = outcomes
                raise failure from None
        return {'status': 'accepted', 'messageId': outcomes[0]['messageId'], 'results': outcomes}
    verbose_log('email.approved', review=fingerprint(review_id), recipient=proposal.get('recipient'),
                attachment_count=len(proposal.get('attachmentRefs', [])))
    try:
        return post_website('/api/agent/google/gmail/send', {
            'phoneNumber': phone_number, 'reviewId': review_id, 'proposal': proposal,
        })
    except urllib.error.HTTPError as error:
        try:
            failure = json.loads(error.response_body if hasattr(error, 'response_body') else error.read(30000))
        except (ValueError, OSError):
            failure = {}
        finally:
            error.close()
        status = ('uncertain' if failure.get('status') in ('send_unknown', 'sending') else
                  'failed' if failure.get('status') == 'failed' else
                  'not_sent' if error.code < 500 else 'uncertain')
        raise EmailApprovalError('Website could not complete the approved Gmail send.', status) from None



def request_email_review(token, reviews, public_url, event, proposal):
    """Called by the email tool; save exact fields before sending the approval card."""
    if reviews.has_message(event.get('messageId')):
        raise RuntimeError('An email review already exists for this request.')
    if event.get('gmailMessageId'):
        proposal['incomingMessageId'] = event['gmailMessageId']
    for child_id, message in expanded_emails(proposal):
        saved = post_website('/api/agent/google/gmail/drafts', {
            'phoneNumber': event['sender']['id'], 'reviewId': child_id, 'proposal': message,
        })
        if isinstance(saved, dict) and saved.get('attachments'):
            proposal['attachments'] = saved['attachments']
    key, created = reviews.create_once(proposal['body'], event, email_proposal=proposal)
    if not created:
        raise RuntimeError('An email review already exists for this request.')
    post(token, '/send-app', {
        'reviewId': key,
        'spaceId': event.get('organizerSpaceId') or event['space']['id'],
        'organizerPhone': event['sender']['id'],
        'url': public_url + '/review/' + key,
        'kind': 'email',
    })
    reviews.mark_card_sent(key)
    verbose_log('email.review_sent', review=fingerprint(key), recipient=proposal['recipient'])


def download_review_attachment(phone_number, document_id):
    base, token = context_settings()
    path = '/api/agent/context/documents/' + urllib.parse.quote(document_id, safe='')
    query = urllib.parse.urlencode({'phoneNumber': normalize_phone(phone_number)})
    return read_document(urllib.request.build_opener(NoRedirect()), base + path + '?' + query, token, 25_000_000)


def deliver_email_feedback(token, reviews, key, event, outcome):
    verbose_log('email.outcome', review=fingerprint(key), outcome=outcome.get('status'))
    with get_response.CONVERSATION_LOCK:
        reply = get_response.handle_email_outcome(event, outcome)
        send_response(token, reviews, event, reply, 'email-outcome-' + key)
        reviews.mark_feedback_sent(key)


def email_feedback_loop(token, reviews, feedback):
    """Process outcomes separately so widget submissions never wait for Hermes."""
    while True:
        key, event, outcome = feedback.get()
        try:
            deliver_email_feedback(token, reviews, key, event, outcome)
        except Exception as exc:
            print(f'Email outcome reply failed: {exc}', flush=True)
        finally:
            feedback.task_done()


def listen(token, reviews, public_url):
    req = urllib.request.Request(URL + "/inbound", headers={"x-hermes-sidecar-token": token})
    with urllib.request.urlopen(req, timeout=None) as stream:
        for line in stream:
            if not line.strip():
                continue
            event = None
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
                event = {**event, 'requestText': text}
                with get_response.CONVERSATION_LOCK:
                    reply, _, email = get_response.get_response_with_context(
                        text, event['sender']['id'],
                        on_email_proposal=lambda proposal: request_email_review(token, reviews, public_url, event, proposal),
                    )
                    send_response(token, reviews, event, reply, 'incoming-' + event['messageId'])
                if email and calendar_proposal.get():
                    raise RuntimeError('One request cannot create both an email and Calendar proposal. Ask for one action at a time.')
                if not calendar_proposal.get():
                    continue
                calendar_message = {**event, 'messageId': 'calendar-' + event['messageId']}
                review_id, created = reviews.create_once(reply, calendar_message, calendar_event=calendar_proposal.get())
                if not created:
                    continue
                post(token, "/send-app", {
                    "reviewId": review_id,
                    "spaceId": event.get('organizerSpaceId') or event["space"]["id"],
                    "url": public_url + "/review/" + review_id,
                    "kind": "calendar",
                })
                reviews.mark_card_sent(review_id)
            except Exception as exc:
                verbose_log('conversation.failed', error=error_info(exc))
                print(f"Reply failed: {exc}", flush=True)
                if isinstance(event, dict) and event.get('sender', {}).get('id') and event.get('messageId'):
                    try:
                        send_response(token, reviews, event,
                                      'I couldn’t complete that request. Please check the website connection and try again.',
                                      'incoming-' + event['messageId'])
                    except Exception as send_error:
                        print(f'Request error reply failed: {send_error}', flush=True)
    raise ConnectionError("Photon stream closed")


def recover_review_cards(token, reviews, public_url):
    for review_id, item in reviews.unsent_cards():
        if not item.get('email_proposal') and not item.get('calendar_event'):
            continue
        event = item['event']
        try:
            post(token, '/send-app', {
                'reviewId': review_id,
                'spaceId': event.get('organizerSpaceId') or event.get('space', {}).get('id'),
                'organizerPhone': event.get('sender', {}).get('id'),
                'url': public_url + '/review/' + review_id,
                'kind': 'calendar' if item.get('calendar_event') else 'email',
            })
            reviews.mark_card_sent(review_id)
        except Exception as exc:
            print(f'Review card recovery failed: {exc}', flush=True)


def main():
    # Hermes may replace this process with its managed Python runtime.
    # Do that before starting servers or the sidecar.
    get_response.load_hermes()
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent / '.env.local', override=False)
    parser = argparse.ArgumentParser(description='Ambassador Photon listener')
    parser.add_argument('--verbose', action='store_true', help='Log redacted request stages and provider errors')
    if parser.parse_args().verbose:
        os.environ['AMBASSADOR_VERBOSE'] = '1'
    verbose_log('listener.start', mode='verbose')
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
    def reject_email(review_id, phone_number, proposal):
        for child_id, message in expanded_emails(proposal, review_id):
            post_website('/api/agent/google/gmail/drafts', {
                'phoneNumber': phone_number, 'reviewId': child_id,
                'proposal': message, 'decision': 'rejected',
            })

    feedback = queue.Queue()
    reviews = ReviewStore(emit=get_response.handle_decision, state_path=REVIEW_STATE,
                          on_attachment_download=download_review_attachment,
                          on_email_outcome=lambda key, event, outcome: feedback.put((key, event, outcome)),
                          on_email_approve=send_approved_email,
                          on_email_reject=reject_email,
                          on_decision=lambda review_id, result: post(token, '/update-app', {
                              'reviewId': review_id, 'action': result['action'],
                          }), on_calendar_approve=create_approved_event)
    server = start_widget_server(reviews, env.get("WIDGET_BIND", "127.0.0.1"),
                                 int(env.get("WIDGET_PORT", "8792")))
    proc = None
    inbox_stop = threading.Event()
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
        threading.Thread(target=email_feedback_loop, args=(token, reviews, feedback), daemon=True).start()
        if env.get('GMAIL_INBOX_ENABLED', '1').lower() not in ('0', 'false', 'no'):
            threading.Thread(target=inbox_loop, args=(post_website, reviews,
                get_response.get_response_with_context,
                lambda event, proposal: request_email_review(token, reviews, public_url, event, proposal),
                lambda event, reply, response_id: send_response(token, reviews, event, reply, response_id),
                get_response.CONVERSATION_LOCK, inbox_stop,
                lambda: recover_review_cards(token, reviews, public_url)), daemon=True).start()
        for key in reviews.pending_email_feedback():
            reviews.queue_email_feedback(key)
        for key in reviews.pending_email_sends():
            reviews.start_email(key)
        while proc.poll() is None:
            try:
                listen(token, reviews, public_url)
            except (urllib.error.URLError, OSError) as exc:
                print(f"Reconnecting: {exc}", flush=True)
                time.sleep(2)
    except KeyboardInterrupt:
        pass
    finally:
        inbox_stop.set()
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
