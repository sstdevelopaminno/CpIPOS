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
  machine_id: string | null;
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
  target_surface?: "android" | "windows_runtime";
  action?: "test_printer" | "set_printer";
  machine_id?: string | null;
  printer_name?: string | null;
};

const WINDOWS_HEARTBEAT_FRESH_MS = 5 * 60_000;

function windowsPrinterFromHealth(health: DeviceHealthRow | null) {
  const version = (health?.app_version ?? "").match(/^(\\d+)\\.(\\d+)\\.(\\d+)/);
  const versionParts = version ? version.slice(1).map(Number) : [];
  const printerSelectionSupported = versionParts.length === 3 &&
    (versionParts[0] > 0 || versionParts[1] > 2 || (versionParts[1] === 2 && versionParts[2] >= 0));
  const peripherals = asRecord(health?.peripheral_health);
  const runtime = asRecord(health?.runtime_health);
  const installed = Array.isArray(peripherals.installed_printers)
    ? peripherals.installed_printers.filter((name): name is string => typeof name === "string" && name.length > 0 && name.length <= 128).slice(0, 32)
    : [];
  const lastSeenTime = health?.last_seen_at ? new Date(health.last_seen_at).getTime() : Number.NaN;
  const recent = Number.isFinite(lastSeenTime) && Date.now() - lastSeenTime <= WINDOWS_HEARTBEAT_FRESH_MS;
  return {
    machine_id: health?.machine_id ?? null,
    installed_printers: installed,
    printer_selection_supported: printerSelectionSupported,
    last_seen_at: health?.last_seen_at ?? null,
    bridge_online: recent && runtime.local_bridge_online === true,
    selected_printer: clean(peripherals.selected_printer),
    default_printer: clean(peripherals.default_printer),
    selected_printer_valid: peripherals.selected_printer_valid === true,
    last_error: clean(runtime.last_error)
  };
}

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

    const [{ data: devices, error: deviceError }, { data: commands, error: commandError }] = await Promise.all([
      supabase
        .from("branch_devices")
        .select("id,device_code,device_name,device_type,status,is_active,last_seen_at,metadata")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!)
        .eq("is_active", true)
        .order("last_seen_at", { ascending: false, nullsFirst: false })
        .returns<BranchDeviceRow[]>(),
      supabase
        .from("device_commands")
        .select("id,pos_device_id,status,issued_at,delivered_at,result,metadata")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!)
        .in("command_type", ["test_printer", "set_printer"])
        .order("issued_at", { ascending: false })
        .limit(100)
        .returns<DeviceCommandRow[]>()
    ]);

    if (deviceError) throw new Error(deviceError.message);
    if (commandError) throw new Error(commandError.message);

    const deviceIds = (devices ?? []).map((device) => device.id).filter(Boolean);
    const { data: healthRows, error: healthError } = deviceIds.length
      ? await supabase
          .from("pos_device_health_latest")
          .select("pos_device_id,device_code,status,runtime_version,app_version,machine_id,runtime_health,peripheral_health,metadata,captured_at,last_seen_at")
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", auth.branchId!)
          .in("pos_device_id", deviceIds)
          .order("last_seen_at", { ascending: false })
          .limit(Math.min(500, Math.max(deviceIds.length * 6, 50)))
          .returns<DeviceHealthRow[]>()
      : { data: [], error: null };

    if (healthError) throw new Error(healthError.message);

    const latestHealthByDevice = new Map<string, DeviceHealthRow>();
    const windowsHealthByDevice = new Map<string, DeviceHealthRow>();
    for (const row of healthRows ?? []) {
      if (!row.pos_device_id) continue;
      if (!latestHealthByDevice.has(row.pos_device_id)) latestHealthByDevice.set(row.pos_device_id, row);
      if ((row.runtime_version ?? "").toLowerCase().startsWith("cpipos-windows") && !windowsHealthByDevice.has(row.pos_device_id)) {
        windowsHealthByDevice.set(row.pos_device_id, row);
      }
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
          windows_printer: windowsPrinterFromHealth(windowsHealthByDevice.get(device.id) ?? null),
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
    const targetSurface = body.target_surface ?? "android";
    const action = body.action ?? "test_printer";
    if (action !== "test_printer" && action !== "set_printer") {
      return fail("invalid_action", "Unsupported printer MDM command.", 422);
    }
    if (action === "set_printer" && targetSurface !== "windows_runtime") {
      return fail("invalid_action_target", "Remote printer selection is supported for Windows only.", 422);
    }
    if (targetSurface !== "android" && targetSurface !== "windows_runtime") {
      return fail("invalid_target_surface", "Unsupported MDM printer target.", 422);
    }

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

    let selectedMachineId: string | null = null;
    let selectedPrinterName: string | null = null;
    if (targetSurface === "windows_runtime") {
      const requestedMachineId = clean(body.machine_id);
      if (!requestedMachineId || requestedMachineId.length > 160) {
        return fail("windows_machine_id_required", "Select a registered Windows machine.", 422);
      }
      const { data: health, error: healthError } = await supabase
        .from("pos_device_health_latest")
        .select("pos_device_id,device_code,status,runtime_version,app_version,machine_id,runtime_health,peripheral_health,metadata,captured_at,last_seen_at")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!)
        .eq("pos_device_id", device.id)
        .eq("machine_id", requestedMachineId)
        .like("runtime_version", "cpipos-windows%")
        .order("last_seen_at", { ascending: false })
        .limit(1)
        .maybeSingle<DeviceHealthRow>();
      if (healthError) throw new Error(healthError.message);
      const windowsPrinter = windowsPrinterFromHealth(health);
      if (!windowsPrinter.bridge_online) {
        return fail("windows_print_bridge_offline", "Windows Print Bridge is not reporting online in the last 5 minutes.", 409);
      }
      selectedMachineId = requestedMachineId;
      if (action === "set_printer") {
        if (!windowsPrinter.printer_selection_supported) {
          return fail("windows_runtime_upgrade_required", "Windows Web POS 0.2.0 or newer is required for remote printer selection.", 409);
        }
        const printerName = clean(body.printer_name);
        if (!printerName || printerName.length > 128 || !windowsPrinter.installed_printers.includes(printerName)) {
          return fail("printer_not_reported", "Windows has not reported this installed printer. Refresh diagnostics.", 409);
        }
        selectedPrinterName = printerName;
      } else if (!windowsPrinter.selected_printer_valid) {
        return fail("windows_printer_not_selected", "ยังไม่พบเครื่องพิมพ์ที่ Windows Runtime เลือกอย่างถูกต้อง", 409);
      }
    }

    const now = new Date();
    const { data: command, error: insertError } = await supabase
      .from("device_commands")
      .insert({
        tenant_id: auth.tenantId!,
        branch_id: auth.branchId!,
        pos_device_id: device.id,
        command_type: action,
        status: "pending",
        issued_by_user_id: auth.userId,
        issued_at: now.toISOString(),
        expires_at: new Date(now.getTime() + Math.min(DEVICE_COMMAND_TTL_MS, 5 * 60_000)).toISOString(),
        result: {},
        metadata: {
          source: "printer_settings_mdm",
          safe_action: action === "set_printer" ? "select_installed_printer" : "test_printer_connection",
          target_surface: targetSurface,
          ...(selectedMachineId ? { target_machine_id: selectedMachineId } : {}),
          ...(selectedPrinterName ? { printer_name: selectedPrinterName } : {}),
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
    return fail("mdm_printer_command_failed", "ไม่สามารถส่งคำสั่งจัดการเครื่องพิมพ์ผ่าน MDM ได้", 400);
  }
}
