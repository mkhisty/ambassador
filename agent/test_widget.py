import concurrent.futures
import json
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request
from widget import ReviewStore, render, start_widget_server


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.responses = []
        self.now = 100
        self.store = ReviewStore(self.responses.append, lambda: self.now)
        self.event = {'sender': {'id': '+12025550100'}, 'space': {'id': 'dm'}, 'messageId': 'incoming'}

    def create(self, text='Hi Jamie, would you consider sponsoring our event?'):
        return self.store.create(text, self.event)

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
            self.assertEqual(json.load(response), {'ok': True, 'action': 'approve'})
        self.assertTrue(started.wait(timeout=1))
        self.assertFalse(release.is_set())
        self.assertEqual(self.store.get(key)['result']['action'], 'approve')
        self.assertEqual(len(self.responses), 1)

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
