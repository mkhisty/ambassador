# ambassador

Outreach from iMessage. Upload campaign docs and contacts, chat with Hermes, then approve or edit emails before they go out.

- `web/` — website, contacts, files, Gmail and Calendar.
- `agent/` — Hermes + Photon listener and approval widgets.

Run the website:

```sh
cd web
npm install
npm run dev
```

Run the agent from `agent/` with `python3 listen.py`. Widgets currently need `ngrok http 8792` and its HTTPS URL set as `WIDGET_PUBLIC_URL`.

Env/setup details: [website](web/README.md) · [agent](agent/README.md).
