import { createHash, timingSafeEqual } from "node:crypto";
import { fail, ok } from "@/lib/http";
import { readEnv } from "@/lib/env";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";
import { scanSubscriptionSlip } from "@/lib/payments/subscription-slip-ai";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BUCKET = "subscription-payment-evidence";
const MAX_SLIP = 4 * 1024 * 1024;

function bridgeSecret() {
  const serviceRole = String(readEnv("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  if (!serviceRole) return "";
  return createHash("sha256")
    .update("cpipos:internal-subscription-slip-scan:v1|")
    .update(serviceRole)
    .digest("hex");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorized(request: Request) {
  const expected = bridgeSecret();
  const header = String(request.headers.get("authorization") ?? "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return Boolean(expected && token && safeEqual(expected, token));
}

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function actualMime(buffer: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return "image/jpeg";
  if (buffer.length >= 12 && buffer.subarray(0,4).toString("ascii") === "RIFF" && buffer.subarray(8,12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export async function POST(request: Request) {
  if (!authorized(request)) return fail("internal_auth_required", "Unauthorized.", 401);

  const body = await request.json().catch(() => null) as {
    tenant_id?: unknown;
    request_id?: unknown;
    storage_path?: unknown;
    expected_amount?: unknown;
    expected_payee_name?: unknown;
    expected_account_number?: unknown;
    expected_promptpay_id?: unknown;
  } | null;

  const tenantId = clean(body?.tenant_id, 80);
  const requestId = clean(body?.request_id, 80);
  const storagePath = clean(body?.storage_path, 500);
  const expectedAmount = Number(body?.expected_amount);

  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(tenantId) || !uuid.test(requestId)) {
    return fail("scan_scope_invalid", "Invalid scan scope.", 422);
  }

  const requiredPrefix = tenantId + "/" + requestId + "/";
  if (!storagePath.startsWith(requiredPrefix) || storagePath.includes("..")) {
    return fail("scan_path_invalid", "Invalid evidence path.", 422);
  }

  if (!Number.isFinite(expectedAmount) || expectedAmount <= 0 || expectedAmount > 10_000_000) {
    return fail("scan_amount_invalid", "Invalid expected amount.", 422);
  }

  try {
    const db = getPrimarySupabaseServiceClient();
    const downloaded = await db.storage.from(BUCKET).download(storagePath);
    if (downloaded.error || !downloaded.data) {
      return fail("scan_evidence_unavailable", "Evidence file is unavailable.", 404);
    }

    const buffer = Buffer.from(await downloaded.data.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_SLIP) {
      return fail("scan_evidence_invalid", "Evidence file is invalid.", 422);
    }

    const mimeType = actualMime(buffer);
    if (!mimeType) return fail("scan_evidence_type_invalid", "Unsupported evidence type.", 422);

    const scan = await scanSubscriptionSlip({
      buffer,
      mimeType,
      expectedAmount: Number(expectedAmount.toFixed(2)),
      expectedPayeeName: clean(body?.expected_payee_name, 180),
      expectedAccountNumber: clean(body?.expected_account_number, 40),
      expectedPromptPayId: clean(body?.expected_promptpay_id, 40)
    });

    const response = ok({ scan });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    console.error("[internal-slip-scan]", error instanceof Error ? error.message : "unknown_error");
    return fail("internal_scan_failed", "Slip scan failed.", 503);
  }
}
