/* Personal account updates share the existing bell, dialog and announcement shell. */
(() => {
  'use strict';
  if(/\/(?:admin-page|staff-page|admin-auth)\//.test(location.pathname))return;
  const token=()=>localStorage.getItem('customer_token')||'';
  const api=()=>String(window.APP_API_BASE_URL||location.origin+'/api').replace(/\/+$/,'');
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const svg=path=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  const icons={
    bell:svg('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/>'),
    appointment:svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18m-14 5 3 3 7-7"/>'),
    order:svg('<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 5v9l9 5 9-5V8M12 13v9M7 5l9 5"/>'),
    payment:svg('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>'),
    return:svg('<path d="M9 10H3V4m0 6 4-4a8 8 0 1 1-1 11"/>'),
    previous:svg('<path d="m14 6-6 6 6 6"/>'),next:svg('<path d="m10 6 6 6-6 6"/>'),
  };
  let modal,body,footer,tabs,announcementIcon,personalUnread=0,announcementUnread=0,page=1,pages=1,rows=[],through=0,session=token(),loading=false,busy=false,error='',timer,failures=0,generation=0;
  const count=n=>Number(n)>99?'99+':Number(n)>0?String(Math.trunc(n)):'';
  const visible=()=>modal&&!modal.hidden&&modal.dataset.section==='notifications';
  const request=async(path,options={})=>{
    const response=await fetch(api()+'/customer/notifications'+path,{...options,cache:'no-store',headers:{Accept:'application/json',Authorization:'Bearer '+token(),'Content-Type':'application/json'},signal:AbortSignal.timeout(20000)});
    const result=await response.json().catch(()=>({}));
    if(!response.ok){const problem=Error(response.status===401?'Sign in to view your personal updates.':'Notifications could not be loaded. Please try again.');problem.status=response.status;throw problem;}
    return result;
  };
  const updateBadge=()=>{window.FMRCAnnouncements?.refreshBadge();};
  const tabCounts=()=>{
    if(!tabs)return;
    for(const [name,value] of [['notifications',personalUnread],['announcements',announcementUnread]]){
      const badge=tabs.querySelector(`[data-count="${name}"]`);badge.textContent=count(value);badge.hidden=!count(value);
    }
  };
  const date=value=>{const d=new Date(/^\d{4}-\d{2}-\d{2} \d{2}:/.test(value)?value.replace(' ','T')+'Z':value);return Number.isNaN(d.getTime())?'':new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}).format(d);};
  function render(){
    if(!body)return;
    const active=document.activeElement?.closest('[data-notification-id]')?.dataset.notificationId,scroll=body.parentElement.scrollTop;
    if(!token())body.innerHTML=`<div class="fmrc-notifications-empty">${icons.bell}<h3>Your updates, in one place</h3><p>Sign in to see appointment, quotation, payment and order updates.</p><a class="fmrc-announcement__button" href="${esc(window.FMRCApp?.url('/customer-auth/auth.html#login')||'/customer-auth/auth.html#login')}">Sign In</a></div>`;
    else if(error)body.innerHTML=`<div class="fmrc-notifications-empty">${icons.bell}<h3>Updates are unavailable</h3><p>${esc(error)}</p><button type="button" class="fmrc-announcement__button" data-notifications-retry>Try again</button></div>`;
    else if(loading&&!rows.length)body.innerHTML='<div class="fmrc-notifications-empty" role="status"><p>Loading your updates…</p></div>';
    else if(!rows.length)body.innerHTML=`<div class="fmrc-notifications-empty">${icons.bell}<h3>You’re all caught up</h3><p>Your appointment, quotation and order updates will appear here.</p></div>`;
    else body.innerHTML=rows.map(row=>`<button type="button" class="fmrc-notification-item${row.read_at?'':' is-unread'}" data-notification-id="${row.id}" ${busy?'disabled':''}><span class="fmrc-notification-icon">${icons[row.type]||icons.bell}</span><span class="fmrc-notification-copy"><span class="fmrc-notification-meta">${esc(({appointment:'Appointment',order:'Order',payment:'Payment',return:'Return or refund'})[row.type]||'Account update')}<span class="fmrc-notification-dot" ${row.read_at?'hidden':''} aria-label="Unread"></span></span><strong>${esc(row.title)}</strong><span>${esc(row.message)}</span><time datetime="${esc(row.published_at)}">${esc(date(row.published_at))}</time></span><span class="fmrc-notification-arrow">${icons.next}</span></button>`).join('');
    body.setAttribute('aria-busy',String(loading));
    footer.innerHTML=`<span class="fmrc-notifications-page">${rows.length?`Page ${page} of ${pages}`:'Personal updates'}</span><div class="fmrc-announcement__actions"><button type="button" class="fmrc-announcement__button" data-notifications-read-all ${!token()||!personalUnread||!rows.length||busy||loading||error?'disabled':''}>Mark all as read</button><button type="button" class="fmrc-announcement__button fmrc-announcement__arrow" data-notifications-page="${page-1}" aria-label="Previous notifications" ${page<=1||busy||loading||error?'disabled':''}>${icons.previous}</button><button type="button" class="fmrc-announcement__button fmrc-announcement__arrow" data-notifications-page="${page+1}" aria-label="Next notifications" ${page>=pages||busy||loading||error?'disabled':''}>${icons.next}</button></div>`;
    if(active)body.querySelector(`[data-notification-id="${active}"]`)?.focus({preventScroll:true});
    body.parentElement.scrollTop=scroll;
  }
  function resetSession(){
    if(session===token())return;
    session=token();generation++;rows=[];page=pages=1;through=personalUnread=0;error='';loading=false;busy=false;updateBadge();render();
  }
  async function refresh(list=false){
    resetSession();const auth=session,requestPage=page;
    if(!auth){render();return;}
    if(loading||busy)return;
    const current=++generation;
    loading=true;if(list&&!rows.length)render();
    try{
      const [badge,data]=await Promise.all([request('/unread-count?scope=personal'),list?request(`?scope=personal&page=${requestPage}`):Promise.resolve(null)]);
      if(auth!==token()||current!==generation)return;
      personalUnread=Number(badge.unread_count)||0;failures=0;error='';
      if(data){rows=Array.isArray(data.data)?data.data:[];pages=Math.max(1,Number(data.last_page)||1);page=Math.min(pages,Math.max(1,Number(data.current_page)||1));if(page===1)through=Math.max(0,...rows.map(row=>Number(row.id)||0));}
      updateBadge();
    }catch(problem){if(auth!==token()||current!==generation)return;failures=Math.min(3,failures+1);if(list)error=problem.message;if(problem.status===401){personalUnread=0;rows=[];updateBadge();}}
    finally{if(auth===token()&&current===generation){loading=false;if(list)render();}}
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(async()=>{if(!document.hidden)await refresh(visible());schedule();},Math.min(60000,10000*2**failures));}
  function select(section,{rendered=false}={}){
    if(!modal)return;const personal=section==='notifications';
    if(!personal&&!rendered){window.FMRCAnnouncements?.open();return;}
    resetSession();modal.dataset.section=section;
    for(const tab of tabs.querySelectorAll('[role=tab]')){const selected=tab.dataset.notificationsTab===section;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;}
    body.hidden=!personal;footer.hidden=!personal;
    modal.querySelector('#announcementModalMessage').hidden=personal;
    for(const node of modal.querySelectorAll('.fmrc-announcement__footer > :not(.fmrc-notifications-footer)'))node.hidden=personal;
    const icon=modal.querySelector('.fmrc-announcement__badge');icon.innerHTML=personal?icons.bell:announcementIcon;
    if(personal){modal.querySelector('#announcementModalBadgeLabel').textContent='YOUR FMRC UPDATES';modal.querySelector('#announcementModalTitle').textContent='Notifications';render();void refresh(true);}
    tabCounts();
  }
  async function activate(row){
    if(busy||loading)return;const auth=token();busy=true;render();
    try{
      const target=new URL(window.FMRCApp?.url(row.target)||row.target,location.href);
      if(target.origin!==location.origin||!/^\/(?:apps\/customer\/)?(?:home-page|about-page|services-page|products-page|contact-page)\//.test(target.pathname))throw Error('This update has no available destination. Please open My Appointments or My Orders.');
      await request(`/${row.id}/read?scope=personal`,{method:'PATCH',body:'{}'});
      if(auth!==token())return;
      if(!row.read_at)personalUnread=Math.max(0,personalUnread-1);row.read_at=new Date().toISOString();updateBadge();
      localStorage.setItem('fmrc_customer_notifications_changed',String(Date.now()));
      const appointmentId=target.searchParams.get('appointment_id');
      if(target.searchParams.get('my_appointments')==='1'&&window.FMRCAppointments){window.FMRCAnnouncements.close();await window.FMRCAppointments.open(appointmentId||undefined);}
      else location.assign(target.href);
    }catch(problem){await window.showCustomerPopup?.(problem.message||'This update could not be opened. Please try again.',{title:'Notification unavailable'});}
    finally{busy=false;render();}
  }
  function mount(){
    modal=document.getElementById('announcementModal');if(!modal||!window.FMRCAnnouncements)return;
    if(modal.querySelector('.fmrc-notifications-tabs'))return;
    const card=modal.querySelector('.fmrc-announcement-card'),header=card?.querySelector('header');
    if(!card||!header)return;
    modal.classList.add('fmrc-notification-center');modal.dataset.section='announcements';
    announcementIcon=header.querySelector('.fmrc-announcement__badge').innerHTML;
    tabs=document.createElement('div');tabs.className='fmrc-notifications-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','FMRC updates');
    tabs.innerHTML=[['notifications','Notifications'],['announcements','FMRC Announcements']].map(([name,label])=>`<button type="button" role="tab" id="fmrc-updates-tab-${name}" aria-controls="${name==='notifications'?'customerNotificationList':'announcementModalMessage'}" aria-selected="${name==='announcements'}" tabindex="${name==='announcements'?0:-1}" data-notifications-tab="${name}">${label}<span data-count="${name}" hidden></span></button>`).join('');header.after(tabs);
    body=document.createElement('section');body.id='customerNotificationList';body.hidden=true;body.setAttribute('role','tabpanel');body.setAttribute('aria-labelledby','fmrc-updates-tab-notifications');card.querySelector('.fmrc-announcement__body').append(body);
    const message=modal.querySelector('#announcementModalMessage');message.setAttribute('role','tabpanel');message.setAttribute('aria-labelledby','fmrc-updates-tab-announcements');
    footer=document.createElement('div');footer.className='fmrc-notifications-footer';footer.hidden=true;card.querySelector('footer').append(footer);
    const bell=document.getElementById('announcementBell');if(bell){bell.setAttribute('aria-label','Open notifications and FMRC announcements');bell.title='Notifications and announcements';bell.setAttribute('aria-haspopup','dialog');}
    modal.querySelector('#announcementModalCloseX').setAttribute('aria-label','Close notifications and announcements');
    modal.addEventListener('click',async event=>{
      const tab=event.target.closest('[data-notifications-tab]');if(tab){select(tab.dataset.notificationsTab);return;}
      if(event.target.closest('[data-notifications-retry]')){await refresh(true);return;}
      const item=event.target.closest('[data-notification-id]');if(item){await activate(rows.find(row=>String(row.id)===item.dataset.notificationId));return;}
      const pager=event.target.closest('[data-notifications-page]');if(pager&&!busy&&!loading){page=Number(pager.dataset.notificationsPage);rows=[];await refresh(true);return;}
      if(event.target.closest('[data-notifications-read-all]')&&!busy&&!loading){const auth=token();busy=true;render();try{await request('/mark-all-read?scope=personal',{method:'POST',body:JSON.stringify(through?{through}:{})});if(auth===token()){rows.forEach(row=>row.read_at=new Date().toISOString());localStorage.setItem('fmrc_customer_notifications_changed',String(Date.now()));}}catch(problem){await window.showCustomerPopup?.(problem.message,{title:'Notifications not updated'});}finally{busy=false;if(auth===token())await refresh(true);}}
    });
    modal.addEventListener('keydown',event=>{
      const tab=event.target.closest('[data-notifications-tab]');if(tab&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const section=event.key==='Home'?'notifications':event.key==='End'?'announcements':tab.dataset.notificationsTab==='notifications'?'announcements':'notifications';select(section);tabs.querySelector(`[data-notifications-tab="${section}"]`).focus();return;}
      if(event.key==='Tab'){const focusable=[...modal.querySelectorAll('button:not(:disabled),a[href],[tabindex="0"]')].filter(el=>el.getClientRects().length);const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
    });
    window.FMRCCustomerNotifications={open:()=>{bell?.focus({preventScroll:true});window.FMRCAnnouncements.open(0,'notifications');tabs.querySelector('[aria-selected=true]').focus();},select,unreadCount:()=>session===token()?personalUnread:0,announcementCount:n=>{announcementUnread=Math.max(0,Number(n)||0);tabCounts();}};
    updateBadge();void refresh();schedule();
    for(const event of ['focus','online'])window.addEventListener(event,()=>void refresh(visible()));
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh(visible());});
    window.addEventListener('storage',event=>{if(['customer_token','customer_info','fmrc_customer_notifications_changed'].includes(event.key))void refresh(visible());});
    for(const event of ['fmrc:custom-product-updated','fmrc:appointment-updated','fmrc:orders-updated'])window.addEventListener(event,()=>void refresh(visible()));
  }
  window.addEventListener('fmrc:announcements-ready',mount,{once:true});
  if(document.readyState==='complete')mount();else document.addEventListener('DOMContentLoaded',mount,{once:true});
})();
