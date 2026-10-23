/**
 * The app shell, cached so an installed app opens fast and the standalone
 * window still renders on a flaky connection. Two rules, both load-bearing:
 *
 * - `/api/*` is never intercepted. Attendance answers must stay fresh, and
 *   the session travels on those requests — a cached one would revive a dead
 *   session or show another read's numbers.
 * - `/assets/*` filenames carry a content hash, so cache-first is safe there
 *   and nowhere else is cached blindly.
 */
const SHELL = "vignan-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

const clearOldCaches = async () => {
  const keys = await caches.keys();
  await Promise.all(
    keys.filter((key) => key !== SHELL).map((key) => caches.delete(key))
  );
  await self.clients.claim();
};
self.addEventListener("activate", (event) => {
  event.waitUntil(clearOldCaches());
});

const serveAsset = async (request) => {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) void cache.put(request, res.clone());
  return res;
};

const serveDocument = async (request) => {
  try {
    const res = await fetch(request);
    if (!res.ok) return res;
    const cache = await caches.open(SHELL);
    void cache.put(request, res.clone());
    return res;
  } catch {
    const hit = await caches.match(request);
    return hit ?? Response.error();
  }
};

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  // Session-bound reads: always the network, never the cache.
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(serveAsset(event.request));
    return;
  }
  if (event.request.mode === "navigate") {
    event.respondWith(serveDocument(event.request));
  }
});
