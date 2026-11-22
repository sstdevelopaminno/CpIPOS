import { fail, ok } from "@/lib/http";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { requirePosSession } from "@/lib/pos-session-guard";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import { validateManagerPin } from "@/lib/pin-approval";
import { appendAuditLog } from "@/lib/audit-log";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function scopeForInvoice(){
  const auth=await getPosApiAuthContext({
    requireBranchScope:true,requiredPermission:"receipts:view"
  });
  const scope=await requirePosSession();
  if(!auth.tenantId||!auth.branchId||
    auth.tenantId!==scope.session.tenant_id||
    auth.branchId!==scope.session.branch_id||
    !await isAuthorizedRecyclingTenant(auth.tenantId)) {
    throw new Error("recycling_tax_scope_denied");
  }
  return {auth,scope};
}

export async function GET(request:Request){
  try{
    const {auth}=await scopeForInvoice();
    const txId=new URL(request.url).searchParams.get("transaction_id")??"";
    if(!UUID.test(txId))return fail("recycling_tax_document_invalid","เลขที่เอกสารไม่ถูกต้อง",422);
    const db=getSupabaseServiceClient();
    const [tx,existing,issuer]=await Promise.all([
      db.from("recycling_transactions")
        .select("id,receipt_no,direction,status,created_at,counterparty_name,total_minor,base_minor,vat_minor,tax_state,tax_snapshot")
        .eq("tenant_id",auth.tenantId!).eq("branch_id",auth.branchId!).eq("id",txId).maybeSingle(),
      db.from("recycling_tax_invoices")
        .select("id,invoice_no,profile_id,issued_at,buyer_snapshot,seller_snapshot,tax_snapshot")
        .eq("tenant_id",auth.tenantId!).eq("branch_id",auth.branchId!)
        .eq("transaction_id",txId).maybeSingle(),
      db.from("recycling_vat_issuers")
        .select("active,verified_at,verified_from,verified_until")
        .eq("tenant_id",auth.tenantId!).eq("branch_id",auth.branchId!).maybeSingle()
    ]);
    if(tx.error||existing.error||issuer.error)return fail(
      "recycling_tax_schema_not_ready","ยังไม่ได้ติดตั้งโครงสร้างใบกำกับภาษี Recycling",503);
    if(!tx.data||tx.data.direction!=="sell")return fail(
      "recycling_tax_sale_not_found","ไม่พบรายการขายออกในสาขาที่ใช้งาน",404);
    const today=new Intl.DateTimeFormat("en-CA",{
      timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit"
    }).format(new Date());
    const reg=issuer.data;
    const sellerVerified=Boolean(reg?.active&&reg.verified_at&&reg.verified_from<=today&&
      (!reg.verified_until||reg.verified_until>=today));
    return ok({
      transaction:tx.data,invoice:existing.data,
      issuing_enabled:process.env.RECYCLING_TAX_INVOICES_ENABLED==="1",
      seller_verified:sellerVerified,
      eligible:tx.data.status==="posted"&&tx.data.tax_state==="vat_recorded" &&
        tx.data.base_minor!==null&&tx.data.vat_minor!==null
    });
  }catch{
    return fail("recycling_tax_scope_denied","ไม่สามารถดูเอกสารภาษีของสาขานี้",403);
  }
}

