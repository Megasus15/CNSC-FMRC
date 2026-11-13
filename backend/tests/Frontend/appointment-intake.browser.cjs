const test=require('node:test'),assert=require('node:assert/strict');
const {browserFixture,chrome}=require('./helpers/website-browser.cjs');
const profile={id:33,role:'customer',name:'Maria Santos',email:'maria@gmail.com'};
const pdf='%PDF-1.4\ntrailer\n%%EOF';

test('UCN optional PR, conditional fields, draft readback and sign-in restoration',{skip:!chrome,timeout:60000},async t=>{
  let draft=null,failSave=false,received;
  const h=await browserFixture(t,async({req,route,json})=>{
    if(route==='/api/user'){json(profile);return true;}
    if(route==='/api/appointment-products/availability'){json({data:{enabled:true,services:[{id:2,title:'3D Printing',modal_materials:['PLA'],modal_best_for:[]}]}});return true;}
    if(route==='/api/customer/appointment-products/drafts'&&req.method==='POST'){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const fd=await new Request('http://fixture',{method:'POST',headers:{'Content-Type':req.headers['content-type']},body:Buffer.concat(chunks)}).formData();
      received={booking:JSON.parse(fd.get('booking')),pr:fd.get('purchase_request')?.name};
      if(failSave){json({message:'The draft could not be saved. Please try again.'},503);return true;}
      draft={id:71,revision:(draft?.revision||0)+1,request_key:'fixture-key',state:'draft',requirements:JSON.parse(fd.get('requirements')),booking:received.booking,files:received.booking.aptRole==='UCN College / Department'?[{id:101,name:received.pr||draft?.files?.[0]?.name,size:pdf.length,kind:'purchase_request'}]:[]};
      json({data:draft,message:'Draft saved.'});return true;
    }
    return false;
  });
  t.diagnostic('Screenshots: '+h.artifacts);
  await h.send('Network.setBlockedURLs',{urls:['https://*']});
  await h.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('customer_token','fixture-customer');localStorage.setItem('customer_info',${JSON.stringify(JSON.stringify(profile))});`});
  const set=async(id,value)=>h.run(`(()=>{const n=document.getElementById(${JSON.stringify(id)});n.value=${JSON.stringify(value)};n.dispatchEvent(new Event(n.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
  const select=async(name,content=pdf,type='application/pdf')=>{
    await h.run(`(()=>{const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(content)}],${JSON.stringify(name)},{type:${JSON.stringify(type)}}));const n=document.getElementById('aptPurchaseRequest');n.files=dt.files;n.dispatchEvent(new Event('change'));})()`);
    await h.until(`document.getElementById('aptPrChoose').disabled===false`);
  };
  await h.go('/home-page/');await h.until(`!!document.getElementById('aptCustomFields')&&!!document.getElementById('aptUniversityDepartment')`);
  await h.run(`document.querySelector('.btn-appointment').click();document.getElementById('btnGoToPrivacy').click();document.getElementById('acceptPrivacyBtn').click()`);
  await set('aptRole','UCN College / Department');
  assert.deepEqual(await h.run(`[...document.getElementById('aptUniversityDepartment').options].slice(1).map(o=>o.value)`),['CCMS','COENG','CAS','CBPA','COED','CANR','CFAST','COTT']);
  assert.equal(await h.run(`document.getElementById('aptUniversityDepartment').required&&!document.getElementById('aptPurchaseRequest').required`),true);
  await set('aptUniversityDepartment','CFAST');
  assert.match(await h.run(`FMRCAppointmentIntake.label()`),/formerly IFMS/);
  assert.equal(await h.run(`FMRCAppointmentIntake.validate([])`),'','PR is optional');
  await select('not-a-pr.pdf','not a pdf');
  assert.match(await h.run(`FMRCAppointmentIntake.validate([])`),/could not be read/);
  await h.run(`document.getElementById('aptPrRemove').click()`);
  assert.equal(await h.run(`FMRCAppointmentIntake.validate([])`),'');
  const longName='College-purchase-request-'.repeat(7)+'.pdf';
  await select(longName);
  assert.equal(await h.run(`FMRCAppointmentIntake.current().name`),longName);
  for(const width of [320,390,768,1024,1440]){
    await h.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await h.run(`document.getElementById('aptPrField').scrollIntoView({block:'center',behavior:'instant'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    const fit=await h.run(`(()=>{const node=document.getElementById('aptPrField'),box=node.getBoundingClientRect();return node.scrollWidth<=node.clientWidth+1&&[...node.querySelectorAll('button:not([hidden]),small:not([hidden]),strong')].every(n=>{const r=n.getBoundingClientRect();return r.left>=box.left-1&&r.right<=box.right+1;});})()`);
    assert(fit,'PR controls and long name fit at '+width);await h.shot('ucn-step2-'+width);
  }
  await set('aptRole','Student');
  assert.equal(await h.run(`document.getElementById('aptPrField').hidden&&!document.getElementById('aptUniversityDepartment').required`),true);
  assert.deepEqual(await h.run(`(()=>{const fd=new FormData();FMRCAppointmentIntake.append(fd);return [...fd.keys()]})()`),[]);
  await set('aptRole','UCN College / Department');assert.equal(await h.run(`FMRCAppointmentIntake.current().name`),longName);
  assert.equal(await h.run(`document.getElementById('aptUniversityDepartment').value`),'CFAST');
  await h.run(`document.getElementById('aptCustomProduct').click();document.querySelector('#aptCustomFields [name=service_id]').value='2';document.querySelector('#aptCustomFields [name=service_id]').dispatchEvent(new Event('change',{bubbles:true}))`);
  await set('aptRole','Student');await h.run(`document.getElementById('aptSaveCustomDraft').click()`);await h.until(`document.querySelector('#customerSystemPopup.show')`);assert.equal(received.booking.aptUniversityDepartment,undefined);assert.equal(received.pr,undefined);await h.run(`document.getElementById('customerSystemPopupOk').click()`);await set('aptRole','UCN College / Department');
  failSave=true;await h.run(`document.getElementById('aptSaveCustomDraft').click()`);await h.until(`document.querySelector('#customerSystemPopup.show')`);
  assert.equal(await h.run(`FMRCAppointmentIntake.current().name`),longName,'Failed save retains the selected PR');
  await h.run(`document.getElementById('customerSystemPopupOk').click()`);failSave=false;
  await h.run(`document.getElementById('aptSaveCustomDraft').click()`);await h.until(`!!document.querySelector('#customerSystemPopup.show')&&!!FMRCAppointmentIntake.resumeData().saved`);
  assert.equal(received.booking.aptUniversityDepartment,'CFAST');assert.equal(received.pr,longName);
  assert.equal(await h.run(`document.querySelector('[data-ap-saved-files]').textContent.includes(${JSON.stringify(longName)})`),false,'PR is not listed as a design');
  await h.run(`sessionStorage.setItem('fmrc-appointment-product-resume',${JSON.stringify(JSON.stringify({booking:draft.booking,custom:draft.requirements,draft,key:draft.request_key}))})`);
  await h.go('/home-page/');await h.until(`FMRCAppointmentIntake.current()?.name===${JSON.stringify(longName)}`);
  assert.equal(await h.run(`document.getElementById('aptUniversityDepartment').value`),'CFAST');
  assert.deepEqual(await h.run(`(()=>{const fd=new FormData();FMRCAppointmentIntake.append(fd);return [...fd.keys()]})()`),['university_department'],'Saved PR is retained by the draft without another upload');
  // Exercise the same IndexedDB payload used by Sign in & keep details for ordinary bookings.
  await h.run(`(async()=>{const data=FMRCAppointmentIntake.resumeData();data.file=new File([${JSON.stringify(pdf)}],'kept-through-sign-in.pdf',{type:'application/pdf'});data.saved=null;await new Promise((resolve,reject)=>{const open=indexedDB.open('fmrc-appointment-resume',1);open.onsuccess=()=>{const tx=open.result.transaction('pending','readwrite');tx.objectStore('pending').put({designs:[],intake:data},'booking');tx.oncomplete=resolve;tx.onerror=reject;};});sessionStorage.setItem('fmrc-appointment-product-resume',JSON.stringify({customSelected:false,booking:{aptRole:'UCN College / Department',aptUniversityDepartment:'CCMS'}}));})()`);
  await h.go('/home-page/');await h.until(`FMRCAppointmentIntake.current()?.name==='kept-through-sign-in.pdf'`);
  assert.equal(await h.run(`document.getElementById('aptUniversityDepartment').value`),'CCMS');
  assert.equal(await h.run(`document.getElementById('appointmentFlow').classList.contains('show-modal')`),true,'Sign-in return opens the restored appointment form');
  await h.run(`FMRCAppointmentIntake.reset()`);assert.equal(await h.run(`FMRCAppointmentIntake.current()`),null);
  assert.deepEqual(await h.run('fixtureErrors'),[]);
});
