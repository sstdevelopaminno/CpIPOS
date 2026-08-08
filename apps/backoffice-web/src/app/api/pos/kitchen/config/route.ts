import { getAuthContext } from "@/lib/auth-context";
import { fail, ok } from "@/lib/http";
import {
  KitchenConfigError,
  loadKitchenConfiguration,
  mutateKitchenConfiguration,
  type KitchenConfigMutation
} from "@/lib/services/kitchen-config-service";

function configFail(error: unknown) {
  if (error instanceof KitchenConfigError) {
    return fail(error.code, error.message, error.status);
  }
  return fail("kitchen_config_failed", error instanceof Error ? error.message : "Unknown Kitchen configuration error.", 400);
}

export async function GET() {
  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    const config = await loadKitchenConfiguration(auth);
    return ok(config);
  } catch (error) {
    return configFail(error);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    const body = (await req.json().catch(() => null)) as KitchenConfigMutation | null;
    if (!body || typeof body !== "object" || !("action" in body)) {
      return fail("invalid_kitchen_config_payload", "Kitchen configuration action is required.", 422);
    }
    if (!["zone.upsert", "zone.printer", "zone.disable", "routes.replace"].includes(String(body.action))) {
      return fail("invalid_kitchen_config_action", "Unsupported Kitchen configuration action.", 422);
    }
    const result = await mutateKitchenConfiguration(auth, body);
    return ok(result);
  } catch (error) {
    return configFail(error);
  }
}
