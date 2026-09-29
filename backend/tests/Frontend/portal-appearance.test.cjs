const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repo = path.resolve(__dirname, '../../..');
const source = fs.readFileSync(path.join(repo, 'home-page/portal-appearance.js'), 'utf8');

function appearance(extraGlobals = {}) {
  const window = {};
  vm.runInNewContext(source, { window, URL, ...extraGlobals });
  return window.FMRC_PORTAL_APPEARANCE;
}

function markedNode(text = '') {
  return {
    textContent: text,
    get innerHTML() { return this.textContent; },
    set innerHTML(_) { throw new Error('Portal copy must be applied as plain text.'); },
  };
}

function logo(src) {
  return { src, style: { display: 'none' }, getAttribute(name) { return name === 'src' ? this.src : null; } };
}

function portalRoot() {
  const markers = new Map([
    ['[data-portal-brand-name]', [markedNode(), markedNode()]],
    ['[data-portal-name]', [markedNode()]],
    ['[data-portal-university-name]', [markedNode()]],
    ['[data-portal-image-kicker]', [markedNode()]],
    ['[data-portal-image-title]', [markedNode()]],
    ['[data-portal-image-description]', [markedNode()]],
    ['[data-portal-center-name]', [markedNode()]],
    ['[data-portal-logo="primary"]', [logo('/images/old-primary.png')]],
    ['[data-portal-logo="secondary"]', [logo('/images/old-secondary.png')]],
  ]);
  const form = {
    heading: 'Sign in', emailLabel: 'Email address', passwordLabel: 'Password',
    email: 'person@example.test', password: 'unchanged-password', button: 'Sign in',
  };
  const properties = new Map();
  const selectors = [];
  const root = {
    dataset: {},
    style: { setProperty: (name, value) => properties.set(name, value) },
    querySelectorAll(selector) {
      selectors.push(selector);
      assert(markers.has(selector), `Appearance cannot select form elements: ${selector}`);
      return markers.get(selector);
    },
  };
  return { root, markers, properties, selectors, form };
}

test('Customer and Admin/Staff read independent artwork, branding, and image placement', () => {
  const api = appearance();
  const settings = {
    portal_customer_background_image: '/images/customer.jpg',
    portal_customer_brand_name: 'Customer identity',
    portal_customer_portal_name: 'Client Portal',
    portal_customer_image_side: 'right',
    portal_customer_image_position: 'top',
    portal_customer_overlay_opacity: '0.8',
    portal_admin_background_image: '/images/admin.jpg',
    portal_admin_brand_name: 'Office identity',
    portal_admin_portal_name: 'Team Portal',
    portal_admin_image_side: 'left',
    portal_admin_image_position: 'bottom',
    portal_admin_overlay_opacity: '0',
  };
  const customer = api.read(settings, 'customer');
  const admin = api.read(settings, 'admin');
  assert.equal(customer.background_image, '/images/customer.jpg');
  assert.equal(customer.brand_name, 'Customer identity');
  assert.equal(customer.portal_name, 'Client Portal');
  assert.equal(customer.image_side, 'right');
  assert.equal(customer.image_position, 'top');
  assert.equal(customer.overlay_opacity, 0.8);
  assert.equal(admin.background_image, '/images/admin.jpg');
  assert.equal(admin.brand_name, 'Office identity');
  assert.equal(admin.portal_name, 'Team Portal');
  assert.equal(admin.image_side, 'left');
  assert.equal(admin.image_position, 'bottom');
  assert.equal(admin.overlay_opacity, 0);
  assert.equal(api.key('customer', 'brand_name'), 'portal_customer_brand_name');
  assert.equal(api.key('admin', 'brand_name'), 'portal_admin_brand_name');
  assert.equal(settings.portal_customer_image_side, 'right', 'Reading does not mutate stored settings.');
});

test('legacy logos remain visible until each portal explicitly restores bundled artwork', () => {
  const api = appearance();
  const legacy = {
    portal_logo_primary_image: '/images/legacy-university.png',
    portal_logo_secondary_image: '/images/legacy-center.png',
  };
  for (const portal of ['customer', 'admin']) {
    const inherited = api.read(legacy, portal);
    assert.equal(inherited.logo_primary_image, legacy.portal_logo_primary_image);
    assert.equal(inherited.logo_secondary_image, legacy.portal_logo_secondary_image);
    for (const cleared of ['', null]) {
      const restored = api.read({
        ...legacy,
        [`portal_${portal}_logo_primary_image`]: cleared,
        [`portal_${portal}_logo_secondary_image`]: cleared,
      }, portal);
      assert.equal(restored.logo_primary_image, api.defaults[portal].logo_primary_image);
      assert.equal(restored.logo_secondary_image, api.defaults[portal].logo_secondary_image);
    }
  }
  const customerOnly = api.read({ ...legacy, portal_customer_logo_primary_image: '/images/client.png' }, 'admin');
  assert.equal(customerOnly.logo_primary_image, legacy.portal_logo_primary_image);
});

