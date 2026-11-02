const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../..');

function harness(page, mode) {
  const markup = fs.readFileSync(path.join(root, `admin-page/website-${page}.html`), 'utf8');
  const nodes = new Map([...markup.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, {
    value: '', checked: false, hidden: false, disabled: false, textContent: '', innerHTML: '',
    addEventListener() {}, setAttribute() {}, querySelectorAll() { return []; },
  }]));
  let work, timeout, popup;
  const context = {
    location: { hostname: 'example.test', origin: 'https://example.test' },
    document: { getElementById: id => nodes.get(id), querySelectorAll: () => [], addEventListener: (_, callback) => callback() },
    window: { AdminSession: { getToken: () => 'fixture' }, AdminWebsiteLoading: { during: callback => (work = callback()) },showAdminPopup:(message,options)=>{popup={message,options};} },
    AbortController, Intl, setTimeout: callback => { timeout = callback; return 1; }, clearTimeout() {},
    fetch: async (_, options) => {
      if (mode === 'timeout') return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => { const error = new Error('Aborted'); error.name = 'AbortError'; reject(error); });
      });
      return { ok: mode === 200, status: mode, json: async () => mode === 200 ? {} : { message: 'Settings are temporarily unavailable. Please try again later.' } };
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, `admin-page/website-${page}.js`), 'utf8'), context);
  return { nodes, done: () => work, expire: () => timeout(), get popup(){return popup;} };
}

for (const page of ['shipping', 'policies']) {
  for (const mode of [503, 401, 403, 200, 'timeout']) {
    test(`${page}: ${mode} releases loading, explains failure and keeps saving disabled`, async () => {
      const h = harness(page, mode);
      if (mode === 'timeout') h.expire();
      await h.done();
      const shipping = page === 'shipping';
      const error = shipping?h.popup.message:h.nodes.get('policySettingsErrorText').textContent;
      assert.match(error, mode === 'timeout' ? /timed out/ : mode === 401 ? /Sign in again/ : mode === 403 ? /permission/ : mode === 200 ? /could not be loaded/ : /temporarily unavailable/);
      assert.equal(h.nodes.get(shipping ? 'shippingSave' : 'policyDraftSave').disabled, true);
      assert.equal(h.nodes.get(shipping ? 'shippingRefresh' : 'policySettingsRetry').disabled, false);
      assert.match(h.nodes.get(shipping ? 'shippingPublished' : 'policyPublishedMessage').textContent, /unavailable/);
      assert.doesNotMatch(h.nodes.get(shipping ? 'shippingSaveStatus' : 'policySaveStatus').textContent, /Loading|Saving|saved/);
    });
  }
}
