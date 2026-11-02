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
test('shipping draft/publication, Staff read access, customer quote review and order details agree across responsive portals',{skip:!fs.existsSync(chrome),timeout:180000},async()=>{
  const artifacts=fs.mkdtempSync(path.join(os.tmpdir(),'fmrc-shipping-'));
  let settings={revision:0,draft:{enabled:false,nonworking_weekdays:[6,7],nonworking_dates:[],zones:[]},published:null,published_version:null,published_at:null};
  let quotes=0,stale=true,fee=85.5,deliveryAvailable=true,settingsUnavailable=false;
  const writes=[],submissions=[],policyHistory=new Map(),shipmentWrites=[];
  let policySettings={revision:0,can_edit:true,has_saved_draft:false,published:null,draft:{title:'FMRC Transaction Terms and Refund Policy',terms_text:'Ordering and delivery\nReview the full order total and fulfillment details before ordering.',refund_text:'Eligible concerns\nContact FMRC to review defective, incorrect, or incomplete items and appropriate remedies.'}};
  const profile={id:33,role:'customer',email:'client@gmail.com',name:'Fixture Client',phone_number:'09171234567',address_line:'1 Test Street',barangay:'Barangay 1',city_municipality:'Daet',province:'Camarines Norte',postal_code:'4600',address_details:'Near the main gate',department:'Student',customer_type:'Student'};
  const product={id:1,name:'Prototype',category:'Fabrication',code:'SHIP',price:123.45,stock:20,stock_status:'in_stock',is_blocked:false,image_data:'/images/FMRC Logo.png'};
  const pricing={has_shipping_snapshot:true,item_subtotal:246.9,item_subtotal_label:'₱246.90',shipping_fee:85.5,shipping_fee_label:'₱85.50',payable_total:332.4,payable_total_label:'₱332.40',estimated_delivery_from:'2026-11-11',estimated_delivery_to:'2026-11-13',estimated_delivery_label:'Nov 11, 2026 – Nov 13, 2026'};
  const order={id:71,order_no:'ORD-SHIP',order_no_display:'#ORD-SHIP',customer_id:33,customer_name:'Fixture Client',customer_contact:'09171234567',product_name:'Prototype',quantity:2,total_amount:332.4,total_label:'₱332.40',pricing,payment_method:'COD',payment_status:'pending',payment_amount:332.4,fulfillment_type:'delivery',fulfillment_label:'Courier Delivery',lifecycle_status:'incoming',customer_stage:'to_pay',customer_stage_label:'To Pay',created_at:'2026-11-02T08:00:00+08:00',delivery_address:{recipient_name:'Fixture Client',city:'Daet',province:'Camarines Norte'},items:[{id:1,product_id:1,product_name:'Prototype',quantity:2,unit_price:123.45,line_total:246.9}],tracking_events:[],timeline:[],stage_labels:{to_pay:'To Pay',to_ship:'To Ship',to_receive:'To Receive',completed:'Completed'}};
  const quote=input=>{const pickup=input.fulfillment_type==='pickup';const subtotal=(input.items || [{quantity:input.quantity}]).reduce((sum,item)=>sum+item.quantity*123.45,0);if(!pickup&&!deliveryAvailable)return {available:false,item_subtotal:subtotal,shipping_fee:null,payable_total:null,message:'Delivery is unavailable. Choose pickup at FMRC.'};return {available:true,fulfillment_type:input.fulfillment_type,item_subtotal:subtotal,shipping_fee:pickup?0:fee,payable_total:subtotal+(pickup?0:fee),estimated_delivery_from:pickup?null:'2026-11-11',estimated_delivery_to:pickup?null:'2026-11-13',expires_at:new Date(Date.now()+900000).toISOString(),quote_token:'fixture-quote-'+(++quotes)};};
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost'),route=decodeURIComponent(url.pathname);
    const role=String(req.headers.authorization||'').includes('staff')?'staff':String(req.headers.authorization||'').includes('customer')?'customer':'admin';
    const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    if(route.startsWith('/api/')){
      if(settingsUnavailable && ['/api/admin/shipping-settings','/api/admin/commerce-policy'].includes(route))return json({message:'Settings are temporarily unavailable. Please try again later.'},503);
      if(route==='/api/user')return json(role==='customer'?profile:{id:role==='staff'?22:11,role,email:role+'@gmail.com',name:role+' Fixture'});
      if(route==='/api/admin/preferences')return json({user_id:role==='staff'?22:11,preferences:{theme:'light',compact:false,reducedMotion:false}});
      if(route==='/api/admin/session')return json({server_time:new Date().toISOString(),idle_warning_at:new Date(Date.now()+3600000).toISOString(),idle_expires_at:new Date(Date.now()+3780000).toISOString(),absolute_expires_at:new Date(Date.now()+21600000).toISOString()});
      if(route==='/api/maintenance')return json({installed:true,data:{},site_page_installed:true,site_page:{}});
      if(route==='/api/site-settings')return json({data:{payment_cash_on_pickup_enabled:'1',payment_cash_on_delivery_enabled:'1',payment_gcash_enabled:'1',payment_gcash_ready:'1',payment_checkout_method:'qrph'}});
      if(route==='/api/customer/profile')return json({data:profile});
      if(route==='/api/products')return json({data:[product]});
      if(route==='/api/admin/shipping-settings')return json({data:{...settings,can_edit:role==='admin',...(role==='staff'?{draft:undefined}:{})}});
      if(route==='/api/commerce/policy'||route.startsWith('/api/commerce/policy/'))return json({data:route==='/api/commerce/policy'?policySettings.published:policyHistory.get(route.split('/').at(-1))||null});
      if(route==='/api/admin/commerce-policy')return json({data:{...policySettings,can_edit:role==='admin',...(role==='staff'?{draft:undefined}:{})}});
      if(route==='/api/admin/commerce-policy/draft'||route==='/api/admin/commerce-policy/publish'){
        assert.equal(role,'admin');let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);assert.equal(input.expected_revision,policySettings.revision);
        if(route.endsWith('/draft')){policySettings.draft={title:input.title,terms_text:input.terms_text,refund_text:input.refund_text};policySettings.has_saved_draft=true;}
        else{assert.equal(input.approved,true);if(!policySettings.has_saved_draft){assert.deepEqual(input.initial_draft,policySettings.draft);policySettings.has_saved_draft=true;}policySettings.published={...policySettings.draft,version:crypto.randomUUID(),published_at:'2026-11-02 00:00:00'};policyHistory.set(policySettings.published.version,structuredClone(policySettings.published));}
        policySettings.revision++;return json({data:policySettings});
      }
      if(route==='/api/admin/shipping-settings/draft'||route==='/api/admin/shipping-settings/publish'){
        assert.equal(role,'admin');let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);writes.push({route,input});
        assert.equal(input.expected_revision,settings.revision);
        if(route.endsWith('draft'))settings.draft=input.settings;
        else{assert.equal(input.approved,true);settings.published=structuredClone(settings.draft);settings.published_at='2026-11-02 00:00:00';settings.published_version='fixture-version';}
        settings.revision++;return json({data:{...settings,can_edit:true}});
      }
      if(route==='/api/shipping/quote'){let body='';for await(const chunk of req)body+=chunk;return json({data:quote(JSON.parse(body))});}
      if(route==='/api/orders'&&req.method==='POST'){
        let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);submissions.push(input);
        if(stale){stale=false;fee=95.5;return json({code:'shipping_quote_stale',message:'Review your updated quote.',quote:quote(input)},409);}
        Object.assign(pricing,{shipping_fee:fee,shipping_fee_label:'₱'+fee.toFixed(2),payable_total:input.total_amount,payable_total_label:'₱'+input.total_amount.toFixed(2)});
        Object.assign(order,{total_amount:input.total_amount,total_label:pricing.payable_total_label,payment_amount:input.total_amount,accepted_policy:{...policySettings.published,accepted_at_label:'Nov 2, 2026, 8:00 AM'}});
        return json({data:order},201);
      }
      if(route.startsWith('/api/admin/orders/71/shipment/')){
        let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);shipmentWrites.push({route,input});
        await pause(250);
        if(route.endsWith('/book'))order.courier_shipment={...order.courier_shipment,id:1,status:'pending_pickup',status_label:'Pending pickup',tracking_number:'NINJA123456789',reference:'FMRC-FIXTURE',can_book:false,can_cancel:true,can_retry:false,parcel:input,actual_booking_cost:input.actual_booking_cost,events:[{status:'Pending Pickup',occurred_at:'2026-11-02T08:00:00Z',occurred_at_label:'Nov 2, 2026, 4:00 PM',location:'FMRC'}]};
        if(route.endsWith('/cancel'))order.courier_shipment={...order.courier_shipment,status:'cancelled',status_label:'Shipment cancelled',can_book:true,can_cancel:false,tracking_number:null,events:[...order.courier_shipment.events,{status:'Shipment cancelled',occurred_at:'2026-11-02T08:01:00Z',occurred_at_label:'Nov 2, 2026, 4:01 PM'}]};
        return json({data:order});
      }
      if(route==='/api/customer/orders')return json({data:[order]});
      if(route==='/api/customer/orders/71'||route==='/api/admin/orders/71')return json({data:order});
      if(route==='/api/admin/orders')return json({incoming:[order],directory:[],payments:[],returns:[],returns_summary:{},cancellations_summary:{},generated_at:new Date().toISOString()});
      return json({data:[]});
    }
    const file=path.resolve(root,'.'+route);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
    const ext=path.extname(file);res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[ext]||'application/octet-stream');
    let content=fs.readFileSync(file);
    // Reproduce the generic cosmetic filter that hid the old policy status panel.
    if(ext==='.html')content=content.toString().replace('<head>',`<head><style>#policyNotice{display:none!important}</style><script>window.APP_API_BASE_URL=location.origin+'/api';window.fixtureErrors=[];addEventListener('error',event=>{if(event.message)fixtureErrors.push(event.message)});addEventListener('unhandledrejection',event=>fixtureErrors.push(String(event.reason)));for(const role of ['admin','staff']){localStorage.setItem(role+'_auth_token','fixture-'+role);localStorage.setItem(role+'_user_info',JSON.stringify({id:role==='admin'?11:22,role,email:role+'@gmail.com'}));}localStorage.setItem('customer_token','fixture-customer');localStorage.setItem('customer_info',${JSON.stringify(JSON.stringify(profile))});</script>`);
    res.end(content);
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
    for(const portal of ['admin','staff']){
      for(const page of ['shipping','policies']){
        settingsUnavailable=true;
        await navigate('/'+portal+'-page/website-'+page+'.html');
        const shipping=page==='shipping';
        const errorId=shipping?'shippingError':'policySettingsError';
        const retryId=shipping?'shippingRetry':'policySettingsRetry';
        const saveId=shipping?'shippingSave':'policyDraftSave';
        const publishedId=shipping?'shippingPublished':'policyPublishedMessage';
        await until(`!document.getElementById('${errorId}').hidden&&!document.getElementById('${retryId}').disabled`);
        assert.equal(await run(`document.getElementById('${saveId}').disabled`),true);
        assert.match(await run(`document.getElementById('${publishedId}').textContent`),/unavailable/i);
        assert.doesNotMatch(await run(`document.getElementById('${publishedId}').textContent`),/loading/i);
        settingsUnavailable=false;
        await run(`document.getElementById('${retryId}').click()`);
        await until(`document.getElementById('${errorId}').hidden&&!document.getElementById('${retryId}').disabled&&!document.getElementById('${publishedId}').textContent.includes('settings are unavailable')`);
        assert.equal(await run(`document.getElementById('${saveId}').disabled`),true,'Readback does not enable unchanged saves');
      }
    }
    await navigate('/admin-page/website-shipping.html');await until(`!document.getElementById('shippingFields').disabled`);
    assert(await run(`document.getElementById('shippingSave').disabled&&document.getElementById('shippingPublish').disabled`));
    await run(`document.getElementById('shippingAddZone').click()`);
    for(const [key,value]of Object.entries({name:'Camarines Norte',province:'Camarines Norte',fee:'85.50'}))await input('shipping-0-'+key,value);
    await run(`document.getElementById('shippingEnabled').click()`);await input('shippingDates','2026-11-09');
    assert.equal(await run(`document.getElementById('shippingSave').disabled`),false);
    await run(`document.getElementById('shippingSave').click()`);await confirm('Save Shipping Draft');await until(`document.getElementById('shippingSave').disabled&&!document.getElementById('shippingFields').disabled`);
    assert.equal(writes.length,1);assert.equal(settings.published,null);
    await run(`document.getElementById('shippingApproved').click();document.getElementById('shippingPublish').click()`);await confirm('Publish Shipping Settings');await until(`document.getElementById('shippingPublished').textContent.includes('85.50')&&document.getElementById('shippingPublish').disabled`);
    for(const portal of ['admin','staff'])for(const width of [390,768,1440])for(const theme of ['light','dark']){
      await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await navigate('/'+portal+'-page/website-shipping.html');
      await until(`document.getElementById('shippingPublished').textContent.includes('85.50')&&!document.querySelector('.website-section-loading,.fmrc-load-veil.is-on')`);
      await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)};Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))`);
      assert.equal(await run(`document.documentElement.scrollWidth>innerWidth+1`),false,portal+' shipping '+width+theme);
      assert.equal(await run(`document.getElementById('shippingEditor').hidden`),portal==='staff');
      if(portal==='staff')assert.equal(await run(`getComputedStyle(document.getElementById('shippingSaveBar')).display`),'none');
      if(width!==768)await shot(portal+'-settings-'+width+'-'+theme);
      assert.deepEqual(await run('fixtureErrors'),[]);
    }
    console.log('Verified saved draft, approval publication, reload persistence, Staff read access, and 12 settings layouts.');
    for(const page of ['transaction-terms','refund-policy']){
      await navigate('/products-page/'+page+'.html');
      await until(`document.getElementById('policyDocument').getAttribute('aria-busy')==='false'&&!document.documentElement.classList.contains('fmrc-booting')&&!document.querySelector('.fmrc-load-boot')`);
      assert.equal(await run(`document.getElementById('policyNoticeTitle').textContent`),'Policy awaiting publication');
      assert.equal(await run(`getComputedStyle(document.getElementById('fmrcPolicyState')).display`),'block');
      assert(await run(`document.getElementById('fmrcPolicyState').getBoundingClientRect().height>0`),'Unpublished state remains visible with generic notice-hiding filters');
      assert.equal(await run(`document.getElementById('policySections').hidden`),true);
      assert.equal(await run(`document.querySelector('.site-header .main-nav [aria-current="page"]')===null`),true);
      await shot('customer-'+page+'-unpublished');
    }
    for(const portal of ['staff','admin']){
      await navigate('/'+portal+'-page/website-policies.html');await until(`document.getElementById('policyPublishedTitle').textContent==='No published policies'`);
      assert.equal(await run(`document.getElementById('policyPublishedDocuments').hidden`),true,'No empty published accordions in '+portal);
      assert.match(await run(`document.getElementById('policyPublishedMessage').textContent`),portal==='admin'?/save the draft/:/has not published/);
    }
    await until(`!document.getElementById('policyEditorFields').disabled`);
    assert(await run(`document.getElementById('policyDraftSave').disabled&&document.getElementById('policyPublish').disabled`));
    await run(`document.getElementById('policyApproval').click()`);
    assert.equal(await run(`document.getElementById('policyPublish').disabled`),false,'Reviewed unchanged starting policies can be published');
    assert.equal(await run(`document.getElementById('policyDraftSave').disabled`),true,'Unchanged Save stays disabled');
    const startingDraft=structuredClone(policySettings.draft);
    await run(`document.getElementById('policyPublish').click()`);await confirm('Publish Approved Policy');
    await until(`!document.getElementById('policyPublishedLink').hidden&&!document.getElementById('policyEditorFields').disabled`);
    assert.deepEqual(policySettings.draft,startingDraft,'First publication does not require a text edit');
    assert.equal(policySettings.has_saved_draft,true);assert.equal(policySettings.published.refund_text,startingDraft.refund_text);
    await input('policyDraftRefund',policySettings.draft.refund_text+'\n\nAssistance\nKeep your order number available when requesting assistance.');
    await run(`document.getElementById('policyDraftSave').click()`);await confirm('Save Policy Draft');await until(`!document.getElementById('policyEditorFields').disabled&&document.getElementById('policyDraftSave').disabled`);
    assert.equal(policySettings.published.refund_text,startingDraft.refund_text,'Saving edits does not change the live policy');
    await run(`document.getElementById('policyApproval').click();document.getElementById('policyPublish').click()`);await confirm('Publish Approved Policy');await until(`!document.getElementById('policyPublishedLink').hidden&&document.getElementById('policyPublish').disabled`);
    for(const portal of ['admin','staff'])for(const width of [390,1440])for(const theme of ['light','dark']){
      await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await navigate('/'+portal+'-page/website-policies.html');
      await until(`document.getElementById('policyPublishedTerms').textContent.includes('Ordering and delivery')&&!document.querySelector('.website-section-loading,.fmrc-load-veil.is-on')`);
      await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      assert.equal(await run(`document.documentElement.scrollWidth>innerWidth+1`),false);
      assert.equal(await run(`document.getElementById('policyDraftEditor').hidden`),portal==='staff');
      assert.equal(await run(`document.getElementById('policyPublishedDocuments').hidden`),false);
      await run(`document.querySelectorAll('#policyPublishedDocuments details').forEach(detail=>detail.open=true)`);
      assert.match(await run(`document.getElementById('policyPublishedTerms').textContent`),/Ordering and delivery/);
      assert.match(await run(`document.getElementById('policyPublishedRefund').textContent`),/Eligible concerns/);
      assert.match(await run(`document.getElementById('policyPublishedTermsLink').href`),/transaction-terms\.html\?version=/);
      if(portal==='staff')assert.equal(await run(`getComputedStyle(document.getElementById('policySaveBar')).display`),'none');
      await shot(portal+'-policy-'+width+'-'+theme);
      if(portal==='admin'){
        assert.equal(await run(`document.querySelector('.policy-approval span').textContent`),'FMRC has approved these policies for publication.');
        await run(`document.querySelector('.policy-approval').scrollIntoView({block:'center',behavior:'instant'})`);
        await shot('admin-policy-approval-'+width+'-'+theme);
      }
    }
    console.log('Verified private policy drafts, approval publication, reload persistence, Staff read access and eight policy layouts.');
    await navigate('/products-page/product.html');await until(`document.getElementById('displayClientName').textContent.includes('Fixture')`);
    await run(`document.dispatchEvent(new CustomEvent('product:buy-now',{detail:${JSON.stringify(product)}}));document.getElementById('hiddenPaymentSelect').value='Cash on Delivery';document.getElementById('hiddenPaymentSelect').dispatchEvent(new Event('change'));`);
    for(const method of ['Cash on Pickup','GCash','Cash on Delivery']){
      await run(`document.getElementById('hiddenPaymentSelect').value=${JSON.stringify(method)};document.getElementById('hiddenPaymentSelect').dispatchEvent(new Event('change'));`);
      assert.equal(await run(`getComputedStyle(document.querySelector('.checkout-fulfillment')).display==='none'`),method!=='GCash','Only online payment needs a separate delivery/pickup choice');
      if(method==='Cash on Pickup')assert(await run(`document.getElementById('fulfillPickupRadio').checked`));
      if(method==='Cash on Delivery')assert(await run(`document.getElementById('fulfillDeliveryRadio').checked`));
      if(method==='GCash'){
        const instructions=await run(`document.getElementById('gcashUnconfiguredNote').textContent`);
        assert.equal(instructions,'Continue to secure checkout to pay using QR Ph. Payment confirmation updates automatically.');
        assert.doesNotMatch(instructions,/GCash/);
      }
    }
    await until(`document.getElementById('checkoutShippingFee').textContent.includes('85.50')&&!document.getElementById('orderTerms').disabled`);
    await run(`if(!document.getElementById('checkoutShippingAccept').hidden)document.getElementById('checkoutShippingAccept').click()`);
    assert(await run(`document.getElementById('submitOrderBtn').disabled`));
    const link=await run(`(()=>{const link=document.getElementById('checkoutRefundLink');return {target:link.target,rel:link.rel,color:getComputedStyle(link).color,href:link.href}})()`);
    assert.equal(link.target,'_blank');assert.match(link.rel,/noopener/);assert.equal(link.color,'rgb(128, 0, 0)');
    for(const [linkId,page,textId,expected]of [['checkoutRefundLink','refund-policy','policyRefundText','Eligible concerns'],['checkoutTermsLink','transaction-terms','policyTermsText','Ordering and delivery']]){
    const targetsBefore=(await cdp.send('Target.getTargets')).targetInfos.map(target=>target.targetId);
    await run(`document.getElementById('${linkId}').scrollIntoView({block:'center'})`);
    const refundPoint=await run(`(()=>{const r=document.getElementById('${linkId}').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...refundPoint});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...refundPoint});
    let policyTab;
    for(let i=0;i<120;i++){policyTab=(await cdp.send('Target.getTargets')).targetInfos.find(target=>!targetsBefore.includes(target.targetId)&&target.url.includes(page+'.html'));if(policyTab)break;await pause(50);}
    assert(policyTab,page+' opens its own browser tab');
    const targetList=await(await fetch('http://127.0.0.1:'+new URL(endpoint).port+'/json/list')).json();
    const policyPage=await connect(targetList.find(target=>target.id===policyTab.targetId).webSocketDebuggerUrl);
    try{
      for(let i=0;i<150;i++){const state=await policyPage.send('Runtime.evaluate',{expression:`document.getElementById('${textId}')?.textContent.includes('${expected}')`,returnByValue:true});if(state.result.value)break;await pause(50);}
      const text=await policyPage.send('Runtime.evaluate',{expression:`document.getElementById('${textId}')?.textContent`,returnByValue:true});assert(text.result.value.includes(expected));
      const active=await policyPage.send('Runtime.evaluate',{expression:`({policy:document.querySelector('.policy-switcher [aria-current="page"]').href,header:!!document.querySelector('.site-header .main-nav [aria-current="page"]'),articles:document.querySelectorAll('#policySections article').length})`,returnByValue:true});
      assert(active.result.value.policy.includes(page+'.html?version='));assert.equal(active.result.value.header,false);assert.equal(active.result.value.articles,1);
      for(let i=0;i<150;i++){const state=await policyPage.send('Runtime.evaluate',{expression:"document.readyState==='complete'&&!document.documentElement.classList.contains('fmrc-booting')&&!document.querySelector('.fmrc-load-boot')",returnByValue:true});if(state.result.value)break;await pause(50);}
      for(const width of [390,768,1440]){
        await policyPage.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
        await policyPage.send('Runtime.evaluate',{expression:`scrollTo({top:0,behavior:'instant'})`});
        const layout=await policyPage.send('Runtime.evaluate',{expression:"({overflow:document.documentElement.scrollWidth>innerWidth+1,errors:fixtureErrors,boot:!!document.querySelector('.fmrc-load-boot')})",returnByValue:true});
        assert.equal(layout.result.value.overflow,false,'policy page fits '+width);assert.equal(layout.result.value.boot,false);assert.deepEqual(layout.result.value.errors,[]);
        const shotPolicy=await policyPage.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifacts,'customer-'+page+'-tab-'+width+'.png'),Buffer.from(shotPolicy.data,'base64'));
      }
    }finally{policyPage.close();await cdp.send('Target.closeTarget',{targetId:policyTab.targetId});}
    }
    assert(await run(`document.getElementById('checkoutModal').classList.contains('show-modal')`),'the original checkout remains open');
    await run(`document.getElementById('orderTerms').click()`);await until(`!document.getElementById('submitOrderBtn').disabled`);
    await run(`document.getElementById('btnPlusQty').click()`);
    await until(`!document.getElementById('checkoutShippingAccept').hidden`);
    assert(await run(`document.getElementById('submitOrderBtn').disabled`));await run(`document.getElementById('checkoutShippingAccept').click()`);
    await until(`document.getElementById('checkoutGrandTotal').textContent.includes('332.40')`);
    for(const width of [390,768,1440]){await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await run(`document.getElementById('checkoutShippingQuote').scrollIntoView({block:'center'})`);await pause(100);assert.equal(await run(`document.documentElement.scrollWidth>innerWidth+1`),false);await shot('customer-checkout-'+width);}
    policySettings.published={...policySettings.published,version:crypto.randomUUID(),refund_text:policySettings.published.refund_text+'\n\nUpdated assistance wording.'};policyHistory.set(policySettings.published.version,structuredClone(policySettings.published));
    await run(`document.getElementById('submitOrderBtn').click()`);await until(`document.getElementById('customerSystemPopup')?.classList.contains('show')`);
    assert.equal(submissions.length,0,'new publication is caught before any order POST');
    assert.equal(await run(`document.getElementById('orderTerms').checked`),false);
    await run(`document.getElementById('customerSystemPopupOk').click();document.getElementById('orderTerms').click();document.getElementById('submitOrderBtn').click()`);
    await until(`!document.getElementById('checkoutShippingAccept').hidden&&document.getElementById('checkoutShippingFee').textContent.includes('95.50')`);
    assert.equal(submissions.length,1);assert.equal(submissions[0].total_amount,332.4);assert(submissions[0].shipping_quote_token);
    await until(`document.getElementById('customerSystemPopup')?.classList.contains('show')`);await run(`document.getElementById('customerSystemPopupOk').click()`);
    await run(`document.getElementById('checkoutShippingAccept').click()`);await until(`!document.getElementById('submitOrderBtn').disabled`);
    await run(`document.getElementById('submitOrderBtn').click()`);await until(`!document.getElementById('checkoutModal').classList.contains('show-modal')`);
    assert.equal(submissions.length,2);assert.equal(submissions[1].total_amount,342.4);
    console.log('Verified Customer quantities, quote review, totals, stale quote recovery and accepted token submission.');
    deliveryAvailable=false;
    await until(`!document.querySelector('.fmrc-load-veil.is-on')&&document.getElementById('orderSuccessModal').classList.contains('active')`);
    await run(`document.getElementById('orderSuccessOkBtn')?.click();document.dispatchEvent(new CustomEvent('product:buy-now',{detail:${JSON.stringify(product)}}))`);
    await until(`!document.getElementById('orderSuccessModal').classList.contains('active')`);
    await until(`!document.getElementById('checkoutShippingPickup').hidden`);
    assert(await run(`document.getElementById('submitOrderBtn').disabled`));
    for(const width of [390,768,1440]){
      await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
      await run(`document.getElementById('checkoutShippingPickup').scrollIntoView({block:'center',behavior:'instant'})`);
      await until(`(()=>{const target=document.getElementById('checkoutShippingPickup'),r=target.getBoundingClientRect();return target.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`);
      const alignment=await run(`(()=>{const target=document.getElementById('checkoutShippingPickup'),button=target.getBoundingClientRect(),row=document.querySelector('.checkout-shipping-actions').getBoundingClientRect();return {difference:Math.abs(row.right-button.right),overflow:button.right>innerWidth,clickable:target.contains(document.elementFromPoint(button.x+button.width/2,button.y+button.height/2))};})()`);
      assert(alignment.difference<2,'Pickup action is aligned right at '+width);assert.equal(alignment.overflow,false);
      assert.equal(alignment.clickable,true,'Pickup action is visible and clickable at '+width);
      await shot('customer-pickup-action-'+width);
    }
    await run(`document.getElementById('checkoutShippingPickup').click()`);
    await until(`document.getElementById('checkoutShippingFee').textContent.includes('0.00')&&!document.getElementById('checkoutShippingAccept').hidden`);
    await run(`document.getElementById('checkoutShippingAccept').click()`);
    assert.equal(await run(`document.getElementById('hiddenPaymentSelect').value`),'Cash on Pickup');
    assert.equal(await run(`document.getElementById('checkoutGrandTotal').textContent`),'₱123.45');
    await navigate('/products-page/product.html');await until(`!!document.getElementById('viewOrdersBtn')`);await run(`document.getElementById('viewOrdersBtn').click()`);
    await until(`!!document.querySelector('[data-order-detail="71"]')`);await run(`document.querySelector('[data-order-detail="71"]').click()`);
    await until(`document.querySelector('#customerOrderDetailModal')?.textContent.includes('₱95.50')`);
    assert(await run(`document.querySelector('#customerOrderDetailModal').textContent.includes('₱342.40')`));
    await shot('customer-order-pricing');
    console.log('Verified unavailable-delivery pickup recovery, zero-fee pickup and Customer saved order pricing.');
    order.lifecycle_status='pending';order.customer_stage='to_ship';order.customer_stage_label='To Ship';
    for(const portal of ['admin','staff']){
      order.courier_shipment={provider:'Ninja Van',status:null,status_label:'No API shipment',booking_available:true,can_book:true,can_retry:false,can_cancel:false,can_link:false,booking_date_min:'2026-11-02',pickup_available:true,environment:'sandbox',events:[]};
      await navigate('/'+portal+'-page/orders.html');await until(`!!document.querySelector('[data-order-view="71"]')`);await run(`document.querySelector('[data-order-view="71"]').click()`);await until(`document.getElementById('modalOrderShippingFee').value==='₱95.50'`);
      assert.equal(await run(`document.getElementById('modalOrderSubtotal').value`),'₱246.90');assert.equal(await run(`document.getElementById('modalOrderTotal').value`),'₱342.40');assert.equal(await run(`document.getElementById('modalOrderDeliveryEstimate').value`),pricing.estimated_delivery_label);
      assert.equal(await run(`document.querySelector('[data-accepted-policy] a').target`),'_blank');
      await shot(portal+'-order-pricing');
      await until(`!!document.querySelector('[data-courier-form]')`);
      for(const [key,value]of Object.entries({weight:'1.5',length:'20',width:'15',height:'10',actual_booking_cost:'140.00'}))await input('shipment-'+key,value);
      const beforeShip=shipmentWrites.length;
      await run(`document.querySelector('[data-courier-form] button[type=submit]').click()`);await confirm('Book Courier Shipment');
      await until(`document.querySelector('[data-courier-controls]').getAttribute('aria-busy')==='true'`);
      assert(await run(`document.querySelector('[data-courier-form] fieldset').disabled`));
      await run(`document.querySelector('[data-courier-form]').requestSubmit()`);
      await until(`document.querySelector('[data-courier-controls]').textContent.includes('Pending pickup')&&!document.querySelector('[data-shipment-cancel]').disabled`);
      assert.equal(shipmentWrites.length,beforeShip+1);assert.equal(shipmentWrites.at(-1).input.weight,1.5);assert.equal(shipmentWrites.at(-1).input.actual_booking_cost,140);
      assert.equal(order.total_amount,342.4,'courier booking cost does not alter the accepted payable total');
      for(const theme of ['light','dark'])for(const width of [390,768,1440]){await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.querySelector('[data-courier-controls]').scrollIntoView({block:'center'})`);assert.equal(await run(`document.documentElement.scrollWidth>innerWidth+1`),false);await shot(portal+'-courier-'+theme+'-'+width);}
      await run(`document.querySelector('[data-shipment-cancel]').click()`);await confirm('Cancel Courier Shipment');
      await until(`document.querySelector('[data-courier-controls]').textContent.includes('Shipment cancelled')&&!document.querySelector('[data-courier-form] button[type=submit]').disabled`);
      assert.equal(order.lifecycle_status,'pending');assert.equal(order.payment_status,'pending');
      console.log('Verified shared courier parcel controls, pending state, duplicate protection and cancellation for '+portal);

    }
    await navigate('/products-page/product.html');await until(`!!document.getElementById('viewOrdersBtn')`);await run(`document.getElementById('viewOrdersBtn').click()`);await until(`!!document.querySelector('[data-order-detail="71"]')`);await run(`document.querySelector('[data-order-detail="71"]').click()`);await until(`document.querySelector('#customerOrderDetailModal')?.textContent.includes('Courier shipment updates')`);assert.match(await run(`document.querySelector('#customerOrderDetailModal').textContent`),/Shipment cancelled/);assert.match(await run(`document.querySelector('#customerOrderDetailModal').textContent`),/Pending Pickup/);
    console.log('Verified Customer courier timeline parity and Admin/Staff order fee, subtotal, payable total and estimated date parity. Screenshots: '+artifacts);
  }finally{
    cdp?.close();browser.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }
});
