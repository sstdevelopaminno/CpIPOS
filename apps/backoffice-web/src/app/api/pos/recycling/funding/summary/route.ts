import { NextResponse } from "next/server";
import { PosGuardError, requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type FundAccount = {
  code:"1100"|"1110";
  label:string;
  balance_minor:number|null;
  entries:number;
};
const NO_STORE={"Cache-Control":"private, no-store, max-age=0"};
const MAX_LEDGER_ROWS=5000;
const PAGE_SIZE=500;

function exactMinor(value:unknown):number|null{
  const parsed=Number(value);
  return Number.isSafeInteger(parsed)&&Math.abs(parsed)<9_000_000_000_000_000?parsed:null;
}
function validBahtToMinor(value:unknown):number|null{
  if(value===null||value===undefined)return null;
  const n=Number(value);
  const minor=Math.round(n*100);
  if(!Number.isFinite(n)||n<0||!Number.isSafeInteger(minor)||Math.abs(n*100-minor)>0.00001)return null;
  return minor;
}
function response(data:unknown,status=200){
  return NextResponse.json(data,{status,headers:NO_STORE});
}

// Read-only cash-fund context. Never count a bank balance as cash in a
// cashier drawer and never transfer or auto-create a finance journal.
export async function GET(request:Request){
  try{
    const scope=await requirePosSession();
    requirePermission(scope,"shift:join");
    const tenantId=scope.session.tenant_id;
    const branchId=scope.session.branch_id;
    if(!await isAuthorizedRecyclingTenant(tenantId)){
      return response({data:null,error:{code:"recycling_not_authorized",message:"ไม่มีสิทธิ์ดูทุนหมุนเวียน Recycling"}},403);
    }
    const db=getSupabaseServiceClient();
    const role=scope.session.role;
    const manager=["owner","manager","accountant"].includes(role);
    const shiftId=new URL(request.url).searchParams.get("shiftId");
    let shiftFlow:null|{
      opening_minor:number|null;
      cash_in_minor:number;
      cash_out_minor:number;
      expected_minor:number|null;
      buy_count:number;
      sell_count:number;
    }=null;
    let shiftFlowStatus:"not_requested"|"ready"|"unavailable"="not_requested";
    if(shiftId){
      if(!/^[a-f0-9-]{36}$/i.test(shiftId))return response({data:null,error:{code:"invalid_shift_id"}},422);
      const shiftResult=await db.from("shifts")
        .select("id,tenant_id,branch_id,opened_by,device_code,opening_cash,metadata,status")
        .eq("id",shiftId).eq("tenant_id",tenantId).eq("branch_id",branchId).maybeSingle();
      const shift=shiftResult.data;
      const tagged=(shift?.metadata as Record<string,unknown>|null)?.business_shift_mode==="recycling_daily";
      if(shiftResult.error||!shift||!tagged||
         (!manager&&shift.opened_by!==scope.session.user_id) ||
         (scope.session.device_code?shift.device_code!==scope.session.device_code:shift.device_code!==null)){
        return response({data:null,error:{code:"recycling_shift_not_found",message:"ไม่พบกะ Recycling ในเครื่องและสาขานี้"}},404);
      }
      if(process.env.RECYCLING_STOCK_SCHEMA_READY==="1"){
        const totals=await db.rpc("recycling_shift_totals",{
          p_tenant_id:tenantId,p_branch_id:branchId,p_shift_id:shiftId
        });
        if(!totals.error&&totals.data){
          const raw=totals.data as Record<string,unknown>;
          const cashIn=exactMinor(raw.cash_in_minor),cashOut=exactMinor(raw.cash_out_minor);
          const buyCount=exactMinor(raw.buy_count),sellCount=exactMinor(raw.sell_count);
          const opening=validBahtToMinor(shift.opening_cash);
          if(cashIn!==null&&cashOut!==null&&buyCount!==null&&sellCount!==null&&
             cashIn>=0&&cashOut>=0&&buyCount>=0&&sellCount>=0){
            const expected=opening===null?null:opening+cashIn-cashOut;
            shiftFlow={
              opening_minor:opening,cash_in_minor:cashIn,cash_out_minor:cashOut,
              expected_minor:expected!==null&&Number.isSafeInteger(expected)&&expected>=0?expected:null,
              buy_count:buyCount,sell_count:sellCount
            };
            shiftFlowStatus="ready";
          }else shiftFlowStatus="unavailable";
        }else shiftFlowStatus="unavailable";
      }else shiftFlowStatus="unavailable";
    }

    let financeStatus:"restricted"|"unposted"|"ready"|"unavailable"="restricted";
    const accounts:FundAccount[]=[
      {code:"1100",label:"บัญชีเงินสด (1100)",balance_minor:null,entries:0},
      {code:"1110",label:"เงินฝากธนาคาร (1110)",balance_minor:null,entries:0}
    ];
    if(manager){
      const chart=await db.from("finance_accounting_chart")
        .select("id,account_code,account_type").eq("tenant_id",tenantId)
        .in("account_code",["1100","1110"]).limit(10);
      if(chart.error)financeStatus="unavailable";
      else if(!chart.data?.length)financeStatus="unposted";
      else{
        const ids=chart.data.filter(a=>a.account_type==="asset").map(a=>a.id);
        if(!ids.length)financeStatus="unposted";
        else{
          const byId=new Map(chart.data.filter(a=>a.account_type==="asset")
            .map(a=>[a.id,String(a.account_code)]));
          let from=0,failed=false,entries=0;
          const totals=new Map<string,number>([["1100",0],["1110",0]]);
          const counts=new Map<string,number>([["1100",0],["1110",0]]);
          // Branch scoped, bounded read. Never display partial balances if
          // pagination or integer safety fails (a partial sum could overstate funds).
          while(from<=MAX_LEDGER_ROWS){
            const page=await db.from("finance_accounting_journal_lines")
              .select("account_id,debit_minor,credit_minor")
              .eq("tenant_id",tenantId).eq("branch_id",branchId)
              .in("account_id",ids).order("id",{ascending:true})
              .range(from,from+PAGE_SIZE-1);
            if(page.error){failed=true;break;}
            const rows=page.data??[];
            if(from+rows.length>MAX_LEDGER_ROWS){failed=true;break;}
            for(const line of rows){
              const code=byId.get(line.account_id);
              if(!code)continue;
              const debit=exactMinor(line.debit_minor),credit=exactMinor(line.credit_minor);
              const running=totals.get(code)!;
              if(debit===null||credit===null||debit<0||credit<0||!Number.isSafeInteger(running+debit-credit)){
                failed=true;break;
              }
              totals.set(code,running+debit-credit);
              counts.set(code,(counts.get(code)??0)+1);
              entries++;
            }
            if(failed||rows.length<PAGE_SIZE)break;
            from+=rows.length;
          }
          if(failed)financeStatus="unavailable";
          else{
            financeStatus=entries?"ready":"unposted";
            for(const account of accounts){
              const num=counts.get(account.code)??0;
              account.entries=num;
              account.balance_minor=num?(totals.get(account.code)??null):null;
            }
          }
        }
      }
    }
    return response({data:{
      finance_status:financeStatus,accounts,
      shift_flow_status:shiftFlowStatus,shift_flow:shiftFlow,
      note:"ยอดบัญชีมาจากสมุดรายวันที่โพสต์ของสาขา ไม่ใช่เงินสดพร้อมจ่าย การเบิกหรือโอนเงินต้องมีธุรกรรมที่อนุมัติและนับเงินจริงก่อน"
    },error:null});
  }catch(error){
    if(error instanceof PosGuardError)return response({data:null,error:{code:error.code,message:error.message}},error.status);
    return response({data:null,error:{code:"recycling_funding_unavailable",message:"ไม่สามารถตรวจสอบข้อมูลเงินทุนจากบัญชีได้"}},503);
  }
}
