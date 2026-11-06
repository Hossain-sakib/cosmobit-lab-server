import nodemailer from 'nodemailer';
import { Notification, EmailJob } from '../models/Automation.js';
import User from '../models/User.js';
import { ManagedProject, TeamTask, Employee, ProductLead } from '../models/Management.js';
import { can } from '../lib/permissions.js';
import { recordScope } from '../lib/managementScope.js';
import { businessModels, businessModules } from '../lib/businessModules.js';
import { todayInDhaka } from '../lib/management.js';
import { invoiceTotals } from '../lib/finance.js';
import { documentPdf } from './documentPdf.js';
import { nextNumber } from '../lib/businessWorkflows.js';
export const smtpReady=()=>process.env.NOTIFICATION_EMAILS_ENABLED==='true'&&!!process.env.SMTP_HOST&&!!process.env.SMTP_FROM;
export async function queueEmail(data){return EmailJob.findOneAndUpdate({eventKey:data.eventKey},{$setOnInsert:{...data,status:smtpReady()?'queued':'waiting-configuration'}},{upsert:true,new:true,runValidators:true});}
async function notificationAccess(user,event){
  const parts=(event.link||'').split('/').filter(Boolean);
  let module=parts[1],id=parts[2],Model,permission;
  if(module==='products'&&parts[3]==='leads'){module='product-leads';id=parts[4];Model=ProductLead;permission='leads';}
  else if(module==='projects'){Model=ManagedProject;permission='projects';}
  else if(module==='team-tasks'){Model=TeamTask;permission='tasks';}
  else if(businessModules[module]){Model=businessModels[module];permission=businessModules[module].permission;}
  if(!Model||!id)return null;
  if(!can(user,`${permission}:view`))return null;
  if(!await Model.exists({$and:[{_id:id,archived:false},await recordScope(user,permission)]}))return null;
  return {authorizationUserId:user._id,authorizationModule:module,authorizationRecordId:id};
}
export async function notify(userIds,event){
  const ids=[...new Set(userIds.filter(Boolean).map(String))];
  for(const userId of ids){
    const user=await User.findById(userId);
    if(!user)continue;
    const access=await notificationAccess(user,event);
    if(!access)continue;
    const notification=await Notification.findOneAndUpdate({userId,eventKey:event.key},{$setOnInsert:{title:event.title,message:event.message,link:event.link}},{upsert:true,new:true,runValidators:true});
    if(user?.notificationEmails)await queueEmail({...access,eventKey:`notification:${notification._id}`,to:user.email,subject:event.title,text:event.message});
  }
}
export async function recordNotification(record,module,previous){
  const recipients=[record.ownerUserId,...(record.memberUserIds||[])];
  if(record.employeeId){const employee=await Employee.findById(record.employeeId);if(employee?.accountUserId)recipients.push(employee.accountUserId);}
  if (module === 'team-tasks' && record.departmentId && !record.employeeId) { const members = await Employee.find({departmentId:record.departmentId,archived:false,status:'active'}).select('accountUserId'); recipients.push(...members.map(member=>member.accountUserId)); }
  if(!previous)recipients.push(record.createdBy);
  const title=record.projectName||record.title||record.subject||record.fullName||record.name||record.profileName||'Record';
  await notify(recipients,{key:`${module}:${record._id}:${record.__v}:${previous?'updated':'created'}`,title:`${previous?'Updated':'New'} ${title}`,message:`${title} ${previous?'was updated':'was created'} in Cosmobit Studio.`,link:`/studio/${module}/${record._id}`});
}
export async function notifySales(event){const users=await User.find({role:{$in:['super_admin','admin','general_manager','sales_manager','business_development_manager']}}).select('_id');await notify(users.map(u=>u._id),event);}
async function dueNotifications(){
  const today=todayInDhaka();
  const projects=await ManagedProject.find({archived:false,deliveryLastDate:{$ne:'',$lte:today},status:{$not:/^(completed|cancelled|delivered)$/i}}).limit(500);
  for(const project of projects)await notify([project.createdBy,...project.memberUserIds],{key:`project-due:${project._id}:${today}`,title:'Project deadline',message:`${project.projectName} is due ${project.deliveryLastDate}.`,link:`/studio/projects/${project._id}`});
  const tasks=await TeamTask.find({archived:false,endDate:{$ne:'',$lte:today},status:{$ne:'done'}}).limit(500);
  for(const task of tasks){const employee=task.employeeId?await Employee.findById(task.employeeId):null;await notify([task.createdBy,employee?.accountUserId],{key:`task-due:${task._id}:${today}`,title:'Task due',message:`${task.title} is due ${task.endDate}.`,link:`/studio/team-tasks/${task._id}`});}
  for(const[Model,path]of[[businessModels['business-leads'],'business-leads'],[businessModels['outreach-activities'],'outreach-activities']])for(const lead of await Model.find({archived:false,nextFollowUp:{$ne:'',$lte:today},status:{$nin:['won','lost']}}).limit(500))await notify([lead.ownerUserId||lead.createdBy],{key:`follow-up:${path}:${lead._id}:${today}`,title:'Follow-up due',message:`Follow up with ${lead.fullName||lead.prospect}.`,link:`/studio/${path}/${lead._id}`});
  for(const lead of await ProductLead.find({archived:false,nextFollowUp:{$ne:'',$lte:today},status:{$nin:['won','lost']}}).limit(500))await notify([lead.ownerUserId||lead.createdBy],{key:`product-follow-up:${lead._id}:${today}`,title:'Product follow-up due',message:`Follow up with ${lead.clientName}.`,link:`/studio/products/${lead.productId}/leads/${lead._id}`});
  const invoices=await businessModels.invoices.find({archived:false,status:'sent',dueDate:{$ne:'',$lte:today}}).limit(500);
  for(const invoice of invoices)if(invoiceTotals(invoice).balance>0)await notify([invoice.ownerUserId||invoice.createdBy],{key:`invoice-due:${invoice._id}:${today}`,title:'Invoice due',message:`${invoice.number} has an outstanding balance.`,link:`/studio/invoices/${invoice._id}`});
  for(const contract of await businessModels.maintenance.find({archived:false,status:'active',renewalDate:{$ne:'',$lte:today}}).limit(500))await notify([contract.ownerUserId||contract.createdBy],{key:`renewal:${contract._id}:${today}`,title:'Maintenance renewal',message:`${contract.title} is due for renewal.`,link:`/studio/maintenance/${contract._id}`});
}
function addMonths(date,months){const d=new Date(date),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));return d.toISOString().slice(0,10);}
async function recurringInvoices(){
  const today=todayInDhaka();const rows=await businessModels.invoices.find({archived:false,recurringInterval:{$ne:'none'},nextIssueDate:{$ne:'',$lte:today},status:{$ne:'cancelled'}}).limit(100);
  for(const source of rows){const key=`recurring:${source._id}:${source.nextIssueDate}`;if(!await businessModels.invoices.exists({sourceActionKey:key}))try{
    await businessModels.invoices.create({number:await nextNumber('INV'),title:source.title,clientId:source.clientId,projectId:source.projectId,ownerUserId:source.ownerUserId,currency:source.currency,items:source.items.toObject(),discount:source.discount,paymentTerms:source.paymentTerms,issueDate:source.nextIssueDate,status:'draft',sourceActionKey:key,createdBy:source.createdBy,updatedBy:source.createdBy,history:[{at:new Date(),action:'recurring draft generated',fields:['items']}]});
  }catch(err){if(err.code!==11000)throw err;}
    const months={monthly:1,quarterly:3,yearly:12}[source.recurringInterval];if(months)await businessModels.invoices.updateOne({_id:source._id,nextIssueDate:source.nextIssueDate},{$set:{nextIssueDate:addMonths(source.nextIssueDate,months)},$inc:{__v:1}});
  }
}
export async function processEmailJob(transportOverride){
  if(!smtpReady()&&!transportOverride)return null;
  if(smtpReady())await EmailJob.updateMany({status:'waiting-configuration'},{$set:{status:'queued',nextAttemptAt:new Date()}});
  const now=new Date();const job=await EmailJob.findOneAndUpdate({$or:[{status:'queued',nextAttemptAt:{$lte:now}},{status:'processing',claimedAt:{$lt:new Date(Date.now()-5*60000)}}]},{$set:{status:'processing',claimedAt:now},$inc:{attempts:1}},{new:true,sort:{createdAt:1}});if(!job)return null;
  try{
    if(job.authorizationUserId){const user=await User.findById(job.authorizationUserId);const link=job.authorizationModule==='product-leads'?`/studio/products/none/leads/${job.authorizationRecordId}`:`/studio/${job.authorizationModule}/${job.authorizationRecordId}`;if(!user||!await notificationAccess(user,{link})) {job.status='failed';job.lastError='Recipient no longer has access to this record.';await job.save();return job;}}
    const transport=transportOverride||nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:process.env.SMTP_SECURE==='true',auth:process.env.SMTP_USER?{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}:undefined});
    const attachments=[];if(job.documentType&&job.documentId){const Model=businessModels[job.documentType];const record=Model&&await Model.findById(job.documentId);if(!record||record.archived)throw new Error('Document unavailable');if(job.documentVersion!==undefined&&record.__v!==job.documentVersion){job.status='failed';job.lastError='The document changed after this email was queued. Review it and queue a new email.';await job.save();return job;}const client=record.clientId?await businessModels.clients.findById(record.clientId):null;attachments.push({filename:`${record.number||job.documentType}.pdf`,content:await documentPdf(record,job.documentType,client)});}
    await transport.sendMail({from:process.env.SMTP_FROM||'test@example.com',to:job.to,subject:job.subject,text:job.text,attachments});
    job.status='sent';job.sentAt=new Date();job.lastError='';await job.save();
  }catch{job.status=job.attempts>=3?'failed':'queued';job.lastError='Email delivery failed. Check SMTP configuration and provider logs.';job.nextAttemptAt=new Date(Date.now()+Math.min(60,2**job.attempts)*60000);await job.save();}
  return job;
}
let running=false,timer;
export async function runAutomations(){if(running)return;running=true;try{await dueNotifications();await recurringInvoices();await processEmailJob();}catch(err){console.error('Automation cycle failed:',err.name);}finally{running=false;}}
export function startAutomations(){if(timer)return;timer=setInterval(runAutomations,60000);timer.unref();void runAutomations();}
export function stopAutomations(){if(timer)clearInterval(timer);timer=undefined;}
