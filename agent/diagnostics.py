"""Opt-in application diagnostics without credentials or message payloads."""

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import traceback


def verbose_enabled():
    return os.environ.get('AMBASSADOR_VERBOSE', '').lower() in ('1', 'true', 'yes', 'on')


def fingerprint(value):
    return hashlib.sha256(str(value).encode()).hexdigest()[:12] if value else None


def redact(value, depth=0):
    if depth > 6:
        return '[truncated]'
    if isinstance(value, dict):
        return {str(key): '[redacted]' if re.search(r'token|secret|password|authorization|cookie|credential|database_url|api.?key|^(raw|body|text|content)$', str(key), re.I)
                else redact(item, depth + 1) for key, item in list(value.items())[:40]}
    if isinstance(value, (list, tuple)):
        return [redact(item, depth + 1) for item in value[:20]]
    if not isinstance(value, str):
        return value
    for key, secret in os.environ.items():
        if len(secret) >= 4 and re.search(r'token|secret|password|credential|database_url|(?:^|_)key(?:$|_)', key, re.I):
            value = value.replace(secret, '[redacted]')
    value = re.sub(r'Bearer\s+[^\s"\x27]+', 'Bearer [redacted]', value, flags=re.I)
    value = re.sub(r'(?:postgres(?:ql)?://)[^\s"\x27]+', '[database URL redacted]', value, flags=re.I)
    value = re.sub(r'(/review/)[^\s"\x27?#]+', r'\1[redacted]', value)
    value = re.sub(r'\bya29\.[\w.-]+|\b1//[\w-]+', '[Google token redacted]', value)
    return value[:2000]


def error_info(error):
    return {'type': type(error).__name__, 'message': str(error),
            'frames': [{'file': Path(frame.filename).name, 'function': frame.name, 'line': frame.lineno}
                       for frame in traceback.extract_tb(error.__traceback__)[-8:]]}


def verbose_log(event, **fields):
    if verbose_enabled():
        record = {'time': datetime.now(timezone.utc).isoformat(), 'event': event, **fields}
        print('[ambassador:verbose] ' + json.dumps(redact(record), ensure_ascii=False, default=str),
              file=sys.stderr, flush=True)


def verbose_headers():
    return {'x-ambassador-verbose': '1'} if verbose_enabled() else {}
