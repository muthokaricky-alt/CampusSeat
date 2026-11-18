/*
 * CampusSeat service worker: keeps your tickets available offline, at the door with no signal.
 *
 * What is cached, and how:
 *  - Build files (/assets/*, hashed, never change): cache first.
 *  - Pages (navigations): network first, falling back to the saved app shell.
 *  - Your bookings, their QR codes and your session: network first, falling back to the last copy.
 *    These are personal, so they live in their own cache, which is cleared when you log out.
 *  - Everything else (other API calls, anything that changes data): network only, never cached.
 */
const VERSION = 'v1';
const SHELL = `cs-shell-${VERSION}`;
const PRIVATE = `cs-private-${VERSION}`;

const PRIVATE_API = [/^\/api\/bookings\/mine(\?|$)/, /^\/api\/bookings\/waitlist$/, /^\/api\/bookings\/\d+\/qr\.svg$/, /^\/api\/auth\/session$/];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/favicon.svg', '/theme-init.js', '/manifest.webmanifest'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (![SHELL, PRIVATE].includes(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

// Logging out clears personal copies (sent by the page).
self.addEventListener('message', (event) => {
  if (event.data?.type === 'clear-private') event.waitUntil(caches.delete(PRIVATE));
});

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(fallbackUrl || request, res.clone());
    return res;
  } catch {
    const hit = await cache.match(fallbackUrl || request);
    if (hit) return hit;
    throw new Error('offline and not cached');
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never touch requests that change things
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(caches.open(SHELL).then(async (c) => (await c.match(req)) || fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; })));
    return;
  }
  if (req.mode === 'navigate') {
    // Every page is the same app shell; keep the latest copy of it.
    event.respondWith(networkFirst(req, SHELL, '/'));
    return;
  }
  if (PRIVATE_API.some((re) => re.test(url.pathname + url.search))) {
    event.respondWith(networkFirst(req, PRIVATE));
  }
});
