// Actual shared pages, isolated API fixtures. No live order or payment is changed.
const test=require('node:test');
const assert=require('node:assert/strict');
const {browserFixture,chrome}=require('./helpers/website-browser.cjs');
const requestOrder=()=>({id:61,order_no:'ORD-000061',order_no_display:'#ORD-000061',customer_name:'Review Customer',customer_contact:'customer@example.test',product_name:'Bamboo cup',quantity:2,total_amount:200,total_label:'₱200.00',payment_method:'GCash',payment_method_label:'QR Ph',payment_is_automated:true,payment_status:'pending',payment_eligibility:{allowed:false},fulfillment_type:'pickup',is_pickup:true,lifecycle_status:'incoming',customer_stage:'to_pay',customer_stage_label:'Awaiting FMRC review',awaiting_review:true,created_at:'2026-11-13T09:00:00+08:00',items:[{product_id:1,product_name:'Bamboo cup',quantity:2,unit_price:100,line_total:200}],review:{required:true,status:'pending',label:'Awaiting FMRC review',awaiting_review:true,can_review:true,availability:[{product_name:'Bamboo cup',quantity:2,available:3}]},approval:{allowed:false,label:'Start preparation',reason:'Awaiting FMRC review'},payment_actions:{paid:{allowed:false,reason:'Awaiting FMRC review'},pending:{allowed:false},refunded:{allowed:false}},timeline:[],can_cancel:true,cancel_state:'none',cancellation:{allowed:true,immediate:true}});

