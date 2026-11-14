import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), "src", path), "utf8");
const center = read("components/pos-preview/pos-subscription-center.tsx");
const menu = read("components/pos-preview/pos-staff-menu.tsx");
const api = read("app/api/pos/billing/alert-count/route.ts");

describe("customer package payment UI redesign", () => {
  it("places payment status and promotion in one responsive row", () => {
    expect(center).toContain('grid items-stretch gap-4 xl:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)]');
    expect(center).toContain("lg:flex-row lg:items-center lg:justify-between");
    expect(center).toContain("applies_to_current_due");
  });
  it("moves all existing actions above equally sized package and summary cards", () => {
    const actionPos = center.indexOf('aria-label="การดำเนินการเกี่ยวกับแพ็กเกจ"');
    const packagePos = center.indexOf('aria-label={ui("ข้อมูลแพ็กเกจปัจจุบัน")}');
    const summaryPos = center.indexOf('aria-label={ui("สรุปข้อมูลแพ็กเกจ")}');
    expect(actionPos).toBeGreaterThan(0);
    expect(actionPos).toBeLessThan(packagePos);
    expect(packagePos).toBeLessThan(summaryPos);
    expect(center).toContain("sm:grid-cols-2 xl:grid-cols-4");
    expect(center).toContain("grid auto-rows-fr gap-3");
    for (const label of ["ประวัติการชำระแพ็กเกจ", "เอกสารแพ็กเกจ", "ซื้อ CpiPOS AI เพิ่ม", "เลือก / อัปเกรดแพ็กเกจ", "ต่ออายุแพ็กเกจ", "แจ้งชำระเงิน"]) {
      expect(center).toContain(label);
    }
  });
  it("keeps internal IT database IDs out of customer-facing billing screens", () => {
    expect(center).not.toContain("เชื่อมต่อ IT");
    expect(center).not.toContain("CpiPOS-001");
    expect(center).toContain("รีเฟรชข้อมูล");
  });
  it("provides a tenant scoped authenticated billing alert API and no-store response", () => {
    expect(api).toContain("requirePosSessionForNonSaleRecovery");
    expect(api).toContain('scope.session.role !== "owner"');
    expect(api).toContain('scope.session.role !== "manager"');
    expect(api).toContain('.eq("tenant_id", scope.session.tenant_id)');
    expect(api).toContain('from("tenant_subscription_settlements")');
    expect(api).toContain('response.headers.set("Cache-Control", "private, no-store")');
    expect(api).not.toContain('from("tenant_billing_cycles").update');
  });
  it("shows the numeric payment badge and refreshes it on settlement without rapid polling", () => {
    expect(menu).toContain("unpaidBillingCount > 0");
    expect(menu).toContain("unpaidBillingCount > 99");
    expect(menu).toContain('fetch("/api/pos/billing/alert-count", { cache: "no-store" })');
    expect(menu).toContain("cpipos-billing-alert-refresh");
    expect(menu).toContain("cpipos-subscription-runtime-changed");
    expect(menu).toContain("90_000");
    expect(center).toContain('window.dispatchEvent(new Event("cpipos-billing-alert-refresh"))');
  });
});
