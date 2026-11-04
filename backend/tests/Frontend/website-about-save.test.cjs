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
    currentSettings: {},
    servicesLoaded: true, sdgsLoaded: true, servicesData: [], sdgsData: [], savedServices: [], savedSdgs: [],
    SERVICE_FIELDS: ['title'], SDG_FIELDS: ['title'],
    BRAND_LOGOS: [{slot:'hero',key:'hero_logo_image'}], brandLogoData: {},
    GALLERIES: { vision: {key:'vision_gallery'}, mission: {key:'mission_gallery'} }, galleryData: {vision:[],mission:[]},
    parseGallery: raw => JSON.parse(raw || '[]'),
    loadServices: async () => {}, loadSdgs: async () => {},
    pageDraft: null, videoUploading: false, videoUploadFailed: false, videoUploadToken: null,
    videoUploadFile: null, videoPreviewUrl: '',
    syncVideoControls() {}, paintVideoUpload() {},
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
      AdminWebsiteDraft: { changes: () => ({upsert:[],delete:[]}) },
      showAdminPopup: (message, options) => state.messages.push({ message, options }),
    },
    broadcastSiteUpdate: () => state.broadcasts++,
    showSettingsLoadFailure: (error) => state.messages.push({ message: error.message, retry: true }),
    fetch: async (url, options) => {
      state.requests.push({ url, options });
      if (state.wait) await state.wait;
      if (state.networkError) throw state.networkError instanceof Error ? state.networkError : new TypeError('Failed to fetch');
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

test('Home batches its scene settings and collections without touching About content', async () => {
  const h = harness('home');
  h.elements.get('heroSceneScale').value = '115';
  await h.save();
  assert.equal(h.state.requests[0].url, '/api/admin/website-pages/home');
  const payload = JSON.parse(h.state.requests[0].options.body).settings;
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

test('text edits do not re-upload unchanged videos or images', async () => {
  const h = harness();
  h.context.aboutVideoData = 'data:video/mp4;base64,' + 'A'.repeat(1024 * 1024);
  h.context.currentSettings = {
    about_video_url: h.context.aboutVideoData,
    vision_image: h.context.visionImageData,
    mission_image: h.context.missionImageData,
  };
  await h.save();
  const payload = JSON.parse(h.state.requests[0].options.body);
  for (const key of ['about_video_url', 'vision_image', 'mission_image']) assert.equal(Object.hasOwn(payload, key), false);
  assert(h.state.requests[0].options.body.length < 2000);
});

test('text edits preserve unchanged galleries even when saved JSON uses whitespace', async () => {
  const h=harness();
  h.context.currentSettings.vision_gallery='[ "existing-photo" ]';
  h.context.galleryData.vision=['existing-photo'];
  await h.save();
  assert.equal(Object.hasOwn(JSON.parse(h.state.requests[0].options.body),'vision_gallery'),false);
});

test('a referenced video is preserved while explicit media replacements and removals are saved', async () => {
  const h = harness();
  h.context.currentSettings = { about_video_url: '/api/site-settings/about-video?v=existing' };
  h.context.aboutVideoData = h.context.currentSettings.about_video_url;
  await h.save();
  assert.equal(Object.hasOwn(JSON.parse(h.state.requests[0].options.body), 'about_video_url'), false);
  h.context.aboutVideoData = 'data:video/mp4;base64,new-upload';
  await h.save();
  assert.equal(JSON.parse(h.state.requests[1].options.body).about_video_url, h.context.aboutVideoData);
  h.context.aboutVideoData = null;
  await h.save();
  assert.equal(JSON.parse(h.state.requests[2].options.body).about_video_url, '');
});

test('an unconfirmed timed-out save preserves the draft and requires a refresh before another write', async () => {
  const h = harness();
  h.context.videoUploadToken = '11111111-1111-4111-8111-111111111111';
  h.context.aboutVideoData = 'blob:staged-preview';
  h.elements.get('aboutText1').value = 'Keep this draft';
  h.state.networkError = Object.assign(new Error('Request timed out.'), { name: 'TimeoutError' });
  await h.save();
  assert.equal(h.button.disabled, true);
  assert.equal(h.button.attributes['aria-busy'], undefined);
  assert.equal(h.elements.get('aboutText1').value, 'Keep this draft');
  assert.match(h.state.messages[0].message, /couldn't confirm/);
  assert.equal(h.state.messages[0].options.title, 'Save Not Confirmed');
  assert.equal(h.context.videoUploadToken, null, 'the receipt cannot block refresh after an ambiguous save');
  assert.equal(h.context.videoUploadFailed, false);
  await h.save();
  assert.equal(h.state.requests.length, 1);
});

test('uploads in progress or failed uploads cannot submit any page edits', async () => {
  const h = harness();
  h.context.videoUploading = true;
  await h.save();
  h.context.videoUploading = false;
  h.context.videoUploadFailed = true;
  await h.save();
  assert.equal(h.state.requests.length, 0);
});

test('a staged video saves its receipt without sending the preview or video bytes', async () => {
  const h = harness();
  h.context.videoUploadToken = '11111111-1111-4111-8111-111111111111';
  h.context.aboutVideoData = 'blob:staged-preview';
  await h.save();
  const payload = JSON.parse(h.state.requests[0].options.body);
  assert.equal(payload.about_video_upload_token, '11111111-1111-4111-8111-111111111111');
  assert.equal(Object.hasOwn(payload, 'about_video_url'), false);
  assert.equal(h.context.videoUploadToken, null);
});
