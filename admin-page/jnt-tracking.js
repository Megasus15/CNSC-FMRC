/* Shared J&T handover controls. Page refreshes read FMRC data, never the courier API. */
(() => {
  'use strict';
  const states = new Set();
  // The same order can be open in Details and Tracking. Each host owns its draft.
  const hosts = new WeakMap();
  const currentHost = state => state.host?.querySelector('[data-courier-controls]')?.dataset.orderId===String(state.order?.id);
  const orderBusy = orderId => [...states].some(state=>String(state.order?.id)===String(orderId)&&state.busy);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const api = () => String(window.APP_API_BASE_URL || (['localhost','127.0.0.1'].includes(location.hostname) && location.port !== '8000' ? location.protocol+'//'+location.hostname+':8000/api' : location.origin+'/api')).replace(/\/$/,'');
  const request = async (path, options = {}) => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(api()+path, {...options, signal:controller.signal, cache:'no-store', headers:{Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+window.AdminSession?.getToken()}});
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = Object.values(body.errors || {}).flat()[0] || body.message;
        throw Error(response.status < 500 && message && !/SQLSTATE|Exception|Laravel/i.test(message) ? message : 'Shipment details could not be loaded. Please try again.');
      }
      return body.data;
    } catch (error) {
      if (error.name === 'AbortError' || error.name === 'TypeError') throw Error('The request could not be confirmed. Refresh the saved shipment before trying again.');
      throw error;
    } finally { clearTimeout(timer); }
  };
  const localTime = value => new Date((value ? new Date(value).getTime() : Date.now()) + 8*3600000).toISOString().slice(0,16);
  const changed = (state, order, broadcast = false) => {
    state.order = order;
    if(currentHost(state))render(order,state.host);
    if (broadcast) window.dispatchEvent(new CustomEvent('fmrc:shipment-updated',{detail:{order}}));
  };
  const load = async state => {
    if (state.busy || state.polling || Date.now() < (state.nextPoll || 0)) return;
    state.polling = true;
    if(currentHost(state))render(state.order,state.host);
    try { const shared=window.AdminOrderDialogs;const order=await (shared?.loadFulfillment?shared.loadFulfillment(state.order.id):request('/admin/orders/'+state.order.id));state.readError=false;state.message='Updated '+new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit',second:'2-digit'}).format(new Date())+' PHT.';if(order)changed(state,order,false);state.failures=0;state.nextPoll=0; }
    catch (error) { state.failures = Math.min(4, (state.failures || 0) + 1); state.nextPoll = Date.now() + 5000 * 2 ** state.failures; state.readError=true;state.message='Fulfillment could not be refreshed. Select Refresh to try again.';if(currentHost(state))render(state.order,state.host); }
    finally { state.polling = false;if(currentHost(state))render(state.order,state.host); }
  };
  const mutate = async (state, method, suffix, payload) => {
    if (orderBusy(state.order.id)) return;
    state.busy = true; state.message = ''; render(state.order, state.host);
    try {
      const order = await request('/admin/orders/'+state.order.id+'/shipment/tracking'+suffix, {method,body:JSON.stringify(payload)});
      state.editing = false; state.draft = null; state.requestKey = null; state.layout = null;
      state.message = suffix ? 'Tracking update requested. Saved updates will refresh automatically.' : 'J&T tracking number saved.';
      changed(state, order, true);
    } catch (error) {
      state.message = error.message;
      try { changed(state, await request('/admin/orders/'+state.order.id)); } catch { /* Preserve draft and request key after an uncertain response. */ }
    } finally { state.busy = false;if(currentHost(state))render(state.order,state.host); }
  };
  const render = (order, host) => {
    if (!host || order.courier_shipment?.tracking_provider!=='17track') return;
    const scrollBody=host.closest('.modal-body-scroll'),scrollTop=scrollBody?.scrollTop;
    let records=hosts.get(host);if(!records){records=new Map();hosts.set(host,records);}
    let state=records.get(String(order.id));
    if(!state){state={draft:null,editing:false,busy:false,polling:false,message:'',layout:null};records.set(String(order.id),state);states.add(state);}
    if (!Array.isArray(order.timeline) && Array.isArray(state.order?.timeline)) order = {...order, timeline:state.order.timeline};
    state.order = order; state.host = host;
    let card = host.querySelector('[data-courier-controls]');
    if (!card) { card = document.createElement('section'); card.dataset.courierControls = ''; card.className = 'shipment-control-card'; host.appendChild(card); }
    const shipment = order.courier_shipment;
    const otherHandover = shipment.id && !state.editing && state.draft;
    const formOpen = !shipment.id || state.editing || Boolean(otherHandover);
    const layout = String(order.id)+':'+(formOpen ? 'form' : String(shipment.id));
    if (card.dataset.jntLayout !== layout || state.layout !== layout || !card.querySelector('[data-jnt-status]')) {
      state.layout = layout; card.dataset.jntLayout = layout; card.dataset.orderId = String(order.id);
      const draft = state.draft || {tracking_number:state.editing ? shipment.tracking_number : '', handed_over_at:localTime(shipment.handed_over_at),
        actual_shipping_cost:shipment.actual_shipping_cost ?? '', correction_reason:'', handover_confirmed:false};
      const prefix = (host.id === 'trackingManagedShipment' ? 'tracking-jnt-' : 'jnt-')+order.id+'-';
      card.innerHTML = '<div class="shipment-heading"><h4>J&T Express delivery</h4><span class="status-pill status-yellow" data-jnt-status></span></div>'+
        '<p class="shipment-note" data-jnt-availability></p><div data-jnt-summary></div><p class="shipment-message" role="status" aria-live="polite" data-jnt-message></p>'+
        (formOpen ? '<form data-jnt-form id="'+prefix+'form"><fieldset><legend class="jnt-form-title">'+(state.editing?'Correct tracking number':'Record parcel handover')+'</legend><div class="shipment-fields">'+
          '<div class="field-stack"><label for="'+prefix+'number">J&T tracking number</label><input class="input-field" id="'+prefix+'number" name="tracking_number" required minlength="5" maxlength="50" autocomplete="off" spellcheck="false" value="'+escape(draft.tracking_number)+'" /></div>'+
          '<div class="field-stack"><label for="'+prefix+'time">Actual handover time (Philippine time)</label><input class="input-field" id="'+prefix+'time" name="handed_over_at" type="datetime-local" required max="'+localTime()+'" value="'+escape(draft.handed_over_at)+'" /></div>'+
          '<div class="field-stack"><label for="'+prefix+'cost">J&T charge (PHP, optional)</label><input class="input-field" id="'+prefix+'cost" name="actual_shipping_cost" type="number" min="0" max="999999.99" step="0.01" value="'+escape(draft.actual_shipping_cost)+'" /></div>'+
          (state.editing?'<div class="field-stack"><label for="'+prefix+'reason">Reason for correction</label><textarea class="input-field" id="'+prefix+'reason" name="correction_reason" minlength="5" maxlength="500" required>'+escape(draft.correction_reason)+'</textarea></div>':'')+'</div>'+
          '<label class="jnt-confirm" for="'+prefix+'confirmed"><input id="'+prefix+'confirmed" name="handover_confirmed" type="checkbox" required '+(draft.handover_confirmed?'checked':'')+' /><span>I confirm this parcel was physically handed to J&T and the number matches the J&T receipt.</span></label>'+
          '<p class="shipment-reference">The customer’s accepted shipping fee stays unchanged.</p></fieldset></form>':'')+
        '<div class="shipment-actions shipment-primary-actions">'+(formOpen?'<button class="btn-admin" type="submit" form="'+prefix+'form" data-jnt-submit>'+(state.editing?'Save correction':'Record handover')+'</button>'+(state.editing?'<button class="btn-admin btn-secondary" type="button" data-jnt-discard>Discard correction</button>':''):'')+
        '<button class="btn-admin btn-secondary" type="button" data-jnt-load><i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i> <span>Refresh</span></button>'+
        (shipment.id?'<button class="btn-admin btn-secondary" type="button" data-jnt-refresh>Request tracking update</button><button class="btn-admin btn-secondary" type="button" data-jnt-correct>Correct tracking number</button>':'')+'</div><div data-jnt-history></div>';
      const collect = () => {
        const form = card.querySelector('[data-jnt-form]'); if (!form) return;
        state.draft = Object.fromEntries(new FormData(form));
        state.draft.handover_confirmed = form.elements.handover_confirmed.checked;
        state.requestKey = null;
      };
      card.oninput = collect; card.onchange = collect;
      const form = card.querySelector('[data-jnt-form]');
      if (form) form.onsubmit = event => {
        event.preventDefault(); if (state.busy || !form.reportValidity()) return;
        const values = Object.fromEntries(new FormData(form));
        const current = state.order.courier_shipment;
        if (!(state.editing ? current.can_correct : current.can_record)) return;
        state.requestKey ||= crypto.randomUUID();
        const payload = {request_key:state.requestKey,tracking_number:values.tracking_number.trim(),handed_over_at:values.handed_over_at+':00+08:00',handover_confirmed:form.elements.handover_confirmed.checked,
          ...(values.actual_shipping_cost!==''?{actual_shipping_cost:Number(values.actual_shipping_cost)}:{}),
          ...(state.editing?{expected_version:state.editVersion,correction_reason:values.correction_reason.trim()}: {})};
        window.showAdminConfirmPopup(state.editing?'Save this corrected tracking number? Earlier tracking stays in the order history.':'Record this J&T handover and save the tracking number?',
          {title:state.editing?'Correct J&T Tracking Number':'Record J&T Handover',confirmText:'Save tracking number',onConfirm:()=>mutate(state,state.editing?'PATCH':'POST','',payload)});
      };
      card.querySelector('[data-jnt-load]').onclick = () => {state.nextPoll=0;void load(state);};
      const refresh = card.querySelector('[data-jnt-refresh]'); if (refresh) refresh.onclick = () => mutate(state,'POST','/refresh',{});
      const correct = card.querySelector('[data-jnt-correct]'); if (correct) correct.onclick = () => {state.editing=true;state.editVersion=state.order.courier_shipment.version;state.draft=null;state.layout=null;state.message='';render(state.order,host);card.querySelector('[name="tracking_number"]')?.focus();};
      const discard = card.querySelector('[data-jnt-discard]'); if (discard) discard.onclick = () => {state.editing=false;state.draft=null;state.layout=null;render(state.order,host);};
    }
    card.setAttribute('aria-busy', String(state.busy || state.polling));
    card.querySelector('[data-jnt-status]').textContent = shipment.status_label;
    card.querySelector('[data-jnt-status]').className = 'status-pill '+(shipment.status==='delivered'?'status-green':'status-yellow');
    card.querySelector('[data-jnt-availability]').textContent = shipment.availability_message;
    card.querySelector('[data-jnt-message]').textContent = state.busy ? 'Saving shipment details…' : state.message || shipment.record_reason || (otherHandover?'A handover was saved by another operator. Your draft is preserved below; review the saved tracking number above.':shipment.needs_review?'A courier update needs review. The last confirmed status is preserved.':'');
    const summary = shipment.id ? '<dl class="jnt-summary"><div><dt>Tracking number</dt><dd class="jnt-waybill">'+escape(shipment.tracking_number)+'</dd></div><div><dt>Handed to J&T</dt><dd>'+escape(shipment.handed_over_at_label)+'</dd></div><div><dt>Latest courier update</dt><dd>'+escape(shipment.last_updated_at_label || 'Waiting for the first update')+'</dd></div><div><dt>Reported location</dt><dd>'+escape(shipment.location || 'Not provided by J&T')+'</dd></div></dl><div class="shipment-actions"><button class="btn-admin btn-secondary" type="button" data-jnt-copy>Copy tracking number</button><a class="btn-admin btn-secondary" href="https://www.jtexpress.ph" target="_blank" rel="noopener noreferrer">Open J&T tracking</a></div>' : '';
    if (card.querySelector('[data-jnt-summary]').dataset.value !== summary) {
      card.querySelector('[data-jnt-summary]').innerHTML = summary; card.querySelector('[data-jnt-summary]').dataset.value=summary;
      const copy = card.querySelector('[data-jnt-copy]'); if (copy) copy.onclick = async () => {try {await navigator.clipboard.writeText(shipment.tracking_number);state.message='Tracking number copied. Paste it into J&T tracking.';}catch {state.message='Select and copy the tracking number shown above.';}render(state.order,host);};
    }
    const form = card.querySelector('[data-jnt-form]'); if (form) {
      form.querySelector('fieldset').disabled = state.busy || !(state.editing?shipment.can_correct:shipment.can_record);
      form.elements.handed_over_at.max = localTime();
    }
    const refresh = card.querySelector('[data-jnt-refresh]'); if (refresh) refresh.disabled = state.busy || !shipment.can_refresh;
    const correct = card.querySelector('[data-jnt-correct]'); if (correct) {correct.hidden=!shipment.can_correct || state.editing;correct.disabled=state.busy;}
    const submit=card.querySelector('[data-jnt-submit]');if(submit)submit.disabled=state.busy||!(state.editing?shipment.can_correct:shipment.can_record);
    const loadButton=card.querySelector('[data-jnt-load]');loadButton.disabled=state.busy||state.polling;
    loadButton.querySelector('span').textContent=state.polling?'Refreshing…':'Refresh';
    const entries = (order.timeline || []).filter(entry => entry.metadata?.source === '17track' || entry.metadata?.tracking_number);
    const history = entries.length ? '<details open><summary>Shipment history</summary><ol class="shipment-events">'+entries.map(entry=>'<li><strong>'+escape(entry.title)+'</strong><time>'+escape(entry.occurred_at_label)+'</time><span>'+escape(entry.source_label || 'FMRC')+(entry.metadata?.tracking_number?' · '+escape(entry.metadata.tracking_number):'')+'</span>'+(entry.location_name?'<span>'+escape(entry.location_name)+'</span>':'')+'</li>').join('')+'</ol></details>' : '';
    const historyHost=card.querySelector('[data-jnt-history]');
    if (historyHost.dataset.value !== history) {const open=historyHost.querySelector('details')?.open;historyHost.innerHTML=history;historyHost.dataset.value=history;if(open===false&&historyHost.firstElementChild)historyHost.firstElementChild.open=false;}
    if(scrollBody)scrollBody.scrollTop=scrollTop;
  };
  setInterval(() => {
    if (document.hidden||window.AdminOrderDialogs?.ownsPolling) return;
    for (const state of states) if (state.host?.isConnected && state.host.closest('#modalOrderDetails, #modalTrackingUpdate')?.classList.contains('show')
      && state.host.querySelector('[data-courier-controls]')?.dataset.orderId === String(state.order.id)) void load(state);
  }, 5000);
  const clearReadError=orderId=>{
    for(const state of states)if(String(state.order?.id)===String(orderId)&&state.readError){state.readError=false;state.message='';state.failures=0;state.nextPoll=0;if(currentHost(state))render(state.order,state.host);}
  };
  window.AdminJntTracking = {render,clearReadError,draft:orderId=>[...states].find(state=>String(state.order?.id)===String(orderId)&&state.host?.id==='trackingManagedShipment')?.draft||null,busy:orderBusy};
})();
