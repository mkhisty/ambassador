import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neonConfig } from '@neondatabase/serverless';
import { POST } from '../app/api/agent/outreach/route.js';

test('agent outreach endpoint rejects unauthenticated writes', async () => {
  const old = process.env.AGENT_API_TOKEN;
  process.env.AGENT_API_TOKEN = 'x'.repeat(32);
  try {
    const response = await POST(new Request('https://example.test/api/agent/outreach', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }));
    assert.equal(response.status, 401);
  } finally {
    if (old === undefined) delete process.env.AGENT_API_TOKEN;
    else process.env.AGENT_API_TOKEN = old;
  }
});

test('agent records are idempotent and associate exact iMessage contact phone only', async () => {
  const previous = process.env.DATABASE_URL, oldToken = process.env.AGENT_API_TOKEN, fetch = neonConfig.fetchFunction;
  process.env.DATABASE_URL = 'postgresql://test:test@example.neon.tech/test';
  process.env.AGENT_API_TOKEN = 't'.repeat(32);
  const statements = [];
  neonConfig.fetchFunction = async (_url, options) => {
    const statement = JSON.parse(options.body); statements.push(statement);
    let rows = [];
    if (statement.query.includes('FROM ambassador_sponsors')) rows = [
      { id: 'contact-1', data: { channel: 'imessage', phone: '+12025550100' } },
      { id: 'other-channel', data: { channel: 'email', address: '+12025550100' } },
    ];
    const names = Object.keys(rows[0] || {});
    return Response.json({ fields: names.map(name => ({ name, dataTypeID: typeof rows[0][name] === 'object' ? 3802 : 25 })),
      rows: rows.map(row => names.map(name => typeof row[name] === 'object' ? JSON.stringify(row[name]) : row[name])),
      rowCount: rows.length, command: 'SELECT' });
  };
  try {
    const request = () => new Request('https://example.test/api/agent/outreach', {
      method: 'POST', headers: { authorization: `Bearer ${'t'.repeat(32)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ eventId: 'out-review-1', phoneNumber: '(202) 555-0100', direction: 'outbound', text: 'Approved message', providerMessageId: 'photon-1' }),
    });
    const response = await POST(request());
    assert.deepEqual(await response.json(), { ok: true, duplicate: false, associatedContact: true });
    assert.match(statements.at(-1).query, /INSERT INTO ambassador_activities/);
    assert.ok(statements.at(-1).params.includes('contact-1'));
    statements.length = 0;
    neonConfig.fetchFunction = async (_url, options) => {
      const statement = JSON.parse(options.body); statements.push(statement);
      const rows = statement.query.includes('SELECT owner_phone_number') ? [{ owner_phone_number: '+12025550100' }] : [];
      const names = Object.keys(rows[0] || {});
      return Response.json({ fields: names.map(name => ({ name, dataTypeID: 25 })), rows: rows.map(row => names.map(name => row[name])), rowCount: rows.length, command: 'SELECT' });
    };
    const duplicate = await POST(request());
    assert.deepEqual(await duplicate.json(), { ok: true, duplicate: true });
    assert.equal(statements.length, 1);
  } finally {
    neonConfig.fetchFunction = fetch;
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
    if (oldToken === undefined) delete process.env.AGENT_API_TOKEN; else process.env.AGENT_API_TOKEN = oldToken;
  }
});
