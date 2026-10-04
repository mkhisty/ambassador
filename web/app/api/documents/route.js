import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { authorized, sessionPhone, normalizePhone } from '../../../lib/auth.mjs';
import { database } from '../../../lib/db.mjs';
import { validateFile, objectStorageReady, storeObject, removeObject } from '../../../lib/files.mjs';

import { documentsForPhone } from '../../../lib/documents.mjs';
export const runtime='nodejs';
export async function GET(request) {
  if(!authorized(request))return NextResponse.json({error:'Sign in to list documents.'},{status:401});
  const owner=sessionPhone(request);if(!owner)return NextResponse.json({error:'Sign in again with your phone number.'},{status:401});
  try {
    const requested=new URL(request.url).searchParams.get('phoneNumber');
    if(requested&&normalizePhone(requested)!==owner)return NextResponse.json({error:'You can only list your own documents.'},{status:403});
    return NextResponse.json({phoneNumber:owner,documents:await documentsForPhone(owner)},{headers:{'Cache-Control':'private, no-store'}});
  }catch(error){return NextResponse.json({error:error.code?'Document lookup failed.':error.message},{status:400});}
}
export async function POST(request) {
  if(!authorized(request))return NextResponse.json({error:'Sign in to upload documents.'},{status:401});
  const owner=sessionPhone(request);if(!owner)return NextResponse.json({error:'Sign in again with your phone number.'},{status:401});
  if(Number(request.headers.get('content-length'))>2200000)return NextResponse.json({error:'Maximum file size is 2 MB.'},{status:413});
  let key;
  try {
    const form=await request.formData(),file=form.get('file'),sponsorId=form.get('sponsorId')||null;
    if(!file||typeof file.arrayBuffer!=='function')throw new Error('Choose a file.');
    const mime=validateFile(file.name,file.size),sql=database(),id=randomUUID(),bytes=Buffer.from(await file.arrayBuffer());
    if(sponsorId && !(await sql`SELECT id FROM ambassador_sponsors WHERE id=${sponsorId}`).length)throw new Error('Unknown contact.');
    if(objectStorageReady()){key=`ambassador/users/${encodeURIComponent(owner)}/${id}`;await storeObject(key,bytes,mime);}
    await sql`INSERT INTO ambassador_documents(id,name,mime,size,sponsor_id,owner_phone_number,object_key,content) VALUES(${id},${file.name},${mime},${bytes.length},${sponsorId},${owner},${key||null},decode(${key?null:bytes.toString('base64')},'base64'))`;
    return NextResponse.json({id,name:file.name,mime,size:bytes.length,sponsorId,ownerPhoneNumber:owner,storage:key?'Neon Object Storage':'Neon Postgres',at:new Date().toISOString()});
  }catch(error){if(key){try{await removeObject(key);}catch{console.error('Object cleanup failed; inspect private bucket.');}}console.error('Document upload failed:',error.code||error.name);return NextResponse.json({error:error.code?'Document storage failed. Check Neon configuration.':error.message},{status:400});}
}
