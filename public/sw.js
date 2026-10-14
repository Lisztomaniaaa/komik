// KomikVibe service worker — the repeat-visit layer of the latency
// architecture (see README > "Sumber data"). The insight it encodes:
// this app is opened in short, repeated sessions, and almost
// everything it shows was already shown last time. So:
//
//   - Catalog JSON (snapshot files + live provider APIs) is served
//     stale-while-revalidate from Cache Storage: a repeat visit
//     renders instantly from the device while one background request
//     refreshes the copy for next time. The 0.35–14s origin lottery
//     leaves the critical path entirely.
//   - Images (covers via wsrv.nl, chapter pages, any source CDN) are
//     cache-first: once seen, an image is a local read (~0ms) —
//     capped, because chapter pages are heavy.
//   - The app shell stays fresh: navigations are network-first (new
//     deploys land immediately) and hashed /assets are cache-first
//     (their filenames change every build).
//   - Everything else — Firebase auth/Firestore above all — is never
//     touched. This worker only accelerates reads of public catalog
//     data and images; it must never sit between the user and their
//     account.

const VERSION = "v1";
const SHELL_CACHE = `komik-shell-${VERSION}`;
const DATA_CACHE = `komik-data-${VERSION}`;
const IMG_CACHE = `komik-img-${VERSION}`;
const IMG_LIMIT = 200;
const IMG_MAX_BYTES = 2_500_000;

const DATA_HOSTS = new Set([
  "raw.githubusercontent.com", // snapshot JSON (the primary data path)
  "www.sankavollerei.web.id", // live fallback: Sanka KomikIndo
  "komikcast.aoxi.my.id", // live fallback: Sanka KomikCast
  "api.mangadex.org", // live fallback: MangaDex
]);

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res && (res.status === 200 || res.type === "opaque")) {
    await cache.put(request, res.clone());
  }
  return res;
}

async function trimCache(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - limit))) {
    await cache.delete(key);
  }
}

async function cacheFirstImage(event) {
  const cache = await caches.open(IMG_CACHE);
  const cached = await cache.match(event.request);
  if (cached) return cached;
  const res = await fetch(event.request);
  if (res && (res.status === 200 || res.type === "opaque")) {
    const declared = Number(res.headers.get("Content-Length") || 0);
    if (!declared || declared <= IMG_MAX_BYTES) {
      await cache.put(event.request, res.clone());
      event.waitUntil(trimCache(IMG_CACHE, IMG_LIMIT));
    }
  }
  return res;
}

function staleWhileRevalidate(event, cacheName) {
  return (async () => {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(event.request);
    const network = fetch(event.request)
      .then(async (res) => {
        if (res && res.status === 200) await cache.put(event.request, res.clone());
        return res;
      })
      .catch(() => null);
    if (cached) {
      // Refresh in the background; this visit renders from the device.
      event.waitUntil(network);
      return cached;
    }
    const res = await network;
    if (res) return res;
    throw new Error("offline and nothing cached");
  })();
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(request);
    if (res && res.status === 200) await cache.put(request, res.clone());
    return res;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error("offline and no shell cached");
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (request.mode === "navigate") {
      event.respondWith(networkFirst(request));
    } else if (url.pathname.startsWith("/assets/")) {
      event.respondWith(cacheFirst(request, SHELL_CACHE));
    }
    return; // other same-origin requests: straight to network
  }

  if (DATA_HOSTS.has(url.hostname)) {
    event.respondWith(staleWhileRevalidate(event, DATA_CACHE));
    return;
  }

  if (request.destination === "image") {
    event.respondWith(cacheFirstImage(event));
  }
  // Anything else (Firebase, etc.) passes through untouched.
});
