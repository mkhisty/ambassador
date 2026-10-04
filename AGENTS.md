# Ambassador — project overview and completion roadmap

Updated October 4, 2026. This file applies to the entire repository. Follow
component-specific instructions as well, especially `web/AGENTS.md` for the
Next.js application. Keep this roadmap current as work is implemented and verified.

## Product and architecture

Ambassador is a campaign planning and outreach platform. The website manages
campaigns, contacts, relationship context, follow-ups, and private documents.
Photon iMessage is the conversation interface: Hermes prepares responses and
email proposals, and users review them before actions execute.

- `web/`: Next.js workspace, Neon Postgres persistence, account authentication,
  document ownership, and private S3-compatible storage.
- `agent/`: Python Hermes response logic, Photon communication through a Node
  sidecar, and hosted review widgets.

The intended completed flow is: user data → agent context → structured draft →
user review → approved action → provider result → workspace update.

## Current implementation

The website has campaign settings, contact management, pipeline charts,
follow-ups, CSV/XLSX imports, documents, Google OAuth account linking, Gmail
draft creation, and explicit Calendar event creation. Accounts use
phone/password login and invitation-based signup. Documents are private per
account; campaign and contact data currently form one shared workspace. New
live uploads require private S3 storage; existing Postgres-backed documents
remain readable.

The Photon sidecar acknowledges incoming messages with a thumbs-up tapback before
queueing them for Hermes; reactions and read receipts are excluded. Failed tapbacks
are logged without stopping message processing.

The agent receives direct iMessages and sends Hermes's conversational replies
as plain text without approval. The `send_email` tool dispatches a separate
widget containing exact email fields; approving or editing and approving sends
through the connected Gmail account, while rejection sends nothing. The actual
outcome resumes Hermes's conversation and produces a plain-text follow-up.
Calendar actions retain their dedicated approval card. Generic message-review
scheduling is removed; existing generic cards cannot send through this listener.
Reviews and pending email outcome notifications persist across restarts.
Email recipients need not be saved or linked contacts. Hermes can use the user's
provided recipient details and factual updates directly; contact association is
optional bookkeeping, while attachment access remains owner-scoped.
Conversation history is currently retained only in memory. Closing the sheet
remains manual.

Gmail inbox notifications use Cloud Pub/Sub in `password-313816`. A Google-OIDC-
authenticated webhook coalesces mailbox history notifications into Neon state;
the Python listener drains a durable owner-scoped inbox queue every 15 seconds.
It registers/renews watches daily and reconciles history after 10 quiet minutes.
Initial registration processes future arrivals; expired history recovers inbox
messages since monitoring began with persisted paging. Sent mail and label-only
changes never generate drafts. New emails are relevant by default unless there
is an explicit reason otherwise; mail requiring a response produces an email
approval card. Approved replies retain Gmail threading, including attachments.
Google read scope requires reconnection. A Vercel automation token permits Google
and the worker to reach the chosen protected deployment URL; it is never passed
to Hermes or storage. Runtime `GMAIL_INBOX_ENABLED=0` disables inbox work.

Email proposals support a shared subject/body template and up to 20 recipients,
each with parameter values. `[FIELD]` names are case-insensitive; missing values
block the proposal. The widget highlights fields, displays the shared template
and recipient values, and allows editing before approval. Approved batches send
separate personalized emails through the existing website routes, with one
persisted child review ID per recipient. Sending stops on failure and reports
partial outcomes without automatic retry. `agent/email_templates.py` validates
and expands templates; `agent/test_email_templates.py` covers batch approval,
edits, escaping, failures, and restart protection. No database migration is needed.
Email previews show the body once, first, with recipient values below it for
batches. Successful sends use brief user-facing confirmations without provider
terminology or routine delivery caveats; failures, partial sends, and uncertain
outcomes still explain what needs attention.
Email approval HTTP requests persist the reviewed decision and return 202 before
provider sending. The widget immediately shows Approved/Done, and background
workers send and notify Hermes afterward. Queued, unstarted sends resume on
listener startup; interrupted in-flight sends remain uncertain and are not
automatically retried. Native sheet dismissal remains manual.
The email tool also accepts original context document paths, resolving them
through the bound owner's `workspace.json` to stored document IDs. Previews show
filenames with private review-scoped download links; emails include real MIME
attachments. Outside paths, unlisted/generated files, and changed local copies
are rejected. Both draft and send endpoints check attachment ownership and total
size, with up to 20 documents, a 25,000,000-byte attachment cap, and a 35 MiB
encoded MIME cap. Workspace uploads have no application per-file size cap and use private signed bucket transfers.

