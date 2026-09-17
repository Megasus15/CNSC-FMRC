const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../..');
const source = fs.readFileSync(path.join(root, 'admin-page/website-payments.js'), 'utf8');
const keys = ['payment_cash_on_pickup_enabled', 'payment_cash_on_delivery_enabled', 'payment_gcash_enabled'];
const settle = () => new Promise((resolve) => setImmediate(resolve));

function element() {
  const listeners = new Map();
  const classes = new Set();
  return {
    checked: false, disabled: false, hidden: true, textContent: '', innerHTML: '',
    classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); } },
    setAttribute() {},
    addEventListener(name, fn) { const list = listeners.get(name) || []; list.push(fn); listeners.set(name, list); },
    emit(type, extra = {}) { return Promise.all((listeners.get(type) || []).map((fn) => fn({ type, target: this, preventDefault() {}, ...extra }))); },
  };
}

async function harness(settings = {}, role = 'admin', initialFailure = false) {
  const fields = new Map();
  const field = (id) => { if (!fields.has(id)) fields.set(id, element()); return fields.get(id); };
  const document = element();
  document.getElementById = field;
  document.querySelector = () => null;
  const window = element();
  window.location = { protocol: 'https:', hostname: 'fmrc.test', origin: 'https://fmrc.test', port: '' };
  window.AdminSession = { getToken: () => `${role}-token` };
  const requests = [];
  const broadcasts = [];
  const storage = [];
  let channel;
  window.BroadcastChannel = class {
    constructor() { Object.assign(this, element()); channel = this; }
    postMessage(value) { broadcasts.push(value); }
  };
  const state = { settings, failGet: initialFailure, putStatus: 200, holdPut: null };
  const fetch = async (url, options) => {
    requests.push({ url, options });
    if (options.method === 'PUT') {
      if (state.holdPut) await state.holdPut;
      if (state.putStatus === 200) state.settings = JSON.parse(options.body);
      return { ok: state.putStatus === 200, status: state.putStatus, json: async () => ({ message: 'Save failed' }) };
    }
    if (state.failGet) throw new Error('Network unavailable');
    return { ok: true, status: 200, json: async () => ({ data: state.settings }) };
  };
  vm.runInNewContext(source, {
    window, document, fetch, AbortController, setTimeout, clearTimeout,
    localStorage: { getItem: () => '', setItem: (key, value) => storage.push({ key, value }) },
  });
  await document.emit('DOMContentLoaded');
  await settle();
  const click = async (id) => { await field(id).emit('click'); await settle(); };
  const toggle = async (key, checked) => { field(key).checked = checked; await field(key).emit('change'); };
  const save = () => field('paymentSettingsForm').emit('submit');
  return { field, window, document, state, requests, broadcasts, storage, channel, click, toggle, save };
}

for (const role of ['admin', 'staff']) {
  test(`${role} can save individual or all methods using the portal session, with no draft-only writes`, async () => {
    const h = await harness({}, role);
    keys.forEach((key) => assert.equal(h.field(key).checked, true));
    assert.equal(h.field('savePaymentSettings').disabled, true);
    await h.click('disableAllPayments');
    assert.equal(h.requests.length, 1, 'bulk action only edits the draft');
    keys.forEach((key) => assert.equal(h.field(key).checked, false));
    assert.match(h.field('paymentSettingsNoteTitle').textContent, /Saving will pause/);
    await h.save();
    const request = h.requests.find((item) => item.options.method === 'PUT');
    assert.equal(request.url, 'https://fmrc.test/api/admin/site-settings');
    assert.equal(request.options.headers.Authorization, `Bearer ${role}-token`);
    assert.deepEqual(JSON.parse(request.options.body), Object.fromEntries(keys.map((key) => [key, '0'])));
    assert.equal(h.field('savePaymentSettings').disabled, true);
    assert.match(h.field('paymentSettingsNoteTitle').textContent, /orders are paused/);
    assert.equal(h.broadcasts.length, 1);
    assert.equal(h.storage[0].key, 'fmrc_site_content_updated_at');
    await h.toggle(keys[2], true);
    await h.save();
    assert.equal(h.state.settings[keys[2]], '1');
    assert.equal(h.state.settings[keys[0]], '0');
    await h.click('enableAllPayments');
    await h.save();
    keys.forEach((key) => assert.equal(h.state.settings[key], '1'));
    await h.window.emit('focus');
    await settle();
    keys.forEach((key) => assert.equal(h.field(key).checked, true));
  });
}

