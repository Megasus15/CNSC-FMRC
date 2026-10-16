// Local browser fixtures: no production credentials, payments or APIs.
const fs=require('node:fs'), path=require('node:path'), http=require('node:http');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'), output=path.join(root,'tmp/orders-workspaces');
fs.mkdirSync(output,{recursive:true});
const original=fs.readFileSync(path.join(__dirname,'check-payment-dialogs.cjs'),'utf8');
const baseFixture=new Function(original.slice(original.indexOf('const fixture='),original.indexOf('const server='))+';return fixture;')();
const ordersSource=fs.readFileSync(path.join(root,'admin-page/orders.js'),'utf8');
const switcher=ordersSource.slice(ordersSource.indexOf('  const ordersModuleTabs ='),ordersSource.indexOf('  refreshBtn?.addEventListener',ordersSource.indexOf('  const ordersModuleTabs =')));
const fixture=()=>baseFixture(true)
 .replace('<html>','<html data-portal="admin">')
 .replace('</head>','<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"></head>')
 .replace('</head>','<link rel="stylesheet" href="/admin-page/admin-responsive.css"><link rel="stylesheet" href="/admin-page/portal-theme-coverage.css"></head>')
 .replace('<div id="ordersModuleTabs">','<div id="ordersModuleTabs"><button class="archive-tab-btn" data-tab="orders">Orders</button><button class="archive-tab-btn" data-tab="walkin">Walk-in</button>')
 .replace('<div class="orders-layout-stack">','<div class="orders-layout-stack"><section id="sectionOrders" class="archive-section"></section><section id="sectionWalkin" class="archive-section"></section>')
 .replace('<table id="paymentsHistoryTable"></table>','<table class="admin-table" id="paymentsHistoryTable"><tbody><tr><td class="action-icons sticky-action"><button aria-label="Reference details"><i class="fa-regular fa-eye"></i></button><button><i class="fa-solid fa-box-archive"></i></button></td></tr></tbody></table>')
 .replace('<script src="/admin-page/gateway-payments.js">','<script>document.addEventListener("DOMContentLoaded",()=>{'+switcher+'});</script><script src="/admin-page/gateway-payments.js">');
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
    await cdp('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/fixture'});
    await until('!!document.querySelector("[data-refund]")');
    await run(`document.documentElement.dataset.portal='${portal}';window.canApprove=${portal==='admin'};document.querySelector('.gateway-refund-shortcut').click()`);
    await until(`document.querySelector('[data-refund]').getAttribute('aria-label')==='${portal==='admin'?'Issue refund':'Request refund'}'`);
    for(const tab of ['refunds','walkin','cancellations','records','refunds','orders','cancellations','walkin']){
      await run(`document.querySelector('[data-tab="${tab}"]').click()`);
      assert.deepEqual(await run(`Array.from(document.querySelectorAll('#ordersModuleTabs .active')).map(b=>b.dataset.tab)`),[tab]);
      assert.deepEqual(await run(`Array.from(document.querySelectorAll('#ordersModuleTabs [aria-pressed=true]')).map(b=>b.dataset.tab)`),[tab]);
      assert.equal(await run(`document.querySelectorAll('.orders-layout-stack .archive-section.active:not([hidden])').length`),1);
      await wait(220);
      assert.equal(await run(`Array.from(document.querySelectorAll('#ordersModuleTabs .archive-tab-btn')).filter(b=>getComputedStyle(b).backgroundColor==='rgb(128, 0, 0)').length`),1);
    }
    await run(`window.cancellation={id:77,order_no:'CANCEL-FIXTURE',customer_name:'Fixture Customer',cancel_state:'requested',cancel_pending:true,cancel_reason:'Changed plans',cancel_reason_detail:'A customer supplied reason.',cancel_requested_at:'2026-10-16T00:00:00Z',payment_status:'paid',payment_is_automated:true,total_amount:500};window.dispatchEvent(new CustomEvent('fmrc:orders-synced',{detail:{orders:[window.cancellation]}}))`);
    for(const width of [1280,390]){
      await cdp('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:false});
      const styleExpr=selector=>`(()=>{const s=getComputedStyle(document.querySelector('${selector}'));return Object.fromEntries(['width','height','borderRadius','fontSize','color','backgroundColor','borderColor','display','transition'].map(k=>[k,s[k]]))})()`;
      for(const theme of ['light','dark']){
        await run(`document.documentElement.dataset.theme='${theme}';document.querySelector('[data-tab=records]').click()`);
        const reference=await run(styleExpr('#paymentsHistoryTable button'));
        for(const tab of ['refunds','cancellations']){
          await run(`document.querySelector('[data-tab=${tab}]').click()`);
          const selector=tab==='refunds'?'#gatewayPaymentsTable [data-history]':'#orderCancellationsTable [data-order-view]';
          assert.deepEqual(await run(styleExpr(selector)),reference,portal+' '+width+' '+theme+' '+tab+' icon styles');
          assert.equal(await run(`document.querySelector('${selector}').parentElement.tagName`),'TD');
          assert.ok(await run(`document.querySelector('${selector}').getAttribute('aria-label')`));
        }
        await run(`document.querySelector('[data-tab=refunds]').click();document.querySelector('[data-history]').click()`);
        await until('document.querySelector("dialog").open');
        // Force a long history to verify the scroll boundary independent of fixture count.
        await run(`document.querySelector('dialog [data-record]').innerHTML+=Array(20).fill('<p>Additional refund history detail for scroll verification.</p>').join('')`);
        const before=await run(`(()=>{const d=document.querySelector('dialog'),b=d.querySelector('.modal-body-scroll'),h=d.querySelector('header').getBoundingClientRect(),f=d.querySelector('footer').getBoundingClientRect(),r=d.getBoundingClientRect();return {header:h.y,footer:f.y,top:r.y,bottom:r.bottom,width:r.width,overflow:d.scrollWidth>d.clientWidth+1,scrolls:b.scrollHeight>b.clientHeight,dialogScroll:d.scrollHeight>d.clientHeight+1}})()`);
        assert.ok(before.scrolls && !before.dialogScroll && !before.overflow,JSON.stringify(before));assert.ok(before.top>=0 && before.bottom<=850,JSON.stringify(before));
        await run(`document.querySelector('dialog .modal-body-scroll').scrollTop=500`);
        const after=await run(`(()=>{const d=document.querySelector('dialog');return {header:d.querySelector('header').getBoundingClientRect().y,footer:d.querySelector('footer').getBoundingClientRect().y}})()`);
        assert.equal(after.header,before.header);assert.equal(after.footer,before.footer);
        await shot(portal+'-'+width+'-'+theme+'-history');
        await run(`document.querySelector('dialog [data-cancel]').click();document.querySelector('[data-tab=cancellations]').click();document.querySelector('[data-cancelapprove]').click()`);
        assert.equal(await run(`document.querySelector('dialog').open`),true);
        await shot(portal+'-'+width+'-'+theme+'-cancellation');
        await run(`document.querySelector('dialog [data-cancel]').click()`);
      }
    }
    // Form errors still release the submit and close controls after the header change.
    await run(`window.fail=true;document.querySelector('[data-tab=refunds]').click();document.querySelector('[data-refund]').click();document.querySelector('dialog form').requestSubmit()`);
    await until(`document.querySelector('dialog [data-error]').textContent==='Please try again.'`);
    assert.equal(await run(`document.querySelector('dialog [data-cancel]').disabled`),false);
    assert.equal(await run(`document.querySelector('dialog [type=submit]').disabled`),false);
    await run(`document.querySelector('dialog [data-cancel]').click()`);
  }
  console.log('PASS: Admin/Staff tab exclusivity, shared payment-history icon styles at desktop/mobile in both themes, fixed dialog header/footer with body-only scrolling, cancellation/refund dialogs, and submit error recovery. Local mocked APIs only.');
 } finally {ws?.close();browser.kill();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
