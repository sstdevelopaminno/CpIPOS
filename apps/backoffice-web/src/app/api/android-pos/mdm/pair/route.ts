import { createHash } from "node:crypto";
import { fail, ok } from "@/lib/http";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";

type JsonRecord = Record<string, unknown>;

type PairingPayload = {
  activation_token?: string | null;
  android_install_id?: string | null;
  device_code?: string | null;
  app_version?: string | null;
  runtime_version?: string | null;
};

type ActivationTokenRow = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  token_type: string;
  purpose: string;
  status: string;
  expires_at: string;
  consumed_at: string | null;
  metadata: JsonRecord | null;
};

type BranchDeviceRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  device_code: string;
  device_name: string;
  status: string;
  is_active: boolean;
  metadata: JsonRecord | null;
};

type EnrollmentRow = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  device_code: string;
  device_type: string;
  enrollment_status: string;
  trust_level: string;
  activation_token_id: string | null;
  metadata: JsonRecord | null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEVICE_CODE_PATTERN = /^[A-Z0-9_-]{2,64}$/;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function hashToken(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function noStore(response: Response) {
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return response;
}

export async function POST(request: Request) {
  try {
    if (request.headers.get("x-cpipos-android-pos") !== "true") {
      return noStore(fail("android_pos_required", "Android POS runtime is required for pairing.", 401));
    }

    const body = (await request.json().catch(() => null)) as PairingPayload | null;
    const rawToken = String(body?.activation_token ?? "").trim();
    const installId = String(body?.android_install_id ?? "").trim();
    const deviceCode = String(body?.device_code ?? "").trim().toUpperCase();
    const appVersion = String(body?.app_version ?? "").trim().slice(0, 40) || null;
    const runtimeVersion = String(body?.runtime_version ?? "").trim().slice(0, 80) || "android-pos-webview-mdm-lite";

    if (rawToken.length < 20 || rawToken.length > 200) {
      return noStore(fail("activation_token_invalid", "Pairing token is invalid.", 401));
    }
    if (!UUID_PATTERN.test(installId)) {
      return noStore(fail("android_install_id_invalid", "Android install id is invalid.", 422));
    }
    if (!DEVICE_CODE_PATTERN.test(deviceCode)) {
      return noStore(fail("device_code_invalid", "POS device code is invalid.", 422));
    }

    const supabase = getPrimarySupabaseServiceClient();
    const tokenHash = hashToken(rawToken);
    const { data: token, error: tokenError } = await supabase
      .from("activation_tokens")
      .select("id,tenant_id,branch_id,token_type,purpose,status,expires_at,consumed_at,metadata")
      .eq("token_hash", tokenHash)
      .maybeSingle<ActivationTokenRow>();

    if (tokenError) throw new Error(tokenError.message);
    if (!token) return noStore(fail("activation_token_invalid", "Pairing token is invalid.", 401));
    if (token.token_type !== "pos_terminal" || token.purpose !== "device_activation") {
      return noStore(fail("activation_token_scope_invalid", "Pairing token is not valid for an Android POS terminal.", 403));
    }
    if (!token.branch_id) {
      return noStore(fail("activation_token_branch_required", "Pairing token must be scoped to a branch.", 422));
    }
    if (token.status === "consumed" || token.consumed_at) {
      return noStore(fail("activation_token_consumed", "Pairing token has already been used.", 409));
    }
    if (token.status === "revoked") {
      return noStore(fail("activation_token_revoked", "Pairing token has been revoked.", 403));
    }
    if (token.status !== "active") {
      return noStore(fail("activation_token_inactive", "Pairing token is not active.", 409));
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAtMs = Date.parse(token.expires_at);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now.getTime()) {
      await supabase
        .from("activation_tokens")
        .update({ status: "expired", updated_at: nowIso })
        .eq("id", token.id)
        .eq("status", "active")
        .is("consumed_at", null);
      return noStore(fail("activation_token_expired", "Pairing token has expired.", 410));
    }

    const { data: device, error: deviceError } = await supabase
      .from("branch_devices")
      .select("id,tenant_id,branch_id,device_code,device_name,status,is_active,metadata")
      .eq("tenant_id", token.tenant_id)
      .eq("branch_id", token.branch_id)
      .eq("device_code", deviceCode)
      .maybeSingle<BranchDeviceRow>();
    if (deviceError) throw new Error(deviceError.message);
    if (!device || !device.is_active || device.status !== "active") {
      return noStore(fail("pairing_device_not_found", "Active POS device was not found in the token branch.", 404));
    }

    const { data: conflicts, error: conflictError } = await supabase
      .from("branch_devices")
      .select("id,tenant_id,branch_id,device_code,device_name,status,is_active,metadata")
      .eq("is_active", true)
      .contains("metadata", { android_mdm_install_id: installId })
      .neq("id", device.id)
      .limit(1)
      .returns<BranchDeviceRow[]>();
    if (conflictError) throw new Error(conflictError.message);
    if ((conflicts ?? []).length > 0) {
      return noStore(fail("android_install_id_conflict", "This Android installation is already paired with another POS device.", 409));
    }

    const { data: existingEnrollment, error: enrollmentLookupError } = await supabase
      .from("device_enrollments")
      .select("id,tenant_id,branch_id,device_code,device_type,enrollment_status,trust_level,activation_token_id,metadata")
      .eq("tenant_id", token.tenant_id)
      .eq("device_code", deviceCode)
      .maybeSingle<EnrollmentRow>();
    if (enrollmentLookupError) throw new Error(enrollmentLookupError.message);

    const existingMetadata = asRecord(existingEnrollment?.metadata);
    const existingInstallId = String(existingMetadata.android_mdm_install_id ?? "").trim();
    if (existingEnrollment?.enrollment_status === "blocked") {
      return noStore(fail("device_enrollment_blocked", "This POS device enrollment is blocked by IT.", 403));
    }
    if (existingEnrollment?.enrollment_status === "active" && existingEnrollment.trust_level === "trusted") {
      if (existingInstallId === installId) {
        return noStore(ok({
          enrollment: existingEnrollment,
          pairing_state: "approved",
          already_enrolled: true,
          device: { id: device.id, device_code: device.device_code, device_name: device.device_name }
        }));
      }
      return noStore(fail("device_enrollment_conflict", "This POS device already has an approved Android enrollment.", 409));
    }

    // Consume the one-time token first with compare-and-set guards. If the subsequent
    // enrollment write fails, the token remains burned (fail-closed) and IT can issue
    // a new token; a replay can never create a second enrollment authority.
    const consumedMetadata = {
      ...asRecord(token.metadata),
      consumed_device_code: deviceCode,
      consumed_android_install_id: installId,
      consumed_app_version: appVersion,
      consumed_runtime_version: runtimeVersion
    };
    const { data: consumedToken, error: consumeError } = await supabase
      .from("activation_tokens")
      .update({
        status: "consumed",
        consumed_at: nowIso,
        metadata: consumedMetadata,
        updated_at: nowIso
      })
      .eq("id", token.id)
      .eq("status", "active")
      .is("consumed_at", null)
      .gt("expires_at", nowIso)
      .select("id")
      .maybeSingle<{ id: string }>();
    if (consumeError) throw new Error(consumeError.message);
    if (!consumedToken) {
      return noStore(fail("activation_token_replay_blocked", "Pairing token was already used or expired.", 409));
    }

    const enrollmentMetadata = {
      ...existingMetadata,
      pairing_source: "android_activation_token",
      android_mdm_install_id: installId,
      android_mdm_app_version: appVersion,
      android_mdm_runtime_version: runtimeVersion,
      android_mdm_pair_requested_at: nowIso,
      android_mdm_branch_device_id: device.id
    };
    const { data: enrollment, error: enrollmentError } = await supabase
      .from("device_enrollments")
      .upsert({
        tenant_id: token.tenant_id,
        branch_id: token.branch_id,
        device_code: deviceCode,
        device_type: "pos_terminal",
        enrollment_status: "pending",
        trust_level: "untrusted",
        activation_token_id: token.id,
        approved_by: null,
        approved_at: null,
        revoked_at: null,
        last_seen_at: nowIso,
        metadata: enrollmentMetadata,
        updated_at: nowIso
      }, { onConflict: "tenant_id,device_code" })
      .select("id,tenant_id,branch_id,device_code,device_type,enrollment_status,trust_level,activation_token_id,approved_at,last_seen_at,metadata,created_at,updated_at")
      .single();
    if (enrollmentError || !enrollment) {
      throw new Error(enrollmentError?.message ?? "Failed to create pending device enrollment.");
    }

    return noStore(ok({
      enrollment,
      pairing_state: "pending_approval",
      already_enrolled: false,
      device: { id: device.id, device_code: device.device_code, device_name: device.device_name }
    }));
  } catch (error) {
    console.error("[android-pos-mdm] activation pairing failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    return noStore(fail("android_pairing_failed", "Unable to submit Android POS pairing request.", 500));
  }
}
