"""Small review UI. Actions only print responses; they never send outreach."""
import html
import json
import secrets
import threading
import time
import os
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class CalendarApprovalError(RuntimeError):
    pass


def validate_email_proposal(value, original):
    allowed = {'recipient', 'subject', 'body', 'cc', 'bcc', 'attachmentRefs', 'replyTo', 'contactId'}
    if set(value) - allowed:
        raise ValueError('Email contains unsupported fields.')
    recipient = value.get('recipient')
    subject = value.get('subject')
    body = value.get('body')
    if not isinstance(recipient, str) or not recipient.strip() or len(recipient) > 254 or '@' not in recipient:
        raise ValueError('Enter a valid email recipient.')
    if not isinstance(subject, str) or len(subject) > 500:
        raise ValueError('Email subject must be at most 500 characters.')
    if not isinstance(body, str) or not body.strip() or len(body) > 20000:
        raise ValueError('Email body must contain 1 to 20,000 characters.')
    def addresses(name):
        values = value.get(name, [])
        if not isinstance(values, list) or len(values) > 20 or any(not isinstance(item, str) or len(item) > 254 or '@' not in item for item in values):
            raise ValueError(f'Invalid {name.upper()} address list.')
        return values
    refs = value.get('attachmentRefs', original.get('attachmentRefs', []))
    if refs != original.get('attachmentRefs', []):
        raise ValueError('Attachment references cannot be changed in this review.')
    reply_to = value.get('replyTo', original.get('replyTo', ''))
    contact_id = value.get('contactId', original.get('contactId', ''))
    if reply_to != original.get('replyTo', '') or contact_id != original.get('contactId', ''):
        raise ValueError('Reply-to and linked contact cannot be changed in this review.')
    return {'recipient': recipient.strip(), 'subject': subject, 'body': body,
            'cc': addresses('cc'), 'bcc': addresses('bcc'), 'attachmentRefs': refs,
            'replyTo': reply_to, 'contactId': contact_id}


