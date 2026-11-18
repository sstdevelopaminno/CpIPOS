import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const login = readFileSync(resolve(process.cwd(), "src/app/login/accounting/page.tsx"), "utf8");
const api = readFileSync(resolve(process.cwd(), "src/app/api/auth/accounting/login/route.ts"), "utf8");

describe("Accountant login — professional and role-safe UI", () => {
  it("renders a compact CpiPOS Finance identity and store context on mobile and desktop", () => {
    expect(login).toContain("min-h-[100dvh]");
    expect(login).toContain("max-w-[468px]");
    expect(login).toContain("rounded-[20px]");
    expect(login).toContain("src=\"/brand/cpipos-symbol-transparent.png\"");
    expect(login).toContain('id="accounting-login-title"');
    expect(login).toContain('ร้านค้าที่เลือก');
    expect(login).toContain('ยืนยันแล้ว');
    expect(login).toContain('role="status"');
    expect(login).toContain("useState(false)");
    expect(login).toContain('ไม่ต้องเลือกเครื่อง POS');
    expect(login).not.toContain("เลือกเครื่องแคชเชียร์");
  });

  it("preserves employee code and PIN semantics with responsive inputs and accessible controls", () => {
    expect(login).toContain('name="employee_code"');
    expect(login).toContain('name="pin"');
    expect(login).toContain('pattern="[0-9]{1,32}"');
    expect(login).toContain('pattern="[0-9]{4,8}"');
    expect(login).toContain('minLength={4} maxLength={8}');
    expect(login).toContain('autoComplete="username"');
    expect(login).toContain('autoComplete="current-password"');
    expect(login).toContain('type={showPin ? "text" : "password"}');
    expect(login).toContain('aria-pressed={showPin}');
    expect(login).toContain('aria-label={showPin ? "ซ่อน PIN" : "แสดง PIN"}');
    expect(login).toContain('disabled={busy || !contextReady}');
    expect(login).toContain('role="alert"');
    expect(login).toContain('aria-busy={busy}');
  });

  it("keeps verified tenant context and existing server-side Finance authentication unchanged", () => {
    expect(login).toContain('fetch("/api/auth/session/context", { cache: "no-store" })');
    expect(login).toContain('["store_verified", "branch_selected"]');
    expect(login).toContain('router.replace("/login/store")');
    expect(login).toContain('fetch("/api/auth/accounting/login", {');
    expect(login).toContain('body: JSON.stringify({ employee_code: code, pin })');
    expect(login).toContain('body?.data?.redirect_to !== "/finance"');
    expect(login).toContain('window.location.replace("/finance")');
    expect(login).toContain('onClick={() => router.push("/login/store")}');
    expect(api).toContain('await bcrypt.compare(pin, user.data.pin_hash)');
    expect(api).toContain('verifyFinanceIdentity(flow.tenantId, userId)');
    expect(api).toContain('max: readRateLimitSetting("AUTH_FINANCE_RATE_LIMIT_MAX"');
    expect(api).toContain('writeFinanceSession(response, identity.tenantId, identity.userId)');
  });
});
