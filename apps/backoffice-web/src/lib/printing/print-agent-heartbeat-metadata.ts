type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function sameJsonValue(left: unknown, right: unknown) {
  if (Object.is(left, right)) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

export function buildPrintAgentHeartbeatMetadata(input: {
  currentMetadata: unknown;
  heartbeatMetadata?: JsonRecord | null;
  appVersion?: string | null;
  isActive: boolean;
}): JsonRecord {
  const current = asRecord(input.currentMetadata);
  const incoming = asRecord(input.heartbeatMetadata);
  const metadata: JsonRecord = {};

  // Only send actual metadata deltas. Print agents may heartbeat frequently; forwarding
  // unchanged device/runtime metadata on every request defeats the write throttle in
  // touchPrintAgent and causes unnecessary UPDATE load on print_agents.
  for (const [key, value] of Object.entries(incoming)) {
    if (!sameJsonValue(current[key], value)) metadata[key] = value;
  }

  const appVersion = nonEmptyString(input.appVersion);
  if (appVersion && nonEmptyString(current.app_version) !== appVersion) metadata.app_version = appVersion;

  if (input.isActive) {
    const deactivatedAt = nonEmptyString(current.deactivated_at);
    const deactivatedReason = nonEmptyString(current.deactivated_reason);
    const wrongDeviceModel = nonEmptyString(current.wrong_device_model);

    if (deactivatedAt) {
      metadata.last_deactivated_at = deactivatedAt;
      metadata.deactivated_at = null;
    }
    if (deactivatedReason) {
      metadata.last_deactivated_reason = deactivatedReason;
      metadata.deactivated_reason = null;
    }
    if (wrongDeviceModel) {
      metadata.last_wrong_device_model = wrongDeviceModel;
      metadata.wrong_device_model = null;
    }
  }

  return metadata;
}
