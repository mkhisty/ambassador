import { validateSponsor, duplicateKey, MAX_FILE_BYTES } from './model.mjs';

export async function readSpreadsheet(file) {
  if(file.size>MAX_FILE_BYTES)throw new Error('Maximum spreadsheet size is 2 MB.');
  let rows;
  if(file.name.toLowerCase().endsWith('.csv'))rows=parseCSV(await file.text());
  else if(file.name.toLowerCase().endsWith('.xlsx')) {
    const module=await import('exceljs'),workbook=new module.default.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const sheet=workbook.worksheets[0];if(!sheet)throw new Error('Workbook has no worksheets.');
    if(sheet.rowCount>501||sheet.columnCount>100)throw new Error('Use at most 500 contacts and 100 columns.');
    rows=[];sheet.eachRow(row=>{
      const values=[];
      for(let i=1;i<=sheet.columnCount;i++){
        const cell=row.getCell(i),value=cell.value;
        values.push(value instanceof Date?value.toISOString().slice(0,10):typeof value==='object'&&value!==null?(value.text??value.result??cell.text):String(value??''));
      }
      rows.push(values);
    });
  }else throw new Error('Choose a CSV or XLSX file.');
  if(rows.length<2)throw new Error('Include a header row and at least one contact.');
  if(rows.length>501||rows[0].length>100)throw new Error('Import at most 500 contacts and 100 columns per file.');
  return rows;
}

export function parseCSV(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i=0;i<text.length;i++) {
    const c=text[i];
    if (c==='"') {
      if (quoted && text[i+1]==='"') {cell+='"';i++;}
      else if (quoted || cell==='') quoted=!quoted;
      else throw new Error('Unexpected quote in CSV.');
    } else if (!quoted && (c===',' || c==='\n' || c==='\r')) {
      row.push(cell);cell='';
      if (c!==',') {if(row.some(v=>v.trim()))rows.push(row);row=[];if(c==='\r'&&text[i+1]==='\n')i++;}
    } else cell+=c;
  }
  if (quoted) throw new Error('CSV has an unclosed quoted cell.');
  row.push(cell);if(row.some(v=>v.trim()))rows.push(row);
  if (!rows.length) throw new Error('File is empty.');
  return rows;
}

export const FIELD_LABELS = {company:'Organization (optional)',contact:'Contact name',address:'Email / phone / profile',channel:'Channel',stage:'Stage',owner:'Owner',notes:'Relationship notes',nextAction:'Next action',nextDate:'Follow-up date',source:'Contact source URL',fit:'Reason for outreach',category:'Category'};
export function guessMapping(headers) {
  const aliases={company:['company','sponsor','organization'],contact:['contact','contact name','name'],address:['address','email','phone'],stage:['stage','status'],amount:['amount','ask','contribution'],notes:['notes','relationship','strategy'],source:['source','source url','lead source'],nextAction:['next action','nextaction'],nextDate:['next date','nextdate','follow-up date']};
  // Continue accepting earlier spreadsheets without displaying financial fields in the campaign UI.
  return Object.fromEntries([...Object.keys(FIELD_LABELS),'amount','received'].map(key=>[key,headers.findIndex(h=>(aliases[key]||[key]).includes(String(h).trim().toLowerCase()))]));
}

export function prepareImport(rows, mapping, existing = []) {
  const keys=new Set(existing.map(duplicateKey)); const valid=[],errors=[];let duplicates=0;
  rows.slice(1).forEach((row,i)=>{
    try {
      const input=Object.fromEntries(Object.entries(mapping).filter(([,column])=>Number(column)>=0).map(([key,column])=>[key,row[Number(column)]]));
      if(input.amount)input.amount=String(input.amount).replace(/[$,]/g,'');
      if(input.received)input.received=String(input.received).replace(/[$,]/g,'');
      if(input.stage){const status=String(input.stage).trim().toLowerCase();const stages={ready:'Qualified',contacted:'Contacted',contract_review:'Negotiating','follow-up':'Negotiating',completed:'Committed'};input.stage=stages[status]||status[0].toUpperCase()+status.slice(1);}
      const sponsor=validateSponsor(input),key=duplicateKey(sponsor);
      if(keys.has(key)){duplicates++;return;}keys.add(key);valid.push(sponsor);
    }catch(error){errors.push({row:i+2,message:error.message});}
  });
  return {valid,errors,duplicates};
}
