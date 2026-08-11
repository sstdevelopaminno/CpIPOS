import type { AuthContext } from "@/lib/auth-context";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type JsonRecord = Record<string, unknown>;
export type PrinterPurpose = "receipt" | "kitchen" | "drink" | "bar" | "reprint" | "shift_report" | "payment_slip" | "cash_drawer";
export type CustomerConnectionMode = "lan" | "usb" | "bluetooth";
export type PrinterAssignmentInput = {
  purpose: PrinterPurpose;
  zoneKey?: string | null;
  isDefault?: boolean;
  copies?: number;
};

export type SyncPrinterDeviceInput = {
  printerProfileId: string;
  displayName: string;
  brand?: string | null;
  model?: string | null;
  connectionMode: CustomerConnectionMode;
  paperWidthMm: 58 | 80;
  purposes: PrinterPurpose[];
  assignments?: PrinterAssignmentInput[];
  deviceFingerprint?: string | null;
  runtimeDeviceCode?: string | null;
  capabilities?: JsonRecord;
  metadata?: JsonRecord;
  eventType?: "connected" | "reconnected" | "updated" | "status_changed";
};

function ensureManagerOrOwner(auth: AuthContext) {
  if (auth.branchRole !== "manager" && auth.branchRole !== "owner") throw new Error("forbidden_role");
}

