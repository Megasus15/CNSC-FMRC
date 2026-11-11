const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../../admin-page/orders.js'), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));

function setup(admin = true) {
  const fields = Object.fromEntries([
    'returnActionId', 'returnActionKind', 'returnActionNo', 'returnActionRequested',
    'returnDecisionSelect', 'returnResolutionSelect', 'returnApprovedAmount', 'returnDecisionNote',
    'returnReceivedNote', 'returnConfirmReceived', 'returnRefundStage', 'returnRefundMethod', 'returnRefundAmount',
    'returnRefundReference', 'returnRefundNote', 'returnActionTitle', 'returnActionSubtitle', 'btnSubmitReturnAction',
  ].map(name => {
    const wrapper = { style: {}, hint: { hidden: false }, querySelector() { return this.hint; } };
    const options = new Map();
    return [name, { value: '', checked: false, textContent: '', readOnly: false, wrapper, closest() { return wrapper; },
      querySelector(selector) { if (!options.has(selector)) options.set(selector, {textContent: ''}); return options.get(selector); } }];
  }));
  const sections = Object.entries({
    returnDecisionSelect: 'decision', returnResolutionSelect: 'decision', returnApprovedAmount: 'decision', returnDecisionNote: 'decision',
    returnConfirmReceived: 'receipt', returnReceivedNote: 'received', returnRefundStage: 'refund', returnRefundMethod: 'refund',
    returnRefundAmount: 'refund', returnRefundReference: 'refund', returnRefundNote: 'refund',
  }).map(([name, kind]) => ({ style: fields[name].wrapper.style, getAttribute: () => kind }));
  const modal = { dataset: {}, classList: { add() {}, remove() {} }, querySelectorAll: () => sections };
  const context = vm.createContext({
    ...fields, modalReturnAction: modal, crypto: { randomUUID: () => 'test-request-key' },
    canIssueOnlineRefund: () => admin, showPopup() {}, returnActionDiscardGuard: { capture() {} },
    returnStatusClass: ()=>'status-blue', returnStatusLabel: row=>row.status,
    formatMoney: amount => `PHP ${amount.toFixed(2)}`, escapeHtml: value => String(value),
  });
  vm.runInContext([
    section('  const renderReturnActionIcons =', '  const renderReturnsTable ='),
    section('  const renderReturnGuide =', '  const renderReturnDetailsBody ='),
    section('  const resolveReturnActionKind =', '  const closeReturnActionModal ='),
    section('  const RETURN_ACTION_COPY =', '  // Repaints an open Return Details modal'),
    'globalThis.flow = { openReturnActionModal, buildReturnActionRequest, renderReturnActionIcons, renderReturnGuide };',
  ].join('\n'), context);
  return { fields, modal, flow: context.flow };
}

const row = { id: 32, order_id: 80, resolution: 'replacement', status: 'item_received', requested_amount: 1, approved_amount: 1, can_decide: false, can_change_resolution: true, can_receive: false, can_refund: false, payment_is_automated: true };

test('Admin can open resolution review for an inspected replacement without offering a refund action', () => {
  const { flow, fields } = setup();
  const icons = flow.renderReturnGuide(row);
  assert.match(icons, /data-return-mode="resolution"/);
  assert.doesNotMatch(icons, /data-return-mode="refund"/);
  flow.openReturnActionModal(row, 'resolution');
  assert.equal(fields.returnActionKind.value, 'resolution');
  assert.equal(fields.returnResolutionSelect.value, 'replacement');
  assert.equal(fields.returnDecisionSelect.wrapper.style.display, 'none');
  assert.equal(fields.returnApprovedAmount.readOnly, true);
  assert.equal(fields.btnSubmitReturnAction.textContent, 'Save Resolution');
  assert.match(flow.buildReturnActionRequest('resolution').error, /reason/);
  fields.returnResolutionSelect.value = 'refund';
  fields.returnDecisionNote.value = 'Refund agreed.';
  const plan = flow.buildReturnActionRequest('resolution');
  assert.equal(plan.path, '/admin/returns/{id}/resolution');
  assert.equal(plan.body.resolution, 'refund');
  assert.equal(plan.body.expected_resolution, 'replacement');
  assert.equal(plan.body.issue, undefined);
  assert.equal(plan.body.amount, undefined);
});

test('Staff cannot open correction; initial review restores fields and submits chosen resolution', () => {
  assert.doesNotMatch(setup(false).flow.renderReturnGuide(row), /data-return-mode="resolution"/);
  const { flow, fields } = setup();
  flow.openReturnActionModal(row, 'resolution');
  flow.openReturnActionModal({ ...row, can_decide: true, status: 'requested' }, 'decision');
  assert.equal(fields.returnDecisionSelect.wrapper.style.display, '');
  assert.equal(fields.returnApprovedAmount.readOnly, false);
  assert.equal(fields.returnApprovedAmount.wrapper.hint.hidden, false);
  fields.returnResolutionSelect.value = 'refund';
  const plan = flow.buildReturnActionRequest('decision');
  assert.equal(plan.path, '/admin/returns/{id}/decision');
  assert.equal(plan.body.resolution, 'refund');
});

test('Only an approved refund resolution enables the provider action', () => {
  const { flow } = setup();
  assert.match(flow.renderReturnGuide({ ...row, resolution: 'refund', can_refund: true }), /data-return-mode="refund"/);
});

