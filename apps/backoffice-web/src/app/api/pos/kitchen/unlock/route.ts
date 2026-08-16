import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { fail, ok } from "@/lib/http";
import { getKitchenApiAuthContext } from "@/lib/pos-api-auth";
import { readKitchenZoneSession, writeKitchenZoneSession } from "@/lib/server/kitchen-zone-session";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type KitchenZoneUnlockRow = {
  id: string;
  zone_code: string;
  zone_name: string;
  kds_enabled: boolean;
};

function zoneResponse(zone: KitchenZoneUnlockRow, auth: { tenantId: string; branchId: string }) {
  const response = NextResponse.json({ data: { zone }, error: null });
  writeKitchenZoneSession(response, {
    tenantId: auth.tenantId,
    branchId: auth.branchId,
    kitchenZoneId: zone.id
  });
  return response;
}

export async function GET() {
  try {
    const auth = await getKitchenApiAuthContext();
    const session = readKitchenZoneSession(await cookies(), { tenantId: auth.tenantId!, branchId: auth.branchId! });
    if (!session) return ok({ zone: null });

    const { data, error } = await getSupabaseServiceClient()
      .from("kitchen_zones")
      .select("id,zone_code,zone_name,kds_enabled")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("id", session.kitchen_zone_id)
      .eq("is_active", true)
      .eq("kds_enabled", true)
      .maybeSingle<KitchenZoneUnlockRow>();

    if (error) return fail("kitchen_zone_unlock_query_failed", error.message, 500);
    if (!data) return ok({ zone: null });
    return ok({ zone: data });
  } catch (error) {
    return fail("kitchen_zone_unlock_failed", error instanceof Error ? error.message : "Authentication failed.", 401);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await getKitchenApiAuthContext();
    const body = (await req.json().catch(() => null)) as { access_code?: string } | null;
    const accessCode = String(body?.access_code ?? "").trim();
    if (!/^[0-9]{6}$/.test(accessCode)) {
      return fail("invalid_kitchen_access_code", "Kitchen access code must be 6 digits.", 422);
    }

    const { data, error } = await getSupabaseServiceClient()
      .from("kitchen_zones")
      .select("id,zone_code,zone_name,kds_enabled")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("access_code", accessCode)
      .eq("is_active", true)
      .eq("kds_enabled", true)
      .maybeSingle<KitchenZoneUnlockRow>();

    if (error) return fail("kitchen_zone_unlock_query_failed", error.message, 500);
    if (!data) return fail("kitchen_zone_unlock_invalid", "Kitchen zone was not found or KDS is disabled.", 404);
    return zoneResponse(data, { tenantId: auth.tenantId!, branchId: auth.branchId! });
  } catch (error) {
    return fail("kitchen_zone_unlock_failed", error instanceof Error ? error.message : "Authentication failed.", 401);
  }
}
