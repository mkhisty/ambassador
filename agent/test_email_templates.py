import copy
from html.parser import HTMLParser
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import listen
from email_templates import expanded_emails
from send_email import email_owner, email_proposal, email_review, handle_send_email
from widget import EmailApprovalError, ReviewStore, render, validate_email_proposal


class TemplateTests(unittest.TestCase):
    def proposal(self, count=2):
        owner = email_owner.set('+12025550100')
        pending = email_proposal.set(None)
        callback = email_review.set(None)
        try:
            result = handle_send_email({'subject': 'Hello [Name]', 'text': 'Hi [NAME], meet [COMPANY].',
                'recipients': [{'email': f'person{i}@example.com',
                                'parameters': {'Name': f'Person {i}', 'COMPANY': 'Example'}}
                               for i in range(count)]})
            self.assertNotIn('error', result)
            return result['proposal']
        finally:
            email_review.reset(callback)
            email_proposal.reset(pending)
            email_owner.reset(owner)

    def test_template_expands_case_insensitively_and_keeps_distinct_review_ids(self):
        proposal = self.proposal()
        messages = expanded_emails(proposal)
        self.assertEqual(messages[0][1]['body'], 'Hi Person 0, meet Example.')
        self.assertEqual(messages[1][1]['subject'], 'Hello Person 1')
        self.assertNotEqual(messages[0][0], messages[1][0])
        self.assertEqual(proposal['body'], 'Hi [NAME], meet [COMPANY].')
        self.assertNotIn('recipients', messages[0][1])

    def test_all_missing_fields_and_header_injection_are_blocked_before_dispatch(self):
        proposal = self.proposal()
        proposal['recipients'][1]['parameters'].pop('NAME')
        with self.assertRaisesRegex(ValueError, 'Missing recipient parameters'):
            expanded_emails(proposal)
        proposal = self.proposal()
        proposal['recipients'][0]['parameters']['NAME'] = 'Person\r\nBcc: attacker@example.com'
        with self.assertRaisesRegex(ValueError, 'without line breaks'):
            expanded_emails(proposal)

    def test_duplicate_addresses_and_unbound_templates_are_rejected(self):
        owner = email_owner.set('+12025550100')
        pending = email_proposal.set(None)
        self.addCleanup(email_owner.reset, owner)
        self.addCleanup(email_proposal.reset, pending)
        self.assertIn('error', handle_send_email({'to': 'person@example.com', 'subject': 'Hi', 'text': 'Hi [NAME]'}))
        self.assertIn('error', handle_send_email({'subject': 'Hi', 'text': 'Hi', 'recipients': [
            {'email': 'person@example.com'}, {'email': 'PERSON@example.com'}]}))

    def test_review_highlights_fields_and_escapes_values_and_template_html(self):
        proposal = self.proposal()
        proposal['body'] += ' <script>unsafe()</script>'
        proposal['recipients'][0]['parameters']['NAME'] = '<img onerror="unsafe()">'
        store = ReviewStore()
        key = store.create(proposal['body'], {'sender': {'id': '+12025550100'}, 'space': {'id': 'owner-dm'}}, email_proposal=proposal)
        page = render(store.get(key))
        self.assertIn('<mark class="template-field">[NAME]</mark>', page)
        self.assertIn('Approve & Send 2 Emails', page)
        self.assertIn('&lt;script&gt;unsafe()', page)
        self.assertNotIn('<img onerror=', page)
        self.assertIn('person1@example.com', page)

    def test_preview_displays_email_once_before_recipient_values(self):
        proposal = self.proposal()
        store = ReviewStore()
        key = store.create(proposal['body'], {'sender': {'id': '+12025550100'}}, email_proposal=proposal)
        page = render(store.get(key))
        class Text(HTMLParser):
            def __init__(self):
                super().__init__()
                self.values = []
            def handle_data(self, value):
                self.values.append(value)
        text = Text()
        text.feed(page)
        visible = ''.join(text.values)
        self.assertEqual(visible.count(proposal['body']), 1)
        self.assertLess(visible.index(proposal['body']), visible.index('Recipient values'))
        self.assertIn('<pre id="response" hidden></pre>', page)
        self.assertIn('<mark class="template-field">[NAME]</mark>', page)

    def test_success_preview_has_simple_confirmation_without_provider_caveats(self):
        proposal = self.proposal()
        store = ReviewStore(emit=lambda value: None, on_email_approve=lambda *args:
                            {'status': 'accepted', 'messageId': 'provider-id', 'results': [
                                {'recipient': row['email'], 'status': 'accepted'} for row in proposal['recipients']]})
        key = store.create(proposal['body'], {'sender': {'id': '+12025550100'}, 'space': {'id': 'owner-dm'}}, email_proposal=proposal)
        store.submit(key, {'action': 'approve'})
        page = render(store.get(key))
        self.assertIn('<h1>Emails sent</h1>', page)
        self.assertIn('Your emails were sent.', page)
        self.assertNotIn('does not confirm delivery', page)
        self.assertNotIn('Recipient outcomes', page)

    def test_edits_keep_trusted_child_ids_and_send_exact_personalized_values(self):
        proposal = self.proposal()
        edited = {key: copy.deepcopy(value) for key, value in proposal.items() if key != 'reviewId'}
        edited['body'] = 'Updated [NAME]'
        edited['recipients'][0].update(reviewId='attacker-selected', email='new@example.com')
        edited['recipients'][0]['parameters']['NAME'] = 'New name'
        reviewed = validate_email_proposal(edited, proposal)
        self.assertEqual(reviewed['recipients'][0]['reviewId'], proposal['recipients'][0]['reviewId'])
        self.assertEqual(expanded_emails(reviewed)[0][1]['body'], 'Updated New name')
        sends = []
        store = ReviewStore(emit=lambda value: None, on_email_approve=lambda *args:
                            sends.append(args) or {'status': 'accepted', 'messageId': 'provider-id'})
        key = store.create(proposal['body'], {'sender': {'id': '+12025550100'}, 'space': {'id': 'owner-dm'}}, email_proposal=proposal)
        store.submit(key, {'action': 'edit_approve', 'email': edited})
        self.assertEqual(sends[0][2], reviewed)

    def test_draft_save_uses_each_child_id_and_review_shows_shared_template(self):
        proposal = self.proposal()
        store = ReviewStore()
        event = {'messageId': 'incoming', 'sender': {'id': '+12025550100'}, 'space': {'id': 'space'}}
        with patch.object(listen, 'post_website') as website, patch.object(listen, 'post'):
            listen.request_email_review('token', store, 'https://widget.example', event, proposal)
        self.assertEqual(website.call_count, 2)
        self.assertEqual(website.call_args_list[1].args[1]['proposal']['body'], 'Hi Person 1, meet Example.')
        self.assertEqual(store.get(proposal['reviewId'])['text'], proposal['body'])

    def test_batch_success_returns_every_provider_message(self):
        proposal = self.proposal()
        with patch.object(listen, 'post_website', side_effect=[
            {'status': 'accepted', 'messageId': 'first'}, {'status': 'accepted', 'messageId': 'second'}]) as website:
            result = listen.send_approved_email(proposal['reviewId'], '+12025550100', proposal)
        self.assertEqual(result['status'], 'accepted')
        self.assertEqual([row['messageId'] for row in result['results']], ['first', 'second'])
        self.assertEqual(website.call_args_list[1].args[1]['reviewId'], proposal['recipients'][1]['reviewId'])

    def test_partial_failure_stops_sending_persists_outcomes_and_never_retries(self):
        proposal = self.proposal(3)
        outcomes = []
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'reviews.json'
            store = ReviewStore(emit=lambda value: None, state_path=state,
                on_email_approve=listen.send_approved_email,
                on_email_outcome=lambda key, event, result: outcomes.append(result))
            key = store.create(proposal['body'], {'sender': {'id': '+12025550100'}, 'space': {'id': 'owner-dm'}}, email_proposal=proposal)
            with patch.object(listen, 'post_website', side_effect=[
                {'status': 'accepted', 'messageId': 'first'}, EmailApprovalError('Rejected', 'failed')]) as website:
                with self.assertRaisesRegex(RuntimeError, '1 of 3'):
                    store.submit(key, {'action': 'approve'})
                self.assertEqual(website.call_count, 2)
            self.assertEqual(outcomes[0]['status'], 'partial')
            self.assertEqual([row['status'] for row in outcomes[0]['results']], ['accepted', 'failed', 'not_sent'])
            recovered = ReviewStore(state_path=state)
            self.assertIn('Batch partially sent', render(recovered.get(key)))
            self.assertIn('person2@example.com: not_sent', render(recovered.get(key)))
            with self.assertRaises(RuntimeError):
                recovered.submit(key, {'action': 'approve'})

    def test_missing_parameters_in_an_edit_dont_send_and_review_remains_editable(self):
        proposal = self.proposal()
        edited = {key: value for key, value in proposal.items() if key != 'reviewId'}
        edited['body'] = 'Hello [MISSING]'
        store = ReviewStore(on_email_approve=lambda *args: self.fail('Must not send'))
        key = store.create(proposal['body'], {'sender': {'id': '+12025550100'}, 'space': {'id': 'owner-dm'}}, email_proposal=proposal)
        with self.assertRaises(ValueError):
            store.submit(key, {'action': 'edit_approve', 'email': edited})
        self.assertFalse(store.get(key)['processing'])
        self.assertIsNone(store.get(key)['result'])


if __name__ == '__main__':
    unittest.main()
