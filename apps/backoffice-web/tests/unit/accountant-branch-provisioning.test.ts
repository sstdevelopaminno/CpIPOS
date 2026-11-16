import { describe, expect, it } from "vitest";
import { planOfficeAccountantBranches } from "../../src/lib/accountant-branch-provisioning";

const base = { tenantId: "tenant-1", userId: "accountant-1" };

describe("POS Accountant is office-only and scoped to all active branches", () => {
  it("assigns every active branch in same tenant and no cashier device", () => {
    const rows = planOfficeAccountantBranches({
      ...base, activeBranchIds: ["branch-1", "branch-2"], existing: []
    });
    expect(rows).toEqual([
      { tenant_id: "tenant-1", user_id: "accountant-1", branch_id: "branch-1", role: "accountant", is_default: false },
      { tenant_id: "tenant-1", user_id: "accountant-1", branch_id: "branch-2", role: "accountant", is_default: false }
    ]);
    expect(JSON.stringify(rows)).not.toContain("device_id");
  });
  it("is idempotent for existing Accountant grants, including repeated branches", () => {
    expect(planOfficeAccountantBranches({
      ...base, activeBranchIds: ["branch-1", "branch-1"], existing: [{ branch_id: "branch-1", role: "accountant" }]
    })).toHaveLength(1);
  });
  it("fails closed for missing branches, wrong tenant context and conflicting roles", () => {
    expect(() => planOfficeAccountantBranches({ ...base, activeBranchIds: [], existing: [] }))
      .toThrow("accountant_no_active_branches");
    expect(() => planOfficeAccountantBranches({ ...base, tenantId: "", activeBranchIds: ["a"], existing: [] }))
      .toThrow("accountant_tenant_scope_required");
    for (const role of ["owner", "manager", "staff", "kitchen"]) {
      expect(() => planOfficeAccountantBranches({
        ...base, activeBranchIds: ["a"], existing: [{ branch_id: "a", role }]
      })).toThrow("accountant_separate_user_required");
    }
  });
});
