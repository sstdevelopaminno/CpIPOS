import { getAuthContext, type AuthContext } from "@/lib/auth-context";
import { DEVICE_COMMAND_TTL_MS } from "@/lib/device-commands";
import { fail, ok } from "@/lib/http";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type BranchDeviceRow = {
  id: string;
  device_code: string;
  device_name: string;
  device_type: string;
  status: string;
  is_active: boolean;
  last_seen_at: string | null;
  metadata: Record<string, unknown> | null;
};

type DeviceHealthRow = {
  pos_device_id: string | null;
  device_code: string;
  status: string;
  runtime_version: string | null;
  app_version: string | null;
  runtime_health: Record<string, unknown> | null;
  peripheral_health: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  captured_at: string;
  last_seen_at: string;
};

type DeviceCommandRow = {
  id: string;
  pos_device_id: string;
  status: string;
  issued_at: string;
  delivered_at: string | null;
  result: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
};

type TestRequest = {
  device_code?: string | null;
};

function ensureManagerOrOwner(auth: AuthContext) {
  if (auth.branchRole !== "manager" && auth.branchRole !== "owner") throw new Error("forbidden_role");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nativePrinterFromHealth(health: DeviceHealthRow | null) {
  const metadata = asRecord(health?.metadata);
  const diagnostics = asRecord(metadata.native_android_diagnostics);
  const printer = asRecord(diagnostics.printer);
  const lastCommand = asRecord(diagnostics.last_command);
  return {
    configured_host: clean(printer.configured_host),
    configured_port: typeof printer.configured_port === "number" ? printer.configured_port : null,
    last_reachable: typeof printer.last_reachable === "boolean" ? printer.last_reachable : null,
    last_error: clean(printer.last_error),
    last_command_action: clean(lastCommand.action),
    last_command_source: clean(lastCommand.source),
    last_command_at_ms: typeof lastCommand.at_ms === "number" ? lastCommand.at_ms : null
  };
}

function surfaceFromHealth(health: DeviceHealthRow | null) {
  const metadata = asRecord(health?.metadata);
  return clean(metadata.telemetry_profile) ?? clean(metadata.native_android_bridge) ?? "unknown";
}

export async function GET() {
  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    ensureManagerOrOwner(auth);
    const supabase = getSupabaseServiceClient();

    const [{ data: devices, error: deviceError }, { data: healthRows, error: healthError }, { data: commands, error: commandError }] = await Promise.all([
      supabase
        .from("branch_devices")
        .select("id,device_code,device_name,device_type,status,is_active,last_seen_at,metadata")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!)
        .eq("is_active", true)
        .order("last_seen_at", { ascending: false, nullsFirst: false })
        .returns<BranchDeviceRow[]>(),
      supabase
        .from("pos_device_health_latest")
        .select("pos_device_id,device_code,status,runtime_version,app_version,runtime_health,peripheral_health,metadata,captured_at,last_seen_at")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!)
        .order("last_seen_at", { ascending: false })
        .returns<DeviceHealthRow[]>(),
      supabase
        .from("device_commands")
        .select("id,pos_device_id,status,issued_at,delivered_at,result,metadata")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!)
        .eq("command_type", "test_printer")
        .order("issued_at", { ascending: false })
        .limit(100)
        .returns<DeviceCommandRow[]>()
    ]);

    if (deviceError) throw new Error(deviceError.message);
    if (healthError) throw new Error(healthError.message);
    if (commandError) throw new Error(commandError.message);

    const latestHealthByDevice = new Map<string, DeviceHealthRow>();
    for (const row of healthRows ?? []) {
      if (row.pos_device_id && !latestHealthByDevice.has(row.pos_device_id)) latestHealthByDevice.set(row.pos_device_id, row);
    }
    const latestCommandByDevice = new Map<string, DeviceCommandRow>();
    for (const row of commands ?? []) {
      if (!latestCommandByDevice.has(row.pos_device_id)) latestCommandByDevice.set(row.pos_device_id, row);
    }

    return ok({
      devices: (devices ?? []).map((device) => {
        const health = latestHealthByDevice.get(device.id) ?? null;
        const latestCommand = latestCommandByDevice.get(device.id) ?? null;
        return {
          id: device.id,
          device_code: device.device_code,
          device_name: device.device_name,
          device_type: device.device_type,
          status: device.status,
          is_active: device.is_active,
          last_seen_at: health?.last_seen_at ?? device.last_seen_at,
          health_status: health?.status ?? null,
          surface: surfaceFromHealth(health),
          runtime_version: health?.runtime_version ?? null,
          app_version: health?.app_version ?? null,
          native_printer: nativePrinterFromHealth(health),
          peripheral_health: health?.peripheral_health ?? {},
          latest_test_command: latestCommand
        };
      })
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    if (message === "forbidden_role") return fail("forbidden_role", "Only manager or owner can access MDM printer testing.", 403);
    return fail("mdm_printer_devices_failed", "ไม่สามารถโหลดเครื่อง POS ผ่าน MDM ได้", 400);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    ensureManagerOrOwner(auth);
    const body = (await req.json().catch(() => ({}))) as TestRequest;
    const deviceCode = clean(body.device_code);
    if (!deviceCode) return fail("device_code_required", "device_code is required", 422);

    const supabase = getSupabaseServiceClient();
    const { data: device, error: deviceError } = await supabase
      .from("branch_devices")
      .select("id,device_code,device_name,status,is_active")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("device_code", deviceCode)
      .eq("is_active", true)
      .maybeSingle<{ id: string; device_code: string; device_name: string; status: string; is_active: boolean }>();

    if (deviceError) throw new Error(deviceError.message);
    if (!device) return fail("device_not_found", "ไม่พบเครื่อง POS นี้ในสาขาปัจจุบัน", 404);

    const now = new Date();
    const { data: command, error: insertError } = await supabase
      .from("device_commands")
      .insert({
        tenant_id: auth.tenantId!,
        branch_id: auth.branchId!,
        pos_device_id: device.id,
        command_type: "test_printer",
        status: "pending",
        issued_by_user_id: auth.userId,
        issued_at: now.toISOString(),
        expires_at: new Date(now.getTime() + Math.min(DEVICE_COMMAND_TTL_MS, 5 * 60_000)).toISOString(),
        result: {},
        metadata: {
          source: "printer_settings_mdm",
          safe_action: "test_printer_connection",
          device_code: device.device_code,
          device_name: device.device_name
        }
      })
      .select("id,command_type,status,issued_at,expires_at")
      .single();

    if (insertError || !command) throw new Error(insertError?.message ?? "command_insert_failed");

    return ok({
      device: { id: device.id, device_code: device.device_code, device_name: device.device_name },
      command
    }, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    if (message === "forbidden_role") return fail("forbidden_role", "Only manager or owner can test printers through MDM.", 403);
    return fail("mdm_printer_test_failed", "ไม่สามารถส่งคำสั่งทดสอบเครื่องพิมพ์ผ่าน MDM ได้", 400);
  }
}
