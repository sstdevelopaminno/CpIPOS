import { ok } from "@/lib/api/response";
import { clearMobileSessionCookie, readMobileSession } from "@/lib/auth/session";
import { clearMobileFlow, createMobileFlow, writeMobileFlow } from "@/lib/auth/mobile-flow";
import { getEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/server";
import { appendMobileAuditLog } from "@/lib/audit/mobile-audit-log";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type LogoutAction = "logout" | "switch_branch" | "switch_device";

type TenantRow = {
  id: string;
  code: string | null;
  name: string | null;
  display_name: string | null;
};

type BranchRow = {
  id: string;
  code: string | null;
  name: string | null;
};

type UserProfileRow = {
  full_name: string | null;
};

function parseAction(value: unknown): LogoutAction {
  if (value === "switch_branch" || value === "switch_device") return value;
  return "logout";
}

function loginContextExpiresAt() {
  return new Date(Date.now() + getEnv().MOBILE_LOGIN_CONTEXT_TTL_MINUTES * 60 * 1000).toISOString();
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { action?: unknown };
  const action = parseAction(body.action);
  const scope = await readMobileSession();
  const supabase = createServiceClient();

  if (scope) {
    const { data: session } = await supabase
      .from("pos_sessions")
      .select("id,metadata")
      .eq("id", scope.sessionId)
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .maybeSingle<{ id: string; metadata: Record<string, unknown> | null }>();
    const sourceApp = String(session?.metadata?.source_app ?? "");
    const isMobileOwnedSession = sourceApp === "CpIPOS Mobile" || sourceApp === "mobile_web";

    if (isMobileOwnedSession) {
      await supabase
        .from("pos_sessions")
        .update({ status: "revoked", revoked_at: new Date().toISOString() })
        .eq("id", scope.sessionId)
        .eq("tenant_id", scope.tenantId)
        .eq("branch_id", scope.branchId);
    }

    await appendMobileAuditLog({
      scope,
      action: isMobileOwnedSession ? "mobile_session_revoked" : "mobile_session_cookie_cleared_shared_web_kept",
      targetTable: "pos_sessions",
      targetId: scope.sessionId,
      module: "auth",
      metadata: {
        logout_action: action,
        source_app: "CpIPOS Mobile",
        mobile_owned_session: isMobileOwnedSession,
        shared_web_session_kept: !isMobileOwnedSession,
      },
    });
  }

  await clearMobileSessionCookie();

  if ((action === "switch_branch" || action === "switch_device") && scope) {
    const [{ data: tenant }, { data: branch }, { data: profile }] = await Promise.all([
      supabase
        .from("tenants")
        .select("id,code,name,display_name")
        .eq("id", scope.tenantId)
        .maybeSingle<TenantRow>(),
      supabase
        .from("branches")
        .select("id,code,name")
        .eq("id", scope.branchId)
        .eq("tenant_id", scope.tenantId)
        .maybeSingle<BranchRow>(),
      supabase
        .from("users_profiles")
        .select("full_name")
        .eq("id", scope.userId)
        .maybeSingle<UserProfileRow>(),
    ]);

    if (tenant?.id && tenant.code) {
      if (action === "switch_branch") {
        const response = ok({ loggedOut: true, action, redirectTo: "/login/branch" });
        writeMobileFlow(response, createMobileFlow({
          stage: "store_verified",
          contextId: "",
          tenantId: tenant.id,
          tenantCode: tenant.code,
          tenantName: tenant.display_name || tenant.name || tenant.code,
          branchId: null,
          branchCode: null,
          branchName: null,
          userId: null,
          employeeCode: null,
          employeeName: null,
          role: null,
          deviceId: null,
          deviceCode: null,
          deviceName: null,
        }));
        return response;
      }

      if (branch?.id && scope.role) {
        const { data: context } = await supabase
          .from("pos_login_contexts")
          .insert({
            tenant_id: tenant.id,
            branch_id: branch.id,
            store_code: tenant.code,
            status: "active",
            expires_at: loginContextExpiresAt(),
            metadata: { source_app: "CpIPOS Mobile", source_channel: "mobile_web", reason: "switch_cashier_device" },
          })
          .select("id")
          .single<{ id: string }>();

        if (context?.id) {
          const response = ok({ loggedOut: true, action, redirectTo: "/login/device" });
          writeMobileFlow(response, createMobileFlow({
            stage: "employee_verified",
            contextId: context.id,
            tenantId: tenant.id,
            tenantCode: tenant.code,
            tenantName: tenant.display_name || tenant.name || tenant.code,
            branchId: branch.id,
            branchCode: branch.code,
            branchName: branch.name,
            userId: scope.userId,
            employeeCode: null,
            employeeName: profile?.full_name ?? scope.userId,
            role: scope.role,
            deviceId: null,
            deviceCode: null,
            deviceName: null,
          }));
          return response;
        }
      }
    }
  }

  const response = ok({ loggedOut: true, action: "logout", redirectTo: "/login/store" });
  clearMobileFlow(response);
  return response;
}
