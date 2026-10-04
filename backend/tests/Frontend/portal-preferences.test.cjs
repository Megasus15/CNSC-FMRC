const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../..');
const source = fs.readFileSync(path.join(root, 'admin-page/dark-mode.js'), 'utf8');
const workspaceDefaults = { sidebarWidth:270,sidebarLabel:'UCN-FMRC',sidebarLogo:'' };

function harness({ id = 11, role = 'admin', pathname = `/${role}-page/settings.html`, storage = new Map(), failed = false, deferReads = false, legacyWorkspace = false } = {}) {
  const events = new Map(), docEvents = new Map(), media = new Map(), requests = [];
  const servers = new Map(), plugins = [], deferred = [];
  storage.set(`${role}_user_info`, JSON.stringify({ id, role }));
  storage.set(`${role}_auth_token`, `fixture-${id}`);
  const on = (map, name, fn) => map.set(name, [...(map.get(name) || []), fn]);
  const status = { textContent: '' };
  const document = { documentElement: { dataset: {},style:{setProperty() {}} }, hidden: false,
    querySelector: () => null, querySelectorAll: () => [],
    getElementById: name => name === 'settingsSaveStatus' ? status : null,
    addEventListener: (name, fn) => on(docEvents, name, fn) };
  const location = { pathname, origin: 'https://fixture.test', protocol: 'https:', hostname: 'fixture.test', port: '' };
  const window = { location, Chart: { defaults: {}, instances: {}, register: plugin => plugins.push(plugin) },
    matchMedia: name => { const item = { matches: false, addEventListener: (_, fn) => { item.change = fn; } }; media.set(name, item); return item; },
    addEventListener: (name, fn) => on(events, name, fn), dispatchEvent: event => (events.get(event.type) || []).forEach(fn => fn(event)) };
  const context = { window, document, location, setInterval() {},
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => { if (failed) throw Error('quota'); storage.set(key, value); } },
    fetch: async (url, options) => { const owner = Number(options.headers.Authorization.split('-').at(-1)); requests.push({ owner, method: options.method });
      if (failed) throw Error('offline');
      if (options.method === 'PUT') { const values = JSON.parse(options.body); servers.set(owner, legacyWorkspace ? {theme:values.theme,compact:values.compact,reducedMotion:values.reducedMotion} : values); }
      const response = { ok: true, json: async () => ({ user_id: owner, preferences: servers.get(owner) || { theme: 'light', compact: false, reducedMotion: false } }) };
      if (deferReads && options.method === 'GET') {
        const snapshot = await response.json();
        return new Promise(resolve => deferred.push(() => resolve({ ok:true, json:async () => snapshot })));
      }
      return response; },
  };
  vm.runInNewContext(source, context);
  return { window, document, storage, media, status, requests, plugins, servers,
    fire: (name, event = {}) => (events.get(name) || []).forEach(fn => fn(event)),
    ready: () => (docEvents.get('DOMContentLoaded') || []).forEach(fn => fn()),
    reconnect: () => { failed = false; (events.get('online') || []).forEach(fn => fn()); },
    upgrade: () => { legacyWorkspace = false; (events.get('online') || []).forEach(fn => fn()); },
    releaseReads: () => deferred.splice(0).forEach(resolve => resolve()),
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('an older deployed API cannot acknowledge or erase sidebar settings it did not save', async () => {
  const h = harness({legacyWorkspace:true});
  h.window.AdminPreferences.set({sidebarWidth:220,sidebarLabel:'My workspace'}); await settle();
  assert.equal(h.window.AdminPreferences.get().sidebarWidth,220);
  assert.equal(JSON.parse(h.storage.get('fmrc-portal-preferences:user:11'))._pending,true);
  assert.match(h.status.textContent,/Account sync is temporarily unavailable/);
  h.upgrade(); await settle();
  assert.equal(h.servers.get(11).sidebarWidth,220);
  assert.match(h.status.textContent,/Saved to your account/);
  const key = 'fmrc-portal-preferences:user:11';
  const cached = harness({legacyWorkspace:true,storage:new Map([[key,JSON.stringify({theme:'light',compact:false,reducedMotion:false,...workspaceDefaults,sidebarWidth:220})]])});
  cached.ready(); await settle();
  assert.equal(cached.window.AdminPreferences.get().sidebarWidth,220);
  assert.equal(JSON.parse(cached.storage.get(key))._pending,true);
});

test('an older server read cannot overwrite a newer same-account tab edit before its storage event arrives', async () => {
  const cacheKey = 'fmrc-portal-preferences:user:11';
  const storage = new Map([[cacheKey, JSON.stringify({ theme:'dark',compact:false,reducedMotion:false,_pending:false })]]);
  const h = harness({ storage, deferReads:true });
  h.servers.set(11,{theme:'dark',compact:false,reducedMotion:false});
  h.ready(); await settle();
  storage.set(cacheKey,JSON.stringify({theme:'light',compact:true,reducedMotion:false,_pending:true}));
  h.releaseReads(); await settle();
  assert.equal(h.document.documentElement.dataset.theme,'light');
  assert.equal(h.window.AdminPreferences.get().compact,true);
  assert.equal(JSON.parse(storage.get(cacheKey))._pending,true);
});

test('preferences persist to the current account, isolate Admin and two Staff accounts, and never consume the old shared theme', async () => {
  const storage = new Map([['admin-theme', 'dark']]);
  const admin = harness({ storage });
  assert.equal(admin.document.documentElement.dataset.theme, 'light');
  admin.window.AdminPreferences.set({ theme: 'dark', compact: true });
  await settle();
  assert.equal(admin.servers.get(11).theme, 'dark');
  assert.match(admin.status.textContent, /Saved to your account/);
  const staff = harness({ storage, role: 'staff', id: 22 });
  assert.equal(staff.document.documentElement.dataset.theme, 'light');
  staff.window.AdminPreferences.set({ theme: 'light' }); await settle();
  const otherStaff = harness({ storage, role: 'staff', id: 33 });
  assert.equal(otherStaff.window.AdminPreferences.get().theme, 'light');
  assert.equal(JSON.parse(storage.get('fmrc-portal-preferences:user:11')).theme, 'dark');
});

test('OS appearance and reduced motion apply immediately; explicit light ignores OS dark', () => {
  const h = harness();
  const scheme = h.media.get('(prefers-color-scheme: dark)');
  scheme.matches = true; scheme.change();
  assert.equal(h.document.documentElement.dataset.theme, 'light', 'new accounts start Light even when the device uses Dark');
  h.window.AdminPreferences.set({theme:'system'});
  assert.equal(h.document.documentElement.dataset.theme, 'dark');
  h.window.AdminPreferences.set({ theme: 'light', reducedMotion: true });
  assert.equal(h.document.documentElement.dataset.theme, 'light');
  assert.equal(h.document.documentElement.dataset.portalMotion, 'reduced');
});

test('same-account storage events update live pages; another account cannot affect the current theme', () => {
  const h = harness();
  h.storage.set('fmrc-portal-preferences:user:22', JSON.stringify({ theme: 'dark' }));
  h.fire('storage', { key: 'fmrc-portal-preferences:user:22' });
  assert.equal(h.document.documentElement.dataset.theme, 'light');
  h.storage.set('fmrc-portal-preferences:user:11', JSON.stringify({ theme: 'dark', compact: true }));
  h.fire('storage', { key: 'fmrc-portal-preferences:user:11' });
  assert.equal(h.document.documentElement.dataset.theme, 'dark');
  assert.equal(h.document.documentElement.dataset.tableDensity, 'compact');
});

test('account switching immediately resets the old account theme and uses only the new cache', () => {
  const h = harness({ role: 'staff', id: 22 });
  h.window.AdminPreferences.set({ theme: 'dark' });
  h.storage.set('staff_user_info', JSON.stringify({ id: 33, role: 'staff' }));
  h.storage.set('staff_auth_token', 'fixture-33');
  h.fire('storage', { key: 'staff_user_info' });
  assert.equal(h.document.documentElement.dataset.theme, 'light');
});

test('offline storage failure leaves controls usable and never claims the account was saved', async () => {
  const h = harness({ failed: true });
  h.window.AdminPreferences.set({ theme: 'dark' }); await settle();
  assert.equal(h.document.documentElement.dataset.theme, 'dark');
  assert.match(h.status.textContent, /have not been saved/);
  h.reconnect(); await settle();
  assert.equal(h.servers.get(11).theme, 'dark');
  assert.match(h.status.textContent, /Saved to your account/);
});

test('rapid settings changes persist the final appearance and display preferences together', async () => {
  const h = harness();
  h.window.AdminPreferences.set({ theme: 'dark' });
  h.window.AdminPreferences.set({ compact: true });
  h.window.AdminPreferences.set({ reducedMotion: true });
  await settle();
  assert.deepEqual(h.servers.get(11), { theme:'dark',compact:true,reducedMotion:true,...workspaceDefaults });
  h.window.AdminPreferences.reset(); await settle();
  assert.deepEqual(h.servers.get(11), { theme:'light',compact:false,reducedMotion:false,...workspaceDefaults });
});

test('chart plugin themes future charts and existing charts change without animation', async () => {
  const h = harness(); h.ready(); await settle();
  assert.equal(h.plugins.length, 1);
  const chart = { options: { scales: { x: { ticks: {}, grid: {} } }, plugins: { tooltip: {} } }, update: value => { chart.updated = value; } };
  h.window.Chart.instances.sample = chart;
  h.window.AdminPreferences.set({ theme: 'dark' });
  assert.equal(chart.options.scales.x.ticks.color, '#b7bdc9');
  assert.equal(chart.updated, 'none');
  const future = { options: { scales: { y: { ticks: {}, grid: {} } } } };
  h.plugins[0].beforeUpdate(future);
  assert.equal(future.options.scales.y.grid.color, '#343944');
  chart.options.animation = { duration: 400 };
  h.window.AdminPreferences.set({ reducedMotion: true });
  assert.equal(chart.options.animation, false);
  h.plugins[0].beforeUpdate(future);
  assert.equal(future.options.animation, false);
  h.window.AdminPreferences.set({ reducedMotion: false });
  assert.equal(chart.options.animation.duration, 400);
});

test('login portals and public previews never initialize the portal theme', () => {
  for (const pathname of ['/admin-auth/auth.html', '/customer-auth/auth.html', '/admin-page/maintenance-preview.html']) {
    const h = harness({ pathname });
    assert.equal(h.window.AdminPreferences, undefined);
    assert.equal(h.document.documentElement.dataset.theme, undefined);
  }
});

test('every authenticated page shares the sidebar; My Account precedes Settings and settings contains the only appearance controls', () => {
  let count = 0;
  for (const folder of ['admin-page', 'staff-page']) for (const file of fs.readdirSync(path.join(root, folder)).filter(f => f.endsWith('.html') && f !== 'maintenance-preview.html')) {
    const html = fs.readFileSync(path.join(root, folder, file), 'utf8');
    count++;
    assert(html.includes('class="admin-dashboard-icon"'), `${folder}/${file}: consistent modern dashboard icon`);
    assert.equal((html.match(/dark-mode\.css/g) || []).length, 1, `${folder}/${file}`);
    assert.equal((html.match(/portal-sidebar\.js/g) || []).length,1,`${folder}/${file}: shared resize controller`);
    assert.equal((html.match(/portal-sidebar\.css/g) || []).length,1,`${folder}/${file}: final sidebar styles`);
    assert(html.indexOf('dark-mode.css') > html.lastIndexOf('</style>'), `${file}: theme wins inline styles`);
    for (const section of ['sidebar-nav', 'profile-popup']) {
      const start = html.indexOf(`class="${section}`), end = section === 'sidebar-nav' ? html.indexOf('</nav>', start) : html.indexOf('<hr', start);
      const contents = html.slice(start, end);
      assert(contents.indexOf('href="my-account.html"') < contents.indexOf('href="settings.html"'), `${folder}/${file}: ${section} ordering`);
    }
    if (file !== 'settings.html') assert(!html.includes('name="portalTheme"'));
  }
  assert.equal(count, 39);
  assert(!fs.readFileSync(path.join(root, 'admin-auth/auth.html'), 'utf8').includes('dark-mode'));
});

test('sidebar preferences are account-scoped, clamped, and reset with the rest of the workspace',async()=>{
  const storage = new Map();const admin=harness({storage});
  admin.window.AdminPreferences.set({sidebarWidth:76,sidebarLabel:'My Workshop',sidebarLogo:'javascript:alert(1)'});
  await settle();assert.equal(admin.servers.get(11).sidebarWidth,76);assert.equal(admin.servers.get(11).sidebarLogo,'');
  assert.equal(admin.document.documentElement.dataset.sidebarMode,'rail');
  const staff=harness({storage,id:22,role:'staff'});assert.equal(staff.window.AdminPreferences.get().sidebarLabel,'UCN-FMRC');
  admin.window.AdminPreferences.set({sidebarWidth:999,sidebarLabel:'A title that is far too long'});await settle();
  assert.equal(admin.window.AdminPreferences.get().sidebarWidth,270);assert.equal(admin.window.AdminPreferences.get().sidebarLabel.length,18);
  admin.window.AdminPreferences.reset();await settle();assert.equal(admin.window.AdminPreferences.get().sidebarLabel,'UCN-FMRC');
});
