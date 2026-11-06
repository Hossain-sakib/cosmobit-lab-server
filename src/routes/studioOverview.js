import { Router } from 'express';
import { businessModels } from '../lib/businessModules.js';
import { ManagedProject, TeamTask, ProductLead, SalesActivity } from '../models/Management.js';
import { requireAuth } from '../middleware/auth.js';
import { can, requirePermission } from '../lib/permissions.js';
import { recordScope } from '../lib/managementScope.js';
import { parseFields, todayInDhaka } from '../lib/management.js';
import { invoiceTotals } from '../lib/finance.js';
import { fail } from '../lib/validation.js';
const router=Router();router.use(requireAuth);
function range(req){const today=todayInDhaka();const{from,to}=parseFields({from:req.query.from||`${today.slice(0,7)}-01`,to:req.query.to||today},{from:{type:'date',required:true},to:{type:'date',required:true}});if(from>to||Date.parse(to)-Date.parse(from)>3660*86400000)fail('Choose a date range of at most ten years.');return{from,to,start:new Date(`${from}T00:00:00+06:00`),end:new Date(`${to}T23:59:59.999+06:00`)};}
async function scoped(Model,user,module,query={}){return Model.find({$and:[{archived:false,...query},await recordScope(user,module)]}).lean();}
function currencyBucket(map,currency){const key=currency||'USD';if(!map.has(key))map.set(key,{currency:key,cashInCents:0,cashOutCents:0,recognizedRevenueCents:0,expenseCents:0,invoicedCents:0,receivableCents:0});return map.get(key);}
const inRange=(value,from,to)=>!!value&&value>=from&&value<=to;
export async function financialReport(user,from,to){
  const totals=new Map();
  const invoices=can(user,'invoices:view')?await scoped(businessModels.invoices,user,'invoices',{status:{$ne:'cancelled'}}):[];
  for(const invoice of invoices){const row=currencyBucket(totals,invoice.currency),money=invoiceTotals(invoice);if(inRange(invoice.issueDate,from,to)&&invoice.status!=='draft')row.invoicedCents+=money.totalCents;
    for(const payment of invoice.payments||[])if(inRange(payment.date,from,to))row.cashInCents+=payment.amountCents;
    if(invoice.recognitionStatus==='recognized'&&inRange(invoice.recognizedDate,from,to))row.recognizedRevenueCents+=money.totalCents;
    if(invoice.issueDate&&invoice.issueDate<=to&&invoice.status!=='draft')row.receivableCents+=Math.round(invoiceTotals({...invoice,payments:(invoice.payments||[]).filter(p=>p.date<=to)}).balance*100);
  }
  for(const income of await scoped(businessModels.income,user,'finance')){const row=currencyBucket(totals,income.currency);if(inRange(income.date,from,to))row.cashInCents+=Math.round(income.amount*100);if(income.recognitionStatus==='recognized'&&inRange(income.recognizedDate,from,to))row.recognizedRevenueCents+=Math.round(income.amount*100);}
  if(can(user,'expenses:view'))for(const expense of await scoped(businessModels.expenses,user,'expenses')){const row=currencyBucket(totals,expense.currency);if(expense.status==='approved'&&inRange(expense.date,from,to))row.expenseCents+=Math.round(expense.amount*100);if(expense.paymentStatus==='paid'&&inRange(expense.paidDate,from,to))row.cashOutCents+=Math.round(expense.amount*100);}
  if(can(user,'payroll:view'))for(const payroll of await scoped(businessModels.payroll,user,'payroll')){const row=currencyBucket(totals,payroll.currency),cents=Math.round(((payroll.salary||0)+(payroll.bonus||0)-(payroll.deductions||0))*100);if(['approved','paid'].includes(payroll.status)&&inRange(`${payroll.month}-01`,from,to))row.expenseCents+=cents;if(payroll.status==='paid'&&inRange(payroll.paidDate,from,to))row.cashOutCents+=cents;}
  const byCurrency=[...totals.values()].map(row=>({currency:row.currency,cashIn:row.cashInCents/100,cashOut:row.cashOutCents/100,cashflow:(row.cashInCents-row.cashOutCents)/100,recognizedRevenue:row.recognizedRevenueCents/100,expenses:row.expenseCents/100,recordedProfit:(row.recognizedRevenueCents-row.expenseCents)/100,invoiced:row.invoicedCents/100,receivables:row.receivableCents/100}));
  return{byCurrency,definition:'Currencies are never added together. Cashflow uses receipt/payment dates. Revenue requires explicit recognition and a recognition date. Expenses use approved incurred dates; approved/paid net payroll is attributed to the first day of its payroll month. Invoice receivables are measured as of the range end. These totals reflect recorded entries, not an independently reconciled bank balance.'};
}
router.get('/overview',requirePermission('dashboard:view'),async(req,res)=>{
  const r=range(req),createdAt={$gte:r.start,$lte:r.end},result={range:{from:r.from,to:r.to},definition:'Entity counts use creation dates in Asia/Dhaka; statuses are current. Financial metrics use their stated business dates.'};
  if(can(req.user,'leads:view')){
    const[leads,productLeads,deals]=await Promise.all([scoped(businessModels['business-leads'],req.user,'leads',{createdAt}),scoped(ProductLead,req.user,'leads',{createdAt}),scoped(businessModels.deals,req.user,'leads',{createdAt})]);
    const records=[...leads,...productLeads],status=value=>String(value||'').toLowerCase();const won=deals.filter(d=>status(d.status)==='won').length,lost=deals.filter(d=>status(d.status)==='lost').length;
    const pipeline=new Map();for(const deal of deals.filter(d=>!['won','lost'].includes(status(d.status)))){const row=pipeline.get(deal.currency)||{currency:deal.currency,valueCents:0,weightedCents:0};row.valueCents+=Math.round(deal.value*100);row.weightedCents+=Math.round(deal.value*100*(deal.probability||0)/100);pipeline.set(deal.currency,row);}
    const sources={};for(const lead of records){const source=lead.source||'Product prospecting';sources[source]=(sources[source]||0)+1;}
    result.leads={total:records.length,new:records.filter(l=>status(l.status)==='new').length,qualified:records.filter(l=>status(l.status)==='qualified').length,won:records.filter(l=>status(l.status)==='won').length,lost:records.filter(l=>status(l.status)==='lost').length,dealsWon:won,dealsLost:lost,conversionRate:won+lost?Math.round(won/(won+lost)*10000)/100:0,pipeline:[...pipeline.values()].map(({currency,valueCents,weightedCents})=>({currency,value:valueCents/100,weighted:weightedCents/100})),sources};
    const upcoming=[...await scoped(businessModels['business-leads'],req.user,'leads',{nextFollowUp:{$ne:'',$gte:todayInDhaka()}}),...await scoped(ProductLead,req.user,'leads',{nextFollowUp:{$ne:'',$gte:todayInDhaka()}})].sort((a,b)=>a.nextFollowUp.localeCompare(b.nextFollowUp)).slice(0,20);result.followUps=upcoming.map(l=>({name:l.fullName||l.clientName,date:l.nextFollowUp,path:l.productId?`/studio/products/${l.productId}/leads/${l._id}`:`/studio/business-leads/${l._id}`}));
  }
  if(can(req.user,'projects:view')){const projects=await scoped(ManagedProject,req.user,'projects',{createdAt});const completed=p=>/^(completed|delivered)$/i.test(p.status||'');result.projects={total:projects.length,completed:projects.filter(completed).length,active:projects.filter(p=>!completed(p)&&!/^cancelled$/i.test(p.status)).length,overdue:projects.filter(p=>p.deliveryLastDate&&p.deliveryLastDate<todayInDhaka()&&!completed(p)&&!/^cancelled$/i.test(p.status)).length};}
  if(can(req.user,'tasks:view')){const tasks=await scoped(TeamTask,req.user,'tasks',{createdAt});result.tasks={total:tasks.length,pending:tasks.filter(t=>t.status!=='done').length,completed:tasks.filter(t=>t.status==='done').length,overdue:tasks.filter(t=>t.status!=='done'&&t.endDate&&t.endDate<todayInDhaka()).length};}
  if(can(req.user,'finance:view'))result.finance=await financialReport(req.user,r.from,r.to);
  if(can(req.user,'sales-activity:view')){const rows=await scoped(SalesActivity,req.user,'sales-activity',{date:{$gte:r.from,$lte:r.to}});result.marketplace={queries:0,quotes:0,orders:0,passes:0};for(const row of rows)for(const shift of['morning','evening','night'])for(const[metric,key]of[['Query','queries'],['Quote','quotes'],['Order','orders'],['Pass','passes']])result.marketplace[key]+=row[shift+metric]||0;}
  res.json(result);
});
router.get('/finance',requirePermission('finance:view'),async(req,res)=>{const r=range(req);res.json({range:{from:r.from,to:r.to},...await financialReport(req.user,r.from,r.to)});});
export default router;
