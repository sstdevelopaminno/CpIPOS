export type PosSalesMode = "home" | "dine_in" | "buffet_table" | "delivery";

export const DEFAULT_POS_SALES_MODE_ORDER: PosSalesMode[] = ["home", "dine_in", "buffet_table", "delivery"];

const FG0003_TENANT_ID = "2d38bd23-bf2d-4b9a-a7cf-adb2547297ed";
const FG0003_HIDDEN_MODES: PosSalesMode[] = ["buffet_table", "delivery"];
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

export function getHiddenPosSalesModes(tenantId: string | null | undefined): PosSalesMode[] {
  return String(tenantId ?? "").trim() === FG0003_TENANT_ID ? [...FG0003_HIDDEN_MODES] : [];
}

export function getVisiblePosSalesModeOrder(order: PosSalesMode[], tenantId: string | null | undefined): PosSalesMode[] {
  const hidden = new Set(getHiddenPosSalesModes(tenantId));
  return normalizePosSalesModeOrder(order).filter((mode) => !hidden.has(mode));
}

export function parsePosScopeIdentity(value: string | null | undefined): PosScopeIdentity | null {
  const [tenantId = "", branchId = ""] = String(value ?? "").split(":", 2).map((entry) => entry.trim());
  if (!tenantId || !branchId) return null;
  return { tenantId, branchId };
}

export function buildPosSalesModeOrderStorageKey(scope: PosScopeIdentity): string {
  return `${POS_SALES_MODE_ORDER_STORAGE_PREFIX}:${scope.tenantId}:${scope.branchId}`;
}
