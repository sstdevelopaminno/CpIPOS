import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const settingsPage = source("../../src/app/preview/pos/settings/page.tsx");
const settingsRoute = source("../../src/app/preview/pos/settings/table-qr/page.tsx");
const policyRoute = source("../../src/app/api/backoffice/tables/[tableId]/qr-policy/route.ts");
const issueRoute = source("../../src/app/api/pos/tables/[tableId]/qr-order/route.ts");
const publicOrderRoute = source("../../src/app/api/table-order/[token]/route.ts");
const timeStateRoute = source("../../src/app/api/table-order/[token]/time-state/route.ts");
const countdownGuard = source("../../src/components/table-order/table-qr-countdown-guard.tsx");
const tableOrderPage = source("../../src/app/table-order/[token]/page.tsx");
const tableQrOrdering = source("../../src/lib/table-qr-ordering.ts");

describe("Table QR timed/bill expiry and customer countdown contract", () => {
  it("exposes Table QR settings from Settings only to management roles", () => {
    expect(settingsPage).toContain('role === "owner" || role === "manager"');
    expect(settingsPage).toContain('href="/preview/pos/settings/table-qr"');
    expect(settingsPage).toContain("ตั้งค่า QR โต๊ะ");
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

  it("does not render a countdown for bill-lifecycle mode", () => {
    expect(countdownGuard).toContain('if (!state || state.expiry_mode !== "time") return null;');
    expect(timeStateRoute).toContain("expiry_mode: policy.mode");
  });
});
