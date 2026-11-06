import { Router } from 'express';
import { rateLimit } from '../lib/rateLimit.js';
import { randomUUID } from 'node:crypto';
import { businessModels } from '../lib/businessModules.js';
import Message from '../models/Message.js';
import { text,email,fail } from '../lib/validation.js';
import { todayInDhaka } from '../lib/management.js';
import { captureInquiry } from '../services/websiteInquiry.js';
const router=Router();
const content={services:{model:'cms-services',fields:['title','slug','summary','content','icon','seoTitle','seoDescription','sortOrder']},pages:{model:'cms-pages',fields:['title','slug','content','seoTitle','seoDescription']},portfolio:{model:'portfolio-items',fields:['title','slug','clientName','serviceCategory','summary','problem','solution','outcome','websiteUrl','imageUrl','seoDescription']},testimonials:{model:'testimonials',fields:['name','company','text','sourceUrl']},team:{model:'team-profiles',fields:['name','designation','bio','photoUrl','linkedin','sortOrder']}};
router.get('/content/company',async(req,res)=>{const record=await businessModels.settings.findOne({archived:false}).select('companyName description contactEmail phone address websiteUrl githubUrl linkedinUrl twitterUrl heroTitle heroDescription aboutDescription footerDescription').lean();res.json({company:record?{...record,_id:undefined}:null});});
router.get('/content/:type',async(req,res)=>{const config=content[req.params.type];if(!config)fail('Content not found.',404);const records=await businessModels[config.model].find({archived:false,status:'published',$or:[{publishAt:''},{publishAt:{$exists:false}},{publishAt:{$lte:todayInDhaka()}}]}).sort({sortOrder:1,createdAt:-1}).select(config.fields.join(' ')).limit(200).lean();res.json({records,configured:!!await businessModels[config.model].exists({})});});
router.get('/content/:type/:slug',async(req,res)=>{const config=content[req.params.type];if(!config||!['services','pages','portfolio'].includes(req.params.type))fail('Content not found.',404);const record=await businessModels[config.model].findOne({slug:req.params.slug,archived:false,status:'published',$or:[{publishAt:''},{publishAt:{$exists:false}},{publishAt:{$lte:todayInDhaka()}}]}).select(config.fields.join(' ')).lean();if(!record)fail('Content not found.',404);res.json({record});});
router.post('/inquiries',rateLimit({windowMs:3600000,limit:5,standardHeaders:'draft-8',legacyHeaders:false,message:{message:'Too many inquiries. Please try again later.'}}, 'inquiries'),async(req,res)=>{
  if(!['quote','consultation'].includes(req.body?.type))fail('Choose quote or consultation.');
  const name=text(req.body.name,'Name',{max:100}),address=email(req.body.email),description=text(req.body.message,'Project description',{max:10000});
  const service=text(req.body.service||'','Service',{min:0,max:200}),company=text(req.body.company||'','Company',{min:0,max:200}),preferredDate=text(req.body.preferredDate||'','Preferred date',{min:0,max:100}),budget=text(req.body.budget||'','Budget',{min:0,max:200});
  const key=req.headers['idempotency-key']||randomUUID();if(typeof key!=='string'||!/^[a-f0-9-]{36}$/i.test(key))fail('Invalid inquiry submission ID.');
  let message=await Message.findOne({submissionKey:key});if(!message)try{message=await Message.create({name,email:address,message:[description,service&&`Service: ${service}`,company&&`Company: ${company}`,preferredDate&&`Preferred consultation date/time: ${preferredDate}`].filter(Boolean).join('\n'),budget,source:req.body.type,submissionKey:key});}catch(err){if(err.code!==11000)throw err;message=await Message.findOne({submissionKey:key});}
  await captureInquiry(message,req.body.type==='quote'?'quote-request':'consultation-request');res.status(201).json({message:req.body.type==='quote'?'Quote request received.':'Consultation request received. We will confirm availability; no appointment is booked automatically.'});
});
export default router;