export async function POST(request:Request){
  try{
    const {auth}=await scopeForInvoice();
    // A production environment variable alone does not authorize VAT issuance:
    // the RPC separately verifies immutable tax data and registration evidence.
    if(process.env.RECYCLING_TAX_INVOICES_ENABLED!=="1"){
      return fail("recycling_tax_issuance_disabled",
        "ยังไม่เปิดให้สร้างใบกำกับภาษี Recycling จนกว่าการทดสอบ VAT และหลักฐานทะเบียนภาษีจะผ่าน",503);
    }
    const raw=await request.json().catch(()=>null) as Record<string,unknown>|null;
    const transactionId=typeof raw?.transaction_id==="string"?raw.transaction_id:"";
    const profileId=typeof raw?.profile_id==="string"?raw.profile_id:"";
    const pin=typeof raw?.manager_pin==="string"?raw.manager_pin:"";
    const buyerBranchNo=typeof raw?.buyer_branch_no==="string"?raw.buyer_branch_no.trim():"";
    if(!UUID.test(transactionId)||!UUID.test(profileId)||pin.length<4||pin.length>30||
      !/^[0-9]{5}$/.test(buyerBranchNo)){
      return fail("recycling_tax_input_invalid",
        "กรุณาเลือกรายการขายออก ผู้ซื้อ และกรอก PIN ของ Owner/Manager",422);
    }
    const approval=await validateManagerPin("sales_record_edit",pin,{
      tenantId:auth.tenantId!,branchId:auth.branchId!
    });
    if(!approval.approved||!approval.approverUserId||!approval.approverRole||
      approval.approverRole==="it_admin"){
      return fail("recycling_tax_manager_approval_denied","PIN Owner/Manager ไม่ถูกต้อง",403);
    }
    const db=getSupabaseServiceClient();
    const {data,error}=await db.rpc("recycling_issue_tax_invoice",{
      p_tenant_id:auth.tenantId,
      p_branch_id:auth.branchId,
      p_transaction_id:transactionId,
      p_profile_id:profileId,
      p_issued_by:approval.approverUserId,
      p_buyer_branch_no:buyerBranchNo
    });
    if(error){
      const codes=[
        "recycling_vat_registration_not_verified",
        "recycling_tax_transaction_not_eligible",
        "recycling_tax_buyer_profile_invalid",
        "recycling_tax_invoice_already_issued_to_other_buyer",
        "recycling_tax_seller_changed_requires_review",
        "recycling_tax_items_total_mismatch",
        "recycling_tax_issuer_role_denied",
        "recycling_tax_buyer_branch_required",
        "recycling_tax_invoice_late_issue_requires_accountant_review"
      ];
      const code=codes.find(c=>error.message.includes(c));
      return fail(code??"recycling_tax_issue_failed",
        code?({
          recycling_vat_registration_not_verified:"ร้านค้ายังไม่มีหลักฐานยืนยันการจดทะเบียน VAT ที่ผ่านการตรวจ",
          recycling_tax_transaction_not_eligible:"บิลนี้ยังไม่มี VAT ที่บันทึกจริงหรือถูกยกเลิกแล้ว",
          recycling_tax_buyer_profile_invalid:"ข้อมูลชื่อ ที่อยู่ หรือเลขผู้เสียภาษีของผู้ซื้อไม่ครบ",
          recycling_tax_invoice_already_issued_to_other_buyer:"บิลนี้ออกใบกำกับภาษีให้ผู้ซื้อรายอื่นแล้ว",
          recycling_tax_seller_changed_requires_review:"ข้อมูลผู้ขายหรือทะเบียน VAT เปลี่ยน ต้องให้ฝ่ายบัญชีตรวจสอบ",
          recycling_tax_items_total_mismatch:"ยอดรายการสินค้าไม่ตรงกับฐาน VAT",
          recycling_tax_issuer_role_denied:"ผู้อนุมัติไม่มีสิทธิ์ในสาขา",
          recycling_tax_buyer_branch_required:"กรุณาระบุเลขสาขาผู้ซื้อให้ถูกต้อง 5 หลัก",
          recycling_tax_invoice_late_issue_requires_accountant_review:"ต้องให้ฝ่ายบัญชีตรวจสอบการออกใบกำกับภาษีย้อนหลัง"
        } as Record<string,string>)[code]:"ไม่สามารถออกใบกำกับภาษีได้ กรุณาติดต่อฝ่ายบัญชี",409);
    }
    try{
      await appendAuditLog({
        tenantId:auth.tenantId!,branchId:auth.branchId!,
        actorUserId:approval.approverUserId,
        actorRole:approval.approverRole,
        action:"recycling_tax_invoice_issued",
        targetTable:"recycling_tax_invoices",
        targetId:String(data?.id??""),
        metadata:{transaction_id:transactionId,invoice_no:String(data?.invoice_no??""),
          idempotent:data?.idempotent===true,requested_by:auth.userId}
      });
    }catch(error){
      // Database issuance is already committed; return the SAME immutable ID
      // on replay. Never retry by making a second invoice.
      console.error("[recycling-tax] invoice issued; audit log unavailable",{
        code:error instanceof Error?error.name:"audit_error"
      });
    }
    return ok({invoice:data});
  }catch(error){
    console.error("[recycling-tax] request rejected",{
      code:error instanceof Error?error.name:"request_error"
    });
    return fail("recycling_tax_issue_failed","ไม่สามารถยืนยันการออกใบกำกับภาษี",403);
  }
}