for(const mode of ['single','cart'])test(mode+' checkout retains failed submissions and requests review without opening payment',{skip:!chrome,timeout:90000},async t=>{
  const profile={id:3,role:'customer',name:'Review Customer',email:'customer@example.test',phone_number:'09171234567'};
  const products=[1,2,3].map(id=>({id,name:'Product '+id,category:'Products',code:'REV'+id,price:100,stock:10,stock_status:'in_stock',is_blocked:false,image_data:'/images/FMRC Logo.png'}));
  const cart=products.map(p=>({product_id:p.id,title:p.name,image:p.image_data,unitPrice:100,quantity:1,checked:p.id!==3}));
  const policy={version:'12345678-1234-4234-8234-123456789abc',title:'Transaction Terms',terms_text:'Review the submitted request.',refund_text:'Contact FMRC for assistance.'};
  const writes=[];let paymentWrites=0;
  const h=await browserFixture(t,async({req,route,json})=>{
    if(route==='/api/user'){json(profile);return true;}
    if(route==='/api/customer/profile'){json({data:profile});return true;}
    if(route==='/api/products'){json({data:products});return true;}
    if(route==='/api/site-settings'){json({data:{payment_cash_on_pickup_enabled:'1',payment_gcash_enabled:'1',payment_gcash_ready:'1',payment_checkout_method:'qrph'}});return true;}
    if(route.startsWith('/api/commerce/policy')){json({data:policy});return true;}
    if(route==='/api/shipping/quote'){
      let body='';for await(const c of req)body+=c;const input=JSON.parse(body),subtotal=input.items.reduce((n,i)=>n+i.quantity*100,0);
      json({data:{available:true,fulfillment_type:input.fulfillment_type,item_subtotal:subtotal,shipping_fee:0,payable_total:subtotal,expires_at:new Date(Date.now()+900000).toISOString(),quote_token:'fixture-review-quote'}});return true;
    }
    if(route==='/api/orders'&&req.method==='POST'){
      let body='';for await(const c of req)body+=c;writes.push(JSON.parse(body));
      if(writes.length===1)json({message:'Request could not be saved. Please try again.'},503);
      else json({data:requestOrder()},201);return true;
    }
    if(route.includes('payment-checkout')){paymentWrites++;json({message:'Not approved'},422);return true;}
    return false;
  });
  await h.send('Network.setBlockedURLs',{urls:['https://*']});
  await h.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('customer_token','fixture-customer');localStorage.setItem('customer_info',${JSON.stringify(JSON.stringify(profile))});localStorage.setItem('fmrc_cart_items_3',${JSON.stringify(JSON.stringify(cart))});`});
  await h.go('/products-page/product.html');
  await h.until(`document.querySelectorAll('.cart-item-card').length===3&&document.getElementById('displayClientName').textContent.includes('Review')`);
  if(mode==='cart')await h.run(`document.getElementById('cartCheckoutSubmitBtn').click()`);
  else await h.run(`document.dispatchEvent(new CustomEvent('product:buy-now',{detail:${JSON.stringify(products[0])}}))`);
  await h.until(`document.getElementById('checkoutModal').classList.contains('show-modal')`);
  await h.run(`document.getElementById('hiddenPaymentSelect').value='GCash';document.getElementById('hiddenPaymentSelect').dispatchEvent(new Event('change'));document.getElementById('fulfillPickupRadio').checked=true;document.getElementById('fulfillPickupRadio').dispatchEvent(new Event('change'));`);
  await h.until(`!document.getElementById('orderTerms').disabled&&document.getElementById('checkoutShippingFee').textContent.includes('0.00')`);
  await h.run(`document.getElementById('orderTerms').click()`);await h.until(`!document.getElementById('submitOrderBtn').disabled`);
  for(const width of [320,390,768,1024,1440]){
    await h.send('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:width<600});
    assert.equal(await h.run(`(()=>{const r=document.getElementById('submitOrderBtn').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1})()`),true,mode+' checkout footer '+width);
  }
  await h.run(`document.getElementById('submitOrderBtn').click()`);
  await h.until(`document.getElementById('customerSystemPopup')?.classList.contains('show')`);
  assert.match(await h.run(`document.getElementById('customerSystemPopupMessage').textContent`),/could not be saved/);
  assert.equal(await h.run(`document.querySelectorAll('.cart-item-card').length`),3);
  assert.equal(await h.run(`document.getElementById('checkoutModal').classList.contains('show-modal')&&document.getElementById('orderTerms').checked&&document.getElementById('hiddenPaymentSelect').value==='GCash'`),true);
  await h.run(`document.getElementById('customerSystemPopupOk').click()`);await h.until(`!document.getElementById('submitOrderBtn').disabled`);
  await h.run(`document.getElementById('submitOrderBtn').click()`);
  await h.until(`document.getElementById('orderSuccessModal').classList.contains('active')`);
  assert.equal(writes.length,2);assert.equal(writes[0].checkout_request_key,writes[1].checkout_request_key);
  assert.equal(writes[1].fulfillment_type,'pickup');assert.equal(writes[1].payment_method,'GCash');
  if(mode==='cart'){assert.deepEqual(writes[1].items.map(i=>i.product_id),[1,2]);assert.deepEqual(await h.run(`JSON.parse(localStorage.getItem('fmrc_cart_items_3')).map(i=>i.product_id)`),[3]);}
  else {assert.equal(writes[1].product_id,1);assert.equal(await h.run(`document.querySelectorAll('.cart-item-card').length`),3);}
  assert.equal(paymentWrites,0);assert.equal(await h.run(`!!document.querySelector('dialog.fmrc-gateway-dialog[open]')`),false);
  assert.match(await h.run(`document.getElementById('orderSuccessModal').textContent`),/awaiting FMRC review/);
  assert.deepEqual(await h.run('fixtureErrors'),[]);
});

for(const role of ['admin','staff'])test(role+' reviews requests with shared feedback and preserves failed decisions',{skip:!chrome,timeout:90000},async t=>{
  let order=requestOrder(),fail=true,writes=[],releaseReview,decisionStarted;
  const decisionPending=new Promise(resolve=>decisionStarted=resolve);
  const h=await browserFixture(t,async({req,route,json})=>{
    if(route==='/api/admin/orders'){json({review:order.awaiting_review?[order]:[],incoming:!order.awaiting_review&&order.lifecycle_status==='incoming'?[order]:[],directory:order.lifecycle_status==='rejected'?[order]:[],payments:[],returns:[]});return true;}
    if(route==='/api/admin/orders/61'){json({data:order});return true;}
    if(route==='/api/admin/orders/61/review'){
      let body='';for await(const c of req)body+=c;const input=JSON.parse(body);writes.push(input);
      if(fail){fail=false;json({message:'Stock changed. Review availability before trying again.'},422);return true;}
      const rejected=input.decision==='reject';order={...order,awaiting_review:false,lifecycle_status:rejected?'rejected':'incoming',review:{...order.review,status:rejected?'rejected':'approved',label:rejected?'Request declined':'Approved by FMRC',awaiting_review:false,can_review:false,reason:input.reason},payment_eligibility:{allowed:!rejected}};
      await new Promise(resolve=>{releaseReview=resolve;decisionStarted();});
      json({message:rejected?'Request declined.':'Request approved. Payment is now available.',data:order});return true;
    }return false;
  });
  await h.send('Network.setBlockedURLs',{urls:['https://*']});
  await h.go('/'+role+'-page/orders.html');await h.until(`document.querySelector('#orderReviewTable [data-order-view="61"]')`);
  assert.equal(await h.run(`!!document.querySelector('#incomingOrdersTable [data-order-view="61"]')`),false);
  await h.run(`document.querySelector('#orderReviewTable [data-order-view="61"]').click()`);
  await h.until(`document.querySelector('[data-review-decision="approve"]')?.disabled===false`);
  assert.match(await h.run(`document.querySelector('[data-request-review]').textContent`),/Available: 3/);
  await h.run(`const reason=document.getElementById('orderReviewReason');reason.value='Keep this draft';reason.focus();reason.setSelectionRange(3,6);`);
  order.review.availability[0].available=4;
  await h.run(`window.AdminOrderDialogs.load(61)`);
  assert.equal(await h.run(`document.activeElement.id==='orderReviewReason'&&document.activeElement.value==='Keep this draft'&&document.activeElement.selectionStart===3&&document.activeElement.selectionEnd===6`),true,'Saved updates preserve the review draft and keyboard selection');
  for(const width of [320,390,768,1024,1440])for(const theme of ['light','dark']){
    await h.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});
    await h.run(`document.documentElement.dataset.theme='${theme}'`);
    assert.equal(await h.run(`(()=>{const body=document.querySelector('#modalOrderDetails .modal-body-scroll');return body.scrollWidth<=body.clientWidth+1})()`),true,role+' '+width+' '+theme);
    const fields=await h.run(`(()=>{const field=document.getElementById('orderReviewReason'),label=field.labels[0],hint=document.getElementById(field.getAttribute('aria-describedby')),buttons=[...document.querySelectorAll('.order-review-actions button')];return {labelSize:parseFloat(getComputedStyle(label).fontSize),fieldSize:parseFloat(getComputedStyle(field).fontSize),hintSize:parseFloat(getComputedStyle(hint).fontSize),family:getComputedStyle(field).fontFamily,buttons:buttons.map(b=>({height:b.getBoundingClientRect().height,size:parseFloat(getComputedStyle(b).fontSize),overflow:b.scrollWidth>b.clientWidth+1}))}})()`);
    assert(fields.labelSize>=12&&fields.labelSize<=14&&fields.fieldSize>=12&&fields.fieldSize<=14&&fields.hintSize>=11&&fields.hintSize<=13,JSON.stringify(fields));
    assert.match(fields.family,/Poppins/);
    assert(fields.buttons.every(b=>b.height>=40&&b.size<=14&&!b.overflow),JSON.stringify(fields));
    assert(Math.abs(fields.buttons[0].height-fields.buttons[1].height)<1,JSON.stringify(fields));
    await h.shot(role+'-review-'+width+'-'+theme);
  }
  await h.run(`document.getElementById('orderReviewReason').value='Customer-visible reason retained after failure';document.querySelector('[data-review-decision="approve"]').click()`);
  await h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupOk')`);await h.run(`document.getElementById('adminSystemPopupOk').click()`);
  await h.until(`document.querySelector('#adminSystemPopupTitle')?.textContent==='Review not saved'`);
  assert.equal(await h.run(`document.getElementById('orderReviewReason').value`),'Customer-visible reason retained after failure');
  await h.run(`document.getElementById('adminSystemPopupOk').click()`);
  const decision=role==='admin'?'approve':'reject';
  await h.run(`document.querySelector('[data-review-decision="${decision}"]').click()`);await h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupOk')`);await h.run(`document.getElementById('adminSystemPopupOk').click()`);
  await decisionPending;
  await h.run(`document.querySelector('[data-modal-close="#modalOrderDetails"]').click()`);releaseReview();
  await h.until(`!document.querySelector('#orderReviewTable [data-order-view="61"]')`);
  assert.equal(await h.run(`document.getElementById('modalOrderDetails').classList.contains('show')`),false,'A delayed decision cannot reopen a dismissed order');
  assert.equal(writes.length,2);assert.equal(writes[1].decision,decision);
  if(decision==='approve'){assert.equal(await h.run(`!!document.querySelector('#incomingOrdersTable [data-order-view="61"]')`),true);assert.match(await h.run(`document.querySelector('#incomingOrdersTable').textContent`),/Awaiting payment/);}
  else assert.equal(writes[1].reason,'Customer-visible reason retained after failure');
  assert.deepEqual(await h.run('fixtureErrors'),[]);t.diagnostic('Screenshots: '+h.artifacts);
});

