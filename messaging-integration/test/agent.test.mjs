import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { config } from '../src/config.mjs';
import { openStore } from '../src/store.mjs';
import { createSource, parseSheet, notionText } from '../src/sources.mjs';
import { createAI } from '../src/ai.mjs';
import { createChannels } from '../src/channels.mjs';
import { createAgent } from '../src/agent.mjs';
import { organizerInput } from '../src/main.mjs';

function setup(t, options = {}) {
  const root = resolve('data', 'tests');
  mkdirSync(root, { recursive: true });
  const directory = join(root, randomUUID());
  const c = config({ DATA_DIR: directory, ORGANIZER_IDS: '+12025550100', ...options.env });
  const db = openStore(directory);
  const source = options.source || createSource(c);
  const channels = options.channels || createChannels(c);
  const agent = createAgent({ db, c, source, channels, ai: options.ai || createAI(c) });
  const ctx = { actor: '+12025550100', conversation: 'organizer-dm' };
  const ask = (text, context = {}) => agent.handle(text, { ...ctx, messageId: randomUUID(), ...context });
  t.after(() => {
    db.close();
    assert.ok(resolve(directory).startsWith(root + sep));
    rmSync(directory, { recursive: true });
  });
  return { c, db, source, channels, agent, ask, directory, ctx };
}
const draftId = text => text.match(/d-[a-f0-9]{12}/)?.[0];

test('real preview email requires exact approval, survives restart, and cannot resend', async t => {
  const s = setup(t);
  const id = draftId(await s.ask('draft lead-012'));
  assert.ok(id);
  assert.match(await s.ask('approve'), /exactly approve/);
  assert.match(await s.ask(`approve ${id}`, { conversation: 'another-chat' }), /not found/);
  assert.equal(await s.ask(`approve ${id}`, { actor: 'attacker' }), null);
  assert.match(await s.ask(`approve ${id}`), /No message delivered/);
  const outbox = join(s.directory, 'outbox');
  assert.match(readFileSync(join(outbox, `${id}.eml`), 'utf8'), /To: partner12@example.com/);
  assert.match(await s.ask(`approve ${id}`), /cannot be sent again/);
  const db2 = openStore(s.directory);
  try {
    const restarted = createAgent({ db: db2, c: s.c, source: s.source, channels: s.channels, ai: createAI(s.c) });
    assert.match(await restarted.handle(`approve ${id}`, { ...s.ctx, messageId: randomUUID() }), /cannot be sent again/);
  } finally { db2.close(); }
  assert.equal(readdirSync(outbox).length, 1);
});

test('edit invalidates old approval and creates a newly reviewable draft', async t => {
  const s = setup(t);
  const old = draftId(await s.ask('draft lead-012'));
  const id = draftId(await s.ask(`edit ${old} Hi Robin, would you like to discuss sponsorship?`));
  assert.notEqual(old, id);
  assert.match(await s.ask(`approve ${old}`), /superseded/);
  assert.match(await s.ask(`show ${id}`), /Hi Robin/);
  assert.match(await s.ask(`approve ${id}`), /preview saved/);
});

test('source changes and expiration block sending', async t => {
  const s = setup(t);
  const id = draftId(await s.ask('draft lead-012'));
  s.c.fixture.leads.find(l => l.id === 'lead-012').address = 'changed@example.com';
  assert.match(await s.ask(`approve ${id}`), /details changed/);
  s.db.prepare('UPDATE drafts SET created=0 WHERE id=?').run(id);
  assert.match(await s.ask(`approve ${id}`), /expired/);
});

test('provider failure becomes uncertain and blocks a second attempt', async t => {
  let attempts = 0;
  const s = setup(t, { channels: { check() {}, async send() { attempts++; throw new Error('Network timeout'); } } });
  const id = draftId(await s.ask('draft lead-012'));
  assert.match(await s.ask(`approve ${id}`), /uncertain/);
  assert.match(await s.ask(`approve ${id}`), /cannot be sent again/);
  assert.match(await s.ask('draft lead-012'), /active draft/);
  assert.equal(attempts, 1);
});

test('source write-back retry never repeats a successful provider send', async t => {
  let attempts = 0, updates = 0;
  const fixture = JSON.parse(readFileSync('demo/fixtures.json', 'utf8'));
  const s = setup(t, { source: { async read() { return fixture.leads; }, async markContacted() { if (++updates === 1) throw new Error('Unavailable'); } },
    channels: { check() {}, async send() { attempts++; return { status: 'accepted', providerId: 'smtp-123' }; } } });
  const id = draftId(await s.ask('draft lead-012'));
  assert.match(await s.ask(`approve ${id}`), /status update failed/);
  assert.match(await s.ask('sync-status'), /Updated 1/);
  assert.match(await s.ask(`approve ${id}`), /cannot be sent again/);
  assert.equal(attempts, 1);
  assert.equal(updates, 2);
});

test('replayed and concurrent approval events produce only one provider attempt', async t => {
  let attempts = 0;
  const s = setup(t, { channels: { check() {}, async send() { attempts++; return { status: 'preview', file: 'test.eml' }; } } });
  const id = draftId(await s.ask('draft lead-012'));
  const responses = await Promise.all([s.ask(`approve ${id}`, { messageId: 'same' }), s.ask(`approve ${id}`, { messageId: 'same' }), s.ask(`approve ${id}`)]);
  assert.equal(attempts, 1);
  assert.ok(responses.some(r => r.includes('preview saved')));
});

