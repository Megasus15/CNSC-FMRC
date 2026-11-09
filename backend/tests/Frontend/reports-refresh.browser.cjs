const test = require('node:test');
const assert = require('node:assert/strict');
const { browserFixture, chrome } = require('./helpers/website-browser.cjs');

const report = (category, revision) => ({
  report: {
    id: 'RPT-REFRESH', title: 'Live report', category, period: 'monthly',
    period_label: 'November 2026', timezone: 'Asia/Manila',
    generated_at: '2026-11-09T09:00:00+08:00',
    snapshot_at: `2026-11-09T09:${String(revision).padStart(2, '0')}:00+08:00`,
    generated_by: 'Records Officer',
  },
  metrics: [{ label: 'Revision', value: revision, format: 'integer' }],
  table: {
    title: 'Requests', columns: [{ key: 'name', label: 'Request' }],
    rows: Array.from({ length: 12 }, (_, i) => ({ name: `Request ${i + 1} revision ${revision}` })),
  },
  additional_tables: [{
    title: 'Financial entries', columns: [{ key: 'name', label: 'Entry' }],
    rows: Array.from({ length: 27 }, (_, i) => ({ name: `Entry ${i + 1} revision ${revision}` })),
  }],
});

test('Admin and Staff reports recover from delayed, timed-out and interrupted automatic refreshes', {
  skip: !chrome, timeout: 90000,
}, async t => {
  let revision = 1, mode = 'success', release = null;
  const requests = [];
  const h = await browserFixture(t, async ({ req, res, route, json }) => {
    if (!['/api/admin/reports', '/api/admin/reports/generate'].includes(route)) return false;
    let body = '';
    for await (const chunk of req) body += chunk;
    const params = req.method === 'POST' ? JSON.parse(body) : Object.fromEntries(new URL(req.url, 'http://local').searchParams);
    const requestMode = mode;
    requests.push({ method: req.method, category: params.category, mode: requestMode });
    const data = report(params.category, revision);
    if (requestMode === 'body-held') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.write('{"data":');
    }
    if (['held', 'body-held'].includes(requestMode)) await new Promise(resolve => { release = resolve; });
    if (requestMode === 'body-held') res.end(JSON.stringify(data) + '}');
    else if (requestMode === 'malformed') json({ data: {} });
    else if (requestMode === 'rate-limited') json({ message: 'Report service busy' }, 429, { 'Retry-After': '90' });
    else json({ data });
    return true;
  });
  await h.send('Network.setBlockedURLs', { urls: ['https://*'] });
  // Control only Reports' own timers; exercise real fetch, abort, DOM and shared
  // portal scripts without waiting 20 seconds for every failure scenario.
  await h.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    (() => {
      const nativeTimeout = window.setTimeout, nativeInterval = window.setInterval;
      const nativeClearTimeout = window.clearTimeout, nativeClearInterval = window.clearInterval;
      const nativeNow = Date.now;
      let elapsed = 0;
      Date.now = () => nativeNow() + elapsed;
      let id = 1000000000;
      window.reportTimers = new Map();
      const wrap = (native, interval) => (callback, delay, ...args) => {
        if (delay >= 20000 && /\\/reports\\.js[?:]/.test(new Error().stack)) {
          const key = ++id;
          reportTimers.set(key, { callback: () => callback(...args), delay, interval });
          return key;
        }
        return native(callback, delay, ...args);
      };
      window.setTimeout = wrap(nativeTimeout, false);
      window.setInterval = wrap(nativeInterval, true);
      window.clearTimeout = key => { reportTimers.delete(key); nativeClearTimeout(key); };
      window.clearInterval = key => { reportTimers.delete(key); nativeClearInterval(key); };
      window.fireReportTimer = delay => {
        const timer = [...reportTimers].find(([, item]) => item.delay === delay);
        if (!timer) throw Error('Missing Reports timer ' + delay);
        if (!timer[1].interval) reportTimers.delete(timer[0]);
        elapsed += delay;
        timer[1].callback();
      };
    })();
  ` });
  for (const portal of ['admin', 'staff']) {
    // The first load can fail too: its filters must survive for automatic retry.
    mode = 'malformed'; revision = 1;
    await h.go(`/${portal}-page/reports.html`);
    await h.until(`!document.getElementById('reportPageMessage').hidden&&!document.getElementById('reportRefreshBtn').disabled`);
    mode = 'success';
    await h.run('fireReportTimer(30000)');
    await h.until(`document.getElementById('reportTableBody').textContent.includes('revision 1')`);
    await h.run(`document.querySelector('[data-report-category="custom_products"]').click();document.getElementById('reportGenerateBtn').click()`);
    await h.until(`!document.getElementById('reportGenerateBtn').disabled`);
    await h.run(`document.getElementById('reportSectionSelect').value='1';document.getElementById('reportSectionSelect').dispatchEvent(new Event('change'));document.getElementById('reportNextPage').click();document.getElementById('reportNextPage').click()`);
    await h.until(`document.getElementById('reportPageNumber').value==='3'`);

    mode = 'held'; revision = 2;
    const before = requests.length;
    await h.run('fireReportTimer(30000)');
    await h.until(`reportTimers.size>0`);
    await h.until(`Array.from(reportTimers.values()).some(timer=>timer.delay===20000)`);
    assert.equal(await h.run(`document.getElementById('reportRefreshBtn').disabled`), false, `${portal}: background refresh must leave manual refresh usable`);
    assert.equal(await h.run(`document.getElementById('reportGenerateBtn').disabled`), false, 'A slow poll must not lock report generation');
    assert.equal(await h.run(`document.getElementById('reportSectionSelect').disabled`), false);
    // A genuine change arriving during the read must be coalesced, not dropped.
    await h.run(`for(let i=0;i<6;i++)dispatchEvent(new CustomEvent('fmrc:custom-product-updated'))`);
    await h.pause(650);
    assert.equal(requests.length, before + 1, 'No concurrent report reads');
    mode = 'success'; release(); release = null;
    await h.until(`document.getElementById('reportTableBody').textContent.includes('revision 2')`);
    await h.pause(700);
    assert.equal(requests.length, before + 2, 'The queued change gets one follow-up read');
    assert.equal(await h.run(`document.getElementById('reportSectionSelect').value`), '1');
    assert.equal(await h.run(`document.getElementById('reportPageNumber').value`), '3', 'The selected detail table determines page count');
    assert.equal(await h.run(`document.getElementById('reportLastUpdated').dateTime`), '2026-11-09T09:02:00+08:00');

    mode = 'body-held'; revision = 3;
    await h.run('fireReportTimer(30000)');
    await h.until(`Array.from(reportTimers.values()).some(timer=>timer.delay===20000)`);
    for (let i = 0; !release && i < 150; i++) await h.pause(20);
    assert.equal(typeof release, 'function', 'The JSON body is stalled after headers have arrived');
    await h.run('fireReportTimer(20000)');
    await h.until(`!document.getElementById('reportPageMessage').hidden`);
    assert.match(await h.run(`document.getElementById('reportTableBody').textContent`), /revision 2/);
    assert.equal(await h.run(`document.getElementById('reportRefreshBtn').disabled`), false, 'Timeout releases controls');
    assert.match(await h.run(`document.getElementById('reportPageMessage').textContent`), /retry/i);
    mode = 'success'; release?.(); release = null;
    await h.run('fireReportTimer(30000)');
    await h.until(`document.getElementById('reportTableBody').textContent.includes('revision 3')&&document.getElementById('reportPageMessage').hidden`);

    mode = 'malformed'; revision = 4;
    await h.run('fireReportTimer(30000)');
    await h.until(`!document.getElementById('reportPageMessage').hidden`);
    assert.match(await h.run(`document.getElementById('reportTableBody').textContent`), /revision 3/, 'An incomplete response cannot erase a good report');
    mode = 'success';
    await h.run(`dispatchEvent(new Event('online'))`);
    await h.until(`document.getElementById('reportTableBody').textContent.includes('revision 4')`);
    assert.equal(await h.run(`document.getElementById('reportPageMessage').hidden`), true);

    // An explicit refresh takes priority; the late older response is discarded.
    mode = 'held'; revision = 5;
    await h.run('fireReportTimer(30000)');
    await h.until(`Array.from(reportTimers.values()).some(timer=>timer.delay===20000)`);
    await h.until(`!document.getElementById('reportRefreshBtn').disabled`);
    // Wait until the fixture has accepted the request before changing its mode.
    for (let i = 0; !release && i < 150; i++) await h.pause(20);
    assert.equal(typeof release, 'function');
    const releaseOlder = release; release = null;
    mode = 'success'; revision = 6;
    await h.run(`document.getElementById('reportRefreshBtn').click()`);
    await h.until(`document.getElementById('reportTableBody').textContent.includes('revision 6')&&!document.getElementById('reportRefreshBtn').disabled`);
    releaseOlder();
    await h.pause(100);
    assert.match(await h.run(`document.getElementById('reportTableBody').textContent`), /revision 6/, 'A superseded response cannot replace the newer snapshot');

    // Both ordinary appointments and custom reports receive appointment signals.
    await h.run(`document.querySelector('[data-report-category="appointments"]').click();document.getElementById('reportGenerateBtn').click()`);
    await h.until(`!document.getElementById('reportGenerateBtn').disabled`);
    revision = 7;
    await h.run(`dispatchEvent(new CustomEvent('fmrc:appointments-updated'))`);
    await h.until(`document.getElementById('reportTableBody').textContent.includes('revision 7')`);

    mode = 'rate-limited'; revision = 8;
    await h.run('fireReportTimer(30000)');
    await h.until(`!document.getElementById('reportPageMessage').hidden`);
    const limitedRequests = requests.length;
    await h.run(`dispatchEvent(new CustomEvent('fmrc:appointments-updated'))`);
    await h.pause(650);
    assert.equal(requests.length, limitedRequests, 'Change signals respect server retry backoff');
    assert.equal(await h.run(`Array.from(reportTimers.values()).some(timer=>timer.delay>80000&&timer.delay<=90000)`), true, 'Retry-After controls the next automatic attempt');
    mode = 'success';
    await h.run(`fireReportTimer(Array.from(reportTimers.values()).find(timer=>timer.delay>80000).delay)`);
    await h.until(`document.getElementById('reportTableBody').textContent.includes('revision 8')&&document.getElementById('reportPageMessage').hidden`);
    assert.deepEqual(await h.run('fixtureErrors'), []);
    await h.shot(`${portal}-reports-refresh`);
  }
  assert.equal(requests.filter(item => item.method === 'POST').length, 4, 'Automatic recovery never creates generation audit entries');
  t.diagnostic('Reports refresh screenshots: ' + h.artifacts);
});
