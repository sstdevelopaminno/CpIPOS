import {
  normalizeProductProfile,
  type ProductProfileCode
} from "@/lib/product-profile-policy";

type ProfileBody = {
  data?: { product_profile?: string | null } | null;
};

export const POS_PRODUCT_PROFILE_CACHE_PREFIX = "cpipos_product_profile_v1";
const PROFILE_REQUEST_RETRY_COOLDOWN_MS = 15_000;
const inFlightProfileRequests = new Map<string, Promise<ProductProfileCode | null>>();
const profileRetryAfter = new Map<string, number>();

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
  const id = String(tenantId ?? "").trim();
  if (!id) return null;

  const cachedProfile = readCachedProductProfile(id);
  const retryAt = profileRetryAfter.get(id) ?? 0;
  if (retryAt > Date.now()) return cachedProfile;

  const inFlight = inFlightProfileRequests.get(id);
  if (inFlight) return inFlight;

  const request = (async (): Promise<ProductProfileCode | null> => {
    try {
      const response = await fetch("/api/pos/product-profile", {
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" }
      });
      const body = (await response.json().catch(() => null)) as ProfileBody | null;
      if (!response.ok) {
        profileRetryAfter.set(id, Date.now() + PROFILE_REQUEST_RETRY_COOLDOWN_MS);
        return cachedProfile;
      }

      const profile = normalizeProductProfile(body?.data?.product_profile);
      if (!profile) {
        profileRetryAfter.set(id, Date.now() + PROFILE_REQUEST_RETRY_COOLDOWN_MS);
        return cachedProfile;
      }

      profileRetryAfter.delete(id);
      writeCachedProductProfile(id, profile);
      return profile;
    } catch {
      profileRetryAfter.set(id, Date.now() + PROFILE_REQUEST_RETRY_COOLDOWN_MS);
      return cachedProfile;
    } finally {
      inFlightProfileRequests.delete(id);
    }
  })();

  inFlightProfileRequests.set(id, request);
  return request;
}
