"""Offline sponsorship demo. No network calls; every identity is fictional."""
import csv
import hashlib
import json
from email.message import EmailMessage
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def digest(draft):
    return hashlib.sha256(json.dumps(draft, sort_keys=True).encode()).hexdigest()


def draft_message(event, lead):
    if lead['channel'] == 'email':
        body = (
            f"Hi {lead['contact'].split()[0]},\n\n"
            f"I'm {event['organizer']}, organizing {event['name']} on {event['date']} "
            f"at {event['location']} for an expected {event['expected_attendees']} participants.\n\n"
            f"Following our conversation about student developer tools, would "
            f"{lead['company']} consider contributing {lead['ask']}? "
            f"Our proposed sponsor benefits include {event['sponsor_benefits']}.\n\n"
            "Would you be open to a brief conversation about the fit?\n\n"
            f"Thanks,\n{event['organizer']}\n\n[FICTIONAL DEMO — NOT FOR DELIVERY]"
        )
    elif lead['channel'] == 'linkedin':
        body = (
            f"Hi {lead['contact'].split()[0]} — a volunteer suggested we connect. "
            f"I'm organizing {event['name']} on {event['date']}. Would your team "
            f"be interested in mentoring and contributing {lead['ask']}? "
            "Happy to share the event details. [FICTIONAL DEMO]"
        )
    else:
        body = (
            f"Hi {lead['contact'].split()[0]}! We're expecting {event['expected_attendees']} "
            f"people at {event['name']} on {event['date']}. Would {lead['company']} "
            f"be open to contributing {lead['ask']}? [FICTIONAL DEMO]"
        )
    return dict(lead_id=lead['id'], channel=lead['channel'], to=lead['address'],
                subject=f"[DEMO] Sponsorship invitation: {event['name']}", body=body)


def queue_mock_email(draft, approval, outbox, ledger):
    if approval != {'draft_hash': digest(draft), 'organizer': 'Alex Morgan', 'mock': True}:
        raise ValueError('Mock organizer approval must match this exact draft.')
    if draft['channel'] != 'email':
        raise ValueError('This offline outbox supports email only.')
    if draft['lead_id'] in ledger:
        return ledger[draft['lead_id']]
    message = EmailMessage()
    message['From'] = 'Alex Morgan <organizer@example.com>'
    message['To'] = draft['to']
    message['Subject'] = draft['subject']
    message['X-Ambassador-Demo'] = 'true; not delivered'
    message.set_content(draft['body'])
    outbox.mkdir(parents=True, exist_ok=True)
    path = outbox / f"{draft['lead_id']}.eml"
    path.write_bytes(message.as_bytes())
    ledger[draft['lead_id']] = {'status': 'mock_queued_not_delivered',
                              'draft_hash': digest(draft), 'file': path.name}
    return ledger[draft['lead_id']]


def main():
    data = json.loads((ROOT / 'fixtures.json').read_text())
    output = ROOT / 'output'
    output.mkdir(exist_ok=True)
    leads = data['leads']
    with (output / 'google-sheets-leads.csv').open('w', newline='', encoding='utf-8') as file:
        writer = csv.DictWriter(file, fieldnames=list(leads[0]))
        writer.writeheader()
        writer.writerows(leads)
    notion = '# Mock sponsorship leads\n\nImport the CSV as a Notion database, or use this page. All records are fictional.\n\n'
    for lead in leads:
        notion += f"## {lead['company']} ({lead['id']})\n\n" + '\n'.join(
            f"- {key}: {value}" for key, value in lead.items()) + '\n\n'
    (output / 'notion-leads.md').write_text(notion, encoding='utf-8')
    drafts = [draft_message(data['event'], lead) for lead in leads if lead['status'] == 'ready']
    (output / 'drafts.json').write_text(json.dumps(drafts, indent=2), encoding='utf-8')
    ledger_path = output / 'ledger.json'
    ledger = json.loads(ledger_path.read_text()) if ledger_path.exists() else {}
    email = drafts[0]
    approval = {'draft_hash': digest(email), 'organizer': 'Alex Morgan', 'mock': True}
    result = queue_mock_email(email, approval, output / 'outbox', ledger)
    ledger_path.write_text(json.dumps(ledger, indent=2), encoding='utf-8')
    transcript = (
        '# SIMULATED iMessage conversation — Spectrum is not connected\n\n'
        'Organizer: Check our sponsorship leads and prepare the next outreach.\n\n'
        f"Ambassador: {len(drafts)} leads are ready; Orbit Hardware is already in contract review. "
        'Northstar Cloud is a fit based on its stated interest in student developer tools.\n\n'
        f"To: {email['to']}\n\nSubject: {email['subject']}\n\n{email['body']}\n\n"
        'Ambassador: Approve this email, edit it, or reject it?\n\n'
        'Organizer (simulated): Approve lead-001.\n\n'
        'Ambassador: Mock email saved to the local outbox. No email was delivered.\n'
    )
    (output / 'imessage-transcript.md').write_text(transcript, encoding='utf-8')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
