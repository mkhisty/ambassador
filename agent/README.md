# Ambassador response widget

Gmail inbox monitoring runs alongside iMessage when `GMAIL_INBOX_ENABLED=1`
(the default). The website saves authenticated Pub/Sub notifications; the worker
drains its durable inbox queue every 15 seconds and runs inbox turns under the
same Hermes lock as iMessages. New email is relevant unless explicitly unrelated;
messages needing a response produce an email approval widget. Approval sends
a threaded Gmail reply. No-response mail does not text the owner. Mailbox watches
renew daily, with history reconciliation after 10 quiet minutes. Initial watches
start with future arrivals. Reconnect Google for `gmail.readonly` first.
Protected Vercel URLs need `VERCEL_AUTOMATION_BYPASS_SECRET` in ignored
`agent/.env.local`; it is used only for website API requests, never Hermes or S3.
See `web/README.md` for cloud and database setup. Restart the listener after
configuration changes; queued inbox messages survive restarts in Neon.

`listen.py` receives a direct Photon iMessage and sends Hermes's natural reply
straight back as plain text. Ordinary replies never create an approval widget.
Incoming messages get a 👍 tapback immediately, including while Hermes is busy
with an earlier message. This acknowledgement does not send an extra text.
Reactions and read receipts are excluded to prevent reaction loops. If Photon
cannot add the tapback, the error is logged and message processing continues.
The `send_email` tool sends a separate Spectrum card containing the actual email
recipient, subject, body, CC/BCC, and attachment references. **Approve & Send**
or **Edit & Send** submits the reviewed fields through Gmail; **Reject** sends
nothing. The resulting acceptance, rejection, failure, or uncertainty is passed
back to Hermes, which replies naturally in the same owner's conversation.

Calendar proposals retain their dedicated **Add to Calendar** / **Reject** card.
Automatic generic iMessage follow-up review scheduling is removed. Previously
saved generic message cards are not recovered, and their approvals cannot send
outreach through the current listener. Close the sheet manually to return to the
conversation; no supported Spectrum dismissal bridge was verified.

`get_response.py` holds Hermes configuration, response generation, per-phone
conversation history, and email outcome handling. Tool callbacks capture action
proposals even when Hermes runs tools on worker threads. `listen.py` handles
messaging, widget callbacks, outcome delivery, and communication service lifecycle.
Conversation history is retained in memory until restart. Persisted email reviews
retain the original request and proposal so pending outcomes can still be reported
after restart. Hermes outcome turns have no tools, preventing another email or
action from being triggered by an approval notification.

For each incoming message, `get_response` passes the sender's phone number to
`fetch_context.fetch_context(phone_number)`. It authenticates to the website,
looks up that account, and downloads every owned document. `workspace.json`
includes the user's profile, shared campaign, linked contacts and activity,
and a document index with local filenames. Context lives in
`agent/context/<SHA-256 of normalized phone>/snapshot-*/`; `current` points to
the latest complete snapshot. Refresh replaces only that user's old files,
after every download succeeds. A failed refresh preserves the previous snapshot
and stops drafting instead of reusing stale context. One serial worker per
context root is supported.

`generate_response(text, context_directory)` runs Hermes with that snapshot as
its working directory and instructs it to inspect relevant files before preparing
the response for review. Original documents are preserved; automatic extraction
into plain text is not implemented. Context is ignored by Git.

`send_email.py` registers `send_email`, accepting `to`, `subject`, `text`, and
optional `attachment_refs`, `cc`, `bcc`, `reply_to`, and `contact_id`.
It also accepts `attachment_paths` for original context documents listed in
`workspace.json`; paths may be relative to the bound context directory or absolute
inside it. The tool resolves them to owned stored document IDs. It refuses paths
outside that directory, unlisted files, another user's documents, and changed
local copies. Generated files must be uploaded to the workspace before attaching.

For a personalized batch, omit `to` and pass `recipients` (1–20 entries), a shared
`subject`, and `text` template. Each entry contains `email` and `parameters`:

