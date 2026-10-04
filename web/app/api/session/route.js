import { NextResponse } from 'next/server';
import { configured, authReady, safeEqual, signSession, sessionPhone, normalizePhone, hashPassword, checkPassword, sameOrigin, COOKIE } from '../../../lib/auth.mjs';
import { database } from '../../../lib/db.mjs';

export const runtime='nodejs';
export async function GET(request) {
  const phoneNumber=sessionPhone(request);
  return NextResponse.json({mode:configured()?'neon':'demo',authenticated:Boolean(phoneNumber),phoneNumber,ready:authReady()},{headers:{'Cache-Control':'no-store'}});
}
export async function POST(request) {
  if(!configured()||!authReady())return NextResponse.json({error:'Configure database, invitation password, and session secret.'},{status:503});
  if(!sameOrigin(request))return NextResponse.json({error:'Invalid request origin.'},{status:403});
  try {
    const text=await request.text();if(Buffer.byteLength(text)>4096)return NextResponse.json({error:'Request too large.'},{status:413});
    const body=JSON.parse(text),phone=normalizePhone(body.phoneNumber),sql=database();
    if(body.action==='signup'){
      if((process.env.WORKSPACE_INVITE_PASSWORD?.length||0)<12)return NextResponse.json({error:'Account registration is not configured.'},{status:503});
      if(!safeEqual(body.invitePassword,process.env.WORKSPACE_INVITE_PASSWORD))return NextResponse.json({error:'Incorrect workspace invitation password.'},{status:401});
      const passwordHash=await hashPassword(body.password);
      await sql.transaction([
        sql`INSERT INTO ambassador_users(phone_number,name) VALUES(${phone},'Campaign owner') ON CONFLICT DO NOTHING`,
        sql`INSERT INTO ambassador_user_auth(phone_number,password_hash) VALUES(${phone},${passwordHash})`,
      ]);
    }else{
      const [account]=await sql`SELECT password_hash FROM ambassador_user_auth WHERE phone_number=${phone}`;
      if(!account||!await checkPassword(body.password,account.password_hash))return NextResponse.json({error:'Incorrect phone number or password.'},{status:401});
    }
    const response=NextResponse.json({ok:true,phoneNumber:phone});
    response.cookies.set(COOKIE,signSession(undefined,phone),{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:86400});
    return response;
  }catch(error){return NextResponse.json({error:error.code==='23505'?'This phone number already has an account. Sign in instead.':error.code?'Account request failed. Check database configuration.':error.message||'Invalid request.'},{status:400});}
}
export async function DELETE(request) {
  if(!sameOrigin(request))return NextResponse.json({error:'Invalid request origin.'},{status:403});
  const response=NextResponse.json({ok:true});response.cookies.set(COOKIE,'',{httpOnly:true,path:'/',maxAge:0});return response;
}
