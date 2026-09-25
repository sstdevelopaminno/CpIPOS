import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { PosGuardError, requirePosSession } from "@/lib/pos-session-guard";
import { loadPosSubscriptionCenter, SUBSCRIPTION_SLIP_BUCKET } from "@/lib/services/pos-subscription-center-service";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SLIP = 4 * 1024 * 1024;
const FILE_TYPES: Record<string,string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf"
};

function str(value: FormDataEntryValue | null, max: number): string {
  return typeof value === "string" ? value.trim().slice(0,max) : "";
}
function actualMime(buffer: Buffer): string | null {
  if (buffer.length >= 4 && buffer.subarray(0,4).toString("ascii") === "%PDF") return "application/pdf";
  if (buffer.length >= 8 && buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png";
  if (buffer.length >= 3 && buffer[0]===255 && buffer[1]===216 && buffer[2]===255) return "image/jpeg";
  if (buffer.length >= 12 && buffer.subarray(0,4).toString("ascii")==="RIFF"
    && buffer.subarray(8,12).toString("ascii")==="WEBP") return "image/webp";
  return null;
}

export async function POST(request: Request) {
  try {
    const scope = await requirePosSession();
    if (scope.session.role !== "owner") {
      return fail("owner_required","Only the store owner can submit subscription requests.",403);
    }
    const length = Number(request.headers.get("content-length") || 0);
    if (length > MAX_SLIP + 12000) return fail("upload_too_large","Evidence must be no larger than 4 MB.",413);
    const form = await request.formData().catch(() => null);
    if (!form) return fail("invalid_form","Unable to read renewal request.",422);
    const requestKey = str(form.get("request_key"),40);
    if (!UUID.test(requestKey)) return fail("request_key_invalid","A valid request identifier is required.",422);
    const kind = str(form.get("kind"),24);
    if (kind !== "renewal_intent" && kind !== "payment_notice") {
      return fail("invalid_kind","Select renewal or payment notification.",422);
    }
    const desiredPackage = str(form.get("package_id"),50);
    const billingInterval = str(form.get("billing_interval"),12);
    if (!["monthly","yearly"].includes(billingInterval)) return fail("invalid_interval","Choose a billing interval.",422);

    const db = getPrimarySupabaseServiceClient();
    type PendingRequest = {id:string;tenant_id:string;status:string;requested_package_id:string|null;
      evidence_url:string|null;metadata:Record<string,unknown>|null};
    const idempotent = await db.from("tenant_subscription_payment_requests")
      .select("id,tenant_id,status,requested_package_id,evidence_url,metadata")
      .eq("id",requestKey).maybeSingle<PendingRequest>();
    if (idempotent.error) throw new Error("Unable to check existing subscription request.");
    const existingById = idempotent.data;
    if (existingById?.tenant_id && existingById.tenant_id !== scope.session.tenant_id) {
      return fail("request_conflict","Request identifier conflicts with another store.",409);
    }
    const upgrading = Boolean(existingById && kind==="payment_notice" &&
      ["pending","under_review"].includes(existingById.status) &&
      existingById.metadata?.kind==="renewal_intent" && !existingById.evidence_url);
    if (existingById && !upgrading) {
      return ok({ id:existingById.id, status:existingById.status, already_submitted:true });
    }

    const snapshot = await loadPosSubscriptionCenter(scope.session.tenant_id);
    if (snapshot.contract.is_internal_demo) return fail("internal_demo","Internal demo stores are not charged for subscriptions.",422);
    const target = snapshot.packages.find(item=>item.id===desiredPackage);
    if (!target) return fail("package_unavailable","Choose an available subscription package.",422);
    if (billingInterval === "yearly" && !target.yearly_price &&
      !(target.id === snapshot.contract.package_id && snapshot.contract.billing_interval === "yearly" && snapshot.contract.amount_per_cycle)) {
      return fail("yearly_unavailable","Annual price is not configured for this package.",422);
    }

    const existing = await db.from("tenant_subscription_payment_requests").select("id")
      .eq("tenant_id",scope.session.tenant_id).in("status",["pending","under_review"])
      .limit(1).maybeSingle<{id:string}>();
    if (existing.error) throw new Error("Unable to check open requests.");
    if (existing.data && (!upgrading || existing.data.id!==requestKey)) {
      return fail("open_request_exists","This store already has an open subscription request.",409);
    }
    if (upgrading && (existingById?.requested_package_id!==target.id ||
      existingById.metadata?.billing_interval!==billingInterval)) {
      return fail("renewal_selection_locked","Use the package and interval from your pending renewal request.",409);
    }

    const expected = target.id===snapshot.contract.package_id && billingInterval === snapshot.contract.billing_interval
      ? snapshot.contract.amount_per_cycle
      : billingInterval==="yearly" ? target.yearly_price : target.monthly_price;
    const amountText = str(form.get("amount_reported"),32);
    const amountReported = kind === "payment_notice" ? Number(amountText) : null;
    if (kind === "payment_notice" && (!/^\d+(?:\.\d{1,2})?$/.test(amountText)
      || amountReported === null || !Number.isFinite(amountReported) || amountReported <= 0 || amountReported > 10_000_000)) {
      return fail("amount_invalid","Enter the actual transfer amount, up to two decimal places.",422);
    }
    if (kind === "payment_notice" && !snapshot.issuer.account_number && !snapshot.issuer.promptpay_id) {
      return fail("receiving_account_not_configured","Company receiving account is not configured. Contact Support.",422);
    }

    const transferReference = str(form.get("transfer_reference"),120);
    const payerName = str(form.get("payer_name"),160);
    const transferAt = str(form.get("transfer_at"),32);
    const note = str(form.get("note"),500);
    if (kind === "payment_notice" && !payerName) {
      return fail("payer_name_required","Enter the name used for the transfer.",422);
    }
    if (kind === "payment_notice") {
      const parsedTransfer = Date.parse(transferAt + "+07:00");
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(transferAt)
        || !Number.isFinite(parsedTransfer)
        || parsedTransfer > Date.now() + 60 * 60 * 1000
        || parsedTransfer < Date.now() - 2 * 365 * 24 * 60 * 60 * 1000) {
        return fail("transfer_time_invalid","Check the transfer date and time (Thailand time).",422);
      }
    }

    const evidence = form.get("slip");
    let filePath: string | null = null;
    let fileBuffer: Buffer | null = null;
    let fileMime: string | null = null;
    if (kind === "payment_notice") {
      if (!(evidence instanceof File) || evidence.size<=0 || evidence.size>MAX_SLIP || !FILE_TYPES[evidence.type]) {
        return fail("slip_required","Attach a JPG, PNG, WebP or PDF slip up to 4 MB.",422);
      }
      fileBuffer=Buffer.from(await evidence.arrayBuffer());
      fileMime=actualMime(fileBuffer);
      if (!fileMime || fileMime !== evidence.type) {
        return fail("slip_type_invalid","The evidence file does not match its claimed type.",422);
      }
      filePath = scope.session.tenant_id + "/" + requestKey + "/slip." + FILE_TYPES[fileMime];
    }

    if (filePath && fileBuffer && fileMime) {
      const upload=await db.storage.from(SUBSCRIPTION_SLIP_BUCKET).upload(filePath,fileBuffer,{
        contentType:fileMime,cacheControl:"0",upsert:false
      });
      if (upload.error) {
        console.error("[pos-subscription] evidence upload failed",upload.error.message);
        return fail("slip_upload_failed","Unable to store your slip securely. Please try again.",503);
      }
    }

    const type = !snapshot.contract.package_id ? "new_subscription"
      : snapshot.contract.status==="trial" ? "trial_conversion"
      : snapshot.contract.package_id!==target.id ? "package_change" : "renewal";
    const metadata = {
      ...(upgrading ? existingById?.metadata ?? {} : {}),
      kind,billing_interval:billingInterval,
      expected_amount:upgrading ? existingById?.metadata?.expected_amount ?? expected : expected,
      source:"pos_subscription_center",
      submitted_by:scope.session.user_id,payer_name:payerName,transfer_reference:transferReference,
      transfer_at:transferAt,note
    };
    const inserted = upgrading
      ? await db.from("tenant_subscription_payment_requests").update({
          amount_reported:amountReported,evidence_url:filePath,metadata,updated_at:new Date().toISOString()
        }).eq("id",requestKey).eq("tenant_id",scope.session.tenant_id).in("status",["pending","under_review"])
          .is("evidence_url",null).contains("metadata",{kind:"renewal_intent"})
          .select("id,status").maybeSingle<{id:string;status:string}>()
      : await db.from("tenant_subscription_payment_requests").insert({
          id:requestKey,tenant_id:scope.session.tenant_id,requested_package_id:target.id,
          request_type:type,amount_reported:amountReported,status:"pending",currency:"THB",
          evidence_url:filePath,metadata
        }).select("id,status").maybeSingle<{id:string;status:string}>();
    if (inserted.error || !inserted.data) {
      if (filePath) await db.storage.from(SUBSCRIPTION_SLIP_BUCKET).remove([filePath]);
      if (inserted.error?.code==="23505") return fail("open_request_exists","Another subscription request is already open.",409);
      throw new Error("Unable to save subscription request.");
    }
    await appendAuditLog({
      tenantId:scope.session.tenant_id,actorUserId:scope.session.user_id,actorRole:"owner",
      action:kind==="payment_notice"?"subscription_payment_reported":"subscription_renewal_requested",
      targetTable:"tenant_subscription_payment_requests",targetId:inserted.data.id,module:"subscription",
      metadata:{kind,requested_package_id:target.id,billing_interval:billingInterval,has_evidence:Boolean(filePath)}
    });
    return ok({id:inserted.data.id,status:inserted.data.status,already_submitted:false,upgraded:Boolean(upgrading)});
  } catch (error) {
    if (error instanceof PosGuardError) return fail(error.code,error.message,error.status);
    console.error("[pos-subscription] request failed",error);
    return fail("subscription_request_failed","Unable to submit the subscription request.",503);
  }
}
