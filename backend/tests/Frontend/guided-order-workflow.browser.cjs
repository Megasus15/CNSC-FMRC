const test = require('node:test');
const assert = require('node:assert/strict');
const {browserFixture, chrome} = require('./helpers/website-browser.cjs');

const agreement = fulfillment => ({specifications:{service_id:2,name:'Custom sign',description:'A desk sign',quantity:1,dimensions:'10 cm',material:'PLA',colors:'Red',instructions:'Keep the text clear.',customer_notes_version:1},unit_price:150,product_subtotal:150,shipping_fee:0,total:150,lead_time:'Five working days',design_notes:'Approved desk sign design.',proof_file_ids:[],fulfillment_type:fulfillment,delivery:{}});
function custom(fulfillment='pickup') {
  return {id:81,order_no:'ORD-000081',order_type:'custom',customer_name:'Fixture Customer',product_name:'Custom sign',quantity:1,total_amount:150,total_label:'₱150.00',payment_method:'Cash at FMRC',payment_status:'pending',customer_stage:'to_pay',customer_stage_label:'To Pay',lifecycle_status:'incoming',fulfillment_type:fulfillment,is_pickup:fulfillment==='pickup',shipment_tracking_mode:fulfillment==='delivery'?'jnt_dropoff':null,items:[{product_name:'Custom sign',quantity:1,unit_price:150}],custom_product:{appointment_id:51,appointment_reference:'AP-00051',service:'3D Printing',quotation_version:1,stage:'Awaiting payment',revision:0,production_status:'awaiting_payment',cash_entries:[],available_actions:{record_cash:true},agreement:agreement(fulfillment)},...(fulfillment==='delivery'?{courier_shipment:{id:1,tracking_provider:'17track',status:'pending',status_label:'Awaiting handover',can_record:false,can_refresh:false,can_correct:false,history:[]}}:{})};
}
const ordinary = () => ({id:81,order_no:'ORD-PICKUP',order_type:'regular',customer_name:'Fixture Customer',product_name:'Desk sign',quantity:1,total_amount:150,total_label:'₱150.00',payment_method:'COP',payment_status:'pending',customer_stage:'to_ship',customer_stage_label:'Preparing for pickup',lifecycle_status:'pending',fulfillment_type:'pickup',is_pickup:true,payment_actions:{paid:{allowed:true},pending:{allowed:false},refunded:{allowed:false}},stage_labels:{to_ship:'Preparing for Pickup',to_receive:'Ready for Pickup',completed:'Completed'},items:[],can_confirm_collection:false,collection_blocked_reason:'Prepare the order before collection.'});

