import type { GeneralSaleLookupProduct } from "@/lib/pos-general-sale-mode";

export type GeneralSaleCartStorageItem = {
  cart_line_id?: string;
  product_id: string;
  name: string;
  quantity: number;
  price: number;
  notes?: string | null;
};

export type GeneralSaleCartTableRow = {
  cartLineId: string;
  productId: string;
  sku: string;
  category: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  notes: string | null;
};

type SalesSnapshot = {
  products?: GeneralSaleLookupProduct[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function normalizeCartItem(value: unknown): GeneralSaleCartStorageItem | null {
  const row = asRecord(value);
  if (!row) return null;
  const productId = String(row.product_id ?? "").trim();
  const name = String(row.name ?? "").trim();
  const quantity = Math.max(0, Math.trunc(Number(row.quantity ?? 0)));
  const price = Number(row.price ?? 0);
  if (!productId || !name || quantity <= 0 || !Number.isFinite(price) || price < 0) return null;
  const cartLineId = String(row.cart_line_id ?? productId).trim() || productId;
  const notes = String(row.notes ?? "").trim();
  return {
    cart_line_id: cartLineId,
    product_id: productId,
    name,
    quantity,
    price: Number(price.toFixed(2)),
    notes: notes || null
  };
}

function normalizeProduct(value: unknown): GeneralSaleLookupProduct | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = String(row.id ?? "").trim();
  if (!id) return null;
  return {
    id,
    sku: String(row.sku ?? "").trim(),
    name: String(row.name ?? "").trim(),
    category: String(row.category ?? "").trim(),
    price: Number(row.price ?? 0),
    is_active: row.is_active !== false,
    stock_deduction_mode: row.stock_deduction_mode === "recipe_deduction" ? "recipe_deduction" : "unit_only",
    stock_on_hand_units: row.stock_on_hand_units === null || row.stock_on_hand_units === undefined ? null : Number(row.stock_on_hand_units),
    is_out_of_stock: row.is_out_of_stock === true,
    has_recipe_deduction: row.has_recipe_deduction === true,
    is_recommended: row.is_recommended === true
  };
}

export function parseGeneralSaleCartStorage(value: string | null): GeneralSaleCartStorageItem[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeCartItem).filter((row): row is GeneralSaleCartStorageItem => Boolean(row));
  } catch {
    return [];
  }
}

export function parseGeneralSaleSalesSnapshot(value: string | null): GeneralSaleLookupProduct[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as SalesSnapshot;
    if (!Array.isArray(parsed?.products)) return [];
    return parsed.products.map(normalizeProduct).filter((row): row is GeneralSaleLookupProduct => Boolean(row));
  } catch {
    return [];
  }
}

export function buildGeneralSaleCartTableRows(input: {
  cart: GeneralSaleCartStorageItem[];
  snapshotProducts: GeneralSaleLookupProduct[];
  lookupProducts?: Iterable<GeneralSaleLookupProduct>;
}): GeneralSaleCartTableRow[] {
  const productById = new Map<string, GeneralSaleLookupProduct>();
  for (const product of input.snapshotProducts) productById.set(product.id, product);
  for (const product of input.lookupProducts ?? []) productById.set(product.id, product);

  return input.cart.map((item) => {
    const product = productById.get(item.product_id);
    const unitPrice = Number(item.price.toFixed(2));
    return {
      cartLineId: item.cart_line_id ?? item.product_id,
      productId: item.product_id,
      sku: String(product?.sku ?? "").trim() || "-",
      category: String(product?.category ?? "").trim() || "-",
      name: item.name,
      quantity: item.quantity,
      unitPrice,
      lineTotal: Number((item.quantity * unitPrice).toFixed(2)),
      notes: item.notes?.trim() || null
    };
  });
}

export function buildGeneralSaleCartTableSignature(rows: GeneralSaleCartTableRow[]): string {
  return rows
    .map((row) => [row.cartLineId, row.productId, row.sku, row.category, row.quantity, row.unitPrice, row.lineTotal, row.notes ?? ""].join("|"))
    .join("||");
}
