const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '../../..');
function worker(app) {
  const handlers = {}, caches = new Map(), notifications = [], navigations = [], fetches = [];
  let state = null, offline = false;
  const db = { close() {}, transaction() { const transaction = { objectStore() { return { get() { const result = { result: state }; queueMicrotask(() => transaction.oncomplete()); return result; }, put(value) { state = value; const result = { result: true }; queueMicrotask(() => transaction.oncomplete()); return result; } }; } }; return transaction; } };
  const self = { location: { origin: 'https://fmrc.example' }, registration: { scope: `https://fmrc.example/apps/${app}/`, showNotification: async (title, options) => notifications.push({ title, ...options }) }, navigator: { setAppBadge: async () => {} }, addEventListener: (name, fn) => handlers[name] = fn, skipWaiting: async () => {}, clients: { claim: async () => {}, matchAll: async () => [{ url: `https://fmrc.example/apps/${app}/home`, navigate: async url => navigations.push(url), focus: async () => {} }], openWindow: async url => navigations.push(url) } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'apps/shared/worker.js'), 'utf8'), { self, URL, Promise, Number, String, queueMicrotask, indexedDB: { open() { const result = { result: db }; queueMicrotask(() => result.onsuccess()); return result; } }, caches: { open: async name => ({ addAll: async assets => caches.set(name, assets), match: async url => ({ offline: url }) }), keys: async () => [...caches.keys()], delete: async name => caches.delete(name) }, fetch: async request => { fetches.push(request); if (offline) throw Error('Offline'); return { online: true }; } });
  return { handlers, caches, notifications, navigations, fetches, setOffline: () => offline = true, async event(name, extra = {}) { let promise; const event = { ...extra, waitUntil: job => promise = job, respondWith: job => promise = job }; handlers[name](event); return await promise; } };
}
test('two manifest identities and maskable/Apple icon exports are distinct and correctly sized', () => {
  const manifests = ['customer', 'team'].map(app => JSON.parse(fs.readFileSync(path.join(root, 'apps', app, 'manifest.webmanifest'))));
  assert.notEqual(manifests[0].id, manifests[1].id); assert.notEqual(manifests[0].scope, manifests[1].scope);
  for (const app of ['customer', 'team']) for (const [icon, size] of [['icon-192',192],['icon-512',512],['maskable-512',512],['apple-touch-icon',180],['notification',96]]) {
    const png = fs.readFileSync(path.join(root, 'apps', app, 'icons', icon + '.png')); assert.equal(png.readUInt32BE(16), size); assert.equal(png.readUInt32BE(20), size);
  }
});
test('workers cache only their offline shell, leave writes/API alone, and do not remove the other app cache', async () => {
  for (const app of ['customer', 'team']) {
    const w = worker(app); w.caches.set(`fmrc-${app === 'team' ? 'customer' : 'team'}-offline-v1`, []);
    await w.event('install'); await w.event('activate'); assert.equal(w.caches.size, 2);
    const assets = w.caches.get(`fmrc-${app}-offline-v1`); assert.equal(assets.length, 3); assert(assets.every(url => /offline|icon-192/.test(url)));
    assert.equal(await w.event('fetch', { request: { method: 'POST', mode: 'navigate', url: `https://fmrc.example/apps/${app}/payment` } }), undefined);
    assert.equal(await w.event('fetch', { request: { method: 'GET', mode: 'cors', url: 'https://fmrc.example/api/customer/orders' } }), undefined);
    w.setOffline(); const result = await w.event('fetch', { request: { method: 'GET', mode: 'navigate', url: `https://fmrc.example/apps/${app}/home-page/main` } });
    assert.equal(result.offline, `/apps/${app}/offline.html`);
  }
});
test('push ignores old account bindings, separate app payloads and untrusted links; click remains in its app', async () => {
  const w = worker('customer');
  await w.event('message', { data: { type: 'binding', value: { user_id: 7, account_alerts: true, public_alerts: true } }, ports: [] });
  const push = data => w.event('push', { data: { json: () => data } });
  await push({ app: 'team', binding: 7, url: '/apps/team/' });
  await push({ app: 'customer', binding: 6, url: '/apps/customer/' });
  await push({ app: 'customer', binding: 7, url: 'https://evil.example/' });
  assert.equal(w.notifications.length, 0);
  await push({ app: 'customer', binding: 7, id: 9, kind: 'Order update', url: '/apps/customer/?notification=9', message: 'Private person and payment details' });
  assert.equal(w.notifications.length, 1); assert.equal(w.notifications[0].body, 'Order update. Open FMRC to view it.');
  assert(!JSON.stringify(w.notifications).includes('Private person'));
  await w.event('notificationclick', { notification: { close() {}, data: w.notifications[0].data } }); assert.equal(w.navigations[0], 'https://fmrc.example/apps/customer/?notification=9');
  await w.event('message', { data: { type: 'binding', value: { user_id: null, account_alerts: false, public_alerts: true } }, ports: [] });
  await push({ app: 'customer', binding: 7, id: 10, kind: 'Order update', url: '/apps/customer/' }); assert.equal(w.notifications.length, 1);
  await push({ app: 'customer', public: true, id: 11, kind: 'Announcement update', url: '/apps/customer/' }); assert.equal(w.notifications.length, 2);
});
