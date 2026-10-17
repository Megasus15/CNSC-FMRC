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
    'returnReceivedNote', 'returnRefundStage', 'returnRefundMethod', 'returnRefundAmount',
    'returnRefundReference', 'returnRefundNote', 'returnActionTitle', 'returnActionSubtitle', 'btnSubmitReturnAction',
  ].map(name => {
    const wrapper = { style: {}, hint: { hidden: false }, querySelector() { return this.hint; } };
    return [name, { value: '', textContent: '', readOnly: false, wrapper, closest() { return wrapper; } }];
  }));
  const sections = ['returnDecisionSelect', 'returnResolutionSelect', 'returnApprovedAmount', 'returnDecisionNote'].map(name => ({
    style: fields[name].wrapper.style, getAttribute: () => 'decision',
  }));
  const modal = { dataset: {}, classList: { add() {}, remove() {} }, querySelectorAll: () => sections };
  const context = vm.createContext({
    ...fields, modalReturnAction: modal, crypto: { randomUUID: () => 'test-request-key' },
    canIssueOnlineRefund: () => admin, showPopup() {}, returnActionDiscardGuard: { capture() {} },
    formatMoney: amount => `PHP ${amount.toFixed(2)}`, escapeHtml: value => String(value),
  });
  vm.runInContext([
    section('  const returnActionIcon =', '  const renderReturnsTable ='),
    section('  const resolveReturnActionKind =', '  const closeReturnActionModal ='),
    section('  const RETURN_ACTION_COPY =', '  // Repaints an open Return Details modal'),
    'globalThis.flow = { openReturnActionModal, buildReturnActionRequest, renderReturnActionIcons };',
  ].join('\n'), context);
  return { fields, modal, flow: context.flow };
}

const row = { id: 32, order_id: 80, resolution: 'replacement', status: 'item_received', requested_amount: 1, approved_amount: 1, can_decide: false, can_change_resolution: true, can_receive: false, can_refund: false, payment_is_automated: true };

test('Admin can open resolution review for an inspected replacement without offering a refund action', () => {
  const { flow, fields } = setup();
  const icons = flow.renderReturnActionIcons(row, 'RTN-32');
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
  assert.doesNotMatch(setup(false).flow.renderReturnActionIcons(row, 'RTN-32'), /data-return-mode="resolution"/);
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
  assert.match(flow.renderReturnActionIcons({ ...row, resolution: 'refund', can_refund: true }, 'RTN-32'), /data-return-mode="refund"/);
});
