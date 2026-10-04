import test from 'node:test';
import assert from 'node:assert/strict';
import { notificationData, notificationHandler, verifyPush } from '../lib/gmail-notifications.mjs';
import { addedMessageIds, inboxMessage, maintainInbox } from '../lib/gmail-inbox.mjs';
import { gmailReply, gmailSendRequest } from '../lib/gmail-reply.mjs';

const subscription='projects/test/subscriptions/inbox';
const envelope=(data={emailAddress:'Owner@Example.com',historyId:'123'})=>({subscription,message:{data:Buffer.from(JSON.stringify(data)).toString('base64url')}});

test('Gmail notifications validate subscription, mailbox and cursor',()=>{
  assert.deepEqual(notificationData(envelope(),subscription),{emailAddress:'owner@example.com',historyId:'123'});
  assert.throws(()=>notificationData(envelope(),'different'),/subscription/);
  assert.throws(()=>notificationData(envelope({emailAddress:'owner@example.com',historyId:'not-a-cursor'}),subscription),/Invalid/);
});

test('Push authentication requires a verified Google service account and expected audience',async()=>{
  const env={GMAIL_PUSH_AUDIENCE:'https://app.example/api/inbox',GMAIL_PUSH_SERVICE_ACCOUNT:'push@project.iam.gserviceaccount.com'};
  const request=new Request('https://app.example/api/inbox',{headers:{authorization:'Bearer google-jwt'}});
  let called;
  const client={verifyIdToken:async args=>{called=args;return {getPayload:()=>({email:env.GMAIL_PUSH_SERVICE_ACCOUNT,email_verified:true})};}};
  await verifyPush(request,env,client);
  assert.deepEqual(called,{idToken:'google-jwt',audience:env.GMAIL_PUSH_AUDIENCE});
  await assert.rejects(verifyPush(new Request(request.url),env,client),{status:401});
  await assert.rejects(verifyPush(request,env,{verifyIdToken:async()=>({getPayload:()=>({email:'other@example.com',email_verified:true})})}),{status:403});
});

test('Webhook acknowledges only after durable saving and retries database failures',async()=>{
  let saved=false;
  const handler=notificationHandler({env:{GMAIL_PUBSUB_SUBSCRIPTION:subscription},verify:async()=>{},save:async()=>{saved=true;}});
  const request=()=>new Request('https://app.example/api/inbox',{method:'POST',body:JSON.stringify(envelope())});
  assert.equal((await handler(request())).status,204);
  assert.equal(saved,true);
  const failed=notificationHandler({env:{GMAIL_PUBSUB_SUBSCRIPTION:subscription},verify:async()=>{},save:async()=>{throw new Error('private SQL');}});
  const response=await failed(request());
  assert.equal(response.status,503);
  assert.ok(!(await response.text()).includes('private SQL'));
});

test('Only new inbox additions are processed; sent mail and label changes do not loop',()=>{
  assert.deepEqual(addedMessageIds([{messagesAdded:[{message:{id:'new',labelIds:['INBOX']}},{message:{id:'sent',labelIds:['SENT','INBOX']}},{message:{id:'archived',labelIds:[]}}]},
    {messagesAdded:[{message:{id:'new',labelIds:['INBOX']}}],labelsAdded:[{message:{id:'label-change'}}]}]),['new']);
});

test('Multipart message extraction prefers readable text and excludes attachment bytes',()=>{
  const encode=text=>Buffer.from(text).toString('base64url');
  const message=inboxMessage({id:'1',threadId:'thread',payload:{headers:[{name:'From',value:'Jamie <jamie@example.com>'}],parts:[
    {mimeType:'multipart/alternative',parts:[{mimeType:'text/html',body:{data:encode('<b>Hello</b>')}},{mimeType:'text/plain',body:{data:encode('Hello')}}]},
    {filename:'notes.txt',mimeType:'text/plain',body:{data:encode('private attachment')}}]}});
  assert.equal(message.text,'Hello');
  assert.equal(message.from,'Jamie <jamie@example.com>');
  assert.deepEqual(message.attachments,[{name:'notes.txt',mime:'text/plain'}]);
});

