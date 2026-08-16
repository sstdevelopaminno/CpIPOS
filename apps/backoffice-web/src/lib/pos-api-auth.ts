import { cookies } from "next/headers";
import type { AuthContext } from "@/lib/auth-context";
import { getAuthContext } from "@/lib/auth-context";
import { PosGuardError, requirePermission, requirePosSession, type PosPermission, type PosSessionScope } from "@/lib/pos-session-guard";
import { resolveSessionCookieConfig } from "@/lib/server/pos-session";

type PosApiAuthInput = {
  requireBranchScope?: boolean;
  requiredPermission?: PosPermission;
  requiredPermissions?: PosPermission[];
};

type KitchenApiAuthInput = {
  requiredPermission?: PosPermission;
};

const posSessionScopeInFlight = new Map<string, Promise<PosSessionScope>>();

function normalizeBranchRole(role: string): AuthContext["branchRole"] {
  if (role === "owner" || role === "manager" || role === "staff" || role === "accountant") {
    return role;
  }
  return "staff";
}

function toAuthContext(scope: PosSessionScope): AuthContext {
  return {
    userId: scope.session.user_id,
    tenantId: scope.session.tenant_id,
    branchId: scope.session.branch_id,
    branchRole: normalizeBranchRole(scope.session.role),
    platformRole: "tenant_user"
  };
}

async function requirePosSessionSingleFlight(): Promise<PosSessionScope> {
  const config = resolveSessionCookieConfig();
  const cookieStore = await cookies();
  const sessionId = String(cookieStore.get(config.sessionIdName)?.value ?? "").trim();

  if (!sessionId) {
    return requirePosSession();
  }

  const existing = posSessionScopeInFlight.get(sessionId);
  if (existing) {
    return existing;
  }

  const pending = requirePosSession();
  posSessionScopeInFlight.set(sessionId, pending);
  try {
    return await pending;
  } finally {
    if (posSessionScopeInFlight.get(sessionId) === pending) {
      posSessionScopeInFlight.delete(sessionId);
    }
  }
}

export async function getPosApiAuthContext(input: PosApiAuthInput = {}): Promise<AuthContext> {
  const { requireBranchScope = true, requiredPermission, requiredPermissions } = input;
  const permissions = [...(requiredPermission ? [requiredPermission] : []), ...(requiredPermissions ?? [])];

  try {
    const scope = await requirePosSessionSingleFlight();
    if (String(scope.session.role ?? "").trim().toLowerCase() === "kitchen") {
      throw new PosGuardError("forbidden_kitchen_role", "Kitchen role cannot access this POS endpoint.", 403);
    }
    for (const permission of permissions) {
      requirePermission(scope, permission);
    }
    return toAuthContext(scope);
  } catch (error) {
    if (error instanceof PosGuardError && error.code === "forbidden_kitchen_role") {
      throw error;
    }
    if (permissions.length > 0) {
      throw error;
    }
    return getAuthContext({ requireBranchScope });
  }
}

export async function getKitchenApiAuthContext(input: KitchenApiAuthInput = {}): Promise<AuthContext> {
  const scope = await requirePosSessionSingleFlight();
  const role = String(scope.session.role ?? "").trim().toLowerCase();
  if (role !== "owner" && role !== "manager" && role !== "staff" && role !== "kitchen") {
    throw new PosGuardError("kitchen_access_forbidden", "This role cannot access Kitchen endpoints.", 403);
  }
  if (role !== "kitchen" && input.requiredPermission) {
    requirePermission(scope, input.requiredPermission);
  }
  return toAuthContext(scope);
}
