import { randomUUID } from 'node:crypto';
import { database } from '../lib/db.mjs';
import { requireObjectStorage, storeObject, readObject, removeObject } from '../lib/files.mjs';

requireObjectStorage();
const sql=database();
const documents=await sql`SELECT id,mime,owner_phone_number,encode(content,'base64') AS content FROM ambassador_documents WHERE object_key IS NULL ORDER BY created_at`;
if(documents.some(file=>!file.owner_phone_number))throw new Error('Assign document owners before migrating files.');
for(const file of documents){
  const bytes=Buffer.from(file.content,'base64');
  const key=`ambassador/users/${encodeURIComponent(file.owner_phone_number)}/${file.id}/${randomUUID()}`;
  await storeObject(key,bytes,file.mime);
  // Verify the stored bytes before removing the database copy.
  if(!(await readObject(key)).equals(bytes))throw new Error('Stored file verification failed; database bytes were preserved.');
  const rows=await sql`UPDATE ambassador_documents SET object_key=${key},content=NULL WHERE id=${file.id} AND object_key IS NULL AND encode(content,'base64')=${file.content} RETURNING id`;
  if(!rows.length){await removeObject(key);throw new Error('Document changed during migration; database bytes were preserved.');}
}
console.log(`Moved ${documents.length} documents into the private S3 bucket; every file was downloaded and verified before its database bytes were removed.`);
