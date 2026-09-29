// Real Home editor markup/CSS/feature scripts with an in-memory API fixture.
// Run with FMRC_CHROME set to local Chrome/Edge; never writes to a database.
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
].find((candidate) => candidate && fs.existsSync(candidate));

function editorFixture(file) {
  let html = fs.readFileSync(path.join(repo, file), 'utf8');
  // Authentication and the broad dashboard shell are outside this editor QA.
  // The actual Home editor, gradient/content modules, markup, and CSS run.
  html = html.replace(/<script\b[^>]*\bsrc="[^"]*(?:session-helper|admin-session|fmrc-loader|admin-common|admin-table-resize)[^"]*"[^>]*><\/script>/gi, '');
  const setup = `<script>
    window.APP_API_BASE_URL = location.origin + '/api';
    window.AdminSession = {getToken: () => 'fixture-only'};
    window.showAdminPopup = () => {};
    window.showAdminConfirmPopup = (_message, options) => options.onConfirm();
    window.fixtureErrors = [];
    window.addEventListener('error', event => window.fixtureErrors.push(event.message));
    window.fixtureWrites = [];
    window.fixtureSettings = {
      hero_title: 'Fixture headline', hero_bg_type: 'color',
      hero_bg_color: '#691b2a', hero_logo_image: ''
    };
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (url, options = {}) => {
      const route = new URL(String(url), location.href).pathname;
      const reply = (body) => new Response(JSON.stringify(body), {
        status: 200, headers: {'Content-Type': 'application/json'}
      });
      if (route === '/api/site-settings') return reply({data: window.fixtureSettings});
      if (route === '/api/admin/site-settings' && options.method === 'PUT') {
        const payload = JSON.parse(options.body);
        window.fixtureWrites.push(payload);
        Object.assign(window.fixtureSettings, payload);
        return reply({message: 'Saved'});
      }
      if (route === '/api/services' || route === '/api/admin/site-sdgs') {
        return reply({data: [], max_slots: 8});
      }
      return originalFetch(url, options);
    };
  </script>`;
  return html.replace('</head>', setup + '</head>');
}

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

