import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { consumeLoginContext } from "@/lib/server/login-context";
import { createPosSession, createSessionHandoffToken, resolveSessionCookieConfig } from "@/lib/server/pos-session";
import { clearPreEntryFlowState, hasFlowStage, readPreEntryFlowState } from "@/lib/server/pre-entry-state";

type MembershipRow = { role: string };
type UserProfileRow = { is_active: boolean };

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ data: null, error: { code, message } }, { status });
}

export async function POST() {
  const cookieStore = await cookies();
  const flow = readPreEntryFlowState(cookieStore);
  if (!flow || !hasFlowStage(flow, ["employee_verified"]) || !flow.branchId || !flow.userId || String(flow.userRole ?? "").trim().toLowerCase() !== "kitchen" || !flow.permissions?.includes("pos.kitchen.access")) {
    return jsonError(401, "missing_kitchen_context", "กรุณายืนยันตัวตนพนักงานครัวอีกครั้ง");
  }

  try {
    const supabase = getSupabaseServiceClient();
    const [membershipResult, userResult] = await Promise.all([
      supabase.from("user_branch_roles").select("role").eq("tenant_id", flow.tenantId).eq("branch_id", flow.branchId).eq("user_id", flow.userId).maybeSingle<MembershipRow>(),
      supabase.from("users_profiles").select("is_active").eq("id", flow.userId).maybeSingle<UserProfileRow>()
    ]);

    if (membershipResult.error || userResult.error) return jsonError(500, "kitchen_session_lookup_failed", "ไม่สามารถตรวจสอบสิทธิ์พนักงานครัวได้");
    if (String(membershipResult.data?.role ?? "").trim().toLowerCase() !== "kitchen" || userResult.data?.is_active !== true) {
      return jsonError(403, "kitchen_role_required", "บัญชีนี้ไม่ได้รับสิทธิ์พนักงานครัวในสาขานี้");
    }

    const contextResult = await supabase.from("pos_login_contexts").insert({
      tenant_id: flow.tenantId,
      branch_id: flow.branchId,
      store_code: flow.storeCode,
      device_code: null,
      status: "active",
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      metadata: { context_type: "pre_entry_kitchen_role", employee_user_id: flow.userId, employee_role: "kitchen", employee_auth_method: flow.employeeAuthMethod ?? "employee_code", device_selection_bypassed: true }
    }).select("id").single<{ id: string }>();
    if (contextResult.error || !contextResult.data?.id) return jsonError(500, "context_create_failed", "ไม่สามารถสร้างบริบทการเข้าสู่ระบบครัวได้");

    const contextId = contextResult.data.id;
    const sessionCreated = await createPosSession({ tenantId: flow.tenantId, branchId: flow.branchId, deviceId: null, deviceCode: null, userId: flow.userId, role: "kitchen", loginContextId: contextId, loginMethod: "staff_card", metadata: { source: "pre_entry_kitchen_role", employee_auth_method: flow.employeeAuthMethod ?? "employee_code", employee_code: flow.employeeCode ?? null, device_selection_bypassed: true } });
    if (!sessionCreated.ok) return jsonError(500, sessionCreated.code, "ไม่สามารถสร้าง Kitchen POS Session ได้");

    void consumeLoginContext(contextId).catch(() => undefined);
    const token = createSessionHandoffToken({ sessionId: sessionCreated.session.id, tenantId: flow.tenantId, branchId: flow.branchId, userId: flow.userId, role: "kitchen" });
    const cookieConfig = resolveSessionCookieConfig();
    const response = NextResponse.json({ data: { redirect_to: "/preview/pos/kitchen", session_id: sessionCreated.session.id }, error: null });
    response.cookies.set({ name: cookieConfig.name, value: token, httpOnly: true, secure: cookieConfig.secure, sameSite: "lax", path: "/", domain: cookieConfig.domain, maxAge: 120 });
    response.cookies.set({ name: cookieConfig.sessionIdName, value: sessionCreated.session.id, httpOnly: true, secure: cookieConfig.secure, sameSite: "lax", path: "/", domain: cookieConfig.domain, maxAge: cookieConfig.sessionMaxAgeSeconds });
    clearPreEntryFlowState(response);
    return response;
  } catch (error) {
    console.error("[auth/kitchen/session] unexpected error", { tenantId: flow.tenantId, branchId: flow.branchId, userId: flow.userId, error: error instanceof Error ? error.message : "Unknown error" });
    return jsonError(500, "kitchen_session_failed", "ไม่สามารถเข้าสู่ระบบครัวได้");
  }
}
