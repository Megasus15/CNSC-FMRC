/* Admin and Staff share the same courier controls; the API owns eligibility. */
(() => {
  'use strict';
  const drafts=new Map();
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const api=()=>String(window.APP_API_BASE_URL||(['localhost','127.0.0.1'].includes(location.hostname)&&location.port!=='8000'?location.protocol+'//'+location.hostname+':8000/api':location.origin+'/api')).replace(/\/$/,'');
  const headers=()=>({Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+window.AdminSession?.getToken()});
  const request=async(path,options={})=>{
    const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),30000);
    try{
      const response=await fetch(api()+path,{...options,headers:headers(),signal:controller.signal});const json=await response.json().catch(()=>({}));
      if(!response.ok)throw Error(Object.values(json.errors||{}).flat()[0]||json.message||'The courier request could not be confirmed. Refresh tracking before retrying.');
      return json.data;
    }catch(error){if(error.name==='AbortError'||error.name==='TypeError')throw Error('The courier request could not be confirmed. Refresh tracking before retrying.');throw error;}
    finally{clearTimeout(deadline);}
  };
  const render=(order,host)=>{
    if(!host)return;
    if(order.is_pickup||order.fulfillment_type==='pickup'){host.querySelector('[data-courier-controls]')?.remove();host.querySelector('[data-tracking-test-controls]')?.remove();return;}
    if(order.courier_shipment?.tracking_provider==='17track'){window.AdminJntTracking?.render(order,host);return;}
    let card=host.querySelector('[data-courier-controls]');if(!card){card=document.createElement('section');card.dataset.courierControls='';card.className='shipment-control-card';host.appendChild(card);}
    const state=drafts.get(String(order.id))||{draft:null,busy:false,message:'',blocked:false};state.order=order;state.host=host;drafts.set(String(order.id),state);
    const shipment=order.courier_shipment;
    if(!shipment){card.innerHTML='<h4>Courier booking</h4><p>Courier booking is not yet available. Manual tracking remains available.</p>';return;}
    const parcel=state.draft||{weight:shipment.parcel?.weight??'',length:shipment.parcel?.length??'',width:shipment.parcel?.width??'',height:shipment.parcel?.height??'',
      dispatch_date:shipment.parcel?.dispatch_date||shipment.booking_date_min||'',pickup_required:shipment.parcel?.pickup_required||false,actual_booking_cost:shipment.actual_booking_cost??'',tracking_number:''};
    const editable=!state.busy&&!state.blocked&&(shipment.can_book||(shipment.can_retry&&shipment.status==='booking_failed'));
    const fields=[['weight','Actual weight (kg)','0.001','1000'],['length','Length (cm)','0.1','300'],['width','Width (cm)','0.1','300'],['height','Height (cm)','0.1','300']];
    const history=(shipment.events||[]).map(event=>'<li><strong>'+escape(event.status)+'</strong><time datetime="'+escape(event.occurred_at)+'">'+escape(event.occurred_at_label)+'</time>'+(event.location?'<span>'+escape(event.location)+'</span>':'')+'</li>').join('');
    card.innerHTML='<div class="shipment-heading"><h4>Ninja Van shipment</h4><span class="status-pill '+(['delivered','returned'].includes(shipment.status)?'status-green':'status-yellow')+'">'+escape(shipment.status_label)+'</span></div>'+
      (shipment.tracking_number?'<p><strong>Tracking number:</strong> '+escape(shipment.tracking_number)+'</p>':'')+
      '<p>Courier status is separate from order completion, payment collection, and refunds. The accepted customer shipping fee stays unchanged.</p>'+
      (shipment.booking_reason?'<p class="shipment-note">'+escape(shipment.booking_reason)+'</p>':'')+
      (shipment.operator_note?'<p class="shipment-note">'+escape(shipment.operator_note)+'</p>':'')+
      (shipment.environment?'<p class="shipment-reference">Courier environment: '+escape(shipment.environment)+'</p>':'')+
      '<p class="shipment-message" role="status" aria-live="polite">'+escape(state.busy?'Processing courier request…':state.message)+'</p>'+
      '<form data-courier-form><fieldset '+(!editable?'disabled':'')+'><div class="shipment-fields">'+fields.map(([name,label,min,max])=>
        '<div class="field-stack"><label for="shipment-'+name+'">'+label+'</label><input class="input-field" id="shipment-'+name+'" name="'+name+'" type="number" min="'+min+'" max="'+max+'" step="0.001" required value="'+escape(parcel[name])+'" /></div>').join('')+
        '<div class="field-stack"><label for="shipment-dispatch_date">Dispatch / pickup date</label><input class="input-field" id="shipment-dispatch_date" name="dispatch_date" type="date" min="'+escape(shipment.booking_date_min)+'" value="'+escape(parcel.dispatch_date)+'" required /></div>'+
        '<div class="field-stack"><label for="shipment-pickup_required">Parcel handover</label><select class="input-field" id="shipment-pickup_required" name="pickup_required"><option value="false" '+(!parcel.pickup_required?'selected':'')+'>FMRC drops off the parcel</option><option value="true" '+(parcel.pickup_required?'selected':'')+' '+(!shipment.pickup_available?'disabled':'')+'>Courier collects at FMRC</option></select></div>'+
        '<div class="field-stack"><label for="shipment-actual_booking_cost">Actual courier charge (PHP, if known)</label><input class="input-field" id="shipment-actual_booking_cost" name="actual_booking_cost" type="number" min="0" max="999999.99" step="0.01" value="'+escape(parcel.actual_booking_cost)+'" /></div></div></fieldset>'+
        '<div class="shipment-actions"><button type="submit" class="btn-admin" '+(state.busy||state.blocked||(!shipment.can_book&&!shipment.can_retry)?'disabled':'')+'>'+escape(shipment.can_retry?'Retry booking with the same reference':'Book courier shipment')+'</button></div></form>'+
      (shipment.reference?'<p class="shipment-reference">Booking reference: '+escape(shipment.reference)+'</p>':'')+
      (shipment.can_link?'<div class="shipment-link"><label for="shipment-existing-tracking">Tracking number from the courier dashboard for this reference</label><input class="input-field" id="shipment-existing-tracking" name="tracking_number" value="'+escape(parcel.tracking_number)+'" maxlength="100" /><button type="button" class="btn-admin btn-secondary" data-shipment-link '+(state.busy?'disabled':'')+'>Link existing tracking</button><p>Linking records the number supplied by FMRC. Courier updates confirm the parcel status.</p></div>':'')+
      '<div class="shipment-actions"><button class="btn-admin btn-secondary" type="button" data-shipment-refresh '+(state.busy?'disabled':'')+'>Refresh tracking</button><button class="btn-admin btn-secondary" type="button" data-shipment-cancel '+(state.busy||state.blocked||!shipment.can_cancel?'disabled':'')+'>'+escape(shipment.status==='booking_failed'?'Discard rejected booking':'Cancel courier shipment')+'</button></div>'+
      (history?'<details open><summary>Courier history</summary><ol class="shipment-events">'+history+'</ol></details>':'');
    card.setAttribute('aria-busy',String(state.busy));
    const collect=()=>{
      const value=name=>card.querySelector('[name="'+name+'"]')?.value??'';
      state.draft={weight:value('weight'),length:value('length'),width:value('width'),height:value('height'),dispatch_date:value('dispatch_date'),pickup_required:value('pickup_required')==='true',actual_booking_cost:value('actual_booking_cost'),tracking_number:value('tracking_number')};
      return state.draft;
    };
    // Assigning handlers avoids stacking listeners when a live status refresh
    // repaints this same card while an operator is reading it.
    card.oninput=collect;card.onchange=collect;
    const changed=data=>{state.order=data;state.blocked=false;window.dispatchEvent(new CustomEvent('fmrc:shipment-updated',{detail:{order:data}}));};
    const refresh=async()=>{
      if(state.busy)return;state.busy=true;render(state.order,host);
      try{const data=await request('/admin/orders/'+order.id);state.message='Latest recorded courier updates loaded.';changed(data);}
      catch{state.blocked=true;state.message='Tracking could not be refreshed. Try again before making another courier request.';}
      finally{state.busy=false;render(state.order,host);}
    };
    const mutate=async(action,payload)=>{
      if(state.busy||state.blocked)return;collect();state.busy=true;render(state.order,host);
      try{const data=await request('/admin/orders/'+order.id+'/shipment/'+action,{method:'POST',body:JSON.stringify(payload)});state.draft=null;state.message=data.courier_shipment?.status_label||'Courier tracking updated.';changed(data);}
      catch(error){state.message=error.message;try{changed(await request('/admin/orders/'+order.id));}catch{state.blocked=true;}}
      finally{state.busy=false;render(state.order,host);}
    };
    card.querySelector('[data-courier-form]').onsubmit=event=>{
      event.preventDefault();if(state.busy||state.blocked||(!shipment.can_book&&!shipment.can_retry)||!event.target.reportValidity())return;
      const values=collect(),payload={request_key:crypto.randomUUID(),weight:Number(values.weight),length:Number(values.length),width:Number(values.width),height:Number(values.height),dispatch_date:values.dispatch_date,pickup_required:values.pickup_required,
        ...(values.actual_booking_cost!==''?{actual_booking_cost:Number(values.actual_booking_cost)}:{})};
      window.showAdminConfirmPopup('Book this parcel with Ninja Van using the recorded measurements and handover details?',{title:'Book Courier Shipment',confirmText:'Book shipment',onConfirm:()=>mutate('book',payload)});
    };
    card.querySelector('[data-shipment-refresh]').onclick=refresh;
    card.querySelector('[data-shipment-cancel]').onclick=()=>{
      if(state.busy||state.blocked||!shipment.can_cancel)return;
      window.showAdminConfirmPopup('Cancel this courier booking? This does not cancel the customer order or change its payment.',{title:'Cancel Courier Shipment',confirmText:'Cancel shipment',onConfirm:()=>mutate('cancel',{request_key:crypto.randomUUID()})});
    };
    const link=card.querySelector('[data-shipment-link]');if(link)link.onclick=()=>{
      if(state.busy||!shipment.can_link)return;const tracking=collect().tracking_number.trim();
      if(!/^[a-zA-Z0-9-]{9,100}$/.test(tracking)){state.message='Enter the tracking number shown for this reference in the courier dashboard.';render(state.order,host);return;}
      window.showAdminConfirmPopup('Link this existing tracking number? Courier updates will still confirm its status.',{title:'Link Existing Tracking',confirmText:'Link tracking',onConfirm:()=>mutate('link-tracking',{tracking_number:tracking})});
    };
  };
  window.AdminCourierShipments={render};
})();
