import io
import json
from pathlib import Path
import tempfile
import unittest
import urllib.error
import urllib.parse
from unittest.mock import patch

import fetch_context as context


class SettingsTests(unittest.TestCase):
    def test_local_shared_token_fallback_and_explicit_override(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(context.os.environ, {}, clear=True):
            agent = Path(tmp) / 'agent'
            web = Path(tmp) / 'web'
            agent.mkdir()
            web.mkdir()
            (web / '.env.local').write_text('AGENT_API_TOKEN=' + 'w' * 32 + '\nDATABASE_URL=private-db\n')
            (agent / '.env.local').write_text('AGENT_API_TOKEN=\nAMBASSADOR_WEB_URL=http://127.0.0.1:3001\n')
            with patch.object(context, 'AGENT_DIR', agent):
                self.assertEqual(context.context_settings(), ('http://127.0.0.1:3001', 'w' * 32))
                self.assertNotIn('DATABASE_URL', context.os.environ)
                context.os.environ['AGENT_API_TOKEN'] = 'e' * 32
                self.assertEqual(context.context_settings()[1], 'e' * 32)
                for url in ('http://example.com', 'https://user:password@example.com', 'https://example.com/path'):
                    context.os.environ['AMBASSADOR_WEB_URL'] = url
                    with self.assertRaises(ValueError):
                        context.context_settings()


class FakeWebsite:
    def __init__(self, phone):
        self.phone = phone
        self.files = {'doc-1': ('brief.md', b'Event brief'), 'doc-2': ('brief.md', b'Sponsor context')}
        self.calls = []
        self.fail_id = None
        self.wrong_owner = False
        self.wrong_size = False

    def open(self, request, timeout):
        self.calls.append(request)
        url = urllib.parse.urlsplit(request.full_url)
        assert urllib.parse.parse_qs(url.query)['phoneNumber'] == [self.phone]
        if url.path == '/api/agent/context':
            return io.BytesIO(json.dumps({
                'phoneNumber': self.phone, 'user': {'phoneNumber': self.phone},
                'campaign': {'name': 'Test campaign'}, 'contacts': [{'company': 'Example'}],
                'documents': [{'id': key, 'name': name, 'size': len(body) + int(self.wrong_size),
                               'ownerPhoneNumber': '+12025550999' if self.wrong_owner else self.phone}
                              for key, (name, body) in self.files.items()],
            }).encode())
        key = url.path.split('/')[-1]
        if key == self.fail_id:
            raise urllib.error.HTTPError(request.full_url, 503, 'unavailable', {}, io.BytesIO())
        return io.BytesIO(self.files[key][1])


class ContextTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.phone = '+12025550100'
        self.web = FakeWebsite(self.phone)
        settings = patch.object(context, 'context_settings', return_value=('https://web.example', 't' * 32))
        settings.start()
        self.addCleanup(settings.stop)

    def fetch(self, phone=None, website=None):
        return context.fetch_context(phone or self.phone, context_root=self.root, opener=website or self.web)

    def test_downloads_all_files_and_context_without_credentials(self):
        directory = self.fetch()
        manifest = json.loads((directory / 'workspace.json').read_text())
        self.assertEqual(len(manifest['documents']), 2)
        self.assertEqual(manifest['campaign']['name'], 'Test campaign')
        self.assertEqual(len({doc['localPath'] for doc in manifest['documents']}), 2)
        for doc in manifest['documents']:
            self.assertEqual((directory / doc['localPath']).read_bytes(), self.web.files[doc['id']][1])
        self.assertNotIn('t' * 32, (directory / 'workspace.json').read_text())
        self.assertEqual((directory.parent / 'current').resolve(), directory)
        self.assertTrue(all(r.get_header('Authorization') == 'Bearer ' + 't' * 32 for r in self.web.calls))

    def test_refresh_removes_old_files_without_touching_other_users(self):
        old = self.fetch()
        other = self.fetch('+12025550101', FakeWebsite('+12025550101'))
        self.web.files = {'doc-3': ('new.md', b'New context')}
        new = self.fetch()
        self.assertFalse(old.exists())
        self.assertTrue(other.exists())
        self.assertEqual(len(list(new.iterdir())), 2)
        self.web.files = {}
        empty = self.fetch()
        self.assertEqual(list(empty.iterdir()), [empty / 'workspace.json'])

    def test_failed_refresh_preserves_complete_previous_snapshot(self):
        old = self.fetch()
        self.web.fail_id = 'doc-2'
        with self.assertRaisesRegex(RuntimeError, '503'):
            self.fetch()
        self.assertEqual((old.parent / 'current').resolve(), old)
        self.assertEqual(list(old.parent.glob('snapshot-*')), [old])

    def test_owner_and_size_mismatch_reject_refresh(self):
        old = self.fetch()
        for field in ('wrong_owner', 'wrong_size'):
            with self.subTest(field=field):
                setattr(self.web, field, True)
                with self.assertRaises(ValueError):
                    self.fetch()
                setattr(self.web, field, False)
                self.assertEqual((old.parent / 'current').resolve(), old)

    def test_filename_paths_cannot_escape_snapshot(self):
        self.web.files = {'doc-1': ('../../escape.md', b'content')}
        directory = self.fetch()
        manifest = json.loads((directory / 'workspace.json').read_text())
        path = manifest['documents'][0]['localPath']
        self.assertNotIn('/', path)
        self.assertEqual((directory / path).parent, directory)
        self.assertFalse((self.root / 'escape.md').exists())

    def test_unknown_account_does_not_reuse_cached_context(self):
        old = self.fetch()
        with patch.object(self.web, 'open', side_effect=urllib.error.HTTPError('url', 404, 'missing', {}, io.BytesIO())):
            with self.assertRaisesRegex(RuntimeError, 'Sign up'):
                self.fetch()
        self.assertEqual((old.parent / 'current').resolve(), old)

    def test_invalid_phone_and_redirects(self):
        for phone in ('', '../owner', 'someone@example.com'):
            with self.assertRaises(ValueError):
                self.fetch(phone=' ' if not phone else phone)
        self.assertIsNone(context.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://elsewhere.example'))


if __name__ == '__main__':
    unittest.main()
