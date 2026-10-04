# Ambassador response widget

`listen.py` receives a direct Photon iMessage, calls `get_response.py`,
and sends its response as a Spectrum mini-app card. The card displays the
response with **Approve**, **Reject**, and **Edit → Approve** actions.
The compact card initially says **Review message**. After a decision, the
same card updates to **Approved** or **Rejected**. Close the sheet to return
to the conversation; automatic native sheet dismissal is not implemented
because no supported Spectrum web bridge for dismissal was verified.
Actions only print JSON in the listener terminal; they do not send outreach
or execute the approved text.

`get_response.py` holds the main agent logic: Hermes configuration and runtime
loading, response generation through `get_response(text, phone_number)`, and logging review
decisions through `handle_decision(response)`. `listen.py` handles only messaging,
widget callbacks, and communication service startup/shutdown.

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

`send_email.py` registers a Hermes tool named `send_email`. Hermes supplies
`to`, `subject`, `text`, and optional `attachment_paths`, `cc`, `bcc`, and
`reply_to`. It currently returns `status: not_sent` and the proposed email;
it does not read attachments, fetch credentials, or send anything. The sender's
phone number is bound by Python request context, not selected by the model.
The future database credential lookup and email composition/sending belong in
the `send_email()` function. Live sending and approval wiring are not implemented.

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

Text the Photon number, then tap the returned card to open the review widget
in Spectrum's sheet view. Inline live rendering is disabled so the response
has more room. Recipients without the Spectrum extension get a URL fallback.

Example terminal output after editing and approving:

```text
Widget response: {"action": "edit_approve", "text": "My edited response", "original_text": "Original Hermes response", "sender": "+12025550100", "space_id": "…", "message_id": "…"}
```

The widget binds to `127.0.0.1:8792`; `WIDGET_BIND` and `WIDGET_PORT` can override
these. Keep the sidecar on loopback. Review links contain secret bearer tokens:
anyone with a link can submit that demo response. Tokens expire after 24 hours,
and restarting the listener invalidates all links. Each review accepts one
submission. Editing is local until **Approve edited response** is pressed.

## Check

```sh
python3 -B -m unittest -v test_fetch_context.py test_widget.py test_listen.py test_get_response.py test_send_email.py
node --check widget-sidecar.mjs
node --check widget.js
node --test test_review_card.mjs
```

Widget HTTP/state tests are offline. Live card delivery needs Photon credentials,
a public HTTPS URL, and a recipient device.
