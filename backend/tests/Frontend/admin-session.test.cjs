const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../../admin-page/admin-session.js'), 'utf8');
const start = Date.parse('2026-09-25T00:00:00Z');

function harness(role = 'admin', initialToken = '17|secret') {
  let now = start;
  let serverTime = start;
  let elapsed = 0;
  const storage = new Map([[`${role}_auth_token`, initialToken]]);
  const sessionValues = new Map();
  const calls = [];
  const windowEvents = new Map();
  const documentEvents = new Map();
  const intervals = [];
  const timeouts = new Map();
  let timeoutId = 0;
  let redirect = '';
  let activityAt = start;

  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }

  function on(map, name, fn) {
    map.set(name, [...(map.get(name) || []), fn]);
  }
  function dispatch(map, name, extra = {}) {
    for (const fn of map.get(name) || []) fn({ type: name, isTrusted: true, ...extra });
  }

  const stayButton = {
    disabled: false,
    isConnected: true,
    addEventListener(type, fn) { this[type] = fn; },
    focus() { document.activeElement = this; },
    click() { return this.click?.({ type: 'click' }); },
  };
  const countdown = { textContent: '' };
  const status = { textContent: '' };
  const dialog = {
    hidden: true,
    innerHTML: '',
    addEventListener(type, fn) { this[type] = fn; },
    querySelector(selector) {
      if (selector.includes('remaining strong')) return countdown;
      if (selector.includes('__status')) return status;
      if (selector.includes('__stay')) return stayButton;
      return null;
    },
  };
  const classes = new Set();
  const document = {
    body: {
      appendChild() {},
      classList: { add: name => classes.add(name), remove: name => classes.delete(name) },
    },
    activeElement: { isConnected: true, focus() {} },
    hidden: false,
    querySelector() { return null; },
    createElement() { return dialog; },
    addEventListener(name, fn) { on(documentEvents, name, fn); },
  };
  const window = {
    location: {
      pathname: `/${role}-page/dashboard.html`, protocol: 'https:',
      hostname: 'example.test', port: '', origin: 'https://example.test',
      replace(value) { redirect = value; },
    },
    AdminSession: {
      role,
      getToken: () => storage.get(`${role}_auth_token`) || '',
      clearSession() { storage.delete(`${role}_auth_token`); storage.delete(`${role}_user_info`); },
    },
    addEventListener(name, fn) { on(windowEvents, name, fn); },
  };
  const deadline = () => ({
    server_time: new ClockDate(serverTime).toISOString(),
    idle_warning_at: new ClockDate(activityAt + 60 * 60_000).toISOString(),
    idle_expires_at: new ClockDate(activityAt + 63 * 60_000).toISOString(),
    absolute_expires_at: new ClockDate(start + 6 * 60 * 60_000).toISOString(),
  });
  const fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (options.method === 'POST' && JSON.parse(options.body).interaction === 'stay_signed_in') {
      activityAt = serverTime;
    } else if (options.method === 'POST' && serverTime < activityAt + 60 * 60_000) {
      activityAt = serverTime;
    }
    return { ok: true, status: 200, json: async () => deadline() };
  };
  const context = vm.createContext({
    window, document, fetch, Date: ClockDate,
    performance: { now: () => elapsed },
    setInterval: fn => intervals.push(fn),
    setTimeout: (fn, delay) => { const id = ++timeoutId; timeouts.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: id => timeouts.delete(id),
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
    sessionStorage: {
      getItem: key => sessionValues.get(key) || null,
      setItem: (key, value) => sessionValues.set(key, value),
    },
  });
  vm.runInContext(source, context);

  return {
    calls, storage, sessionValues, classes, dialog, countdown, status,
    get redirect() { return redirect; },
    async flush() { await new Promise(resolve => setImmediate(resolve)); },
    advance(ms) {
      now += ms;
      serverTime += ms;
      elapsed += ms;
      for (const [id, timer] of timeouts) {
        if (timer.at <= now) { timeouts.delete(id); timer.fn(); }
      }
      for (const fn of intervals) fn();
    },
    jumpClock(ms) {
      now += ms;
      for (const fn of intervals) fn();
    },
    gesture(name = 'pointerdown') { dispatch(documentEvents, name); },
    focus() { dispatch(windowEvents, 'focus'); },
    async stay() { await stayButton.click(); },
  };
}

test('warns at one hour, accepts only Stay signed in, and ends at 63 minutes', async () => {
  const h = harness();
  await h.flush();
  h.advance(59 * 60_000);
  assert.equal(h.dialog.hidden, true);
  h.advance(60_000);
  assert.equal(h.dialog.hidden, false);
  assert.equal(h.countdown.textContent, '03:00');
  const before = h.calls.length;
  h.gesture();
  await h.flush();
  assert.equal(h.calls.length, before, 'incidental gestures cannot extend the warning');
  h.advance(3 * 60_000);
  assert.equal(h.redirect, '../admin-auth/auth.html');
  assert.equal(h.storage.has('admin_auth_token'), false);
  assert.match(h.sessionValues.get('fmrc_admin_session_notice'), /inactivity/i);
});

test('Stay signed in renews idle time but not the six-hour absolute limit', async () => {
  const h = harness('staff');
  await h.flush();
  h.advance(60 * 60_000);
  assert.equal(h.dialog.hidden, false);
  await h.stay();
  assert.equal(h.dialog.hidden, true);
  h.advance(5 * 60 * 60_000);
  assert.equal(h.redirect, '../admin-auth/auth.html');
  assert.match(h.sessionValues.get('fmrc_admin_session_notice'), /six-hour/i);
});

test('server status is checked on focus without reporting human activity', async () => {
  const h = harness();
  await h.flush();
  const before = h.calls.length;
  h.focus();
  await h.flush();
  assert.equal(h.calls.length, before + 1);
  assert.equal(h.calls.at(-1).options.method, 'GET');
});

test('a device clock jump does not sign out a session before server revalidation', async () => {
  const h = harness();
  await h.flush();
  h.jumpClock(8 * 60 * 60_000);
  assert.equal(h.redirect, '');
  h.focus();
  await h.flush();
  assert.equal(h.redirect, '');
  h.advance(60 * 60_000);
  assert.equal(h.dialog.hidden, false);
});
