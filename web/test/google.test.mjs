import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizationUrl, decryptGoogleToken, encryptGoogleToken, GOOGLE_SCOPES, tokenKey } from '../lib/google.mjs';
import { validateCalendarEvent } from '../lib/google-calendar.mjs';
import { isZonedDateTime } from '../lib/datetime.mjs';

test('Calendar accepts browser ISO timestamps including milliseconds and rejects invalid or timezone-free values',()=>{
  assert.equal(isZonedDateTime(new Date('2026-10-04T14:30:00').toISOString()),true);
  assert.equal(isZonedDateTime('2026-10-04T14:30:00-04:00'),true);
  assert.equal(isZonedDateTime('2026-10-04T14:30'),false);
  assert.equal(isZonedDateTime('not-a-date'),false);
});

test('Calendar event validation trims title and preserves timezone-aware event details',()=>{
  const event=validateCalendarEvent({summary:'  Recruiter call  ',start:'2026-10-04T14:30:00.000Z',end:'2026-10-04T15:00:00.000Z',timeZone:'America/New_York'});
  assert.equal(event.summary,'Recruiter call');
  assert.equal(event.timeZone,'America/New_York');
  assert.throws(()=>validateCalendarEvent({summary:'Call',start:'2026-10-04T15:00:00Z',end:'2026-10-04T14:00:00Z',timeZone:'UTC'}),/valid start\/end/);
});

test('Google refresh tokens encrypt with authenticated AES-GCM and reject tampering',()=>{
  const key=Buffer.alloc(32,7),encrypted=encryptGoogleToken('refresh-secret',key);
  assert.notEqual(encrypted.refresh_token_ciphertext,'refresh-secret');
  assert.equal(decryptGoogleToken(encrypted,key),'refresh-secret');
  assert.throws(()=>decryptGoogleToken({...encrypted,refresh_token_tag:Buffer.alloc(16).toString('base64')},key));
  assert.throws(()=>decryptGoogleToken(encrypted,Buffer.alloc(32,8)));
});

test('token encryption key requires exactly 32 canonical base64 bytes',()=>{
  assert.equal(tokenKey(Buffer.alloc(32,3).toString('base64')).length,32);
  assert.throws(()=>tokenKey(Buffer.alloc(16,3).toString('base64')),/32 random bytes/);
  assert.throws(()=>tokenKey('not-a-key'),/32 random bytes/);
});

test('Google consent requests offline Gmail drafts and owned-calendar event access',()=>{
  const url=new URL(authorizationUrl('random-state',{clientId:'client-id',clientSecret:'server-only',redirectUri:'http://127.0.0.1:3000/api/google/callback'}));
  assert.equal(url.origin,'https://accounts.google.com');
  assert.equal(url.searchParams.get('redirect_uri'),'http://127.0.0.1:3000/api/google/callback');
  assert.equal(url.searchParams.get('access_type'),'offline');
  assert.equal(url.searchParams.get('state'),'random-state');
  assert.ok(url.searchParams.get('scope').includes(GOOGLE_SCOPES.find(scope=>scope.endsWith('gmail.compose'))));
  assert.ok(url.searchParams.get('scope').includes(GOOGLE_SCOPES.find(scope=>scope.endsWith('calendar.events.owned'))));
  assert.ok(url.searchParams.get('scope').includes(GOOGLE_SCOPES.find(scope=>scope.endsWith('calendar.events.freebusy'))));
  assert.equal(url.searchParams.get('prompt'),'consent');
  assert.equal(url.searchParams.has('client_secret'),false);
});
