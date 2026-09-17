const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../..');
const source = fs.readFileSync(path.join(root, 'products-page/payment-availability.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'home-page/main.js'), 'utf8');
const names = ['Cash on Pickup', 'Cash on Delivery', 'GCash'];
const keys = ['payment_cash_on_pickup_enabled', 'payment_cash_on_delivery_enabled', 'payment_gcash_enabled'];

function element() {
  const listeners = {};
  const classes = new Set();
  return {
    dataset: {}, attrs: {}, listeners, value: '', hidden: false, disabled: false, textContent: '',
    classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); }, contains: (name) => classes.has(name) },
    setAttribute(name, value) { this.attrs[name] = value; },
    getAttribute(name) { return this.attrs[name]; },
    addEventListener(name, listener) { (listeners[name] ||= []).push(listener); },
    dispatchEvent(event) { for (const listener of listeners[event.type] || []) listener.call(this, event); },
    querySelectorAll() { return []; },
  };
}

function harness({ selector = false } = {}) {
  const fields = new Map();
  for (const id of ['hiddenPaymentSelect', 'tiktokPaymentList', 'checkoutPaymentNotice', 'checkoutPaymentMessage', 'checkoutPaymentRetry', 'submitOrderBtn']) fields.set(id, element());
  const cards = names.map((name) => { const item = element(); item.dataset.method = name; item.click = () => item.dispatchEvent({ type: 'click' }); return item; });
  fields.get('tiktokPaymentList').querySelectorAll = () => cards;
  const select = fields.get('hiddenPaymentSelect');
  select.options = ['', ...names].map((value) => ({ value, disabled: false }));
  const document = element();
  document.getElementById = (id) => fields.get(id) || null;
  document.querySelector = () => select;
  const context = vm.createContext({
    document, window: {}, Event: class { constructor(type) { this.type = type; } },
    localStorage: { getItem() { return null; } },
    renderCheckoutAddress() {}, renderGcashSection() {},
  });
  vm.runInContext(source, context);
  document.dispatchEvent({ type: 'DOMContentLoaded' });
  if (selector) {
    const start = main.indexOf('  const initTikTokPaymentMethods =');
    const end = main.indexOf('  initTikTokPaymentMethods();', start);
    assert.ok(start >= 0 && end > start);
    vm.runInContext(main.slice(start, end) + '\ninitTikTokPaymentMethods();', context);
  }
  const choose = (value) => { select.value = value; select.dispatchEvent({ type: 'change' }); };
  return { api: context.window.FMRC_PAYMENT_METHODS, context, fields, select, cards, choose };
}

test('checkout waits for settings and recovers after an initial load failure', () => {
  const h = harness();
  assert.equal(h.fields.get('submitOrderBtn').disabled, true);
  assert.equal(h.api.isEnabled(names[0]), false);
  assert.equal(h.cards[0].attrs['aria-disabled'], 'true');
  h.api.loadFailed();
  assert.equal(h.fields.get('checkoutPaymentRetry').hidden, false);
  assert.match(h.fields.get('checkoutPaymentMessage').textContent, /could not be loaded/);
  h.api.applySettings({});
  assert.equal(h.fields.get('checkoutPaymentRetry').hidden, true);
  h.choose(names[0]);
  assert.equal(h.fields.get('submitOrderBtn').disabled, false);
});

test('all eight availability combinations disable corresponding options and checkout when all are off', () => {
  for (let mask = 0; mask < 8; mask++) {
    const h = harness();
    h.api.applySettings(Object.fromEntries(keys.map((key, i) => [key, (mask >> i) & 1 ? '1' : '0'])));
    names.forEach((name, i) => {
      const enabled = Boolean((mask >> i) & 1);
      assert.equal(h.api.isEnabled(name), enabled);
      assert.equal(h.cards[i].hidden, !enabled);
      assert.equal(h.select.options[i + 1].disabled, !enabled);
      h.choose(name);
      assert.equal(h.fields.get('submitOrderBtn').disabled, !enabled);
      assert.equal(h.select.value, enabled ? name : '');
    });
    if (!mask) assert.match(h.fields.get('checkoutPaymentMessage').textContent, /Ordering is temporarily unavailable/);
  }
});

test('revoked selection clears without silently switching fulfillment method, then recovers on a new choice', () => {
  const h = harness();
  h.api.applySettings({});
  h.choose(names[0]);
  h.api.applySettings({ [keys[0]]: '0' });
  assert.equal(h.select.value, '');
  assert.equal(h.fields.get('submitOrderBtn').disabled, true);
  assert.match(h.fields.get('checkoutPaymentMessage').textContent, /Please choose another/);
  h.api.applySettings({});
  assert.equal(h.select.value, '', 'reenabling does not choose for the customer');
  h.choose(names[1]);
  assert.equal(h.fields.get('checkoutPaymentNotice').hidden, true);
  assert.equal(h.fields.get('submitOrderBtn').disabled, false);
});

test('settings polls cannot reenable a submitting checkout, and completion respects latest availability', () => {
  const h = harness();
  h.api.applySettings({});
  h.choose(names[0]);
  h.api.setSubmitting(true);
  h.api.applySettings({});
  assert.equal(h.fields.get('submitOrderBtn').disabled, true);
  assert.equal(h.cards[0].attrs['aria-disabled'], 'true');
  h.api.applySettings(Object.fromEntries(keys.map((key) => [key, '0'])));
  h.api.setSubmitting(false);
  assert.equal(h.fields.get('submitOrderBtn').disabled, true);
});

test('transient settings failure preserves disabled methods rather than reverting to defaults', () => {
  const h = harness();
  h.api.applySettings({ [keys[2]]: '0' });
  h.api.loadFailed();
  assert.equal(h.api.isEnabled('GCash'), false);
  assert.equal(h.cards[2].hidden, true);
});

