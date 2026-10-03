// Real shared renderers, isolated HTTP fixtures. No production/API writes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const repo = path.resolve(__dirname, '../../..');
const chrome = [process.env.FMRC_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => p && fs.existsSync(p));
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
async function connect(url) {
  const socket = new WebSocket(url), pending = new Map(); let id = 0;
  await new Promise((resolve,reject) => { socket.onopen=resolve; socket.onerror=reject; });
  socket.onmessage=({data})=>{const r=JSON.parse(data),p=pending.get(r.id);if(!p)return;pending.delete(r.id);r.error?p.reject(new Error(JSON.stringify(r.error))):p.resolve(r.result);};
  return {send(method,params={}){return new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});},close(){socket.close();}};
}
const publicMeasure = function(win) {
  const doc=win.document, selectors=['.maint-site__copy-frame','.maint-site__copy','.maint-site__title','.maint-site__message','.maint-site__art img','.maint-site__foot'];
  return selectors.map(selector=>{
    const el=doc.querySelector(selector),r=el.getBoundingClientRect(),s=win.getComputedStyle(el);
    return {selector,text:el.textContent.trim(),box:[r.x,r.y,r.width,r.height].map(n=>Math.round(n*100)/100),font:s.fontSize,color:s.color};
  });
};
const clock = `(() => {
  let time=1,id=0,controlled=false; const jobs=new Map(),raf=requestAnimationFrame,caf=cancelAnimationFrame;
  window.requestAnimationFrame=fn=>{const key=++id,job={fn,native:0};jobs.set(key,job);if(!controlled)job.native=raf(now=>{jobs.delete(key);fn(now);});return key;};
  window.cancelAnimationFrame=key=>{const job=jobs.get(key);if(job?.native)caf(job.native);jobs.delete(key);};
  window.testClock={start(){controlled=true;time=performance.now();jobs.forEach(j=>{if(j.native)caf(j.native);});},advance(ms){for(let left=ms;left>0;){const step=Math.min(16,left);time+=step;left-=step;const batch=[...jobs.values()];jobs.clear();batch.forEach(j=>j.fn(time));}}};
})();`;
test('Maintenance draft matches the public viewport; independent pedestal pauses every machine in place', {skip:!chrome,timeout:90000}, async()=>{
  const artifacts=fs.mkdtempSync(path.join(os.tmpdir(),'fmrc-preview-power-'));
  let live={installed:true,site_page_installed:true,site_page:{},data:{site_portal:{active:false,message:''}}},writes=0,reads=0;
  const server=http.createServer((req,res)=>{
    const route=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(route.startsWith('/api/')){if(req.method!=='GET')writes++;else reads++;res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(live));return;}
    if(route==='/public-screen.html'){
      res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}</style></head><body><script>const realFetch=fetch;window.fetch=()=>realFetch('/api/maintenance');</script><script src="/home-page/maintenance-gate.js"></script></body></html>`);return;
    }
    if(route==='/machines.html'){
      const home=fs.readFileSync(path.join(repo,'home-page/main.html'),'utf8');
      const scene=home.slice(home.lastIndexOf('<div',home.indexOf('class="fmrc-hero-scene"')),home.indexOf('</div>',home.indexOf('class="fmrc-hero-scene"'))+6);
      res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/home-page/hero-printer-scene.css"><style>body{margin:0;background:#612334}.fmrc-hero-scene{width:min(calc(100% - 24px),660px);margin:20px auto}</style></head><body>${scene.replace('src="assets/','src="/home-page/assets/')}<script>${clock}</script><script src="/home-page/hero-machine-power.js"></script><script src="/home-page/hero-printer-scene.js"></script><script src="/home-page/hero-machine-scenes.js"></script></body></html>`);return;
    }
    const file=path.resolve(repo,'.'+route);
    if(!file.startsWith(repo+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
    if(route==='/admin-page/website-maintenance.html'){
      let html=fs.readFileSync(file,'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
      html=html.replace('</body>',`<script>window.APP_API_BASE_URL=location.origin+'/api';window.AdminPageNotice={clear(){},show(){}};window.AdminSession={getToken:()=>null};localStorage.setItem('fmrc_maintenance_snapshot','preview-sentinel');</script><script src="/admin-page/website-maintenance.js"></script></body>`);
      res.end(html);return;
    }
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=spawn(chrome,['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${path.join(artifacts,'profile')}`,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  let cdp;
  try {
    const endpoint=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error('Browser startup timeout '+log)),15000);browser.stderr.on('data',data=>{log+=data;const match=log.match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timer);resolve(match[1]);}});browser.on('error',reject);});
    const targets=await(await fetch(`http://127.0.0.1:${new URL(endpoint).port}/json/list`)).json();
    cdp=await connect(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
    await cdp.send('Page.enable');await cdp.send('Network.enable');await cdp.send('Network.setBlockedURLs',{urls:['https://*']});
    const evaluate=async expression=>{const r=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
    const wait=async expression=>{for(let i=0;i<120;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50));}throw new Error('Not ready: '+expression);};
    const navigate=route=>cdp.send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}${route}`});
    const viewport=(width,height)=>cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    const shot=async name=>{if(process.env.FMRC_KEEP_SHOTS==='1'){const r=await cdp.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifacts,name+'.png'),Buffer.from(r.data,'base64'));}};
    await viewport(1440,1000);await navigate('/admin-page/website-maintenance.html');
    await wait("document.getElementById('mtPageFields')?.disabled === false && document.getElementById('mtPreviewFrame')?.contentDocument?.querySelector('.maint-site__title')");
    await evaluate("document.getElementById('mtPagePreview').scrollIntoView({block:'center'})");
    await new Promise(r=>setTimeout(r,200));
    const desktop=await evaluate(`(${publicMeasure})(document.getElementById('mtPreviewFrame').contentWindow)`);
    assert.equal(await evaluate("document.getElementById('mtPreviewFrame').contentWindow.innerWidth"),1440);
    await shot('maintenance-desktop');
    await evaluate("document.querySelector('[data-maint-preview-view=mobile]').click()");
    await wait("document.getElementById('mtPreviewFrame').contentWindow.innerWidth === 390");
    await new Promise(r=>setTimeout(r,100));
    const mobile=await evaluate(`(${publicMeasure})(document.getElementById('mtPreviewFrame').contentWindow)`);
    await shot('maintenance-mobile');
    await evaluate(`(() => {
      const input=document.querySelector('[data-page-field=headline]');input.focus();input.value='A new chapter';input.dispatchEvent(new Event('input',{bubbles:true}));
      const message=document.querySelector('[data-msg=site_portal]');message.value='We are preparing the next update for our customers.';message.dispatchEvent(new Event('input',{bubbles:true}));
      const theme=document.querySelector('[name=mtPageTheme][value=soft_gold]');theme.checked=true;theme.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await wait("document.getElementById('mtPreviewFrame').contentDocument.querySelector('.maint-site__title-primary').textContent === 'A new chapter'");
    assert.equal(await evaluate("document.activeElement.matches('[data-page-field=headline]')"),true,'preview updates do not steal editing focus');
    assert.equal(await evaluate("document.getElementById('mtPreviewFrame').contentDocument.querySelector('.maint-site').classList.contains('maint-site--soft_gold')"),true);
    assert.equal(await evaluate("localStorage.getItem('fmrc_maintenance_snapshot')"),'preview-sentinel','draft cannot change customer caches');
    assert.equal(reads,1,'only Admin fetches the snapshot; the preview has no polling');assert.equal(writes,0);
    // The actual public renderer at the same viewport must have equal geometry.
    live.data.site_portal.active=true;
    for(const [width,height,expected]of[[1440,900,desktop],[390,844,mobile]]){
      await viewport(width,height);await navigate('/public-screen.html');
      await wait("document.querySelector('.maint-site__art img')?.complete && document.querySelector('.maint-site__copy')?.style.getPropertyValue('--ms-fit')");
      assert.deepEqual(await evaluate(`(${publicMeasure})(window)`),expected,`${width}: preview matches real public maintenance layout`);
    }
    live.data.site_portal.active=false;
    await viewport(1440,900);await navigate('/machines.html');
    await wait("document.getElementById('heroPrinterScene')?.dataset.mechanism === 'ready' && document.getElementById('heroPrinterScene').dataset.running === 'true'");
    await evaluate('window.testClock.start()');
    const state=`(() => {
      const scene=document.getElementById('heroPrinterScene'),type=scene.dataset.machine||'printer';
      const svg=type==='printer'?scene.querySelector('.hero-printer-mechanism'):[...scene.querySelectorAll('.hero-machine-art')].find(s=>s.style.display!=='none');
      let hash=0;for(const ch of svg.innerHTML)hash=((hash<<5)-hash+ch.charCodeAt(0))|0;
      return {hash,product:type==='printer'?scene.dataset.productId:svg.dataset.productId,progress:type==='printer'?Number(scene.dataset.printProgress):Number(svg.querySelector('.hm-cut').dataset.progress),stand:scene.querySelector('.hero-power-stand').innerHTML};
    })()`;
    const saved={};
    for(const type of ['printer','laser','cnc']){
      await evaluate(`document.getElementById('heroPrinterScene').dataset.machine=${JSON.stringify(type)}`);
      await wait(type==='printer'?"document.getElementById('heroPrinterScene').dataset.running === 'true'":"document.getElementById('heroPrinterScene').dataset.machineReady === 'true' && [...document.querySelectorAll('.hero-machine-art')].some(s=>s.style.display!=='none' && s.dataset.running==='true')");
      await evaluate('window.testClock.advance(5200)');
      const running=await evaluate(state);assert(running.progress>0&&running.progress<1,type+' has a partial product');
      await evaluate("document.querySelector('.hero-machine-power').click()");
      await wait("document.getElementById('heroPrinterScene').dataset.machinePower === 'off'");
      saved[type]=await evaluate(state);
      await evaluate('window.testClock.advance(60000)');
      assert.deepEqual(await evaluate(state),saved[type],type+' freezes exact geometry for a minute');
      await new Promise(r=>setTimeout(r,250));
      assert.equal(await evaluate("document.querySelector('.hero-machine-power').textContent"),'','power control is icon-only');
      assert.equal(await evaluate("document.querySelector('.hero-power-stand').getAnimations({subtree:true}).filter(a=>a.playState==='running').length"),0,'press is brief');
      await shot(type+'-off');
      await evaluate("document.querySelector('.hero-machine-power').focus()");
      await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      await wait("document.getElementById('heroPrinterScene').dataset.machinePower === 'on'");
      await evaluate('window.testClock.advance(700)');
      const resumed=await evaluate(state);assert.equal(resumed.product,running.product);assert(resumed.progress>running.progress,type+' resumes without restart');
      await evaluate("for(let i=0;i<10;i++)document.querySelector('.hero-machine-power').click()");
      await evaluate('window.testClock.advance(500)');
      assert.equal(await evaluate("document.querySelector('.hero-machine-power').getAttribute('aria-pressed')"),'true');
      await viewport(390,844);await new Promise(r=>setTimeout(r,100));
      const hit=await evaluate("(() => {const b=document.querySelector('.hero-machine-power'),r=b.getBoundingClientRect();return {width:r.width,height:r.height,left:r.left,right:r.right,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b};})()");
      assert(hit.width>=44&&hit.height>=44&&hit.left>=0&&hit.right<=390&&hit.hit,type+' has a reachable phone hit target');
      await shot(type+'-mobile');await viewport(1440,900);
    }
    await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await wait("document.querySelector('.hero-machine-power').disabled");
    assert.equal(await evaluate("document.getElementById('heroPrinterScene').dataset.machinePower"),'off');
    assert.equal(writes,0);
    if(process.env.FMRC_KEEP_SHOTS==='1')console.log('Screenshots: '+artifacts);
  } finally {
    cdp?.close();browser.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    if(process.env.FMRC_KEEP_SHOTS!=='1'&&path.resolve(artifacts).startsWith(path.resolve(os.tmpdir())+path.sep)){
      try{fs.rmSync(artifacts,{recursive:true,force:true});}catch{/* browser is releasing its temporary profile */}
    }
  }
});
