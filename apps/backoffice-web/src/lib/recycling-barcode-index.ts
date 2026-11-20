/**
 * Index full SKU/barcode matches once per catalog response.
 * A null entry means the same scanned code belongs to multiple products.
 * Never use fuzzy matching for a scanner checkout.
 */
export function buildRecyclingBarcodeIndex<T extends { sku: string }>(
  items: readonly T[]
): Map<string, T | null> {
  const index = new Map<string, T | null>();
  for (const item of items) {
    const key = item.sku.trim().toLocaleLowerCase("en");
    if (!key) continue;
    if (index.has(key)) index.set(key, null);
    else index.set(key, item);
  }
  return index;
}

export type RecyclingScanMatch<T> =
  | { status: "found"; item: T }
  | { status: "duplicate" }
  | { status: "missing" };

export function resolveRecyclingBarcode<T>(
  index: ReadonlyMap<string, T | null>, scanned: string
): RecyclingScanMatch<T> {
  const key = scanned.trim().toLocaleLowerCase("en");
  if (!key || !index.has(key)) return { status: "missing" };
  const item = index.get(key);
  return item ? { status: "found", item } : { status: "duplicate" };
}
