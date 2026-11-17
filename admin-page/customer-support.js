/* Opt-in shared Admin/Staff support conversations; no session activity spoofing. */
(() => {
  'use strict';
  function init() {
    const modal = document.getElementById('inquiryDetailModal');
    if (!modal || window.FMRCInquirySupport) return;
    const token = () => window.AdminSession?.getToken() || '';
    const esc = value => String(value ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const api = String(window.APP_API_BASE_URL || location.origin + '/api').replace(/\/+$/,'');
    const owner = () => { const info = window.AdminSession?.getUserInfo(); return String((info?.data || info)?.id || '')+':'+token(); };
    let identity = owner(), generation = 0, thread = null, entries = [], earlier = false, installed = false, pending = false, polling = false, timer, inboxAt = Date.now(), failures = 0, presenceEnabled = false, leaseAt = 0, through = 0;
    const drafts = new Map(), requestKeys = new Map();
    const body = modal.querySelector('.portal-detail-dialog__body'), footer = modal.querySelector('footer'), original = document.getElementById('detailMessage');
    const section = document.createElement('section'); section.className = 'support-thread'; section.hidden = true;
    section.innerHTML = '<div class="support-thread-heading"><h3>Conversation</h3><span class="support-inbox-hint" id="supportThreadState"></span></div><button type="button" class="btn-admin btn-secondary" id="supportThreadEarlier" hidden>Earlier messages</button><div id="supportThreadLog" class="support-thread-log" role="log" aria-live="polite" aria-relevant="additions"></div>';
    body.append(section);
    const form = document.createElement('form'); form.className = 'support-reply-form'; form.hidden = true;
    form.innerHTML = '<label for="supportTeamReply">Reply to customer</label><div class="support-reply-row"><textarea id="supportTeamReply" rows="1" maxlength="3000" placeholder="Write a reply…"></textarea><button type="submit" class="btn-admin" id="supportTeamSend" disabled>Send Reply</button></div><p class="support-inbox-hint">Never request passwords, one-time codes or bank credentials.</p><button type="button" class="btn-admin btn-secondary" id="supportTeamReopen" hidden>Reopen Chat</button><p class="support-inbox-error" id="supportTeamError" role="alert" hidden></p>';
    const actions = document.createElement('div'); actions.className = 'support-inbox-actions';
    [...footer.children].forEach(child => actions.append(child)); footer.append(form,actions);
    const input = form.querySelector('textarea'), send = form.querySelector('[type=submit]'), reopen = form.querySelector('#supportTeamReopen'), error = form.querySelector('[role=alert]');
    const tools = document.createElement('div'); tools.className = 'support-inbox-tools'; tools.hidden = true;
    tools.innerHTML = '<label class="support-availability"><input type="checkbox" id="supportAvailability">Available for chat</label><span class="support-inbox-hint" id="supportAvailabilityNote">Only while this inbox is active.</span>';
    document.querySelector('.toolbar-actions')?.prepend(tools);
    const availability = tools.querySelector('input'), availabilityNote = tools.querySelector('span');
    function note(text = '') { error.textContent = text; error.hidden = !text; }
    async function request(path, options = {}) {
      const started = owner();
      const response = await fetch(api+path,{...options,cache:'no-store',headers:{Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+token()},signal:AbortSignal.timeout(15000)});
      if (started !== owner()) throw Object.assign(Error('Session changed.'),{stale:true});
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(Error(Object.values(result.errors || {}).flat()[0] || result.message || 'Support could not be loaded. Please try again.'),{status:response.status});
      return result;
    }
    function signal() { window.dispatchEvent(new CustomEvent('fmrc:customer-messages-updated',{detail:{timestamp:Date.now(),source:'support-chat'}})); }
    function date(value) { return new Date(value).toLocaleString('en-PH',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'Asia/Manila'}); }
    function entry(e) {
      if (e.event) return `<p class="support-thread-system" data-support-entry="${e.id}">${esc(e.body)} · ${esc(date(e.created_at))}</p>`;
      return `<article class="support-thread-entry" data-role="${esc(e.sender_role)}" data-support-entry="${e.id}"><div class="support-thread-sender">${e.sender_role === 'customer' ? '' : '<img src="../images/FMRC%20Logo.png" width="28" height="28" alt="">'}<strong>${esc(e.sender_name)}${e.sender_role === 'customer' ? ' · Customer' : ' · FMRC'}</strong></div><p>${esc(e.body)}</p><time datetime="${esc(e.created_at)}">${esc(date(e.created_at))}</time></article>`;
    }
    function syncControls() {
      if (!thread) { form.hidden = true; return; }
      const closed = thread?.status === 'resolved', canReply = !!thread?.can_reply;
      input.hidden = !canReply || closed; input.disabled = pending || closed || !canReply;
      send.hidden = !canReply || closed; send.disabled = pending || !input.value.trim() || closed || !canReply;
      reopen.hidden = !canReply || !closed; reopen.disabled = pending;
      form.querySelector('label').textContent = !canReply ? 'Conversation record' : closed ? 'Chat ended' : 'Reply to customer';
      form.querySelector('.support-inbox-hint').textContent = !canReply ? (thread?.removed_from_customer_history ? 'The customer removed this chat from their history. FMRC’s inquiry record is retained; use a new inquiry for further messages.' : 'This historical inquiry is not linked to a customer account. Private replies are unavailable.') : closed ? 'History is retained. Reopen the chat to send another reply.' : 'Never request passwords, one-time codes or bank credentials.';
      const badge = document.getElementById('detailStatus'); badge.textContent = closed ? 'Resolved' : 'Open'; badge.className = 'status-pill '+(closed ? 'status-green' : 'status-yellow');
      const resolve = document.getElementById('detailResolveBtn'); resolve.disabled = pending || closed;
      section.querySelector('#supportThreadState').textContent = closed ? (thread.closed_by_role === 'customer' ? 'Ended by customer' : 'Resolved by FMRC') : (thread.waiting_for === 'customer' ? 'Awaiting customer' : 'Awaiting FMRC');
    }
    function setPending(value) { pending = value; modal.dataset.supportPending = String(value); if (value) modal.setAttribute('aria-busy','true'); else modal.removeAttribute('aria-busy'); syncControls(); }
    async function markRead() {
      if (!thread || !modal.classList.contains('show') || document.hidden || body.scrollHeight-body.clientHeight-body.scrollTop > 80) return;
      const id = entries.at(-1)?.id || 0;
      if (id <= through) return;
      await request('/admin/customer-messages/'+thread.id+'/conversation-read',{method:'PATCH',body:JSON.stringify({through:id})}); through = id;
    }
    async function refresh(initial = false, before) {
      if (!thread) return;
      const id = thread.id, ticket = generation, bottom = body.scrollHeight-body.clientHeight-body.scrollTop < 90;
      const cursor = before ? '?before='+before : initial ? '' : '?after='+(entries.at(-1)?.id || 0);
      const result = await request('/admin/customer-messages/'+id+'/entries'+cursor);
      if (ticket !== generation || thread?.id !== id) return;
      thread = result.conversation;
      const log = section.querySelector('#supportThreadLog');
      if (initial) { entries = result.data || []; earlier = !!result.has_more; log.innerHTML = entries.map(entry).join(''); }
      else if (before) { const height = body.scrollHeight; entries = [...result.data,...entries]; earlier = !!result.has_more; log.innerHTML = entries.map(entry).join(''); body.scrollTop += body.scrollHeight-height; }
      else { const added = (result.data || []).filter(e => !entries.some(old => old.id === e.id)); entries.push(...added); added.forEach(e => log.insertAdjacentHTML('beforeend',entry(e))); if (result.has_more) setTimeout(() => { if (thread?.id === id && modal.classList.contains('show')) void refresh().catch(() => {}); },100); }
      section.querySelector('#supportThreadEarlier').hidden = !earlier; syncControls();
      if (initial || bottom) body.scrollTop = body.scrollHeight;
      await markRead();
    }
    async function open(row, ready) {
      generation++; installed = ready || !!row.last_entry_at; thread = row; entries = []; through = 0; earlier = false; note();
      section.hidden = form.hidden = !installed; footer.classList.toggle('support-inbox-footer',installed); original.closest('.inquiry-detail-box').hidden = installed;
      if (!installed) return;
      input.value = drafts.get(String(row.id)) || ''; section.querySelector('#supportThreadLog').textContent = 'Loading conversation…'; syncControls();
      try { await refresh(true); } catch (e) { if (!e.stale) note(e.status === 404 ? 'This inquiry is no longer available.' : e.message); }
    }
    input.addEventListener('input',() => { if (thread) drafts.set(String(thread.id),input.value); syncControls(); });
    form.addEventListener('submit',async event => {
      event.preventDefault(); const text = input.value.trim(); if (!thread || !text || pending || thread.status === 'resolved') return;
      const id = thread.id, ticket = generation, key = String(id);
      if (!requestKeys.has(key) || requestKeys.get(key).body !== text) requestKeys.set(key,{id:crypto.randomUUID(),body:text});
      setPending(true); note();
      try {
        await request('/admin/customer-messages/'+id+'/entries',{method:'POST',body:JSON.stringify({body:text,request_key:requestKeys.get(key).id})});
        if (ticket !== generation) return;
        drafts.delete(key); requestKeys.delete(key); input.value = ''; await refresh(); body.scrollTop = body.scrollHeight; signal();
      } catch (e) { if (!e.stale) note(e.message+' Your draft has been kept.'); }
      finally { if (ticket === generation) setPending(false); }
    });
    reopen.addEventListener('click',async () => { if (!thread || pending) return; setPending(true); note(); try { const result = await request('/admin/customer-messages/'+thread.id+'/reopen',{method:'POST',body:'{}'}); thread = result.data; await refresh(); signal(); } catch (e) { if (!e.stale) note(e.message); } finally { setPending(false); } });
    section.querySelector('#supportThreadEarlier').onclick = () => { if (entries.length && !pending) void refresh(false,entries[0].id).catch(e => note(e.message)); };
    let readTimer; body.addEventListener('scroll',() => { clearTimeout(readTimer); readTimer = setTimeout(() => { void markRead().catch(() => {}); },250); },{passive:true});
    async function presence(value) { const result = await request('/admin/customer-support/presence',{method:'POST',body:JSON.stringify({available:value})}); presenceEnabled = !!result.available; availability.checked = presenceEnabled; leaseAt = Date.now(); availabilityNote.textContent = presenceEnabled ? 'Available while this inbox is active.' : 'Customers can still leave a message.'; }
    availability.addEventListener('change',async () => { const requested = availability.checked; availability.disabled = true; try { await presence(requested); } catch (e) { availability.checked = presenceEnabled; availabilityNote.textContent = e.message; } finally { availability.disabled = false; } });
    async function tick() {
      clearTimeout(timer);
      if (identity !== owner()) { identity = owner(); generation++; drafts.clear(); requestKeys.clear(); thread = null; entries = []; presenceEnabled = false; availability.checked = false; section.hidden = form.hidden = true; }
      if (!document.hidden && navigator.onLine && !polling) {
        polling = true;
        try {
          if (installed && presenceEnabled && Date.now()-leaseAt >= 18000) await presence(true);
          if (installed && thread && modal.classList.contains('show') && !pending) await refresh();
          if (Date.now()-inboxAt >= 14000 && !pending) { inboxAt = Date.now(); signal(); }
          failures = 0;
        } catch (e) { if (!e.stale) { failures++; if (e.status === 401 || e.status === 403) { presenceEnabled = false; availability.checked = false; } if (modal.classList.contains('show')) note(e.message); } }
        finally { polling = false; }
      }
      if (!document.hidden) timer = setTimeout(tick,Math.min(30000,3000*2**Math.min(failures,3)));
    }
    document.addEventListener('visibilitychange',() => { clearTimeout(timer); if (document.hidden) { if (presenceEnabled) { leaseAt = 0; void request('/admin/customer-support/presence',{method:'POST',body:'{"available":false}'}).catch(() => {}); } } else { leaseAt = 0; void tick(); } });
    window.addEventListener('online',() => { failures = 0; void tick(); });
    window.FMRCInquirySupport = {open};
    void request('/support/availability').then(async result => {
      installed = !!result.installed; tools.hidden = !installed;
      if (installed) { const lease = await request('/admin/customer-support/presence'); presenceEnabled = !!lease.available; availability.checked = presenceEnabled; }
    }).catch(() => {}).finally(() => void tick());
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
})();
