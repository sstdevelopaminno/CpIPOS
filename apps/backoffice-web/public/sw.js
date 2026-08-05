const CACHE_NAME = "cpipos-shell-v3";
const OFFLINE_POS_URL = "/offline-pos.html";
const ASSETS_TO_CACHE = [
  "/",
  OFFLINE_POS_URL,
  "/manifest.webmanifest",
  "/brand/cpipos-logo.png",
  "/icons/cpipos-icon-192.png",
  "/icons/cpipos-icon-512.png",
  "/icons/cpipos-browser-icon.png"
];

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function shouldBypassRuntimeCache(url) {
  return (
    url.pathname.startsWith("/api/auth") ||
    url.pathname.startsWith("/api/pos")
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS_TO_CACHE))
      .catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) return caches.delete(key);
            return Promise.resolve(true);
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const offlineShell = await caches.match(OFFLINE_POS_URL);
          if (offlineShell) return offlineShell;
          const cached = await caches.match(request);
          return cached ?? caches.match("/");
        })
    );
    return;
  }

  if (shouldBypassRuntimeCache(url)) {
    event.respondWith(fetch(request));
    return;
  }

  if (url.pathname.startsWith("/_next/") || url.pathname.startsWith("/brand/") || url.pathname.startsWith("/icons/") || url.pathname === OFFLINE_POS_URL) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          throw new Error("Cached asset unavailable.");
        })
    );
  }
});
