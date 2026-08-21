import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const settingsPage = source("../../src/app/preview/pos/settings/page.tsx");
const settingsMenuPortal = source("../../src/components/pos-preview/table-qr-settings-menu-portal.tsx");
const settingsRoute = source("../../src/app/preview/pos/settings/table-qr/page.tsx");
const policyRoute = source("../../src/app/api/backoffice/tables/[tableId]/qr-policy/route.ts");
const issueRoute = source("../../src/app/api/pos/tables/[tableId]/qr-order/route.ts");
const publicOrderRoute = source("../../src/app/api/table-order/[token]/route.ts");
const timeStateRoute = source("../../src/app/api/table-order/[token]/time-state/route.ts");
const countdownGuard = source("../../src/components/table-order/table-qr-countdown-guard.tsx");
const tableOrderPage = source("../../src/app/table-order/[token]/page.tsx");
const tableOrderMobile = source("../../src/components/table-order/table-order-mobile.tsx");
const tableQrOrdering = source("../../src/lib/table-qr-ordering.ts");
const paymentLockRoute = source("../../src/app/api/pos/tables/[tableId]/payment-lock/route.ts");

describe("Table QR timed/bill expiry and customer countdown contract", () => {
  it("exposes Table QR settings to management roles as a normal submenu after Customer Display", () => {
    expect(settingsPage).toContain('role === "owner" || role === "manager"');
    expect(settingsPage).toContain("TableQrSettingsMenuPortal");
    expect(settingsPage).not.toContain('href="/preview/pos/settings/table-qr"');
    expect(settingsMenuPortal).toContain('const CUSTOMER_DISPLAY_HREF = "/preview/pos/customer-display"');
    expect(settingsMenuPortal).toContain('customerDisplayCard.insertAdjacentElement("afterend", slot)');
    expect(settingsMenuPortal).toContain('href="/preview/pos/settings/table-qr"');
    expect(settingsMenuPortal).toContain("ตั้งค่า QR โต๊ะ");
    expect(settingsRoute).toContain('requirePosPagePermission("tables:manage")');
    expect(settingsRoute).toContain('requireTenantFeature(scope.session.tenant_id, "qr_table_ordering"');
  });

  it("revokes the current QR when its table policy changes", () => {
    expect(policyRoute).toContain("requireManage: true");
    expect(policyRoute).toContain('action: "table_qr_policy_updated"');
    expect(policyRoute).toContain('.update({ status: "revoked", revoked_at: revokedAt })');
    expect(policyRoute).toContain("mergeTableQrPolicyMetadata");
  });

  it("issues new QR sessions using the configured timed or bill policy", () => {
    expect(issueRoute).toContain("issueTableQrSessionWithPolicy");
    expect(issueRoute).toContain("expiry_mode: data.expiry_mode");
    expect(issueRoute).toContain("ttl_minutes: data.ttl_minutes");
  });

  it("keeps server-side expiry enforcement on every public Table QR request", () => {
    expect(publicOrderRoute).toContain("resolveTableQrContext(token)");
    expect(tableQrOrdering).toContain("new Date(qr.expires_at).getTime() <= Date.now()");
    expect(tableQrOrdering).toContain('throw new Error("qr_session_expired")');
  });

  it("shows a second-by-second countdown and warns for the final 30 minutes", () => {
    expect(tableOrderPage).toContain("TableQrCountdownGuard");
    expect(countdownGuard).toContain("const COUNTDOWN_TICK_MS = 1_000");
    expect(countdownGuard).toContain("const WARNING_THRESHOLD_MS = 30 * 60_000");
    expect(countdownGuard).toContain("formatRemaining(remainingMs)");
    expect(countdownGuard).toContain("แจ้งเตือนเวลาสั่งอาหาร");
    expect(timeStateRoute).toContain("normalizeTableQrPolicyFromMetadata");
    expect(timeStateRoute).toContain("server_time: new Date().toISOString()");
  });

  it("blocks the entire customer surface when timed ordering expires", () => {
    expect(countdownGuard).toContain("fixed inset-0 z-[9999]");
    expect(countdownGuard).toContain("pointer-events-auto");
    expect(countdownGuard).toContain("หมดเวลาสั่งอาหาร");
    expect(countdownGuard).toContain("ไม่สามารถสั่งเพิ่มหรือกดรายการใดได้แล้ว");
    expect(countdownGuard).toContain("กรุณานำเลขโต๊ะไปชำระเงิน");
  });

  it("allows checkout before the timer ends and closes the QR with the normal bill lifecycle", () => {
    expect(tableOrderMobile).toContain('submitServiceRequest("request_checkout")');
    expect(tableQrOrdering).toContain('if (requestType === "request_checkout")');
    expect(tableQrOrdering).toContain("ensureTableQrOrderAcceptable(context)");
    expect(paymentLockRoute).toContain('supabase.rpc("set_table_payment_lock_tx"');
    expect(paymentLockRoute).not.toContain("expires_at");
    expect(timeStateRoute).toContain('return "bill_closed"');
    expect(timeStateRoute).toContain('fail("table_order_bill_closed"');
    expect(countdownGuard).toContain('body?.error?.code === "table_order_bill_closed"');
    expect(countdownGuard).toContain("บิลโต๊ะนี้ถูกปิดแล้ว");
    expect(countdownGuard).toContain("สามารถชำระหรือปิดบิลก่อนเวลาที่ตั้งไว้ได้ตามปกติ");
  });

  it("does not render a countdown for bill-lifecycle mode", () => {
    expect(countdownGuard).toContain('if (!state || state.expiry_mode !== "time") return null;');
    expect(timeStateRoute).toContain("expiry_mode: policy.mode");
  });
});
