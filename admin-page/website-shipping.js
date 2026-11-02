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
      if (!settings) return '<p>No shipping rates have been published. Delivery is unavailable; customers can choose pickup.</p>';
      if (!settings.enabled) return '<p>Courier delivery is currently unavailable. Pickup has no shipping fee.</p>';
      return '<div class="shipping-table-wrap"><table class="shipping-table"><thead><tr><th>Destination zone</th><th>Coverage</th><th>Fee per order</th><th>Preparation</th><th>Transit</th></tr></thead><tbody>'+settings.zones.map(zone=>
        '<tr><td>'+escape(zone.name)+'</td><td>'+escape([zone.province,zone.cities?.join(', ')||'All cities / municipalities',zone.postal_codes?.join(', ')||'All postal codes'].join(' · '))+'</td><td>'+money(zone.fee)+'</td><td>'+zone.preparation_days+' working days</td><td>'+zone.transit_min_days+'–'+zone.transit_max_days+' working days</td></tr>').join('')+'</tbody></table></div>';
    };
    const sync = () => {
      const changed=dirty();
      get('shippingForm').setAttribute('aria-busy',String(busy));
      get('shippingSave').disabled=!admin()||busy||!changed;
      get('shippingDiscard').disabled=!admin()||busy||!changed;
      get('shippingPublish').disabled=!admin()||busy||changed||!record?.draft||!get('shippingApproved').checked||normalized(record.draft)===normalized(record.published || {enabled:false,nonworking_weekdays:[6,7],nonworking_dates:[],zones:[]});
      get('shippingFields').disabled=!admin()||busy;
      get('shippingApproved').disabled=!admin()||busy;
      get('shippingDraftPreview').innerHTML=record ? table(read()) : '';
      get('shippingSaveStatus').textContent=busy?'Saving shipping settings…':changed?'You have unsaved draft changes.':admin()?'Draft changes are saved. Publish only FMRC-approved settings.':'Published shipping settings are read-only for Staff.';
    };
    const renderZones = values => {
      zones=values;
      const fields=[['name','Zone name','text'],['province','Province (official name)','text'],['cities','Cities / municipalities (comma separated; blank = all)','text'],['postal_codes','Postal codes (comma separated; blank = all)','text'],['fee','Shipping fee per order (PHP)','number'],['preparation_days','Preparation (working days)','number'],['transit_min_days','Minimum transit (working days)','number'],['transit_max_days','Maximum transit (working days)','number']];
      get('shippingZones').innerHTML=zones.map((zone,index)=>'<section class="shipping-zone" data-zone-id="'+escape(zone.id)+'"><div class="shipping-zone-heading"><h4>Destination zone '+(index+1)+'</h4><button type="button" class="btn-admin btn-secondary" data-remove-zone="'+index+'">Remove zone</button></div><div class="shipping-zone-fields">'+fields.map(([key,label,type])=>
        '<div class="field-stack"><label for="shipping-'+index+'-'+key+'">'+label+'</label><input class="input-field" id="shipping-'+index+'-'+key+'" data-field="'+key+'" type="'+type+'" value="'+escape(Array.isArray(zone[key])?zone[key].join(', '):zone[key])+'" '+(['cities','postal_codes'].includes(key)?'':'required ') + (type==='number'?'min="'+(key.includes('transit')?1:0)+'" max="'+(key==='fee'?'999999.99':'90')+'" step="'+(key==='fee'?'.01':'1')+'"':'maxlength="'+(['cities','postal_codes'].includes(key)?'10000':'120')+'"')+' /></div>').join('')+'</div></section>').join('');
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
      get('shippingPublishedCalendar').textContent=calendar ? 'Nonworking weekdays: '+calendar.nonworking_weekdays.map(day=>['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][day-1]).join(', ')+'. Additional nonworking dates: '+(calendar.nonworking_dates.join(', ')||'None')+'.' : '';
      sync();
    };
    const error = message => {get('shippingError').hidden=false;get('shippingErrorText').textContent=message;};
    const fetchData = async (path,options={}) => {
      const response=await fetch(api+path,{...options,headers:headers()});
      const json=await response.json().catch(()=>({}));
      if (!response.ok) throw new Error(Object.values(json.errors || {}).flat()[0] || json.message || 'Shipping settings could not be saved. Please retry.');
      return json.data;
    };
    const load = async () => {
      busy=true;loaded=false;sync();get('shippingError').hidden=true;
      try { populate(await fetchData('/admin/shipping-settings')); }
      catch { error('Shipping settings could not be loaded. Retry before editing.'); }
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
