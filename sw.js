// ============================================================
// JARVIS Service Worker — V4.3.0
// FIX: Bumped cache version + API routes always bypass cache
// ============================================================

const CACHE_NAME = 'jarvis-v4.3.0';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/jarvis-features.js',
  '/jarvis-reminders.js'
];

// ── Install: cache static shell ──────────────────────────────
self.addEventListener('install', event => {
  // Force this SW to activate immediately, replacing any old one
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
});

// ── Activate: purge ALL old caches ──────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim()) // Take control of all open tabs immediately
  );
});

// ── Fetch: network-first for API, cache-first for static ────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // CRITICAL: Never cache API calls — always go to network
  if (
    url.pathname.startsWith('/api/') ||
    url.hostname.includes('api.groq.com') ||
    url.hostname.includes('upstash.io') ||
    url.hostname.includes('serper.dev') ||
    url.hostname.includes('open-meteo.com') ||
    url.hostname.includes('nominatim.openstreetmap.org')
  ) {
    event.respondWith(
      fetch(event.request).catch(err => {
        console.error('[SW] API fetch failed:', err);
        return new Response(
          JSON.stringify({ error: 'Network unavailable', offline: true }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // Static assets: cache-first with network fallback
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Only cache valid GET responses
        if (
          event.request.method === 'GET' &&
          response.status === 200 &&
          response.type !== 'opaque'
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});

// ── Message: allow manual cache clear from app ──────────────
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data === 'CLEAR_CACHE') {
    caches.keys().then(keys =>
      Promise.all(keys.map(key => caches.delete(key)))
    ).then(() => {
      event.ports[0]?.postMessage({ cleared: true });
    });
  }
});