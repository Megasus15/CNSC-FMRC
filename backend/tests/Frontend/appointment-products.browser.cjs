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
test('optional appointment products preserve drafts and share the existing modal design',{skip:!fs.existsSync(chrome),timeout:240000},async()=>{
  const artifacts=fs.mkdtempSync(path.join(os.tmpdir(),'fmrc-appointment-products-'));
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const nextDay=(date,count)=>{const day=new Date(date+'T12:00:00+08:00');day.setUTCDate(day.getUTCDate()+count);while([0,6].includes(day.getUTCDay()))day.setUTCDate(day.getUTCDate()+1);return day.toISOString().slice(0,10);};
  const bookedDate=nextDay(today,8),newDate=nextDay(bookedDate,1),slots=[{id:1,label:'9:00 - 10:00 AM',type:'AM',sort_order:1,is_active:true},{id:2,label:'10:00 - 11:00 AM',type:'AM',sort_order:2,is_active:true}];
  const profile={id:33,role:'customer',name:'Maria Santos',first_name:'Maria',last_name:'Santos',email:'maria@gmail.com',phone_number:'09171234567'};
  let appointment=null,meetingWrites=0,reschedules=0,downloads=0,booking=null,failCalendar=false,emptyList=false,extraAppointments=[];
  let draftWrites=0,failDraft=true;
  const brief={service_id:2,name:'Personal desk sign',description:'Maroon personalized sign',quantity:5,dimensions:'20 x 8 cm',material:'PLA',colors:'Maroon',finish:'Matte',instructions:'',needs_advice:false};
  let job={id:71,appointment_id:51,service_id:2,service_name:'3D Printing',request_key:'fixture-key',state:'awaiting_consultation',stage:'Awaiting consultation',revision:0,requirements:brief,booking:{},files:[],messages:[],quotations:[],orders:[],follow_ups:[],activity:[],next_action:'Attend your consultation.'};
  let quoteWrites=0,cashWrites=0,cacheProgress=false,rejectOutcome=false;
  const agreementFixture={specifications:brief,service:'3D Printing',design_notes:'Approved desk sign layout',proof_file_ids:[],unit_price:200,product_subtotal:1000,shipping_fee:0,total:1000,lead_time:'Five working days',fulfillment_type:'pickup',delivery:{}};
  const customOrder={id:81,order_no:'ORD-000081',customer_name:'Maria Santos',customer_contact:'09171234567',product_name:brief.name,quantity:5,total_amount:1000,total_label:'PHP 1,000.00',subtotal_amount:1000,shipping_fee:0,payment_method:'Cash at FMRC',payment_status:'pending',lifecycle_status:'incoming',customer_stage:'to_pay',fulfillment_type:'pickup',order_type:'custom',items:[{product_name:brief.name,quantity:5,unit_price:200,line_total:1000}],tracking_events:[],created_at:new Date().toISOString(),custom_product:{job_id:71,appointment_id:51,appointment_reference:'AP-00051',service:'3D Printing',quotation_version:1,stage:'Awaiting payment',revision:0,cash_entries:[],available_actions:{record_cash:true},agreement:agreementFixture}};
  const server=http.createServer(async(req,res)=>{
    const route=decodeURIComponent(new URL(req.url,'http://localhost').pathname),role=String(req.headers.authorization||'').includes('staff')?'staff':String(req.headers.authorization||'').includes('customer')?'customer':'admin';
    const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':cacheProgress&&req.method==='GET'&&(route==='/api/appointments'||route.endsWith('/appointment-products/71'))?'public, max-age=60':'no-store'});res.end(JSON.stringify(data));};
    if(route.startsWith('/api/')){
      if(route==='/api/appointment-products/availability')return json({data:{enabled:true,schema_ready:true,services:[{id:2,title:'3D Printing'},{id:3,title:'3D Scanning'},{id:4,title:'Heatpress'}]}});
      if(route==='/api/customer/appointment-products/drafts'&&req.method==='POST'){draftWrites++;if(failDraft){failDraft=false;return json({message:'The connection was interrupted. Your entries are still here.'},503);}return json({message:'Draft saved. No time is reserved.',data:{...job,state:'draft',revision:0}});}
      if(route==='/api/customer/appointment-products/drafts')return json({data:[]});
      if(route.endsWith('/appointment-products/71'))return json({data:job});
      const read=async()=>{let body='';for await(const chunk of req)body+=chunk;return JSON.parse(body||'{}');};
      const copy=()=>JSON.parse(JSON.stringify(job));
      if(route==='/api/commerce/policy')return json({data:{version:'fixture-policy',terms_text:'Production begins after full payment.',refund_text:'Contact FMRC for assistance.'}});
      if(route==='/api/admin/appointment-products/71/outcome'){const input=await read();if(rejectOutcome)return json({message:'Complete an attended consultation before confirming the product discussion.'},422);assert(input.discussion_confirmed);job.discussed_at=new Date().toISOString();job.state='ready_for_quote';job.stage='Preparing quotation';job.revision++;return json({message:'Consultation outcome saved.',data:copy()});}
      if(route==='/api/admin/appointment-products/71/quotations'){const input=await read();assert.equal(Number(input.expected_revision),job.revision);quoteWrites++;job.revision++;job.state='quoted';job.stage='Quotation ready';job.quotations=[{id:91,version:1,state:'sent',agreement:{...agreementFixture,specifications:input.specifications},sent_at:new Date().toISOString(),expires_at:new Date(Date.now()+604800000).toISOString()}];return json({message:'Quotation sent.',data:copy()});}
      if(route==='/api/customer/appointment-products/71/quotations/91/accept'){const input=await read();assert(input.policy_accepted&&input.specifications_accepted);job.revision++;job.quotations[0].state='accepted';job.orders=[{id:81,order_no:'ORD-000081',lifecycle_status:'incoming',payment_status:'pending',payment_method:'Cash at FMRC',total:1000}];return json({message:'Quotation approved.',order_id:81,data:copy()});}
      if(route==='/api/admin/orders/81/custom-product'){const input=await read(),c=customOrder.custom_product;assert.equal(Number(input.expected_revision),c.revision);c.revision++;
        if(input.action==='cash_receipt'){cashWrites++;assert(input.confirmed_received);customOrder.payment_status='paid';c.stage='Paid — Awaiting Production';c.available_actions={start_production:true};c.cash_entries=[{kind:'receipt',amount_centavos:100000,receipt_reference:input.receipt_reference,confirmed_at:new Date().toISOString()}];}
        if(input.action==='start'){customOrder.lifecycle_status='pending';customOrder.customer_stage='to_ship';c.stage='In production';c.available_actions={mark_ready:true};}
        if(input.action==='ready'){customOrder.customer_stage='to_receive';c.stage='Ready for pickup';c.available_actions={collect:true};}return json({data:customOrder});}
      if(route==='/api/admin/orders')return json({data:[customOrder],incoming:[customOrder],directory:[],payments:[]});
      if(route==='/api/admin/orders/81')return json({data:customOrder});
      if(route==='/api/user')return json(role==='customer'?profile:{id:11,role,email:role+'@gmail.com',name:role+' Fixture'});
      if(route==='/api/admin/preferences')return json({user_id:11,preferences:{theme:'light',compact:false,reducedMotion:false}});
      if(route==='/api/admin/session')return json({server_time:new Date().toISOString(),idle_warning_at:new Date(Date.now()+3600000).toISOString(),idle_expires_at:new Date(Date.now()+3780000).toISOString(),absolute_expires_at:new Date(Date.now()+21600000).toISOString()});
      if(route==='/api/maintenance')return json({installed:true,data:{},site_page_installed:true,site_page:{}});
      if(route==='/api/services')return json({data:[{id:2,title:'3D Printing',category:'Prototyping',description:'Custom prototypes and personalized products.',modal_description:'Discuss a personalized product and its final specifications with FMRC.',modal_features:['Personalized designs'],modal_materials:['PLA'],modal_best_for:['Models'],image_data:'/images/FMRC%20Brand%20Logo.png',appointment_products_available:true},{id:3,title:'3D Scanning',category:'Design',description:'Digital recreation of physical objects.',image_data:'/images/FMRC%20Brand%20Logo.png',appointment_products_available:false},{id:4,title:'Heatpress',category:'Manufacturing',description:'Heat transfer printing for custom materials.',image_data:'/images/FMRC%20Brand%20Logo.png',appointment_products_available:false}]});
      if(route==='/api/site-settings')return json({data:{}});
      if(route==='/api/customer/profile')return json({data:profile});
      if(route==='/api/appointments/calendar'&&failCalendar){failCalendar=false;return json({message:'Fixture availability refresh unavailable.'},503);}
      if(route==='/api/appointments/calendar')return json({today,timezone:'Asia/Manila',time_slots:slots,day_settings:[],booked_slots:appointment?{[appointment.appointment_date]:[appointment.appointment_time]}:{}});
      if(route==='/api/appointments'&&req.method==='POST'){
        const chunks=[];for await(const chunk of req)chunks.push(chunk);const form=await new Request('http://localhost',{method:'POST',headers:{'Content-Type':req.headers['content-type']},body:Buffer.concat(chunks)}).formData();booking=Object.fromEntries(form);const files=form.getAll('attachments[]');
        assert.equal(form.get('appointment_method'),'online');assert.equal(files.length,0);assert.equal(form.get('product_requested'),'1');assert.equal(Number(form.get('product_revision')),0);job.state='awaiting_consultation';job.stage='Awaiting consultation';job.requirements=JSON.parse(form.get('product_data'));
        appointment={...booking,id:51,user_id:33,reference_no:'AP-00051',client_name:'Maria Santos',status:'Scheduled',method_label:'Online',meeting_url:null,meeting_platform:null,meeting_status:'Meeting link pending',schedule_version:0,schedule_history:[],can_reschedule:true,attachments:files.map((file,i)=>({id:i+1,name:file.name,size:file.size})),qr_payload:'/appointments/verify/AP-00051',created_at:new Date().toISOString(),custom_product:job,custom_products_available:true};await pause(250);return json({data:appointment},201);
      }
      if(route==='/api/customer/appointments')return json({data:emptyList?[]:appointment?[appointment,...extraAppointments]:[]});
      if(route==='/api/appointments')return json({data:appointment?[appointment]:[]});
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
    const sourceRoute=route.replace(/^\/apps\/customer(?=\/(?:home-page|services-page)\/)/,'').replace(/^\/home-page\/$/,'/home-page/main.html');
    const file=path.resolve(root,'.'+sourceRoute);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
    const ext=path.extname(file);res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[ext]||'application/octet-stream');let content=fs.readFileSync(file);
    if(ext==='.html')content=content.toString().replace('<head>',`<head><script>window.APP_API_BASE_URL=location.origin+'/api';window.fixtureErrors=[];addEventListener('error',event=>{if(event.message)fixtureErrors.push(event.message)});addEventListener('unhandledrejection',event=>fixtureErrors.push(String(event.reason)));for(const role of ['admin','staff']){localStorage.setItem(role+'_auth_token','fixture-'+role);localStorage.setItem(role+'_user_info',JSON.stringify({id:11,role,email:role+'@gmail.com'}));}localStorage.setItem('customer_token','fixture-customer');localStorage.setItem('customer_info',${JSON.stringify(JSON.stringify(profile))});</script>`);res.end(content);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=spawn(chrome,['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+path.join(artifacts,'profile'),'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  let cdp;
  try{
    const endpoint=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Chrome startup')),15000);browser.stderr.on('data',chunk=>{output+=chunk;const match=output.match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timer);resolve(match[1]);}});browser.once('error',reject);});
    const tabs=await(await fetch('http://127.0.0.1:'+new URL(endpoint).port+'/json/list')).json();cdp=await connect(tabs.find(tab=>tab.type==='page').webSocketDebuggerUrl);
    await cdp.send('Page.enable');await cdp.send('Network.enable');await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:true});await cdp.send('Network.setBlockedURLs',{urls:['https://*']});
    const run=async expression=>{const result=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
    const until=async expression=>{for(let i=0;i<180;i++){try{if(await run(expression))return;}catch(error){if(!/context|navigated/i.test(error.message))throw error;}await pause(45);}throw Error('Timeout: '+expression+'; '+JSON.stringify(await run('({url:location.href,errors:fixtureErrors,popup:document.getElementById("customerSystemPopupMessage")?.textContent,adminPopup:document.getElementById("adminSystemPopupMessage")?.textContent,shipping:document.getElementById("checkoutShippingMessage")?.textContent})')));};
    const navigate=async route=>{await cdp.send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+route});await until(`location.pathname===${JSON.stringify(new URL(route,'http://fixture').pathname.replace(/^(\/(?:apps\/customer\/)?home-page)(?:\/main(?:\.html)?)?\/?$/,'$1/'))}&&document.readyState==='complete'`);};
    const input=async(id,value)=>run(`(()=>{const input=document.getElementById(${JSON.stringify(id)});input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    const key=async(value,modifiers=0)=>{await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:value,modifiers,windowsVirtualKeyCode:({Tab:9,Escape:27})[value]});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:value});};
    const confirm=async title=>{await until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupTitle')?.textContent===${JSON.stringify(title)}`);await run(`document.getElementById('adminSystemPopupOk').click()`);};
    const shot=async name=>{await until(`!document.querySelector('.fmrc-load-veil.is-on')&&!document.querySelector('.fmrc-load-boot')`);await run(`document.querySelector('[data-ap-job]')?.scrollIntoView({block:'start',behavior:'instant'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);const image=await cdp.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifacts,name+'.png'),Buffer.from(image.data,'base64'));};
    const centered=async()=>{
      const layout=await run(`(()=>{const card=document.querySelector('#customerAppointmentsModal .appointment-modal'),r=card.getBoundingClientRect();return {x:Math.abs(r.left+r.width/2-innerWidth/2),y:Math.abs(r.top+r.height/2-innerHeight/2),fits:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,overflow:card.scrollWidth>card.clientWidth+1,bodyOverflow:document.querySelector('[data-appointment-content]').scrollWidth>document.querySelector('[data-appointment-content]').clientWidth+1};})()`);
      assert(layout.x<2&&layout.y<2,'Customer appointment dialog stays centered: '+JSON.stringify(layout));assert(layout.fits);assert.equal(layout.overflow,false);assert.equal(layout.bodyOverflow,false);
    };
    const customerFonts=async selector=>{
      const mismatches=await run(`Array.from(document.querySelector(${JSON.stringify(selector)}).querySelectorAll('h1,h2,h3,h4,p,span,label,dt,dd,button,input,select,textarea,small,strong,summary')).filter(node=>node.getClientRects().length&&!node.closest('svg')&&!getComputedStyle(node).fontFamily.startsWith('Montserrat')).map(node=>({tag:node.tagName,class:node.className,font:getComputedStyle(node).fontFamily}))`);
      assert.deepEqual(mismatches,[],'Visible appointment text uses the global Customer Montserrat family');
    };
    const stepPreview=async(step,suffix='')=>{
      for(const width of [320,390,768,1024,1440,1920]){
        await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
        await run(`document.getElementById('appointmentFlow').scrollTop=0;window.scrollTo(0,0);new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
        await run(`Promise.all(document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))`);
        const type=await run(`(()=>{const root=document.getElementById('aptStep'+${step}),h=root.querySelector('h3'),p=root.querySelector('.apt-step-heading p');return {font:getComputedStyle(h).fontFamily,size:parseFloat(getComputedStyle(h).fontSize),body:p?getComputedStyle(p).fontSize:null,overflow:document.documentElement.scrollWidth>innerWidth+1};})()`);
        await customerFonts('#aptStep'+step);
        assert.match(type.font,/Montserrat/);assert(type.size>=18&&type.size<=21);if(step>1)assert.equal(type.body,'14px');assert.equal(type.overflow,false);
        const receipt=await run(`(()=>{const root=document.getElementById('aptStep'+${step}),body=root.querySelector('.ticket-body'),custom=body.querySelector('[data-ap-booking-review]'),details=body.querySelector('.ticket-grid'),qr=body.querySelector('.ticket-qr'),box=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};return {body:box(body),custom:box(custom),details:details&&box(details),qr:qr&&box(qr),padding:parseFloat(getComputedStyle(body).paddingLeft),fields:[...root.querySelectorAll('.t-value')].map(node=>({width:node.getBoundingClientRect().width,overflow:node.scrollWidth>node.clientWidth+1}))};})()`);
        const contentWidth=receipt.body.width-2*receipt.padding;
        assert(Math.abs(receipt.custom.width-contentWidth)<3,'Custom brief spans the receipt: '+JSON.stringify(receipt));
        assert(receipt.fields.every(field=>field.width>=Math.min(150,contentWidth-2)&&!field.overflow),'Receipt fields stay readable: '+JSON.stringify(receipt));
        if(step===5){assert(receipt.custom.top>=Math.max(receipt.details.bottom,receipt.qr.bottom)+15,'Custom brief follows the details and QR');if(width>760)assert(receipt.qr.left>=receipt.details.right+15);else assert(receipt.qr.top>=receipt.details.bottom+10);}
        await shot('customer-booking-step-'+step+suffix+'-'+width);
        if(width===1440){const selector=step===5?'#officialReceiptCard':'#aptStep4 .ticket-container';const bounds=`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height,scale:1};})()`;const before=await run(bounds);await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:Math.ceil(before.y+before.height+40),deviceScaleFactor:1,mobile:false});await run(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);const rect=await run(bounds);const capture=await cdp.send('Page.captureScreenshot',{format:'png',clip:rect});fs.writeFileSync(path.join(artifacts,'customer-receipt-'+step+'.png'),Buffer.from(capture.data,'base64'));}
      }
    };
    const editorStaysOpen=async role=>{
      await run(`(()=>{const root=document.querySelector('[data-ap-appointment]'),form=root.querySelector('[data-ap-form="requirements"]');form.closest('details').open=true;const field=form.elements.name;field.scrollIntoView({block:'center',behavior:'instant'});field.focus({preventScroll:true});field.setSelectionRange(1,4);window.editorState={root,field,scroll:document.getElementById('apptViewBody').scrollTop};})()`);
      const note='Appointment refreshed while '+role+' reads the custom brief';appointment.additional_notes=note;
      await until(`document.querySelector('.appt-view-notes')?.textContent===${JSON.stringify(note)}`);
      assert.equal(await run(`(()=>{const {root,field,scroll}=editorState;return root===document.querySelector('[data-ap-appointment]')&&field.isConnected&&field.closest('details').open&&document.activeElement===field&&field.selectionStart===1&&field.selectionEnd===4&&Math.abs(document.getElementById('apptViewBody').scrollTop-scroll)<3;})()`),true,role+' keeps an open editor, focus, selection and scroll through the real five-second poll');
      await run(`(()=>{const f=document.querySelector('[data-ap-form="requirements"]');f.elements.name.value='Unsaved '+${JSON.stringify(role)}+' requirements';f.elements.name.dispatchEvent(new Event('input',{bubbles:true}));const transfer=new DataTransfer();transfer.items.add(new File(['design'],'unsent-proof.stl',{type:'application/octet-stream'}));const upload=document.querySelector('[data-ap-form="messages"] [name="attachments"]');upload.files=transfer.files;upload.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      job.revision++;job.messages.push({id:100+job.revision,sender_name:'Customer',sender_role:'customer',body:'An incoming clarification',created_at:new Date().toISOString()});
      await until(`document.querySelector('[data-ap-update]')?.hidden===false`);
      assert.equal(await run(`document.querySelector('[data-ap-form="requirements"] [name="name"]').value`),'Unsaved '+role+' requirements');assert.equal(await run(`document.querySelector('[data-ap-form="requirements"]').closest('details').open`),true);assert.equal(await run(`document.querySelector('[data-ap-form="messages"] [name="attachments"]').files[0].name`),'unsent-proof.stl');
      await run(`(()=>{document.querySelector('[data-ap-form="requirements"] [name="name"]').value=${JSON.stringify(brief.name)};document.querySelector('[data-ap-form="messages"] [name="attachments"]').files=new DataTransfer().files;document.querySelectorAll('[data-ap-form]').forEach(f=>f.dataset.dirty='false');document.querySelector('[data-ap-latest]').click();})()`);
      await until(`document.querySelector('[data-ap-update]')?.hidden===true`);
    };
    const operatorButtons=async()=>{
      await run(`document.querySelector('[data-ap-tab="0"]').click();document.querySelector('[data-ap-form="requirements"]').closest('details').open=true`);
      const move=async selector=>{const point=await run(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:'center',behavior:'instant'});const r=n.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await pause(230);return point;};
      const save='[data-ap-form="requirements"] [type="submit"]';await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});await pause(230);
      const solid=await run(`getComputedStyle(document.querySelector('[data-ap-tab="0"]')).backgroundColor`);assert.notEqual(await run(`getComputedStyle(document.querySelector(${JSON.stringify(save)})).backgroundColor`),solid,'Save Details starts with the outlined surface');await move(save);assert.equal(await run(`getComputedStyle(document.querySelector(${JSON.stringify(save)})).backgroundColor`),solid,'Save Details fills maroon on hover');
      for(const name of ['outcome','cancel']){
        await run(`document.querySelector('[data-ap-form="${name}"]').closest('details').open=true`);
        const selector='[data-ap-form="'+name+'"] [type="submit"]';await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});await pause(230);
        assert.notEqual(await run(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).backgroundColor`),solid,name+' starts outlined');await move(selector);await until(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).backgroundColor===${JSON.stringify(solid)}`);assert.equal(await run(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).backgroundColor`),solid,name+' fills maroon on hover');
      }
      for(const tab of [0,1,2]){const selector='[data-ap-tab="'+tab+'"]';await run(`document.querySelector(${JSON.stringify(selector)}).click()`);const point=await move(selector);assert.equal(await run(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).backgroundColor`),solid,'Selected tab stays maroon on hover');await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});assert.equal(await run(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).backgroundColor`),solid,'Selected tab stays maroon while pressed');await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});await run(`document.querySelector(${JSON.stringify(selector)}).focus()`);assert.equal(await run(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).backgroundColor`),solid);}
    };

    const serviceActions=async()=>{
      for(const route of ['/services-page/service.html','/home-page/','/apps/customer/services-page/service.html']){
        await navigate(route);await until(`!!document.querySelector('.service-card .ap-consult-link')`);
        const eligible='.service-card:has(.ap-consult-link)';
        assert.equal(await run(`document.querySelector('${eligible} .service-card-footer').firstElementChild.textContent.trim()`),'Book a Consultation');
        const href=await run(`document.querySelector('${eligible} .ap-consult-link').href`),target=new URL(href);
        assert.equal(target.pathname,route.startsWith('/apps/')?'/apps/customer/home-page/':'/home-page/');assert.equal(target.searchParams.get('custom_service'),'2');
        for(const width of [320,390,768,1440]){
          await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
          await run(`document.querySelector('${eligible}').scrollIntoView({block:'center',behavior:'instant'})`);
          const layout=await run(`(()=>{const card=document.querySelector('${eligible}'),buttons=[...card.querySelectorAll('.service-card-footer > a,.service-card-footer > button')];const rects=buttons.map(b=>b.getBoundingClientRect());return {overflow:document.documentElement.scrollWidth>innerWidth+1,inside:rects.every(r=>r.left>=card.getBoundingClientRect().left&&r.right<=card.getBoundingClientRect().right),style:buttons.map(b=>{const s=getComputedStyle(b);return [s.fontSize,s.fontWeight,s.padding,s.borderWidth,s.borderRadius,s.height,s.textDecorationLine]})};})()`);
          assert.equal(layout.overflow,false,route+' fits '+width);assert(layout.inside);assert.equal(layout.style[0][3],'1px');assert.equal(layout.style[1][3],'0px','Learn more retains its arrow-link style');
          assert.equal(await run(`(()=>{const f=document.querySelector('${eligible} .service-card-footer'),b=f.querySelector('.ap-consult-link').getBoundingClientRect(),l=f.querySelector('.open-modal-btn').getBoundingClientRect(),r=f.getBoundingClientRect();return Math.abs(b.left-r.left)<2&&Math.abs(l.right-r.right)<2;})()`),true,'Booking aligns left and Learn more aligns right');
          assert.match(await run(`getComputedStyle(document.querySelector('${eligible} .ap-consult-link')).fontFamily`),/Montserrat/);
          if(width===1440)assert.equal(await run(`(()=>{const cards=[...document.querySelectorAll('.service-card')].slice(0,3);return Math.max(...cards.map(c=>c.querySelector('.service-image-trigger').getBoundingClientRect().top))-Math.min(...cards.map(c=>c.querySelector('.service-image-trigger').getBoundingClientRect().top))<2;})()`),true,'Eligible and ordinary images align');
          await shot((route.startsWith('/apps/')?'pwa-':route.includes('services-page')?'services-':'home-')+'service-actions-'+width);
        }
        // Booking fills maroon; Learn more retains the familiar underlined hover.
        for(const selector of [eligible+' .ap-consult-link',eligible+' .open-modal-btn']){
          const point=await run(`(()=>{const b=document.querySelector(${JSON.stringify(selector)});b.scrollIntoView({block:'center',behavior:'instant'});const r=b.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
          await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await pause(230);
          if(selector.endsWith('.ap-consult-link'))assert.equal(await run(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).color`),'rgb(255, 255, 255)');else assert.equal(await run(`getComputedStyle(document.querySelector(${JSON.stringify(selector)}+' .details-btn-label')).textDecorationLine`),'underline');
        }
        await run(`document.querySelector('${eligible} .open-modal-btn').click()`);await until(`document.querySelector('#serviceModal.show-modal .service-details-actions a')?.getAttribute('href')`);
        assert.equal(await run(`document.querySelector('#serviceModal .service-details-actions a').href`),href);
        for(const width of [390,768,1440]){
          await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
          const footer=await run(`(()=>{const card=document.querySelector('#serviceModal .modal-box').getBoundingClientRect(),body=document.querySelector('#serviceModal .modal-scroll-area'),foot=document.querySelector('#serviceModal .service-details-actions').getBoundingClientRect();body.scrollTop=body.scrollHeight;return {fits:card.left>=0&&card.right<=innerWidth&&card.top>=0&&card.bottom<=innerHeight,footerOutside:foot.top>=body.getBoundingClientRect().bottom-1,footerVisible:foot.bottom<=innerHeight,overflow:body.scrollWidth>body.clientWidth+1};})()`);
          assert(footer.fits&&footer.footerOutside&&footer.footerVisible);assert.equal(footer.overflow,false);await pause(350);await shot('service-details-booking-'+width);
        }
        await run(`document.querySelector('#serviceModal .service-modal-image-trigger').click()`);await until(`document.getElementById('serviceImageLightboxModal').classList.contains('show-modal')`);await key('Escape');await until(`!document.getElementById('serviceImageLightboxModal').classList.contains('show-modal')`);assert.equal(await run(`document.getElementById('serviceModal').classList.contains('show-modal')`),true);
        await run(`document.getElementById('closeModalBtn').click()`);await until(`!document.getElementById('serviceModal').classList.contains('show-modal')`);
        assert.equal(await run(`document.activeElement===document.querySelector('${eligible} .open-modal-btn')`),true,'Closing returns focus to Learn more');
        await run(`document.querySelector('.service-card:not(:has(.ap-consult-link)) .open-modal-btn').click()`);await until(`document.getElementById('serviceModal').classList.contains('show-modal')`);
        assert.equal(await run(`document.querySelector('#serviceModal .service-details-actions').hidden`),true,'Ineligible details cannot inherit a booking action');
        await run(`document.getElementById('closeModalBtn').click()`);
        await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});assert.equal(await run(`getComputedStyle(document.querySelector('${eligible} .service-action')).transitionDuration`),'0s');await cdp.send('Emulation.setEmulatedMedia',{features:[]});
        assert.deepEqual(await run('fixtureErrors'),[]);
      }
      // A legacy, service-prefilled booking still opens, then returns to clean Home.
      await cdp.send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/home-page/main.html?appointment=1&custom_service=2'});
      await until(`location.pathname==='/home-page/'&&document.getElementById('aptCustomProduct')?.checked`);
      assert.equal(await run(`document.querySelector('#aptCustomFields [name="service_id"]').value`),'2');
      await run(`document.getElementById('closeAppointmentBtn').click()`);
      if(await run(`document.getElementById('aptLeaveConfirmModal')?.classList.contains('show-modal')`))await run(`document.getElementById('acceptLeaveAptBtn').click()`);
      await until(`!document.getElementById('appointmentFlow').classList.contains('show-modal')`);
      assert.equal(await run('location.pathname+location.search'),'/home-page/');
    };
    const audienceCopy=async admin=>{
      const cases=[
        ['awaiting_consultation','Scheduled',admin?/customer.*brief.*consultation/i:/Attend your consultation/],
        ['awaiting_consultation','Completed',admin?/Record the consultation outcome/:/agreed specifications/],
        ['needs_information','Completed',admin?/customer.*reply/:/Send the requested details/],
        ['follow_up','Completed',admin?/with the customer/:/Book a follow-up/],
        ['ready_for_quote','Completed',admin?/prepare the customer/:/FMRC team is preparing/],
        ['quoted','Completed',admin?/Await customer approval/:/approve your quotation/],
        ['expired','Completed',admin?/sending a new version/:/Ask the FMRC team/],
        ['in_production','Completed',admin?/Manage production in Orders/:/FMRC team is making/],
        ['in_transit','Completed',admin?/customer.*receipt confirmation/:/confirm receipt/],
        ['completed','Completed',admin?/This custom order is complete/:/Your custom order is complete/],
      ];
      for(const [state,status,expected]of cases){
        const sample={...job,state:state==='expired'?'quoted':state,progress:state,quotations:['quoted','expired'].includes(state)?[{id:91,version:1,state:'sent',agreement:agreementFixture,sent_at:new Date().toISOString(),expires_at:new Date(Date.now()+(state==='expired'?-10000:600000)).toISOString()}]:[],orders:['in_production','in_transit','completed'].includes(state)?[{id:81,order_no:'ORD-000081',lifecycle_status:state==='completed'?'completed':'pending',payment_status:'paid',fulfillment_type:'delivery'}]:[]};
        const text=await run(`(async()=>{const host=document.createElement('div');host.hidden=true;document.body.append(host);const appointment={...${JSON.stringify(appointment)},status:${JSON.stringify(status)},custom_product:${JSON.stringify(sample)}};${admin?'FMRCAppointmentProducts.mountAdmin(host,appointment);':'await FMRCAppointmentProducts.mountCustomer(host,appointment);'}const text=host.querySelector('.ap-head p').textContent;host.remove();return text;})()`);
        assert.match(text,expected,(admin?'Operator':'Customer')+' guidance for '+state);
      }
    };
    await serviceActions();
    await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:artifacts});

    await navigate('/home-page/main.html');await until(`!!document.getElementById('aptCustomProduct')`);
    await run(`document.querySelector('.btn-appointment').click();document.getElementById('btnGoToPrivacy').click();document.getElementById('acceptPrivacyBtn').click()`);
    assert.equal(await run(`document.getElementById('aptCustomProduct').checked`),false,'Ordinary booking is the default');
    for(const [id,value]of Object.entries({aptLName:'Santos',aptFName:'Maria',aptPhone:'09171234567',aptEmail:'maria@gmail.com',aptMethod:'online',aptPurpose:'3D Printing',aptRole:'Student',aptCountry:'Outside Philippines',aptIntlAddress:'123 Example Avenue, Singapore'})){await input(id,value);await run(`document.getElementById(${JSON.stringify(id)}).dispatchEvent(new Event('change',{bubbles:true}))`);}

    await run(`document.getElementById('aptCustomProduct').click();(()=>{const f=document.getElementById('aptCustomFields');for(const [k,v]of Object.entries(${JSON.stringify(brief)})){if(f.elements[k])f.elements[k].value=v;}})()`);
    await run(`document.getElementById('aptSaveCustomDraft').click();document.getElementById('aptSaveCustomDraft').click()`);
    await until(`document.querySelector('#customerSystemPopup.show #customerSystemPopupTitle')?.textContent==='Draft not saved'`);assert.equal(draftWrites,1);
    assert.equal(await run(`document.getElementById('aptCustomFields').elements.name.value`),brief.name);
    await run(`document.getElementById('customerSystemPopupOk').click()`);
    await until(`!document.getElementById('aptSaveCustomDraft').disabled`);await run(`document.getElementById('aptSaveCustomDraft').click()`);await until(`document.querySelector('#customerSystemPopup.show #customerSystemPopupTitle')?.textContent==='Draft saved'`);assert.equal(draftWrites,2);assert.equal(appointment,null);
    await run(`document.getElementById('customerSystemPopupOk').click()`);
    for(const width of [390,768,1440]){await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});await customerFonts('#aptStep2');assert.equal(await run(`document.documentElement.scrollWidth>innerWidth+1`),false);await run(`document.getElementById('aptCustomProduct').scrollIntoView({block:'start',behavior:'instant'})`);await shot('custom-booking-'+width);}

    await run(`document.getElementById('btnGoToStep3').click()`);await until(`document.getElementById('aptStep3').classList.contains('active')`);
    const targetMonth=new Date(bookedDate+'T12:00:00+08:00').toLocaleDateString('en-US',{month:'long',year:'numeric',timeZone:'Asia/Manila'});
    for(let i=0;i<13&&await run(`document.getElementById('calMonthYear').textContent`)!==targetMonth;i++)await run(`document.getElementById('calNextBtn').click()`);
    const spoken=new Date(bookedDate+'T12:00:00+08:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'Asia/Manila'});
    await run(`document.querySelector('[aria-label="'+${JSON.stringify(spoken)}+', available"]').click();document.querySelector('.time-slot-btn:not(:disabled)').click();document.getElementById('btnGoToConfirm').click();document.getElementById('acceptConfirmBtn').click()`);
    assert.match(await run(`document.querySelector('[data-ap-booking-review]').textContent`),/Personal desk sign/);await stepPreview(4);await run(`document.getElementById('btnGoToStep5').click()`);await until(`document.getElementById('aptStep5').classList.contains('active')`);assert(booking);await stepPreview(5);
    await run(`document.getElementById('btnFinishStep5').click();document.getElementById('btnSuccessHome').click()`);
    appointment.status='Completed';appointment.can_reschedule=false;await audienceCopy(false);
    await navigate('/about-page/about.html');await until(`!!window.FMRCAppointments`);await run(`window.FMRCAppointments.open(51)`);await until(`!!document.querySelector('[data-ap-job]')`);
    for(const width of [390,768,1440]){await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});await centered();await customerFonts('#customerAppointmentsModal');await shot('customer-custom-details-'+width);}
    await run(`document.querySelector('[data-ap-tab="2"]').click();document.querySelector('[data-ap-form="messages"] textarea').value='Please review my changes';document.querySelector('[data-ap-form="messages"] textarea').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-appointments-close]').click()`);
    await until(`document.querySelector('#customerSystemPopup.show #customerSystemPopupTitle')?.textContent==='Unsaved changes'`);await run(`document.getElementById('customerSystemPopupCancel').click()`);assert.equal(await run(`document.getElementById('customerAppointmentsModal').classList.contains('show')`),true);
    await run(`document.querySelector('[data-ap-form="messages"]').dataset.dirty='false'`);
    cacheProgress=true;
    await navigate('/admin-page/appointments.html');await until(`!!document.querySelector('[data-view-id]')`);await run(`document.querySelector('[data-view-id]').click()`);await until(`!!document.querySelector('[data-ap-form="outcome"]')`);await audienceCopy(true);
    await run(`fetch(location.origin+'/api/admin/appointment-products/71',{headers:{Authorization:'Bearer fixture-admin'}}).then(r=>r.json())`);
    rejectOutcome=true;
    await run(`(()=>{const f=document.querySelector('[data-ap-form="outcome"]');f.elements.note.value='Design discussed in the completed meeting';f.elements.discussion_confirmed.checked=true;f.requestSubmit();})()`);
    await until(`document.querySelector('#adminSystemPopup.show #adminSystemPopupTitle')?.textContent==='Action not completed'`);
    assert.equal(await run(`!!document.querySelector('.admin-success-notification')`),false,'an attended-consultation error must never show Success');
    assert.equal(await run(`document.querySelector('[data-ap-form="outcome"]').elements.note.value`),'Design discussed in the completed meeting');
    await run(`document.getElementById('adminSystemPopupOk').click()`);rejectOutcome=false;
    await run(`(()=>{const f=document.querySelector('[data-ap-form="outcome"]');f.elements.note.value='Design discussed in the completed meeting';f.elements.discussion_confirmed.checked=true;f.requestSubmit();})()`);
    await until(`!!document.querySelector('[data-ap-form="quotation"]')`);await run(`document.getElementById('adminSystemPopupOk')?.click()`);await pause(6500);
    assert.equal(await run(`document.querySelector('[data-ap-tab="1"]').getAttribute('aria-selected')`),'true','successful readiness opens Quotation');
    assert.equal(await run(`!!document.querySelector('[data-ap-form="quotation"]')`),true,'a successful outcome must not be replaced by cached appointment progress');
    assert.equal(await run(`document.querySelector('.ap-head .ap-badge').textContent`),'Preparing quotation');
    assert.match(await run(`document.querySelector('[data-ap-pane="1"]').textContent`),/Prepare the quotation below/);
    await until(`document.querySelector('[data-ap-form="requirements"] [name="service_id"]').options.length===3`);
    assert.equal(await run(`document.querySelector('[data-ap-form="requirements"] [name="service_id"]').value`),'2');
    const stale=JSON.parse(JSON.stringify(job));stale.state='awaiting_consultation';stale.stage='Awaiting consultation';stale.discussed_at=null;stale.revision--;
    await run(`window.FMRCAppointmentProducts.mountAdmin(document.getElementById('modalViewAppointment').querySelector('.modal-body-scroll'),${JSON.stringify({...appointment,custom_product:stale})})`);
    assert.equal(await run(`!!document.querySelector('[data-ap-form="quotation"]')`),true,'a lower-revision feed cannot undo an outcome');
    cacheProgress=false;
    await until(`!!document.querySelector('[data-ap-form="quotation"]')`);await run(`document.getElementById('adminSystemPopupOk')?.click();document.querySelector('[data-ap-tab="1"]').click();(()=>{const f=document.querySelector('[data-ap-form="quotation"]');f.closest('details').open=true;f.elements.design_notes.value='Final desk sign layout';f.elements.unit_price.value='200';f.elements.lead_time.value='Five working days';f.requestSubmit();})()`);await confirm('Confirm action');await until(`!!document.querySelector('.ap-message h4')`);assert.equal(quoteWrites,1);await run(`document.getElementById('adminSystemPopupOk')?.click()`);
    const agreement={specifications:brief,service:'3D Printing',design_notes:'Approved desk sign layout',proof_file_ids:[],unit_price:200,product_subtotal:1000,shipping_fee:0,total:1000,lead_time:'Five working days after full payment',fulfillment_type:'pickup',delivery:{}};
    job.discussed_at=new Date().toISOString();job.state='quoted';job.stage='Quotation ready';job.quotations=[{id:91,version:1,state:'sent',agreement,sent_at:new Date().toISOString(),expires_at:new Date(Date.now()+604800000).toISOString()}];
    for(const role of ['admin','staff']){await navigate('/'+role+'-page/appointments.html');await until(`!!document.querySelector('[data-view-id]')`);await run(`document.querySelector('[data-view-id]').click()`);await until(`!!document.querySelector('[data-ap-job]')`);
      await until(`document.querySelector('[data-ap-form="requirements"] [name="service_id"]').options.length===3`);
      assert.equal(await run(`document.querySelector('[data-ap-form="quotation"] [name="spec_service_id"]').disabled`),true,'quotation service follows the reviewed brief');
      await editorStaysOpen(role);
      await run(`document.querySelector('[data-ap-tab="1"]').click()`);
      for(const theme of ['light','dark']){await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.body.classList.toggle('dark-mode',${theme==='dark'});document.body.dataset.theme=${JSON.stringify(theme)}`);await operatorButtons();await run(`document.querySelector('[data-ap-tab="1"]').click()`);for(const width of [390,768,1440]){await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});assert.equal(await run(`document.documentElement.scrollWidth>innerWidth+1`),false);await shot(role+'-quotation-'+theme+'-'+width);}}
      assert.deepEqual(await run('fixtureErrors'),[]);
    }
    await navigate('/home-page/main.html');await until(`!!window.FMRCAppointments`);await run(`window.FMRCAppointments.open(51)`);await until(`!!document.querySelector('[data-ap-form="accept"] button:not(:disabled)')`);
    await run(`(()=>{const f=document.querySelector('[data-ap-form="accept"]');f.elements.policy_accepted.checked=true;f.elements.specifications_accepted.checked=true;f.elements.payment_method.value='cash';f.requestSubmit();})()`);await until(`document.querySelector('#customerSystemPopup.show #customerSystemPopupTitle')?.textContent==='Confirm action'`);await run(`document.getElementById('customerSystemPopupOk').click()`);await until(`document.querySelector('#customerSystemPopup.show #customerSystemPopupTitle')?.textContent==='Saved'`);await run(`document.getElementById('customerSystemPopupOk').click()`);await until(`location.search.includes('order_id=81')`);
    await navigate('/staff-page/orders.html');await until(`!!window.FMRCAppointmentProducts`);await run(`window.FMRCAppointmentProducts.mountOrder(document.getElementById('modalOrderDetails').querySelector('.modal-body-scroll'),${JSON.stringify(customOrder)},true);document.getElementById('modalOrderDetails').classList.add('show')`);
    await run(`(()=>{const f=document.querySelector('[data-ap-order-form="cash_receipt"]');f.elements.receipt_reference.value='CASH-001';f.elements.confirmed_received.checked=true;f.requestSubmit();})()`);await confirm('Confirm action');await until(`!!document.querySelector('[data-ap-production="start"]')`);assert.equal(cashWrites,1);await run(`document.getElementById('adminSystemPopupOk')?.click();document.querySelector('[data-ap-production="start"]').click()`);await confirm('Confirm action');await until(`!!document.querySelector('[data-ap-production="ready"]')`);await run(`document.getElementById('adminSystemPopupOk')?.click();document.querySelector('[data-ap-production="ready"]').click()`);await confirm('Confirm action');await until(`!!document.querySelector('[data-ap-order-form="collect"]')`);await run(`document.getElementById('adminSystemPopupOk')?.click()`);await shot('staff-order-ready');assert.equal(customOrder.custom_product.stage,'Ready for pickup');
    await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});assert.equal(await run(`getComputedStyle(document.querySelector('.ap-btn')).transitionDuration`),'0s');
    console.log('Optional appointment product UI checked with API fixtures; screenshots: '+artifacts);
  }finally{cdp?.close();browser.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
