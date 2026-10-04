import { randomUUID } from 'node:crypto';

// Resolve threading from a backend-owned inbox record, never model-provided
// headers or a browser-selected Google account.
export async function gmailReply(sql,phone,messageId) {
  if(!messageId)return {headers:[],threadId:null};
  if(typeof messageId!=='string' || !/^[\w-]{1,100}$/.test(messageId))throw Object.assign(new Error('Invalid reply message.'),{status:400});
  const [row]=await sql`SELECT data FROM ambassador_gmail_inbox WHERE phone_number=${phone} AND message_id=${messageId}`;
  if(!row)throw Object.assign(new Error('Reply message unavailable for this account.'),{status:403});
  const message=row.data;
  if(!/^[\w-]{1,100}$/.test(message.threadId || ''))throw Object.assign(new Error('Reply thread unavailable.'),{status:409});
  const headers=[];
  if(/^<[^<>\r\n]{1,998}>$/.test(message.internetMessageId || '')) {
    headers.push('In-Reply-To: '+message.internetMessageId);
    const references=(message.references || '').match(/<[^<>\r\n]{1,998}>/g) || [];
    const values=[...new Set([...references,message.internetMessageId])];
    while(values.join(' ').length>2000 && values.length>1)values.shift();
    headers.push('References: '+values.join(' '));
  }
  return {headers,threadId:message.threadId};
}

export function gmailSendRequest(raw,attached,threadId) {
  const endpoint='https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
  if(!attached)return {url:endpoint,contentType:'application/json',body:JSON.stringify({raw,...(threadId?{threadId}:{})})};
  const upload='https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send';
  if(!threadId)return {url:upload+'?uploadType=media',contentType:'message/rfc822',body:Buffer.from(raw,'base64url')};
  const boundary='ambassador_'+randomUUID().replaceAll('-','');
  return {url:upload+'?uploadType=multipart',contentType:'multipart/related; boundary='+boundary,body:Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({threadId})}\r\n--${boundary}\r\nContent-Type: message/rfc822\r\n\r\n`),
    Buffer.from(raw,'base64url'),Buffer.from(`\r\n--${boundary}--\r\n`),
  ])};
}
