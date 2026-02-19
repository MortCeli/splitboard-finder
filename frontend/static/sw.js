// Service Worker — Splitboard Finder v2
const STATIC_CACHE = 'static-v2';
const API_CACHE = 'api-v1';
const MAP_CACHE = 'maps-v1';

const STATIC_ASSETS = [
    '/',
    '/static/css/app.css',
    '/static/js/app.js',
    '/static/manifest.json',
    '/static/icons/icon-192.png',
    '/offline.html',
];

// Install: cache statiske filer
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS))
    );
    self.skipWaiting();
});

// Activate: rydd opp gamle caches
self.addEventListener('activate', (event) => {
    const validCaches = [STATIC_CACHE, API_CACHE, MAP_CACHE];
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.filter((k) => !validCaches.includes(k))
                    .map((k) => caches.delete(k))
            )
        )
    );
    self.clients.claim();
});

// Fetch: ulike strategier basert på type
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // API-kall: network-first med cache-fallback
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(networkFirst(event.request, API_CACHE));
        return;
    }

    // Karttiles: cache-first (uendret for en gitt URL)
    if (url.hostname.includes('kartverket.no') ||
        url.hostname.includes('tile.openstreetmap.org')) {
        event.respondWith(cacheFirst(event.request, MAP_CACHE));
        return;
    }

    // Statiske filer: cache-first med offline fallback
    event.respondWith(
        caches.match(event.request)
            .then((cached) => cached || fetch(event.request))
            .catch(() => {
                if (event.request.mode === 'navigate') {
                    return caches.match('/offline.html');
                }
            })
    );
});

async function networkFirst(request, cacheName) {
    try {
        const response = await fetch(request);
        const cache = await caches.open(cacheName);
        cache.put(request, response.clone());
        return response;
    } catch (e) {
        const cached = await caches.match(request);
        return cached || new Response(
            JSON.stringify({ error: 'Offline — ingen data tilgjengelig' }),
            { headers: { 'Content-Type': 'application/json' } }
        );
    }
}

async function cacheFirst(request, cacheName) {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
        const response = await fetch(request);
        const cache = await caches.open(cacheName);
        cache.put(request, response.clone());
        return response;
    } catch (e) {
        return new Response('', { status: 408 });
    }
}
