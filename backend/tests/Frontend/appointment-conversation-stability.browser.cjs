const test=require('node:test'),assert=require('node:assert/strict');
const {browserFixture,chrome}=require('./helpers/website-browser.cjs');

for(const portal of ['customer','admin','staff'])test(portal+' conversation preserves its position through polls, typing and surrounding updates',{skip:!chrome,timeout:45000},async t=>{
  const profile={id:33,role:'customer',name:'Maria Santos',email:'maria@example.test'};
  const messages=Array.from({length:35},(_,i)=>({id:i+1,sender_id:i<2?11:i===2?22:33,sender_role:i<2?'admin':i===2?'staff':'customer',sender_name:i<2?'Admin User':i===2?'Staff User':'Maria Santos',body:i===0?'ano':i===1?'hehe':'Design note '+i+' — '+('A useful design detail. '.repeat(3)),created_at:`2026-11-11T01:${String(i).padStart(2,'0')}:00Z`}));
  const job={id:71,appointment_id:54,service_id:2,service_name:'3D Printing',state:'awaiting_consultation',stage:'Awaiting consultation',revision:1,requirements:{service_id:2,name:'Desk sign',description:'A personalized sign',quantity:1,dimensions:'20 cm',material:'PLA',colors:'Maroon',instructions:'',customer_notes_version:1},booking:{},files:[],messages,quotations:[],orders:[],follow_ups:[],activity:[]};
  const appointment={id:54,reference_no:'AP-00054',client_name:'Maria Santos',purpose:'3D Printing',appointment_date:'2026-11-11',appointment_time:'9:00 - 10:00 AM',appointment_method:'face_to_face',status:'Completed',schedule_version:0,attachments:[],custom_product:job};
  job.messages=messages.slice(0,2);
  const h=await browserFixture(t,async({route,json})=>{
    if(route==='/api/user'&&portal==='customer'){json(profile);return true;}
    if(route==='/api/appointment-products/availability'){json({data:{enabled:true,services:[{id:2,title:'3D Printing'}]}});return true;}
    if(route==='/api/appointments'||route==='/api/customer/appointments'){json({data:[appointment]});return true;}
    if(route==='/api/customer/appointments/54'||route==='/api/admin/appointments/54'){json({data:appointment});return true;}
    if(route.endsWith('/appointment-products/71')){json({data:job});return true;}
    return false;
  });
  await h.send('Network.setBlockedURLs',{urls:['https://*']});
  await h.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('customer_token','fixture-customer');localStorage.setItem('customer_info',${JSON.stringify(JSON.stringify(profile))});`});
  await h.go(portal==='customer'?'/home-page/':'/'+portal+'-page/appointments.html');
  if(portal==='customer'){await h.until('!!window.FMRCAppointments');await h.run('FMRCAppointments.open(54)');}
  else{await h.until(`!!document.querySelector('[data-view-id="54"]')`);await h.run(`document.querySelector('[data-view-id="54"]').click()`);}
  await h.until(`!!document.querySelector('[data-ap-chat]')`);await h.run(`document.querySelector('[data-ap-tab="2"]').click()`);
  const host=portal==='customer'?'[data-appointment-content]':'#apptViewBody';
  const snapshot=async()=>h.run(`FMRCAppointmentProducts.${portal==='customer'?'mountCustomer':'mountAdmin'}(document.querySelector(${JSON.stringify(host)}),${JSON.stringify(appointment)})`);
  assert.doesNotMatch(await h.run(`document.querySelector('[data-ap-chat-log]').textContent`),/Admin User|Staff User/);
  assert.equal(await h.run(`document.querySelector('[data-chat-message="1"] .ap-chat-sender').textContent`),'FMRC team');
  assert.deepEqual(await h.run(`['1','2'].map(id=>getComputedStyle(document.querySelector('[data-chat-message="'+id+'"] .ap-chat-avatar')).visibility)`),['hidden','visible'],'The logo is beside hehe, the last message in the group');
  assert.equal(await h.run(`document.querySelector('[data-chat-message="2"] .ap-chat-avatar img').getAttribute('src').includes('/images/FMRC%20Logo.png')`),true);
  await h.until(`document.querySelector('[data-chat-message="2"] .ap-chat-avatar img').complete&&document.querySelector('[data-chat-message="2"] .ap-chat-avatar img').naturalWidth>0`);
  job.messages=messages;await snapshot();
  assert.deepEqual(await h.run(`['1','2','3','34','35'].map(id=>getComputedStyle(document.querySelector('[data-chat-message="'+id+'"] .ap-chat-avatar')).visibility)`),['hidden','hidden','visible','hidden','visible'],'Both team and customer avatars follow their last consecutive message');
  await h.run(`(()=>{const l=document.querySelector('[data-ap-chat-log]');l.scrollTop=140;window.savedChat={node:l,top:l.scrollTop,outer:document.querySelector(${JSON.stringify(host)}).scrollTop};})()`);
  for(let i=0;i<4;i++){
    job.revision++;job.outcome_note='Workflow update '+i;
    await snapshot();await h.run(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    const position=await h.run(`({top:document.querySelector('[data-ap-chat-log]').scrollTop,expected:savedChat.top,outer:document.querySelector(${JSON.stringify(host)}).scrollTop,expectedOuter:savedChat.outer,same:savedChat.node===document.querySelector('[data-ap-chat-log]')})`);
    assert(position.same&&Math.abs(position.top-position.expected)<2&&Math.abs(position.outer-position.expectedOuter)<2,'A surrounding refresh preserves both scroll containers: '+JSON.stringify(position));
  }
  await h.run(`(()=>{const f=document.querySelector('[data-ap-form="messages"]');f.elements.body.focus({preventScroll:true});f.elements.body.value='A draft';f.elements.body.dispatchEvent(new Event('input',{bubbles:true}));window.beforeTyping=document.querySelector('[data-ap-chat-log]').scrollTop;})()`);
  for(let i=0;i<8;i++)await h.run(`(()=>{const f=document.querySelector('[data-ap-form="messages"]');f.elements.body.value+='x';f.elements.body.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  assert.equal(await h.run(`Math.abs(document.querySelector('[data-ap-chat-log]').scrollTop-beforeTyping)<2`),true,'Typing does not scroll chat history');
  await h.run(`window.chatMutationCount=0;window.chatObserver=new MutationObserver(records=>chatMutationCount+=records.length);chatObserver.observe(document.querySelector('[data-ap-chat-log]'),{subtree:true,childList:true,attributes:true,characterData:true})`);
  await h.pause(11000);
  assert.equal(await h.run(`Math.abs(document.querySelector('[data-ap-chat-log]').scrollTop-beforeTyping)<2`),true,'Repeated real five-second polls preserve the reading position');
  assert.equal(await h.run(`document.querySelector('[name="body"]').value`),'A draftxxxxxxxx');
  assert.equal(await h.run(`chatObserver.disconnect();chatMutationCount`),0,'Unchanged polling does not rewrite the chat DOM');
  await h.run(`(()=>{const f=document.querySelector('[data-ap-form="messages"]');f.elements.body.value='';f.elements.body.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  if(portal!=='customer'){
    appointment.additional_notes='A refreshed appointment summary';
    await h.until(`document.querySelector('.appt-view-notes')?.textContent==='A refreshed appointment summary'`);
    assert.equal(await h.run(`Math.abs(document.querySelector('[data-ap-chat-log]').scrollTop-beforeTyping)<2`),true,'The portal appointment refresh keeps the inner history position');
  }else{
    await h.run(`document.querySelector('[data-appointments-refresh]').click()`);
    await h.until(`document.querySelector('[data-ap-chat-log]')!==savedChat.node&&!document.querySelector('[data-appointments-refresh]').disabled`);
    assert.equal(await h.run(`Math.abs(document.querySelector('[data-ap-chat-log]').scrollTop-beforeTyping)<2`),true,'Customer Refresh preserves the inner history position');
  }
  for(const width of [390,1440]){
    await h.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await h.run(`document.querySelector('[data-ap-tab="2"]').click();document.querySelector('[data-ap-chat-log]').scrollTo({top:0,behavior:'instant'})`);
    await h.shot(portal+'-team-logo-last-bubble-'+width);
    assert.equal(await h.run(`document.querySelector('[data-ap-chat]').scrollWidth<=document.querySelector('[data-ap-chat]').clientWidth+1`),true);
  }
  t.diagnostic('Conversation screenshots: '+h.artifacts);
  assert.deepEqual(await h.run('fixtureErrors'),[]);
});
