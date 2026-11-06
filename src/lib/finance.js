import { fail } from './validation.js';
export function invoiceTotals(record){
  let subtotalCents=0,taxCents=0;
  for(const item of record.items||[]){const base=Math.round(item.quantity*Math.round(item.unitPrice*100));subtotalCents+=base;taxCents+=Math.round(base*(item.taxPercent||0)/100);}
  const discountCents=Math.round((record.discount||0)*100);
  const totalCents=Math.max(0,subtotalCents+taxCents-discountCents);
  const paidCents=(record.payments||[]).reduce((sum,p)=>sum+p.amountCents,0);
  return{subtotal:subtotalCents/100,tax:taxCents/100,discount:discountCents/100,total:totalCents/100,paid:paidCents/100,balance:Math.max(0,totalCents-paidCents)/100,totalCents,paidCents};
}
export function validateCurrency(data){for(const key of['currency','baseCurrency','salaryCurrency'])if(data[key]&&!/^[A-Z]{3}$/.test(data[key]))fail(`${key} must be a three-letter uppercase currency code.`);}
export function validateFinanceRecord(data,previous,config){
  const record={...(previous?.toObject?.()||previous||{}),...data};validateCurrency(record);
  if(config.arrays?.items){if((record.items||[]).length>100)fail('At most 100 line items are supported.');for(const item of record.items||[])if(!item.quantity||item.quantity<=0)fail('Each line item requires a positive quantity.');}
  if(config.displayTitle==='Invoices'){
    const totals=invoiceTotals(record);if(record.discount>totals.subtotal+totals.tax)fail('Discount cannot exceed the invoice amount.');
    if(previous && previous.status !== 'draft' &&['items','discount','currency','clientId'].some(k=>k in data))fail('Invoice financial fields cannot change after sending. Create a replacement invoice for revised charges.');
    if(data.status==='cancelled'&&totals.paidCents>0)fail('An invoice with recorded payments cannot be cancelled.');
    if(data.status==='sent'&&(!(record.items||[]).length||!record.clientId))fail('Choose a client and add line items before sending the invoice.');
  }
  if(config.displayTitle==='Payroll'&&(record.deductions||0)>(record.salary||0)+(record.bonus||0))fail('Payroll deductions cannot exceed salary plus bonus.');
  if(record.recognitionStatus === 'recognized' && !record.recognizedDate) fail('A recognition date is required.');
  if(config.displayTitle === 'Expenses' && record.paymentStatus === 'paid' && !record.paidDate) fail('Paid expenses require a payment date.');
  if(config.displayTitle === 'Payroll' && record.status === 'paid' && !record.paidDate) fail('Paid payroll requires a payment date.');
  if(record.exchangeRate&&!record.conversionDate)fail('A conversion date is required with an exchange rate.');
  if(record.startDate&&record.endDate&&record.endDate<record.startDate)fail('End date must follow start date.');
  if(record.month&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(record.month))fail('Month must be YYYY-MM.');
  for(const key of['clockIn','clockOut'])if(record[key]&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(record[key]))fail(`${key} must use HH:MM.`);
  if(record.clockIn&&record.clockOut&&record.clockOut<record.clockIn)fail('Clock-out must follow clock-in; split overnight work across two dates.');
}
