import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const file = (name: string) => readFileSync(resolve(process.cwd(), "src", name), "utf8");
const page = file("app/preview/pos/payments/page.tsx");
const snapshot = file("lib/services/pos-subscription-center-service.ts");
const overview = file("app/api/pos/billing/overview/route.ts");
const request = file("app/api/pos/billing/requests/route.ts");
const ui = file("components/pos-preview/pos-subscription-center.tsx");

describe("Phase 1 POS subscription center (not cashier payments)", () => {
  it("derives scope from verified POS session and reads primary billing data", () => {
    expect(page).toContain("requirePosSession()");
    expect(page).toContain("PosSubscriptionCenter");
    expect(overview).toContain("requirePosSession()");
    expect(snapshot).toContain("getPrimarySupabaseServiceClient()");
    expect(snapshot).toContain('from("it_communication_settings")');
    expect(snapshot).toContain('from("tenant_subscription_payment_requests")');
    expect(snapshot).toContain('from("tenant_data_lifecycle")');
    expect(snapshot).toContain('authority: "CpIPOS-IT"');
    expect(snapshot).toContain('source: "CpiPOS-001"');
    expect(snapshot).toContain("open_request_count");
    expect(ui).toContain("เชื่อมต่อ IT");
    expect(ui).toContain("snapshot.control_plane.source");
    expect(snapshot).not.toContain('from("orders")');
    expect(snapshot).not.toContain('from("payments")');
  });
  it("does not accept a customer slip as bank confirmation, uses safe private bucket", () => {
    expect(request).toContain('scope.session.role !== "owner"');
    expect(request).toContain("SUBSCRIPTION_SLIP_BUCKET");
    expect(request).toContain('upsert:false');
    expect(request).toContain('status:"pending"');
    expect(request).toContain("requestKey");
    expect(request).toContain('contains("metadata",{kind:"renewal_intent"})');
    expect(request).toContain('in("status",["pending","under_review"])');
    expect(ui).toContain("แนบสลิปและแจ้งชำระคำขอเดิม");
    expect(request).not.toContain('"approved"');
    expect(request).not.toContain('from("payments")');
    expect(request).not.toContain('from("shifts")');
  });
  it("replaces misleading demo sentinel and separates LINE contact QR from payments", () => {
    expect(ui).toContain("แพ็กเกจและการชำระเงิน");
    expect(ui).toContain("QR LINE สำหรับติดต่อเท่านั้น");
    expect(ui).toContain("ไม่ต่ออายุหรือออกใบเสร็จอัตโนมัติ");
    expect(snapshot).toContain("n < 999999");
    expect(ui).toContain("ไม่จำกัด");
    expect(ui).toContain("บัญชีทดสอบภายใน");
    expect(ui).toContain("แพ็กเกจ");
    expect(ui).toContain("เอกสาร");
  });
});
