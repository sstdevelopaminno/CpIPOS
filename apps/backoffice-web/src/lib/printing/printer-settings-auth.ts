import "server-only";

import { getAuthContext, type AuthContext } from "@/lib/auth-context";
import { PosGuardError, requirePosSession } from "@/lib/pos-session-guard";

export type PrinterSettingsAuthContext = AuthContext & {
  printerSettingsRole?: "kitchen";
};

export async function getPrinterSettingsAuthContext(): Promise<PrinterSettingsAuthContext> {
  try {
    const scope = await requirePosSession();
    const role = String(scope.session.role ?? "").trim().toLowerCase();

    if (role === "owner" || role === "manager") {
      return {
        userId: scope.session.user_id,
        tenantId: scope.session.tenant_id,
        branchId: scope.session.branch_id,
        branchRole: role,
        platformRole: "tenant_user"
      };
    }

    if (role === "kitchen") {
      return {
        userId: scope.session.user_id,
        tenantId: scope.session.tenant_id,
        branchId: scope.session.branch_id,
        // Existing printer services intentionally require manager/owner. This
        // compatibility role exists only inside printer routes after the real
        // POS session has been revalidated as Kitchen above; it is never added
        // to the global auth context, so other Backoffice APIs remain closed.
        branchRole: "manager",
        platformRole: "tenant_user",
        printerSettingsRole: "kitchen"
      };
    }

    // A valid POS session with any other role must not fall back to a broader
    // Backoffice auth context. Fail closed inside the branch/session that was
    // already authenticated by the POS runtime.
    throw new Error("forbidden_role");
  } catch (error) {
    // No active POS session: preserve the existing Backoffice entry path.
    if (error instanceof PosGuardError && error.status === 401) {
      return getAuthContext({ requireBranchScope: true });
    }
    throw error;
  }
}
