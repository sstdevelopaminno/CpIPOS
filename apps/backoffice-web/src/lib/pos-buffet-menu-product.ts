import { buffetPlanModeFromProduct } from "@/lib/pos-buffet-plan-product";

export const BUFFET_MENU_ITEM_METADATA_KEY = "cpipos_buffet_item";

export type BuffetMenuProductRow = {
  sku?: string | null;
  name: string;
  category?: string | null;
  price?: number | null;
  metadata?: Record<string, unknown> | null;
};

const BUFFET_CATEGORY_KEYS = new Set(["บุฟเฟ่", "บุฟเฟต์", "buffet"]);

function normalizedCategory(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function hasExplicitBuffetItemFlag(metadata: Record<string, unknown> | null | undefined): boolean {
  const raw = metadata?.[BUFFET_MENU_ITEM_METADATA_KEY];
  if (raw === true) return true;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const record = raw as Record<string, unknown>;
  return record.included === true || record.enabled === true;
}

export function isBuffetIncludedMenuProduct(product: BuffetMenuProductRow): boolean {
  if (buffetPlanModeFromProduct({
    sku: product.sku ?? null,
    name: product.name,
    metadata: product.metadata ?? null
  })) {
    return false;
  }

  const price = Number(product.price ?? 0);
  if (!Number.isFinite(price) || price > 0) return false;
  if (hasExplicitBuffetItemFlag(product.metadata)) return true;
  return BUFFET_CATEGORY_KEYS.has(normalizedCategory(product.category));
}