class ReviewStore:
    def __init__(self, emit=None, clock=time.time, on_decision=None, on_calendar_approve=None,
                 on_message_approve=None, on_email_approve=None, on_email_reject=None, state_path=None):
        self.items = {}
        self.lock = threading.Lock()
        self.clock = clock
        self.on_decision = on_decision
        self.on_calendar_approve = on_calendar_approve
        self.on_message_approve = on_message_approve
        self.on_email_approve = on_email_approve
        self.on_email_reject = on_email_reject
        self.state_path = Path(state_path) if state_path else None
        self.emit = emit or (lambda response: print(
            'Widget response: ' + json.dumps(response, ensure_ascii=False), flush=True))
        if self.state_path and self.state_path.exists():
            try:
                saved = json.loads(self.state_path.read_text(encoding='utf-8'))
                self.items = saved if isinstance(saved, dict) else {}
                # A process may have died after Photon accepted a send. Never
                # retry that ambiguous request automatically.
                for item in self.items.values():
                    if item.get('delivery') == 'sending':
                        item['delivery'] = 'uncertain'
                        item['delivery_error'] = 'Listener restarted during provider send; reconcile manually.'
                    item['processing'] = False
                self._persist()
            except (OSError, ValueError):
                raise RuntimeError('Could not read review state; refusing to start with empty approval history.')

    def _persist(self):
        if not self.state_path:
            return
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix='.reviews-', dir=self.state_path.parent)
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as stream:
                json.dump(self.items, stream, ensure_ascii=False)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.state_path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def create_once(self, text, event, calendar_event=None, email_proposal=None, recipient_phone=None):
        with self.lock:
            incoming_id = event.get('messageId')
            for key, existing in self.items.items():
                if incoming_id and existing.get('event', {}).get('messageId') == incoming_id:
                    return key, False
            key = email_proposal.get('reviewId') if email_proposal else secrets.token_urlsafe(32)
            if not isinstance(key, str) or not key or key in self.items:
                raise RuntimeError('Review ID is not unique.')
            self.items[key] = dict(text=text, event=event, calendar_event=calendar_event,
                                   email_proposal=email_proposal, recipient_phone=recipient_phone,
                                   expires=self.clock() + 86400, result=None, processing=False,
                                   delivery='pending', delivery_result=None, card_sent=False)
            self._persist()
            return key, True

    def has_message(self, message_id):
        with self.lock:
            return any(item.get('event', {}).get('messageId') == message_id for item in self.items.values())

    def mark_card_sent(self, key):
        with self.lock:
            if key in self.items:
                self.items[key]['card_sent'] = True
                self._persist()

    def unsent_cards(self):
        with self.lock:
            return [(key, dict(item)) for key, item in self.items.items()
                    if not item.get('card_sent') and item.get('expires', 0) > self.clock()]

    def organizer_phones(self):
        with self.lock:
            return sorted({item.get('event', {}).get('sender', {}).get('id')
                           for item in self.items.values()
                           if item.get('event', {}).get('kind') != 'followup'
                           and item.get('event', {}).get('sender', {}).get('id')})

    def organizer_for_contact_phone(self, phone):
        with self.lock:
            owners = {item.get('event', {}).get('sender', {}).get('id')
                      for item in self.items.values()
                      if item.get('event', {}).get('recipientPhone') == phone
                      and item.get('event', {}).get('contactId')
                      and item.get('event', {}).get('sender', {}).get('id')}
            return next(iter(owners)) if len(owners) == 1 else None

    def organizer_space_for(self, phone):
        with self.lock:
            for item in reversed(list(self.items.values())):
                event = item.get('event', {})
                if event.get('sender', {}).get('id') == phone and not event.get('organizerPhone') and event.get('kind') != 'followup':
                    return event.get('space', {}).get('id')
            return None

    def create(self, text, event, calendar_event=None, email_proposal=None, recipient_phone=None):
        return self.create_once(text, event, calendar_event, email_proposal, recipient_phone)[0]

    def get(self, key):
        with self.lock:
            item = self.items.get(key)
            if not item or item['expires'] <= self.clock():
                raise KeyError('This review expired or the listener restarted.')
            return dict(item)

    def submit(self, key, payload):
        with self.lock:
            item = self.items.get(key)
            if not item or item['expires'] <= self.clock():
                raise KeyError('This review expired or the listener restarted.')
            if item['result'] is not None:
                raise RuntimeError('This response has already been recorded.')
            if item.get('delivery') in ('sending', 'uncertain'):
                raise RuntimeError('Message delivery is uncertain; check conversation before retrying.')
            if item['processing']:
                raise RuntimeError('This approval is already processing.')
            action = payload.get('action')
            if action not in ('approve', 'reject', 'edit_approve'):
                raise ValueError('Choose approve, reject, or edit_approve.')
            if item['calendar_event'] and action == 'edit_approve':
                raise ValueError('Calendar event details cannot be edited in this review.')
            item['processing'] = True
            text = item['text']
            if action == 'edit_approve':
                text = payload.get('text')
                if not isinstance(text, str) or not text.strip() or len(text) > 20000:
                    item['processing'] = False
                    raise ValueError('Enter a response between 1 and 20,000 characters.')
            calendar_event = item['calendar_event'] if action == 'approve' else None
            sender = item['event'].get('sender', {}).get('id')
            is_message_approval = action in ('approve', 'edit_approve') and not item['calendar_event']
            email_proposal = item.get('email_proposal')
            if email_proposal and action == 'edit_approve':
                email_proposal = payload.get('email')
                if not isinstance(email_proposal, dict):
                    item['processing'] = False
                    raise ValueError('Reviewed email fields are required.')
                email_proposal = validate_email_proposal(email_proposal, item['email_proposal'])
                text = email_proposal['body']
            is_email_approval = action in ('approve', 'edit_approve') and bool(item.get('email_proposal'))
            is_message_approval = is_message_approval and not is_email_approval and not item['calendar_event']
            if is_email_approval:
                item['delivery'] = 'sending'
                item['email_proposal'] = email_proposal
            if action == 'reject' and item.get('email_proposal'):
                item['delivery'] = 'pending'
            if is_message_approval:
                item['delivery'] = 'sending'
            self._persist()
        created_event = None
        if calendar_event:
            if not self.on_calendar_approve:
                with self.lock:
                    item['processing'] = False
                    self._persist()
                raise RuntimeError('Calendar approval is not configured.')
            try:
                created_event = self.on_calendar_approve(key, sender, calendar_event)
            except Exception as exc:
                with self.lock:
                    item['processing'] = False
                    self._persist()
                raise CalendarApprovalError('Calendar could not create event. Check Google connection, then retry.') from exc
        result = dict(action=action, text=text, original_text=item['text'],
                      sender=sender, space_id=item['event']['space']['id'],
                      message_id=item['event'].get('messageId'))
        if created_event:
            result['calendar_event'] = created_event
        if item.get('email_proposal') and action == 'reject' and self.on_email_reject:
            try:
                self.on_email_reject(key, sender, item['email_proposal'])
            except Exception as exc:
                print(f'Email rejection write-back failed: {exc}', flush=True)
        if is_email_approval:
            if not self.on_email_approve:
                with self.lock:
                    item['delivery'] = 'not_configured'
                    item['delivery_error'] = 'Gmail approval is not configured.'
                    item['processing'] = False
                    item['result'] = result
                    self._persist()
                raise RuntimeError('Gmail approval is not configured.')
            try:
                sent = self.on_email_approve(key, sender, email_proposal)
                result['email_result'] = sent
                result['email_proposal'] = email_proposal
                with self.lock:
                    item['delivery'] = 'sent'
                    item['delivery_result'] = sent
            except Exception as exc:
                with self.lock:
                    item['delivery'] = 'uncertain'
                    item['delivery_error'] = str(exc)[:300]
                    item['result'] = result
                    item['processing'] = False
                    self._persist()
                raise RuntimeError('Gmail send outcome uncertain. Check Gmail before retrying.') from exc
        if is_message_approval:
            if not self.on_message_approve:
                with self.lock:
                    item['delivery'] = 'not_configured'
                    item['delivery_error'] = 'Photon message sending is not configured.'
                    item['processing'] = False
                    item['result'] = result
                    self._persist()
                raise RuntimeError('Photon message sending is not configured.')
            try:
                delivery = self.on_message_approve(item['event'], text, key)
                result['delivery'] = delivery
                with self.lock:
                    item['delivery'] = 'sent'
                    item['delivery_result'] = delivery
            except Exception as exc:
                with self.lock:
                    item['delivery'] = 'uncertain'
                    item['delivery_error'] = str(exc)[:300]
                    item['result'] = result
                    item['processing'] = False
                    self._persist()
                raise RuntimeError('Photon send failed or has uncertain outcome. Do not retry automatically; reconcile in conversation.') from exc
        with self.lock:
            item['result'] = result
            item['processing'] = False
            self._persist()
            self.emit(result)
        return result

    def update_card(self, key, result):
        # The decision is final even when updating the remote card fails.
        # Never hold the store lock while waiting for Photon.
        updated = False
        if self.on_decision:
            try:
                self.on_decision(key, result)
                updated = True
            except Exception as exc:
                print(f'Card update failed; decision is recorded: {exc}', flush=True)
        return updated