test('review queues share oldest-first pagination, search and responsive tables',{skip:!chrome,timeout:90000},async t=>{
  const orders=Array.from({length:12},(_,i)=>({...requestOrder(),id:61+i,order_no:'ORD-'+(61+i),order_no_display:'#ORD-'+(61+i),customer_name:'Customer '+(61+i),created_at:`2026-11-${String(i+1).padStart(2,'0')}T09:00:00+08:00`})).reverse();
  const h=await browserFixture(t,async({route,json})=>{if(route==='/api/admin/orders'){json({review:orders,incoming:[],directory:[],payments:[],returns:[]});return true;}return false;});
  await h.send('Network.setBlockedURLs',{urls:['https://*']});
  for(const role of ['admin','staff']){
    await h.go('/'+role+'-page/orders.html');await h.until(`document.querySelectorAll('#orderReviewTable [data-order-view]').length===10`);
    assert.equal(await h.run(`document.querySelector('#orderReviewTable [data-order-view]').dataset.orderView`),'61');
    await h.run(`document.querySelectorAll('#orderReviewFooter .page-btn')[1].click()`);
    assert.deepEqual(await h.run(`[...document.querySelectorAll('#orderReviewTable [data-order-view]')].map(b=>b.dataset.orderView)`),['71','72']);
    await h.run(`document.getElementById('orderReviewSearch').value='Customer 66';document.getElementById('orderReviewSearch').dispatchEvent(new Event('input'))`);
    assert.deepEqual(await h.run(`[...document.querySelectorAll('#orderReviewTable [data-order-view]')].map(b=>b.dataset.orderView)`),['66']);
    for(const width of [320,390,768,1024,1440]){
      await h.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});
      await h.until(`document.getElementById('orderReviewPanel').getBoundingClientRect().right<=innerWidth+1`);
      assert.equal(await h.run(`getComputedStyle(document.querySelector('#orderReviewTable td.sticky-action')).position`),'sticky');
    }
    await h.run(`document.getElementById('orderReviewSearch').value='No matching customer';document.getElementById('orderReviewSearch').dispatchEvent(new Event('input'))`);
    assert.match(await h.run(`document.getElementById('orderReviewTable').textContent`),/No requests are awaiting/);
    assert.deepEqual(await h.run('fixtureErrors'),[]);
  }
});

