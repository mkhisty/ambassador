"""Action review UI with persisted decisions and provider outcomes."""
import html
import hashlib
import json
import secrets
import threading
import time
import os
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit
from email_templates import FIELDS, recipients as normalize_recipients, expanded_emails


class CalendarApprovalError(RuntimeError):
    pass


class EmailApprovalError(RuntimeError):
    def __init__(self, message, status='uncertain'):
        super().__init__(message)
        self.status = status


def validate_email_proposal(value, original):
    allowed = {'recipient', 'recipients', 'subject', 'body', 'cc', 'bcc', 'attachmentRefs', 'attachments', 'replyTo', 'contactId'}
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
    if value.get('attachments', original.get('attachments', [])) != original.get('attachments', []):
        raise ValueError('Attachment details cannot be changed in this review.')
    reply_to = value.get('replyTo', original.get('replyTo', ''))
    contact_id = value.get('contactId', original.get('contactId', ''))
    if reply_to != original.get('replyTo', '') or contact_id != original.get('contactId', ''):
        raise ValueError('Reply-to and linked contact cannot be changed in this review.')
    result = {'recipient': recipient.strip(), 'subject': subject, 'body': body,
            'cc': addresses('cc'), 'bcc': addresses('bcc'), 'attachmentRefs': refs,
            'replyTo': reply_to, 'contactId': contact_id}
    if original.get('reviewId'):
        result['reviewId'] = original['reviewId']
    if original.get('attachments'):
        result['attachments'] = original['attachments']
    if original.get('incomingMessageId'):
        result['incomingMessageId'] = original['incomingMessageId']
    if original.get('recipients'):
        result['recipients'] = normalize_recipients(value.get('recipients'), original['recipients'])
        result['recipient'] = result['recipients'][0]['email']
        expanded_emails(result)
    elif value.get('recipients'):
        raise ValueError('Recipient count cannot change during this review.')
    else:
        expanded_emails(result)
    return result


