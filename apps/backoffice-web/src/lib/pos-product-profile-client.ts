import {
  normalizeProductProfile,
  type ProductProfileCode
} from "@/lib/product-profile-policy";

type ProfileBody = {
  data?: { product_profile?: string | null } | null;
};

export const POS_PRODUCT_PROFILE_CACHE_PREFIX = "cpipos_product_profile_v1";

export function buildProductProfileCacheKey(tenantId: string) {
  return `${POS_PRODUCT_PROFILE_CACHE_PREFIX}:${tenantId}`;
}

export function readCachedProductProfile(tenantId: string | null | undefined): ProductProfileCode | null {
  if (typeof window === "undefined") return null;
  const id = String(tenantId ?? "").trim();
  if (!id) return null;
  try {
    return normalizeProductProfile(window.sessionStorage.getItem(buildProductProfileCacheKey(id)));
  } catch {
    return null;
  }
}

export function writeCachedProductProfile(tenantId: string | null | undefined, productProfile: string | null | undefined) {
  if (typeof window === "undefined") return;
  const id = String(tenantId ?? "").trim();
  const normalized = normalizeProductProfile(productProfile);
  if (!id || !normalized) return;
  try {
    window.sessionStorage.setItem(buildProductProfileCacheKey(id), normalized);
  } catch {
    // Cache is optional.
  }
}

export async function fetchCurrentProductProfile(tenantId: string | null | undefined): Promise<ProductProfileCode | null> {
  try {
    const response = await fetch("/api/pos/product-profile", {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
    const body = (await response.json().catch(() => null)) as ProfileBody | null;
    if (!response.ok) return null;
    const profile = normalizeProductProfile(body?.data?.product_profile);
    if (profile) writeCachedProductProfile(tenantId, profile);
    return profile;
  } catch {
    return null;
  }
}
