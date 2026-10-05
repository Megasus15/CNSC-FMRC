const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const repo = path.resolve(__dirname, '../../..');
const emailSource = fs.readFileSync(path.join(repo, 'admin-page/website-emails.js'), 'utf8');
const settle = () => new Promise((resolve) => setImmediate(resolve));

function element() {
  const listeners = new Map();
  return {
    value: '', textContent: '', innerHTML: '', disabled: false, hidden: false,
    style: {}, dataset: {}, classList: { toggle() {} },
    addEventListener(type, callback) {
      const callbacks = listeners.get(type) || [];
      callbacks.push(callback);
      listeners.set(type, callbacks);
    },
    emit(type, extra = {}) {
      return Promise.all((listeners.get(type) || []).map((callback) => callback({ type, target: this, preventDefault() {}, ...extra })));
    },
  };
}

async function emailHarness(t) {
  const elements = new Map();
  const field = (id) => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const document = Object.assign(element(), {
    hidden: false, getElementById: field, querySelector: () => null,
    createElement: () => element(),
  });
  const timers = new Set();
  t.after(() => { for (const timer of timers) clearTimeout(timer); });
  const channels = [];
  const broadcasts = [];
  const requests = [];
  const row = {
    slug: 'order_received', label: 'Order received', group: 'Orders', saved: {}, tokens: [],
    defaults: { header_title: 'UCN-FMRC', header_subtitle: 'Your order', header_color: '#800000', body_heading: 'Order received', body_text: 'Your order is ready for review.', footer_note: 'Thank you.' },
  };
  const window = Object.assign(element(), {
    location: { protocol: 'https:', hostname: 'fmrc.test', origin: 'https://fmrc.test', port: '' },
    AdminSession: { getToken: () => 'admin-token' },
    setTimeout(callback, delay) { const timer = setTimeout(callback, delay); timers.add(timer); return timer; },
    clearTimeout,
    showAdminConfirmPopup(_message, options) { options.onConfirm(); },
    showAdminPopup() {},
    AdminPageNotice: { show() {}, clear() {} },
    BroadcastChannel: class {
      constructor() { Object.assign(this, element()); channels.push(this); }
      postMessage(message) { broadcasts.push(message); }
      close() {}
    },
  });
  const fetch = async (url, options = {}) => {
    requests.push({ url, options });
    const data = url.endsWith('/preview') ? { html: '<p>Preview</p>' } : { templates: [row] };
    return { ok: true, status: 200, json: async () => ({ data }) };
  };
  const context = vm.createContext({ window, document, fetch, localStorage: { getItem: () => '' } });
  vm.runInContext(emailSource, context);
  await document.emit('DOMContentLoaded');
  await settle();
  await settle();
  return { document, window, field, row, requests, channels, broadcasts, context };
}

const registryReads = (h) => h.requests.filter(({ url }) => url.endsWith('/admin/email-templates')).length;

test('Email Templates keeps saved wording when tab focus, visibility, or cross-tab updates change', async (t) => {
  const h = await emailHarness(t);
  assert.equal(registryReads(h), 1, 'initial page load still reads templates');
  const original = h.field('emailTplBodyText').value;
  h.row.defaults.body_text = 'Changed elsewhere';
  await h.window.emit('focus');
  await h.document.emit('visibilitychange');
  await h.channels[0].emit('message', { data: { type: 'updated' } });
  await settle();
  assert.equal(registryReads(h), 1);
  assert.equal(h.field('emailTplBodyText').value, original);
  assert.match(h.field('emailTemplateStatus').textContent, /Use Refresh/);
});

test('Email Templates retains a draft across incoming updates and still publishes explicit saves', async (t) => {
  const h = await emailHarness(t);
  const draft = 'A carefully edited notification.';
  h.field('emailTplBodyText').value = draft;
  await h.field('emailTplBodyText').emit('input');
  await h.channels[0].emit('message', { data: { type: 'updated' } });
  await settle();
  assert.equal(h.field('emailTplBodyText').value, draft);
  assert.equal(registryReads(h), 1);
  await h.field('emailTemplateSaveBtn').emit('click');
  await settle();
  await settle();
  const writes = h.requests.filter(({ options }) => options.method === 'PUT');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].options.headers.Authorization, 'Bearer admin-token');
  assert.equal(JSON.parse(JSON.parse(writes[0].options.body).email_tpl_order_received).body_text, draft);
  assert.equal(h.broadcasts.length, 1);
  assert.equal(h.broadcasts[0].type, 'updated');
  assert.equal(registryReads(h), 1, 'save does not cause a background registry reload');
});

test('Website Configuration content editors have no tab-return reload listeners and retain manual Refresh controls', () => {
  const scripts = ['home', 'services', 'contact', 'footer', 'payments', 'emails', 'maintenance'];
  for (const name of scripts) {
    const source = fs.readFileSync(path.join(repo, `admin-page/website-${name}.js`), 'utf8');
    assert.doesNotMatch(source, /(?:window|document)\.addEventListener\(\s*["'](?:focus|visibilitychange)["']/, `${name} reloads on tab return`);
  }
  for (const portal of ['admin-page', 'staff-page']) {
    const names = portal === 'admin-page' ? [...scripts, 'about'] : ['home', 'about', 'services', 'contact', 'footer'];
    for (const name of names) {
      const html = fs.readFileSync(path.join(repo, `${portal}/website-${name}.html`), 'utf8');
      assert.match(html, /Refresh/, `${portal}/${name} has no manual refresh control`);
    }
  }
  assert.match(fs.readFileSync(path.join(repo, 'admin-page/website-payments.html'), 'utf8'), /website-payments\.js\?v=\d+(?:\.\d+)+/);
  assert.match(fs.readFileSync(path.join(repo, 'admin-page/website-emails.html'), 'utf8'), /website-emails\.js\?v=\d+(?:\.\d+)+/);
});
