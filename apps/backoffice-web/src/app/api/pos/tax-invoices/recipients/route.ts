import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { fail, ok } from "@/lib/http";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

const ENTITY_TYPES = new Set(["company", "partnership", "store", "individual"]);
type RecipientPayload = { entity_type?: string; display_name?: string; tax_id?: string; address_line?: string; subdistrict?: string; district?: string; province?: string; postal_code?: string };
type RecipientRow = { id:string; entity_type:string; display_name:string; tax_id:string; address_line:string; subdistrict:string; district:string; province:string; postal_code:string; is_active:boolean; created_at:string; updated_at:string };

function clean(value: unknown, max = 250) { return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max); }
function normalizeTaxId(value: unknown) { return String(value ?? "").replace(/\D/g, "").slice(0, 13); }
function normalizePostcode(value: unknown) { return String(value ?? "").replace(/\D/g, "").slice(0, 5); }
async function requireScope() { const auth = await getPosApiAuthContext({ requireBranchScope:true, requiredPermission:"receipts:view" }); await requirePosApiFeature(auth,"core_pos_sales"); return auth; }

export async function GET(request: Request) {
  try {
    const auth = await requireScope();
    const q = clean(new URL(request.url).searchParams.get("q"), 100).toLowerCase();
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase.from("pos_tax_recipients").select("id,entity_type,display_name,tax_id,address_line,subdistrict,district,province,postal_code,is_active,created_at,updated_at").eq("tenant_id",auth.tenantId!).eq("branch_id",auth.branchId!).eq("is_active",true).order("updated_at",{ascending:false}).limit(300).returns<RecipientRow[]>();
    if (error) return fail("tax_recipient_query_failed",error.message,500);
    let recipients = data ?? [];
    if (q) recipients = recipients.filter((row)=>`${row.display_name} ${row.tax_id} ${row.address_line} ${row.subdistrict} ${row.district} ${row.province} ${row.postal_code}`.toLowerCase().includes(q));
    const ids = recipients.map((row)=>row.id);
    const counts = new Map<string,{count:number;last:string|null}>();
    if (ids.length) {
      const invoices = await supabase.from("pos_tax_invoices").select("recipient_id,issued_at,status").eq("tenant_id",auth.tenantId!).eq("branch_id",auth.branchId!).in("recipient_id",ids).neq("status","voided").order("issued_at",{ascending:false}).returns<Array<{recipient_id:string;issued_at:string;status:string}>>();
      if (invoices.error) return fail("tax_invoice_query_failed",invoices.error.message,500);
      for (const row of invoices.data ?? []) { const current=counts.get(row.recipient_id)??{count:0,last:null}; current.count+=1; if(!current.last) current.last=row.issued_at; counts.set(row.recipient_id,current); }
    }
    return ok({ recipients: recipients.map((row)=>({ ...row, invoice_count:counts.get(row.id)?.count??0, last_issued_at:counts.get(row.id)?.last??null })) });
  } catch (error) { const featureError=featureGateFail(error); if(featureError)return featureError; return fail("unauthorized",error instanceof Error?error.message:"Authentication failed.",401); }
}

export async function POST(request: Request) {
  try {
    const auth = await requireScope();
    const payload=(await request.json().catch(()=>null)) as RecipientPayload|null;
    const entityType=clean(payload?.entity_type,30); const displayName=clean(payload?.display_name,180); const taxId=normalizeTaxId(payload?.tax_id); const addressLine=clean(payload?.address_line,300); const subdistrict=clean(payload?.subdistrict,120); const district=clean(payload?.district,120); const province=clean(payload?.province,120); const postalCode=normalizePostcode(payload?.postal_code);
    if(!ENTITY_TYPES.has(entityType)) return fail("invalid_tax_entity_type","กรุณาเลือกประเภทผู้เสียภาษี",422);
    if(!displayName) return fail("tax_recipient_name_required","กรุณากรอกชื่อสำหรับออกใบกำกับภาษี",422);
    if(!/^\d{13}$/.test(taxId)) return fail("invalid_tax_id","เลขผู้เสียภาษีต้องมี 13 หลัก",422);
    if(!addressLine||!subdistrict||!district||!province||!/^\d{5}$/.test(postalCode)) return fail("invalid_tax_address","กรุณากรอกที่อยู่และเลือกที่อยู่จากรหัสไปรษณีย์ให้ครบ",422);
    const supabase=getSupabaseServiceClient();
    const duplicate=await supabase.from("pos_tax_recipients").select("id,display_name").eq("tenant_id",auth.tenantId!).eq("branch_id",auth.branchId!).eq("tax_id",taxId).eq("is_active",true).limit(1).maybeSingle<{id:string;display_name:string}>();
    if(duplicate.error) return fail("tax_recipient_query_failed",duplicate.error.message,500);
    if(duplicate.data) return fail("tax_recipient_exists",`เลขผู้เสียภาษีนี้มีในระบบแล้ว: ${duplicate.data.display_name}`,409);
    const inserted=await supabase.from("pos_tax_recipients").insert({tenant_id:auth.tenantId!,branch_id:auth.branchId!,entity_type:entityType,display_name:displayName,tax_id:taxId,address_line:addressLine,subdistrict,district,province,postal_code:postalCode,is_active:true,created_by:auth.userId,updated_by:auth.userId}).select("id,entity_type,display_name,tax_id,address_line,subdistrict,district,province,postal_code,is_active,created_at,updated_at").single<RecipientRow>();
    if(inserted.error||!inserted.data) return fail("tax_recipient_create_failed",inserted.error?.message??"Failed to create tax recipient.",500);
    return ok({ recipient:inserted.data });
  } catch(error){const featureError=featureGateFail(error);if(featureError)return featureError;return fail("unauthorized",error instanceof Error?error.message:"Authentication failed.",401);}
}
