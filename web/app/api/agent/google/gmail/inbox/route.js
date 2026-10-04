import { agentAuthorized } from '../../../../../../lib/agent-context.mjs';
import { database } from '../../../../../../lib/db.mjs';
import { normalizePhone } from '../../../../../../lib/auth.mjs';
import { maintainInbox, claimInboxMessage, finishInboxMessage } from '../../../../../../lib/gmail-inbox.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

export async function POST(request) {
  if(!agentAuthorized(request))return Response.json({error:'Agent authentication required.'},{status:401});
  try {
    const raw=await request.text();
    if(Buffer.byteLength(raw)>10000)return Response.json({error:'Request too large.'},{status:413});
    const input=JSON.parse(raw),sql=database();
    if(input.action==='complete' || input.action==='failed') {
      if(typeof input.messageId!=='string' || input.messageId.length>200 || !/^[0-9a-f-]{36}$/i.test(input.leaseToken || ''))throw Object.assign(new Error('Invalid inbox receipt.'),{status:400});
      await finishInboxMessage(sql,{phoneNumber:normalizePhone(input.phoneNumber),messageId:input.messageId,leaseToken:input.leaseToken,failed:input.action==='failed'});
      return Response.json({ok:true});
    }
    if(input.action!=='next')return Response.json({error:'Invalid inbox action.'},{status:400});
    // A provider failure for one mailbox must not strand already queued emails.
    let maintenanceError=false;
    try { await maintainInbox(sql); }
    catch(error) { maintenanceError=true;console.error('Gmail inbox maintenance failed:',error.providerStatus || error.status || error.code || error.name); }
    const message=await claimInboxMessage(sql);
    return Response.json({ok:true,message,maintenanceError},{headers:{'Cache-Control':'private, no-store'}});
  } catch(error) {
    return Response.json({error:'Could not process Gmail inbox.'},{status:error instanceof SyntaxError?400:error.status||503});
  }
}
