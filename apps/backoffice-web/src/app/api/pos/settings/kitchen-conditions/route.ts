import { fail, ok } from "@/lib/http";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import {
  loadKitchenConditionsForScope,
  saveKitchenConditionsPolicy
} from "@/lib/services/kitchen-conditions-service";

function isManager(role: string | null) {
  return role === "owner" || role === "manager";
}

export async function GET() {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "settings:view" });
    if (!isManager(auth.branchRole) && auth.platformRole !== "it_admin") {
      return fail("forbidden_role", "Only owner or manager can view kitchen conditions.", 403);
    }
    const policy = await loadKitchenConditionsForScope({ tenantId: auth.tenantId!, branchId: auth.branchId! });
    return ok({ policy });
  } catch (error) {
    return fail("kitchen_conditions_load_failed", error instanceof Error ? error.message : "Unable to load kitchen conditions.", 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "settings:view" });
    if (!isManager(auth.branchRole) && auth.platformRole !== "it_admin") {
      return fail("forbidden_role", "Only owner or manager can change kitchen conditions.", 403);
    }
    const body = (await request.json().catch(() => null)) as { lock_confirmed_items_on_pos?: unknown } | null;
    if (typeof body?.lock_confirmed_items_on_pos !== "boolean") {
      return fail("invalid_payload", "lock_confirmed_items_on_pos must be a boolean.", 422);
    }
    const policy = await saveKitchenConditionsPolicy(auth, body.lock_confirmed_items_on_pos);
    return ok({ policy });
  } catch (error) {
    return fail("kitchen_conditions_save_failed", error instanceof Error ? error.message : "Unable to save kitchen conditions.", 500);
  }
}
