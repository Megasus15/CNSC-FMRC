// Real portal/customer markup and scripts against an isolated, persistent API fixture.
// Database-backed bearer-token coverage lives in WebsiteContentValidationTest.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');

const repo = path.resolve(__dirname, '../../..');
const chrome = [process.env.FMRC_CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => candidate && fs.existsSync(candidate));

function pageFixture(file) {
  const role = file.startsWith('staff-page/') ? 'staff' : 'admin';
  let html = fs.readFileSync(path.join(repo, file), 'utf8');
  html = html.replace(/<script\b[^>]*\bsrc="[^"]*(?:session-helper|admin-session|fmrc-loader|admin-common|admin-table-resize|maintenance-gate|\/pwa\.js)[^"]*"[^>]*><\/script>/gi, '');
  const setup = `<script>
    window.APP_API_BASE_URL = location.origin + '/api';
    window.AdminSession = {getToken: () => 'fixture-${role}', getUserInfo: () => ({role: '${role}'})};
    window.fixtureErrors = [];
    window.fixtureDialogs = [];
    addEventListener('error', event => window.fixtureErrors.push(event.message));
    addEventListener('unhandledrejection', event => window.fixtureErrors.push(String(event.reason)));
    window.showAdminPopup = (message, options) => window.fixtureDialogs.push({message, title: options?.title});
    window.showAdminConfirmPopup = (message, options) => {
      window.fixtureDialogs.push({message, title: options?.title});
      if (options.confirmText === 'Save') return options.onConfirm();
      window.fixtureRetry = options.onConfirm;
    };
  </script>`;
  return html.replace('</head>', setup + '</head>');
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
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

test('About saves and reloads across both portals, themes and widths, reaches customers, and recovers from failures',
  { skip: !chrome, timeout: 180000 }, async () => {
    const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'fmrc-about-editor-'));
    const initial = {
      hero_title: 'Keep Home headline', hero_scene_scale: '110', footer_brand_name: 'Keep footer',
      about_heading: 'About FMRC', about_text_1: 'Original profile', about_text_2: 'Original continuation',
      vision_heading: 'Our vision', vision_text: 'Original vision',
      mission_heading: 'Our mission', mission_text: 'Original mission',
      editorial_about_page_copy: 'Original introduction',
    };
    let settings = { ...initial };
    let getStatus = 200;
    let putStatus = 200;
    let failReadback = false;
    const writes = [];
    const server = http.createServer(async (request, response) => {
      const route = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const json = (data, status = 200) => {
        response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify(data));
      };
      try {
        if (route === '/api/site-settings') return json({ data: settings }, getStatus);
        if (route === '/api/admin/site-settings' && request.method === 'PUT') {
          if (!['Bearer fixture-admin', 'Bearer fixture-staff'].includes(request.headers.authorization)) {
            return json({ message: 'Sign in required' }, 401);
          }
          let body = '';
          for await (const chunk of request) body += chunk;
          const payload = JSON.parse(body);
          if (putStatus !== 200) return json({ errors: { about_text_1: ['Please shorten the profile text.'] } }, putStatus);
          // Give the browser time to expose its pending-save state.
          await new Promise((resolve) => setTimeout(resolve, 150));
          Object.assign(settings, payload);
          writes.push(payload);
          if (failReadback) getStatus = 503;
          return json({ message: 'Site settings updated successfully.' });
        }
        if (route.startsWith('/api/')) return json({ data: [] });
        const absolute = path.resolve(repo, '.' + route);
        if (!absolute.startsWith(repo + path.sep)) throw new Error('Outside fixture');
        const ext = path.extname(absolute).slice(1);
        const mime = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8',
          svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', woff2: 'font/woff2', ico: 'image/x-icon' };
        if (!mime[ext]) throw new Error('Unsupported fixture asset');
        response.setHeader('Content-Type', mime[ext]);
        response.end(ext === 'html' ? pageFixture(route.slice(1)) : fs.readFileSync(absolute));
      } catch {
        response.statusCode = 404;
        response.end();
      }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
      '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0',
      `--user-data-dir=${path.join(artifacts, 'profile')}`, 'about:blank'],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let cdp;
    try {
      const endpoint = await new Promise((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => reject(new Error('Chrome startup timeout')), 15000);
        browser.stderr.on('data', (chunk) => {
          output += chunk;
          const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
          if (match) { clearTimeout(timer); resolve(match[1]); }
        });
        browser.once('error', (error) => { clearTimeout(timer); reject(error); });
      });
      const targets = await (await fetch(`http://127.0.0.1:${new URL(endpoint).port}/json/list`)).json();
      cdp = await connect(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await cdp.send('Network.enable');
      await cdp.send('Network.setBlockedURLs', { urls: ['https://*'] });
      const evaluate = async (expression) => {
        const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
      };
      const waitFor = async (expression) => {
        for (let attempt = 0; attempt < 150; attempt++) {
          if (await evaluate(expression)) return;
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
        throw new Error(`Not ready: ${expression}; state: ${JSON.stringify(await evaluate('({errors:window.fixtureErrors, dialogs:window.fixtureDialogs, focus:document.activeElement?.id})'))}`);
      };
      const origin = `http://127.0.0.1:${server.address().port}`;
      const navigate = (route) => cdp.send('Page.navigate', { url: origin + route });
      const ready = () => waitFor("document.readyState === 'complete' && document.getElementById('btnSaveAllHome')?.disabled === false && !document.querySelector('.website-section-loading')");
      const clickSave = () => evaluate("document.getElementById('btnSaveAllHome').click()");
      const geometry = new Map();
      for (const portal of ['admin', 'staff']) {
        for (const width of [390, 768, 1440]) {
          for (const theme of ['light', 'dark']) {
            settings = { ...initial };
            await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
            await navigate(`/${portal}-page/website-about.html`);
            await ready();
            const draft = {
              aboutHeading: `About FMRC ${portal}`,
              aboutText1: `Research and design support at ${width}px.`,
              aboutText2: '', visionText: 'Our updated vision.', missionText: 'Our updated mission.',
              editorial_about_page_copy: `Updated introduction from ${portal}.`,
            };
            await evaluate(`(() => {
              document.documentElement.dataset.theme = ${JSON.stringify(theme)};
              for (const [id, value] of Object.entries(${JSON.stringify(draft)})) {
                const input = document.getElementById(id); input.value = value;
                input.dispatchEvent(new Event('input', {bubbles:true}));
              }
              const button = document.getElementById('btnSaveAllHome');
              button.scrollIntoView({block:'center'}); button.focus();
            })()`);
            const before = writes.length;
            await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
            await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
            await waitFor("document.getElementById('btnSaveAllHome').getAttribute('aria-busy') === 'true'");
            await waitFor("window.fixtureDialogs.some(dialog => dialog.title === 'Saved!') && !document.getElementById('btnSaveAllHome').disabled");
            assert.equal(writes.length, before + 1, `${portal} ${width} ${theme}: one keyboard save`);
            assert.equal(settings.about_heading, draft.aboutHeading);
            assert.equal(settings.about_text_2, '');
            assert.equal(settings.hero_title, initial.hero_title);
            assert.equal(settings.hero_scene_scale, initial.hero_scene_scale);
            assert.equal(settings.footer_brand_name, initial.footer_brand_name);
            assert(Object.keys(writes.at(-1)).every((key) => /^(about|vision|mission|editorial_about)_/.test(key)));
            await cdp.send('Page.reload');
            await ready();
            assert.equal(await evaluate("document.getElementById('aboutHeading').value"), draft.aboutHeading);
            assert.equal(await evaluate("document.getElementById('missionText').value"), draft.missionText);
            await evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
            await evaluate(`(() => {
              const button = document.getElementById('btnSaveAllHome');
              button.scrollIntoView({block:'center'}); button.focus();
              getComputedStyle(button).backgroundColor;
              return Promise.all(document.getAnimations()
                .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
                .map(animation => animation.finished.catch(() => {})));
            })()`);
            const layout = await evaluate(`(() => {
              const button = document.getElementById('btnSaveAllHome');
              button.scrollIntoView({block:'center'}); button.focus();
              const rect = button.getBoundingClientRect(), style = getComputedStyle(button);
              return {overflow:document.documentElement.scrollWidth > innerWidth + 1,
                fits:rect.left >= 0 && rect.right <= innerWidth + 1,
                font:style.fontFamily, background:style.backgroundColor, color:style.color,
                height:rect.height, errors:window.fixtureErrors};
            })()`);
            assert.equal(layout.overflow, false, `${portal} ${width} ${theme}: document fits`);
            assert.equal(layout.fits, true, `${portal} ${width} ${theme}: Save fits`);
            assert.deepEqual(layout.errors, []);
            const key = `${width}-${theme}`;
            if (portal === 'admin') geometry.set(key, layout);
            else assert.deepEqual(layout, geometry.get(key), `${key}: Admin/Staff control parity`);
            if (process.env.FMRC_KEEP_SHOTS === '1' && width !== 768) {
              await evaluate("document.getElementById('aboutHeading').scrollIntoView({block:'center'})");
              const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
              fs.writeFileSync(path.join(artifacts, `${portal}-${width}-${theme}.png`), Buffer.from(shot.data, 'base64'));
            }
            await navigate('/about-page/about.html');
            await waitFor(`document.getElementById('aboutHeadingEl')?.textContent === ${JSON.stringify(draft.aboutHeading)}`);
            assert.equal(await evaluate("document.getElementById('visionTextEl').textContent"), draft.visionText);
            assert.equal(await evaluate("document.getElementById('missionTextEl').textContent"), draft.missionText);
            assert.equal(await evaluate("document.querySelector('[data-editorial-copy=editorial_about_page_copy]').textContent"), draft.editorial_about_page_copy);
          }
        }
      }

      for (const portal of ['admin', 'staff']) {
        await navigate(`/${portal}-page/website-about.html`);
        await ready();
        putStatus = 503;
        await evaluate("document.getElementById('aboutText1').value = 'Keep this unsaved draft'");
        await clickSave();
        await waitFor("window.fixtureDialogs.some(dialog => dialog.title === 'Changes Not Saved')");
        assert.equal(await evaluate("document.getElementById('aboutText1').value"), 'Keep this unsaved draft');
        assert.equal(await evaluate("document.getElementById('btnSaveAllHome').disabled"), false);
        putStatus = 200;
        await clickSave();
        await waitFor("window.fixtureDialogs.some(dialog => dialog.title === 'Saved!')");
        assert.equal(settings.about_text_1, 'Keep this unsaved draft');

        failReadback = true;
        await clickSave();
        await waitFor("window.fixtureDialogs.some(dialog => dialog.message.includes('changes were saved'))");
        assert.equal(await evaluate("document.getElementById('btnSaveAllHome').disabled"), true);
        failReadback = false;
        getStatus = 200;
        await evaluate('window.fixtureRetry()');
        await ready();

        getStatus = 503;
        await cdp.send('Page.reload');
        await waitFor("typeof window.fixtureRetry === 'function'");
        assert.equal(await evaluate("document.getElementById('btnSaveAllHome').disabled"), true);
        getStatus = 200;
        await evaluate('window.fixtureRetry()');
        await ready();
        assert.deepEqual(await evaluate('window.fixtureErrors'), []);
      }
      console.log('Verified 12 portal/theme/viewport save-and-reload cases, Customer rendering, keyboard Save, and both portals\' failure/retry states.');
      if (process.env.FMRC_KEEP_SHOTS === '1') console.log(`Screenshots: ${artifacts}`);
    } finally {
      cdp?.close();
      browser.kill();
      if (browser.exitCode === null) await new Promise((resolve) => browser.once('exit', resolve));
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      if (process.env.FMRC_KEEP_SHOTS !== '1') {
        const resolved = path.resolve(artifacts);
        if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) fs.rmSync(resolved, { recursive: true, force: true });
      }
    }
  });
