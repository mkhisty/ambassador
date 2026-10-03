import { GoogleAuth } from 'google-auth-library';
import { required, emailPattern } from './config.mjs';

const fields = ['id', 'company', 'contact', 'channel', 'address', 'ask', 'notes', 'status', 'owner'];
export function validateLeads(leads) {
  const ids = new Set();
  for (const lead of leads) {
    for (const field of fields) {
      if (typeof lead[field] !== 'string' || (!lead[field].trim() && field !== 'notes')) throw new Error(`Lead needs text in ${field}.`);
      if (lead[field].length > 10000) throw new Error(`Lead ${field} is too long.`);
    }
    if (!/^[\w-]{1,80}$/.test(lead.id) || ids.has(lead.id)) throw new Error('Lead IDs must be unique letters, numbers, dashes, or underscores.');
    ids.add(lead.id);
    if (!['email', 'imessage', 'linkedin'].includes(lead.channel)) throw new Error(`Unsupported channel for ${lead.id}.`);
    if (lead.channel === 'email' && !emailPattern.test(lead.address)) throw new Error(`Invalid email for ${lead.id}.`);
    if (lead.channel === 'imessage' && !/^\+[1-9]\d{7,14}$/.test(lead.address)) throw new Error(`Use E.164 phone for ${lead.id}.`);
    if (lead.channel === 'linkedin' && !/^https:\/\//.test(lead.address)) throw new Error(`Use an HTTPS profile for ${lead.id}.`);
  }
  return leads;
}

export function parseSheet(values) {
  if (!values?.length) throw new Error('Sheet is empty. Import the demo CSV first.');
  const [headers, ...rows] = values;
  if (new Set(headers).size !== headers.length || fields.some(f => !headers.includes(f))) throw new Error('Sheet needs unique headers: ' + fields.join(', '));
  return validateLeads(rows.filter(row => row.some(v => String(v).trim())).map(row =>
    Object.fromEntries(fields.map(f => [f, String(row[headers.indexOf(f)] ?? '').trim()]))));
}

export function notionText(property) {
  if (!property) return '';
  const value = property[property.type];
  if (Array.isArray(value)) return value.map(part => part.plain_text ?? part.text?.content ?? '').join('');
  if (value && typeof value === 'object') return value.name ?? '';
  return value == null ? '' : String(value);
}

export function createSource(c, fetcher = fetch) {
  const env = c.env;
  const auth = new GoogleAuth({ keyFile: env.GOOGLE_APPLICATION_CREDENTIALS, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const tab = `'${(env.GOOGLE_SHEET_TAB || 'Leads').replaceAll("'", "''")}'`;
  async function request(url, init, provider) {
    const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`${provider} request failed (HTTP ${response.status}). Check credentials and source access.`);
    return response.json();
  }
  async function sheets(range, method = 'GET', body) {
    required(env, ['GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_SHEET_ID']);
    const token = await auth.getAccessToken();
    return request(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SHEET_ID)}/values/${encodeURIComponent(range)}${method === 'PUT' ? '?valueInputOption=RAW' : ''}`,
      { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }, 'Google Sheets');
  }
  async function notion(path, method, body) {
    required(env, ['NOTION_TOKEN', 'NOTION_DATA_SOURCE_ID']);
    return request(`https://api.notion.com/v1/${path}`, { method, headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': '2025-09-03', 'Content-Type': 'application/json',
    }, body: JSON.stringify(body) }, 'Notion');
  }
  return {
    async read() {
      if (c.source === 'mock') return validateLeads(structuredClone(c.fixture.leads));
      if (c.source === 'sheets') return parseSheet((await sheets(`${tab}!A:Z`)).values);
      const leads = [];
      let cursor;
      do {
        const page = await notion(`data_sources/${encodeURIComponent(env.NOTION_DATA_SOURCE_ID)}/query`, 'POST', { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
        for (const item of page.results) {
          leads.push({ ...Object.fromEntries(fields.map(f => [f, notionText(item.properties[f])])),
            notionPage: item.id, notionStatusType: item.properties.status?.type });
        }
        cursor = page.has_more ? page.next_cursor : null;
      } while (cursor);
      return validateLeads(leads);
    },
    async markContacted(lead) {
      if (c.source === 'mock') return;
      if (c.source === 'notion') {
        const type = lead.notionStatusType;
        if (!['status', 'select', 'rich_text'].includes(type)) throw new Error('Notion status must be status, select, or text.');
        const value = type === 'rich_text' ? [{ text: { content: 'contacted' } }] : { name: 'contacted' };
        await notion(`pages/${encodeURIComponent(lead.notionPage)}`, 'PATCH', { properties: { status: { [type]: value } } });
        return;
      }
      const { values } = await sheets(`${tab}!A:Z`);
      parseSheet(values);
      const headers = values[0];
      const row = values.findIndex((r, i) => i > 0 && r[headers.indexOf('id')] === lead.id);
      if (row < 1) throw new Error('Lead moved or disappeared; source status not updated.');
      const column = String.fromCharCode(65 + headers.indexOf('status'));
      await sheets(`${tab}!${column}${row + 1}`, 'PUT', { values: [['contacted']] });
    },
  };
}
