// Real canonical portal scripts and dialogs with an isolated persistent API fixture.
// Pricing, authorization and database persistence are verified in ShippingQuotesTest.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../../..');
const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function connect(url){
  const socket=new WebSocket(url),pending=new Map();let id=0;
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  socket.onmessage=({data})=>{const reply=JSON.parse(data),job=pending.get(reply.id);if(!job)return;pending.delete(reply.id);reply.error?job.reject(Error(JSON.stringify(reply.error))):job.resolve(reply.result);};
  return {send(method,params={}){return new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error(method));},15000);pending.set(key,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});socket.send(JSON.stringify({id:key,method,params}));});},close(){socket.close();}};
}
test('appointment booking, private designs, rescheduling and meeting updates share consistent portal workflows',{skip:!fs.existsSync(chrome),timeout:180000},async()=>{
  const artifacts=fs.mkdtempSync(path.join(os.tmpdir(),'fmrc-appointments-'));
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const nextDay=(date,count)=>{const day=new Date(date+'T12:00:00+08:00');day.setUTCDate(day.getUTCDate()+count);while([0,6].includes(day.getUTCDay()))day.setUTCDate(day.getUTCDate()+1);return day.toISOString().slice(0,10);};
  const bookedDate=nextDay(today,8),newDate=nextDay(bookedDate,1),slots=[{id:1,label:'9:00 - 10:00 AM',type:'AM',sort_order:1,is_active:true},{id:2,label:'10:00 - 11:00 AM',type:'AM',sort_order:2,is_active:true}];
  const profile={id:33,role:'customer',name:'Maria Santos',first_name:'Maria',last_name:'Santos',email:'maria@gmail.com',phone_number:'09171234567'};
  let appointment=null,meetingWrites=0,reschedules=0,downloads=0,booking=null,failCalendar=false;
  const server=http.createServer(async(req,res)=>{
    const route=decodeURIComponent(new URL(req.url,'http://localhost').pathname),role=String(req.headers.authorization||'').includes('staff')?'staff':String(req.headers.authorization||'').includes('customer')?'customer':'admin';
    const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    if(route.startsWith('/api/')){
      if(route==='/api/user')return json(role==='customer'?profile:{id:11,role,email:role+'@gmail.com',name:role+' Fixture'});
      if(route==='/api/admin/preferences')return json({user_id:11,preferences:{theme:'light',compact:false,reducedMotion:false}});
      if(route==='/api/admin/session')return json({server_time:new Date().toISOString(),idle_warning_at:new Date(Date.now()+3600000).toISOString(),idle_expires_at:new Date(Date.now()+3780000).toISOString(),absolute_expires_at:new Date(Date.now()+21600000).toISOString()});
      if(route==='/api/maintenance')return json({installed:true,data:{},site_page_installed:true,site_page:{}});
      if(route==='/api/site-settings')return json({data:{}});
      if(route==='/api/customer/profile')return json({data:profile});
      if(route==='/api/appointments/calendar'&&failCalendar){failCalendar=false;return json({message:'Fixture availability refresh unavailable.'},503);}
      if(route==='/api/appointments/calendar')return json({today,timezone:'Asia/Manila',time_slots:slots,day_settings:[],booked_slots:appointment?{[appointment.appointment_date]:[appointment.appointment_time]}:{}});
      if(route==='/api/appointments'&&req.method==='POST'){
        const chunks=[];for await(const chunk of req)chunks.push(chunk);const form=await new Request('http://localhost',{method:'POST',headers:{'Content-Type':req.headers['content-type']},body:Buffer.concat(chunks)}).formData();booking=Object.fromEntries(form);const files=form.getAll('attachments[]');
        assert.equal(form.get('appointment_method'),'online');assert.equal(files.length,2);
        appointment={...booking,id:51,user_id:33,reference_no:'AP-00051',client_name:'Maria Santos',status:'Scheduled',method_label:'Online',meeting_url:null,meeting_platform:null,meeting_status:'Meeting link pending',schedule_version:0,schedule_history:[],can_reschedule:true,attachments:files.map((file,i)=>({id:i+1,name:file.name,size:file.size})),qr_payload:'/appointments/verify/AP-00051',created_at:new Date().toISOString()};await pause(250);return json({data:appointment},201);
      }
      if(route==='/api/customer/appointments'||route==='/api/appointments')return json({data:appointment?[appointment]:[]});
      if(route==='/api/customer/appointments/51')return json({data:appointment});
      if(route==='/api/customer/appointments/51/reschedule'){
        let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);assert.equal(input.expected_version,appointment.schedule_version);reschedules++;
        const previous={previous_date:appointment.appointment_date,previous_time:appointment.appointment_time,appointment_date:input.appointment_date,appointment_time:input.appointment_time};
        Object.assign(appointment,{appointment_date:input.appointment_date,appointment_time:input.appointment_time,meeting_url:null,meeting_platform:null,meeting_status:'Meeting link pending',schedule_version:appointment.schedule_version+1,schedule_history:[...appointment.schedule_history,previous]});await pause(250);return json({data:appointment});
      }
      if(route==='/api/admin/appointments/51/meeting'){
        assert(['admin','staff'].includes(role));let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);assert.equal(input.expected_version,appointment.schedule_version);meetingWrites++;Object.assign(appointment,{meeting_platform:input.platform,meeting_url:input.meeting_url,meeting_status:'Meeting link available',schedule_version:appointment.schedule_version+1});await pause(250);return json({data:appointment});
      }
      if(route.startsWith('/api/customer/appointments/51/attachments/')){downloads++;res.writeHead(200,{'Content-Type':'application/octet-stream'});res.end('ISO-10303-21;');return;}
      return json({data:[]});
    }
    const file=path.resolve(root,'.'+route);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
    const ext=path.extname(file);res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[ext]||'application/octet-stream');let content=fs.readFileSync(file);
    if(ext==='.html')content=content.toString().replace('<head>',`<head><script>window.APP_API_BASE_URL=location.origin+'/api';window.fixtureErrors=[];addEventListener('error',event=>{if(event.message)fixtureErrors.push(event.message)});addEventListener('unhandledrejection',event=>fixtureErrors.push(String(event.reason)));for(const role of ['admin','staff']){localStorage.setItem(role+'_auth_token','fixture-'+role);localStorage.setItem(role+'_user_info',JSON.stringify({id:11,role,email:role+'@gmail.com'}));}localStorage.setItem('customer_token','fixture-customer');localStorage.setItem('customer_info',${JSON.stringify(JSON.stringify(profile))});</script>`);res.end(content);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=spawn(chrome,['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+path.join(artifacts,'profile'),'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  let cdp;
  try{
    const endpoint=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Chrome startup')),15000);browser.stderr.on('data',chunk=>{output+=chunk;const match=output.match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timer);resolve(match[1]);}});browser.once('error',reject);});
    const tabs=await(await fetch('http://127.0.0.1:'+new URL(endpoint).port+'/json/list')).json();cdp=await connect(tabs.find(tab=>tab.type==='page').webSocketDebuggerUrl);
    await cdp.send('Page.enable');await cdp.send('Network.enable');await cdp.send('Network.setBlockedURLs',{urls:['https://*']});
    const run=async expression=>{const result=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
    const until=async expression=>{for(let i=0;i<180;i++){try{if(await run(expression))return;}catch(error){if(!/context|navigated/i.test(error.message))throw error;}await pause(45);}throw Error('Timeout: '+expression+'; '+JSON.stringify(await run('({url:location.href,errors:fixtureErrors,popup:document.getElementById("customerSystemPopupMessage")?.textContent,shipping:document.getElementById("checkoutShippingMessage")?.textContent})')));};
    const navigate=async route=>{await cdp.send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+route});await until(`location.pathname===${JSON.stringify(route)}&&document.readyState==='complete'`);};
    const input=async(id,value)=>run(`(()=>{const input=document.getElementById(${JSON.stringify(id)});input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    const confirm=async title=>{await until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupTitle')?.textContent===${JSON.stringify(title)}`);await run(`document.getElementById('adminSystemPopupOk').click()`);};
    const shot=async name=>{const image=await cdp.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifacts,name+'.png'),Buffer.from(image.data,'base64'));};
    await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:artifacts});
    await navigate('/home-page/main.html');await until(`!!document.getElementById('viewAppointmentsBtn')`);
    await run(`document.querySelector('.btn-appointment').click();document.getElementById('btnGoToPrivacy').click();document.getElementById('acceptPrivacyBtn').click()`);
    for(const [id,value]of Object.entries({aptLName:'Santos',aptFName:'Maria',aptPhone:'09171234567',aptEmail:'maria@gmail.com',aptMethod:'online',aptPurpose:'3D Printing',aptRole:'Student',aptCountry:'Outside Philippines',aptIntlAddress:'123 Example Avenue, Singapore'})){await input(id,value);await run(`document.getElementById(${JSON.stringify(id)}).dispatchEvent(new Event('change',{bubbles:true}))`);}
    const selectFiles=expression=>run(`(()=>{const transfer=new DataTransfer();for(const file of ${expression})transfer.items.add(file);const input=document.getElementById('aptFile');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await selectFiles(`Array.from({length:6},(_,i)=>new File(['design'],'part'+i+'.obj',{type:'text/plain'}))`);assert.equal(await run(`document.getElementById('aptFile').files.length`),0);
    await selectFiles(`[new File([new Uint8Array(26*1024*1024)],'a.stl'),new File([new Uint8Array(26*1024*1024)],'b.stl')]`);assert.equal(await run(`document.getElementById('aptFile').files.length`),0);
    await selectFiles(`[new File(['ISO-10303-21;'],'part.step'),new File(['solid design'],'part.stl')]`);assert.match(await run(`document.getElementById('aptFileName').textContent`),/part.step/);
    await run(`document.getElementById('btnGoToStep3').click()`);await until(`document.getElementById('aptStep3').classList.contains('active')`);
    const targetMonth=new Date(bookedDate+'T12:00:00+08:00').toLocaleDateString('en-US',{month:'long',year:'numeric',timeZone:'Asia/Manila'});
    for(let i=0;i<13&&await run(`document.getElementById('calMonthYear').textContent`)!==targetMonth;i++)await run(`document.getElementById('calNextBtn').click()`);
    const spoken=new Date(bookedDate+'T12:00:00+08:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'Asia/Manila'});
    await run(`document.querySelector('[aria-label="'+${JSON.stringify(spoken)}+', available"]').click();document.querySelector('.time-slot-btn:not(:disabled)').click();document.getElementById('btnGoToConfirm').click();document.getElementById('acceptConfirmBtn').click()`);
    assert.match(await run(`document.getElementById('revMethod').textContent`),/Online/);assert.match(await run(`document.getElementById('revFileAttach').textContent`),/part.step/);
    await run(`document.getElementById('btnGoToStep5').click()`);await until(`document.getElementById('aptStep5').classList.contains('active')`);assert(booking);
    await run(`document.getElementById('btnFinishStep5').click();document.getElementById('btnSuccessHome').click();document.getElementById('viewAppointmentsBtn').click()`);
    await until(`!!document.querySelector('[data-appointment-view="51"]')`);await run(`document.querySelector('[data-appointment-view="51"]').click()`);
    assert.match(await run(`document.getElementById('customerAppointmentsModal').textContent`),/Meeting link pending/);
    await run(`document.querySelector('[data-appointment-download="1"]').click()`);await until(`!document.querySelector('[data-appointment-download="1"]').disabled`);assert.equal(downloads,1);
    await run(`(()=>{const form=document.querySelector('[data-appointment-reschedule]');form.elements.appointment_date.value=${JSON.stringify(newDate)};form.elements.appointment_date.dispatchEvent(new Event('change'));form.elements.appointment_time.value='10:00 - 11:00 AM';form.requestSubmit();})()`);
    await until(`document.querySelector('#customerSystemPopup.show #customerSystemPopupTitle')?.textContent==='Reschedule appointment'`);await run(`document.getElementById('customerSystemPopupOk').click()`);
    await until(`document.querySelector('[data-appointment-message]').textContent.includes('Appointment rescheduled')`);assert.equal(reschedules,1);assert.equal(appointment.appointment_date,newDate);assert.equal(appointment.meeting_url,null);
    await until(`!document.querySelector('.fmrc-load-veil.is-on')&&!document.querySelector('.fmrc-load-boot')`);await pause(350);
    for(const width of [390,768,1440]){await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});assert.equal(await run(`document.documentElement.scrollWidth>innerWidth+1`),false);await shot('customer-appointments-'+width);}
    console.log('Verified real Customer booking with online method, file-count/total limits, private download and immediate reschedule.');
    for(const portal of ['admin','staff']){
      await navigate('/'+portal+'-page/appointments.html');await until(`!!document.querySelector('[data-view-id="51"]')`);await run(`document.querySelector('[data-view-id="51"]').click()`);await until(`!!document.querySelector('[data-meeting-form]')`);assert(await run(`document.querySelector('[data-save-meeting]').disabled`));
      await input('appointmentMeetingPlatform',portal==='admin'?'Google Meet':'Zoom');await input('appointmentMeetingLink','https://meet.example.test/'+portal);await run(`document.querySelector('[data-save-meeting]').click()`);await confirm('Save Meeting Details');await until(`document.querySelector('[data-meeting-summary]').textContent.includes('Meeting link available')&&document.querySelector('[data-save-meeting]').disabled`);
      for(const theme of ['light','dark'])for(const width of [390,768,1440]){await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await run(`document.documentElement.dataset.theme='${theme}'`);await run(`document.querySelector('.appointment-operational').scrollIntoView({block:'center'})`);assert.equal(await run(`document.documentElement.scrollWidth>innerWidth+1`),false);await shot(portal+'-meeting-'+theme+'-'+width);}
      assert.deepEqual(await run('fixtureErrors'),[]);
    }
    assert.equal(meetingWrites,2);
    await navigate('/products-page/product.html');await until(`!!document.getElementById('viewAppointmentsBtn')`);await run(`document.getElementById('viewAppointmentsBtn').click()`);await until(`!!document.querySelector('[data-appointment-view="51"]')`);await run(`document.querySelector('[data-appointment-view="51"]').click()`);assert.match(await run(`document.getElementById('customerAppointmentsModal').textContent`),/Zoom/);assert.equal(await run(`document.querySelector('.appointment-detail a[href="https://meet.example.test/staff"]').target`),'_blank');assert.deepEqual(await run('fixtureErrors'),[]);
    failCalendar=true;
    await run(`(()=>{const form=document.querySelector('[data-appointment-reschedule]');form.elements.appointment_date.value=${JSON.stringify(bookedDate)};form.elements.appointment_date.dispatchEvent(new Event('change'));form.elements.appointment_time.value='9:00 - 10:00 AM';form.requestSubmit();})()`);
    await until(`document.querySelector('#customerSystemPopup.show #customerSystemPopupTitle')?.textContent==='Reschedule appointment'`);await run(`document.getElementById('customerSystemPopupOk').click()`);
    await until(`document.querySelector('[data-appointment-message]').textContent.includes('Appointment rescheduled and receipt updated')`);assert.equal(reschedules,2);assert.equal(appointment.meeting_url,null);assert(await run(`document.querySelector('[data-appointment-reschedule] fieldset').disabled`));assert.match(await run(`document.getElementById('customerAppointmentsModal').textContent`),/Meeting link pending/);
    console.log('Verified shared Admin/Staff meeting save, disabled unchanged buttons, Customer meeting readback and truthful saved state when availability refresh fails. Screenshots: '+artifacts);
  }finally{cdp?.close();browser.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
