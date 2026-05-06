self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
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

  event.waitUntil(
    self.registration.showNotification(data.title || "CRM Óticas Joonker", options)
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
    })
  );
});