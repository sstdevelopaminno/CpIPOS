import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd(), "../..");
const claim = readFileSync(resolve(process.cwd(), "src/lib/printing/print-agent-claim-stabilized.ts"), "utf8");
const notice = readFileSync(resolve(process.cwd(), "src/lib/printing/payment-notice-html-template.ts"), "utf8");
const sales = readFileSync(resolve(process.cwd(), "src/components/pos/pos-sales-module.tsx"), "utf8");
const agent = readFileSync(resolve(root, "apps/pos-android/app/src/main/java/com/cpipos/pos/PosPrintAgent.kt"), "utf8");
const main = readFileSync(resolve(root, "apps/pos-android/app/src/main/java/com/cpipos/pos/MainActivity.kt"), "utf8");
const gradle = readFileSync(resolve(root, "apps/pos-android/app/build.gradle.kts"), "utf8");
const migration = readFileSync(resolve(root, "supabase/migrations/202608170002_prioritize_cash_drawer_print_claim.sql"), "utf8");

describe("print latency stability contract", () => {
  it("keeps idle polling adaptive while allowing a fresh job through server suppression quickly", () => {
    expect(claim).toContain("const EMPTY_CLAIM_BACKOFF_MS = 250;");
    expect(agent).toContain("longArrayOf(1L, 3L, 8L)");
    expect(agent).toContain('claim_poll_policy", "adaptive_1_3_8s');
  });

  it("wakes the single-thread Android print worker after queue-producing POS calls", () => {
    expect(sales).toContain("wakeNativePrintAgent()");
    expect(main).toContain('addJavascriptInterface(nativePrintAgent, "CpiposPrint")');
    expect(agent).toContain("fun notifyPrintQueued()");
    expect(agent).toContain("bootstrapRetryAfterElapsedMs = 0L");
    expect(agent).toContain("WAKE_RETRY_DELAY_MS = 350L");
  });

  it("prefetches payment QR data and tightens only the QR layout gap", () => {
    expect(sales).toContain("paymentNoticeQrDataUriCacheRef");
    expect(sales).toContain('cache: "force-cache"');
    expect(notice).toContain(".due-before-qr");
    expect(notice).toContain(".qr-wrap");
    expect(notice).toContain("display: block");
  });

  it("keeps POS table refresh and bridge print bounded so the sales UI stays responsive", () => {
    expect(sales).toContain("RECEIPT_BRIDGE_REQUEST_TIMEOUT_MS = 4500");
    expect(sales).toContain("tableRefreshInFlightRef");
    expect(sales).toContain("activeTableBillRefreshInFlightRef");
    expect(sales).toContain("tableBrowserOpen ? 15000 : 30000");
    expect(sales).toContain("window.setInterval(refreshActiveTableBill, 15000)");
  });

  it("prioritizes drawer pulse claims without lowering Android compatibility", () => {
    expect(migration).toContain("open_cash_drawer' then 0 else 1");
    expect(gradle).toContain("minSdk = 26");
    expect(gradle).toContain('versionName = "1.0.12"');
    expect(gradle).toContain("versionCode = 18");
  });
});
