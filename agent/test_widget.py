import concurrent.futures
import json
import secrets
import threading
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import urllib.error
import urllib.request
from widget import ReviewStore, EmailApprovalError, render, start_widget_server


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.responses = []
        self.now = 100
        self.created = 0
        self.store = ReviewStore(self.responses.append, lambda: self.now,
                                 on_message_approve=lambda event, text, key: {'messageId': 'provider-message'})
        self.event = {'sender': {'id': '+12025550100'}, 'space': {'id': 'dm'}, 'messageId': 'incoming'}

    def create(self, text='Hi Jamie, would you consider sponsoring our event?'):
        self.created += 1
        event = {**self.event, 'messageId': f'incoming-{self.created}'}
        return self.store.create(text, event)

    def test_actions_log_final_response(self):
        for action in ('approve', 'reject', 'edit_approve'):
            key = self.create()
            result = self.store.submit(key, {'action': action, 'text': 'My edited proposal'})
            self.assertEqual(result['action'], action)
            self.assertEqual(result['sender'], '+12025550100')
            self.assertEqual(result['text'], 'My edited proposal' if action == 'edit_approve' else result['original_text'])
        self.assertEqual(len(self.responses), 3)

    def test_concurrent_submissions_record_only_once(self):
        key = self.create()
        def submit(_):
            try:
                self.store.submit(key, {'action': 'approve'})
                return True
            except RuntimeError:
                return False
        with concurrent.futures.ThreadPoolExecutor() as pool:
            self.assertEqual(sum(pool.map(submit, range(10))), 1)
        self.assertEqual(len(self.responses), 1)

    def test_decision_updates_card_once_and_survives_provider_failure(self):
        updates = []
        self.store.on_decision = lambda key, result: updates.append((key, result['action']))
        key = self.create()
        result = self.store.submit(key, {'action': 'approve'})
        self.assertTrue(self.store.update_card(key, result))
        self.assertEqual(updates, [(key, 'approve')])
        with self.assertRaises(RuntimeError):
            self.store.submit(key, {'action': 'reject'})
        self.assertEqual(len(updates), 1)
        def fail(*args):
            raise ConnectionError('Photon unavailable')
        self.store.on_decision = fail
        key = self.create()
        with patch('builtins.print'):
            result = self.store.submit(key, {'action': 'reject'})
            self.assertFalse(self.store.update_card(key, result))
        self.assertEqual(self.store.get(key)['result']['action'], 'reject')
        self.assertIn('<h1>Rejected</h1>', render(self.store.get(key)))

    def test_invalid_edits_expiry_and_safe_html(self):
        key = self.create('<script>alert("x")</script>')
        self.assertIn('&lt;script&gt;', render(self.store.get(key)))
        for payload in ({'action': 'send'}, {'action': 'edit_approve', 'text': '   '}):
            with self.assertRaises(ValueError):
                self.store.submit(key, payload)
        self.now += 86400
        with self.assertRaises(KeyError):
            self.store.submit(key, {'action': 'approve'})
        self.assertEqual(self.responses, [])

    def test_calendar_is_created_only_after_explicit_approval(self):
        created = []
        store = ReviewStore(self.responses.append, lambda: self.now,
                            on_calendar_approve=lambda key, phone, event: created.append((key, phone, event)) or {'url': 'https://calendar.google.com/event'})
        event = {'summary': '<Recruiter call>', 'start': '2026-10-04T14:30:00-04:00', 'end': '2026-10-04T15:00:00-04:00', 'timeZone': 'America/New_York'}
        key = store.create('Proposed time', self.event, calendar_event=event)
        page = render(store.get(key))
        self.assertIn('Add to Calendar', page)
        self.assertIn('&lt;Recruiter call&gt;', page)
        self.assertEqual(created, [])
        result = store.submit(key, {'action': 'approve'})
        self.assertEqual(created, [(key, '+12025550100', event)])
        self.assertEqual(result['calendar_event']['url'], 'https://calendar.google.com/event')

    def test_rejecting_calendar_proposal_never_creates_event(self):
        created = []
        store = ReviewStore(self.responses.append, lambda: self.now,
                            on_calendar_approve=lambda *args: created.append(args))
        key = store.create('Proposed time', self.event, calendar_event={'summary': 'Call'})
        result = store.submit(key, {'action': 'reject'})
        self.assertEqual(result['action'], 'reject')
        self.assertEqual(created, [])

    def email_store(self, send):
        self.outcomes = []
        store = ReviewStore(emit=self.responses.append, clock=lambda: self.now,
                            on_email_approve=send,
                            on_email_reject=lambda *args: None,
                            on_email_outcome=lambda key, event, outcome: self.outcomes.append((key, event, outcome)))
        proposal = {'reviewId': 'email-1', 'recipient': 'jamie@example.com',
                    'subject': 'Subject', 'body': 'Original email',
                    'cc': [], 'bcc': [], 'attachmentRefs': []}
        key = store.create(proposal['body'], self.event, email_proposal=proposal)
        return store, key, proposal

    def test_email_approval_sends_once_and_reports_actual_provider_result(self):
        sends = []
        provider = {'status': 'accepted', 'messageId': 'gmail-message'}
        store, key, proposal = self.email_store(lambda *args: sends.append(args) or provider)
        self.assertEqual(sends, [])
        result = store.submit(key, {'action': 'approve'})
        self.assertEqual(sends, [(key, '+12025550100', proposal)])
        self.assertEqual(result['email_result'], provider)
        self.assertEqual(self.outcomes[0][2]['status'], 'accepted')
        self.assertEqual(self.outcomes[0][2]['provider'], provider)
        with self.assertRaises(RuntimeError):
            store.submit(key, {'action': 'approve'})
        self.assertEqual(len(self.outcomes), 1)

    def test_email_rejection_never_sends_and_reports_rejection(self):
        store, key, proposal = self.email_store(lambda *args: self.fail('rejected email must not send'))
        store.submit(key, {'action': 'reject'})
        self.assertEqual(self.outcomes[0][2]['status'], 'rejected')
        self.assertEqual(self.outcomes[0][2]['proposal'], proposal)

    def test_edited_email_reports_and_sends_exact_reviewed_fields(self):
        sends = []
        store, key, proposal = self.email_store(lambda *args: sends.append(args) or {'status': 'accepted', 'messageId': 'gmail'})
        edited = {name: value for name, value in proposal.items() if name != 'reviewId'}
        edited.update(recipient='other@example.com', subject='Edited subject', body='Edited body')
        store.submit(key, {'action': 'edit_approve', 'text': 'Edited body', 'email': edited})
        self.assertEqual(sends[0][2]['body'], 'Edited body')
        self.assertEqual(sends[0][2]['recipient'], 'other@example.com')
        self.assertEqual(self.outcomes[0][2]['proposal']['subject'], 'Edited subject')

    def test_email_failure_reports_uncertainty_and_never_retries(self):
        def fail(*args):
            raise ConnectionError('lost provider response')
        store, key, _ = self.email_store(fail)
        with self.assertRaisesRegex(RuntimeError, 'uncertain'):
            store.submit(key, {'action': 'approve'})
        self.assertEqual(self.outcomes[0][2]['status'], 'uncertain')
        self.assertEqual(store.get(key)['delivery'], 'uncertain')
        with self.assertRaises(RuntimeError):
            store.submit(key, {'action': 'approve'})
        self.assertEqual(len(self.outcomes), 1)

    def test_definite_email_failure_is_reported_as_not_sent(self):
        def fail(*args):
            raise EmailApprovalError('Google is disconnected', 'not_sent')
        store, key, _ = self.email_store(fail)
        with self.assertRaisesRegex(RuntimeError, 'did not send'):
            store.submit(key, {'action': 'approve'})
        self.assertEqual(self.outcomes[0][2]['status'], 'not_sent')
        self.assertIn('<h1>Email not sent</h1>', render(store.get(key)))

    def test_pending_email_feedback_survives_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'reviews.json'
            store = ReviewStore(emit=lambda result: None, clock=lambda: self.now, state_path=path)
            proposal = {'reviewId': 'pending-email', 'recipient': 'jamie@example.com', 'subject': 'Hello', 'body': 'Email'}
            key = store.create('Email', self.event, email_proposal=proposal)
            store.submit(key, {'action': 'reject'})
            self.assertEqual(store.pending_email_feedback(), [key])
            queued = []
            recovered = ReviewStore(clock=lambda: self.now, state_path=path, on_email_outcome=lambda *args: queued.append(args))
            recovered.queue_email_feedback(key)
            recovered.queue_email_feedback(key)
            self.assertEqual(len(queued), 1)
            self.assertEqual(queued[0][2]['status'], 'rejected')
            recovered.mark_feedback_sent(key)
            self.assertEqual(recovered.pending_email_feedback(), [])

    def test_message_sends_only_after_approval_and_inbound_is_deduplicated(self):
        sends = []
        self.store.on_message_approve = lambda event, text, key: sends.append((event['messageId'], text)) or {'messageId': 'outbound-1'}
        event = {**self.event, 'messageId': 'same-inbound'}
        key = self.store.create('Original', event)
        self.assertEqual(self.store.create('Duplicate', event), key)
        self.assertEqual(sends, [])
        result = self.store.submit(key, {'action': 'edit_approve', 'text': 'Reviewed text'})
        self.assertEqual(sends, [('same-inbound', 'Reviewed text')])
        self.assertEqual(result['delivery']['messageId'], 'outbound-1')
        self.assertEqual(self.store.get(key)['delivery'], 'sent')

    def test_persisted_ambiguous_send_is_not_retried_after_restart(self):
        state = Path(__file__).with_name('test-reviews-' + secrets.token_hex(8) + '.json')
        try:
            store = ReviewStore(clock=lambda: self.now, state_path=state,
                                on_message_approve=lambda *args: (_ for _ in ()).throw(ConnectionError('lost response')))
            key = store.create('Hi', self.event)
            with self.assertRaisesRegex(RuntimeError, 'uncertain outcome'):
                store.submit(key, {'action': 'approve'})
            saved = json.loads(state.read_text())
            saved[key]['result'] = None
            saved[key]['processing'] = True
            saved[key]['delivery'] = 'sending'
            state.write_text(json.dumps(saved))
            recovered = ReviewStore(clock=lambda: self.now, state_path=state,
                                    on_message_approve=lambda *args: self.fail('must not resend'))
            self.assertEqual(recovered.get(key)['delivery'], 'uncertain')
            self.assertIsNone(recovered.get(key)['result'])
            with self.assertRaisesRegex(RuntimeError, 'uncertain'):
                recovered.submit(key, {'action': 'approve'})
            self.assertIn('data-finished="true"', render(recovered.get(key)))
        finally:
            state.unlink(missing_ok=True)

    def test_http_confirms_decision_before_card_update_finishes(self):
        started = threading.Event()
        release = threading.Event()
        def update(key, result):
            started.set()
            release.wait(timeout=5)
        self.store.on_decision = update
        server = start_widget_server(self.store, port=0)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.addCleanup(release.set)
        key = self.create()
        url = f'http://127.0.0.1:{server.server_port}/review/{key}'
        request = urllib.request.Request(url, data=b'{"action":"approve"}',
                                         headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=1) as response:
            self.assertEqual(json.load(response), {'ok': True, 'action': 'approve', 'event': None, 'email': None})
        self.assertTrue(started.wait(timeout=1))
        self.assertFalse(release.is_set())
        self.assertEqual(self.store.get(key)['result']['action'], 'approve')
        self.assertEqual(len(self.responses), 1)

    def test_http_email_approval_returns_before_provider_finishes(self):
        started, release, completed = threading.Event(), threading.Event(), threading.Event()
        def send(*args):
            started.set()
            release.wait(timeout=5)
            return {'status': 'accepted', 'messageId': 'background-message'}
        store, key, proposal = self.email_store(send)
        def outcome(key, event, result):
            self.outcomes.append((key, event, result))
            completed.set()
        store.on_email_outcome = outcome
        server = start_widget_server(store, port=0)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.addCleanup(release.set)
        request = urllib.request.Request(f'http://127.0.0.1:{server.server_port}/review/{key}',
            data=b'{"action":"approve"}', headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=1) as response:
            self.assertEqual(response.status, 202)
            self.assertEqual(json.load(response)['email']['status'], 'queued')
        self.assertTrue(started.wait(timeout=1))
        self.assertFalse(release.is_set())
        self.assertEqual(self.outcomes, [])
        page = render(store.get(key))
        self.assertIn('<h1>Approved</h1>', page)
        self.assertIn('Done. You can close this window.', page)
        self.assertNotIn('<h1>Delivery uncertain</h1>', page)
        with self.assertRaises(RuntimeError):
            store.submit(key, {'action': 'approve'}, defer_email=True)
        release.set()
        self.assertTrue(completed.wait(timeout=1))
        self.assertEqual(self.outcomes[0][2]['status'], 'accepted')
        self.assertEqual(store.get(key)['delivery'], 'sent')

    def test_queued_edited_email_survives_restart_and_starts_only_once(self):
        completed, started, release = threading.Event(), threading.Event(), threading.Event()
        sends = []
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'reviews.json'
            store = ReviewStore(state_path=state, emit=lambda result: None)
            proposal = {'reviewId': 'queued-email', 'recipient': 'jamie@example.com',
                        'subject': 'Original', 'body': 'Original body'}
            key = store.create(proposal['body'], self.event, email_proposal=proposal)
            reviewed = {'recipient': 'new@example.com', 'subject': 'Edited', 'body': 'Reviewed text'}
            result = store.submit(key, {'action': 'edit_approve', 'email': reviewed}, defer_email=True)
            self.assertEqual(result['email_result']['status'], 'queued')
            self.assertEqual(store.pending_email_sends(), [key])
            def send(*args):
                sends.append(args)
                started.set()
                release.wait(timeout=5)
                return {'status': 'accepted', 'messageId': 'background-message'}
            recovered = ReviewStore(state_path=state, emit=lambda result: None,
                on_email_approve=send, on_email_outcome=lambda *args: completed.set())
            self.assertEqual(recovered.pending_email_sends(), [key])
            self.assertTrue(recovered.start_email(key))
            try:
                self.assertTrue(started.wait(timeout=1))
                self.assertFalse(recovered.start_email(key))
                self.assertEqual(sends[0][2]['recipient'], 'new@example.com')
                self.assertEqual(sends[0][2]['body'], 'Reviewed text')
                # An in-flight send is never automatically resumed after a crash.
                crashed = ReviewStore(state_path=state)
                self.assertEqual(crashed.pending_email_sends(), [])
                self.assertEqual(crashed.get(key)['delivery'], 'uncertain')
            finally:
                release.set()
                self.assertTrue(completed.wait(timeout=1))

    def test_background_failure_reports_outcome_after_recorded_approval(self):
        completed = threading.Event()
        def send(*args):
            raise EmailApprovalError('Google is disconnected', 'not_sent')
        store, key, proposal = self.email_store(send)
        def outcome(key, event, result):
            self.outcomes.append((key, event, result))
            completed.set()
        store.on_email_outcome = outcome
        queued = store.submit(key, {'action': 'approve'}, defer_email=True)
        self.assertEqual(queued['email_result']['status'], 'queued')
        self.assertEqual(self.outcomes, [])
        with patch('builtins.print'):
            self.assertTrue(store.start_email(key))
            self.assertTrue(completed.wait(timeout=1))
        self.assertEqual(self.outcomes[0][2]['status'], 'not_sent')
        self.assertEqual(store.get(key)['delivery'], 'not_sent')
        self.assertFalse(store.start_email(key))

    def test_http_get_does_not_approve_post_records_and_reload_shows_result(self):
        server = start_widget_server(self.store, port=0)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        url = f'http://127.0.0.1:{server.server_port}/review/{self.create()}'
        with urllib.request.urlopen(url) as response:
            self.assertIn('Approve', response.read().decode())
        self.assertEqual(self.responses, [])
        def post(payload):
            return urllib.request.urlopen(urllib.request.Request(url,
                data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'}))
        with post({'action': 'edit_approve', 'text': '<b>Edited</b>'}) as response:
            self.assertEqual(json.load(response)['action'], 'edit_approve')
        with urllib.request.urlopen(url) as response:
            body = response.read().decode()
            self.assertIn('data-finished="true"', body)
            self.assertIn('&lt;b&gt;Edited&lt;/b&gt;', body)
        with self.assertRaises(urllib.error.HTTPError) as error:
            post({'action': 'approve'})
        self.assertEqual(error.exception.code, 409)
        error.exception.close()
        self.assertEqual(len(self.responses), 1)


if __name__ == '__main__':
    unittest.main()
