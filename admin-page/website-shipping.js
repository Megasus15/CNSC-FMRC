/* Shared Admin editor / Staff published shipping settings. */
(() => {
  'use strict';
  document.addEventListener('DOMContentLoaded', () => {
    const get = id => document.getElementById(id);
    if (!get('shippingForm')) return;
    const api = (window.APP_API_BASE_URL || (['localhost','127.0.0.1'].includes(location.hostname) && location.port!=='8000' ? location.protocol+'//'+location.hostname+':8000/api' : location.origin+'/api')).replace(/\/$/,'');
    const headers = () => ({Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+window.AdminSession?.getToken()});
    let record=null, busy=false, refreshing=false, loaded=false, baseline='', zones=[], publishedPage=1;
    let provinces=[], provincesReady=false, provincesBusy=false, provincesFailed=false, provinceRequest=null;
    const admin = () => loaded && !!record?.can_edit;
    window.AdminWebsiteDraft?.register({isDirty:()=>admin()&&normalized(read())!==baseline,busy:()=>busy&&!!record?.can_edit});
    const money = amount => new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(amount));
    const list = value => value.split(/[\n,]+/).map(text=>text.trim()).filter(Boolean);
    const escape = text => String(text ?? '').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    const placeKey = value => String(value||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-PH');
    const knownProvince = value => provinces.some(province=>placeKey(province.name)===placeKey(value));
    const provinceOptions = current => {
      const matching=provinces.find(province=>placeKey(province.name)===placeKey(current));
      let html='<option value="">Select a province</option>';
      // Keep an existing value until the Admin explicitly selects a replacement.
      if(current&&!matching)html+='<option value="'+escape(current)+'" selected>'+escape(provincesReady?'Saved province: '+current:current)+'</option>';
      for(const province of provinces){const selected=province===matching;html+='<option value="'+escape(selected?current:province.name)+'" data-code="'+escape(province.code)+'"'+(selected?' selected':'')+'>'+escape(province.name)+'</option>';}
      return html;
    };
    const provinceLabel = value => provinces.find(province=>placeKey(province.name)===placeKey(value))?.name || value;
    const closeProvincePicker = picker => {
      picker.classList.remove('open');
      const input=picker.querySelector('[data-province-search]');
      input.value=provinceLabel(picker.querySelector('[data-field="province"]').value);
      input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');
      picker.querySelector('[role="listbox"]').hidden=true;
      picker.dataset.active='-1';
    };
    const activateProvince = (picker,index) => {
      const items=[...picker.querySelectorAll('[role="option"]')],input=picker.querySelector('[data-province-search]');
      const active=items.length&&index>=0?index%items.length:-1;
      picker.dataset.active=String(active);
      items.forEach((item,i)=>item.classList.toggle('combobox-active',i===active));
      if(active<0)input.removeAttribute('aria-activedescendant');
      else {input.setAttribute('aria-activedescendant',items[active].id);items[active].scrollIntoView({block:'nearest'});}
    };
    const openProvincePicker = (picker,query='',highlight=false) => {
      const input=picker.querySelector('[data-province-search]');
      if(input.disabled)return;
      get('shippingZones').querySelectorAll('[data-province-picker].open').forEach(other=>{if(other!==picker)closeProvincePicker(other);});
      const matches=provinces.filter(province=>placeKey(province.name).includes(placeKey(query)));
      const selected=picker.querySelector('[data-field="province"]').value;
      picker.querySelector('[role="listbox"]').innerHTML=matches.length?matches.map(province=>
        '<li id="'+input.id+'-'+province.code+'" role="option" tabindex="-1" data-province-code="'+province.code+'" aria-selected="'+(placeKey(province.name)===placeKey(selected))+'">'+escape(province.name)+'</li>').join(''):
        '<li class="combobox-no-results" role="presentation">No provinces found. Try another name.</li>';
      picker.classList.add('open');picker.querySelector('[role="listbox"]').hidden=false;input.setAttribute('aria-expanded','true');
      picker.querySelector('[data-province-results]').textContent=matches.length+' '+(matches.length===1?'province':'provinces')+' found.';
      activateProvince(picker,highlight&&matches.length?0:-1);
    };
    const chooseProvince = (picker,code) => {
      const province=provinces.find(item=>item.code===code);if(!province)return;
      const select=picker.querySelector('[data-field="province"]'),input=picker.querySelector('[data-province-search]');
      const option=[...select.options].find(item=>placeKey(item.value)===placeKey(province.name));
      select.value=option?.value || province.name;input.removeAttribute('aria-invalid');
      input.focus({preventScroll:true});closeProvincePicker(picker);
      select.dispatchEvent(new Event('change',{bubbles:true}));
    };
    const showError = (message,{title='Check shipping settings',field=null,retry=null}={}) => {
      if(field?.matches?.('[data-field="province"]'))field=field.closest('[data-province-picker]').querySelector('[data-province-search]');
      field?.setAttribute('aria-invalid','true');
      const options={title,type:'error',okText:retry?'Try again':'OK',onOk:()=>{if(retry)void retry();else field?.focus();}};
      if(window.showAdminPopup)window.showAdminPopup(message,options);
      else window.AdminPageNotice?.show(message,{key:'shipping',...(retry?{retry}:{})});
    };
    const safeFailure = (message,field) => Object.assign(new Error(message),{isShippingMessage:true,field});
    const errorField = key => {
      const area=String(key||'').match(/^settings\.zones\.(\d+)\.([a-z_]+)/);
      return area ? get('shipping-'+area[1]+'-'+area[2]) : key?.includes('nonworking_dates')?get('shippingDates'):null;
    };
    const validationMessage = (key,raw) => {
      const area=String(key).match(/^settings\.zones\.(\d+)\.([a-z_]+)/),number=area?Number(area[1])+1:0;
      if(area&&area[2]==='postal_codes'&&/duplicate|distinct|repeated/i.test(raw))return 'Delivery area '+number+' has a repeated postal code. Enter each postal code only once.';
      if(area&&area[2]==='cities'&&/duplicate|distinct|repeated/i.test(raw))return 'Delivery area '+number+' has a repeated city or municipality. Enter each name only once.';
      if(raw&&!/settings\.|SQLSTATE|Laravel|Exception|database|\bHTTP\b|postal_codes|nonworking_|transit_/i.test(raw)&&raw.length<600)return raw;
      const labels={name:'area name',province:'province',cities:'cities or municipalities',postal_codes:'postal codes',fee:'shipping fee',preparation_days:'preparation days',transit_min_days:'fastest delivery time',transit_max_days:'longest delivery time'};
      return area?'Please review the '+(labels[area[2]]||'settings')+' for delivery area '+number+'.':'Please review your shipping settings and try again.';
    };
    const read = () => ({enabled:get('shippingEnabled').checked,
      nonworking_weekdays:[...document.querySelectorAll('[data-shipping-weekday]:checked')].map(input=>Number(input.value)),
      nonworking_dates:list(get('shippingDates').value),
      zones:[...get('shippingZones').querySelectorAll('[data-zone-id]')].map(row=>{
        const value=key=>row.querySelector('[data-field="'+key+'"]').value;
        return {id:row.dataset.zoneId,name:value('name').trim(),province:value('province').trim(),cities:list(value('cities')),postal_codes:list(value('postal_codes')),
          fee:Number(value('fee')),preparation_days:Number(value('preparation_days')),transit_min_days:Number(value('transit_min_days')),transit_max_days:Number(value('transit_max_days'))};
      })});
    const normalized = settings => JSON.stringify({enabled:settings.enabled,nonworking_weekdays:settings.nonworking_weekdays,nonworking_dates:settings.nonworking_dates,zones:settings.zones.map(zone=>({...zone,fee:Number(zone.fee)}))});
    const dirty = () => !!record && normalized(read())!==baseline;
    const table = (settings, published=false) => {
      if (!settings) return '<div class="shipping-empty"><strong>Pickup only</strong><p>Publish approved delivery rates to offer shipping. Pickup at FMRC has no shipping fee.</p></div>';
      if (!settings.enabled) return '<div class="shipping-empty"><strong>Delivery is turned off</strong><p>Customers can choose free pickup at FMRC.</p></div>';
      if (!settings.zones.length) return '<div class="shipping-empty"><strong>No destinations added</strong><p>Add a destination and its rate before publishing delivery settings.</p></div>';
      const pageSize=5,total=settings.zones.length,pages=Math.max(1,Math.ceil(total/pageSize));
      if(published)publishedPage=Math.max(1,Math.min(publishedPage,pages));
      const rows=published?settings.zones.slice((publishedPage-1)*pageSize,publishedPage*pageSize):settings.zones;
      const pager=published?'<footer class="table-footer"><div class="table-footer-meta">'+window.AdminTablePagination.label(publishedPage,total,pageSize)+'</div><div class="table-pagination" aria-label="Published delivery area pages"><button type="button" class="page-btn" data-shipping-page="prev" aria-label="Previous delivery areas page" '+(publishedPage===1?'disabled':'')+'><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button><input class="page-number" type="number" min="1" max="'+pages+'" value="'+publishedPage+'" data-shipping-page-number aria-label="Delivery areas page number" /><button type="button" class="page-btn" data-shipping-page="next" aria-label="Next delivery areas page" '+(publishedPage===pages?'disabled':'')+'><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button></div></footer>':'';
      return `<section class="portal-data-card">
        <header class="portal-table-header">
          <h3 class="portal-table-title"><i class="fa-solid fa-truck portal-table-icon" aria-hidden="true"></i> Delivery rates</h3>

        </header><div class="shipping-table-wrap" tabindex="0" role="region" aria-label="Delivery rates"><table class="shipping-table"><thead><tr><th scope="col">Delivery area</th><th scope="col">Places covered</th><th scope="col">Fee per order</th><th scope="col">Preparation</th><th scope="col">Delivery time</th></tr></thead><tbody>${rows.map(zone=>
        '<tr><td>'+window.AdminTableValue.html(zone.name)+'</td><td>'+escape([window.AdminTableValue.text(zone.province),zone.cities?.join(', ')||'All cities / municipalities',zone.postal_codes?.join(', ')||'All postal codes'].join(' · '))+'</td><td>'+(window.AdminTableValue.missing(zone.fee)?'--':money(zone.fee))+'</td><td>'+(window.AdminTableValue.missing(zone.preparation_days)?'--':zone.preparation_days+' working '+(Number(zone.preparation_days)===1?'day':'days'))+'</td><td>'+([zone.transit_min_days,zone.transit_max_days].some(window.AdminTableValue.missing)?'--':zone.transit_min_days+'–'+zone.transit_max_days+' working days')+'</td></tr>').join('')}</tbody></table></div>${pager}</section>`;
    };
    const sync = () => {
      const values=read(),changed=!!record&&normalized(values)!==baseline;
      const savedDraft=!!record?.draft&&record.has_saved_draft!==false;
      const same=!!record?.published&&normalized(record.draft||values)===normalized(record.published);
      const needsArea=values.enabled&&!values.zones.length;
      const provinceLock=!!values.zones.length&&(!provincesReady||provincesBusy);
      const invalidProvince=provincesReady&&values.zones.some(zone=>!knownProvince(zone.province));
      get('shippingForm').setAttribute('aria-busy',String(busy));
      get('shippingSave').disabled=!admin()||busy||provinceLock||!changed;
      get('shippingDiscard').disabled=!admin()||busy||!changed;
      get('shippingPublish').disabled=!admin()||busy||provinceLock||invalidProvince||changed||!savedDraft||needsArea||same||!get('shippingApproved').checked;
      get('shippingFields').disabled=!admin()||busy;
      get('shippingApproved').disabled=!admin()||busy||provinceLock||invalidProvince||changed||!savedDraft||needsArea||same;
      get('shippingZones').querySelectorAll('[data-province-picker]').forEach(picker=>{
        const disabled=!admin()||busy||!provincesReady||provincesBusy;
        picker.querySelectorAll('select,input,button').forEach(control=>{control.disabled=disabled;});
        picker.querySelector('[data-province-search]').setAttribute('aria-required','true');
        if(disabled)closeProvincePicker(picker);
      });
      get('shippingProvinceStatus').textContent=provincesBusy?'Loading provinces…':provincesFailed?'The province list is unavailable. Reload it to continue.':'';
      get('shippingProvinceRetry').hidden=!provincesFailed;get('shippingProvinceRetry').disabled=busy||provincesBusy;
      get('shippingDraftPreview').innerHTML=record ? table(values) : '';
      get('shippingRefresh').disabled=busy||refreshing;
      const pending=admin()&&(changed||(savedDraft&&!same));
      get('shippingPendingChanges').hidden=!pending;
      get('shippingPendingMessage').textContent=changed?'Your edits are not saved yet. Save draft, then approve and publish to update customer delivery rates.':'Your draft is saved but not published. Customers still use the published rates below until you publish these changes.';
      get('shippingReviewChanges').disabled=busy;
      get('shippingSaveStatus').textContent=busy?(loaded?'Updating settings…':'Loading settings…'):!loaded?'Settings unavailable. Please retry.':changed?'Unsaved draft changes':admin()?(savedDraft&&!same?'Draft saved — waiting to be published':'No unsaved changes'):'Published settings · Read only';
      const hint=get('shippingPublishHint');
      if(hint)hint.textContent=!loaded?'':busy?'Please wait…':needsArea?'Add at least one delivery area before offering delivery.':provinceLock?'Load the province list before saving or publishing.':invalidProvince?'Select a province from the list for each delivery area.':changed?'Click Save draft first. Then tick the FMRC approval box.':!savedDraft?'Set up your delivery areas and fees, then click Save draft.':same?'These settings are already published.':!get('shippingApproved').checked?'Tick the FMRC approval box to enable Publish settings.':'Ready to publish. These settings will be used for new orders.';
    };
    const renderZones = values => {
      zones=values;
      get('shippingZones').classList.toggle('shipping-zones-scroll',zones.length>=3);
      get('shippingZones').setAttribute('tabindex',zones.length>=3?'0':'-1');
      const fields=[['name','Delivery area name','text'],['province','Province','text'],['cities','Cities / municipalities (optional)','text'],['postal_codes','Postal codes (optional)','text'],['fee','Shipping fee per order (PHP)','number'],['preparation_days','Days to prepare the order','number'],['transit_min_days','Fastest delivery (working days)','number'],['transit_max_days','Longest delivery (working days)','number']];
      const help={name:'A label for your reference, such as Daet delivery.',province:'Search all Philippine provinces, then select a result. Review city and postal-code entries when changing provinces.',cities:'Separate names with commas. Leave blank to include all cities in this province.',postal_codes:'Use four-digit codes, separated by commas. Leave blank for all postal codes in the selected area.',fee:'Charged once for the whole order, regardless of the number of items.',preparation_days:'Working days FMRC needs before the parcel is ready to send.',transit_min_days:'Fewest working days for delivery after preparation.',transit_max_days:'Most working days usually needed after preparation.'};
      if(!zones.length){get('shippingZones').innerHTML='<div class="shipping-empty"><strong>No destinations yet</strong><p>Add your first destination to set its shipping fee and delivery estimate.</p></div>';return;}
      get('shippingZones').innerHTML=zones.map((zone,index)=>'<section class="shipping-zone" data-zone-id="'+escape(zone.id)+'"><div class="shipping-zone-heading"><h4>Delivery area '+(index+1)+'</h4><button type="button" class="btn-admin btn-secondary" data-remove-zone="'+index+'">Remove area</button></div><div class="shipping-zone-fields">'+fields.map(([key,label,type])=>{
        const id='shipping-'+index+'-'+key,attributes='class="input-field" id="'+id+'" data-field="'+key+'" aria-describedby="'+id+'-help"';
        const control=key==='province'?'<div class="combobox-wrap shipping-province-picker" data-province-picker><select '+attributes+' required hidden aria-hidden="true" tabindex="-1"'+(!provincesReady?' disabled':'')+'>'+provinceOptions(zone.province)+'</select><i class="fa-solid fa-magnifying-glass shipping-province-search-icon" aria-hidden="true"></i><input class="input-field combobox-input shipping-province-search" id="'+id+'-search" data-province-search type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="'+id+'-list" aria-describedby="'+id+'-help" autocomplete="off" spellcheck="false" placeholder="Search provinces…" value="'+escape(provinceLabel(zone.province))+'"'+(!provincesReady?' disabled':'')+'><button class="combobox-caret" type="button" data-province-toggle aria-label="Show all provinces for delivery area '+(index+1)+'" tabindex="-1"><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></button><ul class="combobox-list" id="'+id+'-list" role="listbox" aria-label="Philippine provinces" hidden></ul><span class="shipping-province-results" data-province-results role="status" aria-live="polite"></span></div>':'<input '+attributes+' type="'+type+'" value="'+escape(Array.isArray(zone[key])?zone[key].join(', '):zone[key])+'" '+(['cities','postal_codes'].includes(key)?'':'required ') + (type==='number'?'min="'+(key.includes('transit')?1:0)+'" max="'+(key==='fee'?'999999.99':'90')+'" step="'+(key==='fee'?'.01':'1')+'"':'maxlength="'+(['cities','postal_codes'].includes(key)?'10000':key==='name'?'100':'120')+'"')+' />';
        return '<div class="field-stack"><label for="'+id+(key==='province'?'-search':'')+'">'+label+'</label>'+control+'<small id="'+id+'-help">'+help[key]+'</small></div>';
      }).join('')+'</div></section>').join('');
    };
    const populate = data => {
      loaded=true;
      record=data;
      const values=data.draft || data.published || {enabled:false,nonworking_weekdays:[6,7],nonworking_dates:[],zones:[]};
      get('shippingEditor').hidden=!data.can_edit;
      get('shippingSaveBar').hidden=!data.can_edit;
      get('shippingEnabled').checked=values.enabled;
      get('shippingDates').value=values.nonworking_dates.join('\n');
      document.querySelectorAll('[data-shipping-weekday]').forEach(input=>{input.checked=values.nonworking_weekdays.includes(Number(input.value));});
      renderZones(values.zones); baseline=normalized(read()); get('shippingApproved').checked=false;
      get('shippingPublished').innerHTML=table(data.published,true);
      get('shippingPublishedVersion').textContent=data.published_at?'Published '+new Date(data.published_at.replace(' ','T')+'Z').toLocaleString('en-PH',{timeZone:'Asia/Manila'}):'No published rates';
      const calendar=data.published;
      get('shippingPublishedCalendar').textContent=calendar ? 'Nonworking days: '+(calendar.nonworking_weekdays.map(day=>['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][day-1]).join(', ')||'None')+'. Other closures: '+(calendar.nonworking_dates.join(', ')||'None')+'.' : '';
      sync();
      if(data.can_edit&&!provincesReady&&!provincesBusy)void loadProvinces();
    };
    const fetchData = async (path,options={}) => {
      const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),20000);
      try {
      const response=await fetch(api+path,{...options,cache:'no-store',headers:headers(),signal:controller.signal});
      const json=await response.json().catch(()=>({}));
      if(response.status===401)throw safeFailure('Your session has expired. Sign in again to continue.');
      if(response.status===403)throw safeFailure('Your account does not have permission to manage these settings.');
      if(response.status===422){const [field,messages]=Object.entries(json.errors||{})[0]||[];throw safeFailure(validationMessage(field,Array.isArray(messages)?messages[0]:''),field);}
      if(response.status===409)throw safeFailure('These settings changed in another session. Refresh and review the latest draft before continuing.');
      if (!response.ok) throw safeFailure('Shipping settings are temporarily unavailable. Please try again.');
      if(!json.data || typeof json.data.can_edit!=='boolean')throw safeFailure('Shipping settings could not be loaded. Please refresh and try again.');
      return json.data;
      } catch(failure) {
        if(failure.name==='AbortError')throw safeFailure('The request timed out. Refresh to check the latest settings before trying again.');
        if(failure.isShippingMessage)throw failure;
        throw safeFailure('We could not connect. Check your connection and try again.');
      } finally {clearTimeout(timeout);}
    };
    const loadProvinces = () => {
      if(provinceRequest)return provinceRequest;
      provincesBusy=true;provincesFailed=false;sync();
      provinceRequest=(async()=>{
        const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),18000);
        try{
          const response=await fetch(api+'/psgc/provinces',{headers:{Accept:'application/json'},signal:controller.signal,cache:'no-cache'});
          const data=await response.json();
          if(!response.ok||!Array.isArray(data)||!data.length||data.some(value=>!/^\d{10}$/.test(String(value?.code||''))||typeof value?.name!=='string'||!value.name.trim()))throw Error('Province list unavailable');
          provinces=data.map(value=>({code:String(value.code),name:value.name.trim()})).sort((a,b)=>a.name.localeCompare(b.name,'en-PH'));
          provincesReady=true;
          get('shippingZones').querySelectorAll('[data-field="province"]').forEach(select=>{select.innerHTML=provinceOptions(select.value);closeProvincePicker(select.closest('[data-province-picker]'));});
          return true;
        }catch{
          provincesFailed=true;
          showError('The province list is temporarily unavailable. Please try again. Your draft has been kept.',{title:'Province list unavailable',retry:loadProvinces});
          return false;
        }finally{clearTimeout(timeout);provincesBusy=false;provinceRequest=null;sync();}
      })();return provinceRequest;
    };
    const validateDraft = () => {
      const values=read();
      const reject=(message,field)=>{showError(message,{field});return false;};
      if(values.zones.length&&!provincesReady)return reject('Load the province list before saving your delivery areas.');
      if(values.nonworking_weekdays.length===7)return reject('Leave at least one day unchecked so delivery dates can be calculated.');
      const dates=values.nonworking_dates;
      if(new Set(dates).size!==dates.length)return reject('A closed date is repeated. Enter each date only once.',get('shippingDates'));
      if(dates.some(date=>{const parsed=new Date(date+'T00:00:00Z');return !/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==date;}))return reject('Enter closed dates as YYYY-MM-DD, one per line.',get('shippingDates'));
      const labels={name:'area name',province:'province',cities:'cities or municipalities',postal_codes:'postal codes',fee:'shipping fee',preparation_days:'preparation days',transit_min_days:'fastest delivery days',transit_max_days:'longest delivery days'};
      for(const [index,zone]of values.zones.entries()){
        for(const field of get('shippingZones').querySelectorAll('[data-zone-id]')[index].querySelectorAll('[data-field]')){
          if(!field.checkValidity())return reject('Please enter a valid '+labels[field.dataset.field]+' for delivery area '+(index+1)+'.',field);
        }
        if(!knownProvince(zone.province))return reject('Select a province from the list for delivery area '+(index+1)+'.',get('shipping-'+index+'-province'));
        if(new Set(zone.cities.map(placeKey)).size!==zone.cities.length)return reject('Delivery area '+(index+1)+' has a repeated city or municipality. Enter each name only once.',get('shipping-'+index+'-cities'));
        if(new Set(zone.postal_codes).size!==zone.postal_codes.length)return reject('Delivery area '+(index+1)+' has a repeated postal code. Enter each postal code only once.',get('shipping-'+index+'-postal_codes'));
        if(zone.postal_codes.some(code=>!/^\d{4}$/.test(code)))return reject('Enter four-digit postal codes for delivery area '+(index+1)+'.',get('shipping-'+index+'-postal_codes'));
        if(zone.transit_min_days>zone.transit_max_days)return reject('The longest delivery time must be at least the fastest delivery time for delivery area '+(index+1)+'.',get('shipping-'+index+'-transit_max_days'));
      }
      return true;
    };
    const load = async () => {
      busy=true;loaded=false;sync();
      try { populate(await fetchData('/admin/shipping-settings')); return true; }
      catch (failure) {
        loaded=false;
        showError(failure.message,{title:'Shipping settings unavailable'});
        get('shippingPublished').textContent='Published shipping settings are unavailable. Please try again.';
        get('shippingPublishedVersion').textContent='Settings unavailable';
        get('shippingPublishedCalendar').textContent='';
        return false;
      }
      finally { busy=false;sync(); }
    };
    const mutate = async (path,payload) => {
      busy=true;sync();
      try { populate(await fetchData(path,{method:path.endsWith('/draft')?'PUT':'POST',body:JSON.stringify(payload)}));
        window.showAdminSuccessNotification?.(path.endsWith('/draft')?'Shipping draft saved.':'Approved shipping settings published.',{title:'Saved!'});
      } catch (failure) { showError(failure.message,{field:errorField(failure.field)}); }
      finally { busy=false;sync(); }
    };
    const edited=event=>{if(event.target.matches('[data-province-search]'))return;event.target.removeAttribute('aria-invalid');sync();};
    get('shippingForm').addEventListener('input',edited);get('shippingForm').addEventListener('change',edited);
    get('shippingZones').addEventListener('focusin',event=>{
      if(!event.target.matches('[data-province-search]'))return;
      openProvincePicker(event.target.closest('[data-province-picker]'));event.target.select();
    });
    get('shippingZones').addEventListener('input',event=>{
      if(event.target.matches('[data-province-search]'))openProvincePicker(event.target.closest('[data-province-picker]'),event.target.value,true);
    });
    get('shippingZones').addEventListener('focusout',event=>{
      const picker=event.target.closest('[data-province-picker]');
      if(picker&&!picker.contains(event.relatedTarget))closeProvincePicker(picker);
    });
    get('shippingZones').addEventListener('click',event=>{
      const picker=event.target.closest('[data-province-picker]');if(!picker)return;
      const option=event.target.closest('[data-province-code]');
      if(option){chooseProvince(picker,option.dataset.provinceCode);return;}
      if(event.target.closest('[data-province-toggle]')){
        if(picker.classList.contains('open'))closeProvincePicker(picker);
        else {picker.querySelector('[data-province-search]').focus({preventScroll:true});openProvincePicker(picker);}
      }else if(event.target.matches('[data-province-search]')&&!picker.classList.contains('open')){openProvincePicker(picker);event.target.select();}
    });
    get('shippingZones').addEventListener('mousedown',event=>{if(event.target.closest('[data-province-toggle]'))event.preventDefault();});
    get('shippingZones').addEventListener('keydown',event=>{
      if(!event.target.matches('[data-province-search]'))return;
      const picker=event.target.closest('[data-province-picker]'),open=picker.classList.contains('open');
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){
        event.preventDefault();if(!open)openProvincePicker(picker);
        const active=Number(picker.dataset.active),count=picker.querySelectorAll('[role="option"]').length;
        activateProvince(picker,active<0?(event.key==='ArrowDown'?0:count-1):(active+(event.key==='ArrowDown'?1:-1)+count)%count);
      }else if(event.key==='Enter'&&open){
        event.preventDefault();const option=picker.querySelectorAll('[role="option"]')[Number(picker.dataset.active)];
        if(option)chooseProvince(picker,option.dataset.provinceCode);
      }else if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();closeProvincePicker(picker);}
      else if(event.key==='Tab')closeProvincePicker(picker);
    });
    document.addEventListener('click',event=>{if(!event?.target)return;get('shippingZones').querySelectorAll('[data-province-picker].open').forEach(picker=>{if(!picker.contains(event.target))closeProvincePicker(picker);});});
    get('shippingApproved').addEventListener('change',sync);
    get('shippingAddZone').addEventListener('click',()=>{const values=read().zones;if(values.length>=100)return;values.push({id:crypto.randomUUID(),name:'',province:'',cities:[],postal_codes:[],fee:'',preparation_days:1,transit_min_days:1,transit_max_days:3});renderZones(values);sync();const added=get('shippingZones').lastElementChild;added?.scrollIntoView({block:'nearest'});added?.querySelector('input')?.focus({preventScroll:true});});
    get('shippingZones').addEventListener('click',event=>{const button=event.target.closest('[data-remove-zone]');if(!button)return;
      const last=read().zones.length===1;
      window.showAdminConfirmPopup(last?'Remove the last delivery area from the draft? Delivery will be turned off when you save and publish this change.':'Remove this delivery area from the draft? Save and publish to remove it from customer checkout.',
        {title:'Remove destination zone',confirmText:'Remove',onConfirm:()=>{const values=read().zones;values.splice(Number(button.dataset.removeZone),1);if(!values.length)get('shippingEnabled').checked=false;renderZones(values);sync();}});
    });
    get('shippingForm').addEventListener('submit',event=>{event.preventDefault();if(!admin()||busy||!dirty()||!validateDraft())return;const values=read();window.showAdminConfirmPopup('Save these shipping settings as a draft?',{title:'Save Shipping Draft',confirmText:'Save draft',onConfirm:()=>mutate('/admin/shipping-settings/draft',{expected_revision:record.revision,settings:values})});});
    get('shippingPublish').addEventListener('click',()=>{if(get('shippingPublish').disabled)return;window.showAdminConfirmPopup('Publish these FMRC-approved rates and delivery estimates for new checkouts?',{title:'Publish Shipping Settings',confirmText:'Publish',onConfirm:()=>mutate('/admin/shipping-settings/publish',{expected_revision:record.revision,approved:true})});});
    get('shippingDiscard').addEventListener('click',()=>{if(!busy&&record)populate(record);});
    const renderPublishedPage=()=>{get('shippingPublished').innerHTML=table(record?.published,true);};
    get('shippingPublished').addEventListener('click',event=>{
      const button=event.target.closest('[data-shipping-page]');if(!button||button.disabled)return;
      publishedPage+=button.dataset.shippingPage==='next'?1:-1;renderPublishedPage();
    });
    get('shippingPublished').addEventListener('change',event=>{
      if(!event.target.matches('[data-shipping-page-number]'))return;
      publishedPage=Number.parseInt(event.target.value,10)||1;renderPublishedPage();
    });
    const refreshLabel=get('shippingRefresh').innerHTML;
    const loadAll = async () => {
      if(refreshing)return;
      refreshing=true;get('shippingRefreshStatus').hidden=false;get('shippingRefreshStatus').textContent='Refreshing delivery settings and tracking status…';
      get('shippingRefresh').innerHTML='<i class="fa-solid fa-arrows-rotate fa-spin" aria-hidden="true"></i> Refreshing…';
      get('shippingRefresh').setAttribute('aria-busy','true');sync();
      try{
        const results=await Promise.allSettled([load(),window.FMRCShippingTracking?.refresh()??false]);
        const [rates,tracking]=results.map(result=>result.status==='fulfilled'&&result.value===true);
        get('shippingRefreshStatus').textContent=!rates?'Delivery settings could not be refreshed. Please try again.':!tracking?'Delivery settings refreshed. Tracking status could not be refreshed. Please try again.':'Delivery settings and tracking status refreshed.';
      }finally{refreshing=false;get('shippingRefresh').innerHTML=refreshLabel;get('shippingRefresh').setAttribute('aria-busy','false');sync();}
    };
    get('shippingReviewChanges').addEventListener('click',()=>{
      get('shippingEditor').scrollIntoView({block:'start',behavior:'smooth'});
      (get('shippingApproved').disabled?get('shippingSave'):get('shippingApproved')).focus({preventScroll:true});
    });
    const refresh = () => {if(busy||refreshing)return;if(dirty())window.showAdminConfirmPopup('Discard unsaved changes and load the latest shipping settings?',{title:'Refresh Shipping Settings',confirmText:'Load latest',onConfirm:loadAll});else void loadAll();};
    get('shippingRefresh').addEventListener('click',refresh);get('shippingProvinceRetry').addEventListener('click',()=>void loadProvinces());
    void (window.AdminWebsiteLoading ? window.AdminWebsiteLoading.during(load) : load());
  });
})();
