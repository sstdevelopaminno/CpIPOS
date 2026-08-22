import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const server = source("../../src/lib/table-qr-ordering.ts");
const mobile = source("../../src/components/table-order/table-order-mobile.tsx");

describe("table QR post-commit stability", () => {
  it("scopes fingerprint mutation and makes enrichment non-fatal", () => {
    expect(server).toContain('.eq("tenant_id", args.context.tenant_id)');
    expect(server).toContain('.eq("branch_id", args.context.branch_id)');
    expect(server).toContain("duplicate fingerprint payload marking skipped");
  });

  it("queues kitchen printing before non-authoritative fingerprint enrichment", () => {
    const queueAt = server.indexOf("await queueTableQrKitchenPrints({ context, orderId: row.order_id, requestId });");
    const markAt = server.indexOf("await markQrOrderPayloadFingerprint({ context, submissionId: row.submission_id");
    expect(queueAt).toBeGreaterThan(-1);
    expect(markAt).toBeGreaterThan(queueAt);
  });

  it("reuses the same idempotency key after an uncertain submit result", () => {
    expect(mobile).toContain("const submitRetryRef = useRef<{ requestId: string; fingerprint: string } | null>(null);");
    expect(mobile).toContain("retry?.fingerprint === fingerprint ? retry.requestId : buildRequestId()");
    expect(mobile).toContain("submitRetryRef.current = { requestId, fingerprint };");
  });

  it("refreshes authoritative cashier bill state quickly", () => {
    expect(mobile).toContain("const MENU_STATUS_POLL_MS = 3_000;");
  });
});
