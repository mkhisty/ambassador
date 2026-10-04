import { authorized, sessionPhone } from '../../../../lib/auth.mjs';
import { database, contactImportQueries, readWorkspace } from '../../../../lib/db.mjs';
import { createUploadService, decodeUpload } from '../../../../lib/document-uploads.mjs';
export const runtime='nodejs';
export async function POST(request){
  if(!authorized(request))return Response.json({error:'Sign in to upload documents.'},{status:401});
  const owner=sessionPhone(request);if(!owner)return Response.json({error:'Sign in again with your phone number.'},{status:401});
  try{
    const raw=await request.text();if(Buffer.byteLength(raw)>2097152)throw new Error('Upload metadata is too large.');
    const input=JSON.parse(raw),service=createUploadService();
    if(input.action==='prepare')return Response.json(await service.prepare(input,owner),{headers:{'Cache-Control':'private, no-store'}});
    if(input.action!=='complete')throw new Error('Invalid upload action.');
    const record=decodeUpload(input.uploadToken,owner);
    const queries=record.purpose==='import'?contactImportQueries(database(),input.sponsors):[];
    const document=await service.complete(input.uploadToken,owner,{queries});
    return Response.json(record.purpose==='import'?await readWorkspace(owner):document);
  }catch(error){console.error('Direct document upload failed:',error.code||error.name);return Response.json({error:error.code?'Document storage failed.':error.message},{status:error.status||400});}
}
