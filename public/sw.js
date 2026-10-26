// Service-Hub service worker: shows push notifications and opens the right screen on a tap
// (T12, ARCHITECTURE §9). It caches nothing, so the app always loads fresh from the network.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Pages that can play the new-booking chime (T47, src/lib/chime.ts tells): a browser plays sound
// only after the page was touched, and the person can turn it off. Lost when the worker sleeps;
// the notification then simply keeps its own sound.
const chimeReady = new Set();

self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || msg.type !== 'sh:chime' || !event.source || !event.source.id) return;
  if (msg.ready === true) chimeReady.add(event.source.id);
  else chimeReady.delete(event.source.id);
});

self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Service-Hub';
  const options = {
    body: typeof data.body === 'string' ? data.body : '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: typeof data.url === 'string' ? data.url : '/' },
  };
  if (typeof data.tag === 'string' && data.tag) {
    options.tag = data.tag;
    options.renotify = true;
  }
  event.waitUntil(
    (async () => {
      // A new booking for the shop (T47): when a page on screen can ring its own chime, the
      // notification itself stays silent instead of sounding a second time.
      if (data.chime === true) {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        if (windows.some((w) => w.visibilityState === 'visible' && chimeReady.has(w.id))) options.silent = true;
      }
      await self.registration.showNotification(title, options);
    })(),
  );
});

// Only paths inside the app; anything else opens the start page.
function appUrl(path) {
  const url = new URL(typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') ? path : '/', self.location.origin);
  return url.origin === self.location.origin ? url : new URL('/', self.location.origin);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = appUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        // The app routes itself (no reload, nothing typed is lost).
        open.postMessage({ type: 'sh:navigate', url: url.pathname + url.search });
        return open.focus();
      }
      return self.clients.openWindow(url.href);
    })(),
  );
});
