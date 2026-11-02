/* Shared Admin editor / Staff published shipping settings. */
(() => {
  'use strict';
  document.addEventListener('DOMContentLoaded', () => {
    const get = id => document.getElementById(id);
    if (!get('shippingForm')) return;
    const api = (window.APP_API_BASE_URL || (['localhost','127.0.0.1'].includes(location.hostname) && location.port!=='8000' ? location.protocol+'//'+location.hostname+':8000/api' : location.origin+'/api')).replace(/\/$/,'');
    const headers = () => ({Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+window.AdminSession?.getToken()});
    let record=null, busy=false, loaded=false, baseline='', zones=[];
    const admin = () => loaded && !!record?.can_edit;
    const money = amount => new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(amount));
    const list = value => value.split(/[\n,]+/).map(text=>text.trim()).filter(Boolean);
    const escape = text => String(text ?? '').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
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
    const table = settings => {
      if (!settings) return '<div class="shipping-empty"><strong>Pickup only</strong><p>Publish approved delivery rates to offer shipping. Pickup at FMRC has no shipping fee.</p></div>';
      if (!settings.enabled) return '<div class="shipping-empty"><strong>Delivery is turned off</strong><p>Customers can choose free pickup at FMRC.</p></div>';
      if (!settings.zones.length) return '<div class="shipping-empty"><strong>No destinations added</strong><p>Add a destination and its rate before publishing delivery settings.</p></div>';
      return '<div class="shipping-table-wrap" tabindex="0" role="region" aria-label="Delivery rates"><table class="shipping-table"><thead><tr><th scope="col">Delivery area</th><th scope="col">Places covered</th><th scope="col">Fee per order</th><th scope="col">Preparation</th><th scope="col">Delivery time</th></tr></thead><tbody>'+settings.zones.map(zone=>
        '<tr><td>'+escape(zone.name)+'</td><td>'+escape([zone.province,zone.cities?.join(', ')||'All cities / municipalities',zone.postal_codes?.join(', ')||'All postal codes'].join(' · '))+'</td><td>'+money(zone.fee)+'</td><td>'+zone.preparation_days+' working '+(Number(zone.preparation_days)===1?'day':'days')+'</td><td>'+zone.transit_min_days+'–'+zone.transit_max_days+' working days</td></tr>').join('')+'</tbody></table></div>';
    };
    const sync = () => {
      const values=read(),changed=!!record&&normalized(values)!==baseline;
      const savedDraft=!!record?.draft&&record.has_saved_draft!==false;
      const same=!!record?.published&&normalized(record.draft||values)===normalized(record.published);
      const needsArea=values.enabled&&!values.zones.length;
      get('shippingForm').setAttribute('aria-busy',String(busy));
      get('shippingSave').disabled=!admin()||busy||!changed;
      get('shippingDiscard').disabled=!admin()||busy||!changed;
      get('shippingPublish').disabled=!admin()||busy||changed||!savedDraft||needsArea||same||!get('shippingApproved').checked;
      get('shippingFields').disabled=!admin()||busy;
      get('shippingApproved').disabled=!admin()||busy||changed||!savedDraft||needsArea||same;
      get('shippingDraftPreview').innerHTML=record ? table(values) : '';
      get('shippingRefresh').disabled=busy;get('shippingRetry').disabled=busy;
      get('shippingSaveStatus').textContent=busy?(loaded?'Updating settings…':'Loading settings…'):!loaded?'Settings unavailable. Please retry.':changed?'Unsaved draft changes':admin()?'No unsaved changes':'Published settings · Read only';
      const hint=get('shippingPublishHint');
      if(hint)hint.textContent=!loaded?'':busy?'Please wait…':needsArea?'Add at least one delivery area before offering delivery.':changed?'Click Save draft first. Then tick the FMRC approval box.':!savedDraft?'Set up your delivery areas and fees, then click Save draft.':same?'These settings are already published.':!get('shippingApproved').checked?'Tick the FMRC approval box to enable Publish settings.':'Ready to publish. These settings will be used for new orders.';
    };
    const renderZones = values => {
      zones=values;
      const fields=[['name','Delivery area name','text'],['province','Province','text'],['cities','Cities / municipalities (optional)','text'],['postal_codes','Postal codes (optional)','text'],['fee','Shipping fee per order (PHP)','number'],['preparation_days','Days to prepare the order','number'],['transit_min_days','Fastest delivery (working days)','number'],['transit_max_days','Longest delivery (working days)','number']];
      const help={name:'A label for your reference, such as Daet delivery.',province:'Use the province name shown in customer addresses.',cities:'Separate names with commas. Leave blank to include all cities in this province.',postal_codes:'Use four-digit codes, separated by commas. Leave blank for all postal codes in the selected area.',fee:'Charged once for the whole order, regardless of the number of items.',preparation_days:'Working days FMRC needs before the parcel is ready to send.',transit_min_days:'Fewest working days for delivery after preparation.',transit_max_days:'Most working days usually needed after preparation.'};
      if(!zones.length){get('shippingZones').innerHTML='<div class="shipping-empty"><strong>No destinations yet</strong><p>Add your first destination to set its shipping fee and delivery estimate.</p></div>';return;}
      get('shippingZones').innerHTML=zones.map((zone,index)=>'<section class="shipping-zone" data-zone-id="'+escape(zone.id)+'"><div class="shipping-zone-heading"><h4>Delivery area '+(index+1)+'</h4><button type="button" class="btn-admin btn-secondary" data-remove-zone="'+index+'">Remove area</button></div><div class="shipping-zone-fields">'+fields.map(([key,label,type])=>
        '<div class="field-stack"><label for="shipping-'+index+'-'+key+'">'+label+'</label><input class="input-field" id="shipping-'+index+'-'+key+'" data-field="'+key+'" aria-describedby="shipping-'+index+'-'+key+'-help" type="'+type+'" value="'+escape(Array.isArray(zone[key])?zone[key].join(', '):zone[key])+'" '+(['cities','postal_codes'].includes(key)?'':'required ') + (type==='number'?'min="'+(key.includes('transit')?1:0)+'" max="'+(key==='fee'?'999999.99':'90')+'" step="'+(key==='fee'?'.01':'1')+'"':'maxlength="'+(['cities','postal_codes'].includes(key)?'10000':key==='name'?'100':'120')+'"')+' /><small id="shipping-'+index+'-'+key+'-help">'+help[key]+'</small></div>').join('')+'</div></section>').join('');
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
      get('shippingPublished').innerHTML=table(data.published);
      get('shippingPublishedVersion').textContent=data.published_at?'Published '+new Date(data.published_at.replace(' ','T')+'Z').toLocaleString('en-PH',{timeZone:'Asia/Manila'}):'No published rates';
      const calendar=data.published;
      get('shippingPublishedCalendar').textContent=calendar ? 'Nonworking days: '+(calendar.nonworking_weekdays.map(day=>['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][day-1]).join(', ')||'None')+'. Other closures: '+(calendar.nonworking_dates.join(', ')||'None')+'.' : '';
      sync();
    };
    const error = message => {get('shippingError').hidden=false;get('shippingErrorText').textContent=message;};
    const fetchData = async (path,options={}) => {
      const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),20000);
      try {
      const response=await fetch(api+path,{...options,headers:headers(),signal:controller.signal});
      const json=await response.json().catch(()=>({}));
      if(response.status===401)throw new Error('Your session has expired. Sign in again to continue.');
      if(response.status===403)throw new Error('Your account does not have permission to manage these settings.');
      if (!response.ok) throw new Error(Object.values(json.errors || {}).flat()[0] || json.message || 'Shipping settings could not be saved. Please retry.');
      if(!json.data || typeof json.data.can_edit!=='boolean')throw new Error('Shipping settings could not be loaded. Please retry.');
      return json.data;
      } catch(failure) {
        if(failure.name==='AbortError')throw new Error('The request timed out. Refresh to check the latest settings before trying again.');
        throw failure;
      } finally {clearTimeout(timeout);}
    };
    const load = async () => {
      busy=true;loaded=false;sync();get('shippingError').hidden=true;
      try { populate(await fetchData('/admin/shipping-settings')); }
      catch (failure) {
        loaded=false;
        error(failure.message || 'Shipping settings could not be loaded. Retry before editing.');
        get('shippingPublished').textContent='Published shipping settings are unavailable. Please try again.';
        get('shippingPublishedVersion').textContent='Settings unavailable';
        get('shippingPublishedCalendar').textContent='';
      }
      finally { busy=false;sync(); }
    };
    const mutate = async (path,payload) => {
      busy=true;sync();get('shippingError').hidden=true;
      try { populate(await fetchData(path,{method:path.endsWith('/draft')?'PUT':'POST',body:JSON.stringify(payload)}));
        window.showAdminSuccessNotification?.(path.endsWith('/draft')?'Shipping draft saved.':'Approved shipping settings published.',{title:'Saved!'});
      } catch (failure) { error(failure.message); }
      finally { busy=false;sync(); }
    };
    get('shippingForm').addEventListener('input',sync);get('shippingForm').addEventListener('change',sync);
    get('shippingApproved').addEventListener('change',sync);
    get('shippingAddZone').addEventListener('click',()=>{const values=read().zones;if(values.length>=100)return;values.push({id:crypto.randomUUID(),name:'',province:'',cities:[],postal_codes:[],fee:'',preparation_days:1,transit_min_days:1,transit_max_days:3});renderZones(values);sync();});
    get('shippingZones').addEventListener('click',event=>{const button=event.target.closest('[data-remove-zone]');if(!button)return;window.showAdminConfirmPopup('Remove this zone from the draft?',{title:'Remove destination zone',confirmText:'Remove',onConfirm:()=>{const values=read().zones;values.splice(Number(button.dataset.removeZone),1);renderZones(values);sync();}});});
    get('shippingForm').addEventListener('submit',event=>{event.preventDefault();if(!admin()||busy||!dirty()||!get('shippingForm').reportValidity())return;const values=read();window.showAdminConfirmPopup('Save these shipping settings as a draft?',{title:'Save Shipping Draft',confirmText:'Save draft',onConfirm:()=>mutate('/admin/shipping-settings/draft',{expected_revision:record.revision,settings:values})});});
    get('shippingPublish').addEventListener('click',()=>{if(get('shippingPublish').disabled)return;window.showAdminConfirmPopup('Publish these FMRC-approved rates and delivery estimates for new checkouts?',{title:'Publish Shipping Settings',confirmText:'Publish',onConfirm:()=>mutate('/admin/shipping-settings/publish',{expected_revision:record.revision,approved:true})});});
    get('shippingDiscard').addEventListener('click',()=>{if(!busy&&record)populate(record);});
    const refresh = () => {if(busy)return;if(dirty())window.showAdminConfirmPopup('Discard unsaved changes and load the latest shipping settings?',{title:'Refresh Shipping Settings',confirmText:'Load latest',onConfirm:load});else void load();};
    get('shippingRefresh').addEventListener('click',refresh);get('shippingRetry').addEventListener('click',refresh);
    void (window.AdminWebsiteLoading ? window.AdminWebsiteLoading.during(load) : load());
  });
})();
