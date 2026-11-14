/** Only an IT-approved paid grace runtime can extend cashier feature access.
 * An expired trial, suspended contract, locked runtime, or missing authority
 * must never be interpreted as permission to sell.
 */
export type PaidGraceFeatureContract = {
  status: string;
  ended_at: string | null;
};

export type PaidGraceFeatureRuntime = {
  lifecycle_status: string | null;
  access_locked: boolean | null;
  lock_reason: string | null;
  expires_at: string | null;
};

export function hasVerifiedPaidGraceAccess(
  contract: PaidGraceFeatureContract | null,
  runtime: PaidGraceFeatureRuntime | null,
  now = Date.now()
): boolean {
  if (contract?.status !== "active" || runtime?.lifecycle_status !== "grace") return false;
  if (runtime.access_locked !== false || runtime.lock_reason !== "subscription_payment_grace") return false;
  const contractEnd = Date.parse(contract.ended_at ?? "");
  const graceEnd = Date.parse(runtime.expires_at ?? "");
  return Number.isFinite(contractEnd) && contractEnd <= now &&
    Number.isFinite(graceEnd) && graceEnd > now;
}
