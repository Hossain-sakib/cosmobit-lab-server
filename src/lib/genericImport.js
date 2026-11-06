import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import { readWorkbook } from './workbookImport.js';
import { fail } from './validation.js';
const normalize=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const text=cell=>{const v=cell?.value;if(v instanceof Date)return v.toISOString().slice(0,10);if(v&&typeof v==='object')return v.result??v.text??v.hyperlink??v.richText?.map(x=>x.text).join('')??'';return v??'';};
export async function importGeneric(buffer,filename,fields,options={}){
  let sheet;
  if(filename.toLowerCase().endsWith('.csv')){if(buffer.length>5*1024*1024)fail('CSV must be at most 5 MB.');const workbook=new ExcelJS.Workbook();try{sheet=await workbook.csv.read(Readable.from(buffer));}catch{fail('Unable to parse CSV.');}}
  else sheet=(await readWorkbook(buffer)).worksheets[0];
  if(!sheet)fail('No worksheet found.');
  let headerRow;
  sheet.eachRow(row=>{if(!headerRow&&row.values.filter(Boolean).length>1)headerRow=row;});
  if(!headerRow)fail('A header row with at least two columns is required.');
  const columns=[];headerRow.eachCell((cell,index)=>{const label=String(text(cell)).trim();if(!/password|private.?key|access.?token|session.?cookie/i.test(label))columns.push({index,label});});
  const suggestedMapping={};
  for(const[key,spec]of Object.entries(fields)){const source=columns.find(c=>[normalize(key),normalize(spec.label)].filter(Boolean).includes(normalize(c.label)));if(source)suggestedMapping[key]=source.index;}
  if(options.mode==='columns')return{columns,suggestedMapping,sourcePreview:Array.from({length:Math.min(5,Math.max(0,sheet.rowCount-headerRow.number))},(_,index)=>Object.fromEntries(columns.map(c=>[c.index,String(text(sheet.getRow(headerRow.number+1+index).getCell(c.index)))])))};
  let mapping=suggestedMapping;
  if(options.mapping){try{mapping=JSON.parse(options.mapping);}catch{fail('Invalid column mapping.');}if(!mapping||typeof mapping!=='object'||Array.isArray(mapping))fail('Invalid mapping.');}
  for(const[key,index]of Object.entries(mapping))if(!Object.hasOwn(fields,key)||!Number.isSafeInteger(index)||!columns.some(c=>c.index===index))fail('Invalid mapped column.');
  for(const[key,spec]of Object.entries(fields))if(spec.required&&!mapping[key])fail(`Map the ${spec.label||key} column before importing.`);
  const records=[];
  for(let i=headerRow.number+1;i<=sheet.rowCount;i++){
    const row=sheet.getRow(i);if(!row.values.some(Boolean))continue;
    const record={};for(const[key,col]of Object.entries(mapping)){const spec=fields[key];let v=text(row.getCell(col));if(v===undefined||v===null||v==='')continue;
      if(spec.type==='number')v=typeof v==='number'?v:Number(String(v).replace(/[$,]/g,''));
      else if(spec.type==='string-list')v=String(v).split(/[,\n]/).map(x=>x.trim()).filter(Boolean);
      else v=String(v).trim();record[key]=v;
    }
    if(Object.keys(record).length)records.push({...record,__source:{sheetName:sheet.name,rowNumber:i}});if(records.length>1000)fail('Import at most 1,000 records at a time.');
  }
  if(!records.length)fail('No data rows found.');
  return{records,warnings:['Status labels and currencies are preserved. No existing records are overwritten. Exact duplicates are skipped.']};
}
