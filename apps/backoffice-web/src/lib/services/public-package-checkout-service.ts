import "server-only";

import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { appendAuditLog } from "@/lib/audit-log";
import { scanSubscriptionSlip, type SubscriptionSlipScanResult } from "@/lib/payments/subscription-slip-ai";
import { dispatchSupportPush } from "@/lib/services/support-chat/support-push";
import { loadPosSubscriptionCenter, SUBSCRIPTION_SLIP_BUCKET } from "@/lib/services/pos-subscription-center-service";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";
import { resolveTenantByStoreCode } from "@/lib/server/tenant-store-code";

const TOKEN_TTL_SECONDS = 15 * 60;
const MAX_SLIP = 4 * 1024 * 1024;
const FILE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

type CheckoutTokenPayload = {
  v: 1;
  tenant_id: string;
  actor_user_id: string;
  actor_role: "owner" | "manager";
  package_id: string;
  billing_interval: "monthly" | "yearly";
  expected_amount: number;
  issued_at: number;
  expires_at: number;
  nonce: string;
};

type RoleRow = {
  user_id: string;
  role: "owner" | "manager";
};

type UserRow = {
  id: string;
  pin_hash: string | null;
  is_active: boolean;
};

function money(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Number(n.toFixed(2)) : null;
}

function tokenSecret() {
  const raw = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!raw) throw new Error("public_checkout_secret_unavailable");
  return crypto.createHash("sha256").update("cpipos-public-package-checkout-v1|").update(raw).digest();
}

