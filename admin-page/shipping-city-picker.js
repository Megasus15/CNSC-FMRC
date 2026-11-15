/* Province-linked, required coverage choices. Existing cities[] payloads stay intact. */
(() => {
  'use strict';
  const key = value => String(value || '').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-PH');
  const escape = value => String(value ?? '').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const values = input => {
    try {const parsed=JSON.parse(input.value);if(Array.isArray(parsed)&&parsed.every(value=>typeof value==='string'))return parsed;}
    catch { /* Accept older field integrations that still provide comma-separated values. */ }
    return input.value.split(',').map(value=>value.trim()).filter(Boolean);
  };
  window.FMRCShippingCities = Object.freeze({create({root,api,provinceFor,onStateChange}) {
    const states = new Map(), catalogues = new Map();
    const notify = () => onStateChange?.();
    const summary = state => state.scope === 'all' ? 'All cities and municipalities'
      : state.selected.length === 1 ? state.selected[0] : state.selected.length ? `${state.selected.length} locations selected` : '';
    const catalogue = state => catalogues.get(provinceFor(state.province)?.code);
    const issueFor = state => {
      if (!state.element?.isConnected || !state.province) return null;
      const selected = values(state.storage), data = catalogue(state);
      let message = '';
      if (!selected.length && state.scope !== 'all') message = 'Choose cities or municipalities, or select province-wide coverage.';
      else if (selected.length && data?.status !== 'ready') message = data?.status === 'loading' ? 'Wait for the city and municipality list to finish loading.' : 'Reload the city and municipality list before saving this area.';
      else if (selected.length > 200) message = 'Select up to 200 cities or municipalities for one area.';
      else if (selected.some(value=>!data?.items.some(item=>key(item.name)===key(value)))) message = 'Choose listed locations that belong to the selected province.';
      return message ? {message,field:state.storage} : null;
    };
    const close = state => {
      state.element.classList.remove('open');state.list.hidden=true;
      state.input.setAttribute('aria-expanded','false');state.input.removeAttribute('aria-activedescendant');
      state.input.value=summary(state);state.active=-1;
    };
    const activate = (state,index) => {
      const options=[...state.list.querySelectorAll('[role="option"]')];
      state.active=options.length&&index>=0?(index+options.length)%options.length:-1;
      options.forEach((node,i)=>node.classList.toggle('combobox-active',i===state.active));
      if(state.active<0)state.input.removeAttribute('aria-activedescendant');
      else {state.input.setAttribute('aria-activedescendant',options[state.active].id);options[state.active].scrollIntoView({block:'nearest'});}
    };
    const options = (state,query='',highlight=false) => {
      const fragment=document.createDocumentFragment(),data=catalogue(state);
      const add=(name,code,selected)=>{
        const li=document.createElement('li');li.id=state.input.id+'-'+code;li.setAttribute('role','option');li.tabIndex=-1;li.dataset.cityCode=code;li.setAttribute('aria-selected',String(selected));
        const check=document.createElement('span');check.className='shipping-city-option-check';check.setAttribute('aria-hidden','true');check.textContent=selected?'✓':'';
        const label=document.createElement('span');label.textContent=name;li.append(check,label);fragment.append(li);
      };
      add('All cities and municipalities','all',state.scope==='all');
      const matches=(data?.items||[]).filter(item=>key(item.name).includes(key(query)));
      matches.forEach(item=>add(item.name,item.code,state.scope!=='all'&&state.selected.some(name=>key(name)===key(item.name))));
      if(!matches.length){const li=document.createElement('li');li.className='combobox-no-results';li.setAttribute('role','presentation');li.textContent=data?.status==='loading'?'Loading locations…':data?.status==='error'?'Locations are unavailable. Use Retry below.':'No matching locations.';fragment.append(li);}
      state.list.replaceChildren(fragment);activate(state,highlight?0:-1);
    };
    const render = state => {
      if(!state.element?.isConnected)return;
      const province=provinceFor(state.province),data=catalogue(state),open=state.element.classList.contains('open');
      state.input.disabled=!province;state.element.querySelector('[data-city-toggle]').disabled=!province;
      state.input.setAttribute('aria-required','true');
      if(!open)state.input.value=summary(state);
      const chips=state.element.querySelector('[data-city-chips]');chips.replaceChildren();
      if(state.scope!=='all')state.selected.forEach(name=>{
        const chip=document.createElement('span');chip.className='shipping-city-chip';
        const label=document.createElement('span');label.textContent=name;
        const remove=document.createElement('button');remove.type='button';remove.dataset.cityRemove=name;remove.setAttribute('aria-label','Remove '+name);remove.textContent='×';
        chip.append(label,remove);chips.append(chip);
      });
      const status=state.element.querySelector('[data-city-status]'),retry=state.element.querySelector('[data-city-retry]');
      status.textContent=!province?'Choose a province first.':data?.status==='loading'?'Loading cities and municipalities…':data?.status==='error'?'Locations could not be loaded. Retry, or choose province-wide coverage.':issueFor(state)?.message|| (state.scope==='all'?'This area covers the entire province.':'Choose one or more locations from the list.');
      retry.hidden=data?.status!=='error';retry.disabled=data?.status==='loading';
      if(open)options(state,state.input.value);
    };
    const refreshCode = code => {states.forEach(state=>{if(provinceFor(state.province)?.code===code)render(state);});notify();};
    const load = (province,force=false) => {
      if(!province)return;
      const current=catalogues.get(province.code);
      if(current?.status==='loading'||(!force&&current?.status==='ready'))return current?.request;
      const entry={status:'loading',items:[],request:null};catalogues.set(province.code,entry);
      entry.request=(async()=>{
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
        try {
          const response=await fetch(`${api}/psgc/provinces/${encodeURIComponent(province.code)}/cities-municipalities`,{headers:{Accept:'application/json'},cache:'no-cache',signal:controller.signal});
          const items=await response.json();
          if(!response.ok||!Array.isArray(items)||!items.length||items.some(item=>!/^\d{10}$/.test(String(item?.code||''))||typeof item?.name!=='string'||!item.name.trim()))throw Error('Invalid location list');
          entry.items=[...new Map(items.map(item=>[String(item.code),{code:String(item.code),name:item.name.trim()}])).values()].sort((a,b)=>a.name.localeCompare(b.name,'en-PH'));entry.status='ready';
        }catch{entry.status='error';}finally{clearTimeout(timer);refreshCode(province.code);}
      })();refreshCode(province.code);return entry.request;
    };
    const stateFor = node => states.get(node.closest('[data-zone-id]')?.dataset.zoneId);
    const open = (state,query='',highlight=false) => {
      if(!state||state.input.matches(':disabled'))return;
      states.forEach(other=>{if(other!==state&&other.element?.isConnected)close(other);});
      state.element.classList.add('open');state.list.hidden=false;state.input.setAttribute('aria-expanded','true');options(state,query,highlight);
    };
    const commit = (state,selected,scope) => {
      state.selected=selected;state.scope=scope;state.userPending=scope==='pending';state.storage.value=JSON.stringify(selected);
      state.input.removeAttribute('aria-invalid');
      state.input.value='';render(state);state.input.focus({preventScroll:true});
      if(state.element.classList.contains('open'))options(state);
      state.storage.dispatchEvent(new Event('change',{bubbles:true}));
    };
    const choose = (state,code) => {
      if(!state||state.input.matches(':disabled'))return;
      if(code==='all'){commit(state,[],'all');return;}
      const item=catalogue(state)?.items.find(item=>item.code===code);if(!item)return;
      const selected=state.scope==='all'?[]:[...state.selected],index=selected.findIndex(name=>key(name)===key(item.name));
      if(index>=0)selected.splice(index,1);else if(selected.length<200)selected.push(item.name);
      commit(state,selected,selected.length?'selected':'pending');
    };
    root.addEventListener('focusin',event=>{if(event.target.matches('[data-city-search]')){open(stateFor(event.target));event.target.select();}});
    root.addEventListener('input',event=>{if(event.target.matches('[data-city-search]'))open(stateFor(event.target),event.target.value,true);});
    root.addEventListener('focusout',event=>{const state=stateFor(event.target);if(state&&!state.element.contains(event.relatedTarget))close(state);});
    root.addEventListener('mousedown',event=>{if(event.target.closest('[data-city-toggle],[data-city-code]'))event.preventDefault();});
    root.addEventListener('click',event=>{
      const state=stateFor(event.target);if(!state||state.input.matches(':disabled'))return;
      const option=event.target.closest('[data-city-code]'),remove=event.target.closest('[data-city-remove]');
      if(option){choose(state,option.dataset.cityCode);return;}
      if(remove){const selected=state.selected.filter(name=>name!==remove.dataset.cityRemove);commit(state,selected,selected.length?'selected':'pending');return;}
      if(event.target.closest('[data-city-retry]')){void load(provinceFor(state.province),true);return;}
      if(event.target.closest('[data-city-toggle]')){if(state.element.classList.contains('open'))close(state);else{state.input.focus({preventScroll:true});open(state);}return;}
      if(event.target.matches('[data-city-search]')&&!state.element.classList.contains('open'))open(state);
    });
    root.addEventListener('keydown',event=>{
      if(!event.target.matches('[data-city-search]'))return;
      const state=stateFor(event.target);if(!state)return;
      if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();if(!state.element.classList.contains('open'))open(state);const count=state.list.querySelectorAll('[role="option"]').length;activate(state,state.active<0?(event.key==='ArrowDown'?0:count-1):state.active+(event.key==='ArrowDown'?1:-1));}
      else if(event.key==='Enter'&&state.element.classList.contains('open')){event.preventDefault();const node=state.list.querySelectorAll('[role="option"]')[state.active];if(node)choose(state,node.dataset.cityCode);}
      else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(state);}
      else if(event.key==='Tab')close(state);
    });
    root.addEventListener('change',event=>{
      if(!event.target.matches('[data-field="province"]'))return;
      const state=stateFor(event.target);if(!state)return;
      if(key(state.province)!==key(event.target.value)){
        state.province=event.target.value;state.scope='pending';state.selected=[];state.userPending=true;state.storage.value='[]';close(state);
      }
      void load(provinceFor(state.province));render(state);
    });
    document.addEventListener('click',event=>{const path=event.composedPath();states.forEach(state=>{if(state.element?.isConnected&&!path.includes(state.element))close(state);});});
    return {
      markup({zone,id}) {
        return `<div class="shipping-city-picker" data-city-picker><input type="hidden" id="${id}" data-field="cities" value="${escape(JSON.stringify(zone.cities||[]))}"/><div class="combobox-wrap"><i class="fa-solid fa-magnifying-glass shipping-province-search-icon" aria-hidden="true"></i><input class="input-field shipping-city-search" id="${id}-search" data-city-search role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-list" aria-describedby="${id}-help ${id}-status" autocomplete="off" placeholder="Search" required aria-required="true"/><button type="button" class="combobox-caret" data-city-toggle tabindex="-1" aria-label="Show cities and municipalities"><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></button><ul class="combobox-list" id="${id}-list" role="listbox" aria-label="Cities and municipalities" aria-multiselectable="true" hidden></ul></div><div class="shipping-city-chips" data-city-chips></div><p class="shipping-city-status" id="${id}-status" data-city-status role="status" aria-live="polite"></p><button type="button" class="btn-admin btn-secondary shipping-city-retry" data-city-retry hidden>Retry locations</button></div>`;
      },
      attach(zones) {
        zones.forEach(zone=>{
          const row=[...root.querySelectorAll('[data-zone-id]')].find(row=>row.dataset.zoneId===zone.id),element=row?.querySelector('[data-city-picker]');if(!element)return;
          let state=states.get(zone.id);
          if(!state||key(state.province)!==key(zone.province))state={province:zone.province,selected:[...(zone.cities||[])],scope:zone.cities?.length?'selected':zone.province?'all':'pending',userPending:false};
          Object.assign(state,{element,storage:element.querySelector('[data-field="cities"]'),input:element.querySelector('[data-city-search]'),list:element.querySelector('[role="listbox"]'),active:-1});states.set(zone.id,state);render(state);
          void load(provinceFor(state.province));
        });
        for(const id of states.keys())if(!zones.some(zone=>zone.id===id))states.delete(id);
      },
      refresh(){states.forEach(state=>{if(state.element?.isConnected){void load(provinceFor(state.province));render(state);}});},
      reset(){states.clear();},
      values(row){return values(row.querySelector('[data-field="cities"]'));},
      issue(){for(const state of states.values()){const issue=issueFor(state);if(issue)return issue;}return null;},
      pending(){return [...states.values()].some(state=>state.element?.isConnected&&state.userPending&&state.scope==='pending');},
      syncBusy(){states.forEach(state=>{if(state.element?.isConnected&&state.input.matches(':disabled'))close(state);});}
    };
  }});
})();
