const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Run the real renderer and async event handlers against a small DOM adapter.
// This specifically covers the regression where finally re-enabled every action.
const source = fs.readFileSync(path.join(__dirname, '../../../admin-page/orders.js'), 'utf8');
const section = source.slice(source.indexOf('  const paymentActionAllowed ='), source.indexOf('  // ── GCash collection details'));
const stateHelpers = source.slice(source.indexOf('  const mapOrderById ='), source.indexOf('  const populateOrderDetailsModal ='));
const ids = [...new Set(section.match(/\b(?:modalPayment\w+|modalRefund\w+|btnMarkPayment\w+|btnRecordRefund|btnCopyPaymentRef|modalOrderDetails)\b/g))];

function element() {
  const classes = new Set();
  return {
    dataset: {}, hidden: false, disabled: false, checked: false, value: '',
    textContent: '', innerHTML: 'Action', open: false,
    querySelector() { return this.child || null; },
    append(child) { this.child = child; },
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle: (name, on) => on ? classes.add(name) : classes.delete(name),
    },
    setAttribute(name, value) { this[name] = value; },
    removeAttribute(name) { delete this[name]; },
    addEventListener(name, callback) { this[name] = callback; },
    focus() { this.focused = true; },
  };
}

const actions = (paid = false, pending = false, refunded = false) => ({
  paid: { allowed: paid, reason: '' },
  pending: { allowed: pending, reason: '' },
  refunded: { allowed: refunded, reason: '' },
});
const order = (overrides = {}) => ({
  id: 1, order_no_display: '#TEST-1', lifecycle_status: 'incoming',
  customer_stage: 'to_pay', payment_method: 'GCash', payment_status: 'pending',
  payment_reference: '1234567890123', payment_under_review: true,
  payment_amount_label: 'PHP 250.00', total_amount: 250,
  payment_actions: actions(true), ...overrides,
});

function harness(initial = order()) {
  const calls = [];
  const popups = [];
  const elements = Object.fromEntries(ids.map((id) => [id, element()]));
  elements.modalOrderDetails.classList.add('show');
  const context = vm.createContext({
    ...elements, paymentActionBusy: false, paymentVerificationKey: '',
    state: { incoming: [initial], directory: [], ordersById: new Map([['1', initial]]) },
    normalizeStateOrdering() {}, refreshPaymentsFromDirectory() {}, renderAll() {},
    formatMoney: (amount) => `PHP ${Number(amount).toFixed(2)}`,
    resolveMediaUrl: (url) => url || '',
    window: { setTimeout }, navigator: {},
    document: { getElementById: (id) => elements[id] || null, createElement: element },
    showPopup: (message, options) => popups.push({ message, options }),
    askConfirm: async () => true,
    notifyOrdersRealtimeUpdate() {},
    request: async (url, options) => { calls.push({ url, options }); return {}; },
    populateOrderDetailsModal: (row) => context.renderPaymentVerification(row),
  });
  vm.runInContext(`${stateHelpers}\n${section}\nObject.assign(globalThis, { renderPaymentVerification, setPaymentStatus });`, context);
  context.renderPaymentVerification(initial);
  return { context, elements, calls, popups };
}

test('pending claim requires actual receipt acknowledgement and hides unrelated actions', () => {
  const { context, elements: ui } = harness();
  assert.equal(ui.btnMarkPaymentPaid.disabled, true);
  assert.equal(ui.modalPaymentCorrectionWrap.hidden, true);
  assert.equal(ui.modalPaymentRefundWrap.hidden, true);
  ui.modalPaymentAcknowledgement.checked = true;
  ui.modalPaymentAcknowledgement.change();
  assert.equal(ui.btnMarkPaymentPaid.disabled, false);
  context.renderPaymentVerification(order({ id: 2 }));
  assert.equal(ui.modalPaymentAcknowledgement.checked, false);
  assert.equal(ui.btnMarkPaymentPaid.disabled, true);
});

test('confirmation stays Incoming and finally does not unlock receive/refund on paid order', async () => {
  const { context, elements: ui, calls } = harness();
  const paid = order({ payment_status: 'paid', payment_actions: actions(false, true) });
  ui.modalPaymentAcknowledgement.checked = true;
  context.request = async (url, options) => {
    calls.push({ url, options });
    assert.equal(ui.btnMarkPaymentPaid.disabled, true);
    assert.equal(ui.btnMarkPaymentPending.disabled, true);
    assert.equal(ui.btnRecordRefund.disabled, true);
    assert.match(ui.btnMarkPaymentPaid.innerHTML, /Confirming/);
    return { order: paid };
  };
  await context.setPaymentStatus('paid');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.body.confirmed_received, true);
  assert.equal(calls[0].options.body.expected_status, 'pending');
  assert.equal(context.state.incoming.length, 1);
  assert.equal(context.state.directory.length, 0);
  assert.equal(ui.btnMarkPaymentPaid.disabled, true);
  assert.equal(ui.btnMarkPaymentPaid.hidden, true);
  assert.equal(ui.btnRecordRefund.disabled, true);
  assert.equal(ui.btnRecordRefund.hidden, true);
  assert.equal(ui.btnMarkPaymentPending.disabled, false);
  assert.match(ui.modalPaymentCustomerImpact.textContent, /stays in Incoming Orders/);
});

