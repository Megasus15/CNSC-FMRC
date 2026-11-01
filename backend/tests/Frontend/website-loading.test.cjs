const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../../admin-page/website-loading.js'), 'utf8');
const requestCode = source.slice(0, source.indexOf('  const selector =')) + '})();';

function harness(fetch) {
  const deadlines = [];
  const requests = [];
  const window = { fetch: async (input, options) => {
    requests.push({ input, options });
    return fetch ? fetch(input, options) : new Response('{}');
  } };
  const context = vm.createContext({
    window, document: { baseURI: 'https://fmrc.test/admin-page/website-about', addEventListener() {} },
    URL, Request, AbortController, DOMException,
    AbortSignal: {
      timeout(milliseconds) {
        const controller = new AbortController();
        deadlines.push({ milliseconds, controller });
        return controller.signal;
      },
      any: AbortSignal.any.bind(AbortSignal),
    },
  });
  vm.runInContext(requestCode, context);
  return { window, deadlines, requests, context };
}

test('Website Management requests video references and preserves headers, query filters and explicit modes', async () => {
  const h = harness();
  await h.window.fetch('/api/site-settings?existing=1', { headers: { Accept: 'application/json' } });
  const url = new URL(h.requests[0].input);
  assert.equal(url.searchParams.get('media'), 'references');
  assert.equal(url.searchParams.get('existing'), '1');
  assert.equal(h.requests[0].options.headers.Accept, 'application/json');
  assert.equal(h.deadlines[0].milliseconds, 30000);
  await h.window.fetch('/api/site-settings?media=inline');
  assert.equal(h.requests[1].input, '/api/site-settings?media=inline');
});

test('write requests retain their payload and authorization with a bounded upload deadline', async () => {
  const h = harness();
  const body = JSON.stringify({ about_heading: 'Updated title' });
  await h.window.fetch('/api/admin/site-settings', { method: 'PUT', body, headers: { Authorization: 'Bearer fixture-only' } });
  assert.equal(h.requests[0].input, '/api/admin/site-settings');
  assert.equal(h.requests[0].options.body, body);
  assert.equal(h.requests[0].options.headers.Authorization, 'Bearer fixture-only');
  assert.equal(h.deadlines[0].milliseconds, 120000);
});

test('a stalled settings body is aborted even after successful response headers', async () => {
  let stream;
  const h = harness((_input, options) => {
    const body = new ReadableStream({ start(controller) { stream = controller; controller.enqueue(new TextEncoder().encode('{"data":')); } });
    options.signal.addEventListener('abort', () => stream.error(options.signal.reason), { once: true });
    return new Response(body, { headers: { 'Content-Type': 'application/json' } });
  });
  const response = await h.window.fetch('/api/site-settings');
  const reading = response.json();
  h.deadlines[0].controller.abort(new DOMException('Request timed out.', 'TimeoutError'));
  await assert.rejects(reading, { name: 'TimeoutError' });
});

test('caller cancellation still reaches the underlying request', async () => {
  const h = harness((_input, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  }));
  const controller = new AbortController();
  const reading = h.window.fetch('/api/services', { signal: controller.signal });
  controller.abort();
  await assert.rejects(reading, { name: 'AbortError' });
});

test('Request objects retain their headers while settings URLs become compact', async () => {
  const h = harness();
  await h.window.fetch(new Request('https://fmrc.test/api/site-settings', { headers: { 'If-None-Match': 'fixture-etag' } }));
  const request = h.requests[0].input;
  assert(request instanceof Request);
  assert.equal(new URL(request.url).searchParams.get('media'), 'references');
  assert.equal(request.headers.get('If-None-Match'), 'fixture-etag');
});

test('non-API media requests and an already initialized loader are left alone', async () => {
  const h = harness();
  await h.window.fetch('/images/example.png');
  assert.equal(h.requests[0].input, '/images/example.png');
  assert.equal(h.deadlines.length, 0);
  const wrapper = h.window.fetch;
  h.window.AdminWebsiteLoading = {};
  vm.runInContext(requestCode, h.context);
  assert.equal(h.window.fetch, wrapper);
});
