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
`fetch_context.fetch_context(phone_number)`. This is currently a no-op; it will
eventually clear and refresh `context/` with that user's files. Nothing is
fetched or deleted yet. `generate_response(text, context_directory)` instructs
Hermes to inspect relevant files in that directory and prepare the response
for review. Missing or empty context is supported. The private `context/`
directory is ignored by Git.

`send_email.py` registers a Hermes tool named `send_email`. Hermes supplies
`to`, `subject`, `text`, and optional `attachment_paths`, `cc`, `bcc`, and
`reply_to`. It currently returns `status: not_sent` and the proposed email;
it does not read attachments, fetch credentials, or send anything. The sender's
phone number is bound by Python request context, not selected by the model.
The future database credential lookup and email composition/sending belong in
the `send_email()` function. Live sending and approval wiring are not implemented.

## Run

The root `requirements.txt` pins the external Hermes Python dependency and
pulls its declared dependencies. The remaining agent Python code uses the
standard library. From the repository root, install into your Python environment:

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
python3 -m unittest -v test_widget.py test_listen.py test_get_response.py test_send_email.py
node --check widget-sidecar.mjs
node --check widget.js
node --test test_review_card.mjs
```

Widget HTTP/state tests are offline. Live card delivery needs Photon credentials,
a public HTTPS URL, and a recipient device.
