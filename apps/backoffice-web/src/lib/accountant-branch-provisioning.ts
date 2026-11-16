/** Pure tenant-scoped plan for an office Accountant.
 * All active branches are assigned; no cashier device/shift is provisioned.
 * A non-accountant membership is never silently overwritten.
 */
export type AccountantBranchRole = { branch_id: string; role: string };

export function planOfficeAccountantBranches(input: {
  tenantId: string;
  userId: string;
  activeBranchIds: readonly string[];
  existing: readonly AccountantBranchRole[];
}) {
  const { tenantId, userId, activeBranchIds, existing } = input;
  if (!tenantId || !userId) throw new Error("accountant_tenant_scope_required");
  if (!activeBranchIds.length) throw new Error("accountant_no_active_branches");
  if (existing.some(item => item.role !== "accountant")) {
    throw new Error("accountant_separate_user_required");
  }
  const active = [...new Set(activeBranchIds)];
  return active.map(branchId => ({
    tenant_id: tenantId, user_id: userId, branch_id: branchId,
    role: "accountant" as const, is_default: false
  }));
}