test('paid manual GCash without receipt is not mislabelled automated', () => {
  const { elements: ui } = harness(order({
    payment_status: 'paid', payment_reference: 'GCASH-5945-ABC123',
    payment_actions: actions(false, true), payment_is_automated: false,
  }));
  assert.equal(ui.modalPaymentCorrectionWrap.hidden, false);
  assert.doesNotMatch(ui.modalPaymentVerifyHint.textContent, /provider verified/);
  assert.equal(ui.modalPaymentProofEmpty.hidden, false);
});

test('correction needs a reason and returns to checkbox-gated verification', async () => {
  const { context, elements: ui, calls } = harness(order({
    payment_status: 'paid', payment_actions: actions(false, true),
  }));
  await context.setPaymentStatus('pending');
  assert.equal(calls.length, 0);
  assert.equal(ui.modalPaymentCorrectionReason.focused, true);
  ui.modalPaymentCorrectionReason.value = 'The incoming amount did not match.';
  context.request = async (url, options) => {
    calls.push({ url, options });
    return { order: order() };
  };
  await context.setPaymentStatus('pending');
  assert.equal(calls[0].options.body.correction_reason, 'The incoming amount did not match.');
  assert.equal(ui.btnMarkPaymentPaid.disabled, true);
  assert.equal(ui.btnMarkPaymentPaid.hidden, false);
  assert.equal(ui.btnMarkPaymentPending.disabled, true);
  assert.equal(ui.btnRecordRefund.disabled, true);
});

test('refund requires an outgoing reference and all actions remain locked after refund', async () => {
  const cancelled = order({ lifecycle_status: 'cancelled', is_cancelled: true,
    payment_status: 'paid', payment_actions: actions(false, false, true) });
  const { context, elements: ui, calls } = harness(cancelled);
  await context.setPaymentStatus('refunded');
  assert.equal(calls.length, 0);
  assert.equal(ui.modalRefundReference.focused, true);
  ui.modalRefundReference.value = 'REFUND-123';
  context.request = async (url, options) => {
    calls.push({ url, options });
    return { order: { ...cancelled, payment_status: 'refunded', payment_actions: actions(), payment_refund_reference: 'REFUND-123' } };
  };
  await context.setPaymentStatus('refunded');
  assert.equal(calls[0].options.body.refund_reference, 'REFUND-123');
  assert.equal(ui.btnMarkPaymentPaid.disabled, true);
  assert.equal(ui.btnMarkPaymentPending.disabled, true);
  assert.equal(ui.btnRecordRefund.disabled, true);
  assert.equal(ui.modalPaymentRefundWrap.hidden, true);
  assert.match(ui.modalPaymentVerifyHint.textContent, /REFUND-123/);
});

test('double click cannot queue another confirmation or request', async () => {
  const { context, elements: ui, calls } = harness();
  ui.modalPaymentAcknowledgement.checked = true;
  let finishConfirm;
  let confirmations = 0;
  context.askConfirm = () => { confirmations++; return new Promise((resolve) => { finishConfirm = resolve; }); };
  context.request = async (url, options) => {
    calls.push({ url, options });
    return { order: order({ payment_status: 'paid', payment_actions: actions(false, true) }) };
  };
  const first = context.setPaymentStatus('paid');
  await context.setPaymentStatus('paid');
  assert.equal(confirmations, 1);
  finishConfirm(true);
  await first;
  assert.equal(calls.length, 1);
});

test('cancelled confirmation restores only the currently eligible action', async () => {
  const { context, elements: ui, calls } = harness();
  ui.modalPaymentAcknowledgement.checked = true;
  context.askConfirm = async () => false;
  await context.setPaymentStatus('paid');
  assert.equal(calls.length, 0);
  assert.equal(ui.btnMarkPaymentPaid.disabled, false);
  assert.equal(ui.btnMarkPaymentPending.disabled, true);
  assert.equal(ui.btnRecordRefund.disabled, true);
});

test('ambiguous save failure reloads server payment state before restoring actions', async () => {
  const { context, elements: ui, calls } = harness();
  ui.modalPaymentAcknowledgement.checked = true;
  context.request = async (url, options) => {
    calls.push({ url, options });
    if (options?.method === 'PATCH') throw new Error('Timed out');
    return { data: order({ payment_status: 'paid', payment_actions: actions(false, true) }) };
  };
  await context.setPaymentStatus('paid');
  assert.equal(calls.length, 2);
  assert.equal(ui.btnMarkPaymentPaid.disabled, true);
  assert.equal(ui.btnMarkPaymentPending.disabled, false);
  assert.equal(ui.btnRecordRefund.disabled, true);
});

