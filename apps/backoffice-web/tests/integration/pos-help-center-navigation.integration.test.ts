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
  it("renames the main payment navigation to Help Center while preserving the existing policy route", () => {
    expect(staffMenu).toContain('lang === "th" ? "ศูนย์ช่วยเหลือ" : "Help Center"');
    expect(staffMenu).toContain('href="/preview/pos/payments/support"');
    expect(staffMenu).toContain('href="/preview/pos/payments/package"');
    expect(staffMenu).toContain('pathname === "/preview/pos/payments"');
    expect(rootPage).toContain("PosHelpCenter");
  });

  it("renders exactly the two requested Help Center destinations", () => {
    expect(helpCenter).toContain("แพ็กเกจและการชำระเงิน");
    expect(helpCenter).toContain("ติดต่อสอบถาม / แจ้งปัญหา");
    expect(helpCenter).toContain('href="/preview/pos/payments/package"');
    expect(helpCenter).toContain('href="/preview/pos/payments/support"');
  });

  it("keeps billing on its own page and removes contact actions from that page", () => {
    expect(packagePage).toContain("showContactActions={false}");
    expect(packagePage).toContain('backHref="/preview/pos/payments"');
    expect(subscriptionCenter).toContain("showContactActions ? <>");
  });

  it("moves LINE QR and the existing Support Chat into the support submenu", () => {
    expect(supportCenter).toContain("LINE · QR ติดต่อบริษัท");
    expect(supportCenter).toContain("PosSupportChat");
    expect(supportCenter).toContain("แจ้งปัญหา");
    expect(supportCenter).toContain('href="/preview/pos/payments"');
    expect(supportPage).toContain("PosSupportCenter");
  });
});
