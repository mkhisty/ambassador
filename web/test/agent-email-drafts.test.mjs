import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neonConfig } from '@neondatabase/serverless';
import { POST } from '../app/api/agent/google/gmail/drafts/route.js';

test('Email recipients need no saved contact; optional links and attachments remain owner-scoped', async t => {
  const keys = ['DATABASE_URL', 'AGENT_API_TOKEN'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = neonConfig.fetchFunction;
  const phone = '+12025550100', token = 't'.repeat(32);
  const reviewId = '12345678-1234-4123-8123-123456789abc';
  process.env.DATABASE_URL = 'postgresql://test:test@example.neon.tech/test';
  process.env.AGENT_API_TOKEN = token;
  let queries, linkedId, attachmentOwned;
  const request = (proposal = {}, authorization = `Bearer ${token}`) => new Request('https://website.example/api/agent/google/gmail/drafts', {
    method: 'POST', headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ phoneNumber: phone, reviewId, proposal: {
      recipient: 'new-person@example.com', subject: 'User supplied subject', body: 'User supplied facts', ...proposal,
    } }),
  });
  neonConfig.fetchFunction = async (url, options) => {
    const statement = JSON.parse(options.body);
    queries.push(statement);
    let rows = [];
    if (statement.query.includes('FROM ambassador_sponsors')) {
      assert.ok(statement.params.includes(phone));
      assert.match(statement.query, /c.phone_number=/);
      rows = linkedId ? [{ id: linkedId }] : [];
    } else if (statement.query.includes('FROM ambassador_documents')) {
      assert.match(statement.query, /owner_phone_number=/);
      assert.ok(statement.params.includes(phone));
      rows = attachmentOwned ? [{ id: 'owned-file', name: 'Brief.pdf', mime: 'application/pdf', size: 512 }] : [];
    } else if (statement.query.includes('INSERT INTO ambassador_outreach_drafts')) {
      rows = [{ id: 'saved-draft', review_id: reviewId, status: 'draft' }];
    }
    const names = Object.keys(rows[0] || {});
    return Response.json({ fields: names.map(name => ({ name, dataTypeID: name === 'size' ? 23 : 25 })),
      rows: rows.map(row => names.map(name => row[name])), rowCount: rows.length, command: 'SELECT' });
  };
  try {
    await t.test('A new recipient saves a draft without creating or linking a contact', async () => {
      queries = []; linkedId = null;
      const response = await POST(request());
      assert.equal(response.status, 200);
      assert.equal((await response.json()).ok, true);
      const insert = queries.at(-1);
      assert.match(insert.query, /INSERT INTO ambassador_outreach_drafts/);
      assert.equal(insert.params[1], phone);
      assert.equal(insert.params[2], null);
      assert.equal(insert.params[3], 'new-person@example.com');
      assert.equal(insert.params[5], 'User supplied facts');
      assert.equal(queries.some(q => /INSERT INTO ambassador_sponsors/.test(q.query)), false);
    });
    await t.test('Known linked contacts can still be associated', async () => {
      queries = []; linkedId = 'linked-contact';
      assert.equal((await POST(request({ contactId: linkedId }))).status, 200);
      assert.equal(queries.at(-1).params[2], linkedId);
    });
    await t.test('Foreign or stale contact hints cannot attach another owner but do not block the recipient', async () => {
      queries = []; linkedId = null;
      assert.equal((await POST(request({ contactId: 'unowned-contact' }))).status, 200);
      assert.equal(queries.at(-1).params[2], null);
    });
    await t.test('An unlinked recipient can use owned attachments', async () => {
      queries = []; linkedId = null; attachmentOwned = true;
      assert.equal((await POST(request({ attachmentRefs: ['owned-file'] }))).status, 200);
    });
    await t.test('Foreign attachments are denied before any draft write', async () => {
      queries = []; attachmentOwned = false;
      assert.equal((await POST(request({ attachmentRefs: ['foreign-file'] }))).status, 403);
      assert.equal(queries.some(q => q.query.includes('INSERT INTO')), false);
    });
    await t.test('Authentication still precedes all account reads and writes', async () => {
      queries = [];
      assert.equal((await POST(request({}, 'Bearer wrong'))).status, 401);
      assert.deepEqual(queries, []);
    });
  } finally {
    neonConfig.fetchFunction = originalFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
