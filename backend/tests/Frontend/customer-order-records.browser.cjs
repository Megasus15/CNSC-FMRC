// Isolated API fixtures: no real order, courier, payment or refund is contacted.
const test = require('node:test');
const assert = require('node:assert/strict');
const {browserFixture, chrome} = require('./helpers/website-browser.cjs');

for (const prefix of ['', '/apps/customer', '/products-page/product.html']) {
  test(`Customer order records, refund details and protected history removal on ${prefix || 'website'}`, {skip: !chrome, timeout: 120000}, async t => {
    const page = prefix.endsWith('.html') ? prefix : prefix + '/home-page/';
    const profile = {id: 33, role: 'customer', name: 'Customer Fixture', email: 'customer@example.test'};
    const makeOrder = (id, eligible = true) => ({id, order_no: `ORD-${id}`, order_no_display: `#ORD-${id}`, product_name: `Prototype ${id}`,
      total_amount: 150, total_label: '₱ 150.00', quantity: 1, payment_method: 'GCash', payment_status: 'paid', payment_is_confirmed: true, payment_is_automated: true,
      fulfillment_type: 'delivery', lifecycle_status: 'completed', customer_stage: 'completed', has_rating: true,
      created_at: '2026-11-01T02:00:00Z', history_removal: {eligible, reason: eligible ? null : 'Wait until the payment provider confirms the refund or FMRC resolves the refund issue.', code: eligible ? null : 'refund_unresolved'},
      items: [{id, product_name: 'Prototype', quantity: 1, unit_price: 150, line_total: 150}],
      pricing: {item_subtotal_label: '₱ 140.00', shipping_fee_label: '₱ 10.00', payable_total_label: '₱ 150.00'},
      courier_name: 'J&T Express', courier_tracking_no: 'JT0026952419687',
      courier_shipment: {tracking_provider: '17track', status_label: 'Delivered', tracking_number: 'JT0026952419687', last_updated_at_label: 'Nov 9, 2026, 11:40 AM'},
      customer_timeline: [
        {id: 'scan-1', kind: 'courier', status: 'delivered', title: 'Delivered', location_name: 'LABO, F-Labo 01', date_key: '2026-11-09', date_label: 'November 9, 2026', time_label: '11:40:35 AM', occurred_at: '2026-11-09T11:40:35+08:00'},
        {id: 'scan-driver', kind: 'courier', status: 'out_for_delivery', title: 'Out for delivery', description: '【OCW_Mark Jerald Tabadero : 639950198016】 Photo proof of delivery is required.', location_name: 'LABO', date_key: '2026-11-09', date_label: 'November 9, 2026', time_label: '7:33:31 AM', occurred_at: '2026-11-09T07:33:31+08:00'},
        {id: 'scan-2', kind: 'courier', title: 'Departed Pili for Labo', location_name: 'PILI', date_key: '2026-11-09', date_label: 'November 9, 2026', time_label: '2:42:15 AM', occurred_at: '2026-11-09T02:42:15+08:00'},
        {id: 'note-1', kind: 'note', title: 'Packed securely', description: 'Protective packaging added.', date_key: '2026-11-07', date_label: 'November 7, 2026', time_label: '9:00:00 AM', occurred_at: '2026-11-07T09:00:00+08:00'}]});
    let orders = [makeOrder(101), makeOrder(102), makeOrder(103, false)], returns = [{id: 7, order_id: 103, return_no: 'RTN-7', status: 'refund_processing', status_label: 'Refund Processing', status_group: 'open', payment_is_automated: true, resolution: 'refund', reason_label: 'Damaged', requested_amount: 150, requested_amount_label: '₱ 150.00', approved_amount_label: '₱ 150.00', refunded_amount: 0, refunded_amount_label: '₱ 0.00', media: [], items: [], timeline: []}];
    const mutations = [];
    let holdNextList = false, releaseStale, stalePending = false, detailVersion = 1;
    const h = await browserFixture(t, async ({req, route, json}) => {
      if (route === '/api/user') {json(profile); return true;}
      if (route === '/api/customer/orders') {
        const snapshot = JSON.parse(JSON.stringify({data: orders, returns}));
        if (holdNextList) {holdNextList = false; stalePending = true; await new Promise(resolve => {releaseStale = resolve;});}
        json(snapshot); return true;
      }
      if (route === '/api/customer/orders/history/clear' || /\/customer\/orders\/\d+\/history$/.test(route)) {
        let body = ''; for await (const chunk of req) body += chunk;
        const ids = req.method === 'DELETE' ? [Number(route.split('/').at(-2))] : JSON.parse(body).order_ids.map(Number);
        mutations.push({ids, method: req.method});
        const allowed = ids.filter(id => orders.find(order => order.id === id)?.history_removal.eligible);
        orders = orders.filter(order => !allowed.includes(order.id));
        json({removed_ids: allowed, skipped: []}); return true;
      }
      const detail = route.match(/^\/api\/customer\/orders\/(\d+)$/);
      if (detail) {const order = orders.find(order => order.id === Number(detail[1])); const etag = '"detail-'+detail[1]+'-'+detailVersion+'"'; json(order ? {data: order} : {message: 'Removed from My Orders. FMRC retains the transaction record.', code: 'order_history_removed'}, order ? (req.headers['if-none-match'] === etag ? 304 : 200) : 410, {ETag: etag}); return true;}
      if (route === '/api/customer/returns/7') {json({data: {...returns[0], timeline: [{id: 77, title: 'FMRC reviewed the evidence', description: 'The return is being inspected.', occurred_at: '2026-11-09T03:00:00Z', occurred_at_label: 'Nov 9, 2026, 11:00 AM'}]}}); return true;}
      return false;
    });
    await h.send('Network.setBlockedURLs', {urls: ['https://*']});
    await h.send('Page.addScriptToEvaluateOnNewDocument', {source: `localStorage.setItem('customer_token','fixture-customer');localStorage.setItem('customer_info',${JSON.stringify(JSON.stringify(profile))});`});
    await h.go(page + '?orders=1&order_id=101');
    await h.until(`document.querySelector('#customerOrderDetailModal.show .customer-record-event.is-delivered')`);
    assert.equal(await h.run(`document.querySelectorAll('.customer-record-event').length`), 4);
    assert.equal(await h.run(`document.querySelectorAll('.customer-record-date').length`), 2);
    const timeline = await h.run(`document.querySelector('.customer-order-detail-timeline').innerText`);
    assert.doesNotMatch(timeline, /via 17TRACK|Tracking number|JT0026952419687/);
    assert.match(timeline, /FMRC note/);
    assert.match(timeline, /Mark Jerald Tabadero/);
    assert.match(timeline, /639950198016/);
    assert.equal(await h.run(`document.querySelector('[data-copy-text]').disabled`), false, 'Copy remains an enabled action');
    // The pending detail ETag must not consume an update while a custom-product
    // editor holds unsaved input; the next check must render it after editing.
    await h.run(`document.getElementById('customerOrderDetailContent').insertAdjacentHTML('beforeend','<form data-dirty="true" data-fixture-draft><textarea>Unsaved customer choice</textarea></form>')`);
    orders[0].customer_timeline[3].description = 'Packaging record updated during editing.';
    detailVersion++;
    await h.pause(3200);
    assert.equal(await h.run(`document.querySelector('[data-fixture-draft] textarea').value`), 'Unsaved customer choice');
    await h.run(`document.querySelector('[data-fixture-draft]').remove()`);
    await h.until(`document.querySelector('#customerOrderDetailContent').textContent.includes('Packaging record updated during editing.')`);
    for (const width of [390, 1440]) for (const theme of ['light', 'dark']) {
      await h.send('Emulation.setDeviceMetricsOverride', {width, height: 900, deviceScaleFactor: 1, mobile: false});
      await h.run(`document.documentElement.dataset.theme='${theme}';document.querySelector('.customer-order-detail-timeline').scrollIntoView({behavior:'instant',block:'start'})`);
      const layout = await h.run(`(()=>{const body=document.getElementById('customerOrderDetailContent'),modal=document.getElementById('customerOrderDetailModal');return {overflow:body.scrollWidth>body.clientWidth+1,footer:!!document.querySelector('.customer-order-record-foot'),bottomGap:modal.getBoundingClientRect().bottom-body.getBoundingClientRect().bottom,close:document.getElementById('closeCustomerOrderDetail').getBoundingClientRect().width,events:document.querySelectorAll('.customer-record-event').length}})()`);
      assert.equal(layout.overflow, false, JSON.stringify({width, theme, layout}));
      assert.equal(layout.footer, false);
      assert(layout.bottomGap < 3 && layout.close >= 32, JSON.stringify(layout));
      assert.match(await h.run(`getComputedStyle(document.querySelector('.customer-record-event-copy')).fontFamily`), /Montserrat/);
      await h.shot(`order-record-${width}-${theme}`);
    }
    await h.run(`document.getElementById('closeCustomerOrderDetail').click()`);
    await h.until(`!document.querySelector('#customerOrderDetailModal.show')`);
    assert.equal(await h.run(`document.querySelector('[data-order-remove="103"]').disabled`), true);
    assert.equal(await h.run(`document.querySelector('[data-panel="all"] [data-order-remove="103"]').closest('.customer-order-actions')!==null`), true);
    assert.equal(await h.run(`document.querySelector('[data-panel="all"] [data-order-remove="103"]').parentElement.textContent.trim()`), 'Refund must be resolved first');
    assert.equal(await h.run(`document.getElementById('customerOrdersTabs').nextElementSibling.matches('.customer-orders-history-tools:not(.ux-dlg__foot)')`), true);
    for (const width of [320, 390, 1440]) for (const theme of ['light', 'dark']) {
      await h.send('Emulation.setDeviceMetricsOverride', {width, height: 900, deviceScaleFactor: 1, mobile: false});
      await h.run(`document.documentElement.dataset.theme='${theme}'`);
      const list = await h.run(`(()=>{const tools=document.querySelector('.customer-orders-history-tools'),panel=document.querySelector('[data-panel="all"]'),button=panel.querySelector('[data-gateway-order]'),style=getComputedStyle(button),row=tools.getBoundingClientRect(),tabs=document.getElementById('customerOrdersTabs').getBoundingClientRect(),viewport=document.getElementById('customerOrdersViewport').getBoundingClientRect(),clear=tools.querySelector('button').getBoundingClientRect();return {overflow:panel.scrollWidth>panel.clientWidth+1,toolOverflow:tools.scrollWidth>tools.clientWidth+1,background:style.backgroundColor,image:style.backgroundImage,color:style.color,gapAbove:row.top-tabs.bottom,gapBelow:viewport.top-row.bottom,edgeDifference:Math.abs(row.left-viewport.left)+Math.abs(row.right-viewport.right),buttonCentered:Math.abs((clear.top+clear.bottom-row.top-row.bottom)/2)}})()`);
      await h.shot(`order-list-${width}-${theme}`);
      assert.equal(list.overflow, false, JSON.stringify({width, theme, list}));
      assert.equal(list.toolOverflow, false, JSON.stringify({width, theme, list, tools: await h.run(`Array.from(document.querySelector('.customer-orders-history-tools').children).map(el=>({width:el.getBoundingClientRect().width,minWidth:getComputedStyle(el).minWidth,font:getComputedStyle(el).fontSize,padding:getComputedStyle(el).padding}))`)}));
      assert.equal(list.image, 'none');
      assert.equal(list.background, 'rgb(107, 32, 43)');
      assert(list.gapAbove >= 10 && list.gapBelow >= 10 && Math.abs(list.gapAbove-list.gapBelow) <= 2, 'History toolbar has balanced vertical spacing: ' + JSON.stringify(list));
      assert(list.edgeDifference <= 2 && list.buttonCentered <= 1, 'History toolbar aligns with the order list and centers its action: ' + JSON.stringify(list));
    }
    assert.match(await h.run(`document.querySelector('[data-orders-clear]').textContent`), /\(2\)/);
    // Cancel is a true no-op.
    await h.run(`document.querySelector('[data-panel="all"] [data-order-remove="101"]').click()`);
    await h.until(`document.querySelector('#customerSystemPopup.show')`);
    await h.run(`document.getElementById('customerSystemPopupCancel').click()`);
    assert.equal(mutations.length, 0);
    await h.until(`!document.querySelector('[data-panel="all"] [data-order-remove="101"]').disabled`);
    // A response captured before deletion must never restore the removed row.
    holdNextList = true;
    await h.until(`document.getElementById('customerOrdersSyncStatus').classList.contains('is-live')`);
    for (let i = 0; i < 150 && !stalePending; i++) await h.pause(80);
    assert(stalePending, 'An old poll is held before removing an order');
    await h.run(`document.querySelector('[data-panel="all"] [data-order-remove="101"]').click()`);
    await h.until(`document.querySelector('#customerSystemPopup.show')`);
    await h.run(`document.getElementById('customerSystemPopupOk').click()`);
    await h.until(`!document.querySelector('[data-panel="all"] [data-order-detail="101"]')`);
    releaseStale(); await h.pause(300);
    assert.equal(await h.run(`!!document.querySelector('[data-panel="all"] [data-order-detail="101"]')`), false);
    await h.run(`document.querySelector('[data-orders-clear]').click()`);
    await h.until(`document.querySelector('#customerSystemPopup.show')`);
    assert.match(await h.run(`document.getElementById('customerSystemPopupMessage').textContent`), /1 eligible/);
    await h.run(`document.getElementById('customerSystemPopupOk').click()`);
    await h.until(`!document.querySelector('[data-panel="all"] [data-order-detail="102"]')`);
    assert.deepEqual(mutations, [{ids: [101], method: 'DELETE'}, {ids: [102], method: 'POST'}]);
    assert.equal(await h.run(`document.querySelector('#customerOrdersTabs [data-tab="all"] .customer-orders-tab-count').textContent`), '1');
    await h.run(`document.querySelector('#customerOrdersTabs [data-tab="returns"]').click();document.querySelector('[data-return-detail="7"]').click()`);
    await h.until(`document.querySelector('#customerOrderDetailModal[data-record-type="return"].show')`);
    await h.until(`document.querySelector('#customerOrderDetailContent').textContent.includes('FMRC reviewed the evidence')`);
    assert.match(await h.run(`document.querySelector('[data-order-record-eyebrow]').textContent`), /Return & refund/);
    assert.equal(await h.run(`!!document.querySelector('.customer-return-receipt')`), false, 'A zero / pending refund is not a confirmed receipt');
    const refundButton = await h.run(`(()=>{const button=document.querySelector('#customerOrderDetailContent [data-gateway-order="103"]'),style=getComputedStyle(button);return {background:style.backgroundColor,image:style.backgroundImage,height:button.getBoundingClientRect().height}})()`);
    assert.equal(refundButton.background, 'rgb(107, 32, 43)', 'Refund Payment details uses the same maroon action');
    assert.equal(refundButton.image, 'none');
    assert.equal(refundButton.height, 42);
    assert.equal(await h.run(`document.querySelector('#customerOrderDetailModal .ux-dlg__foot')`), null);
    await h.shot('refund-processing');
    await h.run(`document.getElementById('closeCustomerOrderDetail').click()`);
    await h.go(page + '?orders=1&order_id=101');
    await h.until(`document.querySelector('#customerOrderDetailContent').textContent.includes('Removed from My Orders')`);
    assert.deepEqual(await h.run('fixtureErrors'), []);
    t.diagnostic('Screenshots: ' + h.artifacts);
  });
}

