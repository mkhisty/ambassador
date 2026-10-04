#!/usr/bin/env python3
"""Photon/widget communication. Agent behavior lives in get_response.py."""

import json
import os
import secrets
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# Hermes's isolated relaunch does not include this script's directory.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from widget import ReviewStore, start_widget_server
import get_response
from calendar_tools import calendar_proposal, create_approved_event

HOME = Path.home() / ".hermes"
SDK_SIDECAR = HOME / "hermes-agent/plugins/platforms/photon/sidecar/index.mjs"
SIDECAR = Path(__file__).resolve().parent / "widget-sidecar.mjs"
URL = "http://127.0.0.1:8791"

def message_text(content):
    if not isinstance(content, dict):
        return ""
    if content.get("type") == "text":
        return (content.get("text") or "").strip()
    if content.get("type") == "reply":
        return message_text(content.get("content"))
    if content.get("type") == "group":
        return "\n".join(filter(None, (
            message_text(item.get("content")) for item in content.get("items", [])
        )))
    return ""


def post(token, path, body, timeout=30):
    req = urllib.request.Request(
        URL + path,
        data=json.dumps(body).encode(),
        headers={"x-hermes-sidecar-token": token, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        result = json.load(response)
    if result.get("ok") is False:
        raise RuntimeError(result.get("error") or "Photon request failed")


def listen(token, reviews, public_url):
    req = urllib.request.Request(URL + "/inbound", headers={"x-hermes-sidecar-token": token})
    with urllib.request.urlopen(req, timeout=None) as stream:
        for line in stream:
            if not line.strip():
                continue
            try:
                event = json.loads(line)
                text = message_text(event.get("content"))
                if not text:
                    continue
                reply = get_response.get_response(text, event.get('sender', {}).get('id'))
                review_id = reviews.create(reply, event, calendar_event=calendar_proposal.get())
                post(token, "/send-app", {
                    "reviewId": review_id,
                    "spaceId": event["space"]["id"],
                    "url": public_url + "/review/" + review_id,
                    "kind": "calendar" if calendar_proposal.get() else "message",
                })
            except Exception as exc:
                print(f"Reply failed: {exc}", flush=True)
    raise ConnectionError("Photon stream closed")


def main():
    # Hermes may replace this process with its managed Python runtime.
    # Do that before starting servers or the sidecar.
    get_response.load_hermes()
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent / '.env.local', override=False)
    env = os.environ.copy()
    public_url = env.get("WIDGET_PUBLIC_URL", "").rstrip("/")
    if not public_url.startswith("https://"):
        raise SystemExit("Set WIDGET_PUBLIC_URL to your public HTTPS widget URL (see README.md).")
    auth_file = HOME / "auth.json"
    auth = json.loads(auth_file.read_text()) if auth_file.exists() else {}
    project = next(iter(auth.get("credential_pool", {}).get("photon_project", [])), {})
    env.setdefault("PHOTON_PROJECT_ID", project.get("spectrum_project_id") or project.get("project_id") or "")
    env.setdefault("PHOTON_PROJECT_SECRET", project.get("project_secret") or "")
    if not env["PHOTON_PROJECT_ID"] or not env["PHOTON_PROJECT_SECRET"]:
        raise SystemExit("Run hermes photon setup first.")
    nodes = sorted((HOME / "tools").glob("node-*/bin/node"))
    node = str(nodes[-1]) if nodes else shutil.which("node")
    if not node or not SDK_SIDECAR.is_file():
        raise SystemExit("Run hermes photon install-sidecar first.")
    token = secrets.token_hex(16)
    env.update(PHOTON_SIDECAR_PORT="8791", PHOTON_SIDECAR_BIND="127.0.0.1",
               PHOTON_SIDECAR_TOKEN=token, PHOTON_TELEMETRY="false",
               PHOTON_SDK_SIDECAR=str(SDK_SIDECAR))
    env["PATH"] = str(Path(node).parent) + os.pathsep + env.get("PATH", "")
    reviews = ReviewStore(emit=get_response.handle_decision, on_decision=lambda review_id, result: post(token, '/update-app', {
        'reviewId': review_id, 'action': result['action'],
    }), on_calendar_approve=create_approved_event)
    server = start_widget_server(reviews, env.get("WIDGET_BIND", "127.0.0.1"),
                                 int(env.get("WIDGET_PORT", "8792")))
    proc = None
    try:
        proc = subprocess.Popen([node, str(SIDECAR)], cwd=SIDECAR.parent, env=env)
        deadline = time.monotonic() + 30
        while True:
            if proc.poll() is not None:
                raise SystemExit(f"Photon sidecar exited ({proc.returncode}).")
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise SystemExit("Photon sidecar did not start within 30 seconds.")
            try:
                post(token, "/healthz", {}, timeout=min(1, remaining))
                break
            except (urllib.error.URLError, OSError):
                time.sleep(0.4)
        print("Listening. Ctrl-C to stop.", flush=True)
        while proc.poll() is None:
            try:
                listen(token, reviews, public_url)
            except (urllib.error.URLError, OSError) as exc:
                print(f"Reconnecting: {exc}", flush=True)
                time.sleep(2)
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()
        server.server_close()
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()


if __name__ == "__main__":
    main()