def render(item):
    status = item['result']
    uncertain = item.get('delivery') in ('sending', 'uncertain', 'not_configured')
    text = status['text'] if status else item['text']
    proposal = item.get('calendar_event')
    email = item.get('email_proposal')
    email_details = ''
    if email:
        email_details = ('<dl><dt>To</dt><dd>' + html.escape(email['recipient']) +
                         '</dd><dt>Subject</dt><dd>' + html.escape(email['subject']) + '</dd>')
        if email.get('cc'):
            email_details += '<dt>CC</dt><dd>' + html.escape(', '.join(email['cc'])) + '</dd>'
        if email.get('bcc'):
            email_details += '<dt>BCC</dt><dd>' + html.escape(', '.join(email['bcc'])) + '</dd>'
        if email.get('attachmentRefs'):
            email_details += '<dt>Attachments</dt><dd>' + html.escape(', '.join(email['attachmentRefs'])) + '</dd>'
        email_details += '<dt>Message</dt><dd><pre>' + html.escape(email['body']) + '</pre></dd></dl>'
    if proposal:
        details = ('<dl><dt>Event</dt><dd>' + html.escape(proposal['summary']) +
                   '</dd><dt>Starts</dt><dd>' + html.escape(proposal['start']) +
                   '</dd><dt>Ends</dt><dd>' + html.escape(proposal['end']) +
                   '</dd><dt>Time zone</dt><dd>' + html.escape(proposal['timeZone']) + '</dd>')
        if proposal.get('location'):
            details += '<dt>Location</dt><dd>' + html.escape(proposal['location']) + '</dd>'
        details += '</dl>'
        title = 'Event added to Calendar' if status and status['action'] == 'approve' else 'Calendar event not added' if status else 'Calendar event review'
        status_text = 'Event created and time blocked.' if status and status['action'] == 'approve' else 'Event was not created.' if status else 'Check event details, then choose whether to add it.'
    else:
        details = ''
        accepted_email = status and status.get('email_result', {}).get('status') == 'accepted'
        sent_message = status and status.get('delivery', {}).get('messageId')
        title = 'Rejected' if status and status['action'] == 'reject' else 'Email accepted by Gmail' if accepted_email else 'Message sent' if sent_message else 'Delivery uncertain' if (status and status['action'] in ('approve', 'edit_approve')) or uncertain else 'Review message'
        status_text = 'Gmail accepted the approved email; acceptance does not confirm delivery.' if accepted_email else 'Response sent through iMessage.' if sent_message else item.get('delivery_error', 'Message delivery is uncertain; check the provider before retrying.') if (status and status['action'] in ('approve', 'edit_approve')) or uncertain else 'Response rejected.' if status else 'Review this response'
    return (Path(__file__).with_name('widget.html').read_text()
            .replace('__RESPONSE__', html.escape(text))
            .replace('__FINISHED__', 'true' if status or uncertain else 'false')
            .replace('__TITLE__', html.escape(title))
            .replace('__KIND__', 'CALENDAR EVENT' if proposal else 'EMAIL REVIEW' if email else 'RESPONSE REVIEW')
            .replace('__KIND_ID__', 'calendar' if proposal else 'email' if email else 'message')
            .replace('__APPROVE_LABEL__', 'Add to Calendar' if proposal else 'Approve & Send' if email else 'Approve')
            .replace('__EDIT_LABEL__', 'Edit & Send' if email else 'Approve edited response')
            .replace('__EDIT_HIDDEN__', 'hidden' if proposal else '')
            .replace('__EMAIL_HIDDEN__', '' if email else 'hidden')
            .replace('__EMAIL_DETAILS__', email_details)
            .replace('__CALENDAR_DETAILS__', details)
            .replace('__CALENDAR_HIDDEN__', '' if proposal else 'hidden')
            .replace('__CALENDAR_ACTIONS__', '' if proposal else 'hidden')
            .replace('__STATUS__', html.escape(status_text)))