For diagnostic logging, run `python3 listen.py --verbose` from `agent/` or set
`AMBASSADOR_VERBOSE=1`. The worker logs redacted stages and requests sanitized
Google/Gmail errors from authenticated website endpoints. Server-wide diagnostics
use the same environment flag. Mode changes do not retry failed or uncertain sends.

`agent/listen.py` handles communication and service lifecycle.
`agent/get_response.py` holds agent logic and instructs Hermes to use a context
directory. `agent/fetch_context.py` downloads every owned document through the
authenticated website API, plus profile/campaign/linked-contact context. Each
normalized phone has its own hashed directory; complete snapshots publish
atomically and replace only that user's previous files. Failed refreshes stop
drafting and preserve the last complete snapshot. Hermes runs in the new
snapshot directory. `agent/send_email.py` registers a tool accepting email
fields and owned document IDs. It dispatches approval through a trusted Python
callback and initially returns `awaiting_user_approval`. Google credentials,
attachment checks, composition, and sending stay on the website. Tool-thread
callbacks capture proposals independently of ContextVar mutations, which do not
flow back to Hermes's parent thread. Outcome-only turns have no tools.

The website-to-agent context path is connected. Hermes can check Google
Calendar free/busy through the worker API and prepare an event proposal; the
Photon review card creates an opaque primary-calendar event only after explicit
approval. Both the website and agent can submit reviewed emails through Gmail;
normal Hermes replies never authorize sending. Google OAuth and Neon token storage are in place; the developer
has switched to an External testing audience and connected a test account.
Existing connections must reconnect once to grant the added free/busy scope.
Live Photon-to-Google end-to-end delivery still needs verification. Phone
ownership is not verified. S3 connectivity and production hosting remain
unverified. Historical test results are not evidence that later edits or live
integrations work; run checks relevant to each change.

## Hermes setup for a fresh clone

Cloning Ambassador does not install Hermes. The current agent expects a
separate Hermes installation at `~/.hermes/hermes-agent`, a configured model
provider, and Photon SDK dependencies in that installation's sidecar directory.
It currently relies on this installation layout rather than a portable,
version-pinned dependency setup.

The root `requirements.txt` pins the Hermes Python package to revision
`158fd638da1629c8e62caf9ade1515d162def8ab`; installing it pulls Hermes's
declared Python dependencies. `python-dotenv` is also pinned for local configuration;
other Python imports are standard library or local modules. The pip manifest does not configure Hermes or install
Photon's Node dependencies. The existing external installation path remains
required by the listener; a fresh-clone bootstrap is still unfinished.

For a developer on Linux, macOS, or WSL, install Hermes and configure their
own model provider and Photon account:

```sh
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
hermes setup
hermes photon setup
hermes photon install-sidecar
```

