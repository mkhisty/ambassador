import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const emailPattern = /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/;
export function config(env = process.env) {
  const mode = env.SEND_MODE || 'preview';
  const source = env.LEAD_SOURCE || 'mock';
  if (!['preview', 'live'].includes(mode)) throw new Error('SEND_MODE must be preview or live.');
  if (!['mock', 'sheets', 'notion'].includes(source)) throw new Error('LEAD_SOURCE must be mock, sheets, or notion.');
  const fixture = JSON.parse(readFileSync(resolve(env.EVENT_FILE || 'demo/fixtures.json'), 'utf8'));
  const event = fixture.event;
  for (const field of ['name', 'date', 'organizer', 'sponsor_benefits']) {
    if (typeof event?.[field] !== 'string' || !event[field].trim()) throw new Error(`Event needs ${field}.`);
  }
  const sourceKey = JSON.stringify([source, source === 'sheets' ? env.GOOGLE_SHEET_ID : source === 'notion' ? env.NOTION_DATA_SOURCE_ID : resolve(env.EVENT_FILE || 'demo/fixtures.json'), source === 'sheets' ? env.GOOGLE_SHEET_TAB || 'Leads' : '']);
  return { env, mode, source, sourceKey, event, fixture, dataDir: resolve(env.DATA_DIR || 'data'),
    organizers: (env.ORGANIZER_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
    from: env.EMAIL_FROM || 'organizer@example.com', testTo: env.EMAIL_TEST_TO || '' };
}

export function required(env, names) {
  const missing = names.filter(name => !env[name]?.trim());
  if (missing.length) throw new Error(`Configure ${missing.join(', ')} in .env.`);
}

export function configurationReport(c) {
  const group = (name, keys) => `${name}: ${keys.every(k => c.env[k]?.trim()) ? 'configured (not yet verified)' : 'missing ' + keys.filter(k => !c.env[k]?.trim()).join(', ')}`;
  return [
    `Outreach mode: ${c.mode}; lead source: ${c.source}`,
    group('Spectrum', ['PROJECT_ID', 'PROJECT_SECRET', 'ORGANIZER_IDS']),
    group('AI', ['OPENAI_API_KEY']),
    group('Email', ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM']),
    group('Google Sheets', ['GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_SHEET_ID']),
    group('Notion', ['NOTION_TOKEN', 'NOTION_DATA_SOURCE_ID']),
    `Email test recipient: ${c.testTo ? 'set (displayed on each draft)' : 'not set'}`,
    'LinkedIn: draft/manual handoff only; no automated sending integration.',
  ].join('\n');
}
