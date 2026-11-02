/* Customer appointment access uses the same authenticated owner as booking. */
(() => {
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const api=()=>String(window.APP_API_BASE_URL||(['localhost','127.0.0.1'].includes(location.hostname)&&location.port!=='8000'?location.protocol+'//'+location.hostname+':8000/api':location.origin+'/api')).replace(/\/$/,'');
  const token=()=>localStorage.getItem('customer_token')||'';
  const dateLabel=date=>new Date(date+'T12:00:00+08:00').toLocaleDateString('en-PH',{timeZone:'Asia/Manila',month:'long',day:'numeric',year:'numeric'});
  let overlay,active=null,calendar=null,busy=false,loadVersion=0,opener;
  const request=async(path,options={})=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
    try{const response=await fetch(api()+path,{...options,headers:{Accept:'application/json',Authorization:'Bearer '+token(),'Content-Type':'application/json'},signal:controller.signal});const json=await response.json().catch(()=>({}));if(!response.ok){const error=Error(Object.values(json.errors||{}).flat()[0]||json.message||'Appointment details could not be loaded. Please try again.');error.status=response.status;throw error;}return json;}
    catch(error){if(error.name==='AbortError'||error.name==='TypeError')throw Error('The request could not be confirmed. Refresh your appointment before trying again.');throw error;}
    finally{clearTimeout(timer);}
  };
  const message=(text,error=false)=>{const node=overlay.querySelector('[data-appointment-message]');node.textContent=text;node.classList.toggle('is-error',error);};
  const controls=()=>{overlay.setAttribute('aria-busy',String(busy));overlay.querySelectorAll('[data-appointment-action],fieldset').forEach(node=>node.disabled=busy);const form=overlay.querySelector('[data-appointment-reschedule]');if(form){const stale=form.dataset.needsRefresh==='true';form.querySelector('fieldset').disabled=busy||stale;form.querySelector('[type=submit]').disabled=busy||stale||form.elements.appointment_time.options.length<2;}};
  const currentReceipt=item=>'<a class="appointment-text-link" href="'+escape(item.qr_payload||'/appointments/verify/'+encodeURIComponent(item.reference_no))+'" target="_blank" rel="noopener noreferrer">Open current receipt</a>';
  const detail=item=>{
    active=item;
    const meeting=item.appointment_method==='online'?'<p><strong>'+escape(item.meeting_status||'Meeting link pending')+'</strong>'+(item.meeting_url?'<br><a class="appointment-text-link" href="'+escape(item.meeting_url)+'" target="_blank" rel="noopener noreferrer">Join '+escape(item.meeting_platform||'online meeting')+'</a>':'<br>FMRC will provide the platform and meeting link here.')+'</p>':'<p>Visit the Fabrication and Manufacturing Research Center (FMRC) for your appointment.</p>';
    const files=(item.attachments||[]).map(file=>'<li><button class="appointment-text-link" type="button" data-appointment-download="'+escape(file.id)+'">'+escape(file.name)+'</button></li>').join('');
    const history=(item.schedule_history||[]).map(entry=>'<li>'+escape(dateLabel(entry.previous_date)+' · '+entry.previous_time)+' → '+escape(dateLabel(entry.appointment_date)+' · '+entry.appointment_time)+'</li>').join('');
    overlay.querySelector('[data-appointment-content]').innerHTML='<button type="button" class="ux-dlg__btn ux-dlg__btn--secondary" data-appointment-back>All appointments</button><article class="appointment-detail"><div class="appointment-card-heading"><h3>'+escape(item.reference_no)+'</h3><span>'+escape(item.status)+'</span></div><h4>'+escape(item.purpose)+'</h4><p><strong>'+escape(dateLabel(item.appointment_date))+' · '+escape(item.appointment_time)+'</strong><br>Philippine time (Asia/Manila)</p><p>'+escape(item.method_label||'Appointment method not recorded')+'</p>'+meeting+currentReceipt(item)+'<h4>Private design files</h4>'+(files?'<ul class="appointment-files">'+files+'</ul>':'<p>No design files attached.</p>')+(history?'<details><summary>Schedule history</summary><ol>'+history+'</ol></details>':'')+(item.can_reschedule?'<form data-appointment-reschedule><h4>Reschedule appointment</h4><p>Choose another available schedule before your original appointment starts. A previous meeting link is cleared when the schedule changes.</p><fieldset><div class="appointment-fields"><label>New date<input class="c-input" name="appointment_date" type="date" required min="'+escape(calendar.today)+'" value="'+escape(item.appointment_date)+'"></label><label>Available time<select class="c-input" name="appointment_time" required></select></label></div><button type="submit" class="ux-dlg__btn ux-dlg__btn--primary" data-appointment-action>Confirm reschedule</button></fieldset></form>':'<p>Rescheduling is available only for an upcoming active appointment before its original start.</p>')+'</article>';
    overlay.querySelector('[data-appointment-back]').onclick=load;
    overlay.querySelectorAll('[data-appointment-download]').forEach(button=>button.onclick=()=>download(item,button));
    const form=overlay.querySelector('[data-appointment-reschedule]');
    if(form){const date=form.elements.appointment_date;date.onchange=()=>times(form,item);times(form,item);form.onsubmit=event=>reschedule(event,item);}
    message('Current appointment details loaded.');controls();
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
  const load=async()=>{
    if(busy)return;const version=++loadVersion;busy=true;controls();message('Loading your appointments…');
    try{const [json,availability]=await Promise.all([request('/customer/appointments'),request('/appointments/calendar')]);if(version!==loadVersion)return;calendar=availability;active=null;
      overlay.querySelector('[data-appointment-content]').innerHTML=json.data.length?'<div class="appointment-list">'+json.data.map(item=>'<article class="appointment-detail"><div class="appointment-card-heading"><h3>'+escape(item.reference_no)+'</h3><span>'+escape(item.status)+'</span></div><p>'+escape(item.purpose)+'</p><p><strong>'+escape(dateLabel(item.appointment_date))+' · '+escape(item.appointment_time)+'</strong><br>'+escape(item.method_label||'Method not recorded')+'</p><button type="button" class="ux-dlg__btn ux-dlg__btn--secondary" data-appointment-view="'+item.id+'">View appointment</button></article>').join('')+'</div>':'<p class="appointment-empty">You have no appointments yet. Book an appointment from the Home page.</p>';
      overlay.querySelectorAll('[data-appointment-view]').forEach(button=>button.onclick=()=>detail(json.data.find(item=>item.id===Number(button.dataset.appointmentView))));message('Your appointments are up to date.');}
    catch(error){message(error.message,true);}finally{busy=false;controls();}
  };
  const open=()=>{
    if(!token())return window.showCustomerPopup('Sign in to view your appointments.',{title:'Sign in required'});
    if(!overlay){overlay=document.createElement('div');overlay.id='customerAppointmentsModal';overlay.className='customer-orders-overlay ux-dlg';overlay.innerHTML='<section class="customer-orders-modal ux-dlg__card" role="dialog" aria-modal="true" aria-labelledby="customerAppointmentsTitle"><header class="customer-orders-head ux-dlg__head"><button type="button" class="customer-orders-close ux-dlg__close" data-appointments-close aria-label="Close My Appointments">×</button><span class="ux-dlg__badge" aria-hidden="true"><i class="fa-regular fa-calendar-check"></i></span><p class="ux-dlg__eyebrow">Your FMRC schedule</p><h2 class="ux-dlg__title" id="customerAppointmentsTitle">My Appointments</h2><p>Schedules and online meeting details in Philippine time.</p><p role="status" aria-live="polite" data-appointment-message></p></header><div class="appointment-content" data-appointment-content></div><button type="button" class="ux-dlg__btn ux-dlg__btn--secondary" data-appointment-action data-appointments-refresh>Refresh appointments</button></section>';document.body.appendChild(overlay);overlay.querySelector('[data-appointments-close]').onclick=close;overlay.querySelector('[data-appointments-refresh]').onclick=load;
      overlay.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}if(event.key==='Tab'){const nodes=[...overlay.querySelectorAll('button:not(:disabled),a,input:not(:disabled),select:not(:disabled)')].filter(node=>node.getClientRects().length);if(event.shiftKey&&document.activeElement===nodes[0]){event.preventDefault();nodes.at(-1)?.focus();}else if(!event.shiftKey&&document.activeElement===nodes.at(-1)){event.preventDefault();nodes[0]?.focus();}}});
    }
    opener=document.activeElement;overlay.classList.add('show');document.body.style.overflow='hidden';overlay.querySelector('[data-appointments-close]').focus();load();
  };
  const close=()=>{if(busy)return;overlay.classList.remove('show');document.body.style.overflow='';opener?.focus();};
  window.FMRCAppointments={open};
})();