See the official [Hermes installation guide](https://hermes-agent.nousresearch.com/docs/getting-started/installation)
and [Photon setup guide](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/photon).
These commands are manual prerequisites, not an Ambassador setup script.

Start the website with its database configured, using `npm run dev` in `web/`.
Create an account with the phone that will message the agent. Copy
`agent/.env.example` to `agent/.env.local`; set the widget URL and, for a remote
website, its HTTPS origin and matching `AGENT_API_TOKEN`. Locally the website
origin defaults to port 3000 and the token can be read from `web/.env.local`.
Context never contains database credentials or the agent token.

From the cloned repository, start a tunnel for the review widget:

```sh
cd agent
ngrok http 8792
```

In another terminal, also from the cloned repository, start the listener with
the HTTPS forwarding URL printed by ngrok:

```sh
cd agent
WIDGET_PUBLIC_URL=https://THEIR-NGROK-URL python3 listen.py
```

The custom `send_email` tool registers automatically when the listener loads
Hermes. Each developer supplies their own credentials; credentials are not
included in the clone.

For hosted Ambassador users, Hermes runs on our worker server. End users do
not install Hermes: they sign into the website and message the agent. The
embedded review widget still depends on the recipient's Spectrum iMessage
extension, with a browser-link fallback.

Remaining work to make developer setup reliably clone-and-run:

- [ ] Add an Ambassador setup script and a complete fresh-clone walkthrough.
- [ ] Verify fresh-clone installation of the pinned Hermes revision and pin
  a compatible Photon SDK version in Ambassador's own dependency setup.
- [ ] Make Hermes installation and SDK paths configurable instead of assuming
  one home-directory layout.
- [ ] Add dependency/configuration checks with actionable startup errors.

## Website work remaining (`web/`)

- [x] **Google account connection:** OAuth onboarding, connection status,
  disconnect/reconnect, and encrypted per-phone refresh-token storage. Google
  app audience configuration and first user consent remain external steps.
- [x] **Agent context API:** Separate token-authenticated routes expose the
  selected phone's profile, shared campaign, linked contacts/activity, and
  owned document downloads. Browser document routes still require a phone session.
- [ ] **Phone verification:** Verify phone ownership and link that identity to
  the connected email account.
- [ ] **Workspace permissions:** Define access and mutation permissions for
  shared campaigns and contacts. Add tenant isolation if accounts require
  separate workspaces.
- [ ] **Outreach records:** Basic per-contact drafts and Gmail draft IDs persist;
  revisions, approval decisions, send attempts, provider results, and received
  replies still need a complete lifecycle.
- [ ] **Storage verification:** Configure the expected `S3_*` variables,
  verify uploads/downloads, and migrate existing Postgres file bytes if needed.
- [ ] **Deployment:** Deploy the website, configure production secrets, run
  migrations, and verify authentication, imports, and document access.

## Agent work remaining (`agent/`)

- [x] **Context fetching:** `fetch_context(phone_number)` retrieves owned files
  into isolated snapshots and refreshes only that account. A failed fetch never
  starts Hermes using stale files. The implementation supports one serial worker
  per context root; concurrent workers need locking before sharing a root.
- [ ] **Document extraction:** Convert supported documents into readable
  context for Hermes while preserving originals for attachments.
- [x] **Structured email proposals:** The email tool captures exact fields and
  owned attachment references, persists a draft, and dispatches its own widget.
  Normal Hermes text is delivered directly and never treated as an email draft.
- [ ] **Review and execution:** Exact email fields are reviewed and approved
  edits are sent; rejection blocks sending. Immutable draft revision history and
  stronger approval identity verification remain unfinished.
- [x] **Email sending:** The website resolves connected Google credentials,
  refreshes access, checks owned attachments, composes MIME, and submits Gmail
  sends after widget approval. Hermes receives acceptance/rejection/failure or
  uncertainty as a later conversation turn. Live end-to-end verification remains
  required; model/tool generation itself never sends the email.
- [x] **Agent Calendar actions:** Check free/busy without revealing event details;
  prepare an event proposal and create an opaque calendar hold only after the
  user approves it in the Photon review card. Reconnect Google for the added
  free/busy scope; live end-to-end delivery remains unverified.
- [ ] **Agent Gmail drafts:** Expose connected Gmail draft creation to Hermes
  through an explicit review action.
- [ ] **Duplicate prevention and recovery:** Persist processing state,
  deduplicate approvals, and reconcile uncertain provider attempts before
  retrying.
- [ ] **Workspace write-back:** Record provider acceptance and update contact
  activity/status in the website. Distinguish acceptance from delivery.
- [ ] **Reply handling:** Gmail inbox retrieval and follow-up approval are
  implemented; contact stage/activity association and live verification remain.
- [ ] **Worker deployment:** Host the long-running listener and widget server
  with stable HTTPS, restart recovery, and operational logs.

## Integration checks

- [ ] Verify user identity and ownership throughout context retrieval,
  approval, attachment access, and sending. The current bearer-link widget
  is a demo approval mechanism, not verified user authentication.
- [ ] Verify the complete flow: connect email → upload context → request a
  draft over iMessage → edit/approve → send → record the result.
- [ ] Verify rejection, expired drafts, repeated clicks, restarts, revoked
  credentials, and uncertain sends.

Keep credentials out of context files, model prompts, browser responses,
source code, and logs. Bind credential ownership using trusted backend user
identity rather than a model-selected account. Preserve existing database
names and API contracts unless a coordinated migration changes them.

## First completion milestone

One verified user, one connected email account, one private document, and
one approved email sent and recorded end to end. Complete and verify this
path before treating the platform as operational outreach automation.
