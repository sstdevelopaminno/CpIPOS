export type CategoryCountItem = {
  name: string;
  productCount: number;
};

export function normalizeCategoryName(value: unknown): string {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeCategoryKey(value: unknown): string {
  return normalizeCategoryName(value).toLocaleLowerCase("th-TH");
}

export function mergeCategoryCountItems(items: CategoryCountItem[], locale: "th" | "en" = "th"): CategoryCountItem[] {
  const merged = new Map<string, CategoryCountItem>();

  for (const item of items) {
    const name = normalizeCategoryName(item.name);
    const key = normalizeCategoryKey(name);
    if (!key) continue;

    const current = merged.get(key);
    if (current) {
      current.productCount += Number(item.productCount ?? 0);
      continue;
    }

    merged.set(key, { name, productCount: Number(item.productCount ?? 0) });
  }

  return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name, locale, { sensitivity: "base" }));
}

export function mergeCategoryNames(names: unknown[], locale: "th" | "en" = "th"): string[] {
  return mergeCategoryCountItems(
    names.map((name) => ({ name: normalizeCategoryName(name), productCount: 0 })),
    locale
  ).map((item) => item.name);
}
