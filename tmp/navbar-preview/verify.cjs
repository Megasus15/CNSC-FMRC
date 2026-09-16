const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'output/navbar-preview');
fs.mkdirSync(out, { recursive: true });
const port = 8773, debugPort = 9333;
const user = {id: 999999, name: 'Preview Customer', username: 'Preview Customer', email: 'preview@example.test', role: 'customer', has_password: true};
const mime = {'.html':'text/html','.css':'text/css','.js':'text/javascript','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2','.ico':'image/x-icon'};
const server = http.createServer((req,res)=>{
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(root+path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',mime[path.extname(file)] || 'application/octet-stream');
  res.setHeader('Cache-Control','no-store');res.end(fs.readFileSync(file));
});
const delay = ms=>new Promise(resolve=>setTimeout(resolve,ms));
let browser, ws;
const report = {boundary:'Local static customer pages; all API responses are fixtures; synthetic customer account in isolated Chrome profile.',layouts:[],protected:[],interactions:[]};
(async()=>{
 await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
 browser=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${debugPort}`,`--user-data-dir=${path.join(__dirname,'chrome-profile')}`,'about:blank'], {windowsHide:true,stdio:['ignore','ignore','pipe']});
 let stderr='';browser.stderr.on('data',d=>stderr+=d);
 let target;
 for(let n=0;n<40;n++){try{const tabs=await(await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();target=tabs.find(x=>x.type==='page');if(target)break;}catch{}await delay(250);}
 if(!target)throw new Error('No Chrome debugger: '+stderr);
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
 let seq=0;const pending=new Map();
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout '+method));},15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
 ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p){clearTimeout(p.timer);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}}else if(m.method==='Fetch.requestPaused'){
   const pathname=new URL(m.params.request.url).pathname;
   const payload=pathname.includes('site-settings')?{data:{}}:pathname.includes('/customer/profile')?{data:user,user}:pathname.includes('site-favicon')?{}:{data:[],meta:{total:0},current_page:1,last_page:1};
   send('Fetch.fulfillRequest',{requestId:m.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'*'}],body:Buffer.from(JSON.stringify(payload)).toString('base64')}).catch(()=>{});
 }};
 await send('Page.enable');await send('Runtime.enable');await send('Fetch.enable',{patterns:[{urlPattern:'*/api/*'}]});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.APP_API_BASE_URL='http://127.0.0.1:${port}/api'; localStorage.clear();sessionStorage.setItem('fmrc_home_intro_seen','1');if(new URL(location.href).searchParams.has('preview-auth')){localStorage.setItem('customer_token','local-preview-only');localStorage.setItem('customer_info',JSON.stringify(${JSON.stringify(user)}));}`});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text+' '+r.exceptionDetails.exception?.description);return r.result.value;};
 const resize=width=>send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
 const visit=async(route,auth=false)=>{await send('Page.navigate',{url:`http://127.0.0.1:${port}${route}${auth?'?preview-auth=1':''}`});for(let n=0;n<48;n++){if(await evaluate(`document.readyState==='complete' && !!document.querySelector('.${auth?'user-initial-badge':'guest-sign-in-trigger'}')`))break;await delay(200);}await evaluate('document.fonts.ready');await delay(350);};
 const shot=async(name,clip)=>{const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,...(clip?{clip:{...clip,scale:1}}:{})});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(r.data,'base64'));};
 const measure=()=>evaluate(`(()=>{const header=document.querySelector('.site-header'),rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};const children=[...header.children].filter(e=>getComputedStyle(e).display!=='none');const overlaps=[];for(let i=1;i<children.length;i++){const a=rect(children[i-1]),b=rect(children[i]);if(a.right>b.left+1&&a.top<b.bottom&&a.bottom>b.top)overlaps.push([children[i-1].className,children[i].className]);}const sign=document.querySelector('.guest-sign-in-label');return {width:innerWidth,viewport:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,header:rect(header),overlaps,signInTruncated:sign&&getComputedStyle(sign.parentElement).display!=='none'?sign.scrollWidth>sign.clientWidth:false,fontLoaded:document.fonts.check('600 14px Montserrat')}})()`);
 const compare=async(selector,label)=>{
  const snapshot=()=>evaluate(`(()=>{const root=document.querySelector(${JSON.stringify(selector)});if(!root)throw new Error('Missing ${selector}');return [root,...root.querySelectorAll('*')].map((e,i)=>{const c=getComputedStyle(e),styles={};for(const p of c)styles[p]=c.getPropertyValue(p);return {i,id:e.id,tag:e.tagName,styles}});})()`);
  await evaluate(`document.querySelector('link[href*="customer-navbar.css"]').disabled=true`);await delay(400);const before=await snapshot();
  await evaluate(`document.querySelector('link[href*="customer-navbar.css"]').disabled=false`);await delay(400);const after=await snapshot();
  const changes=[];before.forEach((a,i)=>{const b=after[i];for(const key of Object.keys(a.styles)){if(a.styles[key]!==b.styles[key])changes.push({id:b.id,index:i,property:key,before:a.styles[key],after:b.styles[key]});}});report.protected.push({label,changes});return changes;
 };
 const pages=['/home-page/main.html','/about-page/about.html','/services-page/service.html','/products-page/product.html','/contact-page/contact.html'];
 for(const route of pages){await resize(1440);await visit(route);for(const width of [1440,1024,901,768,390,320]){await resize(width);await delay(150);const m=await measure();report.layouts.push({route,auth:false,...m});if(route==='/about-page/about.html'&&[1440,390].includes(width))await shot(width===1440?'desktop-navbar':'phone-navbar',width===1440?{x:0,y:0,width:1440,height:140}:{x:0,y:0,width:390,height:680});}
   console.log('Checked guest navbar '+route);
 }
 await resize(1440);await visit('/about-page/about.html');await evaluate(`document.querySelector('.guest-sign-in-trigger').click()`);await delay(300);await compare('#guestProfilePopup','Guest dropdown');
 await evaluate(`document.querySelector('.guest-sign-in-trigger').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);await delay(250);report.interactions.push({name:'Guest dropdown Escape',pass:await evaluate(`!document.querySelector('#guestProfilePopup').classList.contains('show')`)});
 await resize(390);await evaluate(`document.querySelector('.mobile-menu-toggle').click()`);await delay(350);await shot('mobile-navigation',{x:0,y:0,width:390,height:680});report.interactions.push({name:'Mobile menu opens',pass:await evaluate(`document.querySelector('.mobile-sidebar').classList.contains('open')`)});
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});report.interactions.push({name:'Mobile menu Escape',pass:await evaluate(`!document.querySelector('.mobile-sidebar').classList.contains('open')`)});
 for(const route of pages){await resize(1440);await visit(route,true);for(const width of [1440,1024,901,768,390,320]){await resize(width);await delay(100);report.layouts.push({route,auth:true,...await measure()});}console.log('Checked customer navbar '+route);}
 await resize(1440);await visit('/about-page/about.html',true);await evaluate(`document.querySelector('.user-profile').click()`);await delay(300);await compare('.profile-popup','Customer dropdown');await shot('profile-dropdown',{x:1025,y:0,width:400,height:440});
 await evaluate(`document.querySelector('#logoutBtn').click()`);await delay(350);await compare('#laravelLogoutModal','Confirm Logout modal');await shot('confirm-logout');report.interactions.push({name:'Logout confirm opens',pass:await evaluate(`document.querySelector('#laravelLogoutModal').classList.contains('show')`)});
 const shadows=await evaluate(`({dropdown:getComputedStyle(document.querySelector('#logoutBtn')).boxShadow,confirm:getComputedStyle(document.querySelector('#confirmLogoutBtn')).boxShadow})`);report.logoutShadows=shadows;
 await evaluate(`document.querySelector('#cancelLogoutBtn').click()`);await delay(300);report.interactions.push({name:'Logout cancel preserves session',pass:await evaluate(`!document.querySelector('#laravelLogoutModal').classList.contains('show') && !!localStorage.getItem('customer_token')`)});
 await resize(390);await evaluate(`document.querySelector('.user-profile').click()`);await delay(300);await compare('.profile-popup','Phone customer dropdown');await evaluate(`document.querySelector('#logoutBtn').click()`);await delay(300);await compare('#laravelLogoutModal','Phone Confirm Logout modal');await shot('phone-confirm-logout',{x:0,y:0,width:390,height:680});await evaluate(`document.querySelector('#cancelLogoutBtn').click()`);await delay(300);
 await resize(1440);await delay(250);await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await delay(150);
 const reducedMotion=await evaluate(`({matches:matchMedia('(prefers-reduced-motion: reduce)').matches,durations:getComputedStyle(document.querySelector('.main-nav .nav-link')).transitionDuration})`);
 report.interactions.push({name:'Reduced motion navbar',...reducedMotion,pass:reducedMotion.matches&&reducedMotion.durations.split(',').every(d=>parseFloat(d)<=0.00001)});
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await evaluate(`document.querySelector('.main-nav .nav-link').focus()`);await delay(100);
 const focused=await evaluate(`({target:document.activeElement.className,visible:document.activeElement.matches(':focus-visible'),outline:getComputedStyle(document.activeElement).outlineStyle,width:getComputedStyle(document.activeElement).outlineWidth})`);
 report.interactions.push({name:'Keyboard focus visible',...focused,pass:focused.target.includes('nav-link')&&focused.visible&&focused.outline==='solid'&&parseFloat(focused.width)>=2});
 fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(report,null,2));
 const issues=report.layouts.filter(x=>x.scrollWidth>x.viewport+1||x.overlaps.length||x.signInTruncated);
 if(issues.length||report.interactions.some(x=>!x.pass)||report.protected.some(x=>x.changes.some(c=>!['logoutBtn','confirmLogoutBtn'].includes(c.id)||c.property!=='box-shadow')))process.exitCode=1;
 console.log(JSON.stringify({layouts:report.layouts.length,layoutIssues:issues,protected:report.protected,interactions:report.interactions,logoutShadows:shadows},null,2));
 await send('Browser.close').catch(()=>{});ws.close();
})().catch(e=>{console.error(e);fs.writeFileSync(path.join(out,'verification-partial.json'),JSON.stringify(report,null,2));process.exitCode=1}).finally(()=>{browser?.kill();ws?.close();server.close();});
