import assert from 'node:assert/strict';
import { randomUUID, randomInt } from 'node:crypto';
import { documentsForPhone, documentForOwner } from '../lib/documents.mjs';
import { database, readWorkspace, mutateWorkspace } from '../lib/db.mjs';

// Creates and removes only this check's uniquely named verification records.
const sql=database(),tag=randomUUID(),company=`Verification ${tag}`,address=`${tag}@example.com`;
const phoneNumber=`+1999${String(randomInt(10000000)).padStart(7,'0')}`;
try {
  assert.equal((await readWorkspace()).mode,'neon');
  await mutateWorkspace({action:'import',sponsors:[{company,address,stage:'Identified',amount:1200,received:0}]},'Backend verification');
  const sponsor=(await readWorkspace()).sponsors.find(s=>s.company===company);
  assert.ok(sponsor);
  // A plain insert prevents this check from overwriting a preexisting phone identity.
  await sql`INSERT INTO ambassador_users(phone_number,details) VALUES(${phoneNumber},${JSON.stringify({verification:tag})}::jsonb)`;
  const user={phoneNumber,name:'Verification user',email:address,details:{verification:tag},companyIds:[sponsor.id]};
  await mutateWorkspace({action:'user',user});
  assert.deepEqual((await readWorkspace()).users.find(u=>u.phoneNumber===phoneNumber),user);
  await assert.rejects(()=>mutateWorkspace({action:'user',user:{...user,name:'Must roll back',companyIds:['missing-'+tag]}}),error=>error.code==='23503');
  assert.deepEqual((await readWorkspace()).users.find(u=>u.phoneNumber===phoneNumber),user);
  await mutateWorkspace({action:'sponsor',id:sponsor.id,sponsor:{...sponsor,stage:'Contacted',notes:'Temporary verification record.'}},'Backend verification');
  const updated=await readWorkspace();
  assert.equal(updated.sponsors.find(s=>s.id===sponsor.id).stage,'Contacted');
  assert.ok(updated.activities.some(a=>a.sponsorId===sponsor.id&&a.fromStage==='Identified'&&a.toStage==='Contacted'));
  await mutateWorkspace({action:'import',sponsors:[{company,address,stage:'Identified'}]},'Backend verification');
  assert.equal((await readWorkspace()).sponsors.filter(s=>s.company===company).length,1);
  const documentId=randomUUID(),bytes=Buffer.from('Ambassador document persistence check.');
  await sql`INSERT INTO ambassador_documents(id,name,mime,size,sponsor_id,owner_phone_number,content) VALUES(${documentId},'verification.txt','text/plain',${bytes.length},${sponsor.id},${phoneNumber},decode(${bytes.toString('base64')},'base64'))`;
  const [stored]=await sql`SELECT encode(content,'base64') AS content FROM ambassador_documents WHERE id=${documentId}`;
  assert.equal(Buffer.from(stored.content,'base64').toString(),bytes.toString());
  assert.ok((await documentsForPhone(phoneNumber)).some(d=>d.id===documentId));
  assert.ok((await readWorkspace(phoneNumber)).documents.some(d=>d.id===documentId));
  assert.equal(await documentForOwner(documentId,'+17344199493'),null);
  assert.ok(await documentForOwner(documentId,phoneNumber));
  assert.equal((await readWorkspace()).documents.length,0);
  console.log('Neon verified: document ownership filtering and cross-owner download denial, phone identity, company links, transaction rollback, sponsor imports, stage history, duplicate protection, and document bytes.');
} finally {
  // Resolve by unique company/address even if a request succeeded before throwing.
  const matches=await sql`SELECT id FROM ambassador_sponsors WHERE data->>'company'=${company} AND data->>'address'=${address}`;
  for(const {id} of matches)await sql.transaction([
    sql`DELETE FROM ambassador_documents WHERE sponsor_id=${id}`,
    sql`DELETE FROM ambassador_activities WHERE sponsor_id=${id}`,
    sql`DELETE FROM ambassador_sponsors WHERE id=${id}`,
  ]);
  await sql`DELETE FROM ambassador_users WHERE phone_number=${phoneNumber} AND details->>'verification'=${tag}`;
  console.log('Temporary verification records removed.');
}
