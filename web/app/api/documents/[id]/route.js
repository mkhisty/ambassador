import { NextResponse } from 'next/server';
import { authorized, sessionPhone } from '../../../../lib/auth.mjs';
import { documentForOwner } from '../../../../lib/documents.mjs';
import { readObject } from '../../../../lib/files.mjs';

export const runtime='nodejs';
export async function GET(request,{params}) {
  if(!authorized(request))return NextResponse.json({error:'Sign in to download documents.'},{status:401});
  try {
    const owner=sessionPhone(request);if(!owner)return NextResponse.json({error:'Sign in again with your phone number.'},{status:401});
    const {id}=await params,file=await documentForOwner(id,owner);
    if(!file)return NextResponse.json({error:'Document not found.'},{status:404});
    const bytes=file.object_key?await readObject(file.object_key):Buffer.from(file.content,'base64');
    return new Response(bytes,{headers:{'Content-Type':file.mime,'Content-Disposition':`attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(file.name)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  }catch(error){console.error('Document download failed:',error.code||error.name);return NextResponse.json({error:'Document download failed.'},{status:503});}
}
