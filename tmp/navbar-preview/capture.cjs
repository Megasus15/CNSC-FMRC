const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {spawn} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const mode = process.argv[2] || 'before';
const route = process.argv[3] || '/services-page/service.html';
const port = 8773, debugPort = 9333;
const mime = {'.html':'text/html','.css':'text/css','.js':'text/javascript','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2','.ico':'image/x-icon'};
const server = http.createServer((req,res)=>{
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (url.pathname.startsWith('/api/')) {res.writeHead(200, {'Content-Type':'application/json'}); res.end(url.pathname.includes('site-settings') ? '{}' : '[]'); return;}
  const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(root+path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',mime[path.extname(file)] || 'application/octet-stream');
  res.setHeader('Cache-Control','no-store');
  let content=fs.readFileSync(file);
  if(mode==='before' && path.extname(file)==='.html') content=content.toString().replace(/<link\b[^>]*customer-navbar\.css[^>]*>/g,'');
  res.end(content);
});
const delay = ms=>new Promise(resolve=>setTimeout(resolve,ms));
let browser;
(async()=>{
 await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
 browser=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${debugPort}`,`--user-data-dir=${path.join(__dirname,'chrome-profile')}`,'about:blank'], {windowsHide:true,stdio:['ignore','ignore','pipe']});
 let stderr=''; browser.stderr.on('data', d=>stderr+=d);
 let target;
 for(let n=0;n<40;n++) {try { const tabs=await (await fetch(`http://127.0.0.1:${debugPort}/json/list`, {signal:AbortSignal.timeout(500)})).json();target=tabs.find(x=>x.type==='page');if(target) break;}catch{} await delay(250);}
 if(!target) throw new Error('Chrome debugging endpoint unavailable: '+stderr);
 const ws=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
 let seq=0; const pending=new Map();
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 ws.onmessage=ev=>{const msg=JSON.parse(ev.data);if(msg.id){const p=pending.get(msg.id);pending.delete(msg.id);if(msg.error)p?.reject(new Error(JSON.stringify(msg.error)));else p?.resolve(msg.result);}};
 await send('Page.enable'); await send('Runtime.enable');
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.APP_API_BASE_URL='http://127.0.0.1:${port}/api';`});
 const evalJS=async expression=>(await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result.value;
 const metrics=[];
 for(const width of [1440,1024,901,768,390,320]) {
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:`http://127.0.0.1:${port}${route}`});
  for(let n=0;n<60;n++) {if(await evalJS(`document.readyState==='complete' && !!document.querySelector('.guest-sign-in-trigger')`))break;await delay(250);}
  await evalJS(`document.fonts.ready`); await delay(300);
  const data=await evalJS(`(()=>{const selectors=['.site-header','.logo-container','.logo-text','.main-nav','.header-right-actions','.guest-sign-in-trigger','.user-profile','.announcement-bell','.cart-icon-container'];const dimensions={}; for(const s of selectors){const e=document.querySelector(s);if(e){const r=e.getBoundingClientRect(),c=getComputedStyle(e);dimensions[s]={x:r.x,y:r.y,width:r.width,height:r.height,display:c.display,font:c.fontFamily,background:c.backgroundColor,boxShadow:c.boxShadow};}}return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,dimensions};})()`);
  metrics.push(data);
  const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(__dirname,`${mode}-${path.basename(route,'.html')}-${width}.png`),Buffer.from(shot.data,'base64'));
 }
 const output=path.join(__dirname,`${mode}-${path.basename(route,'.html')}-metrics.json`);fs.writeFileSync(output,JSON.stringify(metrics,null,2));console.log(JSON.stringify({mode,route,metrics,port,debugPort},null,2));
 await send('Browser.close').catch(()=>{});ws.close();
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{browser?.kill();server.close();});
