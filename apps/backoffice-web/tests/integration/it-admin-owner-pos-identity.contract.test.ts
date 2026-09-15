import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const employeeVerifyRoute = source("../../src/app/api/auth/employee/verify-code/route.ts");
const preEntryAuth = source("../../src/lib/server/pre-entry-auth.ts");
const authVerification = source("../../src/lib/server/auth-verification.ts");

describe("IT Admin -> tenant POS owner identity contract", () => {
  it("resolves the POS employee code from the shared tenant identity profile", () => {
    expect(employeeVerifyRoute).toContain("resolveEmployeeByCode");
    expect(preEntryAuth).toContain('from("pos_user_profiles")');
    expect(preEntryAuth).toContain("employee_code");
    expect(preEntryAuth).toContain('from("users_profiles")');
    expect(preEntryAuth).toContain('from("user_branch_roles")');
  });

  it("keeps Owner PIN as a second authentication factor after employee resolution", () => {
    expect(authVerification).toContain("verifyPinLogin");
    expect(authVerification).toContain("pin_hash");
    expect(authVerification).toContain("bcrypt.compare");
    expect(authVerification).toContain("userIdentifier");
  });

  it("enforces tenant and branch scope before a POS user can continue", () => {
    expect(preEntryAuth).toContain("tenantId");
    expect(preEntryAuth).toContain("branchId");
    expect(preEntryAuth).toContain("user_branch_roles");
  });
});
