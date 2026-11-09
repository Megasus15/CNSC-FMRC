// Customer-only action visibility. API fixtures never contact payment or courier providers.
const test = require('node:test');
const assert = require('node:assert/strict');
const {browserFixture, chrome} = require('./helpers/website-browser.cjs');

const makeOrder = (id, custom = false, rated = false) => ({
  id, order_no: `ORD-${id}`, product_name: `${custom ? 'Custom' : 'Catalog'} product ${id}`,
  order_type: custom ? 'custom' : 'regular', customer_stage: 'completed', lifecycle_status: 'completed',
  created_at: '2026-11-10T01:00:00Z', total_amount: 150, quantity: 1, payment_method: 'GCash',
  payment_status: 'paid', payment_is_confirmed: true, has_rating: rated, rating_stars: rated ? 5 : null,
  return_eligible: true, fulfillment_type: 'pickup', pickup_code: 'PICKUP01',
  items: [{id, product_id: custom ? null : id, product_name: `Product ${id}`, quantity: 1, unit_price: 150}],
  ...(custom ? {custom_product: {stage: 'Completed'}} : {}),
});

for (const page of ['/home-page/', '/products-page/product.html', '/apps/customer/home-page/']) {
  test(`My Orders keeps rating and Buy Again for catalog orders only on ${page}`, {skip: !chrome, timeout: 60000}, async t => {
    const profile = {id: 33, role: 'customer', name: 'Customer Fixture', email: 'customer@example.test'};
    const legacy = makeOrder(103, true); delete legacy.order_type;
    // Exact reported shape: the projected list labelled a custom cash order regular.
    const legacyCash = {...makeOrder(107), product_name: 'EW', payment_method: 'Cash at FMRC',
      items: [{id: 107, product_id: null, product_name: 'EW', quantity: 1, unit_price: 150}]};
    const orders = [makeOrder(101, true, true), makeOrder(102, true), legacy, legacyCash,
      {...makeOrder(104, true), customer_stage: 'to_ship', lifecycle_status: 'pending'},
      makeOrder(201), makeOrder(202, false, true)];
    const requests = [];
    const h = await browserFixture(t, async ({req, route, json}) => {
      if (route === '/api/user') {json(profile); return true;}
      if (route.startsWith('/api/customer/orders')) requests.push({method: req.method, route});
      if (route === '/api/customer/orders') {json({data: orders, returns: []}); return true;}
      const match = route.match(/^\/api\/customer\/orders\/(\d+)(\/rating)?$/);
      if (match) {json(match[2] ? {data: []} : {data: orders.find(order => order.id === Number(match[1]))}); return true;}
      return false;
    });
    await h.send('Network.setBlockedURLs', {urls: ['https://*']});
    await h.send('Emulation.setDeviceMetricsOverride', {width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false});
    await h.send('Page.addScriptToEvaluateOnNewDocument', {source: `localStorage.setItem('customer_token','fixture-customer');localStorage.setItem('customer_info',${JSON.stringify(JSON.stringify(profile))});`});
    await h.go(page + '?orders=1');
    await h.until(`!!document.querySelector('[data-panel="all"] [data-order-detail="201"]')`);

    for (const panel of ['all', 'completed']) {
      for (const id of [101, 102, 103, 107]) {
        assert.equal(await h.run(`!!document.querySelector('[data-panel="${panel}"] [data-order-detail="${id}"]')`), true);
        assert.equal(await h.run(`!!document.querySelector('[data-panel="${panel}"] [data-order-rate="${id}"], [data-panel="${panel}"] [data-order-buy-again="${id}"]')`), false);
        assert.equal(await h.run(`!!document.querySelector('[data-panel="${panel}"] [data-order-return="${id}"]')`), true, 'Custom order return actions are preserved');
      }
      assert.equal(await h.run(`!!document.querySelector('[data-panel="${panel}"] [data-order-rate="201"]')`), true);
      for (const id of [201, 202]) assert.equal(await h.run(`!!document.querySelector('[data-panel="${panel}"] [data-order-buy-again="${id}"]')`), true);
    }
    assert.equal(await h.run(`document.querySelector('[data-tab="all"] .customer-orders-tab-count').textContent`), '7');
    assert.equal(await h.run(`document.querySelector('[data-tab="completed"] .customer-orders-tab-count').textContent`), '6');
    assert.equal(await h.run(`document.querySelector('[data-tab="to_rate"] .customer-orders-tab-count').textContent`), '1');
    await h.run(`document.querySelector('[data-tab="to_rate"]').click()`);
    assert.deepEqual(await h.run(`Array.from(document.querySelectorAll('[data-panel="to_rate"] [data-order-rate]'), button => button.dataset.orderRate).sort()`), ['201', '202']);

    // Stale action elements and the legacy global entry points cannot reopen custom actions.
    await h.run(`(()=>{const panel=document.querySelector('[data-panel="all"]');for(const action of ['rate','buy-again']){const button=document.createElement('button');button.setAttribute('data-order-'+action,'102');button.setAttribute('data-buy-again-product','201');panel.append(button);button.click();if(action==='rate')window.__fmrcOrderRate(button);else window.__fmrcOrderBuyAgain(button);button.remove();}})()`);
    assert.equal(await h.run(`!!document.querySelector('#customerRatingModal.show, .customer-buy-again-overlay.show')`), false);
    assert.equal(await h.run(`sessionStorage.getItem('fmrc_buy_again_intent')`), null);
    assert.equal(requests.some(request => /\/(101|102|103|107)\/rating$/.test(request.route)), false);
    await h.run(`document.querySelector('[data-tab="all"]').click()`);
    await h.pause(350);
    await h.run(`document.querySelector('[data-panel="all"] [data-order-detail="107"]').closest('article').scrollIntoView({block:'center'})`);
    await h.shot('custom-actions-removed-regular-actions-kept');
    t.diagnostic('Custom order action screenshot: ' + h.artifacts);

    // The unchanged catalog rating action still opens the existing review form.
    await h.run(`document.querySelector('[data-tab="to_rate"]').click();document.querySelector('[data-panel="to_rate"] [data-order-rate="201"]').click()`);
    await h.until(`!!document.querySelector('#customerRatingModal.show .customer-rating-item')`);
    await h.run(`document.getElementById('closeRatingModal').click()`);
    await h.until(`!document.querySelector('#customerRatingModal.show')`);
    await h.run(`document.querySelector('[data-tab="all"]').click();window.__fmrcConsumeBuyAgainIntent=()=>{window.catalogReorderConsumed=true;};document.querySelector('[data-panel="all"] [data-order-buy-again="201"]').click()`);
    await h.until(`window.catalogReorderConsumed===true`);
    assert.equal(await h.run(`JSON.parse(sessionStorage.getItem('fmrc_buy_again_intent')).productId`), 201);
    assert.equal(requests.some(request => request.method !== 'GET'), false);
    assert.deepEqual(await h.run('fixtureErrors'), []);
  });
}
