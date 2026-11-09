// Canonical Customer/Admin/Staff pages; all appointments, orders and API writes are isolated fixtures.
const test=require('node:test');
const assert=require('node:assert/strict');
const {browserFixture,chrome}=require('./helpers/website-browser.cjs');

test('shared customer brief, hover styles and quiet meeting refresh preserve entered requirements',{skip:!chrome,timeout:60000},async t=>{
  const profile={id:33,role:'customer',name:'Customer Fixture',email:'customer@example.test'};
  const brief={service_id:2,name:'Desk sign',description:'A personalized desk sign',quantity:1,material:'PLA',colors:'Maroon',finish:'Matte',personalization:'Print FMRC.',instructions:'Pack securely.'};
  const job={id:71,appointment_id:54,service_id:2,service_name:'3D Printing',state:'awaiting_consultation',stage:'Awaiting consultation',revision:0,requirements:brief,booking:{},files:[],messages:[],quotations:[],orders:[],follow_ups:[],activity:[],next_action:'Attend the consultation.'};
  const appointment={id:54,reference_no:'AP-00054',purpose:'3D Printing',appointment_date:'2026-11-09',appointment_time:'9:00 - 10:00 AM',appointment_method:'online',status:'Completed',meeting_platform:'Google Meet',meeting_url:'https://meet.example.test/private',meeting_status:'Meeting link available',schedule_version:0,can_reschedule:false,custom_products_available:true,custom_product:null,additional_notes:'Keep the lettering readable.',attachments:[]};
  let posted;
  const h=await browserFixture(t,async({req,route,json})=>{
    if(route==='/api/user'){json(profile);return true;}
    if(route==='/api/appointment-products/availability'){json({data:{enabled:true,services:[{id:2,title:'3D Printing'}]}});return true;}
    if(route==='/api/customer/appointments'){json({data:[appointment]});return true;}
    if(route==='/api/customer/appointments/54'){json({data:appointment});return true;}
    if(route==='/api/customer/appointment-products/drafts'){json({data:[]});return true;}
    if(route==='/api/customer/appointment-products/71'){json({data:job});return true;}
    if(route==='/api/customer/appointments/54/product'){let body='';for await(const chunk of req)body+=chunk;posted=JSON.parse(body);job.requirements=posted.requirements;appointment.custom_product=job;json({data:job});return true;}
    return false;
  });
  await h.send('Network.setBlockedURLs',{urls:['https://*']});
  await h.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('customer_token','fixture-customer');localStorage.setItem('customer_info',${JSON.stringify(JSON.stringify(profile))});`});
  await h.go('/home-page/');
  await h.until(`document.getElementById('aptCustomFields')&&window.FMRCAppointments`);
  const fields=await h.run(`[...document.querySelectorAll('#aptCustomFields .ap-field>span')].map(n=>n.textContent.replace(/\\s*\\*$/,'').trim())`);
  await h.run('FMRCAppointments.open(54)');await h.until(`document.querySelector('[data-ap-opt-in]')`);
  await h.run(`document.querySelector('[data-ap-opt-in]').click()`);await h.until(`document.querySelector('#customerAppointmentsModal form [name="instructions"]')`);
  const labels=await h.run(`[...document.querySelectorAll('#customerAppointmentsModal [data-ap-appointment] .ap-field>span')].map(n=>n.textContent.replace(/\\s*\\*$/,'').trim())`);
  assert.deepEqual(labels,[...fields,'Additional notes (optional)']);
  assert.equal(await h.run(`!!document.querySelector('#customerAppointmentsModal [name="finish"],#customerAppointmentsModal [name="personalization"]')`),false);
  await h.run(`(()=>{const f=document.querySelector('#customerAppointmentsModal [data-ap-appointment] form');f.elements.name.value='Desk sign';f.elements.description.value='A personalized desk sign';f.elements.instructions.value='N'.repeat(2001);f.requestSubmit()})()`);
  assert.equal(posted,undefined);assert.equal(await h.run(`document.querySelector('#customerAppointmentsModal [name="instructions"]').validity.customError`),true);
  await h.run(`(()=>{const f=document.querySelector('#customerAppointmentsModal [data-ap-appointment] form');f.elements.instructions.value='Use the approved spelling.';f.elements.instructions.dispatchEvent(new Event('input',{bubbles:true}));f.requestSubmit()})()`);
  await h.until(`document.querySelector('[data-ap-form="requirements"]')`);
  assert.equal(posted.requirements.instructions,'Use the approved spelling.');assert.equal(posted.requirements.customer_notes_version,1);
  assert.equal('personalization' in posted.requirements,false);assert.equal('finish' in posted.requirements,false);
  const hover=async selector=>{const {root}=await h.send('DOM.getDocument');const {nodeId}=await h.send('DOM.querySelector',{nodeId:root.nodeId,selector});await h.send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:['hover']});await h.pause(400);return h.run(`(()=>{const s=getComputedStyle(document.querySelector(${JSON.stringify(selector)}));return {background:s.backgroundColor,color:s.color}})()`);};
  assert.equal((await hover('#customerAppointmentsModal [data-ap-tab="0"]')).background,'rgb(81, 23, 33)');
  assert.equal((await hover('#customerAppointmentsModal [data-ap-tab="2"]')).background,'rgb(245, 232, 233)');
  await h.run(`(()=>{const form=document.querySelector('[data-ap-form="requirements"]');form.closest('details').open=true;form.elements.instructions.value='Unsaved exact lettering';form.elements.instructions.dispatchEvent(new Event('input',{bubbles:true}));form.elements.instructions.focus();form.elements.instructions.setSelectionRange(3,9);})()`);
  appointment.meeting_url=null;appointment.meeting_platform=null;appointment.meeting_status='No active meeting link';appointment.schedule_version=1;
  await h.pause(15500);await h.until(`!document.querySelector('[data-appointment-join]')`);
  assert.equal(await h.run(`document.querySelector('[data-ap-form="requirements"] [name="instructions"]').value`),'Unsaved exact lettering');
  assert.equal(await h.run(`document.activeElement===document.querySelector('[data-ap-form="requirements"] [name="instructions"]')`),true);
  assert.deepEqual(await h.run(`[document.activeElement.selectionStart,document.activeElement.selectionEnd]`),[3,9]);
  for(const width of [390,1440]){await h.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});assert.equal(await h.run(`document.querySelector('[data-appointment-content]').scrollWidth>document.querySelector('[data-appointment-content]').clientWidth+1`),false);await h.shot('shared-custom-brief-'+width);}
  assert.deepEqual(await h.run('fixtureErrors'),[]);t.diagnostic('Screenshots: '+h.artifacts);
});

for(const portal of ['admin','staff'])test(`${portal} opens archived custom appointments and removes meeting links from linked orders`,{skip:!chrome,timeout:60000},async t=>{
  const job={id:71,appointment_id:54,service_id:2,service_name:'3D Printing',state:'quoted',progress:'awaiting_production',stage:'Awaiting production',revision:1,requirements:{service_id:2,name:'Desk sign',description:'Agreed sign',quantity:1,customer_notes_version:1,instructions:'Keep lettering readable.'},booking:{},files:[],messages:[],quotations:[],orders:[],follow_ups:[],activity:[],next_action:'Prepare the product.'};
  const appointment={id:54,reference_no:'AP-00054',client_name:'Customer Fixture',purpose:'3D Printing',appointment_date:'2026-11-09',appointment_time:'9:00 - 10:00 AM',appointment_method:'online',status:'Archived',meeting_platform:'Google Meet',meeting_url:'https://meet.example.test/private',meeting_status:'Meeting link available',schedule_version:0,can_reschedule:false,can_remove_meeting_link:true,custom_product:job,attachments:[]};
  const order={id:81,order_no:'ORD-000081',product_name:'Desk sign',customer_name:'Customer Fixture',quantity:1,total_amount:150,payment_method:'Cash at FMRC',payment_status:'paid',lifecycle_status:'pending',customer_stage:'to_ship',fulfillment_type:'pickup',order_type:'custom',created_at:'2026-11-09T00:00:00Z',items:[{product_name:'Desk sign',quantity:1,unit_price:150,line_total:150}],custom_product:{appointment_id:54,appointment_reference:'AP-00054',service:'3D Printing',quotation_version:1,stage:'Awaiting production',revision:0,available_actions:{},meeting:appointment,agreement:{specifications:job.requirements,total:150,shipping_fee:0,fulfillment_type:'pickup'}}};
  // Store scalar meeting fields only, matching the backend projection.
  const meeting=()=>Object.fromEntries(['appointment_method','meeting_platform','meeting_url','meeting_status','schedule_version','can_remove_meeting_link'].map(key=>[key,appointment[key]]));
  order.custom_product.meeting=meeting();order.custom_product.cash_entries=[];job.orders=[{...order,custom_product:{stage:'Awaiting production'}}];
  let removals=0,archivedOrderReads=0;
  const h=await browserFixture(t,async({req,route,json})=>{
    if(route==='/api/appointments'){json({data:[appointment]});return true;}
    if(route==='/api/admin/appointments/54'){json({data:appointment});return true;}
    if(route==='/api/admin/appointment-products/71'){json({data:job});return true;}
    if(route==='/api/admin/orders'){json({data:[order],incoming:[],directory:portal==='staff'?[]:[order],payments:[]});return true;}
    if(route==='/api/admin/orders/81'){archivedOrderReads++;json({data:{...order,is_archived:portal==='staff'}});return true;}
    if(route==='/api/admin/appointments/54/meeting'){let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);assert.equal(body.meeting_url,null);assert.equal(body.platform,null);assert.equal(body.expected_version,appointment.schedule_version);removals++;Object.assign(appointment,{meeting_url:null,meeting_platform:null,meeting_status:'No active meeting link',schedule_version:1,can_remove_meeting_link:false});order.custom_product.meeting=meeting();json({data:appointment});return true;}
    return false;
  });
  await h.send('Network.setBlockedURLs',{urls:['https://*']});
  await h.go(`/${portal}-page/appointments.html?appointment_id=54`);
  await h.until(`document.querySelector('#modalViewAppointment.show [data-remove-meeting]')`);
  assert.doesNotMatch(await h.run(`document.querySelector('#appointmentsTableBody').textContent`),/AP-00054/);
  assert.match(await h.run(`document.querySelector('#modalViewAppointment').textContent`),/AP-00054/);
  assert.match(await h.run(`document.querySelector('.ap-linked-orders').textContent`),/ORD-000081/);
  assert.equal(await h.run(`document.querySelector('#modalViewAppointment [data-remove-meeting]').classList.contains('btn-admin')`),true);
  for(const theme of ['light','dark'])for(const width of [390,1440]){await h.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await h.run(`document.documentElement.dataset.theme='${theme}';document.querySelector('#modalViewAppointment [data-remove-meeting]').scrollIntoView({block:'center',behavior:'instant'})`);assert.equal(await h.run(`document.getElementById('apptViewBody').scrollWidth>document.getElementById('apptViewBody').clientWidth+1`),false);await h.shot(portal+'-appointment-meeting-'+theme+'-'+width);}
  await h.go(`/${portal}-page/orders.html?order_id=81`);
  try { await h.until(`document.querySelector('#modalOrderDetails.show [data-remove-meeting]')`); }
  catch(error){await h.shot(portal+'-order-failure');t.diagnostic(JSON.stringify(await h.run(`({url:location.href,loaded:!!window.FMRCAppointmentProducts,modal:document.getElementById('modalOrderDetails')?.className,content:document.getElementById('modalOrderDetails')?.textContent?.slice(-2600),notice:document.body.innerText.slice(-1500)})`)));t.diagnostic('Screenshots: '+h.artifacts);throw error;}
  assert.equal(await h.run(`document.querySelector('#modalOrderDetails .ap-record-links a').getAttribute('href').includes('appointment_id=54')`),true);
  if(portal==='admin')assert.equal(await h.run(`document.querySelector('.ap-reference-link').getAttribute('href').includes('appointment_id=54')`),true);
  else assert.equal(archivedOrderReads,1,'Archived linked orders open through the authenticated detail lookup');
  await h.run(`document.querySelector('[data-remove-meeting]').click()`);await h.until(`document.getElementById('adminSystemPopupTitle').textContent==='Remove meeting link'`);
  await h.run(`document.getElementById('adminSystemPopupCancel').click()`);assert.equal(removals,0);
  await h.run(`document.querySelector('[data-remove-meeting]').click()`);await h.until(`document.getElementById('adminSystemPopupTitle').textContent==='Remove meeting link'`);await h.run(`document.getElementById('adminSystemPopupOk').click()`);
  await h.until(`!document.querySelector('#modalOrderDetails [data-remove-meeting]')`);assert.equal(removals,1);
  assert.equal(await h.run(`!!document.querySelector('[data-order-meeting] a[target="_blank"]')`),false);
  assert.equal(order.payment_status,'paid');assert.equal(order.total_amount,150);assert.equal(order.lifecycle_status,'pending');
  for(const theme of ['light','dark'])for(const width of [390,1440]){await h.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await h.run(`document.documentElement.dataset.theme='${theme}'`);assert.equal(await h.run(`document.querySelector('#modalOrderDetails .modal-body-scroll').scrollWidth>document.querySelector('#modalOrderDetails .modal-body-scroll').clientWidth+1`),false);await h.shot(portal+'-linked-order-'+theme+'-'+width);}
  assert.deepEqual(await h.run('fixtureErrors'),[]);t.diagnostic('Screenshots: '+h.artifacts);
});
