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
test('two app shells retain navigation, device isolation, explicit permission, offline Retry, and phone layouts', { skip: !chrome, timeout: 120000 }, async () => {
  const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'fmrc-pwa-'));
  let offlineNavigation = false, devices = {}, lastPost, reads = new Set();
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    if (offlineNavigation && u.pathname === '/apps/customer/about-page/about.html') { req.socket.destroy(); return; }
    if (u.pathname.startsWith('/api/')) {
      let chunks = ''; for await (const part of req) chunks += part;
      const body = chunks ? JSON.parse(chunks) : {}; res.setHeader('Content-Type', 'application/json');
      let data = { data: [], unread_count: 0 };
      if (u.pathname === '/api/pwa/config') data = { push_available: true, inbox_available: true, public_key: 'B' + 'a'.repeat(86) };
      if (u.pathname === '/api/pwa/subscriptions' && req.method === 'POST') { lastPost = body; const id = body.app === 'team' ? 2 : 1; devices[id] = { id, credential: 'a'.repeat(64), user_id: req.headers.authorization ? (body.app === 'team' ? 8 : 7) : null, public_alerts: body.public_alerts, account_alerts: body.account_alerts }; data = devices[id]; }
      const device = u.pathname.match(/\/pwa\/subscriptions\/(\d+)/);
      if (device) { const id = +device[1]; if (!devices[id]) { res.statusCode = 404; data = {}; } else if (req.method === 'DELETE') { delete devices[id]; data = { removed: true }; } else { if (body.detach) { devices[id].user_id = null; devices[id].account_alerts = false; } else Object.assign(devices[id], body); data = devices[id]; } }
      if (u.pathname === '/api/customer/notifications') data = { data: [{ id: 11, title: 'New FMRC announcement', type: 'announcement', message: 'A public update for everyone.', target: '/home-page/main.html', published_at: '2026-10-05 10:00:00', read_at: reads.has(11) ? 'read' : null }], next_page_url: null };
      if (u.pathname.endsWith('/11/read')) { reads.add(11); data = { read: true }; }
      if (u.pathname.endsWith('/unread-count')) data = { unread_count: reads.has(11) || Number(u.searchParams.get('after')) >= 11 || (u.searchParams.get('read_ids') || '').split(',').includes('11') ? 0 : 1 };
      if (u.pathname === '/api/admin/session') data = { server_time: new Date().toISOString(), idle_warning_at: new Date(Date.now()+3600000).toISOString(), idle_expires_at: new Date(Date.now()+3780000).toISOString(), absolute_expires_at: new Date(Date.now()+21600000).toISOString() };
      if (u.pathname === '/api/user') data = { id: 8, name: 'Operator', role: String(req.headers.authorization).includes('staff') ? 'staff' : 'admin' };
      res.end(JSON.stringify(data)); return;
    }
    let relative = decodeURIComponent(u.pathname).replace(/^\//, '');
    const namespace = relative.match(/^apps\/(customer|team)\/(.*)$/);
    if (namespace && /^(home-page|about-page|services-page|products-page|contact-page|customer-auth|admin-auth|admin-page|staff-page)\//.test(namespace[2])) relative = namespace[2];
    if (u.pathname.endsWith('/test.html')) {
      res.setHeader('Content-Type', 'text/html'); const app = u.pathname.includes('/team/') ? 'team' : 'customer';
      res.end(`<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script>window.APP_API_BASE_URL=location.origin+'/api';</script><link rel="stylesheet" href="/apps/shared/pwa.css"><script src="/apps/shared/pwa.js"></script></head><body style="font-family:Arial"><header class="header-right-actions"></header><aside class="mobile-sidebar"><footer class="sidebar-footer-actions"></footer></aside><aside><footer class="sidebar-footer"></footer></aside><main><a id="internal" href="/${app === 'team' ? 'admin-page/dashboard' : 'about-page/about'}.html">Next page</a><a id="api" href="/api/customer/orders">API</a><a id="external" href="https://example.com">External</a></main></body></html>`); return;
    }
    let file = path.join(root, relative); if (!path.extname(file)) file += '.html'; if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; res.end(); return; }
    const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' }; res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    let content = fs.readFileSync(file); if (file.endsWith('.html')) content = content.toString().replace('<head>', `<head><script>window.APP_API_BASE_URL=location.origin+'/api';</script>`); res.end(content);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  const browser = spawn(chrome, ['--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${path.join(artifacts,'profile')}`,'about:blank'], { windowsHide: true, stdio: ['ignore','ignore','pipe'] });
  let client;
  try {
    const endpoint = await new Promise((resolve,reject) => { let log=''; const timer=setTimeout(()=>reject(Error('Browser startup timeout')),15000); browser.stderr.on('data',data=>{log+=data; const m=log.match(/DevTools listening on (ws:\/\/\S+)/); if(m){clearTimeout(timer);resolve(m[1]);}});browser.on('error',reject); });
    const tabs=await(await fetch(`http://127.0.0.1:${new URL(endpoint).port}/json/list`)).json(); client=await connect(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
    await client.send('Page.enable');await client.send('Network.enable');await client.send('Network.setBlockedURLs',{urls:['https://*']});
    await client.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    const evaluate=async expression=>{const r=await client.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
    const wait=async expression=>{for(let i=0;i<150;i++){if(await evaluate(expression))return;await pause(40);}throw Error('Timeout: '+expression);};
    const navigate=async route=>{await client.send('Page.navigate',{url:base+route});await wait(`location.pathname===${JSON.stringify(route)}&&document.readyState==='complete'`);};
    const screenshot=async name=>{const r=await client.send('Page.captureScreenshot',{captureBeyondViewport:true});fs.writeFileSync(path.join(artifacts,name+'.png'),Buffer.from(r.data,'base64'));};
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
    await evaluate('document.querySelector("dialog").close();FMRCApp.openInbox()');await wait('!!document.querySelector(".fmrc-inbox-item")');await screenshot('customer-inbox-390');
    const cardBorders = await evaluate('(()=>{const s=getComputedStyle(document.querySelector(".fmrc-inbox-item"));return [s.borderLeftWidth,s.borderRightWidth,s.borderLeftColor,s.borderRightColor]})()');
    assert.equal(cardBorders[0],cardBorders[1]);assert.equal(cardBorders[2],cardBorders[3]);
    const hover = await evaluate('(()=>{const r=document.querySelector(".fmrc-inbox-item .fmrc-app-button").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');await client.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:hover.x,y:hover.y});
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".fmrc-inbox-item .fmrc-app-button")).transform'),'none');
    assert.equal(await evaluate('document.querySelector(".fmrc-phone-controls .fmrc-app-button").disabled'),true);
    await client.send('Network.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36'});
    await navigate('/apps/customer/test.html');await evaluate('FMRCApp.openInbox()');await wait('!!document.querySelector(".fmrc-inbox-item")');
    await evaluate(`Notification.requestPermission=async()=>{window.permissionCount=(window.permissionCount||0)+1;return 'denied'};`);
    assert.equal(await evaluate('window.permissionCount||0'),0);
    await evaluate('document.querySelector(".fmrc-phone-controls .fmrc-app-button").click()');await wait('window.permissionCount===1');
    await wait('document.querySelector(".fmrc-app-status").textContent.includes("not enabled")');
    await evaluate(`Notification.requestPermission=async()=>{window.permissionCount++;return 'granted'};PushManager.prototype.getSubscription=async()=>null;PushManager.prototype.subscribe=async()=>({toJSON:()=>({endpoint:'https://fcm.googleapis.com/fcm/send/test',keys:{p256dh:'test',auth:'test'}}),unsubscribe:async()=>true});localStorage.setItem('customer_token','7|customer');`);
    await evaluate('document.querySelector(".fmrc-phone-controls .fmrc-app-button").click()');await wait('!!localStorage.getItem("fmrc_pwa_customer_device")');assert.equal(lastPost.app,'customer');
    await evaluate('FMRCApp.logout()');assert.equal(devices[1].user_id,null);assert.equal(devices[1].public_alerts,true);
    await navigate('/apps/team/test.html');await wait('!!document.querySelector(".sidebar-footer .fmrc-install-button")');
    assert.equal(await evaluate('document.getElementById("internal").pathname'),'/apps/team/admin-page/dashboard.html');
    await wait('(async()=> (await navigator.serviceWorker.getRegistrations()).length===2)()');
    const scopes=await evaluate('(async()=> (await navigator.serviceWorker.getRegistrations()).map(r=>new URL(r.scope).pathname).sort())()');assert.deepEqual(scopes,['/apps/customer/','/apps/team/']);
    await evaluate(`localStorage.setItem('staff_auth_token','8|staff');localStorage.setItem('staff_user_info',JSON.stringify({id:8,name:'Staff',role:'staff'}));localStorage.setItem('fmrc_pwa_team_role','staff')`);
    await navigate('/apps/team/staff-page/settings.html');await wait('!!document.querySelector(".fmrc-phone-controls")');await pause(1800);await evaluate('document.querySelector(".fmrc-phone-controls").scrollIntoView({block:"center"})');await screenshot('staff-settings-390');
    assert.equal(await evaluate('!!document.querySelector(".fmrc-settings-install")'),true);
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
    await navigate('/apps/team/admin-page/settings.html');await wait('!!document.querySelector(".fmrc-settings-install")');
    await navigate('/apps/customer/home-page/main.html');await wait('!!document.querySelector(".mobile-sidebar .fmrc-app-inbox-button")');await wait('!!document.querySelector(".mobile-sidebar .fmrc-install-button")');await wait('!!document.getElementById("announcementModal")');await pause(1600);
    assert.equal(await evaluate('!!document.querySelector("#announcementBell.announcement-bell .fa-bell")'),true);
    await evaluate('document.getElementById("announcementBell").click()');await wait('document.getElementById("announcementModal").hidden===false');
    assert.equal(await evaluate('!!document.querySelector(".fmrc-phone-controls")'),false);
    await evaluate('document.getElementById("announcementModalCloseX").click();document.getElementById("mobileMenuToggle").click()');await screenshot('customer-sidebar-390');
    await evaluate('document.querySelector(".mobile-sidebar .fmrc-app-inbox-button").click()');await wait('!!document.querySelector("dialog.fmrc-inbox-dialog[open]")');
    assert.equal(await evaluate('document.querySelector(".mobile-sidebar").classList.contains("open")'),false);
    assert.equal(await evaluate('!!document.querySelector("dialog .fmrc-phone-controls")'),true);await screenshot('customer-app-notifications-390');
    await evaluate('document.querySelector("dialog").close()');
    const cached=await evaluate('(async()=> {const result={};for(const name of await caches.keys()){const cache=await caches.open(name);result[name]=(await cache.keys()).map(r=>new URL(r.url).pathname)}return result})()');
    assert.equal(Object.keys(cached).length,2);for(const assets of Object.values(cached))assert.equal(assets.length,3);
    offlineNavigation = true;
    await client.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
    await navigate('/apps/customer/about-page/about.html');await wait('document.querySelector("h1")?.textContent==="You\'re offline"');await screenshot('offline-390');
    offlineNavigation = false;
    await client.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});await evaluate('document.querySelector("button").click()');await wait('!!document.querySelector(".fmrc-app-inbox-button")');
    console.log('Browser artifacts: '+artifacts);
  } finally { client?.close();browser.kill();server.close(); }
});
