import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const file = (name: string) => readFileSync(resolve(process.cwd(), "src", name), "utf8");
const page = file("app/preview/pos/payments/page.tsx");
const packagePage = file("app/preview/pos/payments/package/page.tsx");
const snapshot = file("lib/services/pos-subscription-center-service.ts");
const overview = file("app/api/pos/billing/overview/route.ts");
const request = file("app/api/pos/billing/requests/route.ts");
const receiptRoute = file("app/api/pos/billing/receipts/[receiptId]/route.ts");
const receiptTemplate = file("lib/printing/subscription-receipt-html-template.ts");
const ui = file("components/pos-preview/pos-subscription-center.tsx");
const lifecycleGuard = file("components/pos-preview/pos-subscription-lifecycle-guard.tsx");
const lifecycleService = file("lib/services/pos-subscription-lifecycle-guard-service.ts");
const sessionGuard = file("lib/pos-session-guard.ts");
const previewLayout = file("app/preview/pos/layout.tsx");

describe("POS subscription center (commercial billing, not cashier payments)", () => {
  it("derives scope from verified POS session and reads primary billing data", () => {
    expect(page).toContain("requirePosSession()");
    expect(page).toContain("PosHelpCenter");
    expect(packagePage).toContain("requirePosSession()");
    expect(packagePage).toContain("PosSubscriptionCenter");
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
    expect(request).toContain('in("status",["pending","under_review"])');
    expect(request).toContain("completingItPreparedPayment");
    expect(request).toContain('existingById.metadata?.source==="it_tenant_control"');
    expect(request).toContain('.eq("requested_package_id",target.id)');
    expect(ui).toContain("ส่งหลักฐานการชำระคำขอเดิม");
    expect(ui).toContain("ฝ่าย IT ยืนยันเงินเข้าบัญชีบริษัท");
    expect(request).not.toContain('"approved"');
    expect(request).not.toContain('from("payments")');
    expect(request).not.toContain('from("shifts")');
  });

  it("lets the owner complete an IT-created first-payment request without creating a duplicate", () => {
    expect(snapshot).toContain('source: typeof row.metadata?.source');
    expect(snapshot).toContain('created_by_it: row.metadata?.source === "it_tenant_control"');
    expect(ui).toContain("pendingCanAcceptPayment");
    expect(ui).toContain("ฝ่าย IT สร้างรายการชำระไว้แล้ว");
    expect(ui).toContain("รายการชำระถูกเตรียมจากฝ่าย IT แล้ว");
    expect(ui).toContain("บันทึกหลักฐานลงในคำขอเดิมโดยไม่สร้างรายการซ้ำ");
    expect(ui).toContain("pendingCanAcceptPayment && pending");
    expect(request).toContain("upgradingRenewal || completingItPreparedPayment");
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
    expect(receiptRoute).toContain('from("tenant_subscription_receipt_annotations")');
    expect(receiptRoute).toContain("ยกเลิกเอกสาร / VOID");
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

  it("keeps annual billing disabled until IT explicitly sets a yearly price", () => {
    expect(ui).toContain("รอบรายปียังไม่เปิดใช้งาน");
    expect(ui).toContain("รอฝ่าย IT บันทึกราคารายปีใน CpiPOS-001 ก่อน");
    expect(ui).toContain("รายปีพร้อมใช้งาน");
    expect(ui).toContain("choice === \"yearly\" && !annualAvailable");
    expect(ui).toContain("Boolean(packageRow?.yearly_price)");
  });

  it("warns before expiry, blocks sales after expiry, and keeps billing access available", () => {
    expect(lifecycleService).toContain('from("tenant_data_lifecycle")');
    expect(lifecycleService).toContain("days_remaining");
    expect(lifecycleService).toContain("grace_until");
    expect(sessionGuard).toContain('row?.lifecycle_status === "grace"');
    expect(lifecycleService).toContain("billing_bank_account_number");
    expect(lifecycleGuard).toContain("แพ็กเกจใกล้ครบกำหนดชำระ");
    expect(lifecycleGuard).toContain("แพ็กเกจครบกำหนดชำระแล้ว");
    expect(lifecycleGuard).toContain('pathname==="/preview/pos/payments/package"');
    expect(lifecycleGuard).toContain('router.push("/preview/pos/payments/package")');
    expect(lifecycleGuard).toContain("บัญชีบริษัท:");
    expect(previewLayout).toContain("PosSubscriptionLifecycleGuard");
    expect(sessionGuard).toContain("assertSubscriptionAllowsSales");
    expect(sessionGuard).toContain('from("tenant_subscription_runtime")');
    expect(sessionGuard).toContain("subscription_access_locked");
    expect(sessionGuard).toContain("getPrimarySupabaseServiceClient");
    expect(sessionGuard).toContain("await assertSubscriptionAllowsSales(scope.session.tenant_id)");
  });

  it("uses one slip upload without exposing internal AI scan copy or manual transfer fields", () => {
    expect(ui).toContain("ประวัติการชำระแพ็กเกจ");
    expect(ui).toContain("เอกสารแพ็กเกจ");
    expect(ui).toContain("ต่ออายุแพ็กเกจ");
    expect(ui).toContain("แจ้งชำระเงิน");
    expect(ui).toContain("เลือกรูปสลิปจากเครื่อง");
    expect(ui).toContain("ส่งหลักฐานการชำระเงิน");
    expect(ui).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(ui).not.toContain("AI Slip Scan:");
    expect(ui).not.toContain("AI จะเทียบยอดกับสลิปให้อัตโนมัติ");
    expect(ui).not.toContain("หลังโอนเสร็จ แนบเพียงรูปสลิป ระบบจะอ่านข้อมูลการโอนให้อัตโนมัติด้วย AI");
    expect(ui).not.toContain("AI ช่วยอ่านข้อมูลจากสลิปเพื่อส่งให้ฝ่าย IT ตรวจสอบ");
    expect(ui).not.toContain('capture="environment"');
    expect(ui).not.toContain("ถ่ายรูปสลิป");
    expect(ui).not.toContain("จำนวนเงินที่โอน");
    expect(ui).not.toContain("วันที่และเวลาที่โอน");
    expect(ui).not.toContain("ชื่อผู้โอน</");
    expect(ui).not.toContain("เลขที่อ้างอิงการโอน");
    expect(ui).not.toContain("กลับศูนย์ช่วยเหลือ");
    expect(request).toContain("scanSubscriptionSlip");
    expect(request).toContain("slip_ai:");
    expect(request).toContain("slip_ai_status");
    expect(request).not.toContain('form.get("amount_reported")');
    expect(request).not.toContain('form.get("payer_name")');
    expect(request).not.toContain('form.get("transfer_reference")');
    expect(request).not.toContain('form.get("transfer_at")');
    expect(ui).toContain('selectTab("notice")');
  });

  it("reveals AI Add-on payment steps only after the owner selects the Add-on", () => {
    expect(ui).toContain("setAiCheckoutOpen(true)");
    expect(ui).toContain('const aiCheckoutActive = tab === "ai" && aiPurchaseReady && aiCheckoutOpen');
    expect(ui).toContain("เลือก AI Add-on");
    expect(ui).toContain("ชำระค่า AI Add-on");
    expect(ui).toContain('<StepLabel number={3}>แนบหลักฐานการโอนเงิน</StepLabel>');
    expect(ui).toContain("เลือกแล้ว · ดำเนินการต่อด้านล่าง");
  });

  it("uses detailed result dialogs with explicit next steps for every request path", () => {
    expect(ui).toContain("showResultPopup");
    expect(ui).toContain("ส่งคำขอต่ออายุสำเร็จ");
    expect(ui).toContain("ไปแจ้งชำระเงิน");
    expect(ui).toContain("ส่งหลักฐานการชำระเงินสำเร็จ");
    expect(ui).toContain("ดูสถานะการชำระ");
    expect(ui).toContain("ส่งคำขอ CUSTOM สำเร็จ");
    expect(ui).toContain("ขั้นตอนถัดไป");
    expect(ui).toContain("continueFromResultPopup");
  });

  it("opens recorded billing cycles from a dedicated history action", () => {
    expect(ui).toContain("setBillingCyclesOpen(true)");
    expect(ui).toContain('aria-label="รอบบิลที่บันทึกแล้ว"');
    expect(ui).toContain("snapshot.cycles.length");
    expect(ui).toContain("ยอดบันทึกชำระ");
    expect(ui).toContain('cycle.status === "paid" ? "ชำระแล้ว"');
  });

  it("renders CpiPOS AI as package cards using IT quota plus Subscription Add-on data", () => {
    expect(snapshot).toContain('from("pos_ai_package_quotas")');
    expect(snapshot).toContain("ai_quota_enabled");
    expect(snapshot).toContain("ai_monthly_tokens");
    expect(snapshot).toContain("ai_monthly_tokens: amount(aiQuota?.monthly_token_limit)");
    expect(ui).toContain("AI Quota ต่อแพ็กเกจ / ต่อเดือน");
    expect(ui).toContain("แพ็กเกจ / Subscription");
    expect(ui).toContain("AI Add-on · รอบเดือนปัจจุบัน");
    expect(ui).toContain("snapshot.packages.map");
    expect(ui).toContain("aiPurchaseReady");
  });

  it("reflects receipt correction and void status written by IT", () => {
    expect(snapshot).toContain('from("tenant_subscription_receipt_annotations")');
    expect(snapshot).toContain("receiptAnnotationById");
    expect(snapshot).toContain("voided:");
    expect(snapshot).toContain("correction_note:");
    expect(ui).toContain("เอกสารถูกยกเลิกโดย IT");
    expect(ui).toContain("ยกเลิกเอกสาร");
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
