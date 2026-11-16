import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { clearPreEntryFlowState, readPreEntryFlowState } from "@/lib/server/pre-entry-state";
import { clearFinanceSession, verifyFinanceIdentity, writeFinanceSession } from "@/lib/server/finance-session";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { buildRateLimitKey, enforceRateLimit, getClientIpAddress, readRateLimitSetting } from "@/lib/server/rate-limit";
import { getRequestMeta, writeAuditLog } from "@/lib/server/audit-log";

type LoginInput = { employee_code?: string; pin?: string };

function denied(status = 401) {
  // Uniform error prevents account-code and role enumeration.
  return NextResponse.json({
    data: null,
    error: { code: "finance_login_denied", message: "ไม่สามารถเข้าสู่ระบบบัญชีได้ กรุณาตรวจสอบสิทธิ์ รหัสพนักงาน และ PIN" }
  }, { status });
}

export async function POST(request: Request) {
  const input = await request.json().catch(() => null) as LoginInput | null;
  const code = String(input?.employee_code ?? "").trim();
  const pin = String(input?.pin ?? "").trim();
  if (!/^\\d{1,32}$/.test(code) || !/^\\d{4,6}$/.test(pin)) return denied(400);

  const flow = readPreEntryFlowState(await cookies());
  if (!flow || (flow.stage !== "store_verified" && flow.stage !== "branch_selected") || !flow.tenantId) {
    return denied();
  }

  const limit = await enforceRateLimit({
    namespace: "auth_finance_login",
    key: buildRateLimitKey({
      namespace: "finance",
      parts: [flow.tenantId, getClientIpAddress(request)]
    }),
    max: readRateLimitSetting("AUTH_FINANCE_RATE_LIMIT_MAX", 5, { min: 3, max: 30 }),
    windowMs: readRateLimitSetting("AUTH_FINANCE_RATE_LIMIT_WINDOW_MS", 60_000, { min: 10_000, max: 15 * 60_000 }),
    failClosedOnBackendError: true
  });
  if (!limit.ok) {
    const result = denied(429);
    result.headers.set("retry-after", String(Math.max(limit.retryAfterSeconds, 1)));
    return result;
  }

  try {
    const db = getSupabaseServiceClient();
    // Require an explicitly provisioned employee code. UUID-derived/demo codes are NOT
    // suitable credentials for tenant-wide financial access.
    const candidates = await db.from("pos_user_profiles")
      .select("user_id")
      .eq("tenant_id", flow.tenantId)
      .eq("employee_code", code)
      .limit(2);

    if (candidates.error) throw new Error("finance_employee_lookup_failed");
    if (!candidates.data || candidates.data.length !== 1) return denied();

    const userId = String(candidates.data[0].user_id);
    const user = await db.from("users_profiles")
      .select("id,pin_hash,is_active")
      .eq("id", userId)
      .maybeSingle<{ id: string; pin_hash: string | null; is_active: boolean }>();
    if (user.error) throw new Error("finance_pin_lookup_failed");
    if (!user.data?.is_active || !user.data.pin_hash) return denied();
    if (!(await bcrypt.compare(pin, user.data.pin_hash))) return denied();

    const identity = await verifyFinanceIdentity(flow.tenantId, userId);
    if (!identity) return denied(403);

    const response = NextResponse.json({
      data: { redirect_to: "/finance" },
      error: null
    }, { headers: { "Cache-Control": "no-store" } });
    writeFinanceSession(response, identity.tenantId, identity.userId);
    clearPreEntryFlowState(response);

    const { ipAddress, userAgent } = getRequestMeta(request);
    await writeAuditLog({
      tenantId: identity.tenantId,
      actorUserId: identity.userId,
      actorRole: "accountant",
      action: "finance_login_success",
      targetType: "user",
      targetId: identity.userId,
      ipAddress,
      userAgent,
      metadata: { scope: "all_active_tenant_branches", branch_count: identity.branchIds.length }
    }).catch((error) => {
      console.warn("[finance-login] audit warning", error instanceof Error ? error.message : "unknown");
    });
    return response;
  } catch (error) {
    console.error("[finance-login] verification unavailable", error instanceof Error ? error.message : "unknown");
    const response = denied(503);
    clearFinanceSession(response);
    return response;
  }
}
