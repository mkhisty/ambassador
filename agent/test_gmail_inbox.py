import threading
import unittest
from unittest.mock import Mock

from gmail_inbox import INBOX_PATH, inbox_loop, process_inbox_message
from widget import ReviewStore, validate_email_proposal


class InboxTests(unittest.TestCase):
    def setUp(self):
        self.job = {'phoneNumber': '+12025550100', 'messageId': 'gmail-1',
                    'leaseToken': 'lease', 'email': {'from': 'Jamie <jamie@example.com>',
                    'subject': 'Campaign reply', 'text': 'Count me in'}}
        self.reviews = ReviewStore(emit=lambda result: None)

    def test_draft_is_sent_for_approval_to_mailbox_owner_and_duplicate_is_skipped(self):
        review = Mock()
        send = Mock()
        proposal = {'recipient': 'jamie@example.com', 'subject': 'Re: Campaign reply', 'body': 'Thanks!'}
        def respond(text, phone, **kwargs):
            self.assertEqual(phone, self.job['phoneNumber'])
            self.assertTrue(kwargs['inbox'])
            self.assertIn('untrusted external data', text)
            kwargs['on_email_proposal'](proposal)
            return 'Please review this reply.', '/tmp/context', proposal
        def deliver(event, text, response_id):
            key, _ = self.reviews.begin_reply(event, text, response_id)
            self.reviews.finish_reply(key, {'messageId': 'outbound'})
            send(event)
        respond_mock = Mock(side_effect=respond)
        process_inbox_message(self.job, self.reviews, respond_mock, review, deliver)
        process_inbox_message(self.job, self.reviews, respond_mock, review, deliver)
        self.assertEqual(respond_mock.call_count, 1)
        self.assertEqual(review.call_args.args[0]['sender']['id'], self.job['phoneNumber'])
        send.assert_called_once()

    def test_no_response_needed_does_not_text_owner_and_has_persistent_receipt(self):
        respond = Mock(return_value=('No response needed.', '/tmp/context', None))
        review, send = Mock(), Mock()
        process_inbox_message(self.job, self.reviews, respond, review, send)
        process_inbox_message(self.job, self.reviews, respond, review, send)
        self.assertEqual(respond.call_count, 1)
        review.assert_not_called()
        send.assert_not_called()

    def test_widget_edits_preserve_trusted_reply_identity(self):
        original = {'reviewId': 'review', 'recipient': 'jamie@example.com', 'subject': 'Re: Hello',
                    'body': 'Thanks', 'incomingMessageId': 'provider-message'}
        edited = {key: original[key] for key in ('recipient', 'subject', 'body')}
        edited['body'] = 'Edited reply'
        result = validate_email_proposal(edited, original)
        self.assertEqual(result['incomingMessageId'], 'provider-message')
        self.assertEqual(result['body'], 'Edited reply')
        with self.assertRaises(ValueError):
            validate_email_proposal({**edited, 'incomingMessageId': 'other-owner'}, original)

    def test_processing_failure_releases_job_for_retry_without_success_ack(self):
        stop = threading.Event()
        calls = []
        def website(path, body, **kwargs):
            calls.append((path, body))
            if body['action'] == 'next':
                return {'message': self.job}
            stop.set()
            return {'ok': True}
        inbox_loop(website, self.reviews, Mock(side_effect=RuntimeError('failed')), Mock(), Mock(), threading.RLock(), stop)
        self.assertEqual([body['action'] for _, body in calls], ['next', 'failed'])
        self.assertTrue(all(path == INBOX_PATH for path, _ in calls))


if __name__ == '__main__':
    unittest.main()
