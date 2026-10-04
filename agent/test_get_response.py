import unittest
from unittest.mock import Mock, patch

import get_response
from fetch_context import fetch_context


class ResponseTests(unittest.TestCase):
    def test_fetches_phone_context_before_generating_response(self):
        calls = []
        with patch.object(get_response, 'fetch_context', side_effect=lambda phone: calls.append(('fetch', phone))), \
                patch.object(get_response, 'generate_response', side_effect=lambda text, directory, **kw: calls.append(('generate', text, directory, kw['phone_number'])) or 'Proposal'):
            self.assertEqual(get_response.get_response('Draft a proposal', '+12025550100'), 'Proposal')
        self.assertEqual(calls, [('fetch', '+12025550100'),
                                 ('generate', 'Draft a proposal', get_response.CONTEXT_DIR, '+12025550100')])

    def test_context_fetch_placeholder_does_nothing(self):
        self.assertIsNone(fetch_context('+12025550100'))

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
        instructions = runtime[0].call_args.kwargs['ephemeral_system_prompt']
        self.assertIn('/tmp/user-context', instructions)
        self.assertIn('Inspect relevant files', instructions)
        self.assertIn('missing or empty', instructions)

    def test_failure_and_empty_response_close_agent(self):
        for result in ({'failed': True, 'error': 'Provider failed'}, {'final_response': '  '}):
            with self.subTest(result=result):
                agent = Mock()
                agent.run_conversation.return_value = result
                with patch.object(get_response, 'load_hermes', return_value=self.runtime(agent)):
                    with self.assertRaises(RuntimeError):
                        get_response.generate_response('Hello', '/tmp/user-context')
                agent.close.assert_called_once()

    def test_conversation_exception_closes_agent(self):
        agent = Mock()
        agent.run_conversation.side_effect = ConnectionError('Disconnected')
        with patch.object(get_response, 'load_hermes', return_value=self.runtime(agent)):
            with self.assertRaises(ConnectionError):
                get_response.generate_response('Hello', '/tmp/user-context')
        agent.close.assert_called_once()


if __name__ == '__main__':
    unittest.main()
