// Service worker de NexusResidencial: permite instalar la app y recibir notificaciones push.
// No guarda datos de la API en caché (son privados y cambian); solo la página base para abrir sin red.
const SHELL = "nexus-shell-v2";

self.addEventListener("install", (event) => {
  // Si alguna página no se puede guardar, la app se instala igual (los avisos no dependen de la caché).
  event.waitUntil(caches.open(SHELL)
    .then((cache) => Promise.allSettled(["/", "/manifest.webmanifest", "/icons/icon-192.png"].map((url) => cache.add(url))))
    .catch(() => undefined)
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== SHELL).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // Solo navegación del mismo origen: red primero y, sin conexión, la página base.
  if (request.mode === "navigate" && new URL(request.url).origin === self.location.origin) {
    event.respondWith(fetch(request).catch(() => caches.match("/")));
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "NexusResidencial", body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || "NexusResidencial", {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: data.tag,
    data: { url: data.url || "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const open = windows.find((client) => client.url.startsWith(self.location.origin));
    if (open) { open.navigate(target); return open.focus(); }
    return self.clients.openWindow(target);
  }));
});
