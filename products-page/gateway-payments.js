(() => {
  'use strict';
  const base = () => (window.APP_API_BASE_URL || ((['localhost','127.0.0.1'].includes(location.hostname) && location.port !== '8000') ? location.protocol + '//' + location.hostname + ':8000/api' : location.origin + '/api')).replace(/\/$/, '');
  let dialog, orderId, timer, busy = false, delay = 3000, lastStatus, generation = 0, continuing = false, shouldPoll = true, failures = 0;
  const request = async (path, method = 'GET') => {
    const token = localStorage.getItem('customer_token');
    if (!token) throw new Error('Sign in to view this payment in My Orders.');
    const controller = new AbortController(); let deadline;
    const timeout = new Promise((_, reject) => { deadline = setTimeout(() => {
      controller.abort(); reject(new Error('The payment check took too long. Please try again.'));
    }, 20000); });
    try { return await Promise.race([timeout, (async () => {
    const response = await fetch(base() + path, { method, cache: 'no-store', signal: controller.signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      ...(method === 'POST' ? {body: JSON.stringify({app_context: window.FMRCApp?.inApp ? 'customer' : ''})} : {}) });
    const data = await response.json();
    if (!response.ok) throw new Error(response.status === 401 ? 'Sign in to view this payment in My Orders.' : (data.message || 'Payment information is unavailable. Please try again.'));
    return data;
    })()]); } finally { clearTimeout(deadline); }
  };
  const redirect = url => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'checkout.paymongo.com') throw new Error('Secure checkout is unavailable. Please try again.');
    location.assign(parsed.href);
  };
  const ensure = () => {
    if (dialog) return;
    dialog = document.createElement('dialog');
    dialog.className = 'fmrc-gateway-dialog fmrc-payment-modal';
    dialog.setAttribute('aria-labelledby', 'gatewayPaymentTitle');
    dialog.setAttribute('aria-describedby', 'gatewayPaymentMessage');
    dialog.innerHTML = `<header class="payment-modal-head">
      <span class="payment-modal-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h4"/></svg></span>
      <div><p class="payment-modal-eyebrow">Secure payment</p><h2 id="gatewayPaymentTitle" data-gateway-title>Payment details</h2></div>
      <button type="button" class="payment-modal-close" data-gateway-close aria-label="Close payment details"><svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8"/></svg></button>
    </header><div class="payment-modal-body" tabindex="-1" autofocus>
      <p class="payment-modal-label">Payment status</p>
      <span class="payment-modal-status" data-gateway-status role="status">Checking payment</span>
      <p id="gatewayPaymentMessage" data-gateway-message aria-live="polite">Checking your payment status\u2026</p>
      <p class="payment-modal-help" data-gateway-instructions hidden></p>
      <p class="payment-modal-help" data-gateway-refunds hidden></p>
      <p class="payment-modal-error" data-gateway-error role="alert" hidden></p>
      <p data-gateway-checked role="status" hidden></p>
    </div><footer class="payment-modal-footer">
      <button type="button" data-gateway-done>Done</button>
      <button type="button" data-gateway-refresh>Check payment</button>
      <button type="button" class="payment-modal-primary" data-gateway-continue hidden>Continue to payment</button>
    </footer>`;
    document.body.append(dialog);
    dialog.addEventListener('close', () => {
      clearTimeout(timer); orderId = null; generation++; busy = false; continuing = false;
    });
    dialog.querySelector('[data-gateway-close]').onclick = () => dialog.close();
    dialog.querySelector('[data-gateway-done]').onclick = () => dialog.close();
    dialog.querySelector('[data-gateway-refresh]').onclick = () => poll({interactive: true});
    dialog.querySelector('[data-gateway-continue]').onclick = async () => {
      if (continuing || !orderId) return;
      clearTimeout(timer); generation++; busy = false;
      const current = generation;
      continuing = true; setBusy(true);
      try {
        const data = await request('/customer/orders/' + orderId + '/payment-checkout', 'POST');
        if (current !== generation || !dialog.open) return;
        if (data.checkout_url) redirect(data.checkout_url); else render(data);
      } catch (e) { if (current === generation && dialog.open) showError(e.message); }
      finally { if (current === generation) { continuing = false; setBusy(false); void poll(); } }
    };
  };
  const setBusy = value => {
    dialog.querySelector('[data-gateway-refresh]').disabled = value;
    dialog.querySelector('[data-gateway-refresh]').textContent = value ? 'Checking\u2026' : 'Check payment';
    dialog.querySelector('[data-gateway-continue]').disabled = continuing;
  };
  const showError = message => {
    const error = dialog.querySelector('[data-gateway-error]');
    error.textContent = message; error.hidden = false;
  };
  const render = data => {
    const qrph = data.checkout_method === 'qrph';
    const canContinue = data.status !== 'paid' && data.status !== 'refunded' && !data.exception && Boolean(data.checkout_url || data.retry_allowed);
    dialog.querySelector('[data-gateway-error]').hidden = true;
    const status = dialog.querySelector('[data-gateway-status]');
    status.dataset.state = data.exception ? 'review' : data.status;
    const statusText = data.exception ? 'Needs review' : data.status === 'paid' ? 'Payment confirmed' : data.status === 'refunded' ? 'Refunded' : data.attempt_status === 'expired' ? 'Checkout expired' : 'Awaiting payment';
    if (status.textContent !== statusText) status.textContent = statusText;
    dialog.querySelector('[data-gateway-title]').textContent = (data.method_label || (qrph ? 'QR Ph' : 'GCash')) + ' payment';
    dialog.querySelector('[data-gateway-continue]').textContent = qrph ? 'Continue to payment QR' : 'Continue to GCash';
    const instructions = dialog.querySelector('[data-gateway-instructions]');
    instructions.hidden = !qrph || !canContinue;
    instructions.textContent = qrph ? 'Scan the checkout QR with GCash or another QR Ph app. On the same phone, save the QR from checkout and use your payment app’s QR image option, if available. Return here after paying; confirmation updates automatically.' : '';
    const message = data.status === 'paid' ? (data.exception ? 'Payment received. The team is reviewing this transaction.' : 'Payment confirmed. Your order is awaiting team approval or preparation.')
      : data.status === 'refunded' ? 'Your payment has been refunded.'
      : data.exception ? 'Your payment needs review. Please contact FMRC before attempting another payment.'
      : data.attempt_status === 'expired' ? 'This checkout has expired. You can start a new secure payment.'
      : ['creating','unknown'].includes(data.attempt_status) ? 'We are checking your payment request. Please wait; do not pay again.'
      : qrph ? 'Payment has not been confirmed. Continue to the payment QR, or check again if you have already paid.'
      : 'Payment has not been confirmed. Continue to GCash to authorize it, or check again if you have already paid.';
    const messageEl = dialog.querySelector('[data-gateway-message]');
    if (messageEl.textContent !== message) messageEl.textContent = message;
    dialog.querySelector('[data-gateway-continue]').hidden = !canContinue;
    dialog.querySelector('[data-gateway-refunds]').textContent = (data.refunds || []).map(r => 'Refund ₱' + (r.amount_centavos / 100).toFixed(2) + ': ' + r.status).join(' · ');
    dialog.querySelector('[data-gateway-refunds]').hidden = !(data.refunds || []).length;
    if (lastStatus !== data.status) window.dispatchEvent(new CustomEvent('fmrc:orders-updated', { detail: {type: 'payment', orderId} }));
    lastStatus = data.status;
    shouldPoll = !data.exception && (data.status === 'pending' || (data.refunds || []).some(r => !['succeeded','failed','rejected'].includes(r.status)));
  };
  const poll = async ({interactive = false} = {}) => {
    clearTimeout(timer);
    if (!dialog?.open || !orderId || document.hidden || continuing) return;
    if (busy) { if (interactive) setBusy(true); return; }
    busy = true; const current = generation, requestedOrder = orderId;
    if (interactive) setBusy(true);
    try {
      const data = await request('/customer/orders/' + requestedOrder + '/payment-status');
      if (current !== generation || !dialog.open) return;
      render(data); delay = 3000; failures = 0;
      const checked = dialog.querySelector('[data-gateway-checked]');
      checked.hidden = false;
      checked.textContent = 'Last checked at ' + new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit',second:'2-digit'}) + '. ' + (data.status === 'paid' ? 'Payment confirmed.' : data.status === 'refunded' ? 'Refund confirmed.' : data.exception ? 'This payment needs review.' : 'Payment is not confirmed yet.');
    } catch (e) {
      if (current !== generation || !dialog.open) return;
      failures++;
      dialog.querySelector('[data-gateway-checked]').hidden = true;
      showError(e.name === 'TimeoutError' || e.name === 'TypeError' ? 'We could not check your payment. Please try again.' : e.message);
      if (lastStatus === null) {
        dialog.querySelector('[data-gateway-status]').textContent = 'Status unavailable';
        dialog.querySelector('[data-gateway-message]').textContent = 'Your payment status could not be loaded. Use Check payment to try again.';
      }
      delay = Math.min(delay * 2, 30000);
    } finally {
      if (current === generation) {
        busy = false; setBusy(false);
        if (dialog.open && shouldPoll && failures < 3) timer = setTimeout(poll, delay);
      }
    }
  };
  const open = id => {
    ensure(); clearTimeout(timer); generation++; busy = false; continuing = false;
    orderId = String(id); lastStatus = null; delay = 3000; shouldPoll = true; failures = 0;
    dialog.querySelector('[data-gateway-title]').textContent = 'Payment details';
    dialog.querySelector('[data-gateway-message]').textContent = 'Checking your payment status\u2026';
    const status = dialog.querySelector('[data-gateway-status]');
    status.textContent = 'Checking payment'; status.dataset.state = 'loading';
    ['continue','instructions','refunds','error','checked'].forEach(name => { dialog.querySelector('[data-gateway-' + name + ']').hidden = true; });
    setBusy(false);
    if (!dialog.open) dialog.showModal();
    void poll({interactive: true});
  };
  document.addEventListener('click', e => { const button = e.target.closest('[data-gateway-order]'); if (button) open(button.dataset.gatewayOrder); });
  ['focus','online'].forEach(type => window.addEventListener(type, poll));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  window.FMRCGatewayPayments = {open, redirect};
})();