test('background refresh preserves a dirty draft and Load latest intentionally replaces it', async () => {
  const h = await harness();
  await h.toggle(keys[0], false);
  h.state.settings = { [keys[1]]: '0' };
  await h.channel.emit('message');
  await settle();
  assert.equal(h.field(keys[0]).checked, false);
  assert.equal(h.field(keys[1]).checked, true);
  assert.equal(h.field('paymentSettingsUpdated').hidden, false);
  await h.click('reloadPaymentSettings');
  assert.equal(h.field(keys[0]).checked, true);
  assert.equal(h.field(keys[1]).checked, false);
  assert.equal(h.field('savePaymentSettings').disabled, true);
  assert.equal(h.field('paymentSettingsUpdated').hidden, true);
});

test('save failure retains selections, and discard returns to persisted settings', async () => {
  const h = await harness();
  await h.click('disableAllPayments');
  h.state.putStatus = 403;
  await h.save();
  keys.forEach((key) => assert.equal(h.field(key).checked, false));
  assert.equal(h.field('savePaymentSettings').disabled, false);
  assert.equal(h.field('paymentSettingsError').hidden, false);
  assert.match(h.field('paymentSettingsErrorText').textContent, /cannot update/);
  assert.equal(h.broadcasts.length, 0);
  await h.click('discardPaymentSettings');
  keys.forEach((key) => assert.equal(h.field(key).checked, true));
  assert.equal(h.field('savePaymentSettings').disabled, true);
});

test('initial fetch failure keeps editing disabled until Retry succeeds', async () => {
  const h = await harness({}, 'staff', true);
  assert.equal(h.field('paymentSettingsFields').disabled, true);
  assert.equal(h.field('savePaymentSettings').disabled, true);
  assert.equal(h.field('retryPaymentSettings').hidden, false);
  h.state.failGet = false;
  await h.click('retryPaymentSettings');
  assert.equal(h.field('paymentSettingsFields').disabled, false);
  assert.equal(h.field('paymentSettingsError').hidden, true);
});

test('save in flight blocks duplicate writes and keeps switches disabled during queued refresh', async () => {
  const h = await harness();
  await h.click('disableAllPayments');
  let release;
  h.state.holdPut = new Promise((resolve) => { release = resolve; });
  const saving = h.save();
  assert.equal(h.field('paymentSettingsFields').disabled, true);
  await h.save();
  await h.window.emit('focus');
  assert.equal(h.requests.filter((item) => item.options.method === 'PUT').length, 1);
  release();
  await saving;
  await settle();
  assert.equal(h.field('paymentSettingsFields').disabled, false);
  keys.forEach((key) => assert.equal(h.field(key).checked, false));
});

test('only missing settings default enabled; saved false values do not', async () => {
  const h = await harness({ [keys[0]]: null, [keys[1]]: '', [keys[2]]: '0' });
  keys.forEach((key) => assert.equal(h.field(key).checked, false));
});

test('unsaved changes warn before leaving; saved state does not', async () => {
  const h = await harness();
  let warnings = 0;
  const event = { preventDefault() { warnings++; } };
  await h.window.emit('beforeunload', event);
  assert.equal(warnings, 0);
  await h.toggle(keys[2], false);
  await h.window.emit('beforeunload', event);
  assert.equal(warnings, 1);
  await h.save();
  await h.window.emit('beforeunload', event);
  assert.equal(warnings, 1);
});
