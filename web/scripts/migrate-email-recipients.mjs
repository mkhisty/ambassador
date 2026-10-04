import { neon } from '@neondatabase/serverless';

// Scoped, idempotent migration for installations with existing email drafts.
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL before migrating email recipients.');
const connection = new URL(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
if (connection.hostname.endsWith('.neon.tech')) connection.hostname = connection.hostname.replace('-pooler.', '.');
const sql = neon(connection.toString());
// Verify the constraint change against an isolated temporary copy of the current
// table before applying it. No contacts, drafts, or schema objects are retained.
await sql.transaction([
  sql`CREATE TEMP TABLE ambassador_email_recipient_probe (LIKE ambassador_outreach_drafts INCLUDING ALL) ON COMMIT DROP`,
  sql`ALTER TABLE ambassador_email_recipient_probe ALTER COLUMN sponsor_id DROP NOT NULL`,
  sql`INSERT INTO ambassador_email_recipient_probe(id,owner_phone_number,sponsor_id,recipient,subject,body) VALUES('migration-probe','+12025550100',NULL,'probe@example.com','Probe','Probe')`,
]);
await sql`ALTER TABLE ambassador_outreach_drafts ALTER COLUMN sponsor_id DROP NOT NULL`;
console.log('Email drafts now allow recipients without a linked contact.');
