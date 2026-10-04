import { NextResponse } from 'next/server';
import { authorized, sessionPhone } from '../../../lib/auth.mjs';
import { database, contactImportQueries, readWorkspace } from '../../../lib/db.mjs';
import { saveDocument } from '../../../lib/documents.mjs';

export const runtime='nodejs';
export async function POST(request) {
  if(!authorized(request))return NextResponse.json({error:'Sign in to import contacts.'},{status:401});
  const owner=sessionPhone(request);
  try {
    const form=await request.formData(),file=form.get('file'),raw=form.get('sponsors');
    if(!file||!/^.+\.(csv|xlsx)$/i.test(file.name))throw new Error('Choose a CSV or XLSX spreadsheet.');
    if(typeof raw!=='string'||Buffer.byteLength(raw)>2097152)throw new Error('Contact data is too large.');
    const queries=contactImportQueries(database(),JSON.parse(raw));
    await saveDocument(file,owner,{queries});
    return NextResponse.json(await readWorkspace(owner));
  }catch(error){console.error('Contact import failed:',error.code||error.name);return NextResponse.json({error:error.code?'Contact import could not be saved.':error.message},{status:error.status||400});}
}