test('invalid layout values and nonnumeric opacity use the portal defaults', () => {
  const api = appearance();
  for (const portal of ['customer', 'admin']) {
    for (const opacity of [null, '', 'opaque', '0x0', '0b0', -0.01, 1.01, NaN, Infinity, false, true, [], [0.2], {}]) {
      const config = api.read({
        [`portal_${portal}_image_side`]: 'middle',
        [`portal_${portal}_image_position`]: 'left',
        [`portal_${portal}_overlay_opacity`]: opacity,
      }, portal);
      assert.equal(config.image_side, api.defaults[portal].image_side);
      assert.equal(config.image_position, api.defaults[portal].image_position);
      assert.equal(config.overlay_opacity, api.defaults[portal].overlay_opacity, `Invalid opacity ${JSON.stringify(opacity)}`);
    }
    for (const opacity of [0, '0', 0.9, '0.9', 1, '1']) {
      assert.equal(api.read({ [`portal_${portal}_overlay_opacity`]: opacity }, portal).overlay_opacity, Number(opacity));
    }
  }
});

test('overlay intensity changes the visible center at 55, 75, and 100 percent for both images and portals', () => {
  const api = appearance();
  for (const portal of ['customer', 'admin']) {
    for (const custom of [false, true]) {
      const alpha = [];
      for (const intensity of [0, 0.55, 0.75, 1]) {
        const h = portalRoot();
        const config = api.read({
          [`portal_${portal}_overlay_opacity`]: intensity,
          ...(custom ? { [`portal_${portal}_background_image`]: '/images/uploaded.jpg' } : {}),
        }, portal);
        api.apply(h.root, config);
        const center = h.properties.get('--auth-image-overlay').match(/rgb\(69 21 31 \/ ([\d.]+)%\) 44%/);
        assert(center, 'The maroon fade retains a clear center stop.');
        alpha.push(Number(center[1]) / 100 * Number(h.properties.get('--auth-image-overlay-strength')));
      }
      assert.equal(alpha[0], 0, `${portal} ${custom ? 'uploaded' : 'bundled'} starts without an overlay`);
      assert(Math.abs(alpha[1] - 0.24 * (custom ? 0.55 : 1)) < 0.00001, '55% retains the existing photograph treatment.');
      assert(alpha[2] > alpha[1], '75% must visibly deepen the center beyond 55%.');
      assert(alpha[3] > alpha[2], '100% must visibly deepen the center beyond 75%.');
      assert.equal(alpha[3], 1, '100% provides the complete maroon overlay the administrator selected.');
    }
  }
  const html = fs.readFileSync(path.join(repo, 'admin-page/website-portals.html'), 'utf8');
  assert.match(html, /id="portalOverlay"[^>]*min="0"[^>]*max="1"/, 'The editor exposes the whole 0–100% range.');
});

test('cleared optional copy stays empty after null values return from the settings API', () => {
  const api = appearance();
  for (const portal of ['customer', 'admin']) {
    const fields = ['university_name', 'image_kicker', 'image_title', 'image_description', 'center_name'];
    const settings = Object.fromEntries(fields.map(field => [`portal_${portal}_${field}`, null]));
    const config = api.read(settings, portal);
    for (const field of fields) assert.equal(config[field], '', `${portal} ${field}`);
    assert.equal(config.brand_name, api.defaults[portal].brand_name);
    assert.equal(config.portal_name, api.defaults[portal].portal_name);
  }
});

test('unsafe and unsupported image references fall back without becoming CSS artwork', () => {
  const api = appearance();
  const fallback = '/images/default.png';
  for (const image of [
    'javascript:alert(1)', 'file:///C:/image.png', 'blob:https://fmrc.test/id',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    'data:text/html;base64,PHN2Zz48L3N2Zz4=',
    'data:image/png;base64,%%%', 'data:image/png;base64,A',
    '//example.test/image.png', '#image', 'http://',
    '/images/bad\nimage.png', '/images/bad\\image.png', '/images/<image>.png',
    'https://example.test/image".png', 'https://example.test/image\'.png',
    'https://example.test/image`.png',
  ]) {
    assert.equal(api.safeImage(image, fallback), fallback, image);
    const config = api.read({ portal_customer_background_image: image });
    assert.equal(config.background_image, api.defaults.customer.background_image);
  }
  assert.equal(api.safeImage(null, fallback), fallback);
  assert.equal(api.safeImage({ image: '/images/image.png' }, fallback), fallback);
});

test('safe raster data URLs, hosted images, and bundled paths stay usable', () => {
  const api = appearance();
  for (const image of [
    'data:image/png;base64,iVBORw0KGgo=',
    'data:image/jpeg;base64,/9j/2Q==',
    'data:image/jpg;base64,/9j/2Q==',
    'data:image/gif;base64,R0lGODlh',
    'data:image/webp;base64,UklGRg==',
    'https://images.example.test/portal?id=1',
    'http://127.0.0.1:5514/images/Portal Image.jpg',
    '../images/UCN Logo.png', '/images/FMRC Brand Logo.png', 'images/portal.png', 'portal.png',
  ]) assert.equal(api.safeImage(`  ${image}  `), image);
});

