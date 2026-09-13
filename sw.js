// Service worker mínimo: necesario para que el navegador considere la app
// "instalable" (PWA). Usa red primero y solo cae al caché si no hay
// conexión, para que siempre se vea la versión más reciente cuando hay internet.
const CACHE_NAME = "copasa-shell-v1";
const ARCHIVOS_BASE = [
  "./login.html",
  "./dashboard.html",
  "./css/styles.css",
  "./img/icon-192.png",
  "./img/icon-512.png"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ARCHIVOS_BASE)).catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((claves) =>
      Promise.all(claves.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Solo el propio sitio (HTML/CSS/JS); Firebase y CDNs externos van directo a la red
  if (event.request.method !== "GET" || !event.request.url.startsWith(self.location.origin)) return;
  event.respondWith(
    fetch(event.request)
      .then((respuesta) => {
        const copia = respuesta.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia));
        return respuesta;
      })
      .catch(() => caches.match(event.request))
  );
});
