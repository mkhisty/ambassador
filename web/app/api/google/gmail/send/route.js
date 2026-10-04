import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { authorized, configured, sessionPhone } from '../../../../../lib/auth.mjs';
import { database } from '../../../../../lib/db.mjs';
import { googleAccessToken } from '../../../../../lib/google.mjs';
import { verboseLog, providerError, errorInfo } from '../../../../../lib/diagnostics.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const GMAIL_SEND_SCOPE='https://www.googleapis.com/auth/gmail.send';

function rawMessage({recipient,subject,body}) {
  const encodedSubject=`=?UTF-8?B?${Buffer.from(subject,'utf8').toString('base64')}?=`;
  const mime=`To: ${recipient}\r\nSubject: ${encodedSubject}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${body.replace(/\r?\n/g,'\r\n')}`;
  return Buffer.from(mime,'utf8').toString('base64url');
}

export async function POST(request) {
  if (!configured()) return NextResponse.json({error:'Email sending is temporarily unavailable.'},{status:503});
  if (!authorized(request)) return NextResponse.json({error:'Sign in before approving and sending email.'},{status:401});
  let claimed=null,sql,phone;
  try {
    const raw=await request.text();if(Buffer.byteLength(raw)>1000)return NextResponse.json({error:'Invalid approval request.'},{status:413});
    const input=JSON.parse(raw),draftId=String(input.draftId||'');
    if(!/^[0-9a-f-]{36}$/i.test(draftId))return NextResponse.json({error:'Choose a saved draft to approve.'},{status:400});
    sql=database();phone=sessionPhone(request);
    const {accessToken}=await googleAccessToken(sql,phone,[GMAIL_SEND_SCOPE,'https://www.googleapis.com/auth/gmail.compose']);
    const rows=await sql`UPDATE ambassador_outreach_drafts SET status='sending',approved_at=now(),send_error=NULL,updated_at=now() WHERE id=${draftId} AND owner_phone_number=${phone} AND status='draft' RETURNING id,sponsor_id,google_draft_id,recipient,subject,body`;
    if(!rows.length)return NextResponse.json({error:'Draft is unavailable, not in Gmail, or already approved.'},{status:409});
    claimed=rows[0];
    if(claimed.recipient.length>500||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claimed.recipient)||/[\r\n]/.test(claimed.recipient)||claimed.subject.length>500||/[\r\n]/.test(claimed.subject)||!claimed.body||claimed.body.length>20000){
      await sql`UPDATE ambassador_outreach_drafts SET status='draft',approved_at=NULL,send_error='Draft has invalid recipient or message fields.',updated_at=now() WHERE id=${draftId} AND owner_phone_number=${phone} AND status='sending'`;
      claimed=null;
      return NextResponse.json({error:'Edit the saved draft before approving it.'},{status:400});
    }
    let response,result;
    try {
      if(claimed.google_draft_id){
        response=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(claimed.google_draft_id)}`,{method:'PUT',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},body:JSON.stringify({id:claimed.google_draft_id,message:{raw:rawMessage(claimed)}}),signal:AbortSignal.timeout(15000)});
      } else {
        response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts',{method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},body:JSON.stringify({message:{raw:rawMessage(claimed)}}),signal:AbortSignal.timeout(15000)});
      }
      result=await response.json();
      if(!response.ok||!result.id)throw Object.assign(new Error('Gmail rejected the draft update.'),{providerFailure:true,status:response.status});
      claimed.google_draft_id=result.id;
      await sql`UPDATE ambassador_outreach_drafts SET google_draft_id=${result.id},updated_at=now() WHERE id=${draftId} AND owner_phone_number=${phone} AND status='sending'`;
      response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts/send',{method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},body:JSON.stringify({id:claimed.google_draft_id}),signal:AbortSignal.timeout(15000)});
      result=await response.json();
    } catch(error) {
      if(error.providerFailure){
        await sql`UPDATE ambassador_outreach_drafts SET status='draft',approved_at=NULL,send_error=${`Gmail rejected the draft update (${error.status}).`},updated_at=now() WHERE id=${draftId} AND owner_phone_number=${phone} AND status='sending'`;
        return NextResponse.json({error:'Gmail could not update the reviewed draft, so it was not sent.',status:'draft'},{status:502});
      }
      await sql`UPDATE ambassador_outreach_drafts SET status='send_unknown',send_error='Provider outcome unknown; check Gmail before retrying.',updated_at=now() WHERE id=${draftId} AND owner_phone_number=${phone} AND status='sending'`;
      return NextResponse.json({error:'Gmail outcome is unknown. Check Sent before taking further action.',status:'send_unknown'},{status:502});
    }
    if(!response.ok||!result.id) {
      verboseLog('gmail.browser_send_rejected',{draftId,provider:providerError(result,response.status)});
      if(response.status>=500){
        await sql`UPDATE ambassador_outreach_drafts SET status='send_unknown',send_error='Gmail response was inconclusive; check Sent before retrying.',updated_at=now() WHERE id=${draftId} AND owner_phone_number=${phone} AND status='sending'`;
        return NextResponse.json({error:'Gmail outcome is unknown. Check Sent before taking further action.',status:'send_unknown'},{status:502});
      }
      const failure=`Gmail rejected send (${response.status}).`;
      await sql`UPDATE ambassador_outreach_drafts SET status='failed',send_error=${failure},updated_at=now() WHERE id=${draftId} AND owner_phone_number=${phone} AND status='sending'`;
      return NextResponse.json({error:'Gmail rejected the approved email. Draft remains recorded; review it before creating another send attempt.',status:'failed'},{status:502});
    }
    const activityId=randomUUID();
    await sql`WITH sent AS (UPDATE ambassador_outreach_drafts SET status='sent',google_message_id=${result.id},sent_at=now(),send_error=NULL,updated_at=now() WHERE id=${draftId} AND owner_phone_number=${phone} AND status='sending' RETURNING sponsor_id,recipient,subject,google_message_id) INSERT INTO ambassador_activities(id,sponsor_id,owner_phone_number,kind,data) SELECT ${activityId},sponsor_id,${phone},'email_sent',jsonb_build_object('text','Approved email sent','recipient',recipient,'subject',subject,'provider','gmail','providerMessageId',google_message_id,'actor',${phone}::text) FROM sent RETURNING id`;
    return NextResponse.json({ok:true,status:'sent',messageId:result.id},{headers:{'Cache-Control':'no-store'}});
  } catch(error) {
    verboseLog('gmail.browser_send_failed',{error:errorInfo(error)});
    if(claimed&&sql&&phone) {
      try { await sql`UPDATE ambassador_outreach_drafts SET status='send_unknown',send_error='Provider accepted or outcome could not be recorded; check Gmail before retrying.',updated_at=now() WHERE id=${claimed.id} AND owner_phone_number=${phone} AND status='sending'`; } catch {}
    }
    if(error instanceof SyntaxError)return NextResponse.json({error:'Invalid JSON.'},{status:400});
    console.error('Approved Gmail send failed:',error.code||error.status||error.name);
    return NextResponse.json({error:error.message||'Could not approve and send email.'},{status:error.status||503});
  }
}
