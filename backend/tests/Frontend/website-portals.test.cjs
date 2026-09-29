const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repo = path.resolve(__dirname, '../../..');
const editorSource = fs.readFileSync(path.join(repo, 'admin-page/website-portals.js'), 'utf8');
const appearanceSource = fs.readFileSync(path.join(repo, 'home-page/portal-appearance.js'), 'utf8');
const settle = () => new Promise(setImmediate);

function element(extra = {}) {
  const listeners = new Map();
  const attributes = new Map();
  const classes = new Set();
  const disabledWrites = [];
  let disabled = false;
  return Object.assign({
    value: '', textContent: '', innerHTML: '', hidden: true, checked: false,
    maxLength: -1, dataset: {}, style: {}, disabledWrites,
    get disabled() { return disabled; },
    set disabled(value) { disabled = value; disabledWrites.push(value); },
    classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) },
    setAttribute: (name, value) => attributes.set(name, value),
    getAttribute: (name) => attributes.get(name),
    addEventListener(name, listener) {
      const list = listeners.get(name) || [];
      list.push(listener);
      listeners.set(name, list);
    },
    emit(type, extraEvent = {}) {
      return Promise.all((listeners.get(type) || []).map((listener) => listener({
        type, target: this, preventDefault() {}, ...extraEvent,
      })));
    },
    click() { return this.emit('click'); },
    focus() {},
  }, extra);
}

async function harness(settings = {}, role = 'admin') {
  const elements = new Map();
  const field = (id) => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const names = ['brand_name', 'portal_name', 'university_name', 'image_kicker', 'image_title', 'image_description', 'center_name', 'image_position', 'overlay_opacity'];
  const controls = new Map(names.map((name) => [name, element({ name, type: name === 'overlay_opacity' ? 'range' : 'text' })]));
  const radios = ['left', 'right'].map((value) => element({ name: 'image_side', type: 'radio', value }));
  const allControls = [...controls.values(), ...radios];
  field('portalSettingsFields').querySelectorAll = (selector) => selector === '[name]' ? allControls : [];
  field('portalSettingsForm').reportValidity = () => true;
  const previewMarkers = new Map();
  field('portalPreview').querySelector = (selector) => {
    if (!previewMarkers.has(selector)) previewMarkers.set(selector, element());
    return previewMarkers.get(selector);
  };
  const tabs = ['customer', 'admin'].map((portal) => {
    const dirtyMarker = element();
    return element({ dataset: { portal }, querySelector: () => dirtyMarker });
  });
  const document = element({ hidden: false, getElementById: field });
  document.querySelectorAll = (selector) => selector === '.portal-tab' ? tabs : [];
  document.querySelector = (selector) => selector.startsWith('[data-counter=') ? field(selector) : null;
  const window = element({
    location: { protocol: 'https:', hostname: 'fmrc.test', origin: 'https://fmrc.test', port: '' },
    setTimeout, clearTimeout,
    AdminSession: { getToken: () => `${role}-token` },
    showAdminPopup() {},
    confirm: () => true,
  });
  const requests = [];
  const broadcasts = [];
  const storage = [];
  let channel;
  window.BroadcastChannel = class {
    constructor(name) { Object.assign(this, element()); this.name = name; channel = this; }
    postMessage(value) { broadcasts.push(value); }
  };
  const state = { settings: { ...settings }, holdGet: null };
  const fetch = async (url, options) => {
    const method = options.method || 'GET';
    requests.push({ url, method, options });
    if (method === 'PUT') {
      Object.assign(state.settings, JSON.parse(options.body));
      return { ok: true, status: 200, json: async () => ({ message: 'Saved' }) };
    }
    if (state.holdGet) await state.holdGet;
    return { ok: true, status: 200, json: async () => ({ data: state.settings }) };
  };
  const context = vm.createContext({
    window, document, fetch, URL, AbortController,
    localStorage: { getItem: () => '', setItem: (key, value) => storage.push({ key, value }) },
  });
  vm.runInContext(appearanceSource, context);
  // Appearance's DOM-marker contract has its own tests. This harness keeps its
  // real defaults/read/key behavior and records the editor's preview config.
  window.FMRC_PORTAL_APPEARANCE.apply = (_, config) => { field('portalPreview').config = { ...config }; };
  vm.runInContext(editorSource, context);
  await document.emit('DOMContentLoaded');
  await settle();
  const input = async (name, value) => {
    const control = controls.get(name);
    control.value = value;
    await control.emit('input');
  };
  const click = async (id) => { await field(id).emit('click'); await settle(); };
  const selectPortal = async (portal) => { await tabs.find((tab) => tab.dataset.portal === portal).emit('click'); };
  const save = async () => { await field('portalSettingsForm').emit('submit'); await settle(); };
  return { field, controls, window, document, requests, state, channel, broadcasts, storage, input, click, selectPortal, save };
}

test('initial load fetches once; returning to the tab leaves dirty controls and preview untouched', async () => {
  const h = await harness({ portal_customer_brand_name: 'Saved customer' });
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, 'https://fmrc.test/api/site-settings');
  assert.equal(h.field('portalSettingsFields').disabled, false);
  assert.equal(h.controls.get('brand_name').value, 'Saved customer');
  await h.input('brand_name', 'Customer draft');
  const writesBefore = h.field('portalSettingsFields').disabledWrites.length;
  const previewBefore = h.field('portalPreview').config;
  h.state.settings.portal_customer_brand_name = 'New remote customer';
  await h.window.emit('focus');
  h.document.hidden = true;
  await h.document.emit('visibilitychange');
  h.document.hidden = false;
  await h.document.emit('visibilitychange');
  await settle();
  assert.equal(h.requests.length, 1, 'Tab return cannot start a settings GET.');
  assert.equal(h.field('portalSettingsFields').disabledWrites.length, writesBefore, 'Tab return cannot toggle controls.');
  assert.equal(h.field('portalSettingsFields').disabled, false);
  assert.equal(h.controls.get('brand_name').value, 'Customer draft');
  assert.equal(h.field('portalPreview').config, previewBefore, 'Tab return cannot reset or rerender the preview.');
  assert.equal(h.field('savePortalSettings').disabled, false);
});

