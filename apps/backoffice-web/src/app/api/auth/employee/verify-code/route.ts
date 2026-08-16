import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getRequestMeta, writeAuditLog, writeLoginAttempt } from "@/lib/server/audit-log";
import { AuthTimeoutError, withAuthTimeout } from "@/lib/server/auth-timeout";
import { hasPermission, resolveEmployeeByCode } from "@/lib/server/pre-entry-auth";
import { createFlowState, hasFlowStage, readPreEntryFlowState, writePreEntryFlowState } from "@/lib/server/pre-entry-state";
import { buildRateLimitKey, enforceRateLimit, getClientIpAddress, readRateLimitSetting } from "@/lib/server/rate-limit";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { resolveStoreLoginMode, shouldSkipBranchSelection } from "@/lib/server/store-login-mode";

type RequestBody = {
  employee_code?: string;
};

type BranchSummary = {
  id: string;
  code: string | null;
  name: string | null;
  is_active: boolean;
};

type BranchLoginPolicy = {
  allow_pin_login: boolean | null;
  allow_staff_card_login: boolean | null;
  require_registered_device: boolean | null;
};

function runInBackground(task: () => Promise<unknown>) {
  void task().catch((error) => {
    console.error("[auth/employee/verify-code] background task failed", {
      error: error instanceof Error ? error.message : "Unknown error"
    });
  });
}

function withTimingHeaders<T extends NextResponse>(response: T, startedAt: number): T {
  const durationMs = Date.now() - startedAt;
  response.headers.set("x-auth-api-ms", String(durationMs));
  response.headers.set("server-timing", `total;dur=${durationMs}`);
  return response;
}

function isAutoSkipEnabled() {
  const raw = String(process.env.POS_AUTO_SKIP_SINGLE_BRANCH ?? "true").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

async function recoverSingleBranchFlow(flow: NonNullable<ReturnType<typeof readPreEntryFlowState>>) {
  if (hasFlowStage(flow, ["branch_selected", "employee_verified"]) && flow.branchId) return flow;
  if (!hasFlowStage(flow, ["store_verified"])) return null;

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("branches")
    .select("id,code,name,is_active")
    .eq("tenant_id", flow.tenantId)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) {
    console.error("[auth/employee/verify-code] single-branch recovery failed", {
      tenantId: flow.tenantId,
      error: error.message
    });
    return null;
  }

  const branches = ((data ?? []) as BranchSummary[]).filter((branch) => branch.is_active);
  const mode = await resolveStoreLoginMode(flow.tenantId);
  if (!shouldSkipBranchSelection(mode, branches.length, isAutoSkipEnabled())) return null;

  const branch = branches[0];
  return createFlowState({
    ...flow,
    stage: "branch_selected",
    branchId: branch.id,
    branchCode: branch.code,
    branchName: branch.name
  });
}

