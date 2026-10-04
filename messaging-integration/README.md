# Ambassador

Events and relationship-driven outreach, coordinated in iMessage through Photon Spectrum. The current demo highlights hackathon sponsorship; the broader product can apply to party attendance, weddings, recruiter outreach, startup go-to-market work, and political campaigns.

The working service reads sponsor leads, drafts messages, saves them in SQLite, and sends only after an authorized organizer approves the exact draft ID. Email uses SMTP; iMessage uses Spectrum. LinkedIn currently provides a draft for manual handoff. A local terminal uses the same workflow for preview testing.

## Run locally

Requires Node.js 24+. Dependencies are already installed in this workspace.

```powershell
npm install
# For a fresh checkout only (do not overwrite an existing .env):
Copy-Item .env.example .env
npm run doctor
npm run chat
```

Start with `leads`, then `draft lead-012`. Review the recipient and message, then type the displayed `approve d-...` command. In the default `SEND_MODE=preview`, an email is written to `data/outbox/` and nobody is contacted. `status` shows the saved result. `exit` stops terminal mode.

`npm test` runs offline approval, persistence, provider-failure, replay, and adapter tests. The Python files in `demo/` use the shared 26-account fictional sponsorship scenario; use the Node service for the actual agent.

## Connect Spectrum and your organizer

