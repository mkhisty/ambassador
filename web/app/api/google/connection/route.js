import { NextResponse } from 'next/server';
import { authorized, configured, sessionPhone } from '../../../../lib/auth.mjs';
import { database } from '../../../../lib/db.mjs';
import { decryptGoogleToken, tokenKey } from '../../../../lib/google.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function DELETE(request) {
  if (!authorized(request)) return NextResponse.json({error:'Sign in to disconnect Google.'},{status:401});
  if (!configured()) return NextResponse.json({error:'Neon is not connected.'},{status:503});
  try {
    const sql=database(),phone=sessionPhone(request),[connection]=await sql`SELECT refresh_token_ciphertext,refresh_token_iv,refresh_token_tag FROM ambassador_google_connections WHERE phone_number=${phone}`;
    let revoked=true;
    if (connection) {
      try {
        const token=decryptGoogleToken(connection,tokenKey());
        const response=await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token}),signal:AbortSignal.timeout(5000)});
        revoked=response.ok;
      } catch { revoked=false; }
    }
    await sql`DELETE FROM ambassador_google_connections WHERE phone_number=${phone}`;
    await sql`DELETE FROM ambassador_google_oauth_states WHERE phone_number=${phone}`;
    return NextResponse.json({ok:true,revoked},{headers:{'Cache-Control':'no-store'}});
  } catch (error) {
    console.error('Google disconnect failed:',error.code||error.name);
    return NextResponse.json({error:'Could not disconnect Google.'},{status:503});
  }
}
