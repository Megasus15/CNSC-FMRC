/* Only the offline shell is cached. No account data, API responses or writes. */
const APP = new URL(self.registration.scope).pathname.includes('/team/') ? 'team' : 'customer';
const ROOT = `/apps/${APP}/`;
const CACHE = `fmrc-${APP}-offline-v4`;
const ASSETS = [`${ROOT}offline.html`, '/apps/shared/offline.css', `${ROOT}icons/icon-192.png`];
function bindingDB() {
  return new Promise((resolve, reject) => { const open = indexedDB.open(`fmrc-${APP}-push`, 1); open.onupgradeneeded = () => open.result.createObjectStore('preferences'); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
}
async function binding(value, write = false) {
  const db = await bindingDB();
  return new Promise((resolve, reject) => { const transaction = db.transaction('preferences', write ? 'readwrite' : 'readonly'); const store = transaction.objectStore('preferences'); const op = write ? store.put(value, 'binding') : store.get('binding'); transaction.oncomplete = () => { db.close(); resolve(op.result); }; transaction.onerror = () => { db.close(); reject(transaction.error); }; });
}
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(`fmrc-${APP}-offline-`) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (ASSETS.includes(url.pathname)) { event.respondWith(caches.open(CACHE).then(cache => cache.match(url.pathname)).then(cached => cached || fetch(event.request))); return; }
  if (event.request.mode === 'navigate' && url.pathname.startsWith(ROOT)) event.respondWith(fetch(event.request).catch(() => caches.open(CACHE).then(cache => cache.match(`${ROOT}offline.html`))));
});
self.addEventListener('message', event => {
  if (event.data?.type === 'binding') event.waitUntil(binding(event.data.value, true).then(() => event.ports[0]?.postMessage({ saved: true })));
  if (event.data?.type === 'badge') event.waitUntil((event.data.count ? self.navigator.setAppBadge?.(event.data.count) : self.navigator.clearAppBadge?.()) || Promise.resolve());
});
self.addEventListener('push', event => event.waitUntil((async () => {
  let data; try { data = event.data.json(); } catch { return; }
  if (data.app !== APP) return;
  const state = await binding();
  if (!state || (data.public ? !state.public_alerts : !state.account_alerts || Number(state.user_id) !== Number(data.binding))) return;
  const target = new URL(data.url, self.location.origin);
  if (target.origin !== self.location.origin || !target.pathname.startsWith(ROOT)) return;
  // Phone previews deliberately omit the website message and any personal or financial fields.
  await self.registration.showNotification(APP === 'team' ? 'FMRC Team' : 'UCN–FMRC', {
    body: `${String(data.kind || 'FMRC update').slice(0, 64)}. Open FMRC to view it.`,
    icon: `${ROOT}icons/icon-192.png${APP === 'team' ? '?v=3' : ''}`, badge: `${ROOT}icons/notification.png`, tag: `fmrc-${APP}-${data.id}`, renotify: false,
    data: { url: target.href },
  });
  await self.navigator.setAppBadge?.();
})()));
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL(event.notification.data?.url || ROOT, self.location.origin);
    if (target.origin !== self.location.origin || !target.pathname.startsWith(ROOT)) return;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windows.find(window => new URL(window.url).pathname.startsWith(ROOT));
    if (client) { await client.navigate(target.href); await client.focus(); } else await self.clients.openWindow(target.href);
  })());
});
self.addEventListener('pushsubscriptionchange', event => {
  // Do not silently create a new subscription. The next explicit Enable action repairs it.
  event.waitUntil(binding(null, true));
});
