// Run with FMRC_CHROME set to a local Chrome/Edge executable. Uses an isolated
// profile, actual page CSS and scripts, and fixture API data; no live writes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const items = [1, 2, 3].map(id => ({ id, title: `Announcement ${id}`, message: 'Special Product Promotion: Enjoy 12% OFF on all products in our store!\n\nLimited-time campaign. Don\'t miss out on these savings!', cta_label: 'Shop Sale Items', cta_url: '/products-page/product.html', placement: 'both', is_enabled: true, is_live: true }));
const promotions = [{ id: 1, title: 'All products', discount_percent: 12, scope: 'all_products', product_ids: [], is_enabled: true, is_live: true }, { id: 2, title: 'Selected products', discount_percent: 10, scope: 'specific_products', product_ids: [1], is_enabled: true, is_live: true }];

function fixture(file) {
  const admin = /admin-page|staff-page/.test(file);
  let html = read(file).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const setup = `<script>
    window.APP_API_BASE_URL = '/fixture-api';
    window.AdminSession = {getToken: () => 'fixture-only'};
    window.alert = message => { throw new Error(message); };
    const items = ${JSON.stringify(items)};
    const promotions = ${JSON.stringify(promotions)};
    window.fetch = async url => ({ok:true, json:async () => ({data:
      String(url).endsWith('/announcements') ? items :
      String(url).endsWith('/admin/promotions') ? promotions :
      String(url).includes('products') ? [{id:1,name:'Fixture product',code:'TEST'}] : []})});
  </script>
  <script src='/home-page/customer-announcements.js'></script>
  ${admin ? "<script src='/admin-page/promotions.js'></script>" : ''}`;
  return html.replace('</body>', setup + '</body>');
}

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const data = JSON.parse(event.data);
    if (data.id && pending.has(data.id)) {
      const [resolve, reject] = pending.get(data.id);
      pending.delete(data.id);
      data.error ? reject(new Error(JSON.stringify(data.error))) : resolve(data.result);
    }
  };
  return {
    send(method, params = {}) { return new Promise((resolve, reject) => { pending.set(++id, [resolve, reject]); ws.send(JSON.stringify({id, method, params})); }); },
    close() { ws.close(); },
  };
}

