import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isIntegratedWindowsWebPos } from "../../src/lib/customer-display-v2";
import { renderPaymentNoticeHtml } from "../../src/lib/printing/payment-notice-html-template";

const source = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

afterEach(() => vi.unstubAllGlobals());

describe("Windows Web POS second-screen integration", () => {
  it("detects only the installed Windows WebView2 POS runtime, not ordinary browser POS", () => {
    vi.stubGlobal("window", { CpIPOSWindowsRuntime: { runtime: "windows_native_webview2" } });
    expect(isIntegratedWindowsWebPos()).toBe(true);
    vi.stubGlobal("window", { CpIPOSWindowsRuntime: { runtime: "another_process" } });
    expect(isIntegratedWindowsWebPos()).toBe(false);
    vi.stubGlobal("window", {});
    expect(isIntegratedWindowsWebPos()).toBe(false);
  });

  it("enables both cart and payment publishing on integrated Windows without a manual pairing code", () => {
    const publisher = source("src/components/pos/pos-customer-display-v2-publisher.tsx");
    const observer = source("src/components/pos/pos-customer-display-v2-payment-observer.tsx");
    const screen = source("src/components/pos/pos-customer-display-v2-native.tsx");
    const cashier = source("../../apps/windows-runtime-native/Cpipos.WindowsRuntime/MainForm.cs");
    const externalWindow = source("../../apps/windows-runtime-native/Cpipos.WindowsRuntime/CustomerDisplayWindow.cs");
    expect(publisher).toContain("!isIntegratedWindowsWebPos()");
    expect(observer).toContain("!isIntegratedWindowsWebPos()");
    expect(publisher).toContain('fetch("/api/pos/customer-display/v2/publish"');
    expect(publisher).toContain("items: cart.map((item)");
    expect(observer).toContain("CUSTOMER_DISPLAY_V2_PAYMENT_EVENT");
    expect(screen).toContain('fetch("/api/pos/customer-display/v2/native-state"');
    expect(screen).toContain('credentials: "same-origin"');
    expect(cashier).toContain("Screen.AllScreens.FirstOrDefault(screen => !screen.Primary)");
    expect(externalWindow).toContain("EnsureCoreWebView2Async(environment)");
    expect(externalWindow).toContain("/customer-display/v2/native");
    expect(externalWindow).not.toContain("bridge_token");
  });

  it("keeps customer display device/tenant and branch boundaries on both API directions", () => {
    const publish = source("src/app/api/pos/customer-display/v2/publish/route.ts");
    const read = source("src/app/api/pos/customer-display/v2/native-state/route.ts");
    for (const route of [publish, read]) {
      expect(route).toContain("requirePosSession()");
      expect(route).toContain('requirePermission(scope, "sale:create")');
      expect(route).toContain('scope.session.tenant_id');
      expect(route).toContain('scope.session.branch_id');
      expect(route).toContain("buildCustomerDisplayV2Channel");
    }
    expect(read).not.toContain('searchParams.get("channel")');
  });
});

describe("payment notice button for Windows thermal routing", () => {
  const notice = {
    paperWidthMm: 80 as const,
    storeName: "ร้านทดสอบ",
    branchName: "สาขาหนึ่ง",
    sellerName: "พนักงาน",
    orderNo: "DIN-261108-001",
    createdAtIso: "2026-11-08T06:40:17.000Z",
    items: [{ name: "ก๋วยเตี๋ยวน้ำตก", quantity: 1, unitPrice: 50, lineTotal: 50, note: "ไม่ใส่ผัก" }],
    discountAmount: 0,
    totalAmount: 50
  };

  it("prints a valid unpaid itemized 80mm notice without requiring QR or a table", () => {
    const html = renderPaymentNoticeHtml(notice);
    expect(html).toContain("ใบแจ้งชำระเงิน");
    expect(html).toContain("ยังไม่ชำระ");
    expect(html).toContain("กรุณาชำระเงินกับพนักงาน");
    expect(html).toContain("ก๋วยเตี๋ยวน้ำตก");
    expect(html).toContain("50.00");
    expect(html).not.toContain('class="qr"');
    expect(html).not.toContain("สแกน QR เพื่อชำระเงิน");
    expect(html).not.toContain("ชำระโดย</span><strong>โอนเงิน");
    expect(html).toContain("ยังไม่ใช่ใบเสร็จรับเงิน");
  });

  it("retains validated QR when it exists, including on 58mm paper", () => {
    const html = renderPaymentNoticeHtml({
      ...notice,
      paperWidthMm: 58,
      qrDataUri: "data:image/png;base64,YWJj"
    });
    expect(html).toContain('class="qr"');
    expect(html).toContain("data:image/png;base64,YWJj");
    expect(html).toContain("สแกน QR เพื่อชำระเงิน");
  });

  it("dispatches an explicitly requested notice to the existing device scoped print queue", () => {
    const modal = source("src/components/pos/pos-payment-modals.tsx");
    const cashier = source("src/components/pos/pos-sales-module.tsx");
    const endpoint = source("src/app/api/pos/payment-notice/route.ts");
    const routes = source("src/lib/printing/routed-print-service.ts");
    expect(modal).toContain("{onPrintPaymentNotice ? (");
    expect(modal).toContain("paymentNoticeSubmitting ? text.submitting");
    expect(cashier).toContain('"/api/pos/payment-notice"');
    expect(cashier).toContain("signal: AbortSignal.timeout(5_000)");
    expect(cashier).toContain("let qrDataUri: string | null = null");
    expect(cashier).toContain("setPaymentNoticeError(message)");
    expect(endpoint).toContain('requirePosSession()');
    expect(endpoint).toContain("qrDataUri && !validQrDataUri(qrDataUri)");
    expect(endpoint).toContain("print_jobs_queued: jobs.length");
    expect(routes).toContain('purpose: "payment_slip"');
    expect(routes).toContain('fallbackPurposes: ["receipt"]');
    expect(routes).toContain('document_type: "payment_notice"');
    expect(routes).toContain("runtimeDeviceCode: args.runtimeDeviceCode");
    // No payment completion and no cash drawer are triggered by a notice.
    expect(endpoint).not.toContain("openCashDrawerController");
    expect(endpoint).not.toContain("queueRoutedSalesReceipt");
  });
});
