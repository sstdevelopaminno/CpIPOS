const CACHE_PREFIX = "cpipos-shell-";
const CACHE_NAME = "cpipos-shell-v7";
const OFFLINE_POS_URL = "/offline-pos.html";
const ASSETS_TO_CACHE = [
  OFFLINE_POS_URL,
  "/manifest.webmanifest",
  "/brand/cpipos-logo.png",
  "/icons/cpipos-icon-192.png",
  "/icons/cpipos-icon-512.png",
  "/icons/cpipos-browser-icon.png"
];
const STATIC_SHELL_ASSETS = new Set(ASSETS_TO_CACHE);

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function shouldBypassRuntimeCache(request, url) {
  return (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/_next/") ||
    url.searchParams.has("_rsc") ||
    request.headers.get("rsc") === "1" ||
    request.headers.has("next-router-state-tree") ||
    request.headers.has("next-router-prefetch")
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
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
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(OFFLINE_POS_URL)) || Response.error();
      })
    );
    return;
  }

  // Never cache Next.js runtime/chunks/RSC payloads. Mixing payloads from
  // different deployments can break client-side navigation after a release.
  if (shouldBypassRuntimeCache(request, url)) return;

  // Cache only the explicit offline shell assets above. All application data,
  // route payloads, and dynamically generated resources stay network-managed.
  if (!STATIC_SHELL_ASSETS.has(url.pathname)) return;

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => cache.match(request)).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type !== "basic") return response;
        const clone = response.clone();
        void caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        return response;
      });
    })
  );
});


// Never use a push payload as an external navigation or resource URL.
function safeSameOriginPath(value, fallback = "/") {
  try {
    if (typeof value !== "string" || !value) return fallback;
    const target = new URL(value, self.location.origin);
    if (target.origin !== self.location.origin || target.protocol !== self.location.protocol ||
        target.username || target.password || !target.pathname.startsWith("/") ||
        target.pathname.startsWith("//")) return fallback;
    return target.pathname + target.search + target.hash;
  } catch {
    return fallback;
  }
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "CpIPOS", body: event.data ? event.data.text() : "" };
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) payload = {};
  const title = payload.title || "CpIPOS";
  const options = {
    body: payload.body || "",
    icon: safeSameOriginPath(payload.icon, "/brand/cpipos-symbol-sidebar.png"),
    badge: safeSameOriginPath(payload.badge, "/icons/cpipos-browser-icon.png"),
    tag: payload.tag || "cpipos-notification",
    renotify: true,
    data: { url: safeSameOriginPath(payload.url), kind: payload.kind || "general" }
  };
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: "CPIPOS_PUSH_NOTIFICATION", payload: { ...payload, url: options.data.url, icon: options.icon, badge: options.badge } });
        }
      })
    ])
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(safeSameOriginPath(event.notification.data?.url), self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      for (const client of clients) {
        // Focusing an existing register must not destroy its active sale.
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});
