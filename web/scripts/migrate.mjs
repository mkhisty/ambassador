import { readFile } from 'node:fs/promises';
import { neon } from '@neondatabase/serverless';
import { DEFAULT_EVENT } from '../lib/model.mjs';

if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in .env.local before running migrations.');
const connection = new URL(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
if (connection.hostname.endsWith('.neon.tech')) connection.hostname = connection.hostname.replace('-pooler.', '.');
const sql = neon(connection.toString());
const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
await sql.transaction(schema.split(';').map(s=>s.trim()).filter(Boolean).map(statement=>sql.query(statement)));
await sql`INSERT INTO ambassador_event(id,data) VALUES('main',${JSON.stringify(DEFAULT_EVENT)}::jsonb) ON CONFLICT DO NOTHING`;
console.log('Ambassador schema ready. No demo sponsors were inserted.');
