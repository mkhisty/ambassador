import { NextResponse } from 'next/server';
import { authorized, sessionPhone, normalizePhone } from '../../../lib/auth.mjs';
import { documentsForPhone, saveDocument } from '../../../lib/documents.mjs';
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
  try {
    const form=await request.formData(),file=form.get('file'),sponsorId=form.get('sponsorId')||null;
    return NextResponse.json(await saveDocument(file,owner,{sponsorId}));
  }catch(error){console.error('Document upload failed:',error.code||error.name);return NextResponse.json({error:error.code?'Document storage failed. Check storage configuration.':error.message},{status:error.status||400});}
}
