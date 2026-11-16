import { hasVerifiedPaidGraceAccess, type PaidGraceFeatureRuntime } from "@/lib/paid-grace-feature-access";

/** Business and CUSTOM are the only packages entitled to Finance. */
export function isFinancePackageAllowed(input: {
  packageCode: string | null | undefined;
  contractStatus: string | null | undefined;
  endedAt: string | null | undefined;
  runtime: PaidGraceFeatureRuntime | null;
  now?: number;
}): boolean {
  const code = String(input.packageCode ?? "").trim().toLowerCase();
  if (code !== "business" && code !== "custom") return false;
  const status = String(input.contractStatus ?? "").trim().toLowerCase();
  if (status !== "active" && status !== "trial") return false;
  if (input.runtime?.access_locked === true) return false;
  const now = input.now ?? Date.now();
  const endAtMs = input.endedAt ? Date.parse(input.endedAt) : NaN;
  if (!Number.isFinite(endAtMs) || endAtMs > now) return true;
  if (status === "trial") return false;
  return hasVerifiedPaidGraceAccess(
    { status, ended_at: input.endedAt ?? null },
    input.runtime,
    now
  );
}
