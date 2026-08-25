import type { PosBuffetPricePlan, PosBuffetPricingMode } from "@/lib/pos-buffet-pricing";

export const BUFFET_PLAN_METADATA_KEY = "cpipos_buffet_plan";

export type BuffetPlanMetadata = {
  mode: PosBuffetPricingMode;
  draft?: boolean;
  archived?: boolean;
  sort_order?: number;
};

export type BuffetPlanProductRow = {
  id: string;
  sku: string | null;
  name: string;
  price: number | null;
  is_active: boolean | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
};

const CANONICAL_BY_SKU: Record<string, PosBuffetPricingMode> = {
  "BUFFET-PER-PERSON": "per_person",
  "BUFFET-SET": "set"
};

const CANONICAL_BY_NAME: Record<string, PosBuffetPricingMode> = {
  "บุฟเฟ่รายท่าน": "per_person",
  "บุฟเฟ่แบบชุด": "set"
};

export function readBuffetPlanMetadata(metadata: Record<string, unknown> | null | undefined): BuffetPlanMetadata | null {
  const raw = metadata?.[BUFFET_PLAN_METADATA_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  const mode = candidate.mode === "set" ? "set" : candidate.mode === "per_person" ? "per_person" : null;
  if (!mode) return null;
  return {
    mode,
    draft: candidate.draft === true,
    archived: candidate.archived === true,
    sort_order: Number.isFinite(Number(candidate.sort_order)) ? Number(candidate.sort_order) : undefined
  };
}

export function buffetPlanModeFromProduct(product: Pick<BuffetPlanProductRow, "sku" | "name" | "metadata">): PosBuffetPricingMode | null {
  const metadata = readBuffetPlanMetadata(product.metadata);
  if (metadata) return metadata.mode;
  const sku = String(product.sku ?? "").trim().toUpperCase();
  if (CANONICAL_BY_SKU[sku]) return CANONICAL_BY_SKU[sku];
  const name = String(product.name ?? "").trim();
  return CANONICAL_BY_NAME[name] ?? null;
}

export function isBuffetPlanProduct(product: Pick<BuffetPlanProductRow, "sku" | "name" | "metadata">): boolean {
  return buffetPlanModeFromProduct(product) !== null;
}

export function buildBuffetPlanMetadata(args: {
  current?: Record<string, unknown> | null;
  mode: PosBuffetPricingMode;
  draft?: boolean;
  archived?: boolean;
  sortOrder?: number;
}): Record<string, unknown> {
  const current = args.current && typeof args.current === "object" && !Array.isArray(args.current) ? args.current : {};
  const existing = readBuffetPlanMetadata(current);
  return {
    ...current,
    [BUFFET_PLAN_METADATA_KEY]: {
      mode: args.mode,
      draft: args.draft === true,
      archived: args.archived ?? existing?.archived ?? false,
      sort_order: Number.isFinite(Number(args.sortOrder)) ? Number(args.sortOrder) : existing?.sort_order ?? Date.now()
    }
  };
}

export function buffetPlanFromProduct(product: BuffetPlanProductRow, itemCount = 0): PosBuffetPricePlan | null {
  const mode = buffetPlanModeFromProduct(product);
  if (!mode) return null;
  const metadata = readBuffetPlanMetadata(product.metadata);
  const price = Number(product.price ?? 0);
  return {
    id: product.id,
    product_id: product.id,
    code: String(product.sku ?? product.id),
    name: String(product.name ?? "").trim(),
    mode,
    price: Number.isFinite(price) ? Number(price.toFixed(2)) : 0,
    is_active: product.is_active !== false && price > 0 && metadata?.draft !== true && metadata?.archived !== true,
    configured: true,
    draft: metadata?.draft === true,
    item_count: Math.max(0, Math.trunc(Number(itemCount) || 0)),
    description: mode === "per_person" ? "คิดราคาต่อจำนวนลูกค้า" : "คิดราคาตามจำนวนชุด"
  };
}

export function compareBuffetPlans(a: PosBuffetPricePlan, b: PosBuffetPricePlan): number {
  const priority = (plan: PosBuffetPricePlan) => plan.code === "BUFFET-PER-PERSON" ? 0 : plan.code === "BUFFET-SET" ? 1 : 2;
  const diff = priority(a) - priority(b);
  if (diff !== 0) return diff;
  if (a.mode !== b.mode) return a.mode === "per_person" ? -1 : 1;
  return a.name.localeCompare(b.name, "th", { numeric: true, sensitivity: "base" });
}
