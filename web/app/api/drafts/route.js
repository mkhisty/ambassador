import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { authorized, configured, sessionPhone } from '../../../lib/auth.mjs';
import { database } from '../../../lib/db.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';

function denied(request) {
  if(!configured())return NextResponse.json({error:'Neon is not connected.'},{status:503});
  if(!authorized(request))return NextResponse.json({error:'Sign in to access saved drafts.'},{status:401});
}

export async function GET(request) {
  const error=denied(request);if(error)return error;
  const contactId=new URL(request.url).searchParams.get('contactId');
  if(contactId&&contactId.length>100)return NextResponse.json({error:'Invalid contact.'},{status:400});
  try {
    const sql=database(),owner=sessionPhone(request);
    const rows=await sql`SELECT d.id,d.sponsor_id,d.recipient,d.subject,d.body,d.status,d.created_at,d.updated_at,s.data->>'company' AS company,s.data->>'contact' AS contact FROM ambassador_outreach_drafts d JOIN ambassador_sponsors s ON s.id=d.sponsor_id WHERE d.owner_phone_number=${owner} AND (${contactId||null}::text IS NULL OR d.sponsor_id=${contactId||null}) ORDER BY d.updated_at DESC LIMIT 100`;
    return NextResponse.json({drafts:rows.map(row=>({...row,created_at:new Date(row.created_at).toISOString(),updated_at:new Date(row.updated_at).toISOString()}))},{headers:{'Cache-Control':'no-store'}});
  }catch(error){console.error('Draft read failed:',error.code||error.name);return NextResponse.json({error:'Could not load saved drafts. Run npm run db:migrate.'},{status:503});}
}

export async function POST(request) {
  const error=denied(request);if(error)return error;
  try {
    const raw=await request.text();if(Buffer.byteLength(raw)>25000)return NextResponse.json({error:'Draft is too large.'},{status:413});
    const input=JSON.parse(raw),contactId=String(input.contactId||''),recipient=String(input.recipient||'').trim(),subject=String(input.subject||'').trim(),body=String(input.body||'').trim();
    if(!contactId||contactId.length>100||recipient.length>500||subject.length>500||!body||body.length>20000)return NextResponse.json({error:'Check contact, recipient, subject, and message length.'},{status:400});
    const sql=database(),owner=sessionPhone(request),id=randomUUID();
    const rows=await sql`INSERT INTO ambassador_outreach_drafts(id,owner_phone_number,sponsor_id,recipient,subject,body) SELECT ${id},${owner},s.id,${recipient},${subject},${body} FROM ambassador_sponsors s WHERE s.id=${contactId} ON CONFLICT(owner_phone_number,sponsor_id) WHERE status='draft' DO UPDATE SET recipient=excluded.recipient,subject=excluded.subject,body=excluded.body,updated_at=now() RETURNING id,sponsor_id,recipient,subject,body,status,created_at,updated_at`;
    if(!rows.length)return NextResponse.json({error:'Contact not found.'},{status:404});
    return NextResponse.json({draft:rows[0]},{headers:{'Cache-Control':'no-store'}});
  }catch(error){if(error instanceof SyntaxError)return NextResponse.json({error:'Invalid JSON.'},{status:400});console.error('Draft save failed:',error.code||error.name);return NextResponse.json({error:'Could not save draft. Run npm run db:migrate.'},{status:503});}
}
