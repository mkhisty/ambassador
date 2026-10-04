import { randomUUID } from 'node:crypto';
import { googleAccessToken } from './google.mjs';

export const GMAIL_READ_SCOPE='https://www.googleapis.com/auth/gmail.readonly';
const api='https://gmail.googleapis.com/gmail/v1/users/me/';

export function inboxMessage(message) {
  const headers=message.payload?.headers || [];
  const header=name => headers.find(h=>h.name?.toLowerCase()===name)?.value || '';
  function body(part, mime) {
    if (part.filename) return '';
    if (part.mimeType===mime && part.body?.data) return Buffer.from(part.body.data,'base64url').toString('utf8');
    return (part.parts || []).map(p=>body(p,mime)).filter(Boolean).join('\n');
  }
  const plain=body(message.payload || {},'text/plain');
  const html=plain?'':body(message.payload || {},'text/html');
  return {id:message.id,threadId:message.threadId,from:header('from'),replyTo:header('reply-to'),
    to:header('to'),subject:header('subject'),date:header('date'),
    internetMessageId:header('message-id'),references:header('references'),
    text:(plain || html || message.snippet || '').slice(0,100000),format:plain?'text':'html',
    attachments:(message.payload?.parts || []).filter(p=>p.filename).map(p=>({name:p.filename,mime:p.mimeType}))};
}

export function addedMessageIds(history) {
  return [...new Set(history.flatMap(h=>(h.messagesAdded || []).map(a=>a.message)
    .filter(m=>m?.id && m.labelIds?.includes('INBOX') && !m.labelIds.includes('SENT')).map(m=>m.id)))];
}

export async function gmailRequest(accessToken, path, options={}, fetcher=fetch) {
  const response=await fetcher(api+path,{...options,headers:{Authorization:`Bearer ${accessToken}`,
    ...(options.body?{'Content-Type':'application/json'}:{}),...options.headers},signal:AbortSignal.timeout(12000)});
  if (!response.ok) throw Object.assign(new Error('Gmail inbox request failed.'),{providerStatus:response.status});
  return response.json();
}

