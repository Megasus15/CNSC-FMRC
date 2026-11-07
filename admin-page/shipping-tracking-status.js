/* Read-only for Staff; Admin activation never exposes provider credentials. */
(() => {
  'use strict';
  document.addEventListener('DOMContentLoaded', () => {
    const anchor = document.querySelector('.shipping-live');
    if (!anchor) return;
    const panel = document.createElement('section');
    panel.className = 'payment-settings-card wm-section shipping-tracking-status';
    panel.setAttribute('aria-labelledby','shippingTrackingTitle');
    panel.innerHTML = '<div class="shipping-section-heading"><div><h3 id="shippingTrackingTitle">J&T tracking</h3><p>Record the physical J&T handover in Orders. 17TRACK supplies automatic courier updates when active. Standard carrier checks can take 6–12 hours.</p></div><span class="shipping-status" data-tracking-state>Loading…</span></div>'+
      '<p data-tracking-message role="status" aria-live="polite">Loading tracking availability…</p><dl class="shipping-tracking-facts" data-tracking-facts></dl>'+
      '<p class="shipping-calendar-note">The local credit budget includes diagnostics and uncertain registration attempts. It does not reset monthly. The provider account dashboard shows the actual remaining allowance. Saved tracking numbers remain available if credits run out.</p>'+
      '<div class="shipping-save-actions"><button class="btn-admin" type="button" data-tracking-toggle hidden>Activate automatic tracking</button><a class="btn-admin btn-secondary" href="https://admin.17track.net/api/dashboard" target="_blank" rel="noopener noreferrer" data-tracking-dashboard hidden>Open 17TRACK account</a></div>';
    anchor.after(panel);
    const api = String(window.APP_API_BASE_URL || (['localhost','127.0.0.1'].includes(location.hostname) && location.port!=='8000' ? location.protocol+'//'+location.hostname+':8000/api' : location.origin+'/api')).replace(/\/$/,'');
    const toggle = panel.querySelector('[data-tracking-toggle]');
    const escape = text => String(text ?? '').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    const date = value => value ? new Date(value.includes('T') ? value : value.replace(' ','T')+'Z').toLocaleString('en-PH',{timeZone:'Asia/Manila'}) : 'Not yet received';
    let record = null, busy = false, request = null;
    const render = () => {
      toggle.hidden = !record?.can_edit;
      toggle.disabled = busy || !record?.installed || (!record.enabled && !record.ready);
      toggle.textContent = record?.enabled ? 'Pause automatic tracking' : 'Activate automatic tracking';
      panel.querySelector('[data-tracking-dashboard]').hidden = !record?.can_edit;
      if (!record) return;
      const dashboard = panel.querySelector('[data-tracking-dashboard]');
      const providerName = record.provider_name || '17TRACK';
      dashboard.textContent = 'Open '+providerName+' account';
      dashboard.href = 'https://admin.17track.net/api/dashboard';
      panel.querySelector('[data-tracking-state]').textContent = record.enabled ? 'Active' : 'Not active';
      panel.querySelector('[data-tracking-message]').textContent = record.message;
      const facts = [
        ['Connection', record.configured ? 'Configured' : 'Setup required'],
        ['J&T Philippines carrier', record.carrier_verified ? 'Verified' : 'Verification required'],
        ['FMRC parcel tracking', record.waybill_verified ? 'Verified' : 'Verification required'],
        ['Webhook delivery', record.webhook_verified ? 'Verified' : 'Verification required'],
        ['Background processing', record.processor_healthy ? 'Running' : 'Needs attention'],
        ['Tracking credits reserved', (record.budget_used ?? record.registrations ?? 0)+' / '+(record.registration_limit ?? 200)+' lifetime local limit'],
        ['Local budget remaining', record.budget_remaining ?? 'Not available'],
        ['Provider', providerName],
        ['Standard carrier check interval', record.standard_interval || 'Provider dependent'],
        ['Waiting for registration', record.pending ?? 0], ['Needs review', record.failed ?? 0],
        ['Latest update received', date(record.last_webhook_at)],
        ['Updates awaiting processing', record.pending_updates ?? 0],
        ['Unmatched updates', record.quarantined_updates ?? 0],
        ['Notifications awaiting delivery', record.pending_notifications ?? 0],
      ];
      panel.querySelector('[data-tracking-facts]').innerHTML = facts.map(([label,value])=>'<div><dt>'+escape(label)+'</dt><dd>'+escape(value)+'</dd></div>').join('');
    };
    const load = (payload = null) => {
      if (request) return request;
      busy = true; render();
      request = (async () => {
        const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),15000);
        try {
          const response = await fetch(api+'/admin/shipping-tracking', {method:payload?'PUT':'GET',body:payload?JSON.stringify(payload):undefined,cache:'no-store',signal:controller.signal,
            headers:{Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+window.AdminSession?.getToken()}});
          const json = await response.json().catch(()=>({}));
          if (!response.ok || !json.data) {
            const message = Object.values(json.errors||{}).flat()[0] || json.message;
            throw Error(response.status<500 && message && !/SQLSTATE|Laravel|Exception/i.test(message) ? message : 'Tracking availability could not be loaded. Please try again.');
          }
          record = json.data;
        } catch (error) {
          panel.querySelector('[data-tracking-message]').textContent = error.name==='AbortError'||error.name==='TypeError' ? 'Tracking status could not be refreshed. Check your connection and try again.' : error.message;
          busy=false;toggle.disabled=true;return false;
        } finally { clearTimeout(timer);busy=false; }
        render();
        return true;
      })().finally(()=>{request=null;});
      return request;
    };
    window.FMRCShippingTracking = Object.freeze({refresh: () => load()});
    toggle.onclick=()=>{
      if(toggle.disabled)return;
      window.showAdminConfirmPopup(record.enabled ? 'Pause automatic registration and scheduled tracking checks? Saved tracking numbers and history remain available.' : 'Activate automatic tracking for verified J&T shipments within the configured credit budget?',
        {title:record.enabled?'Pause Automatic Tracking':'Activate Automatic Tracking',confirmText:record.enabled?'Pause tracking':'Activate tracking',onConfirm:()=>load({enabled:!record.enabled,expected_revision:record.revision})});
    };
    void load();
  });
})();
