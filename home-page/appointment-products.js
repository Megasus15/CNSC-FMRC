/* Optional appointment work uses the existing booking, appointment and order shells. */
(() => {
  'use strict';
  const team = /\/(admin-page|staff-page)\/|\/apps\/team\//.test(location.pathname);
  const token = () => team ? window.AdminSession?.getToken() || '' : localStorage.getItem('customer_token') || '';
  const api = () => String(window.APP_API_BASE_URL || ((['localhost','127.0.0.1'].includes(location.hostname) && location.port !== '8000') ? location.protocol+'//'+location.hostname+':8000/api' : location.origin+'/api')).replace(/\/$/,'');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uid = () => crypto.randomUUID();
  const money = value => new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(value)||0);
  const date = value => {if(!value)return '—';const parsed=new Date(/^\d{4}-\d{2}-\d{2} \d{2}:/.test(value)?value.replace(' ','T')+'Z':value);return Number.isNaN(parsed.getTime())?'—':new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}).format(parsed);};
  const link = path => window.FMRCApp?.url(path) || path;
  const icon = '<span class="ap-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 5v9l9 5 9-5V8M12 13v9M7 5l9 5"/></svg></span>';
  const contexts = new Map();
  let availability, availabilityLoadedAt=0, availabilityPending, bookingDraft = null, bookingKey = uid(), uploaded = new Set(), draftBusy = false, signingIn = false;
  const field = (name,label,value='',type='text',required=false,wide=false) => `<label class="ap-field${wide?' is-wide':''}"><span>${esc(label)}${required?' *':''}</span>${type==='textarea'?`<textarea name="${esc(name)}" maxlength="2000" ${required?'required':''}>${esc(value)}</textarea>`:`<input name="${esc(name)}" type="${type}" value="${esc(value)}" ${type==='number'?'min="1" step="1"':''} ${required?'required':''} maxlength="${name.includes('name')?'160':'400'}">`}</label>`;
  const button = (text, attrs='', secondary=false) => `<button type="button" class="ap-btn${secondary?' is-secondary':''}" ${attrs}>${text}</button>`;
  const popup = async (message,title='Custom product') => {
    if(team) { window.showAdminPopup?.(message,{title}); return; }
    return window.showCustomerPopup?.(message,{title});
  };
  const confirm = (message,title='Confirm action') => team ? new Promise(resolve => {
    window.showAdminConfirmPopup(message,{title,confirmText:'Confirm',onConfirm:()=>resolve(true),onCancel:()=>resolve(false)});
  }) : window.showCustomerPopup(message,{title,isConfirm:true,okText:'Confirm',cancelText:'Keep editing'});
  const request = async (path, options={}) => {
    const form = options.body instanceof FormData;
    let res;try {res = await fetch(api()+path,{...options,cache:'no-store',headers:{Accept:'application/json',...(token()?{Authorization:'Bearer '+token()}:{}),...(!form?{'Content-Type':'application/json'}:{}),...options.headers},signal:AbortSignal.timeout(60000)});}catch {throw Error('This action could not be confirmed. Your entries are still here. Check your connection and try again.');}
    const json = await res.json().catch(()=>({}));
    if(!res.ok) { const error = new Error(Object.values(json.errors||{}).flat()[0] || json.message || 'This action could not be confirmed. Your entries are still here. Please try again.'); error.status=res.status; throw error; }
    return json;
  };
  const loadAvailability = async () => {
    if(availability&&Date.now()-availabilityLoadedAt<30000)return availability;
    if(!availabilityPending)availabilityPending=request('/appointment-products/availability').then(result=>{availability=result.data;availabilityLoadedAt=Date.now();return availability;}).finally(()=>availabilityPending=null);
    return availabilityPending;
  };
  const older = (incoming,current) => incoming?.id===current?.id&&Number(incoming.revision)<Number(current.revision);
  const requirements = (form,prefix='') => {
    const get = name => form.elements[prefix+name]?.value?.trim() || '';
    const out = Object.fromEntries(['name','description','dimensions','material','colors','finish','personalization','intended_use','instructions'].map(k=>[k,get(k)]));
    out.service_id=Number(get('service_id'));out.quantity=Number(get('quantity'))||1;
    out.needs_advice=!!form.elements[prefix+'needs_advice']?.checked;
    if(get('budget'))out.budget=Number(get('budget')); if(get('preferred_date'))out.preferred_date=get('preferred_date');
    return out;
  };
  const briefFields = (data={},services=[],prefix='',final=false,operator=false) => `<div class="ap-grid">
    <label class="ap-field is-wide"><span>FMRC service *</span><select name="${prefix}service_id" required ${final?'disabled':''}>${services.map(s=>`<option value="${s.id}" ${Number(data.service_id)===Number(s.id)?'selected':''}>${esc(s.title)}</option>`).join('')}</select>${final?'<small>To change the service, save the product details and confirm the consultation outcome first.</small>':''}</label>
    ${field(prefix+'name','Product idea',data.name,'text',true)}${field(prefix+'quantity','Quantity',data.quantity||1,'number',true)}
    ${field(prefix+'description','Describe the product',data.description,'textarea',true,true)}
    ${field(prefix+'dimensions','Dimensions or size',data.dimensions,'text',final)}${field(prefix+'material','Material',data.material,'text',final)}
    ${field(prefix+'colors','Colors',data.colors,'text',final)}${field(prefix+'finish','Finish',data.finish,'text',final)}
    ${field(prefix+'personalization','Text or personalization',data.personalization,'textarea',false,true)}
    ${!final?`${field(prefix+'budget','Budget (optional)',data.budget,'text')}${field(prefix+'preferred_date','Preferred completion date',data.preferred_date,'date')}
      <label class="ap-check"><input type="checkbox" name="${prefix}needs_advice" ${data.needs_advice?'checked':''}><span>${operator?'The customer needs advice on some specifications.':'I need FMRC’s advice on some specifications.'}</span></label>`:''}
    ${field(prefix+'instructions','Additional instructions',data.instructions,'textarea',false,true)}
  </div>`;
  const specs = data => '<dl class="ap-summary">'+Object.entries({Product:data.name,Description:data.description,Quantity:data.quantity,Dimensions:data.dimensions,Material:data.material,Colors:data.colors,Finish:data.finish,Personalization:data.personalization,Instructions:data.instructions}).map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value||(['Personalization','Instructions'].includes(label)?'None':'To be discussed'))}</dd></div>`).join('')+'</dl>';
  const dirty = root => !!root?.querySelector('form[data-dirty="true"]');
  // Update options in place so a service refresh never replaces entered fields or files.
  async function refreshServices(ctx,select) {
    if(!select||select.dataset.loading)return;
    select.dataset.loading='true';select.setAttribute('aria-busy','true');
    try {
      const available=await loadAvailability();if(!select.isConnected)return;
      const selected=select.value,current={id:ctx.job.service_id,title:ctx.job.service_name};
      const services=[...(available.services||[])];if(!services.some(s=>Number(s.id)===Number(current.id)))services.push(current);
      select.replaceChildren(...services.map(s=>new Option(s.title,String(s.id),false,String(s.id)===selected)));
      if([...select.options].some(o=>o.value===selected))select.value=selected;
      select.dataset.loaded='true';
    }catch { /* Keep the saved service. Focusing the field retries the lookup. */ }
    finally {delete select.dataset.loading;select.removeAttribute('aria-busy');}
  }
  const allowLeave = async root => !dirty(root) || await confirm('Discard unsaved custom-product changes? Saved drafts, quotations and sent messages will remain available.','Unsaved changes');
  const download = async (job,file,admin=team) => {
    const response=await fetch(api()+`/${admin?'admin':'customer'}/appointment-products/${job}/files/${file.id}`,{headers:{Authorization:'Bearer '+token()},signal:AbortSignal.timeout(60000)});
    if(!response.ok)throw Error('This private file could not be downloaded. Please try again.');
    const href=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=href;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
  };
  const fileList = (files=[],empty='No design files yet. Files can be attached in Conversation.') => files.length ? '<ul class="ap-files">'+files.map(f=>`<li>${button(esc(f.name),`data-ap-file="${f.id}"`,true)}<small>${Math.ceil(Number(f.size)/1024)} KB</small></li>`).join('')+'</ul>' : `<p class="ap-help">${esc(empty)}</p>`;
  // Instructions describe the reader's next step; workflow state stays server-owned.
  const nextAction = ({job,appointment,admin}) => {
    const order=job.orders[0];
    if(order&&!['cancelled','rejected'].includes(order.lifecycle_status)) {
      const progress=job.progress;
      if(admin) return ({
        completed:'This custom order is complete. Open Orders to review payment and fulfillment history.',
        payment_review:'Review the payment in Orders before collecting payment or starting production.',
        in_transit:'Monitor J&T delivery and the customer’s receipt confirmation in Orders.',
        ready:order.fulfillment_type==='pickup'?'Record collection in Orders when the customer picks up the product.':'Record the J&T handover and waybill in Orders when the product is dispatched.',
        in_production:'Manage production in Orders. Mark the product ready when fabrication is complete.',
        awaiting_production:'Full payment is confirmed. Open Orders to start production.',
      })[progress] || 'Open Orders to verify full payment before starting production.';
      return ({
        completed:'Your custom order is complete. View your order for its payment and fulfillment history.',
        payment_review:'FMRC is checking your payment. Please wait before making another payment.',
        in_transit:'Track delivery in My Orders and confirm receipt when your product arrives.',
        ready:order.fulfillment_type==='pickup'?'Your product is ready for pickup. View My Orders for collection details.':'Your product is ready for shipping. Follow the delivery updates in My Orders.',
        in_production:'FMRC is making your product. Follow its progress in My Orders.',
        awaiting_production:'Your full payment is confirmed. FMRC will start production next.',
      })[progress] || 'Complete full payment in My Orders before production begins.';
    }
    const quote=job.quotations.find(q=>['sent','closing'].includes(q.state));
    if(quote?.state==='closing') return admin?'Wait for payment reconciliation in Orders before revising the quotation or collecting payment.':'FMRC is verifying the previous checkout. Please wait before approving a replacement quotation.';
    if(quote?.state==='sent') {
      if(Date.parse(quote.expires_at)<=Date.now()) return admin?'This quotation has expired. Review the specifications before sending a new version.':'Your quotation has expired. Ask FMRC for an updated quotation in Conversation.';
      return admin?'The quotation has been sent. Await customer approval and full payment before production.':'Review the design, specifications and total, then approve your quotation and pay before it expires.';
    }
    if(['cancelled','declined'].includes(job.state)) return admin?'This custom request is closed. The appointment and product history remain available.':'This custom request is closed. Your appointment and product history remain available.';
    if(job.state==='awaiting_consultation') {
      const completed=String(appointment?.status).toLowerCase()==='completed';
      return admin?(completed?'Record the consultation outcome and agreed specifications before preparing a quotation.':'Review the customer’s brief and complete the consultation before preparing a quotation.'):(completed?'FMRC will review the agreed specifications and prepare the next step.':'Attend your consultation to discuss the product with FMRC before receiving a quotation.');
    }
    return (admin?{
      draft:'The customer has saved a draft. No appointment time is reserved.',
      follow_up:'Review the open questions and arrange a follow-up consultation with the customer.',
      needs_information:'Review the customer’s reply in Conversation and confirm any missing specifications.',
      ready_for_quote:'Finalize the agreed specifications and prepare the customer’s quotation.',
    }:{
      draft:'Finish your product details and choose an available appointment time.',
      follow_up:'Book a follow-up appointment to discuss the remaining details with FMRC.',
      needs_information:'Send the requested details in Conversation so FMRC can continue reviewing your product.',
      ready_for_quote:'FMRC is preparing your quotation from the agreed specifications.',
    })[job.state] || (admin?'Review the product details and record the next step for the customer.':'FMRC is reviewing your product details. Updates will appear here.');
  };
  const quotationHint = ctx => {
    if(ctx.admin&&ctx.job.discussed_at&&['ready_for_quote','quoted'].includes(ctx.job.state))return 'Prepare the quotation below using the agreed design, specifications and delivery details.';
    if(['needs_information','follow_up','cancelled','declined'].includes(ctx.job.state))return nextAction(ctx);
    return ctx.admin?'Confirm the attended consultation and save its outcome as “Ready to prepare quotation” in Overview. Sent versions will appear here.':'Your quotation will appear here after FMRC reviews the consultation and final specifications.';
  };

  async function paint(ctx) {
    const {root,job,appointment,admin}=ctx;
    if(!root.isConnected)return;
    const openDetails=new Map([...root.querySelectorAll('details')].map(d=>[d.querySelector('summary')?.textContent,d.open]));
    const focused=root.contains(document.activeElement)?document.activeElement:null;
    const focusName=focused?.getAttribute('name'),focusTab=focused?.getAttribute('data-ap-tab'),focusForm=focused?.closest('[data-ap-form]')?.dataset.apForm;
    const selection=focused&&typeof focused.selectionStart==='number'?[focused.selectionStart,focused.selectionEnd]:null;
    const scrollHost=root.closest('.modal-body-scroll,.appointment-content'),scrollTop=scrollHost?.scrollTop;

    const current=job.quotations.find(q=>['sent','accepted','closing'].includes(q.state));
    const order=job.orders[0], activeOrder=order&&!['cancelled','rejected'].includes(order.lifecycle_status);
    const editable=!activeOrder&&!['cancelled','declined','draft'].includes(job.state);
    root.innerHTML=`<header class="ap-head"><div><h3>${icon}Custom Product</h3><p>${esc(nextAction(ctx))}</p></div><span class="ap-badge">${esc(job.stage)}</span></header>
      <div class="ap-update" data-ap-update hidden><span>An update is available. Finish editing or review the latest details.</span>${button('Review update','data-ap-latest',true)}</div>
      <div class="ap-tabs" role="tablist" aria-label="Custom product details">${['Overview','Quotation','Conversation'].map((t,i)=>button(t,`role="tab" id="ap-tab-${ctx.key}-${i}" aria-controls="ap-pane-${ctx.key}-${i}" tabindex="${ctx.tab===i?0:-1}" aria-selected="${ctx.tab===i}" data-ap-tab="${i}"`,ctx.tab!==i)).join('')}</div>
      <section role="tabpanel" id="ap-pane-${ctx.key}-0" aria-labelledby="ap-tab-${ctx.key}-0" data-ap-pane="0" ${ctx.tab!==0?'hidden':''}>${!admin&&job.state==='needs_information'?'<div class="ap-actions">'+button('Provide Details','data-ap-go-conversation')+'</div>':''}${!activeOrder&&current?.state==='sent'?'<div class="ap-actions">'+button(admin?'View Quotation':'Review Quotation','data-ap-go-quote')+'</div>':admin&&job.state==='ready_for_quote'?'<div class="ap-actions">'+button('Prepare Quotation','data-ap-go-quote')+'</div>':''}${specs(job.requirements)}${job.outcome_note?`<p><strong>FMRC update:</strong> ${esc(job.outcome_note)}</p>`:''}
        ${fileList(job.files)}${activeOrder?`<div class="ap-actions"><a class="ap-btn" href="${esc(link(admin?`/${location.pathname.includes('staff-page')?'staff-page':'admin-page'}/orders.html?order_id=${order.id}`:`/home-page/?orders=1&order_id=${order.id}`))}">${admin?'Open Order':order.payment_status==='pending'?'Continue Payment':'View Order'} ${esc(order.order_no)}</a></div>`:''}
        ${editable?`<details><summary>Update product details</summary><form data-ap-form="requirements">${briefFields(job.requirements,[{id:job.service_id,title:job.service_name}],'',false,admin)}<div class="ap-actions"><button class="ap-btn is-secondary" type="submit">Save Details</button></div></form></details>`:''}
        ${admin&&!activeOrder&&!['cancelled','declined'].includes(job.state)?`<details ${!job.discussed_at?'open':''}><summary>Record consultation outcome</summary><form data-ap-form="outcome"><div class="ap-grid"><label class="ap-field"><span>Next step *</span><select name="outcome"><option value="ready_for_quote">Ready to prepare quotation</option><option value="needs_information">More information needed</option><option value="follow_up">Follow-up appointment needed</option><option value="declined">Unable to fulfill</option></select></label><label class="ap-field"><span>Consultation discussed *</span><select name="discussed_appointment_id">${[{id:appointment.id,reference_no:appointment.reference_no},...(job.follow_ups||[])].filter((a,i,all)=>all.findIndex(b=>b.id===a.id)===i).map(a=>`<option value="${a.id}">${esc(a.reference_no)}</option>`).join('')}</select></label>${field('note','Summary for the customer',job.outcome_note,'textarea',true,true)}<label class="ap-check"><input type="checkbox" name="discussion_confirmed"><span>The meeting took place and the custom-product requirements were discussed. This is required before quoting.</span></label></div><div class="ap-actions"><button class="ap-btn is-secondary" type="submit">Save Outcome</button></div></form></details>`:''}
        ${!admin&&job.state==='follow_up'?`<details open><summary>Book a follow-up</summary><form data-ap-form="follow-up"><div class="ap-grid">${field('appointment_date','Available date','','date',true)}<label class="ap-field"><span>Available time *</span><select name="appointment_time" required><option value="">Choose a date first</option></select></label><label class="ap-field"><span>Meeting method *</span><select name="appointment_method"><option value="face_to_face">Face-to-face at FMRC</option><option value="online">Online</option></select></label></div><div class="ap-actions"><button class="ap-btn" type="submit">Confirm Follow-up</button></div></form></details>`:''}
        ${editable?`<details><summary>Cancel custom request</summary><p class="ap-help">${admin?'This closes only the product request. The appointment history is retained. Manage paid-order cancellations and refunds in Orders.':'This closes only your product request. Your appointment history is retained. For a paid order, request cancellation or a refund through My Orders.'}</p><form data-ap-form="cancel">${field('note','Reason','','textarea',true,true)}<div class="ap-actions"><button class="ap-btn is-secondary" type="submit">Cancel Custom Request</button></div></form></details>`:''}
        <details><summary>Activity history</summary>${job.activity.map(a=>`<p>${esc(a.description)}<br><small>${esc(date(a.created_at))}</small></p>`).join('')||'<p>No updates yet.</p>'}</details>
      </section>
      <section role="tabpanel" id="ap-pane-${ctx.key}-1" aria-labelledby="ap-tab-${ctx.key}-1" data-ap-pane="1" ${ctx.tab!==1?'hidden':''}>
        ${job.quotations.length?job.quotations.map(q=>`<article class="ap-message"><div class="ap-head"><div><h4>Quotation ${q.version}</h4><small>Sent ${esc(date(q.sent_at))} · Expires ${esc(date(q.expires_at))}</small></div><span class="ap-badge">${esc(q.state==='sent'&&Date.parse(q.expires_at)<=Date.now()?'Expired':({sent:'Awaiting approval',accepted:'Accepted',closing:'Checking payment',superseded:'Replaced',expired:'Expired'})[q.state]||q.state)}</span></div>
          ${specs(q.agreement.specifications)}<p><strong>Agreed design:</strong> ${esc(q.agreement.design_notes)}</p>
          ${fileList(job.files.filter(f=>q.agreement.proof_file_ids.includes(f.id)),'No separate proof files. Refer to the design description above.')}
          <dl class="ap-summary"><div><dt>Unit price × quantity</dt><dd>${money(q.agreement.unit_price)} × ${q.agreement.specifications.quantity}</dd></div><div><dt>Product subtotal</dt><dd>${money(q.agreement.product_subtotal)}</dd></div><div><dt>Shipping</dt><dd>${money(q.agreement.shipping_fee)}</dd></div><div><dt>Total</dt><dd><strong>${money(q.agreement.total)}</strong></dd></div><div><dt>Production lead time</dt><dd>${esc(q.agreement.lead_time)}</dd></div><div><dt>Fulfillment</dt><dd>${q.agreement.fulfillment_type==='pickup'?'Pickup at FMRC':'J&T delivery'}${q.agreement.fulfillment_type==='delivery'?'<br>'+Object.values(q.agreement.delivery).map(esc).join(', '):''}</dd></div></dl>
          ${!admin&&q.state==='sent'&&Date.parse(q.expires_at)>Date.now()?`<form data-ap-form="accept" data-quote="${q.id}"><div data-ap-policy><p>Loading current transaction terms…</p></div><label class="ap-check"><input type="checkbox" name="specifications_accepted" required><span>I approve this design, quantity, specifications, price, lead time, and pickup/delivery arrangement.</span></label><div class="ap-grid"><label class="ap-field"><span>Payment method *</span><select name="payment_method"><option value="online">Pay online</option><option value="cash">Full advance cash payment at FMRC</option></select></label></div><div class="ap-actions"><button type="submit" class="ap-btn" disabled>Approve Quotation</button></div></form>`:''}
        </article>`).join(''):`<p class="ap-help">${esc(quotationHint(ctx))}</p>`}
        ${admin&&editable&&job.discussed_at&&['ready_for_quote','quoted'].includes(job.state)?`<details ${!current?'open':''}><summary>${current?'Prepare revised quotation':'Prepare quotation'}</summary><p class="ap-help">Complete the final specifications. Use “Not applicable” where appropriate. Prices include design and fabrication costs.</p><form data-ap-form="quotation">${briefFields(current?.agreement.specifications||job.requirements,[{id:job.service_id,title:job.service_name}],'spec_',true)}<div class="ap-grid">${field('design_notes','Final design / proof description',current?.agreement.design_notes,'textarea',true,true)}${field('unit_price','Unit price (₱)',current?.agreement.unit_price,'text',true)}${field('shipping_fee','Shipping fee (₱)',current?.agreement.shipping_fee??0,'text',true)}${field('lead_time','Production lead time',current?.agreement.lead_time||'','text',true,true)}<label class="ap-field"><span>Pickup or delivery *</span><select name="fulfillment_type"><option value="pickup">Pickup at FMRC</option><option value="delivery">J&T delivery</option></select></label></div>
          <fieldset data-ap-delivery hidden><legend>Quoted delivery destination</legend><div class="ap-grid">${Object.entries({delivery_recipient_name:'Recipient name',delivery_contact_no:'Contact number',delivery_street:'Street / building',delivery_barangay:'Barangay',delivery_city:'City / municipality',delivery_province:'Province',delivery_postal_code:'Postal code'}).map(([n,l])=>field(n,l,current?.agreement.delivery?.[n])).join('')}<label class="ap-check"><input type="checkbox" name="delivery_eligible"><span>FMRC confirmed that this product and destination are eligible for delivery at the quoted shipping fee.</span></label></div></fieldset>
          ${job.files.length?`<fieldset><legend>Design proofs included in the quotation</legend>${job.files.map(f=>`<label class="ap-check"><input type="checkbox" name="proof_file_ids" value="${f.id}"><span>${esc(f.name)}</span></label>`).join('')}</fieldset>`:''}<div class="ap-actions"><button type="submit" class="ap-btn">Send Quotation</button></div></form></details>`:''}
      </section>
      <section role="tabpanel" id="ap-pane-${ctx.key}-2" aria-labelledby="ap-tab-${ctx.key}-2" data-ap-pane="2" ${ctx.tab!==2?'hidden':''}><p class="ap-help">${admin?'Private conversation with the customer. Agree any changes before sending a revised quotation. Manage paid-order changes through the cancellation and refund process in Orders.':'Private conversation with FMRC. Ask questions and share design files here. Discuss changes before payment; for a paid order, request help in My Orders.'}</p>${job.messages.map(m=>`<article class="ap-message"><strong>${esc(m.sender_name)} · ${esc(m.sender_role==='customer'?'Customer':'FMRC')}</strong><p>${esc(m.body)}</p><small>${esc(date(m.created_at))}</small>${fileList(job.files.filter(f=>f.message_id===m.id))}</article>`).join('')||'<p class="ap-help">No messages yet.</p>'}<form data-ap-form="messages">${field('body','Message','','textarea',true,true)}<label class="ap-field"><span>Attach designs (optional)</span><input type="file" name="attachments" multiple accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.doc,.docx,.stl,.obj,.step,.stp,.iges,.igs,.dxf,.dwg"><small>Up to five files, 50 MB combined.</small></label><div class="ap-actions"><button type="submit" class="ap-btn">Send Message</button></div></form></section>`;
    root.querySelectorAll('details').forEach(d=>{const name=d.querySelector('summary')?.textContent;if(openDetails.has(name))d.open=openDetails.get(name);});
    for(const form of root.querySelectorAll('form')) { form.dataset.key=uid();for(const type of ['input','change'])form.addEventListener(type,()=>form.dataset.dirty='true'); }
    const serviceSelect=root.querySelector('[data-ap-form="requirements"] [name="service_id"]');
    if(serviceSelect){void refreshServices(ctx,serviceSelect);serviceSelect.onfocus=()=>void refreshServices(ctx,serviceSelect);}
    root.onclick=async event=>{
      if(event.target.closest('[data-ap-go-conversation]')){root.querySelector('[data-ap-tab="2"]').click();return;}
      if(event.target.closest('[data-ap-go-quote]')){root.querySelector('[data-ap-tab="1"]').click();return;}
      const tab=event.target.closest('[data-ap-tab]');if(tab){ctx.tab=Number(tab.dataset.apTab);root.querySelectorAll('[data-ap-tab]').forEach(b=>{b.setAttribute('aria-selected',String(Number(b.dataset.apTab)===ctx.tab));b.tabIndex=Number(b.dataset.apTab)===ctx.tab?0:-1;b.classList.toggle('is-secondary',Number(b.dataset.apTab)!==ctx.tab);});root.querySelectorAll('[data-ap-pane]').forEach(p=>p.hidden=Number(p.dataset.apPane)!==ctx.tab);return;}
      const file=event.target.closest('[data-ap-file]');if(file){file.disabled=true;try{await download(job.id,job.files.find(f=>f.id===Number(file.dataset.apFile)),admin);}catch(e){await popup(e.message,'File unavailable');}finally{file.disabled=false;}return;}
      if(event.target.closest('[data-ap-latest]')&&await allowLeave(root)){ctx.job=ctx.latest||ctx.job;ctx.latest=null;await paint(ctx);}
    };
    root.onkeydown=event=>{const tab=event.target.closest('[data-ap-tab]');if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?2:(Number(tab.dataset.apTab)+(event.key==='ArrowRight'?1:2))%3;const button=root.querySelector('[data-ap-tab="'+next+'"]');button.click();button.focus();};
    root.onsubmit=event=>{const form=event.target.closest('[data-ap-form]');if(form){event.preventDefault();void submit(ctx,form);}};
    root.onchange=event=>{
      if(event.target.name==='fulfillment_type'){const wrap=event.target.form.querySelector('[data-ap-delivery]');wrap.hidden=event.target.value!=='delivery';wrap.querySelectorAll('input').forEach(i=>i.required=!wrap.hidden);}
      if(event.target.name==='appointment_date')void followUpTimes(event.target.form);
    };
    for(const form of root.querySelectorAll('[data-ap-form="accept"]')) {
      try {const policy=(await request('/commerce/policy')).data;if(!policy)throw Error('Transaction terms are not yet published. Contact FMRC before ordering.');
        form.dataset.policy=policy.version;form.querySelector('[data-ap-policy]').innerHTML=`<details><summary>Read Transaction Terms and Refund Policy</summary><div class="ap-terms">${esc(policy.terms_text)}\n\n${esc(policy.refund_text)}</div></details><label class="ap-check"><input type="checkbox" name="policy_accepted" required><span>I accept these Transaction Terms and Refund Policy.</span></label>`;
        form.querySelector('[type=submit]').disabled=false;
      }catch(e){form.querySelector('[data-ap-policy]').textContent=e.message;}
    }
    if(focused){const replacement=[...root.querySelectorAll('input,textarea,select,button')].find(node=>focusName?node.getAttribute('name')===focusName&&node.closest('[data-ap-form]')?.dataset.apForm===focusForm:focusTab!==null&&focusTab!==undefined?node.getAttribute('data-ap-tab')===focusTab:node.textContent===focused.textContent);const target=replacement||root.querySelector('[data-ap-tab][aria-selected=true]');target?.focus({preventScroll:true});if(selection&&replacement?.setSelectionRange)replacement.setSelectionRange(...selection);}
    if(scrollHost)scrollHost.scrollTop=scrollTop;
  }
  const rootFocus=root=>root.querySelector('[data-ap-tab][aria-selected=true]')?.focus({preventScroll:true});
  async function followUpTimes(form) {
    try{const cal=await request('/appointments/calendar'),d=form.elements.appointment_date.value,setting=(cal.day_settings||[]).find(x=>x.date===d),select=form.elements.appointment_time;
      select.replaceChildren(new Option('Choose an available time','')); const busy=cal.booked_slots?.[d]||[],seen=new Set();
      if(!setting?.is_blocked&&![0,6].includes(new Date(d+'T12:00:00+08:00').getUTCDay()))for(const s of [...(cal.time_slots||[]),...(setting?.custom_slots||[])])if(!seen.has(s.label||s)&&!busy.includes(s.label||s)&&!setting?.blocked_slots?.includes(s.label||s)){select.add(new Option(s.label||s,s.label||s));seen.add(s.label||s);}
    }catch(e){await popup('Available follow-up times could not be loaded. Please choose the date again.');}
  }
  async function submit(ctx,form) {
    if(ctx.busy||!form.reportValidity())return;
    const action=form.dataset.apForm;
    ctx.busy=true;
    if(action==='requirements'&&Number(form.elements.service_id.value)!==Number(ctx.job.service_id)&&!await confirm('Change the fabrication service? FMRC must review the new requirements before quoting. Any unpaid quotation will be withdrawn; the appointment schedule and history stay the same.','Change service')){ctx.busy=false;return;}
    if(['quotation','accept','cancel','follow-up'].includes(action)&&!await confirm(action==='accept'?'Approve this exact quotation and create its payment order?':action==='quotation'?'Send this quotation to the customer? It will remain valid for seven days.':action==='cancel'?(ctx.admin?'Cancel this custom-product request? The appointment will remain.':'Cancel your custom-product request? Your appointment will remain.'):'Book this follow-up appointment?')){ctx.busy=false;return;}
    ctx.busy=true;const submit=form.querySelector('[type=submit]');submit.disabled=true;
    try {
      const values=Object.fromEntries(new FormData(form));let body={...values,expected_revision:ctx.job.revision,request_key:form.dataset.key};let method='POST';
      if(action==='requirements'){body={requirements:requirements(form),expected_revision:ctx.job.revision};method='PUT';}
      if(action==='outcome')body.discussion_confirmed=!!form.elements.discussion_confirmed.checked;
      if(action==='quotation'){body.specifications=requirements(form,'spec_');body.specifications.needs_advice=false;body.proof_file_ids=[...form.querySelectorAll('[name=proof_file_ids]:checked')].map(x=>Number(x.value));body.delivery_eligible=!!form.elements.delivery_eligible.checked;
        body.delivery=Object.fromEntries(Object.entries(values).filter(([k])=>k.startsWith('delivery_')&&k!=='delivery_eligible'));}
      if(action==='accept'){body.specifications_accepted=form.elements.specifications_accepted.checked;body.policy_accepted=form.elements.policy_accepted.checked;body.policy_version=form.dataset.policy;}
      if(action==='messages'){const fd=new FormData();fd.append('body',values.body);fd.append('request_key',form.dataset.key);for(const f of form.elements.attachments.files)fd.append('attachments[]',f);body=fd;}
      const suffix=action==='accept'?`quotations/${form.dataset.quote}/accept`:action==='quotation'?'quotations':action;
      const result=await request(`/${ctx.admin?'admin':'customer'}/appointment-products/${ctx.job.id}/${suffix}`,{method,body:body instanceof FormData?body:JSON.stringify(body)});
      if(action==='outcome'&&(!result.data||result.data.state!==values.outcome||Number(result.data.revision)<=Number(body.expected_revision)||(values.outcome==='ready_for_quote'&&!result.data.discussed_at)))throw Error('The consultation outcome could not be confirmed. Your entries are still here. Use Refresh to check the saved status before trying again.');
      ctx.job=result.data;ctx.latest=null;await paint(ctx);rootFocus(ctx.root);window.dispatchEvent(new CustomEvent('fmrc:custom-product-updated',{detail:{job:result.data}}));
      await popup(result.message||'Changes saved.','Saved');
      if(result.order_id)location.href=link('/home-page/?orders=1&order_id='+result.order_id);
    }catch(e){await popup(e.message,'Action not completed');form.querySelector('input,textarea,select')?.focus();}
    finally{ctx.busy=false;if(submit.isConnected)submit.disabled=false;}
  }
  function poll(ctx) {
    clearTimeout(ctx.timer);ctx.timer=setTimeout(async()=>{
      if(!ctx.root.isConnected){contexts.delete(ctx.root);return;}
      if(document.hidden||!ctx.root.getClientRects().length||ctx.busy){poll(ctx);return;}
      const before=ctx.job;
      try{const result=await request(`/${ctx.admin?'admin':'customer'}/appointment-products/${ctx.job.id}`);ctx.failures=0;
        if(!ctx.root.isConnected||contexts.get(ctx.root)!==ctx)return;
        if(ctx.busy||ctx.job!==before||older(result.data,ctx.job)||older(result.data,ctx.latest)){poll(ctx);return;}
        if(JSON.stringify(result.data)!==JSON.stringify(ctx.job)){if(dirty(ctx.root)){ctx.latest=result.data;ctx.root.querySelector('[data-ap-update]').hidden=false;}else{ctx.job=result.data;await paint(ctx);}}
      }catch{ctx.failures=Math.min(3,(ctx.failures||0)+1);}poll(ctx);
    },Math.min(30000,5000*2**(ctx.failures||0)));
  }
  function mount(root,job,appointment,admin) {
    if(!root||!job)return;root.classList.add('ap-panel');root.dataset.apJob=job.id;if(job.unavailable){root.innerHTML='<h3>'+icon+'Custom Product</h3><p>Custom-product details are temporarily unavailable. '+(admin?'The appointment is unchanged.':'Your appointment is unchanged.')+' Use Refresh to try again.</p>';return;}
    const old=contexts.get(root);
    if(old&&old.job.id===job.id){
      old.appointment=appointment;
      if(older(job,old.job)||older(job,old.latest))return;
      if(JSON.stringify(old.job)===JSON.stringify(job))return;
      if(old.busy||dirty(root)){old.latest=job;root.querySelector('[data-ap-update]').hidden=false;return;}
      old.job=job;void paint(old);return;
    }
    if(old)clearTimeout(old.timer);
    const ctx={root,job,appointment,admin,key:old?.key||uid(),tab:old?.tab||((job.quotations||[]).some(q=>q.state==='sent')&&!admin?1:0)};contexts.set(root,ctx);void paint(ctx);poll(ctx);
  }
  async function mountCustomer(host,appointment) {
    let root=host.querySelector('[data-ap-appointment]');if(!root){root=document.createElement('section');root.dataset.apAppointment='';const overview=host.querySelector('.appointment-overview');if(overview)overview.after(root);else host.append(root);}
    if(appointment.custom_product){root.closest('.appointment-modal')?.classList.add('has-custom-product');mount(root,appointment.custom_product,appointment,false);return;}
    root.closest('.appointment-modal')?.classList.remove('has-custom-product');if(!appointment.custom_products_available){root.remove();return;}
    root.className='ap-panel';root.innerHTML=`<div class="ap-head"><div><h3>${icon}Have a custom-product idea?</h3><p>Add a request to discuss with FMRC. Your appointment schedule stays the same.</p></div></div>${button('Request a Custom Product','data-ap-opt-in',true)}`;
    root.querySelector('[data-ap-opt-in]').onclick=async()=>{try{const available=await loadAvailability();if(!available.services.length)return popup('FMRC is not accepting new custom-product consultations at the moment. Your appointment is unchanged.');root.innerHTML=`<h3>Custom Product</h3><form>${briefFields({},available.services)}<div class="ap-actions"><button type="submit" class="ap-btn">Add to Appointment</button></div></form>`;
      const form=root.querySelector('form');form.oninput=()=>form.dataset.dirty='true';let busy=false;const key=uid();form.onsubmit=async e=>{e.preventDefault();if(busy||!form.reportValidity())return;busy=true;form.querySelector('button').disabled=true;try{const result=await request(`/customer/appointments/${appointment.id}/product`,{method:'POST',body:JSON.stringify({requirements:requirements(form),request_key:key})});form.dataset.dirty='false';mount(root,result.data,appointment,false);window.dispatchEvent(new CustomEvent('fmrc:custom-product-updated',{detail:{job:result.data}}));}catch(error){await popup(error.message);}finally{busy=false;if(form.isConnected)form.querySelector('button').disabled=false;}};
    }catch(e){await popup(e.message);}};
  }

  // Booking fields remain owned by the existing five-step form.
  const bookingIds=['aptLName','aptFName','aptMI','aptPhone','aptEmail','aptRole','aptRoleOther','aptCountry','aptRegion','aptProvince','aptMunicipality','aptAddress','aptIntlAddress','aptMethod','aptPurpose','aptDesc'];
  const bookingValues=()=>Object.fromEntries(bookingIds.map(id=>[id,document.getElementById(id)?.value||'']));
  const selected=()=>!!document.getElementById('aptCustomProduct')?.checked;
  const fileKey=f=>[f.name,f.size,f.lastModified].join('|');
  const newFiles=files=>files.filter(f=>!uploaded.has(fileKey(f)));
  function append(formData) {
    if(!selected())return;
    if(!token())throw Error('Sign in to request a custom product. Use Sign In in the custom-product section; your details will be kept.');
    formData.append('product_requested','1');formData.append('product_data',JSON.stringify(requirements(document.getElementById('aptCustomFields'))));formData.append('request_key',bookingKey);
    if(bookingDraft){formData.append('product_draft_id',bookingDraft.id);formData.append('product_revision',bookingDraft.revision);}
  }
  async function saveDraft() {
    if(draftBusy)return; if(!token())return signIn(); const form=document.getElementById('aptCustomFields');
    if(!Number(form.elements.service_id.value))return popup('Choose an eligible FMRC service first.');
    draftBusy=true;const btn=document.getElementById('aptSaveCustomDraft');btn.disabled=true;
    try{const fd=new FormData();fd.append('requirements',JSON.stringify(requirements(form)));fd.append('booking',JSON.stringify(bookingValues()));fd.append('request_key',bookingKey);
      if(bookingDraft){fd.append('draft_id',bookingDraft.id);fd.append('expected_revision',bookingDraft.revision);}
      const files=window.FMRCAppointmentBooking?.files()||[];for(const f of newFiles(files))fd.append('attachments[]',f);
      const result=await request('/customer/appointment-products/drafts',{method:'POST',body:fd});bookingDraft=result.data;files.filter(f=>(bookingDraft.files||[]).some(saved=>saved.name===f.name&&Number(saved.size)===f.size)).forEach(f=>uploaded.add(fileKey(f)));showSavedFiles();await popup(result.message,'Draft saved');
    }catch(e){await popup(e.message,'Draft not saved');
      if(e.status===409&&bookingDraft)void request('/customer/appointment-products/'+bookingDraft.id).then(latest=>{
        const host=document.querySelector('[data-ap-saved-files]');let notice=host.querySelector('[data-ap-draft-conflict]');if(!notice){notice=document.createElement('details');notice.dataset.apDraftConflict='';host.prepend(notice);}
        notice.innerHTML='<summary>Review the saved draft update</summary><p class="ap-help">Another session changed this draft. Compare it with your entries before saving. Your current entries stay in the form.</p>'+specs(latest.data.requirements)+button('Keep My Entries','data-ap-keep-draft',true);
        notice.querySelector('button').onclick=async()=>{if(!await confirm('Use the current saved revision and keep your entered specifications? Check the saved design files before saving again.'))return;bookingDraft=latest.data;showSavedFiles();};
      }).catch(()=>{});
    }finally{draftBusy=false;btn.disabled=false;}
  }
  function showSavedFiles(){const node=document.querySelector('[data-ap-saved-files]');if(!node)return;node.innerHTML=bookingDraft?'<p class="ap-help">Saved designs remain private and will be included when you book.</p>'+fileList(bookingDraft.files):'';
    node.querySelectorAll('[data-ap-file]').forEach(b=>{b.onclick=()=>download(bookingDraft.id,bookingDraft.files.find(f=>f.id===Number(b.dataset.apFile))).catch(e=>popup(e.message));
      const remove=document.createElement('button');remove.type='button';remove.className='ap-file';remove.textContent='Remove';remove.setAttribute('aria-label','Remove '+b.textContent);
      b.closest('li').append(remove);remove.onclick=async()=>{if(draftBusy||!await confirm('Remove this file from your saved draft?'))return;draftBusy=true;remove.disabled=true;
        try{const file=bookingDraft.files.find(f=>f.id===Number(b.dataset.apFile));const result=await request(`/customer/appointment-products/${bookingDraft.id}/files/${file.id}`,{method:'DELETE',body:JSON.stringify({expected_revision:bookingDraft.revision})});bookingDraft=result.data;
          const retained=(window.FMRCAppointmentBooking?.files()||[]).filter(f=>!(f.name===file.name&&f.size===file.size));window.FMRCAppointmentBooking?.restoreFiles(retained);showSavedFiles();}
        catch(error){await popup(error.message);}finally{draftBusy=false;if(remove.isConnected)remove.disabled=false;}};});} 
  function localFiles(value) {return new Promise((resolve,reject)=>{const open=indexedDB.open('fmrc-appointment-resume',1);open.onupgradeneeded=()=>open.result.createObjectStore('pending');open.onerror=()=>reject(Error('Your browser could not keep the selected files. Please save or keep this tab open.'));open.onsuccess=()=>{const db=open.result,tx=db.transaction('pending','readwrite'),store=tx.objectStore('pending');let req=value===undefined?store.get('booking'):store.put(value,'booking');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);tx.oncomplete=()=>db.close();};});}
  async function signIn() {
    try{const custom=requirements(document.getElementById('aptCustomFields'));await localFiles(window.FMRCAppointmentBooking?.files()||[]);sessionStorage.setItem('fmrc-appointment-product-resume',JSON.stringify({booking:bookingValues(),custom,draft:bookingDraft,key:bookingKey}));signingIn=true;location.href=link('/customer-auth/auth.html#login');}catch(e){await popup(e.message);}
  }
  async function resume(data) {
    window.FMRCAppointmentBooking?.open();
    for(const [id,value]of Object.entries(data.booking||{})){const input=document.getElementById(id);if(!input)continue;
      if(input.tagName==='SELECT'&&value)for(let i=0;i<45&&!Array.from(input.options).some(o=>o.value===value);i++)await new Promise(r=>setTimeout(r,70));
      input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}));}
    bookingDraft=data.draft||null;bookingKey=data.key||bookingDraft?.request_key||uid();uploaded.clear();
    const checkbox=document.getElementById('aptCustomProduct');if(checkbox){checkbox.checked=true;document.querySelector('[data-ap-brief]').hidden=false;document.getElementById('aptSaveCustomDraft').hidden=false;document.getElementById('aptCustomFields').innerHTML=briefFields(data.custom||bookingDraft?.requirements,availability.services);}
    showSavedFiles();
  }
  async function bookingInit() {
    const anchor=document.getElementById('aptDesc')?.closest('.apt-input-group');if(!anchor)return;
    try{const available=await loadAvailability();if(!available.enabled)return;
      const section=document.createElement('section');section.className='ap-panel ap-booking';section.innerHTML=`<label class="ap-check"><input type="checkbox" id="aptCustomProduct" ${available.services.length?'':'disabled'}><span>Request a custom product<small style="display:block">Discuss your idea with FMRC and receive a quotation after your consultation.</small></span></label>${!available.services.length?'<p class="ap-help">FMRC is not accepting new custom-product consultations right now. You can still book an ordinary appointment.</p>':''}<div data-ap-brief hidden><form id="aptCustomFields">${briefFields({},available.services)}</form><p class="ap-help">Use the Design Files field above to attach private designs. Booking does not commit you to an order.</p><div data-ap-saved-files></div>${!token()?button('Sign In & Keep Details','data-ap-sign-in',true):''}</div>`;
      anchor.before(section);section.querySelector('form').oninput=e=>e.currentTarget.dataset.dirty='true';const checkbox=section.querySelector('input');checkbox.onchange=()=>{section.querySelector('[data-ap-brief]').hidden=!checkbox.checked;document.getElementById('aptSaveCustomDraft').hidden=!checkbox.checked;};
      section.querySelector('[data-ap-sign-in]')?.addEventListener('click',signIn);
      const save=document.createElement('button');save.type='button';save.className='apt-btn apt-btn-back';save.id='aptSaveCustomDraft';save.textContent='Save Draft';save.hidden=true;save.onclick=saveDraft;document.getElementById('btnGoToStep3')?.before(save);
      const pending=sessionStorage.getItem('fmrc-appointment-product-resume');
      if(pending&&token()){sessionStorage.removeItem('fmrc-appointment-product-resume');await resume(JSON.parse(pending));const files=await localFiles();if(files?.length)window.FMRCAppointmentBooking?.restoreFiles(files);await localFiles([]);}
      const service=new URLSearchParams(location.search).get('custom_service');if(service&&!pending){window.FMRCAppointmentBooking?.open();checkbox.checked=true;checkbox.dispatchEvent(new Event('change'));section.querySelector('[name=service_id]').value=service;}
    }catch{/* Optional capability never blocks the ordinary appointment form. */}
  }
  async function draftList(host) {
    try{host.querySelector('[data-ap-drafts]')?.remove();const data=(await request('/customer/appointment-products/drafts')).data;if(!data.length)return;
      const box=document.createElement('section');box.className='ap-panel';box.dataset.apDrafts='';box.innerHTML='<h3>Saved Custom-product Drafts</h3><p class="ap-help">Drafts have no reserved schedule.</p>'+data.map(d=>`<div class="ap-message"><strong>${esc(d.requirements.name||'Untitled product idea')}</strong><p>${esc(d.service_name)}</p><div class="ap-actions">${button('Continue Draft',`data-ap-resume="${d.id}"`,true)}</div></div>`).join('');host.prepend(box);
      box.onclick=async e=>{const b=e.target.closest('[data-ap-resume]');if(!b)return;const draft=data.find(d=>d.id===Number(b.dataset.apResume));
        if(!document.getElementById('aptCustomFields')){sessionStorage.setItem('fmrc-appointment-product-resume',JSON.stringify({booking:draft.booking,custom:draft.requirements,draft,key:draft.request_key}));location.href=link('/home-page/?appointment=1');return;}
        document.querySelectorAll('[data-appointments-close]')[0]?.click();await resume({booking:draft.booking,custom:draft.requirements,draft,key:draft.request_key});};
    }catch{/* Existing appointment lists remain usable if the optional schema is unavailable. */}
  }
  async function claimPanel(host) {
    if(team||!token()||host.querySelector('[data-ap-claim]'))return;
    try{if(!(await loadAvailability()).enabled)return;}catch{return;}
    const box=document.createElement('details');box.className='ap-panel';box.dataset.apClaim='';box.innerHTML='<summary>Connect an appointment booked as a guest</summary><p class="ap-help">Use the reference and email on your receipt. A private link will be sent to that address. Sign in using the same email to add a custom-product request.</p><form><div class="ap-grid">'+field('reference','Appointment reference','','text',true)+field('email','Booking email','','email',true)+'</div><div class="ap-actions"><button type="submit" class="ap-btn is-secondary">Send Private Link</button></div></form>';
    host.append(box);const form=box.querySelector('form');let busy=false;form.onsubmit=async e=>{e.preventDefault();if(busy||!form.reportValidity())return;busy=true;form.querySelector('button').disabled=true;try{const r=await request('/appointment-products/claim-link',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});await popup(r.message,'Check your email');}catch(error){await popup(error.message);}finally{busy=false;form.querySelector('button').disabled=false;}};
  }
  function mountOrder(host,order,admin=team) {
    if(!host)return;let box=host.querySelector('[data-ap-order]');if(order.order_type!=='custom'){box?.remove();return;}
    if(box&&dirty(box))return;if(!box){box=document.createElement('section');box.dataset.apOrder='';box.className='ap-panel';host.prepend(box);}
    const c=order.custom_product;if(!c||c.unavailable){box.textContent='Custom-product details are temporarily unavailable. Please try again.';return;}
    const actions=c.available_actions||{},g=c.agreement;const path=admin?`/${location.pathname.includes('staff-page')?'staff-page':'admin-page'}/appointments.html?appointment_id=${c.appointment_id}`:`/home-page/?my_appointments=1&appointment_id=${c.appointment_id}`;
    const role=window.AdminSession?.getUserInfo?.()?.role || (window.AdminSession?.isStaff||location.pathname.includes('staff-page')?'staff':'admin');
    box.innerHTML=`<header class="ap-head"><div><h3>${icon}Custom Product</h3><p>${esc(c.appointment_reference)} · ${esc(c.service)} · Quotation ${c.quotation_version}</p></div><span class="ap-badge">${esc(c.stage)}</span></header><a class="ap-file" href="${esc(link(path))}">Open Appointment</a>${c.collection_pending?`<p class="ap-help">${admin?'The previous payment is being reconciled. Wait for confirmed checkout expiry before collecting another payment.':'FMRC is verifying the previous payment. Please wait before changing payment method or paying again.'}</p>`:''}<details><summary>Approved design and specifications</summary>${specs(g.specifications)}<p>${esc(g.design_notes)}</p><p><strong>Lead time:</strong> ${esc(g.lead_time)}</p><p><strong>Agreed total:</strong> ${money(g.total)} · shipping ${money(g.shipping_fee)}</p></details>
      ${admin?`<div class="ap-actions">${actions.start_production?button('Start Production','data-ap-production="start"'):''}${actions.mark_ready?button('Mark Ready','data-ap-production="ready"'):''}</div>
      ${actions.record_cash?`<form data-ap-order-form="cash_receipt"><h4>Full advance cash payment</h4><p class="ap-help">Record this only after receiving the full amount at FMRC. This is not cash on pickup or delivery.</p><div class="ap-grid">${field('amount','Amount received (₱)',g.total,'text',true)}${field('receipt_reference','Receipt reference','','text',true)}<label class="ap-check"><input type="checkbox" name="confirmed_received" required><span>I actually received the full quoted cash payment.</span></label></div><div class="ap-actions"><button class="ap-btn" type="submit">Record Cash Payment</button></div></form>`:''}
      ${actions.collect?`<form data-ap-order-form="collect"><div class="ap-grid">${field('pickup_code','Customer pickup code','','text',true)}</div><div class="ap-actions"><button class="ap-btn" type="submit">Confirm Collection</button></div></form>`:''}
      ${role==='admin'&&(actions.correct_cash||actions.refund_cash)?`<details><summary>${['cancelled','rejected'].includes(order.lifecycle_status)?'Record released cash refund':'Correct a mistaken cash receipt'}</summary><form data-ap-order-form="${['cancelled','rejected'].includes(order.lifecycle_status)?'cash_refund':'cash_reverse'}"><div class="ap-grid">${field('amount','Amount (₱)',c.cash_balance_centavos/100,'text',true)}${field('receipt_reference','Receipt / refund reference','','text',true)}${field('note','Reason','','textarea',true,true)}<label class="ap-check"><input type="checkbox" name="refund_released" required><span>I confirm this correction, or that the refund has actually been returned to the customer.</span></label></div><div class="ap-actions"><button class="ap-btn" type="submit">Confirm</button></div></form></details>`:''}`:
      order.payment_status==='pending'&&!['cancelled','rejected','completed'].includes(order.lifecycle_status)?`<p class="ap-help">${order.payment_method==='Cash at FMRC'?'Pay the full amount at FMRC. The team will record your receipt before production begins.':'Use the existing online payment action below to pay securely.'}</p><div class="ap-actions">${button(order.payment_method==='Cash at FMRC'?'Use Online Payment':'Pay at FMRC','data-ap-switch-payment',true)}</div>`:''}
      ${c.cash_entries.length?`<details><summary>Cash receipt history</summary>${c.cash_entries.map(e=>`<p>${esc(e.kind)} · ${money(e.amount_centavos/100)} · ${esc(e.receipt_reference)}<br><small>${esc(date(e.confirmed_at))}</small></p>`).join('')}</details>`:''}`;
    let busy=false;const perform=async(action,form)=>{if(busy||form&&!form.reportValidity())return;busy=true;if(!await confirm(action==='start'?'Start production of the approved, fully paid custom product?':'Confirm this order action?')){busy=false;return;}const buttons=[...box.querySelectorAll('button:not(:disabled)')];buttons.forEach(b=>b.disabled=true);box.setAttribute('aria-busy','true');const values=form?Object.fromEntries(new FormData(form)):{};if(form){values.confirmed_received=!!form.elements.confirmed_received?.checked;values.refund_released=!!form.elements.refund_released?.checked;form.dataset.key ||= uid();}
      try{const result=await request(`/admin/orders/${order.id}/custom-product`,{method:'POST',body:JSON.stringify({...values,action,expected_revision:c.revision,request_key:form?.dataset.key||uid()})});box.querySelectorAll('form').forEach(f=>f.dataset.dirty='false');mountOrder(host,result.data,true);window.dispatchEvent(new CustomEvent('fmrc:custom-order-updated',{detail:{order:result.data}}));await popup('Order updated.','Saved');}
      catch(e){await popup(e.message,'Action not completed');}finally{busy=false;box.removeAttribute('aria-busy');buttons.forEach(b=>{if(b.isConnected)b.disabled=false;});}};
    box.oninput=e=>{const f=e.target.closest('form');if(f)f.dataset.dirty='true';};box.onsubmit=e=>{const f=e.target.closest('[data-ap-order-form]');if(f){e.preventDefault();void perform(f.dataset.apOrderForm,f);}};
    box.onclick=async e=>{const b=e.target.closest('[data-ap-production]');if(b)void perform(b.dataset.apProduction);
      if(e.target.closest('[data-ap-switch-payment]')){if(busy||!await confirm('Change payment method? FMRC must first confirm that the previous checkout cannot receive payment.'))return;busy=true;
        try{await request(`/customer/orders/${order.id}/custom-payment-method`,{method:'POST',body:JSON.stringify({payment_method:order.payment_method==='Cash at FMRC'?'online':'cash',expected_revision:c.revision})});location.reload();}catch(error){await popup(error.message);}finally{busy=false;}}
    };
  }
  window.FMRCAppointmentProducts={mountCustomer,mountAdmin:(host,a)=>{if(!a.custom_product){host?.closest('.appointment-view-modal')?.classList.remove('has-custom-product');return;}let root=host.querySelector('[data-ap-appointment]');if(!root){root=document.createElement('section');root.dataset.apAppointment='';const summary=host.querySelector('.appt-view-header-row');if(summary)summary.after(root);else host.append(root);}host.closest('.appointment-view-modal')?.classList.add('has-custom-product');mount(root,a.custom_product,a,true);},mountOrder,draftList,claimPanel,allowLeave,isDirty:dirty,append,newFiles,selected,isSigningIn:()=>signingIn,
    validate:async()=>{if(!selected())return true;const form=document.getElementById('aptCustomFields');if(!token()){await popup('Sign in using the button in the Custom Product section. Your entered appointment details will be kept.','Sign in required');return false;}return form.reportValidity();},
    review:step=>{let summary=document.querySelector('[data-ap-booking-review]');if(!selected()){summary?.remove();return;}const host=document.querySelector('#aptStep'+step+' .ticket-body');if(!host)return;if(!summary||!host.contains(summary)){summary?.remove();summary=document.createElement('section');summary.className='ap-panel';summary.dataset.apBookingReview='';host.append(summary);}summary.innerHTML='<h3>Custom Product Consultation</h3><p class="ap-help">FMRC will discuss this idea during your consultation. A quotation follows once the specifications are agreed.</p>'+specs(requirements(document.getElementById('aptCustomFields')));},
    reset:()=>{bookingDraft=null;bookingKey=uid();uploaded.clear();document.getElementById('aptCustomFields')?.reset();document.querySelector('[data-ap-saved-files]')?.replaceChildren();document.querySelector('[data-ap-booking-review]')?.remove();const c=document.getElementById('aptCustomProduct');if(c){c.checked=false;c.dispatchEvent(new Event('change'));}},
    booked:()=>{sessionStorage.removeItem('fmrc-appointment-product-resume');void localFiles([]).catch(()=>{});},
  };
  if(team) {
    let checking=false;
    document.addEventListener('click',e=>{const close=e.target.closest('[data-modal-close],#btnCloseApptView,#btnCloseApptView2,#btnArchiveFromView');const backdrop=e.target.matches?.('.modal-overlay.show')?e.target:null;const modal=close?.closest('.modal-overlay')||backdrop;
      const nav=e.target.closest('a[href]');const root=modal||((nav&&!nav.target)?document:null);if(!root||!dirty(root))return;
      if(backdrop?.getAttribute('data-backdrop-close')==='false')return;e.preventDefault();e.stopImmediatePropagation();if(checking)return;checking=true;
      void allowLeave(root).then(ok=>{if(ok){root.querySelectorAll('form[data-dirty]').forEach(f=>f.dataset.dirty='false');(close||nav||backdrop)?.click();}}).finally(()=>checking=false);
    },true);
  }
  addEventListener('beforeunload',e=>{if(!signingIn&&[...document.querySelectorAll('.ap-panel')].some(r=>r.getClientRects().length&&dirty(r))){e.preventDefault();e.returnValue='';}});
  document.addEventListener('DOMContentLoaded',()=>{void bookingInit();const claim=new URLSearchParams(location.search).get('appointment_claim');if(claim){sessionStorage.setItem('fmrc-appointment-claim',claim);history.replaceState({},'',location.pathname);}
    const pending=sessionStorage.getItem('fmrc-appointment-claim');if(pending&&!token())void popup('Sign in using the email on your appointment, then reopen this private link.','Connect your appointment');if(pending&&token())void request('/customer/appointment-products/claim',{method:'POST',body:JSON.stringify({token:pending})}).then(async r=>{sessionStorage.removeItem('fmrc-appointment-claim');await popup(r.message);window.FMRCAppointments?.open(r.appointment_id);}).catch(e=>popup(e.message));
  });
})();