// A small maintenance pass per worker tick. Locks prevent parallel syncs for a
// mailbox; persisted message IDs make partial passes/repeated pushes safe.
export async function maintainInbox(sql, {getToken=googleAccessToken, gmail=gmailRequest, env=process.env}={}) {
  const topic=env.GMAIL_PUBSUB_TOPIC;
  if (!/^projects\/[^/]+\/topics\/[^/]+$/.test(topic || '')) throw new Error('Configure GMAIL_PUBSUB_TOPIC.');
  await sql`INSERT INTO ambassador_gmail_watches(phone_number,google_email)
    SELECT phone_number,google_email FROM ambassador_google_connections WHERE ${GMAIL_READ_SCOPE}=ANY(scopes)
    ON CONFLICT(phone_number) DO NOTHING`;
  const lease=randomUUID();
  const [watch]=await sql`WITH candidate AS (
    SELECT w.phone_number FROM ambassador_gmail_watches w JOIN ambassador_google_connections c USING(phone_number)
    WHERE ${GMAIL_READ_SCOPE}=ANY(c.scopes) AND lower(w.google_email)=lower(c.google_email)
    AND (w.sync_until IS NULL OR w.sync_until<now())
    AND (w.history_id IS NULL OR w.renewed_at<now()-interval '1 day' OR w.watch_expires_at<now()+interval '1 hour'
      OR w.notified_history_id>COALESCE(w.history_id,0) OR w.synced_at IS NULL OR w.synced_at<now()-interval '10 minutes')
    ORDER BY w.synced_at NULLS FIRST LIMIT 1 FOR UPDATE OF w SKIP LOCKED)
    UPDATE ambassador_gmail_watches w SET sync_token=${lease}::uuid,sync_until=now()+interval '5 minutes'
    FROM candidate WHERE w.phone_number=candidate.phone_number RETURNING w.*`;
  if (!watch) return;
  let succeeded=false;
  try {
    const {accessToken}=await getToken(sql,watch.phone_number,GMAIL_READ_SCOPE);
    const request=(path,options)=>gmail(accessToken,path,options);
    if (!watch.history_id || !watch.renewed_at || Date.now()-new Date(watch.renewed_at)>86400000 || new Date(watch.watch_expires_at).getTime()<Date.now()+3600000) {
      const registered=await request('watch',{method:'POST',body:JSON.stringify({topicName:topic,labelIds:['INBOX'],labelFilterBehavior:'INCLUDE'})});
      if (!/^[0-9]{1,30}$/.test(String(registered.historyId)) || !Number.isFinite(Number(registered.expiration))) throw new Error('Invalid Gmail watch response.');
      await sql`UPDATE ambassador_gmail_watches SET renewed_at=now(),watch_expires_at=${new Date(Number(registered.expiration)).toISOString()}::timestamptz,
        started_at=CASE WHEN history_id IS NULL THEN now() ELSE started_at END,
        synced_at=CASE WHEN history_id IS NULL THEN now() ELSE synced_at END,
        history_id=COALESCE(history_id,${registered.historyId}::numeric) WHERE phone_number=${watch.phone_number} AND sync_token=${lease}::uuid`;
      // Begin with future arrivals. Renewals never discard an existing cursor.
      if (!watch.history_id) { succeeded=true;return; }
    }
    const store=async id => {
      let message;
      try { message=await request('messages/'+encodeURIComponent(id)+'?format=full'); }
      catch(error) { if(error.providerStatus===404)return;throw error; }
      if (!message.labelIds?.includes('INBOX') || message.labelIds.includes('SENT') || Number(message.internalDate)<new Date(watch.started_at).getTime()) return;
      await sql`INSERT INTO ambassador_gmail_inbox(phone_number,message_id,data)
        VALUES(${watch.phone_number},${id},${JSON.stringify(inboxMessage(message))}::jsonb) ON CONFLICT DO NOTHING`;
    };
    // Expired Gmail history needs an inbox scan. Preserve a paging cursor and
    // snapshot boundary so downtime cannot silently skip a burst of messages.
    if (watch.recovery_history_id) {
      const params=new URLSearchParams({labelIds:'INBOX',q:`after:${Math.floor(new Date(watch.started_at).getTime()/1000)}`,maxResults:'10'});
      if(watch.recovery_page)params.set('pageToken',watch.recovery_page);
      const page=await request('messages?'+params);
      for(const message of page.messages || [])await store(message.id);
      if(page.nextPageToken) {
        await sql`UPDATE ambassador_gmail_watches SET recovery_page=${page.nextPageToken} WHERE phone_number=${watch.phone_number} AND sync_token=${lease}::uuid`;
      } else {
        await sql`UPDATE ambassador_gmail_watches SET history_id=recovery_history_id,recovery_history_id=NULL,recovery_page=NULL,synced_at=now()
          WHERE phone_number=${watch.phone_number} AND sync_token=${lease}::uuid`;
      }
      succeeded=true;return;
    }
    const params=new URLSearchParams({startHistoryId:String(watch.history_id),historyTypes:'messageAdded',maxResults:'10'});
    let page;
    try { page=await request('history?'+params); }
    catch(error) {
      if(error.providerStatus!==404)throw error;
      const profile=await request('profile');
      await sql`UPDATE ambassador_gmail_watches SET recovery_history_id=${profile.historyId}::numeric,recovery_page=NULL
        WHERE phone_number=${watch.phone_number} AND sync_token=${lease}::uuid`;
      succeeded=true;return;
    }
    for(const record of page.history || []) {
      for(const id of addedMessageIds([record]))await store(id);
      await sql`UPDATE ambassador_gmail_watches SET history_id=${record.id}::numeric WHERE phone_number=${watch.phone_number} AND sync_token=${lease}::uuid`;
    }
    if (!page.nextPageToken) {
      await sql`UPDATE ambassador_gmail_watches SET history_id=${page.historyId}::numeric,synced_at=now()
        WHERE phone_number=${watch.phone_number} AND sync_token=${lease}::uuid`;
    }
    succeeded=true;
  } finally {
    await sql`UPDATE ambassador_gmail_watches SET sync_token=NULL,sync_until=CASE WHEN ${succeeded} THEN NULL ELSE now()+interval '1 minute' END
      WHERE phone_number=${watch.phone_number} AND sync_token=${lease}::uuid`;
  }
}

export async function claimInboxMessage(sql) {
  const lease=randomUUID();
  // Three failed processing attempts leave the message available for inspection,
  // rather than producing an endless stream of approval cards.
  await sql`UPDATE ambassador_gmail_inbox SET status='failed' WHERE attempts>=3
    AND (status='pending' OR (status='processing' AND lease_until<now()))`;
  const [row]=await sql`WITH candidate AS (
    SELECT i.phone_number,i.message_id FROM ambassador_gmail_inbox i JOIN ambassador_google_connections c USING(phone_number)
    JOIN ambassador_gmail_watches w USING(phone_number)
    WHERE ${GMAIL_READ_SCOPE}=ANY(c.scopes) AND lower(w.google_email)=lower(c.google_email)
    AND (i.status='pending' OR (i.status='processing' AND i.lease_until<now())) AND i.attempts<3
    ORDER BY i.created_at LIMIT 1 FOR UPDATE OF i SKIP LOCKED)
    UPDATE ambassador_gmail_inbox i SET status='processing',lease_token=${lease}::uuid,lease_until=now()+interval '10 minutes',attempts=attempts+1
    FROM candidate WHERE i.phone_number=candidate.phone_number AND i.message_id=candidate.message_id RETURNING i.phone_number,i.message_id,i.data`;
  return row?{phoneNumber:row.phone_number,messageId:row.message_id,email:row.data,leaseToken:lease}:null;
}

export async function finishInboxMessage(sql,{phoneNumber,messageId,leaseToken,failed=false}) {
  const rows=await sql`UPDATE ambassador_gmail_inbox SET status=${failed?'pending':'processed'},
    processed_at=CASE WHEN ${!failed} THEN now() ELSE NULL END,lease_token=NULL,lease_until=NULL
    WHERE phone_number=${phoneNumber} AND message_id=${messageId} AND status='processing' AND lease_token=${leaseToken}::uuid RETURNING message_id`;
  if(!rows.length)throw Object.assign(new Error('Inbox lease expired or already completed.'),{status:409});
}
