const CACHE = "crm-pwa-v5";

const PRECACHE = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/pwa-192x192.png",
  "/pwa-512x512.png",
  "/favicon.ico",
];

const NETWORK_ONLY = ["/runtime-config.js", "/service-worker.js", "/sw.js", "/sw-custom.js"];

function isNetworkOnly(pathname) {
  return NETWORK_ONLY.some((p) => pathname === p || pathname.endsWith(p));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => undefined)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (isNetworkOnly(url.pathname)) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/index.html")),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);

      try {
        const response = await fetch(request);
        if (response.ok) {
          await cache.put(request, response.clone());
        }
        return response;
      } catch {
        if (cached) return cached;
        throw new Error("offline");
      }
    })(),
  );
});

self.addEventListener("push", (event) => {
  let data = { title: "CRM Óticas Joonker", body: "Nova notificação" };

  try {
    data = event.data?.json() ?? data;
  } catch {
    // no-op
  }

  const options = {
    body: data.body || "Nova notificação",
    icon: data.icon || "/pwa-192x192.png",
    badge: data.badge || "/pwa-192x192.png",
    vibrate: [200, 100, 200],
    data: data.data || { url: "/" },
    actions: [{ action: "open", title: "Abrir" }],
  };

  event.respondWith(
    self.registration.showNotification(data.title || "CRM Óticas Joonker", options),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }

      return self.clients.openWindow(url);
    }),
  );
});
