// ── Toppturfinner — Service Worker v5 ──
// Statisk app: ingen backend-API, alle kall direkte til eksterne tjenester.

const STATIC_CACHE = 'static-v9';
const API_CACHE = 'api-v1';
const MAP_CACHE = 'maps-v1';

// Statiske filer som caches ved installasjon
const STATIC_ASSETS = [
    './',
    'index.html',
    'offline.html',
    'css/app.css',
    'js/app.js',
    'js/api.js',
    'js/tour-finder.js',
    'js/tours-loader.js',
    'data/turer.geojson',
    'manifest.json',
    'icons/icon-192.png',
];

// ── Install ──
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// ── Activate: slett gamle cacher ──
self.addEventListener('activate', (event) => {
    const validCaches = [STATIC_CACHE, API_CACHE, MAP_CACHE];
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(k => !validCaches.includes(k))
                    .map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

// ── Fetch ──
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Eksterne API-kall (vær, skred, OSRM, sunrise, RegObs): network-first
    if (url.hostname === 'api.met.no' ||
        url.hostname === 'api01.nve.no' ||
        url.hostname === 'router.project-osrm.org' ||
        url.hostname === 'api.regobs.no') {
        event.respondWith(networkFirst(event.request, API_CACHE));
        return;
    }

    // Kartfliser (Kartverket, NVE WMS): cache-first
    if (url.hostname.includes('kartverket.no') ||
        url.hostname.includes('nve.no') ||
        url.hostname.includes('tile.openstreetmap.org')) {
        event.respondWith(cacheFirst(event.request, MAP_CACHE));
        return;
    }

    // CDN (Leaflet, Google Fonts): cache-first
    if (url.hostname === 'unpkg.com' ||
        url.hostname === 'fonts.googleapis.com' ||
        url.hostname === 'fonts.gstatic.com') {
        event.respondWith(cacheFirst(event.request, STATIC_CACHE));
        return;
    }

    // Alt annet (statiske filer): cache-first med offline fallback
    event.respondWith(
        caches.match(event.request)
            .then(cached => {
                if (cached) return cached;
                return fetch(event.request)
                    .then(resp => {
                        // Cache svar for statiske ressurser
                        if (resp.ok && event.request.method === 'GET') {
                            const clone = resp.clone();
                            caches.open(STATIC_CACHE).then(c => c.put(event.request, clone));
                        }
                        return resp;
                    })
                    .catch(() => {
                        // Offline fallback for navigering
                        if (event.request.mode === 'navigate') {
                            return caches.match('offline.html');
                        }
                        return new Response('Offline', { status: 408 });
                    });
            })
    );
});

// ── Strategier ──

async function networkFirst(request, cacheName) {
    try {
        const resp = await fetch(request);
        if (resp.ok && request.method === 'GET') {
            const cache = await caches.open(cacheName);
            cache.put(request, resp.clone());
        }
        return resp;
    } catch (e) {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response(JSON.stringify({ error: 'Offline \u2014 ingen data tilgjengelig' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

async function cacheFirst(request, cacheName) {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
        const resp = await fetch(request);
        if (resp.ok) {
            const cache = await caches.open(cacheName);
            cache.put(request, resp.clone());
        }
        return resp;
    } catch (e) {
        return new Response('Offline', { status: 408 });
    }
}
