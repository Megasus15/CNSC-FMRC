// Browser regression for the real Customer Home markup/CSS with fixture API data.
// Run with: node --test backend/tests/Frontend/hero-printer-scene.browser.cjs
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
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

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
    const request = pending.get(reply.id);
    if (!request) return;
    pending.delete(reply.id);
    reply.error ? request.reject(new Error(JSON.stringify(reply.error))) : request.resolve(reply.result);
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

test('Customer Home 3D printer scene fits desktop and modern iPhones and applies saved settings',
  { skip: !chrome, timeout: 90000 }, async () => {
    let settings = {
      hero_title: 'Ideas take shape here.',
      hero_scene_accent: '#e6c46c', hero_scene_scale: 100, hero_scene_motion: 'on',
    };
    const server = http.createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname.startsWith('/api/')) {
        const result = pathname.endsWith('/maintenance')
          ? { installed: true, site_page: {}, data: { site_portal: { active: false } } }
          : { data: pathname.endsWith('/site-settings') ? settings : [] };
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify(result));
        return;
      }
      const absolute = path.resolve(repo, '.' + pathname);
      if (!absolute.startsWith(repo + path.sep) || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, { 'Content-Type': mime[path.extname(absolute)] || 'application/octet-stream' });
      fs.createReadStream(absolute).pipe(response);
    });
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fmrc-home-printer-'));
    const shots = process.env.FMRC_KEEP_SHOTS === '1'
      ? fs.mkdtempSync(path.join(os.tmpdir(), 'fmrc-printer-shots-')) : null;
    let browser;
    let cdp;
    try {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      browser = spawn(chrome, [
        '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
        '--no-default-browser-check', '--disable-background-networking',
        '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
      ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      const endpoint = await new Promise((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => reject(new Error('Chrome startup timeout: ' + output)), 15000);
        browser.stderr.on('data', (chunk) => {
          output += chunk;
          const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
          if (match) { clearTimeout(timer); resolve(match[1]); }
        });
        browser.once('error', reject);
      });
      const debugPort = new URL(endpoint).port;
      const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      cdp = await connect(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `window.APP_API_BASE_URL = location.origin + '/api';
          const nativeFetch = window.fetch.bind(window);
          window.fetch = (input, init) => {
            const url = new URL(typeof input === 'string' ? input : input.url, location.href);
            return nativeFetch(url.pathname.startsWith('/api/')
              ? location.origin + url.pathname + url.search : input, init);
          };
          // Keep normal RAF behavior for layout checks, then drive five complete
          // builds deterministically without a production-only testing API.
          (() => {
            const request = window.requestAnimationFrame.bind(window);
            const cancel = window.cancelAnimationFrame.bind(window);
            const pending = new Map();
            let controlled = false, time = 0, next = 0;
            window.requestAnimationFrame = callback => {
              const id = ++next, entry = { callback, native:0 };
              pending.set(id, entry);
              if (!controlled) entry.native = request(now => {
                pending.delete(id);
                callback(now);
              });
              return id;
            };
            window.cancelAnimationFrame = id => {
              const entry = pending.get(id);
              if (entry?.native) cancel(entry.native);
              pending.delete(id);
            };
            window.__heroTestClock = {
              start() {
                controlled = true;
                time = performance.now();
                for (const entry of pending.values()) if (entry.native) cancel(entry.native);
              },
              advance(duration) {
                for (let remaining = duration; remaining > 0;) {
                  const step = Math.min(16, remaining);
                  time += step;
                  remaining -= step;
                  const callbacks = [...pending.values()];
                  pending.clear();
                  for (const entry of callbacks) entry.callback(time);
                }
              }
            };
          })();`,
      });
      await cdp.send('Network.enable');
      await cdp.send('Network.setBlockedURLs', { urls: ['https://*'] });
      const evaluate = async (expression) => {
        const reply = await cdp.send('Runtime.evaluate', {
          expression, returnByValue: true, awaitPromise: true,
        });
        if (reply.exceptionDetails) throw new Error(JSON.stringify(reply.exceptionDetails));
        return reply.result.value;
      };
      const waitFor = async (expression) => {
        for (let attempt = 0; attempt < 100; attempt++) {
          if (await evaluate(expression)) return;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error(`Home did not reach: ${expression}`);
      };

      for (const [width, height] of [
        [320, 568], [390, 844], [430, 932],
        [667, 375], [844, 390], [932, 430], [1440, 900], [1920, 1080],
      ]) {
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width, height, deviceScaleFactor: 1, mobile: width < 1000,
        });
        await cdp.send('Page.navigate', {
          url: `http://127.0.0.1:${server.address().port}/home-page/main.html`,
        });
        await waitFor(`document.readyState === 'complete' &&
          !document.querySelector('.fmrc-load-boot') &&
          document.querySelector('img.hero-printer-art')?.naturalWidth > 0 &&
          document.getElementById('heroPrinterScene')?.dataset.mechanism === 'ready' &&
          document.getElementById('heroLogoEl')?.naturalWidth > 0 &&
          document.getElementById('heroPrinterScene')?.style.getPropertyValue('--hero-scene-accent') === '#e6c46c' &&
          document.getElementById('heroTitleEl')?.getAttribute('aria-busy') !== 'true'`);
        const state = await evaluate(`(() => {
          const scene = document.getElementById('heroPrinterScene');
          const title = document.getElementById('heroTitleEl');
          const art = scene.querySelector('.hero-printer-art');
          const logo = document.getElementById('heroLogoEl');
          const badge = scene.querySelector('.hero-printer-badge');
          const mechanics = JSON.parse(scene.querySelector('#hp-mechanics').textContent);
          const sr = scene.getBoundingClientRect(), tr = title.getBoundingClientRect();
          const br = badge.getBoundingClientRect(), bs = getComputedStyle(badge);
          const matrix = new DOMMatrix(bs.transform), unit = sr.width / 960;
          const center = [(br.left + br.right) / 2, (br.top + br.bottom) / 2];
          const toScene = ([x,y]) => [(x - sr.left) / unit, (y - sr.top) / unit];
          const halfWidth = parseFloat(bs.width) / 2, halfHeight = parseFloat(bs.height) / 2;
          const corners = [[-halfWidth,-halfHeight],[halfWidth,-halfHeight],
            [halfWidth,halfHeight],[-halfWidth,halfHeight]].map(([x,y]) =>
              toScene([center[0]+matrix.a*x+matrix.c*y, center[1]+matrix.b*x+matrix.d*y]));
          return {
            title: title.textContent.replace(/\\s+/g, ' ').trim(),
            browse: document.querySelector('.btn-browse').textContent.trim(),
            browseHref: document.querySelector('.btn-browse').getAttribute('href'),
            appointment: document.querySelector('.btn-appointment').textContent.trim(),
            art: art.naturalWidth, logo: logo.naturalWidth,
            logoSrc: logo.getAttribute('src'), scrollWidth: document.documentElement.scrollWidth,
            scene: {left:sr.left, right:sr.right, top:sr.top, bottom:sr.bottom, width:sr.width},
            titleTop: tr.top, sceneTopStyle: getComputedStyle(scene).top,
            accent: scene.style.getPropertyValue('--hero-scene-accent'),
            scale: scene.style.getPropertyValue('--hero-scene-scale'), motion: scene.dataset.motion,
            badge: {center:toScene(center), corners, matrix:[matrix.a,matrix.b,matrix.c,matrix.d],
              localSize:[halfWidth * 2 / unit,halfHeight * 2 / unit],
              expected:{...mechanics.logo, y:mechanics.logo.y + Number(scene.dataset.bedOffset || 0)},
              face:mechanics.logoFace.map(([x,y]) => [x,y + Number(scene.dataset.bedOffset || 0)])},
          };
        })()`);
        const size = `${width}x${height}`;
        assert.equal(state.title.toLowerCase(), 'ideas take shape here.', `${size}: headline preserved`);
        assert.equal(state.browse, 'Browse Products', `${size}: Browse CTA preserved`);
        assert.equal(state.browseHref, '/products-page/product.html', `${size}: Browse destination preserved`);
        assert.equal(state.appointment, 'Appoint Now!', `${size}: appointment CTA preserved`);
        assert.ok(state.art > 0 && state.logo > 0, `${size}: printer artwork and logo load`);
        assert.equal(state.logoSrc, '/images/FMRC Logo.png', `${size}: transparent FMRC mark`);
        assert.ok(Math.hypot(state.badge.center[0] - state.badge.expected.x,
          state.badge.center[1] - state.badge.expected.y) < 0.25,
          `${size}: logo center follows the actual printed face`);
        state.badge.matrix.forEach((value, index) => assert.ok(
          Math.abs(value - state.badge.expected.matrix[index]) < 0.0001,
          `${size}: logo uses the machine's full face projection`));
        assert.ok(Math.abs(state.badge.localSize[0] - state.badge.expected.width) < 0.25 &&
          Math.abs(state.badge.localSize[1] - state.badge.expected.height) < 0.25,
          `${size}: logo uses the face's local dimensions before projection`);
        for (const [x,y] of state.badge.corners) {
          const sides = state.badge.face.map(([fx,fy], edge) => {
            const [nx,ny] = state.badge.face[(edge + 1) % state.badge.face.length];
            return (nx - fx) * (y - fy) - (ny - fy) * (x - fx);
          });
          assert.ok(sides.every(side => side >= -0.5) || sides.every(side => side <= 0.5),
            `${size}: all four projected logo corners fit within its recessed print face`);
        }
        assert.ok(state.scene.width > 0, `${size}: scene is visible`);
        assert.ok(state.scene.left >= -2 && state.scene.right <= width + 2, `${size}: scene fits horizontally`);
        assert.ok(state.scrollWidth <= width + 1, `${size}: no horizontal overflow`);
        if (width < 1000) {
          assert.ok(state.scene.bottom <= state.titleTop + 2, `${size}: scene stays above headline`);
        }
        if (width === 1440) {
          assert.ok(parseFloat(state.sceneTopStyle) > 0,
            `${size}: only the artwork moves to clear an unbroken headline`);
        }
        assert.equal(state.accent, '#e6c46c');
        assert.equal(state.scale, '1');
        assert.equal(state.motion, 'on');
        if (shots && [320, 390, 430, 1440, 1920].includes(width)) {
          const originalTitle = settings.hero_title;
          settings = { ...settings, hero_title:'ONLINE MARKET\nPLACE AND\nSERVICE SOLUTION' };
          assert.equal(await evaluate('window.FMRC_REFRESH_SITE_SETTINGS()'), true);
          await evaluate("window.scrollTo(0, 0)");
          assert.equal(await evaluate(`document.elementFromPoint(innerWidth/2, innerHeight/2)?.closest('.fmrc-load-boot,.fmrc-load-veil') === null`),
            true, 'integrated screenshot shows the page after its curtain lifts');
          const headline = await evaluate(`(() => {
            const title = document.getElementById('heroTitleEl');
            // Measure glyph rows only: a whole-heading range also includes the
            // last line's inline-block box, whose top differs from its text.
            const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
            const rows = [];
            for (let node; (node = walker.nextNode());) {
              if (!node.textContent.trim()) continue;
              const range = document.createRange();
              range.selectNodeContents(node);
              rows.push(...[...range.getClientRects()].filter(r => r.width > 1)
                .map(r => Math.round(r.top)));
            }
            return {breaks:title.querySelectorAll('br').length, rows:[...new Set(rows)].length};
          })()`);
          assert.equal(headline.breaks, 2, `${size}: original three-line headline markup preserved`);
          if (width >= 1440) assert.equal(headline.rows, 3, `${size}: headline remains visually three lines`);
          const viewportShot = await cdp.send('Page.captureScreenshot', {
            format:'png', captureBeyondViewport:false,
          });
          fs.writeFileSync(path.join(shots, `customer-viewport-${width}-${height}.png`), Buffer.from(viewportShot.data, 'base64'));
          const layout = await cdp.send('Page.getLayoutMetrics');
          const shot = await cdp.send('Page.captureScreenshot', {
            format: 'png', captureBeyondViewport: true,
            clip: {x:0, y:0, width:layout.cssContentSize.width, height:layout.cssContentSize.height, scale:1},
          });
          fs.writeFileSync(path.join(shots, `customer-${width}-${height}.png`), Buffer.from(shot.data, 'base64'));
          settings = { ...settings, hero_title:originalTitle };
          assert.equal(await evaluate('window.FMRC_REFRESH_SITE_SETTINGS()'), true);
        }
      }

      settings = { ...settings, hero_title: 'ONLINE MARKET\nPLACE AND\nSERVICE SOLUTION' };
      assert.equal(await evaluate('window.FMRC_REFRESH_SITE_SETTINGS()'), true);
      const multiline = await evaluate(`(() => {
        const title = document.getElementById('heroTitleEl');
        const scene = document.getElementById('heroPrinterScene');
        return {breaks: title.querySelectorAll('br').length,
          finalLineWhiteSpace: getComputedStyle(title.querySelector('.hero-research-line')).whiteSpace,
          sceneTop: getComputedStyle(scene).top};
      })()`);
      assert.deepEqual(multiline, {breaks: 2, finalLineWhiteSpace: 'nowrap', sceneTop: '0px'},
        'configured headline line breaks remain unchanged while artwork aligns beside them');

      await evaluate("document.getElementById('heroPrinterScene').scrollIntoView({block:'center'})");
      await waitFor("document.getElementById('heroPrinterScene').dataset.running === 'true'");
      // A test-controlled clock samples real rendered SVG geometry through all
      // five products, completion, removal and return to the first design.
      await evaluate("window.__heroTestClock.start(); document.getElementById('heroPrinterScene').dataset.motion = 'off'");
      await evaluate("document.getElementById('heroPrinterScene').dataset.motion = 'on'");
      const mechanismState = `(() => {
        const scene = document.getElementById('heroPrinterScene');
        const svg = scene.querySelector('.hero-printer-mechanism');
        const mechanics = JSON.parse(svg.querySelector('#hp-mechanics').textContent);
        const relativeMatrix = element => svg.getCTM().inverse().multiply(element.getCTM());
        const head = scene.querySelector('.hp-printhead');
        const matrix = relativeMatrix(head);
        const gantry = relativeMatrix(scene.querySelector('.hp-gantry'));
        const platform = relativeMatrix(scene.querySelector('.hp-build-platform'));
        const contact = head.querySelector('.hp-contact');
        const nozzle = new DOMPoint(+contact.getAttribute('cx'), +contact.getAttribute('cy'))
          .matrixTransform(relativeMatrix(contact));
        const inlet = new DOMPoint(...mechanics.feed.end).matrixTransform(matrix);
        const endpoints = [...scene.querySelectorAll('.hp-filament-flex')].map(tube => {
          const end = tube.getPointAtLength(tube.getTotalLength());
          const point = new DOMPoint(end.x, end.y).matrixTransform(relativeMatrix(tube));
          return {x:point.x, y:point.y};
        });
        const trail = scene.querySelector('.hp-deposition-path');
        const trailStyle = getComputedStyle(trail);
        const pathLength = +trail.getAttribute('pathLength') || trail.getTotalLength();
        const reveal = 1 - parseFloat(trailStyle.strokeDashoffset) / pathLength;
        const end = trail.getPointAtLength(trail.getTotalLength() * Math.max(0, Math.min(1, reveal)));
        const trailEnd = new DOMPoint(end.x, end.y).matrixTransform(relativeMatrix(trail));
        const product = scene.querySelector('.hp-product-build');
        const productStyle = getComputedStyle(product);
        const miniature = scene.querySelector('.hp-screen-product');
        const layers = [...product.querySelectorAll('.hp-product-layer')];
        const miniBounds = miniature.getBBox();
        const miniGeometry = [...miniature.querySelectorAll('path,polygon,polyline,ellipse,circle')]
          .map(el => [el.tagName,el.getAttribute('d'),el.getAttribute('points'),el.getAttribute('rx'),el.getAttribute('ry')].join(':')).join('|');
        let miniHash = 0;
        for (let i=0; i<miniGeometry.length; i++) miniHash = ((miniHash << 5) - miniHash + miniGeometry.charCodeAt(i)) | 0;
        return {x:matrix.e, y:matrix.f, nozzle:{x:nozzle.x,y:nozzle.y}, inlet:{x:inlet.x,y:inlet.y},
          gantry:{x:gantry.e,y:gantry.f}, platform:{x:platform.e,y:platform.f},
          projection:mechanics.projection, build:mechanics.build,
          cycle:+scene.dataset.printCycle, progress:+scene.dataset.printProgress,
          layer:+scene.dataset.buildLayer, buildHeight:+scene.dataset.buildHeight, bedOffset:+scene.dataset.bedOffset,
          productId:scene.dataset.productId, productName:scene.dataset.productName,
          mainId:product.dataset.productId, miniId:miniature.dataset.productId,
          miniHash, miniSize:[miniBounds.width,miniBounds.height],
          totalLayers:layers.length,
          visibleLayers:layers.filter(el => getComputedStyle(el).display !== 'none' && +getComputedStyle(el).opacity > 0).length,
          productTransform:product.getAttribute('transform'), productOpacity:productStyle.opacity,
          productVisible:productStyle.display !== 'none' && productStyle.visibility !== 'hidden' && +productStyle.opacity > 0,
          running:scene.dataset.running,
          phase:scene.dataset.printState, readout:scene.querySelector('.hp-screen-progress').textContent,
          screenFill:getComputedStyle(scene.querySelector('.hp-monitor-progress .hp-screen-background')).fill,
          fanState:getComputedStyle(scene.querySelector('.hp-fan')).animationPlayState,
          reveal, trailVisible:trailStyle.display !== 'none' && +trailStyle.opacity > 0,
          trailEnd:{x:trailEnd.x,y:trailEnd.y}, endpoints,
          fan:getComputedStyle(scene.querySelector('.hp-fan')).animationName};
      })()`;
      const samples = [];
      const captured = new Set();
      const completionSamples = new Map();
      let greenChecked = false;
      for (let index = 0; index < 500; index++) {
        await evaluate('window.__heroTestClock.advance(240)');
        const state = await evaluate(mechanismState);
        samples.push(state);
        assert.equal(state.mainId, state.productId, 'built product matches the current job');
        assert.equal(state.miniId, state.productId, 'monitor miniature matches the actual product');
        assert.ok(state.miniSize.every(value => value > 0), 'the monitor contains a dimensional miniature');
        assert.ok(state.totalLayers > 1, 'product has distinct deposited layers');
        assert.ok(state.endpoints.length > 0, 'the filament feed is visible');
        for (const endpoint of state.endpoints) {
          assert.ok(Math.hypot(endpoint.x - state.inlet.x, endpoint.y - state.inlet.y) < 0.1,
            'feed tube remains connected to the moving inlet');
        }
        assert.ok(Math.abs(state.platform.y - state.bedOffset) < 0.1 && Math.abs(state.platform.x) < 0.1,
          'heated platform follows its vertical drive without drifting sideways');
        const [ax, ay] = state.projection.xAxis, [bx, by] = state.projection.yAxis;
        const determinant = ax * by - bx * ay;
        assert.ok(Math.abs(determinant) > 0.01, 'machine projection has two independent axes');
        state.worldX = (by * state.x - bx * state.y) / determinant;
        state.worldY = (ax * state.y - ay * state.x) / determinant;
        assert.ok(Math.hypot(state.gantry.x - state.worldY * bx, state.gantry.y - state.worldY * by) < 0.15,
          'gantry follows carriage depth while the toolhead travels along its X rail');
        const previous = samples[index - 1];
        if (state.phase === 'printing' && state.progress > 0.01) {
          assert.ok(state.trailVisible, 'the active product layer receives filament');
          assert.ok(state.reveal >= -0.01 && state.reveal <= 1.01, 'active layer visibility is bounded');
          assert.ok(Math.hypot(state.trailEnd.x - state.nozzle.x, state.trailEnd.y - state.nozzle.y) < 1,
            'new filament ends at the actual moving nozzle');
          // A fixed-height CoreXY nozzle meets the current top as its platform
          // lowers. This detects a product growing through a stationary nozzle.
          const tipZ = state.build.baseZ + state.buildHeight - state.bedOffset;
          assert.ok(Math.abs(tipZ - state.build.nozzleZ) < 0.15, 'current product top stays at nozzle height');
          if (previous?.phase === 'printing' && previous.cycle === state.cycle) {
            assert.ok(state.buildHeight >= previous.buildHeight, 'product grows through deposited layers');
            assert.ok(state.bedOffset >= previous.bedOffset, 'platform descends as the product grows');
            if (state.layer === previous.layer) {
              assert.ok(state.reveal + 0.002 >= previous.reveal, 'filament persists until its layer is complete');
            }
          }
        } else if (state.phase !== 'printing') {
          assert.equal(state.trailVisible, false, 'filament stops during completion and removal');
        }
        if (state.phase === 'complete') {
          assert.equal(state.readout, '100%');
          assert.equal(state.progress, 1);
          assert.equal(state.fanState, 'paused');
          assert.equal(state.visibleLayers, state.totalLayers, 'completion shows the whole product');
          if (!greenChecked) {
            // CSS color transitions use the browser clock, independent of RAF.
            await new Promise(resolve => setTimeout(resolve, 350));
            const filled = await evaluate(mechanismState);
            const rgb = filled.screenFill.match(/[\d.]+/g).map(Number);
            assert.ok(rgb[1] > rgb[0] && rgb[1] > rgb[2], 'completed screen is green');
            greenChecked = true;
          }
          completionSamples.set(state.productId, (completionSamples.get(state.productId) || 0) + 1);
          if (shots && completionSamples.get(state.productId) === 3) {
            // Capture after the nozzle has parked; the complete product and
            // green monitor are easier to inspect than a moving partial build.
            await new Promise(resolve => setTimeout(resolve, 300));
            const bounds = await evaluate(`(() => {
              const r = document.getElementById('heroPrinterScene').getBoundingClientRect();
              return {x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height,scale:2};
            })()`);
            const shot = await cdp.send('Page.captureScreenshot', {format:'png',clip:bounds,captureBeyondViewport:true});
            fs.writeFileSync(path.join(shots, 'printer-' + state.productId + '-complete.png'), Buffer.from(shot.data, 'base64'));
          }
        }
        if (shots && state.phase === 'printing' && state.progress > 0.7 && !captured.has(state.productId)) {
          const bounds = await evaluate(`(() => {
            const r = document.getElementById('heroPrinterScene').getBoundingClientRect();
            return {x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height,scale:2};
          })()`);
          const shot = await cdp.send('Page.captureScreenshot', {format:'png',clip:bounds,captureBeyondViewport:true});
          fs.writeFileSync(path.join(shots, 'printer-' + state.productId + '.png'), Buffer.from(shot.data, 'base64'));
          captured.add(state.productId);
        }
        if (state.cycle >= 5 && state.phase === 'printing' && state.progress > 0.03) break;
      }
      const productOrder = [...new Map(samples.map(state => [state.cycle,state.productId])).values()];
      assert.deepEqual(productOrder.slice(0, 6), ['gear','vase','phone-stand','trophy','organizer','gear'],
        'five different products print before the first one repeats');
      assert.equal(new Set(samples.map(state => state.miniHash)).size, 5,
        'screen previews contain five different geometries, not just different labels');
      for (let cycle = 0; cycle < 5; cycle++) {
        const build = samples.filter(state => state.cycle === cycle);
        const completed = build.filter(state => state.phase === 'complete');
        assert.ok(completed.length >= 2, 'each finished product remains visible for a short hold');
        // Allow the initial clearance move; the final completion samples should
        // hold the parked head before the completed product is removed.
        const settled = completed.slice(-2);
        assert.ok(Math.hypot(settled[0].x - settled[1].x, settled[0].y - settled[1].y) < 0.1,
          'the parked head holds clear of the completed product');
        const exit = build.filter(state => state.phase === 'popout');
        assert.ok(exit.length >= 2 && new Set(exit.map(state => state.productTransform)).size > 1,
          'finished product exits through intermediate 3D transforms');
        assert.ok(exit.some(state => +state.productOpacity > 0 && +state.productOpacity < 1),
          'removal fades smoothly instead of vanishing in one frame');
        const reset = build.filter(state => state.phase === 'resetting');
        assert.ok(reset.length >= 2 && reset.some(state => state.progress > 0.1 && state.progress < 0.9),
          'reset includes a visible intermediate draining progress bar');
        assert.ok(reset.every(state => !state.productVisible), 'pedestal clears before the next product starts');
        for (let index = 1; index < reset.length; index++) {
          assert.ok(reset[index].progress < reset[index - 1].progress, 'bar drains during reset');
        }
        assert.ok(build.some(state => state.phase === 'printing' && state.progress < 0.1),
          'each product begins with an initial build stage');
      }
      assert.equal(samples.find(state => state.phase === 'printing').fan, 'fmrcPrinterFan',
        'print-head fan runs while printing');

      // Suspension checks assert behavior, not machine-specific frame budgets.
      const pose = state => ({x:state.x,y:state.y,platform:state.platform,cycle:state.cycle,
        progress:state.progress,productId:state.productId,layer:state.layer});
      const scrolling = await evaluate(`(() => {
        window.dispatchEvent(new Event('scroll'));
        const before = ${mechanismState};
        window.__heroTestClock.advance(700);
        return {before,after:${mechanismState}};
      })()`);
      assert.equal(scrolling.after.running, 'false', 'scrolling suspends the printer controller');
      assert.equal(scrolling.after.fanState, 'paused', 'scrolling also suspends the fan');
      assert.deepEqual(pose(scrolling.after), pose(scrolling.before),
        'scrolling preserves the current product and exact mechanical pose');
      await waitFor("document.getElementById('heroPrinterScene').dataset.running === 'true'");
      const scrollResumed = await evaluate(`(() => {
        const before = ${mechanismState};
        window.__heroTestClock.advance(500);
        return {before,after:${mechanismState}};
      })()`);
      assert.ok(scrollResumed.after.progress > scrollResumed.before.progress,
        'printing resumes after scrolling settles');

      await evaluate('window.scrollTo(0, document.documentElement.scrollHeight)');
      await waitFor(`document.getElementById('heroPrinterScene').getBoundingClientRect().bottom < 0 &&
        document.getElementById('heroPrinterScene').dataset.running === 'false'`);
      await new Promise(resolve => setTimeout(resolve, 200));
      const offscreen = await evaluate(`(() => {
        const before = ${mechanismState};
        window.__heroTestClock.advance(1000);
        return {before,after:${mechanismState}};
      })()`);
      assert.equal(offscreen.after.running, 'false', 'offscreen printer stays suspended after scroll settles');
      assert.equal(offscreen.after.fanState, 'paused', 'offscreen fan stays paused');
      assert.deepEqual(pose(offscreen.after), pose(offscreen.before), 'offscreen product does not advance');
      await evaluate("document.getElementById('heroPrinterScene').scrollIntoView({block:'center'})");
      await waitFor("document.getElementById('heroPrinterScene').dataset.running === 'true'");
      const visibleAgain = await evaluate(`(() => {
        const before = ${mechanismState};
        window.__heroTestClock.advance(500);
        return {before,after:${mechanismState}};
      })()`);
      assert.ok(visibleAgain.after.progress > visibleAgain.before.progress,
        'visible printer resumes its existing product');
      assert.equal(visibleAgain.after.productId, offscreen.before.productId,
        'visibility changes preserve the build queue');

      settings = { ...settings,
        hero_scene_accent: '#ab874d', hero_scene_scale: 115, hero_scene_motion: 'off',
      };
      assert.equal(await evaluate('window.FMRC_REFRESH_SITE_SETTINGS()'), true);
      const customized = await evaluate(`(() => {
        const scene = document.getElementById('heroPrinterScene');
        return {accent: scene.style.getPropertyValue('--hero-scene-accent'),
          scale: scene.style.getPropertyValue('--hero-scene-scale'),
          motion: scene.dataset.motion, animation: getComputedStyle(scene).animationName};
      })()`);
      assert.deepEqual(customized, {
        accent: '#ab874d', scale: '1.15', motion: 'off', animation: 'none',
      }, 'published scene settings apply on refresh');
      await waitFor("Number(document.getElementById('heroPrinterScene')?.dataset.printProgress) === 1");
      await new Promise((resolve) => setTimeout(resolve, 350));
      const stopped = await evaluate(mechanismState);
      await new Promise((resolve) => setTimeout(resolve, 350));
      assert.deepEqual(await evaluate(mechanismState), stopped,
        'motion off holds the toolhead and gantry still and keeps the feed tube connected');
      assert.equal(stopped.fan, 'none', 'motion off stops the fan');
      assert.equal(stopped.productId, 'gear', 'motion off presents the first product');
      assert.equal(stopped.visibleLayers, stopped.totalLayers, 'motion off retains a complete dimensional product');
      if (shots) {
        const bounds = await evaluate(`(() => {
          const r = document.getElementById('heroPrinterScene').getBoundingClientRect();
          return {x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height,scale:2};
        })()`);
        const shot = await cdp.send('Page.captureScreenshot', {format:'png', clip:bounds, captureBeyondViewport:true});
        fs.writeFileSync(path.join(shots, 'printer-current.png'), Buffer.from(shot.data, 'base64'));
      }

      settings = { ...settings, hero_scene_motion: 'on' };
      await cdp.send('Emulation.setEmulatedMedia', { features:[{name:'prefers-reduced-motion',value:'reduce'}] });
      assert.equal(await evaluate('window.FMRC_REFRESH_SITE_SETTINGS()'), true);
      await waitFor("Number(document.getElementById('heroPrinterScene')?.dataset.printProgress) === 1");
      const reduced = await evaluate(mechanismState);
      await new Promise((resolve) => setTimeout(resolve, 350));
      assert.deepEqual(await evaluate(mechanismState), reduced, 'reduced motion freezes the printing pass');
      assert.equal(reduced.fan, 'none', 'reduced motion stops the fan');
      await cdp.send('Emulation.setEmulatedMedia', { features:[] });
      if (shots) console.log(`Screenshots: ${shots}`);
    } finally {
      cdp?.close();
      if (browser) {
        await new Promise((resolve) => {
          if (browser.exitCode !== null) return resolve();
          browser.once('exit', resolve);
          browser.kill();
          setTimeout(resolve, 2000).unref();
        });
      }
      if (server.listening) await new Promise((resolve) => server.close(resolve));
      const tempRoot = path.resolve(os.tmpdir());
      if (path.resolve(profile).startsWith(tempRoot + path.sep)) {
        fs.rmSync(profile, { recursive: true, force: true });
      }
    }
  });
