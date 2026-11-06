import { Router } from 'express';
import { ManagedProject, SalesActivity, DistributionHistory, ProductLead } from '../models/Management.js';
import { projectCalculated, allocateAmount, todayInDhaka } from '../lib/management.js';
import { fail } from '../lib/validation.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission, can } from '../lib/permissions.js';
import { recordScope } from '../lib/managementScope.js';
const router=Router();router.use(requireAuth,requirePermission('reports:view'));
function monthFilter(req){const month=req.query.month||todayInDhaka().slice(0,7);if(typeof month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))fail('Month must be YYYY-MM.');const platform=req.query.platform;if(platform&&!['Fiverr','Upwork','Direct','Other'].includes(platform))fail('Invalid platform.');return{month,platform,match:platform?{platform}:{}};}
router.get('/marketplace',async(req,res)=>{
  if(!can(req.user,'sales-activity:view'))fail('Marketplace report access is required.',403);
  const{month,match}=monthFilter(req);
  const records=await SalesActivity.find({$and:[{...match,archived:false,date:{$gte:`${month}-01`,$lte:`${month}-31`}},await recordScope(req.user,'sales-activity')]}).lean();
  const totals={query:0,quote:0,order:0,pass:0},profiles=new Map(),daily=new Map(),shifts={};
  for(const record of records){const key=`${record.platform}|${record.profile}`;const p=profiles.get(key)||{profile:record.profile,platform:record.platform,query:0,quote:0,order:0,pass:0};const d=daily.get(record.date)||{date:record.date,query:0,quote:0,order:0,pass:0};
    for(const shift of['morning','evening','night']){shifts[shift]||={query:0,quote:0,order:0,pass:0};for(const metric of['Query','Quote','Order','Pass']){const n=record[shift+metric]||0,k=metric.toLowerCase();totals[k]+=n;p[k]+=n;d[k]+=n;shifts[shift][k]+=n;}}
    profiles.set(key,p);daily.set(record.date,d);
  }
  res.json({month,totals,profiles:[...profiles.values()].sort((a,b)=>a.profile.localeCompare(b.profile)),daily:[...daily.values()].sort((a,b)=>a.date.localeCompare(b.date)),shifts});
});
router.get('/distribution',requirePermission('finance:view'),async(req,res)=>{
  const{month,match}=monthFilter(req);const source=req.query.source==='history'?'history':'projects';const sales=new Map(),operations=new Map();
  function add(map,person,amount,orders){const row=map.get(person)||{person,amountCents:0,orders:0};row.amountCents+=Math.round(amount*100);row.orders+=orders;map.set(person,row);}
  let projects=0,totalCents=0;
  if(source==='history'){
    const rows=await DistributionHistory.find({$and:[{...match,month,archived:false},await recordScope(req.user,'distribution-history')]}).lean();
    for(const row of rows)add(row.division==='operations'?operations:sales,row.person,row.amount,row.orders);
  }else{
    const records=await ManagedProject.find({$and:[{...match,archived:false,orderDate:{$gte:`${month}-01`,$lte:`${month}-31`},status:{$nin:['cancelled','Cancelled']}},await recordScope(req.user,'projects')]}).lean();
    for(const record of records){const amount=projectCalculated(record).totalAfterFiverr;projects++;totalCents+=Math.round(amount*100);
      for(const row of allocateAmount(amount,record.salesAllocations,record.orderedBy))add(sales,row.person,row.amount,1);
      for(const row of allocateAmount(amount,record.operationsAllocations,record.developer||record.assign))add(operations,row.person,row.amount,1);
    }
  }
  const rows=map=>[...map.values()].map(({amountCents,...r})=>({...r,amount:amountCents/100})).sort((a,b)=>b.amount-a.amount);
  const undatedProjects=await ManagedProject.countDocuments({$and:[{archived:false,orderDate:''},await recordScope(req.user,'projects')]});
  res.json({month,source,projects,totalNet:totalCents/100,sales:rows(sales),operations:rows(operations),undatedProjects,definition:'USD net after each project’s fee. Sales and operations are separate attribution views, not added together as payouts. Split projects count once per assigned person.'});
});
export default router;
