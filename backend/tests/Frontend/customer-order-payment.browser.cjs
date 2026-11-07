// Actual Customer pages and payment dialog. All API/provider responses are isolated
// fixtures; no live checkout, payment or customer record is contacted by this test.
const test = require('node:test');
const assert = require('node:assert/strict');
const {browserFixture, chrome} = require('./helpers/website-browser.cjs');

test('order details share hosted checkout and verified refresh on normal and Customer PWA routes', {skip:!chrome,timeout:120000}, async t => {
  const confirmed = new Set(), checkoutPosts = [], hosted = [], errors = [];
  let checkoutFailure = true, statusFailure = false;
  const profile = {id:33,role:'customer',name:'Customer Fixture',email:'customer@example.test'};
  const order = id => {
    const paid=confirmed.has(id),custom=id===102;
    return {id,order_no:`ORD-000${id}`,order_no_display:`#ORD-000${id}`,product_name:custom?'Cup':'Catalog cup',quantity:3,
      total_amount:160,total_label:'₱160.00',subtotal_amount:150,shipping_fee:10,shipping_fee_label:'₱10.00',
      lifecycle_status:'incoming',customer_stage:'to_pay',payment_status:paid?'paid':'pending',payment_method:'GCash',payment_method_label:'QR Ph',
      payment_is_automated:true,payment_is_confirmed:paid,payment_is_refunded:false,payment_checkout_method:'qrph',
      awaiting_customer_payment:!paid,fulfillment_type:'delivery',order_type:custom?'custom':'regular',created_at:new Date().toISOString(),
      accepted_policy:{version:'accepted-fixture',accepted_at_label:'Nov 07, 2026 02:32 PM'},
      items:[{product_name:custom?'Cup':'Catalog cup',quantity:3,unit_price:50,line_total:150}],tracking_events:[],
      ...(custom?{custom_product:{job_id:71,appointment_id:54,appointment_reference:'AP-00054',service:'3D Printing',quotation_version:1,
        stage:paid?'Paid — Awaiting Production':'Awaiting payment',revision:0,cash_entries:[],available_actions:{},
        agreement:{specifications:{name:'Cup',description:'Cup with handle',quantity:3,dimensions:'8 x 10 cm',material:'PLA',colors:'Red and white',finish:'Matte'},
          design_notes:'Agreed design',lead_time:'Five working days',total:160,shipping_fee:10,fulfillment_type:'delivery'}}}:{})};
  };
  const h=await browserFixture(t,async({req,route,json})=>{
    if(route==='/api/user'){json(profile);return true;}
    if(route==='/api/site-settings'){json({data:{payment_checkout_method:'qrph',payment_gcash_ready:'1'}});return true;}
    const cached=data=>{const etag='"'+[...confirmed].sort().join('-')+'"';json(data,req.headers['if-none-match']===etag?304:200,{ETag:etag});};
    if(route==='/api/customer/orders'){cached({data:[order(102),order(103)],returns:[]});return true;}
    const match=route.match(/^\/api\/customer\/orders\/(102|103)(?:\/(payment-status|payment-checkout))?$/);
    if(!match)return false;
    const id=Number(match[1]),paid=confirmed.has(id);
    if(!match[2]){cached({data:order(id)});return true;}
    if(match[2]==='payment-status'){
      if(statusFailure){statusFailure=false;json({message:'Payment check is unavailable. Please try again.'},503);return true;}
      json({status:paid?'paid':'pending',order_status:'incoming',checkout_method:'qrph',method_label:'QR Ph',retry_allowed:!paid,checkout_url:null,refunds:[]});return true;
    }
    let body='';for await(const chunk of req)body+=chunk;
    checkoutPosts.push({id,...JSON.parse(body||'{}')});
    await h.pause(120);
    if(checkoutFailure){checkoutFailure=false;json({message:'Checkout could not be opened. Please try again.'},503);return true;}
    json({status:'pending',checkout_method:'qrph',checkout_url:`https://checkout.paymongo.com/fixture-${id}`});return true;
  });
  // Intercept external navigation before it leaves the local browser fixture.
  h.on('Fetch.requestPaused',async({requestId,request,resourceType})=>{
    try {
      if(resourceType==='Document'&&request.url.startsWith('https://checkout.paymongo.com/')){
        hosted.push(request.url);
        await h.send('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/html'}],body:Buffer.from('<!doctype html><title>Isolated hosted checkout</title><p>Provider navigation fixture</p>').toString('base64')});
      } else await h.send('Fetch.failRequest',{requestId,errorReason:'Aborted'});
    } catch(error){errors.push(error.message);}
  });
  await h.send('Fetch.enable',{patterns:[{urlPattern:'https://*',requestStage:'Request'}]});
  await h.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('customer_token','fixture-customer');localStorage.setItem('customer_info',${JSON.stringify(JSON.stringify(profile))});`});
  const openOrder=async(route,id)=>{
    await h.go(route+(route.includes('?')?'&':'?')+'orders=1&order_id='+id);
    try {await h.until(`document.querySelector('#customerOrderDetailModal.show .customer-order-detail-payment [data-gateway-order="${id}"]')`);}
    catch(error){await h.shot('order-error');t.diagnostic(JSON.stringify(await h.run(`({url:location.href,token:!!localStorage.getItem('customer_token'),title:document.title,modal:document.querySelector('#customerOrdersModal')?.className,detail:document.querySelector('#customerOrderDetailContent')?.textContent,body:document.body.innerText.slice(-1000)})`)));t.diagnostic('Screenshots: '+h.artifacts);throw error;}
  };
  const paymentButton='#customerOrderDetailContent .customer-order-detail-payment [data-gateway-order]';
  await openOrder('/home-page/',102);
  const links=await h.run(`Array.from(document.querySelectorAll('.customer-order-policy-link')).map(a=>({label:a.textContent.trim(),href:a.getAttribute('href'),target:a.target}))`);
  assert.deepEqual(links.map(a=>a.label),['Transaction Terms','Refund Policy']);
  for(const a of links){assert(a.href.includes('version=accepted-fixture'));assert.equal(a.target,'_blank');}
  const buttonStyles=await h.run(`[document.querySelector(${JSON.stringify(paymentButton)}),document.querySelector('.customer-order-actions [data-gateway-order="102"]')].map(node=>{const s=getComputedStyle(node);return {background:s.backgroundColor,color:s.color,font:s.fontFamily,size:s.fontSize,radius:s.borderRadius,height:node.getBoundingClientRect().height};})`);
  assert.deepEqual(buttonStyles[0],buttonStyles[1],'The detail action uses the same maroon button recipe as the order list');
  for(const width of [320,390,768,1440]){
    await h.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await h.run(`document.querySelector('.customer-order-policy').scrollIntoView({block:'center',behavior:'instant'})`);
    const layout=await h.run(`(()=>{const card=document.querySelector('.customer-order-policy'),payment=document.querySelector('.customer-order-detail-payment'),button=payment.querySelector('button');return {overflow:card.scrollWidth>card.clientWidth+1,contentOverflow:document.querySelector('#customerOrderDetailContent').scrollWidth>document.querySelector('#customerOrderDetailContent').clientWidth+1,links:[...card.querySelectorAll('a')].map(a=>({font:getComputedStyle(a).fontFamily,size:parseFloat(getComputedStyle(a).fontSize),height:a.getBoundingClientRect().height,width:a.getBoundingClientRect().width})),buttonHeight:button.getBoundingClientRect().height};})()`);
    await h.shot('custom-order-policy-'+width);
    assert.equal(layout.overflow,false,JSON.stringify({width,layout}));assert.equal(layout.contentOverflow,false);
    assert(layout.links.every(a=>a.size>=12&&a.size<=14&&a.height>=40&&a.height<=44&&a.font.includes('Montserrat')),JSON.stringify(layout));
    assert(layout.buttonHeight>=40&&layout.buttonHeight<=44,JSON.stringify(layout));
  }
  await h.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await h.run(`document.querySelector('.customer-order-policy-link').scrollIntoView({block:'center',behavior:'instant'})`);
  const point=await h.run(`(()=>{const r=document.querySelector('.customer-order-policy-link').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  await h.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
  await h.until(`getComputedStyle(document.querySelector('.customer-order-policy-link')).backgroundColor==='rgb(107, 32, 43)'`);
  const hover=await h.run(`(()=>{const s=getComputedStyle(document.querySelector('.customer-order-policy-link'));return {background:s.backgroundColor,color:s.color,duration:s.transitionDuration};})()`);
  assert.equal(hover.background,'rgb(107, 32, 43)');assert.equal(hover.color,'rgb(255, 255, 255)');assert.match(hover.duration,/0.12s/);
  await h.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});
  await h.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  assert.equal(await h.run(`getComputedStyle(document.querySelector('.customer-order-policy-link')).transitionDuration`),'0s');
  await h.send('Emulation.setEmulatedMedia',{features:[]});
  await h.run(`document.querySelector(${JSON.stringify(paymentButton)}).focus()`);
  assert.equal(await h.run(`getComputedStyle(document.querySelector(${JSON.stringify(paymentButton)})).outlineStyle`),'solid');
  statusFailure=true;
  await h.run(`document.querySelector(${JSON.stringify(paymentButton)}).click()`);
  await h.until(`document.querySelector('[data-gateway-status]')?.textContent==='Status unavailable'`);
  await h.run(`document.querySelector('[data-gateway-refresh]').click()`);
  await h.until(`!document.querySelector('[data-gateway-continue]').hidden`);
  await h.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});
  await h.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});
  await h.until(`!document.querySelector('dialog.fmrc-gateway-dialog').open`);
  assert.equal(await h.run(`document.querySelector('#customerOrderDetailModal').classList.contains('show')`),true);
  await h.until(`document.activeElement===document.querySelector(${JSON.stringify(paymentButton)})`);
  await h.run(`document.querySelector(${JSON.stringify(paymentButton)}).click()`);
  await h.until(`!document.querySelector('[data-gateway-continue]').hidden`);
  await h.run(`document.querySelector('[data-gateway-continue]').click();document.querySelector('[data-gateway-continue]').click()`);
  await h.until(`document.querySelector('[data-gateway-error]')?.textContent.includes('Checkout could not')`);
  assert.equal(checkoutPosts.length,1,'Duplicate clicks reserve one checkout request');
  assert.equal(await h.run(`document.querySelector('#customerOrderDetailModal').classList.contains('show')`),true);
  await h.run(`document.querySelector('[data-gateway-continue]').click()`);
  await h.until(`document.title==='Isolated hosted checkout'`);
  assert.deepEqual(hosted,['https://checkout.paymongo.com/fixture-102']);
  assert.equal(checkoutPosts.length,2,'Only an explicit retry follows a failed request');
  assert.equal(checkoutPosts[0].app_context,'');

  // Returning from checkout is still pending until the fixture server confirms it.
  await h.go('/products-page/product.html?payment=return&order_id=102');
  await h.until(`document.querySelector('[data-gateway-status]')?.textContent==='Awaiting payment'`);
  assert.equal(await h.run(`document.querySelector('[data-gateway-continue]').hidden`),false);
  assert.equal(checkoutPosts.length,2,'The return URL cannot create a new checkout or confirm payment');
  await openOrder('/home-page/',102);
  assert.equal(await h.run(`document.querySelector(${JSON.stringify(paymentButton)}).textContent`),'Pay online');
  await h.run(`document.querySelector(${JSON.stringify(paymentButton)}).click()`);
  await h.until(`document.querySelector('[data-gateway-status]')?.textContent==='Awaiting payment'`);
  confirmed.add(102);
  await h.until(`document.querySelector('[data-gateway-status]')?.textContent==='Payment confirmed'`);
  await h.until(`document.querySelector('#customerOrderDetailContent [data-ap-order] .ap-badge')?.textContent==='Paid — Awaiting Production'`);
  assert.equal(await h.run(`document.querySelector('[data-gateway-continue]').hidden`),true);
  await h.run(`document.querySelector('[data-gateway-done]').click()`);
  await h.until(`document.activeElement===document.querySelector(${JSON.stringify(paymentButton)})`);
  assert.equal(await h.run(`document.querySelector(${JSON.stringify(paymentButton)}).textContent`),'Payment details');
  assert.equal(await h.run(`document.querySelector('#customerOrderDetailModal').classList.contains('show')`),true);

  // Regular catalog orders and the PWA use the identical payment dialog/endpoint.
  await openOrder('/services-page/service.html',102);
  assert.equal(await h.run(`document.querySelector(${JSON.stringify(paymentButton)}).textContent`),'Payment details');
  await openOrder('/products-page/product.html',103);
  assert.equal(await h.run(`document.querySelector(${JSON.stringify(paymentButton)}).textContent`),'Pay online');
  await h.run(`document.querySelector(${JSON.stringify(paymentButton)}).click()`);
  await h.until(`!document.querySelector('[data-gateway-continue]').hidden`);
  await h.run(`document.querySelector('[data-gateway-continue]').click()`);
  await h.until(`document.title==='Isolated hosted checkout'`);
  assert.equal(hosted.at(-1),'https://checkout.paymongo.com/fixture-103');
  confirmed.delete(102);
  await openOrder('/apps/customer/home-page/',102);
  const scoped=await h.run(`({app:window.FMRCApp?.inApp,links:[...document.querySelectorAll('.customer-order-policy-link')].map(a=>a.getAttribute('href'))})`);
  assert.equal(scoped.app,true);assert(scoped.links.every(href=>new URL(href,h.base).pathname.startsWith('/apps/customer/products-page/')));
  await h.run(`document.querySelector(${JSON.stringify(paymentButton)}).click()`);
  await h.until(`!document.querySelector('[data-gateway-continue]').hidden`);
  await h.run(`document.querySelector('[data-gateway-continue]').click()`);
  await h.until(`document.title==='Isolated hosted checkout'`);
  assert.equal(checkoutPosts.at(-1).app_context,'customer');
  await h.go('/apps/customer/products-page/product.html?payment=return&order_id=102');
  await h.until(`document.querySelector('[data-gateway-status]')?.textContent==='Awaiting payment'`);
  assert.equal(await h.run('window.FMRCApp.inApp'),true);
  assert.deepEqual(await h.run('fixtureErrors'),[]);
  assert.deepEqual(errors,[]);
  t.diagnostic('Screenshots: '+h.artifacts);
});