function clean(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function uniquePurposes(values: PrinterPurpose[]) {
  return Array.from(new Set(values));
}

function normalizeZoneKey(value: unknown) {
  return clean(value)?.toUpperCase() ?? "";
}

function normalizeAssignments(input: SyncPrinterDeviceInput) {
  const source = input.assignments?.length
    ? input.assignments
    : uniquePurposes(input.purposes).map((purpose) => ({ purpose, zoneKey: "", isDefault: false, copies: 1 }));
  const byKey = new Map<string, Required<PrinterAssignmentInput>>();
  for (const assignment of source) {
    const purpose = assignment.purpose;
    const zoneKey = purpose === "kitchen" || purpose === "drink" || purpose === "bar" ? normalizeZoneKey(assignment.zoneKey) : "";
    const key = `${purpose}:${zoneKey}`;
    byKey.set(key, {
      purpose,
      zoneKey,
      isDefault: assignment.isDefault === true,
      copies: Math.max(1, Math.min(20, Math.trunc(Number(assignment.copies) || 1)))
    });
  }
  return Array.from(byKey.values());
}

async function syncKitchenZoneDefaults(auth: AuthContext, printerProfileId: string, assignments: Array<Required<PrinterAssignmentInput>>) {
  const supabase = getSupabaseServiceClient();
  const assignedZoneCodes = Array.from(new Set(assignments
    .filter((assignment) => assignment.purpose === "kitchen" || assignment.purpose === "drink" || assignment.purpose === "bar")
    .map((assignment) => assignment.zoneKey ?? "")
    .filter((zoneCode) => Boolean(zoneCode))));

  if (assignedZoneCodes.length > 0) {
    const { data: zones, error: zoneError } = await supabase
      .from("kitchen_zones")
      .select("id,zone_code")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("is_active", true)
      .in("zone_code", assignedZoneCodes);
    if (zoneError) throw new Error(zoneError.message);
    const foundCodes = new Set((zones ?? []).map((zone) => String(zone.zone_code).toUpperCase()));
    const missingZone = assignedZoneCodes.find((zoneCode) => !foundCodes.has(zoneCode));
    if (missingZone) throw new Error(`printer_zone_invalid:${missingZone}`);
  }

  const { data: existingMappedZones, error: existingError } = await supabase
    .from("kitchen_zones")
    .select("id,zone_code")
    .eq("tenant_id", auth.tenantId!)
    .eq("branch_id", auth.branchId!)
    .eq("default_printer_id", printerProfileId);
  if (existingError) throw new Error(existingError.message);

  const keep = new Set(assignedZoneCodes);
  const staleIds = (existingMappedZones ?? [])
    .filter((zone) => !keep.has(String(zone.zone_code).toUpperCase()))
    .map((zone) => String(zone.id));
  if (staleIds.length > 0) {
    const { error: clearError } = await supabase
      .from("kitchen_zones")
      .update({ default_printer_id: null, updated_at: new Date().toISOString() })
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .in("id", staleIds);
    if (clearError) throw new Error(clearError.message);
  }

  if (assignedZoneCodes.length > 0) {
    const { error: assignError } = await supabase
      .from("kitchen_zones")
      .update({ default_printer_id: printerProfileId, updated_at: new Date().toISOString() })
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .in("zone_code", assignedZoneCodes);
    if (assignError) throw new Error(assignError.message);
  }
}

export async function getPrinterSettingsRegistry(auth: AuthContext) {
  ensureManagerOrOwner(auth);
  const supabase = getSupabaseServiceClient();
  const [
    { data: branch },
    { data: devices, error: deviceError },
    { data: history, error: historyError },
    { data: profiles, error: profileError },
    { data: kitchenZones, error: kitchenZoneError }
  ] = await Promise.all([
    supabase.from("branches").select("id,code,name").eq("tenant_id", auth.tenantId!).eq("id", auth.branchId!).maybeSingle(),
    supabase
      .from("printer_devices")
      .select("id,printer_profile_id,display_name,brand,model,connection_mode,paper_width_mm,device_fingerprint,runtime_device_code,status,capabilities,last_seen_at,disconnected_at,is_active,metadata,created_at,updated_at,printer_device_assignments(id,purpose,zone_key,is_enabled,is_default,copies,metadata)")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("is_active", true)
      .not("printer_profile_id", "is", null)
      .order("updated_at", { ascending: false }),
    supabase
      .from("printer_device_history")
      .select("id,printer_device_id,printer_profile_id,event_type,device_name,brand,model,connection_mode,paper_width_mm,details,created_at")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("printer_profiles")
      .select("id,ip_address,port,enabled")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!),
    supabase
      .from("kitchen_zones")
      .select("id,zone_code,zone_name,display_order,is_active,default_printer_id")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("is_active", true)
      .order("display_order", { ascending: true })
      .order("zone_name", { ascending: true })
  ]);
  if (deviceError) throw new Error(deviceError.message);
  if (historyError) throw new Error(historyError.message);
  if (profileError) throw new Error(profileError.message);
  if (kitchenZoneError) throw new Error(kitchenZoneError.message);

  const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  const currentDevices = (devices ?? []).flatMap((device) => {
    const profileId = device.printer_profile_id;
    if (!profileId) return [];
    const profile = profileMap.get(profileId);
    if (!profile) return [];
    return [{
      ...device,
      ip_address: profile.ip_address ?? null,
      port: profile.port ?? null,
      profile_enabled: profile.enabled !== false
    }];
  });
  const activeProfileIds = new Set(currentDevices.map((device) => device.printer_profile_id));
  const decoratedHistory = (history ?? []).map((item) => {
    const profileId = item.printer_profile_id;
    return {
      ...item,
      can_reconnect: Boolean(profileId && profileMap.has(profileId) && !activeProfileIds.has(profileId))
    };
  });

  return {
    branch: branch ?? { id: auth.branchId, code: null, name: "สาขาปัจจุบัน" },
    devices: currentDevices,
    history: decoratedHistory,
    kitchen_zones: kitchenZones ?? []
  };
}

