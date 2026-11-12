const GROWLOG_CACHE = "growlog-pwa-v80";
const PRECACHE = [
  "./",
  "./index.html",
  "./app.js?v=80",
  "./lesson-videos.css?v=46",
  "./manifest.webmanifest",
  "./growlog-icon-192-v39.png",
  "./growlog-icon-512-v39.png",
  "./growlog-icon-maskable-512-v39.png",
  "./apple-touch-icon-v39.png"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(GROWLOG_CACHE).then((cache) => cache.addAll(PRECACHE)).catch(() => undefined)
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("growlog-pwa-") && key !== GROWLOG_CACHE).map((key) => caches.delete(key)))),
      self.clients.claim()
    ])
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request).then((response) => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(GROWLOG_CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
      }
      return response;
    }).catch(async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === "navigate") {
        const shell = await caches.match("./index.html");
        if (shell) return shell;
      }
      return Response.error();
    })
  );
});


self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    try {
      payload = { body: event.data ? event.data.text() : "" };
    } catch (_) {}
  }

  const title = payload.title || "Growlog 🌱";
  const options = {
    body: payload.body || "아이의 새로운 수업기록이 도착했어요.",
    icon: payload.icon || "./growlog-icon-192-v39.png",
    badge: payload.badge || "./growlog-icon-192-v39.png",
    tag: payload.tag || "growlog-notification",
    renotify: true,
    data: payload.data || {}
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const targetUrl = new URL(data.url || "./", self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      try {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin === self.location.origin) {
          await client.focus();
          if (data.notification_id) {
            client.postMessage({
              type: "GROWLOG_NOTIFICATION_CLICK",
              notification_id: data.notification_id
            });
          } else {
            client.navigate(targetUrl);
          }
          return;
        }
      } catch (_) {}
    }
    await self.clients.openWindow(targetUrl);
  })());
});
