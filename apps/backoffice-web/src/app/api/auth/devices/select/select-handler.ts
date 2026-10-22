import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { getRequestMeta, writeAuditLog, writeLoginAttempt } from "@/lib/server/audit-log";
import { AuthTimeoutError, withAuthTimeout } from "@/lib/server/auth-timeout";
import {evaluatePosEntryAccess,PosFeatureLookupUnavailable} from "@/lib/server/pos-entry-access-service";
import { consumeLoginContext } from "@/lib/server/login-context";
import { resolveDeviceSessionAccess } from "@/lib/server/pos-device-session-rules";
import { createPosSession, createSessionHandoffToken, resolvePosRedirectTarget, resolveSessionCookieConfig } from "@/lib/server/pos-session";
import { hasPermission, resolveEmployeeByUserId } from "@/lib/server/pre-entry-auth";
import { clearPreEntryFlowState, hasFlowStage, readPreEntryFlowState } from "@/lib/server/pre-entry-state";

type RequestBody = {
  device_code?: string;
  force_override?: boolean;
};

type DeviceRow = {
  id: string;
  device_code: string;
  device_name: string;
  status: "active" | "inactive" | "maintenance";
};

type ActiveSessionRow = {
  id: string;
  user_id: string;
  issued_at: string;
};

type UserDeviceScopeRow = {
  scope_mode: "all_devices" | "single_device";
  device_id: string | null;
};



function isMissingRelationError(error: { code?: string | null; message?: string | null } | null | undefined, relationName: string) {
  if (!error) return false;
  const code = String(error.code ?? "");
  const message = String(error.message ?? "").toLowerCase();
  return code === "42P01" || message.includes("does not exist") || message.includes(relationName.toLowerCase());
}

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ data: null, error: { code, message } }, { status });
}

function withTimingHeaders<T extends NextResponse>(response: T, startedAt: number): T {
  const durationMs = Date.now() - startedAt;
  response.headers.set("x-auth-api-ms", String(durationMs));
  response.headers.set("server-timing", `total;dur=${durationMs}`);
  return response;
}

function isSafeDeviceCode(value: string) {
  return /^[A-Z0-9_-]{1,64}$/.test(value);
}

