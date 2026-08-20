import { NextResponse } from "next/server";
import { GET as baseGet, POST as basePost } from "@/lib/android-pos/mdm-heartbeat-base";
import { reconcileModernPrinterInventory } from "@/lib/printing/printer-mdm-auto-registry";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type JsonRecord = Record<string, unknown>;
type AutoScope = { id: string; tenant_id: string; branch_id: string; device_code: string };

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function quickAutoSetupEligible(payload: JsonRecord | null): boolean {
  const capabilities = asRecord(payload?.runtime_capabilities);
  const printer = asRecord(capabilities.printer);
  return Number(capabilities.schema_version ?? 0) >= 4 &&
    printer.auto_setup === true &&
    printer.explicit_assignment_first === true &&
    printer.automatic_reassignment === false &&
    String(printer.assignment_protection ?? "") === "preserve_existing_or_require_confirmation";
}

async function findAutoScope(installId: string | null): Promise<AutoScope | null> {
  if (!installId) return null;
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("branch_devices")
    .select("id,tenant_id,branch_id,device_code")
    .eq("is_active", true)
    .contains("metadata", { android_mdm_install_id: installId })
    .order("updated_at", { ascending: false })
    .limit(2)
    .returns<AutoScope[]>();
  if (error) {
    console.error("[printer-auto-registry] paired device scope lookup failed", { message: error.message });
    return null;
  }
  const rows = data ?? [];
  if (rows.length !== 1) {
    if (rows.length > 1) console.error("[printer-auto-registry] duplicate install binding blocked", { install_id_suffix: installId.slice(-8) });
    return null;
  }
  return rows[0] ?? null;
}

export async function GET() {
  return baseGet();
}

export async function POST(request: Request) {
  const requestCopy = request.clone();
  const baseResponse = await basePost(request);
  if (!baseResponse.ok || requestCopy.headers.get("x-cpipos-android-pos") !== "true") return baseResponse;

  const payload = await requestCopy.json().catch(() => null) as JsonRecord | null;
  if (!quickAutoSetupEligible(payload)) return baseResponse;

  const installId = String(requestCopy.headers.get("x-cpipos-install-id") ?? "").trim().slice(0, 120) || null;
  const scope = await findAutoScope(installId);
  if (!scope) return baseResponse;

  const auto = await reconcileModernPrinterInventory({
    device: {
      id: scope.id,
      tenantId: scope.tenant_id,
      branchId: scope.branch_id,
      deviceCode: scope.device_code
    },
    payload
  }).catch((error) => {
    console.error("[printer-auto-registry] reconciliation failed", { message: error instanceof Error ? error.message : "unknown" });
    return { eligible: false, candidateCount: 0, commands: [] };
  });

  if (!auto.eligible && auto.commands.length === 0) return baseResponse;

  const responseBody = await baseResponse.clone().json().catch(() => null) as JsonRecord | null;
  if (!responseBody) return baseResponse;
  const data = asRecord(responseBody.data);
  const existingCommands = Array.isArray(data.commands) ? data.commands : [];
  const commands = [...existingCommands, ...auto.commands].slice(0, 5);

  return NextResponse.json({
    ...responseBody,
    data: {
      ...data,
      commands,
      auto_printer_registry: {
        eligible: auto.eligible,
        candidate_count: auto.candidateCount
      }
    }
  }, {
    status: baseResponse.status,
    headers: baseResponse.headers
  });
}
