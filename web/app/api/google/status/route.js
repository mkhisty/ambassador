import { NextResponse } from 'next/server';
import { authorized, configured, sessionPhone } from '../../../../lib/auth.mjs';
import { database } from '../../../../lib/db.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(request) {
  if (!authorized(request)) return NextResponse.json({error:'Sign in to view connected apps.'},{status:401});
  if (!configured()) return NextResponse.json({error:'Google connection is temporarily unavailable.'},{status:503});
  try {
    const [connection]=await database()`SELECT google_email,scopes,connected_at FROM ambassador_google_connections WHERE phone_number=${sessionPhone(request)}`;
    return NextResponse.json({connected:Boolean(connection),email:connection?.google_email||null,scopes:connection?.scopes||[],connectedAt:connection?.connected_at?new Date(connection.connected_at).toISOString():null},{headers:{'Cache-Control':'no-store'}});
  } catch (error) {
    console.error('Google status read failed:',error.code||error.name);
    return NextResponse.json({error:'Could not load your Google connection. Try again later.'},{status:503});
  }
}
