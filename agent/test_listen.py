import os
import io
import json
import urllib.error
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

import listen
from widget import ReviewStore, EmailApprovalError


class ConversationTests(unittest.TestCase):
    def setUp(self):
        self.store = ReviewStore(emit=lambda result: None)
        self.event = {'sender': {'id': '+12025550100'}, 'space': {'id': 'owner-dm'},
                      'messageId': 'in-1', 'content': {'type': 'text', 'text': 'Hello'}}
        self.proposal = {'reviewId': 'email-review', 'recipient': 'jamie@example.com',
                         'subject': 'Hello', 'body': 'The actual email',
                         'cc': [], 'bcc': [], 'attachmentRefs': []}

    def receive(self, respond, events=None):
        stream = io.BytesIO(b''.join(json.dumps(event).encode() + b'\n' for event in events or [self.event]))
        with patch.object(listen.urllib.request, 'urlopen', return_value=stream), \
                patch.object(listen, 'record_outcome'), \
                patch.object(listen, 'post', return_value={'ok': True, 'messageId': 'outbound'}) as post, \
                patch.object(listen, 'post_website', return_value={'ok': True}) as website, \
                patch.object(listen.get_response, 'get_response_with_context', side_effect=respond) as hermes:
            with self.assertRaisesRegex(ConnectionError, 'stream closed'):
                listen.listen('token', self.store, 'https://widget.example')
        return post, website, hermes

    def test_normal_reply_is_plain_text_without_widget_and_duplicate_is_skipped(self):
        post, website, hermes = self.receive(lambda *args, **kwargs: ('Hello back', '/tmp/context', None),
                                             [self.event, self.event])
        self.assertEqual(hermes.call_count, 1)
        self.assertEqual([call.args[1] for call in post.call_args_list], ['/send-message'])
        self.assertEqual(post.call_args.args[2]['text'], 'Hello back')
        self.assertEqual(post.call_args.args[2]['recipientPhone'], '+12025550100')
        website.assert_not_called()
        self.assertEqual(self.store.unsent_cards(), [])

    def test_email_tool_sends_widget_and_conversation_reply_separately(self):
        def hermes(text, phone, **kwargs):
            kwargs['on_email_proposal'](self.proposal)
            return 'I’ve prepared an email for your review.', '/tmp/context', self.proposal
        post, website, _ = self.receive(hermes)
        self.assertEqual([call.args[1] for call in post.call_args_list], ['/send-app', '/send-message'])
        self.assertEqual(post.call_args_list[0].args[2]['kind'], 'email')
        website.assert_called_once()
        self.assertEqual(website.call_args.args[1]['proposal'], self.proposal)
        review = self.store.get('email-review')
        self.assertEqual(review['text'], 'The actual email')
        self.assertEqual(review['event']['requestText'], 'Hello')
        self.assertIsNone(review['result'])

    def test_outcome_returns_to_hermes_then_sends_plain_reply_to_owner(self):
        outcome = {'status': 'rejected', 'proposal': self.proposal}
        key = self.store.create(self.proposal['body'], self.event, email_proposal=self.proposal)
        self.store._email_finished(key, outcome)
        event = {**self.event, 'recipientPhone': '+12025550999', 'organizerSpaceId': 'owner-dm'}
        with patch.object(listen.get_response, 'handle_email_outcome', return_value='Understood. I didn’t send it.') as hermes, \
                patch.object(listen, 'post', return_value={'messageId': 'outcome-reply'}) as post:
            listen.deliver_email_feedback('token', self.store, key, event, outcome)
        hermes.assert_called_once_with(event, outcome)
        self.assertEqual(post.call_args.args[1], '/send-message')
        self.assertEqual(post.call_args.args[2]['recipientPhone'], '+12025550100')
        self.assertEqual(self.store.get(key)['feedback_status'], 'sent')

    def test_context_failure_returns_text_error_without_approval(self):
        def fail(*args, **kwargs):
            raise RuntimeError('private diagnostic')
        with patch('builtins.print'):
            post, website, _ = self.receive(fail)
        self.assertEqual(post.call_args.args[1], '/send-message')
        self.assertNotIn('private diagnostic', post.call_args.args[2]['text'])
        website.assert_not_called()

    def test_gmail_errors_distinguish_definite_failure_from_unknown_send(self):
        for code, provider_status, expected in [(409, 'send_unknown', 'uncertain'),
                                                (409, 'sending', 'uncertain'),
                                                (403, None, 'not_sent'),
                                                (502, 'failed', 'failed'),
                                                (503, None, 'uncertain')]:
            with self.subTest(code=code, status=provider_status):
                error = urllib.error.HTTPError('https://website.example', code, 'error', {},
                                               io.BytesIO(json.dumps({'status': provider_status}).encode()))
                with patch.object(listen, 'post_website', side_effect=error):
                    with self.assertRaises(EmailApprovalError) as raised:
                        listen.send_approved_email('review', '+12025550100', self.proposal)
                self.assertEqual(raised.exception.status, expected)


class StartupTests(unittest.TestCase):
    def test_local_widget_import_after_isolated_relaunch(self):
        script = str(Path(listen.__file__).resolve())
        code = (
            "import runpy; "
            f"module = runpy.run_path({script!r}, run_name='import_check'); "
            "assert module['ReviewStore'].__module__ == 'widget'; "
            "assert module['get_response'].__name__ == 'get_response'"
        )
        result = subprocess.run(
            [sys.executable, "-I", "-B", "-c", code],
            cwd="/tmp", capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_hermes_bootstraps_before_servers_start(self):
        with patch.dict(os.environ, {"WIDGET_PUBLIC_URL": "https://example.test"}), \
                patch.object(listen.get_response, "load_hermes", side_effect=SystemExit("relaunch")) as bootstrap, \
                patch.object(listen, "start_widget_server") as widget, \
                patch.object(listen.subprocess, "Popen") as sidecar:
            with self.assertRaisesRegex(SystemExit, "relaunch"):
                listen.main()
        bootstrap.assert_called_once()
        widget.assert_not_called()
        sidecar.assert_not_called()


if __name__ == "__main__":
    unittest.main()
