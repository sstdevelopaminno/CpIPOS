import "server-only";
import {getSupabaseServiceClient} from "@/lib/supabase-admin";
import {isAuthorizedRecyclingTenant} from "@/lib/server/recycling-pos-service";
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};
export const recyclingCashierDateReady=()=>process.env.RECYCLING_CASHIER_DATE_OVERRIDE_ENABLED==="1";
export function recyclingCashierDateEnabled(metadata:unknown,branchId:string){
 return record(record(record(metadata).recycling_cashier_document_time_v1)[branchId]).enabled===true;
}
export async function canManageRecyclingCashierDate(tenantId:string,branchId:string,userId:string){
 const db=getSupabaseServiceClient();
 const [role,branch]=await Promise.all([
  db.from("user_branch_roles").select("role").eq("tenant_id",tenantId).eq("branch_id",branchId).eq("user_id",userId).maybeSingle(),
  db.from("branches").select("id").eq("tenant_id",tenantId).eq("id",branchId).eq("is_active",true).maybeSingle()
 ]);
 return !role.error&&!branch.error&&Boolean(branch.data)&&["owner","manager"].includes(String(role.data?.role));
}
export async function readRecyclingCashierDate(tenantId:string,branchId:string){
 const result=await getSupabaseServiceClient().from("tenants").select("metadata").eq("id",tenantId).eq("is_active",true).maybeSingle();
 if(result.error||!result.data)throw Error("recycling_cashier_date_unavailable");
 return {enabled:recyclingCashierDateEnabled(result.data.metadata,branchId),ready:recyclingCashierDateReady()};
}
export async function saveRecyclingCashierDate(tenantId:string,branchId:string,userId:string,enabled:boolean){
 if(!await isAuthorizedRecyclingTenant(tenantId)||!await canManageRecyclingCashierDate(tenantId,branchId,userId))throw Error("recycling_cashier_date_forbidden");
 if(enabled&&!recyclingCashierDateReady())throw Error("recycling_cashier_date_not_ready");
 const db=getSupabaseServiceClient();
 const result=await db.from("tenants").select("metadata").eq("id",tenantId).eq("is_active",true).maybeSingle();
 if(result.error||!result.data)throw Error("recycling_cashier_date_unavailable");
 const before=result.data.metadata;
 if(before!==null&&(typeof before!=="object"||Array.isArray(before)))throw Error("recycling_cashier_date_unavailable");
 const meta=record(before),all=record(meta.recycling_cashier_document_time_v1);
 const next={...meta,recycling_cashier_document_time_v1:{...all,[branchId]:{enabled,updated_by:userId,updated_at:new Date().toISOString()}}};
 let q=db.from("tenants").update({metadata:next}).eq("id",tenantId);
 q=before===null?q.is("metadata",null):q.eq("metadata",JSON.stringify(before));
 const saved=await q.select("id").maybeSingle();
 if(saved.error||!saved.data)throw Error("recycling_cashier_date_conflict");
 return {enabled,ready:recyclingCashierDateReady()};
}
