const test=require('node:test'),assert=require('node:assert/strict');
const {browserFixture,chrome}=require('./helpers/website-browser.cjs');
const order=id=>({id,order_no:'RF-'+id,order_no_display:'#RF-'+id,customer_name:'Refund Customer',customer_contact:'client@example.test',product_name:'Bamboo cup',quantity:2,total_amount:200,total_label:'₱200.00',payment_method:'GCash',payment_method_label:'QR Ph',payment_status:'paid',payment_is_automated:true,payment_is_confirmed:true,lifecycle_status:'pending',customer_stage:'to_ship',customer_stage_label:'To Ship',fulfillment_type:'pickup',is_pickup:true,items:[{product_id:1,product_name:'Bamboo cup',quantity:2,unit_price:100,line_total:200}],timeline:[],payment_actions:{paid:{allowed:false},pending:{allowed:false},refunded:{allowed:false}},approval:{allowed:false,reason:'Already preparing'},can_cancel:false});

for(const role of ['admin','staff'])test(role+' keeps active payment history read-only and reviews historical refunds safely',{skip:!chrome,timeout:90000},async t=>{
  const orders=[order(71),{...order(72),payment_status:'refunded',payment_is_confirmed:false,payment_is_refunded:true,refund_review:{required:true,label:'Refunded — FMRC review required',can_close:role==='admin',reason:role==='staff'?'Admin must review and close this refunded order.':null,stock_items:[{product_id:1,product_name:'Bamboo cup with a long descriptive product name',quantity:2,max_restore:2},{product_id:2,product_name:'Previously released item',quantity:1,max_restore:0}]}}, {...order(73),lifecycle_status:'cancelled'},order(74)];
  let failClose=true,writes=[];
  const h=await browserFixture(t,async({req,route,json})=>{
    if(route==='/api/admin/orders'){json({review:[],incoming:[],directory:orders,payments:[],returns:[]});return true;}
    const detail=route.match(/^\/api\/admin\/orders\/(7[1-4])$/);
    if(detail){json({data:orders.find(o=>o.id===Number(detail[1]))});return true;}
    if(route==='/api/admin/orders/72/close-refunded'){
      let text='';for await(const c of req)text+=c;writes.push(JSON.parse(text));
      if(failClose){failClose=false;json({message:'Shipment check unavailable. Your entries are kept.'},503);return true;}
      Object.assign(orders[1],{lifecycle_status:'cancelled',refund_review:{required:false},timeline:[{id:8,title:'Order closed after confirmed refund',description:writes.at(-1).reason,occurred_at:new Date().toISOString()}]});
      json({message:'Refunded order closed.',data:orders[1]});return true;
    }
    const payment=route.match(/^\/api\/admin\/orders\/(7[1-4])\/gateway-payment$/);
    if(payment){
      const id=Number(payment[1]),extra=id===74,allowed=id===73||(extra&&role==='admin'),action={allowed,kind:extra?'extra_payment':'closed_order',label:extra?'Return extra payment':role==='admin'?'Issue refund':'Request refund'};
      json({can_approve:role==='admin',payments:{data:[{id,order_id:id,order_no:'RF-'+id,status:'paid',lifecycle_status:id===73?'cancelled':'pending',amount:200,refund_action:action}]},receipts:[{payment_id:id,provider_payment_id:'pay_primary'+id,source_type:'qrph',amount_centavos:20000,refund_action:{...action,allowed:id===73}},...(extra?[{payment_id:id,provider_payment_id:'pay_extra',source_type:'qrph',amount_centavos:20000,refund_action:action}]:[])],refunds:[],attempts:[]});return true;
    }
    if(route==='/api/admin/gateway-payments'){json({can_approve:role==='admin',payments:{data:[],last_page:1},receipts:[],refunds:[],attempts:[]});return true;}
    return false;
  });
  await h.send('Network.setBlockedURLs',{urls:['https://*']});
  await h.go('/'+role+'-page/orders.html');await h.until(`document.querySelector('[data-order-view="71"]')`);
  for(const [id,expected]of [[71,null],[73,role==='admin'?'Issue refund':'Request refund'],[74,role==='admin'?'Return extra payment':null]]){
    await h.run(`document.querySelector('[data-order-view="${id}"]').click()`);await h.until(`document.getElementById('modalOrderDetails').dataset.orderId==='${id}'`);
    await h.run(`document.querySelector('#modalOrderDetails [data-gateway-manage]').click()`);await h.until(`document.querySelector('dialog.gateway-team-dialog')?.open`);
    assert.equal(await h.run(`document.querySelector('dialog.gateway-team-dialog [data-title]').textContent`),'Payment details');
    assert.equal(await h.run(`document.querySelector('dialog.gateway-team-dialog [type=submit]').hidden`),expected===null);
    if(expected)assert.equal(await h.run(`document.querySelector('dialog.gateway-team-dialog [type=submit]').textContent`),expected);
    if(id===74&&role==='admin'){
      await h.run(`document.querySelector('dialog.gateway-team-dialog [type=submit]').click()`);
      assert.equal(await h.run(`document.querySelectorAll('dialog.gateway-team-dialog [name=provider_payment_id] option').length`),1);
      assert.equal(await h.run(`document.querySelector('dialog.gateway-team-dialog [name=provider_payment_id]').value`),'pay_extra');
    }
    await h.run(`document.querySelector('dialog.gateway-team-dialog [data-cancel]').click()`);
  }
  await h.run(`document.querySelector('[data-order-view="72"]').click()`);await h.until(`document.querySelector('[data-refunded-review]')?.hidden===false`);
  assert.equal(await h.run(`!!document.querySelector('[data-refunded-review] form')`),role==='admin');
  assert.equal(await h.run(`document.querySelector('[data-manage-fulfillment]').hidden`),true);
  if(role==='admin'){
    for(const width of [320,390,768,1024,1440])for(const theme of ['light','dark']){
      await h.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});
      await h.run(`document.documentElement.dataset.theme='${theme}'`);
      assert.equal(await h.run(`(()=>{const b=document.querySelector('#modalOrderDetails .modal-body-scroll');return b.scrollWidth<=b.clientWidth+1})()`),true,width+' '+theme);
      await h.shot(role+'-refunded-review-'+width+'-'+theme);
    }
    await h.run(`document.getElementById('refundedCloseReason').value='Refund checked; one cup is reusable';document.getElementById('restoreProduct1').value='1';document.querySelector('[name=non_fulfillment_confirmed]').checked=true;document.querySelector('.refunded-order-form button').click()`);
    await h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupOk')`);await h.run(`document.getElementById('adminSystemPopupOk').click()`);
    await h.until(`document.getElementById('adminSystemPopupTitle').textContent==='Closure not saved'`);
    assert.equal(await h.run(`document.getElementById('restoreProduct1').value`),'1');
    assert.equal(await h.run(`document.getElementById('refundedCloseReason').value`),'Refund checked; one cup is reusable');
    await h.run(`document.getElementById('adminSystemPopupOk').click();document.querySelector('.refunded-order-form button').click()`);
    await h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupOk')`);await h.run(`document.getElementById('adminSystemPopupOk').click()`);
    await h.until(`document.querySelector('.admin-success-notification__message')?.textContent==='Refunded order closed.'`);
    assert.equal(await h.run(`document.querySelector('[data-refunded-review]').hidden`),true);
    assert.equal(writes.length,2);assert.deepEqual(writes[1].stock_items,[{product_id:1,quantity:1},{product_id:2,quantity:0}]);
  }
  assert.deepEqual(await h.run('fixtureErrors'),[]);t.diagnostic('Screenshots: '+h.artifacts);
});