class ReviewStore:
    def __init__(self, emit=None, clock=time.time, on_decision=None, on_calendar_approve=None,
                 on_message_approve=None, on_email_approve=None, on_email_reject=None,
                 on_email_outcome=None, on_attachment_download=None, state_path=None):
        self.items = {}
        self.lock = threading.Lock()
        self.clock = clock
        self.on_decision = on_decision
        self.on_calendar_approve = on_calendar_approve
        self.on_message_approve = on_message_approve
        self.on_email_approve = on_email_approve
        self.on_email_reject = on_email_reject
        self.on_email_outcome = on_email_outcome
        self.on_attachment_download = on_attachment_download
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
                        if item.get('email_proposal'):
                            item['email_outcome'] = {'status': 'uncertain', 'action': 'approve',
                                                     'proposal': item['email_proposal']}
                            item['feedback_status'] = 'pending'
                    item['processing'] = False
                    if item.get('feedback_status') == 'queued':
                        item['feedback_status'] = 'pending'
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
            return bool(message_id) and any(item.get('event', {}).get('messageId') == message_id for item in self.items.values())

    def begin_reply(self, event, text, response_id):
        """Persist a plain reply before sending, without creating an approval card."""
        key = 'reply-' + hashlib.sha256(response_id.encode()).hexdigest()
        with self.lock:
            if key in self.items:
                return key, False
            self.items[key] = dict(text=text, event=event, calendar_event=None,
                                   email_proposal=None, response_only=True,
                                   expires=self.clock() + 86400, result=None,
                                   processing=False, delivery='sending', card_sent=True)
            self._persist()
        return key, True

    def finish_reply(self, key, delivery=None):
        with self.lock:
            self.items[key]['delivery'] = 'sent' if delivery else 'uncertain'
            self.items[key]['delivery_result'] = delivery
            self._persist()

    def _email_finished(self, key, outcome):
        with self.lock:
            self.items[key]['email_outcome'] = outcome
            self.items[key]['feedback_status'] = 'pending'
            self._persist()
        try:
            self.queue_email_feedback(key)
        except Exception as exc:
            print(f'Email outcome notification remains pending: {exc}', flush=True)

    def queue_email_feedback(self, key):
        with self.lock:
            item = self.items[key]
            if not self.on_email_outcome or item.get('feedback_status') != 'pending':
                return
            event, outcome = dict(item['event']), dict(item['email_outcome'])
            item['feedback_status'] = 'queued'
            self._persist()
        try:
            self.on_email_outcome(key, event, outcome)
        except Exception:
            with self.lock:
                item['feedback_status'] = 'pending'
                self._persist()
            raise

    def pending_email_feedback(self):
        with self.lock:
            return [key for key, item in self.items.items() if item.get('feedback_status') == 'pending']

    def mark_feedback_sent(self, key):
        with self.lock:
            self.items[key]['feedback_status'] = 'sent'
            self._persist()

    def mark_card_sent(self, key):
        with self.lock:
            if key in self.items:
                self.items[key]['card_sent'] = True
                self._persist()

    def unsent_cards(self):
        with self.lock:
            return [(key, dict(item)) for key, item in self.items.items()
                    if not item.get('response_only') and not item.get('card_sent') and item.get('expires', 0) > self.clock()]

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
            if not item or item.get('response_only') or item['expires'] <= self.clock():
                raise KeyError('This review expired or the listener restarted.')
            return dict(item)

    def attachment(self, key, document_id):
        item = self.get(key)
        proposal = item.get('email_proposal') or {}
        if document_id not in proposal.get('attachmentRefs', []) or not self.on_attachment_download:
            raise KeyError('Attachment not found.')
        metadata = next((file for file in proposal.get('attachments', []) if file['id'] == document_id),
                        {'name': 'document', 'mime': 'application/octet-stream'})
        data = self.on_attachment_download(item['event']['sender']['id'], document_id)
        return data, metadata

    def submit(self, key, payload, *, defer_email=False):
        deferred_result = None
        with self.lock:
            item = self.items.get(key)
            if not item or item.get('response_only') or item['expires'] <= self.clock():
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
            text = item['text']
            if action == 'edit_approve' and not item.get('email_proposal'):
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
            if is_email_approval:
                expanded_emails(email_proposal, key)
            is_message_approval = is_message_approval and not is_email_approval and not item['calendar_event']
            item['processing'] = True
            if is_email_approval:
                item['delivery'] = 'queued' if defer_email else 'sending'
                item['email_proposal'] = email_proposal
            if action == 'reject' and item.get('email_proposal'):
                item['delivery'] = 'pending'
            if is_message_approval:
                item['delivery'] = 'sending'
            if is_email_approval and defer_email:
                deferred_result = dict(action=action, text=text, original_text=item['text'],
                    sender=sender, space_id=item['event']['space']['id'],
                    message_id=item['event'].get('messageId'), email_proposal=email_proposal,
                    email_result={'status': 'queued'})
                item['result'] = deferred_result
                item['processing'] = False
            self._persist()
        if deferred_result is not None:
            self.emit(deferred_result)
            return deferred_result
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
        if item.get('email_proposal'):
            result['email_proposal'] = email_proposal
        if is_email_approval:
            return self._complete_email(key, item, result, sender, email_proposal)
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
        if item.get('email_proposal'):
            self._email_finished(key, {'status': 'rejected' if action == 'reject' else 'accepted',
                                      'action': action, 'proposal': email_proposal,
                                      'provider': result.get('email_result')})
        return result

    def _complete_email(self, key, item, result, sender, email_proposal):
        action = result['action']
        if not self.on_email_approve:
            with self.lock:
                item['delivery'] = 'not_configured'
                item['delivery_error'] = 'Gmail approval is not configured.'
                item['processing'] = False
                item['result'] = result
                self._persist()
            self._email_finished(key, {'status': 'not_sent', 'action': action,
                                      'proposal': email_proposal, 'error': 'Gmail sending is not configured.'})
            raise RuntimeError('Gmail approval is not configured.')
        try:
            sent = self.on_email_approve(key, sender, email_proposal)
            if not isinstance(sent, dict) or sent.get('status') != 'accepted' or not sent.get('messageId'):
                raise EmailApprovalError('Gmail acceptance was not confirmed.')
            result['email_result'] = sent
            result['email_proposal'] = email_proposal
            with self.lock:
                item['delivery'] = 'sent'
                item['delivery_result'] = sent
        except Exception as exc:
            status = exc.status if isinstance(exc, EmailApprovalError) else 'uncertain'
            recipient_results = getattr(exc, 'results', [])
            if recipient_results:
                result['email_result'] = {'status': status, 'results': recipient_results}
            with self.lock:
                item['delivery'] = status
                item['delivery_error'] = str(exc)[:300]
                item['result'] = result
                item['processing'] = False
                self._persist()
            self._email_finished(key, {'status': status, 'action': action,
                                      'proposal': email_proposal, 'results': recipient_results})
            message = ('Gmail did not send this email. Check your Google connection.'
                       if status in ('failed', 'not_sent') else str(exc) if recipient_results else 'Gmail send outcome uncertain. Check Gmail before retrying.')
            raise RuntimeError(message) from exc
        with self.lock:
            item['result'] = result
            item['processing'] = False
            self._persist()
        self.emit(result)
        self._email_finished(key, {'status': 'accepted', 'action': action,
                                  'proposal': email_proposal, 'provider': result['email_result']})
        return result

    def pending_email_sends(self):
        with self.lock:
            return [key for key, item in self.items.items() if item.get('delivery') == 'queued']

    def start_email(self, key):
        with self.lock:
            item = self.items[key]
            if item.get('delivery') != 'queued':
                return False
            item['delivery'] = 'sending'
            item['processing'] = True
            result = dict(item['result'])
            result.pop('email_result', None)
            self._persist()
        def complete():
            try:
                self._complete_email(key, item, result, result['sender'], item['email_proposal'])
            except Exception as error:
                print(f'Background email outcome: {error}', flush=True)
        threading.Thread(target=complete, name='email-send-' + key, daemon=True).start()
        return True

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


