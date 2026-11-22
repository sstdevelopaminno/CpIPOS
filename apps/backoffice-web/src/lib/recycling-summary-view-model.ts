import { sumRecyclingReportMoney, type RecyclingReportMoney, type MoneyRecyclingRow } from "@/lib/recycling-report-calculation";

export type ReportShift = {
 id:string;branch_id:string;opened_at:string;closed_at:string|null;
 opening_cash:number|null;expected_cash:number|null;actual_cash:number|null;status:string;
};
export type ReportTransaction = MoneyRecyclingRow & {
 id:string;shift_id:string|null;branch_id:string;receipt_no:string;
 created_at:string;counterparty_name:string|null;
};
export type ShiftSnapshot = {
 shift:ReportShift;transactions:ReportTransaction[];
 money:RecyclingReportMoney;openingMinor:number|null;
 expectedMinor:number|null;actualMinor:number|null;differenceMinor:number|null;
};

function bahtToMinor(value:number|null):number|null {
 if(value===null||!Number.isFinite(Number(value)))return null;
 const minor=Math.round(Number(value)*100);
 return Number.isSafeInteger(minor)?minor:null;
}
/** Reconcile from immutable posted bills only. Never count VOID as cash. */
export function buildRecyclingShiftSnapshots(shifts:ReportShift[],allRows:ReportTransaction[]):ShiftSnapshot[]{
 const byShift=new Map<string,ReportTransaction[]>();
 for(const row of allRows){
  if(!row.shift_id)continue;
  const arr=byShift.get(row.shift_id)??[];
  arr.push(row);byShift.set(row.shift_id,arr);
 }
 return shifts.map(shift=>{
  const transactions=(byShift.get(shift.id)??[]).sort((a,b)=>b.created_at.localeCompare(a.created_at));
  const money=sumRecyclingReportMoney(transactions);
  const openingMinor=bahtToMinor(shift.opening_cash);
  // Persisted close figure is authoritative when present; open shifts use
  // an explicitly estimated cash value from the loaded report period.
  const expectedMinor=bahtToMinor(shift.expected_cash) ??
    (openingMinor===null?null:openingMinor+money.cashInMinor-money.cashOutMinor);
  const actualMinor=bahtToMinor(shift.actual_cash);
  return {shift,transactions,money,openingMinor,expectedMinor,actualMinor,
   differenceMinor:actualMinor===null||expectedMinor===null?null:actualMinor-expectedMinor};
 });
}

function bangkokParts(iso:string){
 const parts=new Intl.DateTimeFormat("en-US",{
  timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",hourCycle:"h23"
 }).formatToParts(new Date(iso));
 const get=(type:string)=>parts.find(part=>part.type===type)?.value??"00";
 return {day:get("year")+"-"+get("month")+"-"+get("day"),hour:Number(get("hour"))};
}
export type RecyclingChartPoint={key:string;label:string;buyMinor:number;sellMinor:number};
export function recyclingSummaryChart(rows:ReportTransaction[],period:string,from:string,to:string):RecyclingChartPoint[]{
 const days=(Date.parse(to+"T00:00:00Z")-Date.parse(from+"T00:00:00Z"))/86400000+1;
 const group=period==="day"?"hour":period==="year"||days>31?"month":"date";
 const map=new Map<string,RecyclingChartPoint>();
 const put=(key:string,label:string)=>{
  let v=map.get(key);if(!v){v={key,label,buyMinor:0,sellMinor:0};map.set(key,v);}
  return v;
 };
 if(group==="hour"){
  for(let i=0;i<6;i++)put(String(i),String(i*4).padStart(2,"0")+"–"+String(i*4+3).padStart(2,"0"));
 }else if(group==="month"){
  const start=Number(from.slice(0,4))*12+Number(from.slice(5,7))-1;
  const end=Number(to.slice(0,4))*12+Number(to.slice(5,7))-1;
  for(let m=start;m<=end;m++){
   const year=Math.floor(m/12),month=m%12+1;
   const k=year+"-"+String(month).padStart(2,"0");
   put(k,new Intl.DateTimeFormat("th-TH",{month:"short"}).format(new Date(Date.UTC(year,month-1,1))));
  }
 }else{
  for(let ms=Date.parse(from+"T00:00:00Z");ms<=Date.parse(to+"T00:00:00Z");ms+=86400000){
   const k=new Date(ms).toISOString().slice(0,10);
   put(k,k.slice(8,10)+"/"+k.slice(5,7));
  }
 }
 for(const row of rows){
  if(row.status!=="posted")continue;
  const part=bangkokParts(row.created_at);
  const key=group==="hour"?String(Math.floor(part.hour/4)):group==="month"?part.day.slice(0,7):part.day;
  const point=map.get(key);
  if(!point)continue;
  if(!Number.isSafeInteger(Number(row.total_minor))||Number(row.total_minor)<0)continue;
  if(row.direction==="buy")point.buyMinor+=Number(row.total_minor);
  else point.sellMinor+=Number(row.total_minor);
 }
 return [...map.values()];
}
