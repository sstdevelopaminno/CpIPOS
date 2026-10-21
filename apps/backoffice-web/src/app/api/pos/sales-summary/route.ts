import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { authorizeOpticalMoreMenu } from "@/lib/server/optical-more-feature-access";
import { PosGuardError } from "@/lib/pos-session-guard";
import { fail, ok } from "@/lib/http";
import { loadPosSalesSummaryData, type PosSalesSummaryFilters } from "@/lib/services/pos-sales-summary-service";

function readFilters(request: Request): PosSalesSummaryFilters {
  const { searchParams } = new URL(request.url);
  return {
    dateFrom: searchParams.get("dateFrom"),
    dateTo: searchParams.get("dateTo"),
    branchId: searchParams.get("branchId"),
    shiftId: searchParams.get("shiftId"),
    cashierId: searchParams.get("cashierId"),
    paymentMethod: searchParams.get("paymentMethod"),
    status: searchParams.get("status")
  };
}

export async function GET(request: Request) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "reports:view" });
    if (!await authorizeOpticalMoreMenu(auth.tenantId!, auth.branchId, "more.sales_summary")) {
      await requirePosApiFeature(auth, "advanced_sales_reports");
    }
    const payload = await loadPosSalesSummaryData(
      {
        userId: auth.userId,
        tenantId: auth.tenantId,
        branchId: auth.branchId,
        branchRole: auth.branchRole,
        platformRole: auth.platformRole
      },
      readFilters(request)
    );
    return ok(payload);
  } catch (error) {
    if (error instanceof PosGuardError) {
      return fail(error.code, error.message, error.status);
    }
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    return fail(
      "sales_summary_fetch_failed",
      error instanceof Error ? error.message : "Unable to load sales summary.",
      500
    );
  }
}
