const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {browserFixture, chrome} = require('./helpers/website-browser.cjs');

test('Appointment dialog rollout preserves calendar, meeting, consultation and archive workflows in both portals', {skip: !chrome, timeout: 240000}, async t => {
  const seed = () => [
    {id:1,reference_no:'AP-00001',client_name:'University request',client_type:'UCN College / Department',university_department:'CCMS',university_department_label:'CCMS · College of Computer and Multimedia Studies',contact_number:'09123456789',email:'fixture@example.test',full_address:'Daet, Camarines Norte',purpose:'Consultation',appointment_date:'2099-12-10',appointment_time:'9:00 - 10:00 AM',appointment_method:'online',meeting_platform:'Google Meet',meeting_url:'https://meet.google.com/abc-defg-hij',schedule_version:2,status:'Scheduled',can_confirm_consultation:true,can_reschedule:true,can_archive:false,archive_blocked_reason:'Confirm this consultation first.',list_group:'active',attachments:[{id:11,name:'Purchase request.pdf',kind:'purchase_request'},{id:12,name:'Product design.pdf',kind:'design'}],additional_notes:'Please review the attached request.'},
    {id:2,reference_no:'AP-00002',client_name:'Completed client',client_type:'Student',purpose:'Consultation',appointment_date:'2026-11-01',appointment_time:'10:00 - 11:00 AM',appointment_method:'face_to_face',schedule_version:1,status:'Completed',can_confirm_consultation:false,can_reschedule:false,can_archive:true,list_group:'closed',attachments:[]},
    {id:3,reference_no:'AP-00003',client_name:'Long <literal> client name '.repeat(8),client_type:'Student',purpose:'Long consultation purpose '.repeat(8),appointment_date:'2099-12-11',appointment_time:'9:00 - 10:00 AM',appointment_method:'face_to_face',status:'Scheduled',can_archive:false,can_confirm_consultation:false,attachments:[],additional_notes:'First paragraph.\n\n'+('Long notes with <literal> wording. '.repeat(180))},
    ...Array.from({length:6},(_,i)=>({id:i+10,reference_no:'AP-'+String(i+10).padStart(5,'0'),client_name:'Fixture client '+i,purpose:'Consultation',appointment_date:'2099-12-12',appointment_time:'9:00 - 10:00 AM',status:'Scheduled',can_archive:false,attachments:[]})),
  ].map(record=>({...record,created_at:record.id<4?'2099-12-01T02:00:00Z':'2026-11-01T02:00:00Z'}));
  const slots=[{id:1,label:'9:00 - 10:00 AM',type:'AM',sort_order:1,is_active:true},{id:2,label:'10:00 - 11:00 AM',type:'AM',sort_order:2,is_active:true},{id:3,label:'1:00 - 2:00 PM',type:'PM',sort_order:3,is_active:true}];
  let records=seed(),calendar={time_slots:slots,day_settings:[],booked_slots:{}},fail=false,hold=false,holdRead=false,failRead=false;
  const writes=[],replies=[],readReplies=[];
  const font=process.env.FMRC_BROWSER_POPPINS;
  const setup=font?`{const s=document.createElement('style');s.textContent=${JSON.stringify(`@font-face{font-family:Poppins;src:url(data:font/ttf;base64,${fs.readFileSync(font).toString('base64')}) format('truetype');font-weight:400;font-display:swap}`)};document.head.append(s);}`:'';
  const h=await browserFixture(t,async({req,route,json})=>{
    if(route==='/api/appointments'&&req.method==='GET'){json({data:records.filter(r=>r.status!=='Archived')});return true;}
    if(route==='/api/appointment-products/availability'){json({data:{enabled:true,services:[]}});return true;}
    if(route==='/api/appointments/calendar'){
      if(req.method==='GET'){
        if(failRead){failRead=false;json({message:'Readback interrupted.'},503);return true;}
        const snapshot=structuredClone(calendar);if(holdRead)await new Promise(resolve=>readReplies.push(resolve));json(snapshot);return true;
      }
      let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);writes.push({route,body,method:req.method});if(hold)await new Promise(resolve=>replies.push(resolve));
      if(fail){json({message:'Calendar save interrupted. Try again.'},503);return true;}
      calendar={...calendar,...body};json({message:'Saved'});return true;
    }
    const meeting=route.match(/^\/api\/admin\/appointments\/(\d+)\/meeting$/);
    const action=route.match(/^\/api\/appointments\/(\d+)\/(complete|archive)$/);
    if(meeting||action){
      let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):null;writes.push({route,body,method:req.method});if(hold)await new Promise(resolve=>replies.push(resolve));
      if(fail){json({message:'This appointment action could not be saved.'},422);return true;}
      const record=records.find(r=>r.id===Number((meeting||action)[1]));
      if(meeting)Object.assign(record,{meeting_platform:body.platform,meeting_url:body.meeting_url});
      else if(action[2]==='complete')Object.assign(record,{status:'Completed',can_confirm_consultation:false,can_archive:true,list_group:'closed'});
      else record.status='Archived';
      json({data:record,message:'Saved'});return true;
    }
    return false;
  },{setup});
  t.after(()=>{replies.splice(0).forEach(resolve=>resolve());readReplies.splice(0).forEach(resolve=>resolve());});
  await h.send('Network.setBlockedURLs',{urls:['https://*']});
  const viewport=async(width,height=900,scale=1)=>{await h.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:scale,mobile:false});await h.pause(50);};
  const click=async selector=>{await h.until(`document.querySelector(${JSON.stringify(selector)})`);await h.run(`{const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:'nearest',behavior:'instant'});n.focus({preventScroll:true});n.click();}`);};
  const input=(selector,value)=>h.run(`{const n=document.querySelector(${JSON.stringify(selector)});n.value=${JSON.stringify(value)};n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));}`);
  const key=async key=>{await h.send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:{Tab:9,Escape:27,Enter:13,PageDown:34}[key],...(key==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})});await h.send('Input.dispatchKeyEvent',{type:'keyUp',key});};
  const popup=title=>h.until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupTitle')?.textContent===${JSON.stringify(title)}`);
  const idle=()=>h.until(`document.body.style.position!=='fixed'&&!document.querySelector('.modal-overlay.show,.admin-system-popup.show')`);
  const openCalendar=async()=>{await click('#btnOpenCalendar');await h.until(`document.querySelector('#modalCalendar.show[aria-busy="false"]')`);};
  const openDetails=async(id=1)=>{await click(`[data-view-id="${id}"]`);await h.until(`document.querySelector('#modalViewAppointment.show #apptViewBody .appt-view-name')`);};
  const selectDay=async()=>{await click('#adminCalDaysGrid .cal-day-cell:not(:disabled)');return h.run(`document.querySelector('#adminCalDaysGrid .selected').dataset.calendarDate`);};
  const layout=async id=>{
    await h.run(`Promise.all(document.getElementById('${id}').getAnimations({subtree:true}).filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))`);
    return h.run(`(()=>{const r=document.getElementById('${id}'),c=r.querySelector('.portal-detail-dialog__card'),b=r.querySelector('.portal-detail-dialog__body'),rect=n=>{const q=n.getBoundingClientRect();return{top:q.top,bottom:q.bottom,left:q.left,right:q.right};};return{card:rect(c),head:rect(c.querySelector('header')),foot:rect(c.querySelector('.portal-detail-dialog__footer')),body:rect(b),overflow:b.scrollWidth>b.clientWidth+1||c.scrollHeight>c.clientHeight+1,radius:getComputedStyle(c).borderRadius};})()`);
  };
  for(const role of ['admin','staff']){
    records=seed();calendar={time_slots:structuredClone(slots),day_settings:[],booked_slots:{}};fail=false;hold=false;
    await viewport(1440);await h.go('/'+role+'-page/appointments.html');await h.until(`document.querySelector('[data-view-id="1"]')&&!document.querySelector('.admin-global-page-skeleton')`);
    for(const theme of ['light','dark'])for(const width of [320,390,768,1024,1440]){
      await viewport(width);await h.run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      for(const kind of ['details','calendar','picker','archive','confirm']){
        const id={details:'modalViewAppointment',calendar:'modalCalendar',picker:'modalTimePicker',archive:'modalArchiveAppointment',confirm:'modalCompleteAppointment'}[kind];
        if(kind==='details')await openDetails(3);
        if(kind==='calendar'||kind==='picker'){await openCalendar();if(kind==='picker'){await selectDay();await click('#btnOpenDayTimePicker');}}
        if(kind==='archive')await click('[data-archive-id="2"]');
        if(kind==='confirm'){await openDetails();await click('[data-confirm-consultation]');}
        const g=await layout(id);assert(g.card.left>=0&&g.card.right<=width+1&&g.card.top>=0&&g.card.bottom<=901&&!g.overflow&&g.radius==='12px',`${role} ${kind} ${width} ${JSON.stringify(g)}`);
        assert(g.head.bottom<=g.body.top+1&&g.foot.top>=g.body.bottom-1,'Header and footer are fixed');
        assert.equal(await h.run(`document.querySelectorAll('#${id} [data-portal-detail-close]').length`),['confirm','archive'].includes(kind)?0:1);
        assert.equal(await h.run(`document.body.style.position`),'fixed');
        if([390,1440].includes(width))await h.shot(`appointments-${role}-${kind}-${width}-${theme}`);
        await key('Escape');
        if(kind==='picker'){assert.equal(await h.run(`document.body.style.position`),'fixed');await click('#btnCloseCalendar');}
        if(kind==='confirm')await click('#btnCloseApptView2');
        await idle();
      }
    }
    for(const [width,height,scale] of [[852,393,1],[720,450,2]]){await viewport(width,height,scale);await openCalendar();const g=await layout('modalCalendar');assert(g.card.bottom<=height&&!g.overflow&&g.body.bottom>g.body.top+20);await key('Escape');await idle();}
    await viewport(1440);await input('#appointmentSearchInput','University request');assert.equal(await h.run(`document.querySelectorAll('#appointmentsTableBody [data-view-id]').length`),1);await input('#appointmentSearchInput','');
    await h.run(`document.querySelector('[data-view-id="1"]').scrollIntoView({block:'center',behavior:'instant'});window.savedY=scrollY;document.querySelector('[data-view-id="1"]').focus();document.querySelector('[data-view-id="1"]').click()`);
    await h.until(`document.querySelector('#modalViewAppointment.show')`);assert.match(await h.run(`document.getElementById('apptViewBody').textContent`),/CCMS[\s\S]*Purchase Request[\s\S]*Purchase request.pdf[\s\S]*Product design.pdf/);
    assert.equal(await h.run(`document.querySelector('[data-save-meeting]').disabled`),true);await input('#appointmentMeetingPlatform','Zoom');assert.equal(await h.run(`document.querySelector('[data-save-meeting]').disabled`),false);await input('#appointmentMeetingPlatform','Google Meet');assert.equal(await h.run(`document.querySelector('[data-save-meeting]').disabled`),true);
    const beforeMeeting=writes.length;await h.run(`document.querySelector('[data-meeting-form]').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))`);assert.equal(writes.length,beforeMeeting);
    await input('#appointmentMeetingPlatform','Zoom');await click('[data-save-meeting]');await popup('Save Meeting Details');await click('#adminSystemPopupCancel');assert.equal(writes.length,beforeMeeting);
    await click('[data-save-meeting]');await popup('Save Meeting Details');await click('#adminSystemPopupOk');await h.until(`document.querySelector('[data-meeting-summary]').textContent.includes('Zoom')`);await click('#btnCloseApptView2');await idle();assert.equal(await h.run(`Math.abs(scrollY-savedY)<2`),true);assert.equal(await h.run(`document.activeElement.dataset.viewId`),'1');
    await openCalendar();const beforeCalendar=writes.length;await click('#btnSaveCalendarChanges');assert.equal(writes.length,beforeCalendar,'No unchanged calendar writes');await selectDay();await click('#btnToggleBlockDay');assert.equal(await h.run(`document.getElementById('btnSaveCalendarChanges').disabled`),false);await click('#btnToggleBlockDay');assert.equal(await h.run(`document.getElementById('btnSaveCalendarChanges').disabled`),true);
    await input('#adminEventInput','Literal <note>');await click('#btnAddStaticEvent');assert.equal(await h.run(`document.querySelector('#adminEventList span').textContent`),'Literal <note>');assert.equal(await h.run(`document.querySelector('#adminEventList note')`),null);
    await click('#btnOpenDayTimePicker');await input('#pickerStartHour','11');await input('#pickerEndHour','10');await click('#btnConfirmTimePicker');await popup('System Message');await click('#adminSystemPopupOk');await input('#pickerStartHour','9');await input('#pickerStartMinute','30');await input('#pickerEndHour','10');await click('#btnConfirmTimePicker');assert.equal(await h.run(`document.body.style.position`),'fixed');await click('#btnAddDaySlot');assert.match(await h.run(`document.getElementById('adminDaySlotList').textContent`),/9:30/);
    fail=true;hold=true;const beforeSave=writes.length;await click('#btnSaveCalendarChanges');await h.until(`document.getElementById('btnCloseCalendar').disabled`);await key('Escape');await click('#btnSaveCalendarChanges');assert.equal(writes.length,beforeSave+1);hold=false;replies.splice(0).forEach(resolve=>resolve());await popup('Save Failed');await click('#adminSystemPopupOk');assert.match(await h.run(`document.getElementById('adminEventList').textContent`),/Literal <note>/);fail=false;await click('#btnSaveCalendarChanges');await idle();assert.equal(calendar.day_settings[0].events[0],'Literal <note>');
    await openCalendar();await selectDay();await click('#btnToggleBlockDay');await key('Escape');await popup('Discard changes?');await click('#adminSystemPopupCancel');await click('#btnCloseCalendar');await popup('Discard changes?');await click('#adminSystemPopupOk');await idle();
    await openCalendar();await selectDay();assert.equal(await h.run(`document.getElementById('btnSaveCalendarChanges').disabled`),true,'Discarded changes do not reappear');await click('#btnCloseCalendar');await idle();
    await openCalendar();await selectDay();await click('#btnToggleBlockDay');holdRead=true;await click('#btnSaveCalendarChanges');await idle();assert(readReplies.length>0,'Save readback is held');holdRead=false;
    await openCalendar();const focusedDate=await selectDay();await input('#adminEventInput','Unadded new draft');await h.run(`document.querySelector('#adminCalDaysGrid .selected').focus()`);readReplies.splice(0).forEach(resolve=>resolve());await h.pause(120);
    assert.equal(await h.run(`document.activeElement.dataset.calendarDate`),focusedDate,'Delayed save readback does not redraw a reopened calendar');assert.equal(await h.run(`document.getElementById('adminEventInput').value`),'Unadded new draft');await key('Escape');await popup('Discard changes?');await click('#adminSystemPopupOk');await idle();
    await openCalendar();await selectDay();await click('#btnToggleBlockDay');failRead=true;await click('#btnSaveCalendarChanges');await idle();assert.equal(await h.run(`document.querySelector('#adminSystemPopup.show')`),null,'A confirmed write stays successful when readback fails');
    await openDetails();await click('[data-confirm-consultation]');assert.equal(await h.run(`document.getElementById('btnConfirmCompleteAppt').disabled`),true);await click('#confirmConsultationAttendance');hold=true;const beforeConfirm=writes.length;await click('#btnConfirmCompleteAppt');await h.until(`document.getElementById('btnCancelCompleteAppt').disabled`);await key('Escape');await click('#btnConfirmCompleteAppt');assert.equal(writes.length,beforeConfirm+1);hold=false;replies.splice(0).forEach(resolve=>resolve());await h.until(`!document.querySelector('#modalCompleteAppointment.show')`);await click('#btnCloseApptView2');await idle();
    fail=true;await click('[data-archive-id="2"]');await click('#btnConfirmArchiveAppt');await popup('Archive Failed');await click('#adminSystemPopupOk');assert.equal(await h.run(`document.body.style.position`),'fixed');fail=false;hold=true;await click('#btnConfirmArchiveAppt');await h.until(`document.getElementById('btnCancelArchiveAppt').disabled`);await key('Escape');hold=false;replies.splice(0).forEach(resolve=>resolve());await idle();assert(!records.filter(r=>r.status!=='Archived').some(r=>r.id===2));
    assert.deepEqual(await h.run('fixtureErrors'),[]);
  }
  console.log('Appointment desktop/mobile previews:',h.artifacts);
});
