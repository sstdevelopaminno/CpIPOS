import { NextResponse } from "next/server";
import { GET as baseGet, POST as basePost } from "@/lib/android-pos/mdm-heartbeat-base";
import { buildAndroidModernUpdateOffer } from "@/lib/android-runtime-release";
import { reconcileModernPrinterInventory } from "@/lib/printing/printer-mdm-auto-registry";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type JsonRecord = Record<string, unknown>;
type AutoScope = {
  id: string;
  tenant_id: string;
  branch_id: string;
  device_code: string;
  status: string;
  is_locked: boolean;
  metadata: Record<string, unknown> | null;
};

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

function hasUpdaterTelemetry(payload: JsonRecord | null): boolean {
  return Object.keys(asRecord(payload?.update_capabilities)).length > 0 ||
    Object.keys(asRecord(payload?.update_state)).length > 0;
}

async function findAutoScope(installId: string | null): Promise<AutoScope | null> {
  if (!installId) return null;
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("branch_devices")
    .select("id,tenant_id,branch_id,device_code,status,is_locked,metadata")
    .eq("is_active", true)
    .contains("metadata", { android_mdm_install_id: installId })
    .order("updated_at", { ascending: false })
    .limit(2)
    .returns<AutoScope[]>();
  if (error) {
    console.error("[android-pos-mdm] paired device scope lookup failed", { message: error.message });
    return null;
  }
  const rows = data ?? [];
  if (rows.length !== 1) {
    if (rows.length > 1) console.error("[android-pos-mdm] duplicate install binding blocked", { install_id_suffix: installId.slice(-8) });
    return null;
  }
  return rows[0] ?? null;
}

async function findTenantCode(tenantId: string): Promise<string | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("tenants")
    .select("code")
    .eq("id", tenantId)
    .maybeSingle<{ code: string }>();
  if (error) return null;
  return data?.code ?? null;
}

async function persistUpdaterTelemetry(scope: AutoScope, payload: JsonRecord | null) {
  const updateCapabilities = asRecord(payload?.update_capabilities);
  const updateState = asRecord(payload?.update_state);
  if (Object.keys(updateCapabilities).length === 0 && Object.keys(updateState).length === 0) return;

  const metadata = asRecord(scope.metadata);
  const supabase = getSupabaseServiceClient();
  await supabase.from("branch_devices").update({
    metadata: {
      ...metadata,
      android_mdm_update_capabilities: updateCapabilities,
      android_mdm_update_state: updateState
    },
    updated_at: new Date().toISOString()
  }).eq("id", scope.id);
}

export async function GET() {
  return baseGet();
}

export async function POST(request: Request) {
  const requestCopy = request.clone();
  const baseResponse = await basePost(request);
  if (!baseResponse.ok || requestCopy.headers.get("x-cpipos-android-pos") !== "true") return baseResponse;

  const payload = await requestCopy.json().catch(() => null) as JsonRecord | null;
  const printerEligible = quickAutoSetupEligible(payload);
  const updaterTelemetry = hasUpdaterTelemetry(payload);
  if (!printerEligible && !updaterTelemetry) return baseResponse;

  const installId = String(requestCopy.headers.get("x-cpipos-install-id") ?? "").trim().slice(0, 120) || null;
  const scope = await findAutoScope(installId);
  if (!scope) return baseResponse;

  if (updaterTelemetry) await persistUpdaterTelemetry(scope, payload);

  const tenantCode = updaterTelemetry ? await findTenantCode(scope.tenant_id) : null;
  const stagedUpdateOffer = updaterTelemetry && tenantCode
    ? buildAndroidModernUpdateOffer({
        tenantCode,
        payload,
        deviceStatus: scope.status,
        deviceLocked: scope.is_locked
      })
    : null;

  const auto = printerEligible
    ? await reconcileModernPrinterInventory({
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
      })
    : { eligible: false, candidateCount: 0, commands: [] };

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
      update_offer: stagedUpdateOffer ?? data.update_offer ?? null,
      ...(printerEligible ? {
        auto_printer_registry: {
          eligible: auto.eligible,
          candidate_count: auto.candidateCount
        }
      } : {})
    }
  }, {
    status: baseResponse.status,
    headers: baseResponse.headers
  });
}
