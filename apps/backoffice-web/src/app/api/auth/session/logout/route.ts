import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clearPreEntryFlowState, createFlowState, readPreEntryFlowState, writePreEntryFlowState } from "@/lib/server/pre-entry-state";
import { resolveEmployeeByUserId } from "@/lib/server/pre-entry-auth";
import { withAuthTimeout } from "@/lib/server/auth-timeout";
import { PosGuardError, requirePosSession, type PosSessionScope } from "@/lib/pos-session-guard";
import { getRequestMeta, writeAuditLog } from "@/lib/server/audit-log";
import { resolveSessionCookieConfig } from "@/lib/server/pos-session";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type LogoutPayload = {
  mode?: "switch_employee" | "switch_device" | "switch_branch" | "full";
};

function clearPosSessionCookies(response: NextResponse) {
  const config = resolveSessionCookieConfig();
  response.cookies.set({
    name: config.name,
    value: "",
    httpOnly: true,
    secure: config.secure,
    sameSite: "lax",
    path: "/",
    domain: config.domain,
    maxAge: 0
  });
  response.cookies.set({
    name: config.sessionIdName,
    value: "",
    httpOnly: true,
    secure: config.secure,
    sameSite: "lax",
    path: "/",
    domain: config.domain,
    maxAge: 0
  });
}

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ data: null, error: { code, message } }, { status });
}

async function revokePosSessionById(sessionId: string) {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("pos_sessions")
    .update({
      status: "revoked",
      revoked_at: new Date().toISOString()
    })
    .eq("id", sessionId)
    .eq("status", "active");
  if (error) {
    console.warn("[auth/session/logout] revoke session warning", {
      sessionId,
      error: error.message
    });
  }
}