function signPayload(payload: CheckoutTokenPayload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", tokenSecret()).update(body).digest("base64url");
  return body + "." + signature;
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function verifyPublicCheckoutToken(token: string): CheckoutTokenPayload | null {
  const [body, signature] = String(token ?? "").split(".");
  if (!body || !signature) return null;
  const expected = crypto.createHmac("sha256", tokenSecret()).update(body).digest("base64url");
  if (!safeEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as CheckoutTokenPayload;
    if (payload.v !== 1 || !payload.tenant_id || !payload.actor_user_id || !payload.package_id) return null;
    if (payload.actor_role !== "owner" && payload.actor_role !== "manager") return null;
    if (payload.billing_interval !== "monthly" && payload.billing_interval !== "yearly") return null;
    if (!Number.isFinite(payload.expected_amount) || payload.expected_amount <= 0) return null;
    if (!Number.isFinite(payload.expires_at) || payload.expires_at <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function loadPublicPackageCatalog() {
  const db = getPrimarySupabaseServiceClient();
  const [packagesResult, aiResult] = await Promise.all([
    db.from("subscription_packages")
      .select("id,code,name,monthly_price,yearly_price,monthly_discount_percent,yearly_discount_percent,quota_mode,max_branches,max_devices,max_users,max_products,monthly_bill_limit,storage_limit_gb,retention_months,metadata")
      .eq("is_active", true)
      .order("display_order", { ascending: true })
      .limit(20),
    db.from("pos_ai_package_quotas")
      .select("package_id,is_enabled,monthly_request_limit")
  ]);
  if (packagesResult.error || aiResult.error) throw new Error("package_catalog_unavailable");
  const aiByPackage = new Map((aiResult.data ?? []).map((row: any) => [String(row.package_id), row]));

  const discounted = (base: unknown, discount: unknown) => {
    const value = Number(base ?? 0);
    const pct = Number(discount ?? 0);
    if (!Number.isFinite(value) || value <= 0) return null;
    const safePct = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
    return Number((value * (1 - safePct / 100)).toFixed(2));
  };
  const positive = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
  };

  return (packagesResult.data ?? []).map((row: any) => {
    const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
    const contactSales = row.code === "custom" || row.quota_mode === "custom" || metadata.contact_sales === true;
    const ai = aiByPackage.get(String(row.id)) as any;
    return {
      id: String(row.id),
      code: String(row.code),
      name: String(row.name),
      contact_sales: contactSales,
      monthly_price: contactSales ? null : discounted(row.monthly_price, row.monthly_discount_percent),
      yearly_price: contactSales ? null : discounted(row.yearly_price, row.yearly_discount_percent),
      max_branches: positive(row.max_branches),
      max_devices: positive(row.max_devices),
      max_users: positive(row.max_users),
      max_products: positive(row.max_products),
      monthly_bill_limit: positive(row.monthly_bill_limit),
      storage_limit_gb: money(row.storage_limit_gb),
      retention_months: positive(row.retention_months),
      sales_mode_limit: positive(metadata.sales_mode_limit),
      ai_included: ai?.is_enabled === true,
      ai_monthly_requests: positive(ai?.monthly_request_limit)
    };
  });
}

async function verifyTenantOwnerManagerPin(tenantId: string, pin: string) {
  const db = getPrimarySupabaseServiceClient();
  const rolesResult = await db.from("user_branch_roles")
    .select("user_id,role")
    .eq("tenant_id", tenantId)
    .in("role", ["owner", "manager"]);
  if (rolesResult.error) throw new Error("owner_manager_lookup_failed");

  const roleByUser = new Map<string, "owner" | "manager">();
  for (const row of (rolesResult.data ?? []) as RoleRow[]) {
    const existing = roleByUser.get(row.user_id);
    if (!existing || row.role === "owner") roleByUser.set(row.user_id, row.role);
  }
  const ids = [...roleByUser.keys()];
  if (!ids.length) return null;

  const usersResult = await db.from("users_profiles")
    .select("id,pin_hash,is_active")
    .in("id", ids)
    .eq("is_active", true);
  if (usersResult.error) throw new Error("owner_manager_lookup_failed");

  for (const user of (usersResult.data ?? []) as UserRow[]) {
    if (!user.pin_hash) continue;
    if (await bcrypt.compare(pin, user.pin_hash)) {
      return {
        userId: user.id,
        role: roleByUser.get(user.id) ?? "manager"
      };
    }
  }
  return null;
}

export async function authorizePublicPackageCheckout(input: {
  storeCode: string;
  pin: string;
  packageId: string;
  billingInterval: "monthly" | "yearly";
}) {
  const resolved = await resolveTenantByStoreCode(input.storeCode);
  if (!resolved || resolved.isActive === false) return null;

  const matched = await verifyTenantOwnerManagerPin(resolved.tenantId, input.pin);
  if (!matched) return null;

  const snapshot = await loadPosSubscriptionCenter(resolved.tenantId);
  if (snapshot.contract.is_internal_demo) throw new Error("internal_demo_not_billable");

  const target = snapshot.packages.find((row) => row.id === input.packageId);
  if (!target || target.contact_sales || target.quota_mode === "custom" || target.code === "custom") {
    throw new Error("package_unavailable");
  }

  const expected = input.billingInterval === "yearly" ? money(target.yearly_price) : money(target.monthly_price);
  if (!expected) throw new Error(input.billingInterval === "yearly" ? "yearly_unavailable" : "package_price_missing");
  if (!snapshot.issuer.account_number && !snapshot.issuer.promptpay_id) throw new Error("receiving_account_not_configured");

  const now = Math.floor(Date.now() / 1000);
  const payload: CheckoutTokenPayload = {
    v: 1,
    tenant_id: resolved.tenantId,
    actor_user_id: matched.userId,
    actor_role: matched.role,
    package_id: target.id,
    billing_interval: input.billingInterval,
    expected_amount: expected,
    issued_at: now,
    expires_at: now + TOKEN_TTL_SECONDS,
    nonce: crypto.randomUUID()
  };

  return {
    token: signPayload(payload),
    expires_in_seconds: TOKEN_TTL_SECONDS,
    store: {
      code: resolved.publicCode,
      name: snapshot.store.name
    },
    package: {
      id: target.id,
      code: target.code,
      name: target.name,
      billing_interval: input.billingInterval,
      amount: expected,
      currency: snapshot.contract.currency || "THB"
    },
    issuer: snapshot.issuer
  };
}

function actualMime(buffer: Buffer): string | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return "image/jpeg";
  if (buffer.length >= 12 && buffer.subarray(0,4).toString("ascii") === "RIFF" && buffer.subarray(8,12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export async function submitPublicPackageCheckout(input: {
  token: string;
  slip: File;
  note: string;
}) {
  const payload = verifyPublicCheckoutToken(input.token);
  if (!payload) throw new Error("checkout_token_invalid");

  const snapshot = await loadPosSubscriptionCenter(payload.tenant_id);
  const target = snapshot.packages.find((row) => row.id === payload.package_id);
  if (!target || target.contact_sales || target.code === "custom") throw new Error("package_unavailable");

  const currentAmount = payload.billing_interval === "yearly" ? money(target.yearly_price) : money(target.monthly_price);
  if (!currentAmount || Math.abs(currentAmount - payload.expected_amount) > 0.009) throw new Error("package_price_changed");
  if (!snapshot.issuer.account_number && !snapshot.issuer.promptpay_id) throw new Error("receiving_account_not_configured");

  const db = getPrimarySupabaseServiceClient();
  const open = await db.from("tenant_subscription_payment_requests")
    .select("id")
    .eq("tenant_id", payload.tenant_id)
    .in("status", ["pending", "under_review"])
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (open.error) throw new Error("open_request_lookup_failed");
  if (open.data) throw new Error("open_request_exists");

  const evidence = input.slip;
  if (!(evidence instanceof File) || evidence.size <= 0 || evidence.size > MAX_SLIP || !FILE_TYPES[evidence.type]) {
    throw new Error("slip_required");
  }
  const buffer = Buffer.from(await evidence.arrayBuffer());
  const detectedMime = actualMime(buffer);
  if (!detectedMime || detectedMime !== evidence.type || !FILE_TYPES[detectedMime]) throw new Error("slip_type_invalid");

  const slipScan: SubscriptionSlipScanResult = await scanSubscriptionSlip({
    buffer,
    mimeType: detectedMime as "image/jpeg" | "image/png" | "image/webp",
    expectedAmount: payload.expected_amount,
    expectedPayeeName: snapshot.issuer.account_name || snapshot.issuer.name || "",
    expectedAccountNumber: snapshot.issuer.account_number || "",
    expectedPromptPayId: snapshot.issuer.promptpay_id || ""
  });

  const requestId = crypto.randomUUID();
  const filePath = payload.tenant_id + "/" + requestId + "/slip." + FILE_TYPES[detectedMime];
  const upload = await db.storage.from(SUBSCRIPTION_SLIP_BUCKET).upload(filePath, buffer, {
    contentType: detectedMime,
    cacheControl: "0",
    upsert: false
  });
  if (upload.error) throw new Error("slip_upload_failed");

  const amountReported = slipScan.parsed.amount != null &&
    Number.isFinite(slipScan.parsed.amount) && slipScan.parsed.amount > 0 && slipScan.parsed.amount <= 10_000_000
      ? Math.round(slipScan.parsed.amount * 100) / 100
      : null;

  const type = !snapshot.contract.package_id
    ? "new_subscription"
    : snapshot.contract.status === "trial"
      ? "trial_conversion"
      : snapshot.contract.package_id !== target.id
        ? "package_change"
        : "renewal";

  const metadata = {
    kind: "payment_notice",
    billing_interval: payload.billing_interval,
    expected_amount: payload.expected_amount,
    source: "company_website_package_checkout",
    submitted_by: payload.actor_user_id,
    submitted_role: payload.actor_role,
    checkout_nonce: payload.nonce,
    payer_name: slipScan.parsed.payer_name ?? "",
    transfer_reference: slipScan.parsed.reference_no ?? slipScan.parsed.transaction_id ?? "",
    transfer_at: slipScan.parsed.transfer_datetime ?? "",
    slip_ai: {
      version: "subscription-slip-ai-v1",
      status: slipScan.status,
      model: slipScan.model,
      parsed: slipScan.parsed,
      checks: slipScan.checks,
      error_message: slipScan.error_message
    },
    note: input.note.slice(0, 500)
  };

  const inserted = await db.from("tenant_subscription_payment_requests").insert({
    id: requestId,
    tenant_id: payload.tenant_id,
    requested_package_id: target.id,
    request_type: type,
    amount_reported: amountReported,
    status: "pending",
    currency: "THB",
    evidence_url: filePath,
    metadata
  }).select("id,status").maybeSingle<{ id: string; status: string }>();

  if (inserted.error || !inserted.data) {
    await db.storage.from(SUBSCRIPTION_SLIP_BUCKET).remove([filePath]);
    if (inserted.error?.code === "23505") throw new Error("open_request_exists");
    throw new Error("subscription_request_failed");
  }

  await appendAuditLog({
    tenantId: payload.tenant_id,
    actorUserId: payload.actor_user_id,
    actorRole: payload.actor_role,
    action: "subscription_payment_reported_from_website",
    targetTable: "tenant_subscription_payment_requests",
    targetId: inserted.data.id,
    module: "subscription",
    metadata: {
      source: "company_website_package_checkout",
      requested_package_id: target.id,
      billing_interval: payload.billing_interval,
      expected_amount: payload.expected_amount,
      slip_ai_status: slipScan.status,
      slip_ai_amount_match: slipScan.checks.amount_match,
      slip_ai_payee_match: slipScan.checks.payee_match
    }
  });

  await dispatchSupportPush({
    audience: "it",
    kind: "request",
    title: "คำขอชำระแพ็กเกจจากเว็บไซต์ · " + snapshot.store.name,
    body: target.name + " · " + (payload.billing_interval === "yearly" ? "รายปี" : "รายเดือน"),
    url: "/it-admin/subscription-payments/" + payload.tenant_id,
    tag: "subscription-request:" + inserted.data.id
  }).catch(() => null);

  return {
    id: inserted.data.id,
    status: inserted.data.status,
    store_name: snapshot.store.name,
    package_name: target.name,
    expected_amount: payload.expected_amount,
    billing_interval: payload.billing_interval
  };
}
