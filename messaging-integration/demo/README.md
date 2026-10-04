# Offline demo

Run from the repository root:

```powershell
python messaging-integration/demo/run_demo.py
python messaging-integration/demo/test_demo.py
```

No dependencies, credentials, or network access are required.

- `fixtures.json`: fictional hackathon, 26 sponsor accounts across all seven stages, and contract status. Generated from `web/lib/demo.mjs` with `npm run demo:export` in `web`.
- `contracts/contract-001.md`: unsigned mock terms.
- `output/google-sheets-leads.csv`: data suitable for importing into Sheets or Notion; no remote source has been created.
- `output/notion-leads.md`: mock Notion page content.
- `output/drafts.json`: email, LinkedIn, and iMessage drafts.
- `output/imessage-transcript.md`: simulated organizer review and approval.
- `output/outbox/lead-012.eml`: Fieldwork Robotics email saved locally; not delivered.
- `output/ledger.json`: persisted mock result; reruns do not queue the same lead again.

The approval is a scripted demo fixture, not real organizer authentication. This is not a live agent: it uses deterministic drafts, has no Spectrum connection, and sends no messages. Production sending requires authenticated organizer approval, connected providers, and durable send reconciliation.

Five Qualified accounts map to `ready` for initial drafting. Negotiating maps to `contract_review`; other stages retain their own status and are excluded from initial pitches. Cedar Labs has unsigned mock terms. All contact addresses and histories are fictional. Archived outbox files from older walkthroughs are not new send results.
