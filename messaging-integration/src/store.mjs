import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function openStore(directory) {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(join(directory, 'ambassador.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS leads (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS drafts (
      id TEXT PRIMARY KEY, lead_id TEXT NOT NULL, actor TEXT NOT NULL, conversation TEXT NOT NULL,
      data TEXT NOT NULL, status TEXT NOT NULL, created INTEGER NOT NULL, result TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_draft ON drafts(lead_id)
      WHERE status IN ('pending','sending','uncertain','accepted');
    CREATE TABLE IF NOT EXISTS inbound (id TEXT PRIMARY KEY, response TEXT);
    CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY, actor TEXT, conversation TEXT, role TEXT, content TEXT);
    CREATE TABLE IF NOT EXISTS replies (id TEXT PRIMARY KEY, sender TEXT, content TEXT, received INTEGER);
  `);
  return db;
}

export function leadRows(db) {
  return db.prepare('SELECT data FROM leads ORDER BY id').all().map(r => JSON.parse(r.data));
}

export function draftRow(db, id) {
  const row = db.prepare('SELECT * FROM drafts WHERE id=?').get(id);
  return row ? { ...row, data: JSON.parse(row.data), result: row.result ? JSON.parse(row.result) : null } : null;
}
