/* Real Chrome rendering with isolated API fixtures; never contacts production. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));

async function connect(url) {
  const socket = new WebSocket(url), pending = new Map(); let id = 0;
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = ({ data }) => { const r = JSON.parse(data), job = pending.get(r.id); if (!job) return; pending.delete(r.id); r.error ? job.reject(Error(JSON.stringify(r.error))) : job.resolve(r.result); };
  return { send(method, params = {}) { return new Promise((resolve, reject) => { const call = ++id; const timer = setTimeout(() => { pending.delete(call); reject(Error(`CDP timeout: ${method}`)); },15000); pending.set(call, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } }); socket.send(JSON.stringify({ id:call, method, params })); }); }, close() { socket.close(); } };
}

test('all portal pages render both themes; account-scoped settings synchronize live, survive navigation, and leave authentication light', { skip: !chrome, timeout: 300000 }, async () => {
  const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'fmrc-portal-theme-'));
  const prefs = new Map([[11, { theme: 'dark', compact: false, reducedMotion: false }], [22, { theme: 'light', compact: false, reducedMotion: false }]]);
  let writes = 0;
  const server = http.createServer(async (req, res) => {
    const route = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const owner = Number(String(req.headers.authorization || '').split('-').at(-1)) || 11;
    if (route.startsWith('/api/')) {
      let data = { data: [] };
      if (route === '/api/admin/preferences') {
        if (req.method === 'PUT') { let body = ''; for await (const chunk of req) body += chunk; prefs.set(owner, JSON.parse(body)); writes++; }
        data = { user_id: owner, preferences: prefs.get(owner) || { theme: 'light', compact: false, reducedMotion: false } };
      } else if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
      else if (route === '/api/user') data = { id: owner, role: owner === 11 ? 'admin' : 'staff', email: `${owner}@example.test`, name: 'Fixture user' };
      else if (route === '/api/admin/session') data = { server_time: new Date().toISOString(), idle_warning_at: new Date(Date.now()+3600000).toISOString(), idle_expires_at: new Date(Date.now()+3780000).toISOString(), absolute_expires_at: new Date(Date.now()+21600000).toISOString() };
      else if (route === '/api/site-favicon') data = { favicon_image: '' };
      else if (route === '/api/site-settings') data = { data: {} };
      else if (route.startsWith('/api/admin/product-analytics/product-performance')) data = { data: Array.from({length:23},(_,i)=>({product_code:`P-${i+1}`,product_name:`Fixture product ${i+1}`,category:'Fabrication',total_sold:10+i,total_revenue:1000+i*10,status:'High',status_class:'high'})) };
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); return;
    }
    const file = path.resolve(root, '.' + route);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', ({ '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
    let content = fs.readFileSync(file);
    if (/\/(admin|staff)-page\/.*\.html$/.test(route) && !route.endsWith('maintenance-preview.html')) {
      content = content.toString().replace('<head>', `<head><script>window.APP_API_BASE_URL=location.origin+'/api';for(const [role,id]of[['admin',11],['staff',22]]){if(!localStorage.getItem(role+'_user_info'))localStorage.setItem(role+'_user_info',JSON.stringify({id,role,email:id+'@example.test'}));if(!localStorage.getItem(role+'_auth_token'))localStorage.setItem(role+'_auth_token','fixture-'+id);}</script>`);
    }
    res.end(content);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--run-all-compositor-stages-before-draw', '--remote-debugging-port=0', `--user-data-dir=${path.join(artifacts, 'profile')}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let controller, main, second;
  try {
    const endpoint = await new Promise((resolve, reject) => { let log = ''; const timer = setTimeout(() => reject(Error('Browser startup timeout ' + log)), 15000); browser.stderr.on('data', chunk => { log += chunk; const found = log.match(/DevTools listening on (ws:\/\/\S+)/); if (found) { clearTimeout(timer); resolve(found[1]); } }); browser.on('error', reject); });
    controller = await connect(endpoint);
    const tabs = await (await fetch(`http://127.0.0.1:${new URL(endpoint).port}/json/list`)).json();
    main = await connect(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
    async function prepare(cdp) { await cdp.send('Page.enable'); await cdp.send('Network.enable'); await cdp.send('Network.setBlockedURLs', { urls: ['https://*'] }); }
    await prepare(main);
    const evaluate = async (expression, cdp = main) => { const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
    const wait = async (expression, cdp = main) => { for (let i=0; i<150; i++) { if (await evaluate(expression, cdp)) return; await new Promise(resolve => setTimeout(resolve, 40)); } throw Error('Timed out: ' + expression + ' State: ' + JSON.stringify(await evaluate('({page:location.pathname,theme:document.documentElement.dataset.theme,preferences:{...window.AdminPreferences?.get(),sidebarLogo:!!window.AdminPreferences?.get().sidebarLogo},status:document.getElementById("settingsSaveStatus")?.textContent})',cdp))); };
    const navigate = async (route, cdp = main) => { await cdp.send('Page.navigate', { url: base + route }); await wait(`location.pathname === ${JSON.stringify(route)} && document.readyState === "complete"`, cdp); };
    const viewport = (width, height) => main.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    const settled = () => wait(`!document.querySelector('.fmrc-load-veil.is-on') && !document.querySelector('.admin-global-page-skeleton') && (!document.querySelector('.fmrc-load-veil') || getComputedStyle(document.querySelector('.fmrc-load-veil')).visibility === 'hidden')`);
    const shot = async (name, loading = false) => { await main.send('Page.bringToFront'); if (!loading) await settled(); const result = await main.send('Page.captureScreenshot', { format:'png',fromSurface:true }); fs.writeFileSync(path.join(artifacts, name + '.png'), Buffer.from(result.data, 'base64')); };
    const box = selector => evaluate(`(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    const dragEdge = async delta => {
      await wait('Math.abs(document.querySelector(".sidebar").getBoundingClientRect().width-window.AdminPreferences.get().sidebarWidth)<1');
      const point = await box('.portal-sidebar-edge');
      await main.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
      await main.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});
      await main.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x+delta,y:point.y,button:'left',buttons:1});
      await main.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x+delta,y:point.y,button:'left',buttons:0,clickCount:1});
    };
    const key = async value => { const virtual = {Escape:27,Home:36,End:35,ArrowLeft:37,ArrowRight:39}[value]; await main.send('Input.dispatchKeyEvent',{type:'keyDown',key:value,code:value,windowsVirtualKeyCode:virtual,nativeVirtualKeyCode:virtual}); await main.send('Input.dispatchKeyEvent',{type:'keyUp',key:value,code:value,windowsVirtualKeyCode:virtual,nativeVirtualKeyCode:virtual}); };
    const uploadLogo = async () => {
      await evaluate('document.getElementById("sidebarLogoInput").value=""');
      const {root:dom} = await main.send('DOM.getDocument');
      const {nodeId} = await main.send('DOM.querySelector',{nodeId:dom.nodeId,selector:'#sidebarLogoInput'});
      await main.send('DOM.setFileInputFiles',{nodeId,files:[path.join(root,'images','FMRC Brand Logo.png')]});
      await wait('document.getElementById("sidebarLogoDialog").open');
    };
    await viewport(1440, 1000); await navigate('/admin-page/settings.html');
    await wait('document.documentElement.dataset.theme === "dark" && document.getElementById("settingsSaveStatus").textContent.startsWith("Saved to")');
    assert.equal(await evaluate('document.querySelector(".settings-brand-preview")'),null,'the Settings live preview was removed');
    await evaluate('document.querySelector(".sidebar .dropdown-toggle").click()');
    const leftScrollbar = await evaluate('(() => {const n=document.querySelector(".sidebar-nav"),link=n.querySelector(".nav-link");return {direction:getComputedStyle(n).direction,linkDirection:getComputedStyle(link).direction,leftInset:n.clientLeft,overflow:n.scrollHeight>n.clientHeight};})()');
    assert.equal(leftScrollbar.direction,'rtl'); assert.equal(leftScrollbar.linkDirection,'ltr');
    assert.equal(leftScrollbar.overflow,true); assert(leftScrollbar.leftInset>0,'native scrollbar occupies the left edge');
    await evaluate('document.querySelector(".sidebar-nav").scrollTop=100'); assert(await evaluate('document.querySelector(".sidebar-nav").scrollTop')>0);
    await evaluate('document.querySelector(".sidebar-nav").scrollTop=0');
    await shot('settings-admin-dark-desktop');
    await evaluate('document.querySelector(".user-profile").click()');
    await wait('document.getElementById("profilePopup").classList.contains("show")');
    await wait('getComputedStyle(document.getElementById("profilePopup")).opacity === "1"');
    assert.equal(await evaluate('[...document.querySelectorAll(".profile-popup-link")].every(el=>getComputedStyle(el).borderLeftWidth==="0px" && getComputedStyle(el).borderRightWidth==="0px" && getComputedStyle(el).boxShadow==="none")'),true,'account menu rows have no outlined edges');
    assert.match(await evaluate('getComputedStyle(document.querySelector(".admin-dashboard-icon"),"::before").maskImage'),/dashboard\.svg/);
    await shot('settings-account-menu-dark');
    await evaluate('document.querySelector(".user-profile").click()');
    assert.equal(await evaluate('document.querySelectorAll(".dark-mode-toggle,.profile-dark-mode-row,.auth-dark-mode-toggle").length'), 0);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    await viewport(390,844); await wait('!document.body.classList.contains("admin-sidebar-open") && document.querySelector(".sidebar").getBoundingClientRect().right <= 1'); await shot('settings-admin-dark-mobile');
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'mobile settings fit');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".portal-sidebar-edge")).display'), 'none');
    assert.equal(await evaluate('document.getElementById("settingSidebarWidth").disabled'),true);
    await evaluate('document.querySelector(".admin-sidebar-toggle").click()');
    await wait('document.body.classList.contains("admin-sidebar-open") && !document.querySelector(".sidebar").inert');
    await key('Escape'); await wait('!document.body.classList.contains("admin-sidebar-open")');
    await viewport(900,1000);
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".portal-sidebar-edge")).display'), 'none','tablet keeps automatic navigation');
    await viewport(1440,1000);
    const { targetId } = await controller.send('Target.createTarget', { url: base + '/admin-page/my-account.html' });
    const tabList = await (await fetch(`http://127.0.0.1:${new URL(endpoint).port}/json/list`)).json();
    second = await connect(tabList.find(t => t.id === targetId).webSocketDebuggerUrl); await prepare(second);
    await wait('window.AdminPreferences && document.documentElement.dataset.theme === "dark"', second);
    await dragEdge(-210);
    await wait('window.AdminPreferences.get().sidebarWidth === 76 && Math.abs(document.querySelector(".sidebar").getBoundingClientRect().width-76)<1');
    await wait('window.AdminPreferences.get().sidebarWidth === 76',second);
    assert.equal(await evaluate('Number.parseFloat(getComputedStyle(document.querySelector(".main-content")).marginLeft)'),76);
    assert.equal(await evaluate('document.querySelector(".top-header").getBoundingClientRect().left'),76);
    assert.equal(await evaluate('[...document.querySelectorAll(".sidebar .nav-link")].every(el=>el.getAttribute("aria-label"))'),true);
    await shot('sidebar-admin-dark-collapsed');
    await dragEdge(0); await wait('window.AdminPreferences.get().sidebarWidth === 270');
    await dragEdge(150); assert.equal(await evaluate('window.AdminPreferences.get().sidebarWidth'),270,'cannot exceed the original width');
    await dragEdge(-50); await wait('window.AdminPreferences.get().sidebarWidth === 220');
    await evaluate('document.querySelector(".portal-sidebar-edge").focus()');
    await key('Home'); await wait('window.AdminPreferences.get().sidebarWidth === 76');
    await evaluate('document.querySelector(".sidebar .dropdown-toggle").click()');
    await wait('window.AdminPreferences.get().sidebarWidth === 220 && document.querySelector(".sidebar .has-dropdown").classList.contains("open")');
    await evaluate('document.querySelector(".portal-sidebar-edge").focus()'); await key('End'); await wait('window.AdminPreferences.get().sidebarWidth === 270');
    const point = await box('.portal-sidebar-edge');
    await main.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});
    await main.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x-100,y:point.y,button:'left',buttons:1});
    await key('Escape');
    await main.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x-100,y:point.y,button:'left',buttons:0,clickCount:1});
    assert.equal(await evaluate('window.AdminPreferences.get().sidebarWidth'),270,'cancelled dragging does not save');
    await evaluate('document.getElementById("settingSidebarWidth").value=220;document.getElementById("settingSidebarWidth").dispatchEvent(new Event("input"));document.getElementById("settingSidebarWidth").dispatchEvent(new Event("change"))');
    await wait('window.AdminPreferences.get().sidebarWidth === 220',second);
    await viewport(900,1000); await wait('document.getElementById("settingSidebarWidth").disabled');
    await wait('Math.abs(document.querySelector(".sidebar").getBoundingClientRect().width-76)<1');
    await viewport(390,844); assert.equal(await evaluate('getComputedStyle(document.querySelector(".portal-sidebar-edge")).display'),'none');
    assert.equal(await evaluate('window.AdminPreferences.get().sidebarWidth'),220,'automatic small-screen layout preserves desktop width');
    await viewport(1025,1000); await wait('Math.abs(document.querySelector(".sidebar").getBoundingClientRect().width-220)<1');
    await shot('sidebar-admin-dark-laptop-220');
    await viewport(1440,1000);
    await evaluate('document.getElementById("settingSidebarLabel").value="Fabrication Lab";document.getElementById("settingSidebarLabel").dispatchEvent(new Event("input",{bubbles:true}));document.getElementById("settingSidebarLabel").blur()');
    await wait('document.querySelector(".sidebar-header h2").textContent === "Fabrication Lab"',second);
    await uploadLogo(); await shot('sidebar-logo-editor-dark');
    await evaluate('document.getElementById("sidebarLogoCancel").click()');
    assert.equal(await evaluate('window.AdminPreferences.get().sidebarLogo'),'','cancelling leaves the existing logo');
    await uploadLogo();
    await evaluate('document.getElementById("sidebarLogoZoom").value=125;document.getElementById("sidebarLogoZoom").dispatchEvent(new Event("input"));document.getElementById("sidebarLogoRotate").value=15;document.getElementById("sidebarLogoRotate").dispatchEvent(new Event("input"))');
    assert.equal(await evaluate('document.getElementById("sidebarLogoZoomValue").textContent'),'125%');
    const beforeMove = await evaluate('document.getElementById("sidebarLogoCanvas").toDataURL()');
    const canvasPoint = await box('#sidebarLogoCanvas');
    await main.send('Input.dispatchMouseEvent',{type:'mousePressed',...canvasPoint,button:'left',buttons:1,clickCount:1});
    await main.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:canvasPoint.x+20,y:canvasPoint.y+10,button:'left',buttons:1});
    await main.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:canvasPoint.x+20,y:canvasPoint.y+10,button:'left',buttons:0,clickCount:1});
    assert.notEqual(await evaluate('document.getElementById("sidebarLogoCanvas").toDataURL()'),beforeMove,'dragging moves the artwork');
    await evaluate('document.getElementById("sidebarLogoFit").click();document.getElementById("sidebarLogoApply").click()');
    await wait('window.AdminPreferences.get().sidebarLogo.startsWith("data:image/png;base64,")',second);
    assert.equal(await evaluate('document.querySelector(".sidebar-header .logo").getAttribute("src") === window.AdminPreferences.get().sidebarLogo',second),true);
    assert.equal(await evaluate('document.getElementById("sidebarLogoCanvas").getContext("2d").getImageData(0,0,1,1).data[3]'),0,'export preserves the circular transparent corners');
    await evaluate('document.getElementById("sidebarLogoAdjust").click()'); await wait('document.getElementById("sidebarLogoDialog").open'); await key('Escape');
    await wait('!document.getElementById("sidebarLogoDialog").open');
    await evaluate('document.querySelector(".settings-workspace-grid").scrollIntoView({block:"center"})'); await shot('settings-branding-admin-dark');
    await evaluate('document.querySelector("[name=portalTheme][value=light]").click()');
    await wait('document.documentElement.dataset.theme === "light"', second);
    await wait('document.getElementById("settingsSaveStatus").textContent.startsWith("Saved to")');
    await shot('settings-admin-light-desktop');
    await evaluate('document.querySelector(".settings-workspace-grid").scrollIntoView({block:"center"})'); await shot('settings-branding-admin-light');
    await evaluate('document.querySelector("[name=portalTheme][value=dark]").click();document.getElementById("settingCompactTables").click();document.getElementById("settingReducedMotion").click()');
    await wait('document.documentElement.dataset.tableDensity === "compact" && document.documentElement.dataset.portalMotion === "reduced"', second);
    await navigate('/admin-page/products.html',second);
    await wait('document.getElementById("productPerformanceCard")',second);
    assert.equal(await evaluate('getComputedStyle(document.getElementById("productPerformanceCard")).opacity',second),'1','reduced motion keeps analytics visible');
    await wait('document.getElementById("settingsSaveStatus").textContent.startsWith("Saved to")');
    assert.equal(prefs.get(11).theme, 'dark'); assert.equal(prefs.get(22).theme, 'light');
    await navigate('/staff-page/settings.html'); await wait('document.documentElement.dataset.theme === "light"');
    assert.equal(await evaluate('document.getElementById("settingCompactTables").checked'), false, 'Staff never inherits Admin density');
    assert.equal(await evaluate('document.querySelector(".sidebar-header h2").textContent'),'UCN-FMRC','Staff never inherits Admin branding');
    assert.equal(await evaluate('window.AdminPreferences.get().sidebarLogo'),'');
    await evaluate('document.getElementById("settingSidebarLabel").value="W".repeat(25);document.getElementById("settingSidebarLabel").dispatchEvent(new Event("input",{bubbles:true}));document.getElementById("settingSidebarLabel").blur()');
    assert.equal(await evaluate('document.getElementById("settingSidebarLabel").value.length'),18,'title is limited without breaking layout');
    await evaluate('document.getElementById("sidebarBrandDefault").click()');
    await shot('settings-staff-light-desktop');
    await viewport(390,844); await wait('!document.body.classList.contains("admin-sidebar-open") && document.querySelector(".sidebar").getBoundingClientRect().right <= 1');
    await evaluate('document.querySelector(".settings-workspace-grid").scrollIntoView({block:"start"})'); await shot('settings-branding-staff-light-mobile');
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'),true,'mobile branding controls fit');
    await uploadLogo(); await shot('sidebar-logo-editor-light-mobile');
    assert.equal(await evaluate('document.getElementById("sidebarLogoDialog").getBoundingClientRect().width < innerWidth'),true);
    assert.equal(await evaluate('(() => {const r=document.getElementById("sidebarLogoCanvas").getBoundingClientRect();return Math.abs(r.width-r.height)<1;})()'),true,'mobile logo preview stays circular');
    await evaluate('document.getElementById("sidebarLogoCancel").click()'); await viewport(1440,1000);
    // A second Staff account gets its own defaults even on the same browser.
    await uploadLogo();
    await evaluate('localStorage.setItem("staff_user_info",JSON.stringify({id:33,role:"staff",email:"33@example.test"}));localStorage.setItem("staff_auth_token","fixture-33");window.dispatchEvent(new CustomEvent("admin:session-updated"))');
    await wait('window.AdminPreferences.get().theme === "light"');
    await main.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});
    assert.equal(await evaluate('document.documentElement.dataset.theme'),'light','new Staff account starts Light on a Dark device');
    assert.equal(await evaluate('document.querySelector("[name=portalTheme][value=light]").checked'),true);
    await main.send('Emulation.setEmulatedMedia',{features:[]});
    assert.equal(await evaluate('document.getElementById("sidebarLogoDialog").open'),false,'account changes cancel unfinished logo edits');
    await evaluate('document.querySelector("[name=portalTheme][value=dark]").click()');
    await wait('document.getElementById("settingsSaveStatus").textContent.startsWith("Saved to")');
    assert.equal(prefs.get(33).theme, 'dark'); assert.equal(prefs.get(22).theme, 'light');
    await evaluate('document.getElementById("settingsResetBtn").click()');
    await wait('window.AdminPreferences.get().theme === "light" && document.getElementById("settingsSaveStatus").textContent.startsWith("Saved to")');
    await evaluate('document.getElementById("settingSidebarLabel").focus();document.getElementById("settingSidebarLabel").value="Second Staff";document.getElementById("settingSidebarLabel").dispatchEvent(new Event("input",{bubbles:true}))');
    await evaluate('localStorage.setItem("staff_user_info",JSON.stringify({id:22,role:"staff",email:"22@example.test"}));localStorage.setItem("staff_auth_token","fixture-22");window.dispatchEvent(new CustomEvent("admin:session-updated"))');
    await wait('window.AdminPreferences.get().theme === "light"');
    assert.equal(await evaluate('document.getElementById("settingSidebarLabel").value'),'UCN-FMRC','account changes also replace a focused title field');
    second.close(); second = null; await controller.send('Target.closeTarget', { targetId });
    if (process.env.FMRC_WORKSPACE_QA) { console.log(JSON.stringify({workspaceChecks:'passed',artifacts})); return; }
    const measurements = [], brightSurfaces = [];
    for (const folder of ['admin-page','staff-page']) {
      const account = folder === 'admin-page' ? 11 : 22;
      for (const theme of ['dark','light']) {
        prefs.set(account, { theme, compact:false, reducedMotion:false });
        await evaluate(`localStorage.setItem('fmrc-portal-preferences:user:${account}',JSON.stringify(${JSON.stringify(prefs.get(account))}))`);
        for (const file of fs.readdirSync(path.join(root,folder)).filter(f => f.endsWith('.html') && f !== 'maintenance-preview.html')) {
          if (process.env.FMRC_THEME_DEBUG) console.log(`Rendering ${folder}/${file} ${theme}`);
          await navigate(`/${folder}/${file}`);
          await wait(`document.documentElement.dataset.theme === '${theme}'`);
          await settled();
          const report = await evaluate(`(() => { const selectors=['body','.sidebar','.top-header','.panel','.account-summary-card','.account-form-card','.modal-card','.wm-section','.settings-section','.admin-global-skeleton-card'];return selectors.flatMap(selector=>[...document.querySelectorAll(selector)].slice(0,3).map(el=>{const s=getComputedStyle(el);return {selector,background:s.backgroundColor,color:s.color}})); })()`);
          report.forEach(item => { const rgb = item.background.match(/[\d.]+/g)?.map(Number); if (!rgb || rgb[3] === 0) return; const mean = (rgb[0]+rgb[1]+rgb[2])/3; assert(theme === 'dark' ? mean < 90 : mean > 180, `${folder}/${file} ${theme} ${item.selector}: ${item.background}`); });
          measurements.push({ page:`${folder}/${file}`,theme,surfaces:report });
          assert.equal(await evaluate('getComputedStyle(document.querySelector(".sidebar-nav")).direction'),'rtl',`${folder}/${file}: scrolling is on the left`);
          assert.equal(await evaluate('getComputedStyle(document.querySelector(".sidebar-nav .nav-link")).direction'),'ltr',`${folder}/${file}: menu content keeps its order`);
          assert.equal(await evaluate('[document.querySelector(".sidebar-nav"),document.getElementById("profilePopup")].every(menu=>{const links=[...menu.querySelectorAll("a")];return links.findIndex(el=>el.getAttribute("href")==="my-account.html")<links.findIndex(el=>el.getAttribute("href")==="settings.html");})'),true,`${folder}/${file}: account precedes settings in both menus`);
          if (theme === 'dark') {
            await evaluate('window.AdminPreferences.set({sidebarWidth:76})');
            await wait('Math.abs(document.querySelector(".sidebar").getBoundingClientRect().width-76)<1 && Math.abs(document.querySelector(".top-header").getBoundingClientRect().left-76)<1');
            assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'),true,`${folder}/${file}: icon rail fits`);
            await evaluate('window.AdminPreferences.set({sidebarWidth:270})');
            await wait('Math.abs(document.querySelector(".sidebar").getBoundingClientRect().width-270)<1');
            await wait('JSON.parse(localStorage.getItem("fmrc-portal-preferences:user:"+(location.pathname.includes("staff-page")?22:11)))._pending === false');
          }
          if (theme === 'dark') {
            const bright = await evaluate(`(() => [...document.querySelectorAll('body *')].filter(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el),c=s.backgroundColor.match(/[\\d.]+/g)?.map(Number);return r.width*r.height>6000 && r.width>90 && r.height>35 && r.top<innerHeight && r.bottom>0 && s.visibility!=='hidden' && s.display!=='none' && c && c[3]!==0 && (c[0]+c[1]+c[2])/3>190 && !el.closest('.theme-preview,.official-report-page,.portal-preview,.portal-layout-mini,.wm-hero-scene-preview,#themePromoCardPreview,.fmrc-announcement-preview-stage,.mt-preview-frame')}).map(el=>({tag:el.tagName,id:el.id,classes:el.className,background:getComputedStyle(el).backgroundColor})))()`);
            if (bright.length) brightSurfaces.push({ page:`${folder}/${file}`,elements:bright });
          }
          if (theme === 'dark' && ['my-account.html','products.html','website-home.html','orders.html','reports.html'].includes(file) && folder === 'admin-page') await shot(file.replace('.html','')+'-dark');
        }
      }
    }
    // The actual renderer must keep pagination anchored for long and short pages.
    for (const folder of ['admin-page','staff-page']) for (const width of [1440,390]) {
      await viewport(width,1000); await navigate(`/${folder}/products.html`); await settled();
      await wait('document.getElementById("productPerformanceFooter")?.style.display === "flex"');
      const geometry = `(() => {const footer=document.getElementById('productPerformanceFooter'),card=document.getElementById('productPerformanceCard'),r=footer.getBoundingClientRect(),c=card.getBoundingClientRect();return {top:r.top-c.top,bottom:c.bottom-r.bottom,parent:footer.parentElement.id};})()`;
      const before = await evaluate(geometry);
      assert.equal(before.parent,'productPerformanceCard');
      assert(before.bottom >= 0 && before.bottom < 45, `${folder} ${width}: pagination sits above only the caption`);
      await evaluate('document.getElementById("productPerformancePage").value="3";document.getElementById("productPerformancePage").dispatchEvent(new Event("change",{bubbles:true}))');
      await wait('document.getElementById("productPerformanceMeta").textContent.includes("21-23")');
      const after = await evaluate(geometry);
      assert(Math.abs(before.bottom-after.bottom)<1,`${folder} ${width}: short-page footer stays at the card edge`);
      const beforeScroll = await evaluate('document.getElementById("productPerformanceFooter").getBoundingClientRect().top');
      await evaluate('document.getElementById("productPerformanceTableWrapper").scrollTop=100');
      const afterScroll = await evaluate('document.getElementById("productPerformanceFooter").getBoundingClientRect().top');
      assert(Math.abs(beforeScroll-afterScroll)<1,'scrolling records cannot move pagination');
      await evaluate('document.getElementById("productPerformanceCard").scrollIntoView({block:"center"})');
      await shot(`${folder}-performance-footer-${width}`);
    }
    // Inspect the actual action curtain and an actual shared skeleton.
    await navigate('/admin-page/settings.html');
    await evaluate('window.AdminPreferences.set({theme:"dark"});window.FMRCLoader.show("Working on it")');
    await wait('document.querySelector(".fmrc-load-veil.is-on")'); await shot('portal-action-loader-dark', true);
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".fmrc-load-veil")).backgroundColor'), 'rgb(20, 23, 30)');
    await evaluate('window.AdminPreferences.set({theme:"light"})');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".fmrc-load-veil")).backgroundColor'), 'rgb(253, 250, 246)', 'an open loading curtain changes with the theme');
    await shot('portal-action-loader-light', true);
    await evaluate('window.AdminPreferences.set({theme:"dark"})');
    await evaluate('window.FMRCLoader.hide()');
    await navigate('/admin-page/products.html'); await settled();
    await evaluate('window.AdminTableSkeleton.show(document.getElementById("productPerformanceBody"))');
    assert.match(await evaluate('getComputedStyle(document.querySelector("#productPerformanceBody .admin-table-skeleton-bar")).backgroundImage'), /rgb\(41, 46, 57\)/, 'actual shared skeleton uses dark colors');
    await evaluate('document.getElementById("productPerformanceCard").scrollIntoView({block:"center"})');
    await shot('product-performance-skeleton-dark');
    await evaluate('window.AdminTableSkeleton.finish(document.getElementById("productPerformanceBody"))');
    await main.send('Emulation.setEmulatedMedia', { media:'print' });
    assert.equal(await evaluate('getComputedStyle(document.documentElement).getPropertyValue("--surface").trim()'), '#fdfaf6');
    await main.send('Emulation.setEmulatedMedia', { media:'' });
    await navigate('/admin-auth/auth.html');
    assert.equal(await evaluate('document.documentElement.dataset.theme || "light"'), 'light');
    assert.equal(await evaluate('document.querySelectorAll(".auth-dark-mode-toggle").length'), 0);
    await shot('login-remains-light');
    fs.writeFileSync(path.join(artifacts,'measurements.json'),JSON.stringify(measurements,null,2));
    fs.writeFileSync(path.join(artifacts,'bright-surfaces.json'),JSON.stringify(brightSurfaces,null,2));
    assert.deepEqual(brightSurfaces, [], 'no unexpected light surfaces remain in dark mode');
    console.log(JSON.stringify({ pages:measurements.length/2,renderChecks:measurements.length,preferenceWrites:writes,artifacts }));
  } finally {
    second?.close(); main?.close(); controller?.close(); browser.kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});
