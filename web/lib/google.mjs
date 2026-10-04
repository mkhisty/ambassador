import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.events.freebusy',
  'https://www.googleapis.com/auth/calendar.events.owned',
];

export function googleConfig(env=process.env) {
  const { GOOGLE_CLIENT_ID:clientId, GOOGLE_CLIENT_SECRET:clientSecret, GOOGLE_REDIRECT_URI:redirectUri } = env;
  if (!clientId || !clientSecret || !redirectUri) throw new Error('Configure Google OAuth client ID, secret, and redirect URI.');
  const redirect = new URL(redirectUri);
  if (!['https:', 'http:'].includes(redirect.protocol) || redirect.username || redirect.password || redirect.hash) {
    throw new Error('Google redirect URI must be an HTTP(S) URL without credentials or a fragment.');
  }
  return { clientId, clientSecret, redirectUri:redirect.href };
}

export function tokenKey(value=process.env.GOOGLE_TOKEN_ENCRYPTION_KEY) {
  const encoded=String(value||'').trim(), key=Buffer.from(encoded,'base64');
  if (key.length!==32 || key.toString('base64')!==encoded) throw new Error('Configure GOOGLE_TOKEN_ENCRYPTION_KEY as base64-encoded 32 random bytes.');
  return key;
}

export function encryptGoogleToken(token,key=tokenKey()) {
  if (typeof token!=='string'||!token) throw new Error('Google did not provide a refresh token.');
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),ciphertext=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);
  return { refresh_token_ciphertext:ciphertext.toString('base64'), refresh_token_iv:iv.toString('base64'), refresh_token_tag:cipher.getAuthTag().toString('base64') };
}

export function decryptGoogleToken(row,key=tokenKey()) {
  const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(row.refresh_token_iv,'base64'));
  decipher.setAuthTag(Buffer.from(row.refresh_token_tag,'base64'));
  return Buffer.concat([decipher.update(Buffer.from(row.refresh_token_ciphertext,'base64')),decipher.final()]).toString('utf8');
}

export const hashOAuthState=state=>createHash('sha256').update(state).digest('hex');

export async function googleAccessToken(sql,phone,requiredScope) {
  const [connection]=await sql`SELECT google_email,scopes,refresh_token_ciphertext,refresh_token_iv,refresh_token_tag FROM ambassador_google_connections WHERE phone_number=${phone}`;
  if (!connection) throw Object.assign(new Error('Connect a Google account first.'),{status:409});
  const requiredScopes=Array.isArray(requiredScope)?requiredScope:[requiredScope];
  if (!requiredScopes.every(scope=>connection.scopes.includes(scope))) throw Object.assign(new Error('Reconnect Google and grant the requested permission.'),{status:403});
  const config=googleConfig(),key=tokenKey(),refreshToken=decryptGoogleToken(connection,key);
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,refresh_token:refreshToken,grant_type:'refresh_token'}),signal:AbortSignal.timeout(12000)});
  const result=await response.json();
  if (!response.ok||!result.access_token) throw Object.assign(new Error('Google access expired. Reconnect the account and try again.'),{status:401});
  if (result.refresh_token) {
    const encrypted=encryptGoogleToken(result.refresh_token,key);
    await sql`UPDATE ambassador_google_connections SET refresh_token_ciphertext=${encrypted.refresh_token_ciphertext},refresh_token_iv=${encrypted.refresh_token_iv},refresh_token_tag=${encrypted.refresh_token_tag},updated_at=now() WHERE phone_number=${phone}`;
  }
  return {accessToken:result.access_token,email:connection.google_email};
}

export function authorizationUrl(state,config=googleConfig()) {
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search=new URLSearchParams({
    client_id:config.clientId,
    redirect_uri:config.redirectUri,
    response_type:'code',
    scope:GOOGLE_SCOPES.join(' '),
    access_type:'offline',
    include_granted_scopes:'true',
    prompt:'consent',
    state,
  });
  return url.toString();
}
