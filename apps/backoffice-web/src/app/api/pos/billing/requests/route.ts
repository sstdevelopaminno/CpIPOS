import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { PosGuardError, requirePosSession } from "@/lib/pos-session-guard";
import { loadPosSubscriptionCenter, SUBSCRIPTION_SLIP_BUCKET } from "@/lib/services/pos-subscription-center-service";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";
import { dispatchSupportPush } from "@/lib/services/support-chat/support-push";
import { scanSubscriptionSlip, type SubscriptionSlipScanResult } from "@/lib/payments/subscription-slip-ai";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SLIP = 4 * 1024 * 1024;
const FILE_TYPES: Record<string,string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"
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
    if (!["renewal_intent","payment_notice","custom_quote_request","ai_addon_payment"].includes(kind)) {
      return fail("invalid_kind","Select a valid subscription request.",422);
    }
    const desiredPackage = str(form.get("package_id"),50);
    const billingInterval = str(form.get("billing_interval"),12);
    const isAiAddon = kind === "ai_addon_payment";
    const isPayment = kind === "payment_notice" || isAiAddon;
    if (!["monthly","yearly"].includes(billingInterval)) return fail("invalid_interval","Choose a billing interval.",422);

    const db = getPrimarySupabaseServiceClient();
    type PendingRequest = {id:string;tenant_id:string;status:string;requested_package_id:string|null;
      amount_reported:number|null;evidence_url:string|null;metadata:Record<string,unknown>|null};
    const idempotent = await db.from("tenant_subscription_payment_requests")
      .select("id,tenant_id,status,requested_package_id,amount_reported,evidence_url,metadata")
      .eq("id",requestKey).maybeSingle<PendingRequest>();
    if (idempotent.error) throw new Error("Unable to check existing subscription request.");
    const existingById = idempotent.data;
    if (existingById?.tenant_id && existingById.tenant_id !== scope.session.tenant_id) {
      return fail("request_conflict","Request identifier conflicts with another store.",409);
    }
    const upgradingRenewal = Boolean(existingById && kind==="payment_notice" &&
      ["pending","under_review"].includes(existingById.status) &&
      existingById.metadata?.kind==="renewal_intent" && !existingById.evidence_url);
    const completingItPreparedPayment = Boolean(existingById && kind==="payment_notice" &&
      ["pending","under_review"].includes(existingById.status) &&
      existingById.metadata?.kind==="payment_notice" &&
      (existingById.metadata?.source==="it_tenant_control" ||
       existingById.metadata?.source==="it_custom_agreement") &&
      !existingById.evidence_url && existingById.amount_reported == null);
    const upgrading = upgradingRenewal || completingItPreparedPayment;
    if (existingById && !upgrading) {
      return ok({ id:existingById.id, status:existingById.status, already_submitted:true });
    }

    const snapshot = await loadPosSubscriptionCenter(scope.session.tenant_id);
    if (snapshot.contract.is_internal_demo) return fail("internal_demo","Internal demo stores are not charged for subscriptions.",422);
    const target = snapshot.packages.find(item=>item.id===desiredPackage);
    if (!target) return fail("package_unavailable","Choose an available subscription package.",422);
    const isCustomTarget = target.contact_sales === true || target.quota_mode === "custom" || target.code === "custom";
    if (isAiAddon) {
      if (target.id !== snapshot.contract.package_id) {
        return fail("ai_addon_current_package_required","AI Add-on must match the store's current package.",422);
      }
      if (!target.ai_addon_available || !target.ai_addon_monthly_price || target.ai_addon_monthly_price <= 0) {
        return fail("ai_addon_unavailable","This package does not have an AI Add-on configured by IT.",422);
      }
      if (!target.ai_addon_monthly_requests && !target.ai_addon_monthly_tokens && !target.ai_addon_monthly_cost_usd) {
        return fail("ai_addon_quota_missing","IT has not configured quota for this AI Add-on.",422);
      }
    }
    if (!isAiAddon && kind === "custom_quote_request" && !isCustomTarget) {
      return fail("custom_package_required","CUSTOM request can only target the CUSTOM package.",422);
    }
    if (!isAiAddon && isCustomTarget && kind === "renewal_intent") {
      return fail("custom_requires_it_agreement","CUSTOM must be requested first so IT can agree the price and limits.",422);
    }
    if (!isAiAddon && isCustomTarget && kind === "payment_notice" && !completingItPreparedPayment) {
      return fail("custom_requires_it_agreement","Wait for IT to approve the CUSTOM terms before sending payment evidence.",409);
    }
    if (!isAiAddon && kind !== "custom_quote_request" && billingInterval === "yearly" && !target.yearly_price &&
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
      return fail("renewal_selection_locked","Use the package and interval from your pending request.",409);
    }

    const expected = isAiAddon
      ? target.ai_addon_monthly_price
      : kind === "custom_quote_request"
        ? null
        : target.id===snapshot.contract.package_id && billingInterval === snapshot.contract.billing_interval
          ? snapshot.contract.amount_per_cycle
          : billingInterval==="yearly" ? target.yearly_price : target.monthly_price;
    if (isPayment && !snapshot.issuer.account_number && !snapshot.issuer.promptpay_id) {
      return fail("receiving_account_not_configured","Company receiving account is not configured. Contact Support.",422);
    }

    const note = str(form.get("note"),500);
    const expectedForScanRaw = upgrading ? existingById?.metadata?.expected_amount ?? expected : expected;
    const expectedForScan = expectedForScanRaw == null || !Number.isFinite(Number(expectedForScanRaw))
      ? null
      : Number(expectedForScanRaw);

    const evidence = form.get("slip");
    let filePath: string | null = null;
    let fileBuffer: Buffer | null = null;
    let fileMime: "image/jpeg" | "image/png" | "image/webp" | null = null;
    let slipScan: SubscriptionSlipScanResult | null = null;
    if (isPayment) {
      if (!(evidence instanceof File) || evidence.size<=0 || evidence.size>MAX_SLIP || !FILE_TYPES[evidence.type]) {
        return fail("slip_required","แนบสลิป JPG, PNG หรือ WebP ขนาดไม่เกิน 4 MB",422);
      }
      fileBuffer=Buffer.from(await evidence.arrayBuffer());
      const detectedMime=actualMime(fileBuffer);
      if (!detectedMime || detectedMime !== evidence.type || !FILE_TYPES[detectedMime]) {
        return fail("slip_type_invalid","ไฟล์สลิปไม่ตรงกับชนิดไฟล์ที่ระบุ",422);
      }
      fileMime = detectedMime as "image/jpeg" | "image/png" | "image/webp";
      filePath = scope.session.tenant_id + "/" + requestKey + "/slip." + FILE_TYPES[fileMime];
      slipScan = await scanSubscriptionSlip({
        buffer: fileBuffer,
        mimeType: fileMime,
        expectedAmount: expectedForScan,
        expectedPayeeName: snapshot.issuer.account_name || snapshot.issuer.name || "",
        expectedAccountNumber: snapshot.issuer.account_number || "",
        expectedPromptPayId: snapshot.issuer.promptpay_id || ""
      });
    }

    const amountReported = isPayment && slipScan?.parsed.amount != null
      && Number.isFinite(slipScan.parsed.amount) && slipScan.parsed.amount > 0
      && slipScan.parsed.amount <= 10_000_000
      ? Math.round(slipScan.parsed.amount * 100) / 100
      : null;

    if (filePath && fileBuffer && fileMime) {
      const upload=await db.storage.from(SUBSCRIPTION_SLIP_BUCKET).upload(filePath,fileBuffer,{
        contentType:fileMime,cacheControl:"0",upsert:false
      });
      if (upload.error) {
        console.error("[pos-subscription] evidence upload failed",upload.error.message);
        return fail("slip_upload_failed","Unable to store your slip securely. Please try again.",503);
      }
    }

    const type = isAiAddon ? "ai_addon_purchase"
      : !snapshot.contract.package_id ? "new_subscription"
      : snapshot.contract.status==="trial" ? "trial_conversion"
      : snapshot.contract.package_id!==target.id ? "package_change" : "renewal";
    const metadata = {
      ...(upgrading ? existingById?.metadata ?? {} : {}),
      kind,
      billing_interval: isAiAddon || kind === "custom_quote_request" ? "monthly" : billingInterval,
      expected_amount: kind === "custom_quote_request"
        ? null
        : upgrading ? existingById?.metadata?.expected_amount ?? expected : expected,
      ai_addon_code: isAiAddon ? `${target.code}-ai-addon` : null,
      ai_addon_name: isAiAddon ? `CpiPOS AI Add-on · ${target.name}` : null,
      ai_addon_requests: isAiAddon ? target.ai_addon_monthly_requests : null,
      ai_addon_tokens: isAiAddon ? target.ai_addon_monthly_tokens : null,
      ai_addon_cost_usd: isAiAddon ? target.ai_addon_monthly_cost_usd : null,
      source:"pos_subscription_center",
      submitted_by:scope.session.user_id,
      payer_name:kind === "custom_quote_request" ? "" : slipScan?.parsed.payer_name ?? "",
      transfer_reference:kind === "custom_quote_request" ? "" :
        slipScan?.parsed.reference_no ?? slipScan?.parsed.transaction_id ?? "",
      transfer_at:kind === "custom_quote_request" ? "" : slipScan?.parsed.transfer_datetime ?? "",
      slip_ai: isPayment && slipScan ? {
        version: "subscription-slip-ai-v1",
        status: slipScan.status,
        model: slipScan.model,
        parsed: slipScan.parsed,
        checks: slipScan.checks,
        error_message: slipScan.error_message
      } : null,
      note:kind === "custom_quote_request" ? "CUSTOM package request" : note
    };
    const inserted = upgrading
      ? await db.from("tenant_subscription_payment_requests").update({
          amount_reported:amountReported,evidence_url:filePath,metadata,updated_at:new Date().toISOString()
        }).eq("id",requestKey).eq("tenant_id",scope.session.tenant_id)
          .eq("requested_package_id",target.id).in("status",["pending","under_review"])
          .is("evidence_url",null)
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
      action:isAiAddon
        ? "ai_addon_payment_reported"
        : kind==="payment_notice"
          ? "subscription_payment_reported"
          : kind==="custom_quote_request"
          ? "subscription_custom_package_requested"
          : "subscription_renewal_requested",
      targetTable:"tenant_subscription_payment_requests",targetId:inserted.data.id,module:"subscription",
      metadata:{
        kind,
        requested_package_id:target.id,
        billing_interval:isAiAddon || kind === "custom_quote_request" ? "monthly" : billingInterval,
        has_evidence:Boolean(filePath),
        slip_ai_status: slipScan?.status ?? null,
        slip_ai_amount_match: slipScan?.checks.amount_match ?? null,
        slip_ai_payee_match: slipScan?.checks.payee_match ?? null,
        slip_ai_confidence: slipScan?.parsed.confidence ?? null
      }
    });
    await dispatchSupportPush({
      audience: "it",
      kind: "request",
      title: `คำขอใหม่ · ${snapshot.store.name}`,
      body: isAiAddon
        ? "ลูกค้าแจ้งชำระ CpiPOS AI Add-on"
        : kind === "payment_notice"
          ? "ลูกค้าแจ้งชำระเงินแพ็กเกจ"
          : kind === "custom_quote_request"
          ? "ลูกค้าส่งคำขอแพ็กเกจ CUSTOM"
          : "ลูกค้าส่งคำขอต่ออายุแพ็กเกจ",
      url: "/it-admin/requests",
      tag: `subscription-request:${inserted.data.id}`
    }).catch(() => null);
    return ok({
      id:inserted.data.id,
      status:inserted.data.status,
      already_submitted:false,
      upgraded:Boolean(upgrading),
      slip_scan: slipScan ? {
        status: slipScan.status,
        parsed: slipScan.parsed,
        checks: slipScan.checks
      } : null
    });
  } catch (error) {
    if (error instanceof PosGuardError) return fail(error.code,error.message,error.status);
    console.error("[pos-subscription] request failed",error);
    return fail("subscription_request_failed","Unable to submit the subscription request.",503);
  }
}
