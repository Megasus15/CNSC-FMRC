const test = require('node:test');
const assert = require('node:assert/strict');
const {browserFixture, chrome} = require('./helpers/website-browser.cjs');

test('Admin and Staff tables preserve zeros and literal text while marking missing values', {skip: !chrome, timeout: 90000}, async t => {
  const h = await browserFixture(t, ({route, json}) => {
    if (route === '/api/admin/promotions') {
      json({data: [{id: 1, title: 'Missing discount', discount_percent: null}, {id: 2, title: 'Zero discount', discount_percent: 0}]}); return true;
    }
    if (route === '/api/admin/archives') {
      json({inventory: [{source_id: 1, item_name: 'Inventory', on_hand: null, has_variants: true, variants: [{name: 'Zero', on_hand: 0}, {name: 'Missing', on_hand: null}]}],
        promotions: [{source_id: 1, title: 'Archived discount', discount_percent: null}], appointments: [{source_id: 54, reference_no: 'AP-00054', client_name: 'N/A', status: 'Archived'}]}); return true;
    }
    if (route === '/api/admin/orders') {
      json({incoming: [], directory: [{id: 1, order_no: 'ORD-1', product_name: 'Missing amount', total_amount: null}, {id: 2, order_no: 'ORD-2', product_name: 'Zero amount', total_amount: 0}], payments: [], returns: []}); return true;
    }
    if (route === '/api/admin/gateway-payments') {
      json({payments: {data: [], current_page: 1, last_page: 1, total: 0}, refunds: [], attempts: [], receipts: []}); return true;
    }
    if (route === '/api/admin/reports' || route === '/api/admin/reports/generate') {
      json({data: {report: {id: 'RPT-PLACEHOLDERS', title: 'Values', category: 'sales', period: 'monthly', period_label: 'November 2026', generated_at: '2026-11-09T12:00:00+08:00'},
        metrics: [], table: {title: 'Values', columns: [{key: 'text', label: 'Text'}, {key: 'amount', label: 'Amount', type: 'currency'}, {key: 'flag', label: 'Flag', type: 'boolean'}],
          rows: [{text: 'N/A', amount: 0, flag: false}, {text: '', amount: null, flag: null}]}}}); return true;
    }
    return false;
  });
  await h.send('Network.setBlockedURLs', {urls: ['https://*']});
  const cells = selector => h.run(`[...document.querySelectorAll(${JSON.stringify(selector)})].map(cell=>cell.textContent.trim())`);
  for (const portal of ['admin-page', 'staff-page']) {
    await h.go('/' + portal + '/promotions.html');
    await h.until(`document.querySelectorAll('#promotionTableBody [data-edit-promotion]').length===2`);
    assert.deepEqual(await cells('#promotionTableBody tr td:nth-child(4)'), ['--', '0% OFF']);

    await h.go('/' + portal + '/archives.html');
    await h.until(`!!document.querySelector('#apptArchiveTbody [data-archive-restore]')`);
    assert.equal((await cells('#apptArchiveTbody tr td:nth-child(3)'))[0], 'N/A');
    assert.deepEqual((await cells('#apptArchiveTbody tr td')).slice(3, 10), Array(7).fill('--'));
    assert.deepEqual(await cells('#promotionArchiveTbody tr td:nth-child(3)'), ['--']);
    assert.deepEqual(await cells('#invArchiveTbody .inv-variant-row td:nth-child(6)'), ['0', '--']);
    assert.equal((await cells('#invArchiveTbody tr:first-child td:nth-child(6)'))[0], '', 'Grouped values stay intentionally blank');

    await h.go('/' + portal + '/orders.html');
    await h.until(`document.querySelectorAll('#ordersDirectoryTable [data-order-view]').length===2`);
    const amounts = await cells('#ordersDirectoryTable tbody tr td:nth-child(6)');
    assert(amounts.includes('--'));
    assert(amounts.some(value => /^₱\s*0\.00$/.test(value)));

    await h.go('/' + portal + '/reports.html');
    await h.until(`document.querySelectorAll('#reportTableBody tr').length===2 && document.querySelector('#reportTableBody').textContent.includes('N/A')`);
    const reportCells = await cells('#reportTableBody td');
    assert.deepEqual(reportCells.slice(3), ['--', '--', '--']);
    assert.equal(reportCells[0], 'N/A');
    assert.match(reportCells[1], /^₱\s*0\.00$/);
    assert.equal(reportCells[2], 'No');
    assert.deepEqual(await h.run('fixtureErrors'), []);
  }
});