for (const admin of [true, false]) {
  test(`${admin ? 'Admin issues' : 'Staff requests'} receipt and refund through one action and one request`, () => {
    const { flow, fields, modal } = setup(admin);
    const combined = { ...row, resolution: 'refund', status: 'item_in_transit', can_receive: true, can_refund: true, requires_receipt: true, refund_available_amount: 1 };
    const icons = flow.renderReturnGuide(combined);
    assert.equal((icons.match(/data-return-mode="refund"/g) || []).length, 1);
    assert.doesNotMatch(icons, /data-return-mode="received"/);
    flow.openReturnActionModal(combined, 'received'); // Stale separate receipt action resolves to the combined form.
    assert.equal(fields.returnActionKind.value, 'refund');
    assert.equal(fields.returnConfirmReceived.wrapper.style.display, '');
    assert.equal(fields.returnReceivedNote.wrapper.style.display, '');
    assert.equal(fields.returnRefundStage.wrapper.style.display, 'none');
    assert.equal(fields.returnRefundMethod.wrapper.style.display, 'none');
    assert.equal(fields.returnRefundReference.wrapper.style.display, 'none');
    assert.match(fields.btnSubmitReturnAction.textContent, /Receive &/);
    assert.match(flow.buildReturnActionRequest('refund').error, /received and inspected/);
    fields.returnConfirmReceived.checked = true;
    fields.returnReceivedNote.value = 'Item inspected.';
    fields.returnRefundNote.value = 'Refund agreed.';
    const plan = flow.buildReturnActionRequest('refund');
    assert.equal(plan.path, '/admin/returns/{id}/refund');
    assert.equal(plan.body.confirm_received, true);
    assert.equal(plan.body.received_note, 'Item inspected.');
    assert.equal(plan.body.note, 'Refund agreed.');
    assert.equal(plan.body.issue, admin);
    assert.equal(plan.body.amount, 1);
    assert.equal(plan.body.request_key, modal.dataset.requestKey);
    assert.equal(flow.buildReturnActionRequest('refund').body.request_key, plan.body.request_key);
    assert.match(plan.confirmMessage, /Confirm receipt and inspection/);
    fields.returnRefundAmount.value = '2';
    assert.match(flow.buildReturnActionRequest('refund').error, /exceeds/);
  });
}

test('Received items need no second receipt; partial refunds use only the remaining amount', () => {
  const { flow, fields, modal } = setup();
  flow.openReturnActionModal({ ...row, resolution: 'refund', can_refund: true, requires_receipt: false, approved_amount: 10, requested_amount: 10, refund_available_amount: 4.5 }, 'refund');
  assert.equal(modal.dataset.confirmReceipt, '0');
  assert.equal(fields.returnConfirmReceived.wrapper.style.display, 'none');
  assert.equal(fields.returnReceivedNote.wrapper.style.display, 'none');
  assert.equal(fields.returnRefundAmount.value, '4.50');
  assert.equal(flow.buildReturnActionRequest('refund').body.confirm_received, false);
  assert.equal(fields.btnSubmitReturnAction.textContent, 'Issue refund');
});

test('An existing online refund has no second receive or refund action', () => {
  const { flow } = setup();
  const icons = flow.renderReturnGuide({ ...row, resolution: 'refund', status: 'refund_processing', can_refund: false, online_refund_pending: true });
  assert.doesNotMatch(icons, /data-return-mode="(?:received|refund)"/);
  assert.match(icons, /data-gateway-manage="80"/);
  assert.match(icons, /Waiting for the payment provider/);
});

test('Both portals provide the shared combined action confirmation field and current script', () => {
  for (const file of ['admin-page/orders.html', 'staff-page/orders.html']) {
    const html = fs.readFileSync(path.join(__dirname, '../../..', file), 'utf8');
    assert.equal((html.match(/id="returnConfirmReceived"/g) || []).length, 1);
    assert.match(html, /data-return-section="receipt"/);
    assert.match(html, /orders\.js\?v=\d/);
  }
});

test('Return table has one clear entry point; the guide preserves repair, claim, failure and closed branches', () => {
  const {flow}=setup();
  const table=flow.renderReturnActionIcons(row);
  assert.match(table,/Manage return/);assert.doesNotMatch(table,/data-return-mode/);
  const repaired=flow.renderReturnGuide({...row,resolution:'repair',status:'item_received'});
  assert.match(repaired,/agreed repair or rework/);assert.doesNotMatch(repaired,/data-return-mode="refund"/);
  const claim=flow.renderReturnGuide({...row,resolution:'refund',online_refund_pending:true,customer_claim_required:true});
  assert.match(claim,/secure refund claim/);assert.equal((claim.match(/data-gateway-manage/g)||[]).length,1);
  const failed=flow.renderReturnGuide({...row,resolution:'refund',online_refund_status:'failed',can_refund:true});
  assert.match(failed,/Review refund/);assert.doesNotMatch(failed,/data-return-mode="refund"/);
  for(const status of ['rejected','cancelled','refunded']){
    const closed=flow.renderReturnGuide({...row,status,can_change_resolution:false,can_refund:false,can_archive:true});
    assert.match(closed,/Archive return/);assert.doesNotMatch(closed,/data-return-mode/);
  }
});
