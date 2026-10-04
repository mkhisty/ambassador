import { NextResponse } from 'next/server';
import { authorized, sessionPhone } from '../../../../lib/auth.mjs';
import { createDocumentDeletion, documentForOwner } from '../../../../lib/documents.mjs';
import { readObject, downloadUrl } from '../../../../lib/files.mjs';

export const runtime='nodejs';
const deleteDocument=createDocumentDeletion();
export async function GET(request,{params}) {
  if(!authorized(request))return NextResponse.json({error:'Sign in to download documents.'},{status:401});
  try {
    const owner=sessionPhone(request);if(!owner)return NextResponse.json({error:'Sign in again with your phone number.'},{status:401});
    const {id}=await params,file=await documentForOwner(id,owner);
    if(!file)return NextResponse.json({error:'Document not found.'},{status:404});
    if(file.object_key){const url=await downloadUrl(file.object_key,file.name);return new URL(request.url).searchParams.get('download')==='link'?NextResponse.json({downloadUrl:url},{headers:{'Cache-Control':'private, no-store'}}):NextResponse.redirect(url,307);}
    const bytes=file.object_key?await readObject(file.object_key):Buffer.from(file.content,'base64');
    return new Response(bytes,{headers:{'Content-Type':file.mime,'Content-Disposition':`attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(file.name)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  }catch(error){console.error('Document download failed:',error.code||error.name);return NextResponse.json({error:'Document download failed.'},{status:503});}
}
export async function DELETE(request,{params}) {
  if(!authorized(request))return NextResponse.json({error:'Sign in to delete documents.'},{status:401});
  try {
    const owner=sessionPhone(request);if(!owner)return NextResponse.json({error:'Sign in again with your phone number.'},{status:401});
    const {id}=await params;
    if(!await deleteDocument(id,owner))return NextResponse.json({error:'Document not found.'},{status:404});
    return NextResponse.json({ok:true,id},{headers:{'Cache-Control':'private, no-store'}});
  }catch(error){console.error('Document deletion failed:',error.code||error.name);return NextResponse.json({error:'Document deletion failed. Retry the deletion.'},{status:503});}
}