def highlighted_template(value):
    parts, previous = [], 0
    for match in FIELDS.finditer(value):
        parts.append(html.escape(value[previous:match.start()]))
        parts.append('<mark class="template-field">' + html.escape(match.group()) + '</mark>')
        previous = match.end()
    parts.append(html.escape(value[previous:]))
    return ''.join(parts)


def render(item):
    status = item['result']
    uncertain = item.get('delivery') in ('sending', 'uncertain', 'not_configured')
    text = status['text'] if status else item['text']
    proposal = item.get('calendar_event')
    email = item.get('email_proposal')
    email_details = ''
    if email:
        email_details = '<pre class="email-text">' + highlighted_template(email['body']) + '</pre>'
        email_details += ('<dl><dt>To</dt><dd>' + html.escape(
                             f"{len(email['recipients'])} recipients" if email.get('recipients') else email['recipient']) +
                         '</dd><dt>Subject</dt><dd>' + highlighted_template(email['subject']) + '</dd>')
        if email.get('cc'):
            email_details += '<dt>CC</dt><dd>' + html.escape(', '.join(email['cc'])) + '</dd>'
        if email.get('bcc'):
            email_details += '<dt>BCC</dt><dd>' + html.escape(', '.join(email['bcc'])) + '</dd>'
        if email.get('attachmentRefs'):
            files = {file['id']: file for file in email.get('attachments', [])}
            email_details += '<dt>Attachments</dt><dd><ul class="attachments">'
            for ref in email['attachmentRefs']:
                file = files.get(ref, {'name': 'Document'})
                url = '/review/' + quote(email['reviewId'], safe='') + '/attachments/' + quote(ref, safe='')
                size = f" ({file['size'] / 1000:,.0f} KB)" if file.get('size') else ''
                email_details += '<li><a href="' + html.escape(url, quote=True) + '" target="_blank" rel="noreferrer">' + html.escape(file['name']) + '</a>' + size + '</li>'
            email_details += '</ul></dd>'
        email_details += '</dl>'
        if email.get('recipients'):
            email_details += '<h2>Recipient values</h2><ul class="recipients">'
            for row in email['recipients']:
                email_details += '<li><strong>' + html.escape(row['email']) + '</strong><dl>'
                for field, value in row['parameters'].items():
                    email_details += '<dt>' + html.escape('[' + field + ']') + '</dt><dd>' + html.escape(value) + '</dd>'
                email_details += '</dl></li>'
            email_details += '</ul>'
        recipient_results = (status or {}).get('email_result', {}).get('results', [])
        if recipient_results and any(row['status'] != 'accepted' for row in recipient_results):
            email_details += '<h2>Recipient outcomes</h2><ul>' + ''.join(
                '<li>' + html.escape(row['recipient']) + ': ' + html.escape(row['status']) + '</li>'
                for row in recipient_results) + '</ul>'
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
        not_sent = item.get('delivery') in ('not_sent', 'failed', 'not_configured')
        accepted_email = status and status.get('email_result', {}).get('status') == 'accepted'
        sent_message = status and status.get('delivery', {}).get('messageId')
        title = 'Rejected' if status and status['action'] == 'reject' else 'Emails sent' if accepted_email and len(email.get('recipients', [])) > 1 else 'Email sent' if accepted_email else 'Message sent' if sent_message else 'Delivery uncertain' if (status and status['action'] in ('approve', 'edit_approve')) or uncertain else 'Review message'
        status_text = 'Your emails were sent.' if accepted_email and len(email.get('recipients', [])) > 1 else 'Your email was sent.' if accepted_email else 'Response sent through iMessage.' if sent_message else item.get('delivery_error', 'Message delivery is uncertain; check the provider before retrying.') if (status and status['action'] in ('approve', 'edit_approve')) or uncertain else 'Response rejected.' if status else 'Review this response'
        if email and not_sent:
            title = 'Email not sent'
            status_text = 'The email was not sent. Check the Google connection before trying again.'
        if email and status and item.get('delivery') in ('queued', 'sending'):
            title = 'Approved'
            status_text = 'Done. You can close this window.'
        if email and item.get('delivery') == 'partial':
            title = 'Batch partially sent'
            status_text = item['delivery_error']
        if email and not status and not uncertain:
            title = 'Review email template' if email.get('recipients') else 'Review email'
            status_text = 'Review the template and recipient values before sending.' if email.get('recipients') else 'Review this email before sending.'
    return (Path(__file__).with_name('widget.html').read_text()
            .replace('__RESPONSE__', '' if email else html.escape(text))
            .replace('__RESPONSE_HIDDEN__', 'hidden' if email else '')
            .replace('__FINISHED__', 'true' if status or uncertain else 'false')
            .replace('__TITLE__', html.escape(title))
            .replace('__KIND__', 'CALENDAR EVENT' if proposal else 'EMAIL REVIEW' if email else 'RESPONSE REVIEW')
            .replace('__KIND_ID__', 'calendar' if proposal else 'email' if email else 'message')
            .replace('__APPROVE_LABEL__', 'Add to Calendar' if proposal else f"Approve & Send {len(email['recipients'])} Emails" if email and len(email.get('recipients', [])) > 1 else 'Approve & Send' if email else 'Approve')
            .replace('__EDIT_LABEL__', 'Edit & Send' if email else 'Approve edited response')
            .replace('__EDIT_HIDDEN__', 'hidden' if proposal else '')
            .replace('__EMAIL_HIDDEN__', '' if email else 'hidden')
            .replace('__EMAIL_DETAILS__', email_details)
            .replace('__EMAIL_DATA__', html.escape(json.dumps(email or {}), quote=True))
            .replace('__CALENDAR_DETAILS__', details)
            .replace('__CALENDAR_HIDDEN__', '' if proposal else 'hidden')
            .replace('__CALENDAR_ACTIONS__', '' if proposal else 'hidden')
            .replace('__STATUS__', html.escape(status_text)))


