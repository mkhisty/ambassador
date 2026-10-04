# Ambassador mobile conversation designs

October 4, 2026. These are proposed interaction designs, not implemented features. The primary mobile surface is one Photon-connected iMessage conversation. The website remains the companion for dense tables, bulk uploads, charts, and account management.

## Product structure

Treat each display as a moment in the same conversation, rather than a separate mobile application page. Use ordinary text whenever it is sufficient. Compact cards can make structured information easier to scan, but their rendering, buttons, attachments, and callbacks must be validated against the team's Spectrum implementation before development. Every card needs a plain-text command fallback.

Use general campaign language: contacts, outreach, responses, follow-ups, and outcomes. Startup outreach is a sample scenario; parties, weddings, recruiting, community organizing, and other campaigns use the same interaction model.

## Main integrations

- **Hermes client:** requested client integration. Its exact implementation and responsibilities are not yet identified. Keep the client boundary explicit; confirm how it connects to Photon Spectrum before assuming it carries iMessage or renders widgets.
- **Notion:** shared campaign briefs, approved facts, relationship notes, strategy, and source documents. Show the page title and last synchronization time beside context. Ask the user to select which shared pages Ambassador may access.
- **Google Sheets / Excel:** structured contact tracking, channel, stage, last outreach, next action, owner, and source reference. Choose one authoritative tracker per campaign. Treat Excel files as reviewed imports/exports unless a live workbook integration is explicitly chosen; do not silently maintain two competing trackers.
- **Gmail:** connected sender identity, draft creation, reviewed sending, received replies, and thread references. Email creation means drafting messages, not creating Gmail accounts. Display the Gmail account and exact recipient on every approval card.
- **Neon:** existing website identity, private document ownership, and app persistence. Integration mappings and action receipts can be stored here when implemented. Avoid two independent editable versions of a contact stage: declare whether the app or the selected Sheet owns each field.

The mobile experience should show integration state only when useful: first connection, a missing permission, stale context, or a failed synchronization. Detailed integration administration belongs on the website.

## Display inventory and build order

| Priority | Moment | Information and action | Plain-text fallback |
| --- | --- | --- | --- |
| P0 | Link account | Open a secure website account-link flow; select Notion context, the contact tracker, and the Gmail sender. Confirm the client connection. | `Connect my account` |
| P0 | Campaign brief | Goal, audience, deadline, permitted channels, outreach guidelines; review before saving. | `Set up my campaign` |
| P0 | Daily brief | Contacts by stage, replies needing attention, overdue follow-ups, one next action. | `What needs attention?` |
| P0 | Contact context | Contact identity and tracking row from Sheets, relationship notes from Notion, Gmail thread, source and next action. | `Show Priya Shah` |
| P0 | Draft approval | Gmail sender, exact recipient, subject, complete message, draft reference; approve, edit, or discard. | `Approve draft D104`, `Edit D104`, `Discard D104` |
| P0 | Send receipt | Gmail result, tracker update, pending synchronization and unresolved send state shown separately. | `Status D104` |
| P1 | Document intake | Attachment receipt, processing state, proposed extracted facts and contacts; confirm before import. | `Review import I07` |
| P1 | Reply and follow-up | Original reply excerpt, summary, implications, proposed response; no automatic acceptance of terms. | `Draft a reply to Maya` |
| P1 | Scheduling | Proposed title, attendees, date, time, timezone, duration, destination calendar; explicit confirmation. | `Confirm meeting M12` |
| P1 | Campaign switch | Name the active campaign explicitly; disambiguate contacts or actions across campaigns. | `Switch to Investor outreach` |

The prototype may combine campaign selection with account linking. Multi-campaign persistence is a proposed extension: the current website stores one shared campaign.

## First demo journey

1. Link the account and select Notion pages, one Sheet or imported Excel tracker, and the Gmail account through the website; then return to iMessage.
2. Ask what needs attention. Ambassador shows an actionable brief.
3. Open a contact and review its tracking row, Notion relationship context, and existing Gmail thread.
4. Request an outreach draft, edit it, and approve that exact version.
5. Show a receipt with the real Gmail result and the separate tracker synchronization result. A preview is explicitly labeled unsent.
6. Demonstrate a simulated incoming reply and a proposed follow-up. Calendar and document extraction can remain clearly marked future flows until their integrations work.

This short journey proves persistent context, useful action, and human control without needing every proposed display implemented first.

## Interaction and state rules

- A phone number identifies an account; knowing that number is not authentication. The website currently requires a password and does not verify phone ownership. A secure, expiring account-link mechanism between the website session and Spectrum identity is needed.
- Render readable, short messages. Avoid long dashboards inside chat. Provide a website link for charts, full contact tables, and document management.
- An edited recipient, channel, subject, or body creates a new draft version and requires approval again. Approval applies to one exact draft, never a general permission to send.
- Repeated approval must not repeat delivery. Disable or reject stale approval actions server-side, not only visually.
- Distinguish `prepared`, `preview—unsent`, `provider accepted`, `failed`, and `uncertain`. Provider acceptance does not prove delivery. Only claim delivered when a supported provider supplies delivery evidence.
- If a send result is uncertain, offer a status check and reconciliation; never offer an immediate blind retry.
- If Gmail accepts a message but Sheets writeback fails, show `Message accepted; tracker update pending`. Retry the tracker update only; never resend the message to repair tracking. Notion context failure must not be disguised as empty relationship history.
- Reply summaries and negotiation suggestions remain drafts. Do not accept commitments or terms on the user's behalf.
- Scheduling always shows an explicit timezone and requires permission to create the calendar entry. Do not claim a meeting was created before the calendar provider confirms it.
- Document imports show unsupported file, upload failure, processing, extraction failure, duplicate contacts, and review states. Upload success alone does not imply extraction success.
- Files and source references require authenticated owner access. Phone-only file lookup is a query pattern, not permission to download another person's files.
- Empty campaigns ask for a goal or contacts. Ambiguous names require selection. Disconnected channels give a connect action. Expired sessions give an account-link action.
- Do not depend on color alone. Use text status labels, adequate contrast, comfortable touch targets, and a readable fallback for every proposed widget.

## Current implementation versus proposal

Existing website: phone/password accounts, shared campaign and contact records, stage counts, relationship notes, activity history, uploads, authenticated owner-filtered document retrieval, bulk tabular import, and a Sankey snapshot.

Not established by these designs: the Hermes client connection, live synchronization between iMessage and Neon, Spectrum account linking, rich widget compatibility, Gmail API authorization and draft/thread integration, mobile attachment ingestion, AI document extraction, calendar integration, multi-campaign isolation, or verified delivery receipts. Existing messaging documentation describes Notion/Sheets adapters and SMTP email, which does not establish a Gmail API integration. These require implementation and provider validation. The HTML prototype uses fictional data and makes no external calls.

## Handoff for the iMessage widget work

Build three reusable layouts initially: a brief with one primary action, a context card, and an exact draft approval card. Represent receipts as plain text first. Keep the campaign name visible when it affects an action. Use server-generated immutable action references and enforce account, campaign, draft version, expiry, and single-use rules on the server. Add import and scheduling layouts only once their APIs exist.

## Files

- `mobile-imessage-wireframes.html`: standalone, responsive visual board of proposed conversation moments. Open a phone preview to enlarge it. Actions are simulated.
- `MOBILE.md`: scope, display map, implementation order, state rules, and handoff notes.
