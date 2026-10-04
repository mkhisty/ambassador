import { neon } from '@neondatabase/serverless';
if(!process.env.DATABASE_URL)throw new Error('Set DATABASE_URL before migrating.');
const connection=new URL(process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL);
connection.hostname=connection.hostname.replace('-pooler.','.');
const sql=neon(connection.toString());
await sql.transaction([
  sql`CREATE TEMP TABLE document_size_probe (LIKE ambassador_documents INCLUDING ALL) ON COMMIT DROP`,
  sql`ALTER TABLE document_size_probe DROP CONSTRAINT IF EXISTS ambassador_documents_size_check`,
  sql`ALTER TABLE document_size_probe ALTER COLUMN size TYPE bigint`,
  sql`ALTER TABLE document_size_probe ADD CHECK (size > 0)`,
  sql`INSERT INTO document_size_probe(id,name,mime,size,object_key) VALUES('size-probe','large.pdf','application/pdf',5368709120,'probe')`,
]);
await sql.transaction([
  sql`ALTER TABLE ambassador_documents DROP CONSTRAINT IF EXISTS ambassador_documents_size_check`,
  sql`ALTER TABLE ambassador_documents ALTER COLUMN size TYPE bigint`,
  sql`ALTER TABLE ambassador_documents ADD CONSTRAINT ambassador_documents_size_check CHECK (size > 0)`,
]);
console.log('Document storage no longer enforces the 2 MB limit.');