test('cross-tab notices mark both portals without fetching, disabling controls, or replacing drafts', async () => {
  const h = await harness();
  assert.equal(h.field('portalPreview').querySelector('.portal-preview-return').hidden, false, 'Customer preview retains its home link.');
  await h.input('brand_name', 'Customer draft');
  assert.equal(h.field('portalSettingsUpdated').hidden, true);
  const writesBefore = h.field('portalSettingsFields').disabledWrites.length;
  await h.window.emit('storage', { key: 'unrelated-key' });
  assert.equal(h.field('portalSettingsUpdated').hidden, true);
  await h.window.emit('storage', { key: 'fmrc_site_content_updated_at' });
  assert.equal(h.field('portalSettingsUpdated').hidden, false);
  await h.channel.emit('message', { data: { type: 'updated' } });
  await settle();
  assert.equal(h.requests.length, 1);
  assert.equal(h.controls.get('brand_name').value, 'Customer draft');
  assert.equal(h.field('portalSettingsFields').disabled, false);
  assert.equal(h.field('portalSettingsFields').disabledWrites.slice(writesBefore).includes(true), false);
  await h.selectPortal('admin');
  assert.equal(h.field('portalPreview').querySelector('.portal-preview-return').hidden, true, 'Admin / Staff preview has no home link.');
  assert.equal(h.field('portalSettingsUpdated').hidden, false);
  await h.selectPortal('customer');
  assert.equal(h.field('portalPreview').querySelector('.portal-preview-return').hidden, false);
  assert.equal(h.controls.get('brand_name').value, 'Customer draft');
});

test('manual Refresh fetches the latest settings while retaining each dirty portal draft', async () => {
  const h = await harness({ portal_customer_brand_name: 'Saved customer', portal_admin_brand_name: 'Saved admin' });
  await h.input('brand_name', 'Customer draft');
  await h.selectPortal('admin');
  await h.input('brand_name', 'Admin draft');
  await h.selectPortal('customer');
  h.state.settings.portal_customer_brand_name = 'Remote customer';
  h.state.settings.portal_admin_brand_name = 'Remote admin';
  let release;
  h.state.holdGet = new Promise((resolve) => { release = resolve; });
  const refreshing = h.click('refreshPortalSettings');
  assert.equal(h.requests.filter((request) => request.method === 'GET').length, 2);
  assert.equal(h.field('portalSettingsFields').disabled, true, 'Only explicit loading disables editing.');
  release();
  await refreshing;
  assert.equal(h.field('portalSettingsFields').disabled, false);
  assert.equal(h.controls.get('brand_name').value, 'Customer draft');
  assert.equal(h.field('portalSettingsUpdated').hidden, false);
  await h.selectPortal('admin');
  assert.equal(h.controls.get('brand_name').value, 'Admin draft');
  assert.equal(h.field('savePortalSettings').disabled, false);
});

for (const role of ['admin']) {
  test(`${role} saves only changed fields of the selected portal and preserves other drafts and remote copy`, async () => {
    const h = await harness({
      portal_customer_brand_name: 'Saved customer', portal_customer_image_description: 'Saved copy',
      portal_admin_brand_name: 'Saved admin', hero_title: 'Website hero',
    }, role);
    await h.input('brand_name', 'Customer draft');
    await h.selectPortal('admin');
    await h.input('brand_name', 'Admin draft');
    await h.selectPortal('customer');
    h.state.settings.portal_customer_image_description = 'Remote copy';
    await h.click('refreshPortalSettings');
    await h.save();
    const request = h.requests.find((item) => item.method === 'PUT');
    assert.equal(request.url, 'https://fmrc.test/api/admin/site-settings');
    assert.equal(request.options.headers.Authorization, `Bearer ${role}-token`);
    assert.deepEqual(JSON.parse(request.options.body), { portal_customer_brand_name: 'Customer draft' });
    assert.equal(h.state.settings.portal_admin_brand_name, 'Saved admin');
    assert.equal(h.state.settings.hero_title, 'Website hero');
    assert.equal(h.controls.get('image_description').value, 'Remote copy', 'Known remote edits merge after a partial save.');
    assert.equal(h.field('savePortalSettings').disabled, true);
    assert.equal(h.broadcasts.length, 1);
    assert.equal(h.storage[0].key, 'fmrc_site_content_updated_at');
    await h.selectPortal('admin');
    assert.equal(h.controls.get('brand_name').value, 'Admin draft');
    assert.equal(h.field('savePortalSettings').disabled, false);
    await h.save();
    const second = h.requests.filter((item) => item.method === 'PUT')[1];
    assert.deepEqual(JSON.parse(second.options.body), { portal_admin_brand_name: 'Admin draft' });
  });
}

test('docked save button remains associated with the Admin appearance form', () => {
  for (const portal of ['admin']) {
    const html = fs.readFileSync(path.join(repo, `${portal}-page/website-portals.html`), 'utf8');
    const button = html.match(/<button\b[^>]*\bid="savePortalSettings"[^>]*>/)?.[0];
    assert(button, `${portal} save button exists`);
    assert.match(button, /\btype="submit"/);
    assert.match(button, /\bform="portalSettingsForm"/, 'Docking the footer must not detach submission from its form.');
  }
});
