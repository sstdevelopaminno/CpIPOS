import { getAuthContext } from "@/lib/auth-context";
import { fail, ok } from "@/lib/http";
import { KitchenConfigError } from "@/lib/services/kitchen-config-service";
import {
  loadKitchenKdsSettings,
  setKitchenZoneKdsEnabled
} from "@/lib/services/kitchen-kds-settings-service";

function configFail(error: unknown) {
  if (error instanceof KitchenConfigError) {
    return fail(error.code, error.message, error.status);
  }
  return fail("kitchen_kds_settings_failed", error instanceof Error ? error.message : "Unknown Kitchen KDS settings error.", 400);
}

export async function GET() {
  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    return ok(await loadKitchenKdsSettings(auth));
  } catch (error) {
    return configFail(error);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    const body = (await req.json().catch(() => null)) as { zone_id?: string; kds_enabled?: boolean } | null;
    const zoneId = String(body?.zone_id ?? "").trim();
    if (!zoneId || typeof body?.kds_enabled !== "boolean") {
      return fail("invalid_kitchen_kds_settings_payload", "zone_id and kds_enabled are required.", 422);
    }
    return ok({ zone: await setKitchenZoneKdsEnabled(auth, zoneId, body.kds_enabled) });
  } catch (error) {
    return configFail(error);
  }
}
