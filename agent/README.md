# agent

Listens to iMessages, talks to Hermes, and sends replies. Emails and calendar actions get approval widgets first. Also checks connected Gmail for replies.

Needs Hermes and Photon configured. Copy `.env.example` to `.env.local`; set `AMBASSADOR_WEB_URL` and the website's `AGENT_API_TOKEN`.

Run from this folder. One terminal:

```sh
ngrok http 8792
```

Another terminal, using ngrok's HTTPS URL:

```sh
WIDGET_PUBLIC_URL=https://YOUR-NGROK-URL python3 listen.py
```
