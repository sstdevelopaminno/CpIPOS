import { NextResponse } from "next/server";
import { GET as baseGet, POST as basePost } from "@/lib/android-pos/mdm-heartbeat-base";
import { buildAndroidModernUpdateOffer } from "@/lib/android-runtime-release";
import { resolveCommercialActivationGate } from "@/lib/android-pos/commercial-activation";
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

type RecoveryCommand = {
  id: string;
  action: "clear_webview_cache" | "reload_webview";
  reason: string;
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

function recoveryCommandEligible(payload: JsonRecord | null): boolean {
  const capabilities = asRecord(payload?.runtime_capabilities);
  return Number(capabilities.schema_version ?? 0) >= 4;
}

function commercialActivationEligible(payload: JsonRecord | null): boolean {
  const capabilities = asRecord(payload?.commercial_activation_capabilities);
  return Number(capabilities.schema_version ?? 0) >= 1 && capabilities.native_gate === true;
}

function buildRecoveryCommands(scope: AutoScope, payload: JsonRecord | null): RecoveryCommand[] {
  const metadata = asRecord(scope.metadata);
  const policy = asRecord(metadata.android_mdm_recovery_policy);
  if (policy.enabled !== true) return [];
  const generationMs = Number(policy.generation_ms ?? 0);
  if (!Number.isFinite(generationMs) || generationMs <= 0) return [];
  const lastCommand = asRecord(payload?.last_command);
  const lastCommandAtMs = Number(lastCommand.at_ms ?? 0);
  if (Number.isFinite(lastCommandAtMs) && lastCommandAtMs >= generationMs) return [];

  const reason = String(policy.reason ?? "android_mdm_recovery").trim() || "android_mdm_recovery";
  const actions = Array.isArray(policy.actions) ? policy.actions : [];
  return actions
    .filter((action): action is RecoveryCommand["action"] => action === "clear_webview_cache" || action === "reload_webview")
    .slice(0, 2)
    .map((action) => ({
      id: `recovery-${action}-${generationMs}`,
      action,
      reason
    }));
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
  const installId = String(requestCopy.headers.get("x-cpipos-install-id") ?? "").trim().slice(0, 120) || null;
  const printerEligible = quickAutoSetupEligible(payload);
  const updaterTelemetry = hasUpdaterTelemetry(payload);
  const recoveryEligible = recoveryCommandEligible(payload);
  const activationEligible = commercialActivationEligible(payload);

  if (!printerEligible && !updaterTelemetry && !recoveryEligible && !activationEligible) return baseResponse;

  const scope = await findAutoScope(installId);
  if (!scope) return baseResponse;
  const scopeMetadata = asRecord(scope.metadata);

  const recoveryCommands = recoveryEligible ? buildRecoveryCommands(scope, payload) : [];
  const activationGate = activationEligible ? await resolveCommercialActivationGate(scope) : null;
  if (!printerEligible && !updaterTelemetry && recoveryCommands.length === 0 && !activationGate) return baseResponse;

  if (updaterTelemetry) await persistUpdaterTelemetry(scope, payload);

  const tenantCode = updaterTelemetry ? await findTenantCode(scope.tenant_id) : null;
  const updateRing = String(scopeMetadata.update_ring ?? "").trim().toUpperCase();
  const stagedUpdateOffer = updaterTelemetry && tenantCode && updateRing === "PILOT"
    ? buildAndroidModernUpdateOffer({
        tenantCode,
        payload,
        deviceStatus: scope.status,
        deviceLocked: scope.is_locked,
        updatePolicy: asRecord(scopeMetadata.android_update_policy)
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
  const commands = [...existingCommands, ...recoveryCommands, ...auto.commands].slice(0, 5);

  return NextResponse.json({
    ...responseBody,
    data: {
      ...data,
      commands,
      update_offer: stagedUpdateOffer ?? data.update_offer ?? null,
      activation_gate: activationGate ?? data.activation_gate ?? null,
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
