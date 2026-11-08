const test=require('node:test'),assert=require('node:assert/strict');
const {browserFixture,chrome}=require('./helpers/website-browser.cjs');
const settings=()=>({enabled:true,nonworking_weekdays:[7],nonworking_dates:[],zones:Array.from({length:12},(_,i)=>({id:`10000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,name:'Area '+(i+1),province:'Camarines Norte',cities:['Town '+i],postal_codes:[],fee:10+i,preparation_days:1,transit_min_days:1,transit_max_days:3}))});

test('Published shipping uses five-row pagination and a separate scrollable area editor in both portals',{skip:!chrome,timeout:90000},async t=>{
  const published=settings();
  const h=await browserFixture(t,async({route,role,json})=>{
    if(route==='/api/admin/shipping-settings'){json({data:{revision:1,can_edit:role==='admin',published,...(role==='admin'?{draft:published,has_saved_draft:true}:{})}});return true;}
    if(route==='/api/psgc/provinces'){json([{code:'0501600000',name:'Camarines Norte'}]);return true;}
    if(route==='/api/admin/shipping-tracking'){json({data:{installed:true,enabled:true,ready:true,can_edit:role==='admin',readiness_state:'active',configured:true,carrier_verified:true,processor_healthy:true,waybill_verified:false,webhook_verified:false,message:'Automatic tracking is active.',next_action:'Assign a tracking number once; updates are automatic.',blocking_reasons:{}}});return true;}
    return false;
  });
  await h.send('Network.setBlockedURLs',{urls:['https://*']});
  for(const portal of ['admin','staff'])for(const width of [390,1440]){
    await h.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await h.go('/'+portal+'-page/website-shipping.html');
    await h.until(`document.querySelectorAll('#shippingPublished tbody tr').length===5&&!document.getElementById('shippingRefresh').disabled`);
    assert.match(await h.run(`document.querySelector('#shippingPublished .table-footer-meta').textContent`),/Page 1 of 3/);
    await h.run(`document.querySelector('[data-shipping-page="next"]').click()`);
    assert.match(await h.run(`document.querySelector('#shippingPublished tbody').textContent`),/Area 6/);
    await h.run(`document.querySelector('[data-shipping-page="next"]').click()`);
    assert.equal(await h.run(`document.querySelectorAll('#shippingPublished tbody tr').length`),2);
    assert.equal(await h.run(`document.querySelector('[data-shipping-page="next"]').disabled`),true);
    if(portal==='admin'){
      assert.equal(await h.run(`document.querySelectorAll('#shippingZones [data-zone-id]').length`),12);
      assert.equal(await h.run(`getComputedStyle(document.getElementById('shippingZones')).overflowY`),'auto');
      assert.equal(await h.run(`document.getElementById('shippingAddZone').closest('.shipping-section-heading')?.querySelector('h4').id`),'shippingAreasTitle');
      await h.run(`document.getElementById('shippingAddZone').click()`);
      assert.equal(await h.run(`document.querySelectorAll('#shippingZones [data-zone-id]').length`),13);
      assert.equal(await h.run(`document.activeElement.id`),'shipping-12-name');
      await h.run(`document.getElementById('shippingRefresh').scrollIntoView({block:'center'})`);
    }else assert.equal(await h.run(`document.getElementById('shippingEditor').hidden`),true);
    await h.until(`document.querySelector('[data-tracking-state]').textContent==='Active'`);
    assert.equal(await h.run(`document.querySelector('[data-tracking-toggle]').disabled`),false);
    assert.equal(await h.run(`document.querySelector('[data-tracking-toggle]').hidden`),portal!=='admin');
    assert.match(await h.run(`document.querySelector('[data-tracking-facts]').textContent`),/Waiting for the first parcel update/);
    assert.match(await h.run(`document.querySelector('[data-tracking-facts]').textContent`),/saved-result recovery remains automatic/);
    assert.equal(await h.run(`document.documentElement.scrollWidth>innerWidth+1`),false);
    await h.shot(portal+'-shipping-five-rows-'+width);
    await h.run(`document.querySelector('.shipping-tracking-status').scrollIntoView({block:'start'})`);
    await h.shot(portal+'-tracking-active-before-first-update-'+width);
    if(portal==='admin')await h.run(`document.getElementById('shippingDiscard').click()`);
    assert.deepEqual(await h.run('fixtureErrors'),[]);
  }
  t.diagnostic('Shipping screenshots: '+h.artifacts);
});

const delivery=()=>({id:71,order_no:'ORD-UI',order_no_display:'#ORD-UI',customer_name:'Fixture Customer',customer_contact:'09171234567',customer_address:'Daet, Camarines Norte',product_name:'Prototype',quantity:1,total_amount:150,total_label:'₱150.00',payment_method:'GCash',payment_status:'paid',payment_is_automated:true,payment_reference:'Provider confirmed',fulfillment_type:'delivery',fulfillment_label:'J&T delivery',shipment_tracking_mode:'jnt_dropoff',customer_stage:'to_receive',customer_stage_label:'To Receive',lifecycle_status:'pending',created_at:'2026-11-07T08:00:00+08:00',courier_name:'J&T Express',courier_tracking_no:'JT-UI-123',pricing:{item_subtotal_label:'₱140.00',shipping_fee_label:'₱10.00',estimated_delivery_label:'Nov 9 – Nov 12, 2026'},items:[{id:1,product_id:1,product_name:'Prototype',quantity:1,unit_price:140}],timeline:[],tracking_events:[],courier_shipment:{id:1,provider:'17TRACK',tracking_provider:'17track',carrier:'J&T Express',status:'in_transit',status_label:'In transit',tracking_number:'JT-UI-123',availability_message:'Courier updates are automatic.',can_record:false,can_refresh:true,can_correct:false,handed_over_at_label:'Nov 7, 2026, 9:00 AM',history:[]}});
test('Admin and Staff order dialogs lock facts, preserve notes, and confirm pickup through the dedicated action',{skip:!chrome,timeout:90000},async t=>{
  let order=delivery();const writes=[];
  const h=await browserFixture(t,async({req,route,json})=>{
    if(route==='/api/admin/orders'){json({incoming:[],directory:[order],payments:[],returns:[],returns_summary:{},cancellations_summary:{},generated_at:new Date().toISOString()});return true;}
    if(route==='/api/admin/orders/71'){json({data:order});return true;}
    if(route==='/api/couriers'){json({default:'jnt',data:[{key:'jnt',label:'J&T Express'},{key:'pickup',label:'Pickup at FMRC',accepts_tracking_no:false}]});return true;}
    if(route==='/api/admin/orders/71/tracking'){
      let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);writes.push(input);
      assert.equal(input.event_type,'admin_update');assert.equal('stage' in input,false);assert.equal('courier_tracking_no' in input,false);
      await new Promise(resolve=>setTimeout(resolve,600));json({data:order});return true;
    }
    if(route==='/api/admin/orders/71/complete'){
      let body='';for await(const chunk of req)body+=chunk;assert.equal(JSON.parse(body).pickup_code,'FM1234');
      Object.assign(order,{customer_stage:'completed',customer_stage_label:'Completed',lifecycle_status:'completed',can_confirm_collection:false,collection_blocked_reason:'Collection confirmed.',completion_source:'fmrc_collection'});json({data:order});return true;
    }
    return false;
  });
  const confirm=async title=>{await h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupTitle')?.textContent===${JSON.stringify(title)}`);await h.run(`document.getElementById('adminSystemPopupOk').click()`);};
  await h.send('Network.setBlockedURLs',{urls:['https://*']});
  for(const portal of ['admin','staff']){
    order=delivery();
    await h.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    await h.go('/'+portal+'-page/orders.html');await h.until(`!!document.querySelector('[data-order-view="71"]')`);
    await h.run(`document.querySelector('[data-order-view="71"]').click()`);
    await h.until(`document.getElementById('modalOrderDetails').classList.contains('show')`);
    assert.equal(await h.run(`['modalOrderNo','modalOrderContact','modalOrderTotal','modalOrderNotes'].every(id=>document.getElementById(id).disabled)`),true);
    await h.run(`document.getElementById('modalOrderNo').focus()`);
    assert.notEqual(await h.run(`document.activeElement.id`),'modalOrderNo');
    for(const theme of ['light','dark']){
      await h.run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);await h.shot(portal+'-details-'+theme);
    }
    await h.run(`document.querySelector('[data-modal-close="#modalOrderDetails"]').click();document.querySelector('[data-order-track="71"]').click()`);
    await h.until(`document.querySelector('#modalTrackingUpdate.show [data-jnt-status]')?.textContent==='In transit'`);
    assert.equal(await h.run(`['trackingOrderNo','trackingStage','trackingCourierNo','trackingCourierSelect'].every(id=>document.getElementById(id).disabled)`),true);
    assert.equal(await h.run(`document.getElementById('trackingPresetSelect').closest('.field-stack').hidden`),true);
    assert.equal(await h.run(`document.getElementById('btnSaveTrackingUpdate').disabled`),true);
    await h.run(`(()=>{const input=document.getElementById('trackingEventTitle');input.value='Packaging note';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();})()`);
    assert.equal(await h.run(`document.getElementById('btnSaveTrackingUpdate').disabled`),false);
    order.courier_shipment.status_label='Out for delivery';
    await h.run(`document.querySelector('#modalTrackingUpdate [data-jnt-load]').click()`);
    await h.until(`document.querySelector('#modalTrackingUpdate [data-jnt-status]').textContent==='Out for delivery'`);
    assert.equal(await h.run(`document.getElementById('trackingEventTitle').value`),'Packaging note');
    assert.equal(await h.run(`document.activeElement.id`),'trackingEventTitle');
    Object.assign(order,{customer_stage:'completed',customer_stage_label:'Completed',lifecycle_status:'completed',completion_source:'17track'});
    Object.assign(order.courier_shipment,{status:'delivered',status_label:'Delivered'});
    await h.run(`document.querySelector('#modalTrackingUpdate [data-jnt-load]').click()`);
    await h.until(`document.querySelector('#modalTrackingUpdate [data-jnt-status]').textContent==='Delivered'`);
    assert.equal(await h.run(`document.getElementById('trackingStage').value`),'completed');
    assert.equal(await h.run(`document.getElementById('trackingEventTitle').value`),'Packaging note');
    await h.send('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});
    await h.run(`document.getElementById('trackingEventTitle').scrollIntoView({block:'center'})`);
    await h.shot(portal+'-tracking-mobile');
    const beforeNote=writes.length;
    await h.run(`document.getElementById('btnSaveTrackingUpdate').click()`);await confirm('Confirm Tracking Update');
    await h.until(`document.getElementById('trackingEventTitle').disabled&&document.getElementById('btnSaveTrackingUpdate').disabled`);
    await h.run(`document.querySelector('#modalTrackingUpdate [data-jnt-load]').click();document.getElementById('btnSaveTrackingUpdate').click()`);
    await h.until(`!document.getElementById('modalTrackingUpdate').classList.contains('show')`);
    assert.equal(writes.length,beforeNote+1,'Automatic refresh cannot re-enable or repeat a saving note');
    assert.equal(writes.at(-1).title,'Packaging note');
    order={...delivery(),fulfillment_type:'pickup',is_pickup:true,shipment_tracking_mode:null,courier_shipment:null,courier_name:null,courier_tracking_no:null,can_confirm_collection:true,collection_blocked_reason:null,pickup_code:'FM1234',payment_method:'COP'};
    await h.go('/'+portal+'-page/orders.html');await h.until(`!!document.querySelector('[data-order-view="71"]')`);await h.run(`document.querySelector('[data-order-view="71"]').click()`);
    await h.until(`!!document.querySelector('[data-confirm-collection]')`);
    await h.run(`document.getElementById('collectionPickupCode').value='FM1234';document.querySelector('[data-confirm-collection]').click()`);await confirm('Confirm pickup collection');
    try{await h.until(`document.getElementById('modalOrderStatus').value.includes('Completed')`);}catch(error){throw Error(error.message+' server='+JSON.stringify(order)+' browser='+JSON.stringify(await h.run(`({status:document.getElementById('modalOrderStatus').value,popup:document.getElementById('adminSystemPopupMessage')?.textContent})`)));}
    assert.equal(order.payment_status,'paid');
    assert.deepEqual(await h.run('fixtureErrors'),[]);
  }
  t.diagnostic('Order screenshots: '+h.artifacts);
});

test('Custom Product Work uses the shared heading icon in Admin and Staff dashboards',{skip:!chrome,timeout:60000},async t=>{
  const h=await browserFixture(t,async({route,json})=>{
    if(route==='/api/admin/dashboard/summary'){json({data:{counts:{},custom_work:{available:true,enabled:true,awaiting_review:1}}});return true;}
    return false;
  });
  await h.send('Network.setBlockedURLs',{urls:['https://*']});
  for(const portal of ['admin','staff']){
    await h.go('/'+portal+'-page/dashboard.html');
    await h.until(`!!document.querySelector('#appointmentCustomWorkSummary .portal-table-icon')`);
    assert.equal(await h.run(`getComputedStyle(document.querySelector('#appointmentCustomWorkSummary .portal-table-icon')).width`),'34px');
    await h.run(`document.getElementById('appointmentCustomWorkSummary').scrollIntoView({block:'center'})`);
    await h.shot(portal+'-custom-work-heading');
    assert.deepEqual(await h.run('fixtureErrors'),[]);
  }
  t.diagnostic('Dashboard screenshots: '+h.artifacts);
});