export async function syncPrinterDevice(auth: AuthContext, input: SyncPrinterDeviceInput) {
  ensureManagerOrOwner(auth);
  const supabase = getSupabaseServiceClient();
  const now = new Date().toISOString();
  const fingerprint = clean(input.deviceFingerprint);
  const payload = {
    tenant_id: auth.tenantId!, branch_id: auth.branchId!, printer_profile_id: input.printerProfileId,
    display_name: input.displayName.trim(), brand: clean(input.brand), model: clean(input.model), connection_mode: input.connectionMode,
    paper_width_mm: input.paperWidthMm, device_fingerprint: fingerprint, runtime_device_code: clean(input.runtimeDeviceCode),
    status: "checking", capabilities: input.capabilities ?? {}, is_active: true, disconnected_at: null,
    metadata: input.metadata ?? {}, created_by: auth.userId, updated_at: now
  };
  const { data: existing } = await supabase.from("printer_devices").select("id").eq("tenant_id", auth.tenantId!).eq("branch_id", auth.branchId!).eq("printer_profile_id", input.printerProfileId).maybeSingle();
  const query = existing?.id
    ? supabase.from("printer_devices").update(payload).eq("id", existing.id)
    : supabase.from("printer_devices").insert(payload);
  const { data: device, error } = await query.select("id,printer_profile_id,display_name,brand,model,connection_mode,paper_width_mm,status,capabilities,last_seen_at,is_active,metadata,created_at,updated_at").single();
  if (error) throw new Error(error.message);

  const assignments = normalizeAssignments(input);
  await syncKitchenZoneDefaults(auth, input.printerProfileId, assignments);

  const { error: assignmentDeleteError } = await supabase.from("printer_device_assignments").delete().eq("printer_device_id", device.id).eq("tenant_id", auth.tenantId!).eq("branch_id", auth.branchId!);
  if (assignmentDeleteError) throw new Error(assignmentDeleteError.message);
  if (assignments.length) {
    const { error: assignmentError } = await supabase.from("printer_device_assignments").insert(assignments.map((assignment) => ({
      tenant_id: auth.tenantId!,
      branch_id: auth.branchId!,
      printer_device_id: device.id,
      purpose: assignment.purpose,
      zone_key: assignment.zoneKey,
      is_enabled: true,
      is_default: assignment.isDefault,
      copies: assignment.copies
    })));
    if (assignmentError) throw new Error(assignmentError.message);
  }
  const purposes = uniquePurposes(assignments.map((assignment) => assignment.purpose));
  await appendPrinterDeviceHistory(auth, {
    printerDeviceId: device.id, printerProfileId: input.printerProfileId, eventType: input.eventType ?? (existing ? "updated" : "connected"),
    deviceName: input.displayName, brand: input.brand, model: input.model, connectionMode: input.connectionMode,
    paperWidthMm: input.paperWidthMm, details: { assignments, purposes, fingerprint, runtime_device_code: clean(input.runtimeDeviceCode) }
  });
  return device;
}

async function setPrinterConnectionState(auth: AuthContext, printerProfileId: string, connected: boolean) {
  ensureManagerOrOwner(auth);
  const supabase = getSupabaseServiceClient();
  const [{ data: profile, error: profileReadError }, { data: device, error: deviceReadError }] = await Promise.all([
    supabase
      .from("printer_profiles")
      .select("id,enabled")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("id", printerProfileId)
      .maybeSingle(),
    supabase
      .from("printer_devices")
      .select("id,display_name,brand,model,connection_mode,paper_width_mm")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("printer_profile_id", printerProfileId)
      .maybeSingle()
  ]);
  if (profileReadError) throw new Error(profileReadError.message);
  if (deviceReadError) throw new Error(deviceReadError.message);
  if (!profile) throw new Error("printer_not_found");
  if (!device) throw new Error("printer_device_not_found");

  const previousEnabled = profile.enabled !== false;
  const { error: profileUpdateError } = await supabase
    .from("printer_profiles")
    .update({ enabled: connected })
    .eq("tenant_id", auth.tenantId!)
    .eq("branch_id", auth.branchId!)
    .eq("id", printerProfileId);
  if (profileUpdateError) throw new Error(profileUpdateError.message);

  const now = new Date().toISOString();
  const { data: updatedDevice, error: deviceUpdateError } = await supabase
    .from("printer_devices")
    .update({
      status: connected ? "checking" : "disconnected",
      is_active: connected,
      disconnected_at: connected ? null : now,
      updated_at: now
    })
    .eq("tenant_id", auth.tenantId!)
    .eq("branch_id", auth.branchId!)
    .eq("id", device.id)
    .select("id,printer_profile_id,display_name,brand,model,connection_mode,paper_width_mm,status,capabilities,last_seen_at,disconnected_at,is_active,metadata,created_at,updated_at")
    .single();

  if (deviceUpdateError) {
    const { error: compensationError } = await supabase
      .from("printer_profiles")
      .update({ enabled: previousEnabled })
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("id", printerProfileId);
    if (compensationError) console.error("printer_connection_state_compensation_failed", compensationError.message);
    throw new Error(deviceUpdateError.message);
  }

  try {
    await appendPrinterDeviceHistory(auth, {
      printerDeviceId: device.id,
      printerProfileId,
      eventType: connected ? "reconnected" : "disconnected",
      deviceName: device.display_name,
      brand: device.brand,
      model: device.model,
      connectionMode: device.connection_mode,
      paperWidthMm: device.paper_width_mm,
      details: { profile_enabled: connected }
    });
  } catch (historyError) {
    console.error("printer_connection_history_write_failed", historyError);
  }

  return updatedDevice;
}

