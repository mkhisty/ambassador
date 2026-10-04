import { configured, normalizePhone } from '../../../../../../lib/auth.mjs';
import { agentAuthorized } from '../../../../../../lib/agent-context.mjs';
import { database } from '../../../../../../lib/db.mjs';
import { queryCalendarFreeBusy } from '../../../../../../lib/google-calendar.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(request) {
  if(!agentAuthorized(request))return Response.json({error:'Agent authentication required.'},{status:401});
  if(!configured())return Response.json({error:'Neon is not connected.'},{status:503});
  try {
    const text=await request.text();if(Buffer.byteLength(text)>12000)return Response.json({error:'Request too large.'},{status:413});
    const input=JSON.parse(text),phone=normalizePhone(input.phoneNumber),availability=await queryCalendarFreeBusy(database(),phone,input);
    return Response.json({ok:true,availability},{headers:{'Cache-Control':'private, no-store'}});
  } catch(error) {
    if(error instanceof SyntaxError)return Response.json({error:'Invalid JSON.'},{status:400});
    console.error('Agent calendar availability failed:',error.code||error.status||error.name);
    return Response.json({error:error.message||'Could not check Calendar availability.'},{status:error.status||400});
  }
}
