const test=require('node:test'),assert=require('node:assert/strict');
const {browserFixture,chrome}=require('./helpers/website-browser.cjs');

const event=(id,title)=>({id,event_type:'admin_update',title,description:'Prepared and checked at FMRC.',occurred_at:'2026-11-09T08:30:00+08:00',occurred_at_label:'Nov 9, 2026, 8:30 AM',metadata:{source:'fmrc'}});
const delivery=()=>({id:91,order_no:'ORD-91',order_type:'regular',customer_name:'Fixture Customer',product_name:'Prototype',quantity:1,total_amount:150,total_label:'₱150.00',payment_method:'GCash',payment_status:'paid',payment_is_automated:true,payment_reference:'PAY-91',payment_actions:{paid:{allowed:false},pending:{allowed:false},refunded:{allowed:false}},lifecycle_status:'pending',lifecycle_status_label:'Pending',customer_stage:'to_ship',customer_stage_label:'To Ship',fulfillment_type:'delivery',shipment_tracking_mode:'jnt_dropoff',courier_name:'J&T Express',items:[{product_name:'Prototype',quantity:1,unit_price:150}],timeline:[event(1,'Prepared at FMRC')],accepted_policy:{version:'saved-policy',accepted_at_label:'Nov 9, 2026',terms_text:'Saved terms',refund_text:'Saved refund terms'},courier_shipment:{tracking_provider:'17track',status:'pending',status_label:'Awaiting handover',can_record:true,can_correct:false,can_refresh:false,availability_message:'Automatic tracking is active.'}});
const pickup=()=>({...delivery(),id:92,order_no:'ORD-92',payment_method:'COP',payment_status:'pending',payment_is_automated:false,is_pickup:true,fulfillment_type:'pickup',shipment_tracking_mode:null,courier_shipment:null,timeline:[event(2,'Pickup preparation started')],customer_stage_label:'Preparing for pickup',can_confirm_collection:false});
const summary=order=>{const {timeline,accepted_policy,customer_timeline,...row}=structuredClone(order);return row;};

