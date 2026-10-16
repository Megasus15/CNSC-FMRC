document.addEventListener('DOMContentLoaded', () => {
  const target = document.getElementById('paymentsHistoryTable');
  if (!target) return;
  const base = (window.APP_API_BASE_URL || ((['localhost','127.0.0.1'].includes(location.hostname) && location.port !== '8000') ? location.protocol + '//' + location.hostname + ':8000/api' : location.origin + '/api')).replace(/\/$/, '');
  const panel = document.createElement('details'); panel.className = 'gateway-team';
  panel.innerHTML = `<summary><span><i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Refunds &amp; online payments</span><i class="fa-solid fa-chevron-down gateway-chevron" aria-hidden="true"></i></summary>
    <div class="gateway-content"><p class="gateway-intro">Staff requests refunds; Admin approves them. QR Ph refunds use a secure PayMongo claim form where the customer selects a receiving bank or e-wallet. The merchant wallet must have available funds.</p>
    <div class="gateway-stats" data-gateway-stats aria-label="Refund overview"></div>
    <div class="gateway-health" data-gateway-health role="status">Loading payment status...</div>
    <div class="gateway-toolbar"><label class="gateway-search">Find an order or customer<input type="search" maxlength="100" placeholder="Order number or customer name" data-gateway-search></label>
      <label class="gateway-filter">Refund status<select data-gateway-status-filter><option value="">All statuses</option><option value="requested">Awaiting approval</option><option value="processing">Processing</option><option value="failed">Needs attention</option><option value="succeeded">Refund confirmed</option></select></label>
      <button type="button" data-gateway-all>Clear filters</button></div>
    <div class="gateway-scope"><label><input type="checkbox" data-gateway-refund-filter checked> Refunds &amp; closed paid orders</label><label><input type="checkbox" data-gateway-review> Payment issues only</label><span data-gateway-focus></span></div>
    <div class="gateway-payment-list" data-payment-list><p class="gateway-empty">Loading online payments...</p></div>
    <div class="gateway-footer"><span data-page aria-live="polite"></span><div><button type="button" data-prev aria-label="Previous payment page">Previous</button><button type="button" data-next aria-label="Next payment page">Next</button></div></div></div>`;
  const workspace = document.createElement('section'); workspace.id='sectionRefunds'; workspace.className='archive-section'; workspace.hidden=true; workspace.append(panel);
  const tabs = document.getElementById('ordersModuleTabs');
  if (tabs && document.getElementById('sectionRecords')) document.getElementById('sectionRecords').after(workspace);
  else { target.closest('.table-wrapper, .table-responsive, .table-wrap, .table-container')?.before(workspace); if(!workspace.isConnected) target.before(workspace); workspace.hidden=false; }
  const openWorkspace = () => {
    if (tabs) {
      document.querySelectorAll('.orders-layout-stack .archive-section').forEach(section=>section.classList.toggle('active',section===workspace));
      tabs.querySelectorAll('.archive-tab-btn').forEach(button=>{button.classList.toggle('active',button===refundShortcut);button.setAttribute('aria-pressed',String(button===refundShortcut));});
    }
    workspace.hidden=false; workspace.classList.add('active'); panel.open=true;
  };
  tabs?.addEventListener('click',e=>{if(e.target.closest('.archive-tab-btn') && !e.target.closest('.gateway-refund-shortcut')) {workspace.hidden=true;workspace.classList.remove('active');refundShortcut.classList.remove('active');refundShortcut.setAttribute('aria-pressed','false');}});
  const checkResult = document.createElement('p');
  checkResult.className = 'gateway-intro'; checkResult.setAttribute('role', 'status'); checkResult.hidden = true;
  panel.querySelector('[data-gateway-health]').after(checkResult);
  const checking = new Set();
  let financialSnapshot='';
  let realtimeChannel;
  try { if(typeof window.BroadcastChannel==='function') realtimeChannel=new window.BroadcastChannel('fmrc-orders-realtime'); } catch {}
  const refundShortcut = document.createElement('button');
  refundShortcut.type = 'button'; refundShortcut.className = 'archive-tab-btn gateway-refund-shortcut'; refundShortcut.textContent = 'Online refunds';
  refundShortcut.dataset.tab = 'refunds'; refundShortcut.setAttribute('aria-pressed','false');
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
      const data = await api('/admin/gateway-payments?page=' + page + (panel.querySelector('[data-gateway-review]').checked ? '&review=1' : '') + (panel.querySelector('[data-gateway-refund-filter]').checked ? '&refunds=1' : '') + (focusedOrder ? '&order_id='+encodeURIComponent(focusedOrder) : '') + '&search='+encodeURIComponent(panel.querySelector('[data-gateway-search]').value)+'&refund_status='+encodeURIComponent(panel.querySelector('[data-gateway-status-filter]').value));
      if (reloadPending) return;
      currentReceipts = data.receipts || []; currentRefunds = data.refunds; currentPayments = data.payments.data; canApprove = data.can_approve; pages = data.payments.last_page;
      refundShortcut.textContent = 'Online refunds' + (data.refunds_awaiting_approval ? ' ('+data.refunds_awaiting_approval+')' : '');
      refundShortcut.title = 'Refund requests awaiting Admin approval';
      const stats=data.refund_summary || {};
      panel.querySelector('[data-gateway-stats]').innerHTML=[['Awaiting approval',stats.requested||0],['Processing',stats.processing||0],['Needs attention',stats.failed||0],['Returned to customers',money(stats.refunded_centavos||0)]].map(([label,value])=>'<div><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></div>').join('');
      panel.querySelector('[data-gateway-health]').innerHTML = '<span>'+esc(data.checkout_label || methodLabel(data.checkout_method))+'</span>'+badge(data.livemode?'live':'test')+'<span>Last scheduled check: '+esc(dateLabel(data.last_reconciled_at))+'</span>';
      panel.querySelector('[data-gateway-focus]').textContent = focusedOrder ? 'Showing selected order' : '';
      const nextSnapshot = JSON.stringify([data.payments,data.attempts,data.refunds,data.receipts,data.can_approve]);
      if (nextSnapshot !== snapshot) {
        panel.querySelector('[data-payment-list]').innerHTML = data.payments.data.map(p => {
          const attempts = data.attempts.filter(a => Number(a.payment_id) === Number(p.id));
          const refunds = data.refunds.filter(r => Number(r.payment_id) === Number(p.id));
          const receipts = currentReceipts.filter(r => Number(r.payment_id) === Number(p.id));
          const remaining = receipt => Number(receipt.amount_centavos) - refunds.filter(f => f.provider_payment_id === receipt.provider_payment_id && !['failed','rejected'].includes(f.status)).reduce((sum,f)=>sum+Number(f.amount_centavos||0),0);
          const refundable = receipts.some(r=>remaining(r)>=100);
          const received = receipts.reduce((sum,r)=>sum+Number(r.amount_centavos||0),0);
          const returned = refunds.filter(r=>r.status==='succeeded').reduce((sum,r)=>sum+Number(r.amount_centavos||0),0);
          const reserved = refunds.filter(r=>['requested','submitting','pending','unknown'].includes(r.status)).reduce((sum,r)=>sum+Number(r.amount_centavos||0),0);
          const unresolved = attempts.some(a => !a.checkout_id && ['creating','unknown'].includes(a.status));
          const visibleRefunds = refunds.filter(r=>!['failed','rejected'].includes(r.status) || !refunds.some(next=>next.id>r.id && next.provider_payment_id===r.provider_payment_id));
          const refundRows=visibleRefunds.map(r=>{
            const canRetry=r.status==='failed' && receipts.some(receipt=>receipt.provider_payment_id===r.provider_payment_id && remaining(receipt)>=Number(r.amount_centavos));
            return `<div class="gateway-refund-row"><div class="gateway-refund-heading"><strong>${money(r.amount_centavos)}</strong><span class="gateway-badge" data-status="${esc(r.status)}">${esc(refundLabel(r.status))}</span></div>
              <p class="gateway-refund-reason">${esc(r.reason)}</p>
              ${r.transfer_link?'<p class="gateway-secondary"><strong>Customer action needed.</strong> The customer can claim this refund in My Orders > Payment details. Claim links are valid for 3 days.</p>':''}
              ${r.status==='failed'?`<div class="gateway-failure"><strong>${esc(r.failure_message || 'This refund was not completed.')}</strong><p>${esc(r.failure_action || 'Check the original payment in PayMongo before retrying. The original failure reason was not saved.')}</p>${r.error_code?`<small>PayMongo code: ${esc(r.error_code)}</small>`:''}</div>`:''}
              <div class="gateway-actions">${canApprove && r.status==='requested'?`<button class="gateway-primary" data-approve="${r.id}">Issue refund</button><button data-reject="${r.id}">Decline request</button>`:''}
              ${canRetry?`<button data-retry="${r.id}">${canApprove?'Review & retry refund':'Request refund retry'}</button>`:''}
              ${r.provider_refund_id && ['pending','unknown','submitting'].includes(r.status)?`<button data-check-refund="${r.id}">Check refund</button>`:''}
              ${r.transfer_link?`<button data-copy-claim="${r.id}">Copy customer claim link</button>`:''}
              ${canApprove && !r.provider_refund_id && ['unknown','submitting'].includes(r.status)?`<button data-recoverrefund="${r.id}">Match provider refund</button>`:''}</div>
              ${r.confirmed_at?`<small class="gateway-secondary">Confirmed ${esc(dateLabel(r.confirmed_at))}</small>`:''}</div>`;
          }).join('');
          const references=receipts.map(r=>'<div><span>'+esc(methodLabel(r.source_type))+' payment</span><code>'+esc(r.provider_payment_id)+'</code></div>').join('');
          const history=refunds.map(r=>'<div><span>'+money(r.amount_centavos)+' &middot; '+esc(refundLabel(r.status))+'</span><code>'+esc(r.provider_refund_id || 'Request #'+r.id)+'</code></div>').join('');
          return `<article class="gateway-payment-card"><header><div><h3>${esc(p.order_no)}</h3><p>${esc(p.customer_name || 'Customer')} &middot; ${esc(readable(p.lifecycle_status))}</p></div>${badge(p.status)}</header>
            <dl class="gateway-amounts"><div><dt>Received</dt><dd>${money(received)}</dd></div><div><dt>Refund confirmed</dt><dd>${money(returned)}</dd></div><div><dt>Awaiting refund</dt><dd>${money(reserved)}</dd></div></dl>
            ${refundRows || '<p class="gateway-secondary">'+(['cancelled','rejected'].includes(p.lifecycle_status) && p.status==='paid'?'This paid order is closed. Request a refund for the customer.':'No refund requested for this payment.')+'</p>'}
            <div class="gateway-card-footer"><div class="gateway-actions"><button data-check="${p.order_id}">Check payment</button>${refundable && ['paid','refunded'].includes(p.status)?`<button data-refund="${p.order_id}">Request refund</button>`:''}${canApprove && unresolved?`<button data-recovercheckout="${p.order_id}">Match checkout</button>`:''}</div>
            <details class="gateway-history"><summary>Payment references &amp; history</summary>${references}${history || '<span>No refunds recorded</span>'}</details></div></article>`;
        }).join('') || '<p class="gateway-empty">No payments match these filters.</p>';
        snapshot = nextSnapshot;
        panel.querySelectorAll('[data-check]').forEach(b => { b.disabled = checking.has(b.dataset.check); b.textContent = b.disabled ? 'Checking\u2026' : 'Check payment'; });
        panel.querySelectorAll('[data-check-refund]').forEach(b => {b.disabled=checking.has('refund-'+b.dataset.checkRefund);b.textContent=b.disabled?'Checking...':'Check refund';});
        const financial=JSON.stringify([data.payments.data.map(p=>[p.id,p.status]),data.refunds.map(r=>[r.id,r.status,r.amount_centavos])]);
        if(financial!==financialSnapshot){
          financialSnapshot=financial;
          const detail={source:'gateway-payments',timestamp:Date.now()};
          window.dispatchEvent(new CustomEvent('fmrc:orders-updated',{detail}));
          try {localStorage.setItem('fmrc_orders_updated_at',JSON.stringify(detail));realtimeChannel?.postMessage(detail);} catch {}
        }
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
      const qr = currentReceipts.some(r=>r.provider_payment_id===refund?.provider_payment_id && r.source_type==='qrph');
      modal.querySelector('[data-description]').textContent = 'Refund ' + money(refund?.amount_centavos || 0) + ' for ' + (payment?.order_no || 'this order') + '? ' + (qr ? 'This creates a PayMongo claim link. The customer must complete the form to receive the refund. The merchant wallet needs sufficient available funds. ' : 'Funds return through the original payment method. ') + 'Reason: ' + (refund?.reason || '');
    }
    if (type === 'retry') {
      const refund = currentRefunds.find(r => String(r.id) === String(id));
      modal.querySelector('[data-title]').textContent = 'Review refund retry';
      modal.querySelector('[data-description]').textContent = (refund?.failure_action || 'Check PayMongo for any existing refund before retrying.') + ' ' + (canApprove ? 'Submit a new refund of ' : 'Request Admin approval to refund ') + money(refund?.amount_centavos || 0) + '. For QR Ph, the customer must claim it through PayMongo and the merchant wallet must be funded. A scheduled payout is not an available wallet balance.';
    }
    modal.querySelector('[data-provider]').hidden = !recovering; modal.querySelector('[name=provider_id]').disabled = !recovering;
    if (recovering) { modal.querySelector('[data-title]').textContent = 'Match provider record'; modal.querySelector('[data-description]').textContent = 'Copy the matching checkout or refund ID from the school PayMongo dashboard. FMRC verifies the original request before accepting it.'; }
    modal.querySelector('[type=submit]').textContent = request ? 'Send refund request' : type === 'approve' ? 'Issue refund' : recovering ? 'Verify record' : 'Reject request';
    if (type === 'retry') modal.querySelector('[type=submit]').textContent = canApprove ? 'Retry and issue refund' : 'Request retry';
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
        const result = await api('/admin/gateway-refunds/'+action.id+'/'+action.type, action.type === 'retry' ? {request_key:action.key,issue:canApprove} : action.type === 'reject' ? {reason:modal.querySelector('[name=reason]').value.trim()} : {});
        checkResult.hidden = false;
        checkResult.textContent = action.type === 'reject' ? 'Refund request declined. No money was sent.' : refundLabel(result.data?.status) + '. ' + (result.data?.failure_message || 'Open the refund history below for details.');
      }
      if (action.type === 'refund') { checkResult.hidden = false; checkResult.textContent = 'Refund requested. Admin must approve it before money is returned to the customer.'; }
      modal.close(); snapshot = ''; await load();
    } catch (e) { modal.querySelector('[data-error]').textContent = e.message; }
    finally { submitting = false; modal.removeAttribute('closedby'); button.disabled = false; button.textContent = label; modal.querySelector('[data-cancel]').disabled = false; modal.querySelector('[data-close]').disabled = false; }
  };
  panel.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.copyClaim) {
      const refund=currentRefunds.find(r=>String(r.id)===b.dataset.copyClaim);
      if(!refund?.transfer_link) return;
      try {await navigator.clipboard.writeText(refund.transfer_link);checkResult.textContent='Claim link copied. Share it only with the customer for this order.';}
      catch {checkResult.textContent='Copy unavailable. The customer can open the claim link in My Orders > Payment details.';}
      checkResult.hidden=false;return;
    }
    if (b.dataset.checkRefund) {
      const key='refund-'+b.dataset.checkRefund; if(checking.has(key)) return;
      checking.add(key); b.disabled=true; b.textContent='Checking...';
      try { const result=await api('/admin/gateway-refunds/'+b.dataset.checkRefund+'/check',{});
        checkResult.hidden=false; checkResult.textContent=refundLabel(result.data?.status)+'. '+(result.data?.failure_message || 'Refund status checked.'); snapshot=''; void load();
      } catch(error) {checkResult.hidden=false;checkResult.textContent=error.message;}
      finally {checking.delete(key);b.disabled=false;b.textContent='Check refund';}
      return;
    }
    if (b.hasAttribute('data-gateway-all')) { focusedOrder=null; page=1; snapshot=''; panel.querySelector('[data-gateway-search]').value=''; panel.querySelector('[data-gateway-status-filter]').value=''; panel.querySelector('[data-gateway-review]').checked=false; panel.querySelector('[data-gateway-refund-filter]').checked=false; return load(); }
    if (b.hasAttribute('data-prev')) { page--; snapshot=''; return load(); }
    if (b.hasAttribute('data-next')) { page++; snapshot=''; return load(); }
    for (const type of ['refund','retry','approve','reject','recovercheckout','recoverrefund']) if (b.dataset[type]) return show(type,b.dataset[type]);
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
  let searchTimer;
  panel.querySelector('[data-gateway-search]').oninput = () => {clearTimeout(searchTimer);searchTimer=setTimeout(()=>{focusedOrder=null;page=1;snapshot='';void load();},300);};
  panel.querySelector('[data-gateway-status-filter]').onchange = () => {focusedOrder=null;page=1;snapshot='';void load();};
  refundShortcut.onclick = () => {
    openWorkspace();
    focusedOrder=null; page=1; snapshot=''; panel.querySelector('[data-gateway-search]').value=''; panel.querySelector('[data-gateway-status-filter]').value=''; panel.querySelector('[data-gateway-review]').checked=false;
    panel.querySelector('[data-gateway-refund-filter]').checked=true; panel.open=true; void load(); panel.scrollIntoView({behavior:'smooth',block:'start'});
  };
  document.addEventListener('click', e => {
    const button = e.target.closest('[data-gateway-manage]'); if (!button) return;
    openWorkspace();
    focusedOrder=button.dataset.gatewayManage; page=1; snapshot=''; panel.querySelector('[data-gateway-search]').value=''; panel.querySelector('[data-gateway-status-filter]').value='';
    panel.querySelector('[data-gateway-review]').checked=false; panel.querySelector('[data-gateway-refund-filter]').checked=false;
    panel.open=true; void load(); panel.scrollIntoView({behavior:'smooth',block:'start'});
  });
  panel.open = true;
  panel.addEventListener('toggle', () => { if (panel.open) load(); else clearTimeout(timer); });
  ['focus','online'].forEach(type => window.addEventListener(type, load));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
});
