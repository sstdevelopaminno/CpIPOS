import { fail, ok } from "@/lib/http";
import { FeatureGateError } from "@/lib/feature-gate";
import { requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { PosGuardError, requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { queueRoutedRecyclingBarcode } from "@/lib/printing/recycling-barcode-print-service";
import { RECYCLING_BARCODE_LABEL_SIZES, type RecyclingBarcodeLabelSize } from "@/lib/recycling-barcode-print-layout";
import type { AuthContext } from "@/lib/auth-context";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function POST(request:Request){
 try{
  const origin=request.headers.get("origin");
  if(origin&&new URL(origin).host!==new URL(request.url).host)
   return fail("recycling_barcode_invalid_origin","Cross-site request forbidden.",403);
  const scope=await requirePosSession();
  requirePermission(scope,"inventory:view");
  const tenantId=scope.session.tenant_id,branchId=scope.session.branch_id;
  await assertPosMenuPageAllowed(tenantId,"/preview/pos/stock");
  if(!await isAuthorizedRecyclingTenant(tenantId))
   return fail("recycling_not_authorized","CUSTOM Recycling entitlement required.",403);
  await requirePosApiFeature({tenantId,branchId},"stock_management");
  const body=await request.json().catch(()=>null) as {
   request_id?:unknown;product_id?:unknown;branch_id?:unknown;size?:unknown
  }|null;
  const productId=typeof body?.product_id==="string"?body.product_id:"";
  if(!UUID.test(String(body?.request_id??""))||!UUID.test(productId))
   return fail("invalid_recycling_barcode_request","Valid product and request UUIDs required.",422);
  const requestedSize = body?.size ?? "small";
  if(typeof requestedSize!=="string"||!RECYCLING_BARCODE_LABEL_SIZES.includes(requestedSize as RecyclingBarcodeLabelSize))
   return fail("recycling_barcode_label_size_invalid","กรุณาเลือกขนาดฉลากบาร์โค้ดที่รองรับ",422);
  // A workstation may only print in its AUTHENTICATED branch.
  if(body?.branch_id!==branchId)return fail("recycling_barcode_branch_denied","กรุณาเข้าสู่เครื่อง POS ของสาขานี้ก่อนพิมพ์",403);
  const db=getSupabaseServiceClient();
  const [product,branch]=await Promise.all([
   db.from("products").select("id,sku,name,metadata").eq("id",productId)
    .eq("tenant_id",tenantId).eq("branch_id",branchId).eq("is_active",true)
    .is("deleted_at",null).maybeSingle(),
   db.from("branches").select("name").eq("tenant_id",tenantId).eq("id",branchId)
    .eq("is_active",true).maybeSingle()
  ]);
  if(product.error||branch.error)throw new Error("recycling_barcode_lookup_failed");
  if(!product.data||(product.data.metadata as Record<string,unknown>|null)?.business_mode!=="recycling")
   return fail("recycling_material_not_found","ไม่พบวัสดุ Recycling ในสาขาที่เข้าสู่ระบบ",404);
  if(!branch.data)return fail("recycling_branch_not_found","ไม่พบสาขาที่เปิดใช้งาน",404);
  const sku=String(product.data.sku??"").trim();
  const auth:AuthContext={
   userId:scope.session.user_id,tenantId,branchId,
   branchRole:["owner","manager","accountant"].includes(scope.session.role)
    ?scope.session.role as "owner"|"manager"|"accountant":"staff",
   platformRole:"tenant_user"
  };
  const jobs=await queueRoutedRecyclingBarcode({
   auth,runtimeDeviceCode:scope.session.device_code,
   requestId:String(body!.request_id),productId,
   sku,name:String(product.data.name??"วัสดุ"),branchName:String(branch.data.name??"สาขาหลัก"),
   size:requestedSize as RecyclingBarcodeLabelSize
  });
  return ok({queued:true,jobs});
 }catch(error){
  if(error instanceof PosGuardError||error instanceof FeatureGateError)
   return fail(error.code,error.message,error.status);
  const code=error instanceof Error?error.message:"recycling_barcode_print_failed";
  if(["recycling_barcode_printer_not_configured","recycling_barcode_device_scope_required",
     "recycling_barcode_paper_unsupported","recycling_barcode_too_wide_for_paper",
     "optical_barcode_invalid_text"].includes(code)){
   const description=code==="recycling_barcode_too_wide_for_paper"
    ?"รหัสยาวเกินสำหรับเครื่องพิมพ์ 58/80 มม. กรุณาใช้ SKU สั้นลงหรือเครื่องพิมพ์หน้ากว้าง"
    :code==="recycling_barcode_printer_not_configured"
    ?"ยังไม่ได้ตั้งค่าเครื่องพิมพ์ใบเสร็จในสาขานี้":code;
   return fail(code,description,422);
  }
  console.error("[recycling-barcode-print]",{code});
  return fail("recycling_barcode_print_failed","พิมพ์ฉลากบาร์โค้ดไม่สำเร็จ",500);
 }
}


/**
 * Read-only status for a single previously queued Recycling barcode label.
 * Scoped to the authenticated tenant/branch and deliberately returns no
 * printer payload, receipt content, customer data, or native bridge secrets.
 */
export async function GET(request:Request){
 try{
  const scope=await requirePosSession();
  requirePermission(scope,"inventory:view");
  const tenantId=scope.session.tenant_id,branchId=scope.session.branch_id;
  if(!await isAuthorizedRecyclingTenant(tenantId))
   return fail("recycling_not_authorized","CUSTOM Recycling entitlement required.",403);
  const jobId=new URL(request.url).searchParams.get("job_id")?.trim()??"";
  if(!UUID.test(jobId))
   return fail("recycling_print_job_id_invalid","Valid print job UUID required.",422);
  const db=getSupabaseServiceClient();
  const result=await db.from("print_jobs")
   .select("id,status,created_at,claimed_at,printed_at,failed_at,idempotency_key")
   .eq("id",jobId).eq("tenant_id",tenantId).eq("branch_id",branchId)
   .like("idempotency_key","recycling-barcode:%").maybeSingle();
  if(result.error)throw new Error("recycling_barcode_status_query_failed");
  const job=result.data;
  if(!job)return fail("recycling_print_job_not_found","ไม่พบงานพิมพ์บาร์โค้ดในสาขานี้",404);

  // A Windows POS tab can enqueue while the actual native Print Agent is
  // suspended or disconnected. Report only recent server-verified liveness.
  // This is informational; it must NEVER claim/retry a physical print.
  let agentOnline:boolean|null=null;
  if(["pending","retrying","printing"].includes(String(job.status)) &&
     scope.session.device_code){
   const agent=await db.from("print_agents").select("status,last_seen_at")
    .eq("tenant_id",tenantId).eq("branch_id",branchId)
    .eq("device_code",scope.session.device_code)
    .eq("agent_name","Windows Native POS · "+scope.session.device_code)
    .maybeSingle();
   if(!agent.error){
    const seenAt=Date.parse(String(agent.data?.last_seen_at??""));
    agentOnline=Boolean(agent.data?.status==="active" &&
     Number.isFinite(seenAt) && Date.now()-seenAt>=0 && Date.now()-seenAt<45_000);
   }
  }
  return ok({job:{id:job.id,status:job.status,created_at:job.created_at,
   claimed_at:job.claimed_at,printed_at:job.printed_at,failed_at:job.failed_at},
   agent_online:agentOnline,printed_means:"windows_spool_acknowledged_not_physical"});
 }catch(error){
  if(error instanceof PosGuardError||error instanceof FeatureGateError)
   return fail(error.code,error.message,error.status);
  console.warn("[recycling-barcode-status]",{
   code:error instanceof Error?error.message:"status_unavailable"
  });
  return fail("recycling_barcode_status_unavailable","ตรวจสอบคิวพิมพ์ไม่สำเร็จ กรุณาตรวจเครื่องพิมพ์ก่อนสั่งซ้ำ",503);
 }
}
