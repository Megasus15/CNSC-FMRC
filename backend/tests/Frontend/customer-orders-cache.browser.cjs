const test = require('node:test'), assert = require('node:assert/strict');
const {browserFixture, chrome} = require('./helpers/website-browser.cjs');

for (const prefix of ['', '/apps/customer']) {
  test(`My Orders recovers an empty cached list and retains orders after an invalid response on ${prefix || 'website'}`, {skip: !chrome, timeout: 40000}, async t => {
    const profile = {id: 33, role: 'customer', name: 'Customer Fixture', email: 'customer@example.test'};
    const order = {id: 103, order_no: 'ORD-261107-00103', order_no_display: '#ORD-261107-00103', product_name: 'Fixture prototype',
      quantity: 1, total_amount: 100, total_label: 'PHP 100.00', payment_method: 'GCash', payment_status: 'paid', payment_is_confirmed: true,
      fulfillment_type: 'delivery', customer_stage: 'to_receive', lifecycle_status: 'pending', created_at: '2026-11-07T10:00:00Z',
      items: [{id: 1, product_id: 1, product_name: 'Fixture prototype', quantity: 1, unit_price: 100}], tracking_events: []};
    const listRequests = [];
    let mode = 'healthy';
    const h = await browserFixture(t, async ({req, route, json}) => {
      if (route === '/api/user') {json(profile); return true;}
      if (route === '/api/customer/orders') {
        listRequests.push({mode, etag: req.headers['if-none-match'] || ''});
        if (mode === 'invalid') json({message: 'Unexpected deployment response'}, 200, {ETag: '"bad-result"'});
        else if (mode === 'empty') json({data: [], returns: [], counts: {all: 0}}, 200, {ETag: '"empty-result"'});
        else json({data: [order], returns: [], counts: {all: 1}}, req.headers['if-none-match'] === '"same-result"' ? 304 : 200, {ETag: '"same-result"'});
        return true;
      }
      if (route === '/api/customer/orders/103') {json({data: order}); return true;}
      return false;
    });
    await h.send('Network.setBlockedURLs', {urls: ['https://*']});
    // This is the reported state: an empty saved list with an ETag that the
    // server still recognizes. Revalidation alone cannot repair the local rows.
    await h.send('Page.addScriptToEvaluateOnNewDocument', {source: `
      localStorage.setItem('customer_token','fixture-customer');
      localStorage.setItem('customer_info',${JSON.stringify(JSON.stringify(profile))});
      sessionStorage.setItem('fmrc_customer_orders_v2:33',JSON.stringify({orders:[],returns:[],etag:'"same-result"',savedAt:Date.now()}));`});
    await h.go(prefix + '/home-page/?orders=1&order_id=103');
    await h.until(`document.querySelector('#customerOrdersModal [data-panel="all"] [data-order-detail="103"]')`);
    assert.equal(listRequests[0].etag, '', 'Explicit opening requests a complete list, even with a saved ETag');
    assert.equal(await h.run(`document.querySelector('#customerOrdersTabs [data-tab="all"] .customer-orders-tab-count').textContent`), '1');
    await h.until(`document.querySelector('#customerOrderDetailModal.show')`);
    assert.match(await h.run(`document.getElementById('customerOrderDetailTitle').textContent`), /00103/);
    await h.run(`document.getElementById('closeCustomerOrderDetail').click()`);
    await h.until(`document.getElementById('customerOrdersSyncStatus').classList.contains('is-live')`);
    mode = 'invalid';
    await h.until(`document.getElementById('customerOrdersSyncStatus').classList.contains('is-offline')`);
    assert.equal(await h.run(`!!document.querySelector('#customerOrdersModal [data-panel="all"] [data-order-detail="103"]')`), true);
    assert.equal(await h.run(`JSON.parse(sessionStorage.getItem('fmrc_customer_orders_v2:33')).orders.length`), 1);
    assert.notEqual(await h.run(`JSON.parse(sessionStorage.getItem('fmrc_customer_orders_v2:33')).etag`), '"bad-result"');
    // A genuine successful empty list is still authoritative.
    mode = 'empty';
    await h.until(`document.querySelector('#customerOrdersModal [data-panel="all"]').textContent.includes('No orders yet.')`);
    assert.equal(await h.run(`document.getElementById('customerOrdersSyncStatus').classList.contains('is-live')`), true);
    assert.deepEqual(await h.run('fixtureErrors'), []);
  });
}
