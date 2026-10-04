import hashlib
import json
import tempfile
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

from email_attachments import resolve_attachments
from send_email import email_context, email_owner, email_proposal, email_review, handle_send_email
from widget import ReviewStore, render, start_widget_server, validate_email_proposal


class AttachmentTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.phone = '+12025550100'
        self.data = b'%PDF-1.7\n\x00\xff\nattachment bytes'
        self.file = self.root / 'original-brief.pdf'
        self.file.write_bytes(self.data)
        self.doc = {'id': 'owned-document', 'name': 'Campaign brief.pdf', 'mime': 'application/pdf',
                    'size': len(self.data), 'sha256': hashlib.sha256(self.data).hexdigest(),
                    'localPath': self.file.name, 'ownerPhoneNumber': self.phone}
        self.manifest = {'phoneNumber': self.phone, 'documents': [self.doc]}
        self.write_manifest()

    def write_manifest(self):
        (self.root / 'workspace.json').write_text(json.dumps(self.manifest))

    def proposal(self):
        for variable, value in [(email_owner, self.phone), (email_context, self.root),
                                (email_proposal, None), (email_review, None)]:
            token = variable.set(value)
            self.addCleanup(variable.reset, token)
        result = handle_send_email({'to': 'recipient@example.com', 'subject': 'Brief', 'text': 'See attached.',
                                   'attachment_paths': [self.file.name]})
        self.assertNotIn('error', result)
        return result['proposal']

    def test_paths_and_ids_resolve_to_one_owned_document_without_local_paths_in_proposal(self):
        refs, files = resolve_attachments(['owned-document'], [str(self.file), self.file.name], self.root, self.phone)
        self.assertEqual(refs, ['owned-document'])
        self.assertEqual(files[0]['name'], 'Campaign brief.pdf')
        proposal = self.proposal()
        self.assertEqual(proposal['attachmentRefs'], ['owned-document'])
        self.assertNotIn(self.file.name, json.dumps(proposal))
        self.assertEqual(proposal['attachments'], files)

    def test_paths_outside_context_unlisted_files_and_modified_files_are_blocked(self):
        with tempfile.TemporaryDirectory() as other:
            outside = Path(other) / 'private.txt'
            outside.write_text('private')
            (self.root / 'outside-link.txt').symlink_to(outside)
            for path in [str(outside), 'outside-link.txt', 'workspace.json']:
                with self.assertRaises(ValueError):
                    resolve_attachments([], [path], self.root, self.phone)
        self.file.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'changed'):
            resolve_attachments([], [self.file.name], self.root, self.phone)

    def test_foreign_manifest_document_and_oversize_attachments_are_blocked(self):
        with self.assertRaises(ValueError):
            resolve_attachments(['owned-document'], [], self.root, '+12025550999')
        self.manifest['documents'][0]['ownerPhoneNumber'] = '+12025550999'
        self.write_manifest()
        with self.assertRaises(ValueError):
            resolve_attachments(['owned-document'], [], self.root, self.phone)
        self.manifest['documents'][0].update(ownerPhoneNumber=self.phone, size=25_000_001)
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, '25 MB'):
            resolve_attachments(['owned-document'], [], self.root, self.phone)

    def test_review_shows_filename_link_and_edits_preserve_attachment_details(self):
        proposal = self.proposal()
        store = ReviewStore()
        key = store.create(proposal['body'], {'sender': {'id': self.phone}}, email_proposal=proposal)
        page = render(store.get(key))
        self.assertIn(f'/review/{key}/attachments/owned-document', page)
        self.assertIn('Campaign brief.pdf</a>', page)
        self.assertNotIn(str(self.root), page)
        edited = {'recipient': proposal['recipient'], 'subject': 'Updated', 'body': 'Updated body'}
        approved = validate_email_proposal(edited, proposal)
        self.assertEqual(approved['attachments'], proposal['attachments'])
        self.assertEqual(approved['reviewId'], key)
        with self.assertRaises(ValueError):
            validate_email_proposal({**edited, 'attachmentRefs': ['foreign']}, proposal)

    def test_attachment_links_download_only_reviewed_files_and_never_approve(self):
        proposal = self.proposal()
        calls = []
        store = ReviewStore(on_attachment_download=lambda phone, ref: calls.append((phone, ref)) or self.data)
        key = store.create(proposal['body'], {'sender': {'id': self.phone}}, email_proposal=proposal)
        server = start_widget_server(store, port=0)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        base = f'http://127.0.0.1:{server.server_port}/review/{key}/attachments/'
        with urllib.request.urlopen(base + 'owned-document') as response:
            self.assertEqual(response.read(), self.data)
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
            self.assertIn('Campaign%20brief.pdf', response.headers['Content-Disposition'])
        self.assertEqual(calls, [(self.phone, 'owned-document')])
        self.assertIsNone(store.get(key)['result'])
        for path in ['foreign', '../workspace.json', '%2Fetc%2Fpasswd']:
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(base + path)
            error.exception.close()
        self.assertEqual(len(calls), 1)
        store.items[key]['expires'] = 0
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(base + 'owned-document')
        error.exception.close()
        self.assertEqual(len(calls), 1)


if __name__ == '__main__':
    unittest.main()
