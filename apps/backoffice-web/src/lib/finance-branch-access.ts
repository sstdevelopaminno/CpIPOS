export type BranchRoleGrant = { branch_id: string; role: string };

/**
 * Accountant is a branch-level role in current schema. Until an explicit
 * tenant-level Finance grant exists, an all-branch finance session requires
 * that every active branch already grants this user the accountant role.
 */
export function hasAllBranchAccountingGrant(
  activeBranchIds: readonly string[],
  assignedRoles: readonly BranchRoleGrant[]
): boolean {
  if (activeBranchIds.length === 0) return false;
  const grants = new Set(
    assignedRoles.filter((entry) => entry.role === "accountant").map((entry) => entry.branch_id)
  );
  return activeBranchIds.every((branchId) => grants.has(branchId));
}
