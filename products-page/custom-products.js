/* Private custom requests, shared by the customer page and both Orders portals. */
(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = value => new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(value || 0));
  const date = value => value ? new Date(value).toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}) : '—';
  const uid = () => crypto.randomUUID();
  const titleCase = value => value.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
  const steps = ['Product Details','Design & Specifications','Pickup or Delivery','Review & Submit'];
  const labels = {title:'Product name or idea',description:'Describe the product',intended_use:'Intended use',quantity:'Quantity',size:'Dimensions with units or size',material:'Preferred material',colors:'Colors',finish:'Finish',personalization:'Text or personalization',budget:'Budget in PHP (optional)',preferred_date:'Preferred completion date (optional)',notes:'Additional instructions',contact_name:'Contact name',contact_phone:'Contact number',fulfillment_type:'Pickup or delivery',delivery_recipient_name:'Recipient name',delivery_contact_no:'Recipient contact number',delivery_street:'House/unit and street',delivery_barangay:'Barangay',delivery_city:'City or municipality',delivery_province:'Province',delivery_postal_code:'Postal code',delivery_landmark:'Landmark (optional)'};
  const fields = [['title','description','intended_use','quantity'],['size','material','colors','finish','personalization','budget','preferred_date','notes'],['contact_name','contact_phone','fulfillment_type','delivery_recipient_name','delivery_contact_no','delivery_street','delivery_barangay','delivery_city','delivery_province','delivery_postal_code','delivery_landmark']];
  const fileAccept = '.jpg,.jpeg,.png,.webp,.gif,.pdf,.doc,.docx,.stl,.obj,.step,.stp,.iges,.igs,.dxf,.dwg';
  const unavailable = 'Custom requests are temporarily unavailable. Please try again shortly.';
  const requestPage = '../products-page/custom-products.html?new=1';
  const confirm = async (message, action = 'Continue') => {
    if (window.showCustomerPopup) {
      const opener = document.activeElement;
      const accepted = await window.showCustomerPopup(message, {
        title: action, okText: action, cancelText: 'Keep editing', isConfirm: true,
      });
      if (opener?.isConnected) opener.focus();
      return accepted;
    }
    return new Promise(resolve => {
    const dialog = document.createElement('dialog'); dialog.className='cp-dialog';
    dialog.innerHTML=`<h2>Confirm action</h2><p>${esc(message)}</p><form method="dialog" class="cp-actions"><button class="cp-btn secondary" value="cancel">Keep editing</button><button class="cp-btn" value="yes">${esc(action)}</button></form>`;
    document.body.append(dialog); dialog.addEventListener('close',()=>{const yes=dialog.returnValue==='yes';dialog.remove();resolve(yes);},{once:true});dialog.showModal();
    });
  };

  function workspaceDialog(operator) {
    const frame = document.createElement(operator ? 'dialog' : 'div');
    frame.className = operator ? 'modal-card order-rejection-dialog cp-order-dialog' : 'customer-modal-overlay ux-dlg cp-manager';
    if (!operator) frame.id = 'customerCustomRequestsModal';
    frame.setAttribute('aria-labelledby', 'customRequestsDialogTitle');
    const header = operator
      ? '<header class="modal-header-fixed"><h2 id="customRequestsDialogTitle" class="modal-title">Custom Request</h2></header>'
      : `<header class="ux-dlg__head">
        <button type="button" class="ux-dlg__close" data-cp-modal-close aria-label="Close My Custom Requests">&times;</button>
        <span class="ux-dlg__badge" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m14 6-9 5v10l9 5 9-5V11l-9-5Zm-9 5 9 5 9-5m-9 5v10M9.5 8.5l9 5M26 3v7m-3.5-3.5h7"/>
          </svg>
        </span>
        <p class="ux-dlg__eyebrow">Custom products</p>
        <h2 id="customRequestsDialogTitle" class="ux-dlg__title">My Custom Requests</h2>
      </header>`;
    const footer = operator
      ? `<footer class="modal-footer-fixed cp-dialog-footer">
        <button class="btn-admin btn-secondary" type="button" data-cp-modal-refresh>Refresh</button>
        <button class="btn-admin" type="button" data-cp-modal-close>Close</button>
      </footer>`
      : `<footer class="ux-dlg__foot cp-dialog-footer" data-list-pagination hidden>
        <span class="cp-page-count" data-request-count role="status"></span>
        <nav class="cp-page-nav" aria-label="Custom requests pagination">
          <button class="cp-btn secondary cp-page-arrow" type="button" data-page disabled aria-label="Previous page">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m10 4-4 4 4 4"/></svg>
          </button>
          <span data-current-page></span>
          <button class="cp-btn secondary cp-page-arrow" type="button" data-page disabled aria-label="Next page">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 4 4 4-4 4"/></svg>
          </button>
        </nav>
      </footer>`;
    const content = `${header}<div class="cp-workspace cp-dialog-body ${operator ? 'modal-body-scroll' : ''}" data-custom-products="${operator ? 'operator' : 'manager'}"></div>${footer}`;
    frame.innerHTML = operator ? content : `<section class="ux-dlg__card" role="dialog" aria-modal="true" aria-labelledby="customRequestsDialogTitle">${content}</section>`;
    document.body.append(frame);
    const root = frame.querySelector('[data-custom-products]');
    const closeButtons = frame.querySelectorAll('[data-cp-modal-close]');
    let opener;
    let overflow;
    return {
      frame, root, closeButtons,
      refresh: frame.querySelector('[data-cp-modal-refresh]'),
      pagination: frame.querySelector('[data-list-pagination]'),
      isOpen: () => operator ? frame.open : frame.classList.contains('show'),
      show(trigger) {
        opener = trigger || document.activeElement;
        overflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        if (operator) frame.showModal();
        else frame.classList.add('show');
        closeButtons[0].focus();
      },
      hide() {
        if (operator) frame.close();
        else frame.classList.remove('show');
        document.body.style.overflow = overflow;
        if (opener?.isConnected) opener.focus();
        else if (operator) document.querySelector('[data-tab="customrequests"]')?.focus();
      },
    };
  }

  window.AdminNotifFocus?.expect(['custom_request']);
  function mount(listRoot, manager = null) {
    let root = listRoot;
    const operator = listRoot.dataset.customProducts === 'operator';
    const dedicated = !operator && !manager;
    const detailDialog = operator ? workspaceDialog(true) : manager;
    const api = (window.APP_API_BASE_URL || document.querySelector('meta[name="api-base-url"]')?.content || (['localhost','127.0.0.1'].includes(location.hostname) && !['','80','8000'].includes(location.port) ? `${location.protocol}//${location.hostname}:8000/api` : `${location.origin}/api`)).replace(/\/$/,'');
    const prefix = operator ? '/admin/custom-requests' : '/customer/custom-requests';
    const token = () => operator ? window.AdminSession?.getToken() || localStorage.getItem('auth_token') : localStorage.getItem('customer_token');
    const query = new URLSearchParams(location.search);
    let current=null,services=[],available=true,busy=false,dirty=false,step=0,edit=false,quoteEdit=false,page=1,listState={},policy=null,baseline='',pollDelay=5000,timer,listFingerprint='';
    let retryLoad, searchTimer;
    const visible = () => operator ? !listRoot.closest('[hidden]') : !manager || manager.isOpen();
    if(operator&&query.get('service'))listState.service_id=query.get('service');
    let creationKey=uid(),requestKey=null, lastFingerprint='';
    const setNotice=(text,error=false)=>{let node=root.querySelector('[data-notice]');if(!node)return;node.hidden=!text;node.textContent=text;node.classList.toggle('error',error);};
    const request = async (path, body, files) => {
      const headers={Accept:'application/json',Authorization:`Bearer ${token() || ''}`};
      let payload;
      if(body && files?.length){payload=new FormData();payload.append('payload',JSON.stringify(body));for(const file of files)payload.append('attachments[]',file);}
      else if(body){headers['Content-Type']='application/json';payload=JSON.stringify(body);}
      let response;
      try {
        response=await fetch(api+path,{method:body?'POST':'GET',headers,body:payload,cache:'no-store',signal:AbortSignal.timeout(30000)});
      } catch {
        throw new Error('Could not connect. Check your connection and try again.');
      }
      const data=await response.json().catch(()=>({}));
      if(!response.ok){
        const message = response.status === 401 ? 'Your session has expired. Sign in again to continue.'
          : data.code === 'custom_requests_unavailable' ? unavailable
          : response.status >= 500 ? 'Could not complete this request. Please try again.'
          : data.errors?.expected_revision || data.errors?.request_key ? 'Could not save this version of your request. Your edits are still here. Please try again.'
          : Object.values(data.errors || {}).flat()[0] || data.message || 'Could not complete this request. Please try again.';
        const error = new Error(message);
        error.status = response.status;
        throw error;
      }
      return data;
    };
    const shell = content => {
      if (manager) manager.pagination.hidden = true;
      const controls = operator || dedicated ? '' : `<div class="cp-heading cp-workspace-controls">
        <div class="cp-actions">
          ${manager && (current || edit) ? '<button type="button" class="cp-btn secondary" data-list>All requests</button>' : ''}
          ${manager && available && services.some(service => service.accepts_custom_requests) ? `<a class="cp-btn" href="${requestPage}" target="_blank" rel="noopener noreferrer">New request</a>` : ''}
        </div></div>`;
      root.innerHTML = `${controls}<div class="cp-notice" data-notice role="status" aria-live="polite" hidden></div><button type="button" class="cp-btn secondary" data-review-updates hidden>Review latest update</button>${content}`;
    };
    const field = (key,value='',quoted=false) => {
      const required = ['title','description','quantity','contact_name','contact_phone','fulfillment_type'].includes(key);
      const textarea = ['description','intended_use','notes','personalization'].includes(key);
      let control;
      if(key==='fulfillment_type')control=`<select name="${key}" required><option value="pickup" ${value==='pickup'?'selected':''}>Pickup at FMRC</option><option value="delivery" ${value==='delivery'?'selected':''}>J&T delivery</option></select>`;
      else if(textarea)control=`<textarea name="${key}" maxlength="${key==='description'?3000:1000}" ${required?'required':''}>${esc(value)}</textarea>`;
      else control=`<input name="${key}" type="${['quantity','budget'].includes(key)?'number':key==='preferred_date'?'date':'text'}" value="${esc(value)}" ${required?'required':''} ${key==='quantity'?'min="1" max="999" step="1"':key==='budget'?'min="0" max="100000" step="0.01"':'maxlength="'+(key==='delivery_postal_code'?4:180)+'"'} ${key.includes('phone')||key==='delivery_contact_no'?'inputmode="tel"':''}>`;
      return `<label class="cp-field ${textarea?'cp-wide':''}" ${key.startsWith('delivery_')?'data-delivery':''}>${esc(labels[key])}${required?' *':''}${control}${!quoted&&['size','material','colors','finish'].includes(key)?`<span class="cp-check"><input type="checkbox" name="advice" value="${key}"> I need FMRC’s advice</span>`:''}</label>`;
    };
    const summary = spec => `<dl class="cp-summary">${Object.entries(labels).filter(([key])=>spec[key]!==undefined&&spec[key]!==''&&(!key.startsWith('delivery_')||spec.fulfillment_type==='delivery')).map(([key,label])=>`<dt>${esc(label)}</dt><dd>${esc(key==='fulfillment_type'?(spec[key]==='pickup'?'Pickup at FMRC':'J&T delivery'):spec[key])}</dd>`).join('')}${spec.advice_fields?.length?`<dt>FMRC advice requested</dt><dd>${esc(spec.advice_fields.map(titleCase).join(', '))}</dd>`:''}</dl>`;
    const filesMarkup = (files=[]) => `<div class="cp-files">${files.map(f=>`<span class="cp-file"><button type="button" class="cp-link" data-file="${f.id}">${esc(f.name)}</button> <small>${(f.size/1024/1024).toFixed(2)} MB</small></span>`).join('')}</div>`;
    const readSpecs = form => {
      const data=new FormData(form),spec={};for(const key of Object.keys(labels)){if(data.has(key)){const val=String(data.get(key)||'').trim();if(val!=='' || !['quantity','budget','preferred_date'].includes(key))spec[key]=val;}}
      if(spec.quantity)spec.quantity=Number(spec.quantity);if(spec.budget)spec.budget=Number(spec.budget);
      spec.advice_fields=data.getAll('advice');if(spec.fulfillment_type==='pickup')for(const key of Object.keys(spec))if(key.startsWith('delivery_'))delete spec[key];return spec;
    };
    const selectedFiles = form => [...(form.querySelector('[name=attachments]')?.files||[])];
    const validateFiles = files => {if(files.length>5||files.reduce((sum,f)=>sum+f.size,0)>50*1024*1024)throw Error('Choose up to five files totaling 50 MB or less.');};
    const syncDelivery = form => {const delivery=form.elements.fulfillment_type?.value==='delivery';form.querySelectorAll('[data-delivery]').forEach(label=>{label.hidden=!delivery;const input=label.querySelector('input');input.required=delivery&&!['delivery_landmark'].includes(input.name);});};
    const fingerprint = () => JSON.stringify([...root.querySelectorAll('form')].map(form=>[...new FormData(form)].map(([k,v])=>[k,v instanceof File?(v.name?[v.name,v.size,v.lastModified]:null):v])));
    const capture = () => {baseline=fingerprint();dirty=false;};
    const canLeave = async () => !dirty || await confirm('Discard your unsaved changes? Saved drafts and sent messages will remain available.','Discard changes');
    const renderEditor = () => {
      const existingService = current?.status !== 'draft' ? current?.service_id : null;
      const choices = services.filter(service => service.accepts_custom_requests || service.id === existingService);
      if (!available || !choices.length) {
        shell(`<div class="cp-card cp-empty"><h2>${available ? 'No services are accepting custom requests' : 'Custom requests are unavailable'}</h2>
          <p>${available ? 'Check back later or contact FMRC for assistance.' : unavailable}</p>
          <button class="cp-btn secondary" type="button" data-retry>Try again</button></div>`);
        return;
      }
      edit=true;quoteEdit=false;step=0;const spec=current?.specifications || {quantity:1,fulfillment_type:'pickup'};
      const selected=String(current?.service_id || (dedicated ? query.get('service') : '') || '');
      shell(`<form data-editor class="cp-card" novalidate><ol class="cp-steps">${steps.map((s,i)=>`<li data-step-label="${i}"><span class="cp-step-number" aria-hidden="true">${i+1}</span><span>${s}</span></li>`).join('')}</ol>${fields.map((group,i)=>`<section data-step="${i}" ${i?'hidden':''}><h2>${steps[i]}</h2><div class="cp-grid">${i===0?`<label class="cp-field cp-wide">FMRC service *<select name="service_id" required><option value="">Choose an available service</option>${choices.map(s=>`<option value="${s.id}" ${String(s.id)===selected?'selected':''}>${esc(s.title)}</option>`).join('')}</select><small>Requests are reviewed for feasibility within FMRC’s available services.</small></label>`:''}${group.map(key=>field(key,spec[key])).join('')}</div>${i===1?`<div class="cp-field cp-wide cp-design-field"><label for="customDesignFiles">Reference designs (optional)</label><input id="customDesignFiles" name="attachments" type="file" accept="${fileAccept}" multiple class="cp-file-input"><small>Up to five files, 50 MB combined. Images, PDF, Word and supported CAD files. Designs remain private.</small></div>${filesMarkup((current?.attachments||[]).filter(f=>!f.message_id))}${(current?.attachments||[]).filter(f=>!f.message_id&&!(current?.quotes||[]).some(q=>(q.snapshot.proof_ids||[]).includes(f.id))).map(f=>`<label class="cp-check"><input type="checkbox" name="remove_attachment_ids" value="${f.id}">Remove ${esc(f.name)} with next save</label>`).join('')}`:''}${i===2?'<p class="cp-help">FMRC confirms delivery eligibility and includes the shipping fee in your quotation. Your preferred completion date is a request, not a guaranteed deadline.</p>':''}</section>`).join('')}<section data-step="3" hidden><h2>Review your request</h2><div data-review></div><p class="cp-notice">Submitting a request does not place a paid order. FMRC will review your idea and send a quotation for your approval.</p></section><div class="cp-page-footer"><button type="button" class="cp-btn secondary" data-save-draft>Save Draft</button><div class="cp-actions"><button type="button" class="cp-btn secondary" data-back>Back</button><button type="button" class="cp-btn" data-next>Continue</button><button type="submit" class="cp-btn" data-submit hidden>Submit Request</button></div></div></form>`);
      const form=root.querySelector('[data-editor]');for(const key of spec.advice_fields||[]){const input=form.querySelector(`[name=advice][value="${key}"]`);if(input)input.checked=true;}
      syncDelivery(form);setStep(0);capture();
    };
    const setStep = (next, scroll = false) => {step=next;root.querySelectorAll('[data-step]').forEach(el=>el.hidden=Number(el.dataset.step)!==step);root.querySelectorAll('[data-step-label]').forEach(el=>{if(Number(el.dataset.stepLabel)===step)el.setAttribute('aria-current','step');else el.removeAttribute('aria-current');});const heading=root.querySelector(`[data-step="${step}"] h2`);if(heading){heading.tabIndex=-1;heading.focus({preventScroll:!scroll});}root.querySelector('[data-back]').hidden=step===0;root.querySelector('[data-next]').hidden=step===3;root.querySelector('[data-submit]').hidden=step!==3;if(step===3)root.querySelector('[data-review]').innerHTML=summary(readSpecs(root.querySelector('[data-editor]')));};
    const quoteCard = q => `<article class="cp-card"><div class="cp-heading"><h2>Quotation ${q.version}</h2><span class="cp-pill">${esc(titleCase(q.status))}</span></div>${summary(q.snapshot.specifications)}${filesMarkup((current.attachments||[]).filter(f=>(q.snapshot.proof_ids||[]).includes(f.id)))}<p class="cp-help">Production estimate: ${q.snapshot.production_days} working days after payment confirmation.${q.snapshot.specifications.fulfillment_type==='delivery'?` Estimated transit: ${q.snapshot.transit_min_days}–${q.snapshot.transit_max_days} working days.`:''}</p>${q.snapshot.quote_note?`<p>${esc(q.snapshot.quote_note)}</p>`:''}<dl class="cp-summary cp-money"><dt>Unit price</dt><dd>${money(q.unit_price)}</dd><dt>Product subtotal</dt><dd>${money(q.subtotal)}</dd><dt>Shipping</dt><dd>${money(q.shipping_fee)}</dd><dt>Total</dt><dd class="cp-total">${money(q.total)}</dd><dt>Pay by</dt><dd>${date(q.expires_at)}</dd></dl>${q.can_accept?`<form data-accept="${q.id}"><label class="cp-check"><input type="checkbox" name="design_accepted" required>I approve this design, specifications, quantity, price, and fulfillment details.</label><label class="cp-check"><input type="checkbox" name="policy_accepted" required>I agree to the <a href="../products-page/transaction-terms.html?version=${encodeURIComponent(policy?.version||'')}" target="_blank" rel="noopener">transaction terms</a> and <a href="../products-page/refund-policy.html?version=${encodeURIComponent(policy?.version||'')}" target="_blank" rel="noopener">refund policy</a>.</label><button class="cp-btn" type="submit" ${policy?.version?'':'disabled'}>Accept Quotation & Pay</button></form>`:''}</article>`;
    const orderCard = o => `<article class="cp-card"><div class="cp-heading"><h2>${esc(o.order_no)}</h2><span class="cp-pill">${esc(o.status_label)}</span></div><p>Total: <strong>${money(o.total)}</strong> · Payment: ${esc(titleCase(o.payment_status||'pending'))}</p><div class="cp-actions">${!operator&&o.can_pay?`<button class="cp-btn" data-pay="${o.id}">Continue to Payment</button>`:''}${operator&&o.custom_actions?.start?`<button class="cp-btn" data-production="start" data-order="${o.id}">Start Production</button>`:''}${operator&&o.custom_actions?.ready?`<button class="cp-btn" data-production="ready" data-order="${o.id}">Mark Ready</button>`:''}<a class="cp-btn secondary" href="${operator?'orders.html?notif=order&id='+o.id:'../home-page/main.html?orders=1&order_id='+o.id}">Open Order</a></div>${o.tracking?`<p>J&T waybill: <strong>${esc(o.tracking.tracking_number||'Awaiting handover')}</strong></p><p class="cp-help">${esc(o.tracking.status_label||o.tracking.status||'Tracking will appear after FMRC records the actual waybill.')}</p>`:''}</article>`;
    const renderDetail = () => {
      edit=false;quoteEdit=false;const r=current;
      shell(`<div class="cp-heading"><div><span class="cp-eyebrow">${esc(r.reference)} · ${esc(r.service?.title)}</span><h2>${esc(r.specifications.title||'Untitled draft')}</h2><span class="cp-pill">${esc(r.status_label)}</span></div><div class="cp-actions"><button class="cp-btn secondary" data-refresh>Refresh</button>${!operator&&r.actions.edit?'<button class="cp-btn" data-edit>Edit Request</button>':''}${operator&&r.actions.quote?'<button class="cp-btn" data-quote>Prepare Quotation</button>':''}</div></div><div class="cp-layout"><div>${r.orders.map(orderCard).join('')}${r.quotes.map(quoteCard).join('')}<article class="cp-card"><h2>Request details</h2>${summary(r.specifications)}${filesMarkup(r.attachments.filter(f=>!f.message_id))}</article></div><aside><article class="cp-card"><h2>Conversation</h2><p class="cp-help">Discuss specifications and revisions here. Changes to an accepted quotation require a new version.</p><div class="cp-messages">${r.messages.length?r.messages.map(m=>`<div class="cp-message"><header><strong>${esc(m.role==='customer'?m.author:'FMRC · '+m.author)}</strong><time>${date(m.created_at)}</time></header><p>${esc(m.body)}</p>${filesMarkup(r.attachments.filter(f=>f.message_id===m.id))}</div>`).join(''):'<p class="cp-help">No messages yet.</p>'}</div>${r.actions.message?`<form data-message><label class="cp-field">Message<textarea name="body" required maxlength="3000" placeholder="Share a clarification or ask about your request."></textarea></label><label class="cp-field">Attach designs (optional)<input type="file" name="attachments" multiple accept="${fileAccept}"><small>Up to five files, 50 MB combined.</small></label><div class="cp-actions"><button class="cp-btn" type="submit">Send Message</button></div></form>`:''}</article><article class="cp-card"><h3>Request actions</h3>${operator&&r.actions.review?'<div class="cp-actions"><button class="cp-btn secondary" data-status="review">Start Review</button><button class="cp-btn secondary" data-status="clarify">Ask for Details</button><button class="cp-btn secondary" data-status="decline">Decline Request</button></div>':''}${r.actions.revision?`<button class="cp-btn secondary" data-status="${operator?'withdraw':'revision'}">${operator?'Withdraw / Revise Quote':'Request Changes'}</button>`:''}${!operator&&r.actions.cancel?'<button class="cp-link" data-status="cancel">Cancel request</button>':''}<p class="cp-help">For a linked order, use Open Order to review cancellation, pickup, delivery, and refund actions.</p><ol class="cp-history">${r.events.map(e=>`<li>${esc(e.description)}<br><time>${date(e.created_at)}</time></li>`).join('')}</ol></article></aside></div>`);
      capture();lastFingerprint=JSON.stringify(current);
    };
    const renderQuote = () => {
      edit=false;quoteEdit=true;const q=current.quotes.find(q=>q.status==='draft'),s=q?.snapshot.specifications||current.specifications;
      shell(`<form data-quote-editor class="cp-card" novalidate><h2>Prepare quotation · ${esc(current.reference)}</h2><p class="cp-help">Confirm the complete design before sending. Sent quotations remain in history and are valid for seven days.</p><div class="cp-grid">${fields.flat().map(key=>field(key,s[key],true)).join('')}</div><h3 style="margin-top:24px">Price and schedule</h3><div class="cp-grid">${[['unit_price','Unit price (includes design and fabrication)',q?.unit_price||''],['shipping_fee','Quoted shipping fee',q?.shipping_fee||0],['production_days','Production working days',q?.snapshot.production_days||''],['transit_min_days','Minimum transit working days',q?.snapshot.transit_min_days||''],['transit_max_days','Maximum transit working days',q?.snapshot.transit_max_days||'']].map(([name,label,value])=>`<label class="cp-field">${label}<input type="number" name="${name}" min="${name.includes('price') ? 0.01 : 0}" max="${name.includes('days')?365:100000}" step="${name.includes('days')?1:'.01'}" value="${value}" ${name.startsWith('transit')?'':'required'}></label>`).join('')}</div><label class="cp-field">Quotation note<textarea name="quote_note" maxlength="2000">${esc(q?.snapshot.quote_note||'')}</textarea></label><fieldset class="cp-card"><legend>Approved design proofs</legend>${current.attachments.length?current.attachments.map(f=>`<label class="cp-check"><input type="checkbox" name="proof_ids" value="${f.id}" ${q?.snapshot.proof_ids?.includes(f.id)?'checked':''}>${esc(f.name)}</label>`).join(''):'<p class="cp-help">Upload any design proof through the conversation first. Text specifications can be approved without an attachment.</p>'}</fieldset><label class="cp-check"><input type="checkbox" name="specifications_confirmed" required>I have resolved production-critical details and confirmed these specifications.</label><label class="cp-check"><input type="checkbox" name="delivery_confirmed">For delivery, I confirm that this product can be shipped to the quoted destination.</label><div class="cp-page-footer"><button type="button" class="cp-btn secondary" data-detail>Cancel</button><div class="cp-actions"><button type="submit" name="quote_action" value="save_quote" class="cp-btn secondary">Save Quote Draft</button><button type="submit" name="quote_action" value="send_quote" class="cp-btn">Send Quotation</button></div></div></form>`);
      syncDelivery(root.querySelector('form'));capture();
    };
    const readListFilters = () => {
      const form = root.querySelector('[data-list-filters]');
      return form && {
        search: form.querySelector('[data-search]').value.trim(),
        status: form.querySelector('[data-status-filter]').value,
        service_id: form.querySelector('[data-service-filter]').value,
      };
    };
    const filtersChanged = filters => filters && (
      filters.search !== (listState.search || '') ||
      filters.status !== (listState.status || 'all') ||
      filters.service_id !== (listState.service_id || '')
    );
    const loadList = async (quiet = false, rebuildFilters = false) => {
      if(!quiet){current=null;edit=false;quoteEdit=false;dirty=false;}
      const params=new URLSearchParams({page,...listState});const data=await request(prefix+'?'+params);
      if (quiet && (current || busy || !visible() || root.contains(document.activeElement))) return;
      if (!visible() || root !== listRoot || filtersChanged(readListFilters()) || String(params) !== String(new URLSearchParams({page,...listState}))) return;
      if (page > data.last_page) {
        page = data.last_page;
        return loadList(quiet, rebuildFilters);
      }
      const snapshot=JSON.stringify(data);if(quiet&&snapshot===listFingerprint)return;listFingerprint=snapshot;
      const fieldClass = operator ? 'field-stack' : 'cp-field';
      const inputClass = operator ? 'input-field' : '';
      const buttonClass = operator ? 'btn-admin btn-secondary' : 'cp-btn secondary';
      const statuses = ['draft','submitted','under_review','needs_information','quoted','ordered','expired','payment_review','declined','cancelled'];
      const serviceOptions = services.map(service => `<option value="${service.id}" ${String(listState.service_id) === String(service.id) ? 'selected' : ''}>${esc(service.title)}</option>`).join('');
      const historical = listState.service_id && !services.some(service => String(service.id) === String(listState.service_id));
      const filters = `<form data-list-filters class="cp-toolbar">
        <label class="${fieldClass}">Search<input class="${inputClass}" data-search maxlength="180" value="${esc(listState.search || '')}" placeholder="${operator ? 'Request, product or customer' : 'Request or product'}"></label>
        <label class="${fieldClass}">Status<select class="${inputClass}" data-status-filter><option value="all">All statuses</option>${statuses.filter(status => !operator || status !== 'draft').map(status => `<option value="${status}" ${listState.status === status ? 'selected' : ''}>${esc(titleCase(status))}</option>`).join('')}</select></label>
        <label class="${fieldClass}">Service<select class="${inputClass}" data-service-filter><option value="">All services</option>${historical ? `<option selected value="${esc(listState.service_id)}">Historical service</option>` : ''}${serviceOptions}</select></label>
        ${operator ? '' : '<button type="button" class="cp-btn secondary" data-cp-modal-refresh><i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i> Refresh</button>'}
      </form>`;
      const tones = {submitted:'status-blue',under_review:'status-blue',needs_information:'status-yellow',quoted:'status-yellow',ordered:'status-green',payment_review:'status-yellow',declined:'status-red',cancelled:'status-grey',expired:'status-grey'};
      const status = row => `<span class="${operator ? 'status-pill ' + (tones[row.status] || 'status-grey') : 'cp-pill'}" data-status="${esc(row.status)}">${esc(row.status_label)}</span>`;
      const view = row => operator
        ? `<button type="button" data-open="${row.id}" aria-label="View ${esc(row.reference)}" title="View request"><i class="fa-regular fa-eye" aria-hidden="true"></i></button>`
        : `<button type="button" class="${buttonClass}" data-open="${row.id}">View request</button>`;
      const empty = '<div class="cp-empty"><h3>No requests found</h3><p>Requests matching your filters will appear here.</p></div>';
      const rows = operator
        ? `<div class="table-wrapper"><table class="admin-table" id="customRequestsTable"><thead><tr><th>Request</th><th>Product / Service</th><th>Customer</th><th>Status</th><th>Updated</th><th class="sticky-action">Action</th></tr></thead><tbody>${data.data.map(row => `<tr><td>${esc(row.reference)}</td><td><strong>${esc(row.title)}</strong><br>${esc(row.service?.title)}</td><td>${esc(row.customer_name)}</td><td>${status(row)}</td><td>${date(row.updated_at)}</td><td class="action-icons sticky-action">${view(row)}</td></tr>`).join('')}</tbody></table></div>`
        : `<div class="cp-request-list">${data.data.map(row => `<article class="cp-card"><div class="cp-heading"><strong>${esc(row.reference)}</strong>${status(row)}</div><h3>${esc(row.title)}</h3><p>${esc(row.service?.title)} · ${date(row.updated_at)}</p><div class="cp-actions">${view(row)}</div></article>`).join('')}</div>`;
      const results = data.data.length ? rows : empty;
      if (manager) {
        const list = root.querySelector('[data-list-results]');
        if (list && !rebuildFilters) {
          list.innerHTML = results;
          setNotice('');
          root.querySelector('[data-retry]')?.remove();
        } else {
          shell(`${filters}<div data-list-results>${results}</div>`);
        }
        const footer = manager.pagination;
        footer.querySelector('[data-request-count]').textContent = `${data.total} request${data.total === 1 ? '' : 's'}`;
        footer.querySelector('[data-current-page]').textContent = `Page ${data.current_page} of ${data.last_page}`;
        const [previous, next] = footer.querySelectorAll('[data-page]');
        previous.dataset.page = page - 1;
        next.dataset.page = page + 1;
        previous.disabled = page <= 1;
        next.disabled = page >= data.last_page;
        footer.hidden = false;
        capture();
        return;
      }
      const pagination = `<div class="table-pagination">
        <button type="button" class="page-btn" aria-label="Previous page" data-page="${page-1}" ${page<=1?'disabled':''}><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button>
        <input class="page-number" type="number" data-page-number min="1" max="${data.last_page}" value="${page}" aria-label="Go to custom requests page">
        <button type="button" class="page-btn" aria-label="Next page" data-page="${page+1}" ${page>=data.last_page?'disabled':''}><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
      </div>`;
      const footer = `<span class="table-footer-meta">${data.total} request${data.total===1?'':'s'} · Page ${data.current_page} of ${data.last_page}</span>${pagination}`;
      const resultsNode = root.querySelector('[data-list-results]');
      if (resultsNode && !rebuildFilters) {
        resultsNode.innerHTML = results;
        root.querySelector('[data-list-footer]').innerHTML = footer;
        root.querySelector('[data-table-count]').textContent = `${data.total} request${data.total === 1 ? '' : 's'}`;
        setNotice('');
        root.querySelector('[data-retry]')?.remove();
      } else {
        shell(`<article class="panel cp-orders-card portal-data-card"><div class="panel-header portal-table-header"><h3 class="portal-table-title"><i class="fa-solid fa-pen-ruler portal-table-icon" aria-hidden="true"></i> Custom Requests</h3><span class="portal-table-count" data-table-count>${data.total} request${data.total === 1 ? '' : 's'}</span></div>${filters}<div data-list-results>${results}</div><div class="table-footer" data-list-footer>${footer}</div></article>`);
      }
      const badge=document.getElementById('tabCountCustomRequests');if(badge)badge.textContent=Object.values(data.counts||{}).reduce((sum,n)=>sum+Number(n),0);capture();
    };
    const loadPolicy = async () => {if(!operator){try{policy=(await request('/commerce/policy')).data;}catch{policy=null;}}};
    const loadDetail = async (id, trigger) => {
      const data = await request(prefix + '/' + id);
      await loadPolicy();
      if (operator) {
        root = detailDialog.root;
        if (!detailDialog.isOpen()) detailDialog.show(trigger);
      }
      current = data.data;
      renderDetail();
      if (detailDialog?.isOpen()) {
        root.scrollTop = 0;
        const heading = root.querySelector('h2');
        if (heading) {
          heading.tabIndex = -1;
          heading.focus({preventScroll: true});
        }
      }
      if (current.quotes.some(q => q.can_accept) && !policy?.version) {
        setNotice('Transaction terms are temporarily unavailable. Refresh before accepting a quotation.', true);
      }
    };
    const loadServices = async () => {
      const result = await request('/services');
      services = result.data || [];
      available = result.custom_requests_available !== false;
    };
    const load = async (task, showLoading = false) => {
      if (busy) return;
      retryLoad = () => load(task, showLoading);
      busy = true;
      if (showLoading) shell('<div class="cp-empty" role="status">Loading custom requests…</div>');
      try {
        await task();
      } catch (error) {
        const retry = '<button type="button" class="cp-btn secondary" data-retry>Try again</button>';
        if (showLoading) shell('<div class="cp-empty"><h3>Could not load custom requests</h3>' + retry + '</div>');
        else if (!root.querySelector('[data-retry]')) root.querySelector('[data-notice]')?.insertAdjacentHTML('afterend', retry);
        setNotice(error.message, true);
      } finally {
        busy = false;
      }
    };
    const syncListFilters = filters => {
      if (!filtersChanged(filters)) return;
      listState = filters;
      page = 1;
    };
    const applyListFilters = async () => {
      const filters = readListFilters();
      if (!visible() || !filtersChanged(filters)) return;
      if (busy) {
        searchTimer = setTimeout(applyListFilters, 100);
        return;
      }
      syncListFilters(filters);
      await load(() => loadList());
    };
    const act = async (action,data={},files=[]) => {
      if(busy)return;validateFiles(files);busy=true;root.setAttribute('aria-busy','true');const buttonStates=[...root.querySelectorAll('button')].map(button=>[button,button.disabled]);buttonStates.forEach(([button])=>button.disabled=true);
      try {
        requestKey ||= uid();
        const result=await request(prefix+'/'+current.id+'/'+action,{...data,expected_revision:current.revision,request_key:requestKey},files);
        requestKey = null;
        dirty = false;
        current = result.data;
        if (dedicated && (action === 'save' || action === 'submit')) {
          edit = false;
          shell(`<div class="cp-card cp-empty"><h2>${action === 'save' ? 'Draft saved' : 'Request submitted'}</h2>
            <p>${esc(current.reference)} · ${action === 'save' ? 'Open your draft when you are ready to continue.' : 'FMRC will review your specifications and contact you through your request.'}</p>
            <button class="cp-btn" type="button" data-custom-manager data-request-id="${current.id}">View request</button></div>`);
          capture();
        } else {
          renderDetail();
          setNotice(result.message);
        }
        try{const channel=new BroadcastChannel('fmrc-orders-realtime');channel.postMessage({type:'updated',source:'custom-products',at:Date.now()});channel.close();}catch{}
        if(result.payment?.checkout_url){const url=new URL(result.payment.checkout_url);if(url.protocol==='https:'&&url.hostname==='checkout.paymongo.com')location.assign(url.href);}
        return result;
      }catch(error){if(error.status&&error.status<500)requestKey=null;if(error.status===409)root.querySelector('[data-review-updates]').hidden=false;throw error;}
      finally{busy=false;root.removeAttribute('aria-busy');buttonStates.forEach(([button,disabled])=>{if(button.isConnected)button.disabled=disabled;});if(!policy?.version)root.querySelector('[data-accept] button')?.setAttribute('disabled','');}
    };
    const trackInput = event => {
      if (!visible() || !root.contains(event.target)) return;
      if (event.target.closest('[data-list-filters]')) {
        const typed = event.target.matches('[data-search]') &&
          ((event.type === 'input' && !event.isComposing) || event.type === 'compositionend');
        const selected = event.type === 'change' && event.target.matches('select');
        if (typed || selected) {
          clearTimeout(searchTimer);
          searchTimer = setTimeout(applyListFilters, typed ? 250 : 0);
        }
        return;
      }
      if (event.target.closest('form:not([data-list-filters])')) {
        dirty = fingerprint() !== baseline;
        requestKey = null;
      }
      if (event.target.name === 'fulfillment_type') syncDelivery(event.target.form);
    };
    document.addEventListener('input', trackInput);
    document.addEventListener('change', trackInput);
    if (!dedicated) document.addEventListener('compositionend', trackInput);
    const actionError = async (message, opener) => {
      if (operator || !window.showCustomerPopup) {
        setNotice(message, true);
        return;
      }
      await window.showCustomerPopup(message, {title: 'Could not complete this action', tone: 'error'});
      if (opener?.isConnected) opener.focus();
    };
    const run = (fn, opener = document.activeElement) => Promise.resolve().then(fn)
      .catch(error => actionError(error.message || 'Please try again.', opener));
    document.addEventListener('click',event=>{const button=event.target.closest('button,a');if(!button||busy||!visible())return;
    const inPagination = manager && !manager.pagination.hidden && manager.pagination.contains(button);
    if (!root.contains(button) && !inPagination) return;
    run(async()=>{
      if(button.matches('[data-retry]'))await retryLoad?.();
      if(button.matches('[data-review-updates]')){
        const latest=(await request(prefix+'/'+current.id)).data;
        const dialog=document.createElement('dialog');dialog.className='cp-dialog';dialog.innerHTML=`<h2>Latest request update</h2><p>${esc(latest.status_label)} · ${esc(latest.reference)}</p>${summary(latest.specifications)}<p>Your unsaved fields will stay in this form. Review these changes before saving again.</p><form method="dialog" class="cp-actions"><button class="cp-btn secondary" value="cancel">Keep reviewing</button><button class="cp-btn" value="keep">Keep my draft</button></form>`;
        document.body.append(dialog);dialog.addEventListener('close',()=>{if(dialog.returnValue==='keep'){current=latest;lastFingerprint=JSON.stringify(latest);requestKey=null;button.hidden=true;setNotice('Latest version reviewed. Your unsaved fields are preserved. Save when you are ready.');}dialog.remove();},{once:true});dialog.showModal();
      }
      if(button.matches('[data-list]') && await canLeave()) await load(() => loadList(), true);
      if(button.matches('[data-edit]')&&await canLeave())renderEditor();
      if(button.matches('[data-quote]')){if(await canLeave())renderQuote();}
      if(button.matches('[data-detail]')){if(await canLeave())renderDetail();}
      if(button.matches('[data-open]') && await canLeave()) await load(() => loadDetail(button.dataset.open, button));
      if(button.matches('[data-refresh]') && await canLeave()) await load(() => loadDetail(current.id));
      if (manager && button.matches('[data-cp-modal-refresh]')) {
        clearTimeout(searchTimer);
        syncListFilters(readListFilters());
        await load(async () => {
          await loadServices();
          await loadList(false, true);
        });
        if (!button.isConnected) root.querySelector('[data-cp-modal-refresh]')?.focus({preventScroll: true});
      }
      if(button.matches('[data-next]')){
        const invalid = [...root.querySelectorAll(`[data-step="${step}"] :is(input,select,textarea)`)].find(field => !field.checkValidity());
        if (invalid) return actionError(invalid.validationMessage, invalid);
        setStep(Math.min(3,step+1), true);
      }
      if(button.matches('[data-back]'))setStep(Math.max(0,step-1), true);
      if(button.matches('[data-save-draft]'))await saveRequest(false);
      if (button.matches('[data-page]')) {
        if (manager && filtersChanged(readListFilters())) {
          clearTimeout(searchTimer);
          await applyListFilters();
        } else {
          page = Number(button.dataset.page);
          await load(() => loadList());
        }
      }
      if(button.matches('[data-production]')&&await canLeave()&&await confirm('Update this custom order to the selected production stage?','Update production')){await request('/admin/orders/'+button.dataset.order+'/production',{action:button.dataset.production,expected_revision:current.revision,request_key:uid()});await loadDetail(current.id);}
      if(button.matches('[data-pay]')){if(!await canLeave())return;busy=true;try{const data=await request('/customer/orders/'+button.dataset.pay+'/payment-checkout',{app_context:location.pathname.startsWith('/apps/customer/')?'customer':''});const payment=data.data||data;const url=payment.checkout_url||payment.payment?.checkout_url;if(url&&new URL(url).protocol==='https:'&&new URL(url).hostname==='checkout.paymongo.com'){dirty=false;location.assign(url);}else{await loadDetail(current.id);setNotice('Payment status refreshed. If checkout is still preparing, try again shortly.');}}finally{busy=false;}}
      if(button.matches('[data-file]')){const response=await fetch(api+prefix+'/'+current.id+'/attachments/'+button.dataset.file,{headers:{Authorization:`Bearer ${token()}`}});if(!response.ok)throw Error('This design file is unavailable.');const url=URL.createObjectURL(await response.blob());const a=document.createElement('a');a.href=url;a.download=current.attachments.find(f=>String(f.id)===button.dataset.file)?.name||'design';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
      if(button.matches('[data-status]')){
        if(!await canLeave())return;
        const action = button.dataset.status;
        const dialog = document.createElement('dialog');
        dialog.className = 'cp-dialog';
        dialog.innerHTML = `<form><h2>${esc(titleCase(action))}</h2><label class="cp-field">${action==='review'?'Review note (optional)':'Reason or requested details'}<textarea name="note" maxlength="1000" ${action==='review'?'':'required'}></textarea></label><p role="alert" data-dialog-error hidden></p><div class="cp-actions"><button type="button" class="cp-btn secondary" data-dismiss>Cancel</button><button class="cp-btn" type="submit">Confirm</button></div></form>`;
        let pausedForError = false;
        document.body.append(dialog);
        dialog.querySelector('[data-dismiss]').onclick = () => { if (!busy) dialog.close(); };
        dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
        dialog.addEventListener('close', () => { if (!pausedForError) dialog.remove(); });
        dialog.querySelector('form').onsubmit = async event => {
          event.preventDefault();
          if (busy) return;
          const submit = dialog.querySelector('[type=submit]');
          const note = dialog.querySelector('textarea');
          submit.disabled = true;
          try {
            await act(action, {note: note.value});
            dialog.close();
          } catch (error) {
            if (operator || !window.showCustomerPopup) {
              const notice = dialog.querySelector('[data-dialog-error]');
              notice.textContent = error.message;
              notice.hidden = false;
            } else {
              // The shared popup must be outside the native dialog's top layer.
              pausedForError = true;
              const closed = new Promise(resolve => dialog.addEventListener('close', resolve, {once: true}));
              dialog.close();
              await closed;
              await actionError(error.message);
              pausedForError = false;
              if (visible()) { dialog.showModal(); note.focus(); }
              else dialog.remove();
            }
          } finally {
            submit.disabled = false;
          }
        };
        dialog.showModal();
      }
    });});
    const saveRequest=async submit=>{
      if (busy) return;
      const form = root.querySelector('[data-editor]');
      const service = Number(form.elements.service_id.value);
      const files = selectedFiles(form);
      validateFiles(files);
      if (!service) return actionError('Choose an available FMRC service.', form.elements.service_id);
      const data = {service_id: service, specifications: readSpecs(form),
        remove_attachment_ids: new FormData(form).getAll('remove_attachment_ids').map(Number)};
      busy = true;
      try {
        if (submit && !await confirm('Submit this request to FMRC for review and quotation?', 'Submit Request')) return;
        form.inert = true;
        if (!current) current = (await request(prefix, {creation_key: creationKey, service_id: service})).data;
        if (!Number.isInteger(current.revision)) current = (await request(prefix + '/' + current.id)).data;
      } catch (error) {
        form.inert = false;
        throw error;
      } finally {
        busy = false;
      }
      try {
        await act(submit ? 'submit' : 'save', data, files);
      } finally {
        form.inert = false;
      }
    };
    document.addEventListener('submit',event=>{if(!visible()||!root.contains(event.target))return;event.preventDefault();if(busy)return;const form=event.target;run(async()=>{
      if(form.matches('[data-list-filters]')){
        clearTimeout(searchTimer);
        await applyListFilters();
        return;
      }
      if(form.matches('[data-editor]')){const invalid=[...form.elements].find(i=>i.checkValidity&&!i.checkValidity());if(invalid){const section=invalid.closest('[data-step]');if(section)setStep(Number(section.dataset.step));return actionError(invalid.validationMessage,invalid);}await saveRequest(true);}
      if(form.matches('[data-message]'))await act('message',{body:form.elements.body.value},selectedFiles(form));
      if(form.matches('[data-quote-editor]')){const data=Object.fromEntries(new FormData(form));const payload={specifications:readSpecs(form),unit_price:Number(data.unit_price),shipping_fee:Number(data.shipping_fee),production_days:Number(data.production_days)||null,transit_min_days:Number(data.transit_min_days)||null,transit_max_days:Number(data.transit_max_days)||null,proof_ids:new FormData(form).getAll('proof_ids').map(Number),specifications_confirmed:!!data.specifications_confirmed,delivery_confirmed:!!data.delivery_confirmed,quote_note:data.quote_note};const action=event.submitter?.value||'save_quote';if(action==='send_quote'&&!form.reportValidity())return;if(action==='send_quote'&&!await confirm('Send this complete quotation to the customer? It will be valid for seven days.','Send Quotation'))return;await act(action,payload);}
      if(form.matches('[data-accept]')){if(!policy?.version)throw Error('Transaction policies are unavailable. Contact FMRC before payment.');const message=root.querySelector('[data-message]'),unsent=message&&(message.elements.body.value.trim()||selectedFiles(message).length);if(!await confirm((unsent?'Your unsent message will be discarded. ':'')+'Accept this quotation and continue to secure payment?','Accept & Pay'))return;await act('accept',{quote_id:Number(form.dataset.accept),design_accepted:form.elements.design_accepted.checked,policy_accepted:form.elements.policy_accepted.checked,policy_version:policy.version,app_context:location.pathname.startsWith('/apps/customer/')?'customer':''});}
    });});
    window.addEventListener('beforeunload',event=>{if(visible()&&(dirty||document.querySelector('.cp-dialog[open] textarea')?.value.trim())){event.preventDefault();event.returnValue='';}});
    document.addEventListener('click',event=>{const link=event.target.closest('a[href]');if(event.defaultPrevented||!visible()||!dirty||!link||link.hasAttribute('data-custom-manager')||link.target==='_blank'||link.getAttribute('href').startsWith('#'))return;event.preventDefault();run(async()=>{if(await canLeave()){dirty=false;location.assign(link.href);}});},true);
    let polling = false;
    const poll=async()=>{
      clearTimeout(timer);
      if (!visible() || polling) return;
      if(!document.hidden&&!busy&&token()){
        polling = true;
        try{
          if(current && !dedicated){
            const id = current.id;
            const data=(await request(prefix+'/'+id)).data;
            if(!busy && visible() && current?.id === id && JSON.stringify(data)!==lastFingerprint){
              if(dirty||edit||quoteEdit){setNotice('This request has updates. Your unsaved work has been kept. Review the latest update before saving.');root.querySelector('[data-review-updates]').hidden=false;}
              else{
                const activeRoot = root;
                const scroller = detailDialog?.isOpen() ? activeRoot : document.scrollingElement;
                const y = scroller.scrollTop;
                await loadPolicy();
                if (root === activeRoot && !busy && !dirty && current?.id === id) {
                  current = data;
                  renderDetail();
                  scroller.scrollTop = y;
                }
              }
            }
          }else if(!dedicated&&!edit&&!quoteEdit&&!root.contains(document.activeElement))await loadList(true);
          pollDelay=5000;
        }catch{pollDelay=Math.min(pollDelay*2,30000);}
        finally{polling=false;}
      }
      timer=setTimeout(poll,pollDelay);
    };
    window.addEventListener('focus',poll);window.addEventListener('online',poll);document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});
    const start = async id => {
      if(!token()){
        const base = location.pathname.startsWith('/apps/customer/') ? '/apps/customer' : '';
        const returnPath = dedicated ? location.pathname + location.search : base + '/products-page/product.html?custom_requests=1' + (id ? '&request=' + encodeURIComponent(id) : '');
        shell(`<div class="cp-card cp-empty"><h2>Sign in to view custom requests</h2><p>Your designs, conversations, and quotations stay in your account.</p><a class="cp-btn" href="../customer-auth/auth.html?custom_return=${encodeURIComponent(returnPath)}">Sign In</a></div>`);
        return;
      }
      await load(async () => {
        await loadServices();
        if (dedicated) renderEditor();
        else {
          await loadList();
          if (id) {
            try { await loadDetail(id); }
            catch (error) {
              retryLoad = () => load(() => loadDetail(id));
              setNotice(error.message, true);
              root.querySelector('[data-notice]').insertAdjacentHTML('afterend', '<button type="button" class="cp-btn secondary" data-retry>Try again</button>');
            }
          }
        }
      }, true);
      void poll();
    };
    if (detailDialog) {
      const close = async () => {
        if (busy || !await canLeave()) return;
        clearTimeout(searchTimer);
        const id = current?.id;
        capture();
        detailDialog.hide();
        const url = new URL(location.href);
        if (manager && url.searchParams.has('custom_requests')) {
          url.searchParams.delete('custom_requests');
          url.searchParams.delete('request');
          history.replaceState(null, '', url.href);
        }
        current = null;
        edit = quoteEdit = false;
        root = listRoot;
        listFingerprint = '';
        if (operator) {
          await load(() => loadList());
          if (id) listRoot.querySelector('[data-open="' + Number(id) + '"]')?.focus();
          void poll();
        }
      };
      const refresh = async () => {
        if (!busy && await canLeave()) {
          await load(async () => {
            await loadServices();
            if (current) await loadDetail(current.id);
            else await loadList();
          });
        }
      };
      detailDialog.closeButtons.forEach(button => button.addEventListener('click', close));
      detailDialog.refresh?.addEventListener('click', refresh);
      detailDialog.frame.addEventListener('cancel', event => { event.preventDefault(); void close(); });
      if (manager) detailDialog.frame.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          void close();
        }
        if (event.key !== 'Tab') return;
        const nodes = [...manager.frame.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')]
          .filter(node => node.getClientRects().length);
        const boundary = event.shiftKey ? nodes[0] : nodes.at(-1);
        if (document.activeElement === boundary) {
          event.preventDefault();
          (event.shiftKey ? nodes.at(-1) : nodes[0])?.focus();
        }
      });
      if (operator) {
        const tab = document.querySelector('[data-tab="customrequests"]');
        let loaded = false;
        const select = id => {
          if (!loaded) {
            loaded = true;
            return start(id);
          }
          if (id) return load(() => loadDetail(id));
          void poll();
        };
        const initial = query.get('custom_request') || (query.get('notif') === 'custom_request' ? query.get('id') : null);
        if (initial || query.has('custom_requests')) {
          tab?.click();
          void select(initial);
        }
        tab?.addEventListener('click', () => queueMicrotask(() => void select()));
        document.getElementById('ordersRefreshBtn')?.addEventListener('click', event => {
          if (!visible()) return;
          event.stopImmediatePropagation();
          if (!loaded) void select();
          else void refresh();
        }, true);
        document.addEventListener('keydown', event => {
          if (event.key !== 'Enter' || busy || !visible() || !root.contains(event.target) || !event.target.matches('[data-page-number]')) return;
          event.preventDefault();
          page = Math.max(1, Math.min(Number(event.target.max), Math.trunc(Number(event.target.value)) || 1));
          void load(() => loadList());
        });
        window.AdminNotifFocus?.onFocus(['custom_request'], intent => {
          run(async () => {
            if (!await canLeave()) return;
            if (!visible()) tab?.click();
            await select(intent.id);
          });
          return true;
        });
      }
    }
    if (dedicated) void start();
    return start;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const root = document.querySelector('[data-custom-products]');
    if (root?.dataset.customProducts === 'operator') {
      mount(root);
      return;
    }
    const query = new URLSearchParams(location.search);
    if (root && !query.has('new') && !query.has('service')) {
      const catalog = new URL('../products-page/product.html?custom_requests=1', location.href);
      if (query.has('request')) catalog.searchParams.set('request', query.get('request'));
      location.replace(catalog.href);
      return;
    }
    if (root) mount(root);
    let manager;
    let open;
    const openManager = (id, trigger) => {
      if (!manager) {
        manager = workspaceDialog(false);
        open = mount(manager.root, manager);
      }
      if (manager.isOpen()) return;
      manager.show(trigger);
      void open(id);
    };
    document.addEventListener('click', event => {
      const trigger = event.target.closest('[data-custom-manager]');
      if (!trigger || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      openManager(trigger.dataset.requestId, trigger);
    });
    if (query.has('custom_requests')) openManager(query.get('request'));
  });
})();
