import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { demoWorkspace } from '../lib/demo.mjs';
import { database, readWorkspace } from '../lib/db.mjs';
import { validateSponsor, duplicateKey } from '../lib/model.mjs';

const sql=database(),data=demoWorkspace(),fixture='ambassador-demo-v2';
const ids=new Map(data.sponsors.map(s=>[s.id,`mock-${s.id}`]));
const queries=[];
for(const raw of data.sponsors){
  const sponsor={...validateSponsor(raw),mock:true,mockFixture:fixture};
  queries.push(sql`INSERT INTO ambassador_sponsors(id,duplicate_key,data) VALUES(${ids.get(raw.id)},${duplicateKey(sponsor)},${JSON.stringify(sponsor)}::jsonb) ON CONFLICT DO NOTHING`);
}
for(const user of data.users){
  queries.push(sql`INSERT INTO ambassador_users(phone_number,name,email,details) VALUES(${user.phoneNumber},${user.name},${user.email},${JSON.stringify({...user.details,mockFixture:fixture})}::jsonb) ON CONFLICT DO NOTHING`);
  for(const companyId of user.companyIds)queries.push(sql`INSERT INTO ambassador_user_companies(phone_number,company_id) SELECT ${user.phoneNumber},id FROM ambassador_sponsors WHERE id=${ids.get(companyId)} AND data->>'mockFixture'=${fixture} ON CONFLICT DO NOTHING`);
}
for(const activity of data.activities){
  queries.push(sql`INSERT INTO ambassador_activities(id,sponsor_id,kind,data,created_at) SELECT ${`mock-${activity.id}`},s.id,${activity.kind},${JSON.stringify({...activity,sponsorId:ids.get(activity.sponsorId),mock:true})}::jsonb,${activity.at}::timestamptz FROM ambassador_sponsors s WHERE s.id=${ids.get(activity.sponsorId)} AND s.data->>'mockFixture'=${fixture} ON CONFLICT DO NOTHING`);
}
for(const [id,name,path] of [['mock-demo-strategy','STRATEGY.md','../../STRATEGY.md'],['mock-demo-brief','Demo Event Brief.md','../test/fixtures/event-brief.md']]){
  const content=await readFile(new URL(path,import.meta.url));
  queries.push(sql`INSERT INTO ambassador_documents(id,name,mime,size,owner_phone_number,content) VALUES(${id},${name},'text/markdown',${content.length},${data.users[0].phoneNumber},decode(${content.toString('base64')},'base64')) ON CONFLICT DO NOTHING`);
}
// Preserve any event details the organizer has already entered.
queries.push(sql`UPDATE ambassador_event SET data=${JSON.stringify(data.event)}::jsonb WHERE id='main' AND data->>'name' IN ('Your next big event','Your outreach campaign')`);
await sql.transaction(queries);
const saved=await readWorkspace(),mock=saved.sponsors.filter(s=>s.mockFixture===fixture);
assert.equal(mock.length,data.sponsors.length,'A conflicting existing record prevented a complete seed; existing records were preserved.');
assert.equal(saved.users.find(u=>u.phoneNumber===data.users[0].phoneNumber)?.companyIds.length,data.sponsors.length,'Mock phone profiles and company links must match the sponsor set.');
console.log(`${mock.length} fictional sponsor accounts ready in Neon. Existing profiles, sponsors, and event settings were preserved.`);
