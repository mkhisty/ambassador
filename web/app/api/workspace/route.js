import { NextResponse } from 'next/server';
import { authorized, configured, sessionPhone } from '../../../lib/auth.mjs';
import { readWorkspace, mutateWorkspace } from '../../../lib/db.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';
function denied(request){
  if(!configured())return NextResponse.json({error:'Neon is not connected. Use the browser demo or configure DATABASE_URL.'},{status:503});
  if(!authorized(request,true))return NextResponse.json({error:'Sign in to your workspace.'},{status:401});
}
export async function GET(request) {
  const error=denied(request);if(error)return error;
  try{return NextResponse.json(await readWorkspace(sessionPhone(request)),{headers:{'Cache-Control':'no-store'}});}catch(error){console.error('Workspace read failed:',error.code||error.name);return NextResponse.json({error:'Could not read Neon. Check the connection and run npm run db:migrate.'},{status:503});}
}
export async function POST(request) {
  const error=denied(request);if(error)return error;
  if(Number(request.headers.get('content-length'))>2097152)return NextResponse.json({error:'Request too large.'},{status:413});
  try {
    const text=await request.text();if(Buffer.byteLength(text)>2097152)return NextResponse.json({error:'Request too large.'},{status:413});
    const body=JSON.parse(text);
    return NextResponse.json(await mutateWorkspace(body,request.headers.has('authorization')?'Spectrum agent':'Organizer',sessionPhone(request)));
  }catch(error){if(error.code){console.error('Workspace write failed:',error.code);return NextResponse.json({error:error.code==='23505'?'This contact already exists.':error.code==='23503'?'A linked contact record no longer exists. No changes were saved.':'Neon write failed. No changes were saved.'},{status:409});}return NextResponse.json({error:error.message||'Invalid request.'},{status:400});}
}
