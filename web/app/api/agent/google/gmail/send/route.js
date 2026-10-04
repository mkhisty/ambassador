import { randomUUID } from 'node:crypto';
import { configured, normalizePhone } from '../../../../../../lib/auth.mjs';
import { agentAuthorized } from '../../../../../../lib/agent-context.mjs';
import { database } from '../../../../../../lib/db.mjs';
import { googleAccessToken } from '../../../../../../lib/google.mjs';
import { readObject } from '../../../../../../lib/files.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const privateHeaders={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
const SEND_SCOPE='https://www.googleapis.com/auth/gmail.send';

function validate(input) {
  const reviewId=String(input.reviewId||''),proposal=input.proposal||{};
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reviewId))throw Object.assign(new Error('A valid review ID is required.'),{status:400});
  const recipient=String(proposal.recipient||'').trim(),subject=String(proposal.subject||'').trim(),body=String(proposal.body||'').trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)||/[\r\n]/.test(recipient)||recipient.length>500||!subject||subject.length>500||/[\r\n]/.test(subject)||!body||body.length>20000)throw Object.assign(new Error('Check recipient, subject, and message length.'),{status:400});
  const emails=value=>Array.isArray(value)&&value.length<=20&&value.every(item=>typeof item==='string'&&item.length<=500&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)&&!/[\r\n]/.test(item));
  const attachmentRefs=proposal.attachmentRefs||[];
  if(!emails(proposal.cc||[])||!emails(proposal.bcc||[])||!Array.isArray(attachmentRefs)||attachmentRefs.length>5||attachmentRefs.some(id=>typeof id!=='string'||id.length>100))throw Object.assign(new Error('Invalid CC, BCC, or attachment references.'),{status:400});
  return {reviewId,proposal:{recipient,subject,body,cc:proposal.cc||[],bcc:proposal.bcc||[],attachmentRefs,replyTo:proposal.replyTo||''}};
}

function encodedHeader(value){return `=?UTF-8?B?${Buffer.from(value,'utf8').toString('base64')}?=`;}
function wrappedBase64(bytes){return bytes.toString('base64').replace(/.{1,76}/g,'$&\r\n').trimEnd();}
async function rawMessage(sql,phone,proposal) {
  const headers=[`To: ${proposal.recipient}`,`Subject: ${encodedHeader(proposal.subject)}`];
  if(proposal.cc.length)headers.push(`Cc: ${proposal.cc.join(', ')}`);
  if(proposal.bcc.length)headers.push(`Bcc: ${proposal.bcc.join(', ')}`);
  if(proposal.replyTo){if(typeof proposal.replyTo!=='string'||proposal.replyTo.length>500||/[\r\n]/.test(proposal.replyTo)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(proposal.replyTo))throw Object.assign(new Error('Invalid reply-to address.'),{status:400});headers.push(`Reply-To: ${proposal.replyTo}`);}
  if(!proposal.attachmentRefs.length)return Buffer.from(`${headers.join('\r\n')}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrappedBase64(Buffer.from(proposal.body,'utf8'))}`,'utf8').toString('base64url');
  const boundary=`ambassador_${randomUUID().replaceAll('-','')}`;
  const parts=[];
  parts.push(`--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrappedBase64(Buffer.from(proposal.body,'utf8'))}`);
  let total=0;
  for(const ref of new Set(proposal.attachmentRefs)){
    const [file]=await sql`SELECT id,name,mime,size,object_key,encode(content,'base64') AS content FROM ambassador_documents WHERE id=${ref} AND owner_phone_number=${phone}`;
    if(!file)throw Object.assign(new Error('One or more attachments are unavailable for this account.'),{status:403});
    const bytes=file.object_key?await readObject(file.object_key):Buffer.from(file.content,'base64');
    total+=bytes.length;if(bytes.length!==file.size||total>10*1024*1024)throw Object.assign(new Error('Attachments exceed the allowed email size.'),{status:413});
    parts.push(`--${boundary}\r\nContent-Type: ${file.mime}; name="${file.name.replace(/["\\]/g,'_')}"\r\nContent-Disposition: attachment; filename="${file.name.replace(/["\\]/g,'_')}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrappedBase64(bytes)}`);
  }
  const mime=`${headers.join('\r\n')}\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n${parts.join('\r\n')}\r\n--${boundary}--`;
  return Buffer.from(mime,'utf8').toString('base64url');
}

