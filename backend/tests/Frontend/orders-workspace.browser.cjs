const test=require('node:test'),assert=require('node:assert/strict');
const {browserFixture,chrome}=require('./helpers/website-browser.cjs');
const order=(id,extra={})=>({id,order_no:'ORD-'+id,order_type:'regular',customer_name:'Workspace Customer',product_name:'Prototype',quantity:1,total_amount:110,total_label:'₱110.00',payment_method:'GCash',payment_status:'paid',payment_is_automated:true,payment_actions:{paid:{allowed:false},pending:{allowed:false},refunded:{allowed:false}},lifecycle_status:'pending',customer_stage:'to_ship',customer_stage_label:'To Ship',fulfillment_type:'delivery',shipment_tracking_mode:'jnt_dropoff',courier_name:'J&T Express',items:[{product_name:'Prototype',quantity:1,unit_price:100}],timeline:[],accepted_policy:{version:'accepted-version',accepted_at_label:'Nov 11, 2026, 9:00 AM'},courier_shipment:{tracking_provider:'17track',status:'pending',status_label:'Awaiting handover',can_record:true,can_correct:false,can_refresh:false,availability_message:'Automatic tracking is active.'},...extra});

for(const portal of ['admin','staff'])test(portal+' Orders: approval, section-only refresh, unified history, return guide and ten-row refunds',{skip:!chrome,timeout:90000},async t=>{
  let failRead=false,readDelay=0,reads=0;const writes=[];
  const delivery=order(10),incoming=[order(1,{lifecycle_status:'incoming',payment_status:'pending',approval:{allowed:false,label:'Approve order',reason:'Awaiting payment'}}),order(2,{lifecycle_status:'incoming',approval:{allowed:true,label:'Approve order'}}),order(3,{lifecycle_status:'incoming',payment_method:'COP',payment_status:'pending',payment_is_automated:false,fulfillment_type:'pickup',is_pickup:true,courier_shipment:null,approval:{allowed:true,label:'Approve order'}})];
  const closed=[order(20,{lifecycle_status:'cancelled',cancellation_record:{status:'cancelled',source:'customer',source_label:'Customer',reason:'Changed plans',recorded_at:'2026-11-11T09:00:00+08:00'}}),order(21,{lifecycle_status:'rejected',payment_status:'pending',rejected_order_workspace:'rejected',cancellation_record:{status:'rejected',source:'team',source_label:'FMRC team',reason:'Material unavailable'}}),order(22,{lifecycle_status:'cancelled',order_type:'custom',payment_status:'pending',cancellation_record:{status:'cancelled',source:'unknown',source_label:'Not recorded'}})];
  let returned={id:30,return_no:'RTN-30',return_no_display:'#RTN-30',order_id:10,order_no:'ORD-10',customer_name:'Workspace Customer',status:'requested',resolution:'refund',requested_amount:100,can_decide:true,can_receive:false,can_refund:false,payment_is_automated:true,items:[],timeline:[]};
  const summary=o=>{const {timeline,accepted_policy,...row}=structuredClone(o);return row;};
  const h=await browserFixture(t,async({req,route,json,role})=>{
    if(req.method!=='GET'&&/\/api\/admin\/(orders|returns|gateway-payments)/.test(route))writes.push([req.method,route]);
    if(route==='/api/admin/orders'){json({incoming:incoming.map(summary),directory:[delivery,...closed].map(summary),payments:[],returns:[returned]});return true;}
    const match=route.match(/^\/api\/admin\/orders\/(\d+)$/);
    if(match){reads++;if(readDelay)await new Promise(r=>setTimeout(r,readDelay));if(failRead){failRead=false;json({message:'Saved fulfillment is temporarily unavailable.'},503);return true;}json({data:[delivery,...incoming,...closed].find(o=>o.id===Number(match[1]))});return true;}
    if(route==='/api/admin/returns/30'){json({data:returned});return true;}
    if(route==='/api/admin/gateway-payments'){
      const page=Number(new URL(req.url,'http://fixture').searchParams.get('page')||1);
      const data=Array.from({length:21},(_,i)=>({id:100+i,order_id:100+i,order_no:'REFUND-'+i,customer_name:'Refund Customer',status:'refunded',lifecycle_status:'cancelled',payment_is_automated:true})).slice((page-1)*10,page*10);
      json({payments:{data,total:21,per_page:10,last_page:3},refunds:data.map(p=>({id:p.id,payment_id:p.id,status:'succeeded',amount_centavos:1000})),receipts:[],attempts:[],can_approve:role==='admin'});return true;
    }
    return false;
  });
  await h.send('Network.setBlockedURLs',{urls:['https://*']});
  await h.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await h.go('/'+portal+'-page/orders.html');await h.until("!!document.querySelector('[data-order-view=\"10\"]')");
  assert.equal(await h.run("!!document.querySelector('[data-order-approve=\"1\"]')"),false);
  for(const id of [2,3])assert.equal(await h.run(`!!document.querySelector('[data-order-approve="${id}"]')`),true);
  assert.equal(await h.run("document.querySelector('#ordersDirectoryTable')?.textContent.includes('ORD-20')||false"),false);
  await h.run("document.querySelector('[data-order-view=\"10\"]').click()");await h.until("!!document.querySelector('#modalOrderDetails [data-jnt-load]')&&!!document.querySelector('[data-accepted-policy] a')");
  assert.equal(await h.run("document.querySelector('[data-accepted-policy] a').getAttribute('href')"),'/products-page/transaction-terms.html?version=accepted-version');
  await h.run(`(()=>{const modal=document.getElementById('modalOrderDetails'),input=modal.querySelector('[name="tracking_number"]');input.value='JT-DRAFT';input.dispatchEvent(new Event('input',{bubbles:true}));window.draft=input;window.payment=document.getElementById('modalOrderPayment');window.paymentChanges=0;new MutationObserver(r=>paymentChanges+=r.length).observe(modal.querySelector('[data-order-section="payment"]'),{subtree:true,childList:true,attributes:true});modal.querySelector('[data-jnt-load]').scrollIntoView({block:'center'});window.savedScroll=modal.querySelector('.modal-body-scroll').scrollTop;})()`);
  readDelay=200;delivery.courier_shipment.availability_message='Saved fulfillment readback verified.';
  await h.run("document.querySelector('#modalOrderDetails [data-jnt-load]').click()");await h.until("document.querySelector('#modalOrderDetails [data-jnt-load]').textContent.includes('Refreshing')");
  await h.until("document.querySelector('#modalOrderDetails [data-jnt-message]').textContent.startsWith('Updated')");
  assert.equal(await h.run("paymentChanges"),0);assert.equal(await h.run("draft===document.querySelector('#modalOrderDetails [name=\"tracking_number\"]')&&draft.value==='JT-DRAFT'"),true);
  assert.equal(await h.run("Math.abs(savedScroll-document.querySelector('#modalOrderDetails .modal-body-scroll').scrollTop)<3"),true,JSON.stringify(await h.run("({before:savedScroll,after:document.querySelector('#modalOrderDetails .modal-body-scroll').scrollTop})")));
  assert.equal(await h.run("(()=>{const a=document.querySelector('#modalOrderDetails [data-jnt-submit]').getBoundingClientRect(),b=document.querySelector('#modalOrderDetails [data-jnt-load]').getBoundingClientRect();return Math.abs(a.top-b.top)<2})()"),true);
  failRead=true;await h.run("document.querySelector('#modalOrderDetails [data-jnt-load]').click()");await h.until("document.querySelector('#modalOrderDetails [data-jnt-message]').textContent.includes('could not')");
  assert.equal(await h.run("document.querySelector('#modalOrderDetails [data-jnt-load]').disabled"),false);
  await h.run("document.querySelector('#modalOrderDetails [data-jnt-load]').click()");await h.until("document.querySelector('#modalOrderDetails [data-jnt-message]').textContent.startsWith('Updated')");readDelay=0;
  await h.run("document.querySelector('[data-modal-close=\"#modalOrderDetails\"]').click();document.querySelector('[data-tab=\"cancellations\"]').click();const filter=document.querySelector('[data-cancel-filter]');filter.value='all';filter.dispatchEvent(new Event('change',{bubbles:true}));");
  await h.until("document.querySelector('[data-cancellation-list]').textContent.includes('ORD-22')");
  assert.equal(await h.run("document.querySelector('[data-cancellation-list]').querySelectorAll('tr').length"),3);
  assert.equal(await h.run("document.querySelector('[data-cancellation-list]').textContent.includes('FMRC team')"),true);
  await h.run("const source=document.querySelector('[data-cancel-source]');source.value='team';source.dispatchEvent(new Event('change',{bubbles:true}));");
  assert.equal(await h.run("document.querySelector('[data-cancellation-list]').querySelectorAll('tr').length"),1);
  await h.run("document.querySelector('[data-tab=\"records\"]').click();document.querySelector('[data-return-view=\"30\"]').click()");await h.until("!!document.querySelector('#modalReturnDetails .return-workflow')");
  assert.equal(await h.run("document.querySelector('#modalReturnDetails .return-next-action button').textContent"),'Review request');
  await h.run("document.querySelector('#modalReturnDetails .return-next-action button').click()");await h.until("document.getElementById('modalReturnAction').classList.contains('show')");
  await h.run("document.getElementById('returnDecisionNote').value='Keep this draft'");
  returned={...returned,status:'refund_processing',can_decide:false,online_refund_pending:true,online_refund_status:'requested'};
  await h.until("document.querySelector('#modalReturnDetails .return-next-action').textContent.includes('Waiting for Admin')");
  assert.equal(await h.run("document.getElementById('returnDecisionNote').value"),'Keep this draft');
  await h.run("document.getElementById('modalReturnAction').classList.remove('show');document.getElementById('modalReturnDetails').classList.remove('show');document.querySelector('[data-tab=\"refunds\"]').click()");await h.until("document.querySelectorAll('[data-payment-list] > tr').length===10");
  await h.run("document.querySelector('[data-next]').click()");await h.until("document.querySelector('[data-payment-page]').value==='2'");
  assert.equal(await h.run("document.querySelectorAll('[data-payment-list] > tr').length"),10);
  await h.run("document.querySelector('[data-next]').click()");await h.until("document.querySelector('[data-payment-page]').value==='3'");
  assert.equal(await h.run("document.querySelectorAll('[data-payment-list] > tr').length"),1);
  for(const width of [1440,390])for(const theme of ['light','dark']){
    await h.send('Emulation.setDeviceMetricsOverride',{width,height:950,deviceScaleFactor:1,mobile:width<600});
    await h.run(`document.documentElement.dataset.theme='${theme}';document.querySelector('[data-tab="records"]').click();document.querySelector('[data-return-view="30"]').click()`);
    await h.until("document.getElementById('modalReturnDetails').classList.contains('show')");
    assert.equal(await h.run("(()=>{const body=document.querySelector('#modalReturnDetails .modal-body-scroll');return body.scrollWidth<=body.clientWidth+1})()"),true);
    await h.shot(portal+'-return-guide-'+theme+'-'+width);
    await h.run("document.getElementById('modalReturnDetails').classList.remove('show')");
  }
  assert.deepEqual(writes,[],'Readback and navigation cannot change money or fulfillment');assert(reads>0);
  assert.deepEqual(await h.run('fixtureErrors'),[]);t.diagnostic('Workspace screenshots: '+h.artifacts);
});
