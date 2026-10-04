import assert from 'node:assert/strict';
import { randomUUID, randomInt } from 'node:crypto';
import { database } from '../lib/db.mjs';
import { removeObject } from '../lib/files.mjs';

const base='http://127.0.0.1:3000',sql=database(),tag=randomUUID();
const otherPhone=`+1999${String(randomInt(10000000)).padStart(7,'0')}`,otherPassword=`Temporary-${tag}`;
let uploadedId,createdAccount=false;
async function login(body){return fetch(base+'/api/session',{method:'POST',headers:{origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)});}
try {
  assert.equal((await login({password:process.env.WORKSPACE_PASSWORD})).status,400);
  const signedIn=await login({phoneNumber:'7344199492',password:process.env.WORKSPACE_PASSWORD});
  assert.equal(signedIn.status,200);
  const cookie=signedIn.headers.get('set-cookie').split(';')[0];
  const account=await login({action:'signup',phoneNumber:otherPhone,password:otherPassword,invitePassword:process.env.WORKSPACE_INVITE_PASSWORD});
  assert.equal(account.status,200);createdAccount=true;
  const otherCookie=account.headers.get('set-cookie').split(';')[0];
  assert.equal((await login({phoneNumber:otherPhone,password:process.env.WORKSPACE_PASSWORD})).status,401);
  assert.equal((await fetch(base+'/api/documents?phoneNumber=7344199492')).status,401);
  assert.equal((await fetch(base+`/api/documents?phoneNumber=${encodeURIComponent(otherPhone)}`,{headers:{cookie}})).status,403);
  const form=new FormData();form.append('file',new File(['Owner persistence check.'],`ownership-${tag}.txt`,{type:'text/plain'}));
  form.append('ownerPhoneNumber',otherPhone);
  const upload=await fetch(base+'/api/documents',{method:'POST',headers:{cookie,origin:base},body:form});
  assert.equal(upload.status,200);const document=await upload.json();uploadedId=document.id;
  assert.equal(document.ownerPhoneNumber,'+17344199492');
  const listing=await fetch(base+'/api/documents?phoneNumber=7344199492',{headers:{cookie}});
  assert.equal(listing.status,200);assert.ok((await listing.json()).documents.some(d=>d.id===uploadedId));
  assert.equal((await fetch(base+`/api/documents/${uploadedId}`,{headers:{cookie:otherCookie}})).status,404);
  const ownDownload=await fetch(base+`/api/documents/${uploadedId}`,{headers:{cookie}});
  assert.equal(ownDownload.status,200);assert.equal(await ownDownload.text(),'Owner persistence check.');
  const workspace=await (await fetch(base+'/api/workspace',{headers:{cookie:otherCookie}})).json();
  assert.equal(workspace.documents.length,0);
  console.log('API verified: mandatory phone, account signup/login, authenticated phone lookup, owner assignment, private listings, cross-owner denial, and file round trip.');
}finally{
  if(uploadedId){
    const [row]=await sql`SELECT object_key FROM ambassador_documents WHERE id=${uploadedId} AND name=${`ownership-${tag}.txt`}`;
    if(row?.object_key)await removeObject(row.object_key);
    await sql`DELETE FROM ambassador_documents WHERE id=${uploadedId} AND name=${`ownership-${tag}.txt`}`;
  }
  if(createdAccount)await sql`DELETE FROM ambassador_users WHERE phone_number=${otherPhone}`;
}
