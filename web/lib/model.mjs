export const STAGES = ['Identified', 'Qualified', 'Contacted', 'Replied', 'Negotiating', 'Committed', 'Declined'];
// Keep existing API and database stage values compatible; use campaign terminology in the UI.
export const STAGE_LABELS = {Identified:'Identified',Qualified:'Ready',Contacted:'Contacted',Replied:'Replied',Negotiating:'Follow-up',Committed:'Completed',Declined:'Declined'};
export const stageLabel = stage => STAGE_LABELS[stage] || stage;
export function outreachTotals(contacts) {
  return {total:contacts.length,awaitingReply:contacts.filter(c=>c.stage==='Contacted').length,responses:contacts.filter(c=>['Replied','Negotiating','Committed'].includes(c.stage)).length,completed:contacts.filter(c=>c.stage==='Committed').length};
}

export const DEFAULT_EVENT = { name: 'Your outreach campaign', date: '', location: '', attendees: 0, goal: 25000, outcomeGoal:0, audience:'', pitch: '', benefits: '' };

export function validateUser(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('User profile is required.');
  const phoneNumber = String(input.phoneNumber || '').trim().replace(/[\s().-]/g, '');
  if (!/^\+[1-9][0-9]{7,14}$/.test(phoneNumber)) throw new Error('Phone number must include + and country code (E.164).');
  const name = String(input.name || '').trim(), email = String(input.email || '').trim();
  if (name.length > 160) throw new Error('Name must be at most 160 characters.');
  if (email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error('Enter a valid email address.');
  const details = input.details ?? {};
  if (typeof details !== 'object' || details === null || Array.isArray(details) || JSON.stringify(details).length > 10000) throw new Error('Details must be a JSON object of at most 10,000 characters.');
  const companyIds = input.companyIds ?? [];
  if (!Array.isArray(companyIds) || companyIds.length > 500 || companyIds.some(id => typeof id !== 'string' || !id || id.length > 100)) throw new Error('Supply at most 500 valid company IDs.');
  return { phoneNumber, name, email, details, companyIds: [...new Set(companyIds)] };
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}

export function validateSponsor(input) {
  const text = (key, max = 2000) => {
    const value = input[key] == null ? '' : String(input[key]).trim();
    if (value.length > max) throw new Error(`${key} must be at most ${max} characters.`);
    return value;
  };
  const company = text('company', 160);
  const contact = text('contact', 160);
  if (!company && !contact) throw new Error('Contact name or organization is required.');
  const stage = text('stage', 30) || 'Identified';
  if (!STAGES.includes(stage)) throw new Error('Unknown outreach stage.');
  const amount = Number(input.amount || 0), received = Number(input.received || 0);
  if (![amount, received].every(n => Number.isFinite(n) && n >= 0 && n <= 10000000)) throw new Error('Amounts must be between 0 and 10,000,000.');
  if (received > amount) throw new Error('Received amount cannot exceed proposed contribution.');
  const source = text('source', 1000);
  if (source && !/^https?:\/\//i.test(source)) throw new Error('Lead source must be an http or https URL.');
  const nextDate = text('nextDate', 10);
  if (nextDate && !validDate(nextDate)) throw new Error('Follow-up date must use a valid YYYY-MM-DD date.');
  const channel = text('channel', 20) || 'email';
  if (!['email', 'imessage', 'linkedin'].includes(channel)) throw new Error('Channel must be email, imessage, or linkedin.');
  let phone = text('phone', 30).replace(/[\s().-]/g, '');
  if (/^\d{10}$/.test(phone)) phone = '+1' + phone;
  if (phone && !/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error('Contact phone must use a valid phone number with country code.');
  return { company, contact, address: text('address', 500), phone, channel, stage,
    amount, received, owner: text('owner', 160), notes: text('notes', 10000), nextAction: text('nextAction'), nextDate,
    source, fit: text('fit'), category: text('category', 80) || 'General', color: text('color', 20) || '#536b56' };
}

export function validateEvent(input) {
  const name = String(input.name || '').trim();
  if (!name || name.length > 160) throw new Error('Campaign name is required (maximum 160 characters).');
  const goal = Number(input.goal ?? 25000), attendees = Number(input.attendees ?? 0);
  if (!Number.isFinite(goal) || goal <= 0 || goal > 100000000) throw new Error('Invalid legacy goal value.');
  if (!Number.isInteger(attendees) || attendees < 0 || attendees > 1000000) throw new Error('Enter a valid attendee count.');
  const date = String(input.date || '');
  if (date && !validDate(date)) throw new Error('Enter a valid campaign deadline.');
  const outcomeGoal=Number(input.outcomeGoal || 0);
  if (!Number.isInteger(outcomeGoal) || outcomeGoal < 0 || outcomeGoal > 1000000) throw new Error('Target outcomes must be a whole number between 0 and 1,000,000.');
  const value = { name, date, goal, attendees, outcomeGoal };
  for (const key of ['location', 'pitch', 'benefits', 'audience']) {
    value[key] = String(input[key] || '').trim();
    if (value[key].length > 10000) throw new Error(`${key} is too long.`);
  }
  return value;
}

export function totals(sponsors) {
  const committed = sponsors.filter(s => s.stage === 'Committed').reduce((n, s) => n + s.amount, 0);
  const received = sponsors.reduce((n, s) => n + s.received, 0);
  const active = sponsors.filter(s => !['Committed', 'Declined'].includes(s.stage)).length;
  return { committed, received, active, pipeline: sponsors.filter(s => s.stage !== 'Declined').reduce((n, s) => n + s.amount, 0) };
}

export function duplicateKey(sponsor) {
  return `${sponsor.company.trim().toLowerCase()}|${(sponsor.address || sponsor.contact || '').trim().toLowerCase()}`;
}

// Snapshot of actual channels and current stages. No historical conversion is inferred.
export function flowData(sponsors) {
  if (!sponsors.length) return { nodes: [], links: [] };
  const channels = [['email', 'Email'], ['imessage', 'iMessage'], ['linkedin', 'LinkedIn']];
  const nodes = [], links = [];
  channels.forEach(([channel, label], order) => {
    const count = sponsors.filter(s => s.channel === channel).length;
    if (!count) return;
    const id = `channel:${channel}`;
    nodes.push({ id, label, order, column: 0 });
    links.push({ source: id, target: 'pool', value: count });
  });
  const unassigned = sponsors.filter(s => !channels.some(([channel]) => channel === s.channel)).length;
  if (unassigned) {
    nodes.push({ id: 'channel:other', label: 'Not assigned', order: 3, column: 0 });
    links.push({ source: 'channel:other', target: 'pool', value: unassigned });
  }
  nodes.push({ id: 'pool', label: 'Contacts', order: 0, column: 1 });
  STAGES.forEach((stage, order) => {
    const count = sponsors.filter(s => s.stage === stage).length;
    if (!count) return;
    const id = `stage:${stage}`;
    nodes.push({ id, label: stageLabel(stage), order, column: 2 });
    links.push({ source: 'pool', target: id, value: count });
  });
  return { nodes, links };
}
