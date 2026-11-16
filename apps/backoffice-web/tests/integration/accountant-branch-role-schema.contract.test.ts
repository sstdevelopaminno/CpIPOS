import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Accountant Finance schema release contract", () => {
  it("tracks the existing production enum hotfix as a forward-only migration", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "../../supabase/migrations/20261116040225_add_accountant_branch_role_20261116.sql"),
      "utf8"
    );
    expect(migration).toContain("ALTER TYPE public.branch_role ADD VALUE IF NOT EXISTS 'accountant'");
    expect(migration).not.toMatch(/DROP\s+(TYPE|TABLE)|DELETE\s+FROM|TRUNCATE/i);
  });

  it("only uses the database enum role after migration is applied", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/accountant-branch-provisioning.ts"), "utf8");
    expect(source).toContain('role: "accountant" as const');
    expect(source).toContain('activeBranchIds');
    expect(source).toContain('accountant_separate_user_required');
  });
});
