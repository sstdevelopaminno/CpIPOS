import "server-only";

import type { AuthContext } from "@/lib/auth-context";
import { appendAuditLog } from "@/lib/audit-log";
import { assertKitchenManager, KitchenConfigError } from "@/lib/services/kitchen-config-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export type KitchenKdsZoneSetting = {
  id: string;
  zone_code: string;
  zone_name: string;
  display_order: number;
  is_active: boolean;
  kds_enabled: boolean;
  categories: string[];
  products: Array<{ id: string; name: string }>;
};

function requireScope(auth: AuthContext) {
  assertKitchenManager(auth);
  if (!auth.tenantId || !auth.branchId) {
    throw new KitchenConfigError("missing_scope", "Tenant and branch scope are required.", 401);
  }
  return { tenantId: auth.tenantId, branchId: auth.branchId };
}

export async function loadKitchenKdsSettings(auth: AuthContext) {
  const { tenantId, branchId } = requireScope(auth);
  const supabase = getSupabaseServiceClient();
  const [zonesResult, rulesResult, productsResult] = await Promise.all([
    supabase
      .from("kitchen_zones")
      .select("id,zone_code,zone_name,display_order,is_active,kds_enabled")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .order("display_order", { ascending: true })
      .order("zone_name", { ascending: true }),
    supabase
      .from("kitchen_routing_rules")
      .select("zone_id,product_id,category_name,is_active")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .eq("is_active", true),
    supabase
      .from("products")
      .select("id,name")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .eq("is_active", true)
  ]);

  for (const result of [zonesResult, rulesResult, productsResult]) {
    if (result.error) throw new KitchenConfigError("kitchen_kds_settings_query_failed", result.error.message, 500);
  }

  const productNames = new Map(
    (productsResult.data ?? []).map((product) => [String((product as { id: string }).id), String((product as { name: string }).name)])
  );
  const rulesByZone = new Map<string, Array<{ product_id: string | null; category_name: string | null }>>();
  for (const rule of rulesResult.data ?? []) {
    const row = rule as { zone_id: string; product_id: string | null; category_name: string | null };
    const list = rulesByZone.get(row.zone_id) ?? [];
    list.push(row);
    rulesByZone.set(row.zone_id, list);
  }

  const zones: KitchenKdsZoneSetting[] = (zonesResult.data ?? []).map((zoneValue) => {
    const zone = zoneValue as {
      id: string;
      zone_code: string;
      zone_name: string;
      display_order: number;
      is_active: boolean;
      kds_enabled: boolean;
    };
    const rules = rulesByZone.get(zone.id) ?? [];
    const categories = Array.from(
      new Set(rules.map((rule) => String(rule.category_name ?? "").trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b, "th"));
    const products = rules
      .map((rule) => rule.product_id)
      .filter((id): id is string => Boolean(id))
      .map((id) => ({ id, name: productNames.get(id) ?? id }))
      .sort((a, b) => a.name.localeCompare(b.name, "th"));

    return {
      id: zone.id,
      zone_code: zone.zone_code,
      zone_name: zone.zone_name,
      display_order: Number(zone.display_order ?? 0),
      is_active: zone.is_active !== false,
      kds_enabled: zone.kds_enabled !== false,
      categories,
      products
    };
  });

  return { zones };
}

export async function setKitchenZoneKdsEnabled(auth: AuthContext, zoneId: string, enabled: boolean) {
  const { tenantId, branchId } = requireScope(auth);
  const normalizedZoneId = zoneId.trim();
  if (!normalizedZoneId) throw new KitchenConfigError("invalid_zone_id", "zone_id is required.", 422);

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("kitchen_zones")
    .update({ kds_enabled: enabled, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("id", normalizedZoneId)
    .select("id,zone_code,zone_name,is_active,kds_enabled")
    .maybeSingle();
  if (error) throw new KitchenConfigError("kitchen_kds_setting_save_failed", error.message, 500);
  if (!data) throw new KitchenConfigError("kitchen_zone_not_found", "Kitchen zone was not found in this branch.", 404);

  void appendAuditLog({
    tenantId,
    branchId,
    actorUserId: auth.userId,
    actorRole: auth.branchRole ?? auth.platformRole,
    action: "kitchen_zone_kds_setting_changed",
    targetTable: "kitchen_zones",
    targetId: normalizedZoneId,
    metadata: { kds_enabled: enabled }
  });

  return data;
}
