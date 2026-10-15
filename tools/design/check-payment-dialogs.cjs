// Local browser fixtures: no production credentials, payments or APIs.
const fs=require('node:fs'), path=require('node:path'), http=require('node:http');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'), output=path.join(root,'tmp/payment-dialogs');
fs.mkdirSync(output,{recursive:true});
const fixture=(admin=false)=>`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700;800;900&display=swap">
${(admin?['admin-page/dashboard.css','admin-page/admin-modules.css','admin-page/dark-mode.css','admin-page/gateway-payments.css']:['home-page/main.css','products-page/gateway-payments.css']).map(f=>`<link rel="stylesheet" href="/${f}">`).join('')}
<link rel="stylesheet" href="/home-page/payment-dialogs.css"></head><body><button id="launch">Payment details</button>
${admin?'<div id="ordersModuleTabs"><button data-tab="records" onclick="document.querySelector(\'.table-wrapper\').hidden=false">Records</button></div><button data-gateway-manage="1">Manage refund</button><div class="table-wrapper"><table id="paymentsHistoryTable"></table></div>':''}
<script>
localStorage.setItem('customer_token','fixture');localStorage.setItem('auth_token','fixture');
window.mode='paid'; window.calls=[]; window.hold=false; window.release=null; window.refunds=[]; window.orderStatus='incoming'; window.canApprove=true;
window.fetch=async(url,options={})=>{window.calls.push({url,options});
if(options.method==='POST' && window.hold) await new Promise(r=>window.release=r);
if(options.method==='POST' && window.fail) return {ok:false,json:async()=>({message:'Please try again.'})};
return {ok:true,json:async()=>url.includes('/admin/gateway-payments?')?{checkout_method:'qrph',enabled:true,livemode:false,can_approve:window.canApprove,refunds_awaiting_approval:1,last_reconciled_at:new Date().toISOString(),
payments:{data:[{id:1,order_id:1,order_no:'ORD-FIXTURE',gateway:'paymongo',status:'paid',amount:500,paymongo_payment_id:'pay_fixture',lifecycle_status:'rejected'}],last_page:1},
attempts:[{payment_id:1,checkout_id:null,status:'unknown'}],receipts:[{payment_id:1,provider_payment_id:'pay_fixture',amount_centavos:50000,source_type:'qrph'}],
refunds:[{id:2,payment_id:1,provider_payment_id:'pay_fixture',status:'requested',amount_centavos:180,reason:'Duplicate payment'},{id:3,payment_id:1,provider_payment_id:'pay_fixture',amount_centavos:100,status:'unknown',reason:'Checking refund'}]}:
{data:{status:'pending'},status:window.mode,order_status:window.orderStatus,checkout_method:'qrph',method_label:'QR Ph',checkout_url:window.mode==='pending'?'https://checkout.paymongo.com/fixture':null,refunds:window.refunds}};
};
</script><script src="/${admin?'admin-page':'products-page'}/gateway-payments.js"></script>
<script>document.querySelector('#launch').onclick=()=>${admin?"document.querySelector('.gateway-team').open=true":"FMRCGatewayPayments.open(1)"};</script></body></html>`;
const server=http.createServer((req,res)=>{
  if(req.url.startsWith('/fixture')) {res.setHeader('Content-Type','text/html');return res.end(fixture(req.url.includes('admin')));}
  const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'application/javascript':'text/plain');res.end(fs.readFileSync(file));
});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const profile=fs.mkdtempSync(path.join(output,'browser-'));
 const browser=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
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
  const shot=async name=>{const r=await cdp('Page.captureScreenshot');fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(r.data,'base64'));};
  const bounds=()=>run(`(()=>{const d=document.querySelector('dialog[open]'),r=d.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,vw:innerWidth,vh:innerHeight,overflow:d.scrollWidth>d.clientWidth+1}})()`);
  await cdp('Page.enable');
  for(const width of [1280,390]){
   await cdp('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:false});
   await cdp('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/fixture'});
   await until('!!window.FMRCGatewayPayments');await run('document.querySelector("#launch").click()');
   await until('document.querySelector("[data-gateway-status]").textContent==="Payment confirmed"');
   const b=await bounds();assert.ok(Math.abs(b.x-(b.vw-b.w)/2)<12,JSON.stringify(b));assert.ok(b.y>0&&b.y+b.h<=b.vh&&!b.overflow);
   assert.equal(await run('document.querySelector("[data-gateway-continue]").hidden'),true);
   await shot('customer-paid-'+width);
   await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
   await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
   await until('!document.querySelector("dialog").open');
   await run('window.mode="pending";document.querySelector("#launch").click()');
   await until('!document.querySelector("[data-gateway-continue]").hidden');
   await shot('customer-pending-'+width);
   await run('window.mode="paid";window.orderStatus="rejected";window.refunds=[{id:1,status:"requested",amount_centavos:180}];document.querySelector("[data-gateway-refresh]").click()');
   await until('document.querySelector("[data-gateway-status]").textContent==="Refund requested"');
   assert.equal(await run('document.querySelector("[data-gateway-continue]").hidden'),true);
   await shot('customer-refund-'+width);
   await run('document.querySelector("[data-gateway-done]").click()');
   assert.equal(await run('document.querySelector("dialog").open'),false);
  }
  await cdp('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/fixture-admin'});
  await until('!!document.querySelector(".gateway-team")');await run('document.querySelector("#launch").click()');
  await until('!!document.querySelector("[data-refund]")');
  await run('document.querySelector(".gateway-refund-shortcut").click()');
  await until('window.calls.some(c=>c.url.includes("refunds=1"))');
  await run('document.querySelector("[data-gateway-manage]").click()');
  await until('window.calls.some(c=>c.url.includes("order_id=1"))');
  await run('window.hold=true;document.querySelector("[data-check]").click()');
  await until('document.querySelector("[data-check]").disabled');
  await run('window.release()');
  await until('!document.querySelector("[data-check]").disabled');
  assert.match(await run('document.querySelector(".gateway-content > p[role=status]").textContent'),/Payment confirmed.*Checked at/);
  // A fetch wrapper that ignores abort must still release the button at the deadline.
  await run('window.originalTimer=window.setTimeout;window.setTimeout=(fn,ms)=>window.originalTimer(fn,ms===25000?30:ms);document.querySelector("[data-check]").click()');
  await until('document.querySelector(".gateway-content > p[role=status]").textContent.includes("too long")');
  assert.equal(await run('document.querySelector("[data-check]").disabled'),false);
  await run('window.release();window.hold=false;window.setTimeout=window.originalTimer;window.calls=[]');
  for(const type of ['refund','approve','reject','recovercheckout','recoverrefund']){
   await run(`document.querySelector('[data-${type}]').click()`);
   assert.equal(await run('document.querySelector("dialog").open'),true);
   const b=await bounds();assert.ok(b.x>=0&&b.y>=0&&b.x+b.w<=b.vw&&!b.overflow,JSON.stringify(b));
   await shot('team-'+type);
   if(type==='refund') assert.equal(await run('document.querySelector("[name=amount]").value'),'497.20');
   await run('document.querySelector("[data-cancel]").click()');
  }
  await run(`document.documentElement.dataset.portal='admin';document.documentElement.dataset.theme='dark';document.querySelector('[data-refund]').click();document.querySelector('[name=amount]').value='1.80';document.querySelector('[name=reason]').value='Duplicate payment';`);
  await shot('team-refund-dark');
  await run(`window.hold=true;window.fail=true;document.querySelector('dialog form').requestSubmit();document.querySelector('dialog form').requestSubmit();`);
  await until('document.querySelector("dialog [type=submit]").disabled');
  assert.equal(await run('window.calls.filter(c=>c.options.method==="POST").length'),1);
  await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
   await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  assert.equal(await run('document.querySelector("dialog").open'),true);
  await run('window.release()');await until('!document.querySelector("dialog [type=submit]").disabled');
  assert.match(await run('document.querySelector("[data-error]").textContent'),/try again/);
  await run('window.hold=false;window.fail=false;document.querySelector("dialog form").requestSubmit()');
  await until('!document.querySelector("dialog").open');
  await run('window.canApprove=false;document.querySelector("[data-gateway-all]").click()');
  await until('!document.querySelector("[data-approve]")');
  assert.ok(await run('!!document.querySelector("[data-refund]")'));
  console.log('PASS: Customer desktop/mobile centering, pending/paid actions, Escape/Done; team payment check completion and deadline recovery; all five team dialogs, dark theme, duplicate-submit guard, error recovery and successful close. Fixtures only.');
 } finally {ws?.close();browser.kill();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
