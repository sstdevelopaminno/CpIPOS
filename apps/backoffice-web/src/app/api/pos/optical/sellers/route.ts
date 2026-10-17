import { fail, ok } from "@/lib/http";
import { PosGuardError, requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { requireOpticalFinanceModule } from "@/lib/server/optical-finance-policy";

export async function GET() {
  try{
    const scope=await requirePosSession();
    requirePermission(scope,"sales:list:view");
    if(!await requireOpticalFinanceModule(scope.session.tenant_id,"optical_work_orders"))
      return fail("optical_sellers_disabled","Optical work orders have not been approved.",403);
    const db=getSupabaseServiceClient();
    const {data:roles,error}=await db.from("user_branch_roles").select("user_id,role")
      .eq("tenant_id",scope.session.tenant_id).eq("branch_id",scope.session.branch_id)
      .in("role",["owner","manager","staff"]);
    if(error)return fail("optical_sellers_unavailable","Unable to list salespeople.",503);
    const ids=[...new Set((roles??[]).map(row=>String(row.user_id)))];
    if(ids.length===0)return ok({sellers:[]});
    const {data:users,error:usersError}=await db.from("users_profiles")
      .select("id,full_name").in("id",ids).eq("is_active",true).is("archived_at",null);
    if(usersError)return fail("optical_sellers_unavailable","Unable to list salespeople.",503);
    // Deliberately never return login PIN, employee code or email.
    return ok({sellers:(users??[]).map(user=>({id:user.id,name:user.full_name??"พนักงาน"}))});
  }catch(error){
    return error instanceof PosGuardError?fail(error.code,error.message,error.status)
      : fail("optical_sellers_unavailable","Unable to list salespeople.",503);
  }
}
