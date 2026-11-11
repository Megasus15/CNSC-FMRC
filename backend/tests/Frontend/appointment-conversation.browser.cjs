// The canonical Customer modal and shared renderer use isolated authenticated API fixtures.
const test=require('node:test'),assert=require('node:assert/strict');
const {browserFixture,chrome}=require('./helpers/website-browser.cjs');

test('conversation orders actual timestamps, escapes text, preserves backfill anchors and reports reconnection',{skip:!chrome,timeout:45000},async t=>{
  let offline=false;
  const profile={id:33,role:'customer',name:'Maria Santos',email:'maria@example.test'};
  const job={id:71,appointment_id:54,service_id:2,service_name:'3D Printing',state:'awaiting_consultation',stage:'Awaiting consultation',revision:1,
    requirements:{service_id:2,name:'Desk sign',description:'A personalized sign',quantity:1,dimensions:'20 cm',material:'PLA',colors:'Maroon',instructions:'',customer_notes_version:1},
    booking:{},files:[],quotations:[],orders:[],follow_ups:[],activity:[],messages:[
      {id:2,sender_id:11,sender_role:'admin',sender_name:'Alex Reyes',body:'Second day',created_at:'2026-11-11T01:00:00Z'},
      {id:1,sender_id:33,sender_role:'customer',sender_name:'Maria Santos',body:'First day',created_at:'2026-11-10T01:00:00Z'},
      {id:3,sender_id:12,sender_role:'staff',sender_name:'Jamie Cruz',body:'<img src=x onerror="window.injected=true">\nA literal design note',created_at:'2026-11-11T02:00:00Z'},
      {id:4,sender_id:11,sender_role:'admin',sender_name:'Alex Reyes',body:'Older text without a recorded time',created_at:null}
    ]};
  const appointment={id:54,reference_no:'AP-00054',purpose:'3D Printing',appointment_date:'2026-11-11',appointment_time:'9:00 - 10:00 AM',appointment_method:'face_to_face',status:'Completed',schedule_version:0,custom_product:job};
  const h=await browserFixture(t,async({route,json})=>{
    if(route==='/api/user'){json(profile);return true;}
    if(route==='/api/appointment-products/availability'){json({data:{enabled:true,services:[{id:2,title:'3D Printing'}]}});return true;}
    if(route==='/api/customer/appointments'){json({data:[appointment]});return true;}
    if(route==='/api/customer/appointments/54'){json({data:appointment});return true;}
    if(route==='/api/customer/appointment-products/71'){json(offline?{message:'Connection unavailable.'}:{data:job},offline?503:200);return true;}
    return false;
  });
  await h.send('Network.setBlockedURLs',{urls:['https://*']});
  await h.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('customer_token','fixture-customer');localStorage.setItem('customer_info',${JSON.stringify(JSON.stringify(profile))});`});
  await h.go('/home-page/');await h.until('!!window.FMRCAppointments');await h.run('FMRCAppointments.open(54)');await h.until('!!document.querySelector("[data-ap-chat]")');
  await h.run(`document.querySelector('[data-ap-tab="2"]').click()`);
  assert.deepEqual(await h.run(`Array.from(document.querySelectorAll('[data-chat-message]'),n=>Number(n.dataset.chatMessage))`),[4,1,2,3]);
  assert.equal(await h.run(`document.querySelector('[data-chat-message="4"] time').textContent`),'Time unavailable');
  assert.equal(await h.run(`document.querySelector('[data-chat-message="3"] img')===null&&!window.injected`),true,'Message HTML remains literal text');
  assert.match(await h.run(`document.querySelector('[data-chat-message="3"]').textContent`),/Jamie Cruz/);
  assert.match(await h.run(`document.querySelector('[data-chat-message="2"] time').textContent`),/9:00/,'Times are displayed in the Philippines');
  for(let i=5;i<35;i++)job.messages.push({id:i,sender_id:33,sender_role:'customer',sender_name:'Maria Santos',body:'Design detail '+i+' '.repeat(2)+'A long line for reading and wrapping. '.repeat(4),created_at:`2026-11-11T03:${String(i).padStart(2,'0')}:00Z`});
  await h.run(`FMRCAppointmentProducts.mountCustomer(document.querySelector('[data-appointment-content]'),${JSON.stringify(appointment)})`);
  await h.run(`(()=>{const l=document.querySelector('[data-ap-chat-log]');l.scrollTop=150;const n=[...l.querySelectorAll('[data-chat-message]')].find(n=>n.getBoundingClientRect().bottom>l.getBoundingClientRect().top);window.anchor={id:n.dataset.chatMessage,top:n.getBoundingClientRect().top-l.getBoundingClientRect().top};})()`);
  job.messages.push({id:100,sender_id:11,sender_role:'admin',sender_name:'Alex Reyes',body:'A late-loaded earlier message',created_at:'2026-11-09T01:00:00Z'});
  await h.run(`FMRCAppointmentProducts.mountCustomer(document.querySelector('[data-appointment-content]'),${JSON.stringify(appointment)})`);
  assert.equal(await h.run(`(()=>{const l=document.querySelector('[data-ap-chat-log]'),n=l.querySelector('[data-chat-message="'+anchor.id+'"]');return Math.abs(n.getBoundingClientRect().top-l.getBoundingClientRect().top-anchor.top)<3})()`),true,'Backfilled history does not shift the reading anchor');
  assert.equal(await h.run(`document.querySelectorAll('[data-chat-message="100"]').length`),1);
  // Reapplying an older snapshot must not remove already received messages.
  const older={...appointment,custom_product:{...job,messages:job.messages.filter(m=>m.id<10)}};
  await h.run(`FMRCAppointmentProducts.mountCustomer(document.querySelector('[data-appointment-content]'),${JSON.stringify(older)})`);
  assert.equal(await h.run(`document.querySelectorAll('[data-chat-message="100"]').length`),1);
  offline=true;await h.until(`!document.querySelector('[data-ap-chat-connection]').hidden`);
  assert.match(await h.run(`document.querySelector('[data-ap-chat-connection]').textContent`),/Reconnecting/);
  offline=false;await h.pause(5000);await h.until(`document.querySelector('[data-ap-chat-connection]').hidden`);
  assert.deepEqual(await h.run('fixtureErrors'),[]);
});
