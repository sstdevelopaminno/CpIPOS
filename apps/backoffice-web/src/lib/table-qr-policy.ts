export type TableQrExpiryMode = "time" | "bill";

export type TableQrPolicy = {
  version: 1;
  mode: TableQrExpiryMode;
  ttl_minutes: number | null;
};

export const DEFAULT_TABLE_QR_TTL_MINUTES = 18 * 60;
export const MIN_TABLE_QR_TTL_MINUTES = 15;
export const MAX_TABLE_QR_TTL_MINUTES = 24 * 60;
export const BILL_TABLE_QR_SAFETY_TTL_MINUTES = 7 * 24 * 60;

export const DEFAULT_TABLE_QR_POLICY: TableQrPolicy = {
  version: 1,
  mode: "time",
  ttl_minutes: DEFAULT_TABLE_QR_TTL_MINUTES
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
  }
  return null;
}

export function normalizeTableQrPolicyValue(value: unknown): TableQrPolicy {
  const record = asRecord(value);
  if (!record) return { ...DEFAULT_TABLE_QR_POLICY };

  if (record.mode === "bill") {
    return {
      version: 1,
      mode: "bill",
      ttl_minutes: null
    };
  }

  if (record.mode === "time") {
    const ttl = normalizeInteger(record.ttl_minutes);
    if (ttl !== null && ttl >= MIN_TABLE_QR_TTL_MINUTES && ttl <= MAX_TABLE_QR_TTL_MINUTES) {
      return {
        version: 1,
        mode: "time",
        ttl_minutes: ttl
      };
    }
  }

  return { ...DEFAULT_TABLE_QR_POLICY };
}

export function normalizeTableQrPolicyFromMetadata(metadata: unknown): TableQrPolicy {
  const record = asRecord(metadata);
  return normalizeTableQrPolicyValue(record?.qr_policy);
}

export function validateTableQrPolicyInput(value: unknown):
  | { ok: true; policy: TableQrPolicy }
  | { ok: false; code: "invalid_qr_policy_mode" | "invalid_qr_policy_ttl"; message: string } {
  const record = asRecord(value);
  if (!record || (record.mode !== "time" && record.mode !== "bill")) {
    return {
      ok: false,
      code: "invalid_qr_policy_mode",
      message: "QR expiry mode must be 'time' or 'bill'."
    };
  }

  if (record.mode === "bill") {
    return {
      ok: true,
      policy: {
        version: 1,
        mode: "bill",
        ttl_minutes: null
      }
    };
  }

  const ttl = normalizeInteger(record.ttl_minutes);
  if (ttl === null || ttl < MIN_TABLE_QR_TTL_MINUTES || ttl > MAX_TABLE_QR_TTL_MINUTES) {
    return {
      ok: false,
      code: "invalid_qr_policy_ttl",
      message: `QR expiry minutes must be an integer between ${MIN_TABLE_QR_TTL_MINUTES} and ${MAX_TABLE_QR_TTL_MINUTES}.`
    };
  }

  return {
    ok: true,
    policy: {
      version: 1,
      mode: "time",
      ttl_minutes: ttl
    }
  };
}

export function mergeTableQrPolicyMetadata(metadata: unknown, policy: TableQrPolicy): Record<string, unknown> {
  const existing = asRecord(metadata) ?? {};
  return {
    ...existing,
    qr_policy: policy
  };
}

export function tableQrPoliciesEqual(left: TableQrPolicy, right: TableQrPolicy): boolean {
  return left.mode === right.mode && left.ttl_minutes === right.ttl_minutes;
}

export function tableQrPolicyExpiryMs(policy: TableQrPolicy, createdAtMs = Date.now()): number {
  const ttlMinutes =
    policy.mode === "bill"
      ? BILL_TABLE_QR_SAFETY_TTL_MINUTES
      : policy.ttl_minutes ?? DEFAULT_TABLE_QR_TTL_MINUTES;
  return createdAtMs + ttlMinutes * 60_000;
}

export function tableQrSessionMatchesPolicy(args: {
  policy: TableQrPolicy;
  createdAt: string;
  expiresAt: string;
  toleranceMs?: number;
}): boolean {
  const createdAtMs = new Date(args.createdAt).getTime();
  const expiresAtMs = new Date(args.expiresAt).getTime();
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(expiresAtMs)) return false;
  const expected = tableQrPolicyExpiryMs(args.policy, createdAtMs);
  const toleranceMs = Math.max(0, args.toleranceMs ?? 60_000);
  return Math.abs(expiresAtMs - expected) <= toleranceMs;
}
