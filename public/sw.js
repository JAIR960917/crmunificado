self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();

    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));

    const windowClients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });

    await Promise.all(
      windowClients.map(async (client) => {
        if (typeof client.navigate === "function") {
          const url = new URL(client.url);
          url.searchParams.set("sw-cleanup", Date.now().toString());
          await client.navigate(url.toString());
        }
      })
    );

    await self.registration.unregister();
  })());
});