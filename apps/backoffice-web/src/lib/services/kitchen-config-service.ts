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
  description?: string | null;
  display_order?: number;
  is_active?: boolean;
  kds_enabled?: boolean;
  default_printer_id?: string | null;
  category_names?: string[];
};

type ZoneKdsInput = {
  action: "zone.kds";
  zone_id: string;
  kds_enabled: boolean;
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

type ZoneRotateCodeInput = {
  action: "zone.rotate_access_code";
  zone_id: string;
};

type RoutesReplaceInput = {
  action: "routes.replace";
  scope_type: "product" | "category" | "default";
  zone_ids: string[];
  product_id?: string | null;
  category_name?: string | null;
};

export type KitchenConfigMutation =
  | ZoneUpsertInput
  | ZoneKdsInput
  | ZonePrinterInput
  | ZoneDisableInput
  | ZoneRotateCodeInput
  | RoutesReplaceInput;

type KitchenPrinterCandidate = {
  id: string;
  printer_name: string;
  printer_role?: string | null;
  connection_type?: string | null;
  ip_address?: string | null;
  port?: number | null;
  paper_width_mm: 58 | 80;
  enabled: boolean;
  metadata?: unknown;
};

function requireScope(auth: AuthContext) {
  if (!auth.tenantId || !auth.branchId) {
    throw new KitchenConfigError("missing_scope", "Tenant and branch scope are required.", 401);
  }
  return { tenantId: auth.tenantId, branchId: auth.branchId };
}

function auditRole(auth: AuthContext) {
  return (auth.branchRole ?? auth.platformRole ?? "staff") as "owner" | "manager" | "staff" | "accountant";
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

function uniqueCategories(values: string[] | undefined) {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function isKitchenCapablePrinter(printer: Pick<KitchenPrinterCandidate, "printer_role" | "metadata">) {
  if (printer.printer_role === "kitchen") return true;
  const metadata = asRecord(printer.metadata);
  const capabilities = asRecord(metadata.capabilities);
  if (capabilities.kitchen === true) return true;
  const printFunctions = Array.isArray(metadata.print_functions) ? metadata.print_functions : [];
  return printFunctions.some((item) => String(item).trim().toLowerCase() === "kitchen");
}

async function requireKitchenPrinter(args: { tenantId: string; branchId: string; printerId: string }) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("printer_profiles")
    .select("id,printer_name,printer_role,connection_type,paper_width_mm,enabled,metadata")
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .eq("id", args.printerId)
    .eq("enabled", true)
    .maybeSingle<KitchenPrinterCandidate>();

  if (error) throw new KitchenConfigError("printer_query_failed", error.message, 500);
  if (!data || !isKitchenCapablePrinter(data)) {
    throw new KitchenConfigError("invalid_kitchen_printer", "The selected printer is not an enabled Kitchen-capable printer in this branch.", 422);
  }
  return data;
}

async function syncZonePrinterAssignment(args: { tenantId: string; branchId: string; zoneCode: string; printerId: string | null }) {
  const supabase = getSupabaseServiceClient();
  const zoneCode = normalizeZoneCode(args.zoneCode);
  const { error: clearError } = await supabase
    .from("printer_device_assignments")
    .delete()
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .eq("purpose", "kitchen")
    .eq("zone_key", zoneCode);
  if (clearError) throw new KitchenConfigError("kitchen_printer_assignment_sync_failed", clearError.message, 500);
  if (!args.printerId) return;

  const { data: device, error: deviceError } = await supabase
    .from("printer_devices")
    .select("id")
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .eq("printer_profile_id", args.printerId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (deviceError) throw new KitchenConfigError("kitchen_printer_device_query_failed", deviceError.message, 500);
  if (!device) return;

  const { error: assignmentError } = await supabase.from("printer_device_assignments").insert({
    tenant_id: args.tenantId,
    branch_id: args.branchId,
    printer_device_id: device.id,
    purpose: "kitchen",
    zone_key: zoneCode,
    is_enabled: true,
    is_default: true,
    copies: 1
  });
  if (assignmentError) throw new KitchenConfigError("kitchen_printer_assignment_sync_failed", assignmentError.message, 500);
}

async function replaceCategoryRoute(args: { tenantId: string; branchId: string; categoryName: string; zoneIds: string[]; actorUserId: string }) {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.rpc("replace_kitchen_routes", {
    p_tenant_id: args.tenantId,
    p_branch_id: args.branchId,
    p_scope_type: "category",
    p_zone_ids: args.zoneIds,
    p_product_id: null,
    p_category_name: args.categoryName,
    p_actor_user_id: args.actorUserId
  });
  if (error) throw new KitchenConfigError("kitchen_routes_replace_failed", error.message, 500);
}

async function syncZoneCategories(args: { tenantId: string; branchId: string; zoneId: string; categoryNames: string[]; actorUserId: string }) {
  const supabase = getSupabaseServiceClient();
  const desired = uniqueCategories(args.categoryNames);
  const { data: currentRows, error } = await supabase
    .from("kitchen_routing_rules")
    .select("category_name")
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .eq("zone_id", args.zoneId)
    .eq("is_active", true)
    .is("product_id", null)
    .not("category_name", "is", null);
  if (error) throw new KitchenConfigError("kitchen_routes_query_failed", error.message, 500);

  const current = uniqueCategories((currentRows ?? []).map((row) => String(row.category_name ?? "")));
  const desiredSet = new Set(desired.map((category) => category.toLowerCase()));
  for (const category of current) {
    if (!desiredSet.has(category.toLowerCase())) {
      await replaceCategoryRoute({ tenantId: args.tenantId, branchId: args.branchId, categoryName: category, zoneIds: [], actorUserId: args.actorUserId });
    }
  }
  for (const category of desired) {
    await replaceCategoryRoute({ tenantId: args.tenantId, branchId: args.branchId, categoryName: category, zoneIds: [args.zoneId], actorUserId: args.actorUserId });
  }
}

const KITCHEN_ZONE_SELECT_WITH_ACCESS_CODE = "id,access_code,zone_code,zone_name,kds_enabled,display_order,is_active,default_printer_id,metadata,created_at,updated_at";
const KITCHEN_ZONE_SELECT_BASE = "id,zone_code,zone_name,kds_enabled,display_order,is_active,default_printer_id,metadata,created_at,updated_at";

function isMissingAccessCodeError(error: { message?: string; code?: string } | null | undefined) {
  return Boolean(error?.message?.includes("kitchen_zones.access_code") || error?.message?.includes("access_code does not exist"));
}

async function selectKitchenZones(args: { tenantId: string; branchId: string }) {
  const supabase = getSupabaseServiceClient();
  const withAccessCode = await supabase
    .from("kitchen_zones")
    .select(KITCHEN_ZONE_SELECT_WITH_ACCESS_CODE)
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .order("display_order", { ascending: true })
    .order("zone_name", { ascending: true });

  if (!isMissingAccessCodeError(withAccessCode.error)) return withAccessCode;

  const fallback = await supabase
    .from("kitchen_zones")
    .select(KITCHEN_ZONE_SELECT_BASE)
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .order("display_order", { ascending: true })
    .order("zone_name", { ascending: true });

  return {
    data: (fallback.data ?? []).map((zone) => ({ ...zone, access_code: null })),
    error: fallback.error
  };
}

export async function loadKitchenConfiguration(auth: AuthContext) {
  assertKitchenManager(auth);
  const { tenantId, branchId } = requireScope(auth);
  const supabase = getSupabaseServiceClient();

  const [zonesResult, rulesResult, printersResult, productsResult] = await Promise.all([
    selectKitchenZones({ tenantId, branchId }),
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
    if (result.error) throw new KitchenConfigError("kitchen_config_query_failed", result.error.message, 500);
  }

  const products = (productsResult.data ?? []) as Array<{ id: string; name: string; category: string | null; is_active: boolean }>;
  const categories = Array.from(new Set(products.map((product) => String(product.category ?? "").trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "th")
  );
  const kitchenPrinters = ((printersResult.data ?? []) as KitchenPrinterCandidate[]).filter(
    (printer) => printer.enabled && isKitchenCapablePrinter(printer)
  );

  return {
    zones: zonesResult.data ?? [],
    routing_rules: rulesResult.data ?? [],
    kitchen_printers: kitchenPrinters,
    products,
    categories
  };
}

export async function mutateKitchenConfiguration(auth: AuthContext, input: KitchenConfigMutation) {
  assertKitchenManager(auth);
  const { tenantId, branchId } = requireScope(auth);
  const supabase = getSupabaseServiceClient();
  const actorRole = auditRole(auth);

  if (input.action === "zone.upsert") {
    const zoneCode = normalizeZoneCode(input.zone_code);
    const zoneName = normalizeZoneName(input.zone_name);
    const displayOrder = Number.isFinite(Number(input.display_order)) ? Math.trunc(Number(input.display_order)) : 0;
    const printerId = input.default_printer_id?.trim() || null;
    if (printerId) await requireKitchenPrinter({ tenantId, branchId, printerId });

    const metadata = input.description?.trim() ? { description: input.description.trim() } : {};
    const payload = {
      zone_code: zoneCode,
      zone_name: zoneName,
      display_order: displayOrder,
      is_active: input.is_active ?? true,
      kds_enabled: input.kds_enabled ?? true,
      default_printer_id: printerId,
      metadata,
      updated_at: new Date().toISOString()
    };

    const query = input.zone_id?.trim()
      ? supabase.from("kitchen_zones").update(payload).eq("tenant_id", tenantId).eq("branch_id", branchId).eq("id", input.zone_id.trim())
      : supabase.from("kitchen_zones").insert({ ...payload, tenant_id: tenantId, branch_id: branchId, created_by: auth.userId });

    const { data, error } = await query.select(KITCHEN_ZONE_SELECT_BASE).maybeSingle();
    if (error) throw new KitchenConfigError("kitchen_zone_save_failed", error.message, 500);
    if (!data) throw new KitchenConfigError("kitchen_zone_not_found", "Kitchen zone was not found in this branch.", 404);

    await syncZonePrinterAssignment({ tenantId, branchId, zoneCode: data.zone_code, printerId });
    if (input.category_names) {
      await syncZoneCategories({ tenantId, branchId, zoneId: String(data.id), categoryNames: input.category_names, actorUserId: auth.userId });
    }

    void appendAuditLog({
      tenantId,
      branchId,
      actorUserId: auth.userId,
      actorRole,
      action: input.zone_id ? "kitchen_zone_updated" : "kitchen_zone_created",
      targetTable: "kitchen_zones",
      targetId: String(data.id),
      metadata: {
        zone_code: zoneCode,
        zone_name: zoneName,
        kds_enabled: data.kds_enabled,
        default_printer_id: printerId,
        category_names: input.category_names ?? null
      }
    });
    return { zone: data };
  }

  if (input.action === "zone.kds") {
    const zoneId = input.zone_id.trim();
    if (!zoneId) throw new KitchenConfigError("invalid_zone_id", "zone_id is required.", 422);
    const kdsEnabled = input.kds_enabled === true;
    const { data, error } = await supabase
      .from("kitchen_zones")
      .update({ kds_enabled: kdsEnabled, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .eq("id", zoneId)
      .select("id,zone_code,zone_name,kds_enabled,is_active,default_printer_id")
      .maybeSingle();
    if (error) throw new KitchenConfigError("kitchen_kds_update_failed", error.message, 500);
    if (!data) throw new KitchenConfigError("kitchen_zone_not_found", "Kitchen zone was not found in this branch.", 404);

    void appendAuditLog({
      tenantId,
      branchId,
      actorUserId: auth.userId,
      actorRole,
      action: "kitchen_zone_kds_changed",
      targetTable: "kitchen_zones",
      targetId: zoneId,
      metadata: { zone_code: data.zone_code, kds_enabled: data.kds_enabled }
    });
    return { zone: data };
  }

  if (input.action === "zone.printer") {
    const zoneId = input.zone_id.trim();
    if (!zoneId) throw new KitchenConfigError("invalid_zone_id", "zone_id is required.", 422);
    const printerId = input.printer_id?.trim() || null;
    if (printerId) await requireKitchenPrinter({ tenantId, branchId, printerId });

    const { data, error } = await supabase
      .from("kitchen_zones")
      .update({ default_printer_id: printerId, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .eq("id", zoneId)
      .select("id,zone_code,zone_name,default_printer_id")
      .maybeSingle();
    if (error) throw new KitchenConfigError("kitchen_printer_mapping_failed", error.message, 500);
    if (!data) throw new KitchenConfigError("kitchen_zone_not_found", "Kitchen zone was not found in this branch.", 404);

    await syncZonePrinterAssignment({ tenantId, branchId, zoneCode: data.zone_code, printerId });

    void appendAuditLog({
      tenantId,
      branchId,
      actorUserId: auth.userId,
      actorRole,
      action: "kitchen_zone_printer_mapped",
      targetTable: "kitchen_zones",
      targetId: zoneId,
      metadata: { printer_id: printerId, zone_code: data.zone_code }
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

    const { error: assignmentCleanupError } = await supabase
      .from("printer_device_assignments")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .eq("zone_key", String(data.zone_code).toUpperCase());
    if (assignmentCleanupError) throw new KitchenConfigError("kitchen_zone_assignment_cleanup_failed", assignmentCleanupError.message, 500);

    void appendAuditLog({ tenantId, branchId, actorUserId: auth.userId, actorRole, action: "kitchen_zone_disabled", targetTable: "kitchen_zones", targetId: zoneId });
    return { zone: data };
  }

  if (input.action === "zone.rotate_access_code") {
    const zoneId = input.zone_id.trim();
    if (!zoneId) throw new KitchenConfigError("invalid_zone_id", "zone_id is required.", 422);
    const { data, error } = await supabase.rpc("rotate_kitchen_zone_access_code", {
      p_tenant_id: tenantId,
      p_branch_id: branchId,
      p_zone_id: zoneId,
      p_actor_user_id: auth.userId
    });
    if (error) throw new KitchenConfigError("kitchen_zone_access_code_rotate_failed", error.message, 500);
    const row = Array.isArray(data) ? data[0] : data;
    void appendAuditLog({ tenantId, branchId, actorUserId: auth.userId, actorRole, action: "kitchen_zone_access_code_rotated", targetTable: "kitchen_zones", targetId: zoneId });
    return { zone: row };
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
    const status = message.includes("NOT_FOUND") ? 404 : message.includes("INVALID") || message.includes("REQUIRED") || message.includes("SINGLE_ZONE") ? 422 : 500;
    throw new KitchenConfigError("kitchen_routes_replace_failed", message, status);
  }

  void appendAuditLog({
    tenantId,
    branchId,
    actorUserId: auth.userId,
    actorRole,
    action: "kitchen_routes_updated",
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
