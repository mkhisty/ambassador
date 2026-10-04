"""Refresh private account context through the website's authenticated worker API."""

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import urllib.error
import urllib.parse
import urllib.request

AGENT_DIR = Path(__file__).resolve().parent
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_CONTEXT_BYTES = 256 * 1024 * 1024


def normalize_phone(value):
    phone = re.sub(r'[\s().-]', '', str(value or '').strip())
    if re.fullmatch(r'\d{10}', phone):
        phone = '+1' + phone
    if not re.fullmatch(r'\+[1-9]\d{7,14}', phone):
        raise ValueError('Context fetching requires a phone-number sender.')
    return phone


def context_settings():
    from dotenv import dotenv_values
    local = dotenv_values(AGENT_DIR / '.env.local', interpolate=False)
    shared = dotenv_values(AGENT_DIR.parent / 'web' / '.env.local', interpolate=False)
    base = (os.environ.get('AMBASSADOR_WEB_URL') or local.get('AMBASSADOR_WEB_URL') or 'http://127.0.0.1:3000').rstrip('/')
    token = os.environ.get('AGENT_API_TOKEN') or local.get('AGENT_API_TOKEN') or shared.get('AGENT_API_TOKEN') or ''
    parsed = urllib.parse.urlsplit(base)
    loopback = parsed.hostname in ('localhost', '127.0.0.1', '::1')
    if (parsed.scheme != 'https' and not (parsed.scheme == 'http' and loopback)) or not parsed.netloc or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
        raise ValueError('AMBASSADOR_WEB_URL must be an HTTPS origin or a localhost HTTP origin.')
    if len(token) < 32:
        raise ValueError('Configure AGENT_API_TOKEN in agent/.env.local or web/.env.local.')
    return base, token


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def read_api(opener, url, token, limit):
    request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token})
    try:
        with opener.open(request, timeout=30) as response:
            body = response.read(limit + 1)
    except urllib.error.HTTPError as error:
        status = error.code
        error.close()
        if status == 401:
            raise RuntimeError('Website rejected the agent token. Check AGENT_API_TOKEN.') from None
        if status == 404:
            raise RuntimeError('Account or context file was not found. Sign up with your iMessage phone number.') from None
        raise RuntimeError(f'Context download failed (HTTP {status}). Previous context was preserved.') from None
    except (urllib.error.URLError, OSError):
        raise RuntimeError('Cannot reach the website to refresh context. Previous context was preserved.') from None
    if len(body) > limit:
        raise RuntimeError('Context response exceeded its size limit.')
    return body


def fetch_context(phone_number, *, context_root=None, opener=None):
    """Download all owned documents and publish the complete snapshot together.

    One serial worker per context root is supported. Old snapshots are removed
    only after the complete new snapshot is published.
    """
    phone = normalize_phone(phone_number)
    base, token = context_settings()
    opener = opener or urllib.request.build_opener(NoRedirect())
    query = '?' + urllib.parse.urlencode({'phoneNumber': phone})
    payload = json.loads(read_api(opener, base + '/api/agent/context' + query, token, 4 * 1024 * 1024))
    if not isinstance(payload, dict) or payload.get('phoneNumber') != phone or not isinstance(payload.get('documents'), list):
        raise ValueError('Website returned invalid account context.')

    root = Path(context_root) if context_root is not None else AGENT_DIR / 'context'
    root = root.resolve()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    user_dir = root / hashlib.sha256(phone.encode()).hexdigest()
    if user_dir.is_symlink():
        raise ValueError('Context account directory must not be a symlink.')
    user_dir.mkdir(exist_ok=True, mode=0o700)
    snapshot = Path(tempfile.mkdtemp(prefix='snapshot-', dir=user_dir))
    pointer = user_dir / ('.current-' + snapshot.name)
    published = False
    try:
        manifest, ids, total = [], set(), 0
        for document in payload['documents']:
            if not isinstance(document, dict) or document.get('ownerPhoneNumber') != phone:
                raise ValueError('Website returned a document owned by another account.')
            doc_id, name, size = document.get('id'), document.get('name'), document.get('size')
            if not isinstance(doc_id, str) or not re.fullmatch(r'[\w-]{1,100}', doc_id) or doc_id in ids:
                raise ValueError('Website returned an invalid or duplicate document ID.')
            ids.add(doc_id)
            if not isinstance(name, str) or not isinstance(size, int) or isinstance(size, bool) or not 0 < size <= MAX_FILE_BYTES:
                raise ValueError('Website returned invalid document metadata.')
            total += size
            if total > MAX_CONTEXT_BYTES:
                raise ValueError('Account documents exceed the 256 MB context limit.')
            basename = re.sub(r'[^\w .()-]', '_', name.replace('\\', '/').split('/')[-1])[:160] or 'document'
            filename = hashlib.sha256(doc_id.encode()).hexdigest()[:16] + '-' + basename
            url = base + '/api/agent/context/documents/' + urllib.parse.quote(doc_id, safe='') + query
            body = read_api(opener, url, token, MAX_FILE_BYTES)
            if len(body) != size:
                raise ValueError('Context file size changed during refresh. Try again.')
            (snapshot / filename).write_bytes(body)
            manifest.append({**document, 'localPath': filename, 'sha256': hashlib.sha256(body).hexdigest()})
        (snapshot / 'workspace.json').write_text(json.dumps({
            'phoneNumber': phone, 'user': payload.get('user'), 'campaign': payload.get('campaign'),
            'contacts': payload.get('contacts', []), 'activities': payload.get('activities', []),
            'documents': manifest,
        }, ensure_ascii=False, indent=2), encoding='utf-8')
        pointer.symlink_to(snapshot.name, target_is_directory=True)
        os.replace(pointer, user_dir / 'current')
        published = True
        for old in user_dir.glob('snapshot-*'):
            if old != snapshot and old.is_dir() and not old.is_symlink():
                shutil.rmtree(old)
        return snapshot
    finally:
        pointer.unlink(missing_ok=True)
        if not published:
            shutil.rmtree(snapshot)
