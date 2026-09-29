const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repo = path.resolve(__dirname, '../../..');
const source = fs.readFileSync(path.join(repo, 'admin-page/admin-common.js'), 'utf8');
const start = source.indexOf('  const isStaffWebsiteShell =');
const end = source.indexOf('  // Support both admin and staff control button IDs', start);
assert(start >= 0 && end > start, 'Shared Website Configuration menu initializer exists');

function menuFor(portal, cachedAdminEntries = false) {
  const menu = {
    links: [],
    querySelector(selector) {
      const href = selector.match(/href="([^"]+)"/)?.[1];
      return this.links.find((link) => link.href === href) || null;
    },
    appendChild(link) { link.parentElement = this; this.links.push(link); },
  };
  const link = (href) => ({
    href, textContent: '', className: '', parentElement: menu,
    classList: { add() {} }, setAttribute() {},
    after(next) { next.parentElement = menu; menu.links.splice(menu.links.indexOf(this) + 1, 0, next); },
    remove() { menu.links.splice(menu.links.indexOf(this), 1); },
  });
  menu.links = ['website-home.html', 'website-footer.html'].map(link);
  if (cachedAdminEntries) menu.links.push(...['website-portals.html', 'website-payments.html'].map(link));
  const document = {
    createElement: () => link(''),
    querySelectorAll(selector) {
      if (selector.includes('a.sub-link')) return menu.links.filter((entry) => entry.href === 'website-home.html');
      return menu.links.filter((entry) => ['website-portals.html', 'website-payments.html'].includes(entry.href));
    },
  };
  vm.runInNewContext(source.slice(start, end), {
    document, window: { location: { pathname: `/${portal}-page/website-home` }, AdminSession: { isStaff: portal === 'staff' } },
  });
  return menu.links.map((entry) => entry.href);
}

test('Staff shell retains normal configuration destinations and removes cached Admin-only links', () => {
  for (const cached of [false, true]) {
    assert.deepEqual(menuFor('staff', cached), ['website-home.html', 'website-about.html', 'website-footer.html']);
  }
});

test('Admin shell inserts both configuration editors once and preserves existing entries', () => {
  for (const cached of [false, true]) {
    const links = menuFor('admin', cached);
    for (const href of ['website-home.html', 'website-about.html', 'website-footer.html', 'website-portals.html', 'website-payments.html']) {
      assert.equal(links.filter((link) => link === href).length, 1, href);
    }
  }
});
