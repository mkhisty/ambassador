import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, validateSponsor, validateEvent, validateUser, totals, outreachTotals, stageLabel, flowData, MAX_FILE_BYTES } from '../lib/model.mjs';
import { parseCSV, guessMapping, prepareImport, readSpreadsheet } from '../lib/import.mjs';
import { demoWorkspace } from '../lib/demo.mjs';
import { safeEqual, normalizePhone, hashPassword, checkPassword, sessionPhone, signSession, validSession, authorized, sameOrigin } from '../lib/auth.mjs';
import { validateFile } from '../lib/files.mjs';
import { readFile } from 'node:fs/promises';

test('User identity normalizes international phone numbers and validates linked profiles',()=>{
  assert.deepEqual(validateUser({phoneNumber:'+1 (555) 123-4567',name:' Alex ',email:'alex@example.com',details:{role:'Organizer'},companyIds:['a','a','b']}),{phoneNumber:'+15551234567',name:'Alex',email:'alex@example.com',details:{role:'Organizer'},companyIds:['a','b']});
  for(const phoneNumber of ['5551234567','alex@example.com','+0123456789','+1abc5551234567'])assert.throws(()=>validateUser({phoneNumber}),/country code/);
  assert.throws(()=>validateUser({phoneNumber:'+15551234567',email:'invalid'}),/email/);
  assert.throws(()=>validateUser({phoneNumber:'+15551234567',details:[]}),/Details/);
  assert.throws(()=>validateUser({phoneNumber:'+15551234567',companyIds:[null]}),/company IDs/);
});

test('CSV preserves quoted commas, escaped quotes, multiline notes and BOM; rejects incomplete input',()=>{
  const rows=parseCSV('\uFEFFcompany,notes\r\n"Acme, Inc","Met ""Alex""\nWarm intro"\r\n');
  assert.deepEqual(rows,[['company','notes'],['Acme, Inc','Met "Alex"\nWarm intro']]);
  assert.throws(()=>parseCSV('company\n"unclosed'),/unclosed/);
});
test('Import validates money/stages, maps old agent headers, and skips duplicates',()=>{
  const rows=parseCSV('company,contact,address,status,amount\nAcme,Alex,alex@example.com,ready,"$1,000"\nAcme,Alex,alex@example.com,ready,1000\nBad,Pat,pat@example.com,unknown,-1');
  const result=prepareImport(rows,guessMapping(rows[0]));
  assert.equal(result.valid.length,1);assert.equal(result.valid[0].stage,'Qualified');assert.equal(result.valid[0].amount,1000);assert.equal(result.duplicates,1);assert.equal(result.errors.length,1);
});
test('XLSX imports real worksheet values, dates, and cached formulas',async()=>{
  const {default:ExcelJS}=await import('exceljs');
  const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Sponsors');
  sheet.addRow(['company','amount','nextDate','notes']);
  sheet.addRow(['Workbook Partner',{formula:'500+500',result:1000},new Date('2026-11-01T00:00:00Z'),'Warm introduction']);
  const bytes=await workbook.xlsx.writeBuffer();
  const rows=await readSpreadsheet(new File([bytes],'sponsors.xlsx'));
  const result=prepareImport(rows,guessMapping(rows[0]));
  assert.equal(result.valid[0].amount,1000);assert.equal(result.valid[0].nextDate,'2026-11-01');assert.equal(result.valid[0].notes,'Warm introduction');
});
test('Sponsor and event validation rejects unsafe or impossible data',()=>{
  assert.throws(()=>validateSponsor({company:''}),/Contact name or organization/);
  assert.throws(()=>validateSponsor({company:'Acme',amount:50,received:100}),/Received/);
  assert.throws(()=>validateSponsor({company:'Acme',source:'javascript:alert(1)'}),/URL/);
  assert.throws(()=>validateSponsor({company:'Acme',amount:Infinity}),/Amounts/);
  assert.throws(()=>validateSponsor({company:'Acme',nextDate:'2026-02-31'}),/valid/);
  assert.throws(()=>validateEvent({name:'Event',goal:0,attendees:10}),/goal/);
});

test('Campaign workflows accept individual contacts, count outreach outcomes, and map generic stages',()=>{
  const person=validateSponsor({contact:'Wedding guest',address:'guest@example.com'});
  assert.equal(person.company,'');assert.equal(person.contact,'Wedding guest');
  const campaign=validateEvent({name:'Wedding invitations',outcomeGoal:40,audience:'Family and friends'});
  assert.equal(campaign.outcomeGoal,40);assert.equal(campaign.audience,'Family and friends');
  assert.throws(()=>validateEvent({name:'Campaign',outcomeGoal:1.5}),/whole number/);
  assert.deepEqual(outreachTotals(demoWorkspace().sponsors),{total:26,awaitingReply:4,responses:11,completed:5});
  assert.equal(stageLabel('Qualified'),'Ready');assert.equal(stageLabel('Negotiating'),'Follow-up');assert.equal(stageLabel('Committed'),'Completed');
  const rows=parseCSV('name,email,stage\nAlex,alex@example.com,Completed\nBlair,blair@example.com,Follow-up');
  const imported=prepareImport(rows,guessMapping(rows[0]));
  assert.equal(imported.errors.length,0);assert.equal(imported.valid[0].stage,'Committed');assert.equal(imported.valid[1].stage,'Negotiating');
});
test('Totals separate money states; Sankey conserves sponsors and reflects current stages',()=>{
  const data=demoWorkspace(),summary=totals(data.sponsors);
  assert.equal(summary.committed,17500);assert.equal(summary.received,8500);assert.equal(summary.active,19);
  const graph=flowData(data.sponsors);
  assert.equal(graph.links.filter(l=>l.target==='pool').reduce((n,l)=>n+l.value,0),26);
  assert.equal(graph.links.filter(l=>l.source==='pool').reduce((n,l)=>n+l.value,0),26);
  const imported=flowData([{id:'1',stage:'Negotiating',channel:'imessage'}]);
  assert.deepEqual(imported.links,[{source:'channel:imessage',target:'pool',value:1},{source:'pool',target:'stage:Negotiating',value:1}]);
  assert.equal(flowData([{id:'1',stage:'Qualified'}]).links.at(-1).target,'stage:Qualified');
  assert.deepEqual(flowData([]),{nodes:[],links:[]});
});
test('File boundary checks reject unsupported and oversized uploads',()=>{
  assert.equal(validateFile('strategy.pdf',123),'application/pdf');
  assert.throws(()=>validateFile('page.html',100),/Upload/);
  assert.throws(()=>validateFile('notes.txt',MAX_FILE_BYTES+1),/2 MB/);
  assert.throws(()=>validateFile('notes.txt',0),/2 MB/);
});