test('image checks also work with browser base64 decoding available', () => {
  const api = appearance({ atob });
  assert.equal(api.safeImage('data:image/png;base64,iVBORw0KGgo='), 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(api.safeImage('data:image/png;base64,A', '/images/default.png'), '/images/default.png');
});

test('portal copy is bounded with the same UTF-16 limits as editor maxlength', () => {
  const api = appearance();
  const limits = {
    brand_name: 80, portal_name: 80, university_name: 120, image_kicker: 80,
    image_title: 160, image_description: 320, center_name: 160,
  };
  for (const portal of ['customer', 'admin']) {
    const settings = Object.fromEntries(Object.entries(limits).map(([field, max]) => [`portal_${portal}_${field}`, 'x'.repeat(max + 1)]));
    const config = api.read(settings, portal);
    for (const [field, max] of Object.entries(limits)) {
      assert.equal(config[field].length, max, `${portal} ${field}`);
      assert.equal(config[field], 'x'.repeat(max));
    }
    const emoji = api.read({ [`portal_${portal}_brand_name`]: '😀'.repeat(41) }, portal);
    assert.equal(emoji.brand_name, '😀'.repeat(40));
    const cleared = api.read({
      [`portal_${portal}_brand_name`]: '  ', [`portal_${portal}_portal_name`]: '',
      [`portal_${portal}_image_description`]: '', [`portal_${portal}_image_kicker`]: '',
    }, portal);
    assert.equal(cleared.brand_name, api.defaults[portal].brand_name);
    assert.equal(cleared.portal_name, api.defaults[portal].portal_name);
    assert.equal(cleared.image_description, '');
    assert.equal(cleared.image_kicker, '');
  }
});

test('applying appearance updates only branding markers and preserves plain text, newlines, and auth fields', () => {
  const api = appearance();
  const h = portalRoot();
  const untouched = { ...h.form };
  const config = api.read({
    portal_customer_brand_name: '<b>UCN & FMRC</b>',
    portal_customer_image_title: 'Create together.\nMake it happen.',
    portal_customer_image_description: '<script>alert("copy")</script>',
    portal_customer_image_side: 'right',
    portal_customer_image_position: 'top',
    portal_customer_overlay_opacity: '0.4',
    portal_customer_background_image: '/images/custom photo.jpg',
    portal_customer_login_button: 'Ignored form customization',
    portal_customer_password_label: 'Ignored password customization',
  });
  api.apply(h.root, config);
  for (const marker of h.markers.get('[data-portal-brand-name]')) assert.equal(marker.textContent, '<b>UCN & FMRC</b>');
  assert.equal(h.markers.get('[data-portal-image-title]')[0].textContent, 'Create together.\nMake it happen.');
  assert.equal(h.markers.get('[data-portal-image-description]')[0].textContent, '<script>alert("copy")</script>');
  assert.deepEqual(h.form, untouched);
  assert.equal('login_button' in config, false);
  assert.equal('password_label' in config, false);
  assert.equal(h.root.dataset.portalImageSide, 'right');
  assert.equal(h.root.dataset.portalCustomImage, 'true');
  assert.equal(h.properties.get('--auth-photo'), 'url("/images/custom photo.jpg")');
  assert.equal(h.properties.get('--auth-overlay-opacity'), '0.4');
  assert.equal(h.properties.get('--auth-image-position'), 'top');
  assert.equal(h.markers.get('[data-portal-logo="primary"]')[0].src, api.defaults.customer.logo_primary_image);
});

test('logo image errors restore the bundled logo once, and a restored background clears the custom marker', () => {
  const api = appearance();
  const h = portalRoot();
  const custom = api.read({
    portal_admin_logo_primary_image: 'https://images.example.test/primary.png',
    portal_admin_logo_secondary_image: 'https://images.example.test/secondary.png',
    portal_admin_background_image: '/images/admin-background.png',
  }, 'admin');
  api.apply(h.root, custom);
  for (const slot of ['primary', 'secondary']) {
    const img = h.markers.get(`[data-portal-logo="${slot}"]`)[0];
    assert.equal(img.style.display, '');
    assert.equal(img.src, custom[`logo_${slot}_image`]);
    img.onerror();
    assert.equal(img.src, api.defaults.admin[`logo_${slot}_image`]);
    assert.equal(img.onerror, null, 'A missing bundled image cannot start an error loop.');
  }
  assert.equal(h.root.dataset.portalCustomImage, 'true');
  api.apply(h.root, api.read({}, 'admin'));
  assert.equal(h.root.dataset.portalCustomImage, 'false');
});
