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
    if (role === "kitchen") {
      return {
        userId: scope.session.user_id,
        tenantId: scope.session.tenant_id,
        branchId: scope.session.branch_id,
        branchRole: "staff",
        platformRole: "tenant_user",
        printerSettingsRole: "kitchen"
      };
    }
  } catch (error) {
    if (error instanceof PosGuardError && error.status !== 401) throw error;
  }

  return getAuthContext({ requireBranchScope: true });
}
