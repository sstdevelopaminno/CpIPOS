import type { ProductProfileCode } from "@/lib/product-profile-policy";
import { resolveProductProfile } from "@/lib/product-profile-policy";

type BillingDocumentPolicyScope = {
  productProfile?: ProductProfileCode | string | null;
  tenantCode?: string | null;
  tenantMetadata?: unknown;
};

export function shouldSuppressZeroPriceBillingLines(scope: BillingDocumentPolicyScope): boolean {
  return resolveProductProfile({
    productProfile: scope.productProfile,
    tenantCode: scope.tenantCode,
    tenantMetadata: scope.tenantMetadata
  }) === "BUFFET";
}


export function filterBillingDocumentItems<T>(
  items: readonly T[],
  scope: BillingDocumentPolicyScope | unknown,
  getUnitPrice: (item: T) => unknown
): T[] {
  const normalizedScope =
    scope && typeof scope === "object" && !Array.isArray(scope)
      ? (scope as BillingDocumentPolicyScope)
      : { tenantCode: String(scope ?? "") };
  if (!shouldSuppressZeroPriceBillingLines(normalizedScope)) return [...items];

  return items.filter((item) => {
    const rawPrice = getUnitPrice(item);
    if (rawPrice === null || rawPrice === undefined || rawPrice === "") return true;

    const unitPrice = Number(rawPrice);
    if (!Number.isFinite(unitPrice)) return true;

    return unitPrice !== 0;
  });
}