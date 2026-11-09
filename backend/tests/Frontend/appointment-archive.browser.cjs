const test=require('node:test');
const assert=require('node:assert/strict');
const {browserFixture,chrome}=require('./helpers/website-browser.cjs');
for(const portal of ['admin','staff'])test(portal+' archives only the frozen selection and renders compact rows',{skip:!chrome,timeout:90000},async t=>{
  const records=[54,55,56].map(id=>({id,reference_no:'AP-000'+id,client_name:'Customer '+id,purpose:'3D Printing',contact_number:null,email:'fixture@example.test',full_address:'N/A',client_type:'Student',appointment_date:'2026-11-09',appointment_time:'9:00 - 10:00 AM',status:id===56?'Archived':'Completed',attachments:[],additional_notes:null,custom_product:{id:71,revision:0,stage:'Custom request cancelled',requirements:{name:'Large custom product name'},orders:[]}}));
  const archived=[];let release;
  const h=await browserFixture(t,async({req,route,json})=>{
    if(route==='/api/appointments'){json({data:records});return true;}
    const match=route.match(/^\/api\/appointments\/(\d+)\/archive$/);
    if(match){assert.equal(req.method,'PATCH');archived.push(Number(match[1]));await new Promise(resolve=>release=resolve);records.find(a=>a.id===Number(match[1])).status='Archived';json({message:'Archived'});return true;}
    return false;
  });
  await h.send('Network.setBlockedURLs',{urls:['https://*']});
  await h.go('/'+portal+'-page/appointments.html');
  await h.until(`document.querySelector('#appointmentsTableBody [data-archive-id="54"]')`);
  assert.equal(await h.run(`document.querySelectorAll('#appointmentsTableBody tr').length`),2);
  assert.deepEqual(await h.run(`[...document.querySelector('#appointmentsTableBody tr').cells].slice(7,10).map(c=>c.textContent.trim())`),['3D Printing','--','--']);
  assert.equal(await h.run(`document.querySelector('#appointmentsTableBody tr').cells[5].textContent.trim()`),'N/A','Genuine text is preserved');
  assert.deepEqual(await h.run(`[null,undefined,'',' ',0,false,'N/A','—','<x>'].map(AdminTableValue.html)`),['--','--','--','--','0','false','N/A','—','&lt;x&gt;']);
  for(const theme of ['light','dark'])for(const width of [390,1440]){
    await h.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await h.run(`document.documentElement.dataset.theme='${theme}';document.getElementById('appointmentsTable').scrollIntoView({block:'center',behavior:'instant'})`);
    assert.equal(await h.run(`document.querySelectorAll('#appointmentsTableBody .appointment-custom-work').length`),0);
    await h.shot(portal+'-compact-'+theme+'-'+width);
  }
  await h.run(`document.querySelector('[data-archive-id="54"]').click();document.querySelector('[data-archive-id="55"]').click()`);
  assert.match(await h.run(`document.getElementById('archiveAppointmentTargetLabel').textContent`),/54/);
  await h.run(`document.getElementById('btnConfirmArchiveAppt').click();document.getElementById('btnConfirmArchiveAppt').click()`);
  await h.until(`document.getElementById('btnCancelArchiveAppt').disabled`);
  await h.pause(100);assert.deepEqual(archived,[54]);release();
  await h.until(`!document.querySelector('#appointmentsTableBody [data-archive-id="54"]')`);
  assert.equal(await h.run(`!!document.querySelector('#appointmentsTableBody [data-archive-id="55"]')`),true);
  assert.equal(records[1].status,'Completed');
  assert.deepEqual(await h.run('fixtureErrors'),[]);
  t.diagnostic('Screenshots: '+h.artifacts);
});
