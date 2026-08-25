export function isFfStoreCode(storeCode: unknown): boolean {
  return String(storeCode ?? "").trim().toUpperCase().startsWith("FF");
}

export function filterBillingDocumentItems<T>(
  items: readonly T[],
  storeCode: unknown,
  getUnitPrice: (item: T) => unknown
): T[] {
  if (!isFfStoreCode(storeCode)) return [...items];

  return items.filter((item) => {
    const rawPrice = getUnitPrice(item);
    if (rawPrice === null || rawPrice === undefined || rawPrice === "") return true;

    const unitPrice = Number(rawPrice);
    if (!Number.isFinite(unitPrice)) return true;

    return unitPrice !== 0;
  });
}
