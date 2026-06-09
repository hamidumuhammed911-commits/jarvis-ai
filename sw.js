// JARVIS V4.4.0 — sw.js
const CACHE_NAME = "jarvis-v4.4.0";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/jarvis-features.js",
  "/jarvis-reminders.js",
];

// ── Install: cache static assets ──────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// ── Activate: purge old caches ────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: network-first for API, cache-first for static ─────────────────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never cache API routes
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: "Offline — JARVIS network unavailable" }), {
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    return;
  }

  // Cache-first for static assets
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== "basic") return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      });
    })
  );
});

// ── Push Notifications (Reminders) ───────────────────────────────────────
self.addEventListener("push", (event) => {
  let data = { title: "JARVIS", body: "Reminder, Sir.", icon: "/icons/icon-192.png" };
  try {
    data = event.data ? JSON.parse(event.data.text()) : data;
  } catch { /* use defaults */ }

  event.waitUntil(
    self.registration.showNotification(data.title || "JARVIS", {
      body: data.body || "You have a reminder, Sir.",
      icon: data.icon || "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      vibrate: [200, 100, 200],
      tag: data.tag || "jarvis-reminder",
      data: { url: data.url || "/" },
      actions: [
        { action: "open", title: "Open JARVIS" },
        { action: "dismiss", title: "Dismiss" },
      ],
    })
  );
});

// ── Notification click ────────────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss") return;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === "/" && "focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(event.notification.data?.url || "/");
    })
  );
});

// ── Background Sync (future use) ─────────────────────────────────────────
self.addEventListener("sync", (event) => {
  if (event.tag === "jarvis-sync") {
    event.waitUntil(Promise.resolve());
  }
});

// ── Message from page (force update) ─────────────────────────────────────
self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
});