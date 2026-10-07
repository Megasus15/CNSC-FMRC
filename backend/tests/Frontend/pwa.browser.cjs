/* Actual Chromium service workers and DOM; install/permission/push APIs use controlled fixtures. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http'), os = require('node:os');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function connect(url) {
  const socket = new WebSocket(url), jobs = new Map(); let id = 0;
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = ({ data }) => { const m = JSON.parse(data), job = jobs.get(m.id); if (job) { jobs.delete(m.id); m.error ? job.reject(Error(JSON.stringify(m.error))) : job.resolve(m.result); } };
  return { send(method, params = {}) { return new Promise((resolve, reject) => { const number = ++id, timer = setTimeout(() => reject(Error(method)), 15000); jobs.set(number, { resolve: value => { clearTimeout(timer); resolve(value); }, reject }); socket.send(JSON.stringify({ id: number, method, params })); }); }, close() { socket.close(); } };
}
async function startBrowser(profile) {
  const browser=spawn(chrome,['--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  try {
    const endpoint=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(Error('Browser startup timeout')),15000);browser.stderr.on('data',data=>{log+=data;const m=log.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(timer);resolve(m[1]);}});browser.on('error',reject);});
    const tabs=await(await fetch(`http://127.0.0.1:${new URL(endpoint).port}/json/list`)).json();
    return {browser,client:await connect(tabs.find(t=>t.type==='page').webSocketDebuggerUrl)};
  } catch(error) {browser.kill();throw error;}
}
test('two app shells retain navigation, installation state, device isolation, explicit permission, offline Retry, and phone layouts', { skip: !chrome, timeout: 180000 }, async () => {
  const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'fmrc-pwa-'));
  console.log('Browser artifacts: '+artifacts);
  let offlineNavigation = false, pushReady = true, devices = {}, lastPost, reads = new Set();
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname === '/.well-known/assetlinks.json') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(['customer','team'].map(app=>({relation:['delegate_permission/common.query_webapk'],target:{namespace:'web',site:`http://${req.headers.host}/apps/${app}/manifest.webmanifest`}})))); return;
    }
    if (offlineNavigation && u.pathname === '/apps/customer/about-page/about.html') { req.socket.destroy(); return; }
    if (u.pathname.startsWith('/api/')) {
      let chunks = ''; for await (const part of req) chunks += part;
      const body = chunks ? JSON.parse(chunks) : {}; res.setHeader('Content-Type', 'application/json');
      let data = { data: [], unread_count: 0 };
      if (u.pathname === '/api/pwa/config') data = { push_available: pushReady, inbox_available: true, public_key: pushReady ? 'B' + 'a'.repeat(86) : null };
      if (u.pathname === '/api/pwa/subscriptions' && req.method === 'POST') { lastPost = body; const id = body.app === 'team' ? 2 : 1; devices[id] = { id, credential: 'a'.repeat(64), user_id: req.headers.authorization ? (body.app === 'team' ? 8 : 7) : null, public_alerts: body.public_alerts, account_alerts: body.account_alerts }; data = devices[id]; }
      const device = u.pathname.match(/\/pwa\/subscriptions\/(\d+)/);
      if (device) { const id = +device[1]; if (!devices[id]) { res.statusCode = 404; data = {}; } else if (req.method === 'DELETE') { delete devices[id]; data = { removed: true }; } else { if (body.detach) { devices[id].user_id = null; devices[id].account_alerts = false; } else Object.assign(devices[id], body); data = devices[id]; } }
      if (u.pathname === '/api/customer/notifications') data = { data: [{ id: 11, title: 'New FMRC announcement', type: 'announcement', message: 'A public update for everyone.', target: '/home-page/main.html', published_at: '2026-10-05 10:00:00', read_at: reads.has(11) ? 'read' : null }], next_page_url: null };
      if (u.pathname === '/api/customer/notifications/11') data = {id:11,type:'announcement',target:'/home-page/main.html?announcement=11'};
      if (u.pathname.endsWith('/11/read')) { reads.add(11); data = { read: true }; }
      if (u.pathname.endsWith('/unread-count')) data = { unread_count: reads.has(11) || Number(u.searchParams.get('after')) >= 11 || (u.searchParams.get('read_ids') || '').split(',').includes('11') ? 0 : 1 };
      if (u.pathname === '/api/admin/session') data = { server_time: new Date().toISOString(), idle_warning_at: new Date(Date.now()+3600000).toISOString(), idle_expires_at: new Date(Date.now()+3780000).toISOString(), absolute_expires_at: new Date(Date.now()+21600000).toISOString() };
      if (u.pathname === '/api/user') data = { id: 8, name: 'Operator', role: String(req.headers.authorization).includes('staff') ? 'staff' : 'admin' };
      res.end(JSON.stringify(data)); return;
    }
    let relative = decodeURIComponent(u.pathname).replace(/^\//, '');
    const namespace = relative.match(/^apps\/(customer|team)\/(.*)$/);
    if (namespace && /^(home-page|about-page|services-page|products-page|contact-page|customer-auth|admin-auth|admin-page|staff-page|images)\//.test(namespace[2])) relative = namespace[2];
    if (u.pathname.endsWith('/test.html')) {
      res.setHeader('Content-Type', 'text/html'); const app = u.pathname.includes('/team/') ? 'team' : 'customer';
      res.end(`<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script>window.APP_API_BASE_URL=location.origin+'/api';</script><link rel="stylesheet" href="/apps/shared/pwa.css"><script src="/apps/shared/pwa.js"></script></head><body style="font-family:Arial"><header class="header-right-actions"></header><aside class="mobile-sidebar"><footer class="sidebar-footer-actions"></footer></aside><aside><footer class="sidebar-footer"></footer></aside><main><a id="internal" href="/${app === 'team' ? 'admin-page/dashboard' : 'about-page/about'}.html">Next page</a><a id="api" href="/api/customer/orders">API</a><a id="external" href="https://example.com">External</a></main></body></html>`); return;
    }
    let file = path.join(root, relative); if (relative.endsWith('/')) file = path.join(file,'index.html'); if (!path.extname(file)) file += '.html'; if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; res.end(); return; }
    const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' }; res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    let content = fs.readFileSync(file); if (file.endsWith('.html')) content = content.toString().replace('<head>', `<head><script>window.APP_API_BASE_URL=location.origin+'/api';</script>`); res.end(content);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  let browser,client;
  try {
    ({browser,client}=await startBrowser(path.join(artifacts,'profile')));
    await client.send('Page.enable');await client.send('Network.enable');await client.send('Network.setBlockedURLs',{urls:['https://*']});
    await client.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    const evaluate=async expression=>{const r=await client.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
    const wait=async expression=>{for(let i=0;i<150;i++){if(await evaluate(expression))return;await pause(40);}throw Error('Timeout: '+expression);};
    const navigate=async route=>{const target=new URL(route,base);await client.send('Page.navigate',{url:target.href});await wait(`location.pathname===${JSON.stringify(target.pathname)}&&location.search===${JSON.stringify(target.search)}&&document.readyState==='complete'`);};
    const screenshot=async name=>{const r=await client.send('Page.captureScreenshot',{captureBeyondViewport:false});fs.writeFileSync(path.join(artifacts,name+'.png'),Buffer.from(r.data,'base64'));};
    await navigate('/apps/customer/test.html');await wait('!!window.FMRCApp');
    assert.equal(await evaluate('FMRCApp.installDevice'),false);assert.equal(await evaluate('!!document.querySelector(".fmrc-install-button,link[rel=manifest]")'),false);
    await evaluate(`localStorage.setItem('admin_auth_token','8|admin');localStorage.setItem('admin_user_info',JSON.stringify({id:8,name:'Admin',role:'admin'}));`);
    await navigate('/apps/team/admin-page/settings.html');await wait('!!window.FMRCApp');assert.equal(await evaluate('!!document.querySelector(".fmrc-phone-controls,.fmrc-install-button,.fmrc-settings-install")'),false);
    await client.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    for (const page of ['home-page/main','about-page/about','services-page/service','products-page/product','contact-page/contact']) {
      await navigate('/apps/customer/'+page+'.html');await wait('!!document.getElementById("announcementModal")');
      assert.equal(await evaluate('!!document.querySelector("#announcementBell.announcement-bell .fa-bell")'),true,page);
      assert.equal(await evaluate('!!document.querySelector(".fmrc-app-inbox-button,.fmrc-inbox-bell,.fmrc-phone-controls,.fmrc-install-button")'),false,page);
      await evaluate('document.getElementById("announcementBell").click()');await wait('document.getElementById("announcementModal").hidden===false');
      assert.equal(await evaluate('!!document.querySelector("dialog.fmrc-app-dialog,.fmrc-phone-controls")'),false,page);
      await evaluate('document.getElementById("announcementModalCloseX").click()');
    }
    await client.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await client.send('Network.setUserAgentOverride',{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Version/18.5 Mobile/15E148 Safari/604.1'});
    await navigate('/apps/customer/test.html');await wait('!!document.querySelector(".fmrc-install-button")');
    assert.equal(await evaluate('document.getElementById("internal").pathname'),'/apps/customer/about-page/about.html');assert.equal(await evaluate('document.getElementById("api").pathname'),'/api/customer/orders');
    assert.equal(await evaluate('document.getElementById("external").href'),'https://example.com/');
    assert.equal(await evaluate('Notification.permission'),'default');
    await evaluate('FMRCApp.install()'); await wait('!!document.querySelector("dialog[open]")'); await screenshot('customer-install-390');
    await evaluate('document.querySelector("dialog").close();FMRCApp.openPreferences()');await wait('!!document.querySelector(".fmrc-phone-controls")');await screenshot('customer-permissions-390');
    assert.equal(await evaluate('!!document.querySelector(".fmrc-inbox-item,.fmrc-inbox-toolbar,.fmrc-inbox-list")'),false);
    const hover = await evaluate('(()=>{const r=document.querySelector(".fmrc-phone-actions .fmrc-app-button").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');await client.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:hover.x,y:hover.y});
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".fmrc-phone-actions .fmrc-app-button")).transform'),'none');
    assert.equal(await evaluate('document.querySelector(".fmrc-phone-controls .fmrc-app-button").disabled'),true);
    await client.send('Network.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36'});
    pushReady = false;
    await navigate('/apps/customer/test.html');await evaluate('FMRCApp.openPreferences()');await wait('!!document.querySelector(".fmrc-phone-controls")');
    await evaluate(`Notification.requestPermission=async()=>{window.permissionCount=(window.permissionCount||0)+1;return 'denied'};`);
    assert.equal(await evaluate('window.permissionCount||0'),0);
    await wait('document.querySelector(".fmrc-app-status").textContent.includes("not available yet")');
    assert.equal(await evaluate('document.querySelector(".fmrc-phone-controls .fmrc-app-button").disabled'),true);
    pushReady = true;
    await evaluate('document.dispatchEvent(new Event("visibilitychange"))');
    await wait('!document.querySelector(".fmrc-phone-controls .fmrc-app-button").disabled');
    assert.equal(await evaluate('window.permissionCount||0'),0);
    await evaluate('document.querySelector(".fmrc-phone-controls .fmrc-app-button").click()');await wait('window.permissionCount===1');
    await wait('document.querySelector(".fmrc-app-status").textContent.includes("not enabled")');
    await evaluate(`Notification.requestPermission=async()=>{window.permissionCount++;return 'granted'};PushManager.prototype.getSubscription=async()=>null;PushManager.prototype.subscribe=async()=>({toJSON:()=>({endpoint:'https://fcm.googleapis.com/fcm/send/test',keys:{p256dh:'test',auth:'test'}}),unsubscribe:async()=>true});localStorage.setItem('customer_token','7|customer');`);
    await evaluate('document.querySelector(".fmrc-phone-controls .fmrc-app-button").click()');await wait('!!localStorage.getItem("fmrc_pwa_customer_device")');assert.equal(lastPost.app,'customer');
    await evaluate('FMRCApp.logout()');assert.equal(devices[1].user_id,null);assert.equal(devices[1].public_alerts,true);
    await navigate('/apps/team/test.html');await wait('!!window.FMRCApp');
    assert.equal(await evaluate('!!document.querySelector(".sidebar-footer .fmrc-install-button")'),false);
    assert.equal(await evaluate('document.getElementById("internal").pathname'),'/apps/team/admin-page/dashboard.html');
    await wait('(async()=> (await navigator.serviceWorker.getRegistrations()).length===2)()');
    const scopes=await evaluate('(async()=> (await navigator.serviceWorker.getRegistrations()).map(r=>new URL(r.scope).pathname).sort())()');assert.deepEqual(scopes,['/apps/customer/','/apps/team/']);
    await evaluate(`localStorage.setItem('staff_auth_token','8|staff');localStorage.setItem('staff_user_info',JSON.stringify({id:8,name:'Staff',role:'staff'}));localStorage.setItem('fmrc_pwa_team_role','staff')`);
    await navigate('/apps/team/staff-page/settings.html');await wait('!!document.querySelector(".fmrc-phone-controls")');await pause(1800);await evaluate('document.querySelector(".fmrc-phone-controls").scrollIntoView({block:"center"})');await screenshot('staff-settings-390');
    assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("link[rel=apple-touch-icon]")).map(l=>new URL(l.href).pathname+new URL(l.href).search)'),['/apps/team/icons/apple-touch-icon.png?v=3']);
    // The portal's theme helper may set its existing browser-chrome color later.
    assert.equal(await evaluate('document.querySelectorAll("meta[name=theme-color]").length'),1);
    assert.equal(await evaluate('!!document.querySelector(".fmrc-settings-install")'),true);
    assert.equal(await evaluate('!!document.querySelector(".sidebar-footer .fmrc-install-button")'),false);
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
    await navigate('/apps/team/admin-page/settings.html');await wait('!!document.querySelector(".fmrc-settings-install")');
    await evaluate('localStorage.removeItem("customer_token")');
    await navigate('/apps/customer/home-page/main.html');await wait('!!document.querySelector(".mobile-sidebar .fmrc-app-inbox-button")');await wait('!!document.querySelector(".mobile-sidebar .fmrc-install-button")');await wait('!!document.getElementById("announcementModal")');await pause(1600);
    assert.equal(await evaluate('document.querySelector(".fmrc-sidebar-app-actions").nextElementSibling.className'),'sidebar-footer-actions');
    assert.deepEqual(await evaluate('Array.from(document.querySelector(".fmrc-sidebar-app-actions").children).map(b=>b.classList.contains("fmrc-install-button")?"install":"notifications")'),['install','notifications']);
    assert.equal(await evaluate('!!document.querySelector(".sidebar-footer-actions .fmrc-install-button,.sidebar-footer-actions .fmrc-app-inbox-button")'),false);
    assert.equal(await evaluate('!!document.querySelector("#announcementBell.announcement-bell .fa-bell")'),true);
    await evaluate('document.getElementById("announcementBell").click()');await wait('document.getElementById("announcementModal").hidden===false');
    assert.equal(await evaluate('!!document.querySelector(".fmrc-phone-controls")'),false);
    await evaluate('document.getElementById("announcementModalCloseX").click();document.getElementById("mobileMenuToggle").click()');await screenshot('customer-sidebar-390');
    await evaluate('document.querySelector(".mobile-sidebar .fmrc-app-inbox-button").click()');await wait('!!document.querySelector("dialog.fmrc-permissions-dialog[open]")');
    assert.equal(await evaluate('document.querySelector(".mobile-sidebar").classList.contains("open")'),false);
    assert.equal(await evaluate('!!document.querySelector("dialog .fmrc-phone-controls")'),true);await screenshot('customer-app-notifications-390');
    await evaluate('document.querySelector("dialog").close();localStorage.setItem("customer_token","7|customer");FMRCApp.openPreferences()');
    await wait('!document.querySelector("input[data-preference=account_alerts]").disabled');
    // Permission actions stay compact and single-line without an inbox toolbar.
    for (const width of [320,390]) {
      await client.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
      const actions = await evaluate('Array.from(document.querySelector(".fmrc-phone-actions").children).filter(b=>!b.hidden).map(b=>{const r=b.getBoundingClientRect();return {text:b.textContent,top:r.top,height:r.height,fits:b.scrollWidth<=b.clientWidth,nowrap:getComputedStyle(b).whiteSpace}})');
      assert.equal(actions.length,2);
      assert(actions.every(b=>b.top===actions[0].top && b.height===actions[0].height && b.height<=44 && b.fits && b.nowrap==='nowrap'));
      assert.equal(await evaluate('Array.from(document.querySelectorAll("dialog button")).some(b=>/Refresh|Mark All Read|View Update|Mark Read/.test(b.textContent))'),false);
      assert.equal(await evaluate('document.querySelector("dialog").scrollWidth>document.querySelector("dialog").clientWidth'),false);
      await screenshot('customer-permissions-'+width);
    }
    assert.equal(await evaluate('document.querySelector(".fmrc-install-button").textContent'),'Install App');
    assert.equal(await evaluate('!!document.querySelector(".fmrc-install-button svg,.fmrc-install-button [aria-hidden]")'),false);
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".fmrc-install-button")).justifyContent'),'flex-start');
    await evaluate('document.querySelector("dialog").close()');
    // The app actions stay above the appointment divider while only navigation scrolls.
    await evaluate('document.getElementById("mobileMenuToggle").click();document.querySelector(".sidebar-nav ul").innerHTML+=document.querySelector(".sidebar-nav ul").innerHTML.repeat(3)');
    for (const [width,height] of [[320,568],[390,844],[844,390]]) {
      await client.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
      const before=await evaluate('(()=>{const a=document.querySelector(".fmrc-sidebar-app-actions").getBoundingClientRect(),f=document.querySelector(".sidebar-footer-actions").getBoundingClientRect();return {top:a.top,bottom:a.bottom,divider:f.top,footerBottom:f.bottom}})()');
      await evaluate('document.querySelector(".sidebar-nav").scrollTop=10000');
      assert.equal(await evaluate('document.querySelector(".fmrc-sidebar-app-actions").getBoundingClientRect().top'),before.top);
      assert(before.top>=0 && before.bottom<=before.divider && before.footerBottom<=height);
      await screenshot('customer-sidebar-'+width+'x'+height);
    }
    await client.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    const cached=await evaluate('(async()=> {const result={};for(const name of await caches.keys()){const cache=await caches.open(name);result[name]=(await cache.keys()).map(r=>new URL(r.url).pathname)}return result})()');
    assert.equal(Object.keys(cached).length,2);for(const assets of Object.values(cached))assert.equal(assets.length,3);
    offlineNavigation = true;
    await client.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
    await navigate('/apps/customer/about-page/about.html');await wait('document.querySelector("h1")?.textContent==="You\'re offline"');await screenshot('offline-390');
    offlineNavigation = false;
    await client.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});await evaluate('document.querySelector("button").click()');await wait('!!document.querySelector(".fmrc-app-inbox-button")');
    // Native install completion must survive the same observer that used to recreate the button.
    // These tests emulate OS installation; suppress genuine headless install offers for
    // the physically uninstalled fixture. Controlled beforeinstallprompt events remain active.
    const installFixture = await client.send('Page.addScriptToEvaluateOnNewDocument',{source:'Object.defineProperty(navigator,"brave",{configurable:true,value:{isBrave:async()=>true}});window.addEventListener("beforeinstallprompt",e=>{if(e.isTrusted){e.preventDefault();e.stopImmediatePropagation()}},true)'});
    await navigate('/apps/customer/test.html');await wait('!!document.querySelector(".fmrc-install-button")');
    await evaluate('window.dispatchEvent(new Event("appinstalled"));document.body.append(document.createElement("div"))');
    await pause(100);
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".fmrc-install-button")).display'),'none');
    assert.equal(await evaluate('localStorage.getItem("fmrc_pwa_customer_installed")'),'1');
    for (const customerToken of ['', '7|customer']) {
      await evaluate(`localStorage.setItem('customer_token',${JSON.stringify(customerToken)})`);
      await navigate('/home-page/main.html');await wait('!!window.FMRCApp');
      assert.equal(await evaluate('!!document.querySelector(".fmrc-install-button:not([hidden])")'),false);
      assert.equal(await evaluate('!!document.querySelector(".fmrc-app-inbox-button")'),true);
    }
    await evaluate('FMRCApp.logout()');
    assert.equal(await evaluate('localStorage.getItem("fmrc_pwa_customer_installed")'),'1');
    // A shortcut can be removed from the same permission panel; no hidden install page required.
    await evaluate('FMRCApp.openPreferences()');await wait('!!document.querySelector(".fmrc-install-remove-choice:not([hidden])")');
    await evaluate('document.querySelector(".fmrc-install-remove-choice").click()');
    assert.equal(await evaluate('!!document.querySelector(".fmrc-install-button:not([hidden])")'),true);
    await evaluate('document.querySelector(".fmrc-install-confirm-choice").click()');
    assert.equal(await evaluate('!!document.querySelector(".fmrc-install-button:not([hidden])")'),false);
    await evaluate('document.querySelector("dialog").close()');
    await navigate('/apps/team/admin-page/settings.html');await wait('!!document.querySelector(".fmrc-settings-install")');
    assert.equal(await evaluate('document.querySelector(".fmrc-settings-install").hidden'),false);
    await evaluate('window.dispatchEvent(new Event("appinstalled"));document.body.append(document.createElement("div"))');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".fmrc-settings-install")).display'),'none');
    for (const role of ['admin', 'staff']) {
      await navigate(`/${role}-page/settings.html`);await wait('!!document.querySelector(".fmrc-phone-controls")');
      assert.equal(await evaluate('document.querySelector(".fmrc-settings-install").hidden'),true);
      assert.equal(await evaluate('!!document.querySelector(".fmrc-install-button:not([hidden])")'),false);
    }
    // Repeated install offers from shortcut browsers are not uninstall evidence.
    await evaluate(`(()=>{const e=new Event('beforeinstallprompt',{cancelable:true});e.prompt=async()=>{};e.userChoice=Promise.resolve({outcome:'dismissed'});window.dispatchEvent(e)})()`);
    assert.equal(await evaluate('document.querySelector(".fmrc-settings-install").hidden'),true);
    assert.equal(await evaluate('localStorage.getItem("fmrc_pwa_team_installed")'),'1');
    await client.send('Page.reload',{ignoreCache:true});await wait('performance.getEntriesByType("navigation")[0]?.type==="reload" && document.readyState==="complete" && !!document.querySelector(".fmrc-settings-install")');
    assert.equal(await evaluate('document.querySelector(".fmrc-settings-install").hidden'),true);
    // The same removal control is available inside both operator Settings cards.
    await wait('!!document.querySelector(".fmrc-install-remove-choice:not([hidden])")');
    assert.equal(await evaluate('!!document.querySelector(".fmrc-phone-controls .fmrc-settings-install")'),true);
    await evaluate('document.querySelector(".fmrc-install-remove-choice").click()');
    assert.equal(await evaluate('document.querySelector(".fmrc-settings-install").hidden'),false);
    assert.equal(await evaluate('localStorage.getItem("fmrc_pwa_team_installed")'),null);
    assert.equal(await evaluate('localStorage.getItem("fmrc_pwa_customer_installed")'),'1');
    await evaluate(`(()=>{const e=new Event('beforeinstallprompt',{cancelable:true});e.prompt=async()=>{};e.userChoice=Promise.resolve({outcome:'accepted'});window.dispatchEvent(e)})()`);
    await evaluate('FMRCApp.install()');
    assert.equal(await evaluate('localStorage.getItem("fmrc_pwa_team_installed")'),'1');
    // Safari-style confirmation never marks merely opening/closing its installation guide.
    await client.send('Network.setUserAgentOverride',{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Version/18.5 Mobile/15E148 Safari/604.1'});
    await navigate('/apps/customer/install.html');await wait('!!document.querySelector(".fmrc-install-reset")');
    await evaluate('document.querySelector(".fmrc-install-reset").click();FMRCApp.install()');await wait('!!document.querySelector("dialog[open]")');
    await evaluate('document.querySelector("dialog").close()');
    assert.equal(await evaluate('localStorage.getItem("fmrc_pwa_customer_installed")'),null);
    await evaluate('FMRCApp.install()');await wait('!!document.querySelector("dialog[open]")');
    await evaluate('Array.from(document.querySelectorAll("dialog button")).find(b=>b.textContent === "Already installed").click()');
    assert.equal(await evaluate('getComputedStyle(document.querySelector("[data-fmrc-install]")).display'),'none');
    await navigate('/home-page/main.html');await wait('!!window.FMRCApp');
    assert.equal(await evaluate('!!document.querySelector(".fmrc-install-button:not([hidden])")'),false);
    // An installed app window hides installation even without the browser's stored marker.
    await evaluate('localStorage.removeItem("fmrc_pwa_customer_installed")');
    const standaloneFixture = await client.send('Page.addScriptToEvaluateOnNewDocument',{source:'Object.defineProperty(navigator,"standalone",{value:true,configurable:true})'});
    await navigate('/apps/customer/test.html');await wait('!!window.FMRCApp');
    assert.equal(await evaluate('localStorage.getItem("fmrc_pwa_customer_installed")'),'1');
    assert.equal(await evaluate('!!document.querySelector(".fmrc-install-button:not([hidden])")'),false);
    await client.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:standaloneFixture.identifier});
    // Android detection only recognizes the current app, including outside its launch scope.
    await client.send('Network.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36'});
    const relatedFixture = await client.send('Page.addScriptToEvaluateOnNewDocument',{source:'delete navigator.brave;Object.defineProperty(navigator,"getInstalledRelatedApps",{configurable:true,value:async()=>JSON.parse(localStorage.getItem("fixture_installed_apps")||"[]")})'});
    // A current supported inventory repairs legacy "installed" flags even if they were never verified.
    await evaluate('localStorage.setItem("fmrc_pwa_customer_installed","1");localStorage.removeItem("fmrc_pwa_customer_installed_verified");localStorage.setItem("fixture_installed_apps","[]")');
    await navigate('/home-page/main.html');await wait('localStorage.getItem("fmrc_pwa_customer_installed")===null && !!document.querySelector(".fmrc-install-button:not([hidden])")');
    await evaluate('localStorage.removeItem("fmrc_pwa_customer_installed");localStorage.removeItem("fmrc_pwa_team_installed");localStorage.setItem("fixture_installed_apps",JSON.stringify([{platform:"webapp",url:location.origin+"/apps/customer/manifest.webmanifest"}]))');
    await navigate('/home-page/main.html');await wait('localStorage.getItem("fmrc_pwa_customer_installed")==="1"');
    assert.equal(await evaluate('!!document.querySelector(".fmrc-install-button:not([hidden])")'),false);
    await navigate('/staff-page/settings.html');await wait('!!document.querySelector(".fmrc-settings-install")');
    assert.equal(await evaluate('document.querySelector(".fmrc-settings-install").hidden'),false);
    await evaluate('localStorage.setItem("fixture_installed_apps",JSON.stringify([{platform:"webapp",id:location.origin+"/apps/team/"}]))');
    await navigate('/admin-page/settings.html');await wait('localStorage.getItem("fmrc_pwa_team_installed")==="1"');
    assert.equal(await evaluate('document.querySelector(".fmrc-settings-install").hidden'),true);
    // A supported inventory reports real removal for this app only.
    await evaluate('localStorage.setItem("fixture_installed_apps","[]");document.dispatchEvent(new Event("visibilitychange"))');
    await wait('localStorage.getItem("fmrc_pwa_team_installed")===null && !document.querySelector(".fmrc-settings-install").hidden');
    assert.equal(await evaluate('localStorage.getItem("fmrc_pwa_customer_installed")'),'1');
    await client.send('Page.reload',{ignoreCache:true});await wait('performance.getEntriesByType("navigation")[0]?.type==="reload" && document.readyState==="complete" && !!document.querySelector("meta[name=application-name]") && !!document.querySelector(".fmrc-phone-controls .fmrc-settings-install:not([hidden])")');
    assert.equal(await evaluate('document.querySelector("meta[name=application-name]").content'),'FMRC Team');
    // A delayed negative inventory cannot overwrite a newer installation event.
    await evaluate('Object.defineProperty(navigator,"getInstalledRelatedApps",{configurable:true,value:()=>new Promise(resolve=>window.finishInstallCheck=resolve)});window.dispatchEvent(new Event("focus"))');
    await wait('!!window.finishInstallCheck');
    await evaluate('window.dispatchEvent(new Event("appinstalled"));window.finishInstallCheck([])');await pause(50);
    assert.equal(await evaluate('localStorage.getItem("fmrc_pwa_team_installed")'),'1');
    await client.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:relatedFixture.identifier});
    await client.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:installFixture.identifier});
    // Both operator cards keep saved preferences and Turn off on one compact row.
    devices[2] = {id:2,credential:'b'.repeat(64),user_id:8,public_alerts:false,account_alerts:true};
    await evaluate(`localStorage.setItem('fmrc_pwa_team_device',${JSON.stringify(JSON.stringify(devices[2]))})`);
    for (const operator of ['admin','staff']) for (const width of [320,390]) {
      await client.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
      await navigate(`/${operator}-page/settings.html`);await wait('!!document.querySelector(".fmrc-phone-actions")');
      await wait('!document.querySelector(".fmrc-load-veil.is-on,.fmrc-load-boot")');
      await wait('!document.querySelector(".fmrc-load-veil") || getComputedStyle(document.querySelector(".fmrc-load-veil")).opacity==="0"');
      await evaluate('document.documentElement.dataset.theme="dark";document.querySelector(".fmrc-phone-controls").scrollIntoView({block:"center"})');
      assert.equal(await evaluate('getComputedStyle(document.querySelector(".fmrc-settings-install")).color'),await evaluate('getComputedStyle(document.querySelector(".fmrc-phone-actions .is-secondary")).color'));
      const actions = await evaluate('Array.from(document.querySelector(".fmrc-phone-actions").children).filter(b=>!b.hidden).map(b=>{const r=b.getBoundingClientRect();return {top:r.top,height:r.height,fits:b.scrollWidth<=b.clientWidth,nowrap:getComputedStyle(b).whiteSpace}})');
      assert.equal(actions.length,2);assert(actions.every(b=>b.top===actions[0].top && b.height===actions[0].height && b.height<=44 && b.fits && b.nowrap==='nowrap'));
      assert.equal(await evaluate('document.querySelector(".fmrc-phone-controls").scrollWidth>document.querySelector(".fmrc-phone-controls").clientWidth'),false);
      assert.equal(await evaluate('!!document.querySelector(".fmrc-phone-controls .fmrc-settings-install")'),true);
      const gaps=await evaluate('(()=>{const cards=[...document.querySelectorAll(".portal-settings > .settings-section,.portal-settings > .fmrc-phone-controls")];return cards.slice(1).map((card,i)=>card.getBoundingClientRect().top-cards[i].getBoundingClientRect().bottom)})()');
      assert(gaps.length>=3 && gaps.every(gap=>Math.abs(gap-16)<1),JSON.stringify(gaps));
      await screenshot(operator+'-permissions-'+width+'-dark');
    }
    // Customer phone taps resolve the original update, never the permissions dialog.
    await client.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await client.send('Page.navigate',{url:base+'/apps/customer/home-page/main.html?notification=11'});
    await wait('location.pathname==="/apps/customer/home-page/main.html" && location.search==="?announcement=11" && document.readyState==="complete"');
    assert.equal(await evaluate('sessionStorage.getItem("fmrc_pwa_customer_notification")'),null);
    assert.equal(await evaluate('!!document.querySelector(".fmrc-permissions-dialog[open]")'),false);
    await navigate('/apps/team/test.html?notification=21');
    await evaluate('FMRCApp.consumeTeamNotification([{id:21,title:"Update",message:"Message"}],id=>{window.openedUpdate=id})');
    assert.equal(await evaluate('window.openedUpdate'),'21');
    assert.equal(await evaluate('!!document.querySelector("dialog[open]")'),false);
    // The gateways render no opening page. Team launches reuse the existing logo curtain.
    for (const operator of ['admin','staff']) {
      await evaluate(`localStorage.setItem('fmrc_pwa_team_role',${JSON.stringify(operator)})`);
      await client.send('Page.navigate',{url:base+'/apps/team/'});
      await wait(`location.pathname==='/apps/team/${operator}-page/dashboard.html' && !!document.querySelector('.fmrc-load-veil.is-on')`);
      assert.equal(await evaluate('document.querySelectorAll(".fmrc-load-veil.is-on,.fmrc-load-boot").length'),1);
      assert.equal(await evaluate('document.querySelector(".fmrc-load-caption").textContent'),'Preparing your experience');
      await evaluate('document.documentElement.dataset.theme="dark"');
      assert.equal(await evaluate('getComputedStyle(document.querySelector(".fmrc-load-veil")).backgroundColor'),'rgb(255, 253, 249)');
      await evaluate('new Promise(resolve=>{const image=new Image();image.onload=image.onerror=resolve;image.src="/images/FMRC%20Brand%20Logo.png"})');
      await screenshot(operator+'-app-launch-390');
      await wait('document.readyState==="complete" && !document.querySelector(".fmrc-load-veil.is-on")');
      await wait('!document.querySelector(".fmrc-app-entry-loader")');
    }
    await evaluate('localStorage.removeItem("admin_auth_token");localStorage.removeItem("staff_auth_token")');
    await client.send('Page.navigate',{url:base+'/apps/team/'});
    await wait('location.pathname==="/apps/team/admin-auth/auth.html" && !!document.querySelector(".fmrc-load-veil.is-on")');
    assert.equal(await evaluate('document.querySelectorAll(".fmrc-load-veil.is-on,.fmrc-load-boot").length'),1);
    assert.equal(await evaluate('document.querySelector(".fmrc-load-caption").textContent'),'Preparing your experience');
    await wait('getComputedStyle(document.querySelector(".fmrc-load-veil")).opacity==="1"');
    await screenshot('signed-out-team-app-launch-390');
    await client.send('Page.navigate',{url:base+'/apps/customer/'});
    await wait('location.pathname==="/apps/customer/home-page/main.html" && !!document.querySelector(".fmrc-load-boot")');
    assert.equal(await evaluate('document.querySelectorAll(".fmrc-load-boot,.fmrc-load-veil.is-on").length'),1);
    await screenshot('customer-app-launch-390');
    // A genuine browser close/reopen retains per-app install confirmation.
    await evaluate('for(const app of ["customer","team"]){localStorage.setItem(`fmrc_pwa_${app}_installed`,"1");localStorage.removeItem(`fmrc_pwa_${app}_installed_verified`)}');
    await evaluate('localStorage.setItem("admin_auth_token","8|admin");localStorage.setItem("staff_auth_token","9|staff")');
    const closed=new Promise(resolve=>browser.once('close',resolve));
    await client.send('Browser.close');await closed;client.close();
    ({browser,client}=await startBrowser(path.join(artifacts,'profile')));
    await client.send('Page.enable');await client.send('Network.enable');await client.send('Network.setBlockedURLs',{urls:['https://*']});
    await client.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await client.send('Network.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36'});
    await client.send('Page.addScriptToEvaluateOnNewDocument',{source:'Object.defineProperty(navigator,"getInstalledRelatedApps",{configurable:true,value:undefined});window.addEventListener("beforeinstallprompt",e=>{if(e.isTrusted){e.preventDefault();e.stopImmediatePropagation()}},true)'});
    for(const route of ['/home-page/main.html','/admin-page/settings.html','/staff-page/settings.html']) {
      await navigate(route);await wait('!!window.FMRCApp');
      assert.equal(await evaluate('localStorage.getItem("fmrc_pwa_customer_installed")'),'1');
      assert.equal(await evaluate('localStorage.getItem("fmrc_pwa_team_installed")'),'1');
      assert.equal(await evaluate('!!document.querySelector(".fmrc-install-button:not([hidden]),.fmrc-settings-install:not([hidden])")'),false);
    }
    console.log('Browser artifacts: '+artifacts);
  } finally { client?.close();browser?.kill();server.close(); }
});
