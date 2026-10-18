// Full Admin/Staff Orders pages with local API fixtures. No live payments or credentials.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),output=path.join(root,'tmp/refund-scope');
fs.mkdirSync(output,{recursive:true});
const fixture=role=>{
 const html=fs.readFileSync(path.join(root,role+'-page/orders.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
 const mock=String.raw`<script>
 window.errors=[];window.calls=[];window.messages=[];
 addEventListener('error',e=>window.errors.push(e.message));addEventListener('unhandledrejection',e=>window.errors.push(String(e.reason)));
 window.bulkConfigs={};window.AdminBulkSelection={create(config){bulkConfigs[config.key]=config;return {sync(){},setBusy(){},clear(){}}}};
 window.APP_API_BASE_URL=location.origin+'/api';localStorage.setItem('auth_token','fixture');window.AdminSession={role:'${role}',getToken:()=> 'fixture'};
 window.AdminPageNotice={clear(){},show(error){window.errors.push(String(error?.message || error))}};
 window.showAdminPopup=(message)=>window.messages.push(message);
 window.showAdminConfirmPopup=(message,options)=>{window.confirmMessage=message;window.confirmAction=options.onConfirm};
 const row=(id,method,status='pending',online=false,lifecycle='rejected')=>({id,order_no:'ORDER-'+id,order_no_display:'#ORDER-'+id,customer_name:'Fixture Customer',product_name:'Engraved Coaster',items:[{id,product_name:'Engraved Coaster',quantity:1,unit_price:1,line_total:1}],quantity:1,total_amount:1,total_label:'PHP 1.00',payment_amount:1,payment_method:method,payment_status:status,payment_is_automated:online,payment_checkout_method:online?'qrph':null,payment_method_label:online?'QR Ph':method,payment_has_refund_record:online&&[8,9].includes(id),payment_reference:online?'pay_'+id:'CASH-RECEIPT',payment_reference_supplied:false,created_at:'2026-10-17T01:00:00Z',lifecycle_status:lifecycle,customer_stage:lifecycle==='incoming'?'to_pay':'to_ship',rejected_order_workspace:lifecycle!=='rejected'?null:status==='pending'?'rejected':online?'online_refunds':'manual_refunds',payment_actions:{paid:{allowed:false},pending:{allowed:false},refunded:{allowed:!online&&status==='paid'}}});
 window.rows=[row(1,'GCash','paid',true,'incoming'),row(2,'COP'),row(3,'COD'),row(4,'GCash','pending',true),row(5,'GCash','paid'),row(6,'COD','paid'),row(7,'COP','paid'),row(8,'GCash','paid',true),row(9,'GCash','refunded',true),row(10,'COP','paid',false,'completed'),row(11,'GCash','paid',true),...Array.from({length:11},(_,i)=>row(30+i,'COP','paid'))];
 window.refundRows=[{id:108,payment_id:8,provider_payment_id:'pay_8',amount_centavos:100,status:'pending',reason:'Rejected order'},{id:109,payment_id:9,provider_payment_id:'pay_9',amount_centavos:100,status:'succeeded',reason:'Rejected order'}];
 const response=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
 window.fetch=async(url,options={})=>{
  window.calls.push({url:String(url),options});const parsed=new URL(url,location.origin),path=parsed.pathname;
  let match;
  if(path==='/api/admin/orders')return response({incoming:rows.filter(r=>r.lifecycle_status==='incoming'),directory:rows.filter(r=>r.lifecycle_status!=='incoming'),returns:[],returns_summary:{},cancellations_summary:{}});
  if((match=path.match(/^\/api\/admin\/orders\/(\d+)\/reject$/))){if(window.rejectFailure)return new Response(JSON.stringify({message:'This order can no longer be rejected. Refresh its status.'}),{status:422,headers:{'Content-Type':'application/json'}});if(window.holdReject)await new Promise(resolve=>{window.releaseReject=resolve;});window.savedReason=JSON.parse(options.body).reason;const order=rows.find(r=>r.id===Number(match[1]));order.lifecycle_status='rejected';order.rejected_order_workspace='online_refunds';order.payment_has_refund_record=true;order.payment_refund_status='requested';refundRows.push({id:100+order.id,payment_id:order.id,provider_payment_id:'pay_'+order.id,amount_centavos:100,status:'requested',reason:'Rejected order'});return response({data:order,message:'Order rejected.'});}
  if((match=path.match(/^\/api\/admin\/orders\/(\d+)\/payment-(?:reconcile|check)$/))){const order=rows.find(r=>r.id===Number(match[1]));if(!order.payment_has_refund_record){order.payment_has_refund_record=true;order.payment_refund_status='requested';refundRows.push({id:100+order.id,payment_id:order.id,provider_payment_id:'pay_'+order.id,amount_centavos:100,status:'requested',reason:'Rejected order'});}return response({status:'paid'});}
  if(path==='/api/admin/gateway-payments'){
   const ids=new Set(refundRows.map(r=>r.payment_id)),search=parsed.searchParams.get('search')||'';
   const payments=rows.filter(r=>ids.has(r.id)&&r.order_no.includes(search)).map(r=>({id:r.id,order_id:r.id,order_no:r.order_no,customer_name:r.customer_name,lifecycle_status:r.lifecycle_status,status:r.payment_status,gateway:'paymongo'}));
   const selected=new Set(payments.map(p=>p.id));return response({payments:{data:payments,last_page:1},refunds:refundRows.filter(r=>selected.has(r.payment_id)),receipts:payments.map(p=>({payment_id:p.id,provider_payment_id:'pay_'+p.id,amount_centavos:100,source_type:'qrph'})),attempts:[],can_approve:'${role}'==='admin',checkout_method:'qrph',livemode:false,refund_summary:{requested:refundRows.filter(r=>r.status==='requested').length},refunds_awaiting_approval:refundRows.filter(r=>r.status==='requested').length});
  }
  if((match=path.match(/^\/api\/admin\/orders\/(\d+)$/)))return response({data:{...rows.find(r=>r.id===Number(match[1])),timeline:[]}});
  return response({data:[]});
 };
 </script><script defer src="/admin-page/orders.js"></script><script defer src="/admin-page/gateway-payments.js"></script>`;
 return html.replace('<head>','<head><base href="/'+role+'-page/">').replace('<html lang="en">','<html lang="en" data-portal="'+role+'">').replace('</head>',mock+'</head>');
};
const server=http.createServer((req,res)=>{
  if(req.url.startsWith('/fixture')) {res.setHeader('Content-Type','text/html');return res.end(fixture(req.url.includes('staff')?'staff':'admin'));}
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
  for(const portal of ['admin','staff']){
   await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
   await cdp('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/fixture-'+portal});
   await until(`document.querySelector('#rejectedOrdersTable tbody [data-order-view]')`);
   assert.deepEqual(await run(`Array.from(document.querySelectorAll('#rejectedOrdersTable tbody [data-order-view]')).map(b=>Number(b.dataset.orderView)).sort()`),[2,3,4]);
   assert.equal(await run(`document.querySelector('#rejectedOrdersTable tbody').textContent.includes('Awaiting payment')`),false);
   assert.equal(await run(`document.querySelector('#manualRefundsPanel').hidden`),false);
   await run(`document.querySelector('#ordersModuleTabs [data-tab=records]').click()`);
   const count=await run(`Number(document.querySelector('#tabCountOrdersRecords').textContent)`);
   assert.equal(count,18); // 3 unpaid rejections + 14 manual refunds + 1 completed payment.
   assert.equal(await run(`document.querySelector('#manualRefundsFooter .table-footer-meta').textContent`),'Page 1 of 2');
   await run(`document.querySelectorAll('#manualRefundsFooter .page-btn')[1].click()`);
   assert.equal(await run(`document.querySelector('#manualRefundsFooter .table-footer-meta').textContent`),'Page 2 of 2');
   assert.equal(await run(`document.querySelectorAll('#manualRefundsTable tbody tr').length`),4);
   await run(`document.querySelectorAll('#manualRefundsFooter .page-btn')[0].click()`);
   await run(`document.querySelector('#manualRefundsTable [data-order-view]').click()`);
   assert.equal(await run(`document.querySelector('#modalOrderDetails').classList.contains('show')`),true);
   assert.equal(await run(`document.querySelector('#btnRecordRefund').hidden`),false);
   await run(`document.querySelector('#modalOrderDetails').classList.remove('show')`);
   for(const width of [1440,390,320]){
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
    for(const theme of ['light','dark']){
     await run(`document.documentElement.dataset.theme='${theme}';document.querySelector('#manualRefundsPanel').scrollIntoView()`);
     await shot('rejected-'+portal+'-'+width+'-'+theme+'-manual');
     assert.ok(await run(`document.querySelector('#manualRefundsPanel .panel-header').getBoundingClientRect().top>=65`));
     assert.equal(await run(`document.documentElement.scrollWidth>innerWidth+1`),false);
    }
   }
   await run(`document.querySelector('#ordersModuleTabs [data-tab=orders]').click();document.querySelector('[data-order-reject="1"]').click()`);
   await until(`document.querySelector('#rejectIncomingOrderDialog').open`);
   assert.equal(await run(`document.activeElement.id`),'rejectIncomingOrderReason');
   await run(`document.querySelector('#confirmIncomingOrderRejection').click()`);
   assert.match(await run(`document.querySelector('#rejectIncomingOrderError').textContent`),/Enter a reason/);
   assert.equal(await run(`calls.filter(c=>c.options.method==='POST').length`),0);
   for(const width of [1440,390,320]){
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
    for(const theme of ['light','dark']){
     await run(`document.documentElement.dataset.theme='${theme}'`);
     const metrics=await run(`(()=>{const d=document.querySelector('#rejectIncomingOrderDialog'),r=d.getBoundingClientRect(),buttons=Array.from(d.querySelectorAll('.modal-footer-fixed button'));return {width:r.width,left:r.left,right:r.right,height:r.height,scroll:d.scrollWidth,client:d.clientWidth,buttons:buttons.map(b=>({height:b.getBoundingClientRect().height,whiteSpace:getComputedStyle(b).whiteSpace}))};})()`);
     assert.ok(metrics.left>=0&&metrics.right<=width+1&&metrics.height<=1000);
     assert.ok(metrics.scroll<=metrics.client+1);
     assert.ok(metrics.buttons.every(b=>b.whiteSpace==='nowrap'&&b.height===metrics.buttons[0].height));
     await shot('incoming-rejection-'+portal+'-'+width+'-'+theme);
    }
   }
   await run(`document.querySelector('#cancelIncomingOrderRejection').click()`);
   assert.equal(await run(`calls.filter(c=>c.options.method==='POST').length`),0);
   await run(`bulkConfigs['incoming-orders'].actions.find(a=>a.key==='reject').onClick([1,42],{setBusy(){},clear(){}})`);
   assert.match(await run(`document.querySelector('#rejectIncomingOrderContext').textContent`),/2 selected orders.*same reason/);
   await run(`document.querySelector('#cancelIncomingOrderRejection').click();document.querySelector('[data-order-reject="1"]').click()`);
   await run(`document.querySelector('#rejectIncomingOrderReason').value='  Material unavailable.\\n Contact FMRC for alternatives.  ';document.querySelector('#rejectIncomingOrderReason').dispatchEvent(new Event('input'));window.rejectFailure=true;document.querySelector('#confirmIncomingOrderRejection').click()`);
   await until(`document.querySelector('#rejectIncomingOrderError').textContent.includes('no longer')`);
   assert.match(await run(`document.querySelector('#rejectIncomingOrderReason').value`),/Material unavailable/);
   assert.equal(await run(`document.querySelector('#rejectIncomingOrderDialog').open`),true);
   await run(`window.rejectFailure=false;window.holdReject=true;document.querySelector('#confirmIncomingOrderRejection').click();document.querySelector('#confirmIncomingOrderRejection').click()`);
   await until(`!!window.releaseReject`);
   assert.equal(await run(`document.querySelector('#cancelIncomingOrderRejection').disabled`),true);
   assert.equal(await run(`document.querySelector('#rejectIncomingOrderReason').disabled`),true);
   await run(`releaseReject()`);
   await until(`document.querySelector('#sectionRefunds').hidden===false && document.querySelector('#gatewayPaymentsTable tbody').textContent.includes('ORDER-1')`);
   assert.equal(await run(`document.querySelector('#rejectedOrdersTable tbody').textContent.includes('ORDER-1')`),false);
   assert.equal(await run(`document.querySelector('#manualRefundsTable tbody').textContent.includes('ORDER-1')`),false);
   assert.equal(await run(`document.querySelector('[data-gateway-search]').value`),'ORDER-1');
   assert.equal(await run(`window.calls.filter(c=>c.options.method==='POST').length`),2);
   assert.equal(await run('savedReason'),'Material unavailable. Contact FMRC for alternatives.');
   await run(`window.dispatchEvent(new Event('focus'))`);
   await until(`document.querySelector('.order-cancellation-notice:not([hidden]) [data-check="11"]')`);
   await shot('rejected-'+portal+'-online-review');
   await run(`document.querySelector('[data-check="11"]').click()`);
   await until(`window.refundRows.some(r=>r.payment_id===11)`);
   assert.equal(await run(`window.calls.some(c=>/gateway-refunds/.test(c.url))`),false);
   assert.equal(await run(`window.calls.filter(c=>c.options.method==='POST').length`),3);
   assert.deepEqual(await run('window.errors'),[]);
  }
  console.log('PASS: Full Admin/Staff pages, exclusive rejected/manual/online refund queues, manual pagination and payment details, required rejection reason, cancel/validation/failure/duplicate guards, bulk reason form, rejection opens Online refunds, missing-record review without money submission, desktop/mobile in both themes. Local mocked APIs only.');
 } finally {ws?.close();browser.kill();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