def start_widget_server(store, host='127.0.0.1', port=8792):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # Review URLs contain private bearer tokens.

        def respond(self, status, body, kind='application/json', filename=None):
            encoded = body if isinstance(body, bytes) else body.encode()
            try:
                self.send_response(status)
                self.send_header('Content-Type', kind + '; charset=utf-8')
                if filename:
                    self.send_header('Content-Disposition', "attachment; filename=\"document\"; filename*=UTF-8''" + quote(filename, safe=''))
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
                parts = urlsplit(self.path).path.split('/')
                if len(parts) == 5 and parts[1] == 'review' and parts[3] == 'attachments':
                    data, metadata = store.attachment(unquote(parts[2]), unquote(parts[4]))
                    return self.respond(200, data, 'application/octet-stream', filename=metadata['name'])
                self.respond(200, render(store.get(self.key())), 'text/html')
            except KeyError as exc:
                self.respond(404, json.dumps({'error': str(exc)}))
            except (RuntimeError, OSError) as exc:
                self.respond(503, json.dumps({'error': 'Could not download this attachment.'}))

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
                result = store.submit(key, payload, defer_email=True)
                self.respond(202 if result.get('email_result', {}).get('status') == 'queued' else 200, json.dumps({'ok': True, 'action': result['action'],
                                              'event': result.get('calendar_event'),
                                              'email': result.get('email_result')}))
                # Updating the card can reload the view that made this request.
                # Finish its HTTP response before contacting Photon.
                if result.get('email_result', {}).get('status') == 'queued':
                    store.start_email(key)
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
