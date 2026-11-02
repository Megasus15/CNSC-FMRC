/* One operational appointment editor is shared by Admin and Staff. */
(() => {
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const api=()=>String(window.APP_API_BASE_URL||(['localhost','127.0.0.1'].includes(location.hostname)&&location.port!=='8000'?location.protocol+'//'+location.hostname+':8000/api':location.origin+'/api')).replace(/\/$/,'');
  const token=()=>window.AdminSession?.getToken()||'';
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-private-appointment-file]');if(!button||button.disabled)return;
    button.disabled=true;const original=button.textContent;button.textContent='Preparing file…';
    try{const response=await fetch(api()+'/customer/appointments/'+button.dataset.appointment+'/attachments/'+button.dataset.privateAppointmentFile,{headers:{Authorization:'Bearer '+token(),Accept:'application/octet-stream'},signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error();const href=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=href;link.download=button.dataset.filename||'design-file';link.click();setTimeout(()=>URL.revokeObjectURL(href),1000);}
    catch{window.showAdminPopup?.('The file could not be downloaded. Please try again.',{title:'Attachment Unavailable'});}
    finally{button.disabled=false;button.textContent=original;}
  });
  const files=appointment=>(appointment.attachments||[]).map(file=>'<button type="button" class="photo-link appointment-file-button" data-private-appointment-file="'+escape(file.id)+'" data-appointment="'+appointment.id+'" data-filename="'+escape(file.name)+'">'+escape(file.name)+'</button>').join('<br>');
  const render=(appointment,host)=>{
    if(!host)return;
    const card=document.createElement('section');card.className='appointment-operational';host.appendChild(card);
    const online=appointment.appointment_method==='online';
    card.innerHTML='<h4>Appointment method</h4><p>'+escape(appointment.method_label||'Not recorded')+'</p>'+(online?'<p data-meeting-summary>'+escape(appointment.meeting_status||'Meeting link pending')+(appointment.meeting_url?' · <a class="photo-link" href="'+escape(appointment.meeting_url)+'" target="_blank" rel="noopener noreferrer">Join '+escape(appointment.meeting_platform||'online meeting')+'</a>':'')+'</p>':'')+
      (online&&appointment.can_reschedule?'<form data-meeting-form><fieldset><div class="appointment-meeting-fields"><div class="field-stack"><label for="appointmentMeetingPlatform">Online platform</label><input class="input-field" id="appointmentMeetingPlatform" name="platform" maxlength="60" placeholder="Zoom, Google Meet, or another platform" value="'+escape(appointment.meeting_platform)+'"></div><div class="field-stack"><label for="appointmentMeetingLink">HTTPS meeting link</label><input class="input-field" id="appointmentMeetingLink" name="meeting_url" type="url" maxlength="2000" placeholder="https://" value="'+escape(appointment.meeting_url)+'"></div></div><p>Provide the current schedule’s link. Rescheduling clears previous meeting details. Clear both fields to show “Meeting link pending.”</p><button type="submit" class="btn-admin" disabled data-save-meeting>Save meeting details</button></fieldset><p role="status" aria-live="polite" data-meeting-status></p></form>':'')+
      ((appointment.schedule_history||[]).length?'<details><summary>Schedule history</summary><ol>'+appointment.schedule_history.map(entry=>'<li>'+escape(entry.previous_date+' · '+entry.previous_time)+' → '+escape(entry.appointment_date+' · '+entry.appointment_time)+'</li>').join('')+'</ol></details>':'');
    const form=card.querySelector('form');if(!form)return;
    let busy=false,blocked=false;const baseline=JSON.stringify({platform:appointment.meeting_platform||'',meeting_url:appointment.meeting_url||''});
    const values=()=>({platform:form.elements.platform.value.trim(),meeting_url:form.elements.meeting_url.value.trim()});
    const sync=()=>{form.querySelector('fieldset').disabled=busy||blocked;form.querySelector('[type=submit]').disabled=busy||blocked||JSON.stringify(values())===baseline;form.setAttribute('aria-busy',String(busy));};
    form.oninput=sync;
    form.onsubmit=event=>{
      event.preventDefault();if(busy||blocked||!form.reportValidity())return;const input=values();
      if(input.meeting_url){try{const url=new URL(input.meeting_url);if(url.protocol!=='https:'||url.username||url.password||!input.platform)throw Error();}catch{form.querySelector('[data-meeting-status]').textContent='Enter a platform name and a valid HTTPS meeting link.';return;}}
      window.showAdminConfirmPopup('Save the online meeting details for this appointment?',{title:'Save Meeting Details',confirmText:'Save details',onConfirm:async()=>{
        if(busy)return;busy=true;sync();const status=form.querySelector('[data-meeting-status]');status.textContent='Saving meeting information…';
        try{const response=await fetch(api()+'/admin/appointments/'+appointment.id+'/meeting',{method:'PATCH',headers:{Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+token()},body:JSON.stringify({...input,expected_version:appointment.schedule_version}),signal:AbortSignal.timeout(30000)});const json=await response.json().catch(()=>({}));if(!response.ok){if(response.status===409)blocked=true;throw Error(Object.values(json.errors||{}).flat()[0]||json.message||'Meeting details could not be saved. Please try again.');}window.dispatchEvent(new CustomEvent('fmrc:appointment-updated',{detail:{appointment:json.data}}));}
        catch(error){status.textContent=blocked?'This appointment has changed. Close and reopen its details before saving.':error.message;}
        finally{busy=false;sync();}
      }});
    };
  };
  window.AdminAppointmentDetails={render,files};
})();
