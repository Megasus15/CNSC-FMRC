// Local-only regression fixture. Provider responses are mocked; no real money moves.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),output=path.join(root,'tmp/refund-scope');
fs.mkdirSync(output,{recursive:true});
const original=fs.readFileSync(path.join(__dirname,'check-payment-dialogs.cjs'),'utf8');
const baseFixture=new Function(original.slice(original.indexOf('const fixture='),original.indexOf('const server='))+';return fixture;')();
const product=fs.readFileSync(path.join(root,'products-page/product.html'),'utf8');
const paymentList=product.slice(product.indexOf('<div class="tiktok-payment-list"'),product.indexOf('<!-- Hidden select',product.indexOf('<div class="tiktok-payment-list"')));
const fixture=(admin=false)=>admin ? baseFixture(true)
 .replace('<html>','<html data-portal="admin">')
 .replace('</head>','<link rel="stylesheet" href="/admin-page/admin-responsive.css"></head>')
 .replace('</head>','<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"></head>')
 .replace('<div id="fixtureOrderPayment">','<div id="fixtureOrderPayment"><button class="btn-admin btn-secondary" data-gateway-manage="2">Unrefunded order</button>')
 .replace('<script src="/admin-page/gateway-payments.js">',`<script>
const originalFetch=window.fetch;
window.fetch=async(url,options={})=>{
 if(String(url).endsWith('/orders/2/gateway-payment')) {
  window.calls.push({url,options});
  return {ok:true,json:async()=>({can_approve:window.canApprove,payments:{data:[{id:2,order_id:2,order_no:'ORD-READY',customer_name:'Customer Ready',status:'paid',lifecycle_status:'completed'}]},attempts:[],receipts:[{payment_id:2,provider_payment_id:'pay_ready',amount_centavos:50000,source_type:'qrph'}],refunds:[]})};
 }
 return originalFetch(url,options);
};
</script><script src="/admin-page/gateway-payments.js">`)
 : `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
 <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700;800;900&display=swap"><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
 <link rel="stylesheet" href="/home-page/main.css"><link rel="stylesheet" href="/products-page/tiktok-payment.css">
 <style>body{margin:0;background:#f8f5f1}#checkoutModal{display:block;position:static;padding:20px;box-sizing:border-box;max-width:650px;margin:auto}#checkoutModal .checkout-section{margin:0}#tiktokPaymentList{padding:0}</style>
 <script src="/products-page/payment-availability.js"></script></head><body><main id="checkoutModal"><h3>Payment method</h3>${paymentList}
 <select id="hiddenPaymentSelect" hidden><option value=""></option><option value="Cash on Pickup"></option><option value="Cash on Delivery"></option><option value="GCash"></option></select><button id="submitOrderBtn" hidden>Place order</button></main>
 <script>document.addEventListener('DOMContentLoaded',()=>FMRC_PAYMENT_METHODS.applySettings({payment_checkout_method:'qrph',payment_gcash_ready:'1',payment_checkout_label:'GCash / QR Ph'}));</script></body></html>`;
