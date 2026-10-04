import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { encryptGoogleToken, googleAccessToken } from '../lib/google.mjs';
import { createCalendarEvent, queryCalendarFreeBusy } from '../lib/google-calendar.mjs';

const names=['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REDIRECT_URI','GOOGLE_TOKEN_ENCRYPTION_KEY'];
const event={summary:'Recruiter call',start:'2026-10-04T14:30:00-04:00',end:'2026-10-04T15:00:00-04:00',timeZone:'America/New_York'};

function setup(scopes) {
  const old=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  Object.assign(process.env,{GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-secret',GOOGLE_REDIRECT_URI:'http://localhost/callback'});
  const key=Buffer.alloc(32,8);
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY=key.toString('base64');
  const encrypted=encryptGoogleToken('refresh-token',key);
  const row={google_email:'test@example.com',scopes,...encrypted};
  return {old,row,sql:async()=>[row],restore(){for(const name of names){if(old[name]===undefined)delete process.env[name];else process.env[name]=old[name];}}};
}

test('approved Calendar event is created opaque with stable retry ID',async()=>{
  const state=setup(['https://www.googleapis.com/auth/calendar.events.owned']),originalFetch=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,options)=>{
    calls.push({url,options});
    if(String(url).includes('oauth2.googleapis.com/token'))return new Response(JSON.stringify({access_token:'access'}),{status:200});
    return new Response(JSON.stringify({id:JSON.parse(options.body).id,summary:event.summary,start:event.start,end:event.end,htmlLink:'https://calendar.google.com/event'}),{status:200});
  };
  try {
    const created=await createCalendarEvent(state.sql,'+12025550100',event,{requestId:'review-secret-token-123456'});
    const sent=JSON.parse(calls[1].options.body);
    assert.equal(sent.id,createHash('sha256').update('review-secret-token-123456').digest('hex'));
    assert.equal(sent.transparency,'opaque');
    assert.equal(created.url,'https://calendar.google.com/event');
  } finally {globalThis.fetch=originalFetch;state.restore();}
});

test('availability checks require free-busy scope and return busy blocks only',async()=>{
  const state=setup(['https://www.googleapis.com/auth/calendar.events.freebusy']),originalFetch=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,options)=>{
    calls.push({url,options});
    if(String(url).includes('oauth2.googleapis.com/token'))return new Response(JSON.stringify({access_token:'access'}),{status:200});
    return new Response(JSON.stringify({timeMin:event.start,timeMax:event.end,calendars:{primary:{busy:[{start:event.start,end:event.end}]}}}),{status:200});
  };
  try {
    const result=await queryCalendarFreeBusy(state.sql,'+12025550100',{timeMin:event.start,timeMax:event.end,timeZone:event.timeZone});
    assert.deepEqual(result.busy,[{start:event.start,end:event.end}]);
    assert.equal(JSON.parse(calls[1].options.body).items[0].id,'primary');
  } finally {globalThis.fetch=originalFetch;state.restore();}
});

test('Gmail approval requires both compose and send scopes',async()=>{
  const state=setup(['https://www.googleapis.com/auth/gmail.compose']);
  try {
    await assert.rejects(googleAccessToken(state.sql,'+12025550100',[
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/gmail.send',
    ]),{status:403,message:'Reconnect Google and grant the requested permission.'});
  } finally {state.restore();}
});
