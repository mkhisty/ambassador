import contextlib
import io
import json
import os
import unittest
import urllib.error
from unittest.mock import patch

import diagnostics
import listen
from widget import EmailApprovalError


class DiagnosticsTests(unittest.TestCase):
    def test_default_is_quiet_and_verbose_redacts_credentials_and_payloads(self):
        with patch.dict(os.environ, {'AMBASSADOR_VERBOSE': '0'}), contextlib.redirect_stderr(io.StringIO()) as output:
            diagnostics.verbose_log('test', value='hidden')
            self.assertEqual(output.getvalue(), '')
            self.assertEqual(diagnostics.verbose_headers(), {})
        with patch.dict(os.environ, {'AMBASSADOR_VERBOSE': '1', 'GOOGLE_CLIENT_SECRET': 'private-secret'}), \
                contextlib.redirect_stderr(io.StringIO()) as output:
            diagnostics.verbose_log('test', error={'message': '403 private-secret Bearer another-secret ya29.oauth-token'},
                                    access_token='never-print', body='private email body',
                                    link='https://website.example/review/private-review-key')
            logged = output.getvalue()
            for secret in ('private-secret', 'another-secret', 'ya29.oauth-token', 'never-print',
                           'private email body', 'private-review-key'):
                self.assertNotIn(secret, logged)
            self.assertIn('403', logged)
            self.assertEqual(diagnostics.verbose_headers(), {'x-ambassador-verbose': '1'})

    def test_website_provider_failure_is_visible_without_consuming_send_error(self):
        failure = {'error': 'Gmail rejected', 'status': 'failed', 'diagnostics': {
            'stage': 'gmail_submit', 'provider': {'httpStatus': 403, 'message': 'Gmail API disabled',
                                                'reasons': [{'reason': 'accessNotConfigured'}]},
        }}
        error = urllib.error.HTTPError('https://website.example', 502, 'failed', {},
                                       io.BytesIO(json.dumps(failure).encode()))
        with patch.dict(os.environ, {'AMBASSADOR_VERBOSE': '1'}), \
                patch.object(listen, 'context_settings', return_value=('https://website.example', 'private-agent-token')), \
                patch.object(listen.urllib.request, 'urlopen', side_effect=error) as request, \
                contextlib.redirect_stderr(io.StringIO()) as output:
            with self.assertRaises(EmailApprovalError) as caught:
                listen.send_approved_email('private-review-key', '+12025550100', {'recipient': 'test@example.com'})
        self.assertEqual(caught.exception.status, 'failed')
        self.assertEqual(request.call_args.args[0].get_header('X-ambassador-verbose'), '1')
        self.assertIn('accessNotConfigured', output.getvalue())
        self.assertIn('gmail_submit', output.getvalue())
        self.assertNotIn('private-agent-token', output.getvalue())
        self.assertNotIn('private-review-key', output.getvalue())


if __name__ == '__main__':
    unittest.main()
