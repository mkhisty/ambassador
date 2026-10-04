<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Ambassador website — current implementation

Updated October 4, 2026. This file applies to the `web/` application. Preserve the generated Next.js instructions above and update this implementation summary when behavior changes.

## Product and terminology

Ambassador is a general-purpose outreach campaign planning platform. Use campaigns, contacts, audiences, outreach, responses, follow-ups, and outcomes in the interface. Party invitations, weddings, recruiting, startup go-to-market work, and political campaigns are possible use cases. The sample data demonstrates hackathon outreach; sponsorship is not the product's navigation or core metric model.

The website handles campaign overview, contact management, bulk imports, relationship context, follow-up planning, private document uploads, Google account linking, Gmail draft creation, and explicit Calendar event creation. Photon Spectrum/iMessage remains the intended daily conversation interface. The worker can submit reviewed Gmail and Calendar actions; normal Hermes replies are delivered directly as text.

## Stack and files

- Next.js 16 App Router, React 19, JavaScript modules; Node.js 24+.
- `app/workspace.js`: client interface, account forms, overview, contacts, documents, imports, and campaign settings.
- `app/sankey.js`: D3 Sankey showing current contact distribution by channel and stage.
- `lib/model.mjs`: validation, display stage labels, contact totals, and Sankey data.
- `lib/db.mjs`: Neon reads and transactional workspace mutations.
- `lib/auth.mjs`: phone normalization, password hashing, signed sessions, and authorization.
- `lib/documents.mjs`: owner-filtered document lookup.
- `lib/agent-context.mjs`: worker context API, profile/contact scoping and owned downloads.
- `lib/diagnostics.mjs`: opt-in, redacted stage/provider diagnostics for Google email failures.
- `lib/files.mjs`: upload validation and private S3-compatible storage adapter.
- `db/schema.sql`: additive, idempotent schema setup; `scripts/migrate.mjs` applies it transactionally using the direct Neon endpoint.
- `lib/demo.mjs`: canonical fictional sample; `scripts/export-demo.mjs` generates CSV, messaging fixtures, and root `STRATEGY.md`.
- `README.md`, `PRODUCT.md`, and `DESIGN.md`: setup, product context, and visual direction.

## Implemented interface

