import { database, readWorkspace } from '../lib/db.mjs';
import { hashPassword, normalizePhone } from '../lib/auth.mjs';
import assert from 'node:assert/strict';

// Explicitly requested initial owner. All existing document bytes and IDs are preserved.
const phone=normalizePhone('7344199492'),sql=database();
const passwordHash=await hashPassword(process.env.WORKSPACE_PASSWORD);
await sql.transaction([
  sql`INSERT INTO ambassador_users(phone_number,name,details) VALUES(${phone},'Campaign owner','{"role":"Campaign owner"}'::jsonb) ON CONFLICT DO NOTHING`,
  sql`INSERT INTO ambassador_user_auth(phone_number,password_hash) VALUES(${phone},${passwordHash}) ON CONFLICT DO NOTHING`,
  sql`INSERT INTO ambassador_user_companies(phone_number,company_id) SELECT ${phone},id FROM ambassador_sponsors ON CONFLICT DO NOTHING`,
  sql`UPDATE ambassador_documents SET owner_phone_number=${phone}`,
  // Consolidate fictional demo user identities only. Real user profiles are preserved.
  sql`DELETE FROM ambassador_users WHERE phone_number<>${phone} AND details->>'mockFixture'='ambassador-demo-v2'`,
]);
const workspace=await readWorkspace(phone);
const [{count}]=await sql`SELECT count(*)::integer AS count FROM ambassador_documents`;
assert.equal(workspace.documents.length,count);
console.log(`Owner ${phone} configured; ${count} documents associated. Sign in using this phone and the existing workspace password. Existing account passwords are never overwritten.`);
