// Full Admin/Staff Orders pages with local API fixtures. No live payments or credentials.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),output=path.join(root,'tmp/refund-scope');
fs.mkdirSync(output,{recursive:true});
const fixture=route=>{
 const role=route.includes('staff')?'staff':'admin', archives=route.includes('archives');
 const html=fs.readFileSync(path.join(root,role+'-page/'+(archives?'archives':'orders')+'.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
 const mock=String.raw`<script>
 window.errors=[];window.calls=[];window.messages=[];
 addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
 window.APP_API_BASE_URL=location.origin+'/api';localStorage.setItem('auth_token','fixture');window.AdminSession={role:'${role}',getToken:()=> 'fixture'};
 window.showAdminPopup=message=>messages.push(message);window.AdminPageNotice={clear(){},show(){}};
 window.runAdminBulkAction=options=>{window.restoreAction=async()=>{const result=await options.execute(options.ids);await options.afterSuccess(result)}};
 window.AdminBulkSelection={create:options=>{window.bulkConfigs||={};bulkConfigs[options.key]=options;return {sync(){}}}};
 const payment=(id,status='paid')=>({id,order_id:id,order_no:'ORD-FIXTURE-'+id,customer_name:'Refund Customer '+id,lifecycle_status:'completed',status,gateway:'paymongo',can_archive_refunds:id===2,refund_archive_reason:id===2?null:'Resolve pending or failed refunds before archiving.'});
 window.payments=[payment(1),payment(2,'refunded')];window.refunds=[{id:11,payment_id:1,provider_payment_id:'pay_1',amount_centavos:100,status:'pending',provider_refund_id:'ref_1',reason:'Returned item'},{id:22,payment_id:2,provider_payment_id:'pay_2',amount_centavos:100,status:'succeeded',reason:'Returned item'}];
 const receipt=id=>({payment_id:id,provider_payment_id:'pay_'+id,amount_centavos:100,source_type:'qrph'});
 window.archived=${archives};window.archiveReady=true;
 const response=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
 window.fetch=async(url,options={})=>{
  calls.push({url:String(url),options});const parsed=new URL(url,location.origin),path=parsed.pathname;
  if(path==='/api/admin/orders')return response({incoming:[],directory:[],returns:[],returns_summary:{}});
  if(path==='/api/admin/gateway-payments')return response({payments:{data:payments.filter(p=>!archived||p.id!==2).map(p=>({...p,can_archive_refunds:archiveReady&&p.can_archive_refunds,refund_archive_reason:archiveReady?p.refund_archive_reason:'Refund archiving is temporarily unavailable.'})),last_page:1},refund_archive_available:archiveReady,refunds,receipts:[receipt(1),receipt(2)],attempts:[],can_approve:'${role}'==='admin',checkout_method:'qrph',livemode:false,refund_summary:{processing:1}});
  if(path.endsWith('/payment-check')){await new Promise(r=>setTimeout(r,100));return response({status:'paid',refunds:[refunds[0]]});}
  if(path.endsWith('/archive-refunds')){archived=true;return response({message:'Refund moved to Archives > Online refunds.'});}
  if(path.endsWith('/gateway-payment'))return response({payments:{data:[payment(2,'refunded')]},receipts:[receipt(2)],refunds:[refunds[1]],attempts:[],can_approve:'${role}'==='admin'});
  if(path==='/api/admin/archives')return response({online_refunds:archived?[{id:'online-refund-2',source_id:2,order_id:2,order_no:'ORD-FIXTURE-2',customer_name:'Refund Customer 2',payment_method:'QR Ph',received_label:'PHP 1.00',refunded_label:'PHP 1.00',status_label:'Refund confirmed',archived_at:'2026-10-18T02:00:00Z',archived_by:'Staff Member'}]:[]});
  if(path==='/api/admin/archives/restore-bulk'){archived=false;return response({processed_ids:[2],processed_count:1});}
  return response({data:[],deleted_count:0});
 };
 </script>`+(archives?'<script defer src="/admin-page/archives.js"></script>':'<script defer src="/admin-page/orders.js"></script><script defer src="/admin-page/gateway-payments.js"></script>');
 return html.replace('<head>','<head><base href="/'+role+'-page/">').replace('<html lang="en">','<html lang="en" data-portal="'+role+'">').replace('</head>',mock+'</head>');
};
const server=http.createServer((req,res)=>{
  if(req.url.startsWith('/fixture')) {res.setHeader('Content-Type','text/html');return res.end(fixture(req.url));}
  const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'application/javascript':file.endsWith('.svg')?'image/svg+xml':'text/plain');res.end(fs.readFileSync(file));
});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const profile=fs.mkdtempSync(path.join(output,'browser-'));
 const browser=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-extensions','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
 let ws;
 try {
  const portFile=path.join(profile,'DevToolsActivePort');
  for(let i=0;i<100&&!fs.existsSync(portFile);i++)await wait(100);
  const port=fs.readFileSync(portFile,'utf8').split('\n')[0];
  const targets=await (await fetch('http://127.0.0.1:'+port+'/json',{signal:AbortSignal.timeout(5000)})).json();
  ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Browser socket timeout')),5000);ws.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});ws.addEventListener('error',reject,{once:true});});
  let seq=0;const pending=new Map();
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){const {resolve,reject}=pending.get(m.id);pending.delete(m.id);m.error?reject(m.error):resolve(m.result);}});
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},10000);pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id,method,params}));});
  const run=async expression=>{const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const until=async expression=>{for(let i=0;i<80;i++){if(await run(expression))return;await wait(50);}throw new Error('Timeout: '+expression);};
  const shot=async name=>{await wait(250);const r=await cdp('Page.captureScreenshot');fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(r.data,'base64'));};


  await cdp('Page.enable');
  for(const role of ['admin','staff']){
   await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
   await cdp('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/fixture-'+role});
   await until(`document.querySelector('[data-history="2"]')`);
   await run(`document.querySelector('.gateway-refund-shortcut').click()`);
   assert.deepEqual(await run(`Array.from(document.querySelectorAll('#gatewayPaymentsTable tbody tr')).map(row=>row.querySelector('.gateway-actions button').dataset.history)`),['1','2']);
   assert.equal(await run(`document.querySelectorAll('[data-check-refund]').length`),0);
   assert.equal(await run(`document.querySelectorAll('#gatewayPaymentsTable [data-check]').length`),2);
   assert.equal(await run(`document.querySelector('[data-archive="1"]').disabled`),true);
   assert.equal(await run(`document.querySelector('[data-archive="2"]').disabled`),false);
   assert.equal(await run(`document.querySelector('[data-archive="1"] i').className`),'fa-solid fa-box-archive');
   await run(`window.calls=[];window.archiveReady=false;window.dispatchEvent(new Event('focus'))`);
   await until(`calls.some(c=>c.url.includes('/gateway-payments'))`);
   assert.equal(await run(`document.querySelector('[data-archive="2"]').disabled`),false);
   assert.match(await run(`document.querySelector('#gatewayPaymentsTable tbody tr:nth-child(2)').textContent`),/Refund confirmed/);
   assert.equal(await run(`document.querySelector('[data-archive="1"]').title`),'Available after refund confirmation.');
   assert.equal(await run(`getComputedStyle(document.querySelector('[data-archive="1"]')).pointerEvents`),'auto');
   await run(`refunds.push({id:23,payment_id:2,provider_payment_id:'pay_2',amount_centavos:100,status:'unknown'});window.dispatchEvent(new Event('focus'))`);
   await until(`document.querySelector('[data-archive="2"]').disabled===true`);
   await run(`refunds=refunds.filter(r=>r.id!==23);window.dispatchEvent(new Event('focus'))`);
   await until(`document.querySelector('[data-archive="2"]').disabled===false`);
   assert.equal(await run(`calls.filter(c=>c.options.method==='POST').length`),0);

   for(const width of [1440,390,320]){
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
    for(const theme of ['light','dark']){
     await run(`document.documentElement.dataset.theme='${theme}';document.querySelector('#sectionRefunds').scrollIntoView()`);
     assert.equal(await run(`getComputedStyle(document.querySelector('#gatewayPaymentsTable .gateway-actions')).textAlign`),'left');
     assert.equal(await run(`document.documentElement.scrollWidth>innerWidth+1`),false);
     const positions=await run(`Array.from(document.querySelectorAll('#gatewayPaymentsTable tbody tr:nth-child(2) button')).map(b=>({x:b.getBoundingClientRect().x,y:b.getBoundingClientRect().y,w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height}))`);
     assert.ok(positions.every(p=>p.w===positions[0].w&&p.h===positions[0].h&&p.y===positions[0].y));
     assert.ok(positions[0].x<positions[1].x);
     await shot('refund-archives-'+role+'-'+width+'-'+theme);
    }
   }
   await run(`document.querySelector('[data-check="1"]').click();document.querySelector('[data-check="1"]').click()`);
   await until(`!document.querySelector('[data-check="1"]').disabled`);
   assert.equal(await run(`calls.filter(c=>c.url.endsWith('/payment-check')).length`),1);
   assert.equal(await run(`calls.some(c=>c.url.includes('/gateway-refunds'))`),false);
   await run(`document.querySelector('[data-archive="2"]').click()`);
   await until(`document.querySelector('.gateway-team-dialog').open`);
   assert.equal(await run(`document.querySelector('.gateway-team-dialog [type=submit]').textContent`),'Archive refund');
   await run(`document.querySelector('.gateway-team-dialog [type=submit]').click()`);
   await until(`!document.querySelector('[data-history="2"]')`);
   assert.equal(await run(`calls.filter(c=>c.url.endsWith('/archive-refunds')).length`),1);
   assert.deepEqual(await run('errors'),[]);
   await cdp('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/fixture-archives-'+role});
   await until(`document.querySelector('#onlineRefundArchiveTbody [data-refund-view]')`);
   await run(`document.querySelector('[data-tab=online_refund]').click()`);
   assert.equal(await run(`document.querySelector('#sectionOnline_refund').classList.contains('active')`),true);
   assert.equal(await run(`document.querySelector('#onlineRefundArchiveTbody [data-archive-delete]')`),null);
   assert.deepEqual(await run(`bulkConfigs['archive-online_refund'].actions.map(a=>a.key)`),['restore']);
   for(const width of [1440,390,320]){
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
    for(const theme of ['light','dark']){
     await run(`document.documentElement.dataset.theme='${theme}';document.querySelector('#sectionOnline_refund').scrollIntoView()`);
     assert.equal(await run(`document.documentElement.scrollWidth>innerWidth+1`),false);
     await shot('archive-section-'+role+'-'+width+'-'+theme);
    }
   }
   await run(`document.querySelector('[data-archive-restore=online_refund]').click()`);
   await until(`!!window.restoreAction`);await run('restoreAction()');
   await until(`document.querySelector('#tabCountOnlineRefund').textContent==='0'`);
   assert.deepEqual(await run(`JSON.parse(calls.find(c=>c.url.endsWith('/restore-bulk')).options.body)`),{module:'online_refund',ids:[2]});
   assert.deepEqual(await run('errors'),[]);
   await cdp('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/fixture-'+role+'?refund_order=2'});
   await until(`document.querySelector('.gateway-team-dialog')?.open`);
   assert.match(await run(`document.querySelector('.gateway-team-dialog [data-context]').textContent`),/ORD-FIXTURE-2/);
   assert.equal(await run(`calls.some(c=>c.options.method==='POST')`),false);
   assert.deepEqual(await run('errors'),[]);
  }
  console.log('PASS: Admin and Staff confirmed refunds enable Archive despite stale capability flags, pending refunds stay disabled with a readable reason, realtime transitions, Archives/restore and GET-only status checks. 1440/390/320px, light/dark. Mocked APIs only.');
 } finally {ws?.close();browser.kill();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
