import { fail, ok } from "@/lib/http";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import {
  KitchenQueueError,
  loadKitchenQueue,
  parseKitchenStatuses
} from "@/lib/services/kitchen-queue-service";

export async function GET(req: Request) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "sales:view" });
    const { searchParams } = new URL(req.url);
    const statusParams = searchParams
      .getAll("status")
      .flatMap((value) => value.split(","))
      .map((value) => value.trim())
      .filter(Boolean);
    const statuses = statusParams.length > 0 ? parseKitchenStatuses(statusParams) : undefined;
    const zoneId = searchParams.get("zone_id")?.trim() || null;
    const rawLimit = Number(searchParams.get("limit") ?? 60);
    const limit = Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : 60;

    const result = await loadKitchenQueue({
      tenantId: auth.tenantId!,
      branchId: auth.branchId!,
      statuses,
      zoneId,
      limit
    });
    return ok(result);
  } catch (error) {
    if (error instanceof KitchenQueueError) {
      return fail(error.code, error.message, error.status);
    }
    return fail("kitchen_queue_failed", error instanceof Error ? error.message : "Unknown Kitchen queue error.", 400);
  }
}
