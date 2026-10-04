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
follow-ups, CSV/XLSX imports, and documents. Accounts use phone/password login
and invitation-based signup. Documents are private per account; campaign and
contact data currently form one shared workspace. New live uploads require
private S3 storage; existing Postgres-backed documents remain readable.

The agent receives direct iMessages, calls Hermes, and returns a “Review
message” card. Its sheet supports Approve, Reject, and Edit → Approve; the
original card can update to Approved or Rejected. Decisions currently print
responses rather than execute outreach. Closing the sheet remains manual.

`agent/listen.py` handles communication and service lifecycle.
`agent/get_response.py` holds agent logic and instructs Hermes to use a context
directory. `agent/fetch_context.py` is a no-op. `agent/send_email.py` registers
a Hermes tool that accepts email fields and attachment paths but returns
`not_sent`; it does not fetch credentials, read attachments, or send email.

The website and agent are not connected end to end. Phone ownership is not
verified. S3 connectivity and production hosting remain unverified according
to component documentation. Historical test results are not evidence that
later edits or live integrations work; run checks relevant to each change.

## Hermes setup for a fresh clone

Cloning Ambassador does not install Hermes. The current agent expects a
separate Hermes installation at `~/.hermes/hermes-agent`, a configured model
provider, and Photon SDK dependencies in that installation's sidecar directory.
It currently relies on this installation layout rather than a portable,
version-pinned dependency setup.

The root `requirements.txt` pins the Hermes Python package to revision
`158fd638da1629c8e62caf9ade1515d162def8ab`; installing it pulls Hermes's
declared Python dependencies. Ambassador's other Python imports are standard
library or local modules. The pip manifest does not configure Hermes or install
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

- [ ] **Email account connection:** Add OAuth onboarding, connection status,
  disconnect/reconnect, and secure storage of each user's email tokens.
- [ ] **Agent context API:** Provide authenticated access to the requesting
  user's profile, campaign context, contacts, and document downloads. The
  existing agent token does not grant access to private browser document routes.
- [ ] **Phone verification:** Verify phone ownership and link that identity to
  the connected email account.
- [ ] **Workspace permissions:** Define access and mutation permissions for
  shared campaigns and contacts. Add tenant isolation if accounts require
  separate workspaces.
- [ ] **Outreach records:** Persist structured drafts, revisions, approvals,
  send attempts, provider results, and received replies.
- [ ] **Storage verification:** Configure the expected `S3_*` variables,
  verify uploads/downloads, and migrate existing Postgres file bytes if needed.
- [ ] **Deployment:** Deploy the website, configure production secrets, run
  migrations, and verify authentication, imports, and document access.

## Agent work remaining (`agent/`)

- [ ] **Context fetching:** Implement `fetch_context(phone_number)` to
  authenticate to the website, retrieve the user's authorized context, and
  download their files into an isolated context directory. The eventual
  refresh must replace that user's context without affecting another user.
- [ ] **Document extraction:** Convert supported documents into readable
  context for Hermes while preserving originals for attachments.
- [ ] **Structured email proposals:** Capture recipient, subject, body,
  CC/BCC, and attachment references as a saved draft rather than relying on
  Hermes's final text.
- [ ] **Review and execution:** Display the exact email fields in the widget.
  Edits create a new draft revision; approval authorizes that revision;
  rejection blocks it.
- [ ] **Email sending:** Implement `send_email()` to resolve the user's
  connected account, refresh tokens, load authorized attachments, compose
  the message, and call the email provider. The current tool is a stub;
  replacing it with immediate sending during draft generation would bypass
  the intended approval flow.
- [ ] **Duplicate prevention and recovery:** Persist processing state,
  deduplicate approvals, and reconcile uncertain provider attempts before
  retrying.
- [ ] **Workspace write-back:** Record provider acceptance and update contact
  activity/status in the website. Distinguish acceptance from delivery.
- [ ] **Reply handling:** Retrieve email replies, associate them with
  contacts, and prepare follow-ups for review.
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
