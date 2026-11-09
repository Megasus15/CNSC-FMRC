/* Customer appointment access uses the same authenticated owner as booking. */
(() => {
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const api=()=>String(window.APP_API_BASE_URL||(['localhost','127.0.0.1'].includes(location.hostname)&&location.port!=='8000'?location.protocol+'//'+location.hostname+':8000/api':location.origin+'/api')).replace(/\/$/,'');
  const token=()=>localStorage.getItem('customer_token')||'';
  const dateLabel=date=>new Date(date+'T12:00:00+08:00').toLocaleDateString('en-PH',{timeZone:'Asia/Manila',month:'long',day:'numeric',year:'numeric'});
  let overlay,active=null,calendar=null,busy=false,loadVersion=0,opener,meetingTimer,meetingBusy=false;
  const statusBadge=item=>{const status=item.status==='Archived'?'Completed':item.status;return '<span class="appointment-status" data-status="'+escape(String(status||'').toLowerCase())+'">'+escape(status||'Status unavailable')+'</span>';};
  const deleteButton=item=>item.can_delete?'<button type="button" class="appointment-button ux-dlg__btn ux-dlg__btn--ghost appointment-delete" data-appointment-action data-appointment-delete="'+item.id+'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg>Delete</button>':'';
  const methodLabel=item=>item.appointment_method==='online'?'Online':item.appointment_method==='face_to_face'?'Face-to-face at FMRC':'Not recorded';
  const schedule=item=>'<dl class="appointment-schedule"><div><dt>Date</dt><dd>'+escape(dateLabel(item.appointment_date))+'</dd></div><div><dt>Time</dt><dd>'+escape(item.appointment_time)+'</dd></div><div><dt>Method</dt><dd>'+escape(methodLabel(item))+'</dd></div></dl>';
  const heading=detail=>{
    overlay.querySelector('#customerAppointmentsTitle').textContent=detail?'Appointment details':'My Appointments';
    overlay.querySelector('[data-appointment-subtitle]').textContent=detail?'Everything you need for your appointment, in one place.':'View your schedule, meeting details, and submitted designs.';
  };
  const request=async(path,options={})=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
    try{const response=await fetch(api()+path,{...options,cache:'no-store',headers:{Accept:'application/json',Authorization:'Bearer '+token(),'Content-Type':'application/json'},signal:controller.signal});const json=await response.json().catch(()=>({}));if(!response.ok){const error=Error(Object.values(json.errors||{}).flat()[0]||json.message||'Appointment details could not be loaded. Please try again.');error.status=response.status;throw error;}return json;}
    catch(error){if(error.name==='AbortError'||error.name==='TypeError')throw Error('The request could not be confirmed. Refresh your appointment before trying again.');throw error;}
    finally{clearTimeout(timer);}
  };
  const message=(text,error=false)=>{const node=overlay.querySelector('[data-appointment-message]');node.textContent=text;node.hidden=!text;node.classList.toggle('is-error',error);node.setAttribute('aria-live',error?'assertive':'polite');};
  const controls=()=>{overlay.setAttribute('aria-busy',String(busy));overlay.querySelectorAll('[data-appointment-action],fieldset').forEach(node=>node.disabled=busy);const form=overlay.querySelector('[data-appointment-reschedule]');if(form){const stale=form.dataset.needsRefresh==='true';form.querySelector('fieldset').disabled=busy||stale;form.querySelector('[type=submit]').disabled=busy||stale||form.elements.appointment_time.options.length<2;}};
  const currentReceipt=item=>'<a class="appointment-button ux-dlg__btn ux-dlg__btn--ghost" href="'+escape(item.qr_payload||'/appointments/verify/'+encodeURIComponent(item.reference_no))+'" target="_blank" rel="noopener noreferrer">View receipt </a>';
  const meetingSection=item=>item.appointment_method==='online'?'<section class="appointment-section" data-appointment-meeting><div class="appointment-section-heading"><h3 tabindex="-1">Online meeting</h3><span class="appointment-method-tag">Online</span></div><div class="appointment-meeting-summary"><div><strong>'+escape(item.meeting_status||'Meeting link pending')+'</strong><p>'+escape(item.meeting_url?(item.meeting_platform||'Online meeting'):item.can_reschedule?'The FMRC team will add your platform and meeting link here.':'No online meeting link is currently shared.')+'</p></div>'+(item.meeting_url?'<a class="appointment-button ux-dlg__btn ux-dlg__btn--primary" data-appointment-join href="'+escape(item.meeting_url)+'" target="_blank" rel="noopener noreferrer">Join meeting</a>':'')+'</div></section>':item.appointment_method==='face_to_face'?'<section class="appointment-section"><h3>Appointment location</h3><p>Fabrication and Manufacturing Research Center (FMRC)</p><p class="appointment-help">Visit FMRC at your scheduled date and time.</p></section>':'';
  const refreshMeeting=async()=>{
    if(meetingBusy||busy||!active||active.appointment_method!=='online'||document.hidden||!overlay?.classList.contains('show'))return;
    const id=active.id,generation=loadVersion,ownerToken=token();meetingBusy=true;
    try{
      const {data}=await request('/customer/appointments/'+encodeURIComponent(id));
      if(!overlay.classList.contains('show')||active?.id!==id||loadVersion!==generation||token()!==ownerToken||Number(data.schedule_version)<Number(active.schedule_version))return;
      const keys=['meeting_platform','meeting_url','meeting_status','schedule_version'];
      if(keys.every(key=>data[key]===active[key]))return;
      const section=overlay.querySelector('[data-appointment-meeting]');if(!section)return;
      const body=overlay.querySelector('[data-appointment-content]'),scroll=body.scrollTop,wasFocused=section.contains(document.activeElement);
      keys.forEach(key=>active[key]=data[key]);section.outerHTML=meetingSection(active);body.scrollTop=scroll;
      if(wasFocused)overlay.querySelector('[data-appointment-meeting] h3')?.focus({preventScroll:true});
    }catch{/* Retain the last confirmed meeting information during a temporary connection failure. */}
    finally{meetingBusy=false;}
  };
  const detail=item=>{
    active=item;heading(true);
    const meeting=meetingSection(item);
    const files=(item.attachments||[]).map(file=>'<li><button class="appointment-file" type="button" data-appointment-download="'+escape(file.id)+'"><span class="appointment-file-name">'+escape(file.name)+'</span><span class="appointment-file-action">Download </span></button></li>').join('');
    const history=(item.schedule_history||[]).map(entry=>'<li><span>Previous schedule</span><p>'+escape(dateLabel(entry.previous_date)+' · '+entry.previous_time)+'</p><span>Updated schedule</span><p>'+escape(dateLabel(entry.appointment_date)+' · '+entry.appointment_time)+'</p></li>').join('');
    overlay.querySelector('[data-appointment-content]').innerHTML='<div class="appointment-detail-toolbar"><button type="button" class="appointment-button ux-dlg__btn ux-dlg__btn--ghost" data-appointment-action data-appointment-back> All appointments</button>'+currentReceipt(item)+'</div><article class="appointment-detail"><section class="appointment-section appointment-overview"><div class="appointment-card-heading"><span class="appointment-reference">'+escape(item.reference_no)+'</span>'+statusBadge(item)+'</div><h3 class="appointment-service">'+escape(item.purpose||'FMRC appointment')+'</h3>'+schedule(item)+'<p class="appointment-time-note">Philippine time (UTC+8).</p></section>'+meeting+'<section class="appointment-section"><div class="appointment-section-heading"><h3>Design files</h3><span class="appointment-section-count">'+(item.attachments||[]).length+' '+((item.attachments||[]).length===1?'file':'files')+'</span></div><p class="appointment-help">These files are available only to you and the FMRC team.</p>'+(files?'<ul class="appointment-files">'+files+'</ul>':'<p class="appointment-empty-note">No design files were submitted.</p>')+'</section>'+(history?'<details class="appointment-section appointment-history"><summary>View schedule history</summary><ol>'+history+'</ol></details>':'')+(item.can_reschedule?'<section class="appointment-section"><form data-appointment-reschedule><h3>Reschedule appointment</h3><p class="appointment-help">Choose an available date and time before your appointment begins.</p><fieldset><div class="appointment-fields"><label>New date<input class="c-input" name="appointment_date" type="date" required min="'+escape(calendar.today)+'" value="'+escape(item.appointment_date)+'"></label><label>Available time<select class="c-input" name="appointment_time" required></select></label></div>'+(item.appointment_method==='online'?'<p class="appointment-help">Rescheduling clears the previous meeting link. The FMRC team will add a new link here.</p>':'')+'<div class="appointment-section-actions"><button type="submit" class="appointment-button ux-dlg__btn ux-dlg__btn--primary" data-appointment-action>Confirm reschedule</button></div></fieldset></form></section>':'<section class="appointment-section"><h3>Rescheduling</h3><p class="appointment-help">This appointment can no longer be rescheduled. Contact the FMRC team if you need assistance.</p></section>')+'</article>';
    overlay.querySelector('[data-appointment-back]').onclick=load;
    if(item.can_delete){const receipt=overlay.querySelector('.appointment-detail-toolbar a');receipt.insertAdjacentHTML('beforebegin',deleteButton(item));overlay.querySelector('[data-appointment-delete]').onclick=()=>remove(item);}
    overlay.querySelectorAll('[data-appointment-download]').forEach(button=>button.onclick=()=>download(item,button));
    const form=overlay.querySelector('[data-appointment-reschedule]');
    if(form){const date=form.elements.appointment_date;date.onchange=()=>times(form,item);times(form,item);form.onsubmit=event=>reschedule(event,item);}
    const ready=window.FMRCAppointmentProducts?.mountCustomer(overlay.querySelector('[data-appointment-content]'),item);
    message('');controls();overlay.querySelector('[data-appointment-content]').scrollTop=0;overlay.querySelector('[data-appointment-back]').focus({preventScroll:true});
    return ready;
  };
  const times=(form,item)=>{
    const date=form.elements.appointment_date.value,setting=(calendar.day_settings||[]).find(day=>day.date===date),day=new Date(date+'T12:00:00+08:00').getUTCDay();
    const slots=[...(calendar.time_slots||[]),...(setting?.custom_slots||[])];
    const unique=new Set(),select=form.elements.appointment_time;select.replaceChildren(new Option('Choose an available time',''));
    const booked=calendar.booked_slots?.[date]||[],blocked=setting?.blocked_slots||[];
    if(!setting?.is_blocked&&day!==0&&day!==6)for(const slot of slots){const label=slot.label;if(unique.has(label)||blocked.includes(label)||(booked.includes(label)&&!(date===item.appointment_date&&label===item.appointment_time)))continue;unique.add(label);select.add(new Option(label,label));}
    if(unique.size===0)select.options[0].textContent='No available time slots';
    form.querySelector('[type=submit]').disabled=busy||unique.size===0;
  };
  const reschedule=async(event,item)=>{
    event.preventDefault();const form=event.target;if(busy||!form.reportValidity())return;
    const date=form.elements.appointment_date.value,time=form.elements.appointment_time.value;
    if(date===item.appointment_date&&time===item.appointment_time){message('Choose a different date or time.',true);return;}
    const confirmed=await window.showCustomerPopup('Move your appointment to '+dateLabel(date)+' at '+time+' (Philippine time)? Any previous meeting link will be cleared.',{title:'Reschedule appointment',okText:'Confirm reschedule',isConfirm:true});
    if(!confirmed||busy)return;busy=true;controls();message('Saving your new schedule…');
    try{const json=await request('/customer/appointments/'+item.id+'/reschedule',{method:'POST',body:JSON.stringify({appointment_date:date,appointment_time:time,expected_date:item.appointment_date,expected_time:item.appointment_time,expected_version:item.schedule_version})});let availabilityError=false;try{calendar=await request('/appointments/calendar');}catch{availabilityError=true;}detail(json.data);if(availabilityError){const currentForm=overlay.querySelector('[data-appointment-reschedule]');if(currentForm)currentForm.dataset.needsRefresh='true';message('Appointment rescheduled and receipt updated. Refresh appointments before choosing another schedule.');}else message('Appointment rescheduled. Your current receipt and schedule are updated.');}
    catch(error){message(error.message,true);form.querySelector('fieldset').disabled=true;form.querySelector('[type=submit]').disabled=true;form.dataset.needsRefresh='true';}
    finally{busy=false;controls();if(form.dataset.needsRefresh==='true')form.querySelector('fieldset').disabled=true;}
  };
  const download=async(item,button)=>{
    if(button.disabled)return;button.disabled=true;message('Preparing your private file…');
    const file=item.attachments.find(file=>String(file.id)===button.dataset.appointmentDownload);
    try{const response=await fetch(api()+'/customer/appointments/'+item.id+'/attachments/'+file.id,{headers:{Accept:'application/octet-stream',Authorization:'Bearer '+token()},signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error();const href=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=href;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(href),1000);message('File ready.');}
    catch{message('The file could not be downloaded. Please try again.',true);}finally{button.disabled=false;}
  };
  const remove=async item=>{
    if(busy||!item.can_delete)return;
    if(window.FMRCAppointmentProducts&&!await window.FMRCAppointmentProducts.allowLeave(overlay))return;
    const trigger=overlay.querySelector('[data-appointment-delete="'+item.id+'"]');let removed=false;
    busy=true;controls();
    try{
      const confirmed=await window.showCustomerPopup('Delete '+item.reference_no+' from My Appointments? The FMRC team keeps the consultation history. Any custom-product request or linked order will continue.',{title:'Delete appointment',isConfirm:true,okText:'Delete',cancelText:'Keep appointment'});
      if(!confirmed)return;
      await request('/customer/appointments/'+item.id,{method:'DELETE'});
      removed=true;overlay.querySelectorAll('form[data-dirty]').forEach(form=>form.dataset.dirty='false');
      pendingId=null;active=null;busy=false;await load();
      window.dispatchEvent(new CustomEvent('fmrc:appointment-deleted',{detail:{id:item.id}}));
      await window.showCustomerPopup('Appointment deleted from My Appointments.',{title:'Appointment deleted'});
    }catch(error){await window.showCustomerPopup(error.message,{title:'Appointment not deleted'});}
    finally{busy=false;controls();if(!removed&&trigger?.isConnected)trigger.focus({preventScroll:true});else overlay.querySelector('[data-appointments-close]')?.focus({preventScroll:true});}
  };
  const load=async({preserveScroll=false}={})=>{
    if(busy)return;if(window.FMRCAppointmentProducts&&!await window.FMRCAppointmentProducts.allowLeave(overlay))return;if(busy)return;const version=++loadVersion,scroll=preserveScroll?overlay.querySelector('[data-appointment-content]').scrollTop:0;busy=true;controls();message('Loading your appointments…');
    try{const [json,availability]=await Promise.all([request('/customer/appointments'),request('/appointments/calendar')]);if(version!==loadVersion)return;calendar=availability;active=null;
      json.data=[...json.data].sort((a,b)=>(Date.parse(b.created_at)||0)-(Date.parse(a.created_at)||0)||Number(b.id)-Number(a.id));
      heading(false);overlay.querySelector('.appointment-modal').classList.remove('has-custom-product');
      overlay.querySelector('[data-appointment-content]').innerHTML=json.data.length?'<div class="appointment-list-heading"><p>All times are in Philippine time (UTC+8).</p><span>'+json.data.length+' '+(json.data.length===1?'appointment':'appointments')+'</span></div><div class="appointment-list">'+json.data.map(item=>'<article class="appointment-card"><div class="appointment-card-heading"><span class="appointment-reference">'+escape(item.reference_no)+'</span>'+statusBadge(item)+'</div><h3 class="appointment-service">'+escape(item.purpose||'FMRC appointment')+'</h3>'+schedule(item)+'<div class="appointment-card-actions"><button type="button" class="appointment-button ux-dlg__btn ux-dlg__btn--primary" data-appointment-action data-appointment-view="'+item.id+'">View appointment </button></div></article>').join('')+'</div>':'<div class="appointment-empty"><span class="appointment-empty-icon" aria-hidden="true">◷</span><h3>No appointments yet</h3><p>Your bookings will appear here. Visit the Home page to schedule an appointment with the FMRC team.</p></div>';
      overlay.querySelectorAll('[data-appointment-view]').forEach(button=>button.onclick=()=>detail(json.data.find(item=>item.id===Number(button.dataset.appointmentView))));overlay.querySelectorAll('.appointment-card').forEach((card,index)=>{const item=json.data[index];if(item.can_delete){card.querySelector('.appointment-card-actions').insertAdjacentHTML('afterbegin',deleteButton(item));card.querySelector('[data-appointment-delete]').onclick=()=>remove(item);}});message('');overlay.querySelector('[data-appointment-content]').scrollTop=0;window.FMRCAppointmentProducts?.draftList(overlay.querySelector('[data-appointment-content]'));if(pendingId){const id=pendingId;pendingId=null;const match=json.data.find(a=>String(a.id)===String(id))||(await request('/customer/appointments/'+encodeURIComponent(id))).data;if(match){detail(match);if(match.deleted_from_list)message('This appointment was deleted from your list. Its custom-product history remains available here.');}}}
    catch(error){message(error.message,true);}finally{busy=false;controls();if(preserveScroll){overlay.querySelector('[data-appointment-content]').scrollTop=scroll;overlay.querySelector('[data-appointments-refresh]').focus({preventScroll:true});}}
  };
  const refresh=async()=>{
    if(!active)return load({preserveScroll:true});
    if(busy||window.FMRCAppointmentProducts&&!await window.FMRCAppointmentProducts.allowLeave(overlay))return;
    if(busy)return;
    const item=active,version=++loadVersion,body=overlay.querySelector('[data-appointment-content]'),scroll=body.scrollTop;
    const tab=body.querySelector('[data-ap-tab][aria-selected="true"]')?.dataset.apTab;
    const expanded=new Map([...body.querySelectorAll('details')].map(node=>[node.querySelector('summary')?.textContent,node.open]));
    busy=true;controls();message('Refreshing appointment details…');
    try{
      const [json,availability]=await Promise.all([request('/customer/appointments/'+encodeURIComponent(item.id)),request('/appointments/calendar')]);
      if(version!==loadVersion)return;
      calendar=availability;await detail(json.data);
      if(tab!==undefined)body.querySelector('[data-ap-tab="'+tab+'"]')?.click();
      body.querySelectorAll('details').forEach(node=>{const name=node.querySelector('summary')?.textContent;if(expanded.has(name))node.open=expanded.get(name);});
    }catch(error){message(error.message,true);}
    finally{busy=false;controls();body.scrollTop=scroll;overlay.querySelector('[data-appointments-refresh]').focus({preventScroll:true});}
  };
  let pendingId=null;
  const open=id=>{
    pendingId=id||null;
    if(!token())return window.showCustomerPopup('Sign in to view your appointments.',{title:'Sign in required'});
    if(!overlay){overlay=document.createElement('div');overlay.id='customerAppointmentsModal';overlay.className='appointment-modal-overlay ux-dlg';overlay.innerHTML="<section class=\"appointment-modal ux-dlg__card\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"customerAppointmentsTitle\" aria-describedby=\"customerAppointmentsSubtitle\">\n  <header class=\"appointment-modal-head ux-dlg__head\">\n    <button type=\"button\" class=\"appointment-close ux-dlg__close\" data-appointments-close aria-label=\"Close appointments\">×</button>\n    <span class=\"ux-dlg__badge\" aria-hidden=\"true\"><svg width=\"22\" height=\"22\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M16 3v4M8 3v4M3 11h18M8 16l2 2 5-5\"/></svg></span>\n    <p class=\"ux-dlg__eyebrow\">Customer appointments</p>\n    <h2 class=\"ux-dlg__title\" id=\"customerAppointmentsTitle\">My Appointments</h2>\n    <p id=\"customerAppointmentsSubtitle\" data-appointment-subtitle hidden>View your schedule, meeting details, and submitted designs.</p>\n  </header>\n  <p class=\"appointment-notice\" role=\"status\" aria-live=\"polite\" data-appointment-message hidden></p>\n  <div class=\"appointment-content\" data-appointment-content></div>\n  <footer class=\"appointment-modal-footer ux-dlg__foot is-confirm\">\n    <button type=\"button\" class=\"appointment-button ux-dlg__btn ux-dlg__btn--ghost\" data-appointment-action data-appointments-refresh>Refresh</button>\n    <button type=\"button\" class=\"appointment-button ux-dlg__btn ux-dlg__btn--primary\" data-appointments-close>Close</button>\n  </footer>\n</section>";document.body.appendChild(overlay);overlay.querySelectorAll('[data-appointments-close]').forEach(button=>button.onclick=close);overlay.querySelector('[data-appointments-refresh]').onclick=refresh;
      overlay.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}if(event.key==='Tab'){const nodes=[...overlay.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),summary')].filter(node=>node.getClientRects().length);if(event.shiftKey&&document.activeElement===nodes[0]){event.preventDefault();nodes.at(-1)?.focus();}else if(!event.shiftKey&&document.activeElement===nodes.at(-1)){event.preventDefault();nodes[0]?.focus();}}});
    }
    opener=document.activeElement;overlay.classList.add('show');document.body.style.overflow='hidden';overlay.querySelector('[data-appointments-close]').focus();load();clearInterval(meetingTimer);meetingTimer=setInterval(refreshMeeting,15000);
  };
  const close=async()=>{if(busy)return;if(window.FMRCAppointmentProducts&&!await window.FMRCAppointmentProducts.allowLeave(overlay))return;clearInterval(meetingTimer);overlay.classList.remove('show');document.body.style.overflow='';opener?.focus();};
  addEventListener('focus',()=>void refreshMeeting());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refreshMeeting();});
  window.FMRCAppointments={open};
})();
