import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCustomerDisplayV2Channel,
  CUSTOMER_DISPLAY_V2_IDLE_TIMEOUT_MS,
  resolveCustomerDisplayV2Phase
} from "../../src/lib/customer-display-v2";

function readSource(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const publisher = readSource("src/components/pos/pos-customer-display-v2-publisher.tsx");
const observer = readSource("src/components/pos/pos-customer-display-v2-payment-observer.tsx");
const screen = readSource("src/components/pos/pos-customer-display-v2-screen.tsx");
const liveDisplay = readSource("src/components/pos/pos-customer-display-v2-live.tsx");
const setupPage = readSource("src/app/preview/pos/customer-display/v2-setup/page.tsx");
const livePage = readSource("src/app/customer-display/v2/page.tsx");
const publishRoute = readSource("src/app/api/pos/customer-display/v2/publish/route.ts");
const paymentModals = readSource("src/components/pos/pos-payment-modals.tsx");

describe("Customer Display V2 live integration contract", () => {
  it("keeps the live idle timeout at five minutes", () => {
    expect(CUSTOMER_DISPLAY_V2_IDLE_TIMEOUT_MS).toBe(300_000);
    expect(resolveCustomerDisplayV2Phase({
      nowMs: 300_000,
      lastActivityAtMs: 0,
      itemCount: 0,
      paymentState: null
    })).toBe("idle");
    expect(resolveCustomerDisplayV2Phase({
      nowMs: 299_999,
      lastActivityAtMs: 0,
      itemCount: 0,
      paymentState: null
    })).toBe("cart");
  });

  it("uses a POS-device-scoped channel instead of the legacy branch-wide main channel", () => {
    const channelA = buildCustomerDisplayV2Channel({ id: "device-a", code: "POS-01" });
    const channelB = buildCustomerDisplayV2Channel({ id: "device-b", code: "POS-02" });
    expect(channelA).toBe("pos-device-a-display");
    expect(channelB).toBe("pos-device-b-display");
    expect(channelA).not.toBe(channelB);
    expect(channelA).not.toBe("main");
    expect(channelA.length).toBeLessThanOrEqual(64);
    expect(publisher).toContain("buildCustomerDisplayV2Channel");
    expect(publisher).not.toContain('channel: "main"');
    expect(publishRoute).toContain("buildCustomerDisplayV2Channel");
    expect(publishRoute).toContain("scope.session.device_id");
    expect(publishRoute).toContain("scope.session.device_code");
  });

  it("publishes V2 state through a sales-authorized server-scoped endpoint without a new database contract", () => {
    expect(publisher).toContain('fetch("/api/pos/customer-display/v2/publish"');
    expect(publisher).toContain("JSON.stringify({ payload })");
    expect(publisher).toContain("version: 2");
    expect(publisher).toContain("store_profile?.display_name");
    expect(publisher).toContain("store_profile?.logo_url");
    expect(publisher).toContain("device_policy");
    expect(publisher).not.toContain("supabase");
    expect(publishRoute).toContain('requirePermission(scope, "sale:create")');
    expect(publishRoute).toContain('"customer_facing_display"');
    expect(publishRoute).toContain('from("pos_customer_display_states").upsert');
    expect(publishRoute).toContain('onConflict: "tenant_id,branch_id,channel"');
  });

  it("scans same-tab local POS state quickly while deduping unchanged network payloads", () => {
    expect(publisher).toContain("const LOCAL_STATE_SCAN_MS = 500;");
    expect(publisher).toContain("publishedSignatureRef.current === signature");
    expect(publisher).toContain("window.setInterval(() => schedule(0), LOCAL_STATE_SCAN_MS)");
  });

  it("uses the existing transparent system asset as the no-logo fallback", () => {
    expect(screen).toContain('/brand/cpipos-symbol-transparent.png');
    expect(screen).not.toContain('/brand/cpipos-logo.png');
    expect(screen).toContain("SystemBrand");
    expect(screen).toContain("background: transparent");
  });

  it("has no manual customer-facing phase controls in the live renderer", () => {
    expect(screen).not.toContain("<button");
    expect(screen).not.toContain("setPhase");
    expect(screen).not.toContain("PREVIEW_PHASES");
  });

  it("bridges existing payment UI states without mutating payment APIs", () => {
    const selectorContracts = [
      ["posui-payment-modal--cash", ".posui-payment-modal--cash"],
      ["posui-payment-modal--transfer-qr-only", ".posui-payment-modal--transfer-qr-only"],
      ["posui-transfer-qr-image", ".posui-transfer-qr-image"],
      ["posui-payment-modal--receipt-final", ".posui-payment-modal--receipt-final"],
      ["posui-cash-summary-row--received", ".posui-cash-summary-row--received"],
      ["posui-cash-summary-row--accent", ".posui-cash-summary-row--accent"]
    ] as const;

    for (const [className, selector] of selectorContracts) {
      expect(paymentModals).toContain(className);
      expect(observer).toContain(selector);
    }
    expect(observer).toContain("MutationObserver");
    expect(observer).not.toContain("/api/pos/payments");
    expect(observer).not.toContain("fetch(");
  });

  it("shows the real transfer QR source when the existing payment modal exposes it", () => {
    expect(observer).toContain("qr?.currentSrc || qr?.src || null");
    expect(screen).toContain("state.payment_qr_url");
    expect(screen).toContain('className="cdv2-qr-img"');
  });

  it("keeps pairing management protected while the display route exposes data only through a device token", () => {
    expect(setupPage).toContain('requirePosPagePermission("customer_display:manage")');
    expect(livePage).toContain("PosCustomerDisplayV2Live");
    expect(livePage).not.toContain("requirePosPagePermission");
    expect(liveDisplay).toContain('"x-customer-display-token": deviceToken');
    expect(liveDisplay).toContain("/api/pos/customer-display/pairings/claim");
    expect(liveDisplay).toContain("version !== 2");
  });
});
