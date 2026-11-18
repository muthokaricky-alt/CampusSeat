/**
 * Installable app + offline tickets. The service worker (public/sw.js) is only registered in the
 * production build, so local development never serves stale files.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* the app works without it */ });
  });
}

/** Called on logout: removes the personal copies (bookings, QR codes, session) kept for offline use. */
export async function clearOfflineData() {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: 'clear-private' });
    if ('caches' in window) for (const k of await caches.keys()) if (k.startsWith('cs-private-')) await caches.delete(k);
  } catch { /* nothing cached */ }
}
