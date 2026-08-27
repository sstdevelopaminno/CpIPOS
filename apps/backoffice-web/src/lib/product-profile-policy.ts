import type { PosSalesMode } from "@/lib/pos-sales-mode-preferences";

export type ProductProfileCode = "STANDARD" | "RESTAURANT_QR" | "BUFFET";

export type ProductProfileInput = {
  tenantCode?: string | null;
  tenantMetadata?: unknown;
  productProfile?: string | null;
};

export type ProductProfilePolicy = {
  productProfile: ProductProfileCode;
  hiddenSalesModes: PosSalesMode[];
  preferredSalesMode: PosSalesMode;
  forcePreferredSalesMode: boolean;
  hiddenSettingsViews: string[];
};

const PROFILE_VALUES = new Set<ProductProfileCode>(["STANDARD", "RESTAURANT_QR", "BUFFET"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function normalizeProductProfile(value: unknown): ProductProfileCode | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  return PROFILE_VALUES.has(normalized as ProductProfileCode) ? (normalized as ProductProfileCode) : null;
}

export function resolveProductProfile(input: ProductProfileInput): ProductProfileCode {
  const metadata = asRecord(input.tenantMetadata);
  return normalizeProductProfile(input.productProfile)
    ?? normalizeProductProfile(metadata?.product_profile)
    ?? normalizeProductProfile(asRecord(metadata?.product)?.profile)
    ?? resolveProductProfileFromTenantCode(input.tenantCode);
}

export function resolveProductProfileFromTenantCode(tenantCode: string | null | undefined): ProductProfileCode {
  const code = String(tenantCode ?? "").trim().toUpperCase();
  if (code.startsWith("FF")) return "BUFFET";
  if (code.startsWith("FG")) return "RESTAURANT_QR";
  return "STANDARD";
}

export function getProductProfilePolicy(productProfile: string | null | undefined): ProductProfilePolicy {
  const profile = normalizeProductProfile(productProfile) ?? "STANDARD";
  if (profile === "BUFFET") {
    return {
      productProfile: profile,
      hiddenSalesModes: ["home", "dine_in", "delivery"],
      preferredSalesMode: "buffet_table",
      forcePreferredSalesMode: true,
      hiddenSettingsViews: []
    };
  }
  if (profile === "RESTAURANT_QR") {
    return {
      productProfile: profile,
      hiddenSalesModes: ["buffet_table", "delivery"],
      preferredSalesMode: "dine_in",
      forcePreferredSalesMode: false,
      hiddenSettingsViews: ["branches", "activity", "taxes", "display"]
    };
  }
  return {
    productProfile: "STANDARD",
    hiddenSalesModes: [],
    preferredSalesMode: "home",
    forcePreferredSalesMode: false,
    hiddenSettingsViews: []
  };
}
