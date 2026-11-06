import { Router } from 'express';
import { randomBytes, createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { DocumentShare } from '../models/Automation.js';
import { businessModels } from '../lib/businessModules.js';
import { invoiceTotals } from '../lib/finance.js';
import { recordScope } from '../lib/managementScope.js';
import { requireAuth } from '../middleware/auth.js';
import { can } from '../lib/permissions.js';
import { fail, text } from '../lib/validation.js';
import { documentPdf } from '../services/documentPdf.js';
import { queueEmail, smtpReady, notify } from '../services/automation.js';
export const documentActions=Router();
function documentType(value){if(!['invoices','proposals'].includes(value))fail('Unsupported document type.');return value;}
async function authorized(req){const type=documentType(req.params.type);if(!can(req.user,`${type}:edit`)||!can(req.user,`${type}:view`))fail('Document permission required.',403);if(!mongoose.isObjectIdOrHexString(req.params.id))fail('Invalid document ID.');const record=await businessModels[type].findOne({$and:[{_id:req.params.id,archived:false},await recordScope(req.user,type)]});if(!record)fail('Document not found.',404);return{type,record};}
const publicKeys=['number','title','currency','status','scope','deliverables','technologyStack','timeline','paymentTerms','revisionTerms','exclusions','validUntil','issueDate','dueDate','maintenancePlan','items'];
function publicDocument(record,client){const raw=record.toObject();return{...Object.fromEntries(publicKeys.map(key=>[key,raw[key]])),...invoiceTotals(record),client:client?{name:client.name,companyName:client.companyName}:null};}
documentActions.post('/:type/:id/share',requireAuth,async(req,res)=>{
  const{type,record}=await authorized(req);
  if(type==='proposals'&&!['approved','sent','accepted','rejected'].includes(record.status))fail('Approve the proposal before creating a client review link.');
  if(type==='invoices'&&record.status==='draft')fail('Send the invoice before sharing it.');
  const token=randomBytes(32).toString('hex'),hash=createHash('sha256').update(token).digest('hex');
  const client=record.clientId?await businessModels.clients.findById(record.clientId):null;
  await DocumentShare.create({tokenHash:hash,documentType:type,documentId:record._id,documentVersion:record.__v,snapshot:publicDocument(record,client),expiresAt:new Date(Date.now()+7*86400000),createdBy:req.user._id});
  res.status(201).json({path:`/documents/${token}`,expiresInDays:7});
});
documentActions.get('/:type/:id/pdf',requireAuth,async(req,res)=>{
  const type=documentType(req.params.type);if(!can(req.user,`${type}:view`))fail('Document permission required.',403);if(!mongoose.isObjectIdOrHexString(req.params.id))fail('Invalid document ID.');const record=await businessModels[type].findOne({$and:[{_id:req.params.id,archived:false},await recordScope(req.user,type)]});if(!record)fail('Document not found.',404);
  const client=record.clientId?await businessModels.clients.findById(record.clientId):null;const bytes=await documentPdf(record,type,client);res.type('pdf').attachment(`${record.number||type}.pdf`).send(bytes);
});
documentActions.post('/:type/:id/email',requireAuth,async(req,res)=>{
  const{type,record}=await authorized(req);if(!can(req.user,'documents:send'))fail('Document delivery permission required.',403);if(type==='invoices'&&record.status==='draft')fail('Mark the invoice sent before emailing.');if(type==='proposals'&&!['approved','sent','accepted'].includes(record.status))fail('Approve the proposal before emailing.');
  const client=record.clientId?await businessModels.clients.findById(record.clientId):null;if(!client?.email)fail('The linked client needs an email address.');
  const key=req.headers['idempotency-key'];if(typeof key!=='string'||!/^[a-f0-9-]{36}$/i.test(key))fail('A unique email request ID is required.');
  const job=await queueEmail({eventKey:`document:${type}:${record._id}:${key}`,to:client.email,subject:`Cosmobit Labs — ${record.number||record.title}`,text:`Hello ${client.name},\n\nPlease find your ${type==='invoices'?'invoice':'proposal'} attached.\n\nCosmobit Labs`,documentType:type,documentId:record._id,documentVersion:record.__v,createdBy:req.user._id});
  res.status(202).json({status:job.status,message:smtpReady()?'Document email queued for delivery.':'Email saved in the queue; SMTP delivery is not configured yet.'});
});
export const publicDocuments=Router();
async function loadShare(token){if(!/^[a-f0-9]{64}$/.test(token))fail('Document link not found.',404);const share=await DocumentShare.findOne({tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:{$gt:new Date()},revokedAt:null});if(!share)fail('This document link has expired or is unavailable.',404);const record=await businessModels[share.documentType].findOne({_id:share.documentId,archived:false});if(!record)fail('Document unavailable.',404);return{share,record};}
publicDocuments.get('/:token',async(req,res)=>{const{share,record}=await loadShare(req.params.token);res.set('Cache-Control','no-store');const data={...share.snapshot};if(share.documentType==='invoices')Object.assign(data,invoiceTotals(record),{status:record.status});res.json({type:share.documentType,document:data,canRespond:share.documentType==='proposals'&&share.documentVersion===record.__v&&['approved','sent'].includes(record.status)});});
publicDocuments.post('/:token/respond',async(req,res)=>{
  const{share,record}=await loadShare(req.params.token);if(share.documentType!=='proposals')fail('Only proposals accept responses.');
  const decision=req.body?.decision;if(!['accepted','rejected'].includes(decision))fail('Choose accepted or rejected.');const name=text(req.body?.name,'Name',{max:200});
  if(record.status===decision)return res.json({message:`Proposal ${decision}.`});
  if(share.documentVersion!==record.__v||!['approved','sent'].includes(record.status))fail('This proposal was revised or already answered. Request an updated link.',409);
  const updated=await businessModels.proposals.findOneAndUpdate({_id:record._id,__v:record.__v,status:{$in:['approved','sent']}},{$set:{status:decision,clientDecisionName:name,clientDecisionAt:new Date()},$inc:{__v:1},$push:{history:{at:new Date(),action:`client ${decision}`,fields:['status']}}},{new:true});
  if(!updated)fail('The proposal changed. Request an updated link.',409);
  if(updated.dealId){await businessModels.deals.updateOne({_id:updated.dealId,status:{$nin:['won','lost']}},{$set:{status:decision==='accepted'?'negotiation':'on-hold'},$inc:{__v:1},$push:{stageHistory:{stage:decision==='accepted'?'negotiation':'on-hold',at:new Date()}}});}
  await notify([updated.ownerUserId||updated.createdBy],{key:`proposal-response:${updated._id}:${updated.__v}`,title:`Proposal ${decision}`,message:`${name} ${decision} ${updated.number}.`,link:`/studio/proposals/${updated._id}`});
  res.json({message:`Proposal ${decision}.`});
});