test('unreachable refresh fails closed instead of permitting a duplicate financial record', async () => {
  const { context, elements: ui } = harness();
  ui.modalPaymentAcknowledgement.checked = true;
  context.request = async () => { throw new Error('Offline'); };
  await context.setPaymentStatus('paid');
  assert.equal(ui.btnMarkPaymentPaid.disabled, true);
  assert.equal(ui.btnMarkPaymentPending.disabled, true);
  assert.equal(ui.btnRecordRefund.disabled, true);
  assert.match(ui.modalPaymentVerifyHint.textContent, /Refresh this order/);
});

test('forbidden action stays blocked even if invoked directly', async () => {
  const { context, calls } = harness();
  await context.setPaymentStatus('refunded');
  await context.setPaymentStatus('pending');
  assert.equal(calls.length, 0);
});

test('cash confirmation uses collection wording and hides GCash proof', () => {
  const { elements: ui } = harness(order({ payment_method: 'Cash on Pickup', payment_reference: '' }));
  assert.match(ui.modalPaymentAcknowledgementText.textContent, /collected the full PHP 250.00 in cash/);
  assert.equal(ui.modalPaymentProofWrap.hidden, true);
  assert.equal(ui.btnCopyPaymentRef.hidden, true);
});

test('changed reference invalidates an earlier acknowledgement before any request', async () => {
  const { context, elements: ui, calls } = harness();
  ui.modalPaymentAcknowledgement.checked = true;
  context.state.ordersById.set('1', order({ payment_reference: '9876543210123' }));
  await context.setPaymentStatus('paid');
  assert.equal(calls.length, 0);
  assert.equal(ui.modalPaymentAcknowledgement.checked, false);
  assert.equal(ui.btnMarkPaymentPaid.disabled, true);
  assert.equal(ui.modalPaymentClaimRef.textContent, '9876543210123');
});

test('unavailable provider/manual action displays its server reason', () => {
  const blocked = order({ payment_is_automated: true, payment_actions: actions() });
  blocked.payment_actions.paid.reason = 'This payment is managed by the payment provider.';
  const { elements: ui } = harness(blocked);
  assert.match(ui.modalPaymentVerifyHint.textContent, /managed by the payment provider/);
  assert.equal(ui.modalPaymentConfirmWrap.hidden, true);
});

test('rejected provider payment exposes refund management and closes order details when followed', () => {
  const { elements: ui } = harness(order({payment_is_automated:true,lifecycle_status:'rejected',payment_status:'paid',payment_refund_status:'requested',payment_actions:actions()}));
  assert.match(ui.modalPaymentVerifyHint.textContent,/Admin must approve/);
  assert.equal(ui.modalPaymentVerifyStatus.textContent,'Refund awaiting approval');
  const button=ui.modalPaymentVerifyBlock.child;
  assert.equal(button.hidden,false); assert.equal(button.dataset.gatewayManage,'1');
  assert.equal(button.className,'btn-admin btn-secondary gateway-order-action');
  assert.equal(button.textContent,'Payment & refund details');
  button.click(); assert.equal(ui.modalOrderDetails.classList.contains('show'),false);
});

test('provider payment with a pending cancellation leads to its review', () => {
  const { elements: ui } = harness(order({payment_is_automated:true,cancel_pending:true,payment_status:'paid',payment_actions:actions()}));
  const button=ui.modalPaymentVerifyBlock.child;
  assert.equal(button.className,'btn-admin btn-secondary gateway-order-action');
  assert.equal(button.textContent,'Review customer cancellation');
  assert.equal(button.dataset.cancellationReview,'1');
  assert.equal(button.dataset.gatewayManage,undefined);
  assert.equal(ui.modalPaymentProofWrap.hidden,true);
  button.click(); assert.equal(ui.modalOrderDetails.classList.contains('show'),false);
});

test('product-return refund plan distinguishes direct Admin issue from Staff approval', () => {
  const planSource=source.slice(source.indexOf('  const buildReturnActionRequest ='),source.indexOf('  // Repaints an open Return Details modal'));
  for(const role of ['admin','staff']){
    const context=vm.createContext({
      canIssueOnlineRefund:()=>role==='admin',
      returnRefundMethod:{value:'gcash'},returnRefundStage:{value:'released'},returnRefundAmount:{value:'250.00'},
      returnRefundNote:{value:'Returned item inspected'},returnActionCeilingAmount:250,
      modalReturnAction:{dataset:{gateway:'1',requestKey:'fixture-key'}},formatMoney:amount=>`PHP ${amount.toFixed(2)}`,
    });
    vm.runInContext(planSource+'\nglobalThis.plan=buildReturnActionRequest("refund");',context);
    assert.equal(context.plan.body.issue,role==='admin');
    assert.equal(context.plan.confirmText,role==='admin'?'Issue refund':'Request refund');
    assert.equal(context.plan.path,'/admin/returns/{id}/refund');
    if(role==='admin')assert.match(context.plan.confirmMessage,/directly to PayMongo.*claim form/);
    else assert.match(context.plan.confirmMessage,/Admin must approve/);
  }
});