test('customer sees refunded active order only in All, then Cancelled after Admin closure',{skip:!chrome,timeout:60000},async t=>{
  let current={...order(72),payment_status:'refunded',payment_is_refunded:true,payment_is_confirmed:false,refund_review:{required:true,label:'Refunded — FMRC review required'}};
  const profile={id:3,role:'customer',email:'client@example.test',name:'Refund Customer'};
  const h=await browserFixture(t,async({route,json})=>{
    if(route==='/api/user'){json(profile);return true;}if(route==='/api/customer/orders'){json({data:[current],returns:[]});return true;}if(route==='/api/customer/orders/72'){json({data:current});return true;}return false;
  });
  await h.send('Network.setBlockedURLs',{urls:['https://*']});
  await h.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('customer_token','fixture-customer');localStorage.setItem('customer_info',${JSON.stringify(JSON.stringify(profile))});`});
  await h.go('/products-page/product.html');await h.until(`document.getElementById('viewOrdersBtn')`);await h.run(`document.getElementById('viewOrdersBtn').click()`);
  await h.until(`document.querySelector('[data-panel="all"]').textContent.includes('Refunded — FMRC review required')`);
  assert.equal(await h.run(`document.querySelector('[data-panel="to_ship"]').textContent.includes('Bamboo cup')`),false);
  assert.equal(await h.run(`!!document.querySelector('[data-panel="all"] .customer-order-cancel-btn')`),false);
  current={...current,lifecycle_status:'cancelled',refund_review:{required:false}};
  await h.run(`window.dispatchEvent(new CustomEvent('fmrc:orders-updated',{detail:{type:'refunded-order-closed',orderId:72}}))`);
  await h.until(`document.querySelector('[data-panel="cancelled"]').textContent.includes('Bamboo cup')`);
  assert.deepEqual(await h.run('fixtureErrors'),[]);
});
