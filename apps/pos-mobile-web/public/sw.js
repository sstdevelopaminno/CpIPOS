const SW_VERSION = "sstipos-mobile-2026-07-18-notifications";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    self.clients.claim().then(async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) {
        client.postMessage({ type: "SSTIPOS_SW_READY", version: SW_VERSION });
      }
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", () => {
  // Network-first by default. Avoid stale POS/auth data and keep the PWA stable.
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text() };
  }

  const title = payload.title || "CpIPOS Mobile";
  const body = payload.body || payload.message || "มีการแจ้งเตือนใหม่";
  const options = {
    body,
    icon: payload.icon || "/brand/cpipos-icon-transparent-192.png",
    badge: payload.badge || "/brand/cpipos-icon-transparent-192.png",
    tag: payload.tag || `sstipos-mobile-push-${Date.now()}`,
    renotify: payload.renotify !== false,
    data: {
      url: payload.url || "/sales",
    },
  };

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({
        type: "SSTIPOS_PUSH_NOTICE",
        title,
        message: body,
        url: options.data.url,
      });
    }
    await self.registration.showNotification(title, options);
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/sales", self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client && client.url.startsWith(self.location.origin)) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
