const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../../../admin-page/orders.js'), 'utf8');
const readSection = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a);
  return source.slice(a, b);
};
const helpers = readSection('  const rejectedOrderWorkspace =', '  // Directory and record counts');
const cells = readSection('  const renderPaymentMethodCell =', '  const renderIncomingTable =');
const renderers = readSection('  const renderRejectedTable =', '  // Returns arrive whole');
const order = (id, overrides = {}) => ({ id, order_no: 'ORDER-' + id, lifecycle_status: 'rejected', payment_status: 'pending', payment_method: 'COP', ...overrides });

function harness(rows = []) {
  const events = [], rendered = [], scrolls = [];
  let recordsClicks = 0;
  const panel = { hidden: true, scrollIntoView() { scrolls.push('manual'); } };
  const context = vm.createContext({
    state: { directory: rows, rejectedPage: 1, manualRefundsPage: 1 },
    manualRefundsPanel: panel, manualRefundsTbody: {}, manualRefundsFooter: {},
    rejectedOrdersTbody: {}, rejectedOrdersFooter: {}, rejectedBulkController: { sync() {} }, PAGE_SIZE: 10,
    escapeHtml: value => String(value ?? '').replaceAll('<', '&lt;'),
    formatDateShort: () => 'Oct 17, 2026', formatMoney: value => 'PHP ' + Number(value || 0).toFixed(2),
    renderPagedRows(config) { rendered.push({ rows: config.rows, html: config.rows.map(config.renderRow).join('') }); return 1; },
    window: { dispatchEvent: event => events.push(event) },
    document: { querySelector: () => ({ click() { recordsClicks++; } }), getElementById: () => ({ scrollIntoView() { scrolls.push('rejected'); } }) },
    CustomEvent: class { constructor(type, { detail }) { this.type = type; this.detail = detail; } },
  });
  vm.runInContext(helpers + cells + renderers + '\nObject.assign(globalThis,{rejectedOrderWorkspace,getRejectedRows,getManualRefundRows,followRejectedOrders,renderRejectedTable,renderManualRefundsTable,renderPaymentMethodCell});', context);
  return { context, events, rendered, panel, scrolls, recordsClicks: () => recordsClicks };
}

test('rejected, online refund and manual refund rows are mutually exclusive across payment methods', () => {
  const rows = [
    order(1), order(2, { payment_method: 'COD' }), order(3, { payment_method: 'GCash', payment_is_automated: true }),
    order(4, { payment_method: 'GCash', payment_is_automated: true, payment_status: 'paid', payment_refund_status: 'requested' }),
    order(5, { payment_method: 'GCash', payment_is_automated: true, payment_status: 'refunded' }),
    order(6, { payment_status: 'paid' }), order(7, { payment_status: 'paid', payment_method: 'COD' }),
    order(8, { payment_status: 'paid', payment_method: 'GCash' }), order(9, { payment_status: 'refunded' }),
    order(10, { payment_method: 'GCash', payment_reference_supplied: true }),
    order(11, { lifecycle_status: 'incoming' }),
  ];
  const h = harness(rows);
  assert.deepEqual(Array.from(h.context.getRejectedRows(), r => r.id), [1, 2, 3]);
  assert.deepEqual(Array.from(h.context.getManualRefundRows(), r => r.id), [6, 7, 8, 9, 10]);
  assert.equal(h.context.rejectedOrderWorkspace(rows[3]), 'online_refunds');
  assert.equal(h.context.rejectedOrderWorkspace(rows[4]), 'online_refunds');
  assert.equal(h.context.rejectedOrderWorkspace(rows[10]), null);
  h.context.renderRejectedTable(); h.context.renderManualRefundsTable();
  assert.deepEqual(h.rendered.map(r => Array.from(r.rows, x => x.id)), [[1, 2, 3], [6, 7, 8, 9, 10]]);
  assert.match(h.rendered[1].html, /Refund due/); assert.match(h.rendered[1].html, /Verify payment/);
  assert.doesNotMatch(h.rendered[1].html, /data-gateway-manage|data-rejected-archive|data-admin-bulk-row/);
  assert.equal(h.panel.hidden, false);
});

test('provider refund requests stay out of rejected rows through failure, processing and confirmation', () => {
  for (const state of ['requested', 'processing', 'needs_review', 'succeeded']) {
    const h = harness([order(1, { payment_method: 'GCash', payment_is_automated: true, payment_status: 'paid', payment_refund_status: state })]);
    assert.equal(h.context.getRejectedRows().length, 0); assert.equal(h.context.getManualRefundRows().length, 0);
  }
  const h = harness(); h.context.renderManualRefundsTable(); assert.equal(h.panel.hidden, true);
});

test('rejection follows the appropriate queue without issuing a refund', () => {
  const h = harness();
  const paid = order(1, { payment_status: 'paid', payment_is_automated: true });
  h.context.followRejectedOrders([paid]);
  assert.equal(h.events[0].type, 'fmrc:open-online-refunds'); assert.equal(h.events[0].detail.orderNo, 'ORDER-1');
  h.context.followRejectedOrders([paid, { ...paid, id: 2 }]); assert.equal(h.events[1].detail.orderNo, '');
  h.context.followRejectedOrders([order(3, { payment_status: 'paid' })]);
  h.context.followRejectedOrders([order(4)]);
  assert.equal(h.recordsClicks(), 2); assert.deepEqual(h.scrolls, ['manual', 'rejected']);
});

test('rejected unpaid orders never invite a new payment', () => {
  const h = harness();
  for (const method of ['COP', 'COD', 'GCash']) {
    const html = h.context.renderPaymentMethodCell(order(1, { payment_method: method, payment_is_automated: method === 'GCash' }));
    assert.doesNotMatch(html, /Awaiting payment|Pay at counter|Pay on delivery/);
    assert.match(html, /No (?:payment received|cash collected)/);
  }
});

test('zero value paid flags do not create a refund obligation', () => {
  const h = harness();
  for (const method of ['COP', 'COD', 'GCash']) {
    const zero = order(1, {
      payment_method: method, payment_status: 'paid', payment_is_automated: method === 'GCash',
      payment_amount: 0, total_amount: 0,
    });
    assert.equal(h.context.rejectedOrderWorkspace(zero), 'rejected');
    assert.match(h.context.renderPaymentMethodCell(zero), /No payment required/);
    assert.doesNotMatch(h.context.renderPaymentMethodCell(zero), /Manage refund|\(Paid\)/);
  }
});
