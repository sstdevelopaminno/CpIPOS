import { fail, ok } from "@/lib/http";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import {
  KitchenQueueError,
  transitionKitchenItemStatus,
  type KitchenItemStatus
} from "@/lib/services/kitchen-queue-service";

export async function POST(req: Request, context: { params: Promise<{ itemId: string }> }) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "sale:create" });
    const { itemId } = await context.params;
    const body = (await req.json().catch(() => null)) as { status?: string } | null;
    const status = String(body?.status ?? "").trim().toLowerCase();

    if (!itemId?.trim()) return fail("invalid_kitchen_item_id", "itemId is required.", 422);
    if (status !== "accepted" && status !== "ready") {
      return fail("invalid_kitchen_item_status", "Kitchen item status must be accepted or ready.", 422);
    }

    const item = await transitionKitchenItemStatus({
      auth,
      itemId: itemId.trim(),
      status: status as KitchenItemStatus
    });
    return ok({ item });
  } catch (error) {
    if (error instanceof KitchenQueueError) {
      return fail(error.code, error.message, error.status);
    }
    return fail(
      "kitchen_item_status_failed",
      error instanceof Error ? error.message : "Unknown Kitchen item status error.",
      400
    );
  }
}
