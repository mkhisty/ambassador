<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Ambassador website — current implementation

Updated October 4, 2026. This file applies to the `web/` application. Preserve the generated Next.js instructions above and update this implementation summary when behavior changes.

## Product and terminology

Ambassador is a general-purpose outreach campaign planning platform. Use campaigns, contacts, audiences, outreach, responses, follow-ups, and outcomes in the interface. Party invitations, weddings, recruiting, startup go-to-market work, and political campaigns are possible use cases. The sample data demonstrates hackathon outreach; sponsorship is not the product's navigation or core metric model.

The website handles campaign overview, contact management, bulk imports, relationship context, follow-up planning, and private document uploads. Photon Spectrum/iMessage is the intended daily conversation interface. Do not claim this website sends messages, runs negotiations, or creates calendar entries: those integrations are not active here.

## Stack and files

- Next.js 16 App Router, React 19, JavaScript modules; Node.js 24+.
- `app/workspace.js`: client interface, account forms, overview, contacts, documents, imports, and campaign settings.
- `app/sankey.js`: D3 Sankey showing current contact distribution by channel and stage.
- `lib/model.mjs`: validation, display stage labels, contact totals, and Sankey data.
- `lib/db.mjs`: Neon reads and transactional workspace mutations.
- `lib/auth.mjs`: phone normalization, password hashing, signed sessions, and authorization.
- `lib/documents.mjs`: owner-filtered document lookup.
- `lib/agent-context.mjs`: worker context API, profile/contact scoping and owned downloads.
- `lib/files.mjs`: upload validation and private S3-compatible storage adapter.
- `db/schema.sql`: additive, idempotent schema setup; `scripts/migrate.mjs` applies it transactionally using the direct Neon endpoint.
- `lib/demo.mjs`: canonical fictional sample; `scripts/export-demo.mjs` generates CSV, messaging fixtures, and root `STRATEGY.md`.
- `README.md`, `PRODUCT.md`, and `DESIGN.md`: setup, product context, and visual direction.

## Implemented interface

- Sign-in and sidebar branding use `assets/logo.png` through a static Next.js image import; the same asset supplies browser and Apple touch icons.
- Navigation: Overview, Contacts, Documents, Imports, Campaign settings.
- Overview counts contacts, responses, completed outcomes, and overdue follow-ups. Optional targets count outcomes, not dollars.
- Sankey widths count contacts. It shows a current snapshot, not historical conversion rates. Stage history remains separate.
- Contact editor supports a name or organization, address, channel, category, owner, notes, reason for outreach, next action/date, and activity history. Organization is optional.
- Visible stages: Identified, Ready, Contacted, Replied, Follow-up, Completed, Declined.
- Campaign settings include name, deadline, optional context/location, audience description, objective, outreach guidelines, and optional outcome target.
- CSV/XLSX import supports column mapping, validation preview, duplicate skipping, and at most 500 contacts per file. XLSX uses the first sheet and cached formula results. Contact exports omit financial fields.
- The live workspace refreshes every 30 seconds when visible and not editing a contact/import dialog.

## Database and compatibility

The database retains earlier naming for compatibility. Do not rename tables, API fields, or stored stages without a migration and coordination with the messaging worker.

- `ambassador_event`: one shared campaign, fixed ID `main`, JSON settings.
- `ambassador_sponsors`: contact/outreach records, unique duplicate key, JSON context, update timestamp.
- `ambassador_users`: phone-number primary key, name, email, JSON details.
- `ambassador_user_auth`: phone foreign key and salted scrypt password hash; hashes never enter client responses.
- `ambassador_user_companies`: many-to-many profile/contact-account associations.
- `ambassador_activities`: contact stage/note history with timestamps.
- `ambassador_documents`: UUID, filename/type/size, optional contact link, owner phone foreign key, and either Postgres bytes or an object key. Owner/time lookup is indexed.

Existing API fields are `event`, `sponsors`, and `sponsorId`. Stored stages remain Qualified, Negotiating, and Committed where the UI displays Ready, Follow-up, and Completed. Earlier financial fields are retained in legacy records but are not campaign controls or metrics. Contact/campaign data is currently shared among workspace accounts; only documents are private per account. This is not a multi-campaign or fully tenant-isolated application.

## Accounts and document ownership

- Phone is required for signup and login. Ten-digit US numbers normalize to `+1`; international numbers require `+` and country code. Phone ownership is not SMS-verified.
- Each account has its own password. Signup additionally requires `WORKSPACE_INVITE_PASSWORD`, separate from personal account passwords.
- HTTP-only, SameSite Strict cookies carry an HMAC-signed phone identity and expire after one day. Cookies are Secure in production. Mutations require same-origin requests.
- Old sessions without phone identity must sign in again.
- Upload ownership comes exclusively from the authenticated session; never accept a submitted phone as authorization or as the upload owner.
- Listings and downloads filter by owner. A requested different phone returns 403; another owner's or unknown document ID returns 404.
- One private bucket can hold files for all users. Database ownership checks enforce access; an object-key prefix alone is not access control.
- Legacy unowned documents are excluded from ordinary owner listings until explicitly assigned.
- The requested initial owner is `+17344199492`; existing documents were explicitly assigned to that account. Fictional demo user profiles were consolidated into one owner with 26 contact associations. Do not confuse outreach contacts with login accounts.
- Never put passwords, invitation secrets, session keys, database URLs, or bucket credentials in this file, source code, screenshots, or logs.

