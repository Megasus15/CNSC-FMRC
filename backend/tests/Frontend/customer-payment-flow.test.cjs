const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Execute the shared customer's real state helpers, pay panel and poll handler.
// The small DOM adapter verifies decisions and async races, not visual layout.
const source = fs.readFileSync(path.join(__dirname, '../../../home-page/main.js'), 'utf8');
function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing source section: ${start}`);
  return source.slice(from, to);
}
const helpers = section('  const formatOrderCurrency =', '  const buildGoogleMapEmbedUrl =');
const statuses = section('      const resolveOrderStatusMeta =', '      const renderStarsRow =');
const payPanel = section('      const openGcashPayPanel =', '      const submitGcashPayment =');
const refresh = section('      const refreshOrders = async', '      tabs.forEach((tab, index) =>');

function element() {
  const classes = new Set(['show']);
  const listeners = new Map();
  return {
    dataset: {}, style: {}, innerHTML: '', textContent: '', value: '', files: [],
    disabled: false, hidden: false,
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle: (name, on) => on ? classes.add(name) : classes.delete(name),
    },
    addEventListener(name, callback) { listeners.set(name, callback); },
    dispatchEvent(event) { return listeners.get(event.type)?.(event); },
    focus() {},
    remove() { this.removed = true; },
  };
}

const order = (overrides = {}) => ({
  id: 1, lifecycle_status: 'incoming', customer_stage: 'to_pay',
  payment_status: 'pending', payment_method: 'GCash',
  awaiting_customer_payment: true, payment_under_review: false,
  payment_is_confirmed: false, payment_is_refunded: false,
  total_amount: 250, total_label: 'PHP 250.00', ...overrides,
});
const claim = (overrides = {}) => order({
  awaiting_customer_payment: false, payment_under_review: true,
  payment_reference: '1234567890123', ...overrides,
});
const paid = (overrides = {}) => order({
  payment_status: 'paid', payment_is_confirmed: true,
  awaiting_customer_payment: false, ...overrides,
});

function harness(initial = order()) {
  const fields = new Map();
  for (const key of ['#cgcReferenceInput', '#cgcProofInput', '[data-gcash-error]',
    '[data-gcash-file-name]', '[data-gcash-submit]', '[data-gcash-submit-label]']) {
    fields.set(key, element());
  }
  fields.get('#cgcReferenceInput').value = '1234567890123';
  fields.get('[data-gcash-submit-label]').textContent = 'Submit';
  const overlay = element();
  overlay.dataset.orderId = '1';
  overlay.querySelector = (selector) => fields.get(selector);
  const popups = [];
  const resolved = [];
  const document = {
    body: { style: { overflow: 'hidden' }, appendChild() {} },
    addEventListener() {}, removeEventListener() {},
    createElement: () => overlay,
    querySelectorAll: () => [overlay],
  };
  const context = vm.createContext({
    document, navigator: {},
    window: { clearTimeout() {}, setTimeout() {} },
    setTimeout() {}, requestAnimationFrame: (callback) => callback(),
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    ORDER_STAGE_FLOW: ['to_pay', 'to_ship', 'to_receive', 'completed'],
    GCASH_REF_DIGITS: 13,
    CUSTOMER_ORDERS_MIN_REFRESH_GAP_MS: 1200,
    escapeHtml: (value) => String(value),
    formatOrderDate: (value) => String(value),
    readGcashSettings: () => ({ accountNumber: '09123456789', accountName: 'FMRC' }),
    describePaymentDeadline: () => null,
    renderGcashHowToPay: (_, amount) => `Send ${amount}`,
    showCustomerPopup: (message, options) => popups.push({ message, ...options }),
    submitGcashPayment: async () => null,
    state: { token: 'test', lastRefreshAt: 0, orders: [initial], returns: [], etag: '' },
    fetchCustomerOrders: async () => ({ orders: [initial], etag: 'updated' }),
    writeCustomerOrdersCache() {}, renderOrders() {}, setSyncStatus() {},
    refreshActiveDetail() {}, refreshActiveReturnDetail() {}, handleSessionExpired() {},
    tabs: [], panels: [],
  });
  vm.runInContext(`${helpers}\n${statuses}\n${payPanel}\n${refresh}\nObject.assign(globalThis, {
    canSubmitOrderPayment, resolveOrderPaymentNotice, resolveOrderStatusMeta,
    isOrderAwaitingApproval, openGcashPayPanel, wireGcashPayPanel, refreshOrders,
  });`, context);
  const wire = () => context.wireGcashPayPanel(overlay, initial, (value) => resolved.push(value));
  const update = (latest) => overlay.dispatchEvent({ type: 'fmrc:payment-state-updated', detail: latest });
  const submit = () => overlay.dispatchEvent({
    type: 'click', target: { closest: (selector) => selector === '[data-gcash-submit]' ? fields.get(selector) : null },
  });
  return { context, overlay, fields, popups, resolved, wire, update, submit };
}

test('unpaid and submitted GCash claim distinguish sending payment from review', () => {
  const { context: ui } = harness();
  assert.equal(ui.canSubmitOrderPayment(order()), true);
  assert.equal(ui.resolveOrderPaymentNotice(order()).label, 'Awaiting payment');
  assert.equal(ui.canSubmitOrderPayment(claim()), true, 'reference correction remains available');
  assert.equal(ui.resolveOrderStatusMeta(claim()).label, 'Under Review');
  assert.match(ui.resolveOrderPaymentNotice(claim()).note, /Do not send another payment/);
});

test('payment confirmation stays awaiting approval, and approved orders advance separately', () => {
  const { context: ui } = harness();
  assert.equal(ui.canSubmitOrderPayment(paid()), false);
  assert.equal(ui.resolveOrderStatusMeta(paid()).label, 'Awaiting approval');
  assert.match(ui.resolveOrderPaymentNotice(paid()).note, /awaiting staff approval/);
  const approved = paid({ lifecycle_status: 'pending', customer_stage: 'to_ship', customer_stage_label: 'Preparing for pickup' });
  assert.equal(ui.isOrderAwaitingApproval(approved), false);
  assert.equal(ui.canSubmitOrderPayment(approved), false);
  assert.equal(ui.resolveOrderStatusMeta(approved).label, 'Preparing for pickup');
  assert.doesNotMatch(ui.resolveOrderPaymentNotice(approved).note, /awaiting staff approval/);
});

test('undo confirmation restores claim review without instructing a second payment', () => {
  const { context: ui } = harness();
  const undone = claim({ lifecycle_status: 'pending' });
  assert.equal(ui.canSubmitOrderPayment(undone), true);
  assert.equal(ui.resolveOrderStatusMeta(undone).label, 'Under Review');
  assert.match(ui.resolveOrderPaymentNotice(undone).note, /Do not send another payment/);
});

test('refunded and closed orders reject stale pay flags and explain their final state', () => {
  const { context: ui } = harness();
  const refunded = order({ payment_status: 'refunded', payment_is_refunded: true, payment_refund_reference: 'REFUND-1' });
  assert.equal(ui.canSubmitOrderPayment(refunded), false);
  assert.equal(ui.resolveOrderPaymentNotice(refunded).label, 'Payment refunded');
  assert.match(ui.resolveOrderPaymentNotice(refunded).note, /REFUND-1.*No further payment is needed/);
  for (const lifecycle_status of ['cancelled', 'rejected', 'completed']) {
    assert.equal(ui.canSubmitOrderPayment(claim({ lifecycle_status })), false);
  }
  const cancelled = paid({ lifecycle_status: 'cancelled', cancel_refund_due: true });
  assert.match(ui.resolveOrderPaymentNotice(cancelled).note, /still needs to return your payment/);
});

test('cash orders await collection without exposing the GCash submission flow', () => {
  const { context: ui } = harness();
  const cash = order({ payment_method: 'Cash', awaiting_customer_payment: false });
  assert.equal(ui.canSubmitOrderPayment(cash), false);
  assert.equal(ui.resolveOrderPaymentNotice(cash).label, 'Awaiting payment collection');
});

test('provider payments reject stale manual pay flags and prevent duplicate payment instructions', () => {
  const { context: ui } = harness();
  const automated = claim({ payment_is_automated: true, awaiting_customer_payment: true });
  assert.equal(ui.canSubmitOrderPayment(automated), false);
  assert.equal(ui.resolveOrderPaymentNotice(automated).label, 'Payment with provider');
  assert.equal(ui.resolveOrderStatusMeta(automated).label, 'Payment with provider');
  assert.match(ui.resolveOrderPaymentNotice(automated).note, /Do not send a separate manual payment/);
});

test('GCash panel displays and copies the payment amount, falling back for older payloads', () => {
  const { context, overlay } = harness();
  context.openGcashPayPanel(order({ payment_amount: 175, payment_amount_label: 'PHP 175.00' }));
  assert.match(overlay.innerHTML, /cgc-amount-value">PHP 175\.00</);
  assert.match(overlay.innerHTML, /data-gcash-copy="175\.00"/);
  context.openGcashPayPanel(order({ payment_amount: 175 }));
  assert.match(overlay.innerHTML, /cgc-amount-value">₱175\.00</);
  context.openGcashPayPanel(order());
  assert.match(overlay.innerHTML, /cgc-amount-value">PHP 250\.00</);
  assert.match(overlay.innerHTML, /data-gcash-copy="250\.00"/);
});

test('live order refresh closes an open pay panel immediately when staff confirm payment', async () => {
  const { context, overlay, popups, resolved, wire } = harness();
  wire();
  context.fetchCustomerOrders = async () => ({ orders: [paid()], etag: 'paid' });
  await context.refreshOrders(false, true);
  assert.equal(overlay.classList.contains('show'), false);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0], null);
  assert.equal(popups[0].title, 'Payment confirmed');
  assert.match(popups[0].message, /awaiting staff approval/);
});

for (const outcome of ['rejected', 'older success']) {
  test(`payment confirmation received during ${outcome} submission still closes stale instructions`, async () => {
    const { context, fields, overlay, popups, resolved, wire, update, submit } = harness();
    wire();
    let complete;
    context.submitGcashPayment = () => new Promise((resolve) => { complete = resolve; });
    const pending = submit();
    assert.equal(fields.get('[data-gcash-submit]').disabled, true);
    update(paid());
    assert.equal(resolved.length, 0, 'waits for the in-flight submission to settle');
    complete(outcome === 'rejected' ? null : claim());
    await pending;
    assert.equal(overlay.classList.contains('show'), false);
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0], null, 'does not overwrite the fresh paid order with an older claim response');
    assert.equal(popups[0].title, 'Payment confirmed');
  });
}

test('ordinary failed claim submission restores the button and keeps correction available', async () => {
  const { fields, overlay, popups, resolved, wire, submit } = harness();
  wire();
  await submit();
  assert.equal(fields.get('[data-gcash-submit]').disabled, false);
  assert.equal(fields.get('[data-gcash-submit-label]').textContent, 'Submit');
  assert.equal(overlay.classList.contains('show'), true);
  assert.equal(popups.length, 0);
  assert.equal(resolved.length, 0);
});
