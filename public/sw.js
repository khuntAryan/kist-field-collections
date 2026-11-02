/*
 * Kist service worker. Keeps the officer app openable with no signal.
 * - App code and fonts (hashed files): cache first.
 * - The officer page: network first, falling back to the last copy saved on this phone.
 * - API calls are never cached; the app keeps its own data in IndexedDB.
 */
const VERSION = "v1";
const STATIC = `kist-static-${VERSION}`;
const PAGES = `kist-pages-${VERSION}`;
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PAGES);
      await cache.add(new Request(OFFLINE_URL, { cache: "reload" }));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC, PAGES]);
      for (const key of await caches.keys()) if (!keep.has(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (req.headers.get("RSC") || url.searchParams.has("_rsc")) return;

  if (url.pathname.startsWith("/_next/static/") || /\.(woff2|png|svg|ico)$/.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })(),
    );
    return;
  }

  if (req.mode === "navigate") {
    const isApp = url.pathname === "/app" || url.pathname.startsWith("/app/");
    event.respondWith(
      (async () => {
        const cache = await caches.open(PAGES);
        try {
          const res = await Promise.race([fetch(req), timeout(isApp ? 5000 : 10000)]);
          if (isApp && res.ok && !res.redirected) cache.put("/app", res.clone());
          return res;
        } catch {
          if (isApp) {
            const saved = await cache.match("/app");
            if (saved) return saved;
          }
          return (await cache.match(OFFLINE_URL)) || Response.error();
        }
      })(),
    );
  }
});
