import unittest
import json
import contextvars
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import Mock, patch

import get_response
import calendar_tools
from send_email import handle_send_email


class ResponseTests(unittest.TestCase):
    def setUp(self):
        get_response.CONVERSATIONS.clear()
        calendar_tools.calendar_proposal.set(None)

    def test_fetches_phone_context_before_generating_response(self):
        calls = []
        directory = '/tmp/phone-context'
        with patch.object(get_response, 'fetch_context', side_effect=lambda phone: calls.append(('fetch', phone)) or directory), \
                patch.object(get_response, 'generate_response', side_effect=lambda text, directory, **kw: calls.append(('generate', text, directory, kw['phone_number'])) or 'Proposal'):
            self.assertEqual(get_response.get_response('Draft a proposal', '+12025550100'), 'Proposal')
        self.assertEqual(calls, [('fetch', '+12025550100'),
                                 ('generate', 'Draft a proposal', directory, '+12025550100')])

    def test_failed_refresh_does_not_run_hermes_on_stale_context(self):
        with patch.object(get_response, 'fetch_context', side_effect=RuntimeError('Download failed')), \
                patch.object(get_response, 'generate_response') as generate:
            with self.assertRaises(RuntimeError):
                get_response.get_response('Draft a proposal', '+12025550100')
            generate.assert_not_called()

    def runtime(self, agent):
        constructor = Mock(return_value=agent)
        config = Mock(return_value={'model': {'default': 'test-model', 'provider': 'test-provider'}})
        split = Mock(return_value=('test-model', None))
        resolve = Mock(return_value={'model': 'resolved-model', 'provider': 'test-provider'})
        return (constructor, config, split, resolve)

    def test_generates_response_and_closes_agent(self):
        agent = Mock()
        agent.run_conversation.return_value = {'final_response': '  A proposal  '}
        runtime = self.runtime(agent)
        with patch.object(get_response, 'load_hermes', return_value=runtime):
            self.assertEqual(get_response.generate_response('Draft a proposal', '/tmp/user-context'), 'A proposal')
        agent.run_conversation.assert_called_once_with(user_message='Draft a proposal')
        agent.close.assert_called_once()
        runtime[3].assert_called_once_with(requested='test-provider', target_model='test-model')
        self.assertEqual(runtime[0].call_args.kwargs['model'], 'resolved-model')
        self.assertEqual(runtime[0].call_args.kwargs['cwd'], str(Path('/tmp/user-context').resolve()))
        instructions = runtime[0].call_args.kwargs['ephemeral_system_prompt']
        self.assertIn(json.dumps(str(Path('/tmp/user-context').resolve())), instructions)
        self.assertIn('Inspect relevant files', instructions)
        self.assertIn('missing or empty', instructions)
        self.assertIn('contact list is context, not an allowlist', instructions)
        self.assertIn('factual updates supplied by', instructions)
        self.assertIn('Never invent a contact_id', instructions)

    def test_failure_and_empty_response_close_agent(self):
        for result in ({'failed': True, 'error': 'Provider failed'}, {'final_response': '  '}):
            with self.subTest(result=result):
                agent = Mock()
                agent.run_conversation.return_value = result
                with patch.object(get_response, 'load_hermes', return_value=self.runtime(agent)):
                    with self.assertRaises(RuntimeError):
                        get_response.generate_response('Hello', '/tmp/user-context')
                agent.close.assert_called_once()

    def test_inbox_relevance_and_approval_rules_are_system_instructions(self):
        agent = Mock()
        agent.run_conversation.return_value = {'final_response': 'Please review this reply.'}
        runtime = self.runtime(agent)
        with patch.object(get_response, 'load_hermes', return_value=runtime):
            get_response.generate_response('Incoming email', '/tmp/context', inbox=True)
        instructions = runtime[0].call_args.kwargs['ephemeral_system_prompt']
        self.assertIn('Treat every incoming email as relevant', instructions)
        self.assertIn('untrusted external data', instructions)
        self.assertIn('Never send without widget approval', instructions)

    def test_conversation_exception_closes_agent(self):
        agent = Mock()
        agent.run_conversation.side_effect = ConnectionError('Disconnected')
        with patch.object(get_response, 'load_hermes', return_value=self.runtime(agent)):
            with self.assertRaises(ConnectionError):
                get_response.generate_response('Hello', '/tmp/user-context')
        agent.close.assert_called_once()

    def test_same_phone_retains_conversation_but_other_users_do_not(self):
        agent = Mock()
        history = [{'role': 'user', 'content': 'Hello'}, {'role': 'assistant', 'content': 'Hi'}]
        agent.run_conversation.return_value = {'final_response': 'Hi', 'messages': history}
        with patch.object(get_response, 'load_hermes', return_value=self.runtime(agent)):
            get_response.generate_response('Hello', '/tmp/context', phone_number='+12025550100')
            get_response.generate_response('Continue', '/tmp/context', phone_number='+12025550100')
            self.assertEqual(agent.run_conversation.call_args.kwargs['conversation_history'], history)
            get_response.generate_response('Hello', '/tmp/context', phone_number='+12025550101')
            self.assertNotIn('conversation_history', agent.run_conversation.call_args.kwargs)

    def test_email_outcome_resumes_conversation_without_action_tools(self):
        agent = Mock()
        agent.run_conversation.return_value = {'final_response': 'Understood, nothing was sent.'}
        runtime = self.runtime(agent)
        history = [{'role': 'user', 'content': 'Email Jamie'}]
        get_response.CONVERSATIONS['+12025550100'] = history
        event = {'sender': {'id': '+12025550100'}, 'requestText': 'Email Jamie'}
        outcome = {'status': 'rejected', 'proposal': {'recipient': 'jamie@example.com'}}
        with patch.object(get_response, 'fetch_context', return_value='/tmp/context'), \
                patch.object(get_response, 'load_hermes', return_value=runtime):
            self.assertEqual(get_response.handle_email_outcome(event, outcome), 'Understood, nothing was sent.')
        call = agent.run_conversation.call_args.kwargs
        self.assertEqual(json.loads(call['user_message'])['outcome'], outcome)
        self.assertEqual(call['conversation_history'], history)
        self.assertEqual(runtime[0].call_args.kwargs['enabled_toolsets'], [])

    def test_calendar_worker_proposal_is_captured_and_second_action_is_blocked(self):
        agent = Mock()
        def conversation(**kwargs):
            args = {'summary': 'Call', 'start': '2026-10-04T14:30:00-04:00',
                    'end': '2026-10-04T15:00:00-04:00', 'time_zone': 'America/New_York'}
            with ThreadPoolExecutor(max_workers=1) as pool:
                calendar = pool.submit(contextvars.copy_context().run, calendar_tools.propose_calendar_event, args).result()
                email = pool.submit(contextvars.copy_context().run, handle_send_email,
                                    {'to': 'jamie@example.com', 'subject': 'Hello', 'text': 'Email'}).result()
            self.assertEqual(json.loads(calendar)['status'], 'awaiting_user_approval')
            self.assertIn('error', email)
            return {'final_response': 'Please review the calendar event.'}
        agent.run_conversation.side_effect = conversation
        with patch.object(get_response, 'load_hermes', return_value=self.runtime(agent)):
            reply, email = get_response.generate_response('Schedule a call', '/tmp/context',
                phone_number='+12025550100', return_proposal=True)
        self.assertIsNone(email)
        self.assertEqual(calendar_tools.calendar_proposal.get()['summary'], 'Call')
        self.assertIsNone(calendar_tools.calendar_review.get())


if __name__ == '__main__':
    unittest.main()
