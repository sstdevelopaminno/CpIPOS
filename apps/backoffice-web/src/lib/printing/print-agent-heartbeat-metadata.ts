type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

export function buildPrintAgentHeartbeatMetadata(input: {
  currentMetadata: unknown;
  heartbeatMetadata?: JsonRecord | null;
  appVersion?: string | null;
  isActive: boolean;
}): JsonRecord {
  const current = asRecord(input.currentMetadata);
  const metadata: JsonRecord = { ...asRecord(input.heartbeatMetadata) };
  const appVersion = nonEmptyString(input.appVersion);

  if (appVersion) metadata.app_version = appVersion;

  if (input.isActive) {
    const deactivatedAt = nonEmptyString(current.deactivated_at);
    const deactivatedReason = nonEmptyString(current.deactivated_reason);
    const wrongDeviceModel = nonEmptyString(current.wrong_device_model);

    if (deactivatedAt) metadata.last_deactivated_at = deactivatedAt;
    if (deactivatedReason) metadata.last_deactivated_reason = deactivatedReason;
    if (wrongDeviceModel) metadata.last_wrong_device_model = wrongDeviceModel;

    metadata.deactivated_at = null;
    metadata.deactivated_reason = null;
    metadata.wrong_device_model = null;
  }

  return metadata;
}
