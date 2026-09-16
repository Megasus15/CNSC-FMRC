const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function contentModule(elements = []) {
  const context = {
    window: {}, CustomEvent: class { constructor(type) { this.type = type; } },
    document: {
      querySelectorAll: (selector) => elements.filter((el) => selector.includes('placeholder') ? el.dataset.editorialPlaceholder : el.dataset.editorialCopy),
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

// Small event/element fixtures exercise gallery state without claiming browser rendering.
class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attributes = {}; this.events = {}; this.className = ''; this.style = {};
    this.complete = true; this.naturalWidth = 640;
  this.classList = {
    add: (...names) => { this.className = [...new Set([...this.className.split(' '), ...names])].join(' ').trim(); },
    remove: (...names) => { this.className = this.className.split(' ').filter((n) => !names.includes(n)).join(' '); },
    contains: (name) => this.className.split(' ').includes(name),
    toggle: (name, force) => { const next = force === undefined ? !this.className.split(' ').includes(name) : Boolean(force); if (next) this.classList.add(name); else this.classList.remove(name); return next; },
  };
  }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  after(child) { this.parentElement.appendChild(child); }
  remove() { this.parentElement.children = this.parentElement.children.filter((child) => child !== this); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  addEventListener(type, callback, options = {}) { (this.events[type] ||= []).push({ callback, signal: options.signal }); }
  emit(type, detail = {}) { for (const event of this.events[type] || []) if (!event.signal?.aborted) event.callback({ type, target: this, ...detail }); }
  contains(element) { return element === this || this.children.some((child) => child.contains(element)); }
  querySelectorAll(selector) {
    const matches = (node) => selector.startsWith('.') ? node.classList.contains(selector.slice(1)) : selector.startsWith('[') ? Object.hasOwn(node.attributes, selector.slice(1, -1)) : node.tagName.toLowerCase() === selector;
    return this.children.flatMap((child) => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  set innerHTML(value) {
    this.html = value;
    if (value.includes('data-gallery-dots')) {
      const dots = new Element('div'); dots.setAttribute('data-gallery-dots', ''); this.appendChild(dots);
    }
  }
}

test('gallery crossfades loop, supports dots and swipe, respects reduced motion and cleans up on refresh', () => {
  const source = read('home-page/main.js');
  const start = source.indexOf('  function applyEditorialGallery(');
  const code = source.slice(start, source.indexOf('  /* Cards from slot', start));
  assert(!code.includes('data-gallery-prev') && !code.includes('data-gallery-next') && !code.includes('data-gallery-pause') && !code.includes('editorial-gallery-status'));
  const parent = new Element(); const deck = parent.appendChild(new Element());
  const first = deck.appendChild(new Element()); first.className = 'vm-deck__card'; first.appendChild(new Element('img'));
  const timers = new Map(); let nextTimer = 0; let disconnects = 0;
  const reduced = new Element(); reduced.matches = false;
  const document = { hidden: false, activeElement: null, body: new Element('body'), createElement: (tag) => new Element(tag) };
  const ctx = {
    document, window: { matchMedia: () => reduced, IntersectionObserver: true }, AbortController,
    IntersectionObserver: class { observe() {} disconnect() { disconnects++; } },
    setInterval: (fn, delay) => { assert.equal(delay, 5000); timers.set(++nextTimer, fn); return nextTimer; },
    clearInterval: (id) => timers.delete(id), vmPhotoSettle() {}, vmWarmDeckImages() {},
    vmResetToFirstCard: (el) => { for (const child of el.querySelectorAll('.vm-deck__card').slice(1)) child.remove(); },
  };
  vm.runInNewContext(code, ctx);
  ctx.applyEditorialGallery(deck, 'mission', ['a', 'b', 'c']);
  const current = () => deck.querySelectorAll('.vm-deck__card').findIndex((card) => card.dataset.current === 'true');
  assert.equal(current(), 0); assert.equal(timers.size, 1);
  const tick = () => [...timers.values()][0]?.();
  tick(); assert.equal(current(), 1); tick(); tick(); assert.equal(current(), 0);
  document.hidden = true; tick(); assert.equal(current(), 0); document.hidden = false;
  const controls = parent.querySelector('.editorial-gallery-controls');
  const dots = controls.querySelector('[data-gallery-dots]');
  assert.equal(dots.querySelectorAll('button').length, 3);
  assert.equal(dots.querySelectorAll('button')[0].getAttribute('aria-current'), 'true');
  dots.querySelectorAll('button')[2].emit('click'); assert.equal(current(), 2);
  deck.emit('pointerdown', { isPrimary: true, clientX: 220, clientY: 20, pointerId: 1 });
  deck.emit('pointerup', { isPrimary: true, clientX: 140, clientY: 22, pointerId: 1 });
  assert.equal(current(), 0, 'Horizontal swipe advances the slideshow');
  reduced.matches = true; reduced.emit('change'); assert.equal(timers.size, 0);
  ctx.applyEditorialGallery(deck, 'mission', ['a', 'b']);
  assert.equal(disconnects, 1); assert.equal(parent.querySelectorAll('.editorial-gallery-controls').length, 1);
  dots.querySelectorAll('button')[1].emit('click'); assert.equal(current(), 0, 'Old handlers are aborted');
  ctx.applyEditorialGallery(deck, 'mission', ['only']);
  assert.equal(parent.querySelectorAll('.editorial-gallery-controls').length, 0); assert.equal(timers.size, 0);
});
