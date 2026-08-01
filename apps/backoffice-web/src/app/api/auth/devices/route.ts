import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { AuthTimeoutError, withAuthTimeout } from "@/lib/server/auth-timeout";
import { mapDeviceStatus, type DeviceCandidate, type DeviceSessionOccupancy } from "@/lib/server/pre-entry-auth";
import { hasFlowStage, readPreEntryFlowState } from "@/lib/server/pre-entry-state";
import { resolveStoreLoginMode } from "@/lib/server/store-login-mode";

type SessionRow = {
  id: string;
  device_id: string | null;
  device_code: string | null;
  user_id: string;
  users_profiles: { full_name: string | null } | Array<{ full_name: string | null }> | null;
};

type QueryResult<T> = {
  data: T[] | null;
  error: { message?: string | null } | null;
};

function withTimingHeaders<T extends NextResponse>(response: T, startedAt: number): T {
  const durationMs = Date.now() - startedAt;
  response.headers.set("x-auth-api-ms", String(durationMs));
  response.headers.set("server-timing", `total;dur=${durationMs}`);
  return response;
}

function emptySessionResult(): QueryResult<SessionRow> {
  return { data: [], error: null };
}

async function safeResolveStoreMode(tenantId: string) {
  try {
    return await withAuthTimeout(resolveStoreLoginMode(tenantId), "device_store_mode_lookup_timeout", 5000);
  } catch (error) {
    console.warn("[auth/devices] store mode lookup degraded", {
      tenantId,
      error: error instanceof Error ? error.message : "Unknown error"
    });
    return { singleRegister: false, branchSelection: "visible" as const, maxBranches: null, maxDevices: null, packageCode: null, source: "fallback" as const };
  }
}

