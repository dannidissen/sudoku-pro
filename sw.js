// Offline support for Sudoku Pro.
// Network-first: online players always get the latest deploy, and every successful
// response refreshes the cache that is used when the network is unavailable.
const CACHE_NAME = 'sudoku-pro-v3';
const APP_SHELL = [
    './',
    'index.html',
    'style.css',
    'i18n.js',
    'puzzles.js',
    'solver.js',
    'app.js',
    'manifest.webmanifest',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/apple-touch-icon.png'
];

// Assets are requested with a ?v= cache-busting query. Caching by path only keeps
// a single entry per file instead of one per release.
function cacheKey(request) {
    const url = new URL(request.url);
    return url.origin + url.pathname;
}

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

    event.respondWith(
        fetch(request)
            .then(async response => {
                if (response.ok) {
                    const copy = response.clone();
                    try {
                        const cache = await caches.open(CACHE_NAME);
                        await cache.put(cacheKey(request), copy);
                    } catch (error) {
                        console.warn('Sudoku Pro cache update failed', error);
                    }
                }
                return response;
            })
            .catch(async () => {
                const cached = await caches.match(cacheKey(request));
                if (cached) return cached;
                if (request.mode === 'navigate') {
                    return caches.match(new URL('index.html', self.registration.scope).href);
                }
                return Response.error();
            })
    );
});