export async function disconnectPrinterDevice(auth: AuthContext, printerProfileId: string) {
  return setPrinterConnectionState(auth, printerProfileId, false);
}

export async function reconnectPrinterDevice(auth: AuthContext, printerProfileId: string) {
  return setPrinterConnectionState(auth, printerProfileId, true);
}

export async function recordPrinterDeviceActionHistory(auth: AuthContext, printerProfileId: string, eventType: string, details: JsonRecord = {}) {
  ensureManagerOrOwner(auth);
  const supabase = getSupabaseServiceClient();
  const { data: device, error } = await supabase
    .from("printer_devices")
    .select("id,display_name,brand,model,connection_mode,paper_width_mm")
    .eq("tenant_id", auth.tenantId!)
    .eq("branch_id", auth.branchId!)
    .eq("printer_profile_id", printerProfileId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!device) return false;
  await appendPrinterDeviceHistory(auth, {
    printerDeviceId: device.id,
    printerProfileId,
    eventType,
    deviceName: device.display_name,
    brand: device.brand,
    model: device.model,
    connectionMode: device.connection_mode,
    paperWidthMm: device.paper_width_mm,
    details
  });
  return true;
}

export async function markPrinterDeviceDeleted(auth: AuthContext, printerProfileId: string) {
  ensureManagerOrOwner(auth);
  const supabase = getSupabaseServiceClient();
  const { data: device, error: readError } = await supabase.from("printer_devices").select("id,display_name,brand,model,connection_mode,paper_width_mm").eq("tenant_id", auth.tenantId!).eq("branch_id", auth.branchId!).eq("printer_profile_id", printerProfileId).maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!device) return;
  await appendPrinterDeviceHistory(auth, { printerDeviceId: device.id, printerProfileId, eventType: "deleted", deviceName: device.display_name, brand: device.brand, model: device.model, connectionMode: device.connection_mode, paperWidthMm: device.paper_width_mm, details: {} });
  const { error: zoneClearError } = await supabase.from("kitchen_zones").update({ default_printer_id: null, updated_at: new Date().toISOString() }).eq("tenant_id", auth.tenantId!).eq("branch_id", auth.branchId!).eq("default_printer_id", printerProfileId);
  if (zoneClearError) throw new Error(zoneClearError.message);
  const { error } = await supabase.from("printer_devices").update({ is_active: false, status: "disconnected", disconnected_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("tenant_id", auth.tenantId!).eq("branch_id", auth.branchId!).eq("id", device.id);
  if (error) throw new Error(error.message);
}

export async function appendPrinterDeviceHistory(auth: AuthContext, input: { printerDeviceId?: string | null; printerProfileId?: string | null; eventType: string; deviceName: string; brand?: string | null; model?: string | null; connectionMode?: string | null; paperWidthMm?: number | null; details?: JsonRecord }) {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("printer_device_history").insert({ tenant_id: auth.tenantId!, branch_id: auth.branchId!, printer_device_id: input.printerDeviceId ?? null, printer_profile_id: input.printerProfileId ?? null, event_type: input.eventType, device_name: input.deviceName, brand: clean(input.brand), model: clean(input.model), connection_mode: input.connectionMode ?? null, paper_width_mm: input.paperWidthMm ?? null, details: input.details ?? {}, created_by: auth.userId });
  if (error) throw new Error(error.message);
}
