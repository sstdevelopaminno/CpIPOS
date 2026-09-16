import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const employeeVerifyRoute = source("../../src/app/api/auth/employee/verify-code/route.ts");
const employeeLoginPage = source("../../src/app/login/employee/page.tsx");
const preEntryAuth = source("../../src/lib/server/pre-entry-auth.ts");
const authVerification = source("../../src/lib/server/auth-verification.ts");
const posLayout = source("../../src/app/preview/pos/layout.tsx");
const salesModePolicyController = source("../../src/components/pos/pos-sales-mode-policy-controller.tsx");

describe("IT Admin -> tenant POS owner identity contract", () => {
  it("resolves the POS employee code from the shared tenant identity profile", () => {
    expect(employeeVerifyRoute).toContain("resolveEmployeeByCode");
    expect(preEntryAuth).toContain('from("pos_user_profiles")');
    expect(preEntryAuth).toContain("employee_code");
    expect(preEntryAuth).toContain("users_profiles!inner");
    expect(preEntryAuth).toContain('from("user_branch_roles")');
  });

  it("uses employee code for normal POS login and reserves Owner PIN for privileged approvals", () => {
    expect(employeeVerifyRoute).toContain('employeeAuthMethod: "employee_code"');
    expect(employeeVerifyRoute).not.toContain("requiresPrivilegedPin");
    expect(employeeVerifyRoute).not.toContain("verifyPinLogin");
    expect(employeeVerifyRoute).not.toContain('next_step: "pin"');

    // The client may keep the legacy PIN step for backward-compatible API responses,
    // but the normal employee verification API must no longer request that step.
    expect(employeeLoginPage).toContain("employee_code");

    // PIN hashing/verification remains available to manager override and other
    // privileged approval flows. The secret itself is never stored in plaintext.
    expect(authVerification).toContain("verifyPinLogin");
    expect(authVerification).toContain("pin_hash");
    expect(authVerification).toContain("bcrypt.compare");
    expect(authVerification).toContain("userIdentifier");
  });

  it("enforces tenant and branch scope before a POS user can continue", () => {
    expect(preEntryAuth).toContain("tenantId");
    expect(preEntryAuth).toContain("branchId");
    expect(preEntryAuth).toContain("user_branch_roles");
    expect(employeeVerifyRoute).toContain("loadBranchEmployeeLoginPolicy");
  });

  it("mounts the IT sales-mode policy in the live POS shell and blocks disabled modes", () => {
    expect(posLayout).toContain('import { PosSalesModePolicyController }');
    expect(posLayout).toContain("<PosSalesModePolicyController />");
    expect(salesModePolicyController).toContain('fetch("/api/pos/features"');
    expect(salesModePolicyController).toContain('const MODE_ATTRIBUTE = "data-pos-sale-mode"');
    expect(salesModePolicyController).toContain("element.disabled = true");
    expect(salesModePolicyController).toContain("event.preventDefault()");
    expect(salesModePolicyController).toContain("event.stopImmediatePropagation()");
  });
});
