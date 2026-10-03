# Offline demo

Run from the project root:

```powershell
python demo/run_demo.py
python demo/test_demo.py
```

No dependencies, credentials, or network access are required.

- `fixtures.json`: fictional hackathon, four sponsor leads, and contract status.
- `contracts/contract-001.md`: unsigned mock terms.
- `output/google-sheets-leads.csv`: data suitable for importing into Sheets or Notion; no remote source has been created.
- `output/notion-leads.md`: mock Notion page content.
- `output/drafts.json`: email, LinkedIn, and iMessage drafts.
- `output/imessage-transcript.md`: simulated organizer review and approval.
- `output/outbox/lead-001.eml`: drafted email saved locally; not delivered.
- `output/ledger.json`: persisted mock result; reruns do not queue the same lead again.

The approval is a scripted demo fixture, not real organizer authentication. This is not a live agent: it uses deterministic drafts, has no Spectrum connection, and sends no messages. Production sending requires authenticated organizer approval, connected providers, and durable send reconciliation.
