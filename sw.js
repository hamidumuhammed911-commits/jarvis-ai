// JARVIS Service Worker — V4.3.3
// KEY FIX: index.html is NEVER cached — always network-only.
// API routes (/api/*) are NEVER cached — always network-only.

const CACHE_NAME = "jarvis-v4.3.3";

// Static assets that are safe to cache (index.html removed — always fresh)
const STATIC_ASSETS = [
  "/manifest.json",
];

// ── Install: cache static assets only ────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  // Activate immediately — don't wait for old SW to die
  self.skipWaiting();
});

// ── Activate: delete ALL old caches ──────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => {
            console.log("[JARVIS SW] Deleting old cache:", key);
            return caches.delete(key);
          })
      )
    )
  );
  self.clients.claim();
});

// ── Fetch: network-only for /api/* and index.html, cache-first for static ────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // CRITICAL: Never cache API calls — always go to network
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(
          JSON.stringify({ reply: "Network unavailable, Sir. Check your connection." }),
          { headers: { "Content-Type": "application/json" } }
        )
      )
    );
    return;
  }

  // CRITICAL: Never cache index.html — always fetch fresh from network
  if (url.pathname === "/" || url.pathname === "/index.html") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("/index.html"))
    );
    return;
  }

  // For other static assets: cache-first with network fallback
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (
          response.ok &&
          event.request.method === "GET" &&
          url.origin === self.location.origin
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});