async function writeLogoutAudit(request: Request, scope: PosSessionScope, mode: NonNullable<LogoutPayload["mode"]>) {
  const loggedOutAt = new Date().toISOString();
  const { ipAddress, userAgent } = getRequestMeta(request);

  try {
    await writeAuditLog({
      tenantId: scope.session.tenant_id,
      branchId: scope.session.branch_id,
      actorUserId: scope.session.user_id,
      actorRole: scope.session.role,
      targetUserId: scope.session.user_id,
      deviceCode: scope.session.device_code,
      posSessionId: scope.session.id,
      action: "session_logout",
      targetType: "pos_session",
      targetId: scope.session.id,
      ipAddress,
      userAgent,
      metadata: {
        device_code: scope.session.device_code,
        logout_mode: mode,
        logged_out_at: loggedOutAt
      }
    });
  } catch (error) {
    console.warn("[auth/session/logout] audit warning", {
      sessionId: scope.session.id,
      error: error instanceof Error ? error.message : "Unknown audit error."
    });
  }
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as LogoutPayload | null;
  const mode =
    payload?.mode === "full" ||
    payload?.mode === "switch_employee" ||
    payload?.mode === "switch_device" ||
    payload?.mode === "switch_branch"
      ? payload.mode
      : "switch_employee";

  if (mode === "full") {
    try {
      const scope = await requirePosSession();
      await withAuthTimeout(revokePosSessionById(scope.session.id), "logout_revoke_timeout", 3000);
      await writeLogoutAudit(request, scope, mode);
    } catch {
      // If the browser no longer has a valid POS session cookie, still clear local login state.
    }

    const response = NextResponse.json({
      data: {
        ok: true,
        mode,
        redirect_to: "/login/store"
      },
      error: null
    });
    clearPosSessionCookies(response);
    clearPreEntryFlowState(response);
    return response;
  }

  try {
    const scope = await requirePosSession();
    // A logout/switch action belongs to this browser/device session only. Never revoke
    // every active session owned by the same user; the same employee may be signed in
    // concurrently on other registered devices.
    await revokePosSessionById(scope.session.id);
    await writeLogoutAudit(request, scope, mode);

    if (mode === "switch_branch" || mode === "switch_employee") {
      const [tenantRow, branchRow] = await Promise.all([
        getSupabaseServiceClient()
          .from("tenants")
          .select("name,code")
          .eq("id", scope.session.tenant_id)
          .maybeSingle<{ name: string | null; code: string | null }>(),
        getSupabaseServiceClient()
          .from("branches")
          .select("name,code")
          .eq("id", scope.session.branch_id)
          .maybeSingle<{ name: string | null; code: string | null }>()
      ]);

      const flow = createFlowState({
        stage: mode === "switch_employee" ? "branch_selected" : "store_verified",
        tenantId: scope.session.tenant_id,
        storeCode: String(tenantRow.data?.code ?? "").trim() || "UNKNOWN",
        tenantName: String(tenantRow.data?.name ?? "").trim() || String(tenantRow.data?.code ?? "").trim() || "Store",
        branchId: mode === "switch_employee" ? scope.session.branch_id : null,
        branchCode: mode === "switch_employee" ? (branchRow.data?.code ?? null) : null,
        branchName: mode === "switch_employee" ? (branchRow.data?.name ?? null) : null,
        deviceId: mode === "switch_employee" ? (scope.session.device_id ?? null) : null,
        deviceCode: mode === "switch_employee" ? (scope.session.device_code ?? null) : null,
        userId: null,
        userRole: null,
        employeeCode: null,
        employeeName: null,
        employeeAuthMethod: null,
        permissions: null
      });

      const response = NextResponse.json({
        data: {
          ok: true,
          mode,
          redirect_to: mode === "switch_employee" ? "/login/employee?flow=multi" : "/login/branches?flow=multi"
        },
        error: null
      });
      clearPosSessionCookies(response);
      writePreEntryFlowState(response, flow);
      return response;
    }

    const [employee, tenantRow, branchRow] = await Promise.all([
      resolveEmployeeByUserId({
        tenantId: scope.session.tenant_id,
        branchId: scope.session.branch_id,
        userId: scope.session.user_id
      }),
      getSupabaseServiceClient().from("tenants").select("name,code").eq("id", scope.session.tenant_id).maybeSingle<{ name: string | null; code: string | null }>(),
      getSupabaseServiceClient().from("branches").select("name,code").eq("id", scope.session.branch_id).maybeSingle<{ name: string | null; code: string | null }>()
    ]);

    if (!employee) {
      const response = NextResponse.json({
        data: { ok: true, mode, redirect_to: "/login/employee?flow=multi" },
        error: null
      });
      clearPosSessionCookies(response);
      return response;
    }

    const flow = createFlowState({
      stage: "employee_verified",
      tenantId: scope.session.tenant_id,
      storeCode: String(tenantRow.data?.code ?? "").trim() || "UNKNOWN",
      tenantName: String(tenantRow.data?.name ?? "").trim() || String(tenantRow.data?.code ?? "").trim() || "Store",
      branchId: scope.session.branch_id,
      branchCode: branchRow.data?.code ?? null,
      branchName: branchRow.data?.name ?? null,
      deviceId: null,
      deviceCode: null,
      userId: employee.userId,
      userRole: employee.role,
      employeeCode: employee.employeeCode,
      employeeName: employee.fullName,
      employeeAuthMethod: "employee_code",
      permissions: employee.permissions
    });

    const response = NextResponse.json({
      data: {
        ok: true,
        mode,
        redirect_to: "/login/devices?flow=multi"
      },
      error: null
    });
    clearPosSessionCookies(response);
    writePreEntryFlowState(response, flow);
    return response;
  } catch (error) {
    if (error instanceof PosGuardError) {
      if (mode === "switch_device" || mode === "switch_employee") {
        const flow = readPreEntryFlowState(await cookies());
        if (flow?.tenantId && flow.branchId && flow.userId) {
          // There is no validated current POS session here, so there is no safe session
          // identifier to revoke. In particular, never fall back to revoking all active
          // sessions for this user/branch because those may belong to other devices.
          const response = NextResponse.json({
            data: { ok: true, mode, redirect_to: "/login/employee?flow=multi" },
            error: null
          });
          clearPosSessionCookies(response);
          if (mode === "switch_employee") {
            writePreEntryFlowState(
              response,
              createFlowState({
                ...flow,
                stage: "branch_selected",
                userId: null,
                userRole: null,
                employeeCode: null,
                employeeName: null,
                employeeAuthMethod: null,
                permissions: null
              })
            );
          }
          return response;
        }
      }
      const response = jsonError(error.status, error.code, error.message);
      clearPosSessionCookies(response);
      return response;
    }
    return jsonError(500, "logout_failed", error instanceof Error ? error.message : "Unknown error.");
  }
}
