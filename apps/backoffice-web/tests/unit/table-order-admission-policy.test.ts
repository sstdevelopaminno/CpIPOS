import { describe, expect, it } from "vitest";
import {
  TABLE_ORDER_CONTENTION_MAX_ATTEMPTS,
  resolveTableOrderContentionRetryMs
} from "../../src/lib/table-order-admission-policy";

describe("table order admission policy", () => {
  it("retries transient table contention with bounded delay", () => {
    expect(resolveTableOrderContentionRetryMs({ status: 409, errorCode: "table_order_busy", retryAfter: "1", attempt: 1 })).toBe(1000);
    expect(resolveTableOrderContentionRetryMs({ status: 409, errorCode: "table_order_busy", retryAfter: null, attempt: 1 })).toBe(650);
    expect(resolveTableOrderContentionRetryMs({ status: 409, errorCode: "table_order_busy", retryAfter: null, attempt: 2 })).toBe(1100);
  });

  it("stops after the bounded attempt count", () => {
    expect(TABLE_ORDER_CONTENTION_MAX_ATTEMPTS).toBe(3);
    expect(resolveTableOrderContentionRetryMs({ status: 409, errorCode: "table_order_busy", retryAfter: "1", attempt: 3 })).toBeNull();
  });

  it("does not retry unrelated conflicts or rate-limit responses", () => {
    expect(resolveTableOrderContentionRetryMs({ status: 409, errorCode: "table_order_not_available", attempt: 1 })).toBeNull();
    expect(resolveTableOrderContentionRetryMs({ status: 429, errorCode: "rate_limited", retryAfter: "5", attempt: 1 })).toBeNull();
    expect(resolveTableOrderContentionRetryMs({ status: 500, errorCode: "table_order_failed", attempt: 1 })).toBeNull();
  });

  it("clamps retry-after so a QR request cannot stall the UI indefinitely", () => {
    expect(resolveTableOrderContentionRetryMs({ status: 409, errorCode: "table_order_busy", retryAfter: "0", attempt: 1 })).toBe(250);
    expect(resolveTableOrderContentionRetryMs({ status: 409, errorCode: "table_order_busy", retryAfter: "10", attempt: 1 })).toBe(1500);
  });
});
