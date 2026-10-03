import { randomBytes } from 'node:crypto';
import { draftRow, leadRows } from './store.mjs';

const help = 'Try: leads | draft [lead-id] | status | contracts | inbox | sync-status\nReview: show <draft-id> | approve <draft-id> | reject <draft-id>\nEdit: edit <draft-id> <replacement message body>\nAI revision: revise <draft-id> <instructions>\nEach draft expires after 24 hours. Approval must name the exact draft.';
const now = () => Date.now();

export function createAgent({ db, c, source, ai, channels }) {
  function history(context, role, text) {
    db.prepare('INSERT INTO history(actor,conversation,role,content) VALUES(?,?,?,?)').run(context.actor, context.conversation, role, text);
  }
  function listDrafts() {
    return db.prepare('SELECT id,lead_id,status,result FROM drafts ORDER BY created DESC LIMIT 20').all();
  }
  async function sync() {
    const leads = await source.read();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('DELETE FROM leads');
      for (const lead of leads) db.prepare('INSERT INTO leads(id,data) VALUES(?,?)').run(lead.id, JSON.stringify(lead));
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return leads;
  }
  function owned(id, context) {
    const draft = draftRow(db, id);
    if (!draft || draft.actor !== context.actor || draft.conversation !== context.conversation) throw new Error('Draft not found in this organizer conversation.');
    return draft;
  }
  function pending(draft) {
    if (draft.status !== 'pending') throw new Error(`Draft ${draft.id} is ${draft.status}; it cannot be sent again.`);
    if (now() - draft.created > 86400000) {
      db.prepare("UPDATE drafts SET status='expired' WHERE id=? AND status='pending'").run(draft.id);
      throw new Error('Draft expired. Prepare a new draft.');
    }
  }
  function render(draft) {
    const d = draft.data;
    return `${draft.id} · ${draft.status} · ${d.mode.toUpperCase()}\n${d.reason}\nChannel: ${d.channel}\nFrom: ${d.channel === 'email' ? d.from : 'Spectrum iMessage line'}\nTo: ${d.to}${d.to !== d.lead.address ? ` (test inbox; original lead: ${d.lead.address})` : ''}\nSubject: ${d.subject}\n\n${d.body}\n\n${d.channel === 'linkedin' ? 'Manual LinkedIn handoff only; nothing sent.' : `Reply approve ${draft.id} to ${d.mode === 'preview' ? 'save an offline preview (no delivery)' : 'send this exact message'}.`}\nOr: edit ${draft.id} <replacement body> / reject ${draft.id}`;
  }
  function insertDraft(lead, content, context, oldId) {
    const id = 'd-' + randomBytes(6).toString('hex');
    const data = { ...content, channel: lead.channel, to: lead.channel === 'email' ? c.testTo || lead.address : lead.address,
      from: c.from, mode: c.mode, lead, source: c.source, sourceKey: c.sourceKey, line: c.env.IMESSAGE_LINE || '' };
    db.exec('BEGIN IMMEDIATE');
    try {
      if (oldId) {
        const update = db.prepare("UPDATE drafts SET status='superseded' WHERE id=? AND status='pending'").run(oldId);
        if (!update.changes) throw new Error('Draft changed while editing. Check status.');
      }
      db.prepare('INSERT INTO drafts(id,lead_id,actor,conversation,data,status,created) VALUES(?,?,?,?,?,?,?)')
        .run(id, lead.id, context.actor, context.conversation, JSON.stringify(data), 'pending', now());
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return render(draftRow(db, id));
  }
  async function prepare(id, context) {
    const leads = await sync();
    db.prepare("UPDATE drafts SET status='expired' WHERE status='pending' AND created<?").run(now() - 86400000);
    const blocked = new Set(db.prepare("SELECT lead_id FROM drafts WHERE status IN ('pending','sending','uncertain','accepted')").all().map(d => d.lead_id));
    const lead = id ? leads.find(l => l.id === id) : leads.find(l => l.status === 'ready' && !blocked.has(l.id));
    if (!lead) return 'No matching ready lead. Use leads or status.';
    if (lead.status !== 'ready') return `${lead.id} is ${lead.status}; initial outreach is not appropriate.`;
    if (blocked.has(lead.id)) return 'This lead already has an active draft or send record. Use status and show <draft-id>.';
    return insertDraft(lead, await ai.draft(lead), context);
  }
  async function writeBack(draft, result) {
    if (draft.data.sourceKey !== c.sourceKey) throw new Error('Source configuration changed; status update needs review.');
    await source.markContacted(draft.data.lead);
    result.sourceUpdated = true;
    db.prepare('UPDATE drafts SET result=? WHERE id=?').run(JSON.stringify(result), draft.id);
  }
  async function revise(id, instruction, context) {
    const draft = owned(id || '', context);
    pending(draft);
    if (!instruction.trim()) return 'Provide revision instructions.';
    const content = await ai.draft(draft.data.lead, { previous: { subject: draft.data.subject, body: draft.data.body }, instruction });
    return insertDraft(draft.data.lead, content, context, draft.id);
  }
  async function approve(id, context) {
    const draft = owned(id, context);
    pending(draft);
    if (context.terminal && c.mode === 'live') throw new Error('Live sends require approval from the organizer over Spectrum iMessage.');
    channels.check(draft.data);
    if (draft.data.sourceKey !== c.sourceKey) throw new Error('Lead source changed. Reject this draft and prepare a new one.');
    const fresh = (await source.read()).find(l => l.id === draft.lead_id);
    if (!fresh || ['address', 'channel', 'ask', 'status', 'company', 'contact'].some(k => fresh[k] !== draft.data.lead[k])) {
      throw new Error('Lead details changed since drafting. Reject this draft and prepare a new one.');
    }
    const claimed = db.prepare("UPDATE drafts SET status='sending' WHERE id=? AND status='pending'").run(id);
    if (!claimed.changes) throw new Error('This draft is already being processed.');
    let result;
    try {
      result = await channels.send(id, draft.data);
    } catch {
      db.prepare("UPDATE drafts SET status='uncertain',result=? WHERE id=?").run(JSON.stringify({ note: 'Provider attempt did not complete. Inspect provider logs before any further outreach.' }), id);
      return `${id}: send outcome uncertain. No automatic retry will occur. Check the provider and local record before contacting this lead again.`;
    }
    // Persist acceptance before remote status updates so a failed write-back cannot resend.
    db.prepare('UPDATE drafts SET status=?,result=? WHERE id=?').run(result.status, JSON.stringify(result), id);
    if (result.status === 'preview') return `${id}: preview saved to data/outbox/${result.file}. No message delivered.`;
    try { await writeBack(draft, result); }
    catch { return `${id}: provider accepted the message; delivery is not confirmed. Lead-source status update failed. Run sync-status to retry that update only.`; }
    return `${id}: provider accepted the message; delivery is not confirmed. Lead status recorded.`;
  }
  async function execute(text, context) {
    const [command, id] = text.split(/\s+/);
    switch (command.toLowerCase()) {
      case 'help': return help;
      case 'leads': case 'list': {
        const leads = await sync();
        return leads.map(l => `${l.id}: ${l.company} · ${l.channel} · source: ${l.status}`).join('\n') || 'No leads found.';
      }
      case 'draft': return prepare(id, context);
      case 'show': return render(owned(id || '', context));
      case 'status': return listDrafts().map(d => `${d.id} · ${d.lead_id} · ${d.status}${d.result && JSON.parse(d.result).sourceUpdated ? ' · source updated' : ''}`).join('\n') || 'No outreach yet. Try draft.';
      case 'contracts': return JSON.stringify(c.fixture.contracts || [], null, 2) + '\nContract tracking only. No signatures or acceptance of terms.';
      case 'inbox': return db.prepare('SELECT sender,content FROM replies ORDER BY received DESC LIMIT 10').all()
        .map(r => `${r.sender}: ${r.content}`).join('\n\n') || 'No sponsor iMessage replies saved. Email/LinkedIn inbox sync is not connected.';
      case 'approve':
        if (!/^approve d-[a-f0-9]{12}$/i.test(text)) return 'Use exactly approve <draft-id> from the draft you reviewed.';
        return approve(id.toLowerCase(), context);
      case 'reject': {
        const draft = owned(id || '', context);
        pending(draft);
        db.prepare("UPDATE drafts SET status='rejected' WHERE id=? AND status='pending'").run(draft.id);
        return `${draft.id} rejected. Nothing sent.`;
      }
      case 'edit': {
        const draft = owned(id || '', context);
        pending(draft);
        const body = text.replace(/^\S+\s+\S+\s*/, '');
        if (!body || body === text || body.length > 4000) return 'Use edit <draft-id> <replacement body>, up to 4000 characters.';
        return insertDraft(draft.data.lead, { subject: draft.data.subject, body, reason: 'Organizer edited this draft; review the new approval ID.' }, context, draft.id);
      }
      case 'revise': return revise(id, text.replace(/^\S+\s+\S+\s*/, ''), context);
      case 'sync-status': {
        let count = 0;
        for (const row of listDrafts().filter(d => d.status === 'accepted')) {
          const draft = draftRow(db, row.id);
          if (!draft.result.sourceUpdated) { await writeBack(draft, draft.result); count++; }
        }
        return `Updated ${count} accepted-message source records. No outreach resent.`;
      }
      default: {
        const leads = await sync();
        const recent = db.prepare('SELECT role,content FROM history WHERE actor=? AND conversation=? ORDER BY id DESC LIMIT 8').all(context.actor, context.conversation).reverse();
        const drafts = db.prepare("SELECT id,lead_id FROM drafts WHERE actor=? AND conversation=? AND status='pending'").all(context.actor, context.conversation);
        const intent = await ai.intent(text, leads, recent, drafts);
        if (intent.action === 'draft') return prepare(intent.lead_id || undefined, context);
        if (intent.action === 'revise' && drafts.some(d => d.id === intent.draft_id)) return revise(intent.draft_id, text, context);
        if (['list', 'status', 'contracts'].includes(intent.action)) return execute(intent.action, context);
        return help;
      }
    }
  }
  return {
    async handle(text, context) {
      if (!(context.terminal && context.actor === 'local-organizer') && !c.organizers.includes(context.actor)) return null;
      if (typeof text !== 'string' || !text.trim() || text.length > 5000) return 'Send a text request under 5000 characters.';
      const key = JSON.stringify([context.actor, context.conversation, context.messageId]);
      const prior = db.prepare('SELECT response FROM inbound WHERE id=?').get(key);
      if (prior) return prior.response || 'Previous request was interrupted or is processing. Check status before continuing.';
      const inserted = db.prepare('INSERT OR IGNORE INTO inbound(id) VALUES(?)').run(key);
      if (!inserted.changes) return 'Request is already processing.';
      history(context, 'user', text);
      let response;
      try { response = await execute(text.trim(), context); }
      catch (error) { response = error.message.startsWith('UNIQUE constraint') ? 'This lead already has an active draft. Check status.' : error.message; }
      history(context, 'assistant', response);
      db.prepare('UPDATE inbound SET response=? WHERE id=?').run(response, key);
      return response;
    },
  };
}
