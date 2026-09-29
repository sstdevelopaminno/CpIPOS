import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const staffMenu = source("../../src/components/pos-preview/pos-staff-menu.tsx");
const settings = source("../../src/components/pos-preview/pos-settings-workspace.tsx");
const helpCenter = source("../../src/components/pos-preview/pos-help-center.tsx");
const subscriptionCenter = source("../../src/components/pos-preview/pos-subscription-center.tsx");
const supportCenter = source("../../src/components/pos-preview/pos-support-center.tsx");
const shell = source("../../src/components/pos-preview/pos-shell-sidebar.tsx");
const push = source("../../src/components/pos-preview/pos-support-push-control.tsx");
const rootPage = source("../../src/app/preview/pos/payments/page.tsx");
const packagePage = source("../../src/app/preview/pos/payments/package/page.tsx");
const supportPage = source("../../src/app/preview/pos/payments/support/page.tsx");

describe("POS help center navigation", () => {
  it("moves Help Center from the sidebar into Settings while keeping direct package payment", () => {
    expect(staffMenu).not.toContain('lang === "th" ? "ศูนย์ช่วยเหลือ" : "Help Center"');
    expect(staffMenu).not.toContain('href="/preview/pos/payments"');
    expect(staffMenu).toContain('href="/preview/pos/payments/package"');
    expect(staffMenu).toContain('isPosMenuEnabled("main.package_payment", menuPolicy)');
    expect(settings).toContain('title={lang === "en" ? "Help Center" : "ศูนย์ช่วยเหลือ"}');
    expect(settings).toContain('href="/preview/pos/payments"');
    expect(settings).toContain('menuVisible("settings.support")');
    expect(rootPage).toContain("PosHelpCenter");
  });

  it("keeps Help Center focused on support without a duplicate billing card", () => {
    expect(helpCenter).not.toContain("แพ็กเกจและการชำระเงิน");
    expect(helpCenter).not.toContain('href="/preview/pos/payments/package"');
    expect(helpCenter).toContain("ติดต่อสอบถาม / แจ้งปัญหา");
    expect(helpCenter).toContain('href="/preview/pos/payments/support"');
  });

  it("moves push notification status out of the sidebar and into Settings", () => {
    expect(shell).not.toContain("PosSupportPushControl");
    expect(shell).toContain("PosSupportPushBridge");
    expect(settings).toContain("PosSupportPushSettingsModal");
    expect(settings).toContain('menuVisible("settings.push_notifications")');
    expect(settings).toContain("การแจ้งเตือนอุปกรณ์");
    expect(push).toContain("export function PosSupportPushBridge");
    expect(push).toContain("export function PosSupportPushSettingsModal");
  });

  it("keeps Support chat and package billing routes functional", () => {
    expect(supportCenter).toContain("PosSupportChat");
    expect(supportPage).toContain("PosSupportCenter");
    expect(packagePage).toContain("showContactActions={false}");
    expect(packagePage).toContain('backHref="/preview/pos/payments"');
    expect(subscriptionCenter).toContain("showContactActions ? <>");
  });
});
