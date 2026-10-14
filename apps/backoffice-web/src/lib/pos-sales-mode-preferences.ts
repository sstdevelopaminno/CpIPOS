import { getProductProfilePolicy } from "@/lib/product-profile-policy";
import { normalizeCustomPosSalesModes } from "@/lib/pos-sales-modes";

export type PosSalesMode = "home" | "dine_in" | "buffet_table" | "delivery";

export const DEFAULT_POS_SALES_MODE_ORDER: PosSalesMode[] = ["home", "dine_in", "buffet_table", "delivery"];

export type PosStartupSalesMode = PosSalesMode | "general_sale" | "optical_retail";

/**
 * Use the IT allowlist for CUSTOM startup, not the last cached UI preference.
 * Do not fall back to an ungranted takeaway ("home") selling mode.
 */
export function getAuthorizedCustomPosStartupMode(
  order: PosSalesMode[],
  productProfile: string | null | undefined,
  rawEntitlements: unknown
): PosStartupSalesMode | null {
  const allowed = normalizeCustomPosSalesModes(rawEntitlements);
  const visible = getVisiblePosSalesModeOrder(order, null, productProfile);
  // Preserve the branch's ordinary-mode order. Delivery is last because its
  // existing selector button enters the separate delivery management workflow.
  const priority: PosStartupSalesMode[] = [
    ...visible.filter((mode) => mode !== "delivery"),
    "general_sale",
    "optical_retail",
    "delivery"
  ];
  return priority.find((mode) => allowed[mode === "home" ? "takeaway" : mode] === true) ?? null;
}


const POS_SALES_MODE_ORDER_STORAGE_PREFIX = "pos_sales_mode_order_v1";

export type PosScopeIdentity = {
  tenantId: string;
  branchId: string;
};

export function normalizePosSalesModeOrder(value: unknown): PosSalesMode[] {
  const supported = new Set<PosSalesMode>(DEFAULT_POS_SALES_MODE_ORDER);
  const seen = new Set<PosSalesMode>();
  const normalized: PosSalesMode[] = [];

  if (Array.isArray(value)) {
    for (const rawMode of value) {
      const mode = String(rawMode ?? "") as PosSalesMode;
      if (!supported.has(mode) || seen.has(mode)) continue;
      seen.add(mode);
      normalized.push(mode);
    }
  }

  for (const mode of DEFAULT_POS_SALES_MODE_ORDER) {
    if (seen.has(mode)) continue;
    normalized.push(mode);
  }

  return normalized;
}

export function swapPosSalesModes(order: PosSalesMode[], left: PosSalesMode, right: PosSalesMode): PosSalesMode[] {
  if (left === right) return normalizePosSalesModeOrder(order);

  const normalized = normalizePosSalesModeOrder(order);
  const leftIndex = normalized.indexOf(left);
  const rightIndex = normalized.indexOf(right);
  if (leftIndex < 0 || rightIndex < 0) return normalized;

  const next = [...normalized];
  [next[leftIndex], next[rightIndex]] = [next[rightIndex], next[leftIndex]];
  return next;
}

export function getHiddenPosSalesModes(_tenantId: string | null | undefined, productProfile?: string | null | undefined): PosSalesMode[] {
  return [...getProductProfilePolicy(productProfile).hiddenSalesModes];
}

export function getVisiblePosSalesModeOrder(
  order: PosSalesMode[],
  tenantId: string | null | undefined,
  productProfile?: string | null | undefined
): PosSalesMode[] {
  const hidden = new Set(getHiddenPosSalesModes(tenantId, productProfile));
  return normalizePosSalesModeOrder(order).filter((mode) => !hidden.has(mode));
}

export function getPreferredPosSalesMode(productProfile: string | null | undefined): PosSalesMode {
  return getProductProfilePolicy(productProfile).preferredSalesMode;
}

export function shouldForcePreferredPosSalesMode(productProfile: string | null | undefined): boolean {
  return getProductProfilePolicy(productProfile).forcePreferredSalesMode;
}

export function canManageBranchSalesModeOrder(
  branchRole: string | null | undefined,
  platformRole?: string | null | undefined
): boolean {
  if (String(platformRole ?? "").trim() === "it_admin") return true;
  const role = String(branchRole ?? "").trim();
  return role === "owner" || role === "manager";
}

export function parsePosScopeIdentity(value: string | null | undefined): PosScopeIdentity | null {
  const [tenantId = "", branchId = ""] = String(value ?? "").split(":", 2).map((entry) => entry.trim());
  if (!tenantId || !branchId) return null;
  return { tenantId, branchId };
}

export function buildPosSalesModeOrderStorageKey(scope: PosScopeIdentity): string {
  return `${POS_SALES_MODE_ORDER_STORAGE_PREFIX}:${scope.tenantId}:${scope.branchId}`;
}
