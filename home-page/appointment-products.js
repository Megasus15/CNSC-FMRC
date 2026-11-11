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
  const scrollContainer = node => {
    for(let parent=node?.parentElement;parent&&parent!==document.body;parent=parent.parentElement) {
      if(/auto|scroll/.test(getComputedStyle(parent).overflowY))return parent;
    }
    return null;
  };
  const revealSection = (root,target) => {
    if(!target)return;
    cancelAnimationFrame(root.apRevealFrame);
    root.apRevealFrame=requestAnimationFrame(()=>{
      if(!target.isConnected)return;
      const host=root.closest('.modal-body-scroll')||scrollContainer(target);
      const behavior=matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth';
      if(host){const top=host.scrollTop+target.getBoundingClientRect().top-host.getBoundingClientRect().top-16;host.scrollTo({top:Math.max(0,Math.min(top,host.scrollHeight-host.clientHeight)),behavior});}
      else if(!team)target.scrollIntoView({block:'start',behavior});
      if(!target.matches('summary,button,input,select,textarea,a'))target.tabIndex=-1;
      target.focus({preventScroll:true});
    });
  };
  const positionOptions = (wrap,input,list) => {
    const host=scrollContainer(input),bounds=host?.getBoundingClientRect()||{top:0,bottom:innerHeight};
    const viewport=window.visualViewport,top=Math.max(bounds.top,viewport?.offsetTop||0),bottom=Math.min(bounds.bottom,viewport?viewport.offsetTop+viewport.height:innerHeight),rect=input.getBoundingClientRect();
    const below=bottom-rect.bottom-10,above=rect.top-top-10,up=below<180&&above>below;
    const confined=!!input.closest('.modal-body-scroll');
    const height=Math.max(confined?0:44,Math.min(232,up?above:below));
    wrap.classList.toggle('is-above',up);list.style.maxHeight=height+'px';
    return !confined||(height>=24&&rect.bottom>top&&rect.top<bottom);
  };
  const revealOption = (list,option) => {
    const bounds=list.getBoundingClientRect(),rect=option.getBoundingClientRect(),top=bounds.top+list.clientTop,bottom=top+list.clientHeight;
    if(rect.top<top)list.scrollTop+=rect.top-top;
    else if(rect.bottom>bottom)list.scrollTop+=rect.bottom-bottom;
  };
  const revealQuotation = (ctx,mode='view') => {
    const {root,job}=ctx;
    root.querySelector('[data-ap-tab="1"]')?.click();
    const editor=root.querySelector('[data-ap-quotation-editor]');
    if(mode==='prepare'&&editor){editor.open=true;revealSection(root,editor.querySelector('summary'));return;}
    const quotes=[...job.quotations].sort((a,b)=>Number(b.version)-Number(a.version));
    const current=quotes.find(q=>['sent','accepted','closing'].includes(q.state))||quotes[0];
    const record=current&&root.querySelector(`[data-ap-quotation-record="${CSS.escape(String(current.id))}"]`);
    if(record){for(let node=record.parentElement;node&&node!==root;node=node.parentElement)if(node.matches('details'))node.open=true;revealSection(root,record.querySelector('h4')||record);}
    else if(editor){editor.open=true;revealSection(root,editor.querySelector('summary'));}
    else revealSection(root,root.querySelector('[data-ap-pane="1"]'));
  };
  const orderActionLocks = new Set();
  let availability, availabilityLoadedAt=0, availabilityPending, bookingDraft = null, bookingKey = uid(), bookingFinish = '', uploaded = new Set(), draftBusy = false, signingIn = false;
  const numberLimits = {quantity:[1,100000,1],unit_price:[0.01,100000,0.01],shipping_fee:[0,100000,0.01],budget:[0,10000000,0.01]};
  let fieldSequence = 0;
  const requiredMark = '<span class="ap-required" aria-hidden="true">*</span>';
  const field = (name,label,value='',type='text',required=false,wide=false,help='',placeholder='') => {
    const limits=numberLimits[name.replace(/^spec_/,'')];
    const attributes=type==='number'?`min="${limits?.[0]??0}" max="${limits?.[1]??100000}" step="${limits?.[2]??1}" inputmode="${limits?.[2]===0.01?'decimal':'numeric'}" data-ap-number="${limits?.[2]===0.01?'decimal':'integer'}"`:name==='delivery_postal_code'?'inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="postal-code" data-ap-number="integer"':name==='delivery_contact_no'?'inputmode="tel" autocomplete="tel" maxlength="16" pattern="[+]?[0-9]{7,15}" placeholder="e.g. 09171234567"':name==='receipt_reference'?'maxlength="100"':name==='pickup_code'?'maxlength="20" autocomplete="off"':name==='lead_time'?'maxlength="300" placeholder="e.g. 5 working days after full payment"':`maxlength="${name.includes('name')?'160':name.startsWith('delivery_')?'200':'400'}"`;
    const id='ap-field-'+(++fieldSequence),hint=help?` aria-describedby="${id}-help"`:'';
    return `<label class="ap-field${wide?' is-wide':''}" for="${id}"><span>${esc(label)}${required?' '+requiredMark:''}</span>${type==='textarea'?`<textarea id="${id}" name="${esc(name)}" maxlength="2000" placeholder="${esc(placeholder)}"${hint} ${required?'required':''}>${esc(value)}</textarea>`:`<input id="${id}" name="${esc(name)}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}"${hint} ${attributes} ${required?'required':''}>`}${help?`<small id="${id}-help">${esc(help)}</small>`:''}</label>`;
  };
  function bindNumberFields(root) {
    root.querySelectorAll('[data-ap-number]').forEach(input=>{
      const decimal=input.dataset.apNumber==='decimal',valid=value=>(decimal?/^\d*(?:\.\d{0,2})?$/:/^\d*$/).test(value);
      input.addEventListener('keydown',event=>{if(!event.ctrlKey&&!event.metaKey&&!event.altKey&&event.key.length===1&&!/\d/.test(event.key)&&!(decimal&&event.key==='.'))event.preventDefault();});
      input.addEventListener('beforeinput',event=>{if(event.data&&!event.inputType?.startsWith('delete')&&!(decimal?/^[\d.]+$/:/^\d+$/).test(event.data))event.preventDefault();});
      input.addEventListener('paste',event=>{if(!valid(event.clipboardData.getData('text').trim())){event.preventDefault();input.setCustomValidity(decimal?'Enter a number with up to two decimal places.':'Enter whole numbers only.');input.reportValidity();}});
      input.addEventListener('input',()=>input.setCustomValidity(valid(input.value)?'':decimal?'Enter a number with up to two decimal places.':'Enter whole numbers only.'));
      input.addEventListener('blur',()=>{if(valid(input.value))input.setCustomValidity('');});
    });
  }
  const button = (text, attrs='', secondary=false) => `<button type="button" class="ap-btn${secondary?' is-secondary':''}" ${attrs}>${text}</button>`;
  const popup = async (message,title='Custom product') => {
    if(team) { window.showAdminPopup?.(message,{title,type:['Saved','Draft saved'].includes(title)?'success':'modal'}); return; }
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
  // Reuse the Customer address API. Only place names enter the agreed quotation;
  // PSGC codes stay in the picker and drive the province/city/barangay cascade.
  const placeRequests = new Map();
  const placeKey = value => String(value||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-PH');
  const placeList = path => {
    if(!placeRequests.has(path))placeRequests.set(path,request('/psgc/'+path).then(items=>{
      if(!Array.isArray(items)||items.some(item=>!/^\d{10}$/.test(item?.code)||typeof item.name!=='string'||!item.name.trim()))throw Error('Place list unavailable.');
      return [...new Map(items.map(item=>[item.code,{code:item.code,name:item.name.trim()}])).values()].sort((a,b)=>a.name.localeCompare(b.name,'en-PH'));
    }).catch(error=>{placeRequests.delete(path);throw error;}));
    return placeRequests.get(path);
  };
  const placeField = (key,label,value,id) => `<div class="ap-field"><label for="${id}">${label} *</label><div class="combobox-wrap ap-place" data-ap-place="${key}"><input type="hidden" name="delivery_${key}" value="${esc(value)}"><svg class="ap-place-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input id="${id}" class="combobox-input" data-ap-place-search="${key}" type="text" value="${esc(value)}" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-list" aria-describedby="${id}-status" autocomplete="off" spellcheck="false" placeholder="Search ${key==='city'?'cities or municipalities':key==='province'?'provinces':'barangays'}…"><button type="button" class="combobox-caret" data-ap-place-toggle aria-label="Show ${key==='city'?'cities and municipalities':key==='province'?'provinces':'barangays'}" tabindex="-1"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m4 7 6 6 6-6"/></svg></button><ul id="${id}-list" class="ap-place-list" role="listbox" aria-label="${label}" hidden></ul></div><div class="ap-place-feedback"><small id="${id}-status" data-ap-place-status="${key}" role="status" aria-live="polite"></small><button type="button" class="ap-place-retry" data-ap-place-retry="${key}" hidden>Try again</button></div></div>`;
  function quotationPlaces(form,isSaving) {
    let alive=true,started=false;
    const events=new AbortController(),signal=events.signal;
    const states=['province','city','barangay'].map(key=>{
      const wrap=form.querySelector(`[data-ap-place="${key}"]`);
      return {key,wrap,input:wrap.querySelector('[data-ap-place-search]'),value:wrap.querySelector('[type=hidden]'),list:wrap.querySelector('[role=listbox]'),toggle:wrap.querySelector('button'),status:form.querySelector(`[data-ap-place-status="${key}"]`),retry:form.querySelector(`[data-ap-place-retry="${key}"]`),items:[],sequence:0,active:-1,loading:false};
    });
    const delivery=()=>form.elements.fulfillment_type.value==='delivery';
    const submit=form.querySelector('[type=submit]');
    const busy=()=>delivery()&&states.some(state=>state.loading);
    const message=(state,text)=>{state.note=text;state.status.textContent=text;state.status.removeAttribute('data-ap-count');};
    const check=state=>state.input.setCustomValidity(state.input.value===state.value.value&&state.value.value?'':'Choose a '+(state.key==='city'?'city or municipality':state.key)+' from the list.');
    const close=state=>{state.wrap.classList.remove('open');state.list.hidden=true;state.input.value=state.value.value;state.input.setAttribute('aria-expanded','false');state.input.removeAttribute('aria-activedescendant');state.active=-1;message(state,state.note||'');check(state);};
    const position=state=>{if(!positionOptions(state.wrap,state.input,state.list))close(state);};
    const activate=(state,index)=>{
      const options=[...state.list.querySelectorAll('[role=option]')];state.active=options.length?(index+options.length)%options.length:-1;
      options.forEach((option,i)=>option.classList.toggle('is-active',i===state.active));
      if(state.active<0)state.input.removeAttribute('aria-activedescendant');else{state.input.setAttribute('aria-activedescendant',options[state.active].id);revealOption(state.list,options[state.active]);}
    };
    const open=(state,query='')=>{
      if(state.input.disabled)return;states.forEach(other=>{if(other!==state)close(other);});
      const matches=state.items.filter(item=>placeKey(item.name).includes(placeKey(query)));
      state.list.innerHTML=matches.map(item=>`<li role="option" id="${state.input.id}-${item.code}" data-code="${item.code}" aria-selected="${placeKey(item.name)===placeKey(state.value.value)}">${esc(item.name)}</li>`).join('')||'<li class="ap-place-empty" role="presentation">No matches. Try another name.</li>';
      state.status.textContent=matches.length+' '+(matches.length===1?'match':'matches')+' found.';state.status.setAttribute('data-ap-count','');state.list.hidden=false;state.wrap.classList.add('open');state.input.setAttribute('aria-expanded','true');state.input.removeAttribute('aria-activedescendant');state.active=-1;position(state);
    };
    const waiting=(state,text)=>{state.sequence++;state.loading=false;state.items=[];state.selected=null;state.path=null;state.wrap.removeAttribute('aria-busy');state.value.value='';close(state);state.input.disabled=true;state.toggle.disabled=true;message(state,text);state.retry.hidden=true;};
    const load=async(state,path)=>{
      const sequence=++state.sequence;state.path=path;state.loading=true;close(state);state.wrap.setAttribute('aria-busy','true');state.input.disabled=true;state.toggle.disabled=true;message(state,'Loading '+(state.key==='city'?'cities and municipalities':state.key==='province'?'provinces':'barangays')+'…');state.retry.hidden=true;submit.disabled=busy()||isSaving();
      try{
        let items=await placeList(path);if(!alive||!form.isConnected||sequence!==state.sequence)return false;
        if(state.key==='province'&&!items.some(item=>item.code==='1300000000'))items=[...items,{code:'1300000000',name:'Metro Manila (NCR)'}].sort((a,b)=>a.name.localeCompare(b.name,'en-PH'));
        const saved=state.value.value,match=items.find(item=>placeKey(item.name)===placeKey(saved)||(item.code==='1300000000'&&/^(metro manila|ncr|national capital region)( \(ncr\))?$/i.test(saved)));
        state.items=items;state.selected=match;state.input.disabled=!items.length&&!saved;state.toggle.disabled=state.input.disabled;
        if(saved&&!match)state.items=[{code:'saved',name:saved},...items];
        message(state,saved&&!match?'Saved '+(state.key==='city'?'city/municipality':state.key)+' retained. Select a listed place to change it.':items.length?'': 'No places available for this selection.');
        check(state);return true;
      }catch{
        if(!alive||!form.isConnected||sequence!==state.sequence)return false;
        state.input.disabled=!state.value.value;state.toggle.disabled=true;message(state,'Could not load '+(state.key==='city'?'cities and municipalities':state.key==='province'?'provinces':'barangays')+'. Your entries are kept.');state.retry.hidden=false;return false;
      }finally{if(alive&&sequence===state.sequence){state.loading=false;state.wrap.removeAttribute('aria-busy');submit.disabled=busy()||isSaving();}}
    };
    const cityPath=code=>(code==='1300000000'?'regions/':'provinces/')+code+'/cities-municipalities';
    const hydrate=async()=>{
      if(!await load(states[0],'provinces'))return;
      if(states[0].selected&&await load(states[1],cityPath(states[0].selected.code))&&states[1].selected)await load(states[2],'cities-municipalities/'+states[1].selected.code+'/barangays');
    };
    const choose=(state,code)=>{
      const item=state.items.find(item=>item.code===code);if(!item)return;
      const changed=state.value.value!==item.name;state.value.value=item.name;state.input.value=item.name;state.selected=item;close(state);state.input.focus({preventScroll:true});
      if(!changed)return;
      if(state.key==='province'){waiting(states[1],'Choose a province first.');waiting(states[2],'Choose a city or municipality first.');if(code!=='saved')void load(states[1],cityPath(code));}
      if(state.key==='city'){waiting(states[2],'Choose a city or municipality first.');if(code!=='saved')void load(states[2],'cities-municipalities/'+code+'/barangays');}
      state.value.dispatchEvent(new Event('change',{bubbles:true}));
    };
    states.forEach(state=>{
      state.input.addEventListener('focus',()=>open(state),{signal});
      state.input.addEventListener('input',()=>{check(state);open(state,state.input.value);},{signal});
      state.input.addEventListener('keydown',event=>{
        if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();if(state.list.hidden)open(state);activate(state,state.active<0?(event.key==='ArrowDown'?0:-1):state.active+(event.key==='ArrowDown'?1:-1));}
        else if(['Home','End'].includes(event.key)&&!state.list.hidden){event.preventDefault();activate(state,event.key==='Home'?0:-1);}
        else if(event.key==='Enter'&&!state.list.hidden){event.preventDefault();const item=state.list.querySelectorAll('[role=option]')[state.active<0?0:state.active];if(item)choose(state,item.dataset.code);}
        else if(event.key==='Escape'&&!state.list.hidden){event.preventDefault();event.stopPropagation();close(state);}
        else if(event.key==='Tab')close(state);
      },{signal});
      state.wrap.addEventListener('focusout',event=>{if(!state.wrap.contains(event.relatedTarget))close(state);},{signal});
      state.toggle.addEventListener('mousedown',event=>event.preventDefault(),{signal});
      state.toggle.addEventListener('click',()=>{if(state.list.hidden){state.input.focus({preventScroll:true});open(state);}else close(state);},{signal});
      state.list.addEventListener('mousedown',event=>event.preventDefault(),{signal});
      state.list.addEventListener('click',event=>{const option=event.target.closest('[role=option]');if(option)choose(state,option.dataset.code);},{signal});
      state.retry.addEventListener('click',async()=>{const loaded=state.key==='province'?await hydrate():await load(state,state.path);if(loaded&&state.key==='city'&&state.selected)await load(states[2],'cities-municipalities/'+state.selected.code+'/barangays');if(!state.input.disabled)state.input.focus();},{signal});
      state.input.disabled=!state.value.value;state.toggle.disabled=true;check(state);
    });
    message(states[1],states[1].value.value?'Saved city/municipality retained. Choose a listed province to change it.':'Choose a province first.');
    message(states[2],states[2].value.value?'Saved barangay retained. Choose a listed city or municipality to change it.':'Choose a city or municipality first.');
    document.addEventListener('pointerdown',event=>states.forEach(state=>{if(!state.wrap.contains(event.target))close(state);}),{signal});
    form.closest('.modal-body-scroll')?.addEventListener('scroll',()=>states.forEach(state=>{if(!state.list.hidden)position(state);}),{signal});
    window.addEventListener('resize',()=>states.forEach(state=>{if(!state.list.hidden)position(state);}),{signal});
    window.visualViewport?.addEventListener('resize',()=>states.forEach(state=>{if(!state.list.hidden)position(state);}),{signal});
    window.visualViewport?.addEventListener('scroll',()=>states.forEach(state=>{if(!state.list.hidden)position(state);}),{signal});
    const fee=form.elements.shipping_fee;let deliveryFee=fee.value||'0';
    const sync=()=>{
      const shown=delivery();form.querySelector('[data-ap-delivery]').hidden=!shown;
      form.querySelectorAll('[data-ap-delivery] input:not([type=hidden])').forEach(input=>{input.required=shown;});
      if(shown&&fee.readOnly)fee.value=deliveryFee;
      if(!shown){if(!fee.readOnly)deliveryFee=fee.value;fee.value='0';fee.setCustomValidity('');}fee.readOnly=!shown;
      if(shown&&!started){started=true;void hydrate();}else if(!shown)states.forEach(close);
      submit.disabled=busy()||isSaving();
    };
    const validate=()=>{
      if(!delivery())return true;
      if(busy()){void popup('Please wait for the delivery places to finish loading. Your quotation is still here.','Check delivery address');return false;}
      const invalid=states.find(state=>!state.value.value||state.input.value!==state.value.value);
      if(invalid){check(invalid);if(!invalid.input.disabled){invalid.input.focus();invalid.input.reportValidity();}else{void popup('Select the province, city or municipality, and barangay before sending this delivery quotation. If a list could not load, choose Try again.','Check delivery address');}return false;}
      return true;
    };
    sync();return {sync,busy,validate,dispose:()=>{alive=false;events.abort();}};
  }
  const loadAvailability = async () => {
    if(availability&&Date.now()-availabilityLoadedAt<30000)return availability;
    if(!availabilityPending)availabilityPending=request('/appointment-products/availability').then(result=>{availability=result.data;availabilityLoadedAt=Date.now();return availability;}).finally(()=>availabilityPending=null);
    return availabilityPending;
  };
  const older = (incoming,current) => incoming?.id===current?.id&&Number(incoming.revision)<Number(current.revision);
  const suggestField = (name,label,value,kind,required,help,placeholder) => {
    const id='ap-suggest-'+(++fieldSequence),limit=kind==='name'?160:300;
    return `<div class="ap-field"><label for="${id}">${esc(label)}${required?' '+requiredMark:''}</label><div class="ap-suggest" data-ap-suggest="${kind}"><input id="${id}" name="${esc(name)}" value="${esc(value)}" maxlength="${limit}" placeholder="${esc(placeholder)}" ${required?'required':''} role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-list" aria-describedby="${id}-help" autocomplete="off"><button type="button" data-ap-suggest-toggle aria-label="Show ${esc(label.toLowerCase())} examples" aria-controls="${id}-list" aria-expanded="false"><svg viewBox="0 0 12 8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m1 1.5 5 5 5-5"/></svg></button><ul id="${id}-list" role="listbox" aria-label="${esc(label)} examples" hidden></ul></div><small id="${id}-help">${esc(help)}</small></div>`;
  };
  const measurementField = (prefix,value='',final=false) => {
    const id='ap-size-'+(++fieldSequence);
    const number=(key,label)=>`<label class="ap-field" data-size-axis="${key}"><span>${label} <span data-size-required>${requiredMark}</span></span><input id="${id}-${key}" type="number" inputmode="decimal" min="0" step="any" data-size-value="${key}" data-ap-focus-key="${prefix}size-${key}" aria-label="${label}" placeholder="e.g. 10" disabled></label>`;
    return `<div class="ap-field is-wide ap-dimensions" data-ap-measurements data-size-final="${final}" role="group" aria-labelledby="${id}-label"><span id="${id}-label" class="ap-dimensions-label">Dimensions or size${final?' '+requiredMark:''}</span><input type="hidden" name="${esc(prefix)}dimensions" value="${esc(value)}"><div class="ap-measurement-controls"><label class="ap-field" for="${id}-mode"><span>Size entry${final?' '+requiredMark:''}</span><select id="${id}-mode" data-size-mode data-ap-focus-key="${prefix}size-mode" ${final?'required':''}><option value="">Choose size format</option><option value="rectangular">Rectangular</option><option value="round">Round</option><option value="custom">Describe another size</option>${!final?'<option value="advice">I need advice</option>':''}</select></label><label class="ap-field" data-size-unit-field for="${id}-unit" hidden><span>Unit ${requiredMark}</span><select id="${id}-unit" data-size-unit data-ap-focus-key="${prefix}size-unit" disabled><option value="">Choose a unit</option><option value="mm">Millimeters (mm)</option><option value="cm">Centimeters (cm)</option><option value="in">Inches (in)</option></select></label></div><div class="ap-measurement-values" data-size-values hidden>${number('length','Length')}${number('width','Width')}${number('diameter','Diameter')}${number('height','Height (optional)')}</div><label class="ap-field" data-size-custom-field for="${id}-custom" hidden><span>Describe the size ${requiredMark}</span><input id="${id}-custom" type="text" data-size-custom data-ap-focus-key="${prefix}size-custom" maxlength="400" placeholder="e.g. Shirt size M, or the same size as my attached design" disabled></label><small data-size-help>Use the unit you know. For example, 10 cm is 100 mm. You can ask FMRC for help.</small><output class="ap-size-preview" data-size-preview aria-live="polite" hidden></output></div>`;
  };
  function bindBriefFields(form) {
    if(!form)return;
    for(const grid of form.querySelectorAll('[data-ap-brief-fields]')) {
      if(grid.dataset.bound)continue;
      grid.dataset.bound='true';
      const prefix=grid.dataset.prefix||'',final=grid.dataset.final==='true',service=form.elements[prefix+'service_id'];
      const services=JSON.parse(grid.dataset.services||'[]');
      const advice=()=>{const box=form.elements[prefix+'needs_advice'];if(box&&!box.checked){box.checked=true;box.dispatchEvent(new Event('input',{bubbles:true}));}};
      const source=kind=>{
        const current=(availability?.services||[]).find(s=>String(s.id)===service?.value)||services.find(s=>String(s.id)===service?.value)||{};
        const examples=kind==='name'?current.modal_best_for:kind==='material'?current.modal_materials:['Maroon','White','Black','Blue','Red','Green','Yellow','Gray','Natural / unpainted'];
        const items=(Array.isArray(examples)?examples:[]).filter(v=>typeof v==='string'&&v.trim()&&!/^(n\/?a|none|--?)$/i.test(v.trim())).map(v=>v.trim());
        if(kind==='material'&&!final)items.push('I need advice');
        return [...new Set(items)];
      };
      for(const wrap of grid.querySelectorAll('[data-ap-suggest]')) {
        const input=wrap.querySelector('input'),toggle=wrap.querySelector('button'),list=wrap.querySelector('[role=listbox]');let active=-1;
        const close=()=>{list.hidden=true;wrap.classList.remove('is-open');input.setAttribute('aria-expanded','false');toggle.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1;};
        const position=()=>{if(!positionOptions(wrap,input,list))close();};
        const activate=index=>{const options=[...list.querySelectorAll('[role=option]')];active=options.length?(index+options.length)%options.length:-1;options.forEach((o,i)=>o.classList.toggle('is-active',i===active));if(active>=0){input.setAttribute('aria-activedescendant',options[active].id);revealOption(list,options[active]);}else input.removeAttribute('aria-activedescendant');};
        const choose=value=>{input.value=value;if(value==='I need advice')advice();close();input.dispatchEvent(new Event('input',{bubbles:true}));close();input.dispatchEvent(new Event('change',{bubbles:true}));input.focus({preventScroll:true});};
        const open=(queryText=input.value)=>{
          if(input.disabled)return;
          document.querySelectorAll('.ap-suggest.is-open').forEach(other=>{if(other!==wrap)other.apSuggestion?.close();});
          const query=queryText.trim().toLocaleLowerCase('en-PH'),items=source(wrap.dataset.apSuggest),matches=items.filter(item=>item.toLocaleLowerCase('en-PH').includes(query));
          list.replaceChildren();
          for(const [i,value] of matches.entries()){const option=document.createElement('li');option.id=input.id+'-option-'+i;option.setAttribute('role','option');option.setAttribute('aria-selected',String(input.value===value));option.textContent=value;option.dataset.value=value;list.append(option);}
          if(!matches.length){const empty=document.createElement('li');empty.className='ap-suggest-empty';empty.setAttribute('role','presentation');empty.textContent=query?'No matching example. You can use your own text.':'No examples for this service yet. Type your own idea.';list.append(empty);}
          active=-1;input.removeAttribute('aria-activedescendant');list.hidden=false;wrap.classList.add('is-open');input.setAttribute('aria-expanded','true');toggle.setAttribute('aria-expanded','true');position();
        };
        wrap.apSuggestion={close,position,refresh:()=>{if(!list.hidden)open('');}};
        toggle.addEventListener('click',()=>{if(list.hidden){input.focus({preventScroll:true});open('');}else close();});
        input.addEventListener('input',()=>{input.setCustomValidity('');open();});
        input.addEventListener('click',()=>open(''));
        input.addEventListener('keydown',event=>{
          if(event.isComposing)return;
          if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();if(list.hidden)open('');activate(active<0?(event.key==='ArrowDown'?0:-1):active+(event.key==='ArrowDown'?1:-1));}
          else if(['Home','End'].includes(event.key)&&!list.hidden){event.preventDefault();activate(event.key==='Home'?0:-1);}
          else if(event.key==='Enter'&&!list.hidden){event.preventDefault();if(active>=0)choose(list.querySelectorAll('[role=option]')[active].dataset.value);else close();}
          else if(event.key==='Escape'&&!list.hidden){event.preventDefault();event.stopPropagation();close();}
          else if(event.key==='Tab')close();
        });
        wrap.addEventListener('focusout',()=>queueMicrotask(()=>{if(!wrap.contains(document.activeElement))close();}));
        list.addEventListener('pointerdown',event=>{if(event.target.closest('[role=option]'))event.preventDefault();});
        list.addEventListener('click',event=>{const option=event.target.closest('[role=option]');if(option)choose(option.dataset.value);});
      }
      service?.addEventListener('change',()=>grid.querySelectorAll('[data-ap-suggest]').forEach(wrap=>wrap.apSuggestion.refresh()));
      for(const root of grid.querySelectorAll('[data-ap-measurements]')) {
        const mode=root.querySelector('[data-size-mode]'),unit=root.querySelector('[data-size-unit]'),custom=root.querySelector('[data-size-custom]'),value=root.querySelector('input[type=hidden]'),preview=root.querySelector('[data-size-preview]'),inputs=Object.fromEntries([...root.querySelectorAll('[data-size-value]')].map(input=>[input.dataset.sizeValue,input]));
        let lastValue=value.value;
        const state=()=>({version:1,mode:mode.value,unit:unit.value,custom:custom.value,...Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,input.value])),raw:value.value});
        const positive=input=>input.value!==''&&/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(input.value)&&Number.isFinite(Number(input.value))&&Number(input.value)>0;
        const sync=(commit=true)=>{
          const geometric=['rectangular','round'].includes(mode.value);
          root.querySelector('[data-size-unit-field]').hidden=!geometric;unit.disabled=!geometric;unit.required=geometric;
          root.querySelector('[data-size-values]').hidden=!geometric;
          for(const [key,input]of Object.entries(inputs)){const on=geometric&&(key==='height'||mode.value==='round'&&key==='diameter'||mode.value==='rectangular'&&['length','width'].includes(key));input.closest('[data-size-axis]').hidden=!on;input.disabled=!on;input.required=on&&key!=='height';input.closest('label').querySelector('[data-size-required]').hidden=key==='height';input.setCustomValidity('');}
          custom.closest('[data-size-custom-field]').hidden=mode.value!=='custom';custom.disabled=mode.value!=='custom';custom.required=mode.value==='custom';
          mode.setCustomValidity('');unit.setCustomValidity('');custom.setCustomValidity('');
          const size=mode.value==='rectangular'?[inputs.length.value,inputs.width.value,...(inputs.height.value?[inputs.height.value]:[])].filter(Boolean).join(' × '):mode.value==='round'?'Diameter '+inputs.diameter.value+(inputs.height.value?' × Height '+inputs.height.value:''):custom.value.trim();
          const complete=geometric&&unit.value&&(mode.value==='round'?positive(inputs.diameter):positive(inputs.length)&&positive(inputs.width))&&(!inputs.height.value||positive(inputs.height));
          const text=complete?size+' '+unit.value:mode.value==='custom'?custom.value.trim():mode.value==='advice'?'I need advice':'';
          if(commit){value.value=text;lastValue=text;}
          preview.hidden=!complete;preview.textContent=complete?'Size: '+text:'';
          root.querySelector('[data-size-help]').textContent=mode.value==='advice'?'FMRC will help you choose the size during your consultation.':'Use the unit you know. For example, 10 cm is 100 mm. You can ask FMRC for help.';
          if(mode.value==='advice')advice();
        };
        const restore=saved=>{
          if(!saved||saved.version!==1)return false;
          mode.value=saved.mode||'';unit.value=saved.unit||'';custom.value=String(saved.custom||'');for(const [key,input]of Object.entries(inputs))input.value=String(saved[key]||'');
          value.value=String(saved.raw||'');lastValue=value.value;sync(false);return true;
        };
        const read=raw=>{
          mode.value='';unit.value='';custom.value='';Object.values(inputs).forEach(input=>input.value='');
          const n='(\\d+(?:\\.\\d+)?|\\.\\d+)',rect=new RegExp('^'+n+'\\s*[×x]\\s*'+n+'(?:\\s*[×x]\\s*'+n+')?\\s*(mm|cm|in)$','i'),round=new RegExp('^Diameter\\s+'+n+'(?:\\s*[×x]\\s*Height\\s+'+n+')?\\s*(mm|cm|in)$','i');
          let match=raw.trim().match(rect);
          if(match){mode.value='rectangular';inputs.length.value=match[1];inputs.width.value=match[2];inputs.height.value=match[3]||'';unit.value=match[4].toLowerCase();}
          else if((match=raw.trim().match(round))){mode.value='round';inputs.diameter.value=match[1];inputs.height.value=match[2]||'';unit.value=match[3].toLowerCase();}
          else if(raw.trim()){mode.value=raw==='I need advice'&&!final?'advice':'custom';custom.value=raw;}
          value.value=raw;lastValue=raw;sync(false);
        };
        const validate=()=>{
          if(value.value!==lastValue)read(value.value);
          sync(false);
          if(['rectangular','round'].includes(mode.value)){
            for(const input of Object.values(inputs))if(!input.disabled&&(input.required||input.value)&&!positive(input))input.setCustomValidity('Enter a measurement greater than zero.');
          }
          if(final&&(!mode.value||mode.value==='advice'||value.value==='I need advice'))mode.setCustomValidity('Confirm the product dimensions before sending the quotation.');
          if(mode.value==='custom'&&!custom.value.trim())custom.setCustomValidity('Describe the size, or choose I need advice.');
          return [mode,unit,custom,...Object.values(inputs)].every(input=>input.disabled||input.checkValidity());
        };
        root.apMeasurements={state,restore,validate,reset:()=>read('')};
        root.addEventListener('input',event=>{if(event.target!==value)sync();});
        root.addEventListener('change',event=>{if(event.target!==value){sync();form.dataset.dirty='true';}});
        read(value.value);
      }
      form.addEventListener('reset',()=>queueMicrotask(()=>grid.querySelectorAll('[data-ap-measurements]').forEach(root=>root.apMeasurements.reset())));
    }
  }
  function validateBriefFields(form) {
    bindBriefFields(form);
    let valid=true;
    form.querySelectorAll('[data-ap-measurements]').forEach(root=>{if(!root.apMeasurements.validate())valid=false;});
    for(const grid of form.querySelectorAll('[data-ap-brief-fields][data-final="true"]')){
      const material=form.elements[(grid.dataset.prefix||'')+'material'];
      material.setCustomValidity(material.value==='I need advice'?'Confirm the material before sending the quotation.':'');
      if(!material.checkValidity())valid=false;
    }
    if(!valid)form.reportValidity();
    return valid;
  }
  document.addEventListener('pointerdown',event=>document.querySelectorAll('.ap-suggest.is-open').forEach(wrap=>{if(!wrap.contains(event.target))wrap.apSuggestion?.close();}));
  const positionSuggestions=()=>document.querySelectorAll('.ap-suggest.is-open').forEach(wrap=>wrap.apSuggestion?.position());
  window.addEventListener('resize',positionSuggestions);
  window.visualViewport?.addEventListener('resize',positionSuggestions);
  window.visualViewport?.addEventListener('scroll',positionSuggestions);
  document.addEventListener('scroll',positionSuggestions,true);
  const requirements = (form,prefix='') => {
    const get = name => form.elements[prefix+name]?.value?.trim() || '';
    const keys=['name','description','dimensions','material','colors','instructions'];
    const out = Object.fromEntries(keys.map(k=>[k,get(k)]));
    out.service_id=Number(get('service_id'));out.quantity=Number(get('quantity'))||1;
    out.needs_advice=!!form.elements[prefix+'needs_advice']?.checked;
    out.customer_notes_version=1;
    if(form.id==='aptCustomFields') {
      if(bookingFinish)out.finish=bookingFinish;
      out.instructions=document.getElementById('aptDesc')?.value.trim()||'';
    }
    if(get('budget'))out.budget=Number(get('budget')); if(get('preferred_date'))out.preferred_date=get('preferred_date');
    return out;
  };
  const briefFields = (data={},services=[],prefix='',final=false,operator=false,booking=false) => {
    data=customerRequest(data);
    return `<div class="ap-grid" data-ap-brief-fields data-prefix="${esc(prefix)}" data-final="${final}" data-services="${esc(JSON.stringify(services))}">
    <label class="ap-field is-wide"><span>FMRC service ${requiredMark}</span><select name="${prefix}service_id" required ${final?'disabled':''}>${services.map(s=>`<option value="${s.id}" ${Number(data.service_id)===Number(s.id)?'selected':''}>${esc(s.title)}</option>`).join('')}</select><small>${final?'To change the service, save the product details and confirm the consultation outcome first.':'Choose the FMRC service that best fits your idea.'}</small></label>
    <p class="ap-help ap-brief-guidance">Choose an example or type your own. FMRC will confirm the specifications during your consultation.</p>
    ${suggestField(prefix+'name','Product idea',data.name,'name',true,'Search examples or name the product you want made.','e.g. Personalized desk sign')}
    ${field(prefix+'quantity','Quantity',data.quantity||1,'number',true,false,'How many pieces would you like?')}
    ${field(prefix+'description','Describe the product',data.description,'textarea',true,true,'Tell us what you want made, its purpose, and any important design details.','Describe your idea in your own words.')}
    ${measurementField(prefix,data.dimensions,final)}
    ${suggestField(prefix+'material','Material',data.material,'material',final,final?'Confirm the material agreed with the customer.':'Choose an example, type another material, or ask FMRC for advice.','Search or type a material')}
    ${suggestField(prefix+'colors','Colors',data.colors,'colors',final,'Choose a color or describe a combination.','e.g. Maroon and white')}
    ${!final?`${field(prefix+'budget','Budget (optional)',data.budget,'number',false,false,'Your estimated budget for the whole request, in pesos.','e.g. 500')}${field(prefix+'preferred_date','Preferred completion date',data.preferred_date,'date',false,false,'Your target date. FMRC will confirm the production schedule.')}
      <label class="ap-check"><input type="checkbox" name="${prefix}needs_advice" ${data.needs_advice?'checked':''}><span>${operator?'The customer needs advice on some specifications.':'I need advice from the FMRC team on some specifications.'}</span></label>`:''}
    ${booking?'':field(prefix+'instructions','Additional notes (optional)',data.instructions,'textarea',false,true,'Add exact lettering, personalization, or other details FMRC should know.','e.g. Print “FMRC” on the front.')}
  </div>`;};
  const specs = (data,omit=[],service='') => {
    const d=customerRequest(data||{});
    const values={'FMRC service':service,'Product idea':d.name,Quantity:d.quantity,'Describe the product':d.description,'Dimensions or size':d.dimensions,Material:d.material,Colors:d.colors,'Additional notes (optional)':d.instructions||'None'};
    const main='<dl class="ap-summary">'+Object.entries(values).filter(([label,value])=>!omit.includes(label)&&(label!=='FMRC service'||value)).map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value??'Not specified')}</dd></div>`).join('')+'</dl>';
    const legacy=Object.entries({Finish:data?.finish,'Intended use':data?.intended_use}).filter(([,value])=>value);
    return main+(legacy.length?'<details class="ap-legacy-specs"><summary>Original quotation details</summary><dl class="ap-summary">'+legacy.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')+'</dl></details>':'');
  };
  const preferences = data => `<section class="ap-preferences"><h4>Customer preferences</h4><dl class="ap-summary"><div><dt>Budget</dt><dd>${data?.budget!==undefined&&data?.budget!==null&&data?.budget!==''?money(data.budget):'Not specified'}</dd></div><div><dt>Preferred completion date</dt><dd>${data?.preferred_date?esc(new Date(data.preferred_date+'T12:00:00+08:00').toLocaleDateString('en-PH',{timeZone:'Asia/Manila',month:'long',day:'numeric',year:'numeric'})):'No preference'}</dd></div><div><dt>Specification advice</dt><dd>${data?.needs_advice?'Requested by the customer':'Not requested'}</dd></div></dl></section>`;
  const customerSpecs=(data,service='',omit=[])=>{const d=customerRequest(data),values={'FMRC service':service||'To be discussed','Product idea':d.name,Quantity:d.quantity,'Describe the product':d.description,'Dimensions or size':d.dimensions,Material:d.material,Colors:d.colors,'Budget (optional)':d.budget!==undefined&&d.budget!==null&&d.budget!==''?money(d.budget):'Not specified','Preferred completion date':d.preferred_date?new Date(d.preferred_date+'T12:00:00+08:00').toLocaleDateString('en-PH',{timeZone:'Asia/Manila',month:'long',day:'numeric',year:'numeric'}):'No preference','Advice from the FMRC team':d.needs_advice?'Requested':'Not requested','Additional notes (optional)':d.instructions||'None'};return '<dl class="ap-summary">'+Object.entries(values).filter(([label])=>!omit.includes(label)).map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value||'To be discussed')}</dd></div>`).join('')+'</dl>';};
  const teamPage=name=>link(`/${location.pathname.includes('staff-page')?'staff-page':'admin-page'}/${name}.html`);
  const linkedOrders=job=>!(job.orders||[]).length?'':`<section class="ap-linked-orders"><h4>Linked orders</h4><p class="ap-help">The appointment keeps your consultation history. Each accepted quotation has a linked payment and fulfillment order.</p><ul>${job.orders.map(order=>`<li><div><strong>${esc(order.order_no)}</strong><small>${esc(order.custom_product?.stage||order.lifecycle_status)} · ${esc(order.payment_status||'Payment pending')}</small></div><a class="ap-btn is-secondary" href="${esc(teamPage('orders')+'?order_id='+encodeURIComponent(order.id))}">Open order</a></li>`).join('')}</ul></section>`;
  function mountMeetingRemoval(host,appointment){
    if(!host||!team||!appointment.can_remove_meeting_link||host.querySelector('[data-remove-meeting]'))return;
    const row=document.createElement('div');row.className='ap-meeting-removal';
    row.innerHTML=button('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg>Remove meeting link','data-remove-meeting',true);
    const summary=host.querySelector('[data-meeting-summary]')||host,join=summary.querySelector(':scope > a');if(join)row.prepend(join);summary.append(row);const action=row.querySelector('button');let busy=false,blocked=false;
    if(!host.closest('.ap-panel'))action.classList.add('btn-admin','btn-secondary');
    action.onclick=async()=>{if(busy||blocked)return;busy=true;action.disabled=true;
      try{if(!await confirm(`Remove the meeting link for ${appointment.reference_no}? Customers will no longer see its Join meeting button. The appointment and linked orders will be kept.`,'Remove meeting link'))return;
        const result=await request(`/admin/appointments/${appointment.id}/meeting`,{method:'PATCH',body:JSON.stringify({platform:null,meeting_url:null,expected_version:appointment.schedule_version})});
        summary.querySelectorAll('a[href]').forEach(link=>link.remove());const status=summary.querySelector('strong');if(status)status.textContent=result.data.meeting_status;const copy=summary.querySelector('p');if(copy)copy.textContent='No meeting link is currently shared.';
        const form=host.querySelector('[data-meeting-form]');if(form){form.querySelectorAll('input').forEach(input=>input.value='');form.querySelector('fieldset').disabled=true;form.querySelector('[data-meeting-status]').textContent='Meeting link removed. Refresh before adding new meeting details.';}
        row.remove();window.dispatchEvent(new CustomEvent('fmrc:appointment-updated',{detail:{appointment:result.data}}));window.showAdminSuccessNotification?.('Meeting link removed.',{title:'Saved!'});
      }catch(error){blocked=error.status===409;await popup(error.message,'Meeting link not removed');}
      finally{busy=false;if(action.isConnected)action.disabled=blocked;}
    };
  }
  const orderMeeting=meeting=>!meeting||meeting.appointment_method!=='online'?'':`<section class="ap-linked-meeting" data-order-meeting><h4>Online meeting</h4><div class="appointment-meeting-summary" data-meeting-summary><div><strong>${esc(meeting.meeting_status)}</strong><p>${esc(meeting.meeting_platform||'No meeting link is currently shared.')}</p></div>${meeting.meeting_url?`<a class="ap-btn is-secondary" href="${esc(meeting.meeting_url)}" target="_blank" rel="noopener noreferrer">Join meeting</a>`:''}</div></section>`;
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
  const chatAccept='.jpg,.jpeg,.png,.webp,.gif,.pdf,.doc,.docx,.stl,.obj,.step,.stp,.iges,.igs,.dxf,.dwg';
  const chatIcon = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">'+({
    chat:'<path d="M21 11a8 8 0 0 1-8 8H6l-4 3V11a9 9 0 0 1 19 0Z"/><path d="M7 10h10M7 14h6"/>',
    attach:'<path d="m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9"/>',
    file:'<path d="M14 2H5v20h14V7l-5-5Z"/><path d="M14 2v6h5M8 13h8M8 17h6"/>',
    send:'<path d="m22 2-7 20-4-9-9-4 20-7ZM11 13 22 2"/>',
    close:'<path d="m6 6 12 12M18 6 6 18"/>',
    down:'<path d="M12 4v16m-6-6 6 6 6-6"/>'
  })[name]+'</svg>';
  const chatSize = size => Number(size)>=1048576?(Number(size)/1048576).toFixed(1)+' MB':Math.max(1,Math.ceil(Number(size)/1024))+' KB';
  const chatDate = value => value?new Date(/^\d{4}-\d{2}-\d{2} \d{2}:/.test(value)?value.replace(' ','T')+'Z':value):new Date(NaN);
  const chatDay = value => {const d=chatDate(value);return Number.isNaN(d.getTime())?'unknown':new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);};
  const chatDayLabel = value => {const d=chatDate(value);if(Number.isNaN(d.getTime()))return 'Earlier messages';return chatDay(value)===chatDay(new Date().toISOString())?'Today':new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',year:'numeric'}).format(d);};
  const chatTime = value => {const d=chatDate(value);return Number.isNaN(d.getTime())?'Time unavailable':new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'}).format(d);};
  const chatCompare = (a,b) => {const x=chatDate(a.created_at).getTime(),y=chatDate(b.created_at).getTime();return (Number.isNaN(x)?Number.isNaN(y)?0:-1:Number.isNaN(y)?1:x-y)||Number(a.id)-Number(b.id);};
  const chatAuthor = m => String(m.sender_id??m.sender_name??m.sender_role);
  const chatMarkup = ctx => `<div class="ap-chat" data-ap-chat><header class="ap-chat-head"><span class="ap-chat-symbol">${chatIcon('chat')}</span><div><h4 id="ap-chat-title-${ctx.key}">Conversation</h4><p>Discuss your request and share design files here.</p></div></header><p class="ap-chat-notice">${ctx.admin?'For paid-order changes, use the cancellation and refund actions in Orders.':'For changes to a paid order, request help in My Orders.'}</p><div class="ap-chat-history"><div class="ap-chat-log" data-ap-chat-log role="log" aria-labelledby="ap-chat-title-${ctx.key}" aria-relevant="additions" tabindex="0"><div class="ap-chat-empty" data-ap-chat-empty>${chatIcon('chat')}<strong>Start the conversation</strong><p>Send a message or share a design file.</p></div></div><button type="button" class="ap-chat-latest" data-ap-chat-latest hidden>${chatIcon('down')}<span>New messages</span></button></div><form class="ap-chat-composer" data-ap-form="messages" novalidate><ul class="ap-chat-selected" data-ap-chat-selected aria-label="Files to send" hidden></ul><label class="ap-chat-label" for="ap-chat-message-${ctx.key}">Message</label><textarea id="ap-chat-message-${ctx.key}" name="body" rows="2" maxlength="5000" placeholder="Write a message…" aria-describedby="ap-chat-feedback-${ctx.key} ap-chat-limit-${ctx.key}"></textarea><div class="ap-chat-compose-actions"><div><input class="ap-chat-upload" type="file" id="ap-chat-files-${ctx.key}" name="attachments" multiple accept="${chatAccept}"><button type="button" class="ap-chat-attach" data-ap-chat-attach>${chatIcon('attach')}Attach files</button><span class="ap-chat-counter" data-ap-chat-counter aria-label="Message characters">0 / 5,000</span></div><button type="submit" class="ap-btn ap-chat-send" disabled>${chatIcon('send')}<span>Send</span></button></div><small id="ap-chat-limit-${ctx.key}" class="ap-chat-limit">Up to 5 files · 50 MB total. Images, PDF, Word, or CAD files.</small><p id="ap-chat-feedback-${ctx.key}" class="ap-chat-feedback" data-ap-chat-feedback role="status" aria-live="polite"></p><p class="ap-chat-connection" data-ap-chat-connection role="status" hidden></p></form></div>`;

  // This surface survives surrounding form refreshes. Only new message nodes are inserted.
  function syncChat(ctx, snapshot=ctx.job) {
    const chat=ctx.root.querySelector('[data-ap-chat]');if(!chat)return;
    const state=ctx.chat||(ctx.chat={messages:new Map(),files:new Map(),unseen:new Set(),selected:[]});
    for(const m of snapshot.messages||[])state.messages.set(String(m.id),m);
    for(const f of snapshot.files||[])if(f.message_id)state.files.set(String(f.id),f);
    const log=chat.querySelector('[data-ap-chat-log]'),nearBottom=log.scrollHeight-log.scrollTop-log.clientHeight<64;
    const wasVisible=ctx.tab===2&&!!log.getClientRects().length;
    const anchor=wasVisible&&!nearBottom?[...log.querySelectorAll('[data-chat-message]')].find(n=>n.getBoundingClientRect().bottom>log.getBoundingClientRect().top):null,anchorTop=anchor?.getBoundingClientRect().top;
    const messages=[...state.messages.values()].sort(chatCompare);
    let added=0,previous=null;
    for(const m of messages){
      const day=chatDay(m.created_at),own=ctx.admin?m.sender_role!=='customer':m.sender_role==='customer';
      let group=log.querySelector(`[data-chat-day="${CSS.escape(day)}"]`);
      if(!group){group=document.createElement('section');group.className='ap-chat-day';group.dataset.chatDay=day;group.innerHTML=`<h5>${esc(chatDayLabel(m.created_at))}<span class="ap-chat-sr"> · Philippine time</span></h5>`;log.append(group);}
      let row=log.querySelector(`[data-chat-message="${CSS.escape(String(m.id))}"]`);
      if(!row){
        row=document.createElement('article');row.className='ap-chat-message';row.dataset.chatMessage=m.id;
        const name=m.sender_name||(m.sender_role==='customer'?'Customer':'FMRC team');
        const initials=name.trim().split(/\s+/).slice(0,2).map(s=>[...s][0]).join('').toLocaleUpperCase();
        row.innerHTML=`<span class="ap-chat-avatar" aria-hidden="true">${esc(initials)}</span><div class="ap-chat-bubble"><div class="ap-chat-sender">${esc(name)}${m.sender_role!=='customer'?'<span>FMRC team</span>':''}</div>${m.body?`<p class="ap-chat-text">${esc(m.body)}</p>`:''}<ul class="ap-chat-files" data-ap-chat-files hidden></ul><time title="${esc(date(m.created_at))} · Philippine time">${esc(chatTime(m.created_at))}</time></div>`;
        if(!Number.isNaN(chatDate(m.created_at).getTime()))row.querySelector('time').dateTime=chatDate(m.created_at).toISOString();
        const next=[...group.querySelectorAll('[data-chat-message]')].find(n=>chatCompare(state.messages.get(n.dataset.chatMessage),m)>0);group.insertBefore(row,next||null);
        added++;if(state.initialized&&(!wasVisible||!nearBottom))state.unseen.add(String(m.id));
      }
      row.classList.toggle('is-own',own);
      row.classList.toggle('is-continuation',!!previous&&chatAuthor(previous)===chatAuthor(m)&&previous.sender_role===m.sender_role&&chatDay(previous.created_at)===day&&Math.abs(chatDate(m.created_at)-chatDate(previous.created_at))<=300000);
      const files=row.querySelector('[data-ap-chat-files]');
      for(const f of state.files.values())if(String(f.message_id)===String(m.id)&&!files.querySelector(`[data-ap-file="${CSS.escape(String(f.id))}"]`)){
        const li=document.createElement('li');li.innerHTML=`<button type="button" class="ap-chat-file" data-ap-file="${esc(f.id)}" aria-label="Download ${esc(f.name)}">${chatIcon('file')}<span><strong>${esc(f.name)}</strong><small>${esc(chatSize(f.size))} · Download</small></span></button>`;files.append(li);
      }
      files.hidden=!files.children.length;previous=m;
    }
    // Late snapshots may include older history; keep its actual date and reading anchor.
    const groups=[...log.querySelectorAll('[data-chat-day]')];groups.sort((a,b)=>a.dataset.chatDay==='unknown'?-1:b.dataset.chatDay==='unknown'?1:a.dataset.chatDay.localeCompare(b.dataset.chatDay));
    groups.forEach((group,i)=>{if(log.querySelectorAll('[data-chat-day]')[i]!==group)log.insertBefore(group,log.querySelectorAll('[data-chat-day]')[i]||null);});
    log.querySelector('[data-ap-chat-empty]').hidden=messages.length>0;
    if(wasVisible&&(!state.initialized||nearBottom)&&added){log.scrollTop=log.scrollHeight;state.unseen.clear();}
    else if(anchor)log.scrollTop+=anchor.getBoundingClientRect().top-anchorTop;
    state.initialized=true;
    chat.querySelector('[data-ap-chat-latest]').hidden=!state.unseen.size;
    chat.querySelector('[data-ap-chat-latest] span').textContent=state.unseen.size?'New messages ('+state.unseen.size+')':'New messages';
  }
  function chatConnection(ctx,failed) {
    const node=ctx.root.querySelector('[data-ap-chat-connection]');if(!node)return;
    node.hidden=!failed;node.textContent=failed?'Updates paused. Reconnecting…':'';
  }
  function openChat(ctx,reveal=false) {
    const log=ctx.root.querySelector('[data-ap-chat-log]');if(!log)return;
    fitChat(ctx);
    const state=ctx.chat;if(!state.opened){log.scrollTop=log.scrollHeight;state.opened=true;state.unseen.clear();ctx.root.querySelector('[data-ap-chat-latest]').hidden=true;}
    if(reveal){const chat=log.closest('[data-ap-chat]'),host=scrollContainer(chat);if(host)host.scrollTop+=chat.getBoundingClientRect().top-host.getBoundingClientRect().top-12;}
  }
  function fitChat(ctx) {
    const chat=ctx.root.querySelector('[data-ap-chat]');if(ctx.tab!==2||!chat?.getClientRects().length)return;
    const log=chat.querySelector('[data-ap-chat-log]'),host=scrollContainer(chat),nearBottom=log.scrollHeight-log.scrollTop-log.clientHeight<64;
    const available=Math.min(host?.clientHeight||innerHeight-80,window.visualViewport?.height||innerHeight)-24;
    const fixed=chat.getBoundingClientRect().height-log.getBoundingClientRect().height;
    log.style.height=Math.max(80,Math.min(430,available-fixed))+'px';
    if(nearBottom)log.scrollTop=log.scrollHeight;
  }
  const fitVisibleChats=()=>{for(const ctx of contexts.values())if(ctx.root.isConnected){fitChat(ctx);const form=ctx.root.querySelector('[data-ap-form="messages"]');if(form?.contains(document.activeElement)){const host=scrollContainer(form),bottom=Math.min(host?.getBoundingClientRect().bottom||innerHeight,(window.visualViewport?.offsetTop||0)+(window.visualViewport?.height||innerHeight));if(host&&form.getBoundingClientRect().bottom>bottom)host.scrollTop+=form.getBoundingClientRect().bottom-bottom+12;}}};
  window.addEventListener('resize',fitVisibleChats,{passive:true});
  window.visualViewport?.addEventListener('resize',fitVisibleChats,{passive:true});
  function bindChat(ctx) {
    const chat=ctx.root.querySelector('[data-ap-chat]');if(chat.dataset.bound)return;
    chat.dataset.bound='true';syncChat(ctx);
    const state=ctx.chat,form=chat.querySelector('form'),input=form.elements.body,upload=form.elements.attachments,send=form.querySelector('[type=submit]');
    const feedback=(text,error=false)=>{const n=chat.querySelector('[data-ap-chat-feedback]');n.textContent=text;n.classList.toggle('is-error',error);};
    const setFiles=files=>{const transfer=new DataTransfer();for(const file of files)transfer.items.add(file);upload.files=transfer.files;state.selected=files;};
    const update=()=>{
      input.setCustomValidity('');form.dataset.dirty=String(!!input.value||state.selected.length>0||!!state.pending);
      send.disabled=!!state.sending||(!state.pending&&!input.value.trim()&&!state.selected.length);
      send.querySelector('span').textContent=state.sending?'Sending…':state.pending?'Retry':'Send';
      chat.querySelector('[data-ap-chat-counter]').textContent=input.value.length.toLocaleString('en-PH')+' / 5,000';
      let recovery=chat.querySelector('[data-ap-chat-recovery]');
      if(!recovery){recovery=document.createElement('div');recovery.className='ap-chat-recovery';recovery.dataset.apChatRecovery='';form.prepend(recovery);}
      recovery.hidden=!state.pending||state.sending;
      if(!recovery.hidden){const text=state.pending.body||state.pending.files.map(f=>f.name).join(', ');recovery.innerHTML=`<strong>Message not confirmed</strong><p>${esc(text.slice(0,160))}${text.length>160?'…':''}</p><small>Retry checks this message first. Your current draft is kept.</small>`;}
      input.style.height='auto';input.style.height=Math.min(130,Math.max(64,input.scrollHeight))+'px';
      fitChat(ctx);
    };
    const showFiles=()=>{
      const list=chat.querySelector('[data-ap-chat-selected]');list.hidden=!state.selected.length;
      list.innerHTML=state.selected.map((f,i)=>`<li>${chatIcon('file')}<span><strong>${esc(f.name)}</strong><small>${chatSize(f.size)}</small></span><button type="button" data-chat-remove="${i}" aria-label="Remove ${esc(f.name)}">${chatIcon('close')}</button></li>`).join('');update();
    };
    state.update=update;state.feedback=feedback;state.setFiles=setFiles;state.showFiles=showFiles;
    input.addEventListener('input',()=>{feedback('');update();});
    input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229&&!matchMedia('(pointer: coarse)').matches&&navigator.maxTouchPoints===0){e.preventDefault();if(!send.disabled)form.requestSubmit();}});
    upload.addEventListener('change',()=>{
      const files=[...state.selected];for(const f of upload.files)if(!files.some(x=>x.name===f.name&&x.size===f.size&&x.lastModified===f.lastModified))files.push(f);
      const bad=files.find(f=>!chatAccept.split(',').includes('.'+f.name.split('.').pop().toLowerCase()));
      if(files.length>5||files.reduce((sum,f)=>sum+f.size,0)>50*1024*1024||bad){setFiles(state.selected);feedback(bad?'Choose an image, PDF, Word, or supported CAD file.':'Choose up to 5 files, totaling 50 MB or less.',true);update();return;}
      setFiles(files);feedback('');showFiles();
    });
    chat.addEventListener('click',e=>{
      if(e.target.closest('[data-ap-chat-attach]'))upload.click();
      const remove=e.target.closest('[data-chat-remove]');if(remove){setFiles(state.selected.filter((_,i)=>i!==Number(remove.dataset.chatRemove)));showFiles();}
      if(e.target.closest('[data-ap-chat-latest]')){const log=chat.querySelector('[data-ap-chat-log]');log.scrollTo({top:log.scrollHeight,behavior:'instant'});state.unseen.clear();chat.querySelector('[data-ap-chat-latest]').hidden=true;}
    });
    chat.querySelector('[data-ap-chat-log]').addEventListener('scroll',()=>{const log=chat.querySelector('[data-ap-chat-log]');if(log.scrollHeight-log.scrollTop-log.clientHeight<64){state.unseen.clear();chat.querySelector('[data-ap-chat-latest]').hidden=true;}});
    update();
  }
  const nonChatState = job => JSON.stringify({...job,messages:[],activity:(job.activity||[]).filter(a=>a.action!=='message')});
  function receiveSnapshot(ctx,snapshot) {
    if(!ctx.root.isConnected||contexts.get(ctx.root)!==ctx||Number(snapshot?.id)!==Number(ctx.job.id))return;
    syncChat(ctx,snapshot);chatConnection(ctx,false);
    if(older(snapshot,ctx.job)||older(snapshot,ctx.latest))return;
    if(ctx.chat)snapshot={...snapshot,messages:[...ctx.chat.messages.values()].sort(chatCompare),files:[...(snapshot.files||[]).filter(f=>!f.message_id),...ctx.chat.files.values()]};
    if(nonChatState(snapshot)===nonChatState(ctx.job)){
      ctx.job={...ctx.job,messages:snapshot.messages,files:snapshot.files,activity:snapshot.activity};return;
    }
    if(ctx.busy||dirty(ctx.root)){ctx.latest=snapshot;ctx.root.querySelector('[data-ap-update]').hidden=false;return;}
    ctx.job=snapshot;return paint(ctx);
  }
  async function sendChat(ctx,form) {
    const state=ctx.chat;if(ctx.busy||state.sending)return;
    const text=form.elements.body.value.trim(),files=[...state.selected];
    if(!state.pending&&!text&&!files.length){state.feedback('Write a message or attach a file.',true);return;}
    if(!state.pending&&(text.length>5000||!form.reportValidity())){state.feedback('Keep your message within 5,000 characters.',true);return;}
    // Keep a retry's exact payload and key, even if a newer draft is being composed.
    const attempt=state.pending||{key:uid(),body:text,files,draft:form.elements.body.value};state.pending=attempt;state.sending=true;ctx.busy=true;state.update();state.feedback('');
    let completed=false;
    try {
      let result;
      if(attempt.tried){
        const check=await request(`/${ctx.admin?'admin':'customer'}/appointment-products/${ctx.job.id}`);
        await receiveSnapshot(ctx,check.data);
        const saved=check.data.messages?.find(m=>m.client_request_key===attempt.key);
        if(saved)result={...check,message_id:saved.id};
      }
      if(!result){
        attempt.tried=true;const fd=new FormData();fd.append('body',attempt.body);fd.append('request_key',attempt.key);for(const file of attempt.files)fd.append('attachments[]',file);
        result=await request(`/${ctx.admin?'admin':'customer'}/appointment-products/${ctx.job.id}/messages`,{method:'POST',body:fd});
      }
      if(!result.message_id||!result.data?.messages?.some(m=>String(m.id)===String(result.message_id)))throw Error('The message could not be confirmed. Retry to check its status.');
      completed=true;state.pending=null;
      if(form.elements.body.value===attempt.draft)form.elements.body.value='';
      state.setFiles(state.selected.filter(f=>!attempt.files.includes(f)));state.showFiles();
      await receiveSnapshot(ctx,result.data);state.feedback('');
      const log=ctx.root.querySelector('[data-ap-chat-log]');if(ctx.tab===2&&log){log.scrollTop=log.scrollHeight;state.unseen.clear();ctx.root.querySelector('[data-ap-chat-latest]').hidden=true;}
    }catch(error){
      if(error.status&&error.status<500&&error.status!==408&&error.status!==429)state.pending=null;
      state.feedback(state.pending?'Message not confirmed. Retry checks before sending again.':error.message,true);
    }finally{
      state.sending=false;ctx.busy=false;state.update();
      if(completed&&ctx.tab===2&&form.contains(document.activeElement))form.elements.body.focus({preventScroll:true});
    }
  }
  // Instructions describe the reader's next step; workflow state stays server-owned.
  const nextAction = ({job,appointment,admin}) => {
    const order=job.orders[0];
    if(order&&!['cancelled','rejected'].includes(order.lifecycle_status)) {
      const progress=job.progress;
      if(admin) return ({
        completed:'This custom order is complete. Open Orders to review payment and fulfillment history.',
        payment_review:'Review the payment in Orders before collecting payment or starting production.',
        in_transit:'Follow automatic J&T delivery updates in Orders.',
        ready:order.fulfillment_type==='pickup'?'Record collection in Orders when the customer picks up the product.':'Record the J&T handover and waybill in Orders when the product is dispatched.',
        in_production:'Manage production in Orders. Mark the product ready when fabrication is complete.',
        awaiting_production:'Full payment is confirmed. Open Orders to start production.',
      })[progress] || 'Open Orders to verify full payment before starting production.';
      return ({
        completed:'Your custom order is complete. View your order for its payment and fulfillment history.',
        payment_review:'The FMRC team is checking your payment. Please wait before making another payment.',
        in_transit:'Follow automatic delivery updates in My Orders.',
        ready:order.fulfillment_type==='pickup'?'Your product is ready for pickup. View My Orders for collection details.':'Your product is ready for shipping. Follow the delivery updates in My Orders.',
        in_production:'The FMRC team is making your product. Follow its progress in My Orders.',
        awaiting_production:'Your full payment is confirmed. The FMRC team will start production next.',
      })[progress] || 'Complete full payment in My Orders before production begins.';
    }
    const quote=job.quotations.find(q=>['sent','closing'].includes(q.state));
    if(quote?.state==='closing') return admin?'Wait for payment reconciliation in Orders before revising the quotation or collecting payment.':'The FMRC team is verifying the previous checkout. Please wait before approving a replacement quotation.';
    if(quote?.state==='sent') {
      if(Date.parse(quote.expires_at)<=Date.now()) return admin?'This quotation has expired. Review the specifications before sending a new version.':'Your quotation has expired. Ask the FMRC team for an updated quotation in Conversation.';
      return admin?'The quotation has been sent. Await customer approval and full payment before production.':'Review the design, specifications and total, then approve your quotation and pay before it expires.';
    }
    if(['cancelled','declined'].includes(job.state)) return admin?'This custom request is closed. The appointment and product history remain available.':'This custom request is closed. Your appointment and product history remain available.';
    if(job.state==='awaiting_consultation') {
      const completed=String(appointment?.status).toLowerCase()==='completed';
      return admin?(completed?'Record the consultation outcome and agreed specifications before preparing a quotation.':'Review the customer’s brief and complete the consultation before preparing a quotation.'):(completed?'The FMRC team will review the agreed specifications and prepare the next step.':'Attend your consultation to discuss the product with the FMRC team before receiving a quotation.');
    }
    return (admin?{
      draft:'The customer has saved a draft. No appointment time is reserved.',
      follow_up:'Review the open questions and arrange a follow-up consultation with the customer.',
      needs_information:'Review the customer’s reply in Conversation and confirm any missing specifications.',
      ready_for_quote:'Finalize the agreed specifications and prepare the customer’s quotation.',
    }:{
      draft:'Finish your product details and choose an available appointment time.',
      follow_up:'Book a follow-up appointment to discuss the remaining details with the FMRC team.',
      needs_information:'Send the requested details in Conversation so the FMRC team can continue reviewing your product.',
      ready_for_quote:'The FMRC team is preparing your quotation from the agreed specifications.',
    })[job.state] || (admin?'Review the product details and record the next step for the customer.':'The FMRC team is reviewing your product details. Updates will appear here.');
  };
  const quotationHint = ctx => {
    if(ctx.admin&&ctx.job.discussed_at&&['ready_for_quote','quoted'].includes(ctx.job.state))return 'Prepare the quotation below using the agreed design, specifications and delivery details.';
    if(['needs_information','follow_up','cancelled','declined'].includes(ctx.job.state))return nextAction(ctx);
    return ctx.admin?'Confirm the attended consultation and save its outcome as “Ready to prepare quotation” in Overview. Sent versions will appear here.':'Your quotation will appear here after the FMRC team reviews the consultation and final specifications.';
  };

  const consultations = ctx => [ctx.appointment,...(ctx.job.follow_ups||[])]
    .filter((a,i,all)=>a?.id&&all.findIndex(b=>b.id===a.id)===i&&!['cancelled','archived'].includes(String(a.status).toLowerCase()));
  const nextOrderAction = order => {
    const a=order.custom_product?.available_actions||{};
    if(a.record_cash)return 'cash_receipt';
    if(order.payment_status==='pending')return 'payment';
    if(a.start_production)return 'start';
    if(a.mark_ready)return 'ready';
    if(a.collect)return 'collect';
    return order.custom_product?.production_status==='ready'&&(order.fulfillment_type||order.custom_product?.agreement?.fulfillment_type)==='delivery'?'handover':'summary';
  };
  const workflowChecklist = ctx => {
    const {job}=ctx, order=job.orders.find(o=>!['cancelled','rejected'].includes(o.lifecycle_status));
    const quote=job.quotations.find(q=>['sent','accepted','closing'].includes(q.state));
    const closed=!order&&['cancelled','declined'].includes(job.state);
    let current=1;
    if(job.discussed_at)current=2;
    if(quote?.state==='sent'&&Date.parse(quote.expires_at)>Date.now()||quote?.state==='closing')current=3;
    if(order)current=order.lifecycle_status==='completed'?7:order.payment_status!=='paid'?4:['ready','in_transit'].includes(job.progress)?6:5;
    if(closed)current=-1;
    const steps=['Review request','Confirm consultation','Prepare quotation','Await customer approval','Confirm payment','Prepare product','Complete pickup or delivery'];
    const action=order?`<a class="ap-btn" data-ap-open-order href="${esc(teamPage('orders')+'?order_id='+encodeURIComponent(order.id)+'&order_action='+nextOrderAction(order))}">Open order ${esc(order.order_no)}</a>`:
      closed?'':current<2?button('Confirm consultation','data-ap-go-outcome'):button(current===2?'Prepare quotation':'View quotation',`data-ap-go-quote="${current===2?'prepare':'view'}"`);
    return `<section class="ap-workflow" aria-label="Custom-product steps"><div class="ap-workflow-heading"><h4>Custom-product steps</h4><span class="ap-badge">${closed?'Request closed':current===7?'All steps complete':'Step '+(current+1)+' of 7'}</span></div><ol>${steps.map((label,i)=>`<li class="${i<current?'is-done':i===current?'is-current':''}" ${i===current?'aria-current="step"':''}><span class="ap-step-number" aria-hidden="true">${i<current?'✓':i+1}</span><span>${label}</span></li>`).join('')}</ol><div class="ap-next-action"><p>${esc(order?'Continue payment, production, or fulfillment in Orders.':closed?'Request history remains available.':current<2?'Save the attended consultation and customer summary.':current===2?'Confirm the design, price, and fulfillment details.':'The customer can review and approve the quotation.')}</p>${action}</div></section>`;
  };

  async function paint(ctx) {
    const {root,job,appointment,admin}=ctx;
    if(!root.isConnected)return;
    const openDetails=new Map([...root.querySelectorAll('details')].map(d=>[d.querySelector('summary')?.textContent,d.open]));
    const focused=root.contains(document.activeElement)?document.activeElement:null;
    const focusName=focused?.getAttribute('name'),focusKey=focused?.dataset.apFocusKey,focusTab=focused?.getAttribute('data-ap-tab'),focusForm=focused?.closest('[data-ap-form]')?.dataset.apForm;
    const selection=focused&&typeof focused.selectionStart==='number'?[focused.selectionStart,focused.selectionEnd]:null;
    const scrollHost=root.closest('.modal-body-scroll,.appointment-content'),scrollTop=scrollHost?.scrollTop;
    const conversation=ctx.chat?root.querySelector('[data-ap-pane="2"]:has([data-ap-chat])'):null;
    ctx.places?.dispose();

    const current=job.quotations.find(q=>['sent','accepted','closing'].includes(q.state));
    const order=job.orders[0], activeOrder=order&&!['cancelled','rejected'].includes(order.lifecycle_status);
    const editable=!activeOrder&&!['cancelled','declined','draft'].includes(job.state);
    root.innerHTML=`<header class="ap-head"><div><h3>${icon}Custom Product</h3><p>${esc(nextAction(ctx))}</p></div><span class="ap-badge">${esc(job.stage)}</span></header>
      <div class="ap-update" data-ap-update hidden><span>An update is available. Finish editing or review the latest details.</span>${button('Review update','data-ap-latest',true)}</div>
      ${admin?workflowChecklist(ctx):''}
      <div class="ap-tabs" role="tablist" aria-label="Custom product details">${['Overview','Quotation','Conversation'].map((t,i)=>button(t,`role="tab" id="ap-tab-${ctx.key}-${i}" aria-controls="ap-pane-${ctx.key}-${i}" tabindex="${ctx.tab===i?0:-1}" aria-selected="${ctx.tab===i}" data-ap-tab="${i}"`,ctx.tab!==i)).join('')}</div>
      <section role="tabpanel" id="ap-pane-${ctx.key}-0" aria-labelledby="ap-tab-${ctx.key}-0" data-ap-pane="0" ${ctx.tab!==0?'hidden':''}>${!admin&&job.state==='needs_information'?'<div class="ap-actions">'+button('Provide Details','data-ap-go-conversation')+'</div>':''}${!admin&&!activeOrder&&current?.state==='sent'?'<div class="ap-actions">'+button('Review Quotation','data-ap-go-quote')+'</div>':''}${customerSpecs(job.requirements,job.service_name)}${job.outcome_note?`<p><strong>FMRC update:</strong> ${esc(job.outcome_note)}</p>`:''}
        ${fileList(job.files)}${admin?linkedOrders(job):activeOrder?`<div class="ap-actions"><a class="ap-btn" href="${esc(link(admin?`/${location.pathname.includes('staff-page')?'staff-page':'admin-page'}/orders.html?order_id=${order.id}`:`/home-page/?orders=1&order_id=${order.id}`))}">${admin?'Open Order':order.payment_status==='pending'?'Continue Payment':'View Order'} ${esc(order.order_no)}</a></div>`:''}
        ${editable?`<details><summary>Update product details</summary><form data-ap-form="requirements">${briefFields(job.requirements,[{id:job.service_id,title:job.service_name}],'',false,admin)}<div class="ap-actions"><button class="ap-btn is-secondary" type="submit">Save Details</button></div></form></details>`:''}
        ${admin&&!activeOrder&&!['cancelled','declined'].includes(job.state)?`<details data-ap-outcome ${!job.discussed_at?'open':''}><summary>Confirm consultation</summary><p class="ap-help">Confirm the meeting and save its outcome here. Choose the consultation you attended.</p><form data-ap-form="outcome"><div class="ap-grid"><label class="ap-field"><span>Next step *</span><select name="outcome"><option value="ready_for_quote">Ready to prepare quotation</option><option value="needs_information">More information needed</option><option value="follow_up">Follow-up needed</option><option value="declined">Unable to fulfill</option></select></label><label class="ap-field"><span>Consultation *</span><select name="discussed_appointment_id" required>${consultations(ctx).map(a=>`<option value="${a.id}" ${a.id===appointment.id?'selected':''}>${esc(a.reference_no)}${a.status==='Completed'?' · Done':''}</option>`).join('')}</select></label>${field('note','Summary for the customer',job.outcome_note,'textarea',true,true)}<label class="ap-check"><input type="checkbox" name="discussion_confirmed"><span>I confirm that this consultation took place and the product requirements were discussed.</span></label><p class="ap-help" data-ap-outcome-help></p></div><div class="ap-actions"><button class="ap-btn is-secondary" type="submit">Confirm consultation and save</button></div></form></details>`:''}
        ${!admin&&job.state==='follow_up'?`<details open><summary>Book a follow-up</summary><form data-ap-form="follow-up"><div class="ap-grid">${field('appointment_date','Available date','','date',true)}<label class="ap-field"><span>Available time *</span><select name="appointment_time" required><option value="">Choose a date first</option></select></label><label class="ap-field"><span>Meeting method *</span><select name="appointment_method"><option value="face_to_face">Face-to-face at FMRC</option><option value="online">Online</option></select></label></div><div class="ap-actions"><button class="ap-btn" type="submit">Confirm Follow-up</button></div></form></details>`:''}
        ${editable?`<details><summary>Cancel custom request</summary><p class="ap-help">${admin?'This closes only the product request. The appointment history is retained. Manage paid-order cancellations and refunds in Orders.':'This closes only your product request. Your appointment history is retained. For a paid order, request cancellation or a refund through My Orders.'}</p><form data-ap-form="cancel">${field('note','Reason','','textarea',true,true)}<div class="ap-actions"><button class="ap-btn is-secondary" type="submit">Cancel Custom Request</button></div></form></details>`:''}
        <details><summary>Activity history</summary>${job.activity.map(a=>`<p>${esc(a.description)}<br><small>${esc(date(a.created_at))}</small></p>`).join('')||'<p>No updates yet.</p>'}</details>
      </section>
      <section role="tabpanel" id="ap-pane-${ctx.key}-1" aria-labelledby="ap-tab-${ctx.key}-1" data-ap-pane="1" ${ctx.tab!==1?'hidden':''}>
        ${job.quotations.length?job.quotations.map(q=>`<article class="ap-message" data-ap-quotation-record="${q.id}"><div class="ap-head"><div><h4>Quotation ${q.version}</h4><small>Sent ${esc(date(q.sent_at))} · Expires ${esc(date(q.expires_at))}</small></div><span class="ap-badge">${esc(q.state==='sent'&&Date.parse(q.expires_at)<=Date.now()?'Expired':({sent:'Awaiting approval',accepted:'Accepted',closing:'Checking payment',superseded:'Replaced',expired:'Expired'})[q.state]||q.state)}</span></div>
          ${specs(q.agreement.specifications,[],job.service_name)}<p><strong>Design proof:</strong> ${esc(q.agreement.design_notes)}</p>
          ${fileList(job.files.filter(f=>q.agreement.proof_file_ids.includes(f.id)),'No separate proof files. Refer to the design description above.')}
          <dl class="ap-summary"><div><dt>Unit price × quantity</dt><dd>${money(q.agreement.unit_price)} × ${q.agreement.specifications.quantity}</dd></div><div><dt>Product subtotal</dt><dd>${money(q.agreement.product_subtotal)}</dd></div><div><dt>Shipping</dt><dd>${money(q.agreement.shipping_fee)}</dd></div><div><dt>Total</dt><dd><strong>${money(q.agreement.total)}</strong></dd></div><div><dt>Production lead time</dt><dd>${esc(q.agreement.lead_time)}</dd></div><div><dt>Fulfillment</dt><dd>${q.agreement.fulfillment_type==='pickup'?'Pickup at FMRC':'J&T delivery'}${q.agreement.fulfillment_type==='delivery'?'<br>'+Object.values(q.agreement.delivery).map(esc).join(', '):''}</dd></div></dl>
          ${!admin&&q.state==='sent'&&Date.parse(q.expires_at)>Date.now()?`<form data-ap-form="accept" data-quote="${q.id}"><div data-ap-policy><p>Loading current transaction terms…</p></div><label class="ap-check ap-approval-check"><input type="checkbox" name="specifications_accepted" required><span>I approve this design, quantity, specifications, price, lead time, and pickup/delivery arrangement.</span></label><div class="ap-grid"><label class="ap-field"><span>Payment method *</span><select name="payment_method"><option value="online" ${job.online_payment_available===false?'disabled':''}>Pay online${job.online_payment_available===false?' (temporarily unavailable)':''}</option><option value="cash" ${job.online_payment_available===false?'selected':''}>Full advance cash payment at FMRC</option></select></label></div><div class="ap-actions"><button type="submit" class="ap-btn" disabled>Approve Quotation</button></div></form>`:''}
        </article>`).join(''):`<p class="ap-help">${esc(quotationHint(ctx))}</p>`}
        ${admin&&editable&&job.discussed_at&&['ready_for_quote','quoted'].includes(job.state)?`<details data-ap-quotation-editor ${!current?'open':''}><summary>${current?'Prepare revised quotation':'Prepare quotation'}</summary><p class="ap-help">Confirm the specifications, design proof, price, and pickup or delivery details before sending.</p><form data-ap-form="quotation">${preferences(job.requirements)}${briefFields(current?.agreement.specifications||job.requirements,[{id:job.service_id,title:job.service_name}],'spec_',true)}<fieldset class="ap-form-section"><legend>Design proof</legend><p class="ap-help">Describe the final design the customer will approve. Add its proof files below when available.</p><div class="ap-grid">${field('design_notes','Design confirmation',current?.agreement.design_notes,'textarea',true,true)}</div></fieldset><div class="ap-grid">${field('unit_price','Unit price (₱)',current?.agreement.unit_price,'number',true)}${field('shipping_fee','Shipping fee (₱)',current?.agreement.shipping_fee??0,'number',true)}${field('lead_time','Production lead time',current?.agreement.lead_time||'','text',true)}<label class="ap-field"><span>Pickup or delivery *</span><select name="fulfillment_type"><option value="pickup" ${current?.agreement.fulfillment_type!=='delivery'?'selected':''}>Pickup at FMRC</option><option value="delivery" ${current?.agreement.fulfillment_type==='delivery'?'selected':''}>J&T delivery</option></select></label></div>
          <fieldset class="ap-form-section" data-ap-delivery hidden><legend>Quoted delivery destination</legend><div class="ap-grid">${field('delivery_recipient_name','Recipient name',current?.agreement.delivery?.delivery_recipient_name,'text',true)}${field('delivery_contact_no','Contact number',current?.agreement.delivery?.delivery_contact_no,'tel',true)}${field('delivery_street','Street / building',current?.agreement.delivery?.delivery_street,'text',true,true)}${placeField('province','Province / Metro Manila',current?.agreement.delivery?.delivery_province,'ap-'+ctx.key+'-province')}${placeField('city','City / municipality',current?.agreement.delivery?.delivery_city,'ap-'+ctx.key+'-city')}${placeField('barangay','Barangay',current?.agreement.delivery?.delivery_barangay,'ap-'+ctx.key+'-barangay')}${field('delivery_postal_code','Postal code',current?.agreement.delivery?.delivery_postal_code,'text',true)}<label class="ap-check"><input type="checkbox" name="delivery_eligible"><span>FMRC confirmed that this product and destination are eligible for delivery at the quoted shipping fee.</span></label></div></fieldset>
          ${job.files.length?`<fieldset class="ap-form-section"><legend>Design proofs included in the quotation</legend><div class="ap-proof-options">${job.files.map(f=>`<label class="ap-check"><input type="checkbox" name="proof_file_ids" value="${f.id}"><span>${esc(f.name)}</span></label>`).join('')}</div></fieldset>`:''}<div class="ap-actions"><button type="submit" class="ap-btn">Send Quotation</button></div></form></details>`:''}
      </section>
      <section role="tabpanel" id="ap-pane-${ctx.key}-2" aria-labelledby="ap-tab-${ctx.key}-2" data-ap-pane="2" ${ctx.tab!==2?'hidden':''}>${chatMarkup(ctx)}</section>`;
    if(conversation){root.querySelector('[data-ap-pane="2"]').replaceWith(conversation);conversation.hidden=ctx.tab!==2;}
    root.querySelectorAll('details').forEach(d=>{const name=d.querySelector('summary')?.textContent;if(openDetails.has(name))d.open=openDetails.get(name);});
    for(const form of root.querySelectorAll('form:not([data-ap-form="messages"])')) { form.dataset.key=uid();for(const type of ['input','change'])form.addEventListener(type,()=>form.dataset.dirty='true');if(form.dataset.apForm==='requirements')form.elements.instructions?.addEventListener('input',()=>form.elements.instructions.setCustomValidity('')); }
    bindChat(ctx);syncChat(ctx);
    bindNumberFields(root);
    root.querySelectorAll('form').forEach(bindBriefFields);
    const quotationForm=root.querySelector('[data-ap-form="quotation"]');
    ctx.places=quotationForm?quotationPlaces(quotationForm,()=>!!ctx.busy):null;
    const serviceSelect=root.querySelector('[data-ap-form="requirements"] [name="service_id"]');
    if(serviceSelect){void refreshServices(ctx,serviceSelect);serviceSelect.onfocus=()=>void refreshServices(ctx,serviceSelect);}
    root.onclick=async event=>{
      const orderLink=event.target.closest('[data-ap-open-order],.ap-linked-orders a');
      if(orderLink){event.preventDefault();if(await allowLeave(root))location.href=orderLink.href;return;}
      if(event.target.closest('[data-ap-go-conversation]')){root.querySelector('[data-ap-tab="2"]').click();return;}
      if(event.target.closest('[data-ap-go-outcome]')){root.querySelector('[data-ap-tab="0"]').click();const section=root.querySelector('[data-ap-outcome]');if(section){section.open=true;revealSection(root,section.querySelector('summary'));}return;}
      const quotationAction=event.target.closest('[data-ap-go-quote]');if(quotationAction){revealQuotation(ctx,quotationAction.dataset.apGoQuote||'view');return;}
      const tab=event.target.closest('[data-ap-tab]');if(tab){ctx.tab=Number(tab.dataset.apTab);root.querySelectorAll('[data-ap-tab]').forEach(b=>{b.setAttribute('aria-selected',String(Number(b.dataset.apTab)===ctx.tab));b.tabIndex=Number(b.dataset.apTab)===ctx.tab?0:-1;b.classList.toggle('is-secondary',Number(b.dataset.apTab)!==ctx.tab);});root.querySelectorAll('[data-ap-pane]').forEach(p=>p.hidden=Number(p.dataset.apPane)!==ctx.tab);if(ctx.tab===2)openChat(ctx,true);return;}
      const file=event.target.closest('[data-ap-file]');if(file){file.disabled=true;try{await download(job.id,ctx.chat?.files.get(file.dataset.apFile)||ctx.job.files.find(f=>String(f.id)===file.dataset.apFile),admin);}catch(e){await popup(e.message,'File unavailable');}finally{file.disabled=false;}return;}
      if(event.target.closest('[data-ap-latest]')&&await allowLeave(root)){ctx.job=ctx.latest||ctx.job;ctx.latest=null;await paint(ctx);}
    };
    root.onkeydown=event=>{const tab=event.target.closest('[data-ap-tab]');if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?2:(Number(tab.dataset.apTab)+(event.key==='ArrowRight'?1:2))%3;const button=root.querySelector('[data-ap-tab="'+next+'"]');button.click();button.focus();};
    root.onsubmit=event=>{const form=event.target.closest('[data-ap-form]');if(form){event.preventDefault();void(form.dataset.apForm==='messages'?sendChat(ctx,form):submit(ctx,form));}};
    const outcomeForm=root.querySelector('[data-ap-form="outcome"]');
    const syncOutcome=()=>{if(!outcomeForm)return;const ready=outcomeForm.elements.outcome.value==='ready_for_quote';const checked=outcomeForm.elements.discussion_confirmed;checked.required=ready;outcomeForm.querySelector('[type=submit]').textContent=checked.checked?'Confirm consultation and save':'Save outcome';outcomeForm.querySelector('[data-ap-outcome-help]').textContent=checked.checked?'This consultation will be marked Done when you save.':ready?'Confirm that the consultation took place before preparing a quotation.':'Leave attendance unchecked if this update does not complete a consultation.';};
    if(outcomeForm){outcomeForm.addEventListener('change',syncOutcome);syncOutcome();}
    root.onchange=event=>{
      if(event.target.name==='fulfillment_type')ctx.places?.sync();
      if(event.target.name==='appointment_date')void followUpTimes(event.target.form);
    };
    for(const form of root.querySelectorAll('[data-ap-form="accept"]')) {
      try {const policy=(await request('/commerce/policy')).data;if(!policy)throw Error('Transaction terms are not yet published. Contact the FMRC team before ordering.');
        form.dataset.policy=policy.version;form.querySelector('[data-ap-policy]').innerHTML=`<section class="ap-policy-card"><div class="ap-policy-heading"><span class="ap-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m12 3 8 4v6c0 5-8 9-8 9s-8-4-8-9V7l8-4Z"/><path d="m8 12 3 3 5-6"/></svg></span><div><h4>Terms and approval</h4><p>Review the terms and refund policy before approving this quotation.</p></div></div><div class="ap-policy-documents"><details><summary>Transaction Terms</summary><div class="ap-terms">${esc(policy.terms_text)}</div></details><details><summary>Refund Policy</summary><div class="ap-terms">${esc(policy.refund_text)}</div></details></div><label class="ap-check ap-approval-check"><input type="checkbox" name="policy_accepted" required><span>I accept the Transaction Terms and Refund Policy.</span></label></section>`;
        form.querySelector('[type=submit]').disabled=false;
      }catch(e){form.querySelector('[data-ap-policy]').textContent=e.message;}
    }
    if(focused){const replacement=[...root.querySelectorAll('input,textarea,select,button')].find(node=>focusKey?node.dataset.apFocusKey===focusKey&&node.closest('[data-ap-form]')?.dataset.apForm===focusForm:focusName?node.getAttribute('name')===focusName&&node.closest('[data-ap-form]')?.dataset.apForm===focusForm:focusTab!==null&&focusTab!==undefined?node.getAttribute('data-ap-tab')===focusTab:node.textContent===focused.textContent);const target=replacement||root.querySelector('[data-ap-tab][aria-selected=true]');target?.focus({preventScroll:true});if(selection&&replacement?.setSelectionRange)replacement.setSelectionRange(...selection);}
    if(ctx.tab===2)openChat(ctx);
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
    if(ctx.busy)return;
    if(form.dataset.apForm==='quotation'&&ctx.places&&!ctx.places.validate())return;
    if(['requirements','quotation'].includes(form.dataset.apForm)&&(!validateCustomerNotes(form,form.dataset.apForm==='quotation'?'spec_':'')||!validateBriefFields(form)))return;
    if(!form.reportValidity())return;
    const action=form.dataset.apForm;
    ctx.busy=true;
    if(action==='requirements'&&Number(form.elements.service_id.value)!==Number(ctx.job.service_id)&&!await confirm('Change the fabrication service? FMRC must review the new requirements before quoting. Any unpaid quotation will be withdrawn; the appointment schedule and history stay the same.','Change service')){ctx.busy=false;return;}
    if(['quotation','accept','cancel','follow-up'].includes(action)&&!await confirm(action==='accept'?'Approve this exact quotation and create its payment order?':action==='quotation'?'Send this quotation to the customer? It will remain valid for seven days.':action==='cancel'?(ctx.admin?'Cancel this custom-product request? The appointment will remain.':'Cancel your custom-product request? Your appointment will remain.'):'Book this follow-up appointment?')){ctx.busy=false;return;}
    ctx.busy=true;const submit=form.querySelector('[type=submit]');submit.disabled=true;
    try {
      const values=Object.fromEntries(new FormData(form));let body={...values,expected_revision:ctx.job.revision,request_key:form.dataset.key};let method='POST';
      if(action==='requirements'){body={requirements:requirements(form),expected_revision:ctx.job.revision};method='PUT';}
      if(action==='outcome'){
        body.discussion_confirmed=!!form.elements.discussion_confirmed.checked;
        body.complete_consultation=body.discussion_confirmed;
        const meeting=consultations(ctx).find(a=>String(a.id)===String(values.discussed_appointment_id));
        if(body.complete_consultation)body.expected_schedule_version=meeting?.schedule_version??0;
      }
      if(action==='quotation'){body.specifications=requirements(form,'spec_');body.specifications.needs_advice=false;body.proof_file_ids=[...form.querySelectorAll('[name=proof_file_ids]:checked')].map(x=>Number(x.value));body.delivery_eligible=!!form.elements.delivery_eligible.checked;
        body.delivery=Object.fromEntries(Object.entries(values).filter(([k])=>k.startsWith('delivery_')&&k!=='delivery_eligible'));}
      if(action==='accept'){body.specifications_accepted=form.elements.specifications_accepted.checked;body.policy_accepted=form.elements.policy_accepted.checked;body.policy_version=form.dataset.policy;}
      const suffix=action==='accept'?`quotations/${form.dataset.quote}/accept`:action==='quotation'?'quotations':action;
      const result=await request(`/${ctx.admin?'admin':'customer'}/appointment-products/${ctx.job.id}/${suffix}`,{method,body:body instanceof FormData?body:JSON.stringify(body)});
      if(action==='outcome'&&(!result.data||result.data.state!==values.outcome||Number(result.data.revision)<=Number(body.expected_revision)||(values.outcome==='ready_for_quote'&&!result.data.discussed_at)))throw Error('The consultation outcome could not be confirmed. Your entries are still here. Use Refresh to check the saved status before trying again.');
      if(action==='outcome'&&values.outcome==='ready_for_quote')ctx.tab=1;
      if(result.appointment?.id===ctx.appointment.id)ctx.appointment=result.appointment;
      ctx.job=result.data;ctx.latest=null;await paint(ctx);rootFocus(ctx.root);window.dispatchEvent(new CustomEvent('fmrc:custom-product-updated',{detail:{job:result.data}}));
      if(result.appointment)window.dispatchEvent(new CustomEvent('fmrc:appointment-updated',{detail:{appointment:result.appointment}}));
      if(action==='outcome'&&values.outcome==='ready_for_quote')revealQuotation(ctx,'prepare');
      if(ctx.admin&&action==='outcome')window.showAdminSuccessNotification?.('Consultation outcome saved.',{title:'Saved'});else await popup(result.message||'Changes saved.','Saved');
      if(result.order_id)location.href=link('/home-page/?orders=1&order_id='+result.order_id);
    }catch(e){await popup(e.message,'Action not completed');form.querySelector('input,textarea,select')?.focus();}
    finally{ctx.busy=false;if(submit.isConnected)submit.disabled=false;ctx.places?.sync();}
  }
  function poll(ctx) {
    clearTimeout(ctx.timer);ctx.timer=setTimeout(async()=>{
      if(!ctx.root.isConnected){ctx.places?.dispose();contexts.delete(ctx.root);return;}
      if(document.hidden||!ctx.root.getClientRects().length||ctx.busy){poll(ctx);return;}
      const before=ctx.job;
      try{const result=await request(`/${ctx.admin?'admin':'customer'}/appointment-products/${ctx.job.id}`);ctx.failures=0;
        if(!ctx.root.isConnected||contexts.get(ctx.root)!==ctx)return;
        if(ctx.busy||ctx.job!==before||older(result.data,ctx.job)||older(result.data,ctx.latest)){poll(ctx);return;}
        await receiveSnapshot(ctx,result.data);
      }catch{ctx.failures=Math.min(3,(ctx.failures||0)+1);chatConnection(ctx,true);}poll(ctx);
    },Math.min(30000,5000*2**(ctx.failures||0)));
  }
  function mount(root,job,appointment,admin) {
    if(!root||!job)return;root.classList.add('ap-panel');root.dataset.apJob=job.id;if(job.unavailable){root.innerHTML='<h3>'+icon+'Custom Product</h3><p>Custom-product details are temporarily unavailable. '+(admin?'The appointment is unchanged.':'Your appointment is unchanged.')+' Use Refresh to try again.</p>';return;}
    const old=contexts.get(root);
    if(old&&old.job.id===job.id){
      old.appointment=appointment;
      if(older(job,old.job)||older(job,old.latest))return;
      if(JSON.stringify(old.job)===JSON.stringify(job))return;
      return receiveSnapshot(old,job);
    }
    if(old){clearTimeout(old.timer);old.places?.dispose();}
    const ctx={root,job,appointment,admin,key:old?.key||uid(),tab:old?.tab||((job.quotations||[]).some(q=>q.state==='sent')&&!admin?1:0)};contexts.set(root,ctx);const ready=paint(ctx);poll(ctx);return ready;
  }
  async function mountCustomer(host,appointment) {
    let root=host.querySelector('[data-ap-appointment]');if(!root){root=document.createElement('section');root.dataset.apAppointment='';const overview=host.querySelector('.appointment-overview');if(overview)overview.after(root);else host.append(root);}
    if(appointment.custom_product){root.closest('.appointment-modal')?.classList.add('has-custom-product');return mount(root,appointment.custom_product,appointment,false);}
    root.closest('.appointment-modal')?.classList.remove('has-custom-product');if(!appointment.custom_products_available){root.remove();return;}
    root.className='ap-panel';root.innerHTML=`<div class="ap-head"><div><h3>${icon}Have a custom-product idea?</h3><p>Add a request to discuss with the FMRC team. Your appointment schedule stays the same.</p></div></div>${button('Request a Custom Product','data-ap-opt-in',true)}`;
    root.querySelector('[data-ap-opt-in]').onclick=async()=>{try{const available=await loadAvailability();if(!available.services.length)return popup('The FMRC team is not accepting new custom-product consultations at the moment. Your appointment is unchanged.');root.innerHTML=`<h3>Custom Product</h3><form>${briefFields(customerRequest({instructions:appointment.additional_notes||'',customer_notes_version:1}),available.services)}<div class="ap-actions"><button type="submit" class="ap-btn">Add to Appointment</button></div></form>`;
      const form=root.querySelector('form');bindBriefFields(form);form.oninput=e=>{form.dataset.dirty='true';if(e.target.name==='instructions')e.target.setCustomValidity('');};let busy=false;const key=uid();form.onsubmit=async e=>{e.preventDefault();if(busy||!validateCustomerNotes(form)||!validateBriefFields(form)||!form.reportValidity())return;busy=true;form.querySelector('[type=submit]').disabled=true;try{const result=await request(`/customer/appointments/${appointment.id}/product`,{method:'POST',body:JSON.stringify({requirements:requirements(form),request_key:key})});form.dataset.dirty='false';mount(root,result.data,appointment,false);window.dispatchEvent(new CustomEvent('fmrc:custom-product-updated',{detail:{job:result.data}}));}catch(error){await popup(error.message);}finally{busy=false;if(form.isConnected)form.querySelector('[type=submit]').disabled=false;}};
    }catch(e){await popup(e.message);}};
  }

  // Booking fields remain owned by the existing five-step form.
  const bookingIds=['aptLName','aptFName','aptMI','aptPhone','aptEmail','aptRole','aptRoleOther','aptCountry','aptRegion','aptProvince','aptMunicipality','aptAddress','aptIntlAddress','aptMethod','aptPurpose','aptDesc'];
  const bookingValues=()=>({...Object.fromEntries(bookingIds.map(id=>[id,document.getElementById(id)?.value||''])),custom_measurements:document.querySelector('#aptCustomFields [data-ap-measurements]')?.apMeasurements?.state()});
  const selected=()=>!!document.getElementById('aptCustomProduct')?.checked;
  const bookingPurpose=()=>document.querySelector('#aptCustomFields [name="service_id"]')?.selectedOptions[0]?.textContent.trim()||'';
  function syncBookingFields() {
    const active=selected(),purpose=document.getElementById('aptPurpose');
    if(purpose){purpose.disabled=active;purpose.closest('.apt-input-group').hidden=active;}
    const client=document.getElementById('aptClientTypeField');if(client)client.style.gridColumn=active?'span 3':'';
    const save=document.getElementById('aptSaveCustomDraft');if(save)save.hidden=!active;
    const brief=document.querySelector('[data-ap-brief]');if(brief)brief.hidden=!active;
    window.dispatchEvent(new Event('fmrc:appointment-required'));
  }
  // Older drafts may hold different notes in each field. Keep every distinct block.
  const mergeBookingNotes=(...values)=>values.map(v=>String(v||'').trim()).filter(Boolean).reduce((parts,note)=>{
    if(parts.some(part=>('\n\n'+part+'\n\n').includes('\n\n'+note+'\n\n')))return parts;
    return [...parts.filter(part=>!('\n\n'+note+'\n\n').includes('\n\n'+part+'\n\n')),note];
  },[]).join('\n\n');
  function customerRequest(data={},...legacyNotes){return {...data,instructions:Number(data.customer_notes_version)>=1?String(data.instructions||''):mergeBookingNotes(...legacyNotes,data.instructions,data.personalization),customer_notes_version:1};}
  function validateCustomerNotes(form,prefix=''){const notes=form?.id==='aptCustomFields'?document.getElementById('aptDesc'):form?.elements[prefix+'instructions'];if(!notes)return true;const valid=notes.value.trim().length<=2000;notes.setCustomValidity(valid?'':'Additional notes must not exceed 2,000 characters. Review the combined notes before continuing.');if(!valid){notes.focus();notes.reportValidity();}return valid;}
  function validateBookingNotes() {
    const notes=document.getElementById('aptDesc');if(!notes)return true;
    const valid=notes.value.trim().length<=2000;
    notes.setCustomValidity(valid?'':'Additional notes must not exceed 2,000 characters. Review the combined notes before continuing.');
    if(!valid){notes.focus();notes.reportValidity();}return valid;
  }
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
    if(!validateBookingNotes())return;
    const snapshot=()=>JSON.stringify({requirements:requirements(form),booking:bookingValues(),files:(window.FMRCAppointmentBooking?.files()||[]).map(fileKey)}),savedSnapshot=snapshot();
    draftBusy=true;const btn=document.getElementById('aptSaveCustomDraft');btn.disabled=true;
    try{const fd=new FormData();fd.append('requirements',JSON.stringify(requirements(form)));fd.append('booking',JSON.stringify(bookingValues()));fd.append('request_key',bookingKey);
      if(bookingDraft){fd.append('draft_id',bookingDraft.id);fd.append('expected_revision',bookingDraft.revision);}
      const files=window.FMRCAppointmentBooking?.files()||[];for(const f of newFiles(files))fd.append('attachments[]',f);
      const result=await request('/customer/appointment-products/drafts',{method:'POST',body:fd});bookingDraft=result.data;files.filter(f=>(bookingDraft.files||[]).some(saved=>saved.name===f.name&&Number(saved.size)===f.size)).forEach(f=>uploaded.add(fileKey(f)));showSavedFiles();if(snapshot()===savedSnapshot)form.dataset.dirty='false';await popup(result.message,'Draft saved');
    }catch(e){await popup(e.message,'Draft not saved');
      if(e.status===409&&bookingDraft)void request('/customer/appointment-products/'+bookingDraft.id).then(latest=>{
        const host=document.querySelector('[data-ap-saved-files]');let notice=host.querySelector('[data-ap-draft-conflict]');if(!notice){notice=document.createElement('details');notice.dataset.apDraftConflict='';host.prepend(notice);}
        notice.innerHTML='<summary>Review the saved draft update</summary><p class="ap-help">Another session changed this draft. Compare it with your entries before saving. Your current entries stay in the form.</p>'+customerSpecs(latest.data.requirements,latest.data.service_name)+button('Keep My Entries','data-ap-keep-draft',true);
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
    const custom=customerRequest(data.custom||bookingDraft?.requirements||{},data.booking?.aptDesc);bookingFinish=custom.finish||'';
    const notes=document.getElementById('aptDesc');if(notes){notes.value=custom.instructions;notes.setCustomValidity('');}
    const checkbox=document.getElementById('aptCustomProduct');if(checkbox){checkbox.checked=true;document.getElementById('aptCustomFields').innerHTML=briefFields(custom,availability.services,'',false,false,true);bindBriefFields(document.getElementById('aptCustomFields'));document.querySelector('#aptCustomFields [data-ap-measurements]')?.apMeasurements.restore(data.booking?.custom_measurements);syncBookingFields();}
    showSavedFiles();
  }
  async function bookingInit() {
    const anchor=document.getElementById('aptDesc')?.closest('.apt-input-group');if(!anchor)return;
    try{const available=await loadAvailability();if(!available.enabled)return;
      const section=document.createElement('section');section.className='ap-panel ap-booking';section.innerHTML=`<label class="ap-check"><input type="checkbox" id="aptCustomProduct" ${available.services.length?'':'disabled'}><span>Request a custom product<small style="display:block">Discuss your idea with FMRC and receive a quotation after your consultation.</small></span></label>${!available.services.length?'<p class="ap-help">The FMRC team is not accepting new custom-product consultations right now. You can still book an ordinary appointment.</p>':''}<div data-ap-brief hidden><form id="aptCustomFields">${briefFields({},available.services,'',false,false,true)}</form><p class="ap-help">Use Design Files to attach private designs and Additional notes for other instructions. Booking does not commit you to an order.</p><div data-ap-saved-files></div>${!token()?button('Sign In & Keep Details','data-ap-sign-in',true):''}</div>`;
      anchor.before(section);bindBriefFields(section.querySelector('form'));section.querySelector('form').oninput=e=>e.currentTarget.dataset.dirty='true';const checkbox=section.querySelector('input');checkbox.onchange=syncBookingFields;
      document.getElementById('aptDesc')?.addEventListener('input',()=>{document.getElementById('aptDesc').setCustomValidity('');if(selected())section.querySelector('form').dataset.dirty='true';});
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
  function mountOrder(host,order,admin=team) {
    if(!host)return;let box=host.querySelector('[data-ap-order]');if(order.order_type!=='custom'){box?.remove();return;}
    if(box&&box.dataset.orderId!==String(order.id)){box.remove();box=null;}
    const snapshot=JSON.stringify({id:order.id,order_no:order.order_no,payment_status:order.payment_status,payment_method:order.payment_method,lifecycle_status:order.lifecycle_status,fulfillment_type:order.fulfillment_type,custom_product:order.custom_product});
    if(box&&(dirty(box)||box.getAttribute('aria-busy')==='true'))return;if(box?.dataset.snapshot===snapshot)return;if(!box){box=document.createElement('section');box.dataset.apOrder='';box.className='ap-panel';host.prepend(box);}
    const opened=new Map([...box.querySelectorAll('details')].map(d=>[d.querySelector('summary')?.textContent,d.open]));
    const focused=box.contains(document.activeElement)?document.activeElement?.name:null;
    box.dataset.orderId=String(order.id);box.dataset.snapshot=snapshot;
    const c=order.custom_product;if(!c||c.unavailable){box.textContent='Custom-product details are temporarily unavailable. Please try again.';return;}
    const actions=c.available_actions||{},g=c.agreement;const path=admin?`/${location.pathname.includes('staff-page')?'staff-page':'admin-page'}/appointments.html?appointment_id=${c.appointment_id}`:`/home-page/?my_appointments=1&appointment_id=${c.appointment_id}`;
    const role=window.AdminSession?.getUserInfo?.()?.role || (window.AdminSession?.isStaff||location.pathname.includes('staff-page')?'staff':'admin');
    box.innerHTML=`<header class="ap-head"><div><h3>${icon}Custom Product</h3><p>Appointment ${esc(c.appointment_reference)} · Order ${esc(order.order_no||order.id)}</p><p>${esc(c.service)} · Quotation ${c.quotation_version}</p></div><span class="ap-badge">${esc(c.stage)}</span></header><div class="ap-record-links"><a class="ap-btn is-secondary" href="${esc(link(path))}">Open appointment ${esc(c.appointment_reference)}</a></div>${admin?orderMeeting(c.meeting):''}${c.collection_pending?`<p class="ap-help">${admin?'The previous payment is being reconciled. Wait for confirmed checkout expiry before collecting another payment.':'The FMRC team is verifying the previous payment. Please wait before changing payment method or paying again.'}</p>`:''}<details><summary>Approved design and specifications</summary>${specs(g.specifications,[],c.service)}<p>${esc(g.design_notes)}</p><p><strong>Lead time:</strong> ${esc(g.lead_time)}</p><p><strong>Agreed total:</strong> ${money(g.total)} · shipping ${money(g.shipping_fee)}</p></details>
      ${admin?`<div class="ap-actions">${actions.start_production?button('Start production','data-ap-production="start"'):''}${actions.mark_ready?button(order.fulfillment_type==='pickup'?'Mark ready for pickup':'Mark ready for shipping','data-ap-production="ready"'):''}</div>
      ${actions.record_cash?`<form data-ap-order-form="cash_receipt"><h4>Record cash payment</h4><p class="ap-help">Receive the full quoted amount at FMRC before starting production.</p><div class="ap-grid">${field('amount','Amount to receive (₱)',money(g.total),'text').replace('<input ','<input disabled readonly ')}${field('receipt_reference','Receipt reference','','text',true)}<label class="ap-check"><input type="checkbox" name="confirmed_received" required><span>I received the full quoted amount in cash.</span></label></div><div class="ap-actions"><button class="ap-btn" type="submit">Record cash payment</button></div></form>`:''}
      ${actions.collect?`<form data-ap-order-form="collect"><h4>Confirm pickup</h4><p class="ap-help">Check the customer’s pickup code before handing over the product.</p><div class="ap-grid">${field('pickup_code','Customer pickup code','','text',true)}</div><div class="ap-actions"><button class="ap-btn" type="submit">Confirm pickup</button></div></form>`:''}
      ${role==='admin'&&(actions.correct_cash||actions.refund_cash)?`<details><summary>${['cancelled','rejected'].includes(order.lifecycle_status)?'Record released cash refund':'Correct a mistaken cash receipt'}</summary><form data-ap-order-form="${['cancelled','rejected'].includes(order.lifecycle_status)?'cash_refund':'cash_reverse'}"><div class="ap-grid">${field('amount','Amount (₱)',c.cash_balance_centavos/100,'text',true)}${field('receipt_reference','Receipt / refund reference','','text',true)}${field('note','Reason','','textarea',true,true)}<label class="ap-check"><input type="checkbox" name="refund_released" required><span>I confirm this correction, or that the refund has actually been returned to the customer.</span></label></div><div class="ap-actions"><button class="ap-btn" type="submit">Confirm</button></div></form></details>`:''}`:
      order.payment_status==='pending'&&!['cancelled','rejected','completed'].includes(order.lifecycle_status)?`<p class="ap-help">${order.payment_method==='Cash at FMRC'?'Pay the full amount at FMRC. The team will record your receipt before production begins.':'Use the existing online payment action below to pay securely.'}</p><div class="ap-actions">${button(order.payment_method==='Cash at FMRC'?'Use Online Payment':'Pay at FMRC','data-ap-switch-payment'+(order.payment_method==='Cash at FMRC'&&c.online_payment_available===false?' disabled title="Online checkout is temporarily unavailable."':''),true)}</div>`:''}
      ${c.cash_entries.length?`<details><summary>Cash receipt history</summary>${c.cash_entries.map(e=>`<p>${esc(e.kind)} · ${money(e.amount_centavos/100)} · ${esc(e.receipt_reference)}<br><small>${esc(date(e.confirmed_at))}</small></p>`).join('')}</details>`:''}`;
    let busy=false;const perform=async(action,form)=>{if(busy||orderActionLocks.has(String(order.id))||form&&!form.reportValidity())return;busy=true;orderActionLocks.add(String(order.id));box.setAttribute('aria-busy','true');if(!await confirm(action==='start'?'Start production of the approved, fully paid custom product?':'Confirm this order action?')){busy=false;orderActionLocks.delete(String(order.id));box.removeAttribute('aria-busy');return;}const buttons=[...box.querySelectorAll('button:not(:disabled)')];buttons.forEach(b=>b.disabled=true);box.setAttribute('aria-busy','true');const values=form?Object.fromEntries(new FormData(form)):{};if(action==='cash_receipt')values.amount=g.total;if(form){values.confirmed_received=!!form.elements.confirmed_received?.checked;values.refund_released=!!form.elements.refund_released?.checked;form.dataset.key ||= uid();}
      try{const result=await request(`/admin/orders/${order.id}/custom-product`,{method:'POST',body:JSON.stringify({...values,action,expected_revision:c.revision,request_key:form?.dataset.key||uid()})});box.querySelectorAll('form').forEach(f=>f.dataset.dirty='false');box.removeAttribute('aria-busy');if(box.isConnected&&host.querySelector('[data-ap-order]')===box)mountOrder(host,result.data,true);window.dispatchEvent(new CustomEvent('fmrc:custom-order-updated',{detail:{order:result.data}}));await popup('Order updated.','Saved');}
      catch(e){await popup(e.message,'Action not completed');}finally{busy=false;orderActionLocks.delete(String(order.id));box.removeAttribute('aria-busy');buttons.forEach(b=>{if(b.isConnected)b.disabled=false;});}};
    box.querySelectorAll('details').forEach(d=>{const name=d.querySelector('summary')?.textContent;if(opened.has(name))d.open=opened.get(name);});
    box.querySelectorAll('input,textarea,select').forEach((input,i)=>{input.id='ap-order-'+(host.id||host.closest('[id]')?.id||'record')+'-'+order.id+'-'+i;});
    if(focused)[...box.querySelectorAll('[name]')].find(n=>n.name===focused)?.focus({preventScroll:true});
    if(admin&&c.meeting)mountMeetingRemoval(box.querySelector('[data-order-meeting]'),{...c.meeting,id:c.appointment_id,reference_no:c.appointment_reference});
    box.oninput=box.onchange=e=>{const f=e.target.closest('form');if(f)f.dataset.dirty='true';};box.onsubmit=e=>{const f=e.target.closest('[data-ap-order-form]');if(f){e.preventDefault();void perform(f.dataset.apOrderForm,f);}};
    box.onclick=async e=>{const b=e.target.closest('[data-ap-production]');if(b)void perform(b.dataset.apProduction);
      if(e.target.closest('[data-ap-switch-payment]')){if(busy||!await confirm('Change payment method? FMRC must first confirm that the previous checkout cannot receive payment.'))return;busy=true;
        try{await request(`/customer/orders/${order.id}/custom-payment-method`,{method:'POST',body:JSON.stringify({payment_method:order.payment_method==='Cash at FMRC'?'online':'cash',expected_revision:c.revision})});location.reload();}catch(error){await popup(error.message);}finally{busy=false;}}
    };
  }
  window.FMRCAppointmentProducts={mountCustomer,mountAdmin:(host,a)=>{if(!a.custom_product){host?.closest('.appointment-view-modal')?.classList.remove('has-custom-product');return;}let root=host.querySelector('[data-ap-appointment]');if(!root){root=document.createElement('section');root.dataset.apAppointment='';const summary=host.querySelector('.appt-view-header-row');if(summary)summary.after(root);else host.append(root);}host.closest('.appointment-view-modal')?.classList.add('has-custom-product');mount(root,a.custom_product,a,true);},mountOrder,orderBusy:id=>orderActionLocks.has(String(id)),mountMeetingRemoval,draftList,allowLeave,isDirty:dirty,append,newFiles,selected,bookingPurpose,isSigningIn:()=>signingIn,
    validate:async()=>{if(!selected())return true;const form=document.getElementById('aptCustomFields');if(!token()){await popup('Sign in using the button in the Custom Product section. Your entered appointment details will be kept.','Sign in required');return false;}return validateBriefFields(form)&&form.reportValidity()&&validateBookingNotes();},
    review:step=>{let summary=document.querySelector('[data-ap-booking-review]');if(!selected()){summary?.remove();return;}const host=document.querySelector('#aptStep'+step+' .ticket-body');if(!host)return;if(!summary||!host.contains(summary)){summary?.remove();summary=document.createElement('section');summary.className='ap-panel';summary.dataset.apBookingReview='';host.append(summary);}summary.innerHTML='<h3>Custom Product Consultation</h3><p class="ap-help">The FMRC team will discuss this idea during your consultation. A quotation follows once the specifications are agreed.</p>'+customerSpecs(requirements(document.getElementById('aptCustomFields')),bookingPurpose(),['Additional notes (optional)']);},
    reset:()=>{bookingDraft=null;bookingKey=uid();bookingFinish='';uploaded.clear();document.getElementById('aptDesc')?.setCustomValidity('');document.getElementById('aptCustomFields')?.reset();document.querySelector('[data-ap-saved-files]')?.replaceChildren();document.querySelector('[data-ap-booking-review]')?.remove();const c=document.getElementById('aptCustomProduct');if(c){c.checked=false;c.dispatchEvent(new Event('change'));}},
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
