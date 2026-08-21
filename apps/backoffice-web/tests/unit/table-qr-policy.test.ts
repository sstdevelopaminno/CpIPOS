import { describe, expect, it } from "vitest";
import {
  BILL_TABLE_QR_SAFETY_TTL_MINUTES,
  DEFAULT_TABLE_QR_TTL_MINUTES,
  MAX_TABLE_QR_TTL_MINUTES,
  MIN_TABLE_QR_TTL_MINUTES,
  mergeTableQrPolicyMetadata,
  normalizeTableQrPolicyFromMetadata,
  tableQrPoliciesEqual,
  tableQrPolicyExpiryMs,
  tableQrSessionMatchesPolicy,
  validateTableQrPolicyInput
} from "@/lib/table-qr-policy";

describe("table QR expiry policy", () => {
  it("keeps the legacy 18 hour expiry when no policy exists", () => {
    expect(normalizeTableQrPolicyFromMetadata({})).toEqual({
      version: 1,
      mode: "time",
      ttl_minutes: DEFAULT_TABLE_QR_TTL_MINUTES
    });
  });

  it("accepts bill lifecycle mode without a customer TTL", () => {
    expect(validateTableQrPolicyInput({ mode: "bill" })).toEqual({
      ok: true,
      policy: { version: 1, mode: "bill", ttl_minutes: null }
    });
  });

  it("accepts bounded timed expiry and rejects unsafe values", () => {
    expect(validateTableQrPolicyInput({ mode: "time", ttl_minutes: 120 })).toEqual({
      ok: true,
      policy: { version: 1, mode: "time", ttl_minutes: 120 }
    });
    expect(validateTableQrPolicyInput({ mode: "time", ttl_minutes: MIN_TABLE_QR_TTL_MINUTES - 1 }).ok).toBe(false);
    expect(validateTableQrPolicyInput({ mode: "time", ttl_minutes: MAX_TABLE_QR_TTL_MINUTES + 1 }).ok).toBe(false);
  });

  it("preserves unrelated table metadata when storing the policy", () => {
    expect(
      mergeTableQrPolicyMetadata(
        { buffet: { enabled: true }, note: "window" },
        { version: 1, mode: "time", ttl_minutes: 90 }
      )
    ).toEqual({
      buffet: { enabled: true },
      note: "window",
      qr_policy: { version: 1, mode: "time", ttl_minutes: 90 }
    });
  });

  it("uses a seven day hard safety cap for bill lifecycle sessions", () => {
    const createdAt = Date.UTC(2026, 7, 21, 0, 0, 0);
    expect(tableQrPolicyExpiryMs({ version: 1, mode: "bill", ttl_minutes: null }, createdAt)).toBe(
      createdAt + BILL_TABLE_QR_SAFETY_TTL_MINUTES * 60_000
    );
  });

  it("detects sessions created under a different policy", () => {
    const createdAt = "2026-08-21T00:00:00.000Z";
    const expiry90 = "2026-08-21T01:30:00.000Z";
    expect(
      tableQrSessionMatchesPolicy({
        policy: { version: 1, mode: "time", ttl_minutes: 90 },
        createdAt,
        expiresAt: expiry90
      })
    ).toBe(true);
    expect(
      tableQrSessionMatchesPolicy({
        policy: { version: 1, mode: "time", ttl_minutes: 120 },
        createdAt,
        expiresAt: expiry90
      })
    ).toBe(false);
  });

  it("compares normalized policy values", () => {
    expect(
      tableQrPoliciesEqual(
        { version: 1, mode: "time", ttl_minutes: 90 },
        { version: 1, mode: "time", ttl_minutes: 90 }
      )
    ).toBe(true);
    expect(
      tableQrPoliciesEqual(
        { version: 1, mode: "time", ttl_minutes: 90 },
        { version: 1, mode: "bill", ttl_minutes: null }
      )
    ).toBe(false);
  });
});