1. Create a project at [Photon](https://app.photon.codes) and enable its iMessage connection. Register the organizer as a project user if using a shared line, then use the assigned number shown in the dashboard.
2. In `.env`, set `PROJECT_ID`, `PROJECT_SECRET`, and `ORGANIZER_IDS` to the organizer's exact E.164 sender number (for example `+12025550100`). For an Apple ID sender, use the exact email identity instead. Comma-separated organizers are supported.
3. Keep `SEND_MODE=preview` initially. Run `npm start`, then text `help` to the Photon number from the configured organizer account.
4. Text `draft lead-012`. Review the returned draft and approve its ID to produce an offline email preview. This verifies the real Spectrum -> agent -> iMessage approval path while outreach remains in preview mode.

Only inbound, direct organizer messages control the agent. Group messages, self-echoes, edits, and reactions cannot approve a send. An approval belongs to the organizer and conversation that created the draft. The terminal cannot authorize live sends. All configured organizers can inspect overall outreach status.

For iMessage outreach, shared-line recipients must also be registered as project users. Set `IMESSAGE_LINE` when a particular dedicated sending line is required. See [Photon's iMessage documentation](https://photon.codes/docs/spectrum-ts/providers/imessage).

## Enable AI drafting

Set `OPENAI_API_KEY`; `OPENAI_MODEL` defaults to `gpt-4.1-mini`. Requests include event details, the selected lead and its notes, and recent organizer context for intent classification. Without a key the agent clearly labels template drafts and supports explicit commands.

With a key, try “Prepare outreach to Fieldwork” and then “Make that shorter.” Revisions generate a new draft ID; old IDs cannot be approved. The model cannot send or approve messages. [OpenAI Chat Completions reference](https://developers.openai.com/api/reference/resources/chat).

## Connect email and send to your own test inbox

Set these in `.env`:

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=your-sending-account
SMTP_PASS=your-provider-app-password
EMAIL_FROM=your-sending-address
EMAIL_TEST_TO=your-own-test-inbox
```

Use your email provider's SMTP credentials; an account password may not be accepted. Ports 465 (TLS) and 587 (STARTTLS) are supported. `EMAIL_FROM` and `EMAIL_TEST_TO` must be plain email addresses, without display names. Validate authentication without sending:

```powershell
npm run doctor -- --verify-email
```

Once the preview path works, set `SEND_MODE=live`, restart `npm start`, and prepare a **new** draft over iMessage. The actual test recipient is shown before approval. Approve that exact draft to send it. Fictional fixtures cannot send live email without `EMAIL_TEST_TO`, and fictional iMessage outreach is blocked. Keep the mock label in messages while using fictional event details.

A successful send means the provider accepted the message, not that it reached the recipient's inbox. Any uncertain provider attempt is blocked from automatic retry. Inspect provider logs and the stored record before resolving it manually. The stable email Message-ID helps locate a send, but is not an SMTP deduplication guarantee.

## Connect a Google Sheet

1. Import `demo/output/google-sheets-leads.csv` into a tab named `Leads`. Generate it with `python demo/run_demo.py` if necessary.
2. Enable Google Sheets API in a Google Cloud project, create a service account, and keep its JSON key in `secrets/google-service-account.json` (ignored by Git).
3. Share the sheet with the service account's `client_email` as an editor.
4. Set `LEAD_SOURCE=sheets`, `GOOGLE_APPLICATION_CREDENTIALS=secrets/google-service-account.json`, `GOOGLE_SHEET_ID` (the ID in the sheet URL), and `GOOGLE_SHEET_TAB=Leads`.
5. Run `npm run doctor` to verify the read.

Required lowercase headers: `id,company,contact,channel,address,ask,notes,status,owner`. IDs must be unique. Channels are `email`, `imessage`, and `linkedin`. Only `status=ready` qualifies for initial outreach. After provider acceptance, the service updates the matching lead's status to `contacted`; previews do not change the sheet. Avoid sorting/editing rows during the short write-back window: Sheets does not provide a row-level compare-and-swap here. [Google Sheets API](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get).

## Connect Notion

1. Import the same CSV as a database. Preserve the lowercase field names; `company` can be the title property. Use text properties for `id`, `contact`, `address`, `ask`, `notes`, and `owner`; `channel` can be text or select.
2. Make `status` text or a select/status property with `ready` and `contacted` available.
3. Create a Notion integration with read/update access and connect it to the database.
4. Set `LEAD_SOURCE=notion`, `NOTION_TOKEN`, and `NOTION_DATA_SOURCE_ID`. This must be the underlying **data source ID**, not a page URL or database ID; retrieve the database with Notion's API to inspect its `data_sources` if needed.
5. Run `npm run doctor` to verify access. Accepted outreach updates the page's `status`.

The reader supports pagination and uses Notion API version `2025-09-03`. It expects a structured database, not arbitrary page prose. [Notion's official API schema](https://github.com/makenotion/notion-mcp-server/blob/main/scripts/notion-openapi.json).

## Commands and saved state

| Command | Action |
| --- | --- |
| `leads` | Read and validate the configured source |
| `draft [lead-id]` | Draft for a selected or next ready lead |
| `show <draft-id>` | Show exact saved content and recipient |
| `edit <draft-id> <body>` | Replace the body and invalidate the old approval ID |
| `revise <draft-id> <instructions>` | Ask AI to revise and generate a new approval ID |
| `approve <draft-id>` | Send or preview the exact pending draft |
| `reject <draft-id>` | Reject the pending draft |
| `status` | Show persistent outreach outcomes |
| `sync-status` | Retry source updates for accepted sends, never resend outreach |
| `contracts` | Display configured contract tracking records |
| `inbox` | Show saved iMessage replies from known sponsor contacts |

`data/ambassador.sqlite` holds leads, messages, approvals, and outcomes. Protect and retain it across restarts. One local process per data directory is supported. After an abnormal exit, confirm the agent is stopped before removing `data/agent.lock`. Normal exits remove it automatically. Do not reset the database to retry an uncertain send.

Event and contract data currently come from `EVENT_FILE` (`demo/fixtures.json` by default). For a real event, use a private file in `data/` with `mock:false`, real event details, and `contracts` records in the fixture format. Contract support is tracking only: no legal drafting, signing, or accepting terms. Email reply polling and LinkedIn sending are not yet implemented. Google Sheets/Notion changes are read on request, not monitored continuously. Switching sources or sending settings requires new drafts; reject any pending drafts in their original conversation first.

## Verification status

Offline tests exercise the real SQLite store and Nodemailer email preview output, with controlled providers for failure scenarios. The installed Spectrum API contract and adapter filtering are checked locally. Live Spectrum, AI, SMTP, Sheets, and Notion end-to-end verification still requires your credentials and accounts.

The lockfile includes a scoped override upgrading vulnerable OpenTelemetry core 2.7.x copies to 2.8.0. The installation audit currently reports zero known vulnerabilities. Revisit that override when Spectrum updates its telemetry dependencies.
