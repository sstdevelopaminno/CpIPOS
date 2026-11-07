import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const code = readFileSync(
  resolve(process.cwd(), "src/components/kitchen/kitchen-kds.tsx"),
  "utf8"
);

describe("Kitchen KDS stall recovery and partial bill completion", () => {
  it("times out read-only queue polls instead of leaving the UI indefinitely blocked", () => {
    expect(code).toContain("KITCHEN_QUEUE_REQUEST_TIMEOUT_MS = 12_000");
    expect(code).toContain("window.setTimeout(() => {\n      timedOut = true;\n      controller.abort();");
    expect(code).toContain("window.clearTimeout(timeoutId)");
    expect(code).toContain("if (controller.signal.aborted && !timedOut) return");
    expect(code).toContain("loadFailedRef.current = true");
    expect(code).toContain("inFlightRef.current = false");
    expect(code).toContain("MAX_ERROR_POLL_INTERVAL_MS");
  });

  it("continues to abort outstanding requests when switching Kitchen zones", () => {
    expect(code).toContain("queueAbortRef.current?.abort()");
    expect(code).toContain("queueAbortRef.current = null");
    expect(code).toContain("if (queueAbortRef.current === controller)");
    expect(code).toContain("if (disposed) return");
  });

  it("does not use a fail-fast Promise.all for multi-ticket completion", () => {
    const finishBill = code.slice(code.indexOf("async function finishBill("));
    expect(finishBill).toContain("await Promise.allSettled(");
    expect(finishBill).not.toContain("await Promise.all(");
    expect(finishBill).toContain('results[index].status === "fulfilled"');
    expect(finishBill).toContain("!completedIds.has(row.id)");
    expect(finishBill).toContain("originalStatus ? { ...row, status: originalStatus } : row");
    expect(finishBill).toContain('result.status === "rejected"');
    expect(finishBill).toContain("void load(true)");
    expect(finishBill).toContain("setBusy(busyKey, false)");
  });
});
