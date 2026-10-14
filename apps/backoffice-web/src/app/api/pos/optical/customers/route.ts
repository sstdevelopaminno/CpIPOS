import type { BranchRole } from "@pos/shared-types";
import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { PosGuardError, requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { requireOpticalRetailEntitlement } from "@/lib/server/optical-entitlement";

type OpticalCustomerInput = {
  request_id?: string;
  customer_code?: string;
  full_name?: string;
  phone?: string;
  age?: number | null;
  exam_date?: string;
  previous_prescription?: string;
  pd_mm?: number | null;
  examiner_name?: string;
  right_sph?: number | null;
  right_cyl?: number | null;
  right_axis?: number | null;
  right_add?: number | null;
  left_sph?: number | null;
  left_cyl?: number | null;
  left_axis?: number | null;
  left_add?: number | null;
  notes?: string;
};
const safe = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
function optionalNumber(value: unknown) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}
function failFromError(error: unknown) {
  if (error instanceof PosGuardError) return fail(error.code,error.message,error.status);
  return fail("optical_customer_error", "Unable to save optical customer record.",500);
}

export async function GET(request: Request) {
  try {
    const scope = await requirePosSession();
    requirePermission(scope,"sales:list:view");
    if (!await requireOpticalRetailEntitlement(scope.session.tenant_id)) {
      return fail("optical_mode_denied","This tenant does not have IT-authorized Optical access.",403);
    }
    const q = safe(new URL(request.url).searchParams.get("q"), 48);
    const supabase = getSupabaseServiceClient();
    let query = supabase.from("optical_customers")
      .select("id,customer_code,full_name,phone,last_exam_date,examiner_name,updated_at")
      .eq("tenant_id",scope.session.tenant_id)
      .eq("branch_id",scope.session.branch_id)
      .is("deleted_at",null).order("updated_at",{ascending:false}).limit(40);
    if (q) {
      const sanitized = q.replace(/[%,.()]/g,"");
      if (sanitized) query=query.or(`customer_code.ilike.%${sanitized}%,full_name.ilike.%${sanitized}%`);
    }
    const {data,error}=await query;
    if(error) return fail("optical_customer_query_failed",error.message,500);
    return ok({customers:data??[]});
  } catch(error) {
    return failFromError(error);
  }
}

export async function POST(request: Request) {
  try {
    const scope=await requirePosSession();
    requirePermission(scope,"sale:create");
    if (!await requireOpticalRetailEntitlement(scope.session.tenant_id)) {
      return fail("optical_mode_denied","This tenant does not have IT-authorized Optical access.",403);
    }
    const input=await request.json().catch(()=>null) as OpticalCustomerInput | null;
    if (!input || safe(input.customer_code,48).length===0 || safe(input.full_name,240).length===0) {
      return fail("optical_customer_invalid","Customer code and name are required.",422);
    }
    const examined=safe(input.exam_date,10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(examined)) return fail("optical_exam_date_invalid","Exam date is required.",422);
    const numbers=["age","pd_mm","right_sph","right_cyl","right_axis","right_add",
      "left_sph","left_cyl","left_axis","left_add"] as const;
    if (numbers.some(key=>Number.isNaN(optionalNumber(input[key])))) {
      return fail("optical_exam_number_invalid","Eye examination values must be numbers.",422);
    }
    if (optionalNumber(input.age)!==null && (Number(input.age)<0 || Number(input.age)>130)) {
      return fail("optical_age_invalid","Age is out of range.",422);
    }
    if (optionalNumber(input.pd_mm)!==null && (Number(input.pd_mm)<30 || Number(input.pd_mm)>90)) {
      return fail("optical_pd_invalid","PD must be between 30 and 90 mm.",422);
    }
    const requestId=safe(input.request_id,40);
    if(requestId && !/^[0-9a-f-]{36}$/i.test(requestId)){
      return fail("optical_request_id_invalid","Invalid request id.",422);
    }
    const supabase=getSupabaseServiceClient();
    const {data,error}=await supabase.rpc("optical_save_customer_exam",{
      p_tenant_id:scope.session.tenant_id,p_branch_id:scope.session.branch_id,
      p_customer_code:safe(input.customer_code,48),p_full_name:safe(input.full_name,240),
      p_phone:safe(input.phone,48)||null,p_age:optionalNumber(input.age),
      p_exam_date:examined,p_previous_prescription:safe(input.previous_prescription,1000)||null,
      p_pd_mm:optionalNumber(input.pd_mm),p_examiner_name:safe(input.examiner_name,180)||null,
      p_right_sph:optionalNumber(input.right_sph),p_right_cyl:optionalNumber(input.right_cyl),
      p_right_axis:optionalNumber(input.right_axis),p_right_add:optionalNumber(input.right_add),
      p_left_sph:optionalNumber(input.left_sph),p_left_cyl:optionalNumber(input.left_cyl),
      p_left_axis:optionalNumber(input.left_axis),p_left_add:optionalNumber(input.left_add),
      p_notes:safe(input.notes,1500)||null,p_request_id:requestId||crypto.randomUUID(),
      p_actor:scope.session.user_id
    });
    if(error) return fail("optical_customer_save_failed",error.message,500);
    const saved = data as {customer_id?:string;exam_id?:string;request_id?:string}|null;
    // Audit identifiers only; do not copy private optometry values into logs.
    void appendAuditLog({
      tenantId:scope.session.tenant_id,
      branchId:scope.session.branch_id,
      actorUserId:scope.session.user_id,
      actorRole:scope.session.role as BranchRole,
      action:"optical_customer_exam_saved",
      targetTable:"optical_customers",
      targetId:saved?.customer_id,
      metadata:{exam_id:saved?.exam_id??null,request_id:saved?.request_id??null}
    });
    return ok({record:data});
  } catch(error){return failFromError(error);}
}
