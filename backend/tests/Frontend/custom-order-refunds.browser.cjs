const test = require('node:test'), assert = require('node:assert/strict');
const {browserFixture, chrome} = require('./helpers/website-browser.cjs');

test('Shared return modal restores fields and records custom cash refunds with the remaining balance', {skip: !chrome, timeout: 60000}, async t => {
  let writes = [];
  const row = (id, role = 'admin') => ({id, order_id: id, return_no: 'RTN-' + id, return_no_display: '#RTN-' + id,
    order_no_display: '#ORD-' + id, customer_name: 'Fixture Customer', status: 'refund_processing', resolution: 'refund',
    requested_amount: 1000, approved_amount: 1000, refunded_amount: 400, refund_available_amount: 600,
    payment_is_automated: id === 1, payment_is_custom_cash: id === 2, refund_admin_only: id === 2,
    can_refund: id !== 2 || role === 'admin', can_receive: false, requires_receipt: false,
    refund_method: id === 2 ? 'cash' : 'gcash', items: [], events: []});
  const h = await browserFixture(t, async ({req, route, role, json}) => {
    if (route === '/api/admin/orders') {json({data: [], incoming: [], directory: [], payments: [], returns: [row(1, role), row(2, role), row(3, role)]}); return true;}
    if (route === '/api/admin/returns') {json({data: [row(1, role), row(2, role), row(3, role)]}); return true;}
    const match = route.match(/^\/api\/admin\/returns\/([123])$/);
    if (match) {json({data: row(Number(match[1]), role)}); return true;}
    if (route === '/api/admin/returns/2/refund') {
      let body = ''; for await (const chunk of req) body += chunk;
      const input = JSON.parse(body); writes.push(input);
      assert.equal(input.refund_method, 'cash'); assert.equal(input.stage, 'released');
      assert.equal(input.refund_released, true); assert.equal(input.amount, 600);
      assert.equal(input.refund_reference, 'CASH-RETURN-2'); assert(input.request_key);
      json({data: {...row(2), status: 'refunded', refunded_amount: 1000, refund_available_amount: 0, can_refund: false}}); return true;
    }
    return false;
  });
  await h.send('Network.setBlockedURLs', {urls: ['https://*']});
  for (const portal of ['admin', 'staff']) {
    await h.go('/' + portal + '-page/orders.html');
    await h.until(`document.querySelector('[data-return-view="2"]')`);
    if (portal === 'staff') {
      assert.equal(await h.run(`!!document.querySelector('[data-return-action="2"][data-return-mode="refund"]')`), false);
      assert.match(await h.run(`document.querySelector('[data-return-view="2"]').closest('tr').textContent`), /RTN-2/);
      continue;
    }
    const openRefund=async id=>{
      await h.run(`document.getElementById('modalReturnDetails').classList.remove('show');document.querySelector('[data-return-view="${id}"]').click()`);
      await h.until(`!!document.querySelector('#modalReturnDetails [data-return-action="${id}"][data-return-mode="refund"]')`);
      await h.run(`document.querySelector('#modalReturnDetails [data-return-action="${id}"][data-return-mode="refund"]').click()`);
    };
    // Online refunds hide manual receipt fields; the next cash modal must restore them.
    await openRefund(1);
    await h.until(`document.getElementById('modalReturnAction').classList.contains('show')`);
    assert.equal(await h.run(`document.getElementById('returnRefundReference').closest('.field-stack').style.display`), 'none');
    await h.run(`document.getElementById('btnCancelReturnAction').click()`);await openRefund(2);
    await h.until(`document.getElementById('returnActionTitle').textContent==='Record cash refund'`);
    assert.equal(await h.run(`document.getElementById('returnRefundReference').closest('.field-stack').style.display`), '');
    assert.equal(await h.run(`document.getElementById('returnRefundAmount').value`), '600.00');
    assert.equal(await h.run(`document.getElementById('returnRefundMethod').disabled&&document.getElementById('returnRefundStage').disabled`), true);
    for (const [width, theme] of [[1440, 'light'], [390, 'dark']]) {
      await h.send('Emulation.setDeviceMetricsOverride', {width, height: 900, deviceScaleFactor: 1, mobile: false});
      await h.run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      await h.shot('custom-cash-refund-' + width + '-' + theme);
    }
    await h.run(`document.getElementById('returnRefundReference').value='CASH-RETURN-2';document.getElementById('btnSubmitReturnAction').click()`);
    await h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupTitle')?.textContent==='Record cash refund'`);
    assert.match(await h.run(`document.getElementById('adminSystemPopup').textContent`), /already been returned in cash/);
    await h.run(`document.getElementById('adminSystemPopupOk').click()`);
    await h.until(`!document.getElementById('modalReturnAction').classList.contains('show')`);
    assert.equal(writes.length, 1);
    await h.run(`document.querySelector('#adminSystemPopup.show #adminSystemPopupOk')?.click()`);
    await openRefund(3);
    await h.until(`document.getElementById('modalReturnAction').classList.contains('show')`);
    assert.equal(await h.run(`document.getElementById('returnRefundMethod').disabled`), false);
    assert.equal(await h.run(`document.getElementById('returnRefundReference').maxLength`), 180);
    await h.run(`document.getElementById('btnCancelReturnAction').click()`);
  }
  assert.deepEqual(await h.run('fixtureErrors'), []);
  t.diagnostic('Screenshots: ' + h.artifacts);
});

test('Custom customer cash orders disable switching to unavailable online payment', {skip: !chrome, timeout: 30000}, async t => {
  const h = await browserFixture(t, async ({route, json}) => {
    if (route === '/api/admin/orders') {json({data: [], incoming: [], directory: [], payments: []}); return true;}
    return false;
  });
  await h.send('Network.setBlockedURLs', {urls: ['https://*']});
  await h.go('/admin-page/orders.html');
  await h.until(`!!window.FMRCAppointmentProducts`);
  await h.run(`window.customPaymentHost=document.createElement('div');document.body.append(customPaymentHost);
    window.customPaymentOrder={id:81,order_type:'custom',payment_status:'pending',payment_method:'Cash at FMRC',lifecycle_status:'incoming',custom_product:{online_payment_available:false,revision:1,stage:'Awaiting payment',agreement:{specifications:{name:'Fixture sign',quantity:1},total:1000,shipping_fee:0},cash_entries:[],available_actions:{}}};
    FMRCAppointmentProducts.mountOrder(customPaymentHost,customPaymentOrder,false)`);
  assert.equal(await h.run(`customPaymentHost.querySelector('[data-ap-switch-payment]').disabled`), true);
  await h.run(`customPaymentOrder.custom_product.online_payment_available=true;FMRCAppointmentProducts.mountOrder(customPaymentHost,customPaymentOrder,false)`);
  assert.equal(await h.run(`customPaymentHost.querySelector('[data-ap-switch-payment]').disabled`), false);
  assert.deepEqual(await h.run('fixtureErrors'), []);
});
