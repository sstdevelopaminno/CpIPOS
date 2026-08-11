import type { AuthContext } from "@/lib/auth-context";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type JsonRecord = Record<string, unknown>;
export type PrinterPurpose = "receipt" | "kitchen" | "drink" | "bar" | "reprint" | "shift_report" | "payment_slip" | "cash_drawer";
export type CustomerConnectionMode = "lan" | "usb" | "bluetooth";

export type SyncPrinterDeviceInput = {
  printerProfileId: string;
  displayName: string;
  brand?: string | null;
  model?: string | null;
  connectionMode: CustomerConnectionMode;
  paperWidthMm: 58 | 80;
  purposes: PrinterPurpose[];
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

export async function getPrinterSettingsRegistry(auth: AuthContext) {
  ensureManagerOrOwner(auth);
  const supabase = getSupabaseServiceClient();
  const [{ data: branch }, { data: devices, error: deviceError }, { data: history, error: historyError }] = await Promise.all([
    supabase.from("branches").select("id,code,name").eq("tenant_id", auth.tenantId!).eq("id", auth.branchId!).maybeSingle(),
    supabase
      .from("printer_devices")
      .select("id,printer_profile_id,display_name,brand,model,connection_mode,paper_width_mm,device_fingerprint,runtime_device_code,status,capabilities,last_seen_at,disconnected_at,is_active,metadata,created_at,updated_at,printer_device_assignments(id,purpose,zone_key,is_enabled,is_default,copies,metadata)")
      .eq("tenant_id", auth.tenantId!).eq("branch_id", auth.branchId!).order("updated_at", { ascending: false }),
    supabase
      .from("printer_device_history")
      .select("id,printer_device_id,printer_profile_id,event_type,device_name,brand,model,connection_mode,paper_width_mm,details,created_at")
      .eq("tenant_id", auth.tenantId!).eq("branch_id", auth.branchId!).order("created_at", { ascending: false }).limit(100)
  ]);
  if (deviceError) throw new Error(deviceError.message);
  if (historyError) throw new Error(historyError.message);
  return { branch: branch ?? { id: auth.branchId, code: null, name: "สาขาปัจจุบัน" }, devices: devices ?? [], history: history ?? [] };
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

  await supabase.from("printer_device_assignments").delete().eq("printer_device_id", device.id).eq("tenant_id", auth.tenantId!).eq("branch_id", auth.branchId!);
  const purposes = uniquePurposes(input.purposes);
  if (purposes.length) {
    const { error: assignmentError } = await supabase.from("printer_device_assignments").insert(purposes.map((purpose) => ({ tenant_id: auth.tenantId!, branch_id: auth.branchId!, printer_device_id: device.id, purpose, zone_key: "", is_enabled: true })));
    if (assignmentError) throw new Error(assignmentError.message);
  }
  await appendPrinterDeviceHistory(auth, {
    printerDeviceId: device.id, printerProfileId: input.printerProfileId, eventType: input.eventType ?? (existing ? "updated" : "connected"),
    deviceName: input.displayName, brand: input.brand, model: input.model, connectionMode: input.connectionMode,
    paperWidthMm: input.paperWidthMm, details: { purposes, fingerprint, runtime_device_code: clean(input.runtimeDeviceCode) }
  });
  return device;
}

export async function disconnectPrinterDevice(auth: AuthContext, printerProfileId: string) {
  ensureManagerOrOwner(auth);
  const supabase = getSupabaseServiceClient();
  const { data: device, error } = await supabase.from("printer_devices").update({ status: "disconnected", is_active: false, disconnected_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("tenant_id", auth.tenantId!).eq("branch_id", auth.branchId!).eq("printer_profile_id", printerProfileId)
    .select("id,display_name,brand,model,connection_mode,paper_width_mm").maybeSingle();
  if (error) throw new Error(error.message);
  if (device) await appendPrinterDeviceHistory(auth, { printerDeviceId: device.id, printerProfileId, eventType: "disconnected", deviceName: device.display_name, brand: device.brand, model: device.model, connectionMode: device.connection_mode, paperWidthMm: device.paper_width_mm, details: {} });
  return device;
}

export async function markPrinterDeviceDeleted(auth: AuthContext, printerProfileId: string) {
  ensureManagerOrOwner(auth);
  const supabase = getSupabaseServiceClient();
  const { data: device } = await supabase.from("printer_devices").select("id,display_name,brand,model,connection_mode,paper_width_mm").eq("tenant_id", auth.tenantId!).eq("branch_id", auth.branchId!).eq("printer_profile_id", printerProfileId).maybeSingle();
  if (!device) return;
  await appendPrinterDeviceHistory(auth, { printerDeviceId: device.id, printerProfileId, eventType: "deleted", deviceName: device.display_name, brand: device.brand, model: device.model, connectionMode: device.connection_mode, paperWidthMm: device.paper_width_mm, details: {} });
  await supabase.from("printer_devices").update({ is_active: false, status: "disconnected", disconnected_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", device.id);
}

export async function appendPrinterDeviceHistory(auth: AuthContext, input: { printerDeviceId?: string | null; printerProfileId?: string | null; eventType: string; deviceName: string; brand?: string | null; model?: string | null; connectionMode?: string | null; paperWidthMm?: number | null; details?: JsonRecord }) {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("printer_device_history").insert({ tenant_id: auth.tenantId!, branch_id: auth.branchId!, printer_device_id: input.printerDeviceId ?? null, printer_profile_id: input.printerProfileId ?? null, event_type: input.eventType, device_name: input.deviceName, brand: clean(input.brand), model: clean(input.model), connection_mode: input.connectionMode ?? null, paper_width_mm: input.paperWidthMm ?? null, details: input.details ?? {}, created_by: auth.userId });
  if (error) throw new Error(error.message);
}
