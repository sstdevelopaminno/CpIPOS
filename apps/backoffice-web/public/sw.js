const CACHE_NAME = "cpipos-shell-v2";
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
    url.pathname.startsWith("/api/pos") ||
    url.pathname.startsWith("/api/windows-runtime")
  );
}

async function putCache(request, response) {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  } catch {
    // Cache storage must never block navigation.
  }
}

async function offlineNavigationFallback(request) {
  const cachedPage = await caches.match(request);
  if (cachedPage) return cachedPage;
  const offlineShell = await caches.match(OFFLINE_POS_URL);
  if (offlineShell) return offlineShell;
  const root = await caches.match("/");
  if (root) return root;
  return new Response("CpIPOS offline shell is not cached yet.", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8" }
  });
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
          void putCache(request, response);
          return response;
        })
        .catch(() => offlineNavigationFallback(request))
    );
    return;
  }

  if (shouldBypassRuntimeCache(url)) {
    event.respondWith(fetch(request));
    return;
  }

  if (url.pathname === OFFLINE_POS_URL) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          void putCache(request, response);
          return response;
        })
        .catch(async () => (await caches.match(OFFLINE_POS_URL)) ?? offlineNavigationFallback(request))
    );
    return;
  }

  if (url.pathname.startsWith("/_next/")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          void putCache(request, response);
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          throw new Error("Next asset unavailable.");
        })
    );
    return;
  }

  if (url.pathname.startsWith("/brand/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          void putCache(request, response);
          return response;
        });
      })
    );
  }
});
