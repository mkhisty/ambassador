import { database } from './db.mjs';
import { normalizePhone } from './auth.mjs';

export function documentMetadata(d) {
  return {id:d.id,name:d.name,mime:d.mime,size:d.size,sponsorId:d.sponsor_id,ownerPhoneNumber:d.owner_phone_number,storage:d.object_key?'Neon Object Storage':'Neon Postgres',at:new Date(d.created_at).toISOString()};
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
