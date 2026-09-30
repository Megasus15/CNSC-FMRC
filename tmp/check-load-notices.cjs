const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('admin-page/admin-common.js', 'utf8');
const elements = [];
function element() {
  const children = new Map();
  return { hidden: false, style: {}, textContent: '', setAttribute() {},
    querySelector(s) { if (!children.has(s)) children.set(s, element()); return children.get(s); },
    getBoundingClientRect() { return { height: this.hidden ? 0 : 52 }; },
  };
}
let outcome;
const context = vm.createContext({ URL, console, navigator: { onLine: true }, SyntaxError,
  ResizeObserver: class { observe() {} },
  document: { body: { append(...items) { elements.push(...items); } }, createElement: element, addEventListener() {} },
  window: { location: { href: 'https://example.test/admin-page/dashboard.html' }, addEventListener() {}, fetch: async () => { if (outcome instanceof Error) throw outcome; return outcome; } },
});
vm.runInContext(source.slice(0, source.indexOf('\n})();') + 6), context);
const notice = context.window.AdminPageNotice;
for (const [error, message] of [[{ status: 500 }, 'Temporarily unavailable.'], [{ status: 504 }, 'Request timed out.'], ['SQLSTATE Laravel backend', 'Temporarily unavailable.'], ['Failed to fetch', 'Connection lost. Try again.'], [{ status: 403 }, 'Access denied.']]) assert.equal(notice.describe(error), message);
notice.show('Request timed out.', { key: 'dashboard', retry() {} });
assert.equal(elements[1].hidden, false);
assert.equal(elements[1].querySelector('.admin-page-load-notice__retry').hidden, false);
notice.clear('dashboard');
assert.equal(elements[1].hidden, true);
const start = source.lastIndexOf('(() => {', source.indexOf('  if (window.AdminLiveData'));
const end = source.indexOf('\n})();', start) + 6;
vm.runInContext(source.slice(start, end), context);
(async () => {
  outcome = { ok: false, status: 503 };
  await context.window.fetch('/api/admin/orders?page=1');
  assert.equal(notice.active, true);
  outcome = { ok: true, status: 200 };
  await context.window.fetch('/api/admin/products');
  assert.equal(notice.active, true, 'Unrelated success must not clear an orders failure');
  await context.window.fetch('/api/admin/orders?page=2');
  assert.equal(notice.active, false, 'Recovery clears across filter changes');
  outcome = { ok: false, status: 500 };
  await context.window.fetch('/api/admin/orders', { method: 'POST' });
  assert.equal(notice.active, false, 'Saving uses existing form feedback');
  await context.window.fetch('/api/admin/notifications');
  assert.equal(notice.active, false, 'Background notification polling is excluded');
  outcome = Object.assign(new Error('cancelled'), { name: 'AbortError' });
  await assert.rejects(context.window.fetch('/api/admin/orders'));
  assert.equal(notice.active, false, 'Intentional cancellation stays quiet');
  outcome = new TypeError('Failed to fetch');
  await assert.rejects(context.window.fetch('/api/admin/orders'));
  assert.equal(notice.active, true);
  elements[1].querySelector('.admin-page-load-notice__close').onclick();
  assert.equal(notice.active, false);
  console.log('PASS: error wording, retry, recovery, unrelated successes, mutations, polling, cancellation and dismissal');
})();
