import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neonConfig } from '@neondatabase/serverless';
import { sanitize, providerError } from '../lib/diagnostics.mjs';
import { encryptGoogleToken } from '../lib/google.mjs';
import { POST } from '../app/api/agent/google/gmail/send/route.js';

test('Diagnostics redact credentials and payloads while preserving provider failure reasons', () => {
  const result = sanitize({ authorization: 'Bearer private', body: 'private email',
    error: { message: 'Bad Bearer unknown-secret https://example.com/review/private-link ya29.oauth-token' } });
  const logged = JSON.stringify(result);
  for (const secret of ['unknown-secret', 'private email', 'private-link', 'ya29.oauth-token']) assert.ok(!logged.includes(secret));
  assert.equal(providerError({ error: { code: 403, message: 'API disabled', errors: [{ reason: 'accessNotConfigured' }] },
    access_token: 'private-access-token' }, 403).reasons[0].reason, 'accessNotConfigured');
});

test('Verbose worker requests report Gmail and OAuth failures; default and unauthenticated requests stay quiet', async t => {
  const values = { DATABASE_URL: 'postgresql://test:test@example.neon.tech/test', AGENT_API_TOKEN: 't'.repeat(32),
    AMBASSADOR_VERBOSE: '0', GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'private-client-secret',
    GOOGLE_REDIRECT_URI: 'https://website.example/api/google/callback', GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  const originalFetch = globalThis.fetch, originalNeonFetch = neonConfig.fetchFunction, originalError = console.error;
  let logs = [], providerCalls = 0, refreshFailure = false, providerAccepted = false, recorded = false;
  console.error = (...args) => logs.push(args.join(' '));
  globalThis.fetch = async url => {
    providerCalls++;
    if (url === 'https://oauth2.googleapis.com/token') return refreshFailure
      ? Response.json({ error: 'invalid_grant', error_description: 'Google consent expired' }, { status: 400 })
      : Response.json({ access_token: 'ya29.private-access-token' });
    assert.equal(url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    if (providerAccepted) return Response.json({ id: 'accepted-message-id' });
    return Response.json({ error: { code: 403, status: 'PERMISSION_DENIED',
      message: 'Gmail API disabled private-client-secret ya29.private-access-token',
      errors: [{ reason: 'accessNotConfigured', domain: 'usageLimits' }] }, refresh_token: 'never-log-refresh' }, { status: 403 });
  };
  neonConfig.fetchFunction = async (url, options) => {
    const { query } = JSON.parse(options.body);
    let rows = [];
    if (query.includes('SELECT status,google_message_id')) rows = [{ status: 'draft', google_message_id: null }];
    if (query.includes('FROM ambassador_google_connections')) rows = [{ google_email: 'owner@example.com',
      scopes: ['https://www.googleapis.com/auth/gmail.send'], ...encryptGoogleToken('private-refresh-token', Buffer.alloc(32, 7)) }];
    if (query.includes('RETURNING id,sponsor_id')) rows = [{ id: 'saved-draft', sponsor_id: null }];
    if (query.startsWith('WITH sent AS')) {
      // jsonb_build_object is polymorphic: Postgres needs an explicit type
      // for this parameter, even when another parameter has the same value.
      assert.match(query, /'actor',\$6::text/);
      recorded = true;
      rows = [{ id: 'saved-activity' }];
    }
    const names = Object.keys(rows[0] || {});
    return Response.json({ fields: names.map(name => ({ name, dataTypeID: Array.isArray(rows[0][name]) ? 3802 : 25 })),
      rows: rows.map(row => names.map(name => Array.isArray(row[name]) ? JSON.stringify(row[name]) : row[name])),
      rowCount: rows.length, command: 'SELECT' });
  };
  const reviewId = '12345678-1234-4123-8123-123456789abc';
  const request = (verbose, authorized = true) => new Request('https://website.example/api/agent/google/gmail/send', {
    method: 'POST', headers: { authorization: authorized ? `Bearer ${values.AGENT_API_TOKEN}` : 'Bearer wrong',
      ...(verbose ? { 'x-ambassador-verbose': '1' } : {}) },
    body: JSON.stringify({ phoneNumber: '+12025550100', reviewId,
      proposal: { recipient: 'new-person@example.com', subject: 'Test', body: 'private email body' } }),
  });
  try {
    await t.test('Default Gmail rejection keeps diagnostics off', async () => {
      const response = await POST(request(false));
      assert.equal(response.status, 502);
      assert.equal((await response.json()).diagnostics, undefined);
      assert.deepEqual(logs, []);
    });
    await t.test('Verbose Gmail rejection includes safe provider diagnostics', async () => {
      logs = [];
      const response = await POST(request(true));
      const body = await response.json();
      assert.equal(body.status, 'failed');
      assert.equal(body.diagnostics.stage, 'gmail_submit');
      assert.equal(body.diagnostics.provider.httpStatus, 403);
      assert.equal(body.diagnostics.provider.reasons[0].reason, 'accessNotConfigured');
      const output = logs.join('\n') + JSON.stringify(body);
      for (const secret of ['private-client-secret', 'ya29.private-access-token', 'private-refresh-token',
                           'never-log-refresh', 'private email body', reviewId]) assert.ok(!output.includes(secret), secret);
      assert.ok(output.includes('google.refresh_done'));
    });
    await t.test('OAuth refresh failure identifies the earlier stage', async () => {
      logs = []; refreshFailure = true;
      const response = await POST(request(true));
      assert.equal(response.status, 401);
      const body = await response.json();
      assert.equal(body.diagnostics.stage, 'google_access');
      assert.equal(body.diagnostics.provider.status, 'invalid_grant');
      assert.ok(logs.join('\n').includes('google.refresh_failed'));
    });
    await t.test('Gmail acceptance records activity and returns an accepted outcome', async () => {
      refreshFailure = false; providerAccepted = true; recorded = false;
      const response = await POST(request(true));
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.status, 'accepted');
      assert.equal(body.messageId, 'accepted-message-id');
      assert.equal(recorded, true);
    });
    await t.test('A debug header cannot bypass worker authentication', async () => {
      logs = []; providerCalls = 0;
      assert.equal((await POST(request(true, false))).status, 401);
      assert.deepEqual(logs, []);
      assert.equal(providerCalls, 0);
    });
  } finally {
    globalThis.fetch = originalFetch; neonConfig.fetchFunction = originalNeonFetch; console.error = originalError;
    for (const key of Object.keys(values)) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  }
});
