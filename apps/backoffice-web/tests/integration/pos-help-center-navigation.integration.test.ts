import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const staffMenu = source("../../src/components/pos-preview/pos-staff-menu.tsx");
const helpCenter = source("../../src/components/pos-preview/pos-help-center.tsx");
const subscriptionCenter = source("../../src/components/pos-preview/pos-subscription-center.tsx");
const supportCenter = source("../../src/components/pos-preview/pos-support-center.tsx");
const rootPage = source("../../src/app/preview/pos/payments/page.tsx");
const packagePage = source("../../src/app/preview/pos/payments/package/page.tsx");
const supportPage = source("../../src/app/preview/pos/payments/support/page.tsx");

describe("POS help center navigation", () => {
  it("keeps Help Center in the main navigation and renames the direct package action", () => {
    expect(staffMenu).toContain('lang === "th" ? "ศูนย์ช่วยเหลือ" : "Help Center"');
    expect(staffMenu).toContain('lang === "th" ? "ชำระแพ็กเกจ" : "Package Payment"');
    expect(staffMenu).toContain('href="/preview/pos/payments/package"');
    expect(staffMenu).toContain('pathname === "/preview/pos/payments"');
    expect(rootPage).toContain("PosHelpCenter");
  });

  it("removes the duplicate package card from Help Center", () => {
    expect(helpCenter).not.toContain("แพ็กเกจและการชำระเงิน");
    expect(helpCenter).not.toContain('href="/preview/pos/payments/package"');
    expect(helpCenter).toContain("ติดต่อสอบถาม / แจ้งปัญหา");
    expect(helpCenter).toContain('href="/preview/pos/payments/support"');
  });

  it("removes the standalone Chat item from the sidebar without deleting Support", () => {
    expect(staffMenu).not.toContain('lang === "th" ? "แชท" : "Chat"');
    expect(staffMenu).not.toContain('href="/preview/pos/payments/support"');
    expect(supportCenter).toContain("PosSupportChat");
    expect(supportPage).toContain("PosSupportCenter");
  });

  it("keeps package billing functional on its dedicated route", () => {
    expect(packagePage).toContain("showContactActions={false}");
    expect(packagePage).toContain('backHref="/preview/pos/payments"');
    expect(subscriptionCenter).toContain("showContactActions ? <>");
  });
});
