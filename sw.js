// JARVIS V4.3.0 — sw.js
// Cache version bump forces old cache purge on every deploy

const CACHE_NAME = "jarvis-v4.3.0";
const CACHE_STATIC = "jarvis-static-v4.3.0";

// Assets to pre-cache on install
const PRE_CACHE = [
  "/",
  "/index.html",
  "/manifest.json",
  "/jarvis-features.js",
  "/jarvis-reminders.js",
];

// Never cache these prefixes
const NEVER_CACHE = ["/api/", "https://api.groq.com", "https://api.upstash.io"];

// ── Install: pre-cache static shell ──────────────────────────────────────────
self.addEventListener("install", (event) => {
  console.log("[JARVIS SW] Installing v4.3.0...");
  event.waitUntil(
    caches
      .open(CACHE_STATIC)
      .then((cache) => cache.addAll(PRE_CACHE))
      .then(() => self.skipWaiting()) // Force immediate activation
  );
});

// ── Activate: purge ALL old caches ───────────────────────────────────────────
self.addEventListener("activate", (event) => {
  console.log("[JARVIS SW] Activating v4.3.0 — purging old caches...");
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_STATIC) // Delete everything except current
            .map((k) => {
              console.log("[JARVIS SW] Deleting old cache:", k);
              return caches.delete(k);
            })
        )
      )
      .then(() => self.clients.claim()) // Take control of all open tabs
  );
});

// ── Fetch: smart routing ──────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const url = event.request.url;

  // 1. Never cache API routes or external API calls
  const isApiCall = NEVER_CACHE.some((prefix) => url.includes(prefix));
  if (isApiCall) {
    event.respondWith(fetch(event.request));
    return;
  }

  // 2. For non-GET requests, always go to network
  if (event.request.method !== "GET") {
    event.respondWith(fetch(event.request));
    return;
  }

  // 3. For navigation requests (HTML pages) — network first, fallback to cache
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Update cache with fresh version
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_STATIC).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match("/index.html"))
    );
    return;
  }

  // 4. Static assets — cache first, network fallback
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok && event.request.method === "GET") {
          const clone = response.clone();
          caches.open(CACHE_STATIC).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});

// ── Message: handle skipWaiting from app ─────────────────────────────────────
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    console.log("[JARVIS SW] Received SKIP_WAITING — forcing update...");
    self.skipWaiting();
  }
  if (event.data?.type === "GET_VERSION") {
    event.ports[0]?.postMessage({ version: CACHE_NAME });
  }
});