export async function POST(request) {
  if(!agentAuthorized(request))return Response.json({error:'Agent authentication required.'},{status:401,headers:privateHeaders});
  if(!configured())return Response.json({error:'Neon is not connected.'},{status:503,headers:privateHeaders});
  let claimed=null,sql,phone,reviewId;
  try {
    const requestText=await request.text();if(Buffer.byteLength(requestText)>30000)return Response.json({error:'Request too large.'},{status:413,headers:privateHeaders});
    const input=JSON.parse(requestText);phone=normalizePhone(input.phoneNumber);({reviewId}=validate(input));sql=database();
    const [prior]=await sql`SELECT status,google_message_id FROM ambassador_outreach_drafts WHERE owner_phone_number=${phone} AND review_id=${reviewId}`;
    if(prior?.status==='sent')return Response.json({ok:true,status:'accepted',reviewId,messageId:prior.google_message_id},{headers:privateHeaders});
    if(prior&&prior.status!=='draft')return Response.json({error:prior.status==='send_unknown'?'Gmail outcome is unknown; check Sent before any retry.':'Email review is unavailable or already being processed.',status:prior.status},{status:409,headers:privateHeaders});
    const {accessToken}=await googleAccessToken(sql,phone,SEND_SCOPE);
    const proposal=validate(input).proposal,encodedMime=await rawMessage(sql,phone,proposal);
    const rows=await sql`UPDATE ambassador_outreach_drafts SET recipient=${proposal.recipient},subject=${proposal.subject},body=${proposal.body},cc=${JSON.stringify(proposal.cc)}::jsonb,bcc=${JSON.stringify(proposal.bcc)}::jsonb,attachment_refs=${JSON.stringify(proposal.attachmentRefs)}::jsonb,reply_to=${proposal.replyTo},status='sending',approved_at=now(),send_error=NULL,updated_at=now() WHERE owner_phone_number=${phone} AND review_id=${reviewId} AND status='draft' RETURNING id,sponsor_id`;
    if(!rows.length)return Response.json({error:'Email review is unavailable, already decided, or already sent.'},{status:409,headers:privateHeaders});
    claimed=rows[0];
    let response,result;
    try {
      response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},body:JSON.stringify({raw:encodedMime}),signal:AbortSignal.timeout(20000)});
      result=await response.json();
    }catch(error){
      await sql`UPDATE ambassador_outreach_drafts SET status='send_unknown',send_error='Provider outcome unknown; inspect Gmail Sent before retrying.',updated_at=now() WHERE id=${claimed.id} AND owner_phone_number=${phone} AND status='sending'`;
      return Response.json({error:'Gmail outcome is unknown. Check Sent before taking further action.',status:'send_unknown'},{status:502,headers:privateHeaders});
    }
    if(!response.ok||!result.id){
      if(response.status>=500){
        await sql`UPDATE ambassador_outreach_drafts SET status='send_unknown',send_error='Gmail response was inconclusive; inspect Sent before retrying.',updated_at=now() WHERE id=${claimed.id} AND owner_phone_number=${phone} AND status='sending'`;
        return Response.json({error:'Gmail outcome is unknown. Check Sent before taking further action.',status:'send_unknown'},{status:502,headers:privateHeaders});
      }
      await sql`UPDATE ambassador_outreach_drafts SET status='failed',send_error=${`Gmail rejected send (${response.status}).`},updated_at=now() WHERE id=${claimed.id} AND owner_phone_number=${phone} AND status='sending'`;
      return Response.json({error:'Gmail rejected the approved email.',status:'failed'},{status:502,headers:privateHeaders});
    }
    const activityId=randomUUID();
    const recorded=await sql`WITH sent AS (UPDATE ambassador_outreach_drafts SET status='sent',google_message_id=${result.id},sent_at=now(),send_error=NULL,updated_at=now() WHERE id=${claimed.id} AND owner_phone_number=${phone} AND status='sending' RETURNING sponsor_id,recipient,subject,google_message_id) INSERT INTO ambassador_activities(id,sponsor_id,owner_phone_number,kind,data) SELECT ${activityId},sponsor_id,${phone},'email_sent',jsonb_build_object('text','Gmail accepted approved email','recipient',recipient,'subject',subject,'provider','gmail','providerMessageId',google_message_id,'providerAccepted',true,'actor',${phone}) FROM sent RETURNING id`;
    if(!recorded.length)throw new Error('Gmail accepted send but result record is missing.');
    return Response.json({ok:true,status:'accepted',reviewId,messageId:result.id},{headers:privateHeaders});
  }catch(error){
    if(claimed&&sql&&phone){try{await sql`UPDATE ambassador_outreach_drafts SET status='send_unknown',send_error='Send result could not be recorded; inspect Gmail Sent before retrying.',updated_at=now() WHERE id=${claimed.id} AND owner_phone_number=${phone} AND status='sending'`;}catch{}}
    if(error instanceof SyntaxError)return Response.json({error:'Invalid JSON.'},{status:400,headers:privateHeaders});
    console.error('Agent Gmail send failed:',error.code||error.status||error.name);
    return Response.json({error:error.message||'Could not send approved email.'},{status:error.status||503,headers:privateHeaders});
  }
}
