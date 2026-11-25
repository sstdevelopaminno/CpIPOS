import "server-only";
import {getSupabaseServiceClient} from "@/lib/supabase-admin";
import {todayBangkok} from "@/lib/finance-sales-analytics";
import {validateOverviewDates,summarizeRecyclingFinance,summarizeRecyclingCapital,type RecyclingFinanceTransaction,type RecyclingFinanceShift} from "@/lib/recycling-finance-overview";
import {FinanceReportError,type FinanceReadScope} from "@/lib/server/finance-report-guard";
const BATCH=500,MAX=20000;
const shiftFields="id,branch_id,opened_at,closed_at,opening_cash,actual_cash,expected_cash,metadata";
export async function loadRecyclingFinanceOverview(scope:FinanceReadScope,from:string,to:string,branchId:string|null){
 const today=todayBangkok();
 let range:ReturnType<typeof validateOverviewDates>;
 try{range=validateOverviewDates(from,to,today);}catch{throw new FinanceReportError("finance_invalid_date_range",422);}
 const db=getSupabaseServiceClient();
 const b=await db.from("branches").select("id,name").eq("tenant_id",scope.tenantId).in("id",scope.branchIds).eq("is_active",true).order("name");
 if(b.error||!b.data?.length)throw new FinanceReportError("finance_branches_unavailable",503);
 const branches=b.data.map(x=>({id:String(x.id),name:String(x.name)}));
 if(branchId&&!branches.some(x=>x.id===branchId))throw new FinanceReportError("finance_branch_not_permitted",403);
 const ids=branchId?[branchId]:branches.map(x=>x.id);
 const end=to===today?new Date(Math.min(Date.parse(range.end),Date.now())).toISOString():range.end;
 const rows:RecyclingFinanceTransaction[]=[],shifts:RecyclingFinanceShift[]=[];
 for(let offset=0;offset<MAX;offset+=BATCH){
  const result=await db.from("recycling_transactions").select("id,branch_id,shift_id,direction,settlement,total_minor,base_minor,vat_minor,cogs_minor",{count:"exact"}).eq("tenant_id",scope.tenantId).in("branch_id",ids).eq("status","posted").gte("created_at",range.start).lt("created_at",end).order("created_at").order("id").range(offset,offset+BATCH-1);
  if(result.error||result.count===null)throw new FinanceReportError("recycling_finance_unavailable",503);
  if(result.count>MAX)throw new FinanceReportError("recycling_finance_narrow_dates",422);
  rows.push(...(result.data??[]) as RecyclingFinanceTransaction[]);
  if(rows.length>=result.count)break;
  if((result.data??[]).length<BATCH)throw new FinanceReportError("recycling_finance_incomplete",503);
 }
 for(let offset=0;offset<MAX;offset+=BATCH){
  const result=await db.from("shifts").select(shiftFields,{count:"exact"}).eq("tenant_id",scope.tenantId).in("branch_id",ids).eq("metadata->>business_shift_mode","recycling_daily").gte("opened_at",range.start).lt("opened_at",end).order("opened_at").order("id").range(offset,offset+BATCH-1);
  if(result.error||result.count===null)throw new FinanceReportError("recycling_finance_shift_unavailable",503);
  if(result.count>MAX)throw new FinanceReportError("recycling_finance_narrow_dates",422);
  shifts.push(...(result.data??[]) as RecyclingFinanceShift[]);
  if(shifts.length>=result.count)break;
  if((result.data??[]).length<BATCH)throw new FinanceReportError("recycling_finance_incomplete",503);
 }
 const prior=await Promise.all(ids.map(id=>db.from("shifts").select(shiftFields).eq("tenant_id",scope.tenantId).eq("branch_id",id).eq("metadata->>business_shift_mode","recycling_daily").lt("opened_at",range.start).order("opened_at",{ascending:false}).order("id",{ascending:false}).limit(1).maybeSingle()));
 if(prior.some(x=>x.error))throw new FinanceReportError("recycling_finance_shift_unavailable",503);
 return {branches,from,to,asOf:end,capital:summarizeRecyclingCapital(ids,shifts,prior.flatMap(x=>x.data?[x.data as RecyclingFinanceShift]:[]),rows,range.start,end),totals:summarizeRecyclingFinance(rows)};
}
