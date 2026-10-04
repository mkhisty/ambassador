import { agentAuthorized } from '../../../../lib/agent-context.mjs';
import { normalizePhone } from '../../../../lib/auth.mjs';
import { database } from '../../../../lib/db.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  if (!agentAuthorized(request)) return Response.json({ error: 'Agent authentication required.' }, { status: 401 });
  try {
    const text = await request.text();
    if (Buffer.byteLength(text) > 30000) return Response.json({ error: 'Request too large.' }, { status: 413 });
    const body = JSON.parse(text);
    const phone = normalizePhone(body.phoneNumber);
    const contactPhone = body.contactPhone == null ? phone : normalizePhone(body.contactPhone);
    if (typeof body.eventId !== 'string' || !/^[\w-]{1,180}$/.test(body.eventId)) throw new Error('Invalid event ID.');
    if (!['inbound', 'outbound'].includes(body.direction)) throw new Error('Invalid message direction.');
    if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 20000) throw new Error('Message text is required.');
    if (body.providerMessageId != null && (typeof body.providerMessageId !== 'string' || body.providerMessageId.length > 200)) throw new Error('Invalid provider message ID.');
    if (body.reviewId != null && (typeof body.reviewId !== 'string' || body.reviewId.length > 200)) throw new Error('Invalid review ID.');

    const sql = database();
    const [existing] = await sql`SELECT owner_phone_number FROM ambassador_activities WHERE id=${body.eventId}`;
    if (existing) {
      if (existing.owner_phone_number !== phone) return Response.json({ error: 'Event ID already belongs to another account.' }, { status: 409 });
      return Response.json({ ok: true, duplicate: true });
    }

    const candidates = await sql`SELECT id,data FROM ambassador_sponsors WHERE data->>'channel'='imessage'`;
    const samePhone = (value, expected) => {
      try { return normalizePhone(value) === expected; } catch { return false; }
    };
    const matches = candidates.filter(row => {
      const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      return data?.channel === 'imessage' && samePhone(data?.phone, contactPhone);
    });
    const sponsorId = matches.length === 1 ? matches[0].id : null;
    const acceptedAt = new Date().toISOString();
    const record = {
      channel: 'imessage', direction: body.direction,
      outcome: body.direction === 'outbound' ? 'provider_accepted' : 'received',
      text: body.text.trim(), providerMessageId: body.providerMessageId || null,
      reviewId: body.reviewId || null, associatedContact: Boolean(sponsorId), acceptedAt,
    };
    await sql`INSERT INTO ambassador_activities(id,sponsor_id,owner_phone_number,kind,data)
      VALUES(${body.eventId},${sponsorId},${phone},'imessage',${JSON.stringify(record)}::jsonb)
      ON CONFLICT(id) DO NOTHING`;
    return Response.json({ ok: true, duplicate: false, associatedContact: Boolean(sponsorId) });
  } catch (error) {
    if (error instanceof SyntaxError) return Response.json({ error: 'Invalid JSON.' }, { status: 400 });
    if (error.message?.startsWith('Enter a US') || error.message?.startsWith('Invalid') || error.message?.startsWith('Message')) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error('Agent outreach write failed:', error.code || error.name);
    return Response.json({ error: 'Could not record outreach event.' }, { status: 503 });
  }
}
