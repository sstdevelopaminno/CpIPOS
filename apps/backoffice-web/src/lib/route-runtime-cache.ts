type CacheSource = "hit" | "miss" | "inflight" | "stale";

type CacheEntry = {
  expiresAt: number;
  staleUntil: number;
  value: unknown;
  touchedAt: number;
};

const valueCache = new Map<string, CacheEntry>();
const inflightCache = new Map<string, Promise<unknown>>();
const MAX_ENTRIES = 512;

function pruneCache(now: number) {
  for (const [key, entry] of valueCache.entries()) {
    if (entry.staleUntil <= now) {
      valueCache.delete(key);
    }
  }
  if (valueCache.size <= MAX_ENTRIES) return;
  const sorted = Array.from(valueCache.entries()).sort((left, right) => left[1].touchedAt - right[1].touchedAt);
  const removeCount = valueCache.size - MAX_ENTRIES;
  for (let i = 0; i < removeCount; i += 1) {
    valueCache.delete(sorted[i][0]);
  }
}

export async function readThroughRuntimeCache<T>(args: {
  key: string;
  ttlMs: number;
  staleIfErrorMs?: number;
  loader: () => Promise<T>;
}): Promise<{ value: T; source: CacheSource }> {
  const { key, ttlMs, loader } = args;
  const staleIfErrorMs = Math.max(0, Number(args.staleIfErrorMs ?? 0));
  const now = Date.now();
  pruneCache(now);

  const cached = valueCache.get(key);
  if (cached && cached.expiresAt > now) {
    cached.touchedAt = now;
    return { value: cached.value as T, source: "hit" };
  }

  const stale = cached && cached.staleUntil > now ? cached : null;
  const inflight = inflightCache.get(key);
  if (inflight) {
    try {
      return { value: (await inflight) as T, source: "inflight" };
    } catch (error) {
      if (stale) {
        stale.touchedAt = Date.now();
        return { value: stale.value as T, source: "stale" };
      }
      throw error;
    }
  }

  const promise = (async () => {
    const loaded = await loader();
    const storedAt = Date.now();
    const freshForMs = Math.max(50, ttlMs);
    valueCache.set(key, {
      value: loaded,
      expiresAt: storedAt + freshForMs,
      staleUntil: storedAt + freshForMs + staleIfErrorMs,
      touchedAt: storedAt
    });
    return loaded;
  })().finally(() => {
    inflightCache.delete(key);
  });

  inflightCache.set(key, promise);
  try {
    return { value: (await promise) as T, source: "miss" };
  } catch (error) {
    if (stale) {
      stale.touchedAt = Date.now();
      return { value: stale.value as T, source: "stale" };
    }
    throw error;
  }
}

export function invalidateRuntimeCacheByPrefix(prefix: string) {
  if (!prefix) return;
  for (const key of valueCache.keys()) {
    if (key.startsWith(prefix)) {
      valueCache.delete(key);
    }
  }
}