const server=http.createServer((req,res)=>{
  if(req.url.startsWith('/fixture')) {res.setHeader('Content-Type','text/html');return res.end(fixture(req.url.includes('admin')));}
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
    await cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:850,deviceScaleFactor:1,mobile:false});
    await cdp('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/fixture-admin'});
    await until('!!document.querySelector("[data-history]")');
    await run(`document.documentElement.dataset.portal='${portal}';window.canApprove=${portal==='admin'};document.querySelector('.gateway-refund-shortcut').click()`);
    await until(`document.querySelector('[data-approve]')${portal==='admin'?'!==null':'===null'}`);
    assert.equal(await run(`document.querySelector('[data-payment-list]').textContent.includes('ORD-READY')`),false);
    assert.equal(await run(`document.querySelector('[data-gateway-refund-filter], [data-gateway-review]')`),null);
    await run(`document.querySelector('[data-gateway-search]').value='Customer';document.querySelector('[data-gateway-all]').click()`);
    await until(`window.calls.filter(c=>c.url.includes('/gateway-payments?')).length>=3`);
    assert.equal(await run(`document.querySelector('[data-gateway-search]').value`),'');
    assert.equal(await run(`window.calls.filter(c=>c.url.includes('/gateway-payments?')).some(c=>/order_id|refunds=0|review=1/.test(c.url))`),false);
    for(const width of [1280,390]){
      await cdp('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:false});
      for(const theme of ['light','dark']){
        await run(`document.documentElement.dataset.theme='${theme}'`);
        await wait(200);
        const surface=await run(`getComputedStyle(document.querySelector('.gateway-team')).backgroundColor`);
        const red=Number(surface.match(/\d+/)[0]);
        assert.ok(theme==='dark'?red<65:red>200,portal+' '+theme+' '+surface);
        assert.equal(await run('document.documentElement.scrollWidth>innerWidth+1'),false);
        await shot(portal+'-'+width+'-'+theme+'-refunds');
      }
    }
    await run(`document.querySelector('[data-gateway-manage="2"]').click()`);
    await until(`document.querySelector('dialog').open`);
    assert.match(await run(`document.querySelector('dialog [data-context]').textContent`),/ORD-READY/);
    assert.match(await run(`document.querySelector('dialog [data-record]').textContent`),/pay_ready/);
    assert.equal(await run(`document.querySelector('dialog [type=submit]').textContent`),portal==='admin'?'Issue refund':'Request refund');
    assert.equal(await run(`window.calls.filter(c=>c.options.method==='POST').length`),0);
    // Background list refresh must not replace the selected order's refund form.
    await run(`window.dispatchEvent(new Event('focus'))`);
    await wait(150);
    assert.equal(await run(`document.querySelector('[data-payment-list]').textContent.includes('ORD-READY')`),false);
    await run(`document.querySelector('dialog form').requestSubmit()`);
    assert.equal(await run(`document.querySelector('dialog [name=provider_payment_id]').value`),'pay_ready');
    assert.equal(await run(`document.querySelector('dialog [name=amount]').value`),'500.00');
    assert.equal(await run(`window.calls.filter(c=>c.options.method==='POST').length`),0);
    await shot(portal+'-refund-form-390');
    await run(`window.hold=true;document.querySelector('dialog [name=reason]').value='Agreed return refund';document.querySelector('dialog form').requestSubmit();document.querySelector('dialog form').requestSubmit()`);
    await until(`window.calls.filter(c=>c.options.method==='POST').length===1`);
    const post=await run(`window.calls.find(c=>c.options.method==='POST')`);
    assert.match(post.url,/orders\/2\/gateway-refunds$/);
    const payload=JSON.parse(post.options.body);
    assert.equal(payload.issue,portal==='admin');assert.equal(payload.provider_payment_id,'pay_ready');assert.equal(payload.amount_centavos,50000);
    assert.match(payload.request_key,/^[a-f0-9-]{36}$/);
    assert.equal(await run(`document.querySelector('dialog [data-cancel]').disabled`),true);
    await run(`window.release();window.hold=false`);
    await until(`!document.querySelector('dialog').open`);
    assert.equal(await run(`document.querySelector('[data-payment-list]').textContent.includes('ORD-READY')`),false);
  }
  for(const width of [1280,390,320]){
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:false});
    await cdp('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/fixture'});
    await until(`document.querySelector('.checkout-qrph-logo')?.naturalWidth>0`);
    assert.deepEqual(await run(`Array.from(document.querySelectorAll('.tiktok-pm-name')).map(n=>n.textContent)`),['Cash on pickup','Cash on delivery','QR Ph']);
    assert.equal(await run(`document.querySelector('#tiktokPaymentList').textContent.includes('GCash')`),false);
    assert.equal(await run('document.documentElement.scrollWidth>innerWidth+1'),false);
    assert.equal(await run(`document.querySelector('.checkout-qrph-logo').getAttribute('src')`),'../images/qrph-logo.svg');
    await run('document.fonts.ready.then(()=>true)');
    await shot('checkout-qrph-'+width);
  }
  console.log('PASS: Refund-only lists and clear filters, isolated payment details, Admin/Staff refund permissions and duplicate-click guard, desktop/mobile themes, QR Ph checkout logo and copy at 1280/390/320. Local mocked APIs only.');
 } finally {ws?.close();browser.kill();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
