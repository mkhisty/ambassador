import { NextResponse } from 'next/server';
import { authorized, configured, sessionPhone } from '../../../../../lib/auth.mjs';
import { database } from '../../../../../lib/db.mjs';
import { createCalendarEvent } from '../../../../../lib/google-calendar.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request) {
  if (!configured()) return NextResponse.json({error:'Calendar is temporarily unavailable.'},{status:503});
  if (!authorized(request)) return NextResponse.json({error:'Sign in before creating a Calendar event.'},{status:401});
  try {
    const text=await request.text();if(Buffer.byteLength(text)>12000)return NextResponse.json({error:'Event is too large.'},{status:413});
    const input=JSON.parse(text),event=await createCalendarEvent(database(),sessionPhone(request),input);
    return NextResponse.json({ok:true,event},{headers:{'Cache-Control':'no-store'}});
  } catch(error) {
    if(error instanceof SyntaxError)return NextResponse.json({error:'Invalid JSON.'},{status:400});
    console.error('Google Calendar event creation failed:',error.code||error.status||error.name);
    return NextResponse.json({error:error.message||'Could not create Calendar event.'},{status:error.status||503});
  }
}
