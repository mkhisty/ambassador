# Ambassador web workspace

The interface uses campaign terminology: Contacts, Campaign settings, Outreach pipeline, responses, follow-ups, and completed outcomes. Dashboard totals are contact counts; campaign targets count outcomes. Individual contacts can be added without an organization. CSV imports accept Ready, Follow-up, and Completed. Existing Postgres table names and API fields (`event`, `sponsors`, `sponsorId`) are retained for compatibility with the messaging worker; financial fields remain in existing records but are not part of the campaign interface.

Ambassador coordinates events, people, and relationship-driven outreach through conversations. Use cases include party attendance, wedding planning, recruiter outreach, startup go-to-market work, and political campaigns. This Vercel-ready POC demonstrates that broader product through hackathon sponsorship: sponsor context, document uploads, and pipeline visibility backed by Neon, with Photon Spectrum as the intended conversation interface. Other use cases are not separate implemented modules yet.

## Run

Requires Node.js 24+.

```powershell
cd web
npm install
npm run dev
```

Open http://127.0.0.1:3000. Without `DATABASE_URL`, the application runs a clearly labeled browser demo. Sponsor changes and event settings persist in localStorage; document bytes persist in IndexedDB. Demo data is fictional and does not send messages. Browser storage is not shared across devices or backed up by Neon.

Once signed into Neon, choose **View demo** in the upper right to explore the sample workspace. Choose **Live workspace** to return to your private data. Sample records are never copied into Neon automatically.

The current sample contains **26 fictional accounts**, across all seven sponsor stages and email, iMessage, and LinkedIn channels. It includes phone-keyed profiles, distinct relationship context, follow-ups, stage histories, $17,500 committed and $8,500 received against a $25,000 goal. These payments and commitments are invented. Version 2 uses a new browser storage key; any earlier local sample remains stored under its previous key.

`web/lib/demo.mjs` is the canonical dataset. Run `npm run demo:export` from `web` to regenerate `test/fixtures/sponsors.csv`, `messaging-integration/demo/fixtures.json`, and the root `STRATEGY.md`. Exports use October 3, 2026 as the walkthrough anchor; browser and Neon seed follow-ups are relative to the seed date.

To explicitly load this scenario into your configured Neon project, run `npm run db:seed-demo`. This adds marked mock sponsors, phone profiles, company associations, history, the strategy guide, and the event brief atomically. It never replaces existing sponsors or users, and it only fills event settings if the event still has the original default name. Reruns do not duplicate accounts or overwrite edits or documents. The live dashboard displays a fictional-data notice while mock records are present. Migrations alone never load samples.

## Connect Neon

1. Create a Neon project and copy its pooled Postgres connection string.
2. Copy `.env.example` to `.env.local`. Set `DATABASE_URL`, `WORKSPACE_PASSWORD` (at least 12 characters), and a random `SESSION_SECRET` (at least 32 characters). Never expose these through `NEXT_PUBLIC_` variables.
3. Run `npm run db:migrate`. This creates the schema and an empty event; it does not copy fictional sponsors into the database.
4. Restart the website and sign in using your workspace password.
5. Set event details and import real sponsors.

The POC supports a single shared campaign with individual phone/password accounts and signed, HTTP-only, one-day sessions. Use a strong random password. Production accounts should use a managed authentication provider, phone verification where required, and campaign-level permissions. Set rate limits on the sign-in endpoint in your hosting platform before broadly distributing a private workspace URL. Credential configuration and live Neon round-trip verification require your account; no Neon project is provisioned automatically.

## Document storage

Documents have an indexed `owner_phone_number` foreign key to `ambassador_users.phone_number`. Uploads assign this from the signed login session, ignoring any owner submitted by the browser. Workspace listings and ID-based downloads are filtered by that owner. `GET /api/documents?phoneNumber=7344199492` returns that owner's document metadata after login; a different requested phone returns 403. Unknown or another owner's document ID returns 404. Both Postgres and object-store files use the same ownership checks.

Phone numbers are required for both account creation and sign-in. Ten-digit US numbers normalize to `+1` E.164 format. Each account has its own salted scrypt password hash in `ambassador_user_auth`; cookies contain a signed phone identity. Account creation also requires a separate invitation password (`WORKSPACE_INVITE_PASSWORD`), which must not be shared with the initial account password. Knowing a phone number alone never grants file access; phone ownership itself is not SMS-verified. Campaign/contact data remains a shared workspace; document ownership is private per account. Agent tokens do not grant access to user documents through these browser routes.

The initial account is `+17344199492`, using the existing workspace password as its initial account password. The explicitly requested setup script associated the existing documents with this account and consolidated only fictional demo user profiles. Other real user profiles remain unchanged. All demo contacts associate with this one owner; contacts do not each become a duplicate user with the same primary key. Old sessions without a phone identity must sign in again.

Run `npm run db:migrate` before enabling the new login. `npm run db:setup-owner` is a one-time, explicit reassignment of all current documents to the requested initial owner; do not run it after multiple users start uploading private files. Normal migrations never assign unowned legacy files automatically.

PDF, DOCX, TXT, MD, CSV, and XLSX files up to 2 MB each can be uploaded in bulk. Uploaded files are stored intact and downloaded as attachments; no AI extraction is performed yet.

All live document uploads and original contact-import spreadsheets store their bytes in a **private S3-compatible bucket**. Postgres stores file metadata, ownership, and structured contact records. Missing bucket settings reject uploads; there is no database-byte fallback. Provision a private bucket and set `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY` from its credentials. The backend writes file bytes to that bucket and metadata to Postgres. Contact imports save the original spreadsheet and contact records together; a failed database transaction cleans up the newly uploaded object. Existing Postgres-backed files remain downloadable. Run `npm run files:migrate` after configuring the bucket to move existing files: it verifies downloaded S3 bytes before removing database bytes. Keep access credentials valid for the bucket and branch where each file lives; do not point a production database at a preview bucket.

