import { Router } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import defaultServices from '../data/defaultServices.json' with { type: 'json' };
import { randomUUID, createHash } from 'node:crypto';
import { ManagedProject, SpecialOrder, Product, WorkSample, Department, Employee, TeamTask, SalesActivity, DistributionHistory, CareerApplication } from '../models/Management.js';
import Job from '../models/Job.js';
import User from '../models/User.js';
import productLeadsRouter from './productLeads.js';
import projectTasksRouter from './projectTasks.js';
import mediaRouter from './media.js';
import overviewRouter from './studioOverview.js';
import { searchRouter } from './studioSearch.js';
import reportsRouter from './managementReports.js';
import businessActionsRouter from './businessActions.js';
import notificationsRouter from './notifications.js';
import { documentActions } from './documentShares.js';
import { recordNotification } from '../services/automation.js';
import { importGeneric } from '../lib/genericImport.js';
import { catalogEntry } from '../lib/moduleCatalog.js';
import { businessModules } from '../lib/businessModules.js';
import { prepareBusinessRecord, afterBusinessSave, calculatedBusiness } from '../lib/businessWorkflows.js';
import { projectFields, specialOrderFields, pageFields, revisionFields, allocationFields, productFields, sampleFields, departmentFields, employeeFields, taskFields, salesActivityFields, distributionFields, applicationFields } from '../lib/managementFields.js';
import { parseFields, todayInDhaka } from '../lib/management.js';
import { importProjectWorkbook, importSpecialWorkbook, importSamples, importTasks, importSalesActivity, importDistribution, importApplications } from '../lib/workbookImport.js';
import { fail } from '../lib/validation.js';
import { requireAuth } from '../middleware/auth.js';
import { can, requirePermission, ROLE_LABELS, ROLE_PERMISSIONS, ALL_PERMISSIONS, MODULES, hasAllScope } from '../lib/permissions.js';
import { recordScope, visibleRecord } from '../lib/managementScope.js';
const router = Router();
router.use(requireAuth);
router.use('/products/:productId/leads', productLeadsRouter);
router.use('/reports', reportsRouter);
router.use('/workflows', businessActionsRouter);
router.use('/notifications', notificationsRouter);
router.use('/documents', documentActions);
router.use('/storage', mediaRouter);
router.use('/project-tasks', projectTasksRouter);
router.get('/people', async (req,res) => {
  if (!can(req.user,'team:edit') && !can(req.user,'projects:edit') && !can(req.user,'leads:edit')) fail('People directory access required.',403);
  const accountIds = can(req.user,'users:view') ? null : await Employee.distinct('accountUserId',{archived:false,status:'active'});
  const users = await User.find(accountIds ? {_id:{$in:[...accountIds,req.user._id]}} : {}).select('displayName email role').limit(500);
  res.json({ users });
});
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0, parts: 1 } });
export const managementModules = {
  ...businessModules,
  'job-openings': { Model: Job, fields: { title:{type:'text',label:'Job title',max:200,required:true},department:{type:'text',label:'Department',max:200,required:true},location:{type:'text',label:'Location',max:200},type:{type:'enum',label:'Employment type',values:['Full-time','Part-time','Contract','Internship']},description:{type:'text',label:'Description',max:20000,required:true},active:{type:'boolean',label:'Accept applications'} },title:'title',permission:'jobs',displayTitle:'Job Openings',singular:'job opening',defaults:{active:true,type:'Full-time'} },
  projects: { Model: ManagedProject, fields: projectFields, title: 'projectName', status: 'status', permission: 'projects', importer: importProjectWorkbook },
  'special-orders': { Model: SpecialOrder, fields: specialOrderFields, title: 'profileName', status: 'orderStatus', permission: 'special-orders', importer: importSpecialWorkbook },
  products: { Model: Product, fields: productFields, title: 'name', status: 'status', permission: 'products' },
  samples: { Model: WorkSample, fields: sampleFields, title: 'name', status: 'useStatus', permission: 'samples', importer: importSamples, filters: ['collectionType','medium','category'] },
  departments: { Model: Department, fields: departmentFields, title: 'name', permission: 'departments' },
  employees: { Model: Employee, fields: employeeFields, title: 'name', status: 'status', permission: 'team', filters: ['departmentId'] },
  'team-tasks': { Model: TeamTask, fields: taskFields, title: 'title', status: 'status', permission: 'tasks', importer: importTasks, filters: ['departmentId','employeeId'] },
  'sales-activity': { Model: SalesActivity, fields: salesActivityFields, title: 'profile', permission: 'sales-activity', importer: importSalesActivity, filters: ['platform','profile'] },
  'distribution-history': { Model: DistributionHistory, fields: distributionFields, title: 'person', permission: 'distribution-history', importer: importDistribution, filters: ['platform','division','month'] },
  applications: { Model: CareerApplication, fields: applicationFields, title: 'fullName', status: 'status', permission: 'applications', importer: importApplications },
};
router.use('/', overviewRouter);
router.use('/search', searchRouter(managementModules));
const financeFields = ['orderAmount','bonusAmount','feePercent','salesAllocations','operationsAllocations'];
function parseRecord(body, config, partial, user) {
  for(const [key,spec] of Object.entries(config.fields)) if(spec.writePermission && key in body && !can(user,spec.writePermission)) fail(`Permission required to edit ${spec.label||key}.`,403);
  const data = parseFields(body, config.fields, partial);
  if (body.sourceReference) data.sourceReference=parseFields(body.sourceReference,{fileName:{type:'text',max:300},sheetName:{type:'text',max:200},rowNumber:{type:'number',min:1,max:1000000,decimals:0}});
  if (config.arrays) for (const [key, specs] of Object.entries(config.arrays)) {
    if (!(key in body)) continue;
    if (!Array.isArray(body[key]) || body[key].length > 100) fail(`${key} must contain at most 100 rows.`);
    data[key] = body[key].map(row => parseFields(row, specs));
  }
  if (typeof body.archived === 'boolean') data.archived = body.archived;
  else if ('archived' in body) fail('archived must be a boolean.');
  if (config.Model === Employee && ['salary','salaryCurrency'].some(key=>key in body) && !can(user,'payroll:edit')) fail('Payroll edit permission is required for salary fields.',403);
  if (config.Model === ManagedProject) {
    if (!can(user, 'finance:edit') && financeFields.some(key => key in body)) fail('Financial fields require finance edit permission.', 403);
    for (const [key, specs, max] of [['pages', pageFields, 500], ['revisions', revisionFields, 200], ['salesAllocations', allocationFields, 50], ['operationsAllocations', allocationFields, 50]]) {
      if (!(key in body)) continue;
      if (!Array.isArray(body[key]) || body[key].length > max) fail(`${key} must contain at most ${max} rows.`);
      data[key] = body[key].map(row => parseFields(row, specs));
      if (key.endsWith('Allocations') && data[key].reduce((n,row) => n + row.percent, 0) > 100.00001) fail('Allocation percentages must total at most 100.');
    }
    if ('memberUserIds' in body) {
      if (!Array.isArray(body.memberUserIds) || body.memberUserIds.length > 50 || body.memberUserIds.some(id => !mongoose.isObjectIdOrHexString(id))) fail('Invalid project members.');
      data.memberUserIds = body.memberUserIds;
    }
  }
  if (config.Model === DistributionHistory && data.month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(data.month)) fail('Month must be YYYY-MM.');
  if (partial && !Object.keys(data).length) fail('No supported fields supplied.');
  return data;
}
async function validateReferences(data, config, req) {
  for (const [key, Model] of [['departmentId',Department],['employeeId',Employee],['accountUserId',User]]) {
    if (data[key] && !await Model.exists({ _id: data[key], ...(Model !== User ? { archived: false } : {}) })) fail(`The selected ${key} was not found.`);
  }
  for (const [key, spec] of Object.entries(config.fields)) {
    if (!spec.resource || !data[key]) continue;
    const target = managementModules[spec.resource];
    if (spec.resource === 'people') { if (!await User.exists({ _id: data[key] })) fail('Account not found.'); continue; }
    if (!target) continue;
    if (spec.resource === 'employees' && req && !can(req.user,'team:view') && await Employee.exists({_id:data[key],accountUserId:req.user.id,archived:false,status:'active'})) continue;
    if (req && !can(req.user, `${target.permission}:view`)) fail(`Access to the linked ${spec.resource} is required.`, 403);
    const scope = req ? await recordScope(req.user, target.permission) : {};
    if (!await target.Model.exists({ $and: [{ _id: data[key], archived: false }, scope] })) fail(`Linked ${spec.resource} not found.`,404);
  }
  if(config.Model === Employee && data.salaryCurrency && !/^[A-Z]{3}$/.test(data.salaryCurrency)) fail('Salary currency must use a three-letter uppercase code.');
  if (req && data.ownerUserId && !hasAllScope(req.user,config.permission) && String(data.ownerUserId) !== req.user.id) fail('Only a manager may reassign ownership.',403);
  if (data.pages) for (const page of data.pages) if (page.assigneeUserId && !await User.exists({_id:page.assigneeUserId})) fail('Page assignee not found.');
  if (data.memberUserIds && await User.countDocuments({ _id: { $in: data.memberUserIds } }) !== new Set(data.memberUserIds).size) fail('A project member was not found.');
  if (data.employeeId) {
    const employee = await Employee.findById(data.employeeId);
    if (employee.status !== 'active') fail('The selected employee is inactive.');
    if (data.departmentId && String(employee.departmentId) !== String(data.departmentId)) fail('Employee and department do not match.');
    if (!data.departmentId) data.departmentId = employee.departmentId;
  }
  if (config.Model === TeamTask && data.startDate && data.endDate && data.startDate > data.endDate) fail('End date must follow start date.');
}
async function syncEmployee(record, previous) {
  if (previous?.accountUserId && String(previous.accountUserId) !== String(record.accountUserId)) await User.updateOne({ _id: previous.accountUserId, role: 'employee' }, { $set: { role: 'user' } });
  if (record.accountUserId) await User.updateOne({ _id: record.accountUserId, role: { $nin: ['admin','super_admin'] } }, { $set: { studioSuspended: record.archived || record.status !== 'active' } });
  if (record.accountUserId) await User.updateOne({ _id: record.accountUserId, role: { $in: ['user','employee'] } }, { $set: { role: record.archived || record.status !== 'active' ? 'user' : 'employee' } });
}
router.post('/cms-services/bootstrap',requirePermission('cms:edit'),async(req,res)=>{
  const records=defaultServices;
  let created=0;
  for(const data of records){const existing=await businessModules['cms-services'].Model.exists({slug:data.slug});if(existing)continue;try{await businessModules['cms-services'].Model.create({...data,createdBy:req.user.id,updatedBy:req.user.id,history:[{at:new Date(),actor:req.user.id,action:'existing website service migrated',fields:Object.keys(data)}]});created++;}catch(err){if(err.code!==11000)throw err;}}
  res.json({created,message:'Existing website services migrated without overwriting records.'});
});
router.get('/catalog', async (req,res) => {
  const settings = await businessModules.settings.Model.findOne({ archived: false }).lean();
  const modules = Object.fromEntries(Object.entries(managementModules).filter(([,config])=>config.displayTitle).filter(([,config])=>can(req.user,`${config.permission}:view`)).map(([path,config])=>[path,catalogEntry(path,config,settings)]));
  res.json({modules});
});
router.get('/access', requirePermission('users:view'), async (req,res) => {
  const users = await User.find().select('email displayName role grantedPermissions deniedPermissions allScopes').limit(500);
  res.json({ users, roles: Object.keys(ROLE_PERMISSIONS), rolePermissions: ROLE_PERMISSIONS, roleLabels: ROLE_LABELS, permissions: ALL_PERMISSIONS, modules: MODULES });
});
router.patch('/access/:id', requirePermission('users:edit'), async (req,res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) fail('Invalid user ID.');
  const user = await User.findById(req.params.id);
  if (!user) fail('User not found.',404);
  if (user.role === 'super_admin' && req.user.role !== 'super_admin') fail('Only a super admin can change a super admin.',403);
  if (String(user._id) === req.user.id) fail('Ask another administrator to change your own access.');
  const update = {};
  if ('role' in req.body) {
    if (!Object.hasOwn(ROLE_PERMISSIONS, req.body.role) || (req.body.role === 'super_admin' && req.user.role !== 'super_admin')) fail('Role is not permitted.',403);
    update.role = req.body.role;
  }
  for (const key of ['grantedPermissions','deniedPermissions','allScopes']) if (key in req.body) {
    const allowed = key === 'allScopes' ? MODULES : ALL_PERMISSIONS;
    if (!Array.isArray(req.body[key]) || req.body[key].some(x => !allowed.includes(x))) fail('Invalid access settings.');
    update[key] = [...new Set(req.body[key])];
  }
  if (!Object.keys(update).length) fail('No access changes supplied.');
  if (!['admin','super_admin'].includes(req.user.role)) {
    const nextRole=update.role||user.role;
    if (['admin','super_admin'].includes(nextRole)) fail('Only an administrator may grant administrative roles.',403);
    const requested=[...(ROLE_PERMISSIONS[nextRole]||[]),...(update.grantedPermissions||user.grantedPermissions||[])].filter(permission=>!(update.deniedPermissions||user.deniedPermissions||[]).includes(permission));
    if(requested.some(permission=>!can(req.user,permission))) fail('You cannot grant permissions beyond your own access.',403);
    if((update.allScopes||[]).some(module=>!hasAllScope(req.user,module))) fail('You cannot grant a broader record scope than your own.',403);
  }
  Object.assign(user, update); await user.save();
  res.json({ user: user.toPublicJSON() });
});
router.get('/summary', async (req,res) => {
  const result = {};
  for (const [path, config] of Object.entries(managementModules)) if (can(req.user, `${config.permission}:view`)) result[path] = await config.Model.countDocuments({ $and: [{ archived: false }, await recordScope(req.user,config.permission)] });
  if (can(req.user,'projects:view')) result.overdueProjects = await ManagedProject.countDocuments({ $and: [{ archived:false, deliveryLastDate: { $ne:'', $lt:todayInDhaka() }, status: { $not: /^(completed|cancelled|delivered)$/i } }, await recordScope(req.user,'projects')] });
  res.json(result);
});
for (const [path, config] of Object.entries(managementModules)) {
  const { Model, permission } = config;
  router.post(`/${path}/import-preview`, requirePermission(`${permission}:edit`), (req,res,next) => upload.single('workbook')(req,res,err => err ? res.status(400).json({message:err.message}) : next()), async (req,res) => {
    if (!req.file || !/\.(xlsx|csv)$/i.test(req.file.originalname)) fail('Upload an XLSX or CSV workbook.');
    const useGeneric = req.file.originalname.toLowerCase().endsWith('.csv') || !config.importer || req.query.mapping || req.query.mode === 'columns';
    const result = useGeneric ? await importGeneric(req.file.buffer,req.file.originalname,config.fields,req.query) : await config.importer(req.file.buffer,req.query);
    if (req.query.mode === 'columns') return res.json(result);
    const valid = [], errors = [];
    result.records.forEach((record,index) => { try { valid.push(parseRecord({...record,sourceReference:{fileName:req.file.originalname,sheetName:record.__source?.sheetName||'',rowNumber:record.__source?.rowNumber||index+2}},config,false,req.user)); } catch(err) { errors.push({ row:index+1, message:err.message }); } });
    res.json({ ...result, records:valid, errors });
  });
  router.post(`/${path}/bulk-import`, requirePermission(`${permission}:edit`), async (req,res) => {
    if (!Array.isArray(req.body.records) || !req.body.records.length || req.body.records.length > 1000) fail('Import 1–1,000 rows at a time.');
    const records = req.body.records.map(body => parseRecord(body,config,false,req.user));
    const batchId=randomUUID();
    const importKeys = records.map(({sourceReference,...data})=>createHash('sha256').update(JSON.stringify(data)).digest('hex'));
    for (const data of records) { await validateReferences(data,config,req); await prepareBusinessRecord(data,config,req); }
    let imported = 0, duplicates = 0; const errors = [];
    for (const [index,data] of records.entries()) {
      const importKey = importKeys[index];
      try {
        const record = await Model.create({ ...data, sourceReference:{...(data.sourceReference||{}),batchId}, importKey, createdBy:req.user.id, updatedBy:req.user.id, history:[{at:new Date(),actor:req.user.id,action:'imported',fields:Object.keys(data)}] });
        if (Model === Employee) await syncEmployee(record);
        imported++;
      } catch(err) { if (err.code === 11000) duplicates++; else errors.push({row:index+1,message:'Unable to save this row.'}); }
    }
    res.json({imported,duplicates,errors,batchId});
  });
  router.post(`/${path}/imports/:batchId/rollback`,requirePermission(`${permission}:edit`),async(req,res)=>{
    if(!/^[a-f0-9-]{36}$/i.test(req.params.batchId)) fail('Invalid import batch.');
    const scope=await recordScope(req.user,permission);
    const query={$and:[{'sourceReference.batchId':req.params.batchId,archived:false},scope]};
    const total=await Model.countDocuments(query);
    const result=await Model.updateMany({$and:[...query.$and,{__v:0}]},{$set:{archived:true,updatedBy:req.user.id},$inc:{__v:1},$push:{history:{at:new Date(),actor:req.user.id,action:'import rolled back',fields:['archived']}}});
    res.json({archived:result.modifiedCount,skipped:total-result.modifiedCount});
  });
  router.get(`/${path}`, requirePermission(`${permission}:view`), async (req,res) => {
    const page = Number(req.query.page || 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000) fail('Invalid page.');
    const query = { archived:req.query.archived === 'true' };
    if (req.query.status && config.status) {
      if (typeof req.query.status !== 'string' || req.query.status.length > 100) fail('Invalid status.');
      query[config.status] = req.query.status;
    }
    for (const key of config.filters || []) if (req.query[key]) {
      if (typeof req.query[key] !== 'string' || req.query[key].length > 200) fail('Invalid filter.');
      if (key.endsWith('Id') && !mongoose.isObjectIdOrHexString(req.query[key])) fail('Invalid reference filter.');
      query[key] = req.query[key];
    }
    if (req.query.month && path === 'sales-activity') { if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.month)) fail('Invalid month.'); query.date = { $gte:`${req.query.month}-01`, $lte:`${req.query.month}-31` }; }
    if (req.query.search) {
      if (typeof req.query.search !== 'string' || req.query.search.length > 100) fail('Search must be at most 100 characters.');
      const regex = {$regex:req.query.search.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),$options:'i'};
      query.$or = [config.title,...['clientName','account','keyword','email','category','assigneeName'].filter(k => config.fields[k])].map(field => ({[field]:regex}));
    }
    const scoped = {$and:[query,await recordScope(req.user,permission)]};
    const [records,total] = await Promise.all([Model.find(scoped).sort({createdAt:-1,_id:-1}).skip((page-1)*25).limit(25),Model.countDocuments(scoped)]);
    res.json({records:records.map(r=>visibleRecord(calculatedBusiness(r,config),req.user,permission)),total,page,pageSize:25});
  });
  router.post(`/${path}`, (req,res,next)=>Model===TeamTask&&can(req.user,'tasks:view')?next():requirePermission(`${permission}:edit`)(req,res,next), async (req,res) => {
    let body=req.body;
    if(Model===TeamTask&&!can(req.user,'tasks:edit')){
      const allowed=['title','category','priority','status','startDate','endDate','outputUrl','employeeComment'];
      if(Object.keys(body).some(key=>!allowed.includes(key)))fail('Personal tasks cannot be assigned to another person or department.',403);
      body=Object.fromEntries(allowed.filter(key=>key in body).map(key=>[key,body[key]]));
    }
    const data = parseRecord(body,config,false,req.user); await validateReferences(data,config,req);
    if (!hasAllScope(req.user,permission) && Model === TeamTask && data.employeeId) {
      const own = await Employee.exists({_id:data.employeeId,accountUserId:req.user.id}); if (!own) fail('You can only assign your own tasks.',403);
    }
    await prepareBusinessRecord(data,config,req);
    const record = await Model.create({...data,createdBy:req.user.id,updatedBy:req.user.id,history:[{at:new Date(),actor:req.user.id,action:'created',fields:Object.keys(data)}]});
    if (Model === Employee) await syncEmployee(record);
    await afterBusinessSave(record,config,req);
    try { await recordNotification(record,path); } catch(err) { console.error('Notification record failed:',err.name); }
    res.status(201).json({record:visibleRecord(calculatedBusiness(record,config),req.user,permission)});
  });
  router.get(`/${path}/:id`, requirePermission(`${permission}:view`), async (req,res) => {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) fail('Invalid record ID.');
    const record = await Model.findOne({$and:[{_id:req.params.id},await recordScope(req.user,permission)]});
    if (!record) fail('Record not found.',404);
    const serialized=visibleRecord(calculatedBusiness(record,config),req.user,permission);
    if(Model===ManagedProject){const rows=await businessModules['time-entries'].Model.aggregate([{$match:{projectId:record._id,archived:false}},{$group:{_id:null,hours:{$sum:'$hours'}}}]);serialized.actualHours=rows[0]?.hours||0;}
    res.json({record:serialized});
  });
  router.patch(`/${path}/:id`, async (req,res,next) => {
    if (Model === TeamTask && can(req.user,'tasks:view')) return next();
    return requirePermission(`${permission}:edit`)(req,res,next);
  }, async (req,res) => {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) fail('Invalid record ID.');
    const scope = await recordScope(req.user,permission);
    const previous = await Model.findOne({$and:[{_id:req.params.id},scope]});
    if (!previous) fail('Record not found.',404);
    let body = req.body;
    if (Model === TeamTask && !can(req.user,'tasks:edit')) {
      const allowed=String(previous.createdBy)===req.user.id?['title','category','priority','status','startDate','endDate','employeeComment','outputUrl','archived','version']:['status','employeeComment','outputUrl','version'];
      if (Object.keys(body).some(k=>!allowed.includes(k))) fail('You may only update your task status, output and comment.',403);
    }
    const data = parseRecord(body,config,true,req.user); await validateReferences(data,config,req);
    if (!Number.isSafeInteger(body.version) || body.version < 0) fail('A record version is required.');
    if (body.version !== previous.__v) fail('This record changed. Reload before saving.',409);
    await prepareBusinessRecord(data,config,req,previous);
    if (!Number.isSafeInteger(body.version) || body.version < 0) fail('A record version is required. Reload and try again.');
    if (Model === TeamTask && data.status === 'done' && !data.completedDate) data.completedDate=todayInDhaka();
    if (Model === TeamTask && data.status && data.status !== 'done') data.completedDate='';
    const record = await Model.findOneAndUpdate({$and:[{_id:req.params.id,__v:body.version},scope]},{$set:{...data,updatedBy:req.user.id},$inc:{__v:1},$push:{history:{$each:[{at:new Date(),actor:req.user.id,action:data.archived===true?'archived':data.archived===false?'restored':'updated',fields:Object.keys(data)}],$slice:-100}}},{new:true,runValidators:true});
    if (!record) fail('This record changed. Reload before saving your changes.',409);
    if (Model === Employee) await syncEmployee(record,previous);
    if (config.displayTitle === 'Sales Pipeline' && data.status && data.status !== previous.status) { await Model.updateOne({ _id: record._id }, { $push: { stageHistory: { stage: data.status, at: new Date(), actor: req.user._id } } }); }
    await afterBusinessSave(record,config,req,previous);
    try { await recordNotification(record,path,previous); } catch(err) { console.error('Notification record failed:',err.name); }
    res.json({record:visibleRecord(calculatedBusiness(record,config),req.user,permission)});
  });
}
export default router;
