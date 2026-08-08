import "server-only";

import type { AuthContext } from "@/lib/auth-context";
import { appendAuditLog } from "@/lib/audit-log";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export class KitchenConfigError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "KitchenConfigError";
    this.code = code;
    this.status = status;
  }
}

type ZoneUpsertInput = {
  action: "zone.upsert";
  zone_id?: string | null;
  zone_code: string;
  zone_name: string;
  display_order?: number;
  is_active?: boolean;
};

type ZonePrinterInput = {
  action: "zone.printer";
  zone_id: string;
  printer_id: string | null;
};

type ZoneDisableInput = {
  action: "zone.disable";
  zone_id: string;
};

type RoutesReplaceInput = {
  action: "routes.replace";
  scope_type: "product" | "category" | "default";
  zone_ids: string[];
  product_id?: string | null;
  category_name?: string | null;
};

export type KitchenConfigMutation = ZoneUpsertInput | ZonePrinterInput | ZoneDisableInput | RoutesReplaceInput;

function requireScope(auth: AuthContext) {
  if (!auth.tenantId || !auth.branchId) {
    throw new KitchenConfigError("missing_scope", "Tenant and branch scope are required.", 401);
  }
  return { tenantId: auth.tenantId, branchId: auth.branchId };
}

export function assertKitchenManager(auth: AuthContext) {
  requireScope(auth);
  if (auth.platformRole === "it_admin") return;
  if (auth.branchRole !== "owner" && auth.branchRole !== "manager") {
    throw new KitchenConfigError("kitchen_manage_forbidden", "Owner or manager access is required for Kitchen configuration.", 403);
  }
}

function normalizeZoneCode(value: string) {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{1,32}$/.test(code)) {
    throw new KitchenConfigError("invalid_zone_code", "Kitchen zone code must use A-Z, 0-9, underscore, or hyphen (max 32 characters).", 422);
  }
  return code;
}

function normalizeZoneName(value: string) {
  const name = value.trim();
  if (!name || name.length > 120) {
    throw new KitchenConfigError("invalid_zone_name", "Kitchen zone name is required and must be at most 120 characters.", 422);
  }
  return name;
}

function uniqueIds(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

async function requireKitchenPrinter(args: { tenantId: string; branchId: string; printerId: string }) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("printer_profiles")
    .select("id,printer_name,connection_type,paper_width_mm,enabled")
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .eq("id", args.printerId)
    .eq("printer_role", "kitchen")
    .eq("enabled", true)
    .maybeSingle();

  if (error) {
    throw new KitchenConfigError("printer_query_failed", error.message, 500);
  }
  if (!data) {
    throw new KitchenConfigError("invalid_kitchen_printer", "The selected printer is not an enabled Kitchen printer in this branch.", 422);
  }
  return data;
}

