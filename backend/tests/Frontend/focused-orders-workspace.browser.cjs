const test=require('node:test'),assert=require('node:assert/strict');
const {browserFixture,chrome}=require('./helpers/website-browser.cjs');
const order=(id,extra={})=>({id,order_no:'ORD-'+id,order_type:'regular',customer_name:'Workspace Customer',product_name:'Prototype',quantity:1,total_amount:110,total_label:'₱110.00',payment_method:'GCash',payment_status:'paid',payment_is_automated:true,payment_actions:{paid:{allowed:false},pending:{allowed:false},refunded:{allowed:false}},lifecycle_status:'pending',customer_stage:'to_ship',customer_stage_label:'To Ship',fulfillment_type:'delivery',shipment_tracking_mode:'jnt_dropoff',courier_name:'J&T Express',items:[{product_name:'Prototype',quantity:1,unit_price:100}],timeline:[],accepted_policy:{version:'accepted-version',accepted_at_label:'Nov 11, 2026, 9:00 AM'},tracking_test:{can_attach:true,linked:false},courier_shipment:{tracking_provider:'17track',status:'pending',status_label:'Awaiting handover',can_record:true,can_correct:false,can_refresh:false,availability_message:'Automatic tracking is active.'},...extra});

for(const portal of ['admin','staff'])test(portal+' focused Orders: approval, isolated refresh, cancellation archive/restore and pagination',{skip:!chrome,timeout:90000},async t=>{
  let failRead=false,readDelay=0,archive=null;const writes=[];
  const delivery=order(10),incoming=[order(1,{lifecycle_status:'incoming',payment_status:'pending',approval:{allowed:false,label:'Approve order',reason:'Awaiting payment'}}),order(2,{lifecycle_status:'incoming',approval:{allowed:true,label:'Approve order'}}),order(3,{lifecycle_status:'incoming',payment_method:'COP',payment_status:'pending',payment_is_automated:false,fulfillment_type:'pickup',is_pickup:true,courier_shipment:null,approval:{allowed:true,label:'Approve order'}})];
  const requests=[order(20,{lifecycle_status:'cancelled',payment_status:'refunded',cancel_state:'approved',cancel_requested_at:'2026-11-11T09:00:00+08:00',cancellation_archive:{request_key:'a'.repeat(64),allowed:true,archived:false}}),order(21,{cancel_state:'requested',cancel_pending:true,cancel_requested_at:'2026-11-11T10:00:00+08:00',cancellation_archive:{request_key:'b'.repeat(64),allowed:false,archived:false,reason:'Review the cancellation first.'}})];
  const summary=o=>{const {timeline,accepted_policy,...row}=structuredClone(o);return row;};
  const h=await browserFixture(t,async({req,route,json,role})=>{
    if(req.method!=='GET'&&/\/api\/admin\/(orders|archives)/.test(route))writes.push([req.method,route]);
    if(route==='/api/admin/orders'){json({incoming:incoming.map(summary),directory:[delivery,...requests].map(summary),payments:[],returns:[]});return true;}
    const match=route.match(/^\/api\/admin\/orders\/(\d+)$/);
    if(match){const saved=structuredClone([delivery,...incoming,...requests].find(o=>o.id===Number(match[1])));if(readDelay)await new Promise(r=>setTimeout(r,readDelay));if(failRead){failRead=false;json({message:'Fixture unavailable'},503);return true;}json({data:saved});return true;}
    if(route==='/api/admin/orders/20/cancellation/archive'){
      let text='';for await(const chunk of req)text+=chunk;assert.equal(JSON.parse(text).request_key,'a'.repeat(64));assert.equal(req.method,'PATCH');
      archive={source_id:51,order_id:20,order_no:'ORD-20',customer_name:'Workspace Customer',status:'approved',reason:'Changed plans',requested_at:'2026-11-11T09:00:00+08:00',decided_at:'2026-11-11T10:00:00+08:00',archived_at:new Date().toISOString(),archived_by:'FMRC team',amount:110,payment_status:'refunded',can_restore:true};
      requests[0].cancellation_archive.archived=true;json({message:'Cancellation archived.',data:{id:51,order_id:20,request_key:'a'.repeat(64),archived:true}});return true;
    }
    if(route==='/api/admin/archives'){json({cancellations:archive?[archive]:[]});return true;}
    if(route==='/api/admin/archives/restore-bulk'){
      let text='';for await(const chunk of req)text+=chunk;assert.deepEqual(JSON.parse(text),{module:'cancellation',ids:[51]});
      archive=null;requests[0].cancellation_archive.archived=false;json({processed_ids:[51],processed_count:1,message:'Cancellation restored.'});return true;
    }
    if(route==='/api/admin/gateway-payments'){
      const page=Number(new URL(req.url,'http://fixture').searchParams.get('page')||1);
      const data=Array.from({length:21},(_,i)=>({id:100+i,order_id:100+i,order_no:'REFUND-'+i,customer_name:'Refund Customer',status:'refunded',lifecycle_status:'cancelled'})).slice((page-1)*10,page*10);
      json({payments:{data,total:21,per_page:10,last_page:3},refunds:data.map(p=>({id:p.id,payment_id:p.id,status:'succeeded',amount_centavos:1000})),receipts:[],attempts:[],can_approve:role==='admin'});return true;
    }
    return false;
  });
  await h.send('Network.setBlockedURLs',{urls:['https://*']});
  await h.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await h.go('/'+portal+'-page/orders.html');await h.until(`!!document.querySelector('[data-order-view="10"]')`);
  assert.equal(await h.run(`!!document.querySelector('[data-order-approve="1"]')`),false);
  for(const id of [2,3])assert.equal(await h.run(`!!document.querySelector('[data-order-approve="${id}"]')`),true);
  const open=async id=>{await h.run(`document.querySelector('[data-order-view="${id}"]').click()`);await h.until(`document.getElementById('modalOrderDetails').dataset.orderId==='${id}'&&!!document.querySelector('[data-accepted-policy] a')`);};
  await open(10);
  assert.equal(await h.run(`!!document.querySelector('[data-tracking-test-controls]')`),false);
  assert.equal(await h.run(`document.querySelector('[data-accepted-policy] a').getAttribute('href')`),'/products-page/transaction-terms.html?version=accepted-version');
  const layout=await h.run(`[...document.querySelectorAll('#modalOrderDetails [data-order-section]')].map(n=>n.dataset.orderSection)`);
  await h.run(`(()=>{const modal=document.getElementById('modalOrderDetails'),input=modal.querySelector('[name="tracking_number"]');input.value='JT-DRAFT';input.dispatchEvent(new Event('input',{bubbles:true}));window.draft=input;window.paymentChanges=0;new MutationObserver(r=>paymentChanges+=r.length).observe(modal.querySelector('[data-order-section="payment"]'),{subtree:true,childList:true,attributes:true});modal.querySelector('[data-jnt-load]').scrollIntoView({block:'center'});window.savedScroll=modal.querySelector('.modal-body-scroll').scrollTop;})()`);
  readDelay=200;delivery.courier_shipment.availability_message='Saved fulfillment readback verified.';
  await h.run(`document.querySelector('#modalOrderDetails [data-jnt-load]').click()`);await h.until(`document.querySelector('#modalOrderDetails [data-jnt-message]').textContent.startsWith('Updated')`);
  assert.equal(await h.run('paymentChanges'),0);assert.equal(await h.run(`draft===document.querySelector('#modalOrderDetails [name="tracking_number"]')&&draft.value==='JT-DRAFT'`),true);
  assert.equal(await h.run(`Math.abs(savedScroll-document.querySelector('#modalOrderDetails .modal-body-scroll').scrollTop)<3`),true);
  assert.equal(await h.run(`(()=>{const a=document.querySelector('#modalOrderDetails [data-jnt-submit]').getBoundingClientRect(),b=document.querySelector('#modalOrderDetails [data-jnt-load]').getBoundingClientRect();return Math.abs(a.top-b.top)<2})()`),true);
  failRead=true;await h.run(`document.querySelector('#modalOrderDetails [data-jnt-load]').click()`);await h.until(`document.querySelector('#modalOrderDetails [data-jnt-message]').textContent.includes('could not')`);
  await h.run(`document.querySelector('#modalOrderDetails [data-jnt-load]').click()`);await h.until(`document.querySelector('#modalOrderDetails [data-jnt-message]').textContent.startsWith('Updated')`);readDelay=0;
  for(const width of [1440,390])for(const theme of ['light','dark']){
    await h.send('Emulation.setDeviceMetricsOverride',{width,height:950,deviceScaleFactor:1,mobile:width<600});
    await h.run(`document.documentElement.dataset.theme='${theme}'`);
    assert.equal(await h.run(`(()=>{const b=document.querySelector('#modalOrderDetails .modal-body-scroll');return b.scrollWidth<=b.clientWidth+1})()`),true);
    await h.shot(portal+'-fulfillment-'+theme+'-'+width);
  }
  await h.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await h.run(`document.querySelector('[data-modal-close="#modalOrderDetails"]').click()`);await open(1);
  assert.deepEqual(await h.run(`[...document.querySelectorAll('#modalOrderDetails [data-order-section]')].map(n=>n.dataset.orderSection)`),layout);
  assert.equal(await h.run(`!!document.querySelector('#modalOrderDetails [data-pickup-action="approve"]')`),false);
  await h.run(`document.querySelector('[data-modal-close="#modalOrderDetails"]').click();document.querySelector('[data-tab="cancellations"]').click()`);
  assert.equal(await h.run(`document.querySelector('[data-cancel-filter]').value`),'all');
  await h.until(`document.querySelectorAll('[data-cancellation-list] > tr').length===2`);
  assert.equal(await h.run(`document.querySelector('[data-cancelarchive="21"]').disabled`),true);
  assert.equal(await h.run(`document.querySelector('[data-cancelarchive="21"]').dataset.tooltip`),'Review the cancellation first.');
  await h.run(`(()=>{const filter=document.querySelector('[data-cancel-filter]');filter.value='requested';filter.dispatchEvent(new Event('change'));})()`);
  await h.run(`window.dispatchEvent(new CustomEvent('fmrc:orders-synced',{detail:{orders:${JSON.stringify(requests.map(summary))}}}))`);
  assert.equal(await h.run(`document.querySelector('[data-cancel-filter]').value`),'requested');
  assert.equal(await h.run(`document.querySelectorAll('[data-cancellation-list] > tr').length`),1);
  await h.run(`(()=>{const filter=document.querySelector('[data-cancel-filter]');filter.value='all';filter.dispatchEvent(new Event('change'));})()`);
  await open(20);assert.deepEqual(await h.run(`[...document.querySelectorAll('#modalOrderDetails [data-order-section]')].map(n=>n.dataset.orderSection)`),layout);
  await h.run(`document.querySelector('[data-modal-close="#modalOrderDetails"]').click();document.querySelector('[data-cancelarchive="20"]').click()`);
  await h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupTitle')?.textContent==='Archive cancellation'`);
  await h.run(`document.getElementById('adminSystemPopupOk').click()`);await h.until(`!document.querySelector('[data-cancelarchive="20"]')`);
  assert.equal(await h.run(`document.querySelector('[data-cancel-filter]').value`),'all');
  await h.run(`document.querySelector('[data-tab="refunds"]').click()`);await h.until(`document.querySelectorAll('[data-payment-list] > tr').length===10`);
  await h.run(`document.querySelector('[data-next]').click()`);await h.until(`document.querySelector('[data-payment-page]').value==='2'`);assert.equal(await h.run(`document.querySelectorAll('[data-payment-list] > tr').length`),10);
  await h.run(`document.querySelector('[data-next]').click()`);await h.until(`document.querySelector('[data-payment-page]').value==='3'`);assert.equal(await h.run(`document.querySelectorAll('[data-payment-list] > tr').length`),1);
  await h.go('/'+portal+'-page/archives.html');await h.until(`!!document.querySelector('[data-cancellation-view="51"]')`);
  await h.run(`document.querySelector('[data-tab="cancellation"]').click();document.querySelector('[data-cancellation-view="51"]').click()`);
  await h.until(`document.getElementById('cancellationArchiveDetails').open`);
  assert.match(await h.run(`document.getElementById('cancellationArchiveDetails').textContent`),/Changed plans/);
  assert.equal(await h.run(`!!document.querySelector('#sectionCancellation [data-archive-delete]')`),false);
  for(const width of [1440,390])for(const theme of ['light','dark']){
    await h.send('Emulation.setDeviceMetricsOverride',{width,height:950,deviceScaleFactor:1,mobile:width<600});await h.run(`document.documentElement.dataset.theme='${theme}'`);
    assert.equal(await h.run(`(()=>{const b=document.querySelector('#cancellationArchiveDetails .modal-body-scroll');return b.scrollWidth<=b.clientWidth+1})()`),true);
    assert.equal(await h.run(`(()=>{const b=document.getElementById('cancellationArchiveDetails').getBoundingClientRect();return b.left>=10&&b.right<=innerWidth-10&&Math.abs((b.left+b.right)/2-innerWidth/2)<2})()`),true,'Cancellation details stays centered inside the viewport');
    await h.shot(portal+'-cancellation-'+theme+'-'+width);
  }
  await h.run(`document.querySelector('[data-cancellation-close]').click()`);
  assert.equal(await h.run(`getComputedStyle(document.getElementById('cancellationArchiveDetails')).display`),'none');
  await h.run(`document.querySelector('[data-archive-restore="cancellation"]').click()`);
  await h.until(`document.querySelector('#adminSystemPopup.show')`);await h.run(`document.getElementById('adminSystemPopupOk').click()`);await h.until(`!document.querySelector('[data-cancellation-view="51"]')`);
  assert.deepEqual(writes,[['PATCH','/api/admin/orders/20/cancellation/archive'],['POST','/api/admin/archives/auto-delete'],['PATCH','/api/admin/archives/restore-bulk']]);
  assert.deepEqual(await h.run('fixtureErrors'),[]);t.diagnostic('Screenshots: '+h.artifacts);
});
