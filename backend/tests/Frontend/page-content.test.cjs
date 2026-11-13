const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function contentModule(elements = [], university = null) {
  const context = {
    window: {}, CustomEvent: class { constructor(type) { this.type = type; } },
    document: {
      querySelectorAll: (selector) => elements.filter((el) => selector.includes('placeholder') ? el.dataset.editorialPlaceholder : el.dataset.editorialCopy),
      getElementById: (id) => id === 'universityPurposeSection' ? university : null,
      dispatchEvent() {},
    },
  };
  vm.runInNewContext(read('home-page/page-content.js'), context);
  return context.window.FMRC_PAGE_CONTENT;
}

test('every public copy field has a bounded editor and identical API limit', () => {
  const { fields } = contentModule();
  const backend = read('backend/app/Support/WebsiteContentLimits.php');
  const limits = new Map([...backend.matchAll(/'([^']+)'\s*=>\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]));
  const keys = new Set();
  for (const field of fields) {
    assert(!keys.has(field.key), `Duplicate ${field.key}`);
    keys.add(field.key);
    assert(field.maxLength > 0 && field.default.length <= field.maxLength, field.key);
    assert.equal(limits.get(field.key), field.maxLength, field.key);
  }
  for (const file of ['home-page/main.html', 'about-page/about.html', 'services-page/service.html']) {
    for (const [, key] of read(file).matchAll(/data-editorial-(?:copy|placeholder)="([^"]+)"/g)) assert(keys.has(key), `${file}: ${key}`);
  }
});

test('copy preserves defaults, literal user text, intentional blanks and cached late-rendered controls', () => {
  const title = { dataset: { editorialCopy: 'editorial_home_intro_title' }, textContent: '' };
  const search = { dataset: { editorialPlaceholder: 'editorial_services_image_placeholder' }, setAttribute(key, value) { this[key] = value; } };
  const elements = [title, search];
  const api = contentModule(elements);
  api.apply({ editorial_home_intro_title: '<img onerror=alert(1)>', editorial_services_image_placeholder: '' });
  assert.equal(title.textContent, '<img onerror=alert(1)>');
  assert.equal(search.placeholder, '');
  const later = { dataset: { editorialCopy: 'editorial_home_intro_title' }, textContent: '' };
  elements.push(later);
  api.apply();
  assert.equal(later.textContent, title.textContent);
  api.apply({ editorial_home_intro_title: '' });
  assert.equal(title.textContent, '');
  assert.equal(search.placeholder, 'Image coming soon');
  assert(!api.fields.some((field) => field.key === 'editorial_services_search_placeholder'));
});

test('university statements start empty and display together only after both contain text', () => {
  const university = { hidden: true };
  const vision = { dataset: { editorialCopy: 'editorial_about_university_vision_copy' }, textContent: '' };
  const mission = { dataset: { editorialCopy: 'editorial_about_university_mission_copy' }, textContent: '' };
  const api = contentModule([vision, mission], university);
  const fields = api.fields.filter(field => field.key.startsWith('editorial_about_university_'));
  assert.equal(fields.length, 6);
  assert.equal(fields.find(field => field.key.endsWith('vision_copy')).default, '');
  assert.equal(fields.find(field => field.key.endsWith('mission_copy')).default, '');
  api.apply({});
  assert.equal(university.hidden, true);
  api.apply({editorial_about_university_vision_copy:'A sample university vision.'});
  assert.equal(university.hidden, true);
  const draft = {editorial_about_university_vision_copy:'CNSC sample wording.', editorial_about_university_mission_copy:'First paragraph.\n\nSecond paragraph with <b>literal text</b>.'};
  api.apply(draft);
  assert.equal(university.hidden, false);
  assert.equal(vision.textContent, draft.editorial_about_university_vision_copy);
  assert.equal(mission.textContent, draft.editorial_about_university_mission_copy);
  api.apply();
  assert.equal(university.hidden, false, 'reapplying the last saved snapshot preserves the section');
  for (const blank of ['', ' \n\t ', null]) {
    api.apply({...draft, editorial_about_university_mission_copy:blank});
    assert.equal(university.hidden, true);
    api.apply({...draft, editorial_about_university_vision_copy:blank});
    assert.equal(university.hidden, true);
  }
  api.apply({});
  assert.equal(university.hidden, true, 'missing settings cannot retain previously displayed statements');
  assert.equal(mission.textContent, '');
});

test('Home renders three ordered text-first cards, escapes content and preserves detail data', () => {
  const source = read('home-page/main.js');
  const renderer = source.slice(source.indexOf('  function homeServicePlaceholder()'), source.indexOf('  function applyServices(services)'));
  const grid = { innerHTML: '', setAttribute() {} };
  const escape = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const ctx = { document: { getElementById: () => grid }, window: { FMRC_PAGE_CONTENT: { apply() {} } }, _esc: escape, _attr: escape };
  vm.runInNewContext(renderer, ctx);
  const services = Array.from({ length: 5 }, (_, id) => ({ id, title: `Service ${id} <script>`, category: 'Prototyping', description: 'Longword'.repeat(40), modal_description: 'Full details', modal_features: ['Safe <b>text</b>'], image_data: id === 1 ? '' : '/images/sample.jpg' }));
  ctx.applyHomeServices(services);
  assert.equal((grid.innerHTML.match(/<article /g) || []).length, 3);
  assert(!grid.innerHTML.includes('carousel'));
  assert(grid.innerHTML.indexOf('card-content') < grid.innerHTML.indexOf('service-image-trigger'));
  assert(grid.innerHTML.includes('data-desc="Full details"'));
  assert(grid.innerHTML.includes('&lt;script&gt;'));
  assert(grid.innerHTML.includes('service-image-placeholder'));
  assert(!grid.innerHTML.includes('Service 3'));
  ctx.applyHomeServices([]);
  assert(grid.innerHTML.includes('editorial_home_services_empty'));
});

test('each configuration page saves only its own settings', () => {
  const source = read('admin-page/website-home.js');
  const start = source.indexOf('function scopePageSettings(');
  const ctx = { CONFIG_PAGE: 'home' };
  vm.runInNewContext(source.slice(start, source.indexOf('function setText(', start)), ctx);
  const payload = { hero_title: 'Hero', home_sdg_heading: 'SDGs', editorial_home_intro_title: 'Intro', about_heading: 'About', mission_text: 'Mission', vision_image: 'image', editorial_about_cta_title: 'Explore', editorial_services_title: 'Services', footer_brand_name: 'Brand' };
  assert.deepEqual(Object.keys(ctx.scopePageSettings(payload, 'home')), ['hero_title', 'home_sdg_heading', 'editorial_home_intro_title']);
  assert.deepEqual(Object.keys(ctx.scopePageSettings(payload, 'about')), ['about_heading', 'mission_text', 'vision_image', 'editorial_about_cta_title']);
});

test('legacy About copy distinguishes missing settings from cleared settings', () => {
  const source = read('home-page/main.js');
  const start = source.indexOf('  function _txt(');
  const element = { textContent: 'Existing', innerHTML: '<strong>Existing</strong>' };
  const ctx = { document: { getElementById: () => element } };
  vm.runInNewContext(source.slice(start, source.indexOf('  function _src(', start)), ctx);
  ctx._txt('title', undefined); assert.equal(element.textContent, 'Existing');
  ctx._txt('title', null); assert.equal(element.textContent, '');
  ctx._html('description', null); assert.equal(element.innerHTML, '');
});

// The shared controller owns navigation; this adapter preserves About's public hooks.
test('About galleries preserve cover IDs and current slide through the shared controller', () => {
  const source = read('home-page/main.js');
  const start = source.indexOf('  function applyEditorialGallery(');
  const calls = [];
  const ctx = {
    window: {FMRCMediaCarousel:{mount(deck, items, options) {calls.push({deck, items, options});}}},
  };
  vm.runInNewContext(source.slice(start, source.indexOf('  /* Cards from slot', start)), ctx);
  for (const kind of ['mission', 'vision']) {
    const deck = {
      _editorialIndex: 1,
      classList:{remove() {}},
      querySelector: () => ({className:kind+'-img',getAttribute:()=>'/legacy-cover.png'}),
    };
    ctx.applyEditorialGallery(deck, kind, ['/first.png','/second.png']);
    const call = calls.at(-1);
    assert.equal(call.options.imageId, kind+'ImgEl');
    assert.equal(call.options.imageClass, kind+'-img');
    assert.equal(call.options.initialIndex, 1);
    assert.equal(call.options.label, 'FMRC '+(kind==='mission'?'Mission':'Vision'));
    assert.deepEqual(Array.from(call.items, item=>item.url), ['/first.png','/second.png']);
    const before = calls.length;
    ctx.applyEditorialGallery(deck, kind, ['/first.png','/second.png']);
    assert.equal(calls.length,before,'unchanged settings do not rebuild the active gallery');
    ctx.applyEditorialGallery(deck, kind, []);
    assert.equal(calls.at(-1).items[0].url,'/legacy-cover.png','removing extras retains the cover');
  }
});
