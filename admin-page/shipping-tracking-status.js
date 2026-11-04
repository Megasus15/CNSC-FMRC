/* Read-only for Staff; Admin activation never exposes provider credentials. */
(() => {
  'use strict';
  document.addEventListener('DOMContentLoaded', () => {
    const anchor = document.querySelector('.shipping-live');
    if (!anchor) return;
    const panel = document.createElement('section');
    panel.className = 'payment-settings-card wm-section shipping-tracking-status';
    panel.setAttribute('aria-labelledby','shippingTrackingTitle');
    panel.innerHTML = '<div class="shipping-section-heading"><div><h3 id="shippingTrackingTitle">J&T tracking</h3><p>Record the physical J&T handover in Orders. Ship24 supplies automatic courier updates when active.</p></div><span class="shipping-status" data-tracking-state>Loading…</span></div>'+
      '<p data-tracking-message role="status" aria-live="polite">Loading tracking availability…</p><dl class="shipping-tracking-facts" data-tracking-facts></dl>'+
      '<p class="shipping-calendar-note">FMRC registrations show this installation’s activity for the current Philippine calendar month. Ship24’s account dashboard determines the actual allowance and reset date. Shipping can continue when automatic updates are unavailable.</p>'+
      '<div class="shipping-save-actions"><button class="btn-admin" type="button" data-tracking-toggle hidden>Activate automatic tracking</button><a class="btn-admin btn-secondary" href="https://dashboard.ship24.com" target="_blank" rel="noopener noreferrer" data-tracking-dashboard hidden>Open Ship24 account</a></div>';
    anchor.after(panel);
    const api = String(window.APP_API_BASE_URL || (['localhost','127.0.0.1'].includes(location.hostname) && location.port!=='8000' ? location.protocol+'//'+location.hostname+':8000/api' : location.origin+'/api')).replace(/\/$/,'');
    const toggle = panel.querySelector('[data-tracking-toggle]');
    const escape = text => String(text ?? '').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    const date = value => value ? new Date(value.includes('T') ? value : value.replace(' ','T')+'Z').toLocaleString('en-PH',{timeZone:'Asia/Manila'}) : 'Not yet received';
    let record = null, busy = false;
    const render = () => {
      toggle.hidden = !record?.can_edit;
      toggle.disabled = busy || !record?.installed || (!record.enabled && !record.ready);
      toggle.textContent = record?.enabled ? 'Pause automatic tracking' : 'Activate automatic tracking';
      panel.querySelector('[data-tracking-dashboard]').hidden = !record?.can_edit;
      if (!record) return;
      panel.querySelector('[data-tracking-state]').textContent = record.enabled ? 'Active' : 'Not active';
      panel.querySelector('[data-tracking-message]').textContent = record.message;
      const facts = [
        ['Connection', record.configured ? 'Configured' : 'Setup required'],
        ['J&T Philippines carrier', record.carrier_verified ? 'Verified' : 'Verification required'],
        ['Real waybill', record.waybill_verified ? 'Verified' : 'Verification required'],
        ['Webhook delivery', record.webhook_verified ? 'Verified' : 'Verification required'],
        ['Background processing', record.processor_healthy ? 'Running' : 'Needs attention'],
        ['FMRC registrations this month', (record.registrations ?? 0)+' / '+(record.registration_limit ?? 10)+' local limit'],
        ['Waiting for registration', record.pending ?? 0], ['Needs review', record.failed ?? 0],
        ['Latest update received', date(record.last_webhook_at)],
        ['Updates awaiting processing', record.pending_updates ?? 0],
        ['Unmatched updates', record.quarantined_updates ?? 0],
        ['Notifications awaiting delivery', record.pending_notifications ?? 0],
      ];
      panel.querySelector('[data-tracking-facts]').innerHTML = facts.map(([label,value])=>'<div><dt>'+escape(label)+'</dt><dd>'+escape(value)+'</dd></div>').join('');
    };
    const load = async (payload = null) => {
      if (busy) return;
      busy = true; render();
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
        busy=false;toggle.disabled=true;return;
      } finally { clearTimeout(timer);busy=false; }
      render();
    };
    window.FMRCShippingTracking = Object.freeze({refresh: load});
    toggle.onclick=()=>{
      if(toggle.disabled)return;
      window.showAdminConfirmPopup(record.enabled ? 'Pause automatic registration and scheduled tracking checks? Saved waybills and history remain available.' : 'Activate automatic tracking for verified J&T shipments within the free pilot allowance?',
        {title:record.enabled?'Pause Automatic Tracking':'Activate Automatic Tracking',confirmText:record.enabled?'Pause tracking':'Activate tracking',onConfirm:()=>load({enabled:!record.enabled,expected_revision:record.revision})});
    };
    void load();
  });
})();
