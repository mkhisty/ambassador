import { createHmac, randomUUID } from 'node:crypto';
import { normalizePhone, safeEqual } from './auth.mjs';
import { database } from './db.mjs';
import { documentMetadata } from './documents.mjs';
import { validateFile, uploadUrl, inspectObject, copyObject, removeObject } from './files.mjs';

function signature(data){
  if((process.env.SESSION_SECRET?.length||0)<32)throw new Error('Workspace authentication is not configured.');
  return createHmac('sha256',process.env.SESSION_SECRET).update('document-upload:'+data).digest('hex');
}
export function decodeUpload(token,phone){
  const [data,mac,...extra]=String(token||'').split('.');
  if(extra.length||!data||!safeEqual(mac,signature(data)))throw new Error('Invalid upload authorization.');
  const record=JSON.parse(Buffer.from(data,'base64url').toString());
  if(record.owner!==normalizePhone(phone)||record.expires<=Date.now())throw new Error('Upload authorization expired or belongs to another account.');
  return record;
}
export function createUploadService({db=database,sign=uploadUrl,inspect=inspectObject,copy=copyObject,remove=removeObject}={}){
  return {
    async prepare(input,phone){
      const owner=normalizePhone(phone),mime=validateFile(input.name,input.size),sql=db();
      const sponsorId=input.sponsorId||null,purpose=input.purpose==='import'?'import':'document';
      if(purpose==='import'&&!/\.(csv|xlsx)$/i.test(input.name))throw new Error('Choose a CSV or XLSX spreadsheet.');
      if(sponsorId&&!(await sql`SELECT id FROM ambassador_sponsors WHERE id=${sponsorId}`).length)throw new Error('Unknown contact.');
      const id=randomUUID(),key=`ambassador/users/${encodeURIComponent(owner)}/${id}`;
      const record={id,owner,name:input.name,mime,size:input.size,sponsorId,purpose,key,stagingKey:key+'/upload',expires:Date.now()+900000};
      const data=Buffer.from(JSON.stringify(record)).toString('base64url');
      return {uploadUrl:await sign(record.stagingKey,mime),headers:{'Content-Type':mime},uploadToken:data+'.'+signature(data)};
    },
    async complete(token,phone,{queries=[]}={}){
      const r=decodeUpload(token,phone),sql=db();
      const [existing]=await sql`SELECT * FROM ambassador_documents WHERE id=${r.id} AND owner_phone_number=${r.owner}`;
      if(existing)return documentMetadata(existing);
      const head=await inspect(r.stagingKey);
      if(Number(head.ContentLength)!==r.size||head.ContentType!==r.mime)throw new Error('Uploaded file does not match the approved metadata.');
      // Freeze the upload before recording it; a reusable PUT URL cannot alter saved files.
      await copy(r.stagingKey,r.key,head.ETag);
      const final=await inspect(r.key);
      if(Number(final.ContentLength)!==r.size||final.ContentType!==r.mime){await remove(r.key);throw new Error('Uploaded file changed during confirmation.');}
      try{
        await sql.transaction([...queries,sql`INSERT INTO ambassador_documents(id,name,mime,size,sponsor_id,owner_phone_number,object_key,content) VALUES(${r.id},${r.name},${r.mime},${r.size},${r.sponsorId},${r.owner},${r.key},NULL)`]);
      }catch(error){
        const [saved]=await sql`SELECT * FROM ambassador_documents WHERE id=${r.id} AND owner_phone_number=${r.owner}`;
        if(saved)return documentMetadata(saved);
        try{await remove(r.key);}catch{}throw error;
      }
      try{await remove(r.stagingKey);}catch{console.error('Staged upload cleanup failed.');}
      return {id:r.id,name:r.name,mime:r.mime,size:r.size,sponsorId:r.sponsorId,ownerPhoneNumber:r.owner,storage:'S3 bucket',at:new Date().toISOString()};
    },
  };
}