test('Order dialogs hydrate full records and keep unchanged polls, handover drafts, and note sections stable',{skip:!chrome,timeout:90000},async t=>{
  let orders=[delivery(),pickup()],failReads=false,slowRead=false,reads=0;const writes=[];
  const h=await browserFixture(t,async({req,route,json})=>{
    if(route==='/api/admin/orders'){json({incoming:[],directory:orders.map(summary),payments:[],returns:[],generated_at:new Date().toISOString()});return true;}
    const match=route.match(/^\/api\/admin\/orders\/(91|92)(\/tracking)?$/);if(!match)return false;
    const order=orders.find(o=>o.id===Number(match[1]));
    if(match[2]){
      let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);writes.push(body);
      assert.equal(body.event_type,'admin_update');assert.equal('stage' in body,false);assert.equal('courier_name' in body,false);
      order.timeline.unshift(event(3,body.title));json({data:order});return true;
    }
    reads++;const saved=structuredClone(order);if(slowRead)await new Promise(r=>setTimeout(r,650));
    if(failReads){json({message:'Fixture unavailable'},503);return true;}json({data:saved});return true;
  });
  await h.send('Network.setBlockedURLs',{urls:['https://*']});
  const openDetails=async id=>{await h.run(`document.querySelector('[data-order-view="${id}"]').click()`);await h.until(`document.getElementById('modalOrderDetails').dataset.orderId==='${id}'&&document.querySelector('[data-order-section="history"]').textContent.includes(${JSON.stringify(id===91?'Prepared at FMRC':'Pickup preparation started')})`);};
  for(const portal of ['admin','staff']){
    orders=[delivery(),pickup()];failReads=false;slowRead=false;
    await h.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    await h.go('/'+portal+'-page/orders.html');await h.until(`!!document.querySelector('[data-order-view="91"]')`);await openDetails(91);
    assert.equal(await h.run(`document.querySelector('[data-accepted-policy]').hidden`),false,'List summaries cannot erase the saved policy');
    await h.run(`(()=>{
      const modal=document.getElementById('modalOrderDetails'),body=modal.querySelector('.modal-body-scroll'),number=modal.querySelector('[name="tracking_number"]');
      number.value='JT-DRAFT-91';number.dispatchEvent(new Event('input',{bubbles:true}));number.focus();number.setSelectionRange(3,6);number.scrollIntoView({block:'center'});
      window.savedNumber=number;window.savedBodyScroll=body.scrollTop;window.dialogMutations=0;
      window.dialogObserver=new MutationObserver(records=>dialogMutations+=records.filter(r=>r.type==='childList').length);dialogObserver.observe(body,{subtree:true,childList:true});
    })()`);
    await h.pause(5600);
    assert.equal(await h.run(`savedNumber===document.querySelector('#modalOrderDetails [name="tracking_number"]')`),true);
    assert.equal(await h.run(`savedNumber.value`),'JT-DRAFT-91');
    assert.equal(await h.run(`document.activeElement===savedNumber&&savedNumber.selectionStart===3&&savedNumber.selectionEnd===6`),true);
    assert.equal(await h.run(`Math.abs(document.querySelector('#modalOrderDetails .modal-body-scroll').scrollTop-savedBodyScroll)<2`),true);
    assert.equal(await h.run(`dialogMutations`),0,'Unchanged polling does not rebuild the open dialog');
    await h.run(`dialogObserver.disconnect()`);

    // Both views of one order retain their own handover form and share one read.
    await h.run(`document.querySelector('[data-order-track="91"]').click()`);await h.until(`!!document.querySelector('#trackingManagedShipment [name="tracking_number"]')`);
    await h.run(`(()=>{const input=document.querySelector('#trackingManagedShipment [name="tracking_number"]');input.value='JT-TRACKING-DRAFT';input.dispatchEvent(new Event('input',{bubbles:true}));window.trackingNumberNode=input;})()`);
    slowRead=true;const before=reads;
    orders[0].courier_shipment.availability_message='Saved tracking connection verified.';
    await h.run(`document.querySelector('#modalOrderDetails [data-jnt-load]').click();document.querySelector('#modalTrackingUpdate [data-jnt-load]').click()`);
    await h.until(`document.querySelector('#trackingManagedShipment [data-jnt-availability]').textContent==='Saved tracking connection verified.'`);slowRead=false;
    assert.equal(reads-before,1,'Two open views join one saved-order request');
    assert.equal(await h.run(`document.querySelector('#modalOrderDetails [name="tracking_number"]').value`),'JT-DRAFT-91');
    assert.equal(await h.run(`document.querySelector('#trackingManagedShipment [name="tracking_number"]').value`),'JT-TRACKING-DRAFT');
    assert.equal(await h.run(`document.querySelector('#trackingManagedShipment [name="tracking_number"]')===trackingNumberNode`),true);

    failReads=true;
    await h.run(`document.querySelector('#modalOrderDetails [data-jnt-load]').click()`);await h.until(`document.querySelector('[data-order-readback]:not([hidden])')`);
    assert.match(await h.run(`document.querySelector('[data-order-section="history"]').textContent`),/Prepared at FMRC/);
    assert.equal(await h.run(`document.querySelector('#modalOrderDetails [name="tracking_number"]').value`),'JT-DRAFT-91');
    failReads=false;await h.run(`document.querySelector('[data-order-readback] button').click()`);await h.until(`document.querySelector('[data-order-readback]').hidden`);
    await h.until(`!document.querySelector('#modalOrderDetails [data-jnt-message]').textContent.includes('could not')`);

    // A real saved courier change still reaches both views without erasing drafts.
    Object.assign(orders[0],{customer_stage:'completed',customer_stage_label:'Completed',lifecycle_status:'completed',lifecycle_status_label:'Completed'});
    Object.assign(orders[0].courier_shipment,{id:771,tracking_number:'JT-91',status:'delivered',status_label:'Delivered',can_record:false,handed_over_at_label:'Nov 9, 2026',last_updated_at_label:'Nov 10, 2026',location:'Labo'});
    orders[0].timeline.unshift({...event(4,'Delivered to the customer'),event_type:'delivered',metadata:{source:'17track',tracking_number:'JT-91'}});
    await h.until(`document.querySelector('#modalOrderDetails [data-jnt-status]').textContent==='Delivered'&&document.querySelector('#trackingManagedShipment [data-jnt-status]').textContent==='Delivered'`,12000);
    assert.match(await h.run(`document.querySelector('[data-order-section="history"]').textContent`),/Delivered to the customer/);
    assert.equal(await h.run(`document.querySelector('#modalOrderDetails [name="tracking_number"]')===savedNumber&&savedNumber.value==='JT-DRAFT-91'`),true);
    assert.equal(await h.run(`document.querySelector('#trackingManagedShipment [name="tracking_number"]')===trackingNumberNode&&trackingNumberNode.value==='JT-TRACKING-DRAFT'`),true);
    assert.equal(await h.run(`document.getElementById('trackingStage').value`),'completed');

    // A late response for the previous record must never replace a new record.
    slowRead=true;await h.run(`document.querySelector('#modalOrderDetails [data-jnt-load]').click();document.querySelector('[data-modal-close="#modalOrderDetails"]').click();document.querySelector('[data-order-view="92"]').click()`);
    await h.until(`document.getElementById('modalOrderDetails').dataset.orderId==='92'`);await h.pause(850);slowRead=false;
    assert.equal(await h.run(`document.getElementById('modalOrderDetails').dataset.orderId`),'92');
    assert.equal(await h.run(`!!document.querySelector('#modalOrderDetails [data-courier-controls]')`),false,'Pickup never displays an old courier card');
    assert.match(await h.run(`document.querySelector('[data-order-section="history"]').textContent`),/Pickup preparation started/);

    await h.run(`document.getElementById('modalTrackingUpdate').classList.remove('show');document.querySelector('#modalOrderDetails [data-manage-fulfillment]').click()`);
    await h.until(`document.querySelector('#modalTrackingUpdate.show #trackingOptionalNotes')`);
    assert.equal(await h.run(`document.getElementById('trackingNotesHeading')`),null,'The old orphan heading is removed');
    assert.equal(await h.run(`document.querySelectorAll('#modalTrackingUpdate #trackingOptionalNotes > summary').length`),1);
    assert.equal(await h.run(`document.querySelector('#trackingOptionalNotes > summary').textContent`),'Optional FMRC note');
    assert.doesNotMatch(await h.run(`document.getElementById('trackingEventDescription').placeholder`),/courier/i);
    assert.equal(await h.run(`getComputedStyle(document.getElementById('trackingPresetSelect').closest('.field-stack')).display`),'none');
    await h.run(`(()=>{document.getElementById('trackingOptionalNotes').open=true;const input=document.getElementById('trackingEventTitle');input.value='Your pickup is being prepared';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();window.noteNode=input;})()`);
    await h.pause(5500);assert.equal(await h.run(`noteNode===document.getElementById('trackingEventTitle')&&noteNode.value==='Your pickup is being prepared'`),true);
    for(const width of [390,1440])for(const theme of ['light','dark']){
      await h.send('Emulation.setDeviceMetricsOverride',{width,height:960,deviceScaleFactor:1,mobile:false});
      await h.run(`document.documentElement.dataset.theme='${theme}';document.getElementById('trackingOptionalNotes').scrollIntoView({block:'center'})`);
      assert.equal(await h.run(`document.querySelector('#modalTrackingUpdate .modal-card').scrollWidth>document.querySelector('#modalTrackingUpdate .modal-card').clientWidth+1`),false);
      await h.shot(portal+'-single-fmrc-note-'+width+'-'+theme);
    }
    const count=writes.length;
    await h.run(`document.getElementById('btnSaveTrackingUpdate').click()`);await h.until(`document.querySelector('#adminSystemPopup.show')?.textContent.includes('Confirm Tracking Update')`);await h.run(`document.getElementById('adminSystemPopupOk').click()`);
    await h.until(`!document.getElementById('modalTrackingUpdate').classList.contains('show')`);
    assert.equal(writes.length,count+1);assert.equal(orders[1].customer_stage,'to_ship');assert.equal(orders[1].payment_status,'pending');
    assert.deepEqual(await h.run('fixtureErrors'),[]);
  }
  t.diagnostic('Stable-dialog screenshots: '+h.artifacts);
});
