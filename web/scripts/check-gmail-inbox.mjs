import assert from 'node:assert/strict';
import { neon } from '@neondatabase/serverless';
import { readFile } from 'node:fs/promises';
import { claimInboxMessage, finishInboxMessage, GMAIL_READ_SCOPE } from '../lib/gmail-inbox.mjs';

const connection=new URL(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
connection.hostname=connection.hostname.replace('-pooler.', '.');
const db=neon(connection.toString());
const schema=(await readFile(new URL('../db/gmail-inbox.sql',import.meta.url),'utf8'))
  .replaceAll('ambassador_google_connections','google_connection_probe')
  .replaceAll('ambassador_gmail_watches','gmail_watch_probe')
  .replaceAll('ambassador_gmail_inbox','gmail_inbox_probe')
  .replaceAll('CREATE TABLE IF NOT EXISTS','CREATE TEMP TABLE');
const queries=[db`CREATE TEMP TABLE google_connection_probe (LIKE ambassador_google_connections INCLUDING ALL) ON COMMIT DROP`,
  ...schema.split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.query(s)),
  db`INSERT INTO google_connection_probe(phone_number,google_subject,google_email,scopes,refresh_token_ciphertext,refresh_token_iv,refresh_token_tag)
    VALUES('+12025550100','probe','owner@example.invalid',${[GMAIL_READ_SCOPE]},'probe','probe','probe')`,
  db`INSERT INTO gmail_watch_probe(phone_number,google_email,history_id) VALUES('+12025550100','owner@example.invalid',100)`,
  db`UPDATE gmail_watch_probe SET notified_history_id=GREATEST(notified_history_id,150)`,
  db`UPDATE gmail_watch_probe SET notified_history_id=GREATEST(notified_history_id,120)`,
  db`INSERT INTO gmail_inbox_probe(phone_number,message_id,data) VALUES('+12025550100','probe','{}') ON CONFLICT DO NOTHING`,
  db`INSERT INTO gmail_inbox_probe(phone_number,message_id,data) VALUES('+12025550100','probe','{}') ON CONFLICT DO NOTHING`,
];
// Capture the application's actual parameterized lease SQL, then run it in one
// transaction against temporary tables. No real mailbox or queue is touched.
const capture=async(parts,...values)=>{
  let text=parts[0];for(let i=0;i<values.length;i++)text+='$'+(i+1)+parts[i+1];
  text=text.replaceAll('ambassador_google_connections','google_connection_probe')
    .replaceAll('ambassador_gmail_watches','gmail_watch_probe').replaceAll('ambassador_gmail_inbox','gmail_inbox_probe');
  queries.push(db.query(text,values));
  return [{phone_number:'+12025550100',message_id:'probe',data:{}}];
};
const claimedIndex=queries.length+1;
const job=await claimInboxMessage(capture);
const foreignIndex=queries.length;
await finishInboxMessage(capture,{phoneNumber:'+12025550101',messageId:'probe',leaseToken:job.leaseToken});
const completeIndex=queries.length;
await finishInboxMessage(capture,{phoneNumber:job.phoneNumber,messageId:job.messageId,leaseToken:job.leaseToken});
queries.push(db`SELECT status,attempts FROM gmail_inbox_probe`,db`SELECT history_id::text,notified_history_id::text FROM gmail_watch_probe`,
  db`DROP TABLE gmail_inbox_probe`,db`DROP TABLE gmail_watch_probe`);
const results=await db.transaction(queries);
assert.equal(results[claimedIndex].length,1);
assert.equal(results[foreignIndex].length,0);
assert.equal(results[completeIndex].length,1);
assert.deepEqual(results.at(-4),[{status:'processed',attempts:1}]);
assert.deepEqual(results.at(-3),[{history_id:'100',notified_history_id:'150'}]);
console.log('Gmail queue verified: duplicate prevention, ordered notifications, exclusive claim, owner/lease-bound acknowledgment, and cleanup.');
