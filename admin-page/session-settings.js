/* Personal security policy. Only server readback establishes a saved change. */
document.addEventListener('DOMContentLoaded', () => {
  'use strict';
  const card = document.getElementById('sessionPolicyCard');
  if (!card) return;
  const enabled = document.getElementById('sessionPolicyEnabled');
  const hours = document.getElementById('sessionPolicyHours');
  const status = document.getElementById('sessionPolicyStatus');
  const current = document.getElementById('sessionPolicyCurrent');
  const retry = document.getElementById('sessionPolicyRetry');
  const owner = () => window.AdminSession?.getToken() || '';
  const configured = window.APP_API_BASE_URL || document.querySelector('meta[name="api-base-url"]')?.content;
  const api = (configured || ((['localhost','127.0.0.1'].includes(location.hostname) && location.port !== '8000') ? location.protocol+'//'+location.hostname+':8000/api' : location.origin+'/api')).replace(/\/+$/, '');
  let account = owner(), loaded = false, busy = false, dirty = false, failedSave = false, generation = 0;
  const controls = () => { enabled.disabled = !loaded || busy; hours.disabled = !loaded || busy || !enabled.checked; retry.disabled = busy; };
  async function request(path, method = 'GET', data) {
    const response = await fetch(api+'/admin/session'+path, {method, cache:'no-store', headers:{Accept:'application/json',Authorization:'Bearer '+account,...(data ? {'Content-Type':'application/json'} : {})},...(data ? {body:JSON.stringify(data)} : {})});
    const json = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(json.message || 'Session settings could not be saved.');
    return json;
  }
  async function load() {
    const ticket = ++generation, token = account = owner();
    loaded = false; busy = true; controls(); retry.hidden = true;
    status.textContent = 'Loading your session settings…';
    try {
      const [result,timing] = await Promise.all([request('/preferences'),request('')]);
      if (ticket !== generation || token !== owner()) return;
      const p = result.preferences;
      if (typeof p?.enabled !== 'boolean' || ![6,12].includes(p.max_hours)) throw new Error('Session settings are unavailable.');
      enabled.checked = p.enabled; hours.value = String(p.max_hours); loaded = true; dirty = false; failedSave = false;
      current.textContent = timing.absolute_expires_at ? 'Current session ends '+new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}).format(new Date(timing.absolute_expires_at))+' (Philippine time).' : timing.absolute_limit_enabled === false ? 'This session has no scheduled sign-out. Inactivity protection remains active.' : 'Your current session keeps its existing deadline.';
      status.textContent = 'Saved to your account. Changes take effect the next time you sign in.';
    } catch (error) {
      if (ticket !== generation || token !== owner()) return;
      status.textContent = error.message; retry.hidden = false;
    } finally { if (ticket === generation && token === owner()) { busy = false; controls(); } }
  }
  async function save() {
    if (!loaded || busy || account !== owner()) return;
    const ticket = generation, token = account;
    const draft = {enabled:enabled.checked,max_hours:Number(hours.value)};
    busy = true; dirty = true; controls(); retry.hidden = true; status.textContent = 'Saving your next-sign-in preference…';
    try {
      const result = await request('/preferences','PUT',draft);
      if (ticket !== generation || token !== owner()) return;
      if (result.preferences?.enabled !== draft.enabled || result.preferences?.max_hours !== draft.max_hours) throw new Error('The saved settings could not be confirmed. Please try again.');
      dirty = false; failedSave = false;
      status.textContent = 'Saved for your next sign-in. Your current session is unchanged.';
    } catch (error) {
      if (ticket !== generation || token !== owner()) return;
      failedSave = true; status.textContent = error.message+' Your selection has not been saved.'; retry.hidden = false;
    } finally { if (ticket === generation && token === owner()) { busy = false; controls(); } }
  }
  enabled.addEventListener('change',save); hours.addEventListener('change',save);
  retry.addEventListener('click',()=>failedSave ? save() : load());
  document.getElementById('settingsResetBtn')?.addEventListener('click',()=>{
    if (!loaded || busy) { status.textContent = 'Workspace defaults were requested, but session defaults could not be saved. Retry this card when available.'; return; }
    enabled.checked = true; hours.value = '6'; void save();
  });
  window.addEventListener('admin:session-updated',()=>{ if (owner() !== account) void load(); });
  window.addEventListener('focus',()=>{ if (!busy && !dirty) void load(); });
  window.addEventListener('storage',()=>{ if (owner() !== account) void load(); });
  void load();
});