- Sign-in and sidebar branding use `assets/logo.png` through a static Next.js image import; the same asset supplies browser and Apple touch icons.
- Navigation: Overview, Contacts, Documents, Imports, Campaign settings.
- Overview counts contacts, responses, completed outcomes, and overdue follow-ups. Optional targets count outcomes, not dollars.
- Overview shows a daily summary of recorded contact activity with a direct link to the Sankey pipeline.
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
- `ambassador_google_oauth_states`: hashed, one-time OAuth state bound to a phone account with a short expiry.
- `ambassador_google_connections`: one Google identity per phone account; refresh tokens are AES-256-GCM encrypted with `GOOGLE_TOKEN_ENCRYPTION_KEY`.
- `ambassador_outreach_drafts`: owner-scoped email drafts with optional contact association and Gmail IDs. Recipients need not be saved or linked. Widget reviews have an owner/review ID uniqueness constraint; browser drafts allow one open draft per contact/account.

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
- `POST /api/documents/upload`: authenticated prepare/complete JSON API. Browser PUTs directly to a short-lived signed staging key; completion verifies size and MIME, copies to a saved key, then commits owner-scoped metadata and optional imported contacts. Bucket CORS must allow the website origin (`npm run files:cors -- <origins>`); `npm run db:migrate-document-size` removes the old database constraint. S3-backed browser and worker downloads use signed private URLs, never forwarding worker bearer credentials to storage. The worker retains a 256 MiB total context budget.
- `POST /api/imports`: authenticated multipart `file` (CSV/XLSX) and `sponsors` (JSON contact list). Original bytes go to S3; contacts, history, and document metadata commit together in Postgres. The original appears in Documents. Missing bucket configuration returns 503.
- `GET /api/documents/[id]`: private attachment download after owner lookup.
- `AGENT_API_TOKEN` enables privileged server-to-server workspace access. It does not grant access to the private browser document endpoints. Without a phone session, workspace responses contain no user documents.
- `GET /api/agent/context?phoneNumber=...`: worker bearer token required; returns the selected phone's profile, shared campaign, linked contacts/activity, and owned document metadata. Unknown profiles return 404. Authentication data and other user profiles are excluded.
- `GET /api/agent/context/documents/[id]?phoneNumber=...`: the same worker authentication and SQL owner lookup precede either Postgres or S3 byte reads. Unknown/foreign IDs return 404. All context responses use private, no-store caching.
- Google OAuth is signed-in-user-only. `POST /api/google/connect` starts authorization; `/api/google/callback` consumes one-time state and saves an encrypted refresh token. `GET /api/google/status` returns connection metadata; `DELETE /api/google/connection` revokes and removes the local token.
- `POST /api/google/gmail/drafts` creates or updates a Gmail draft from reviewed fields and stores its Gmail ID. It never sends email.
- `POST /api/agent/google/gmail/drafts` saves an exact-fields email proposal for widget approval. Any valid user-supplied recipient is allowed. Contact association is optional and only resolves against the owner's linked contacts; stale/foreign hints do not block email or grant access. Attachments must still belong to the owner.
- The worker supports up to 20 recipients per template approval. It saves and submits a separate personalized draft through these existing routes for each recipient, with distinct child review IDs. Template/parameter review data stays in persisted worker reviews; no batch schema change is required. Partial failures stop remaining sends and are reported per recipient.
- Attachment selection supports original context paths on the worker, resolving to owner-scoped document IDs. Draft saving returns authoritative attachment names/MIME/sizes for review download links. The send endpoint attaches stored bytes using Gmail's MIME media-upload endpoint. `lib/email-attachments.mjs` checks a 25,000,000-byte combined attachment limit, 35 MiB encoded MIME limit, at most 20 attachments, and safe filename/MIME headers. Workspace uploads use signed direct bucket transfers without an application per-file size cap. Review links proxy the existing owner-filtered context download API through the worker without exposing credentials or public object URLs.
- `POST /api/agent/google/gmail/send` submits the reviewed email through connected Gmail after widget approval and records acceptance or uncertainty. A missing contact association does not block sending. Google credentials remain server-side.
- Both Gmail send routes explicitly cast the activity's actor parameter to text inside `jsonb_build_object`; otherwise Postgres raises `42P18` after Gmail accepts the email. Earlier reviews affected by this failure retain their uncertain status and must not be resent automatically.
- `AMBASSADOR_VERBOSE=1` enables server diagnostics. Authenticated worker requests may also supply `x-ambassador-verbose: 1`; unauthenticated requests cannot enable provider diagnostics. Debug Gmail responses include sanitized stage, provider HTTP status/message/reasons, and OAuth refresh errors for the worker terminal. Never log complete OAuth responses, authorization headers, raw MIME, email bodies, or widget bearer links. Logs correlate hashed review/account IDs.
- `POST /api/google/calendar/events` creates an event on the connected account's primary calendar after an explicit organizer action.
- OAuth requests `gmail.compose`, `gmail.send`, `calendar.events.freebusy`, and `calendar.events.owned`. Google Cloud must enable Gmail API and Calendar API. Personal accounts require an External audience and, in Testing, must be added as test users. Reconnect after new scopes are added.
- `POST /api/agent/google/calendar/freebusy` checks the selected phone owner's primary calendar and returns busy intervals only. `POST /api/agent/google/calendar/events` creates an opaque event using an approval ID for safe retries. Both require the server-only agent bearer token and a phone number supplied by the worker's trusted Photon sender context.
- Photon schedule requests can check availability and prepare a proposal. The hosted review card displays event details; only its explicit **Add to Calendar** action creates the event. This flow is implemented but still needs live Photon-to-Google end-to-end verification.
- The worker token is privileged to select any profile; only the trusted listener supplies the incoming sender identity. Never expose that token in widgets or browser code. Phone ownership remains unverified.
- `agent/fetch_context.py` refreshes local snapshots before Hermes responds. User-supplied contacts and factual updates can be used directly without saving a contact first. Email/Calendar tools require review approval; email outcomes are passed back to Hermes for a natural follow-up. Sent emails and iMessage activity are recorded; full outreach lifecycle reconciliation remains unfinished.

## Files, environment, and demo

Supported uploads: PDF, DOCX, TXT, MD, CSV, XLSX; nonempty files without an application per-file size cap. Uploads are stored intact; no AI parsing, document extraction, or indexing runs automatically.

All live uploads, including original CSV/XLSX contact imports, require a private S3-compatible bucket configured with `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY` (legacy `S3_*` names also work). Set `AWS_S3_BUCKET` when multiple buckets exist; a single bucket is selected automatically. There is no Postgres-byte fallback for uploads. These can be Neon Object Storage credentials; an AWS account is not required. Existing Postgres files remain readable. `npm run files:migrate` copies them to S3, verifies downloaded bytes, then replaces database bytes with object keys; it refuses unowned files. Object keys include owner and document ID; secrets stay server-side. Bucket connectivity has not been verified in this workspace yet.

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
- `npm run db:migrate-email-recipients`: scoped, idempotent migration making the email draft contact association nullable. It validates the change on a temporary copy of the existing table first. Normal `db:migrate` also includes this change. Applied to this workspace on October 4, 2026.

Last verified: 11 unit tests, live Neon ownership/persistence checks, live signup/document API checks, and production build. Run checks relevant to the change; do not assume prior results apply to later edits.

Vercel deployment uses repository root directory `web`. Hosting/domain setup is not completed here. The Spectrum worker needs a separate long-running host. Keep UI restrained: neutral surfaces, clear labels, broad Sankey ribbons, selective outcome colors, accessible controls, and responsive navigation.
