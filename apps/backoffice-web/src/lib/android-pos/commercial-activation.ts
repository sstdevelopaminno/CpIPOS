import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type JsonRecord = Record<string, unknown>;

type DeviceScope = {
  id: string;
  tenant_id: string;
  branch_id?: string;
  device_code: string;
  metadata: JsonRecord | null;
};

type SubscriptionContractRow = {
  id: string;
  tenant_id: string;
  status: string;
  metadata: JsonRecord | null;
  updated_at: string;
};

export type CommercialActivationGate = {
  schema_version: 1;
  required: boolean;
  blocking: boolean;
  policy_id: string;
  effective_date: string;
  title: string;
  message: string;
  confirm_label: string;
  support_hint: string;
};

export type CommercialActivationConfirmResult = {
  confirmed: boolean;
  already_confirmed: boolean;
  tenant_id: string;
  device_id: string;
  device_code: string;
  contract_id: string;
  effective_date: string;
  confirmed_at: string | null;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function normalizeEffectiveDate(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = Date.parse(`${raw}T00:00:00+07:00`);
  return Number.isFinite(parsed) ? raw : null;
}

function bangkokIsoDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatThaiDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00+07:00`);
  return new Intl.DateTimeFormat("th-TH-u-ca-buddhist", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(date);
}

function buildPolicyId(contractId: string, effectiveDate: string): string {
  return `commercial-activation-v1:${contractId}:${effectiveDate}`;
}

async function findLatestContract(tenantId: string): Promise<SubscriptionContractRow | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("tenant_subscription_contracts")
    .select("id,tenant_id,status,metadata,updated_at")
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<SubscriptionContractRow>();

  if (error) {
    console.error("[commercial-activation] contract lookup failed", { message: error.message });
    return null;
  }
  return data ?? null;
}

export async function resolveCommercialActivationGate(
  device: DeviceScope,
  now = new Date()
): Promise<CommercialActivationGate | null> {
  const contract = await findLatestContract(device.tenant_id);
  if (!contract) return null;

  const metadata = asRecord(contract.metadata);
  const effectiveDate = normalizeEffectiveDate(metadata.commercial_activation_effective_date);
  if (!effectiveDate) return null;

  const policyId = buildPolicyId(contract.id, effectiveDate);
  const requiredFlag = metadata.commercial_activation_required === true;
  const billingStarted = metadata.billing_started === true;
  const effective = bangkokIsoDate(now) >= effectiveDate;
  const required = requiredFlag && !billingStarted && effective;
  const thaiDate = formatThaiDate(effectiveDate);
  const displayPrice = Number(metadata.display_price_thb ?? 0);
  const priceHint = Number.isFinite(displayPrice) && displayPrice > 0
    ? ` แพ็กเกจปัจจุบัน ${displayPrice.toLocaleString("th-TH")} บาทต่อรอบ`
    : "";

  return {
    schema_version: 1,
    required,
    blocking: required,
    policy_id: policyId,
    effective_date: effectiveDate,
    title: required ? "ยืนยันเปิดใช้งาน SST iPOS" : "SST iPOS พร้อมใช้งาน",
    message: required
      ? `ระบบจะเริ่มนับรอบการใช้งานแพ็กเกจตั้งแต่วันที่ ${thaiDate}${priceHint} กรุณากดยืนยันเพื่อเปิดใช้งานระบบบนเครื่องนี้`
      : `สถานะการเปิดใช้งานแพ็กเกจของเครื่องนี้ได้รับการยืนยันแล้ว โดยมีผลตั้งแต่วันที่ ${thaiDate}`,
    confirm_label: "ยืนยันเปิดใช้งาน",
    support_hint: "หากข้อมูลไม่ถูกต้อง กรุณาติดต่อผู้ดูแลระบบก่อนยืนยัน"
  };
}

async function findPairedDevice(installId: string): Promise<DeviceScope | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("branch_devices")
    .select("id,tenant_id,branch_id,device_code,metadata")
    .eq("is_active", true)
    .contains("metadata", { android_mdm_install_id: installId })
    .order("updated_at", { ascending: false })
    .limit(2)
    .returns<DeviceScope[]>();

  if (error) {
    console.error("[commercial-activation] device lookup failed", { message: error.message });
    return null;
  }

  const rows = data ?? [];
  if (rows.length !== 1) {
    if (rows.length > 1) {
      console.error("[commercial-activation] duplicate install binding blocked", {
        install_id_suffix: installId.slice(-8)
      });
    }
    return null;
  }
  return rows[0] ?? null;
}

export async function confirmCommercialActivation(input: {
  installId: string;
  policyId: string;
  effectiveDate: string;
  appVersion: string | null;
}): Promise<CommercialActivationConfirmResult | null> {
  const device = await findPairedDevice(input.installId);
  if (!device) return null;

  const contract = await findLatestContract(device.tenant_id);
  if (!contract) return null;

  const metadata = asRecord(contract.metadata);
  const effectiveDate = normalizeEffectiveDate(metadata.commercial_activation_effective_date);
  if (!effectiveDate) throw new Error("commercial_activation_effective_date_missing");

  const expectedPolicyId = buildPolicyId(contract.id, effectiveDate);
  if (input.policyId !== expectedPolicyId || input.effectiveDate !== effectiveDate) {
    throw new Error("commercial_activation_policy_mismatch");
  }

  if (bangkokIsoDate() < effectiveDate) {
    throw new Error("commercial_activation_not_effective");
  }

  const alreadyConfirmed = metadata.billing_started === true || metadata.commercial_activation_required !== true;
  const existingConfirmedAt = String(metadata.commercial_activation_confirmed_at ?? "").trim() || null;
  if (alreadyConfirmed) {
    return {
      confirmed: true,
      already_confirmed: true,
      tenant_id: device.tenant_id,
      device_id: device.id,
      device_code: device.device_code,
      contract_id: contract.id,
      effective_date: effectiveDate,
      confirmed_at: existingConfirmedAt
    };
  }

  const confirmedAt = new Date().toISOString();
  const supabase = getSupabaseServiceClient();
  const nextMetadata = {
    ...metadata,
    billing_started: true,
    commercial_activation_required: false,
    commercial_activation_policy_version: 1,
    commercial_activation_effective_date: effectiveDate,
    commercial_activation_confirmed_at: confirmedAt,
    commercial_activation_confirmed_by_device_id: device.id,
    commercial_activation_confirmed_by_device_code: device.device_code,
    commercial_activation_confirmation_source: "android_pos_native_gate"
  };

  const { error: contractError } = await supabase
    .from("tenant_subscription_contracts")
    .update({ metadata: nextMetadata, updated_at: confirmedAt })
    .eq("id", contract.id)
    .eq("tenant_id", device.tenant_id);
  if (contractError) {
    console.error("[commercial-activation] contract update failed", { message: contractError.message });
    throw new Error("commercial_activation_update_failed");
  }

  const deviceMetadata = asRecord(device.metadata);
  const { error: deviceError } = await supabase
    .from("branch_devices")
    .update({
      metadata: {
        ...deviceMetadata,
        android_commercial_activation: {
          policy_id: expectedPolicyId,
          effective_date: effectiveDate,
          confirmed_at: confirmedAt,
          app_version: input.appVersion,
          source: "android_pos_native_gate"
        }
      },
      updated_at: confirmedAt
    })
    .eq("id", device.id);
  if (deviceError) {
    console.error("[commercial-activation] device audit metadata update failed", {
      device_code: device.device_code,
      message: deviceError.message
    });
  }

  return {
    confirmed: true,
    already_confirmed: false,
    tenant_id: device.tenant_id,
    device_id: device.id,
    device_code: device.device_code,
    contract_id: contract.id,
    effective_date: effectiveDate,
    confirmed_at: confirmedAt
  };
}
