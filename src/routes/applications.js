import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { CareerApplication } from '../models/Management.js';
import Job from '../models/Job.js';
import { applicationFields } from '../lib/managementFields.js';
import { parseFields, todayInDhaka } from '../lib/management.js';
import { fail } from '../lib/validation.js';
import { requireAuth } from '../middleware/auth.js';
import { recordScope } from '../lib/managementScope.js';
import { requirePermission } from '../lib/permissions.js';
const router=Router();
const directory=path.join(path.dirname(fileURLToPath(import.meta.url)),'../../uploads/.private-applications');
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1,fields:15,fieldSize:20000,parts:16}});
const publicKeys=['fullName','email','phone','dateOfBirth','gender','position','experience','expectedSalary','cvLink','portfolioLink'];
const publicFields=Object.fromEntries(publicKeys.map(key=>[key,applicationFields[key]]));
router.post('/',rateLimit({windowMs:3600000,limit:5,standardHeaders:'draft-8',legacyHeaders:false,message:{message:'Too many applications. Please try again later.'}}),(req,res,next)=>{
  const key=req.headers['idempotency-key'];
  if(typeof key!=='string'||!/^[a-f0-9-]{36}$/i.test(key))return res.status(400).json({message:'A valid application submission ID is required.'});
  upload.single('resume')(req,res,err=>err?res.status(400).json({message:err.message}):next());
},async(req,res)=>{
  const existing=await CareerApplication.exists({submissionKey:req.headers['idempotency-key']});
  if(existing)return res.json({message:'Application received.'});
  if(req.body?.consent!=='true')fail('Consent to processing this application is required.');
  const data=parseFields(req.body,publicFields);
  if(!data.phone)fail('Phone number is required.');
  if(data.dateOfBirth&&data.dateOfBirth>todayInDhaka())fail('Date of birth cannot be in the future.');
  let jobId;
  if(req.body.jobId){if(!mongoose.isObjectIdOrHexString(req.body.jobId))fail('Invalid job.');const job=await Job.findOne({_id:req.body.jobId,active:true,archived:{$ne:true}});if(!job)fail('This opening is no longer accepting applications.',404);jobId=job._id;data.position=job.title;}
  if(!req.file&&!data.cvLink)fail('Upload a PDF CV or provide a CV link.');
  let resumeFilename;
  if(req.file){
    const buffer=req.file.buffer;
    if(req.file.mimetype!=='application/pdf'||!buffer.subarray(0,5).equals(Buffer.from('%PDF-'))||!buffer.subarray(Math.max(0,buffer.length-1024)).toString().includes('%%EOF'))fail('Upload a valid PDF file up to 5 MB.');
    await fs.mkdir(directory,{recursive:true});resumeFilename=`${randomUUID()}.pdf`;
    await fs.writeFile(path.join(directory,resumeFilename),buffer,{flag:'wx',mode:0o600});
  }
  try{
    await CareerApplication.create({...data,jobId,resumeFilename,resumeAvailable:!!resumeFilename,submissionKey:req.headers['idempotency-key'],submittedDate:todayInDhaka(),status:'new',history:[{at:new Date(),action:'application submitted',fields:publicKeys}]});
    res.status(201).json({message:'Application received.'});
  }catch(err){if(resumeFilename)await fs.unlink(path.join(directory,resumeFilename)).catch(()=>{});if(err.code===11000)return res.json({message:'Application received.'});throw err;}
});
router.get('/:id/resume',requireAuth,requirePermission('applications:view'),async(req,res)=>{
  if(!mongoose.isObjectIdOrHexString(req.params.id))fail('Invalid application ID.');
  const application=await CareerApplication.findOne({ $and: [{ _id: req.params.id }, await recordScope(req.user,'applications')] }).select('+resumeFilename');
  if(!application?.resumeFilename||!/^[-a-f0-9]{36}\.pdf$/.test(application.resumeFilename))fail('Resume not found.',404);
  res.set('Cache-Control','no-store');
  res.download(path.join(directory,application.resumeFilename),'resume.pdf',{dotfiles:'allow'},err=>{if(err&&!res.headersSent)res.status(404).json({message:'Resume not found.'});});
});
export default router;
