import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parseFields, countdown, projectCalculated, specialCalculated, allocateAmount } from '../src/lib/management.js';
import { projectFields, specialOrderFields } from '../src/lib/managementFields.js';
import { importProjectWorkbook, importSpecialWorkbook, importProductLeads, importSamples } from '../src/lib/workbookImport.js';
test('management date and monetary calculations',()=>{
  assert.equal(countdown('2026-11-07',new Date('2026-11-06T17:59:59Z')),1);
  assert.equal(countdown('2026-11-07',new Date('2026-11-06T18:00:00Z')),0);
  const project=projectCalculated({orderAmount:0.03,bonusAmount:0.02,feePercent:20,pages:[{status:'Done'},{status:'in-progress'}]});
  assert.equal(project.afterFiverr,0.02);assert.equal(project.bonusAfterFiverr,0.02);assert.equal(project.totalAfterFiverr,0.04);assert.equal(project.pageProgress,50);
  assert.equal(specialCalculated({orderStartDate:'2026-12-30',timelineDays:5},new Date('2026-12-30T00:00:00Z')).effectiveDeliveryDate,'2027-01-04');
  const rows=allocateAmount(0.01,[{person:'One',percent:50},{person:'Two',percent:50}]);assert.equal(rows.reduce((n,r)=>n+r.amount,0),0.01);
  assert.equal(allocateAmount(100,[{person:'One',percent:60}]).find(r=>r.person==='Unassigned').amount,40);
});
test('strict field validation rejects unsafe URLs, invalid dates, amounts, and query objects',()=>{
  assert.throws(()=>parseFields({projectName:'Test',websiteUrl:'javascript:alert(1)'},projectFields));
  assert.throws(()=>parseFields({projectName:'Test',deliveryLastDate:'2026-02-30'},projectFields));
  assert.throws(()=>parseFields({projectName:'Test',orderAmount:1.001},projectFields));
  assert.throws(()=>parseFields({projectName:{$ne:null}},projectFields));
  assert.equal(parseFields({profileName:'Profile',review:'Yes',secretReview:'No'},specialOrderFields).review,'Yes');
});
test('project workbook import excludes credential lines and preserves page status labels',async()=>{
  const workbook=new ExcelJS.Workbook();const instructions=workbook.addWorksheet('Instruction');
  instructions.getCell('D14').value='Project Name';instructions.getCell('E14').value='Wordpress_Fiverr_Profile_#ID_Example_$400';
  instructions.getCell('D20').value='Project Instructions';instructions.getCell('D22').value='Build a responsive site';
  instructions.getCell('D23').value='Instruction From Client';instructions.getCell('E23').value='Redesign';
  instructions.getCell('D29').value='WordPress Login Credentials( Our own Hosting)';instructions.getCell('E29').value='https://example.com';instructions.getCell('E31').value='test-secret-not-imported';
  const pages=workbook.addWorksheet('Pages');pages.getRow(2).values=[,,, 'All Page','Old Link','New Link','Assign','Status','Recheck'];pages.getRow(3).values=[,,, 'Home','https://old.example.com','https://new.example.com','Worker','Done','Transferred'];
  const result=await importProjectWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()));
  assert.equal(result.records[0].orderAmount,400);assert.equal(result.records[0].pages[0].status,'Done');assert.equal(result.records[0].projectInstructions,'Build a responsive site');assert.ok(!JSON.stringify(result).includes('test-secret-not-imported'));
});
test('special orders import ignores blank dropdown template rows',async()=>{
  const workbook=new ExcelJS.Workbook();const sheet=workbook.addWorksheet('Orders');sheet.addRow(['Profile name','Type','Client-name','Order type','Conversation doc link','Order amount ($)','Amount in Taka','Timeline (Days)','Keyword','Gig Position','Website URL','Order start date','Status','Post order conversation link','Conversation start date','Countdown','Status','Delivery date','Delivery countdown','Status','Review text','Review','Secret review','Status','Payment status']);sheet.addRow(['Profile','WordPress','Client','','',100,12000,7,'','','','2026-11-06','Pending','','','','In Progress','','','Hold','','Yes','No','','Paid']);sheet.addRow(['','Shopify','','','','','','','','','','','Pending']);
  const result=await importSpecialWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()));assert.equal(result.records.length,1);assert.equal(result.records[0].paymentStatus,'paid');assert.equal(result.records[0].review,'Yes');assert.equal(result.records[0].conversationStatus,'In Progress');
});
test('product lead import uses worksheet ownership and normalizes URL schemes',async()=>{
  const workbook=new ExcelJS.Workbook();const sheet=workbook.addWorksheet('Sales Owner');sheet.addRow(['Client Name','Designation','Company Name','City','Email','Contact Number','LinkedIn','Website','Pain Point','Offer']);sheet.addRow(['Example person','Owner','Example company','Dhaka','person@example.com','123.0','linkedin.com/in/example','https://example.com','Needs product','Demo']);
  const result=await importProductLeads(Buffer.from(await workbook.xlsx.writeBuffer()));assert.equal(result.records[0].owner,'Sales Owner');assert.equal(result.records[0].linkedin,'https://linkedin.com/in/example');assert.equal(result.records[0].contactNumber,'123');
});
test('sample workbook imports separate website/graphic media with unused default',async()=>{
  const workbook=new ExcelJS.Workbook();workbook.addWorksheet('Website samples').addRows([['Project Name','URL','Category','Tech Stack','Platform Type'],['Example','https://example.com','Commerce','React','Custom']]);workbook.addWorksheet('Graphic').addRows([['URL','Type/category','Project brief'],['https://example.com/design','Branding','Logo']]);const result=await importSamples(Buffer.from(await workbook.xlsx.writeBuffer()));assert.equal(result.records.length,2);assert.equal(result.records[1].medium,'graphic');assert.ok(result.records.every(r=>r.useStatus==='unused'));
});