test('announcement layout parity, footer fit, navigation and promotion scope in Chrome', { skip: !process.env.FMRC_CHROME, timeout: 90000 }, async () => {
  const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'fmrc-announcement-qa-'));
  const server = http.createServer((req, res) => {
    const route = new URL(req.url, 'http://localhost').pathname.slice(1);
    try {
      if (route.endsWith('.html')) { res.setHeader('Content-Type', 'text/html'); res.end(fixture(route)); return; }
      const absolute = path.resolve(root, route);
      if (!absolute.startsWith(root + path.sep)) throw new Error('Outside fixture');
      res.setHeader('Content-Type', route.endsWith('.css') ? 'text/css' : route.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
      res.end(fs.readFileSync(absolute));
    } catch { res.statusCode = 404; res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = spawn(process.env.FMRC_CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${path.join(artifacts, 'profile')}`, 'about:blank'], { windowsHide:true, stdio:['ignore','ignore','pipe'] });
  let cdp;
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Chrome startup timeout: ' + output)), 15000);
      browser.stderr.on('data', chunk => { output += chunk; const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
      browser.on('error', reject);
    });
    const port = new URL(endpoint).port;
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    cdp = await connect(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    // Keep this fixture test offline and deterministic; remote fonts/icons use
    // their fallbacks. Page CSS, DOM and the two feature scripts are real.
    await cdp.send('Network.enable');
    await cdp.send('Network.setBlockedURLs', {urls:['https://*', 'http://fonts.*']});
    const evaluate = async expression => {
      const result = await cdp.send('Runtime.evaluate', { expression, returnByValue:true, awaitPromise:true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    async function waitFor(expression) {
      for (let tries = 0; tries < 100; tries++) {
        if (await evaluate(expression)) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error('Fixture did not become ready: ' + expression + '\n' + JSON.stringify(await evaluate('({ready:document.readyState, title:document.title, badge:document.querySelector("#announcementBellBadge")?.outerHTML, scripts:[...document.scripts].map(s=>s.src), body:document.body?.innerText.slice(-500)})')));
    }
    const snapshots = {};
    for (const portal of ['products-page/product.html', 'admin-page/promotions.html', 'staff-page/promotions.html']) {
      const customer = portal.startsWith('products');
      await cdp.send('Emulation.setDeviceMetricsOverride', {width:1280,height:900,deviceScaleFactor:1,mobile:false});
      await cdp.send('Page.navigate', {url:`http://127.0.0.1:${server.address().port}/${portal}`});
      await waitFor(customer ? "document.querySelector('#announcementBellBadge')?.textContent === '3'" : "document.querySelector('#liveCustomerModalCard .fmrc-announcement__counter')?.textContent === '1 of 5'");
      if (customer) await evaluate("document.getElementById('announcementBell').click()");
      const selector = customer ? '#announcementModal .fmrc-announcement-card' : '#liveCustomerModalCard';
      await evaluate(`document.querySelector('${selector}').scrollIntoView({block:'center'})`);
      await evaluate("Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 3000))])");
      await evaluate(`document.querySelector('${selector} [data-announcement-next]').click()`);
      assert.match(await evaluate(`document.querySelector('${selector} .fmrc-announcement__counter').textContent`), /^2 of /);
      await evaluate(`document.querySelector('${selector} [data-announcement-previous]').click()`);
      assert.match(await evaluate(`document.querySelector('${selector} .fmrc-announcement__counter').textContent`), /^1 of /);
      await evaluate(`document.querySelector('${selector} [data-announcement-previous]').click()`);
      assert.equal(await evaluate(`document.querySelector('${selector} .fmrc-announcement__counter').textContent`), customer ? '3 of 3' : '5 of 5');
      await evaluate(`document.querySelector('${selector} [data-announcement-next]').click()`);
      assert.match(await evaluate(`document.querySelector('${selector} .fmrc-announcement__counter').textContent`), /^1 of /);

      for (const width of [1280, 768, 430, 390, 320]) {
        await cdp.send('Emulation.setDeviceMetricsOverride', {width,height:900,deviceScaleFactor:1,mobile:false});
        // Let the real portal shell finish its resize/entrance transitions.
        await new Promise(resolve => setTimeout(resolve, 450));
        const layout = await evaluate(`(() => {
          const card = document.querySelector('${selector}');
          card.scrollIntoView({block:'center'});
          const box = el => { const r=el.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}; };
          const footer = card.querySelector('.fmrc-announcement__footer');
          const controls = [...footer.querySelectorAll('button,a')].filter(el => !el.hidden);
          return {card:box(card),footer:box(footer),controls:controls.map(box),overflow:card.scrollWidth > card.clientWidth,
            style:[card,...card.querySelectorAll('.fmrc-announcement__header,.fmrc-announcement__title,.fmrc-announcement__message,.fmrc-announcement__footer,.fmrc-announcement__button')].map(el => {const s=getComputedStyle(el); return [s.backgroundColor,s.backgroundImage,s.borderColor,s.borderWidth,s.fontFamily,s.fontSize,s.padding,s.borderRadius];})};
        })()`);
        assert.equal(layout.overflow,false, `${portal} overflow at ${width}`);
        for (const control of layout.controls) {
          assert.ok(control.left >= layout.footer.left && control.right <= layout.footer.right + 1 && control.top >= layout.footer.top && control.bottom <= layout.footer.bottom + 1, `${portal} footer control escapes at ${width}`);
        }
        for (let i=0;i<layout.controls.length;i++) for(let j=i+1;j<layout.controls.length;j++) {
          const a=layout.controls[i],b=layout.controls[j];
          assert.ok(a.right <= b.left+1 || b.right <= a.left+1 || a.bottom <= b.top+1 || b.bottom <= a.top+1, `${portal} overlapping controls at ${width}`);
        }
        if (width === 1280) snapshots[portal] = layout.style;
        if (width === 1280 || width === 390) {
          const shot = await cdp.send('Page.captureScreenshot', {format:'png'});
          fs.writeFileSync(path.join(artifacts, `${portal.split('/')[0]}-${width}.png`), Buffer.from(shot.data,'base64'));
        }
      }
      if (!customer) {
        const choose = async value => evaluate(`(() => { const el=document.getElementById('promotionScope'); el.value='${value}'; el.dispatchEvent(new Event('change')); return getComputedStyle(document.getElementById('specificProductsField')).display; })()`);
        await evaluate("document.getElementById('btnOpenAddPromotion').click()");
        assert.equal(await choose('all_products'),'none');
        assert.notEqual(await choose('specific_products'),'none');
        assert.equal(await choose('all_products'),'none');
        await evaluate("document.getElementById('promotionReset').click(); document.querySelector('[data-edit-promotion=\"2\"]').click()");
        assert.notEqual(await evaluate("getComputedStyle(document.getElementById('specificProductsField')).display"),'none');
        await evaluate("document.getElementById('promotionReset').click(); document.querySelector('[data-edit-promotion=\"1\"]').click()");
        assert.equal(await evaluate("getComputedStyle(document.getElementById('specificProductsField')).display"),'none');
        assert.equal(await evaluate("getComputedStyle(document.getElementById('livePreviewBadgeTag')).backgroundColor"),'rgb(236, 253, 245)');
      }
    }
    assert.deepEqual(snapshots['admin-page/promotions.html'], snapshots['products-page/product.html'], 'Admin and Customer card computed styles');
    assert.deepEqual(snapshots['staff-page/promotions.html'], snapshots['products-page/product.html'], 'Staff and Customer card computed styles');
    console.log('Screenshots:', artifacts);
  } finally {
    cdp?.close();
    browser.kill();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
