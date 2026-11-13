// Canonical portals with isolated API fixtures; no production accounts or orders.
const test=require('node:test'),assert=require('node:assert/strict');
const {browserFixture,chrome}=require('./helpers/website-browser.cjs');
const services=[{id:2,title:'3D Printing',modal_materials:['PLA','Resin'],modal_best_for:['Scale model','Custom part']},{id:4,title:'Laser Cutting',modal_materials:['Acrylic','Plywood'],modal_best_for:['Desk sign','Keychain']}];
const profile={id:33,role:'customer',name:'Maria Santos',email:'maria@gmail.com'};

test('guided measurements, searchable examples, required markers and phone actions preserve booking drafts',{skip:!chrome,timeout:90000},async t=>{
  let saved;
  const h=await browserFixture(t,async({req,route,json})=>{
    if(route==='/api/user'){json(profile);return true;}
    if(route==='/api/appointment-products/availability'){json({data:{enabled:true,services}});return true;}
    if(route==='/api/customer/appointment-products/drafts'&&req.method==='POST'){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const fd=await new Request('http://fixture',{method:'POST',headers:{'Content-Type':req.headers['content-type']},body:Buffer.concat(chunks)}).formData();
      saved={requirements:JSON.parse(fd.get('requirements')),booking:JSON.parse(fd.get('booking'))};
      json({data:{id:71,revision:0,files:[],...saved},message:'Draft saved.'});return true;
    }
    return false;
  });
  t.diagnostic('Screenshots: '+h.artifacts);
  await h.send('Network.setBlockedURLs',{urls:['https://*']});
  await h.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('customer_token','fixture-customer');localStorage.setItem('customer_info',${JSON.stringify(JSON.stringify(profile))});`});
  await h.go('/home-page/');await h.until(`document.querySelector('#aptCustomFields [data-ap-measurements]')?.apMeasurements`);
  await h.run(`document.querySelector('.btn-appointment').click();document.getElementById('btnGoToPrivacy').click();document.getElementById('acceptPrivacyBtn').click()`);
  await h.until(`document.getElementById('aptStep2').classList.contains('active')`);
  const set=(selector,value)=>h.run(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.value=${JSON.stringify(value)};n.dispatchEvent(new Event(n.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
  const book='#aptCustomFields ',size=book+'[data-ap-measurements] ';
  assert.equal(await h.run(`document.getElementById('aptLName').required&&!!document.querySelector('label[for=aptLName] .apt-required')`),true);
  assert.equal(await h.run(`document.querySelector('label[for=aptDesc] .apt-required')!==null`),false);
  assert.equal(await h.run(`document.getElementById('aptNotesHelp')!==null`),false);
  await set('#aptCountry','Outside Philippines');await set('#aptRole','Others');
  assert.equal(await h.run(`document.getElementById('aptIntlAddress').required&&!document.getElementById('aptRegion').required&&document.getElementById('aptRoleOther').required`),true);
  await h.run(`document.getElementById('aptCustomProduct').click()`);
  assert.equal(await h.run(`document.getElementById('aptPurpose').required`),false);
  for(const selector of ['#aptCustomFields [name=service_id]','#aptCustomFields [data-size-mode]'])assert.notEqual(await h.run(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).backgroundImage`),'none','A visible dropdown arrow is present on '+selector);
  await set(book+'[name=name]','Unique desk sign');await set(book+'[name=description]','A sign for the reception desk.');
  await set(book+'[name=material]','P');
  await h.run(`document.querySelector('#aptCustomFields [name=material]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));document.querySelector('#aptCustomFields [name=material]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));`);
  assert.equal(await h.run(`document.querySelector('#aptCustomFields [name=material]').value`),'PLA');
  await h.run(`document.querySelector('#aptCustomFields [data-ap-suggest=material] button').click();document.querySelector('#aptCustomFields [name=material]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}));document.querySelector('#aptCustomFields [name=material]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));`);
  assert.equal(await h.run(`document.querySelector('#aptCustomFields [name=needs_advice]').checked`),true);
  await set(book+'[name=material]','PLA');
  await set(book+'[name=service_id]','4');
  assert.equal(await h.run(`document.querySelector('#aptCustomFields [name=material]').value`),'PLA');
  await set(book+'[name=material]','Acr');
  assert.match(await h.run(`document.querySelector('#aptCustomFields [data-ap-suggest=material] [role=listbox]').textContent`),/Acrylic/);
  await set(book+'[name=material]','My own material');
  await h.run(`document.querySelector('#aptCustomFields [name=material]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  assert.equal(await h.run(`document.querySelector('#aptCustomFields [name=material]').value`),'My own material');
  assert.equal(await h.run(`document.querySelector('#aptCustomFields [name=material]').getAttribute('aria-expanded')`),'false');
  await set(size+'[data-size-mode]','rectangular');await set(size+'[data-size-unit]','cm');await set(size+'[data-size-value=length]','12.5');
  assert.equal(await h.run('FMRCAppointmentProducts.validate()'),false);
  await h.run(`document.getElementById('aptSaveCustomDraft').click()`);await h.until(`document.querySelector('#customerSystemPopup.show')`);
  assert.equal(saved.booking.custom_measurements.length,'12.5');assert.equal(saved.booking.custom_measurements.width,'');
  assert.equal(saved.requirements.dimensions,'');assert.equal(saved.requirements.material,'My own material');
  await h.run(`document.querySelector('#customerSystemPopup [data-popup-close],#customerSystemPopupOk')?.click()`);
  // Sign-in recovery also restores unfinished controls, rather than dropping them.
  await h.run(`sessionStorage.setItem('fmrc-appointment-product-resume',${JSON.stringify(JSON.stringify({booking:saved.booking,custom:saved.requirements,draft:{id:71,revision:0,files:[],...saved},key:'fixture-resume'}))})`);
  await h.go('/home-page/');await h.until(`document.querySelector('#aptCustomFields [data-size-value=length]')?.value==='12.5'`);
  assert.equal(await h.run(`document.querySelector('#aptCustomFields [data-size-mode]').value`),'rectangular');
  await h.run(`document.getElementById('btnGoToPrivacy').click();document.getElementById('acceptPrivacyBtn').click()`);await h.until(`document.getElementById('aptStep2').classList.contains('active')`);
  await set(size+'[data-size-value=width]','5');await set(size+'[data-size-value=height]','3');
  assert.equal(await h.run(`document.querySelector('#aptCustomFields [name=dimensions]').value`),'12.5 × 5 × 3 cm');
  assert.equal(await h.run('FMRCAppointmentProducts.validate()'),true);
  await set(size+'[data-size-value=width]','0');assert.equal(await h.run('FMRCAppointmentProducts.validate()'),false);
  await set(size+'[data-size-mode]','round');await set(size+'[data-size-value=diameter]','4.25');await set(size+'[data-size-value=height]','');await set(size+'[data-size-unit]','in');
  assert.equal(await h.run(`document.querySelector('#aptCustomFields [name=dimensions]').value`),'Diameter 4.25 in');
  assert.equal(await h.run('FMRCAppointmentProducts.validate()'),true);
  await set(size+'[data-size-mode]','advice');assert.equal(await h.run(`document.querySelector('#aptCustomFields [name=needs_advice]').checked`),true);
  await set(size+'[data-size-mode]','custom');await set(size+'[data-size-custom]','Same size as the attached sample');
  assert.equal(await h.run('FMRCAppointmentProducts.validate()'),true);
  for(const width of [375,390,393,402,414,430,440,640,641,844,1024,1440]){
    await h.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await h.run(`document.getElementById('btnGoToStep3').scrollIntoView({block:'end',behavior:'instant'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    const layout=await h.run(`(()=>{const b=document.getElementById('btnCancelTo1').getBoundingClientRect(),s=document.getElementById('aptSaveCustomDraft').getBoundingClientRect(),c=document.getElementById('btnGoToStep3').getBoundingClientRect(),flow=document.getElementById('appointmentFlow');return {b:{x:b.x,y:b.y,w:b.width,h:b.height},s:{x:s.x,y:s.y,w:s.width,h:s.height},c:{x:c.x,y:c.y,w:c.width,h:c.height},overflow:flow.scrollWidth>flow.clientWidth+1}})()`);
    assert.equal(layout.overflow,false,'No overflow at '+width);assert(layout.c.h>=48);
    if(width<=640){assert(Math.abs(layout.b.y-layout.s.y)<1);assert(Math.abs(layout.b.w-layout.s.w)<1);assert(layout.c.y>=layout.b.y+layout.b.h+10);assert(Math.abs(layout.c.w-layout.b.w-layout.s.w-12)<2);}
    else {assert(Math.abs(layout.b.y-layout.c.y)<1,'One desktop action row');const centered=await h.run(`(()=>{const row=document.querySelector('#aptStep2 .apt-footer-actions').getBoundingClientRect(),a=document.getElementById('btnCancelTo1').getBoundingClientRect(),b=document.getElementById('btnGoToStep3').getBoundingClientRect();return Math.abs((a.left+b.right)/2-(row.left+row.right)/2)<1;})()`);assert.equal(centered,true,'Booking actions are centered at '+width);}
    if([390,1440].includes(width)){await h.until(`[...document.querySelectorAll('.fmrc-load-veil,.fmrc-load-boot')].every(n=>Number(getComputedStyle(n).opacity)<0.01)`);await h.run(`Promise.all(document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))`);await h.shot('guided-booking-'+width);}
  }
  await h.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await h.run(`document.getElementById('aptCustomProduct').click()`);
  assert.equal(await h.run(`document.getElementById('aptPurpose').required`),true);
  const plain=await h.run(`(()=>{const b=document.getElementById('btnCancelTo1').getBoundingClientRect(),c=document.getElementById('btnGoToStep3').getBoundingClientRect();return {equal:Math.abs(b.width-c.width)<1,below:c.y>b.y,saveHidden:!document.getElementById('aptSaveCustomDraft').getClientRects().length}})()`);
  assert.deepEqual(plain,{equal:true,below:true,saveHidden:true});
  await h.run(`(()=>{const files=new DataTransfer();files.items.add(new File(['solid example'],'Custom-part-'.repeat(16)+'.stl',{type:'text/plain'}));const input=document.getElementById('aptFile');input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  for(const width of [375,390,640,844,1440]){
    await h.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await h.run(`document.querySelector('#aptStep2 .apt-design-files .file-upload-wrapper').scrollIntoView({block:'center',behavior:'instant'});new Promise(r=>requestAnimationFrame(r))`);
    const upload=await h.run(`(()=>{const box=document.querySelector('#aptStep2 .apt-design-files .file-upload-wrapper'),r=box.getBoundingClientRect();return {inside:[...box.children].filter(n=>n.type!=='file').every(n=>{const c=n.getBoundingClientRect();return c.left>=r.left+1&&c.right<=r.right-1&&c.top>=r.top+1&&c.bottom<=r.bottom-1;}),width:box.scrollWidth<=box.clientWidth+1};})()`);
    assert.deepEqual(upload,{inside:true,width:true},'Upload instructions and long file names fit at '+width);
    if([390,1440].includes(width)){await h.run(`Promise.all(document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))`);await h.shot('upload-contained-'+width);}
  }

  assert.deepEqual(await h.run('fixtureErrors'),[]);
});


for(const portal of ['admin','staff'])test(portal+' reuses guidance and retains legacy specifications without rewriting quotations',{skip:!chrome,timeout:45000},async t=>{
  const brief={service_id:2,name:'Desk sign',description:'An existing design',quantity:2,dimensions:'20 x 8 cm',material:'PLA',colors:'Maroon',instructions:'Exact lettering',customer_notes_version:1};
  const job={id:71,appointment_id:54,service_id:2,service_name:'3D Printing',state:'ready_for_quote',stage:'Ready for quotation',revision:1,discussed_at:'2026-11-09T02:00:00Z',requirements:brief,booking:{},files:[],messages:[],quotations:[],orders:[],follow_ups:[],activity:[]};
  const appointment={id:54,reference_no:'AP-00054',first_name:'Maria',last_name:'Santos',purpose:'3D Printing',appointment_date:'2026-11-09',appointment_time:'9:00 - 10:00 AM',appointment_method:'face_to_face',status:'Completed',schedule_version:0,custom_product:job};
  let saved;
  const h=await browserFixture(t,async({req,route,json})=>{
    if(route==='/api/appointment-products/availability'){json({data:{enabled:true,services}});return true;}
    if(route==='/api/appointments'){json({data:[appointment]});return true;}
    if(route==='/api/admin/appointments/54'){json({data:appointment});return true;}
    if(route==='/api/admin/appointment-products/71/requirements'){
      let body='';for await(const chunk of req)body+=chunk;saved=JSON.parse(body);job.requirements=saved.requirements;job.revision++;json({data:job,message:'Saved'});return true;
    }
    if(route==='/api/admin/appointment-products/71'){json({data:job});return true;}
    return false;
  });
  t.diagnostic('Screenshots: '+h.artifacts);
  await h.send('Network.setBlockedURLs',{urls:['https://*']});
  await h.go('/'+portal+'-page/appointments.html?appointment_id=54');
  await h.until(`document.querySelector('[data-ap-form=requirements] [data-size-mode]')`);
  await h.run(`document.querySelector('[data-ap-form=requirements]').closest('details').open=true`);
  assert.equal(await h.run(`document.querySelector('[data-ap-form=requirements] [data-size-mode]').value`),'rectangular');
  assert.equal(await h.run(`document.querySelector('[data-ap-form=requirements] [name=dimensions]').value`),'20 x 8 cm','Reading does not normalize a saved agreement');
  assert.equal(await h.run(`document.querySelector('[data-ap-form=requirements] [data-size-value=width]').value`),'8');
  await h.run(`(()=>{const n=document.querySelector('[data-ap-form=requirements] [data-size-value=length]');n.value='22.5';n.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-ap-form=requirements]').requestSubmit();})()`);
  await h.until(`document.querySelector('[data-ap-form=requirements] [name=dimensions]').value==='22.5 × 8 cm'`);
  assert.equal(saved.requirements.dimensions,'22.5 × 8 cm');assert.equal(saved.requirements.instructions,'Exact lettering');
  assert.equal('dimension_mode' in saved.requirements,false);
  await h.run(`document.querySelector('#adminSystemPopupOk')?.click();document.querySelector('[data-ap-go-quote]').click()`);
  await h.until(`document.querySelector('[data-ap-form=quotation] [data-size-mode]')?.getClientRects().length`);
  assert.equal(await h.run(`document.querySelector('[data-ap-form=quotation] [name=spec_service_id]').disabled`),true);
  const arrows=await h.run(`[...document.querySelectorAll('[data-ap-form=quotation] select[name=spec_service_id],[data-ap-form=quotation] [data-size-mode],[data-ap-form=quotation] [data-size-unit]')].every(select=>{const arrow=select.closest('.admin-select-wrap')?.querySelector('.admin-select-chevron');return arrow?arrow.getBoundingClientRect().width>0:getComputedStyle(select).backgroundImage!=='none';})`);
  assert.equal(arrows,true,portal+' shows service, size and unit chevrons');

  assert.equal(await h.run(`!!document.querySelector('[data-ap-form=quotation] [name=spec_finish],[data-ap-form=quotation] [name=spec_personalization]')`),false);
  assert.equal(await h.run(`document.querySelector('[data-ap-form=quotation] [data-size-mode] option[value=advice]')===null`),true);
  await h.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await h.run(`document.documentElement.dataset.theme='dark';document.querySelector('[data-ap-form=quotation] [data-ap-measurements]').scrollIntoView({block:'center',behavior:'instant'})`);
  const layout=await h.run(`(()=>{const r=document.querySelector('[data-ap-form=quotation] [data-ap-measurements]').getBoundingClientRect();return {fits:r.left>=0&&r.right<=innerWidth,overflow:document.querySelector('#modalViewAppointment .modal-body-scroll').scrollWidth>document.querySelector('#modalViewAppointment .modal-body-scroll').clientWidth+1}})()`);
  assert.deepEqual(layout,{fits:true,overflow:false});await h.pause(4500);await h.shot(portal+'-guided-quotation-dark-390');
  await h.run(`document.querySelector('[data-ap-tab="2"]').click();(()=>{const input=document.querySelector('[data-ap-form=messages] input[type=file]'),files=new DataTransfer();files.items.add(new File(['drawing'],'Custom-design-'.repeat(12)+'.pdf',{type:'application/pdf'}));input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  for(const width of [390,1440]){
    await h.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    const fit=await h.run(`(()=>{const form=document.querySelector('[data-ap-form=messages]'),file=form.querySelector('[data-ap-chat-selected] li'),r=file.getBoundingClientRect(),p=form.getBoundingClientRect();return r.left>=p.left-1&&r.right<=p.right+1&&file.scrollWidth<=file.clientWidth+1;})()`);
    assert.equal(fit,true,portal+' selected chat file fits at '+width);
  }

  assert.deepEqual(await h.run('fixtureErrors'),[]);
});


for(const route of ['/home-page/','/apps/customer/home-page/'])test('Customer request edits preserve custom sizes and read back measurements at '+route,{skip:!chrome,timeout:35000},async t=>{
  let saved;
  const job={id:71,appointment_id:54,service_id:2,service_name:'3D Printing',state:'awaiting_consultation',stage:'Awaiting consultation',revision:1,requirements:{service_id:2,name:'Custom cover',description:'A cover matching my sample',quantity:1,dimensions:'Same size as my attached sample',material:'PLA',colors:'Black',instructions:'Exact text',customer_notes_version:1},booking:{},files:[],messages:[],quotations:[],orders:[],follow_ups:[],activity:[]};
  const appointment={id:54,reference_no:'AP-00054',purpose:'3D Printing',appointment_date:'2026-11-09',appointment_time:'9:00 - 10:00 AM',appointment_method:'face_to_face',status:'Completed',schedule_version:0,custom_product:job};
  const h=await browserFixture(t,async({req,route,json})=>{
    if(route==='/api/user'){json(profile);return true;}
    if(route==='/api/appointment-products/availability'){json({data:{enabled:true,services}});return true;}
    if(route==='/api/customer/appointments/54'){json({data:appointment});return true;}
    if(route==='/api/customer/appointments'){json({data:[appointment]});return true;}
    if(route==='/api/customer/appointment-products/71/requirements'){
      let body='';for await(const chunk of req)body+=chunk;saved=JSON.parse(body);job.requirements=saved.requirements;job.revision++;json({data:job,message:'Saved'});return true;
    }
    if(route==='/api/customer/appointment-products/71'){json({data:job});return true;}
    return false;
  });
  await h.send('Network.setBlockedURLs',{urls:['https://*']});
  await h.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('customer_token','fixture-customer');localStorage.setItem('customer_info',${JSON.stringify(JSON.stringify(profile))});`});
  await h.go(route);await h.until(`!!window.FMRCAppointments`);await h.run(`FMRCAppointments.open(54)`);
  await h.until(`document.querySelector('#customerAppointmentsModal [data-ap-form=requirements] [data-size-mode]')`);
  assert.equal(await h.run(`document.querySelector('#customerAppointmentsModal [data-size-mode]').value`),'custom');
  assert.equal(await h.run(`document.querySelector('#customerAppointmentsModal [name=dimensions]').value`),'Same size as my attached sample');
  await h.run(`(()=>{const f=document.querySelector('#customerAppointmentsModal [data-ap-form=requirements]');f.closest('details').open=true;for(const [selector,value]of [['[data-size-mode]','round'],['[data-size-unit]','mm'],['[data-size-value=diameter]','32.5'],['[data-size-value=height]','8']]){const n=f.querySelector(selector);n.value=value;n.dispatchEvent(new Event(n.tagName==='SELECT'?'change':'input',{bubbles:true}));}f.requestSubmit();})()`);
  await h.until(`document.querySelector('#customerAppointmentsModal [name=dimensions]').value==='Diameter 32.5 × Height 8 mm'`);
  assert.equal(saved.requirements.dimensions,'Diameter 32.5 × Height 8 mm');assert.equal(saved.requirements.instructions,'Exact text');
  assert.equal(await h.run(`document.querySelector('#customerAppointmentsModal [data-size-mode]').value`),'round');
  assert.equal(await h.run(`document.querySelector('#customerAppointmentsModal [data-size-value=diameter]').value`),'32.5');
  for(const selector of ['[name=service_id]','[data-size-mode]','[data-size-unit]'])assert.notEqual(await h.run(`getComputedStyle(document.querySelector('#customerAppointmentsModal [data-ap-form=requirements] '+${JSON.stringify(selector)})).backgroundImage`),'none','Customer form chevron survives shared field styles');
  await h.until(`!!document.querySelector('#customerSystemPopup.show')`);await h.run(`document.getElementById('customerSystemPopupOk').click();document.querySelector('#customerAppointmentsModal [data-ap-tab="2"]').click()`);
  for(const width of [390,1440]){
    await h.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    const fit=await h.run(`(()=>{const form=document.querySelector('#customerAppointmentsModal [data-ap-form=messages]'),button=form.querySelector('[data-ap-chat-attach]'),r=button.getBoundingClientRect(),p=form.getBoundingClientRect();return r.left>=p.left-1&&r.right<=p.right+1&&form.scrollWidth<=form.clientWidth+1;})()`);
    assert.equal(fit,true,'Customer chat attachment button fits at '+width);
  }

  assert.deepEqual(await h.run('fixtureErrors'),[]);
});
