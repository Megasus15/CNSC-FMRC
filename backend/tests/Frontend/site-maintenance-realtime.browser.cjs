// Browser regression for the public maintenance gate. The fixture answers the
// maintenance API in memory; it never changes a database or production site.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');

const repo = path.resolve(__dirname, '../../..');
const chrome = [
  process.env.FMRC_CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((candidate) => candidate && fs.existsSync(candidate));

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const reply = JSON.parse(data);
    if (!pending.has(reply.id)) return;
    const { resolve, reject } = pending.get(reply.id);
    pending.delete(reply.id);
    reply.error ? reject(new Error(JSON.stringify(reply.error))) : resolve(reply.result);
  };
  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { socket.close(); },
  };
}

const fixturePages = [
  ['navHome', '/home-page/main.html', 'page_home'],
  ['navAbout', '/about-page/about.html', 'page_about'],
  ['navServices', '/services-page/service.html', 'page_services'],
  ['navProducts', '/products-page/product.html', 'page_products'],
  ['navContact', '/contact-page/contact.html', 'page_contact'],
];

const fixture = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Maintenance fixture</title>
<style>body{margin:0;font-family:Arial,sans-serif}nav{display:flex;flex-wrap:wrap;gap:12px;padding:12px}button,input{font-size:16px}</style></head>
<body><nav>${fixturePages.map(([id, href]) => `<a id="${id}" href="${href}">${id.slice(3)}</a>`).join('')}
<button id="gatedAction" data-maint-gate="page_products" type="button">Place order</button>
<button id="appointmentAction" class="btn-appointment" type="button">Book appointment</button></nav>
<form id="gatedForm" data-maint-gate="page_contact"><input name="message" value="Customer inquiry"><button id="gatedSubmit" type="submit">Send inquiry</button></form>
<main id="home" class="editorial-content services-list-section contact-main-section shop-section"><button id="openImage" type="button">Open image</button>
<a id="rawImage" href="/raw-image.png" target="_blank" rel="noopener">Open full image</a>
<div id="imageLightbox" hidden>Image open</div></main>
<script>
window.fixtureActive = false;
window.fixtureSitePage = {};
window.fixtureScopes = JSON.parse(localStorage.getItem('fixture-maintenance-scopes') || '{}');
window.fixtureMessage = 'The customer website is being updated. Please return shortly.';
window.fixtureOpens = 0;
window.fixtureActions = 0;
window.fixtureSubmits = 0;
window.fixtureSignals = [];
window.fixtureFetches = 0;
window.fixtureReleaseFirstFetch = null;
const fixtureStartup = new URLSearchParams(location.search).get('startup');
if (fixtureStartup) localStorage.clear();
window.addEventListener('fmrc:site-portal-maintenance', (event) => fixtureSignals.push(event.detail));
window.fetch = async function (url) {
  if (!String(url).endsWith('/api/maintenance')) throw new Error('Unexpected request: ' + url);
  window.fixtureFetches += 1;
  if (window.fixtureFetches === 1 && fixtureStartup) {
    await new Promise((resolve, reject) => {
      window.fixtureReleaseFirstFetch = () => {
        fixtureStartup === 'unavailable' ? reject(new TypeError('Failed to fetch')) : resolve();
      };
    });
  }
  return new Response(JSON.stringify({ installed: true, site_page: window.fixtureSitePage, data: {
    ...window.fixtureScopes, site_portal: { active: window.fixtureActive, message: window.fixtureMessage }
  } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
</script>
<script src="/home-page/maintenance-gate.js"></script>
<script>
document.getElementById('openImage').addEventListener('click', () => {
  window.fixtureOpens += 1;
  document.getElementById('imageLightbox').hidden = false;
});
document.getElementById('gatedAction').addEventListener('click', () => { window.fixtureActions += 1; });
document.getElementById('appointmentAction').addEventListener('click', () => { window.fixtureActions += 1; });
document.getElementById('gatedForm').addEventListener('submit', (event) => {
  event.preventDefault(); window.fixtureSubmits += 1;
});
</script></body></html>`;

test('customer entry pages do not load a blocking startup availability screen', () => {
  for (const page of [
    'home-page/main.html', 'about-page/about.html', 'services-page/service.html',
    'products-page/product.html', 'contact-page/contact.html', 'customer-auth/auth.html',
  ]) {
    const html = fs.readFileSync(path.join(repo, page), 'utf8');
    assert(!html.includes('maintenance-boot.js'), `${page} must not load the blocking maintenance bootstrap`);
    assert(html.includes('maintenance-gate.js'), `${page} must keep the live maintenance gate`);
  }
});

test('sitewide maintenance stays live while individual maintenance pages remain reachable with phone notice rows',
  { skip: !chrome, timeout: 90000 }, async () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fmrc-site-maintenance-'));
    let rawImageRequests = 0;
    const server = http.createServer((request, response) => {
      const route = new URL(request.url, 'http://localhost').pathname;
      if (route === '/fixture.html' || fixturePages.some(([, pathname]) => pathname === route)) {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(fixture);
        return;
      }
      if (route === '/home-page/maintenance-gate.js') {
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        response.end(fs.readFileSync(path.join(repo, 'home-page/maintenance-gate.js')));
        return;
      }
      if (route === '/home-page/maintenance-illustration.svg') {
        response.setHeader('Content-Type', 'image/svg+xml');
        response.end(fs.readFileSync(path.join(repo, 'home-page/maintenance-illustration.svg')));
        return;
      }
      if (route === '/raw-image.png') {
        rawImageRequests += 1;
        response.setHeader('Content-Type', 'image/png');
        response.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7ZV0kAAAAASUVORK5CYII=', 'base64'));
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = spawn(chrome, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
      '--no-default-browser-check', '--disable-background-networking',
      '--remote-debugging-port=0', `--user-data-dir=${path.join(profile, 'chrome')}`,
      'about:blank',
    ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let cdp;
    try {
      const endpoint = await new Promise((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => reject(new Error('Chrome startup timeout: ' + output)), 15000);
        browser.stderr.on('data', (chunk) => {
          output += chunk;
          const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
          if (match) { clearTimeout(timer); resolve(match[1]); }
        });
        browser.on('error', reject);
      });
      const debugPort = new URL(endpoint).port;
      const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      cdp = await connect(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      const evaluate = async (expression) => {
        const result = await cdp.send('Runtime.evaluate', {
          expression, returnByValue: true, awaitPromise: true,
        });
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
      };
      const waitFor = async (expression) => {
        for (let attempt = 0; attempt < 100; attempt++) {
          if (await evaluate(expression)) return;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error(`Fixture did not reach: ${expression}`);
      };
      const clickSelector = async (selector) => {
        const { x, y } = await evaluate(`(() => {
          const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        })()`);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      };
      const clickAt = (id) => clickSelector(`#${id}`);

      const fixtureUrl = `http://127.0.0.1:${server.address().port}/fixture.html`;
      const normalPageIsVisible = async () => evaluate(`(() => {
        const home = document.getElementById('home');
        const body = getComputedStyle(document.body);
        const content = getComputedStyle(home);
        return home.getBoundingClientRect().width > 0 && body.visibility === 'visible'
          && body.display !== 'none' && content.visibility === 'visible' && content.display !== 'none'
          && !home.inert && !home.hasAttribute('aria-hidden')
          && !document.getElementById('fmrcSiteMaintenance')
          && !document.documentElement.classList.contains('fmrc-maintenance-checking')
          && !document.body.innerText.includes('Checking website availability');
      })()`);

      // A cold visitor must see the actual page while the first background
      // availability request is pending, including when the API is unreachable.
      // A delayed response that enables maintenance must still replace it.
      for (const startup of ['delayed', 'unavailable']) {
        await cdp.send('Page.navigate', { url: `${fixtureUrl}?startup=${startup}` });
        await waitFor('Boolean(window.FMRC_MAINTENANCE && window.fixtureReleaseFirstFetch && document.readyState === "complete")');
        assert.equal(await normalPageIsVisible(), true, `normal page stays visible during ${startup} initial request`);
        assert.equal(await evaluate('window.fixtureFetches'), 1, 'startup requests share the pending background check');
        if (startup === 'delayed') await evaluate('window.fixtureActive = true');
        await evaluate('window.fixtureReleaseFirstFetch(); FMRC_MAINTENANCE.refresh()');
        if (startup === 'delayed') {
          await waitFor('FMRC_MAINTENANCE.isActive("site_portal")');
          assert.equal(await evaluate('Boolean(document.getElementById("fmrcSiteMaintenance"))'), true,
            'a delayed active response must display the maintenance page');
        } else {
          assert.equal(await normalPageIsVisible(), true, 'an unavailable API must leave the normal customer page visible');
          assert.equal(await evaluate('FMRC_MAINTENANCE.isActive("site_portal")'), false);
        }
      }

      await cdp.send('Page.navigate', { url: fixtureUrl });
      await waitFor('Boolean(window.FMRC_MAINTENANCE && document.readyState === "complete")');
      assert.equal(await evaluate('FMRC_MAINTENANCE.isActive("site_portal")'), false);
      const originalPages = (await cdp.send('Target.getTargets')).targetInfos.filter((target) => target.type === 'page').length;

      // A remote admin has paused the site while this page is still open. The
      // next real visitor action must reveal maintenance before a raw image can
      // open in another tab.
      await evaluate('window.fixtureActive = true');
      await clickAt('rawImage');
      await waitFor('FMRC_MAINTENANCE.isActive("site_portal")');
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.equal(rawImageRequests, 0, 'a stale image link must not request the image');
      assert.equal((await cdp.send('Target.getTargets')).targetInfos.filter((target) => target.type === 'page').length,
        originalPages, 'a stale target=_blank link must not open a tab');

      await evaluate(`window.fixtureActive = false;
        new BroadcastChannel('fmrc-site-settings-realtime').postMessage({ type: 'updated' });`);
      await waitFor('!FMRC_MAINTENANCE.isActive("site_portal")');

      // The same protection covers a lightbox button. Wait beyond the
      // interaction throttle so this click performs a fresh availability check.
      await new Promise((resolve) => setTimeout(resolve, 3200));
      await evaluate('window.fixtureActive = true');
      await clickAt('openImage');
      await waitFor('FMRC_MAINTENANCE.isActive("site_portal")');
      assert.equal(await evaluate('window.fixtureOpens'), 0);
      assert.equal(await evaluate('document.getElementById("imageLightbox").hidden'), true);
      assert.equal(await evaluate('window.fixtureSignals.some((signal) => signal.active === true)'), true);

      // The outage page must fit rather than scroll, including maximum-length
      // editable copy on compact portrait and short landscape phone viewports.
      await evaluate(`window.fixtureSitePage = {
        eyebrow: 'Scheduled improvements to the customer website',
        headline: 'We are making improvements to your FMRC customer experience',
        headline_accent: 'We will be back shortly.',
        supporting_line: 'Thank you for your patience while our team completes these scheduled improvements to the website.',
        theme: 'soft_gold'
      }; window.fixtureMessage = 'Our team is completing scheduled improvements to the customer website. Please check back shortly to explore our services and continue your projects. Thank you for your understanding and patience.';
      FMRC_MAINTENANCE.refresh();`);
      await waitFor('document.querySelector(".maint-site__title-primary").textContent === fixtureSitePage.headline');
      for (const [width, height] of [[320, 568], [375, 667], [390, 844], [393, 852], [402, 874], [430, 932], [440, 956], [667, 375], [844, 390], [1440, 900]]) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
        await new Promise((resolve) => setTimeout(resolve, 90));
        const metrics = await evaluate(`(() => {
          const screen = document.getElementById('fmrcSiteMaintenance');
          const rect = screen.getBoundingClientRect();
          const copy = screen.querySelector('.maint-site__copy').getBoundingClientRect();
          const message = screen.querySelector('.maint-site__message').getBoundingClientRect();
          const rule = screen.querySelector('.maint-site__rule').getBoundingClientRect();
          const content = getComputedStyle(screen.querySelector('.maint-site__content'));
          return { width: rect.width, height: rect.height,
            overflowX: screen.scrollWidth > screen.clientWidth,
            overflowY: screen.scrollHeight > screen.clientHeight,
            outline: content.outlineStyle, border: content.borderTopStyle,
            hasHeader: !!screen.querySelector('header'),
            messageFits: message.bottom <= rect.bottom && message.top >= rect.top,
            ruleFits: rule.bottom <= rect.bottom && rule.top >= rect.top,
            copyFits: copy.right <= rect.right + 1 && copy.bottom <= rect.bottom + 1 };
        })()`);
        assert.equal(metrics.width, width, `viewport width at ${width}x${height}`);
        assert.equal(metrics.height, height, `viewport height at ${width}x${height}`);
        assert.equal(metrics.overflowX, false, `horizontal scrolling at ${width}x${height}`);
        assert.equal(metrics.overflowY, false, `vertical scrolling at ${width}x${height}`);
        assert.equal(metrics.hasHeader, false, 'the removed institutional header must stay absent');
        assert.equal(metrics.outline, 'none', 'focus must not draw a square around the page');
        assert.equal(metrics.border, 'none', 'the content must not have an edge border');
        assert(metrics.copyFits && metrics.messageFits && metrics.ruleFits, `all copy fits at ${width}x${height}: ${JSON.stringify(metrics)}`);
      }
      await cdp.send('Emulation.clearDeviceMetricsOverride');
      await new Promise((resolve) => setTimeout(resolve, 100));

      // The Admin save signal updates the open page in place when the site
      // reopens. No page navigation or click is needed for the second change.
      await evaluate(`window.fixtureActive = false;
        new BroadcastChannel('fmrc-site-settings-realtime').postMessage({ type: 'updated' });`);
      await waitFor('!FMRC_MAINTENANCE.isActive("site_portal")');
      assert.equal(await evaluate('window.fixtureSignals.some((signal) => signal.active === false)'), true);
      assert.equal(await evaluate('location.pathname'), '/fixture.html');
      await clickAt('openImage');
      await waitFor('window.fixtureOpens === 1');
      assert.equal(await evaluate('window.fixtureOpens'), 1);

      // A successful check must also preserve a normal external image link.
      await new Promise((resolve) => setTimeout(resolve, 3200));
      await clickAt('rawImage');
      for (let attempt = 0; attempt < 40 && rawImageRequests === 0; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.equal(rawImageRequests, 1, 'an available image link must still open');

      // Individual page maintenance explains the unavailable content at the
      // destination. Navigation itself remains available, even when the source
      // already knows the destination's scope is active.
      await evaluate(`window.fixtureScopes = {
        page_about: { active: true, message: 'The About Us page is being updated. Please check back shortly.' },
        page_services: { active: true, message: 'The Services page is being updated. Please check back shortly.' },
        page_products: { active: true, message: 'The Products page is being updated. Orders will reopen shortly.' },
        page_contact: { active: true, message: 'The Contact page is being updated. Please check back shortly.' },
        page_appointment: { active: true, message: 'Appointment booking is paused. Please try again later.' }
      }; localStorage.setItem('fixture-maintenance-scopes', JSON.stringify(fixtureScopes));
      FMRC_MAINTENANCE.refresh();`);
      await waitFor('FMRC_MAINTENANCE.isActive("page_about")');
      const destinations = [...fixturePages.slice(1), fixturePages[0]];
      for (const [id, pathname, scope] of destinations) {
        if (scope === 'page_home') {
          await evaluate(`window.fixtureScopes.page_home = {
            active: true, message: 'Our home page is being updated. Please check back shortly.'
          }; localStorage.setItem('fixture-maintenance-scopes', JSON.stringify(fixtureScopes));
          FMRC_MAINTENANCE.refresh();`);
          await waitFor('FMRC_MAINTENANCE.isActive("page_home")');
        }
        assert.equal(await evaluate(`FMRC_MAINTENANCE.isActive(${JSON.stringify(scope)})`), true,
          `${scope} is already active before navigation`);
        await clickAt(id);
        await waitFor(`location.pathname === ${JSON.stringify(pathname)} && Boolean(window.FMRC_MAINTENANCE)`);
        await waitFor('Boolean(document.querySelector(".maint-dlg"))');
        assert.equal(await evaluate('document.querySelector(".maint-dlg__title").textContent'), 'Under Maintenance');
        assert.equal(await evaluate('Boolean(document.getElementById("fmrcMaintenanceRibbon"))'), false,
          `${scope} must not display its footer ribbon before the dialog closes`);
        assert.equal(await evaluate(`document.querySelector('.maint-panel[data-maint-scope="${scope}"] .maint-panel__text').textContent`),
          await evaluate(`FMRC_MAINTENANCE.message(${JSON.stringify(scope)})`),
          `${scope} destination must show its own maintenance copy`);
        await clickSelector('.maint-dlg__btn');
        await waitFor('Boolean(document.getElementById("fmrcMaintenanceRibbon"))');

        // A long page message stays on one row on narrow iPhones. The grouped
        // icon and label must stay together while the message can truncate.
        for (const [width, height] of [[320, 568], [375, 667], [390, 844], [430, 932], [667, 375], [844, 390]]) {
          await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
          await new Promise((resolve) => setTimeout(resolve, 60));
          const metrics = await evaluate(`(() => {
            const ribbon = document.getElementById('fmrcMaintenanceRibbon');
            const heading = ribbon.querySelector('.maint-ribbon__heading');
            const icon = ribbon.querySelector('.maint-ribbon__icon');
            const label = ribbon.querySelector('strong');
            const text = ribbon.querySelector('.maint-ribbon__text');
            const bounds = (element) => {
              const rect = element.getBoundingClientRect();
              return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
                width: rect.width, height: rect.height, centerY: rect.top + rect.height / 2 };
            };
            return { ribbon: bounds(ribbon), icon: bounds(icon), label: bounds(label), text: bounds(text),
              grouped: !!heading && heading.contains(icon) && heading.contains(label),
              textOverflow: getComputedStyle(text).textOverflow,
              labelLineHeight: parseFloat(getComputedStyle(label).lineHeight),
              horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
          })()`);
          assert.equal(metrics.ribbon.width, width, `${scope}: full-width ribbon at ${width}x${height}`);
          assert.equal(metrics.grouped, true, `${scope}: icon belongs beside Under Maintenance`);
          assert.equal(metrics.horizontalOverflow, false, `${scope}: no horizontal document overflow at ${width}x${height}`);
          assert(metrics.icon.right <= metrics.label.left + 1,
            `${scope}: icon is immediately before the label at ${width}x${height}`);
          assert(Math.abs(metrics.icon.centerY - metrics.label.centerY) <= 2,
            `${scope}: icon and label share one row at ${width}x${height}`);
          assert(metrics.label.height <= metrics.labelLineHeight + 1,
            `${scope}: Under Maintenance label stays on one line at ${width}x${height}`);
          assert(metrics.text.left >= metrics.label.right - 1
            && Math.abs(metrics.text.centerY - metrics.label.centerY) <= 2,
          `${scope}: message stays beside the label at ${width}x${height}`);
          if (width <= 560) assert.equal(metrics.textOverflow, 'ellipsis', 'phone copy truncates without wrapping');
          if (width === 320) {
            await clickSelector('.maint-ribbon__heading');
            await waitFor('Boolean(document.querySelector(".maint-dlg"))');
            assert.equal(await evaluate('document.querySelector(".maint-dlg__text").textContent'),
              await evaluate(`FMRC_MAINTENANCE.message(${JSON.stringify(scope)})`),
              `${scope}: the mobile label opens the complete maintenance message`);
            await clickSelector('.maint-dlg__btn');
            await waitFor('!document.querySelector(".maint-dlg")');
          }
        }
        await cdp.send('Emulation.clearDeviceMetricsOverride');
        await new Promise((resolve) => setTimeout(resolve, 60));
      }

      // Keeping page navigation open must not reopen gated mutations. Explicit
      // order/appointment actions and form submits still stop before handlers.
      for (const id of ['gatedAction', 'appointmentAction', 'gatedSubmit']) {
        await clickAt(id);
        await waitFor('Boolean(document.querySelector(".maint-dlg"))');
        assert.equal(await evaluate('window.fixtureActions'), 0, `${id} must not trigger a gated action`);
        assert.equal(await evaluate('window.fixtureSubmits'), 0, `${id} must not submit a gated form`);
        await clickSelector('.maint-dlg__btn');
        await waitFor('!document.querySelector(".maint-dlg")');
      }
    } finally {
      cdp?.close();
      browser.kill();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      const tempRoot = fs.realpathSync(os.tmpdir());
      const resolvedProfile = fs.realpathSync(profile);
      if (resolvedProfile.startsWith(tempRoot + path.sep)) {
        try { fs.rmSync(resolvedProfile, { recursive: true, force: true }); } catch { /* Chrome may still be releasing its profile. */ }
      }
    }
  });
