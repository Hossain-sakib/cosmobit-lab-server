import ExcelJS from 'exceljs';
import yauzl from 'yauzl';
import { fail } from './validation.js';
const normalized = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function value(cell) {
  const v = cell?.value;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (v && typeof v === 'object') {
    if ('result' in v) return v.result ?? '';
    if (v.richText) return v.richText.map(x => x.text).join('');
    if (v.hyperlink) return v.hyperlink;
    return v.text || '';
  }
  return v ?? '';
}
const string = cell => String(value(cell)).trim();
const safeUrl = input => { try { const u = new URL(input); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? input : ''; } catch { return ''; } };
async function checkZip(buffer) {
  if (buffer.length > 5 * 1024 * 1024) fail('Workbook must be at most 5 MB.');
  await new Promise((resolve, reject) => yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
    if (error) return reject(new Error('Invalid XLSX archive.'));
    let size = 0, entries = 0;
    zip.on('error', reject);
    zip.on('entry', entry => {
      size += entry.uncompressedSize;
      if (++entries > 1000 || size > 20 * 1024 * 1024 || entry.uncompressedSize > 10 * 1024 * 1024 || (entry.generalPurposeBitFlag & 1)) {
        zip.close(); reject(new Error('Workbook is encrypted or expands beyond the import limits.')); return;
      }
      zip.readEntry();
    });
    zip.on('end', resolve); zip.readEntry();
  }));
}
export async function readWorkbook(buffer) {
  try {
    await checkZip(buffer);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    if (workbook.worksheets.length > 20) fail('Workbook has too many sheets.');
    for (const sheet of workbook.worksheets) if (sheet.rowCount > 5000 || sheet.columnCount > 100) fail('Workbook exceeds 5,000 rows or 100 columns per sheet.');
    return workbook;
  } catch (err) { fail(err.status ? err.message : 'Unable to read workbook. Use an unencrypted XLSX file within the import limits.'); }
}
export async function importProjectWorkbook(buffer) {
  const workbook = await readWorkbook(buffer);
  const record = { projectName: '', pages: [], revisions: [] };
  const labels = {
    projectname: 'projectName', deadline: 'deliveryLastDate', workprogressdone: 'progress', assignto: 'assign', assignedby: 'assignedBy',
    instructionfromclient: 'clientInstructions', orderpagescreenshot: 'orderScreenshotLink', conversationpagescreenshot: 'conversationScreenshotLink',
    fileslinksifany: 'filesLink', scopeofwork: 'scopeOfWork', themenamechildthemename: 'themeName', pagebuildername: 'pageBuilder',
    referencewebsitelinkordesignfigmainvisionadobexdpsd: 'referenceDesignLink', specialsplugin: 'specialPlugins', specialrequirement: 'specialRequirements', notecommentsifany: 'notes',
  };
  const urlFields = new Set(['orderScreenshotLink', 'conversationScreenshotLink', 'filesLink', 'referenceDesignLink']);
  let credentialSections = false;
  for (const sheet of workbook.worksheets) {
    let pageHeader;
    sheet.eachRow(row => {
      row.eachCell((cell, column) => {
        const key = normalized(string(cell));
        if (labels[key]) {
          const field = labels[key]; let v = value(row.getCell(column + 1));
          if (field === 'progress') { const n = Number(String(v).replace('%', '')); v = String(value(row.getCell(column + 1))).includes('%') ? n : n <= 1 ? n * 100 : n; v = Math.min(100, Math.max(0, Math.round(v || 0))); }
          else if (field === 'deliveryLastDate') v = /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : '';
          else v = String(v || '').trim();
          if (urlFields.has(field)) v = safeUrl(v);
          if (v !== '') record[field] = v;
        }
        if (key === 'projectinstructions') {
          const lines = [];
          for (let i = row.number + 1; i <= Math.min(row.number + 10, sheet.rowCount); i++) {
            const next = sheet.getRow(i);
            if (labels[normalized(string(next.getCell(column)))] || /credentials|revisionhistory/.test(normalized(string(next.getCell(column))))) break;
            const content = [string(next.getCell(column)), string(next.getCell(column + 1))].filter(Boolean).join(' ');
            if (content) lines.push(content);
          }
          record.projectInstructions = lines.join('\n');
        }
        if (key.includes('credentials') || key.includes('cpanelhosting')) {
          credentialSections = true;
          const host = safeUrl(string(row.getCell(column + 1)));
          if (host && key.includes('ourown')) record.ownHostingUrl = host;
          if (host && key.includes('clienthosting') && !key.includes('cpanel')) record.clientHostingUrl = host;
        }
        if (key === 'allpage' && normalized(string(row.getCell(column + 1))) === 'oldlink') pageHeader = { row: row.number, column };
      });
    });
    if (pageHeader) {
      for (let i = pageHeader.row + 1; i <= sheet.rowCount; i++) {
        const row = sheet.getRow(i), c = pageHeader.column;
        const name = string(row.getCell(c));
        if (!name) continue;
        record.pages.push({ name, oldUrl: safeUrl(string(row.getCell(c + 1))), newUrl: safeUrl(string(row.getCell(c + 2))), assign: string(row.getCell(c + 3)), status: string(row.getCell(c + 4)), recheck: string(row.getCell(c + 5)), remarks: '' });
        if (record.pages.length > 500) fail('A project may contain at most 500 page tasks.');
      }
    }
    sheet.eachRow(row => row.eachCell((cell, column) => {
      if (normalized(string(cell)) !== 'date' || normalized(string(row.getCell(column + 1))) !== 'messages') return;
      for (let i = row.number + 1; i <= Math.min(row.number + 2, sheet.rowCount); i++) {
        const date = string(sheet.getRow(i).getCell(column));
        const message = string(sheet.getRow(i).getCell(column + 1));
        if (message && /^\d{4}-\d{2}-\d{2}$/.test(date)) record.revisions.push({ date, message, author: '' });
      }
    }));
  }
  if (!record.projectName) fail('Project Name was not found. Use the Instruction/Pages workbook layout.');
  const match = /^([^_]+)_Fiverr_([^_]+)_#([^_]+)_([^_]+)_\$(\d+(?:\.\d{1,2})?)$/i.exec(record.projectName);
  if (match) Object.assign(record, { projectType: match[1], account: match[2], clientName: match[4], orderAmount: Number(match[5]) });
  record.__source = {sheetName: 'Instruction', rowNumber: 14};
  return { records: [record], warnings: [credentialSections ? 'Hosting passwords were intentionally excluded. Add a password-manager link in the credential-reference field.' : '', 'This is a preview. Nothing is saved until you review and save the project.'].filter(Boolean) };
}
export async function importSpecialWorkbook(buffer) {
  const workbook = await readWorkbook(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) fail('Workbook has no worksheets.');
  const keys = ['profileName','type','clientName','orderType','conversationDocLink','orderAmount','amountTaka','timelineDays','keyword','gigPosition','websiteUrl','orderStartDate','orderStatus','postOrderConversationLink','conversationStartDate',null,'conversationStatus','deliveryDate',null,'deliveryStatus','reviewText','review','secretReview','reviewStatus','paymentStatus'];
  let header;
  sheet.eachRow(row => { if (normalized(string(row.getCell(1))) === 'profilename' && normalized(string(row.getCell(3))) === 'clientname') header = row.number; });
  if (!header) fail('Special Order Tracker headers were not found.');
  const records = [];
  for (let i = header + 1; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i);
    if (!string(row.getCell(1))) continue; // Ignore blank template rows and preset dropdown defaults.
    const record = {};
    keys.forEach((key, index) => {
      if (!key) return;
      let v = value(row.getCell(index + 1));
      if (['orderAmount','amountTaka','timelineDays'].includes(key)) v = v === '' ? 0 : Number(v);
      else v = String(v || '').trim();
      if (key.endsWith('Link') || key === 'websiteUrl') v = safeUrl(v);
      if (key === 'paymentStatus') v = { paid: 'paid', unpaid: 'unpaid', 'n/a': 'not-applicable', partial: 'partial', refunded: 'refunded' }[v.toLowerCase()] || 'unpaid';
      record[key] = v;
    });
    record.__source={sheetName:sheet.name,rowNumber:i};
    records.push(record);
    if (records.length > 100) fail('Import at most 100 special orders at a time.');
  }
  if (!records.length) fail('No orders with a Profile name were found. Blank template rows are not imported.');
  return { records, warnings: ['Review imported orders before saving. Countdown columns are recalculated from dates.'] };
}
export async function importProductLeads(buffer) {
  const workbook = await readWorkbook(buffer), records = [];
  const aliases = { clientname:'clientName', designation:'designation', companyname:'companyName', city:'city', personalemail:'email', email:'email', personalcontactnumber:'contactNumber', contactnumber:'contactNumber', linkedin:'linkedin', personalwebsite:'personalWebsite', companywebsite:'companyWebsite', website:'companyWebsite', painpoint:'painPoint', offer:'offer' };
  for (const sheet of workbook.worksheets) {
    let headers;
    sheet.eachRow(row => {
      if (!headers) {
        const columns = {};
        row.eachCell((cell, col) => { const key = aliases[normalized(string(cell))]; if (key) columns[col] = key; });
        if (Object.values(columns).includes('clientName')) headers = columns;
        return;
      }
      const record = { owner: sheet.name, status: 'new' };
      for (const [col, key] of Object.entries(headers)) {
        let v = string(row.getCell(Number(col)));
        if (key === 'contactNumber') v = v.replace(/\.0$/, '');
        if (['linkedin','personalWebsite','companyWebsite'].includes(key)) v = safeUrl(v && !/^https?:\/\//i.test(v) ? `https://${v}` : v);
        record[key] = v;
      }
      if (record.clientName) { record.__source={sheetName:sheet.name,rowNumber:row.number}; records.push(record); }
    });
  }
  if (!records.length) fail('No lead rows with Client Name headers were found.');
  if (records.length > 1000) fail('Import at most 1,000 leads at a time.');
  return { records, warnings: ['Worksheet names become lead owners. Existing emails/phone numbers within this product are skipped; no outreach is sent.'] };
}
export async function importSamples(buffer) {
  const workbook = await readWorkbook(buffer), records = [];
  for (const sheet of workbook.worksheets) {
    const graphic = /graphic/i.test(sheet.name);
    let header;
    sheet.eachRow(row => {
      if (!header) {
        const cols = {};
        const aliases = { projectname:'name', url:'url', category:'category', typecategory:'category', techstack:'techStack', platformtype:'platformType', projectbrief:'brief', status:'useStatus' };
        row.eachCell((cell, col) => { const key = aliases[normalized(string(cell))]; if (key) cols[col] = key; });
        if (Object.values(cols).includes('url')) header = cols;
        return;
      }
      const record = { medium: graphic ? 'graphic' : 'website', collectionType: 'work-sample', useStatus: 'unused' };
      for (const [col, key] of Object.entries(header)) record[key] = string(row.getCell(Number(col)));
      record.url = safeUrl(record.url);
      if (!record.url) return;
      record.name ||= record.category || `${graphic ? 'Graphic' : 'Website'} sample`;
      record.useStatus = record.useStatus.toLowerCase() === 'used' ? 'used' : 'unused';
      records.push(record);
    });
  }
  if (!records.length) fail('No website/graphic sample rows found.');
  return { records, warnings: ['Rows without a valid URL are ignored. Usage defaults to Unused unless the sheet explicitly says Used. Review before importing.'] };
}
export async function importTasks(buffer) {
  const workbook = await readWorkbook(buffer), records = [];
  const aliases = { prioritytasks:'title', task:'title', category:'category', status:'status', startdate:'startDate', assigndate:'startDate', enddate:'endDate', completedate:'completedDate', outputurl:'outputUrl', filelink:'outputUrl', person:'assigneeName', assignedto:'assigneeName', comment:'comment', priority:'priority' };
  for (const sheet of workbook.worksheets) {
    let headers;
    sheet.eachRow(row => {
      if (!headers) {
        const cols = {};
        row.eachCell((cell,col) => { const key = aliases[normalized(string(cell))]; if (key) cols[col] = key; });
        if (Object.values(cols).includes('title')) headers = cols;
        return;
      }
      const record = {};
      for (const [col,key] of Object.entries(headers)) record[key] = string(row.getCell(Number(col)));
      if (!record.title) return;
      record.sourceStatus = record.status || '';
      record.status = ({ pending:'todo', wip:'in-progress', inprogress:'in-progress', complete:'done', completed:'done', hold:'blocked' })[normalized(record.status)] || 'todo';
      record.priority = ['low','normal','high','urgent'].includes(record.priority?.toLowerCase()) ? record.priority.toLowerCase() : 'normal';
      if (record.outputUrl && !safeUrl(record.outputUrl)) { record.comment = [record.comment, record.outputUrl].filter(Boolean).join('\n'); record.outputUrl = ''; }
      records.push(record);
    });
  }
  if (!records.length) fail('No task rows found.');
  return { records, warnings: ['Sheet assignee names are preserved. Link each imported task to a registered employee or department so it appears in employee task lists.'] };
}
const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
function sheetMonth(name) {
  const year = /20\d{2}/.exec(name)?.[0];
  const corrected = name.toLowerCase().replace('septeber','september');
  const index = monthNames.findIndex(x => corrected.includes(x));
  return year && index >= 0 ? `${year}-${String(index + 1).padStart(2,'0')}` : null;
}
export async function importSalesActivity(buffer, options = {}) {
  const workbook = await readWorkbook(buffer);
  const availableMonths = [...new Set(workbook.worksheets.map(s => sheetMonth(s.name)).filter(Boolean))].sort().reverse();
  const month = options.month || availableMonths[0];
  const records = [];
  for (const sheet of workbook.worksheets.filter(s => sheetMonth(s.name) === month)) {
    let date = '';
    sheet.eachRow(row => {
      const d = string(row.getCell(1));
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) date = d;
      const profile = string(row.getCell(2));
      if (!date || !profile || /total|profiles|daily result/i.test(profile)) return;
      const record = { date, profile, platform: options.platform === 'Upwork' ? 'Upwork' : 'Fiverr' };
      let hasActivity = false;
      ['morning','evening','night'].forEach((shift, index) => ['Query','Quote','Order','Pass'].forEach((metric, m) => {
        const n = Number(value(row.getCell(3 + index * 4 + m))) || 0;
        record[shift + metric] = n;
        if (n) hasActivity = true;
      }));
      if (hasActivity) records.push(record);
    });
  }
  if (!records.length) fail(`No activity rows for ${month || 'this workbook'}. Available months: ${availableMonths.join(', ')}.`);
  return { records, availableMonths, warnings: [`Importing ${month}. Formula totals are ignored and recalculated. Blank zero-activity rows are not imported.`] };
}
export async function importDistribution(buffer, options = {}) {
  const workbook = await readWorkbook(buffer), records = [];
  for (const sheet of workbook.worksheets) {
    const month = sheetMonth(sheet.name);
    if (!month || (options.month && options.month !== month)) continue;
    let headers;
    sheet.eachRow(row => {
      if (!headers) {
        const cols = {};
        row.eachCell((cell,col) => { const n = normalized(string(cell)); if (['name','amount','orderno'].includes(n)) cols[n] = col; });
        if (cols.name && cols.amount && cols.orderno) headers = cols;
        return;
      }
      const person = string(row.getCell(headers.name));
      if (!person || /^(total|name)$/i.test(person)) return;
      const amount = Number(value(row.getCell(headers.amount))) || 0;
      const orders = Number(value(row.getCell(headers.orderno))) || 0;
      if (amount || orders) records.push({ month, person, amount, orders, division: options.division === 'operations' ? 'operations' : 'sales', platform: options.platform === 'Upwork' ? 'Upwork' : 'Fiverr' });
    });
  }
  if (!records.length) fail('No monthly Name/Amount/Order no. rows found.');
  return { records, warnings: ['Historical totals are stored separately from live project distributions to prevent double counting. Review the month/platform/division before saving.'] };
}
export async function importApplications(buffer) {
  const workbook = await readWorkbook(buffer), records = [];
  const aliases = { timestamp:'submittedDate', emailaddress:'email', fullname:'fullName', phonenumber:'phone', dateofbirth:'dateOfBirth', gender:'gender', whichroleareyouapplyingfor:'position', doyouhaveanypriorexperienceinthisfield:'experience', expectedsalary:'expectedSalary', uploadyourcvpdfonly:'cvLink', comment:'comment' };
  for (const sheet of workbook.worksheets) {
    let headers;
    sheet.eachRow(row => {
      if (!headers) {
        const cols = {};
        row.eachCell((cell,col) => { const key = aliases[normalized(string(cell))]; if (key) cols[col] = key; });
        if (Object.values(cols).includes('fullName')) headers = cols;
        return;
      }
      const record = {};
      for (const [col,key] of Object.entries(headers)) record[key] = string(row.getCell(Number(col)));
      if (!record.fullName || !record.email) return;
      if (record.cvLink) record.cvLink = safeUrl(record.cvLink);
      record.position ||= 'Unspecified';
      records.push(record);
    });
  }
  if (!records.length) fail('No application rows found.');
  return { records, warnings: ['CV links are preserved as links, not downloaded. Original applicant data is private to administrators.'] };
}
