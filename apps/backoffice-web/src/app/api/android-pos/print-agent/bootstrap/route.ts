import { createHash, randomBytes } from "node:crypto";
import { fail, ok } from "@/lib/http";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";

type JsonRecord = Record<string, unknown>;

type BranchDeviceRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  device_code: string;
  device_name: string;
  metadata: JsonRecord | null;
};

type PrintAgentRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  device_id: string | null;
  device_code: string;
  agent_name: string;
  status: string;
  metadata: JsonRecord | null;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function hashAgentKey(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function noStoreHeaders() {
  return { "Cache-Control": "no-store, no-cache, must-revalidate" };
}

async function findPairedDevice(installId: string) {
  const supabase = getPrimarySupabaseServiceClient();
  const { data, error } = await supabase
    .from("branch_devices")
    .select("id,tenant_id,branch_id,device_code,device_name,metadata")
    .eq("is_active", true)
    .contains("metadata", { android_mdm_install_id: installId })
    .maybeSingle<BranchDeviceRow>();
  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function POST(request: Request) {
  try {
    if (request.headers.get("x-cpipos-android-pos") !== "true") {
      return fail("android_pos_required", "Android POS runtime is required.", 401, noStoreHeaders());
    }

    const installId = String(request.headers.get("x-cpipos-install-id") ?? "").trim().slice(0, 120);
    const appVersion = String(request.headers.get("x-cpipos-app-version") ?? "").trim().slice(0, 40) || null;
    if (!installId) return fail("android_install_id_required", "Android install id is required.", 401, noStoreHeaders());

    const device = await findPairedDevice(installId);
    if (!device) {
      return fail(
        "android_device_not_paired",
        "Android POS เครื่องนี้ยังไม่ได้จับคู่กับเครื่อง POS ของสาขา กรุณาเปิดหน้าตั้งค่าเครื่องและจับคู่เครื่องก่อน",
        403,
        noStoreHeaders()
      );
    }

    const supabase = getPrimarySupabaseServiceClient();
    const { data: existingRows, error: existingError } = await supabase
      .from("print_agents")
      .select("id,tenant_id,branch_id,device_id,device_code,agent_name,status,metadata")
      .eq("tenant_id", device.tenant_id)
      .eq("branch_id", device.branch_id)
      .eq("device_code", device.device_code)
      .order("created_at", { ascending: false })
      .limit(1)
      .returns<PrintAgentRow[]>();
    if (existingError) throw new Error(existingError.message);

    const rawKey = `cpi_pa_${randomBytes(32).toString("base64url")}`;
    const now = new Date().toISOString();
    const agentName = `Android POS · ${device.device_name || device.device_code}`.slice(0, 120);
    const agentMetadata = {
      source: "android_pos_native_print_agent",
      native_runtime: true,
      transports: ["lan", "usb", "bluetooth"],
      pos_device_id: device.id,
      app_version: appVersion,
      provisioned_at: now
    };

    let agent: PrintAgentRow;
    const existing = existingRows?.[0] ?? null;
    if (existing) {
      const { data, error } = await supabase
        .from("print_agents")
        .update({
          device_id: device.id,
          agent_name: agentName,
          api_key_hash: hashAgentKey(rawKey),
          status: "active",
          last_seen_at: now,
          app_version: appVersion,
          metadata: { ...asRecord(existing.metadata), ...agentMetadata },
          updated_at: now
        })
        .eq("id", existing.id)
        .eq("tenant_id", device.tenant_id)
        .eq("branch_id", device.branch_id)
        .select("id,tenant_id,branch_id,device_id,device_code,agent_name,status,metadata")
        .single<PrintAgentRow>();
      if (error) throw new Error(error.message);
      agent = data;
    } else {
      const { data, error } = await supabase
        .from("print_agents")
        .insert({
          tenant_id: device.tenant_id,
          branch_id: device.branch_id,
          device_id: device.id,
          device_code: device.device_code,
          agent_name: agentName,
          api_key_hash: hashAgentKey(rawKey),
          status: "active",
          last_seen_at: now,
          app_version: appVersion,
          metadata: agentMetadata
        })
        .select("id,tenant_id,branch_id,device_id,device_code,agent_name,status,metadata")
        .single<PrintAgentRow>();
      if (error) throw new Error(error.message);
      agent = data;
    }

    const deviceMetadata = asRecord(device.metadata);
    await supabase
      .from("branch_devices")
      .update({
        metadata: {
          ...deviceMetadata,
          android_print_agent_id: agent.id,
          android_print_agent_version: appVersion,
          android_print_agent_provisioned_at: now
        },
        last_seen_at: now,
        updated_at: now
      })
      .eq("id", device.id)
      .eq("tenant_id", device.tenant_id)
      .eq("branch_id", device.branch_id);

    return ok(
      {
        agent: {
          id: agent.id,
          tenant_id: agent.tenant_id,
          branch_id: agent.branch_id,
          device_id: agent.device_id,
          device_code: agent.device_code,
          agent_name: agent.agent_name,
          status: agent.status
        },
        agent_key: rawKey,
        transports: ["lan", "usb", "bluetooth"]
      },
      200,
      noStoreHeaders()
    );
  } catch (error) {
    console.error("[android-pos-print-agent] bootstrap failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    return fail(
      "android_print_agent_bootstrap_failed",
      "ไม่สามารถเตรียม Android Print Agent ได้ กรุณาตรวจการจับคู่เครื่อง POS แล้วลองใหม่",
      500,
      noStoreHeaders()
    );
  }
}