## API behavior

- `GET/POST/DELETE /api/session`: session status, phone/password login or invited signup, and logout.
- `GET /api/workspace`: shared campaign/contact context plus documents filtered to the session owner.
- `POST /api/workspace`: `event`, `import`, `sponsor`, and `user` mutations. Import batches and profile/link replacements are transactional; contact updates and stage history are atomic.
- `GET /api/documents`: signed-in user's document metadata. Optional `?phoneNumber=7344199492` is normalized and must match the session owner. Knowing a phone number alone never grants access.
- `POST /api/documents`: multipart upload with `file` and optional `sponsorId`; server assigns document UUID and owner. Live file bytes require private S3 storage.
- `POST /api/imports`: authenticated multipart `file` (CSV/XLSX) and `sponsors` (JSON contact list). Original bytes go to S3; contacts, history, and document metadata commit together in Postgres. The original appears in Documents. Missing bucket configuration returns 503.
- `GET /api/documents/[id]`: private attachment download after owner lookup.
- `AGENT_API_TOKEN` enables privileged server-to-server workspace access. It does not grant access to the private browser document endpoints. Without a phone session, workspace responses contain no user documents.
- `GET /api/agent/context?phoneNumber=...`: worker bearer token required; returns the selected phone's profile, shared campaign, linked contacts/activity, and owned document metadata. Unknown profiles return 404. Authentication data and other user profiles are excluded.
- `GET /api/agent/context/documents/[id]?phoneNumber=...`: the same worker authentication and SQL owner lookup precede either Postgres or S3 byte reads. Unknown/foreign IDs return 404. All context responses use private, no-store caching.
- The worker token is privileged to select any profile; only the trusted listener supplies the incoming sender identity. Never expose that token in widgets or browser code. Phone ownership remains unverified.
- `agent/fetch_context.py` refreshes local snapshots through these read-only routes before Hermes drafts. Decisions still only log; live outreach and workspace write-back are unfinished.

## Files, environment, and demo

Supported uploads: PDF, DOCX, TXT, MD, CSV, XLSX; 1 byte through 2 MB per file. Uploads are stored intact; no AI parsing, document extraction, or indexing runs automatically.

All live uploads, including original CSV/XLSX contact imports, require a private S3-compatible bucket configured with `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY`. There is no Postgres-byte fallback for uploads. These can be Neon Object Storage credentials; an AWS account is not required. Existing Postgres files remain readable. `npm run files:migrate` copies them to S3, verifies downloaded bytes, then replaces database bytes with object keys; it refuses unowned files. Object keys include owner and document ID; secrets stay server-side. Bucket connectivity has not been verified in this workspace yet.

Use `.env.example` and `.env.bucket.example` as templates. Real values belong in ignored `.env.local`, then in the matching Vercel environment. Preserve existing environment values when adding configuration. `WORKSPACE_PASSWORD` remains required for initial account bootstrap/auth readiness; new-account invitations use the separate `WORKSPACE_INVITE_PASSWORD`.

Without `DATABASE_URL`, the website uses fictional browser data. With Neon configured, View demo opens browser samples and Live workspace returns to private persistence. Demo changes use localStorage (`ambassador-workspace-v2`); demo file bytes use IndexedDB. Samples are never copied into Neon automatically. There are 26 fictional outreach contacts across all seven stages and three channels. Never deliver messages to demo addresses.

## Running and checking changes

Run commands from `web/`:

```powershell
npm run dev
npm test
npm run build
npm run db:migrate
npm run db:check
npm run test:document-api
```

The dev server uses `http://127.0.0.1:3000`. `db:check` verifies live persistence and owner-filtered lookup with uniquely named temporary records. `test:document-api` requires the running server and current initial account password; it verifies signup/login, mandatory phone, ownership assignment, authenticated phone lookup, cross-owner denial, and file byte round trip using disposable records.

Additional commands:

- `npm run demo:export`: regenerate demo CSV, worker fixtures, and `STRATEGY.md` after changing the canonical sample.
- `npm run db:seed-demo`: explicitly add fictional records, associations, history, and documents; reruns preserve edits. Never run just to inspect a real workspace.
- `npm run db:setup-owner`: explicit bootstrap script that reassigns all existing documents to the initial owner. It has already run. Do not rerun after multiple users have uploaded private files; it is not a routine migration.

Last verified: 11 unit tests, live Neon ownership/persistence checks, live signup/document API checks, and production build. Run checks relevant to the change; do not assume prior results apply to later edits.

Vercel deployment uses repository root directory `web`. Hosting/domain setup is not completed here. The Spectrum worker needs a separate long-running host. Keep UI restrained: neutral surfaces, clear labels, broad Sankey ribbons, selective outcome colors, accessible controls, and responsive navigation.
