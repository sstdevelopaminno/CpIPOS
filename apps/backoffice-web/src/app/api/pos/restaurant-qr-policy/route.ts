import { fail, ok } from "@/lib/http";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { loadRestaurantQrKitchenFlagsForScope } from "@/lib/services/restaurant-qr-kitchen-profile-service";

// The cashier needs the same effective review policy as public QR submissions.
// Settings API requires settings:view and must not be used by sales-only staff.
export async function GET() {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "sales:view" });
    const flags = await loadRestaurantQrKitchenFlagsForScope({
      tenantId: auth.tenantId!,
      branchId: auth.branchId!
    });
    return ok({ cashier_review_required: flags.qr_pos_review_required });
  } catch (error) {
    return fail("cashier_review_policy_unavailable", error instanceof Error ? error.message : "Unable to read cashier review policy.", 503);
  }
}