```json
{
  "subject": "Hello [NAME]",
  "text": "Hi [Name], would [COMPANY] like to join us?",
  "recipients": [
    {"email": "jamie@example.com", "parameters": {"NAME": "Jamie", "COMPANY": "Example"}},
    {"email": "alex@example.com", "parameters": {"NAME": "Alex", "COMPANY": "Another company"}}
  ]
}
```

The review shows the email text once, first, highlights `[FIELD]` placeholders in
purple, and lists each recipient's values below the template. Edit can change the template, addresses, and
parameters; recipient count and attachment references stay fixed. Field names
are case-insensitive identifiers such as `NAME` or `FIRST_NAME`; every field must
have a value for every recipient. Templates for one recipient use the same shape.
Approval sends a separate personalized email per recipient. Shared CC/BCC,
reply-to, and attachments apply to each email. Each child draft has its own
persisted review ID; sending stops at the first failure and reports per-recipient
acceptance/failure/uncertainty and remaining unsent recipients. Batches are not
automatically retried, including after restart.

Successful sends produce brief natural replies such as “Sent.” or “Sent to all
20 recipients.” Provider acknowledgment details and routine delivery caveats stay
out of replies. Explicit failures, partial sends, and uncertain outcomes still
explain the problem and any action needed.

Approval saves the reviewed fields and immediately returns an acknowledgment.
The widget shows **Approved** and **Done**, so the user can close the sheet while
email sending continues in the background. The original card updates to Approved
and Hermes reports the actual send outcome later. A queued send that has not
started resumes after listener restart; an interrupted in-flight send remains
uncertain and is never automatically retried. Sheet dismissal is still manual.

Any valid email address supplied by the user is allowed, including new recipients
who are not saved or linked contacts. Hermes also uses the user's supplied details
and factual updates directly. Omit `contact_id` when there is no matching saved
contact. The contact list supplies context rather than restricting recipients.

Attachment references sent to the website are owned document IDs. The review
displays filenames and private download links beside the email text. Downloads
use the review's expiring bearer link and the backend's owner checks; credentials
and S3 URLs are never exposed. Recipients receive the file bytes as ordinary email
attachments, including for every personalized email in a batch.

