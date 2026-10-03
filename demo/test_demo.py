from uuid import uuid4
from pathlib import Path
from run_demo import digest, queue_mock_email


def test_approval_and_duplicate_send():
    draft = dict(lead_id='test', channel='email', to='test@example.com', subject='Demo', body='Test')
    approval = dict(draft_hash=digest(draft), organizer='Alex Morgan', mock=True)
    outbox = Path(__file__).resolve().parent / ('test-output-' + uuid4().hex)
    outbox.mkdir()
    try:
        ledger = {}
        for invalid in ({}, dict(approval, organizer='Someone else')):
            try:
                queue_mock_email(draft, invalid, outbox, ledger)
                raise AssertionError('Unapproved send accepted')
            except ValueError:
                pass
        try:
            queue_mock_email(dict(draft, body='Changed after approval'), approval, outbox, ledger)
            raise AssertionError('Changed draft accepted')
        except ValueError:
            pass
        assert not list(outbox.iterdir())
        first = queue_mock_email(draft, approval, outbox, ledger)
        assert queue_mock_email(draft, approval, outbox, ledger) == first
        assert len(list(outbox.iterdir())) == 1
        assert first['status'] == 'mock_queued_not_delivered'
    finally:
        for file in outbox.iterdir():
            file.unlink()
        outbox.rmdir()


if __name__ == '__main__':
    test_approval_and_duplicate_send()
    print('PASS: missing/wrong approval, changed draft, duplicate send, and mock status')
