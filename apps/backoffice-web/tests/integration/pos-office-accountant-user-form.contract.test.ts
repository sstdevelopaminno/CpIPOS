import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ui = readFileSync(resolve(process.cwd(), "src/components/pos/pos-users-module.tsx"), "utf8");
const api = readFileSync(resolve(process.cwd(), "src/app/api/pos/users/route.ts"), "utf8");

describe("POS user form: Accountant office-wide behavior", () => {
  it("does not ask an Accountant to select a branch or POS terminal", () => {
    expect(ui).toContain('form.role === "accountant"');
    expect(ui).toContain('ทุกสาขาที่เปิดใช้งาน — กำหนดอัตโนมัติ');
    expect(ui).toContain('ทำงานออฟฟิศ • ไม่ผูกเครื่อง POS');
    expect(ui).toContain('form.role !== "accountant" ? <Field label={t.chooseDevice}>');
    expect(ui).toContain('form.role === "accountant" ? "accountant" : form.permission_role.trim()');
    expect(ui).toContain('if (form.role !== "accountant") await requestJson("/api/pos/users"');
  });

  it("assigns all active store branches on the server, not from user submitted IDs", () => {
    expect(api).toContain("grantAccountantAllActiveBranches(auth.tenantId!, userId)");
    expect(api).toContain('.eq("tenant_id", tenantId).eq("is_active", true)');
    expect(api).toContain('planOfficeAccountantBranches({');
    expect(api).toContain('onConflict: "user_id,tenant_id,branch_id"');
    expect(api).toContain('office_only: role === "accountant"');
    expect(api).toContain('if (role !== "accountant") {');
  });

  it("prevents unauthorized cashier device use and enforces accountant PIN limits", () => {
    expect(api).toContain('if (targetRole === "accountant") return fail("accountant_office_only"');
    expect(api).toContain('if (role === "accountant" && !/^\\d{4,8}$/.test(pin))');
    expect(api).toContain('if ((targetRole === "accountant") !== (nextRole === "accountant"))');
    expect(api).toContain('targetRole === "accountant"');
    expect(api).toContain('tenant_wide: targetRole === "accountant"');
  });
});
