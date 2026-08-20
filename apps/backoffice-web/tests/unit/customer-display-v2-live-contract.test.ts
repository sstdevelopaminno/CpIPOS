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
  });

  it("publishes V2 state through the existing customer display API without a new database contract", () => {
    expect(publisher).toContain('fetch("/api/pos/customer-display"');
    expect(publisher).toContain("version: 2");
    expect(publisher).toContain("store_profile?.display_name");
    expect(publisher).toContain("store_profile?.logo_url");
    expect(publisher).toContain("device_policy");
    expect(publisher).not.toContain("supabase");
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
    for (const selector of [
      ".posui-payment-modal--cash",
      ".posui-payment-modal--transfer-qr-only",
      ".posui-transfer-qr-image",
      ".posui-payment-modal--receipt-final",
      ".posui-cash-summary-row--received",
      ".posui-cash-summary-row--accent"
    ]) {
      expect(paymentModals).toContain(selector);
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