export async function loadKitchenConfiguration(auth: AuthContext) {
  assertKitchenManager(auth);
  const { tenantId, branchId } = requireScope(auth);
  const supabase = getSupabaseServiceClient();

  const [zonesResult, rulesResult, printersResult, productsResult] = await Promise.all([
    supabase
      .from("kitchen_zones")
      .select("id,zone_code,zone_name,display_order,is_active,default_printer_id,metadata,created_at,updated_at")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .order("display_order", { ascending: true })
      .order("zone_name", { ascending: true }),
    supabase
      .from("kitchen_routing_rules")
      .select("id,zone_id,product_id,category_name,priority,is_active,metadata,created_at,updated_at")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .order("priority", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("printer_profiles")
      .select("id,printer_name,printer_role,connection_type,ip_address,port,paper_width_mm,enabled,metadata")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .eq("printer_role", "kitchen")
      .order("printer_name", { ascending: true }),
    supabase
      .from("products")
      .select("id,name,category,is_active")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .order("category", { ascending: true })
      .order("name", { ascending: true })
  ]);

  for (const result of [zonesResult, rulesResult, printersResult, productsResult]) {
    if (result.error) {
      throw new KitchenConfigError("kitchen_config_query_failed", result.error.message, 500);
    }
  }

  const products = (productsResult.data ?? []) as Array<{ id: string; name: string; category: string | null; is_active: boolean }>;
  const categories = Array.from(new Set(products.map((product) => String(product.category ?? "").trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "th")
  );

  return {
    zones: zonesResult.data ?? [],
    routing_rules: rulesResult.data ?? [],
    kitchen_printers: printersResult.data ?? [],
    products,
    categories
  };
}

export async function mutateKitchenConfiguration(auth: AuthContext, input: KitchenConfigMutation) {
  assertKitchenManager(auth);
  const { tenantId, branchId } = requireScope(auth);
  const supabase = getSupabaseServiceClient();
  const actorRole = auth.branchRole ?? auth.platformRole;

  if (input.action === "zone.upsert") {
    const zoneCode = normalizeZoneCode(input.zone_code);
    const zoneName = normalizeZoneName(input.zone_name);
    const displayOrder = Number.isFinite(Number(input.display_order)) ? Math.trunc(Number(input.display_order)) : 0;
    const payload = {
      zone_code: zoneCode,
      zone_name: zoneName,
      display_order: displayOrder,
      is_active: input.is_active ?? true,
      updated_at: new Date().toISOString()
    };

    const query = input.zone_id?.trim()
      ? supabase
          .from("kitchen_zones")
          .update(payload)
          .eq("tenant_id", tenantId)
          .eq("branch_id", branchId)
          .eq("id", input.zone_id.trim())
      : supabase.from("kitchen_zones").insert({ ...payload, tenant_id: tenantId, branch_id: branchId, created_by: auth.userId });

    const { data, error } = await query
      .select("id,zone_code,zone_name,display_order,is_active,default_printer_id,metadata,created_at,updated_at")
      .maybeSingle();
    if (error) {
      throw new KitchenConfigError("kitchen_zone_save_failed", error.message, 500);
    }
    if (!data) {
      throw new KitchenConfigError("kitchen_zone_not_found", "Kitchen zone was not found in this branch.", 404);
    }

    void appendAuditLog({
      tenantId,
      branchId,
      actorUserId: auth.userId,
      actorRole,
      action: input.zone_id ? "kitchen_zone_updated" : "kitchen_zone_created",
      targetTable: "kitchen_zones",
      targetId: String(data.id),
      metadata: { zone_code: zoneCode, zone_name: zoneName }
    });
    return { zone: data };
  }

  if (input.action === "zone.printer") {
    const zoneId = input.zone_id.trim();
    if (!zoneId) throw new KitchenConfigError("invalid_zone_id", "zone_id is required.", 422);
    if (input.printer_id) {
      await requireKitchenPrinter({ tenantId, branchId, printerId: input.printer_id.trim() });
    }

    const { data, error } = await supabase
      .from("kitchen_zones")
      .update({ default_printer_id: input.printer_id?.trim() || null, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .eq("id", zoneId)
      .select("id,zone_code,zone_name,default_printer_id")
      .maybeSingle();
    if (error) throw new KitchenConfigError("kitchen_printer_mapping_failed", error.message, 500);
    if (!data) throw new KitchenConfigError("kitchen_zone_not_found", "Kitchen zone was not found in this branch.", 404);

    void appendAuditLog({
      tenantId,
      branchId,
      actorUserId: auth.userId,
      actorRole,
      action: "kitchen_zone_printer_mapped",
      targetTable: "kitchen_zones",
      targetId: zoneId,
      metadata: { printer_id: input.printer_id?.trim() || null }
    });
    return { zone: data };
  }

  if (input.action === "zone.disable") {
    const zoneId = input.zone_id.trim();
    if (!zoneId) throw new KitchenConfigError("invalid_zone_id", "zone_id is required.", 422);
    const { data, error } = await supabase
      .from("kitchen_zones")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .eq("id", zoneId)
      .select("id,zone_code,zone_name,is_active")
      .maybeSingle();
    if (error) throw new KitchenConfigError("kitchen_zone_disable_failed", error.message, 500);
    if (!data) throw new KitchenConfigError("kitchen_zone_not_found", "Kitchen zone was not found in this branch.", 404);

    void appendAuditLog({
      tenantId,
      branchId,
      actorUserId: auth.userId,
      actorRole,
      action: "kitchen_zone_disabled",
      targetTable: "kitchen_zones",
      targetId: zoneId
    });
    return { zone: data };
  }

  const zoneIds = uniqueIds(input.zone_ids ?? []);
  const { data, error } = await supabase.rpc("replace_kitchen_routes", {
    p_tenant_id: tenantId,
    p_branch_id: branchId,
    p_scope_type: input.scope_type,
    p_zone_ids: zoneIds,
    p_product_id: input.product_id?.trim() || null,
    p_category_name: input.category_name?.trim() || null,
    p_actor_user_id: auth.userId
  });
  if (error) {
    const message = error.message || "Kitchen routing update failed.";
    const status = message.includes("NOT_FOUND") ? 404 : message.includes("INVALID") || message.includes("REQUIRED") ? 422 : 500;
    throw new KitchenConfigError("kitchen_routes_replace_failed", message, status);
  }

  void appendAuditLog({
    tenantId,
    branchId,
    actorUserId: auth.userId,
    actorRole,
    action: "kitchen_routes_replaced",
    targetTable: "kitchen_routing_rules",
    metadata: {
      scope_type: input.scope_type,
      product_id: input.product_id?.trim() || null,
      category_name: input.category_name?.trim() || null,
      zone_ids: zoneIds
    }
  });

  return { routes: Array.isArray(data) ? data : [] };
}
