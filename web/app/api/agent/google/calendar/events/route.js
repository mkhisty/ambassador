import { configured, normalizePhone } from '../../../../../../lib/auth.mjs';
import { agentAuthorized } from '../../../../../../lib/agent-context.mjs';
import { database } from '../../../../../../lib/db.mjs';
import { createCalendarEvent } from '../../../../../../lib/google-calendar.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(request) {
  if(!agentAuthorized(request))return Response.json({error:'Agent authentication required.'},{status:401});
  if(!configured())return Response.json({error:'Neon is not connected.'},{status:503});
  try {
    const text=await request.text();if(Buffer.byteLength(text)>12000)return Response.json({error:'Request too large.'},{status:413});
    const input=JSON.parse(text),phone=normalizePhone(input.phoneNumber),requestId=input.requestId;
    if(typeof requestId!=='string'||requestId.length<16||requestId.length>200||!/^[A-Za-z0-9_-]+$/.test(requestId))return Response.json({error:'A valid approval ID is required.'},{status:400});
    const event=await createCalendarEvent(database(),phone,input.event,{requestId});
    return Response.json({ok:true,event},{headers:{'Cache-Control':'private, no-store'}});
  } catch(error) {
    if(error instanceof SyntaxError)return Response.json({error:'Invalid JSON.'},{status:400});
    console.error('Agent calendar event failed:',error.code||error.status||error.name);
    return Response.json({error:error.message||'Could not create Calendar event.'},{status:error.status||400});
  }
}