test('Shared guided dialogs finish ordinary and custom cash pickup and retain custom delivery controls', {skip:!chrome,timeout:120000}, async t => {
  let order, writes=[];
  const other={...ordinary(),id:82,order_no:'ORD-OTHER-82',customer_name:'Another customer'};
  const h=await browserFixture(t,async ({req,route,json})=>{
    if(route==='/api/admin/orders'){json({incoming:order.lifecycle_status==='incoming'?[order]:[],directory:order.lifecycle_status==='incoming'?[other]:[order,other],payments:[],returns:[]});return true;}
    if(route==='/api/admin/orders/82'){json({data:other});return true;}
    if(route==='/api/admin/orders/81'){json({data:order});return true;}
    if(route==='/api/couriers'){json({default:'jnt',data:[{key:'jnt',label:'J&T Express'}]});return true;}
    if(['/api/admin/orders/81/custom-product','/api/admin/orders/81/tracking','/api/admin/orders/81/payment-status','/api/admin/orders/81/complete'].includes(route)){
      let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);writes.push({route,body});
      if(route.endsWith('/custom-product')){
        const c=order.custom_product;c.revision++;
        if(body.action==='cash_receipt'){
          assert.equal(body.amount,150);assert.equal(body.receipt_reference,'FMRC-150');assert.equal(body.confirmed_received,true);
          order.payment_status='paid';c.available_actions={start_production:true};c.stage='Paid';
        }else if(body.action==='start'){
          assert.equal(order.payment_status,'paid');order.lifecycle_status='pending';order.customer_stage='to_ship';order.customer_stage_label='To Ship';c.production_status='in_production';c.available_actions={mark_ready:true};c.stage='In production';
        }else if(body.action==='ready'){
          c.production_status='ready';c.stage='Ready';c.available_actions={collect:order.is_pickup};order.customer_stage=order.is_pickup?'to_receive':'to_ship';order.customer_stage_label=order.is_pickup?'Ready for pickup':'To Ship';
        }else if(body.action==='collect'){
          if(body.pickup_code!=='FM1234'){json({message:'The pickup code does not match.'},422);return true;}
          order.lifecycle_status='completed';order.customer_stage='completed';order.customer_stage_label='Completed';c.available_actions={};c.stage='Completed';
        }
      }else if(route.endsWith('/tracking')){assert.equal(body.stage,'to_receive');order.customer_stage='to_receive';order.customer_stage_label='Ready for pickup';order.pickup_ready_at=new Date().toISOString();order.collection_blocked_reason='Confirm payment before collection.';}
      else if(route.endsWith('/payment-status')){assert.equal(body.confirmed_received,true);assert.equal(body.expected_status,'pending');order.payment_status='paid';order.payment_actions={paid:{allowed:false},pending:{allowed:true},refunded:{allowed:false}};order.can_confirm_collection=true;}
      else if(route.endsWith('/complete')){assert.equal(body.pickup_code,'FM1234');order.lifecycle_status='completed';order.customer_stage='completed';order.customer_stage_label='Completed';order.can_confirm_collection=false;}
      json({data:order});return true;
    }
    return false;
  });
  await h.send('Network.setBlockedURLs',{urls:['https://*']});
  const confirm=async()=>{await h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupOk')`);await h.run(`document.getElementById('adminSystemPopupOk').click()`);};
  const acknowledge=async()=>{await h.run(`document.querySelector('#adminSystemPopup.show #adminSystemPopupOk')?.click()`);};
  const open=async portal=>{await h.go('/'+portal+'-page/orders.html');await h.until(`!!document.querySelector('[data-order-view="81"]')`);await h.run(`document.querySelector('[data-order-view="81"]').click()`);await h.until(`!!document.querySelector('#modalOrderDetails [data-manage-fulfillment]:not([hidden])')`);await h.run(`document.querySelector('[data-manage-fulfillment]').click()`);await h.until(`document.querySelector('#modalTrackingUpdate.show #trackingGuidedWorkflow [data-ap-order],#modalTrackingUpdate.show #trackingGuidedWorkflow [data-pickup-collection]')`);};
  for(const portal of ['admin','staff']){
    order=ordinary();writes=[];await open(portal);
    assert.equal(await h.run(`document.getElementById('trackingStage').disabled`),true);
    assert.equal(await h.run(`['trackingCourierField','trackingCourierNoField'].every(id=>document.getElementById(id).hidden)`),true);
    assert.equal(await h.run(`document.getElementById('trackingLocationName').closest('.field-stack').hidden`),true);
    assert.equal(await h.run(`document.getElementById('trackingOptionalNotes').open`),false);
    await h.run(`document.querySelector('#trackingGuidedWorkflow [data-pickup-action="ready"]').click()`);await confirm();
    await h.until(`!!document.querySelector('#trackingGuidedWorkflow [data-pickup-action="cash"]')`);
    assert.equal(await h.run(`document.querySelector('#trackingGuidedWorkflow [data-pickup-action="cash"]').disabled`),true);
    await h.run(`document.querySelector('[data-order-view="82"]').click()`);await h.until(`document.getElementById('modalOrderDetails').dataset.orderId==='82'`);
    await h.run(`(()=>{const ack=document.querySelector('#trackingGuidedWorkflow [data-cash-ack]');ack.checked=true;ack.dispatchEvent(new Event('change'));document.querySelector('#trackingGuidedWorkflow [data-pickup-action="cash"]').click();})()`);await confirm();
    await h.until(`!!document.getElementById('trackingPickupCode')`);await acknowledge();
    await h.run(`document.getElementById('trackingPickupCode').value='FM1234';document.querySelector('#trackingGuidedWorkflow [data-pickup-action="collect"]').click()`);await confirm();
    await h.until(`document.getElementById('trackingStage').value==='completed'`);
    assert.deepEqual(writes.map(w=>w.route.split('/').pop()),['tracking','payment-status','complete']);
    assert.equal(await h.run(`document.getElementById('modalOrderDetails').dataset.orderId`),'82','The pickup action cannot replace another order’s open details');

    for(const fulfillment of ['pickup','delivery']){
      order=custom(fulfillment);writes=[];await open(portal);
      const form='#trackingGuidedWorkflow [data-ap-order-form="cash_receipt"]';
      assert.equal(await h.run(`document.querySelector('${form} [name="amount"]').disabled`),true);
      assert.equal(await h.run(`(()=>{const ids=[...document.querySelectorAll('[data-ap-order] [id]')].map(n=>n.id);return new Set(ids).size===ids.length;})()`),true,'The details and tracking forms have unique field IDs');
      await h.shot(portal+'-cash-receipt-'+fulfillment);
      assert.equal(await h.run(`!!document.querySelector('#trackingGuidedWorkflow [data-ap-production]')`),false,'Unpaid custom work cannot start production');
      await h.run(`(()=>{const f=document.querySelector('${form}');f.elements.receipt_reference.value='FMRC-150';f.elements.receipt_reference.dispatchEvent(new Event('input',{bubbles:true}));f.elements.receipt_reference.focus();})()`);
      await h.run(`window.dispatchEvent(new CustomEvent('fmrc:shipment-updated',{detail:{order:${JSON.stringify(order)}}}))`);
      assert.equal(await h.run(`document.querySelector('${form} [name="receipt_reference"]').value`),'FMRC-150');
      assert.equal(await h.run(`document.activeElement.name`),'receipt_reference');
      await h.run(`(()=>{const f=document.querySelector('${form}');f.elements.confirmed_received.checked=true;f.requestSubmit();})()`);await confirm();await h.until(`!!document.querySelector('#trackingGuidedWorkflow [data-ap-production="start"]')`);await acknowledge();
      await h.run(`document.querySelector('#trackingGuidedWorkflow [data-ap-production="start"]').click()`);await confirm();await h.until(`!!document.querySelector('#trackingGuidedWorkflow [data-ap-production="ready"]')`);await acknowledge();
      await h.run(`document.querySelector('#trackingGuidedWorkflow [data-ap-production="ready"]').click()`);await confirm();await h.until(`!document.querySelector('#trackingGuidedWorkflow [data-ap-production="ready"]')`);await acknowledge();
      if(fulfillment==='pickup'){
        await h.run(`(()=>{const f=document.querySelector('#trackingGuidedWorkflow [data-ap-order-form="collect"]');f.elements.pickup_code.value='WRONG';f.requestSubmit();})()`);await confirm();
        await h.until(`document.querySelector('#adminSystemPopup.show')?.textContent.includes('does not match')`);await acknowledge();
        assert.equal(order.lifecycle_status,'pending');
        await h.run(`(()=>{const f=document.querySelector('#trackingGuidedWorkflow [data-ap-order-form="collect"]');f.elements.pickup_code.value='FM1234';f.requestSubmit();})()`);await confirm();await h.until(`document.getElementById('trackingStage').value==='completed'`);await acknowledge();
      }else{
        assert.equal(await h.run(`document.getElementById('trackingManagedShipment').hidden`),false);
        assert.equal(await h.run(`Array.from(document.querySelectorAll('#trackingManagedShipment .shipment-actions')).every(row=>getComputedStyle(row).justifyContent==='flex-end')`),true,'J&T card actions align to the right');
        assert.equal(await h.run(`!!document.querySelector('#trackingGuidedWorkflow [name="pickup_code"]')`),false);
        assert.equal(order.lifecycle_status,'pending','Ready for shipping never completes delivery');
      }
      for(const width of [1440,390])for(const theme of ['light','dark']){
        await h.send('Emulation.setDeviceMetricsOverride',{width,height:960,deviceScaleFactor:1,mobile:false});
        await h.run(`document.documentElement.dataset.theme='${theme}';document.getElementById('trackingGuidedWorkflow').scrollIntoView({block:'start'})`);
        assert.equal(await h.run(`document.getElementById('modalTrackingUpdate').querySelector('.modal-card').scrollWidth>document.getElementById('modalTrackingUpdate').querySelector('.modal-card').clientWidth+1`),false);
        await h.run(`document.querySelectorAll('.admin-success-notification__close').forEach(button=>button.click());new Promise(resolve=>setTimeout(resolve,350))`);
        await h.shot(portal+'-guided-'+fulfillment+'-'+width+'-'+theme);
      }
      assert.deepEqual(await h.run('fixtureErrors'),[]);
    }
  }
  t.diagnostic('Guided cash workflow screenshots: '+h.artifacts);
});
