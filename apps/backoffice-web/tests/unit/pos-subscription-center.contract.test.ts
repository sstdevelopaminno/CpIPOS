import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const file = (name: string) => readFileSync(resolve(process.cwd(), "src", name), "utf8");
const page = file("app/preview/pos/payments/page.tsx");
const snapshot = file("lib/services/pos-subscription-center-service.ts");
const overview = file("app/api/pos/billing/overview/route.ts");
const request = file("app/api/pos/billing/requests/route.ts");
const receiptRoute = file("app/api/pos/billing/receipts/[receiptId]/route.ts");
const receiptTemplate = file("lib/printing/subscription-receipt-html-template.ts");
const ui = file("components/pos-preview/pos-subscription-center.tsx");

describe("POS subscription center (commercial billing, not cashier payments)", () => {
  it("derives scope from verified POS session and reads primary billing data", () => {
    expect(page).toContain("requirePosSession()");
    expect(page).toContain("PosSubscriptionCenter");
    expect(overview).toContain("requirePosSession()");
    expect(snapshot).toContain("getPrimarySupabaseServiceClient()");
    expect(snapshot).toContain('from("it_communication_settings")');
    expect(snapshot).toContain('from("tenant_subscription_payment_requests")');
    expect(snapshot).toContain('from("tenant_data_lifecycle")');
    expect(snapshot).toContain('from("tenant_subscription_receipts")');
    expect(snapshot).toContain('authority: "CpIPOS-IT"');
    expect(snapshot).toContain('source: "CpiPOS-001"');
    expect(snapshot).toContain("open_request_count");
    expect(ui).toContain("เชื่อมต่อ IT");
    expect(ui).toContain("snapshot.control_plane.source");
    expect(snapshot).not.toContain('from("orders")');
    expect(snapshot).not.toContain('from("payments")');
  });

  it("does not accept a customer slip as bank confirmation", () => {
    expect(request).toContain('scope.session.role !== "owner"');
    expect(request).toContain("SUBSCRIPTION_SLIP_BUCKET");
    expect(request).toContain('upsert:false');
    expect(request).toContain('status:"pending"');
    expect(request).toContain("requestKey");
    expect(request).toContain('contains("metadata",{kind:"renewal_intent"})');
    expect(request).toContain('in("status",["pending","under_review"])');
    expect(ui).toContain("แนบสลิปและแจ้งชำระคำขอเดิม");
    expect(ui).toContain("เมื่อ IT ตรวจสอบเงินเข้าบัญชีบริษัท");
    expect(request).not.toContain('"approved"');
    expect(request).not.toContain('from("payments")');
    expect(request).not.toContain('from("shifts")');
  });

  it("shows only immutable issued receipts and keeps them tenant-scoped", () => {
    expect(snapshot).toContain('from("tenant_subscription_receipts")');
    expect(snapshot).toContain('type: "receipt" as const');
    expect(ui).toContain("เปิดใบเสร็จ / พิมพ์ PDF");
    expect(ui).toContain("/api/pos/billing/receipts/");
    expect(ui).toContain("หนึ่งใบต่อหนึ่งรายการรับเงิน");
    expect(receiptRoute).toContain("requirePosSession()");
    expect(receiptRoute).toContain('.eq("tenant_id", scope.session.tenant_id)');
    expect(receiptRoute).toContain('from("tenant_subscription_receipts")');
    expect(receiptRoute).toContain("renderSubscriptionReceiptHtml");
    expect(receiptTemplate).toContain("ใบเสร็จรับเงิน / RECEIPT");
    expect(receiptTemplate).toContain("ยืนยันรับเงินจริงแล้ว");
    expect(receiptTemplate).toContain("ไม่ใช่ใบกำกับภาษี VAT");
    expect(receiptTemplate).toContain("พิมพ์ / บันทึกเป็น PDF");
  });


  it("mirrors IT payment review results into POS history and package documents", () => {
    expect(snapshot).toContain("payment_request_id");
    expect(snapshot).toContain("package_name: requestedPackage?.name");
    expect(snapshot).toContain("expected_amount: expected");
    expect(snapshot).toContain("receipt: issuedReceipt");
    expect(snapshot).toContain("payment_summary");
    expect(snapshot).toContain("monthly_paid");
    expect(snapshot).toContain("yearly_paid");
    expect(snapshot).toContain("total_paid");
    expect(ui).toContain("ข้อมูลเดียวกับฝั่ง IT จาก CpiPOS-001");
    expect(ui).toContain("ยอดชำระรายเดือน");
    expect(ui).toContain("ยอดชำระรายปี");
    expect(ui).toContain("ยอดรับชำระรวม");
    expect(ui).toContain("ยอดตามแพ็กเกจ");
    expect(ui).toContain("row.receipt.number");
    expect(ui).toContain("document.package_name");
    expect(ui).toContain("document.billing_interval");
    expect(ui).toContain("document.period_start");
  });

  it("replaces misleading demo sentinel and separates LINE contact QR from payments", () => {
    expect(ui).toContain("แพ็กเกจและการชำระเงิน");
    expect(ui).toContain("QR LINE สำหรับติดต่อเท่านั้น");
    expect(snapshot).toContain("n < 999999");
    expect(ui).toContain("ไม่จำกัด");
    expect(ui).toContain("บัญชีทดสอบภายใน");
    expect(ui).toContain("แพ็กเกจ");
    expect(ui).toContain("เอกสาร");
  });
});
