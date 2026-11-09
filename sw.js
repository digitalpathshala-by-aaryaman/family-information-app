// Family Information Book service worker.
// Keeps the app shell on the device so the book opens fast and works offline.
// Your family data is never cached here: it is stored by the database and on-device cache.
// Bump VERSION when a shell file changes so every device fetches the new files.
const VERSION = 'v11-edit-protection';
const CACHE = 'family-book-' + VERSION;
const SHELL = [
  './',
  './index.html',
  './config.js',
  './data.js',
  './xlsx-reader.js',
  './cloud.js',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './template/Family-Information-Book-Template.xlsx'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('family-book-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first on every HTML/JS/CSS request: a reload must not silently run old save logic.
// Offline fallbacks remain available from the app-shell cache.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(req);
      if (response && response.ok) await cache.put(req, response.clone());
      return response;
    } catch (err) {
      return await cache.match(req) || (req.mode === 'navigate' ? await cache.match('./index.html') : Response.error());
    }
  })());
});
