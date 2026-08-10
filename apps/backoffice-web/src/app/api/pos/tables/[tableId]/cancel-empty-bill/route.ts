import { fail, ok } from "@/lib/http";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { invalidatePosScopeRuntimeCaches } from "@/lib/pos-cache-invalidation";
import { cancelEmptyTableBillSession } from "@/lib/services/table-service";

export async function POST(_req: Request, context: { params: Promise<{ tableId: string }> }) {
  const startedAt = Date.now();
  const withTiming = (response: Response) => {
    response.headers.set("x-pos-cancel-empty-bill-ms", String(Date.now() - startedAt));
    return response;
  };

  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "tables:manage" });
    await requirePosApiFeature(auth, "table_management");
    const { tableId } = await context.params;
    if (!tableId) return withTiming(fail("invalid_table_id", "tableId is required.", 422));

    const result = await cancelEmptyTableBillSession({ auth, tableId });
    if (!result.ok) return withTiming(fail(result.code, result.message, result.status));

    invalidatePosScopeRuntimeCaches({ tenantId: auth.tenantId!, branchId: auth.branchId! });
    return withTiming(ok(result.data, 200));
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return withTiming(featureError);
    return withTiming(fail("empty_bill_cancel_failed", error instanceof Error ? error.message : "Unknown error", 400));
  }
}
