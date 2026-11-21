import "server-only";
import type { PosSessionScope } from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { getRecyclingStockBranches } from "@/lib/server/recycling-stock-branch-scope";
import { sumRecyclingReportMoney } from "@/lib/recycling-report-calculation";

export type RecyclingReportKind = "summary" | "receipts" | "products";
export type RecyclingReportQuery = {report_mode?:string;period?:string;date?:string;from?:string;to?:string;branch?:string;direction?:string;status?:string;q?:string;page?:string};
export type RecyclingTransaction = {
 id:string; receipt_no:string; direction:"buy"|"sell"; settlement:"cash"|"bank_transfer"|"credit";
 total_minor:number; cogs_minor:number; status:"posted"|"voided"; branch_id:string;
 shift_id:string|null; operator_user_id:string|null; counterparty_name:string|null; created_at:string
};
export type RecyclingLine = {id:string;transaction_id:string;line_no:number;sku_snapshot:string;name_snapshot:string;
 category_snapshot:string|null;original_quantity:number;original_unit:string;base_unit:string;price_per_base:number;amount_minor:number};
export type RecyclingHistoryReport = {
 kind:RecyclingReportKind; from:string;to:string;date:string;period:string;branch:string;direction:string;status:string;q:string;
 branchOptions:Array<{id:string;name:string}>;sessionBranchId:string;
 transactions:RecyclingTransaction[];lines:RecyclingLine[];
 shifts:Array<{id:string;branch_id:string;opened_at:string;closed_at:string|null;opening_cash:number|null;expected_cash:number|null;actual_cash:number|null;status:string}>;
 totals:Record<"buyCount"|"sellCount"|"voidCount"|"buyMinor"|"sellMinor"|"cogsMinor"|"cashInMinor"|"cashOutMinor"|"transferInMinor"|"transferOutMinor"|"creditInMinor"|"creditOutMinor",number>;
 page:number;pages:number;visible:RecyclingTransaction[];
};
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const MAX_TX=850;
function day(value:string):boolean{
 if(!DATE.test(value))return false;
 const time=Date.parse(value+"T00:00:00Z");
 return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value;
}
function todayBangkok():string{
 const f=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit"});
 const p=f.formatToParts(new Date());const n=(type:string)=>p.find(x=>x.type===type)?.value??"";
 return n("year")+"-"+n("month")+"-"+n("day");
}
/** The generic POS orders/receipts and their payment ledger are intentionally untouched. */
export async function loadRecyclingHistoryReport(scope:PosSessionScope,kind:RecyclingReportKind,query:RecyclingReportQuery={}):Promise<RecyclingHistoryReport>{
 if(process.env.RECYCLING_STOCK_SCHEMA_READY!=="1")throw new Error("recycling_report_backend_disabled");
 const date=day(query.date??"")?query.date!:todayBangkok();
 const period=["day","month","year","custom"].includes(query.period??"")?query.period!:"day";
 let from=date,to=date;
 if(period==="month"){
  from=date.slice(0,7)+"-01";
  to=new Date(Date.UTC(Number(date.slice(0,4)),Number(date.slice(5,7)),0)).toISOString().slice(0,10);
 }else if(period==="year"){from=date.slice(0,4)+"-01-01";to=date.slice(0,4)+"-12-31";}
 else if(period==="custom"){from=query.from??"";to=query.to??"";}
 if(!day(from)||!day(to)||Date.parse(to)<Date.parse(from)||(Date.parse(to)-Date.parse(from))/86400000>366){
  throw new Error("recycling_report_invalid_date_range");
 }
 const branches=await getRecyclingStockBranches(scope);
 const role=String(scope.session.role);
 const branch=query.branch||scope.session.branch_id;
 if(branch==="all"&&!["owner","manager"].includes(role))throw new Error("recycling_report_branch_denied");
 if(branch!=="all"&&!branches.some(b=>b.id===branch))throw new Error("recycling_report_branch_denied");
 const ids=branch==="all"?branches.map(b=>b.id):[branch];
 const db=getSupabaseServiceClient();
 const result=await db.from("recycling_transactions")
  .select("id,receipt_no,direction,settlement,total_minor,cogs_minor,status,branch_id,shift_id,operator_user_id,counterparty_name,created_at",{count:"exact"})
  .eq("tenant_id",scope.session.tenant_id).in("branch_id",ids).in("status",["posted","voided"])
  .gte("created_at",new Date(from+"T00:00:00+07:00").toISOString())
  .lt("created_at",new Date(Date.parse(to+"T00:00:00+07:00")+86400000).toISOString())
  .order("created_at",{ascending:false}).order("id",{ascending:false}).range(0,MAX_TX);
 if(result.error)throw new Error("recycling_report_transactions_unavailable");
 if((result.count??0)>MAX_TX)throw new Error("recycling_report_narrow_period_required");
 const transactions=(result.data??[]) as RecyclingTransaction[];
 const direction=["buy","sell"].includes(query.direction??"")?query.direction!:"all";
 const status=["posted","voided"].includes(query.status??"")?query.status!:"all";
 const q=(query.q??"").trim().slice(0,80).toLocaleLowerCase();
 const matching=transactions.filter(t=>(kind!=="products"||t.direction==="sell")
   &&(direction==="all"||t.direction===direction)&&(status==="all"||t.status===status)
   &&(!q||[t.receipt_no,t.counterparty_name??""].some(x=>x.toLocaleLowerCase().includes(q))));
 const pageRequested=Number(query.page??"1");
 const page=Number.isSafeInteger(pageRequested)?Math.max(1,Math.min(pageRequested,500)):1;
 const size=kind==="products"?20:20,pages=Math.max(1,Math.ceil(matching.length/size));
 const visible=matching.slice((page-1)*size,page*size);
 const lines:RecyclingLine[]=[];
 if(kind==="products"){
  // Product list uses immutable material snapshots; purchases are never counted as sales.
  for(let i=0;i<matching.length;i+=65){
   const batch=matching.slice(i,i+65).map(t=>t.id);
   if(!batch.length)continue;
   const v=await db.from("recycling_transaction_lines")
     .select("id,transaction_id,line_no,sku_snapshot,name_snapshot,category_snapshot,original_quantity,original_unit,base_unit,price_per_base,amount_minor")
     .eq("tenant_id",scope.session.tenant_id).in("branch_id",ids)
     .in("transaction_id",batch).order("line_no").limit(1001);
   if(v.error)throw new Error("recycling_report_lines_unavailable");
   if((v.data??[]).length>1000)throw new Error("recycling_report_narrow_period_required");
   lines.push(...(v.data??[]) as RecyclingLine[]);
  }
 }
 let shifts:RecyclingHistoryReport["shifts"]=[];
 if(kind==="summary"){
  const shiftIds=[...new Set(matching.map(t=>t.shift_id).filter((x):x is string=>Boolean(x)))];
  for(let i=0;i<shiftIds.length;i+=65){
   const v=await db.from("shifts")
    .select("id,branch_id,opened_at,closed_at,opening_cash,expected_cash,actual_cash,status")
    .eq("tenant_id",scope.session.tenant_id).in("branch_id",ids).in("id",shiftIds.slice(i,i+65));
   if(v.error)throw new Error("recycling_report_shifts_unavailable");
   shifts=shifts.concat((v.data??[]) as RecyclingHistoryReport["shifts"]);
  }
  shifts.sort((a,b)=>b.opened_at.localeCompare(a.opened_at));
 }
 return {kind,from,to,date,period,branch,direction,status,q,sessionBranchId:scope.session.branch_id,
  branchOptions:branches.map(b=>({id:b.id,name:b.name})),transactions:matching,lines,shifts,
  totals:sumRecyclingReportMoney(kind==="summary"?matching:transactions),page,pages,visible};
}
