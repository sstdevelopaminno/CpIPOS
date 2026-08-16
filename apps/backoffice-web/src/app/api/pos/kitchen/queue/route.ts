import { cookies } from "next/headers";
import { fail, ok } from "@/lib/http";
import { getKitchenApiAuthContext } from "@/lib/pos-api-auth";
import { readKitchenZoneSession } from "@/lib/server/kitchen-zone-session";
import {
  KitchenQueueError,
  loadKitchenQueue,
  parseKitchenStatuses
} from "@/lib/services/kitchen-queue-service";

export async function GET(req: Request) {
  try {
    const auth = await getKitchenApiAuthContext();
    const { searchParams } = new URL(req.url);
    const statusParams = searchParams
      .getAll("status")
      .flatMap((value) => value.split(","))
      .map((value) => value.trim())
      .filter(Boolean);
    const statuses = statusParams.length > 0 ? parseKitchenStatuses(statusParams) : undefined;
    const requestedZoneId = searchParams.get("zone_id")?.trim() || null;
    const zoneSession = readKitchenZoneSession(await cookies(), { tenantId: auth.tenantId!, branchId: auth.branchId! });
    if (!zoneSession) {
      return fail("kitchen_zone_session_required", "Kitchen display must be unlocked before loading a zone queue.", 403);
    }
    if (requestedZoneId && requestedZoneId !== zoneSession.kitchen_zone_id) {
      return fail("kitchen_zone_unlock_mismatch", "Kitchen display is unlocked to a different zone.", 403);
    }
    const zoneId = zoneSession.kitchen_zone_id;
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