async function loadBranchEmployeeLoginPolicy({
  tenantId,
  branchId
}: {
  tenantId: string;
  branchId: string;
}): Promise<BranchLoginPolicy | null> {
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from("branch_login_policies")
    .select("allow_pin_login,allow_staff_card_login,require_registered_device")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .maybeSingle();

  if (error) {
    console.error("[auth/employee/verify-code] branch policy lookup failed", {
      tenantId,
      branchId,
      error: error.message
    });
    throw new Error("branch_policy_lookup_failed");
  }

  return data as BranchLoginPolicy | null;
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const body = (await request.json().catch(() => null)) as RequestBody | null;
  const employeeCodeInput = String(body?.employee_code ?? "").trim();

  if (!employeeCodeInput) {
    return withTimingHeaders(
      NextResponse.json(
        { data: null, error: { code: "employee_code_required", message: "กรุณากรอกรหัสพนักงาน" } },
        { status: 400 }
      ),
      startedAt
    );
  }
  if (!/^\d{1,32}$/.test(employeeCodeInput)) {
    return withTimingHeaders(
      NextResponse.json(
        { data: null, error: { code: "invalid_employee_code", message: "รหัสพนักงานต้องเป็นตัวเลขเท่านั้น" } },
        { status: 422 }
      ),
      startedAt
    );
  }

  const cookieStore = await cookies();
  const flow = readPreEntryFlowState(cookieStore);

  if (!flow) {
    return withTimingHeaders(
      NextResponse.json(
        { data: null, error: { code: "missing_branch_context", message: "กรุณาเลือกสาขาก่อนยืนยันตัวตนพนักงาน" } },
        { status: 401 }
      ),
      startedAt
    );
  }

  const branchFlow = await withAuthTimeout(recoverSingleBranchFlow(flow), "employee_branch_recovery_timeout");
  if (!branchFlow?.branchId) {
    return withTimingHeaders(
      NextResponse.json(
        { data: null, error: { code: "missing_branch_context", message: "กรุณาเลือกสาขาก่อนยืนยันตัวตนพนักงาน" } },
        { status: 401 }
      ),
      startedAt
    );
  }

  const clientIp = getClientIpAddress(request);
  const rateLimitResult = await enforceRateLimit({
    namespace: "auth_employee_verify",
    key: buildRateLimitKey({
      namespace: "scope",
      parts: [branchFlow.tenantId, branchFlow.branchId, clientIp]
    }),
    max: readRateLimitSetting("AUTH_EMPLOYEE_RATE_LIMIT_MAX", 10, { min: 3, max: 60 }),
    windowMs: readRateLimitSetting("AUTH_EMPLOYEE_RATE_LIMIT_WINDOW_MS", 60_000, { min: 10_000, max: 15 * 60_000 }),
    failClosedOnBackendError: true
  });

  if (!rateLimitResult.ok) {
    const response = NextResponse.json(
      { data: null, error: { code: "rate_limited", message: "ลองหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่" } },
      { status: 429 }
    );
    response.headers.set("retry-after", String(Math.max(rateLimitResult.retryAfterSeconds, 1)));
    response.headers.set("x-ratelimit-limit", String(rateLimitResult.limit));
    response.headers.set("x-ratelimit-remaining", String(rateLimitResult.remaining));
    return withTimingHeaders(response, startedAt);
  }

  const { ipAddress, userAgent } = getRequestMeta(request);

  try {
    const policy = await withAuthTimeout(
      loadBranchEmployeeLoginPolicy({
        tenantId: branchFlow.tenantId,
        branchId: branchFlow.branchId
      }),
      "employee_policy_lookup_timeout"
    );

    const allowEmployeeCodeLogin = Boolean(policy?.allow_pin_login || policy?.allow_staff_card_login);

    if (!policy || !allowEmployeeCodeLogin) {
      runInBackground(() =>
        writeAuditLog({
          tenantId: branchFlow.tenantId,
          branchId: branchFlow.branchId,
          actorRole: "system",
          action: "permission_denied",
          targetType: "branch_login_policy",
          targetId: flow.branchId,
          ipAddress,
          userAgent,
          metadata: {
            reason: "employee_code_login_disabled",
            allow_pin_login: policy?.allow_pin_login ?? null,
            allow_staff_card_login: policy?.allow_staff_card_login ?? null,
            source: "employee_code"
          }
        })
      );

      return withTimingHeaders(
        NextResponse.json(
          {
            data: null,
            error: {
              code: "employee_code_login_disabled",
              message: "สาขานี้ยังไม่เปิดใช้งานล็อกอินด้วยรหัสพนักงาน"
            }
          },
          { status: 403 }
        ),
        startedAt
      );
    }

    const employee = await withAuthTimeout(
      resolveEmployeeByCode({
        tenantId: branchFlow.tenantId,
        branchId: branchFlow.branchId,
        employeeCode: employeeCodeInput
      }),
      "employee_lookup_timeout"
    );

    if (!employee) {
      runInBackground(() =>
        writeLoginAttempt({
          tenantId: branchFlow.tenantId,
          branchId: branchFlow.branchId,
          loginMethod: "staff_card",
          success: false,
          failureReason: "auth_failed",
          ipAddress,
          userAgent,
          metadata: { source: "employee_code" }
        })
      );

      return withTimingHeaders(
        NextResponse.json(
          {
            data: null,
            error: {
              code: "employee_not_found",
              message: "ไม่พบพนักงานในสาขานี้ หรือพนักงานไม่พร้อมใช้งาน"
            }
          },
          { status: 401 }
        ),
        startedAt
      );
    }

    const isKitchen = String(employee.role ?? "").trim().toLowerCase() === "kitchen";
    const effectivePermissions = isKitchen ? ["pos.kitchen.access"] : employee.permissions;

    if (!isKitchen && !hasPermission(employee.permissions, "pos.sales.access")) {
      runInBackground(() =>
        writeAuditLog({
          tenantId: branchFlow.tenantId,
          branchId: branchFlow.branchId,
          actorUserId: employee.userId,
          actorRole: employee.role,
          targetUserId: employee.userId,
          action: "permission_denied",
          targetType: "user_branch_role",
          targetId: employee.userId,
          ipAddress,
          userAgent,
          metadata: {
            permission: "pos.sales.access",
            source: "employee_code"
          }
        })
      );

      return withTimingHeaders(
        NextResponse.json(
          { data: null, error: { code: "permission_denied", message: "พนักงานไม่มีสิทธิ์เข้าใช้งานหน้าขาย" } },
          { status: 403 }
        ),
        startedAt
      );
    }

    const nextFlow = createFlowState({
      ...branchFlow,
      stage: "employee_verified",
      userId: employee.userId,
      userRole: employee.role,
      employeeCode: employee.employeeCode,
      employeeName: employee.fullName,
      employeeAuthMethod: "employee_code",
      permissions: effectivePermissions
    });
    const rememberedDeviceCode = isKitchen ? "" : String(branchFlow.deviceCode ?? "").trim().toUpperCase();

    const response = NextResponse.json({
      data: {
        employee: {
          id: employee.userId,
          code: employee.employeeCode,
          name: employee.fullName,
          role: employee.role
        },
        permissions: effectivePermissions,
        next_step: isKitchen ? "kitchen" : rememberedDeviceCode ? "remembered_device" : "devices",
        remembered_device: !isKitchen && rememberedDeviceCode
          ? {
              id: branchFlow.deviceId ?? null,
              code: rememberedDeviceCode
            }
          : null
      },
      error: null
    });

    writePreEntryFlowState(response, nextFlow);

    runInBackground(() =>
      writeLoginAttempt({
        tenantId: branchFlow.tenantId,
        branchId: branchFlow.branchId,
        userId: employee.userId,
        loginMethod: "staff_card",
        success: true,
        ipAddress,
        userAgent,
        metadata: { source: "employee_code", kitchen_role: isKitchen }
      })
    );

    runInBackground(() =>
      writeAuditLog({
        tenantId: branchFlow.tenantId,
        branchId: branchFlow.branchId,
        actorUserId: employee.userId,
        actorRole: employee.role,
        targetUserId: employee.userId,
        action: "employee_verification_success",
        targetType: "users_profiles",
        targetId: employee.userId,
        ipAddress,
        userAgent,
        metadata: { source: "employee_code", remembered_device_code: rememberedDeviceCode || null, kitchen_role: isKitchen }
      })
    );

    return withTimingHeaders(response, startedAt);
  } catch (error) {
    if (error instanceof AuthTimeoutError) {
      return withTimingHeaders(
        NextResponse.json(
          { data: null, error: { code: "auth_timeout", message: "ระบบตอบสนองช้าเกินไป กรุณาลองใหม่อีกครั้ง" } },
          { status: 504 }
        ),
        startedAt
      );
    }

    console.error("[auth/employee/verify-code] unexpected error", {
      tenantId: branchFlow.tenantId,
      branchId: branchFlow.branchId,
      error: error instanceof Error ? error.message : "Unknown error"
    });

    return withTimingHeaders(
      NextResponse.json(
        { data: null, error: { code: "employee_verify_failed", message: "ไม่สามารถยืนยันตัวตนพนักงานได้" } },
        { status: 500 }
      ),
      startedAt
    );
  }
}
