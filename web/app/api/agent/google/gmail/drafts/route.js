import { randomUUID } from 'node:crypto';
import { configured, normalizePhone } from '../../../../../../lib/auth.mjs';
import { agentAuthorized } from '../../../../../../lib/agent-context.mjs';
import { database } from '../../../../../../lib/db.mjs';
import { verboseEnabled, verboseLog, fingerprint, errorInfo } from '../../../../../../lib/diagnostics.mjs';
import { MAX_EMAIL_ATTACHMENTS, checkAttachmentTotal } from '../../../../../../lib/email-attachments.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const privateHeaders={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};

function validate(input) {
  const reviewId=String(input.reviewId||''),proposal=input.proposal||{};
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reviewId))throw Object.assign(new Error('A valid review ID is required.'),{status:400});
  const recipient=String(proposal.recipient||'').trim(),subject=String(proposal.subject||'').trim(),body=String(proposal.body||'').trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)||/[\r\n]/.test(recipient)||recipient.length>500||!subject||subject.length>500||/[\r\n]/.test(subject)||!body||body.length>20000)throw Object.assign(new Error('Check recipient, subject, and message length.'),{status:400});
  const emails=value=>Array.isArray(value)&&value.length<=20&&value.every(item=>typeof item==='string'&&item.length<=500&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)&&!/[\r\n]/.test(item));
  const attachmentRefs=proposal.attachmentRefs||[];
  const replyTo=proposal.replyTo||'';
  if(!emails(proposal.cc||[])||!emails(proposal.bcc||[])||!Array.isArray(attachmentRefs)||attachmentRefs.length>MAX_EMAIL_ATTACHMENTS||attachmentRefs.some(id=>typeof id!=='string'||id.length>100)||replyTo&&(typeof replyTo!=='string'||replyTo.length>500||!emails([replyTo])))throw Object.assign(new Error('Invalid CC, BCC, reply-to, or attachment references.'),{status:400});
  return {reviewId,proposal:{recipient,subject,body,cc:proposal.cc||[],bcc:proposal.bcc||[],attachmentRefs,replyTo,contactId:proposal.contactId?String(proposal.contactId):null}};
}

export async function POST(request) {
  if(!agentAuthorized(request))return Response.json({error:'Agent authentication required.'},{status:401,headers:privateHeaders});
  if(!configured())return Response.json({error:'Neon is not connected.'},{status:503,headers:privateHeaders});
  const verbose=verboseEnabled(request);
  try {
    const raw=await request.text();if(Buffer.byteLength(raw)>30000)return Response.json({error:'Request too large.'},{status:413,headers:privateHeaders});
    const input=JSON.parse(raw),phone=normalizePhone(input.phoneNumber),reviewId=String(input.reviewId||''),sql=database(),decision=input.decision||'draft';
    verboseLog('email.draft_start',{review:fingerprint(reviewId),decision,account:fingerprint(phone)},verbose);
    if(!['draft','rejected'].includes(decision))return Response.json({error:'Invalid review decision.'},{status:400,headers:privateHeaders});
    if(decision==='rejected'&&!input.proposal){
      const rows=await sql`UPDATE ambassador_outreach_drafts SET status='rejected',updated_at=now() WHERE owner_phone_number=${phone} AND review_id=${reviewId} AND status='draft' RETURNING id,review_id,status`;
      if(rows.length)return Response.json({ok:true,...rows[0]},{headers:privateHeaders});
      const existing=await sql`SELECT id,review_id,status FROM ambassador_outreach_drafts WHERE owner_phone_number=${phone} AND review_id=${reviewId} AND status='rejected'`;
      return existing.length?Response.json({ok:true,...existing[0]},{headers:privateHeaders}):Response.json({error:'Email review not found.'},{status:404,headers:privateHeaders});
    }
    const {proposal}=validate(input);
    if(decision==='rejected'&&!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reviewId))return Response.json({error:'A valid review ID is required.'},{status:400,headers:privateHeaders});
    // Contact linkage is optional bookkeeping, never a recipient allowlist.
    // An unowned/stale ID cannot attach another account's contact to this draft.
    let contactId=null;
    if(proposal.contactId){
      const rows=await sql`SELECT s.id FROM ambassador_sponsors s JOIN ambassador_user_companies c ON c.company_id=s.id WHERE s.id=${proposal.contactId} AND c.phone_number=${phone}`;
      contactId=rows[0]?.id||null;
    }
    if(!contactId){
      const rows=await sql`SELECT s.id FROM ambassador_sponsors s JOIN ambassador_user_companies c ON c.company_id=s.id WHERE c.phone_number=${phone} AND lower(s.data->>'address')=lower(${proposal.recipient}) LIMIT 1`;
      contactId=rows[0]?.id||null;
    }
    const attachments=[];
    if(proposal.attachmentRefs.length){
      for(const ref of new Set(proposal.attachmentRefs)){
        const files=await sql`SELECT id,name,mime,size::float8 AS size FROM ambassador_documents WHERE id=${ref} AND owner_phone_number=${phone}`;
        if(!files.length)return Response.json({error:'One or more attachments are unavailable for this account.'},{status:403,headers:privateHeaders});
        attachments.push(files[0]);
      }
      checkAttachmentTotal(attachments.map(file=>file.size));
    }
    const id=randomUUID();
    const saved=await sql`INSERT INTO ambassador_outreach_drafts(id,owner_phone_number,sponsor_id,recipient,subject,body,review_id,cc,bcc,attachment_refs,reply_to,status) VALUES(${id},${phone},${contactId},${proposal.recipient},${proposal.subject},${proposal.body},${reviewId},${JSON.stringify(proposal.cc)}::jsonb,${JSON.stringify(proposal.bcc)}::jsonb,${JSON.stringify(proposal.attachmentRefs)}::jsonb,${proposal.replyTo},${decision}) ON CONFLICT(owner_phone_number,review_id) WHERE review_id IS NOT NULL DO UPDATE SET recipient=excluded.recipient,subject=excluded.subject,body=excluded.body,cc=excluded.cc,bcc=excluded.bcc,attachment_refs=excluded.attachment_refs,reply_to=excluded.reply_to,status=excluded.status,updated_at=now() WHERE ambassador_outreach_drafts.status='draft' OR (ambassador_outreach_drafts.status='rejected' AND excluded.status='rejected') RETURNING id,review_id,status`;
    if(!saved.length)return Response.json({error:'This review was already decided or sent.'},{status:409,headers:privateHeaders});
    verboseLog('email.draft_saved',{review:fingerprint(reviewId),linkedContact:Boolean(contactId),status:saved[0].status},verbose);
    return Response.json({ok:true,draftId:saved[0].id,reviewId,status:saved[0].status,attachments},{headers:privateHeaders});
  } catch(error) {
    verboseLog('email.draft_failed',{error:errorInfo(error)},verbose);
    if(error instanceof SyntaxError)return Response.json({error:'Invalid JSON.'},{status:400,headers:privateHeaders});
    console.error('Agent Gmail proposal save failed:',error.code||error.status||error.name);
    return Response.json({error:error.message||'Could not save email proposal.'},{status:error.status||503,headers:privateHeaders});
  }
}
