self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Intentionally no fetch/cache handler.
// Accounting and banking data must always come from the network and must not be stored by the service worker.