function harness(watch, failStore=false) {
  const queries=[];
  const sql=async(parts,...values)=>{
    const query=parts.join('?');queries.push({query,values});
    if(query.includes('RETURNING w.*'))return [watch];
    if(failStore && query.includes('INSERT INTO ambassador_gmail_inbox'))throw new Error('storage unavailable');
    return [];
  };
  return {sql,queries};
}
const watch={phone_number:'+12025550100',history_id:'100',google_email:'owner@example.com',started_at:'2026-01-01T00:00:00Z',renewed_at:'2025-12-01T00:00:00Z',watch_expires_at:'2025-12-08T00:00:00Z'};
const options=gmail=>({getToken:async()=>({accessToken:'test'}),env:{GMAIL_PUBSUB_TOPIC:'projects/test/topics/inbox'},gmail});

test('Renewing a watch preserves unsynced history and commits the cursor after queueing',async()=>{
  const {sql,queries}=harness(watch),paths=[];
  await maintainInbox(sql,options(async(token,path)=>{
    paths.push(path);
    if(path==='watch')return {historyId:'900',expiration:Date.now()+86400000};
    if(path.startsWith('history?'))return {historyId:'110',history:[{id:'105',messagesAdded:[{message:{id:'new',labelIds:['INBOX']}}]}]};
    return {id:'new',internalDate:String(Date.now()),labelIds:['INBOX'],payload:{}};
  }));
  assert.ok(paths.find(p=>p.startsWith('history?')).includes('startHistoryId=100'));
  const stored=queries.findIndex(q=>q.query.includes('INSERT INTO ambassador_gmail_inbox'));
  const advanced=queries.findIndex(q=>q.query.includes('SET history_id=') && q.values.includes('105'));
  assert.ok(stored>=0 && advanced>stored);
});

test('A message-fetch/storage failure never advances the mailbox cursor',async()=>{
  const {sql,queries}=harness({...watch,renewed_at:new Date().toISOString(),watch_expires_at:new Date(Date.now()+86400000).toISOString()},true);
  await assert.rejects(maintainInbox(sql,options(async(token,path)=>path.startsWith('history?')?
    {historyId:'110',history:[{id:'105',messagesAdded:[{message:{id:'new',labelIds:['INBOX']}}]}]}:
    {id:'new',internalDate:String(Date.now()),labelIds:['INBOX'],payload:{}})),/storage unavailable/);
  assert.equal(queries.some(q=>q.query.includes('SET history_id=')),false);
  assert.ok(queries.at(-1).query.includes('sync_token=NULL'));
});

test('Expired history starts a paged recovery instead of resetting and losing mail',async()=>{
  const {sql,queries}=harness({...watch,renewed_at:new Date().toISOString(),watch_expires_at:new Date(Date.now()+86400000).toISOString()});
  await maintainInbox(sql,options(async(token,path)=>{
    if(path.startsWith('history?'))throw Object.assign(new Error('expired'),{providerStatus:404});
    assert.equal(path,'profile');return {historyId:'500'};
  }));
  assert.ok(queries.some(q=>q.query.includes('SET recovery_history_id=') && q.values.includes('500')));
  assert.equal(queries.some(q=>q.query.includes('SET history_id=')),false);
});

test('Approved replies resolve only the owner’s saved message and retain threading with attachments',async()=>{
  let values;
  const sql=async(parts,...args)=>{values=args;return [{data:{threadId:'thread123',internetMessageId:'<message@example.com>',references:'<previous@example.com>\r\nX-Evil: bad'}}];};
  const reply=await gmailReply(sql,'+12025550100','message123');
  assert.deepEqual(values,['+12025550100','message123']);
  assert.deepEqual(reply.headers,['In-Reply-To: <message@example.com>','References: <previous@example.com> <message@example.com>']);
  await assert.rejects(gmailReply(async()=>[],'+12025550100','foreign'),{status:403});
  const raw=Buffer.from('To: jamie@example.com\r\n\r\nHello').toString('base64url');
  assert.equal(JSON.parse(gmailSendRequest(raw,false,reply.threadId).body).threadId,'thread123');
  const attached=gmailSendRequest(raw,true,reply.threadId);
  assert.ok(attached.url.endsWith('uploadType=multipart'));
  assert.ok(attached.body.toString().includes('"threadId":"thread123"'));
  assert.ok(attached.body.toString().includes('To: jamie@example.com'));
});
