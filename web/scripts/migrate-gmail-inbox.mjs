import { readFile } from 'node:fs/promises';
import { neon } from '@neondatabase/serverless';

if(!process.env.DATABASE_URL)throw new Error('Set DATABASE_URL before migrating Gmail inbox.');
const connection=new URL(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
connection.hostname=connection.hostname.replace('-pooler.', '.');
const sql=neon(connection.toString());
const schema=await readFile(new URL('../db/gmail-inbox.sql',import.meta.url),'utf8');
const statements=schema.split(';').map(s=>s.trim()).filter(Boolean);
// Validate the additive tables using transaction-local copies before applying.
const probe=schema.replaceAll('ambassador_gmail_watches','gmail_watch_probe')
  .replaceAll('ambassador_gmail_inbox','gmail_inbox_probe')
  .replaceAll('ambassador_google_connections','google_connection_probe')
  .replaceAll('CREATE TABLE IF NOT EXISTS','CREATE TEMP TABLE');
await sql.transaction([sql`CREATE TEMP TABLE google_connection_probe (LIKE ambassador_google_connections INCLUDING ALL) ON COMMIT DROP`,
  ...probe.split(';').map(s=>s.trim()).filter(Boolean).map(s=>sql.query(s)),
  sql`DROP TABLE gmail_inbox_probe`,sql`DROP TABLE gmail_watch_probe`]);
await sql.transaction(statements.map(s=>sql.query(s)));
console.log('Gmail watch state and durable inbox queue ready.');