test('26-account demo and generated worker/CSV fixtures stay aligned with phone profiles and strategies',async()=>{
  const now=new Date('2026-10-03T12:00:00-04:00'),data=demoWorkspace(now);
  assert.equal(data.sponsors.length,26);
  assert.deepEqual([...new Set(data.sponsors.map(s=>s.stage))].sort(),[...STAGES].sort());
  assert.equal(new Set(data.sponsors.map(s=>s.channel)).size,3);
  data.sponsors.forEach((s,i)=>{
    assert.doesNotThrow(()=>validateSponsor(s));
    assert.doesNotThrow(()=>validateUser(data.users[0]));
    assert.ok(data.users[0].companyIds.includes(s.id));assert.equal(data.users[0].phoneNumber,'+17344199492');
    assert.ok(s.notes.includes('Fictional'));
    assert.equal(data.activities.filter(a=>a.sponsorId===s.id).at(-1).toStage,'Identified');
    assert.equal(data.activities.find(a=>a.sponsorId===s.id).toStage,s.stage);
  });
  assert.ok(data.activities.every(a=>new Date(a.at)<=now));
  const fixture=JSON.parse(await readFile(new URL('../../messaging-integration/demo/fixtures.json',import.meta.url),'utf8'));
  assert.deepEqual(fixture.leads.map(l=>[l.company,l.stage,l.channel,l.amount,l.received]),data.sponsors.map(s=>[s.company,s.stage,s.channel,s.amount,s.received]));
  assert.equal(fixture.leads.filter(l=>l.status==='ready').length,5);
  const rows=parseCSV(await readFile(new URL('./fixtures/sponsors.csv',import.meta.url),'utf8'));
  const imported=prepareImport(rows,guessMapping(rows[0]));
  assert.equal(imported.valid.length,26);assert.equal(imported.errors.length,0);
  const strategy=await readFile(new URL('../../STRATEGY.md',import.meta.url),'utf8');
  data.sponsors.forEach(s=>assert.ok(strategy.includes(`### ${s.company} — ${s.stage}`)));
});
test('Sessions reject expired, tampered and cross-origin requests; agent tokens stay server-side',()=>{
  process.env.WORKSPACE_PASSWORD='test-password-123';process.env.SESSION_SECRET='x'.repeat(32);process.env.AGENT_API_TOKEN='a'.repeat(32);
  const token=signSession(undefined,'+17344199492');assert.equal(validSession(token),true);assert.equal(validSession(token+'bad'),false);assert.equal(validSession(signSession(Date.now()-1)),false);assert.equal(safeEqual('x','xx'),false);
  const request={method:'POST',url:'https://example.com/api/workspace',cookies:{get:()=>({value:token})},headers:new Headers({origin:'https://evil.example'})};
  assert.equal(authorized(request),false);request.headers.set('origin','https://example.com');assert.equal(authorized(request),true);
  request.cookies.get=()=>undefined;request.headers.set('authorization',`Bearer ${process.env.AGENT_API_TOKEN}`);assert.equal(authorized(request,true),true);assert.equal(authorized(request,false),false);
  const local={url:'http://localhost:3000/api/session',headers:new Headers({origin:'http://127.0.0.1:3000',host:'127.0.0.1:3000'})};
  assert.equal(sameOrigin(local),true);local.headers.set('origin','https://evil.example');assert.equal(sameOrigin(local),false);local.headers.delete('origin');assert.equal(sameOrigin(local),false);
});

test('Phone identities require signed sessions and account passwords reject impersonation',async()=>{
  process.env.WORKSPACE_PASSWORD='test-password-123';process.env.SESSION_SECRET='x'.repeat(32);
  assert.equal(normalizePhone('7344199492'),'+17344199492');
  assert.equal(normalizePhone('+1 (734) 419-9492'),'+17344199492');
  assert.throws(()=>normalizePhone(''),/phone/);
  const token=signSession(undefined,'+17344199492');
  const request={cookies:{get:()=>({value:token})}};
  assert.equal(sessionPhone(request),'+17344199492');
  request.cookies.get=()=>({value:token.replace('7344199492','7344199493')});assert.equal(sessionPhone(request),null);
  request.cookies.get=()=>({value:signSession()});assert.equal(sessionPhone(request),null);
  const hash=await hashPassword('personal-password-123');
  assert.equal(await checkPassword('personal-password-123',hash),true);
  assert.equal(await checkPassword('incorrect-password-123',hash),false);
  assert.notEqual(hash,await hashPassword('personal-password-123'));
});
