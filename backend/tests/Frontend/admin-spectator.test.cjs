const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../../..');
const sessionSource = fs.readFileSync(path.join(root, 'admin-page/session-helper.js'), 'utf8');
const commonSource = fs.readFileSync(path.join(root, 'admin-page/admin-common.js'), 'utf8');
const spectatorSource = commonSource.slice(
  commonSource.indexOf('// Presentation accounts use the same pages'),
  commonSource.indexOf('// One image/video viewer'),
);

function harness(user = { role: 'admin', is_spectator: true }, portal = 'admin') {
  const storage = new Map([[`${portal}_user_info`, JSON.stringify(user)]]);
  const callbacks = new Map();
  const requests = [];
  const popups = [];
  const events = () => ({
    addEventListener(type, callback) {
      const list = callbacks.get(this) || new Map();
      const handlers = list.get(type) || [];
      handlers.push(callback); list.set(type, handlers); callbacks.set(this, list);
    },
    dispatchEvent(event) { for (const callback of callbacks.get(this)?.get(event.type) || []) callback(event); },
  });
  class Element {
    constructor(id, label, attributes = {}) { this.id = id; this.textContent = label; this.attributes = attributes; }
    getAttribute(name) { return this.attributes[name] || null; }
    matches(selector) {
      return selector.split(',').some(part => {
        const value = part.trim();
        if (value.startsWith('.')) return (this.attributes.class || '').split(' ').includes(value.slice(1));
        if (value === '[data-modal-open]') return this.attributes['data-modal-open'] != null;
        return value === '[type="submit"]' && this.attributes.type === 'submit';
      });
    }
    closest() { return this; }
  }
  const window = Object.assign(events(), {
    location: { pathname: `/${portal}-page/dashboard.html`, href: `https://fmrc.test/${portal}-page/dashboard.html` },
    fetch: async (input, init) => { requests.push({ input, init }); return { ok: true }; },
    showAdminPopup: (message, options) => popups.push({ message, options }),
  });
  const document = Object.assign(events(), { body: null });
  const context = vm.createContext({
    window, document, URL, Element,
    CustomEvent: class { constructor(type) { this.type = type; } },
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
  });
  vm.runInContext(sessionSource, context);
  vm.runInContext(spectatorSource, context);
  const click = (id, label, attributes) => {
    const event = { type: 'click', target: new Element(id, label, attributes), prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    document.dispatchEvent(event);
    return event;
  };
  return { window, document, requests, popups, storage, click };
}

test('spectator reads remain live; only logout and pure email preview POST pass through', async () => {
  const h = harness();
  for (const endpoint of ['/api/user', '/api/admin/orders', '/api/admin/reports?year=2026', '/api/admin/notifications']) {
    assert.equal((await h.window.fetch(endpoint)).ok, true);
  }
  await h.window.fetch('/api/logout', { method: 'POST' });
  await h.window.fetch('/api/admin/email-templates/preview', { method: 'POST' });
  assert.equal(h.requests.length, 6);
});

test('spectator mutations reject before a network call, including Request objects and overrides', async () => {
  const h = harness();
  const writes = [
    ['/api/admin/orders/1/tracking', { method: 'PATCH' }],
    ['/api/admin/products', { method: 'POST' }],
    ['/api/admin/site-settings', { method: 'PUT' }],
    ['/api/admin/archives/1', { method: 'DELETE' }],
    ['/api/admin/reports/generate', { method: 'POST' }],
    ['/api/admin/notifications/1/read', { method: 'PATCH' }],
    ['/api/admin/archives/auto-delete', { method: 'POST' }],
    [new Request('https://fmrc.test/api/admin/accounts', { method: 'POST' })],
    [new Request('https://fmrc.test/api/admin/products'), { method: 'DELETE' }],
    ['/api/logout/other', { method: 'POST' }],
    ['/api/admin/email-templates/preview/other', { method: 'POST' }],
  ];
  for (const args of writes) {
    await assert.rejects(h.window.fetch(...args), error => error.status === 403 && error.code === 'SPECTATOR_READ_ONLY');
  }
  assert.equal(h.requests.length, 0);
});

test('ordinary Admin and Staff mutations keep their original request and response', async () => {
  for (const role of ['admin', 'staff']) {
    const h = harness({ role }, role);
    const init = { method: 'POST', body: '{"name":"Unchanged"}' };
    assert.equal((await h.window.fetch('/api/admin/products', init)).ok, true);
    assert.equal(h.requests[0].init, init);
    assert.equal(h.click('saveChanges', 'Save changes').prevented, false);
  }
});

test('server profile refresh changes spectator behavior without changing the portal role', async () => {
  const h = harness({ role: 'admin' });
  assert.equal(h.window.AdminSession.isSpectator(), false);
  h.window.AdminSession.setUserInfo({ data: { role: 'admin', is_spectator: true } });
  assert.equal(h.window.AdminSession.isSpectator(), true);
  assert.equal(h.window.AdminSession.role, 'admin');
  await assert.rejects(h.window.fetch('/api/admin/accounts', { method: 'POST' }));
  h.window.AdminSession.setUserInfo({ role: 'admin', is_spectator: false });
  await h.window.fetch('/api/admin/accounts', { method: 'POST' });
  assert.equal(h.requests.length, 1);
});

test('spectator can open details, presentation forms, reports, calendar and logout; commits stop at capture', () => {
  const h = harness();
  const allowed = [
    ['btnOpenAddProduct', 'Add Product'], ['btnOpenEditFromView', 'Edit Product'],
    ['reportGenerateBtn', 'View Report'], ['reportLetterheadBtn', 'Edit Letterhead'],
    ['', 'Manage Calendar', { 'data-modal-open': '#modalCalendar' }],
    ['btnCancelDeleteProduct', 'Cancel'], ['', 'View Product'], ['', 'Log Out'],
    ['', 'Export CSV'], ['', 'Preview / Print'], ['', 'Refresh'],
  ];
  for (const args of allowed) assert.equal(h.click(...args).prevented, false, args[1]);
  const denied = [
    ['btnSaveProduct', 'Save Product'], ['btnCreateUser', 'Create Account', { type: 'submit' }],
    ['', '', { 'data-tooltip': 'Approve Order' }], ['', '', { 'data-tooltip': 'Delete User' }],
    ['', 'Restore Record'], ['', 'Mark as Done'], ['detailReplyBtn', 'Send Reply'],
    ['btnMarkPaymentPaid', 'Confirm payment received'], ['emailPendingCancelBtn', 'Cancel change'],
    ['recoveryGenerateBtn', 'Generate Codes'], ['', '', { class: 'notif-read-btn' }],
  ];
  for (const args of denied) {
    const event = h.click(...args);
    assert.equal(event.prevented, true, args[1] || JSON.stringify(args[2]));
    assert.equal(event.stopped, true);
  }
  assert.equal(h.popups.length, denied.length);
});

test('calendar reads identify spectators to the server and retain live slot data', async () => {
  const source = fs.readFileSync(path.join(root, 'admin-page/appointments.js'), 'utf8');
  const calendarSource = source.slice(source.indexOf('  const fetchCalendar = async'),
    source.indexOf('  const filteredAppointments ='));
  for (const spectator of [true, false]) {
    const requests = [];
    const state = { calendar: {} };
    const context = vm.createContext({
      window: { AdminSession: { isSpectator: () => spectator, getToken: () => 'presentation-token' } },
      API_BASE_URL: 'https://fmrc.test/api', state, defaultSlots: [],
      slotSortComparator: (a, b) => a.sort_order - b.sort_order,
      fetch: async (url, init) => {
        requests.push({ url, init });
        return { ok: true, json: async () => ({
          time_slots: [{ id: 7, label: 'Live slot', type: 'AM', sort_order: 1 }],
          day_settings: [{ date: '2026-09-22', is_blocked: true }],
        }) };
      },
    });
    await vm.runInContext(calendarSource + '\nfetchCalendar();', context);
    assert.equal(requests[0].init.headers.Authorization, spectator ? 'Bearer presentation-token' : undefined);
    assert.equal(state.calendar.time_slots[0].label, 'Live slot');
    assert.equal(state.calendar.day_settings['2026-09-22'].is_blocked, true);
  }
});
