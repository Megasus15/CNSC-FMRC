const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {browserFixture,chrome}=require('./helpers/website-browser.cjs');
const delivery={id:91,order_no:'ORD-91',order_type:'regular',customer_name:'Fixture Customer',product_name:'Prototype',quantity:1,total_amount:150,total_label:'₱150.00',payment_method:'GCash',payment_status:'paid',payment_is_automated:true,payment_reference:'PAY-91',payment_actions:{paid:{allowed:false},pending:{allowed:false},refunded:{allowed:false}},lifecycle_status:'pending',customer_stage:'to_ship',customer_stage_label:'To Ship',fulfillment_type:'delivery',shipment_tracking_mode:'jnt_dropoff',courier_name:'J&T Express',items:[{product_name:'Prototype',quantity:1,unit_price:150}],timeline:[],cancel_state:'declined',cancel_state_label:'Cancellation declined',cancel_reason:'Changed requirements',courier_shipment:{tracking_provider:'17track',status:'pending',status_label:'Awaiting handover',can_record:true,can_correct:false,can_refresh:false,availability_message:'Automatic tracking is active.'}};
for(const role of ['admin','staff'])test(role+' restores original success X and aligns Orders checkboxes and concise refund retry',{skip:!chrome,timeout:150000},async t=>{
 const font=process.env.FMRC_BROWSER_POPPINS,setup=font?`{let s=document.createElement('style');s.textContent=${JSON.stringify(`@font-face{font-family:Poppins;src:url(data:font/ttf;base64,${fs.readFileSync(font).toString('base64')});font-weight:400}`)};document.head.append(s);}`:'';
 let writes=0;
 const h=await browserFixture(t,async({req,route,json})=>{
  if(req.method!=='GET'&&/\/api\/admin\/(?:gateway|orders)/.test(route))writes++;
  if(route==='/api/admin/orders'){json({incoming:[],directory:[delivery],payments:[],returns:[]});return true;}
  if(route==='/api/admin/orders/91'){json({data:delivery});return true;}
  if(route==='/api/admin/gateway-payments'){
   json({can_approve:role==='admin',payments:{data:[{id:1,order_id:91,order_no:'ORD-91',customer_name:'Fixture Customer',status:'paid',amount:150,refund_action:{allowed:false}}],last_page:1,current_page:1,total:1},receipts:[{payment_id:1,provider_payment_id:'pay_91',amount_centavos:15000,source_type:'qrph'}],refunds:[{id:7,payment_id:1,order_id:91,provider_payment_id:'pay_91',amount_centavos:15000,status:'failed',actions:{retry:{allowed:true}},failure_action:'A lengthy provider explanation that stays available in refund history.'}],attempts:[]});return true;
  }
  return false;
 },{setup});await h.send('Network.setBlockedURLs',{urls:['https://*']});
 const shot=async n=>{await h.run(`Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))`);await h.shot(n);};
 for(const page of ['inventory','products','promotions','customer-inquiries','orders','ratings']){
  await h.go('/'+role+'-page/'+page+'.html');await h.until(`typeof showAdminPopup==='function'&&typeof showAdminSuccessNotification==='function'`);
  await h.run(`window.fixtureSuccessCallback=0;showAdminPopup('Saved successfully.',{type:'success',onOk:()=>fixtureSuccessCallback++})`);await h.until(`document.querySelector('.admin-success-notification__close svg')`);
  assert.equal(await h.run(`document.querySelector('.admin-success-notification__close').textContent.trim()`),'');
  assert.equal(await h.run(`document.querySelector('.admin-success-notification__close').getAttribute('aria-label')`),'Close success notification');
  assert.equal(await h.run('fixtureSuccessCallback'),1);if(page==='customer-inquiries'){await h.pause(220);await h.shot(role+'-success-toast');}await h.run(`document.querySelector('.admin-success-notification__close').click()`);await h.until(`!document.querySelector('.admin-success-notification')`);
 }
 await h.run(`showAdminSuccessNotification('Saved automatically.')`);await h.until(`document.querySelector('.admin-success-notification')`);await h.until(`!document.querySelector('.admin-success-notification')`);
 await h.go('/'+role+'-page/orders.html');await h.until(`document.querySelector('[data-order-view="91"]')`);await h.run(`document.querySelector('[data-order-view="91"]').click()`);await h.until(`document.querySelector('#modalOrderDetails .jnt-confirm')`);
 for(const width of [320,390,768,1024,1440])for(const theme of ['light','dark']){
  await h.send('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:width<600});await h.run(`document.documentElement.dataset.theme='${theme}';document.querySelector('#modalOrderDetails .jnt-confirm').scrollIntoView({block:'center',behavior:'instant'})`);
  const g=await h.run(`(()=>{const l=document.querySelector('#modalOrderDetails .jnt-confirm'),i=l.querySelector('input'),s=l.querySelector('span'),a=i.getBoundingClientRect(),b=s.getBoundingClientRect(),body=document.querySelector('#modalOrderDetails .portal-detail-dialog__body'),notice=document.querySelector('[data-cancellation-notice]');return {width:a.width,height:a.height,gap:b.left-a.right,top:a.top-b.top,overflow:body.scrollWidth>body.clientWidth+1,color:getComputedStyle(body).scrollbarColor,border:getComputedStyle(notice).borderLeftColor}})()`);
  assert.equal(g.width,18);assert.equal(g.height,18);assert(g.gap>=9&&g.gap<=11&&g.top>=0&&g.top<=5&&!g.overflow,JSON.stringify({width,theme,g}));
  assert(!g.color.includes('128, 0, 0'));assert.notEqual(g.border,'rgb(128, 0, 0)');if([390,1440].includes(width))await shot(role+'-order-checkbox-'+width+'-'+theme);
 }
 await h.run(`document.querySelector('#modalOrderDetails .portal-detail-dialog__close').click();document.querySelector('[data-tab=refunds]').click()`);await h.until(`document.querySelector('[data-retry="7"]')`);await h.run(`document.querySelector('[data-retry="7"]').click()`);await h.until(`document.querySelector('.gateway-team-dialog[open]')`);
 assert.equal(await h.run(`document.querySelector('.gateway-team-dialog [data-title]').textContent`),'Retry refund');
 const text=await h.run(`document.querySelector('.gateway-team-dialog [data-description]').textContent`);assert(text.length<260);assert.match(text,/PayMongo/);assert.match(text,/₱150.00/);assert.match(text,/claim/);
 assert.equal(await h.run(`document.querySelector('.gateway-team-dialog [type=submit]').textContent`),role==='admin'?'Retry refund':'Request retry');
 assert.equal(await h.run(`getComputedStyle(document.querySelector('.gateway-team-dialog .portal-detail-dialog__close')).display`),'none');
 for(const width of [320,390,768,1024,1440]){
  await h.send('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:width<600});assert(await h.run(`(()=>{let d=document.querySelector('.gateway-team-dialog'),r=d.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&d.scrollWidth<=d.clientWidth+1})()`));if([390,1440].includes(width))await shot(role+'-refund-retry-'+width);
 }
 await h.run(`document.querySelector('.gateway-team-dialog [data-cancel]').click()`);assert.equal(writes,0,'Appearance checks never submit a payment or refund');assert.deepEqual(await h.run('fixtureErrors'),[]);t.diagnostic('Screenshots: '+h.artifacts);
});
test('All Admin/Staff HTML consumers use the restored shared success notification version',()=>{
 for(const folder of ['admin-page','staff-page'])for(const name of fs.readdirSync(path.resolve(__dirname,'../../..',folder)).filter(n=>n.endsWith('.html'))){
  const text=fs.readFileSync(path.resolve(__dirname,'../../..',folder,name),'utf8');
  for(const ref of text.matchAll(/admin-common\.js\?v=([^"\s]+)/g))assert.equal(ref[1],'2026.1114.12',folder+'/'+name);
 }
});
