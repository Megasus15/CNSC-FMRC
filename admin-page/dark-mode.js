/* Shared authenticated portal preferences. Load in <head> before first paint. */
(() => {
  "use strict";
  if (!/(?:^|\/)(?:admin-page|staff-page)\//.test(location.pathname) || /maintenance-preview\.html$/.test(location.pathname)) return;
  const root = document.documentElement;
  const defaults = { theme: "system", compact: false, reducedMotion: false };
  const role = location.pathname.includes('/staff-page/') ? 'staff' : 'admin';
  const infoKey = `${role}_user_info`, tokenKey = `${role}_auth_token`;
  const modes = ["light", "dark", "system"];
  const scheme = window.matchMedia("(prefers-color-scheme: dark)");
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let preferences = { ...defaults }, persistent = true, chartRegistered = false, channel;
  let identity = '', key = '', token = '', pending = false, writing = false, version = 0;
  let saveState = 'loading';
  const chartAnimations = new WeakMap();
  const apiBase = () => {
    const configured = window.APP_API_BASE_URL || document.querySelector('meta[name="api-base-url"]')?.content;
    if (configured) return configured.replace(/\/+$/, '');
    return /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && location.port !== '8000'
      ? `${location.protocol}//${location.hostname}:8000/api` : `${location.origin}/api`;
  };
  function normalize(stored) {
    return { theme: modes.includes(stored?.theme) ? stored.theme : defaults.theme,
      compact: stored?.compact === true, reducedMotion: stored?.reducedMotion === true };
  }
  function bindAccount() {
    let nextId = '', nextToken = '';
    try {
      const info = JSON.parse(localStorage.getItem(infoKey) || 'null');
      const user = info?.data || info;
      nextToken = localStorage.getItem(tokenKey) || '';
      if (nextToken && /^\d+$/.test(String(user?.id || ''))) nextId = String(user.id);
    } catch (_) { persistent = false; }
    if (nextId === identity && nextToken === token) return false;
    identity = nextId; token = nextToken; key = identity ? `fmrc-portal-preferences:user:${identity}` : '';
    preferences = { ...defaults }; pending = false; version++;
    channel?.close(); channel = null;
    if (key) {
      preferences = read();
      try { channel = new BroadcastChannel(key); channel.onmessage = () => { version++; preferences = read(); saveState = pending ? 'saving' : 'saved'; apply(); }; }
      catch (_) { /* Account-scoped storage events remain available. */ }
    }
    saveState = identity ? 'loading' : 'guest';
    return true;
  }
  function read() {
    if (!key) return { ...defaults };
    try {
      const stored = JSON.parse(localStorage.getItem(key) || "null");
      pending = stored?._pending === true;
      return normalize(stored);
    } catch (_) { persistent = false; return preferences; }
  }
  function cache() {
    if (!key) return;
    try { localStorage.setItem(key, JSON.stringify({ ...preferences, _pending: pending })); persistent = true; }
    catch (_) { persistent = false; }
  }
  function cachedSnapshot() {
    try { return key ? localStorage.getItem(key) : null; }
    catch (_) { return null; }
  }
  async function request(method, snapshot) {
    const response = await fetch(`${apiBase()}/admin/preferences`, {
      method, headers: { Accept: 'application/json', Authorization: `Bearer ${token}`,
        ...(method === 'PUT' ? { 'Content-Type': 'application/json' } : {}) },
      ...(typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? { signal: AbortSignal.timeout(10000) } : {}),
      cache: 'no-store', ...(snapshot ? { body: JSON.stringify(snapshot) } : {}),
    });
    if (!response.ok) throw new Error('Preferences unavailable');
    return response.json();
  }
  async function save() {
    if (writing || !identity || !pending) return;
    writing = true;
    const owner = identity, ownerToken = token;
    try {
      while (pending && owner === identity && ownerToken === token) {
        const revision = version, snapshot = { ...preferences };
        saveState = 'saving'; syncControls();
        const result = await request('PUT', snapshot);
        if (owner !== identity || ownerToken !== token || String(result.user_id) !== owner) return;
        if (revision === version) { pending = false; saveState = 'saved'; cache(); channel?.postMessage({ updated: true }); }
      }
    } catch (_) { if (owner === identity) saveState = 'offline'; }
    finally { writing = false; syncControls(); if (pending && (owner !== identity || ownerToken !== token)) save(); }
  }
  async function refresh() {
    if (!identity || writing) return;
    if (pending) { save(); return; }
    const owner = identity, ownerToken = token, revision = version;
    const cachedAtRequest = cachedSnapshot();
    try {
      const result = await request('GET');
      if (owner !== identity || ownerToken !== token || revision !== version || pending || String(result.user_id) !== owner) return;
      // A storage event can arrive after this response. Read the cache directly
      // so an older server snapshot cannot overwrite another tab's newer edit.
      if (cachedSnapshot() !== cachedAtRequest) {
        version++; preferences = read(); saveState = pending ? 'saving' : 'saved'; apply();
        return;
      }
      preferences = normalize(result.preferences); saveState = 'saved'; cache(); apply();
    } catch (_) { if (owner === identity) { saveState = 'offline'; syncControls(); } }
  }
  function chartColors(chart) {
    const dark = root.dataset.theme === "dark";
    const text = dark ? "#b7bdc9" : "#606875", grid = dark ? "#343944" : "#e8e3df";
    const options = chart.options;
    if (!options) return;
    if (root.dataset.portalMotion === 'reduced') {
      if (!chartAnimations.has(chart)) chartAnimations.set(chart, options.animation);
      options.animation = false;
    } else if (chartAnimations.has(chart)) {
      const previous = chartAnimations.get(chart);
      if (previous === undefined) delete options.animation;
      else options.animation = previous;
      chartAnimations.delete(chart);
    }
    options.color = text;
    Object.values(options.scales || {}).forEach(scale => {
      if (scale.ticks) scale.ticks.color = text;
      if (scale.grid) scale.grid.color = grid;
      if (scale.border) scale.border.color = grid;
      if (scale.title) scale.title.color = text;
    });
    const plugins = options.plugins || {};
    if (plugins.legend?.labels) plugins.legend.labels.color = text;
    if (plugins.tooltip) Object.assign(plugins.tooltip, {
      backgroundColor: dark ? "#252a34" : "#fdfaf6", titleColor: dark ? "#edf0f5" : "#2b2b31",
      bodyColor: text, borderColor: grid, borderWidth: 1,
    });
  }
  function syncCharts() {
    const Chart = window.Chart;
    if (!Chart?.defaults) return;
    Chart.defaults.color = root.dataset.theme === "dark" ? "#b7bdc9" : "#606875";
    if (!chartRegistered && typeof Chart.register === "function") {
      Chart.register({ id: "fmrcPortalTheme", beforeUpdate: chartColors });
      chartRegistered = true;
    }
    Object.values(Chart.instances || {}).forEach(chart => { chartColors(chart); chart.update("none"); });
  }
  function syncControls() {
    document.querySelectorAll('[name="portalTheme"]').forEach(input => { input.checked = input.value === preferences.theme; });
    document.querySelectorAll("[data-portal-preference]").forEach(input => { input.checked = preferences[input.dataset.portalPreference] === true; });
    const status = document.getElementById("settingsSaveStatus");
    if (status) status.textContent = saveState === 'saved' ? 'Saved to your account. Your preferences follow you across portal pages and devices.'
      : saveState === 'saving' ? 'Saving your preferences…'
      : saveState === 'loading' ? 'Loading your personal preferences…'
      : saveState === 'guest' ? 'Sign in to save your personal preferences.'
      : persistent ? 'Applied on this device. Account sync is temporarily unavailable and will retry automatically.' : 'Applied for this page. Your preferences have not been saved yet.';
    const stateLabel = document.getElementById('settingsStateLabel');
    if (stateLabel) stateLabel.textContent = saveState === 'saved' ? 'Saved to your account' : saveState === 'saving' ? 'Saving changes' : saveState === 'loading' ? 'Loading preferences' : 'Applied on this device';
    const current = document.getElementById("settingsCurrentTheme");
    if (current) current.textContent = `${root.dataset.theme === "dark" ? "Dark" : "Light"} appearance${preferences.theme === "system" ? " · following your device" : ""}`;
  }
  function apply() {
    root.dataset.portal = "true";
    root.dataset.theme = !identity ? 'light' : preferences.theme === "system" ? scheme.matches ? "dark" : "light" : preferences.theme;
    root.dataset.themePreference = preferences.theme;
    root.dataset.tableDensity = preferences.compact ? "compact" : "comfortable";
    root.dataset.portalMotion = preferences.reducedMotion || motion.matches ? "reduced" : "full";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = root.dataset.theme === "dark" ? "#191d25" : "#800000";
    syncCharts(); syncControls();
    window.dispatchEvent(new CustomEvent("adminThemeChanged", { detail: { theme: root.dataset.theme, preference: preferences.theme } }));
    window.dispatchEvent(new CustomEvent("adminPreferencesChanged", { detail: { ...preferences } }));
  }
  function set(patch) {
    if (!identity) return;
    preferences = {
      theme: modes.includes(patch.theme) ? patch.theme : preferences.theme,
      compact: typeof patch.compact === "boolean" ? patch.compact : preferences.compact,
      reducedMotion: typeof patch.reducedMotion === "boolean" ? patch.reducedMotion : preferences.reducedMotion,
    };
    pending = true; version++; saveState = 'saving'; cache();
    apply(); channel?.postMessage({ updated: true }); save();
  }
  window.AdminPreferences = { get: () => ({ ...preferences }), set, reset: () => set(defaults) };
  window.setAdminTheme = theme => set({ theme });
  window.getAdminThemePreference = () => preferences.theme;
  window.getAdminActiveTheme = () => root.dataset.theme;
  bindAccount(); apply();
  scheme.addEventListener("change", () => { if (preferences.theme === "system") apply(); });
  motion.addEventListener("change", apply);
  window.addEventListener("storage", event => {
    if (event.key === infoKey || event.key === tokenKey || event.key === null) { bindAccount(); apply(); refresh(); }
    else if (key && event.key === key) { version++; preferences = read(); saveState = pending ? 'saving' : 'saved'; apply(); }
  });
  window.addEventListener('admin:session-updated', () => { if (bindAccount()) { apply(); refresh(); } });
  window.addEventListener("pageshow", () => { bindAccount(); if (persistent) preferences = read(); apply(); });
  window.addEventListener('online', refresh);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { bindAccount(); if (persistent) preferences = read(); apply(); refresh(); } });
  document.addEventListener("DOMContentLoaded", () => { syncCharts(); syncControls(); refresh(); }, { once: true });
  setInterval(() => { if (!document.hidden) refresh(); }, 30000);
  window.addEventListener("load", syncCharts, { once: true });
})();