test('real payment selector ignores disabled clicks and supports keyboard selection', () => {
  const h = harness({ selector: true });
  h.api.applySettings({ [keys[0]]: '0' });
  h.cards[0].click();
  assert.equal(h.select.value, '');
  h.cards[1].dispatchEvent({ type: 'keydown', key: 'Enter', target: h.cards[1], preventDefault() {} });
  assert.equal(h.select.value, names[1]);
  assert.equal(h.cards[1].attrs['aria-pressed'], 'true');
  h.api.setSubmitting(true);
  h.cards[0].click();
  assert.equal(h.select.value, names[1]);
});

test('settings requests coalesce, validate responses, recover and report failures to checkout', async () => {
  const start = main.indexOf('  let settingsRequest = null;');
  const end = main.indexOf('  let aboutVideoLoadingTimer', start);
  assert.ok(start >= 0 && end > start);
  let resolveFetch;
  let calls = 0;
  let failures = 0;
  let applies = 0;
  let response = { ok: true, text: async () => JSON.stringify({ data: { payment_gcash_enabled: '0' } }) };
  const context = vm.createContext({
    window: { FMRC_PAYMENT_METHODS: { loadFailed() { failures++; } } },
    AbortController, setTimeout, clearTimeout,
    _API: '/api', _settingsSnapshot: '',
    fetch() { calls++; return new Promise((resolve) => { resolveFetch = () => resolve(response); }); },
    applySettings() { applies++; },
  });
  vm.runInContext(main.slice(start, end), context);
  const refresh = context.window.FMRC_REFRESH_SITE_SETTINGS;
  const a = refresh();
  const b = refresh();
  assert.equal(a, b);
  resolveFetch();
  assert.equal(await a, true);
  assert.equal(calls, 1);
  assert.equal(applies, 1);
  response = { ok: false };
  const failed = refresh(); resolveFetch();
  assert.equal(await failed, false);
  assert.equal(failures, 1);
  response = { ok: true, text: async () => '{}' };
  const malformed = refresh(); resolveFetch();
  assert.equal(await malformed, false);
  assert.equal(applies, 1);
  response = { ok: true, text: async () => JSON.stringify({ data: {} }) };
  const recovery = refresh(); resolveFetch();
  assert.equal(await recovery, true);
  assert.equal(applies, 2);
});

function submitHarness() {
  const h = harness();
  h.api.applySettings({});
  h.choose(names[0]);
  const requests = [];
  const popups = [];
  Object.assign(h.context, {
    getCheckoutPaymentKey: () => 'COP',
    getSelectedFulfillmentType: () => 'pickup',
    getEffectiveCheckoutAddress: () => ({ name: 'Test Customer', phone_number: '09123456789' }),
    getCustomerToken: () => 'test-token',
    customerSession: {}, customerCheckoutProfile: {},
    currentCheckoutMode: 'single', currentCheckoutItems: [], currentProductId: 1,
    inputQty: { value: '1' }, checkoutGrandTotal: { innerText: '250.00' }, checkoutPrice: null,
    currentItemPrice: 250, checkoutTitle: { innerText: 'Test Product' }, checkoutImg: null,
    parsePrice: Number, API_BASE_URL: '/api',
    showCustomerPopup: async (message) => { popups.push(message); },
    fetchWithTimeout: async (url, options) => {
      requests.push({ url, options });
      return { ok: false, status: 422, json: async () => ({ code: 'payment_method_disabled', message: 'Method unavailable' }) };
    },
  });
  h.context.window.FMRC_REFRESH_SITE_SETTINGS = async () => true;
  const start = main.indexOf('  const submitOrderBtn = document.getElementById("submitOrderBtn");');
  const end = main.indexOf('  // SHOPPING CART & FLY-ANIMATION LOGIC', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(main.slice(start, end), h.context);
  const button = h.fields.get('submitOrderBtn');
  const submit = () => button.listeners.click[0].call(button, { preventDefault() {} });
  return { ...h, submit, requests, popups };
}

test('failed preflight and a revoked selection prevent any order POST', async () => {
  const h = submitHarness();
  h.context.window.FMRC_REFRESH_SITE_SETTINGS = async () => false;
  await h.submit();
  assert.equal(h.requests.length, 0);
  assert.match(h.popups[0], /could not confirm/);
  h.context.window.FMRC_REFRESH_SITE_SETTINGS = async () => {
    h.api.applySettings({ [keys[0]]: '0' });
    return true;
  };
  await h.submit();
  assert.equal(h.requests.length, 0);
  assert.equal(h.select.value, '');
  assert.equal(h.fields.get('submitOrderBtn').disabled, true);
});

test('duplicate clicks while preflight is pending send only one order, then server rejection clears stale selection', async () => {
  const h = submitHarness();
  let release;
  let refreshCount = 0;
  h.context.window.FMRC_REFRESH_SITE_SETTINGS = () => {
    refreshCount++;
    return refreshCount === 1 ? new Promise((resolve) => { release = resolve; }) : Promise.resolve(false);
  };
  const first = h.submit();
  await h.submit();
  assert.equal(refreshCount, 1);
  assert.equal(h.requests.length, 0);
  release(true);
  await first;
  assert.equal(h.requests.length, 1);
  assert.equal(JSON.parse(h.requests[0].options.body).payment_method, names[0]);
  assert.equal(refreshCount, 2, 'server rejection re-reads current availability');
  assert.equal(h.api.isEnabled(names[0]), false, 'denied method stays blocked even if refresh fails');
  assert.equal(h.select.value, '');
  assert.equal(h.fields.get('submitOrderBtn').disabled, true);
  assert.match(h.popups[0], /Method unavailable/);
});
