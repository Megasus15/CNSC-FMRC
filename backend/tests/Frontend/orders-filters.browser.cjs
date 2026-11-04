const test = require('node:test');
const assert = require('node:assert/strict');
const {browserFixture, chrome} = require('./helpers/website-browser.cjs');

test('Orders retain label-free filters and filter walk-ins before pagination in both portals', {skip: !chrome, timeout: 150000}, async t => {
  const customReads = [], refundReads = [];
  const custom = Array.from({length: 11}, (_, index) => ({
    id: index + 1, reference: 'CUS-' + String(index + 1).padStart(6, '0'),
    title: index === 10 ? 'Unique enclosure' : 'Custom product ' + (index + 1),
    customer_name: 'Fixture customer', service_id: index === 10 ? 9 : 7,
    service: {title: index === 10 ? 'Laser Cutting' : '3D Printing'},
    status: index === 10 ? 'cancelled' : 'submitted',
    status_label: index === 10 ? 'Cancelled' : 'Submitted',
    revision: 1, can_archive: index === 10, updated_at: '2026-11-04T04:00:00Z',
  }));
  const walkins = Array.from({length: 21}, (_, index) => ({
    id: index + 1, order_no: 'WI-' + String(index + 1).padStart(3, '0'),
    customer_name: index === 20 ? 'Unique client' : 'Client ' + (index + 1),
    status: index === 20 ? 'Cancelled' : index % 2 ? 'Completed' : 'Pending',
    project_description: '3D PRINTING', total: 100, subtotal_cost: 100,
  }));
  const h = await browserFixture(t, async ({req, route, json}) => {
    const params = new URL(req.url, 'http://fixture.test').searchParams;
    if (route === '/api/services') {
      json({data: [{id: 7, title: '3D Printing'}, {id: 9, title: 'Laser Cutting'}]}); return true;
    }
    if (route === '/api/admin/custom-requests') {
      customReads.push(Object.fromEntries(params));
      const rows = custom.filter(row =>
        (!params.get('search') || (row.reference + ' ' + row.title + ' ' + row.customer_name).toLowerCase().includes(params.get('search').toLowerCase())) &&
        (!params.get('status') || params.get('status') === 'all' || row.status === params.get('status')) &&
        (!params.get('service_id') || String(row.service_id) === params.get('service_id')));
      const page = Math.min(Number(params.get('page') || 1), Math.max(1, Math.ceil(rows.length / 10)));
      json({data: rows.slice((page - 1) * 10, page * 10), current_page: page, last_page: Math.max(1, Math.ceil(rows.length / 10)), total: rows.length, counts: {submitted: 10, cancelled: 1}}); return true;
    }
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
    await h.go(base + 'orders.html?custom_requests=1');
    await h.until("document.querySelector('#sectionCustomRequests .table-footer-meta')?.textContent === 'Page 1 of 2 • Showing 1–10 of 11' && !document.querySelector('#sectionCustomRequests').closest('[inert]')");
    assert(await noVisibleLabels('#sectionCustomRequests [data-list-filters] label'));
    assert.equal(await h.run("document.querySelectorAll('#sectionCustomRequests [data-list-filters] input, #sectionCustomRequests [data-list-filters] select').length"), 3);
    assert.equal(await h.run("!!document.querySelector('#sectionCustomRequests [data-list-filters] button')"), false);
    await h.run("document.querySelector('[data-search]').focus()");
    await h.send('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9});
    await h.send('Input.dispatchKeyEvent', {type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9});
    assert(await h.run("document.activeElement.matches('[data-status-filter]')"), 'status filter follows search in keyboard order');
    await h.run("document.querySelector('#sectionCustomRequests [data-page=\"2\"]').click()");
    await h.until("document.querySelector('#sectionCustomRequests .table-footer-meta').textContent === 'Page 2 of 2 • Showing 11–11 of 11'");
    await setField('[data-list-filters] [data-search]', 'Unique');
    await h.until("document.querySelector('#sectionCustomRequests .table-footer-meta').textContent === 'Page 1 of 1 • Showing 1–1 of 1'");
    assert(await h.run("document.activeElement.matches('[data-search]')"), 'live search retains focus');
    await setField('[data-status-filter]', 'submitted', 'change');
    await h.until("!!document.querySelector('#customRequestsTable .table-empty-state')");
    await setField('[data-status-filter]', 'cancelled', 'change');
    await h.until("!!document.querySelector('#customRequestsTable [data-open=\"11\"]')");
    await setField('[data-service-filter]', '7', 'change');
    await h.until("!!document.querySelector('#customRequestsTable .table-empty-state')");
    await setField('[data-service-filter]', '9', 'change');
    await h.until("!!document.querySelector('#customRequestsTable [data-open=\"11\"]')");
    assert(customReads.some(params => params.search === 'Unique' && params.status === 'cancelled' && params.service_id === '9'));
    await checkLayout(portal, '#sectionCustomRequests', '.cp-toolbar');

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
