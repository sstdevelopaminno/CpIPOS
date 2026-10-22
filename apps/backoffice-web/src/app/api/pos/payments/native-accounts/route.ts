import { NextResponse } from "next/server";
import type { AuthContext } from "@/lib/auth-context";
import { PosGuardError, requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { loadPosSettingsSnapshot } from "@/lib/services/pos-settings-service";

/**
 * Narrow, read-only cashier projection of the SAME tenant payment accounts
 * configured by the tablet POS. No settings-management permission or writes.
 */
export async function GET() {
  try {
    const scope = await requirePosSession();
    requirePermission(scope, "sale:create");
    const branchId = scope.session.branch_id;
    const auth: AuthContext = {
      userId: scope.session.user_id,
      tenantId: scope.session.tenant_id,
      branchId,
      branchRole: scope.session.role === "owner" || scope.session.role === "manager" ||
        scope.session.role === "accountant" ? scope.session.role : "staff",
      platformRole: "tenant_user"
    };
    const snapshot = await loadPosSettingsSnapshot(auth);
    const accounts = snapshot.payment_accounts
      .filter((account) => account.is_active &&
        (account.branch_id === branchId || account.applies_to_all_branches))
      .sort((a, b) => {
        const aSpecific = a.branch_id === branchId && !a.applies_to_all_branches ? 0 : 1;
        const bSpecific = b.branch_id === branchId && !b.applies_to_all_branches ? 0 : 1;
        return aSpecific - bSpecific;
      })
      .map((account) => ({
        id: account.id,
        bank_name: account.bank_name,
        account_name: account.account_name,
        account_number: account.account_number,
        promptpay_phone: account.promptpay_phone,
        qr_image_url: account.qr_image_url,
        qr_mode: account.qr_mode
      }));
    return NextResponse.json({ data: { accounts }, error: null }, {
      headers: { "Cache-Control": "private, no-store" }
    });
  } catch (error) {
    if (error instanceof PosGuardError) {
      return NextResponse.json({
        data: null, error: { code: error.code, message: error.message }
      }, { status: error.status });
    }
    return NextResponse.json({
      data: null,
      error: { code: "native_payment_accounts_failed", message: "Unable to load payment accounts." }
    }, { status: 500 });
  }
}
