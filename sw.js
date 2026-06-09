// JARVIS Service Worker — V4.3.0
// Stark Industries — Restricted Access

const CACHE_NAME = "jarvis-v4.3.0";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/jarvis-features.js",
  "/jarvis-reminders.js",
  "https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&display=swap",
];

// ─── Install: cache static assets ────────────────────────────────────────────
self.addEventListener("install", (event) => {
  console.log("[JARVIS SW] Installing V4.3.0...");
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn("[JARVIS SW] Cache addAll partial failure:", err);
      });
    })
  );
  // Force immediate activation — skip waiting
  self.skipWaiting();
});

// ─── Activate: purge old caches ───────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  console.log("[JARVIS SW] Activating V4.3.0 — purging old caches...");
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log("[JARVIS SW] Deleting old cache:", key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// ─── Fetch: network-first for API, cache-first for static ────────────────────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // NEVER cache API routes or external services
  const bypassPatterns = [
    "/api/",
    "api.groq.com",
    "groq.com",
    "upstash.io",
    "serper.dev",
    "open-meteo.com",
    "nominatim.openstreetmap.org",
    "api.telegram.org",
  ];

  const shouldBypass = bypassPatterns.some(
    (p) => url.pathname.startsWith(p) || url.hostname.includes(p.replace("/", ""))
  );

  if (shouldBypass) {
    // Pure network — no caching
    event.respondWith(fetch(event.request));
    return;
  }

  // Cache-first for static assets, fallback to network
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Cache valid GET responses for static assets
        if (
          event.request.method === "GET" &&
          response.status === 200 &&
          response.type !== "opaque"
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback for navigation requests
        if (event.request.mode === "navigate") {
          return caches.match("/index.html");
        }
      });
    })
  );
});

// ─── Message handler: force update from client ───────────────────────────────
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (event.data && event.data.type === "CLEAR_CACHE") {
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
  }
});