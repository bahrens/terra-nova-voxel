// Network-first service worker: fetch every GET from the network bypassing the
// HTTP cache, so the newest deploy always shows on reload — even on mobile
// Safari, which otherwise serves a cached page for ~10 minutes. No offline
// caching (this is a dev/testing convenience); a caching strategy can come later
// for production. Once installed it controls the page on the next reload.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(fetch(e.request, { cache: "no-store" }));
});