test('Admin and Staff Home scene previews and save payloads match at phone and desktop widths',
  { skip: !chrome, timeout: 90000 }, async () => {
    const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'fmrc-hero-editor-'));
    const server = http.createServer((request, response) => {
      const route = decodeURIComponent(new URL(request.url, 'http://localhost').pathname.slice(1));
      try {
        const absolute = path.resolve(repo, route);
        if (!absolute.startsWith(repo + path.sep)) throw new Error('Outside fixture');
        response.setHeader('Content-Type', route.endsWith('.html') ? 'text/html; charset=utf-8'
          : route.endsWith('.js') ? 'text/javascript; charset=utf-8'
            : route.endsWith('.css') ? 'text/css; charset=utf-8'
              : route.endsWith('.svg') ? 'image/svg+xml'
                : route.endsWith('.png') ? 'image/png' : 'application/octet-stream');
        response.end(route.endsWith('.html') ? editorFixture(route) : fs.readFileSync(absolute));
      } catch {
        response.statusCode = 404;
        response.end();
      }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = spawn(chrome, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
      '--no-default-browser-check', '--disable-background-networking',
      '--remote-debugging-port=0', `--user-data-dir=${path.join(artifacts, 'profile')}`,
      'about:blank',
    ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let cdp;
    const portalGeometry = new Map();
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
      await cdp.send('Network.enable');
      await cdp.send('Network.setBlockedURLs', { urls: ['https://*'] });
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
        throw new Error(`Fixture did not reach: ${expression}; errors: ${JSON.stringify(await evaluate('window.fixtureErrors'))}`);
      };

      for (const portal of ['admin', 'staff']) {
        for (const width of [390, 1440]) {
          await cdp.send('Emulation.setDeviceMetricsOverride', {
            width, height: width === 390 ? 844 : 900,
            deviceScaleFactor: 1, mobile: false,
          });
          await cdp.send('Page.navigate', {
            url: `http://127.0.0.1:${server.address().port}/${portal}-page/website-home.html`,
          });
          await waitFor("document.getElementById('heroSceneAccent')?.disabled === false && document.querySelector('#heroScenePreview img.hero-printer-art')?.naturalWidth > 0 && document.getElementById('heroScenePreview')?.dataset.mechanism === 'ready' && document.querySelector('#heroScenePreview [data-hero-scene-logo]')?.naturalWidth > 0 && document.getElementById('heroScenePreview')?.style.getPropertyValue('--hero-scene-accent') === '#e6c46c'");
          const initial = await evaluate(`(() => {
            const scene = document.getElementById('heroScenePreview');
            const logo = scene.querySelector('[data-hero-scene-logo]');
            const mechanics = JSON.parse(scene.querySelector('#hp-mechanics').textContent);
            scene.scrollIntoView({block:'center'});
            const bounds = scene.getBoundingClientRect();
            return {art:scene.querySelector('.hero-printer-art').naturalWidth, logo:logo.naturalWidth,
              logoSrc:logo.getAttribute('src'), accent:scene.style.getPropertyValue('--hero-scene-accent'),
              scale:scene.style.getPropertyValue('--hero-scene-scale'), motion:scene.dataset.motion,
              bounds:{left:bounds.left,right:bounds.right,width:bounds.width},
              viewport:innerWidth, scrollWidth:document.documentElement.scrollWidth,
              mechanics,
              errors:window.fixtureErrors};
          })()`);
          assert.ok(initial.art > 0 && initial.logo > 0, `${portal} ${width}: artwork/logo load ${JSON.stringify(initial)}`);
          assert.equal(initial.logoSrc, '/images/FMRC Logo.png');
          assert.equal(initial.accent, '#e6c46c');
          assert.equal(initial.scale, '1');
          assert.equal(initial.motion, 'on');
          assert.ok(initial.bounds.left >= -1 && initial.bounds.right <= width + 1, `${portal} ${width}: preview fits viewport`);
          assert.ok(initial.scrollWidth <= width + 1, `${portal} ${width}: no horizontal overflow`);
          assert.deepEqual(initial.errors, [], `${portal} ${width}: script errors`);
          if (portal === 'admin') portalGeometry.set(width, initial.mechanics);
          else assert.deepEqual(initial.mechanics, portalGeometry.get(width), `${width}: Admin and Staff share identical printer geometry`);
          const headPosition = `(() => {
            const scene = document.getElementById('heroScenePreview');
            const svg = scene.querySelector('.hero-printer-mechanism');
            const matrix = svg.getCTM().inverse().multiply(scene.querySelector('.hp-printhead').getCTM());
            const gantry = svg.getCTM().inverse().multiply(scene.querySelector('.hp-gantry').getCTM());
            return {x:matrix.e,y:matrix.f,gantry:{x:gantry.e,y:gantry.f},
              progress:+scene.dataset.printProgress,
              fan:getComputedStyle(scene.querySelector('.hp-fan')).animationName};
          })()`;
          const movingStart = await evaluate(headPosition);
          await new Promise((resolve) => setTimeout(resolve, 350));
          const movingEnd = await evaluate(headPosition);
          assert.ok(Math.hypot(movingEnd.x - movingStart.x, movingEnd.y - movingStart.y) > 0.1,
            `${portal} ${width}: preview performs its printing pass`);
          assert.equal(movingEnd.fan, 'fmrcPrinterFan');

          const changed = await evaluate(`(() => {
            const set = (id, value) => {
              const el = document.getElementById(id); el.value = value;
              el.dispatchEvent(new Event('input', {bubbles:true}));
            };
            set('heroSceneAccent', '#ab874d');
            set('heroSceneScale', '115');
            set('heroSceneMotion', 'off');
            const scene = document.getElementById('heroScenePreview');
            return {accent:scene.style.getPropertyValue('--hero-scene-accent'),
              scale:scene.style.getPropertyValue('--hero-scene-scale'),
              motion:scene.dataset.motion,
              output:document.getElementById('heroSceneScaleValue').textContent};
          })()`);
          assert.deepEqual(changed, {accent:'#ab874d',scale:'1.15',motion:'off',output:'115%'});
          await waitFor("Number(document.getElementById('heroScenePreview')?.dataset.printProgress) === 1");
          const stopped = await evaluate(headPosition);
          await new Promise((resolve) => setTimeout(resolve, 250));
          assert.deepEqual(await evaluate(headPosition), stopped, `${portal} ${width}: motion off freezes the preview`);
          assert.equal(stopped.fan, 'none', `${portal} ${width}: cooling fan stops`);
          await evaluate("document.getElementById('btnSaveAllHome').click()");
          await waitFor('window.fixtureWrites.length === 1');
          const payload = await evaluate('window.fixtureWrites[0]');
          assert.equal(payload.hero_scene_accent, '#ab874d');
          assert.equal(payload.hero_scene_scale, 115);
          assert.equal(payload.hero_scene_motion, 'off');
          assert.equal(Object.hasOwn(payload, 'hero_logo_image'), false);
          await cdp.send('Emulation.setEmulatedMedia', { features:[{name:'prefers-reduced-motion',value:'reduce'}] });
          await evaluate(`(() => {
            const el = document.getElementById('heroSceneMotion'); el.value = 'on';
            el.dispatchEvent(new Event('input', {bubbles:true}));
          })()`);
          await waitFor("document.getElementById('heroScenePreview').dataset.motion === 'on'");
          await new Promise((resolve) => setTimeout(resolve, 250));
          assert.deepEqual(await evaluate(headPosition), stopped, `${portal} ${width}: reduced motion holds preview still`);
          await cdp.send('Emulation.setEmulatedMedia', { features:[] });
          if (process.env.FMRC_KEEP_SHOTS === '1') {
            await evaluate("document.getElementById('heroScenePreview').scrollIntoView({block:'center'})");
            const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
            fs.writeFileSync(path.join(artifacts, `${portal}-${width}.png`), Buffer.from(shot.data, 'base64'));
          }
        }
      }
      if (process.env.FMRC_KEEP_SHOTS === '1') console.log(`Screenshots: ${artifacts}`);
    } finally {
      cdp?.close();
      browser.kill();
      await new Promise((resolve) => browser.once('exit', resolve));
      await new Promise((resolve) => server.close(resolve));
      if (process.env.FMRC_KEEP_SHOTS !== '1') {
        const resolved = path.resolve(artifacts);
        if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
          fs.rmSync(resolved, { recursive: true, force: true });
        }
      }
    }
  });
