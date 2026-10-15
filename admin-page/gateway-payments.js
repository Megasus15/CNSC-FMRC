document.addEventListener('DOMContentLoaded', () => {
  const target = document.getElementById('paymentsHistoryTable');
  if (!target) return;
  const base = (window.APP_API_BASE_URL || ((['localhost','127.0.0.1'].includes(location.hostname) && location.port !== '8000') ? location.protocol + '//' + location.hostname + ':8000/api' : location.origin + '/api')).replace(/\/$/, '');
  const panel = document.createElement('details'); panel.className = 'gateway-team';
  panel.innerHTML = `<summary><span><i class="fa-solid fa-credit-card" aria-hidden="true"></i> Online payments &amp; refunds</span><i class="fa-solid fa-chevron-down gateway-chevron" aria-hidden="true"></i></summary><div class="gateway-content"><p class="gateway-intro">Track online payments and review refund requests. Payment confirmation is separate from order approval.</p><div class="gateway-health" data-gateway-health role="status">Loading payment status\u2026</div><div class="gateway-toolbar"><label><input type="checkbox" data-gateway-review> Needs payment review</label><label><input type="checkbox" data-gateway-refund-filter> Refunds &amp; closed paid orders</label><button type="button" data-gateway-all>Show all orders</button></div><div class="gateway-scroll"><table class="admin-table"><thead><tr><th>Order</th><th>Payment status</th><th>Amount</th><th>Payment &amp; refund history</th><th>Actions</th></tr></thead><tbody><tr><td colspan="5" class="gateway-empty">Loading online payments?</td></tr></tbody></table></div><div class="gateway-footer"><span data-page aria-live="polite"></span><div><button type="button" data-prev aria-label="Previous payment page"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button><button type="button" data-next aria-label="Next payment page"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button></div></div></div>`;
  target.closest('.table-wrapper, .table-responsive, .table-wrap, .table-container')?.before(panel);
  if (!panel.isConnected) target.before(panel);
  const checkResult = document.createElement('p');
  checkResult.className = 'gateway-intro'; checkResult.setAttribute('role', 'status'); checkResult.hidden = true;
  panel.querySelector('[data-gateway-health]').after(checkResult);
  const checking = new Set();
  const refundShortcut = document.createElement('button');
  refundShortcut.type = 'button'; refundShortcut.className = 'archive-tab-btn gateway-refund-shortcut'; refundShortcut.textContent = 'Online refunds';
  document.getElementById('ordersModuleTabs')?.append(refundShortcut);
  let focusedOrder = null, reloadPending = false;
  let page = 1, pages = 1, timer, busy = false, delay = 5000, snapshot = '', canApprove = false, currentRefunds = [], currentPayments = [], currentReceipts = [];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = cents => '₱' + (Number(cents) / 100).toLocaleString('en-PH', {minimumFractionDigits:2,maximumFractionDigits:2});
  const methodLabel = method => method === 'qrph' ? 'QR Ph' : method === 'gcash' ? 'GCash' : 'Online payment';
  const readable = value => String(value || 'Pending').replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
  const refundLabel = value => ({requested:'Awaiting Admin approval',submitting:'Submitting to provider',pending:'Processing with provider',unknown:'Awaiting provider confirmation',succeeded:'Refund confirmed',failed:'Failed — review and retry',rejected:'Request declined'}[value] || readable(value));
  const badge = value => '<span class="gateway-badge" data-status="' + esc(value) + '">' + esc(readable(value)) + '</span>';
  const dateLabel = value => {
    if (!value) return 'Not run yet';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Unavailable' : new Intl.DateTimeFormat('en-PH', {timeZone:'Asia/Manila', month:'short', day:'numeric', hour:'numeric', minute:'2-digit', second:'2-digit'}).format(date) + ' PHT';
  };
  const api = async (path, body) => {
    const token = window.AdminSession?.getToken() || localStorage.getItem('auth_token');
    const controller = new AbortController(); let deadline;
    const timeout = new Promise((_, reject) => { deadline = setTimeout(() => {
      controller.abort(); reject(new Error('The request took too long. Check the payment status before trying again.'));
    }, 25000); });
    try { return await Promise.race([timeout, (async () => {
    const response = await fetch(base + path, {method: body ? 'POST' : 'GET', cache: 'no-store', signal: controller.signal,
      headers: {Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer ' + token}, ...(body ? {body:JSON.stringify(body)} : {})});
    const data = await response.json(); if (!response.ok) throw new Error(data.message || 'Payment information is unavailable. Please try again.'); return data;
    })()]); } finally { clearTimeout(deadline); }
  };
  const load = async () => {
    clearTimeout(timer); if (!panel.open || document.hidden) return;
    if (busy) { reloadPending = true; return; }
    busy = true;
    try {
      const data = await api('/admin/gateway-payments?page=' + page + (panel.querySelector('[data-gateway-review]').checked ? '&review=1' : '') + (panel.querySelector('[data-gateway-refund-filter]').checked ? '&refunds=1' : '') + (focusedOrder ? '&order_id='+encodeURIComponent(focusedOrder) : ''));
      if (reloadPending) return;
      currentReceipts = data.receipts || []; currentRefunds = data.refunds; currentPayments = data.payments.data; canApprove = data.can_approve; pages = data.payments.last_page;
      refundShortcut.textContent = 'Online refunds' + (data.refunds_awaiting_approval ? ' ('+data.refunds_awaiting_approval+')' : '');
      refundShortcut.title = 'Refund requests awaiting Admin approval';
      panel.querySelector('[data-gateway-health]').innerHTML = '<div><span class="gateway-label">Payment method</span><strong>' + esc(data.checkout_label || methodLabel(data.checkout_method)) + '</strong></div><div><span class="gateway-label">Checkout</span>' + badge(data.enabled ? 'enabled' : 'disabled') + ' ' + badge(data.livemode ? 'live' : 'test') + '</div><div><span class="gateway-label">Last payment check</span><strong>' + esc(dateLabel(data.last_reconciled_at)) + '</strong></div>';
      const nextSnapshot = JSON.stringify([data.payments,data.attempts,data.refunds,data.receipts]);
      if (nextSnapshot !== snapshot) {
        panel.querySelector('tbody').innerHTML = data.payments.data.map(p => {
          const attempts = data.attempts.filter(a => a.payment_id === p.id);
          const refunds = data.refunds.filter(r => r.payment_id === p.id);
          const legacy = !p.gateway && (!p.paymongo_payment_id || String(p.paymongo_payment_id).startsWith('pay_sim_')) && (/^GCASH-/.test(p.reference || '') || /^cs_sim_/.test(p.paymongo_checkout_id || ''));
          const unresolved = attempts.some(a => !a.checkout_id && ['creating','unknown'].includes(a.status));
          const refundable = currentReceipts.filter(r => r.payment_id === p.id).some(r => Number(r.amount_centavos) - refunds.filter(f => f.provider_payment_id === r.provider_payment_id && !['failed','rejected'].includes(f.status)).reduce((sum,f)=>sum+Number(f.amount_centavos),0) >= 100);
          const refundDue = ['cancelled','rejected'].includes(p.lifecycle_status) && p.status === 'paid';
          const timeline = attempts.map(a => esc(methodLabel(a.checkout_method) + ': ' + a.status + (a.exception ? ' — ' + a.exception.replaceAll('_',' ') : '')) + '<br>' + esc(a.provider_payment_id || a.checkout_id || 'Awaiting checkout')).join('<hr>') + currentReceipts.filter(r => r.payment_id === p.id).map(r => '<p>Received via ' + esc(methodLabel(r.source_type)) + ': ' + money(r.amount_centavos) + '<br>' + esc(r.provider_payment_id) + '</p>').join('');
          return '<tr><td>' + '<strong class="gateway-order">' + esc(p.order_no) + '</strong><span class="gateway-secondary">' + esc(readable(p.lifecycle_status)) + '</span>' + '</td><td>' + badge(p.status) + (refundDue ? '<small class="gateway-note">Refund required ? review below</small>' : '') + (legacy ? '<small class="gateway-note">Historical record. Verify receipt before counting as received.</small>' : '') + '</td><td>' + money(Number(p.amount)*100) + '</td><td>' + (timeline || '<span class="gateway-secondary">No provider history recorded</span>') + refunds.map(r => '<p>Refund ' + money(r.amount_centavos) + ': ' + esc(refundLabel(r.status)) + '<br>' + esc(r.reason) + (canApprove && !r.provider_refund_id && ['unknown','submitting'].includes(r.status) ? '<button data-recoverrefund="'+r.id+'">Match provider refund</button>' : '') + (canApprove && r.status === 'requested' ? '<br><button data-approve="'+r.id+'">Approve refund</button><button data-reject="'+r.id+'">Decline request</button>' : '') + '</p>').join('') + '</td><td><button data-check="'+p.order_id+'">Check payment</button>' + (refundable && ['paid','refunded'].includes(p.status) && p.paymongo_payment_id && !legacy ? '<button data-refund="'+p.order_id+'">Request refund</button>' : '') + (canApprove && unresolved ? '<button data-recovercheckout="'+p.order_id+'">Match provider checkout</button>' : '') + '</td></tr>';
        }).join('') || '<tr><td colspan="5" class="gateway-empty">No online payments found.</td></tr>';
        snapshot = nextSnapshot;
        panel.querySelectorAll('[data-check]').forEach(b => { b.disabled = checking.has(b.dataset.check); b.textContent = b.disabled ? 'Checking\u2026' : 'Check payment'; });
        window.dispatchEvent(new CustomEvent('fmrc:orders-updated', {detail:{source:'gateway-payments'}}));
      }
      panel.querySelector('[data-page]').textContent = ' Page ' + page + ' of ' + pages + ' ';
      panel.querySelector('[data-prev]').disabled = page <= 1; panel.querySelector('[data-next]').disabled = page >= pages;
      delay = 5000;
    } catch (e) { panel.querySelector('[data-gateway-health]').textContent = e.message; delay = Math.min(delay*2,30000); }
    finally { busy = false; const nextDelay = reloadPending ? 0 : delay; reloadPending = false; if (panel.open) timer = setTimeout(load, nextDelay); }
  };
  const modal = document.createElement('dialog'); modal.className = 'gateway-team-dialog fmrc-payment-modal';
  modal.setAttribute('aria-labelledby', 'gatewayTeamTitle');
  modal.setAttribute('aria-describedby', 'gatewayTeamDescription');
  modal.innerHTML = `<form>
    <header class="payment-modal-head"><span class="payment-modal-icon" aria-hidden="true">&#8634;</span>
      <div><p class="payment-modal-eyebrow">Payments &amp; refunds</p><h3 id="gatewayTeamTitle" data-title></h3></div>
      <button type="button" class="payment-modal-close" data-close aria-label="Close payment action"><svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8"/></svg></button>
    </header><div class="payment-modal-body"><p id="gatewayTeamDescription" data-description></p>
      <label data-receipt>Original payment<select name="provider_payment_id" required></select></label>
      <label data-amount>Amount (PHP)<input name="amount" type="number" min="1" step="0.01" required></label>
      <label data-reason>Reason<textarea name="reason" maxlength="400" required></textarea></label>
      <label data-provider hidden>Provider reference<input name="provider_id" required></label>
      <p class="payment-modal-error" data-error role="alert"></p>
    </div><footer class="payment-modal-footer"><button type="button" data-cancel>Cancel</button><button class="payment-modal-primary" type="submit">Confirm</button></footer>
  </form>`;
  document.body.append(modal); let action, submitting = false;
  const close = () => { if (!submitting) modal.close(); };
  modal.querySelector('[data-cancel]').onclick = close;
  modal.querySelector('[data-close]').onclick = close;
  modal.addEventListener('cancel', e => { if (submitting) e.preventDefault(); });
  modal.addEventListener('keydown', e => {
    if (submitting && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); }
  });
  const show = (type,id) => {
    if (submitting) return;
    action = {type,id,key:crypto.randomUUID()}; const request = type === 'refund'; const recovering = type.startsWith('recover');
    modal.querySelector('form').reset(); modal.querySelector('[data-error]').textContent = '';
    modal.querySelector('[data-title]').textContent = request ? 'Request payment refund' : type === 'approve' ? 'Approve and issue refund' : 'Reject refund request';
    modal.querySelector('[data-description]').textContent = request ? 'Admin will review this request before money is returned.' : type === 'approve' ? 'This sends the requested refund to the original payment method. Confirm only after reviewing the amount and reason in the payment history.' : 'No money will be returned for this request.';
    modal.querySelector('[data-receipt]').hidden = !request;
    modal.querySelector('[name=provider_payment_id]').disabled = !request;
    const payment = currentPayments.find(p => String(p.order_id) === String(id));
    modal.querySelector('[name=provider_payment_id]').innerHTML = currentReceipts.filter(r => r.payment_id === payment?.id).map(r => '<option value="'+esc(r.provider_payment_id)+'">'+esc(methodLabel(r.source_type))+' — '+esc(r.provider_payment_id)+' — '+money(r.amount_centavos)+'</option>').join('');
    const updateRefundAmount = () => {
      const receipt = currentReceipts.find(r => r.provider_payment_id === modal.querySelector('[name=provider_payment_id]').value);
      const reserved = currentRefunds.filter(r => r.provider_payment_id === receipt?.provider_payment_id && !['failed','rejected'].includes(r.status)).reduce((sum,r)=>sum+Number(r.amount_centavos),0);
      const remaining = Math.max(0, Number(receipt?.amount_centavos || 0) - reserved) / 100;
      const input = modal.querySelector('[name=amount]'); input.max = remaining.toFixed(2); input.value = remaining.toFixed(2);
    };
    modal.querySelector('[name=provider_payment_id]').onchange = updateRefundAmount;
    if (request) {
      updateRefundAmount();
      if (['cancelled','rejected'].includes(payment?.lifecycle_status)) modal.querySelector('[name=reason]').value = 'Refund for '+payment.lifecycle_status+' order '+payment.order_no;
    }
    ['amount','reason'].forEach(name => { modal.querySelector('[data-'+name+']').hidden = !request; modal.querySelector('[name='+name+']').disabled = !request; });
    if (type === 'reject') {
      modal.querySelector('[data-reason]').hidden = false; modal.querySelector('[name=reason]').disabled = false;
      modal.querySelector('[data-description]').textContent = 'Explain why this refund request is being declined. The customer will see this reason. No money will be returned.';
    }
    if (type === 'approve') {
      const refund = currentRefunds.find(r => String(r.id) === String(id));
      const payment = currentPayments.find(p => p.id === refund?.payment_id);
      modal.querySelector('[data-description]').textContent = 'Return ' + money(refund?.amount_centavos || 0) + ' to the original payment method for ' + (payment?.order_no || 'this order') + '? Reason: ' + (refund?.reason || '');
    }
    modal.querySelector('[data-provider]').hidden = !recovering; modal.querySelector('[name=provider_id]').disabled = !recovering;
    if (recovering) { modal.querySelector('[data-title]').textContent = 'Match provider record'; modal.querySelector('[data-description]').textContent = 'Copy the matching checkout or refund ID from the school PayMongo dashboard. FMRC verifies the original request before accepting it.'; }
    modal.querySelector('[type=submit]').textContent = request ? 'Send refund request' : type === 'approve' ? 'Issue refund' : recovering ? 'Verify record' : 'Reject request';
    if (!modal.open) modal.showModal();
  };
  modal.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    if (submitting || !action || !modal.querySelector('form').reportValidity()) return;
    submitting = true; const button = modal.querySelector('[type=submit]'), label = button.textContent;
    modal.setAttribute('closedby', 'none');
    button.disabled = true; button.textContent = 'Processing\u2026';
    modal.querySelector('[data-cancel]').disabled = true; modal.querySelector('[data-close]').disabled = true;
    modal.querySelector('[data-error]').textContent = '';
    try {
      if (action.type === 'recovercheckout') await api('/admin/orders/'+action.id+'/payment-recover', {provider_id:modal.querySelector('[name=provider_id]').value.trim()});
      else if (action.type === 'recoverrefund') await api('/admin/gateway-refunds/'+action.id+'/recover', {provider_id:modal.querySelector('[name=provider_id]').value.trim()});
      else if (action.type === 'refund') await api('/admin/orders/'+action.id+'/gateway-refunds', {amount_centavos:Math.round(Number(modal.querySelector('[name=amount]').value)*100),reason:modal.querySelector('[name=reason]').value,request_key:action.key,provider_payment_id:modal.querySelector('[name=provider_payment_id]').value});
      else {
        const result = await api('/admin/gateway-refunds/'+action.id+'/'+action.type, action.type === 'reject' ? {reason:modal.querySelector('[name=reason]').value.trim()} : {});
        checkResult.hidden = false;
        checkResult.textContent = action.type === 'approve' ? refundLabel(result.data?.status) + '. Open the refund history below for details.' : 'Refund request declined. No money was sent.';
      }
      if (action.type === 'refund') { checkResult.hidden = false; checkResult.textContent = 'Refund requested. Admin must approve it before money is returned to the customer.'; }
      modal.close(); snapshot = ''; await load();
    } catch (e) { modal.querySelector('[data-error]').textContent = e.message; }
    finally { submitting = false; modal.removeAttribute('closedby'); button.disabled = false; button.textContent = label; modal.querySelector('[data-cancel]').disabled = false; modal.querySelector('[data-close]').disabled = false; }
  };
  panel.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-gateway-all')) { focusedOrder=null; page=1; snapshot=''; return load(); }
    if (b.hasAttribute('data-prev')) { page--; snapshot=''; return load(); }
    if (b.hasAttribute('data-next')) { page++; snapshot=''; return load(); }
    for (const type of ['refund','approve','reject','recovercheckout','recoverrefund']) if (b.dataset[type]) return show(type,b.dataset[type]);
    if (b.dataset.check) {
      const id = b.dataset.check; if (checking.has(id)) return;
      checking.add(id); b.disabled = true; b.textContent = 'Checking\u2026';
      const order = currentPayments.find(p => String(p.order_id) === id);
      checkResult.hidden = false; checkResult.textContent = 'Checking payment for ' + (order?.order_no || 'this order') + '\u2026';
      try {
        const result = await api('/admin/orders/'+id+'/payment-reconcile', {});
        checkResult.textContent = (order?.order_no || 'Order') + ': ' + (result.exception ? 'Payment needs review.' : result.status === 'paid' ? 'Payment confirmed.' : result.status === 'refunded' ? 'Refund confirmed.' : 'Payment is not confirmed yet.') + ' Checked at ' + dateLabel(new Date().toISOString()) + '.';
        snapshot=''; void load();
      } catch(e) { checkResult.textContent = e.message; }
      finally {
        checking.delete(id);
        panel.querySelectorAll('[data-check]').forEach(button => { if(button.dataset.check === id) { button.disabled=false; button.textContent='Check payment'; } });
      }
    }
  });
  panel.querySelector('[data-gateway-review]').onchange = () => { page=1; snapshot=''; load(); };
  panel.querySelector('[data-gateway-refund-filter]').onchange = () => { focusedOrder=null; page=1; snapshot=''; load(); };
  refundShortcut.onclick = () => {
    document.querySelector('#ordersModuleTabs [data-tab="records"]')?.click();
    focusedOrder=null; page=1; snapshot=''; panel.querySelector('[data-gateway-review]').checked=false;
    panel.querySelector('[data-gateway-refund-filter]').checked=true; panel.open=true; void load(); panel.scrollIntoView({behavior:'smooth',block:'start'});
  };
  document.addEventListener('click', e => {
    const button = e.target.closest('[data-gateway-manage]'); if (!button) return;
    document.querySelector('#ordersModuleTabs [data-tab="records"]')?.click();
    focusedOrder=button.dataset.gatewayManage; page=1; snapshot='';
    panel.querySelector('[data-gateway-review]').checked=false; panel.querySelector('[data-gateway-refund-filter]').checked=false;
    panel.open=true; void load(); panel.scrollIntoView({behavior:'smooth',block:'start'});
  });
  panel.open = true;
  panel.addEventListener('toggle', () => { if (panel.open) load(); else clearTimeout(timer); });
  ['focus','online'].forEach(type => window.addEventListener(type, load));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
});
