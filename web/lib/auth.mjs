import { createHmac, timingSafeEqual, randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
const deriveKey=promisify(scrypt);

export function normalizePhone(value) {
  let phone=String(value||'').trim().replace(/[\s().-]/g,'');
  if(/^\d{10}$/.test(phone))phone='+1'+phone;
  if(!/^\+[1-9]\d{7,14}$/.test(phone))throw new Error('Enter a US 10-digit phone number or an international number with + and country code.');
  return phone;
}
export async function hashPassword(password) {
  if(typeof password!=='string'||password.length<12||password.length>256)throw new Error('Password must be between 12 and 256 characters.');
  const salt=randomBytes(16).toString('hex'),key=await deriveKey(password,salt,64);
  return `${salt}:${key.toString('hex')}`;
}
export async function checkPassword(password,stored) {
  if(typeof password!=='string'||password.length>256)return false;
  const [salt,key]=String(stored||'').split(':');
  if(!/^[a-f0-9]{32}$/.test(salt)||!/^[a-f0-9]{128}$/.test(key))return false;
  return safeEqual((await deriveKey(password,salt,64)).toString('hex'),key);
}

export const COOKIE = 'ambassador_session';
export function sameOrigin(request) {
  try {
    const raw=request.headers.get('origin'),origin=new URL(raw);
    if(!['http:','https:'].includes(origin.protocol)||raw!==origin.origin)return false;
    // Next.js can normalize its internal URL to localhost while the browser uses 127.0.0.1.
    return raw===new URL(request.url).origin || origin.host===request.headers.get('host');
  }catch{return false;}
}
export function safeEqual(a,b) {
  if(typeof a!=='string'||typeof b!=='string')return false;
  const x=Buffer.from(a),y=Buffer.from(b);
  return x.length===y.length&&timingSafeEqual(x,y);
}
export function configured() {return Boolean(process.env.DATABASE_URL);}
export function authReady() {return (process.env.WORKSPACE_PASSWORD?.length||0)>=12&&(process.env.SESSION_SECRET?.length||0)>=32;}
export function signSession(expiry=Date.now()+86400000,phoneNumber) {
  if(!authReady())throw new Error('Workspace authentication is not configured.');
  const data=phoneNumber?`${expiry}:${normalizePhone(phoneNumber)}`:String(expiry), signature=createHmac('sha256',process.env.SESSION_SECRET).update(data).digest('hex');
  return `${data}.${signature}`;
}
export function validSession(token) {
  if(!authReady()||!token)return false;
  const [data,signature,...rest]=token.split('.');
  const match=data.match(/^(\d+)(?::(\+[1-9]\d{7,14}))?$/);
  if(rest.length||!match||Number(match[1])<=Date.now())return false;
  return safeEqual(signature,createHmac('sha256',process.env.SESSION_SECRET).update(data).digest('hex'));
}
export function sessionPhone(request) {
  const token=request.cookies.get(COOKIE)?.value;
  if(!validSession(token))return null;
  return token.split('.')[0].split(':')[1]||null;
}
export function authorized(request,allowAgent=false) {
  if(allowAgent && (process.env.AGENT_API_TOKEN?.length||0)>=32 && safeEqual(request.headers.get('authorization'),`Bearer ${process.env.AGENT_API_TOKEN}`))return true;
  const raw=request.cookies.get(COOKIE)?.value;
  if(!sessionPhone(request))return false;
  if(!['GET','HEAD'].includes(request.method)) {
    if(!sameOrigin(request))return false;
  }
  return true;
}
