const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repo = path.resolve(__dirname, '../../..');
const source = fs.readFileSync(path.join(repo, 'admin-page/website-home.js'), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

function harness(page = 'about', portal = 'admin') {
  const markup = fs.readFileSync(path.join(repo, `${portal}-page/website-${page}.html`), 'utf8');
  const elements = new Map([...markup.matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], {
    value: match[1], innerHTML: 'Save All Changes', disabled: false, attributes: {},
    setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; },
  }]));
  const state = { requests: [], messages: [], reloads: 0, broadcasts: 0, loaded: true, reloadOk: true, valid: true, status: 200, collectError: false };
  const context = vm.createContext({
    CONFIG_PAGE: page, CONFIG_LABEL: page === 'about' ? 'About Us' : 'Home',
    API: '/api', settingsLoaded: true, settingsSaving: false,
    heroBgGradient: 'warm', heroBgImageData: 'home-image',
    aboutVideoData: 'about-video', visionImageData: 'vision-image', missionImageData: 'mission-image',
    token: () => `${portal}-token`,
    document: {
      getElementById: (id) => elements.get(id) || null,
      querySelector: () => ({}), querySelectorAll: () => [],
    },
    validateTextFields: () => state.valid,
    window: {
      FMRC_PAGE_CONTENT: { collect() {
        if (state.collectError) throw new Error('Broken control');
        return { editorial_about_page_copy: 'About draft', editorial_home_intro_title: 'Home draft' };
      } },
      showAdminPopup: (message, options) => state.messages.push({ message, options }),
    },
    broadcastSiteUpdate: () => state.broadcasts++,
    showSettingsLoadFailure: (error) => state.messages.push({ message: error.message, retry: true }),
    fetch: async (url, options) => {
      state.requests.push({ url, options });
      if (state.wait) await state.wait;
      if (state.networkError) throw new TypeError('Failed to fetch');
      return { ok: state.status === 200, status: state.status, json: async () => ({
        errors: state.status === 422 ? { about_text_1: ['Please shorten the profile text.'] } : {},
        message: 'Internal technical details must stay private',
      }) };
    },
    loadSettings: async () => {
      state.reloads++;
      context.setSettingsLoaded(state.reloadOk);
      assert.equal(elements.get('btnSaveAllHome').disabled, true, 'Readback cannot unlock an active save');
      return state.reloadOk;
    },
  });
  vm.runInContext(section('function scopePageSettings(', 'function setText('), context);
  vm.runInContext(section('function setSettingsLoaded(', '/** One dialog'), context);
  vm.runInContext(section('function collectPageSettings(', '// ── Service CRUD'), context);
  return { state, elements, context, save: () => context.doSaveAll(), button: elements.get('btnSaveAllHome') };
}

for (const portal of ['admin', 'staff']) {
  test(`${portal} About saves its actual controls without Home scene fields and reads back the result`, async () => {
    const h = harness('about', portal);
    assert.equal(h.elements.has('heroSceneAccent'), false);
    h.elements.get('aboutHeading').value = 'Our center';
    h.elements.get('aboutText2').value = '';
    await h.save();
    assert.equal(h.state.requests.length, 1);
    const { url, options } = h.state.requests[0];
    assert.equal(url, '/api/admin/site-settings');
    assert.equal(options.headers.Authorization, `Bearer ${portal}-token`);
    const payload = JSON.parse(options.body);
    assert.equal(payload.about_heading, 'Our center');
    assert.equal(payload.about_text_2, '');
    assert.equal(payload.vision_image, 'vision-image');
    assert.equal(payload.mission_image, 'mission-image');
    assert.equal(payload.about_video_url, 'about-video');
    assert.equal(payload.editorial_about_page_copy, 'About draft');
    assert(Object.keys(payload).every((key) => /^(about|mission|vision|editorial_about)_/.test(key)));
    assert.equal(h.state.reloads, 1);
    assert.equal(h.state.broadcasts, 1);
    assert.equal(h.button.disabled, false);
    assert.equal(h.button.attributes['aria-busy'], undefined);
    assert.equal(h.state.messages[0].options.type, 'success');
  });
}

