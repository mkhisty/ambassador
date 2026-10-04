import { NextResponse } from 'next/server';
import { authorized, configured } from '../../../../lib/auth.mjs';
import { database } from '../../../../lib/db.mjs';
import { decryptGoogleToken, encryptGoogleToken, googleConfig, GOOGLE_SCOPES, hashOAuthState, tokenKey } from '../../../../lib/google.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';

function finish(request,result) {
  const url=new URL('/',request.url);url.searchParams.set('google',result);
  return NextResponse.redirect(url);
}

export async function GET(request) {
  if (!configured()) return finish(request,'error');
  const params=new URL(request.url).searchParams,state=params.get('state'),code=params.get('code');
  if (!state||state.length>100||! /^[A-Za-z0-9_-]+$/.test(state)) return finish(request,'error');
  try {
    const sql=database(),pending=await sql`DELETE FROM ambassador_google_oauth_states WHERE state_hash=${hashOAuthState(state)} AND expires_at>now() RETURNING phone_number`;
    if (!pending.length) return finish(request,'error');
    if (params.has('error')||!code) return finish(request,'error');
    const config=googleConfig(),key=tokenKey(),body=new URLSearchParams({
      code,client_id:config.clientId,client_secret:config.clientSecret,redirect_uri:config.redirectUri,grant_type:'authorization_code',
    });
    const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(12000)});
    if (!tokenResponse.ok) throw new Error('Google token exchange failed.');
    const token=await tokenResponse.json();
    const profileResponse=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:`Bearer ${token.access_token}`},signal:AbortSignal.timeout(12000)});
    if (!profileResponse.ok) throw new Error('Google account verification failed.');
    const profile=await profileResponse.json();
    if (!profile.sub||!profile.email||profile.email_verified!==true) throw new Error('Google account email is not verified.');
    let refreshToken=token.refresh_token;
    if (!refreshToken) {
      const [existing]=await sql`SELECT google_subject,refresh_token_ciphertext,refresh_token_iv,refresh_token_tag FROM ambassador_google_connections WHERE phone_number=${pending[0].phone_number}`;
      if (existing?.google_subject===profile.sub) refreshToken=decryptGoogleToken(existing,key);
    }
    if (!refreshToken) throw new Error('Google did not return offline access. Disconnect Google and try again.');
    const encrypted=encryptGoogleToken(refreshToken,key),scopes=token.scope?String(token.scope).split(' ').filter(Boolean):GOOGLE_SCOPES;
    if (!scopes.includes('https://www.googleapis.com/auth/gmail.compose')||!scopes.includes('https://www.googleapis.com/auth/calendar.events.owned')||!scopes.includes('https://www.googleapis.com/auth/calendar.events.freebusy')) throw new Error('Google did not grant all requested permissions. Reconnect and approve them.');
    await sql`INSERT INTO ambassador_google_connections(phone_number,google_subject,google_email,scopes,refresh_token_ciphertext,refresh_token_iv,refresh_token_tag) VALUES(${pending[0].phone_number},${profile.sub},${profile.email},${scopes},${encrypted.refresh_token_ciphertext},${encrypted.refresh_token_iv},${encrypted.refresh_token_tag}) ON CONFLICT(phone_number) DO UPDATE SET google_subject=excluded.google_subject,google_email=excluded.google_email,scopes=excluded.scopes,refresh_token_ciphertext=excluded.refresh_token_ciphertext,refresh_token_iv=excluded.refresh_token_iv,refresh_token_tag=excluded.refresh_token_tag,updated_at=now()`;
    return finish(request,'connected');
  } catch (error) {
    console.error('Google callback failed:',error.code||error.name);
    return finish(request,'error');
  }
}