Up to 20 documents can be selected, subject to a 25,000,000-byte combined limit
and Gmail's 35 MiB encoded MIME limit. The website rechecks ownership, metadata,
and actual byte sizes before sending via Gmail's MIME media-upload endpoint.
Workspace uploads use direct bucket transfers without the previous 2 MiB limit. See
[Gmail attachment limits](https://support.google.com/mail/answer/6584) and the
[Gmail API discovery metadata](https://gmail.googleapis.com/$discovery/rest?version=v1).

The trusted callback saves
the proposal through `/api/agent/google/gmail/drafts` and sends its review widget
while the tool runs. The initial tool result is `awaiting_user_approval`; a later
conversation turn supplies the user's decision and provider outcome. One action
proposal is allowed per incoming message.

Only approval calls `/api/agent/google/gmail/send`. The website resolves the
owner's connected Google credentials, checks attachment ownership, composes the
email, and submits it to Gmail. The worker never receives Google credentials.
Provider acceptance is not proof of delivery. Unknown sends are not automatically
retried. Reviews and pending outcome notifications are persisted in
`agent/data/reviews.json`; queued feedback resumes after restart.

## Google Calendar through Photon

The worker registers `check_calendar_availability` and
`propose_calendar_event` with Hermes. Availability responses contain busy blocks
only. The proposed title and time appear in the Spectrum review card; tapping
**Add to Calendar** creates an opaque event on the sender's primary Google
Calendar. Rejecting the proposal creates nothing. The worker calls the website
with its server-only `AGENT_API_TOKEN`; it never receives Google credentials.

Connect Google in the web workspace and reconnect after granting the
`calendar.events.freebusy` permission. The worker derives calendar ownership
from the inbound Photon sender, not a model-selected phone number. The live
Photon-to-Google path still requires a real sender, running worker, HTTPS review
URL, and connected test account to verify end to end.

## Run

The root `requirements.txt` pins the external Hermes Python dependency and
pulls its declared dependencies, including `python-dotenv` for local configuration.
From the repository root, install into your Python environment:

```sh
python3 -m pip install -r requirements.txt
```

This does not configure a model provider or provision the Photon sidecar.
The current listener still expects the separate Hermes installation layout
described in the root `AGENTS.md`. Website and sidecar JavaScript dependencies
are installed with npm, and ngrok is installed separately.

Requires the existing Hermes runtime and Photon SDK installation. Configure
Photon with `hermes photon setup` and `hermes photon install-sidecar` if needed.
The listener uses those credentials and installed SDK without changing Hermes.

Start the website first (`cd web && npm run dev` from the repository root),
with a configured database and an account matching your incoming iMessage phone.
Browser-only demo files are not available to the worker. Copy `agent/.env.example`
to `agent/.env.local` and set `WIDGET_PUBLIC_URL`. `AMBASSADOR_WEB_URL` defaults
to `http://127.0.0.1:3000`; a hosted website must use its HTTPS origin.
`AGENT_API_TOKEN` must match the website's token (32+ characters). Locally, a
blank/omitted token falls back to `web/.env.local`. Only that token is read;
website database and storage credentials are not loaded into the worker.
Explicit environment values take priority. Run the following listener commands
from `agent/`.

Expose the widget server with a public HTTPS URL. For example, in one terminal:

```sh
ngrok http 8792
```

In another terminal, use the HTTPS forwarding URL ngrok displays:

```sh
WIDGET_PUBLIC_URL=https://YOUR-HOST.ngrok-free.app python3 listen.py
```

Text the Photon number to receive a normal reply. Ask Hermes to send an email,
then tap its separate approval card to open the review widget in Spectrum's sheet view. Inline live rendering is disabled so the response
has more room. Recipients without the Spectrum extension get a URL fallback.

Example terminal output after editing and approving:

```text
Widget response: {"action": "edit_approve", "text": "My edited response", "original_text": "Original Hermes response", "sender": "+12025550100", "space_id": "…", "message_id": "…"}
```

The widget binds to `127.0.0.1:8792`; `WIDGET_BIND` and `WIDGET_PORT` can override
these. Keep the sidecar on loopback. Review links contain secret bearer tokens:
anyone with a link can submit that demo response. Tokens expire after 24 hours,
and persisted reviews survive listener restarts. Each review accepts one
submission. Email edits are local until **Edit & Send** is pressed.

## Verbose logging

From `agent/`, start the listener with:

```sh
python3 listen.py --verbose
```

Alternatively, set `AMBASSADOR_VERBOSE=1` in `agent/.env.local` or in the process
environment. Detailed logs go to stderr with the `[ambassador:verbose]` prefix.
They show context downloads, Hermes turns, email proposal and card delivery,
website request status/timing, Google permission and token-refresh checks, and
Gmail's HTTP status, error message, and reason. The listener requests diagnostics
from authenticated worker endpoints so Gmail failures also appear in its terminal.
Review IDs and account phones use hashed correlation IDs; credentials, bearer
links, request payloads, and email bodies are omitted or redacted.

For example, `stage: gmail_submit` with `httpStatus: 403` and
`reason: accessNotConfigured` identifies a Gmail API configuration failure.
`stage: google_access` with `status: invalid_grant` identifies a token-refresh
failure before sending. These are examples, not a diagnosis of a previous send.

Restart the listener after changing this setting. The website must run the updated
code; restart its process too when using a production build. Default logging
remains unchanged when verbose mode is disabled. Logging never retries a send.

## Check

```sh
python3 -B -m unittest -v test_diagnostics.py test_fetch_context.py test_widget.py test_listen.py test_get_response.py test_send_email.py test_email_templates.py test_email_attachments.py test_calendar_tools.py
node --check widget-sidecar.mjs
node --check widget.js
node --test test_review_card.mjs test_message_receipts.mjs
```

Widget HTTP/state tests are offline. Live card delivery needs Photon credentials,
a public HTTPS URL, and a recipient device.