test('Home keeps its scene values and omits About content and separately saved logos', async () => {
  const h = harness('home');
  h.elements.get('heroSceneScale').value = '115';
  await h.save();
  const payload = JSON.parse(h.state.requests[0].options.body);
  assert.equal(payload.hero_scene_scale, 115);
  assert.equal(payload.hero_bg_image, 'home-image');
  assert.equal(payload.hero_scene_accent, 'heroSceneAccent');
  assert.equal(payload.editorial_home_intro_title, 'Home draft');
  assert(Object.keys(payload).every((key) => /^(hero_|home_sdg_heading$|editorial_home_)/.test(key)));
  assert.equal(Object.hasOwn(payload, 'hero_logo_image'), false);
});

test('unloaded or invalid content cannot be submitted', async () => {
  const h = harness();
  h.context.setSettingsLoaded(false);
  await h.save();
  assert.equal(h.button.disabled, true);
  h.context.setSettingsLoaded(true);
  h.state.valid = false;
  await h.save();
  assert.equal(h.state.requests.length, 0);
});

test('payload collection errors restore Save and allow the same draft to be retried', async () => {
  const h = harness();
  h.state.collectError = true;
  await h.save();
  assert.equal(h.button.disabled, false);
  assert.equal(h.button.innerHTML, 'Save All Changes');
  assert.equal(h.button.attributes['aria-busy'], undefined);
  assert.equal(h.state.requests.length, 0);
  assert.match(h.state.messages[0].message, /couldn't save/);
  assert.doesNotMatch(h.state.messages[0].message, /Broken control/);
  h.state.collectError = false;
  await h.save();
  assert.equal(h.state.requests.length, 1);
});

test('validation, sign-in, network and temporary failures preserve the draft and allow retry', async () => {
  for (const failure of [422, 401, 403, 503, 'network']) {
    const h = harness();
    h.state.status = failure;
    h.state.networkError = failure === 'network';
    h.elements.get('aboutText1').value = 'Keep this draft';
    await h.save();
    assert.equal(h.elements.get('aboutText1').value, 'Keep this draft');
    assert.equal(h.button.disabled, false);
    assert.equal(h.state.reloads, 0);
    const message = h.state.messages[0].message;
    assert.doesNotMatch(message, /technical|TypeError|server|Laravel|HTTP/);
    if (failure === 422) assert.equal(message, 'Please shorten the profile text.');
    if (failure === 401 || failure === 403) assert.match(message, /sign in again/);
    h.state.status = 200;
    h.state.networkError = false;
    await h.save();
    assert.equal(h.state.reloads, 1);
  }
});

test('a pending save remains busy and duplicate submissions do not create extra writes', async () => {
  const h = harness();
  let finish;
  h.state.wait = new Promise((resolve) => { finish = resolve; });
  const pending = h.save();
  assert.equal(h.button.disabled, true);
  assert.equal(h.button.attributes['aria-busy'], 'true');
  await h.save();
  assert.equal(h.state.requests.length, 1);
  finish();
  await pending;
  assert.equal(h.button.disabled, false);
});

test('a saved change with failed readback stays locked and offers loading retry', async () => {
  const h = harness();
  h.state.reloadOk = false;
  await h.save();
  assert.equal(h.state.requests.length, 1);
  assert.equal(h.button.disabled, true);
  assert.equal(h.state.messages[0].retry, true);
  assert.match(h.state.messages[0].message, /changes were saved/);
  await h.save();
  assert.equal(h.state.requests.length, 1);
});

test('missing optional controls do not clear their saved text or media', async () => {
  const h = harness();
  for (const id of ['aboutText2', 'aboutVideoInput', 'visionImgInput', 'missionImgInput']) h.elements.delete(id);
  await h.save();
  const payload = JSON.parse(h.state.requests[0].options.body);
  for (const key of ['about_text_2', 'about_video_url', 'vision_image', 'mission_image']) {
    assert.equal(Object.hasOwn(payload, key), false, key);
  }
});
