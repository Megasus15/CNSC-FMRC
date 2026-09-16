const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const postcss = require('../../node_modules/postcss');
const selectors = require('../../node_modules/postcss-selector-parser');
const lightningcss = require('../../node_modules/lightningcss');
const root = path.resolve(__dirname, '../../..');
const code = fs.readFileSync(path.join(root, 'services-page/services.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'services-page/services.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'services-page/service.html'), 'utf8');
const parsed = postcss.parse(css);
let rules = 0;
parsed.walkRules(rule => {
  rules++;
  for (const selector of selectors().astSync(rule.selector).nodes) {
    assert.equal(selector.nodes[0].type, 'class', rule.selector);
    assert.equal(selector.nodes[0].value, 'services-page-body', rule.selector);
  }
});
const transformed = lightningcss.transform({ filename: 'services.css', code: Buffer.from(css), errorRecovery: false });
assert.deepEqual(transformed.warnings, []);
assert(html.indexOf('services.css?v=') > html.indexOf('fmrc-loader.css'));
assert(html.indexOf('services-list-header') < html.indexOf('products-toolbar'));
assert(html.indexOf('products-toolbar') < html.indexOf('services-grid'));
assert(!html.includes('editorial_services_search_placeholder'));
assert(!html.includes('editorial_services_all_categories'));
assert(html.includes('placeholder="Search services..."'));
assert(html.includes('>All Categories</option>'));
console.log(`PASS CSS parsing (${rules} scoped rules, zero warnings), asset ordering, intro ordering`);

function harness(width) {
  class Element {
    constructor(value = '') { this.value = value; this.innerHTML = ''; this.attrs = {}; this.events = {}; this.children = []; this.textContent = ''; }
    setAttribute(name, value) { this.attrs[name] = value; }
    addEventListener(name, fn) { this.events[name] = fn; }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(...children) { this.children = children; }
    get options() { return this.children; }
  }
  const grid = new Element();
  const search = new Element();
  const category = new Element('all');
  const listeners = {};
  let resolveFetch, rejectFetch;
  const response = new Promise((resolve, reject) => { resolveFetch = resolve; rejectFetch = reject; });
  const requests = [];
  const document = {
    getElementById: id => id === 'servicesGrid' ? grid : null,
    querySelector: selector => selector.includes('.search-input') ? search : selector.includes('.category-select') ? category : null,
    addEventListener: (name, fn) => { (listeners[name] ||= []).push(fn); },
    createElement: () => new Element(),
  };
  const context = vm.createContext({
    setInterval() {},
    window: { addEventListener() {}, innerWidth: width, location: { protocol: 'http:', hostname: '127.0.0.1', origin: 'http://127.0.0.1:5500', port: '5500' } },
    document, Element, HTMLElement: Element,
    MutationObserver: class { observe() {} },
    fetch: (url, options) => { requests.push({url, options}); return response; },
    console: {error() {}},
  });
  vm.runInContext(code, context);
  listeners.DOMContentLoaded.forEach(fn => fn());
  return {
    grid, search, category, requests,
    complete: async data => {
      resolveFetch({ok: true, json: async () => ({data})});
      // Both the services and category-label requests share this deterministic
      // response in the lightweight harness; allow both promise chains to
      // finish before asserting the filtered render.
      await new Promise(setImmediate);
      await new Promise(setImmediate);
    },
    fail: async () => { rejectFetch(new Error('Test network failure')); await new Promise(setImmediate); },
  };
}

(async () => {
  for (const [width, count] of [[1440, 6], [1024, 4], [768, 4], [390, 2], [320, 2]]) {
    const h = harness(width);
    assert.equal((h.grid.innerHTML.match(/<article/g) || []).length, count);
    assert.equal(h.grid.attrs['aria-busy'], 'true');
    assert(h.grid.innerHTML.indexOf('service-skeleton-action') < h.grid.innerHTML.indexOf('service-skeleton-img'));
    await h.complete([]);
    assert.equal(h.grid.attrs['aria-busy'], 'false');
    assert(h.grid.innerHTML.includes('services-empty-state'));
  }
  console.log('PASS skeleton counts and empty states at all five target widths (runtime DOM stub)');

  const fixtures = [
    {title: '3D Printing', category: 'Prototyping', description: 'Precision rapid prototypes', image_data: '/images/3Dprint.png', modal_features: ['FDM', 'SLA'], modal_materials: ['PLA'], modal_best_for: ['Models']},
    {title: 'Laser Cutting', category: 'Manufacturing', description: 'Precision cuts', image_data: '/images/laser-cutting.png'},
    {title: 'Design Consultation', category: 'Design & Labelling', description: 'Design support', image_data: null},
    {title: 'Unknown Service', category: 'Special research', description: 'Research capability'},
    {title: 'Very long service title '.repeat(12) + '<script>alert(1)</script>', category: 'Training & Workshops', description: 'Description '.repeat(40), image_data: '/images/test" onerror="alert(1)', modal_features: ['Safe <script> value']},
  ];
  const h = harness(1440);
  h.search.value = 'PRECISION';
  h.search.events.input();
  assert(h.grid.innerHTML.includes('service-skeleton-card'));
  h.category.value = 'manufacturing';
  h.category.events.change();
  await h.complete(fixtures);
  h.category.value = 'manufacturing';
  h.category.events.change();
  assert.equal((h.grid.innerHTML.match(/<article/g) || []).length, 1);
  assert(h.grid.innerHTML.includes('Laser Cutting'));
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[0].url, 'http://127.0.0.1:8000/api/services');
  assert.equal(h.requests[0].options.cache, 'no-store');
  assert.equal(h.requests[1].url, 'http://127.0.0.1:8000/api/site-settings');
  h.category.value = 'all'; h.category.events.change();
  assert.equal((h.grid.innerHTML.match(/<article/g) || []).length, 2);
  h.search.value = ''; h.search.events.input();
  assert.equal((h.grid.innerHTML.match(/<article/g) || []).length, 5);
  assert(h.grid.innerHTML.indexOf('3D Printing') < h.grid.innerHTML.indexOf('Laser Cutting'));
  assert(h.grid.innerHTML.indexOf('Learn more') < h.grid.innerHTML.indexOf('class="service-image-trigger"'));
  assert(h.grid.innerHTML.includes('Unknown Service'));
  assert(h.grid.innerHTML.includes('Image coming soon'));
  assert(h.grid.innerHTML.includes('&lt;script&gt;'));
  assert(!h.grid.innerHTML.includes('<script>'));
  assert(!h.grid.innerHTML.includes('" onerror="'));
  assert(h.grid.innerHTML.includes('data-features="[&quot;FDM&quot;,&quot;SLA&quot;]"'));
  h.search.value = 'not a matching service'; h.search.events.input();
  assert(h.grid.innerHTML.includes('services-empty-state'));
  h.search.value = ''; h.category.value = 'prototyping'; h.category.events.change();
  assert(h.grid.innerHTML.includes('3D Printing'));
  h.category.value = 'training'; h.category.events.change();
  assert(h.grid.innerHTML.includes('Very long service title'));
  console.log('PASS combined filters, pending query, API order, unknown category, missing images, long/escaped content, modal data hooks');

  const failed = harness(390);
  await failed.fail();
  assert(failed.grid.innerHTML.includes('services-load-error'));
  failed.search.value = 'typing after error'; failed.search.events.input();
  assert(failed.grid.innerHTML.includes('services-load-error'));
  assert.equal(failed.grid.attrs['aria-busy'], 'false');
  console.log('PASS fetch failure remains visible after filter edits');
})().catch(error => { console.error(error); process.exitCode = 1; });