test('Customer return form preserves notes, quantities and evidence through live refresh', {skip: !chrome, timeout: 60000}, async t => {
  const fs = require('node:fs'), path = require('node:path');
  const profile = {id: 44, role: 'customer', name: 'Return Fixture', email: 'return@example.test'};
  const order = {id: 104, order_no: 'ORD-104', product_name: 'Custom prototype', quantity: 2, customer_stage: 'completed', lifecycle_status: 'completed',
    payment_status: 'paid', payment_is_confirmed: true, payment_method: 'COP', total_amount: 300, return_eligible: true, created_at: '2026-11-08T02:00:00Z',
    history_removal: {eligible: false, code: 'waiting_period', reason: 'The return window is still open.'}, items: [{id: 11, product_name: 'Prototype', quantity: 2, unit_price: 150}]};
  let listLoads = 0, submitted = '';
  const h = await browserFixture(t, async ({req, route, json}) => {
    if (route === '/api/user') {json(profile); return true;}
    if (route === '/api/customer/orders') {listLoads++; json({data: [order], returns: []}); return true;}
    if (route === '/api/customer/orders/104/return/eligibility') {
      json({eligible: true, window_days: 7, days_remaining: 5, items: [{order_item_id: 11, product_name: 'Prototype', quantity: 2, unit_price: 150, returned_quantity: 0}],
        reasons: [{value: 'damaged', label: 'Damaged item'}], resolutions: [{value: 'refund', label: 'Refund'}, {value: 'repair', label: 'Repair'}]}); return true;
    }
    if (route === '/api/customer/orders/104/return') {
      for await (const chunk of req) submitted += chunk;
      json({data: {id: 12, order_id: 104, return_no: 'RTN-12', status: 'requested', status_group: 'open'}}, 201); return true;
    }
    return false;
  });
  await h.send('Network.setBlockedURLs', {urls: ['https://*']});
  await h.send('Page.addScriptToEvaluateOnNewDocument', {source: `localStorage.setItem('customer_token','fixture-customer');localStorage.setItem('customer_info',${JSON.stringify(JSON.stringify(profile))});`});
  await h.go('/home-page/?orders=1');
  await h.until(`document.querySelector('[data-panel="all"] [data-order-return="104"]')`);
  await h.run(`document.querySelector('[data-panel="all"] [data-order-return="104"]').click()`);
  await h.until(`document.querySelector('#customerReturnRequestModal.show [data-return-reason]')`);
  await h.run(`(()=>{const select=document.querySelector('[data-return-reason]');select.value='damaged';select.dispatchEvent(new Event('change',{bubbles:true}));const note=document.querySelector('[data-return-note]');note.value='Please inspect the engraved edge.';note.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-return-qty="1"]').click()})()`);
  const file = path.join(h.artifacts, 'return-evidence.png');
  fs.writeFileSync(file, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6QmcAAAAASUVORK5CYII=', 'base64'));
  const {root} = await h.send('DOM.getDocument');
  const {nodeId} = await h.send('DOM.querySelector', {nodeId: root.nodeId, selector: '#returnEvidenceInput'});
  await h.send('DOM.setFileInputFiles', {nodeId, files: [file]});
  await h.until(`document.querySelectorAll('[data-return-media-preview] .is-new').length===1`);
  const before = listLoads;
  for (let i = 0; i < 100 && listLoads <= before; i++) await h.pause(80);
  assert(listLoads > before, 'Live refresh ran while the return draft stayed open');
  assert.equal(await h.run(`document.querySelector('[data-return-note]').value`), 'Please inspect the engraved edge.');
  assert.equal(await h.run(`document.querySelector('[data-return-qty-value]').textContent`), '2');
  assert.equal(await h.run(`document.querySelectorAll('[data-return-media-preview] .is-new').length`), 1);
  await h.run(`document.querySelector('[data-return-resolution][value="repair"]').click()`);
  assert.equal(await h.run(`document.querySelector('[data-return-estimate-label]').textContent`), 'Selected item value');
  await h.run(`document.querySelector('[data-return-resolution][value="refund"]').click();document.querySelector('[data-return-request-close]').click()`);
  await h.until(`document.querySelector('[data-return-discard].show')`);
  await h.run(`document.querySelector('[data-return-discard-continue]').click()`);
  assert.equal(await h.run(`document.querySelector('[data-return-note]').value`), 'Please inspect the engraved edge.');
  await h.shot('return-request-draft');
  await h.run(`document.querySelector('[data-return-request-submit]').click()`);
  await h.until(`!document.querySelector('#customerReturnRequestModal.show')`);
  assert.match(submitted, /Please inspect the engraved edge\./);
  assert.match(submitted, /filename="return-evidence.png"/);
  assert.match(submitted, /name="items\[0\]\[quantity\]"\r\n\r\n2/);
  assert.deepEqual(await h.run('fixtureErrors'), []);
  t.diagnostic('Screenshots: ' + h.artifacts);
});
