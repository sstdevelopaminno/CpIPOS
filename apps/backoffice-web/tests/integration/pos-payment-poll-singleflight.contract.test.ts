import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const code = readFileSync(
  resolve(process.cwd(), "src/components/pos/pos-sales-module.tsx"),
  "utf8"
);
const statusPoll = code.slice(
  code.indexOf("    let inFlight = false;\n    const pollStatus = async () =>"),
  code.indexOf("    const timer = window.setInterval(() => void pollStatus(), 2500);") + 100
);

describe("POS payment-status polling responsiveness", () => {
  it("allows only one in-flight status request during a slow payment provider response", () => {
    expect(statusPoll).toContain("let inFlight = false");
    expect(statusPoll).toContain('if (cancelled || inFlight || document.visibilityState !== "visible") return');
    expect(statusPoll).toContain("inFlight = true");
    expect(statusPoll).toContain("inFlight = false");
    expect(statusPoll).toContain("finally {");
    expect(statusPoll).toContain("12000");
    expect(statusPoll).toContain("2500");
  });

  it("preserves authoritative payment finalization and does not auto-retry a charge", () => {
    expect(statusPoll).toContain('body.data.status === "paid"');
    expect(statusPoll).toContain('setInetQrStatus("paid")');
    expect(statusPoll).toContain("setReceiptSession({");
    expect(statusPoll).not.toContain("POST");
  });

  it("rechecks only when returning to visible tab and disposes listeners on modal close", () => {
    expect(code).toContain('document.addEventListener("visibilitychange", onVisibilityChange)');
    expect(code).toContain('document.removeEventListener("visibilitychange", onVisibilityChange)');
    expect(code).toContain("if (document.visibilityState === \"visible\") void pollStatus()");
    expect(code).toContain("window.clearInterval(timer)");
  });
});