Document downloads require an organizer session. Database and object storage credentials never enter the browser. Upload limits keep requests within ordinary Vercel request payload limits. For large decks and archives, add direct signed uploads rather than raising this endpoint's limit.

## Imports and charts

Each live contact import archives its original CSV/XLSX in the private bucket. It appears in Documents as well as producing structured contact records. Demo imports preserve originals in browser IndexedDB.

CSV and XLSX imports support column mapping, a validation preview, and at most 500 sponsors per file. Matching company and contact address/name records are skipped, including duplicates within a file. Invalid rows are listed and excluded; fix them in the source spreadsheet and reimport. XLSX reads the first worksheet and formula results without evaluating formulas.

`company` is required. Optional fields: `contact,address,channel,stage,amount,received,owner,notes,nextAction,nextDate,source,fit,category`. Channels: `email,imessage,linkedin`. Stages: `Identified,Qualified,Contacted,Replied,Negotiating,Committed,Declined`. Old agent statuses `ready` and `contract_review` map to `Qualified` and `Negotiating`.

Sankey widths represent sponsor counts. The three columns show actual outreach channels, the total sponsor pool, and current stages. This is a current distribution, not historical conversion rates. Full stage changes, including backward moves, remain in each sponsor's relationship history. Committed dollars include only sponsors currently at Committed; received funds and all proposed amounts are separate totals.

## Spectrum integration contract

The website exposes the backend interface but does **not** automatically connect the existing SQLite-based Spectrum worker. Your messaging partner can wire the following operations into that worker while preserving exact-draft approval and send-result checks.

Set a random `AGENT_API_TOKEN` (32+ characters) in the website's server environment. Call with `Authorization: Bearer <token>` from the worker only:

```http
GET /api/workspace
```

Returns `{ mode, event, users, sponsors, activities, documents }`. Each sponsor has a stable `id`. Fetch the current record before updates. The POC uses whole-record updates; coordinate one worker and organizer to avoid concurrent edits overwriting fields.

### Phone identity

`ambassador_users.phone_number` is the user primary key. Store an international E.164 number, including `+` and country code; spaces, parentheses, dots, and hyphens are normalized. No country code is guessed. Email, name, and a JSON `details` object belong to that phone identity. Email is optional and is not the primary key. Numbers are format-validated, not ownership-verified; this profile does not grant access or replace workspace authentication.

`ambassador_user_companies` links phone numbers to existing sponsor/company IDs. A user can belong to several companies, and a company can have several users. Existing sponsor records stay intact; email-only leads do not need a fabricated phone number. Use the authenticated workspace API from Spectrum to create or update a complete profile:

```json
{
  "action": "user",
  "user": {
    "phoneNumber": "+15551234567",
    "name": "Alex Morgan",
    "email": "alex@example.com",
    "details": { "role": "Organizer", "notes": "Prefers iMessage" },
    "companyIds": ["existing-sponsor-id"]
  }
}
```

Send to `POST /api/workspace`. Reusing a phone number updates the same user; it does not create a second identity. Updates replace the profile and its company links together in one transaction. An unknown company ID rejects the entire update. Supply the full `companyIds` list each time; an empty or omitted list clears associations. Run `npm run db:migrate` before using this API. The dashboard currently manages sponsors; user profiles are available through the API for the messaging worker.

```json
{
  "action": "sponsor",
  "id": "existing-sponsor-id",
  "sponsor": {
    "company": "Example Partner",
    "contact": "Alex Morgan",
    "address": "alex@example.com",
    "channel": "email",
    "stage": "Contacted",
    "amount": 1000,
    "received": 0,
    "owner": "Organizer",
    "notes": "Retain the existing relationship context.",
    "nextAction": "Follow up next week",
    "nextDate": "2026-10-10",
    "source": "https://example.com/partnerships",
    "fit": "Student developer community",
    "category": "Technology"
  }
}
```

Send that body to `POST /api/workspace`. Mark Contacted only after the provider accepts an organizer-approved message, never after a preview or draft. Reply handling can move to Replied; actual confirmed commitments can move to Committed. An update and its activity record are committed atomically. Bearer tokens are not accepted by document download endpoints.

Other supported POST bodies: `{ "action": "import", "sponsors": [...] }` and `{ "action": "event", "event": {...} }`. Import batches commit atomically; database uniqueness handles repeated company/contact imports. The dashboard refreshes every 30 seconds when visible, outside editing dialogs.

## Deploy to Vercel

Import this GitHub repository, select Next.js, and set **Root Directory** to `web`. Add the same server environment variables. Run migrations against the deployment's target database before opening the workspace. Keep previews on a separate Neon branch. No custom domain is needed for the first deployment. The long-running Spectrum loop should run separately from Vercel Functions.

## Verify

```powershell
npm test
npm run build
```

After adding Neon credentials and running migrations, `npm run db:check` verifies actual sponsor writes, stage history, duplicate protection, and document-byte persistence. It removes only its own uniquely named temporary records.

Tests cover CSV parsing, import mapping, duplicates, validation, file limits, Sankey conservation, financial totals, and signed sessions. Browser verification covers navigation and demo persistence. Live Neon/S3 verification requires account credentials.

This workspace's Neon Postgres connection has been verified with `db:check`: sponsor reads/writes, atomic stage history, duplicate handling, and stored document bytes passed. The optional S3 configuration remains unverified until bucket credentials are supplied.
