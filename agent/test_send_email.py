import unittest
import contextvars
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import get_response
from send_email import email_owner, email_proposal, email_review, handle_send_email
import test_get_response


class EmailToolTests(unittest.TestCase):
    def setUp(self):
        get_response.CONVERSATIONS.clear()

    def test_tool_dispatches_exact_fields_to_review_before_returning(self):
        owner = email_owner.set('+12025550100')
        proposal = email_proposal.set(None)
        dispatched = []
        callback = email_review.set(dispatched.append)
        try:
            result = handle_send_email({'to': 'jamie@example.com', 'subject': 'Hello', 'text': 'Email body'})
            self.assertEqual(dispatched, [result['proposal']])
            self.assertEqual(result['status'], 'awaiting_user_approval')
            self.assertFalse(result['sent'])
            self.assertIn('error', handle_send_email({'to': 'jamie@example.com', 'subject': 'Again', 'text': 'Another'}))
            self.assertEqual(len(dispatched), 1)
        finally:
            email_review.reset(callback)
            email_proposal.reset(proposal)
            email_owner.reset(owner)

    def test_failed_widget_dispatch_is_reported_to_hermes(self):
        owner = email_owner.set('+12025550100')
        proposal = email_proposal.set(None)
        def unavailable(value):
            raise ConnectionError('secret provider diagnostic')
        callback = email_review.set(unavailable)
        try:
            result = handle_send_email({'to': 'jamie@example.com', 'subject': 'Hello', 'text': 'Email body'})
            self.assertIn('error', result)
            self.assertNotIn('secret provider diagnostic', result['error'])
            self.assertIsNone(email_proposal.get())
        finally:
            email_review.reset(callback)
            email_proposal.reset(proposal)
            email_owner.reset(owner)
    def test_tool_captures_structured_proposal_for_review_without_sending(self):
        token = email_owner.set('+12025550100')
        self.addCleanup(email_owner.reset, token)
        proposal_token = email_proposal.set(None)
        self.addCleanup(email_proposal.reset, proposal_token)
        result = handle_send_email({
            'to': 'sponsor@example.com', 'subject': 'Sponsorship', 'text': 'Hello!',
            'attachment_refs': ['document-123'],
            'cc': ['organizer@example.com'], 'bcc': [], 'reply_to': 'organizer@example.com',
        })
        self.assertFalse(result['sent'])
        self.assertEqual(result['status'], 'awaiting_user_approval')
        self.assertEqual(result['proposal']['attachmentRefs'], ['document-123'])
        self.assertEqual(email_proposal.get()['recipient'], 'sponsor@example.com')
        self.assertTrue(email_proposal.get()['reviewId'])

    def test_identity_cannot_be_chosen_by_model(self):
        args = {'to': 'sponsor@example.com', 'subject': 'Proposal', 'text': 'Hello'}
        self.assertIn('error', handle_send_email(args))
        self.assertIn('error', handle_send_email({**args, 'phone_number': '+12025550999'}))

    def test_generation_binds_identity_then_resets_it(self):
        from unittest.mock import Mock
        proposal_token = email_proposal.set(None)
        self.addCleanup(email_proposal.reset, proposal_token)
        agent = Mock()
        received = []
        def conversation(**kwargs):
            received.append(handle_send_email({'to': 'sponsor@example.com', 'subject': 'Proposal', 'text': 'Hello'}))
            return {'final_response': 'Proposed email. Nothing sent.'}
        agent.run_conversation.side_effect = conversation
        runtime = test_get_response.ResponseTests().runtime(agent)
        with patch.object(get_response, 'load_hermes', return_value=runtime):
            result = get_response.generate_response('Email the sponsor', '/tmp/context', phone_number='+12025550100', return_proposal=True)
        self.assertEqual(received[0]['status'], 'awaiting_user_approval')
        self.assertEqual(result[1]['recipient'], 'sponsor@example.com')
        self.assertIsNone(email_proposal.get())
        self.assertIsNone(email_owner.get())

    def test_realistic_hermes_worker_context_captures_proposal_in_parent(self):
        from unittest.mock import Mock
        agent = Mock()
        delivered = []
        def conversation(**kwargs):
            args = {'to': 'sponsor@example.com', 'subject': 'Hello', 'text': 'Email body'}
            with ThreadPoolExecutor(max_workers=1) as pool:
                first = pool.submit(contextvars.copy_context().run, handle_send_email, args).result()
                second = pool.submit(contextvars.copy_context().run, handle_send_email, args).result()
            self.assertEqual(first['status'], 'awaiting_user_approval')
            self.assertIn('error', second)
            return {'final_response': 'Please review the email.'}
        agent.run_conversation.side_effect = conversation
        with patch.object(get_response, 'load_hermes', return_value=test_get_response.ResponseTests().runtime(agent)):
            reply, proposal = get_response.generate_response('Email the sponsor', '/tmp/context',
                phone_number='+12025550100', return_proposal=True, on_email_proposal=delivered.append)
        self.assertEqual(proposal['recipient'], 'sponsor@example.com')
        self.assertEqual(delivered, [proposal])
        self.assertIsNone(email_review.get())


if __name__ == '__main__':
    unittest.main()
