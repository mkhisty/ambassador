import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { authorized, configured, sessionPhone } from '../../../../lib/auth.mjs';
import { database } from '../../../../lib/db.mjs';
import { authorizationUrl, googleConfig, hashOAuthState, tokenKey } from '../../../../lib/google.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(request) {
  if (!configured()) return NextResponse.json({error:'Google connection is temporarily unavailable.'},{status:503});
  if (!authorized(request)) return NextResponse.json({error:'Sign in to connect Google.'},{status:401});
  try {
    const config=googleConfig();tokenKey();
    const state=randomBytes(32).toString('base64url'),sql=database(),phone=sessionPhone(request);
    await sql`DELETE FROM ambassador_google_oauth_states WHERE expires_at<now()`;
    await sql`INSERT INTO ambassador_google_oauth_states(state_hash,phone_number,expires_at) VALUES(${hashOAuthState(state)},${phone},now()+interval '10 minutes')`;
    return NextResponse.json({url:authorizationUrl(state,config)},{headers:{'Cache-Control':'no-store'}});
  } catch (error) {
    console.error('Google connection could not start:',error.code||error.name);
    return NextResponse.json({error:'Could not connect Google. Try again later.'},{status:503});
  }
}
