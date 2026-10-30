const GROWLOG_CACHE = "growlog-pwa-v38";
const PRECACHE = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.webmanifest",
  "./growlog-icon-192-v33.png",
  "./growlog-icon-512-v33.png",
  "./growlog-icon-maskable-512-v33.png",
  "./apple-touch-icon-v33.png"
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
