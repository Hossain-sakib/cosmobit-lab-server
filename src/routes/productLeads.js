import { Router } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { Product, ProductLead, Employee } from '../models/Management.js';
import { leadFields } from '../lib/managementFields.js';
import { parseFields } from '../lib/management.js';
import { fail } from '../lib/validation.js';
import { importGeneric } from '../lib/genericImport.js';
import { importProductLeads } from '../lib/workbookImport.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../lib/permissions.js';
import { recordScope } from '../lib/managementScope.js';
const router = Router({ mergeParams:true });
router.use(requireAuth,requirePermission('leads:view'));
router.use(async (req,res,next)=>{
  if (!mongoose.isObjectIdOrHexString(req.params.productId)) fail('Invalid product ID.');
  if (!await Product.exists({_id:req.params.productId,archived:false})) fail('Product not found.',404);
  next();
});
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1,fields:0,parts:1}});
function dedupe(data) { return data.email ? `email:${data.email}` : data.contactNumber?.replace(/\D/g,'') ? `phone:${data.contactNumber.replace(/\D/g,'')}` : `unique:${randomUUID()}`; }
async function scope(req) { return {$and:[{productId:req.params.productId},await recordScope(req.user,'leads')]}; }
async function parse(body,partial=false) {
  const data=parseFields(body,leadFields,partial);
  if (data.ownerUserId && !await Employee.exists({accountUserId:data.ownerUserId,status:'active',archived:false})) fail('Choose a linked active employee account.');
  return data;
}
router.get('/',async(req,res)=>{
  const page=Number(req.query.page||1);if(!Number.isSafeInteger(page)||page<1||page>10000)fail('Invalid page.');
  const query=await scope(req);query.$and.push({archived:req.query.archived==='true'});
  if(req.query.status){if(typeof req.query.status!=='string'||req.query.status.length>100)fail('Invalid status.');query.$and.push({status:req.query.status});}
  if(req.query.search){if(typeof req.query.search!=='string'||req.query.search.length>100)fail('Invalid search.');const r={$regex:req.query.search.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),$options:'i'};query.$and.push({$or:[{clientName:r},{companyName:r},{email:r},{owner:r}]});}
  const [records,total]=await Promise.all([ProductLead.find(query).sort({createdAt:-1,_id:-1}).skip((page-1)*25).limit(25),ProductLead.countDocuments(query)]);
  res.json({records,total,page,pageSize:25});
});
router.post('/import-preview',requirePermission('leads:edit'),(req,res,next)=>upload.single('workbook')(req,res,err=>err?res.status(400).json({message:err.message}):next()),async(req,res)=>{
  if(!req.file||!/\.(xlsx|csv)$/i.test(req.file.originalname))fail('Upload XLSX or CSV.');
  const generic=req.query.mode==='columns'||req.query.mapping||req.file.originalname.toLowerCase().endsWith('.csv');
  const result=generic?await importGeneric(req.file.buffer,req.file.originalname,leadFields,req.query):await importProductLeads(req.file.buffer);
  if(req.query.mode==='columns')return res.json(result);
  const records=[],errors=[];
  for(const [index,raw]of result.records.entries())try{records.push(await parse(raw));}catch(err){errors.push({row:index+1,message:err.message});}
  res.json({...result,records,errors});
});
router.post('/bulk-import',requirePermission('leads:edit'),async(req,res)=>{
  if(!Array.isArray(req.body.records)||!req.body.records.length||req.body.records.length>1000)fail('Import 1–1,000 leads.');
  const records=await Promise.all(req.body.records.map(raw=>parse(raw)));
  let imported=0,duplicates=0;const errors=[];
  for(const [index,data]of records.entries())try{await ProductLead.create({...data,productId:req.params.productId,dedupeKey:dedupe(data),createdBy:req.user.id,updatedBy:req.user.id,history:[{at:new Date(),actor:req.user.id,action:'imported',fields:Object.keys(data)}]});imported++;}catch(err){if(err.code===11000)duplicates++;else errors.push({row:index+1,message:'Unable to save row.'});}
  res.json({imported,duplicates,errors});
});
router.post('/',requirePermission('leads:edit'),async(req,res)=>{
  const data=await parse(req.body);
  const record=await ProductLead.create({...data,productId:req.params.productId,dedupeKey:dedupe(data),createdBy:req.user.id,updatedBy:req.user.id,history:[{at:new Date(),actor:req.user.id,action:'created',fields:Object.keys(data)}]});
  res.status(201).json({record});
});
router.get('/:id',async(req,res)=>{
  if(!mongoose.isObjectIdOrHexString(req.params.id))fail('Invalid lead ID.');
  const query=await scope(req);query.$and.push({_id:req.params.id});
  const record=await ProductLead.findOne(query);if(!record)fail('Lead not found.',404);res.json({record});
});
router.patch('/:id',requirePermission('leads:edit'),async(req,res)=>{
  if(!mongoose.isObjectIdOrHexString(req.params.id))fail('Invalid lead ID.');
  const query=await scope(req);query.$and.push({_id:req.params.id});
  const previous=await ProductLead.findOne(query);if(!previous)fail('Lead not found.',404);
  const data=await parse(req.body,true);
  if('archived'in req.body){if(typeof req.body.archived!=='boolean')fail('Invalid archive value.');data.archived=req.body.archived;}
  if(!Object.keys(data).length)fail('No supported fields supplied.');
  if(!Number.isSafeInteger(req.body.version)||req.body.version<0)fail('Record version is required.');
  query.$and.push({__v:req.body.version});
  const record=await ProductLead.findOneAndUpdate(query,{$set:{...data,dedupeKey:dedupe({...previous.toObject(),...data}),updatedBy:req.user.id},$inc:{__v:1},$push:{history:{$each:[{at:new Date(),actor:req.user.id,action:'updated',fields:Object.keys(data)}],$slice:-100}}},{new:true,runValidators:true});
  if(!record)fail('This lead changed. Reload before saving.',409);res.json({record});
});
export default router;
