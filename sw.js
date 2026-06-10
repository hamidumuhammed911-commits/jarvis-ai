// JARVIS Service Worker — V4.3.2
// KEY FIX: API routes (/api/*) are NEVER cached — always network-only.
// This eliminates the "Systems nominal" ghost response bug.

const CACHE_NAME = "jarvis-v4.3.2";

// Static assets that are safe to cache
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/jarvis-features.js",
  "/jarvis-reminders.js",
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

// ── Fetch: network-only for /api/*, cache-first for static ───────────────────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // CRITICAL: Never intercept API calls — always go to network
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

  // For static assets: cache-first with network fallback
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Only cache successful same-origin GET requests
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
