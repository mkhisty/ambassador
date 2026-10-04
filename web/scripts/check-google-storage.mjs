import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { database } from '../lib/db.mjs';
import { decryptGoogleToken, encryptGoogleToken, hashOAuthState, tokenKey } from '../lib/google.mjs';

const sql=database(),tag=randomUUID(),phone=`+1999${String(randomInt(10_000_000)).padStart(7,'0')}`;
let ownerCreated=false;
try {
  const owners=await sql`INSERT INTO ambassador_users(phone_number,details) VALUES(${phone},${JSON.stringify({googleCheck:tag})}::jsonb) RETURNING phone_number`;
  assert.equal(owners[0]?.phone_number,phone);ownerCreated=true;
  const state=randomBytes(32).toString('base64url'),stateHash=hashOAuthState(state);
  await sql`INSERT INTO ambassador_google_oauth_states(state_hash,phone_number,expires_at) VALUES(${stateHash},${phone},now()+interval '10 minutes')`;
  assert.equal((await sql`DELETE FROM ambassador_google_oauth_states WHERE state_hash=${stateHash} AND expires_at>now() RETURNING phone_number`).length,1);
  assert.equal((await sql`DELETE FROM ambassador_google_oauth_states WHERE state_hash=${stateHash} AND expires_at>now() RETURNING phone_number`).length,0);
  const secret=randomBytes(32).toString('base64url'),encrypted=encryptGoogleToken(secret,tokenKey());
  await sql`INSERT INTO ambassador_google_connections(phone_number,google_subject,google_email,scopes,refresh_token_ciphertext,refresh_token_iv,refresh_token_tag) VALUES(${phone},${tag},'google-check@example.invalid',${['openid','email']},${encrypted.refresh_token_ciphertext},${encrypted.refresh_token_iv},${encrypted.refresh_token_tag})`;
  const [stored]=await sql`SELECT google_email,refresh_token_ciphertext,refresh_token_iv,refresh_token_tag FROM ambassador_google_connections WHERE phone_number=${phone}`;
  assert.equal(stored.google_email,'google-check@example.invalid');
  assert.notEqual(stored.refresh_token_ciphertext,secret);
  assert.equal(decryptGoogleToken(stored),secret);
  console.log('Google storage verified: one-time OAuth state, phone ownership, encrypted refresh token write/read, and cleanup.');
} finally {
  if(ownerCreated)await sql`DELETE FROM ambassador_users WHERE phone_number=${phone} AND details->>'googleCheck'=${tag}`;
}
