import unittest
from unittest.mock import patch

import get_response
from send_email import email_owner, handle_send_email
import test_get_response


class EmailToolTests(unittest.TestCase):
    def test_stub_receives_fields_and_trusted_owner_without_sending(self):
        token = email_owner.set('+12025550100')
        self.addCleanup(email_owner.reset, token)
        result = handle_send_email({
            'to': 'sponsor@example.com', 'subject': 'Sponsorship', 'text': 'Hello!',
            'attachment_paths': ['/nonexistent/proposal.pdf'],
            'cc': ['organizer@example.com'], 'bcc': [], 'reply_to': 'organizer@example.com',
        })
        self.assertFalse(result['sent'])
        self.assertEqual(result['status'], 'not_sent')
        self.assertEqual(result['phone_number'], '+12025550100')
        self.assertEqual(result['email']['attachment_paths'], ['/nonexistent/proposal.pdf'])

    def test_identity_cannot_be_chosen_by_model(self):
        args = {'to': 'sponsor@example.com', 'subject': 'Proposal', 'text': 'Hello'}
        self.assertIn('error', handle_send_email(args))
        self.assertIn('error', handle_send_email({**args, 'phone_number': '+12025550999'}))

    def test_generation_binds_identity_then_resets_it(self):
        from unittest.mock import Mock
        agent = Mock()
        received = []
        def conversation(**kwargs):
            received.append(handle_send_email({'to': 'sponsor@example.com', 'subject': 'Proposal', 'text': 'Hello'}))
            return {'final_response': 'Proposed email. Nothing sent.'}
        agent.run_conversation.side_effect = conversation
        runtime = test_get_response.ResponseTests().runtime(agent)
        with patch.object(get_response, 'load_hermes', return_value=runtime):
            get_response.generate_response('Email the sponsor', '/tmp/context', phone_number='+12025550100')
        self.assertEqual(received[0]['phone_number'], '+12025550100')
        self.assertIsNone(email_owner.get())


if __name__ == '__main__':
    unittest.main()
