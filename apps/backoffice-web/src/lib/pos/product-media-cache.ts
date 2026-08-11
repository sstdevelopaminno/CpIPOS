type CacheLedgerEntry = {
  bytes: number;
  last_accessed_at: number;
};

type CacheLedger = Record<string, CacheLedgerEntry>;

export type ProductMediaCardAsset = {
  thumbnail_url?: string | null;
  image_url?: string | null;
};

export type ResolvedProductMediaUrls = {
  urls: Record<string, string>;
  revoke: () => void;
};

const CACHE_NAME = "cpipos-product-media-v1";
const LEDGER_KEY = "cpipos_product_media_cache_ledger_v1";

function readLedger(): CacheLedger {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LEDGER_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as CacheLedger;
  } catch {
    return {};
  }
}

function writeLedger(ledger: CacheLedger) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger));
  } catch {
    // Local cache is an optimization only; never block POS sales if storage is unavailable.
  }
}

function ledgerBytes(ledger: CacheLedger) {
  return Object.values(ledger).reduce((sum, item) => sum + Math.max(0, Number(item.bytes ?? 0)), 0);
}

async function evictUntilFits(cache: Cache, ledger: CacheLedger, incomingBytes: number, maxBytes: number, protectedUrls: Set<string>) {
  if (maxBytes <= 0) return false;
  let used = ledgerBytes(ledger);
  if (incomingBytes > maxBytes) return false;
  const candidates = Object.entries(ledger)
    .filter(([url]) => !protectedUrls.has(url))
    .sort((a, b) => Number(a[1].last_accessed_at ?? 0) - Number(b[1].last_accessed_at ?? 0));

  for (const [url, entry] of candidates) {
    if (used + incomingBytes <= maxBytes) break;
    await cache.delete(url).catch(() => false);
    used -= Math.max(0, Number(entry.bytes ?? 0));
    delete ledger[url];
  }
  return used + incomingBytes <= maxBytes;
}

async function warmMissingUrls(urls: string[], maxBytes: number) {
  if (typeof window === "undefined" || !("caches" in window) || maxBytes <= 0 || !navigator.onLine) return;
  const cache = await caches.open(CACHE_NAME);
  const ledger = readLedger();
  const protectedUrls = new Set(urls);

  for (const url of urls) {
    try {
      const existing = await cache.match(url);
      if (existing) {
        ledger[url] = { bytes: Math.max(0, Number(ledger[url]?.bytes ?? 0)), last_accessed_at: Date.now() };
        continue;
      }

      const response = await fetch(url, { cache: "force-cache" });
      if (!response.ok) continue;
      const copy = response.clone();
      const bytes = (await copy.blob()).size;
      const fits = await evictUntilFits(cache, ledger, bytes, maxBytes, protectedUrls);
      if (!fits) continue;
      await cache.put(url, response.clone());
      ledger[url] = { bytes, last_accessed_at: Date.now() };
    } catch {
      // Product media cache is best-effort. Public Cloud URL remains the fallback.
    }
  }
  writeLedger(ledger);
}

export async function resolveProductMediaCardUrls(
  assets: Record<string, ProductMediaCardAsset>,
  options: { enabled: boolean; maxBytes: number }
): Promise<ResolvedProductMediaUrls> {
  const publicUrls = Object.fromEntries(
    Object.entries(assets).map(([productId, asset]) => [productId, String(asset.thumbnail_url || asset.image_url || "")])
  );
  if (!options.enabled || typeof window === "undefined" || !("caches" in window)) {
    return { urls: publicUrls, revoke: () => undefined };
  }

  const urls: Record<string, string> = { ...publicUrls };
  const objectUrls: string[] = [];
  const cache = await caches.open(CACHE_NAME).catch(() => null);
  if (!cache) return { urls, revoke: () => undefined };
  const ledger = readLedger();
  const uniqueUrls = Array.from(new Set(Object.values(publicUrls).filter(Boolean)));

  for (const [productId, publicUrl] of Object.entries(publicUrls)) {
    if (!publicUrl) continue;
    try {
      const cached = await cache.match(publicUrl);
      if (!cached) continue;
      const blob = await cached.blob();
      const objectUrl = URL.createObjectURL(blob);
      objectUrls.push(objectUrl);
      urls[productId] = objectUrl;
      ledger[publicUrl] = { bytes: blob.size, last_accessed_at: Date.now() };
    } catch {
      // Public URL remains available.
    }
  }
  writeLedger(ledger);
  void warmMissingUrls(uniqueUrls, Math.max(0, options.maxBytes));

  return {
    urls,
    revoke: () => {
      for (const url of objectUrls) URL.revokeObjectURL(url);
    }
  };
}

export function readProductMediaCacheUsageBytes() {
  return ledgerBytes(readLedger());
}
