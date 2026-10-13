// Service worker: guarda todos los archivos para que la app funcione sin internet.
// Al cambiar VERSION, la app muestra "Versión nueva: toca para actualizar".
const VERSION = '1.2.0';
const CACHE = `app-registro-${VERSION}`;
const ARCHIVOS = [
  './',
  './index.html',
  './estilos.css',
  './manifest.webmanifest',
  './iconos/icono-192.png',
  './iconos/icono-512.png',
  './iconos/icono-maskable-512.png',
  './src/app.js',
  './src/avisos.js',
  './src/calculos.js',
  './src/cierre.js',
  './src/comida.js',
  './src/copia.js',
  './src/cuerpo.js',
  './src/datos.js',
  './src/db.js',
  './src/entreno.js',
  './src/estado.js',
  './src/fechas.js',
  './src/hoy.js',
  './src/navegar.js',
  './src/progresion.js',
  './src/resumen.js',
  './src/ui.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(ARCHIVOS.map((u) => new Request(u, { cache: 'reload' })));
      // La primera instalación se activa sola; las siguientes esperan el toque del usuario.
      if (!self.registration.active) await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const nombres = await caches.keys();
      await Promise.all(nombres.filter((n) => n.startsWith('app-registro-') && n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'saltar') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Open Food Facts y otros: directo a internet
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (req.mode === 'navigate') {
        const r = await cache.match('./index.html');
        if (r) return r;
      }
      const r = await cache.match(req, { ignoreSearch: true });
      if (r) return r;
      try {
        return await fetch(req);
      } catch {
        return new Response('Sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })(),
  );
});
