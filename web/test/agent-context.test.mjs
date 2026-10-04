import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neonConfig } from '@neondatabase/serverless';
import { createContextHandlers, contextForPhone } from '../lib/agent-context.mjs';

test('Worker context authenticates independently and downloads only owned files', async t => {
  const previous = process.env.AGENT_API_TOKEN;
  const token = 't'.repeat(32), phone = '+12025550100';
  process.env.AGENT_API_TOKEN = token;
  const request = (authorization = `Bearer ${token}`, number = phone) => new Request(
    `https://website.example/api/agent/context?phoneNumber=${encodeURIComponent(number)}`,
    { headers: { authorization, cookie: 'ambassador_session=browser-cookie' } });
  const params = { params: Promise.resolve({ id: 'doc-1' }) };
  try {
    await t.test('Missing, wrong, and short tokens cannot access context or file bytes', async () => {
      let reads = 0;
      const api = createContextHandlers({ readContext: () => { reads++; }, readDocument: () => { reads++; } });
      for (const auth of ['', 'Bearer wrong']) {
        assert.equal((await api.manifest(request(auth))).status, 401);
        assert.equal((await api.document(request(auth), params)).status, 401);
      }
      process.env.AGENT_API_TOKEN = 'short';
      assert.equal((await api.manifest(request('Bearer short'))).status, 401);
      process.env.AGENT_API_TOKEN = token;
      assert.equal(reads, 0);
    });
    await t.test('Phone validation and unknown accounts stop lookup', async () => {
      let seen;
      const api = createContextHandlers({ readContext: async value => { seen = value; return null; } });
      assert.equal((await api.manifest(request(undefined, 'email@example.com'))).status, 400);
      assert.equal(seen, undefined);
      assert.equal((await api.manifest(request(undefined, '(202) 555-0100'))).status, 404);
      assert.equal(seen, phone);
    });
    await t.test('Manifest is private and carries the requested account', async () => {
      const api = createContextHandlers({ readContext: async value => ({ phoneNumber: value, documents: [] }) });
      const response = await api.manifest(request());
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      assert.equal((await response.json()).phoneNumber, phone);
    });
    await t.test('Another owner or unknown ID never reaches object storage', async () => {
      let storageReads = 0;
      const api = createContextHandlers({
        readDocument: async (id, owner) => { assert.equal(id, 'doc-1'); assert.equal(owner, phone); return null; },
        readStoredObject: () => { storageReads++; },
      });
      assert.equal((await api.document(request(), params)).status, 404);
      assert.equal(storageReads, 0);
    });
    await t.test('Both legacy Postgres and private object bytes download unchanged', async () => {
      const bytes = Buffer.from([0, 255, 42, 13]);
      for (const object_key of [null, 'private/owned-key']) {
        const api = createContextHandlers({
          readDocument: async () => ({ name: 'brief.pdf', mime: 'application/pdf', object_key, content: bytes.toString('base64') }),
          readStoredObject: async key => { assert.equal(key, 'private/owned-key'); return bytes; },
        });
        const response = await api.document(request(), params);
        assert.equal(response.status, 200);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
        assert.equal(response.headers.get('cache-control'), 'private, no-store');
      }
    });
  } finally {
    if (previous === undefined) delete process.env.AGENT_API_TOKEN;
    else process.env.AGENT_API_TOKEN = previous;
  }
});

test('Actual context SQL scopes profiles, linked contacts, activity, and documents by phone', async () => {
  const previous = process.env.DATABASE_URL, fetch = neonConfig.fetchFunction;
  process.env.DATABASE_URL = 'postgresql://test:test@example.neon.tech/test';
  const phone = '+12025550100', queries = [];
  neonConfig.fetchFunction = async (url, options) => {
    const statement = JSON.parse(options.body);
    queries.push(statement);
    assert.match(statement.query, /^SELECT/);
    let rows = [];
    if (statement.query.includes('FROM ambassador_users')) {
      rows = [{ phone_number: phone, name: 'Owner', email: '', details: {} }];
    } else if (statement.query.includes('FROM ambassador_event')) {
      rows = [{ data: { name: 'Shared campaign' } }];
    }
    const names = Object.keys(rows[0] || {});
    return Response.json({ fields: names.map(name => ({ name, dataTypeID: typeof rows[0][name] === 'object' ? 3802 : 25 })),
      rows: rows.map(row => names.map(name => typeof row[name] === 'object' ? JSON.stringify(row[name]) : row[name])), rowCount: rows.length, command: 'SELECT' });
  };
  try {
    const result = await contextForPhone(phone);
    assert.equal(result.user.phoneNumber, phone);
    assert.equal(result.campaign.name, 'Shared campaign');
    assert.deepEqual(result.documents, []);
    assert.equal(queries.length, 5);
    for (const { query, params } of queries) {
      if (query.includes('FROM ambassador_event')) continue;
      assert.ok(params.length >= 1 && params.every(value => value === phone));
      assert.match(query, /WHERE .*phone_number=\$1/);
    }
  } finally {
    neonConfig.fetchFunction = fetch;
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});
