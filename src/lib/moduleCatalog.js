const humanize=key=>key.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,c=>c.toUpperCase());
function field(key,spec){return{key,label:spec.label||humanize(key),type:spec.type==='boolean'?'checkbox':spec.type==='enum'?'select':spec.type==='id'?(spec.resource==='people'?'users':'reference'):spec.type==='number'?'number':spec.type==='date'?'date':spec.type==='string-list'?'tags':spec.type==='url'?'url':spec.type==='email'?'email':spec.options?'select':spec.max>2000?'textarea':'text',options:spec.values||spec.options,custom:!!spec.options,resource:spec.resource,permission:spec.viewPermission,writePermission:spec.writePermission,required:!!spec.required,min:spec.min,max:spec.max,step:spec.type==='number'?1/10**(spec.decimals??2):undefined};}
export function catalogEntry(path,config,settings){
  const fields=Object.entries(config.fields).map(([key,spec])=>field(key,spec));
  const stageKey=path==='business-leads'?'leadStages':path==='deals'?'dealStages':null;
  if(stageKey&&settings?.[stageKey]?.length){const status=fields.find(f=>f.key==='status');if(status){status.type='select';status.custom=true;status.options=settings[stageKey];}}
  let columns=fields.filter(f=>!['users','reference','textarea','tags'].includes(f.type)).slice(0,8).map(f=>[f.key,f.label]);
  if(path==='invoices')columns=[['number','Invoice'],['title','Title'],['currency','Currency'],['dueDate','Due'],['total','Total'],['paid','Paid'],['balance','Balance'],['paymentStatus','Payment status']];
  if(path==='proposals')columns=[['number','Proposal'],['title','Title'],['status','Status'],['currency','Currency'],['total','Total'],['validUntil','Valid until']];
  if(path==='deals')columns=[['title','Deal'],['status','Stage'],['value','Value'],['currency','Currency'],['probability','Probability (%)'],['weightedValue','Weighted value'],['expectedClosingDate','Expected close']];
  if(path==='payroll')columns=[['description','Description'],['month','Month'],['currency','Currency'],['salary','Salary'],['bonus','Bonus'],['deductions','Deductions'],['netPay','Net pay'],['status','Status']];
  return{title:config.displayTitle,singular:config.singular,permission:config.permission,nameKey:config.title,description:`Manage ${config.displayTitle.toLowerCase()} with persistent records, assigned access and activity history.`,groups:[{title:'Details',fields}],columns,arrays:Object.entries(config.arrays||{}).map(([key,defs])=>({key,title:humanize(key),fields:Object.entries(defs).map(([k,s])=>field(k,s))})),defaults:config.defaults,import:true,dynamic:true};
}