async function runBestEffort(label: string, action: () => PromiseLike<unknown> | unknown) {
  try {
    await action();
  } catch (error) {
    console.error(`[auth/devices/select] best-effort task failed: ${label}`, {
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
}

function pickNewestActiveSession(rows: Array<ActiveSessionRow | null | undefined>) {
  return rows
    .filter((row): row is ActiveSessionRow => Boolean(row))
    .sort((a, b) => new Date(b.issued_at).getTime() - new Date(a.issued_at).getTime())[0] ?? null;
}

const DEVICE_SELECT_AUTH_TIMEOUT_MS = 30000;
export async function POST(request: Request) {
  const startedAt = Date.now();
  const timedJsonError = (status: number, code: string, message: string) =>
    withTimingHeaders(jsonError(status, code, message), startedAt);
  const body = (await request.json().catch(() => null)) as RequestBody | null;
  const selectedDeviceCode = String(body?.device_code ?? "").trim().toUpperCase();
  const forceOverride = Boolean(body?.force_override);

  if (!selectedDeviceCode) {
    return timedJsonError(400, "device_required", "กรุณาเลือกเครื่องแคชเชียร์");
  }
  if (!isSafeDeviceCode(selectedDeviceCode)) {
    return timedJsonError(422, "device_required", "รูปแบบรหัสเครื่องไม่ถูกต้อง");
  }

  const cookieStore = await cookies();
  const flow = readPreEntryFlowState(cookieStore);
  if (!flow) {
    return timedJsonError(401, "missing_employee_context", "กรุณายืนยันตัวตนพนักงานก่อนเลือกเครื่องแคชเชียร์");
  }
  if (!hasFlowStage(flow, ["employee_verified"]) || !flow.branchId || !flow.userId || !flow.userRole || !flow.permissions) {
    return timedJsonError(401, "missing_employee_context", "กรุณายืนยันตัวตนพนักงานก่อนเลือกเครื่องแคชเชียร์");
  }

  const { ipAddress, userAgent } = getRequestMeta(request);
  const nowIso = new Date().toISOString();

  try {
    const supabase = getSupabaseServiceClient();

    const [entryAccess, deviceQuery, employee] = await withAuthTimeout(
      Promise.all([
        evaluatePosEntryAccess(supabase, flow.tenantId, flow.branchId),
        supabase
          .from("branch_devices")
          .select("id,device_code,device_name,status")
          .eq("tenant_id", flow.tenantId)
          .eq("branch_id", flow.branchId)
          .eq("device_code", selectedDeviceCode)
          .maybeSingle<DeviceRow>(),
        resolveEmployeeByUserId({
          tenantId: flow.tenantId,
          branchId: flow.branchId,
          userId: flow.userId
        })
      ]),
      "device_select_core_lookup_timeout",
      DEVICE_SELECT_AUTH_TIMEOUT_MS
    );

    if (!employee) {
      return timedJsonError(401, "employee_not_found", "ไม่พบผู้ใช้งานในสาขานี้ หรือผู้ใช้งานไม่พร้อมใช้งาน");
    }
    if (!hasPermission(employee.permissions, "pos.sales.access")) {
      return timedJsonError(403, "permission_denied", "ผู้ใช้งานไม่มีสิทธิ์เข้าใช้งานหน้าขาย");
    }
    // Verify lifecycle independently of feature grants: an old branch override
    // must never bypass a completed trial or an explicit account lock.
    if(!entryAccess.allowed){
      const detail=entryAccess.denial;
      return withTimingHeaders(NextResponse.json({
        data:null,error:{
          code:detail.code,message:detail.message,title:detail.title,
          expires_at:detail.expires_at,kind:detail.kind
        }
      },{status:403}),startedAt);
    }

    if (deviceQuery.error) {
      return timedJsonError(500, "device_select_failed", "ไม่สามารถตรวจสอบข้อมูลเครื่องแคชเชียร์ได้");
    }

    const device = deviceQuery.data;
    if (!device) {
      return timedJsonError(404, "device_not_found", "ไม่พบเครื่องแคชเชียร์ที่เลือก");
    }

    if (device.status === "inactive") {
      return timedJsonError(403, "device_disabled", "เครื่องที่เลือกถูกปิดใช้งาน");
    }

    if (device.status === "maintenance") {
      return timedJsonError(403, "device_offline", "เครื่องที่เลือกออฟไลน์หรืออยู่ระหว่างบำรุงรักษา");
    }

    const deviceScopeQueryPromise = withAuthTimeout(
      supabase
        .from("pos_user_device_scopes")
        .select("scope_mode,device_id")
        .eq("tenant_id", flow.tenantId)
        .eq("branch_id", flow.branchId)
        .eq("user_id", employee.userId)
        .maybeSingle<UserDeviceScopeRow>(),
      "device_scope_lookup_timeout",
      DEVICE_SELECT_AUTH_TIMEOUT_MS
    );

    const [activeSessionById, activeSessionByCode] = await withAuthTimeout(
      Promise.all([
        supabase
          .from("pos_sessions")
          .select("id,user_id,issued_at")
          .eq("tenant_id", flow.tenantId)
          .eq("branch_id", flow.branchId)
          .eq("status", "active")
          .eq("device_id", device.id)
          .gt("expires_at", nowIso)
          .order("issued_at", { ascending: false })
          .limit(1)
          .maybeSingle<ActiveSessionRow>(),
        supabase
          .from("pos_sessions")
          .select("id,user_id,issued_at")
          .eq("tenant_id", flow.tenantId)
          .eq("branch_id", flow.branchId)
          .eq("status", "active")
          .eq("device_code", selectedDeviceCode)
          .gt("expires_at", nowIso)
          .order("issued_at", { ascending: false })
          .limit(1)
          .maybeSingle<ActiveSessionRow>()
      ]),
      "device_active_session_lookup_timeout",
      DEVICE_SELECT_AUTH_TIMEOUT_MS
    );

    if (activeSessionById.error || activeSessionByCode.error) {
      return timedJsonError(500, "device_select_failed", "ไม่สามารถตรวจสอบสถานะเครื่องได้");
    }

    const activeSession = pickNewestActiveSession([activeSessionById.data, activeSessionByCode.data]);
    let overrideApplied = false;
    if (activeSession) {
      const accessDecision = resolveDeviceSessionAccess({
        activeSessionUserId: activeSession.user_id,
        employeeUserId: employee.userId,
        employeePermissions: employee.permissions
      });
      if (!accessDecision.ok) {
        return timedJsonError(accessDecision.status, accessDecision.code, accessDecision.message);
      }

      overrideApplied = accessDecision.overrideApplied;
      if (accessDecision.shouldRevokeExistingSession) {
        const [revokeByDeviceId, revokeByDeviceCode] = await withAuthTimeout(
          Promise.all([
            supabase
              .from("pos_sessions")
              .update({ status: "revoked", revoked_at: nowIso })
              .eq("tenant_id", flow.tenantId)
              .eq("branch_id", flow.branchId)
              .eq("status", "active")
              .eq("device_id", device.id),
            supabase
              .from("pos_sessions")
              .update({ status: "revoked", revoked_at: nowIso })
              .eq("tenant_id", flow.tenantId)
              .eq("branch_id", flow.branchId)
              .eq("status", "active")
              .eq("device_code", selectedDeviceCode)
          ]),
          "device_session_revoke_timeout",
          DEVICE_SELECT_AUTH_TIMEOUT_MS
        );

        if (revokeByDeviceId.error || revokeByDeviceCode.error) {
          return timedJsonError(500, "device_select_failed", "ไม่สามารถปลดล็อกเครื่องที่กำลังใช้งานอยู่ได้");
        }
      }
    }

    const deviceScopeQuery = await deviceScopeQueryPromise;

    if (deviceScopeQuery.error && !isMissingRelationError(deviceScopeQuery.error, "pos_user_device_scopes")) {
      return timedJsonError(500, "device_select_failed", "ไม่สามารถตรวจสอบขอบเขตอุปกรณ์ของผู้ใช้งานได้");
    }

    const scopeMode = deviceScopeQuery.data?.scope_mode ?? "all_devices";
    const scopedDeviceId = deviceScopeQuery.data?.device_id ?? null;
    if (scopeMode === "single_device" && scopedDeviceId && scopedDeviceId !== device.id) {
      return timedJsonError(403, "device_scope_denied", "ผู้ใช้งานนี้ไม่ได้รับสิทธิ์ใช้เครื่องที่เลือก");
    }

    const contextExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const contextResult = await withAuthTimeout(
      supabase
        .from("pos_login_contexts")
        .insert({
          tenant_id: flow.tenantId,
          branch_id: flow.branchId,
          store_code: flow.storeCode,
          device_code: selectedDeviceCode,
          status: "active",
          expires_at: contextExpiresAt,
          metadata: {
            context_type: "pre_entry_device_selection",
            employee_user_id: employee.userId,
            employee_role: employee.role,
            employee_auth_method: flow.employeeAuthMethod ?? "employee_code"
          }
        })
        .select("id")
        .single<{ id: string }>(),
      "device_context_create_timeout",
      DEVICE_SELECT_AUTH_TIMEOUT_MS
    );

    if (contextResult.error || !contextResult.data?.id) {
      return timedJsonError(500, "context_create_failed", "ไม่สามารถสร้างบริบทการเข้าสู่ระบบได้");
    }

    const contextId = contextResult.data.id;
    const loginMethod = "staff_card";

    const sessionCreated = await withAuthTimeout(
      createPosSession({
        tenantId: flow.tenantId,
        branchId: flow.branchId,
        deviceId: device.id,
        deviceCode: selectedDeviceCode,
        userId: employee.userId,
        role: employee.role,
        loginContextId: contextId,
        loginMethod,
        metadata: {
          source: "pre_entry_flow",
          employee_auth_method: flow.employeeAuthMethod ?? "employee_code",
          employee_code: employee.employeeCode ?? flow.employeeCode ?? null,
          override_in_use_device: overrideApplied,
          overridden_session_id: overrideApplied ? activeSession?.id ?? null : null,
          force_override_requested: forceOverride
        }
      }),
      "device_session_create_timeout",
      DEVICE_SELECT_AUTH_TIMEOUT_MS
    );

    if (!sessionCreated.ok) {
      if (sessionCreated.code === "session_scope_conflict") {
        return timedJsonError(409, "device_in_use", "เครื่องนี้กำลังถูกใช้งานอยู่");
      }
      return timedJsonError(500, sessionCreated.code, "ไม่สามารถสร้าง POS Session ได้");
    }

    void runBestEffort("consume_login_context", () => consumeLoginContext(contextId));

    const token = createSessionHandoffToken({
      sessionId: sessionCreated.session.id,
      tenantId: flow.tenantId,
      branchId: flow.branchId,
      userId: employee.userId,
      role: employee.role
    });

    const cookieConfig = resolveSessionCookieConfig();
    const response = NextResponse.json({
      data: {
        redirect_to: resolvePosRedirectTarget(),
        session_id: sessionCreated.session.id
      },
      error: null
    });

    response.cookies.set({
      name: cookieConfig.name,
      value: token,
      httpOnly: true,
      secure: cookieConfig.secure,
      sameSite: "lax",
      path: "/",
      domain: cookieConfig.domain,
      maxAge: 120
    });
    response.cookies.set({
      name: cookieConfig.sessionIdName,
      value: sessionCreated.session.id,
      httpOnly: true,
      secure: cookieConfig.secure,
      sameSite: "lax",
      path: "/",
      domain: cookieConfig.domain,
      maxAge: cookieConfig.sessionMaxAgeSeconds
    });

    void Promise.allSettled([
      runBestEffort("touch_branch_device", () => supabase.from("branch_devices").update({ last_seen_at: nowIso }).eq("id", device.id)),
      runBestEffort("write_login_attempt", () =>
        writeLoginAttempt({
          tenantId: flow.tenantId,
          branchId: flow.branchId,
          userId: employee.userId,
          deviceCode: selectedDeviceCode,
          loginContextId: contextId,
          loginMethod,
          success: true,
          ipAddress,
          userAgent,
          metadata: {
            source: "pre_entry_flow_device_select"
          }
        })
      ),
      runBestEffort("write_audit_device_selected", () =>
        writeAuditLog({
          tenantId: flow.tenantId,
          branchId: flow.branchId,
          actorUserId: employee.userId,
          actorRole: employee.role,
          targetUserId: employee.userId,
          deviceCode: selectedDeviceCode,
          posSessionId: sessionCreated.session.id,
          action: "device_selected",
          targetType: "branch_devices",
          targetId: device.id,
          ipAddress,
          userAgent,
          metadata: {
            device_code: selectedDeviceCode,
            device_name: device.device_name,
            override_in_use_device: overrideApplied,
            overridden_session_id: overrideApplied ? activeSession?.id ?? null : null
          }
        })
      ),
      runBestEffort("write_audit_session_created", () =>
        writeAuditLog({
          tenantId: flow.tenantId,
          branchId: flow.branchId,
          actorUserId: employee.userId,
          actorRole: employee.role,
          targetUserId: employee.userId,
          deviceCode: selectedDeviceCode,
          posSessionId: sessionCreated.session.id,
          action: "session_created",
          targetType: "pos_session",
          targetId: sessionCreated.session.id,
          ipAddress,
          userAgent,
          metadata: {
            login_method: loginMethod,
            device_code: selectedDeviceCode,
            device_name: device.device_name,
            logged_in_at: nowIso,
            override_in_use_device: overrideApplied,
            overridden_session_id: overrideApplied ? activeSession?.id ?? null : null
          }
        })
      )
    ]);

    clearPreEntryFlowState(response);
    return withTimingHeaders(response, startedAt);
  } catch (error) {
    if(error instanceof PosFeatureLookupUnavailable){
      return timedJsonError(503,"feature_verification_unavailable","ไม่สามารถตรวจสอบสถานะแพ็กเกจได้ชั่วคราว กรุณาลองใหม่หรือติดต่อฝ่าย Support");
    }
    if (error instanceof AuthTimeoutError) {
      return timedJsonError(504, "auth_timeout", "ระบบตอบสนองช้าเกินไป กรุณาลองใหม่อีกครั้ง");
    }
    console.error("[auth/devices/select] unexpected error", {
      tenantId: flow.tenantId,
      branchId: flow.branchId,
      userId: flow.userId,
      deviceCode: selectedDeviceCode,
      error: error instanceof Error ? error.message : "Unknown error"
    });
    return timedJsonError(500, "device_select_failed", "ไม่สามารถเข้าใช้งานเครื่องที่เลือกได้");
  }
}
