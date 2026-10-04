import { createHash } from 'node:crypto';

export const fingerprint = value => value ? createHash('sha256').update(String(value)).digest('hex').slice(0, 12) : null;
export const verboseEnabled = request => /^(1|true|yes|on)$/i.test(process.env.AMBASSADOR_VERBOSE || '')
  || request?.headers.get('x-ambassador-verbose') === '1';

export function sanitize(value, depth = 0) {
  if (depth > 6) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 20).map(item => sanitize(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [key,
    /token|secret|password|authorization|cookie|credential|database_url|api.?key|^(raw|body|text|content)$/i.test(key) ? '[redacted]' : sanitize(item, depth + 1)]));
  if (typeof value !== 'string') return value;
  for (const [key, secret] of Object.entries(process.env)) {
    if (secret.length >= 4 && /token|secret|password|credential|database_url|(?:^|_)key(?:$|_)/i.test(key)) value = value.replaceAll(secret, '[redacted]');
  }
  return value.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[database URL redacted]')
    .replace(/(\/review\/)[^\s"'?#]+/g, '$1[redacted]')
    .replace(/\bya29\.[\w.-]+|\b1\/\/[\w-]+/g, '[Google token redacted]').slice(0, 2000);
}

export function providerError(payload, httpStatus) {
  const error = payload?.error;
  // Select diagnostic fields explicitly; never log the full OAuth/Gmail response.
  return sanitize({ httpStatus, code: error?.code,
    status: typeof error === 'string' ? error : error?.status,
    message: error?.message || payload?.error_description,
    reasons: error?.errors?.map(item => ({ reason: item.reason, domain: item.domain })),
  });
}

export const errorInfo = error => sanitize({ type: error?.name, code: error?.code,
  httpStatus: error?.status, message: error?.message });

export function verboseLog(event, fields = {}, enabled = verboseEnabled()) {
  if (enabled) console.error('[ambassador:verbose]', JSON.stringify(sanitize({ time: new Date().toISOString(), event, ...fields })));
}