test('AI suggestions cannot authorize sending', async t => {
  const s = setup(t, { ai: { async intent() { return { action: 'approve', lead_id: 'lead-001' }; } } });
  assert.match(await s.ask('yes go ahead'), /Approval must name/);
  assert.equal(s.db.prepare('SELECT count(*) AS n FROM drafts').get().n, 0);
});

test('live mode refuses terminal approval and reserved mock recipients', async t => {
  const s = setup(t, { env: { SEND_MODE: 'live' } });
  const draft = { mode: 'live', from: s.c.from, channel: 'imessage', to: '+12025550143' };
  assert.throws(() => s.channels.check(draft), /fictional leads/);
  const response = await s.ask('draft lead-012', { terminal: true, actor: 'local-organizer' });
  assert.match(await s.ask(`approve ${draftId(response)}`, { terminal: true, actor: 'local-organizer' }), /require approval.*Spectrum/);
});

test('LinkedIn remains unsent and contract-review leads are not pitched again', async t => {
  const s = setup(t);
  assert.match(await s.ask('draft lead-004'), /not appropriate/);
  const id = draftId(await s.ask('draft lead-014'));
  assert.match(await s.ask(`approve ${id}`), /manual handoff/);
  assert.equal(s.db.prepare('SELECT status FROM drafts WHERE id=?').get(id).status, 'pending');
});

test('Sheets parsing validates addresses and Notion normalizes property types', () => {
  const lead = JSON.parse(readFileSync('demo/fixtures.json', 'utf8')).leads[0];
  const headers = Object.keys(lead);
  assert.equal(parseSheet([headers, Object.values(lead)])[0].id, 'lead-001');
  assert.throws(() => parseSheet([headers, Object.values({ ...lead, address: 'bad\nBcc: x@y.com' })]), /Invalid email/);
  assert.throws(() => parseSheet([headers, Object.values(lead), Object.values(lead)]), /unique/);
  assert.equal(notionText({ type: 'select', select: { name: 'ready' } }), 'ready');
  assert.equal(notionText({ type: 'title', title: [{ plain_text: 'Company' }] }), 'Company');
});

test('Spectrum adapter accepts only inbound organizer DMs, including threaded replies', () => {
  const space = { id: 'dm', phone: 'shared', type: 'dm' };
  const message = { id: 'message', platform: 'imessage', direction: 'inbound', sender: { id: '+12025550100' }, content: { type: 'text', text: 'leads' } };
  const organizers = ['+12025550100'];
  assert.equal(organizerInput(space, message, organizers).text, 'leads');
  assert.equal(organizerInput({ ...space, type: 'group' }, message, organizers), null);
  assert.equal(organizerInput(space, { ...message, direction: 'outbound' }, organizers), null);
  assert.equal(organizerInput(space, { ...message, sender: undefined }, organizers), null);
  assert.equal(organizerInput(space, { ...message, content: { type: 'reply', content: message.content } }, organizers).text, 'leads');
});

test('Notion reads every page and writes only the contacted status after checking identity', async () => {
  const c = config({ LEAD_SOURCE: 'notion', NOTION_TOKEN: 'test-token', NOTION_DATA_SOURCE_ID: 'source-id' });
  const leads = c.fixture.leads.filter(l => l.status === 'ready').slice(0, 2);
  const page = (lead, id) => ({ id, properties: Object.fromEntries(Object.entries(lead).map(([key, value]) => [key,
    { type: 'rich_text', rich_text: [{ plain_text: value }] }])) });
  const pages = leads.map((l, i) => page(l, `page-${i}`));
  const calls = [];
  const source = createSource(c, async (url, init) => {
    calls.push({ url, init });
    let body;
    if (init.method === 'GET') body = pages[0];
    else if (init.method === 'PATCH') body = {};
    else body = calls.length === 1 ? { results: [pages[0]], has_more: true, next_cursor: 'next' } : { results: [pages[1]], has_more: false };
    return { ok: true, async json() { return body; } };
  });
  const imported = await source.read();
  assert.equal(imported.length, 2);
  assert.equal(JSON.parse(calls[1].init.body).start_cursor, 'next');
  await source.markContacted(imported[0]);
  assert.equal(calls[2].init.method, 'GET');
  assert.deepEqual(JSON.parse(calls[3].init.body), { properties: { status: { rich_text: [{ text: { content: 'contacted' } }] } } });
});

test('AI response validation rejects malformed drafts before approval', async () => {
  const c = config({ OPENAI_API_KEY: 'test-key' });
  let request;
  const ai = createAI(c, async (url, init) => {
    request = JSON.parse(init.body);
    return { ok: true, async json() { return { choices: [{ message: { content: JSON.stringify({ subject: 'bad\r\nsubject', body: 'message', reason: 'fit' }) } }] }; } };
  });
  await assert.rejects(() => ai.draft(c.fixture.leads[0]), /one line/);
  assert.equal(request.tools, undefined);
  assert.equal(request.response_format.type, 'json_object');
});
