export type PeriodMode="day"|"month"|"year"|"custom";
export type RecyclingFinanceTransaction={id:string;branch_id:string;shift_id:string;direction:string;settlement:string;total_minor:number|string;base_minor:number|string|null;vat_minor:number|string|null;cogs_minor:number|string|null};
export type RecyclingFinanceShift={id:string;branch_id:string;opened_at:string;closed_at:string|null;opening_cash:number|string|null;actual_cash:number|string|null;expected_cash:number|string|null;metadata:unknown};
export type CapitalSnapshot={opening:number|null;remaining:number|null;estimated:boolean};
export function periodDates(mode:PeriodMode,date:string,today:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return {from:today,to:today};
 const from=mode==="year"?date.slice(0,4)+"-01-01":mode==="month"?date.slice(0,7)+"-01":date;
 let to=date;
 if(mode==="month"){const [y,m]=date.split("-").map(Number);to=new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);}
 if(mode==="year")to=date.slice(0,4)+"-12-31";
 return {from,to:to>today?today:to};
}
export function validateOverviewDates(from:string,to:string,today:string){
 const valid=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+"T00:00:00Z"))&&new Date(s+"T00:00:00Z").toISOString().slice(0,10)===s;
 if(!valid(from)||!valid(to)||from>to||to>today||Date.parse(to)-Date.parse(from)>=366*86400000)throw Error("ช่วงวันที่ไม่ถูกต้อง หรือเกิน 366 วัน");
 return {start:new Date(from+"T00:00:00+07:00").toISOString(),end:new Date(Date.parse(to+"T00:00:00+07:00")+86400000).toISOString()};
}
function integer(v:unknown):number{
 if(v===null||v===undefined||v===""||!Number.isSafeInteger(Number(v)))throw Error("invalid_minor");
 return Number(v);
}
function add(a:number,b:number){return integer(a+b);}
function baht(v:unknown):number|null{
 if(v===null||v===undefined||v==="")return null;
 const n=Number(v);return Number.isFinite(n)&&Number.isSafeInteger(Math.round(n*100))?Math.round(n*100):null;
}
export function summarizeRecyclingFinance(rows:readonly RecyclingFinanceTransaction[]){
 let buy=0,sell=0,revenue=0,cogs=0,cashIn=0,cashOut=0,bankIn=0,bankOut=0,vat=0,creditBuy=0,creditSell=0;
 for(const r of rows){
  const gross=integer(r.total_minor);
  if(gross<0||!["buy","sell"].includes(r.direction)||!["cash","bank_transfer","credit"].includes(r.settlement))throw Error("invalid_transaction");
  if(r.direction==="buy"){buy=add(buy,gross);if(r.settlement==="cash")cashOut=add(cashOut,gross);if(r.settlement==="bank_transfer")bankOut=add(bankOut,gross);if(r.settlement==="credit")creditBuy=add(creditBuy,gross);}
  else{
   const tax=integer(r.vat_minor??0),base=integer(r.base_minor??gross),cost=integer(r.cogs_minor);
   if(tax<0||base<0||cost<0||add(base,tax)!==gross)throw Error("invalid_sale_totals");
   sell=add(sell,gross);revenue=add(revenue,base);vat=add(vat,tax);cogs=add(cogs,cost);
   if(r.settlement==="cash")cashIn=add(cashIn,gross);if(r.settlement==="bank_transfer")bankIn=add(bankIn,gross);if(r.settlement==="credit")creditSell=add(creditSell,gross);
  }
 }
 const result=add(revenue,-cogs);
 return {buy,sell,revenue,cogs,profit:Math.max(0,result),loss:Math.max(0,-result),cashIn,cashOut,bankIn,bankOut,cashNet:add(cashIn,-cashOut),bankNet:add(bankIn,-bankOut),vat,creditBuy,creditSell,count:rows.length};
}
function closingSnapshot(s:RecyclingFinanceShift,rows:readonly RecyclingFinanceTransaction[],end:string,allowCompute=true):{amount:number|null;estimated:boolean}{
 if(s.closed_at&&Date.parse(s.closed_at)<Date.parse(end)){
  const actual=baht(s.actual_cash);if(actual!==null)return {amount:actual,estimated:false};
  const expected=baht(s.expected_cash);
  if(expected!==null)return {amount:expected,estimated:true};
  const meta=s.metadata as Record<string,unknown>|null;
  const raw=meta?.recycling_expected_cash_minor;
  if(raw!==null&&raw!==undefined&&Number.isSafeInteger(Number(raw)))return {amount:Number(raw),estimated:true};
 }
 if(!allowCompute)return {amount:null,estimated:true};
 const opening=baht(s.opening_cash);if(opening===null)return {amount:null,estimated:true};
 const m=summarizeRecyclingFinance(rows.filter(r=>r.shift_id===s.id));
 return {amount:add(opening,m.cashNet),estimated:true};
}
/** Cash working-capital snapshots, not sum of repeated daily float. */
export function summarizeRecyclingCapital(branchIds:readonly string[],shifts:readonly RecyclingFinanceShift[],prior:readonly RecyclingFinanceShift[],rows:readonly RecyclingFinanceTransaction[],start:string,end:string):CapitalSnapshot{
 let opening:number|null=0,remaining:number|null=0,estimated=false;
 for(const branch of branchIds){
  const period=shifts.filter(s=>s.branch_id===branch).sort((a,b)=>Date.parse(a.opened_at)-Date.parse(b.opened_at));
  const prev=prior.find(s=>s.branch_id===branch);
  const previous=prev&&prev.closed_at&&Date.parse(prev.closed_at)<=Date.parse(start)?closingSnapshot(prev,[],end,false):null;
  const first=period[0],last=period[period.length-1];
  const open=first?baht(first.opening_cash):previous?.amount??null;
  const close=last?closingSnapshot(last,rows,end):previous??{amount:null,estimated:true};
  opening=opening===null||open===null?null:add(opening,open);
  remaining=remaining===null||close.amount===null?null:add(remaining,close.amount);
  estimated=estimated||close.estimated||(!first&&!!previous?.estimated);
 }
 return {opening,remaining,estimated};
}
