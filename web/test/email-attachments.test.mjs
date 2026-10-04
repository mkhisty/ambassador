import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neonConfig } from '@neondatabase/serverless';
import { encryptGoogleToken } from '../lib/google.mjs';
import { checkAttachmentTotal, encodeEmailMime, attachmentHeaders, MAX_EMAIL_MIME_BYTES } from '../lib/email-attachments.mjs';
import { POST } from '../app/api/agent/google/gmail/send/route.js';

test('Attachment size limits include the complete encoded MIME message', () => {
  checkAttachmentTotal([12_500_000, 12_500_000]);
  assert.throws(() => checkAttachmentTotal([25_000_001]), /25 MB/);
  assert.throws(() => checkAttachmentTotal(Array(21).fill(1)), /count/);
  assert.throws(() => encodeEmailMime('x'.repeat(MAX_EMAIL_MIME_BYTES + 1)), /encoded email/);
  const headers = attachmentHeaders({ name: 'Résumé "brief".pdf', mime: 'application/pdf' });
  assert.match(headers, /filename\*=UTF-8''R%C3%A9sum%C3%A9%20%22brief%22.pdf/);
  assert.throws(() => attachmentHeaders({ name: 'file.pdf\r\nBcc: attacker@example.com', mime: 'application/pdf' }), /metadata/);
});

test('The approved Gmail send includes exact owned document bytes as MIME attachments', async t => {
  const values = { DATABASE_URL: 'postgresql://test:test@example.neon.tech/test', AGENT_API_TOKEN: 't'.repeat(32),
    AMBASSADOR_VERBOSE: '0', GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret',
    GOOGLE_REDIRECT_URI: 'https://website.example/api/google/callback', GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64') };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  const originalFetch = globalThis.fetch, originalNeonFetch = neonConfig.fetchFunction;
  const phone = '+12025550100', reviewId = '12345678-1234-4123-8123-123456789abc';
  const binary = Buffer.from([0, 255, 42, 13, 10, 128]);
  let attachmentOwned = true, oversize = false, changed = false, sentMime, claimed;
  neonConfig.fetchFunction = async (url, options) => {
    const { query, params } = JSON.parse(options.body);
    let rows = [];
    if (query.includes('SELECT status,google_message_id')) rows = [{ status: 'draft', google_message_id: null }];
    if (query.includes('FROM ambassador_google_connections')) rows = [{ google_email: 'owner@example.com',
      scopes: ['https://www.googleapis.com/auth/gmail.send'], ...encryptGoogleToken('refresh', Buffer.alloc(32, 9)) }];
    if (query.includes('FROM ambassador_documents')) {
      assert.ok(params.includes(phone));
      assert.match(query, /owner_phone_number=/);
      rows = attachmentOwned ? [{ id: 'document-id', name: 'Résumé.pdf', mime: 'application/pdf',
        size: oversize ? 25_000_001 : binary.length + (changed ? 1 : 0),
        object_key: null, content: binary.toString('base64') }] : [];
    }
    if (query.includes('RETURNING id,sponsor_id')) {
      claimed = true;
      rows = [{ id: 'draft-id', sponsor_id: null }];
    }
    if (query.startsWith('WITH sent AS')) rows = [{ id: 'activity-id' }];
    const names = Object.keys(rows[0] || {});
    return Response.json({ fields: names.map(name => ({ name, dataTypeID: name === 'size' ? 23 : Array.isArray(rows[0][name]) ? 3802 : 25 })),
      rows: rows.map(row => names.map(name => Array.isArray(row[name]) ? JSON.stringify(row[name]) : row[name])), rowCount: rows.length, command: 'SELECT' });
  };
  globalThis.fetch = async (url, options) => {
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'access' });
    assert.equal(url, 'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media');
    assert.equal(options.headers['Content-Type'], 'message/rfc822');
    sentMime = options.body.toString('utf8');
    return Response.json({ id: 'gmail-message' });
  };
  const request = () => new Request('https://website.example/api/agent/google/gmail/send', {
    method: 'POST', headers: { authorization: `Bearer ${values.AGENT_API_TOKEN}` },
    body: JSON.stringify({ phoneNumber: phone, reviewId,
      proposal: { recipient: 'recipient@example.com', subject: 'Brief', body: 'See attached.', attachmentRefs: ['document-id'] } }),
  });
  try {
    await t.test('Recipient gets the document as an attachment with preserved binary data and filename', async () => {
      const response = await POST(request());
      assert.equal(response.status, 200);
      assert.equal((await response.json()).status, 'accepted');
      assert.match(sentMime, /Content-Type: multipart\/mixed/);
      assert.match(sentMime, /Content-Disposition: attachment;.*filename\*=UTF-8''R%C3%A9sum%C3%A9.pdf/);
      const attachment = sentMime.split('Content-Disposition: attachment;')[1].split('\r\n\r\n')[1].split('\r\n--')[0];
      assert.deepEqual(Buffer.from(attachment, 'base64'), binary);
      assert.ok(!sentMime.includes('/review/'));
    });
    await t.test('Foreign documents are rejected before sending or claiming a draft', async () => {
      attachmentOwned = false; sentMime = null; claimed = false;
      assert.equal((await POST(request())).status, 403);
      assert.equal(sentMime, null); assert.equal(claimed, false);
      attachmentOwned = true;
    });
    await t.test('Oversize attachments stop before sending or claiming a draft', async () => {
      oversize = true; sentMime = null; claimed = false;
      assert.equal((await POST(request())).status, 413);
      assert.equal(sentMime, null); assert.equal(claimed, false);
      oversize = false;
    });
    await t.test('Changed attachment size is rejected before provider submission', async () => {
      changed = true; sentMime = null; claimed = false;
      assert.equal((await POST(request())).status, 409);
      assert.equal(sentMime, null); assert.equal(claimed, false);
    });
  } finally {
    globalThis.fetch = originalFetch; neonConfig.fetchFunction = originalNeonFetch;
    for (const key of Object.keys(values)) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  }
});