export async function GET() {
  const startedAt = Date.now();
  const cookieStore = await cookies();
  const flow = readPreEntryFlowState(cookieStore);
  if (!flow || !hasFlowStage(flow, ["employee_verified"]) || !flow.branchId || !flow.permissions) {
    return withTimingHeaders(
      NextResponse.json(
        { data: null, error: { code: "missing_employee_context", message: "กรุณายืนยันตัวตนพนักงานก่อนเลือกเครื่องแคชเชียร์" } },
        { status: 401 }
      ),
      startedAt
    );
  }

  try {
    const supabase = getSupabaseServiceClient();
    const { data: deviceRows, error: deviceError } = await withAuthTimeout(
      supabase
        .from("branch_devices")
        .select("id,tenant_id,branch_id,device_code,device_name,status,last_seen_at,metadata")
        .eq("tenant_id", flow.tenantId)
        .eq("branch_id", flow.branchId)
        .order("device_name", { ascending: true }),
      "devices_lookup_timeout",
      10000
    );

    if (deviceError) {
      return withTimingHeaders(
        NextResponse.json({ data: null, error: { code: "device_query_failed", message: "ไม่สามารถโหลดรายการเครื่องแคชเชียร์ได้" } }, { status: 500 }),
        startedAt
      );
    }

    const devices = (deviceRows ?? []) as DeviceCandidate[];
    const deviceIds = devices.map((device) => device.id).filter(Boolean);
    const deviceCodes = devices.map((device) => device.device_code).filter(Boolean);
    const nowIso = new Date().toISOString();

    let sessionsById = emptySessionResult();
    let sessionsByCode = emptySessionResult();
    try {
      [sessionsById, sessionsByCode] = await withAuthTimeout(
        Promise.all([
          deviceIds.length > 0
            ? supabase
                .from("pos_sessions")
                .select("id,device_id,device_code,user_id,users_profiles(full_name)")
                .eq("tenant_id", flow.tenantId)
                .eq("branch_id", flow.branchId)
                .eq("status", "active")
                .gt("expires_at", nowIso)
                .in("device_id", deviceIds)
            : Promise.resolve(emptySessionResult()),
          deviceCodes.length > 0
            ? supabase
                .from("pos_sessions")
                .select("id,device_id,device_code,user_id,users_profiles(full_name)")
                .eq("tenant_id", flow.tenantId)
                .eq("branch_id", flow.branchId)
                .eq("status", "active")
                .gt("expires_at", nowIso)
                .in("device_code", deviceCodes)
            : Promise.resolve(emptySessionResult())
        ]),
        "device_sessions_lookup_timeout",
        5000
      );
    } catch (error) {
      console.warn("[auth/devices] session occupancy lookup degraded", {
        tenantId: flow.tenantId,
        branchId: flow.branchId,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }

    if (sessionsById.error || sessionsByCode.error) {
      console.warn("[auth/devices] session occupancy query failed; returning devices without occupancy", {
        tenantId: flow.tenantId,
        branchId: flow.branchId,
        idError: sessionsById.error?.message ?? null,
        codeError: sessionsByCode.error?.message ?? null
      });
      sessionsById = emptySessionResult();
      sessionsByCode = emptySessionResult();
    }

    const activeSessionRows = new Map<string, SessionRow>();
    for (const row of [...((sessionsById.data ?? []) as SessionRow[]), ...((sessionsByCode.data ?? []) as SessionRow[])]) {
      activeSessionRows.set(row.id, row);
    }

    const occupancies = Array.from(activeSessionRows.values()).map((row) => {
      const profile = Array.isArray(row.users_profiles) ? row.users_profiles[0] : row.users_profiles;
      return {
        session_id: row.id,
        device_id: row.device_id,
        device_code: row.device_code,
        user_id: row.user_id,
        user_name: profile?.full_name ?? null
      } satisfies DeviceSessionOccupancy;
    });

    const storeMode = await safeResolveStoreMode(flow.tenantId);
    const devicesWithStatus = devices.map((device) => {
      const occupancy =
        occupancies.find((item) => item.device_id && item.device_id === device.id) ??
        occupancies.find((item) => item.device_code && item.device_code === device.device_code) ??
        null;
      const publicStatus = mapDeviceStatus(device, occupancy);
      const counterName = typeof device.metadata?.counter_name === "string" ? device.metadata.counter_name : null;
      const location = typeof device.metadata?.location === "string" ? device.metadata.location : null;
      return {
        deviceCode: device.device_code,
        deviceId: device.id,
        deviceName: device.device_name,
        counterName: counterName ?? location ?? "-",
        status: publicStatus,
        lastConnectedAt: device.last_seen_at,
        currentUser: occupancy ? { id: occupancy.user_id, name: occupancy.user_name ?? occupancy.user_id } : null
      };
    });

    return withTimingHeaders(
      NextResponse.json({
        data: {
          tenant: { name: flow.tenantName, code: flow.storeCode },
          branch: { id: flow.branchId, code: flow.branchCode ?? null, name: flow.branchName ?? null },
          employee: { id: flow.userId, code: flow.employeeCode, name: flow.employeeName, role: flow.userRole },
          devices: devicesWithStatus,
          single_device_mode: storeMode.singleRegister || devicesWithStatus.length === 1,
          auto_select_single_device: storeMode.singleRegister && devicesWithStatus.length === 1,
          store_mode: {
            single_register: storeMode.singleRegister,
            branch_selection: storeMode.branchSelection,
            max_devices: storeMode.maxDevices,
            package_code: storeMode.packageCode
          },
          can_override_in_use: flow.permissions.includes("pos.device.override_in_use")
        },
        error: null
      }),
      startedAt
    );
  } catch (error) {
    if (error instanceof AuthTimeoutError) {
      return withTimingHeaders(
        NextResponse.json({ data: null, error: { code: "auth_timeout", message: "ระบบตอบสนองช้าเกินไป กรุณาลองใหม่อีกครั้ง" } }, { status: 504 }),
        startedAt
      );
    }
    console.error("[auth/devices] unexpected error", {
      tenantId: flow.tenantId,
      branchId: flow.branchId,
      error: error instanceof Error ? error.message : "Unknown error"
    });
    return withTimingHeaders(
      NextResponse.json({ data: null, error: { code: "device_query_failed", message: "ไม่สามารถโหลดรายการเครื่องแคชเชียร์ได้" } }, { status: 500 }),
      startedAt
    );
  }
}