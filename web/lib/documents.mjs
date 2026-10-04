import { database } from './db.mjs';
import { normalizePhone } from './auth.mjs';
import { randomUUID } from 'node:crypto';
import { validateFile, requireObjectStorage, storeObject, removeObject } from './files.mjs';

// Contact imports include their record writes in the document's transaction.
export async function saveDocument(file,phoneNumber,{sponsorId=null,queries=[]}={}) {
  requireObjectStorage();
  const owner=normalizePhone(phoneNumber);
  if(!file||typeof file.arrayBuffer!=='function')throw new Error('Choose a file.');
  const mime=validateFile(file.name,file.size),sql=database(),id=randomUUID();
  if(sponsorId&&!(await sql`SELECT id FROM ambassador_sponsors WHERE id=${sponsorId}`).length)throw new Error('Unknown contact.');
  const bytes=Buffer.from(await file.arrayBuffer()),key=`ambassador/users/${encodeURIComponent(owner)}/${id}`;
  await storeObject(key,bytes,mime);
  try {
    await sql.transaction([...queries,sql`INSERT INTO ambassador_documents(id,name,mime,size,sponsor_id,owner_phone_number,object_key,content) VALUES(${id},${file.name},${mime},${bytes.length},${sponsorId},${owner},${key},NULL)`]);
  }catch(error){
    try{await removeObject(key);}catch{console.error('Object cleanup failed; inspect private bucket.');}
    throw error;
  }
  return {id,name:file.name,mime,size:bytes.length,sponsorId,ownerPhoneNumber:owner,storage:'S3 bucket',at:new Date().toISOString()};
}

export function documentMetadata(d) {
  return {id:d.id,name:d.name,mime:d.mime,size:d.size,sponsorId:d.sponsor_id,ownerPhoneNumber:d.owner_phone_number,storage:d.object_key?'S3 bucket':'Neon Postgres',at:new Date(d.created_at).toISOString()};
}
export async function documentsForPhone(phoneNumber) {
  const phone=normalizePhone(phoneNumber),sql=database();
  const rows=await sql`SELECT id,name,mime,size,sponsor_id,owner_phone_number,object_key,created_at FROM ambassador_documents WHERE owner_phone_number=${phone} ORDER BY created_at DESC`;
  return rows.map(documentMetadata);
}
export async function documentForOwner(id,phoneNumber) {
  const phone=normalizePhone(phoneNumber),sql=database();
  const [file]=await sql`SELECT name,mime,object_key,encode(content,'base64') AS content FROM ambassador_documents WHERE id=${id} AND owner_phone_number=${phone}`;
  return file||null;
}
