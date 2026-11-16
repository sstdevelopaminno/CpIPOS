import { describe, expect, it } from "vitest";
import { hasAllBranchAccountingGrant } from "../../src/lib/finance-branch-access";
import { roleToPermissions } from "../../src/lib/server/pre-entry-auth";

describe("tenant-wide accounting access", () => {
  it("requires explicit accountant grant for every active branch", () => {
    expect(hasAllBranchAccountingGrant(["a", "b"], [
      { branch_id: "a", role: "accountant" },
      { branch_id: "b", role: "accountant" }
    ])).toBe(true);
    expect(hasAllBranchAccountingGrant(["a", "b"], [
      { branch_id: "a", role: "accountant" }
    ])).toBe(false);
    expect(hasAllBranchAccountingGrant(["a", "b"], [
      { branch_id: "a", role: "accountant" },
      { branch_id: "b", role: "manager" }
    ])).toBe(false);
  });

  it("fails closed for unknown or empty active branches", () => {
    expect(hasAllBranchAccountingGrant([], [{ branch_id: "a", role: "accountant" }])).toBe(false);
    expect(hasAllBranchAccountingGrant(["z"], [{ branch_id: "a", role: "accountant" }])).toBe(false);
  });

  it("does not grant sales access to the accountant role", () => {
    expect(roleToPermissions("accountant")).toEqual(["finance.access"]);
    expect(roleToPermissions("accountant")).not.toContain("pos.sales.access");
  });
});
