"""Small review UI. Actions only print responses; they never send outreach."""
import html
import json
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class CalendarApprovalError(RuntimeError):
    pass


class ReviewStore:
    def __init__(self, emit=None, clock=time.time, on_decision=None, on_calendar_approve=None):
        self.items = {}
        self.lock = threading.Lock()
        self.clock = clock
        self.on_decision = on_decision
        self.on_calendar_approve = on_calendar_approve
        self.emit = emit or (lambda response: print(
            'Widget response: ' + json.dumps(response, ensure_ascii=False), flush=True))

    def create(self, text, event, calendar_event=None):
        with self.lock:
            self.items = {k: v for k, v in self.items.items() if v['expires'] > self.clock()}
            key = secrets.token_urlsafe(32)
            self.items[key] = dict(text=text, event=event, calendar_event=calendar_event,
                                   expires=self.clock() + 86400, result=None, processing=False)
            return key

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
        created_event = None
        if calendar_event:
            if not self.on_calendar_approve:
                with self.lock:
                    item['processing'] = False
                raise RuntimeError('Calendar approval is not configured.')
            try:
                created_event = self.on_calendar_approve(key, sender, calendar_event)
            except Exception as exc:
                with self.lock:
                    item['processing'] = False
                raise CalendarApprovalError('Calendar could not create event. Check Google connection, then retry.') from exc
        result = dict(action=action, text=text, original_text=item['text'],
                      sender=sender, space_id=item['event']['space']['id'],
                      message_id=item['event'].get('messageId'))
        if created_event:
            result['calendar_event'] = created_event
        with self.lock:
            item['result'] = result
            item['processing'] = False
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
    text = status['text'] if status else item['text']
    proposal = item.get('calendar_event')
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
        title = 'Rejected' if status and status['action'] == 'reject' else 'Approved' if status else 'Review message'
        status_text = 'Response recorded: ' + status['action'] if status else 'Review this response'
    return (Path(__file__).with_name('widget.html').read_text()
            .replace('__RESPONSE__', html.escape(text))
            .replace('__FINISHED__', 'true' if status else 'false')
            .replace('__TITLE__', html.escape(title))
            .replace('__KIND__', 'CALENDAR EVENT' if proposal else 'RESPONSE REVIEW')
            .replace('__CALENDAR_DETAILS__', details)
            .replace('__CALENDAR_HIDDEN__', '' if proposal else 'hidden')
            .replace('__CALENDAR_ACTIONS__', '' if proposal else 'hidden')
            .replace('__APPROVE_LABEL__', 'Add to Calendar' if proposal else 'Approve')
            .replace('__EDIT_HIDDEN__', 'hidden' if proposal else '')
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
                self.respond(200, json.dumps({'ok': True, 'action': result['action'], 'event': result.get('calendar_event')}))
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
