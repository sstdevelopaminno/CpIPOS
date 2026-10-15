import "server-only";
import {getSupabaseServiceClient} from "@/lib/supabase-admin";
import {PosGuardError,type PosSessionScope} from "@/lib/pos-session-guard";

export type OpticalBranch={id:string;name:string};
/** Stock branch switching is limited to POS-session tenant and assigned branches.
 * A staff session never inherits owner/manager multi-branch privileges.
 */
export async function getOpticalBranchScope(scope:PosSessionScope):Promise<OpticalBranch[]>{
  const tenant=scope.session.tenant_id,user=scope.session.user_id;
  const branch=scope.session.branch_id;
  const role=String(scope.session.role??"").toLowerCase();
  const db=getSupabaseServiceClient();
  if(!["owner","manager"].includes(role)){
    const single=await db.from("branches").select("id,name")
      .eq("tenant_id",tenant).eq("id",branch).eq("is_active",true).maybeSingle();
    if(single.error)throw new PosGuardError("optical_branch_lookup_failed","ตรวจสอบสาขาไม่สำเร็จ",503);
    return [{id:branch,name:single.data?.name??"สาขาปัจจุบัน"}];
  }
  const [membership,branches]=await Promise.all([
    db.from("user_branch_roles").select("branch_id")
      .eq("tenant_id",tenant).eq("user_id",user),
    db.from("branches").select("id,name")
      .eq("tenant_id",tenant).eq("is_active",true).order("name",{ascending:true})
  ]);
  if(membership.error||branches.error)
    throw new PosGuardError("optical_branch_lookup_failed","ไม่สามารถตรวจสอบสิทธิ์สาขาได้",503);
  const assigned=new Set((membership.data??[]).map(row=>String(row.branch_id)));
  // A valid signed POS session may be attached to a branch even where an old
  // device account has no matching user_branch_roles row yet.
  assigned.add(branch);
  return (branches.data??[]).filter(row=>assigned.has(row.id))
    .map(row=>({id:row.id,name:row.name??row.id}));
}
export function verifyOpticalBranch(branchId:string,options:OpticalBranch[]){
 if(!options.some(b=>b.id===branchId))
   throw new PosGuardError("optical_branch_forbidden","คุณไม่ได้รับสิทธิ์สาขานี้",403);
 return branchId;
}