test('customer sees review status, shared success modal and payment only after approval',{skip:!chrome,timeout:90000},async t=>{
  let order=requestOrder(),paymentWrites=0;
  const profile={id:3,role:'customer',name:'Review Customer',email:'customer@example.test'};
  const h=await browserFixture(t,async({req,route,json})=>{
    if(route==='/api/user'){json(profile);return true;}
    if(route==='/api/customer/orders'){json({data:[order],returns:[]});return true;}
    if(route==='/api/customer/orders/61'){json({data:order});return true;}
    if(route.includes('payment-checkout')){paymentWrites++;json({message:'Not approved'},422);return true;}
    if(route.includes('payment-status')){json({status:'pending',order_status:'incoming',checkout_method:'qrph',payment_blocked_reason:'Awaiting FMRC review',retry_allowed:false,checkout_url:null});return true;}
    return false;
  });
  await h.send('Network.setBlockedURLs',{urls:['https://*']});
  await h.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('customer_token','fixture-customer');localStorage.setItem('customer_info',${JSON.stringify(JSON.stringify(profile))});`});
  await h.go('/products-page/product.html');await h.until(`!!window.FMRCOrderRequestSuccess&&!!document.getElementById('viewOrdersBtn')`);
  assert.equal(await h.run(`!!document.getElementById('productMyOrdersBtn')`),false,'The navbar shortcut is removed; the profile entry remains');
  assert.equal(await h.run(`document.getElementById('submitOrderBtn').textContent.trim()`),'Submit Order Request');
  await h.run(`void window.FMRCOrderRequestSuccess('#ORD-000061')`);
  await h.until(`document.activeElement.id==='orderSuccessViewOrdersBtn'`);
  await h.run(`document.getElementById('orderSuccessViewOrdersBtn').click()`);
  await h.until(`document.querySelector('.customer-orders-tab[data-tab="awaiting_review"]')`);
  await h.run(`document.querySelector('.customer-orders-tab[data-tab="awaiting_review"]').click()`);
  await h.until(`document.querySelector('[data-panel="awaiting_review"]').textContent.includes('Bamboo cup')`);
  assert.equal(await h.run(`!!document.querySelector('[data-panel="awaiting_review"] [data-gateway-order]')`),false);
  assert.equal(await h.run(`document.querySelector('[data-panel="to_pay"]').textContent.includes('Bamboo cup')`),false);
  for(const width of [320,390,768,1024,1440]){
    await h.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});
    await h.until(`(()=>{const modal=document.querySelector('#customerOrdersModal > section');return modal.getBoundingClientRect().left>=0&&modal.getBoundingClientRect().right<=innerWidth+1})()`);
    await h.pause(350);
    const positions=await h.run(`(()=>{const v=document.getElementById('customerOrdersViewport'),p=document.querySelector('[data-panel="awaiting_review"]'),r=p.getBoundingClientRect(),vr=v.getBoundingClientRect();return {left:r.left,viewportLeft:vr.left,width:r.width,viewportWidth:v.clientWidth,scroll:v.scrollLeft,transform:getComputedStyle(document.getElementById('customerOrdersTrack')).transform}})()`);
    assert(Math.abs(positions.left-positions.viewportLeft-1)<2,JSON.stringify({width,positions}));
    const strip=await h.run(`(()=>{const s=document.getElementById('customerOrdersTabs'),r=s.getBoundingClientRect();return {width:s.clientWidth,content:s.scrollWidth,tabs:[...s.querySelectorAll('button')].map(b=>{const br=b.getBoundingClientRect(),lr=b.querySelector('.customer-orders-tab-label').getBoundingClientRect();return {top:br.top-r.top,height:br.height,room:br.width-lr.width,font:parseFloat(getComputedStyle(b).fontSize),overflow:b.scrollWidth>b.clientWidth+1}})}})()`);
    assert.equal(strip.tabs.length,9);
    assert(strip.tabs.every(b=>Math.abs(b.top-strip.tabs[0].top)<1&&b.height===strip.tabs[0].height&&b.room>=24&&!b.overflow),JSON.stringify({width,strip}));
    if(width>=1024)assert(strip.content<=strip.width+1,JSON.stringify({width,strip}));
    await h.shot('customer-review-'+width);
  }
  await h.send('Emulation.setDeviceMetricsOverride',{width:768,height:900,deviceScaleFactor:1,mobile:false});
  await h.run(`document.querySelector('.customer-orders-tab[data-tab="cancelled"]').focus()`);
  await h.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});
  await h.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
  await h.until(`(()=>{const s=document.getElementById('customerOrdersTabs').getBoundingClientRect(),b=document.querySelector('.customer-orders-tab.active');const r=b.getBoundingClientRect();return b.dataset.tab==='cancelled'&&r.left>=s.left-1&&r.right<=s.right+1})()`);
  order={...order,awaiting_review:false,review:{...order.review,status:'approved',label:'Approved by FMRC',awaiting_review:false},payment_eligibility:{allowed:true},awaiting_customer_payment:true};
  await h.run(`window.dispatchEvent(new CustomEvent('fmrc:orders-updated',{detail:{type:'review',orderId:61}}))`);
  await h.until(`!!document.querySelector('[data-panel="to_pay"] [data-gateway-order="61"]')`);
  assert.equal(await h.run(`document.querySelector('[data-panel="awaiting_review"]').textContent.includes('Bamboo cup')`),false);
  assert.equal(paymentWrites,0);assert.deepEqual(await h.run('fixtureErrors'),[]);t.diagnostic('Screenshots: '+h.artifacts);
});
