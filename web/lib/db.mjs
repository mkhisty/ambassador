import { neon } from '@neondatabase/serverless';
import { randomUUID } from 'node:crypto';
import { DEFAULT_EVENT, validateSponsor, validateEvent, validateUser, duplicateKey } from './model.mjs';

export function database(){if(!process.env.DATABASE_URL)throw new Error('Neon is not connected.');return neon(process.env.DATABASE_URL);}
export function contactImportQueries(sql,sponsors,actor='Campaign owner') {
  if(!Array.isArray(sponsors)||sponsors.length<1||sponsors.length>500)throw new Error('Import between 1 and 500 contacts.');
  return sponsors.map(raw=>{
    const sponsor=validateSponsor(raw),id=randomUUID(),key=duplicateKey(sponsor);
    return sql`WITH inserted AS (INSERT INTO ambassador_sponsors(id,duplicate_key,data) VALUES(${id},${key},${JSON.stringify(sponsor)}::jsonb) ON CONFLICT(duplicate_key) DO NOTHING RETURNING id) INSERT INTO ambassador_activities(id,sponsor_id,kind,data) SELECT ${randomUUID()},id,'stage',${JSON.stringify({company:sponsor.contact||sponsor.company,text:'Added to the outreach pipeline',toStage:sponsor.stage,fromStage:null,actor})}::jsonb FROM inserted`;
  });
}
export async function readWorkspace(ownerPhone=null) {
  const sql=database();
  const [events,sponsors,activities,documents,users]=await sql.transaction([
    sql`SELECT data FROM ambassador_event WHERE id='main'`,
    sql`SELECT id,data FROM ambassador_sponsors ORDER BY updated_at DESC`,
    sql`SELECT id,sponsor_id,kind,data,created_at FROM ambassador_activities WHERE owner_phone_number IS NULL OR owner_phone_number=${ownerPhone} ORDER BY created_at DESC`,
    sql`SELECT id,name,mime,size,sponsor_id,owner_phone_number,object_key,created_at FROM ambassador_documents WHERE owner_phone_number=${ownerPhone} ORDER BY created_at DESC`,
    sql`SELECT u.phone_number,u.name,u.email,u.details,COALESCE(jsonb_agg(c.company_id ORDER BY c.company_id) FILTER (WHERE c.company_id IS NOT NULL),'[]'::jsonb) AS company_ids FROM ambassador_users u LEFT JOIN ambassador_user_companies c USING(phone_number) GROUP BY u.phone_number ORDER BY u.updated_at DESC`,
  ]);
  return {mode:'neon',ownerPhoneNumber:ownerPhone,event:events[0]?.data||DEFAULT_EVENT,users:users.map(u=>({phoneNumber:u.phone_number,name:u.name,email:u.email,details:u.details,companyIds:u.company_ids})),sponsors:sponsors.map(s=>({...s.data,id:s.id})),activities:activities.map(a=>({...a.data,id:a.id,sponsorId:a.sponsor_id,kind:a.kind,at:new Date(a.created_at).toISOString()})),documents:documents.map(d=>({id:d.id,name:d.name,mime:d.mime,size:d.size,sponsorId:d.sponsor_id,ownerPhoneNumber:d.owner_phone_number,storage:d.object_key?'S3 bucket':'Neon Postgres',at:new Date(d.created_at).toISOString()}))};
}
export async function mutateWorkspace(body,actor='Campaign owner',ownerPhone=null) {
  const sql=database();
  if(body.action==='user') {
    const user=validateUser(body.user);
    // Lock the profile first so simultaneous replacements cannot interleave company links.
    await sql.transaction([
      sql`INSERT INTO ambassador_users(phone_number,name,email,details) VALUES(${user.phoneNumber},${user.name},${user.email},${JSON.stringify(user.details)}::jsonb) ON CONFLICT(phone_number) DO UPDATE SET name=excluded.name,email=excluded.email,details=excluded.details,updated_at=now()`,
      sql`DELETE FROM ambassador_user_companies WHERE phone_number=${user.phoneNumber}`,
      ...user.companyIds.map(id=>sql`INSERT INTO ambassador_user_companies(phone_number,company_id) VALUES(${user.phoneNumber},${id})`),
    ]);
  } else if(body.action==='event') {
    const event=validateEvent(body.event);
    await sql`INSERT INTO ambassador_event(id,data) VALUES('main',${JSON.stringify(event)}::jsonb) ON CONFLICT(id) DO UPDATE SET data=excluded.data`;
  } else if(body.action==='import') {
    await sql.transaction(contactImportQueries(sql,body.sponsors,actor));
  } else if(body.action==='sponsor') {
    if(typeof body.id!=='string'||body.id.length>100)throw new Error('Invalid contact ID.');
    const sponsor=validateSponsor(body.sponsor);
    // Update and history are one SQL statement; concurrent updates preserve their actual prior stage.
    const rows=await sql`WITH previous AS (SELECT id,data FROM ambassador_sponsors WHERE id=${body.id} FOR UPDATE), updated AS (UPDATE ambassador_sponsors SET data=${JSON.stringify(sponsor)}::jsonb,duplicate_key=${duplicateKey(sponsor)},updated_at=now() WHERE id IN(SELECT id FROM previous) RETURNING id) INSERT INTO ambassador_activities(id,sponsor_id,kind,data) SELECT ${randomUUID()},updated.id,CASE WHEN previous.data->>'stage' <> ${sponsor.stage} THEN 'stage' ELSE 'note' END,${JSON.stringify({company:sponsor.contact||sponsor.company,text:`Updated ${sponsor.contact||sponsor.company}`,actor})}::jsonb || jsonb_build_object('fromStage',previous.data->>'stage','toStage',${sponsor.stage}::text) FROM updated JOIN previous ON updated.id=previous.id RETURNING id`;
    if(!rows.length)throw new Error('Contact no longer exists.');
  } else throw new Error('Unknown workspace action.');
  return readWorkspace(ownerPhone);
}
