const test = require('node:test');
const assert = require('node:assert/strict');
const {browserFixture, chrome} = require('./helpers/website-browser.cjs');

test('Orders retain label-free cancellation/refund filters and filter walk-ins before pagination', {skip: !chrome, timeout: 150000}, async t => {
  const refundReads = [];
  const walkins = Array.from({length: 21}, (_, index) => ({
    id: index + 1, order_no: 'WI-' + String(index + 1).padStart(3, '0'),
    customer_name: index === 20 ? 'Unique client' : 'Client ' + (index + 1),
    status: index === 20 ? 'Cancelled' : index % 2 ? 'Completed' : 'Pending',
    project_description: '3D PRINTING', total: 100, subtotal_cost: 100,
  }));
  const h = await browserFixture(t, async ({req, route, json}) => {
    const params = new URL(req.url, 'http://fixture.test').searchParams;
    if (route === '/api/admin/walkin-orders') { json({data: walkins}); return true; }
    if (route === '/api/admin/orders') {
      json({incoming: [], directory: [{id: 99, order_no: 'ORD-99', customer_name: 'Cancellation client', cancel_state: 'requested', cancel_pending: true, cancel_reason: 'Changed plans', payment_status: 'unpaid', total_amount: 100}], payments: [], returns: []}); return true;
    }
    if (route === '/api/admin/gateway-payments') {
      refundReads.push(Object.fromEntries(params));
      json({payments: {data: [], current_page: 1, last_page: 1, total: 0}, refunds: [], attempts: [], receipts: []}); return true;
    }
    return false;
  });
  const setField = (selector, value, event = 'input') => h.run(`(() => {
    const field = document.querySelector(${JSON.stringify(selector)});
    field.focus(); field.value = ${JSON.stringify(value)};
    field.dispatchEvent(new Event(${JSON.stringify(event)}, {bubbles: true}));
  })()`);
  const noVisibleLabels = selector => h.run(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).every(label =>
    Array.from(label.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).every(node => !node.textContent.trim()) &&
    !!label.querySelector('[aria-label]'))`);
  const checkLayout = async (portal, section, tools) => {
    for (const width of [1440, 960, 390]) {
      await h.send('Emulation.setDeviceMetricsOverride', {width, height: 1000, deviceScaleFactor: 1, mobile: width === 390});
      await h.pause(350);
      await h.run(`document.querySelector('${section} .panel').scrollIntoView({block: 'start', behavior: 'instant'})`);
      const geometry = await h.run(`(() => {
        const header = document.querySelector('${section} .panel-header');
        const controls = [...header.querySelectorAll('${tools} input, ${tools} select, ${tools} button')].filter(node => node.getBoundingClientRect().width);
        const rect = header.getBoundingClientRect();
        return {fits: controls.every(node => {const r = node.getBoundingClientRect(); return r.left >= Math.max(0, rect.left) - 1 && r.right <= Math.min(innerWidth, rect.right) + 1;}),
          right: Math.abs(rect.right - Math.max(...controls.map(node => node.getBoundingClientRect().right))),
          overflow: document.documentElement.scrollWidth > innerWidth + 1};
      })()`);
      assert(geometry.fits && !geometry.overflow, portal + ' ' + section + ' fits at ' + width);
      assert(geometry.right < 2, portal + ' ' + section + ' controls align right at ' + width);
      for (const theme of ['light', 'dark']) {
        await h.run(`document.documentElement.dataset.theme = '${theme}'`);
        await h.pause(350);
        await h.shot(portal + '-' + section.slice(1) + '-' + width + '-' + theme);
      }
    }
    await h.send('Emulation.setDeviceMetricsOverride', {width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false});
    await h.run("document.documentElement.dataset.theme = 'light'");
  };
  for (const portal of ['admin-page', 'staff-page']) {
    const base = portal === 'staff-page' ? '/apps/team/staff-page/' : '/admin-page/';
    await h.send('Emulation.setDeviceMetricsOverride', {width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false});
    await h.go(base + 'orders.html');
    await h.until("!!document.querySelector('[data-cancel-search]') && !document.querySelector('#ordersModuleTabs').closest('[inert]')");
    assert.equal(await h.run("document.querySelectorAll('#ordersModuleTabs > button').length"), 5);
    await h.run("document.querySelector('[data-tab=cancellations]').click()");
    await h.until("!document.getElementById('sectionCancellations').hidden && !!document.querySelector('[data-cancelapprove]')");
    assert(await noVisibleLabels('#sectionCancellations .gateway-toolbar label'));
    await setField('[data-cancel-search]', 'missing');
    await h.until("!!document.querySelector('#orderCancellationsTable .table-empty-state')");
    await setField('[data-cancel-search]', 'Cancellation client');
    await h.until("!!document.querySelector('[data-cancelapprove]')");
    await checkLayout(portal, '#sectionCancellations', '.gateway-toolbar');

    await h.run("document.querySelector('[data-tab=refunds]').click()");
    await h.until("!document.getElementById('sectionRefunds').hidden && !!document.querySelector('#gatewayPaymentsTable .table-empty-state')");
    assert(await noVisibleLabels('#sectionRefunds .gateway-toolbar label'));
    await setField('[data-gateway-search]', 'Order 99');
    await setField('[data-gateway-status-filter]', 'succeeded', 'change');
    for (let i = 0; i < 100 && !refundReads.some(params => params.search === 'Order 99' && params.refund_status === 'succeeded'); i++) await h.pause(50);
    assert(refundReads.some(params => params.search === 'Order 99' && params.refund_status === 'succeeded'));
    await checkLayout(portal, '#sectionRefunds', '.gateway-toolbar');

    await h.run("document.querySelector('[data-tab=walkin]').click()");
    await h.until("document.querySelector('#walkInOrdersFooter .table-footer-meta').textContent === 'Page 1 of 3 • Showing 1–10 of 21'");
    await h.run("document.querySelector('#walkInOrdersFooter .page-btn:last-child').click()");
    await h.until("document.querySelector('#walkInOrdersFooter .table-footer-meta').textContent.startsWith('Page 2 of 3')");
    await setField('#walkInOrdersSearch', 'Unique');
    await h.until("document.querySelector('#walkInOrdersFooter .table-footer-meta').textContent === 'Page 1 of 1 • Showing 1–1 of 1'");
    assert(await h.run("document.activeElement.id === 'walkInOrdersSearch'"));
    assert(await h.run("!!document.querySelector('#walkInOrdersTable [data-walkin-view=\"21\"]')"));
    await setField('#walkInOrdersStatusFilter', 'completed', 'change');
    await h.until("document.querySelector('#walkInOrdersFooter .table-footer-meta').textContent === 'Page 1 of 1 • Showing 0–0 of 0'");
    await setField('#walkInOrdersSearch', '');
    await h.until("document.querySelector('#walkInOrdersFooter .table-footer-meta').textContent === 'Page 1 of 1 • Showing 1–10 of 10'");
    assert(await h.run("document.querySelector('#walkInOrdersFooter .page-btn:last-child').disabled"));
    await setField('#walkInOrdersStatusFilter', 'pending', 'change');
    await h.until("document.querySelector('#walkInOrdersTable tbody tr:first-child').textContent.includes('Pending')");
    await setField('#walkInOrdersStatusFilter', 'all', 'change');
    await setField('#walkInOrdersSearch', 'client');
    await h.until("document.querySelector('#walkInOrdersFooter .table-footer-meta').textContent === 'Page 1 of 3 • Showing 1–10 of 21'");
    await h.run("const field = document.querySelector('#walkInOrdersFooter .page-number');field.value = 3;field.dispatchEvent(new Event('change', {bubbles: true}))");
    await h.until("document.querySelector('#walkInOrdersFooter .table-footer-meta').textContent === 'Page 3 of 3 • Showing 21–21 of 21'");
    assert(await h.run("!!document.querySelector('#walkInOrdersTable [data-walkin-view=\"1\"]')"), 'page input follows the existing newest-first record order');
    await checkLayout(portal, '#sectionWalkin', '.filters-row');
    assert.deepEqual(await h.run('fixtureErrors'), []);
  }
  t.diagnostic('Orders control screenshots: ' + h.artifacts);
});
