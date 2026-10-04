import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { authorized, configured, sessionPhone } from '../../../../../lib/auth.mjs';
import { database } from '../../../../../lib/db.mjs';
import { googleAccessToken } from '../../../../../lib/google.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const GMAIL_SCOPE='https://www.googleapis.com/auth/gmail.compose';

function rawMessage({to,subject,body}) {
  const encodedSubject=`=?UTF-8?B?${Buffer.from(subject,'utf8').toString('base64')}?=`;
  const mime=`To: ${to}\r\nSubject: ${encodedSubject}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${body.replace(/\r?\n/g,'\r\n')}`;
  return Buffer.from(mime,'utf8').toString('base64url');
}

export async function POST(request) {
  if (!configured()) return NextResponse.json({error:'Neon is not connected.'},{status:503});
  if (!authorized(request)) return NextResponse.json({error:'Sign in before creating a Gmail draft.'},{status:401});
  try {
    const text=await request.text();if(Buffer.byteLength(text)>25000)return NextResponse.json({error:'Draft is too large.'},{status:413});
    const input=JSON.parse(text),contactId=String(input.contactId||''),to=String(input.to||'').trim(),subject=String(input.subject||'').trim(),body=String(input.body||'').trim();
    if(!contactId||contactId.length>100||to.length>500||!/^\S+@\S+\.\S+$/.test(to)||/[\r\n]/.test(to)||subject.length>500||/[\r\n]/.test(subject)||!body||body.length>20000)return NextResponse.json({error:'Check contact, recipient, subject, and message length.'},{status:400});
    const sql=database(),phone=sessionPhone(request),id=randomUUID();
    const rows=await sql`INSERT INTO ambassador_outreach_drafts(id,owner_phone_number,sponsor_id,recipient,subject,body) SELECT ${id},${phone},s.id,${to},${subject},${body} FROM ambassador_sponsors s WHERE s.id=${contactId} ON CONFLICT(owner_phone_number,sponsor_id) WHERE status='draft' AND review_id IS NULL DO UPDATE SET recipient=excluded.recipient,subject=excluded.subject,body=excluded.body,updated_at=now() RETURNING id,google_draft_id`;
    if(!rows.length)return NextResponse.json({error:'Contact not found.'},{status:404});
    const saved=rows[0],{accessToken}=await googleAccessToken(sql,phone,GMAIL_SCOPE),raw=rawMessage({to,subject,body});
    const endpoint=saved.google_draft_id?`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(saved.google_draft_id)}`:'https://gmail.googleapis.com/gmail/v1/users/me/drafts';
    const response=await fetch(endpoint,{method:saved.google_draft_id?'PUT':'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},body:JSON.stringify({...(saved.google_draft_id?{id:saved.google_draft_id}:{}),message:{raw}}),signal:AbortSignal.timeout(15000)});
    const result=await response.json();
    if(!response.ok||!result.id){console.error('Gmail draft request failed:',response.status);return NextResponse.json({error:'Draft saved in Ambassador, but Gmail could not create it. Try again.'},{status:502});}
    await sql`UPDATE ambassador_outreach_drafts SET google_draft_id=${result.id},updated_at=now() WHERE id=${saved.id} AND owner_phone_number=${phone}`;
    return NextResponse.json({ok:true,draftId:saved.id,gmailDraftId:result.id,url:`https://mail.google.com/mail/u/0/#drafts/${encodeURIComponent(result.id)}`},{headers:{'Cache-Control':'no-store'}});
  } catch(error) {
    if(error instanceof SyntaxError)return NextResponse.json({error:'Invalid JSON.'},{status:400});
    console.error('Gmail draft creation failed:',error.code||error.status||error.name);
    return NextResponse.json({error:error.message||'Could not create Gmail draft.'},{status:error.status||503});
  }
}
