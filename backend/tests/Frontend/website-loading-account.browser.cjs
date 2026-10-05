/* Render the real editors in Chrome with isolated, delayed local API fixtures. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function connect(url) {
  const socket = new WebSocket(url), pending = new Map(); let id = 0;
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = ({ data }) => {
    const response = JSON.parse(data), job = pending.get(response.id);
    if (!job) return;
    pending.delete(response.id);
    response.error ? job.reject(Error(JSON.stringify(response.error))) : job.resolve(response.result);
  };
  return {
    send(method, params = {}) { return new Promise((resolve, reject) => {
      const call = ++id, timer = setTimeout(() => { pending.delete(call); reject(Error(method)); }, 15000);
      pending.set(call, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      socket.send(JSON.stringify({ id: call, method, params }));
    }); },
    close() { socket.close(); },
  };
}

test('Website Management section skeletons follow slow loads, recovery, themes and phone layouts; account edits gate saving', { skip: !chrome, timeout: 180000 }, async () => {
  const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'fmrc-website-account-'));
  let held = false, theme = 'light', failSettings = false, failSave = false;
  let releases = [], writes = [];
  const release = () => { held = false; releases.splice(0).forEach(resolve => resolve()); };
  const server = http.createServer(async (req, res) => {
    const route = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const role = String(req.headers.authorization || '').includes('staff') ? 'staff' : 'admin';
    if (route.startsWith('/api/')) {
      if (held && ['/api/site-settings', '/api/services', '/api/sdgs', '/api/maintenance', '/api/admin/email-templates'].includes(route)) await new Promise(resolve => releases.push(resolve));
      let data = { data: [] }, code = 200;
      if (route === '/api/user') {
        data = { id: role === 'admin' ? 11 : 22, role, email: `${role}@gmail.com`, username: `${role}_fixture`, name: 'Fixture Account' };
        if (req.method === 'PUT') {
          let body = ''; for await (const chunk of req) body += chunk;
          writes.push({ route, body: JSON.parse(body) });
          code = failSave ? 422 : 200;
          data = failSave ? { message: 'This address is already in use.' } : { data, email_verification_required: role === 'admin', pending_email: JSON.parse(body).email };
        }
      } else if (route === '/api/change-password') {
        let body = ''; for await (const chunk of req) body += chunk;
        writes.push({ route, body: JSON.parse(body) }); code = 422; data = { message: 'Current password is incorrect.' };
      } else if (route === '/api/admin/preferences') data = { user_id: role === 'admin' ? 11 : 22, preferences: { theme, compact: false, reducedMotion: false } };
      else if (route === '/api/admin/session') data = { server_time: new Date().toISOString(), idle_warning_at: new Date(Date.now()+3600000).toISOString(), idle_expires_at: new Date(Date.now()+3780000).toISOString(), absolute_expires_at: new Date(Date.now()+21600000).toISOString() };
      else if (route === '/api/site-settings') { data = { data: {} }; if (failSettings) { code = 503; data = { message: 'Temporarily unavailable.' }; } }
      else if (route === '/api/maintenance') data = { installed: true, data: {}, site_page_installed: true, site_page: {} };
      else if (route === '/api/site-favicon') data = { favicon_image: '' };
      else if (route === '/api/user/email-change') data = { pending: false };
      else if (route === '/api/admin/recovery-codes') data = { supported: true, total: 10, remaining: 10 };
      else if (route === '/api/admin/email-templates') data = { data: { templates: [{ slug: 'fixture', label: 'Fixture notification', group: 'Account', defaults: { subject: 'Fixture', heading: 'Account update', body_text: 'Sample wording', header_color: '#800000' }, saved: {}, tokens: [] }] } };
      else if (route === '/api/admin/email-templates/preview') { await pause(250); data = { data: { html: '<p>Fixture preview</p>' } }; }
      res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); return;
    }
    const file = path.resolve(root, '.' + route);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
    let content = fs.readFileSync(file);
    if (/\/(admin|staff)-page\/.*\.html$/.test(route)) content = content.toString().replace('<head>', `<head><script>window.APP_API_BASE_URL=location.origin+'/api';for(const role of ['admin','staff']){localStorage.setItem(role+'_user_info',JSON.stringify({id:role==='admin'?11:22,role,email:role+'@gmail.com'}));localStorage.setItem(role+'_auth_token','fixture-'+role);}</script>`);
    res.end(content);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--remote-debugging-port=0', `--user-data-dir=${path.join(artifacts, 'profile')}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let controller, page;
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let log = ''; const timer = setTimeout(() => reject(Error('Browser startup timeout')), 15000);
      browser.stderr.on('data', chunk => { log += chunk; const found = log.match(/DevTools listening on (ws:\/\/\S+)/); if (found) { clearTimeout(timer); resolve(found[1]); } }); browser.on('error', reject);
    });
    controller = await connect(endpoint);
    const tabs = await (await fetch(`http://127.0.0.1:${new URL(endpoint).port}/json/list`)).json();
    page = await connect(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
    await page.send('Page.enable'); await page.send('Network.enable'); await page.send('Network.setBlockedURLs', { urls: ['https://*'] });
    const evaluate = async expression => {
      const value = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (value.exceptionDetails) throw Error(JSON.stringify(value.exceptionDetails));
      return value.result.value;
    };
    const wait = async expression => { for (let i=0; i<150; i++) { if (await evaluate(expression)) return; await pause(40); } throw Error('Timeout: ' + expression); };
    const navigate = async route => { await page.send('Page.navigate', { url: base + route }); await wait(`location.pathname===${JSON.stringify(route)} && document.readyState==='complete'`); };
    const screenshot = async name => { const value = await page.send('Page.captureScreenshot', { captureBeyondViewport: true }); fs.writeFileSync(path.join(artifacts, name + '.png'), Buffer.from(value.data, 'base64')); };
    const settled = () => wait(`!document.querySelector('.website-section-loading,.admin-global-page-skeleton,.fmrc-load-veil.is-on')`);
    const input = async (id, value) => evaluate(`(()=>{const input=document.getElementById(${JSON.stringify(id)});input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    const pages = ['home', 'about', 'services', 'contact', 'footer', 'maintenance', 'payments', 'emails', 'portals'];
    for (const width of [1440, 390]) {
      theme = width === 1440 ? 'light' : 'dark';
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: width === 1440 ? 1000 : 844, deviceScaleFactor: 1, mobile: false });
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: width === 390 ? 'reduce' : 'no-preference' }] });
      for (const role of ['admin', 'staff']) for (const name of pages) {
        if (role === 'staff' && !['home', 'about', 'services', 'contact', 'footer'].includes(name)) continue;
        held = true;
        const route = `/${role}-page/website-${name}.html`;
        await navigate(route); await wait(`!!document.querySelector('.website-section-skeleton .admin-global-skeleton-bar')`); await pause(1150);
        const loading = await evaluate(`(()=>{const sections=[...document.querySelectorAll('.website-section-loading')];return {count:sections.length,locked:sections.every(s=>s.inert&&s.getAttribute('aria-busy')==='true'),bars:document.querySelectorAll('.website-section-skeleton .admin-global-skeleton-bar').length,generic:!!document.querySelector('.admin-global-page-skeleton'),overflow:document.documentElement.scrollWidth>innerWidth,animation:getComputedStyle(document.querySelector('.website-section-skeleton .admin-global-skeleton-bar')).animationName};})()`);
        assert(loading.count >= 2 && loading.bars > 3 && loading.locked, route + ' retains section skeletons after one second');
        assert.equal(loading.generic, false, route); assert.equal(loading.overflow, false, route);
        if (width === 390) assert.equal(loading.animation, 'none', route);
        if (name === 'footer' || name === 'services' || name === 'portals') await screenshot(`${role}-${name}-${width}-loading`);
        release(); await settled();
        assert.equal(await evaluate(`!!document.querySelector('.module-content [inert],.wm-save-bar[inert]')`), false, route + ' unlocks after data rendering');
        console.log(`Verified ${role}/${name} ${width}px ${theme}`);
      }
      for (const role of ['admin', 'staff']) {
        await navigate(`/${role}-page/my-account.html`); await settled(); await wait(`document.getElementById('emailInput').value==='${role}@gmail.com'`);
        const boxes = await evaluate(`(()=>{const a=document.querySelector('.account-summary-card').getBoundingClientRect(),b=document.querySelector('.account-form-card').getBoundingClientRect();return {top:a.top-b.top,bottom:a.bottom-b.bottom,stacked:a.bottom<=b.top,disabled:document.getElementById('saveCredentialsBtn').disabled,cancel:!!document.getElementById('cancelCredentialsBtn'),overflow:document.documentElement.scrollWidth>innerWidth};})()`);
        assert(boxes.disabled && !boxes.cancel && !boxes.overflow, role + ' initial account state');
        if (width === 1440) assert(Math.abs(boxes.top)<1 && Math.abs(boxes.bottom)<1, role + ' card edges align');
        else assert(boxes.stacked, role + ' phone cards stack');
        await screenshot(`${role}-account-${width}-initial`);
        await input('currentPassword', 'fixture-current'); assert(await evaluate(`document.getElementById('saveCredentialsBtn').disabled`));
        await input('newPassword', 'short'); await input('confirmPassword', 'short'); assert(await evaluate(`document.getElementById('saveCredentialsBtn').disabled`));
        await input('newPassword', 'fixture-new-password'); assert(await evaluate(`document.getElementById('saveCredentialsBtn').disabled`));
        await input('confirmPassword', 'fixture-new-password'); assert.equal(await evaluate(`document.getElementById('saveCredentialsBtn').disabled`), false);
        writes = []; await evaluate(`document.getElementById('saveCredentialsBtn').click()`); await wait(`!document.getElementById('saveCredentialsBtn').disabled`);
        assert.deepEqual(writes.map(write => write.route), ['/api/change-password'], role + ' password-only edit makes no profile write');
        for (const id of ['currentPassword', 'newPassword', 'confirmPassword']) await input(id, '');
        assert(await evaluate(`document.getElementById('saveCredentialsBtn').disabled`));
        await input('emailInput', 'invalid'); assert(await evaluate(`document.getElementById('saveCredentialsBtn').disabled`));
        await input('emailInput', `${role}+updated@gmail.com`); assert.equal(await evaluate(`document.getElementById('saveCredentialsBtn').disabled`), false);
        await input('emailInput', `${role}@gmail.com`); assert(await evaluate(`document.getElementById('saveCredentialsBtn').disabled`));
        if (role === 'staff') { await input('usernameInput', 'new_staff'); assert.equal(await evaluate(`document.getElementById('saveCredentialsBtn').disabled`), false); await input('usernameInput', 'staff_fixture'); assert(await evaluate(`document.getElementById('saveCredentialsBtn').disabled`)); }
        await evaluate(`document.querySelectorAll('.admin-system-popup button,.admin-system-popup__card button').forEach(button=>{if(button.textContent.trim()==='Okay')button.click();})`);
        await screenshot(`${role}-account-${width}`);
      }
    }
    theme = 'light'; failSettings = true;
    await navigate('/admin-page/website-payments.html'); await settled();
    assert(await evaluate(`document.getElementById('paymentSettingsFields').disabled && !!document.querySelector('.admin-page-load-notice')`));
    failSettings = false; held = true;
    await evaluate(`document.querySelector('.admin-page-load-notice__retry').click()`);
    await wait(`!!document.querySelector('.website-section-loading')`); release(); await settled();
    assert.equal(await evaluate(`document.getElementById('paymentSettingsFields').disabled`), false);
    console.log('Verified failed load and retry recovery');
    await navigate('/admin-page/website-footer.html'); await settled();
    const overlap = await evaluate(`(()=>{window.finishFirstSection=AdminWebsiteLoading.begin(document.querySelector('.wm-section'));window.finishAllSections=AdminWebsiteLoading.begin();return document.querySelectorAll('.website-section-loading').length;})()`);
    assert(overlap > 2, 'a page load joins an existing section preview load');
    await evaluate('window.finishAllSections()'); await pause(250);
    assert(await evaluate(`!!document.querySelector('.website-section-loading')`), 'the earlier section load keeps skeletons visible');
    await evaluate('window.finishFirstSection()'); await settled();
    assert.equal(await evaluate(`!!document.querySelector('.module-content [inert],.wm-save-bar[inert]')`), false);
    console.log('Verified overlapping section load recovery');
    console.log('Browser screenshots: ' + artifacts);
  } finally {
    release();
    try { await controller?.send('Browser.close'); } catch {}
    page?.close(); controller?.close(); browser.kill();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});