def start_widget_server(store, host='127.0.0.1', port=8792):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # Review URLs contain private bearer tokens.

        def respond(self, status, body, kind='application/json'):
            encoded = body.encode()
            try:
                self.send_response(status)
                self.send_header('Content-Type', kind + '; charset=utf-8')
                self.send_header('Content-Length', str(len(encoded)))
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Referrer-Policy', 'no-referrer')
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.send_header('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'")
                self.end_headers()
                self.wfile.write(encoded)
                self.wfile.flush()
            except ConnectionError:
                pass  # A disconnected view does not undo a recorded decision.

        def key(self):
            path = self.path.split('?', 1)[0]
            if not path.startswith('/review/') or '/' in path[len('/review/'):]:
                raise KeyError('Review not found.')
            return path[len('/review/'):]

        def do_GET(self):
            if self.path == '/widget.js':
                return self.respond(200, Path(__file__).with_name('widget.js').read_text(), 'text/javascript')
            try:
                self.respond(200, render(store.get(self.key())), 'text/html')
            except KeyError as exc:
                self.respond(404, json.dumps({'error': str(exc)}))

        def do_POST(self):
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= 100000:
                    raise ValueError('Invalid request size.')
                if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                    raise ValueError('JSON required.')
                payload = json.loads(self.rfile.read(size))
                if not isinstance(payload, dict):
                    raise ValueError('JSON object required.')
                key = self.key()
                result = store.submit(key, payload)
                self.respond(200, json.dumps({'ok': True, 'action': result['action'],
                                              'event': result.get('calendar_event'),
                                              'email': result.get('email_result')}))
                # Updating the card can reload the view that made this request.
                # Finish its HTTP response before contacting Photon.
                store.update_card(key, result)
            except KeyError as exc:
                self.respond(404, json.dumps({'error': str(exc)}))
            except (ValueError, UnicodeError) as exc:
                self.respond(400, json.dumps({'error': str(exc)}))
            except CalendarApprovalError as exc:
                self.respond(502, json.dumps({'error': str(exc)}))
            except RuntimeError as exc:
                self.respond(409, json.dumps({'error': str(exc)}))

    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server
