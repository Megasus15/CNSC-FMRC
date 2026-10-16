document.addEventListener('DOMContentLoaded', () => {
  const target = document.getElementById('paymentsHistoryTable');
  if (!target) return;
  const base = (window.APP_API_BASE_URL || ((['localhost','127.0.0.1'].includes(location.hostname) && location.port !== '8000') ? location.protocol + '//' + location.hostname + ':8000/api' : location.origin + '/api')).replace(/\/$/, '');
  const panel = document.createElement('article'); panel.className = 'panel gateway-team';
  panel.innerHTML = `<div class="panel-header"><h3>Refunds &amp; online payments</h3></div>
    <div class="gateway-content"><p class="gateway-intro">Admin can issue refunds directly. Staff sends requests for Admin approval. QR Ph refunds use a secure PayMongo claim form where the customer selects a receiving bank or e-wallet. The merchant wallet must have available funds.</p>
    <div class="gateway-stats" data-gateway-stats aria-label="Refund overview"></div>
    <div class="gateway-health" data-gateway-health role="status">Loading payment status...</div>
    <div class="gateway-toolbar"><label class="gateway-search">Find an order or customer<input type="search" maxlength="100" placeholder="Order number or customer name" data-gateway-search></label>
      <label class="gateway-filter">Refund status<select data-gateway-status-filter><option value="">All statuses</option><option value="requested">Awaiting approval</option><option value="processing">Processing</option><option value="failed">Needs attention</option><option value="succeeded">Refund confirmed</option></select></label>
      <button type="button" data-gateway-all>Clear filters</button></div>
    <div class="gateway-scope"><label><input type="checkbox" data-gateway-refund-filter checked> Refunds &amp; closed paid orders</label><label><input type="checkbox" data-gateway-review> Payment issues only</label><span data-gateway-focus></span></div>
    <div class="table-scroll-hint table-scroll-hint--mobile"><i class="fa-solid fa-left-right" aria-hidden="true"></i> Scroll horizontally to see all columns.</div><div class="table-wrapper gateway-table-wrap"><table class="admin-table" id="gatewayPaymentsTable"><thead><tr><th>Order / customer</th><th>Cancellation / reason</th><th>Received</th><th>Refunded</th><th>Refund status</th><th class="sticky-action">Actions</th></tr></thead><tbody data-payment-list><tr><td colspan="6">Loading online payments...</td></tr></tbody></table></div>
    <div class="table-footer"><span class="table-footer-meta" data-page aria-live="polite"></span><div class="table-pagination"><button class="page-btn" type="button" data-prev aria-label="Previous payment page"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button><input class="page-number" type="number" min="1" value="1" inputmode="numeric" aria-label="Go to online refunds page" data-payment-page><button class="page-btn" type="button" data-next aria-label="Next payment page"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button></div></div></div>`;
  const workspace = document.createElement('section'); workspace.id='sectionRefunds'; workspace.className='archive-section'; workspace.hidden=true; workspace.append(panel);
  const tabs = document.getElementById('ordersModuleTabs');
  if (tabs && document.getElementById('sectionRecords')) document.getElementById('sectionRecords').after(workspace);
  else { target.closest('.table-wrapper, .table-responsive, .table-wrap, .table-container')?.before(workspace); if(!workspace.isConnected) target.before(workspace); workspace.hidden=false; }
  const openWorkspace = (which='refunds') => {
    const section=which==='cancellations'?cancelWorkspace:workspace;
    const selected=which==='cancellations'?cancelShortcut:refundShortcut;
    document.querySelectorAll('.orders-layout-stack .archive-section').forEach(item=>{item.classList.toggle('active',item===section);item.hidden=item!==section;});
    tabs?.querySelectorAll('.archive-tab-btn').forEach(button=>{button.classList.toggle('active',button===selected);button.setAttribute('aria-pressed',String(button===selected));});
    workspace.hidden=section!==workspace;cancelWorkspace.hidden=section!==cancelWorkspace;
    section.classList.add('active');
  };
  const checkResult = document.createElement('p');
  checkResult.className = 'gateway-intro'; checkResult.setAttribute('role', 'status'); checkResult.hidden = true;
  panel.querySelector('[data-gateway-health]').after(checkResult);
  const checking = new Set();
  let financialSnapshot='';
  let realtimeChannel;
  try { if(typeof window.BroadcastChannel==='function') realtimeChannel=new window.BroadcastChannel('fmrc-orders-realtime'); } catch {}
  const refundShortcut = document.createElement('button');
  refundShortcut.type = 'button'; refundShortcut.className = 'archive-tab-btn gateway-refund-shortcut'; refundShortcut.innerHTML = '<i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Online refunds';
  refundShortcut.dataset.tab = 'refunds'; refundShortcut.setAttribute('aria-pressed','false');
  document.getElementById('ordersModuleTabs')?.append(refundShortcut);
  const cancelShortcut=document.createElement('button');cancelShortcut.type='button';cancelShortcut.className='archive-tab-btn gateway-cancellations-shortcut';cancelShortcut.dataset.tab='cancellations';cancelShortcut.innerHTML='<i class="fa-solid fa-ban" aria-hidden="true"></i> Cancellations';cancelShortcut.setAttribute('aria-pressed','false');
  tabs?.insertBefore(cancelShortcut,tabs.children[1] || refundShortcut);
  const cancelAlert=document.createElement('button');cancelAlert.type='button';cancelAlert.className='cancellation-alert';cancelAlert.hidden=true;tabs?.before(cancelAlert);
  const cancelWorkspace=document.createElement('section');cancelWorkspace.id='sectionCancellations';cancelWorkspace.className='archive-section';cancelWorkspace.hidden=true;
  cancelWorkspace.innerHTML=`<article class="panel cancellation-panel"><div class="panel-header"><div><h3>Customer cancellations</h3><p>Review the customer's reason, then approve or decline the cancellation. Paid online orders also need a refund.</p></div></div>
    <p class="gateway-intro" data-cancel-result role="status" hidden></p><div class="gateway-toolbar"><label class="gateway-search">Find a cancellation<input type="search" data-cancel-search placeholder="Order, customer or reason"></label><label class="gateway-filter">Status<select data-cancel-filter><option value="requested">Awaiting decision</option><option value="all">All cancellations</option><option value="approved">Approved</option><option value="declined">Declined</option></select></label></div>
    <div class="table-scroll-hint table-scroll-hint--mobile"><i class="fa-solid fa-left-right" aria-hidden="true"></i> Scroll horizontally to see all columns.</div><div class="table-wrapper gateway-table-wrap"><table class="admin-table" id="orderCancellationsTable"><thead><tr><th>Order / customer</th><th>Requested</th><th>Customer's reason</th><th>Payment</th><th>Cancellation status</th><th class="sticky-action">Actions</th></tr></thead><tbody data-cancellation-list><tr><td colspan="6">Loading cancellations...</td></tr></tbody></table></div>
    <div class="table-footer"><span class="table-footer-meta" data-cancel-page></span><div class="table-pagination"><button class="page-btn" type="button" data-cancel-prev aria-label="Previous cancellations page"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button><input class="page-number" type="number" min="1" value="1" inputmode="numeric" aria-label="Go to cancellations page" data-cancel-page-input><button class="page-btn" type="button" data-cancel-next aria-label="Next cancellations page"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button></div></div></article>`;
  workspace.after(cancelWorkspace);
  let currentCancellations=[],cancelPage=1;
  cancelShortcut.onclick=()=>{openWorkspace('cancellations');renderCancellations();};
  cancelAlert.onclick=()=>{cancelWorkspace.querySelector('[data-cancel-filter]').value='requested';cancelWorkspace.querySelector('[data-cancel-search]').value='';cancelPage=1;openWorkspace('cancellations');renderCancellations();};
  window.addEventListener('fmrc:orders-synced',e=>{
    currentCancellations=(e.detail?.orders || []).filter(o=>o.cancel_state && o.cancel_state!=='none');
    renderCancellations();
  });
  let focusedOrder = null, reloadPending = false;
  let page = 1, pages = 1, timer, busy = false, delay = 5000, snapshot = '', canApprove = false, currentRefunds = [], currentPayments = [], currentReceipts = [];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const emptyRow = message => `<tr class="table-empty-row"><td colspan="6"><div class="table-empty-state"><i class="fa-regular fa-folder-open" aria-hidden="true"></i><span>${esc(message)}</span></div></td></tr>`;
  const actionIcons = {'cancelapprove':'check','canceldecline':'xmark','gateway-manage':'rotate-left','order-view':'eye','cancellation-review':'clipboard-check','approve':'check','reject':'xmark','retry':'rotate-right','check-refund':'arrows-rotate','copy-claim':'copy','recoverrefund':'link','refund':'rotate-left','recovercheckout':'link','check':'arrows-rotate','history':'eye'};
  const styleActions = root => root.querySelectorAll('.gateway-actions button').forEach(button => {
    const label=button.textContent.trim() || button.getAttribute('aria-label');
    const icon=Object.keys(actionIcons).find(key=>button.hasAttribute('data-'+key));
    button.type='button'; button.classList.remove('gateway-primary');
    button.setAttribute('aria-label',label); button.dataset.tooltip=label;
    button.innerHTML='<i class="'+(!button.disabled && ['order-view','history'].includes(icon)?'fa-regular':'fa-solid')+' fa-'+(button.disabled?'spinner fa-spin':actionIcons[icon] || 'eye')+'" aria-hidden="true"></i>';
  });
  const money = cents => '₱' + (Number(cents) / 100).toLocaleString('en-PH', {minimumFractionDigits:2,maximumFractionDigits:2});
  const methodLabel = method => method === 'qrph' ? 'QR Ph' : method === 'gcash' ? 'GCash' : 'Online payment';
  const readable = value => String(value || 'Pending').replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
  const refundLabel = value => ({requested:'Awaiting Admin approval',submitting:'Submitting to provider',pending:'Processing with provider',unknown:'Awaiting provider confirmation',succeeded:'Refund confirmed',failed:'Failed — review and retry',rejected:'Request declined'}[value] || readable(value));
  const statusClass = value => ['paid','succeeded','approved'].includes(value) ? 'status-green' : ['failed','declined','rejected'].includes(value) ? 'status-red' : ['pending','requested','unknown','submitting'].includes(value) ? 'status-yellow' : 'status-blue';
  const badge = value => '<span class="status-pill '+statusClass(value)+'" data-status="' + esc(value) + '">' + esc(readable(value)) + '</span>';
  const dateLabel = value => {
    if (!value) return 'Not run yet';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Unavailable' : new Intl.DateTimeFormat('en-PH', {timeZone:'Asia/Manila', month:'short', day:'numeric', hour:'numeric', minute:'2-digit', second:'2-digit'}).format(date) + ' PHT';
  };
  const cancellationReason = row => [row.cancel_reason_label || row.cancel_reason,row.cancel_reason_detail].filter(Boolean).join(' - ');
  const detailField = (label, value, full=false) => `<div class="gateway-detail-field${full?' full':''}"><dt>${esc(label)}</dt><dd>${esc(value || 'Not provided')}</dd></div>`;
  const orderDetails = (order, reason='') => `<dl class="form-grid gateway-detail-grid">${detailField('Order',order.order_no_display || order.order_no)}${detailField('Customer',order.customer_name)}${reason?detailField('Reason',reason,true):''}</dl>`;
  const historyStatus = refund => refund.transfer_link ? 'Awaiting claim' : ({requested:'Awaiting approval',submitting:'Sending',pending:'Processing',unknown:'Checking status',succeeded:'Refunded',failed:'Failed',rejected:'Declined'}[refund.status] || readable(refund.status));
  const refundNextStep = refund => refund.failure_action || (refund.transfer_link ? 'The customer can claim the refund in My Orders.' : ({requested:'Admin must approve this refund.',submitting:'Wait for confirmation.',pending:'Wait for confirmation.',unknown:'Check the refund status.',succeeded:'Refund confirmed.',rejected:'No refund was sent.'}[refund.status] || 'Review the payment before retrying.'));
  const paymentHistory = (receipts, refunds) => `
    <section class="gateway-detail-section" aria-label="Payments"><h4><i class="fa-regular fa-credit-card" aria-hidden="true"></i> Payments</h4>
      ${receipts.length ? receipts.map(r=>`<article class="gateway-record-card"><div class="gateway-record-heading"><strong>${esc(methodLabel(r.source_type))}</strong><span class="gateway-record-amount">${money(r.amount_centavos)}</span></div><dl class="gateway-record-fields">${detailField('Payment ID',r.provider_payment_id)}</dl></article>`).join('') : '<p class="gateway-detail-empty">No payments recorded.</p>'}
    </section>
    <section class="gateway-detail-section" aria-label="Refunds"><h4><i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Refunds <span class="gateway-detail-count">${refunds.length}</span></h4>
      ${refunds.length ? [...refunds].sort((a,b)=>Number(b.id)-Number(a.id)).map(r=>`<article class="gateway-record-card"><div class="gateway-record-heading"><strong class="gateway-record-amount">${money(r.amount_centavos)}</strong><span class="status-pill ${statusClass(r.status)}">${esc(historyStatus(r))}</span></div>
        <dl class="gateway-record-fields">${detailField('Reason',r.reason || 'Not provided')}${r.failure_message?detailField('Issue',r.failure_message):''}</dl>
        <div class="gateway-next-step"><span>Next step</span><p>${esc(refundNextStep(r))}</p></div>
        <dl class="gateway-record-meta">${detailField('Request','#'+r.id)}${r.provider_refund_id?detailField('Refund ID',r.provider_refund_id):''}${r.error_code?detailField('Provider code',r.error_code):''}</dl>
      </article>`).join('') : '<p class="gateway-detail-empty">No refunds requested.</p>'}
    </section>`;
  const renderCancellations=()=>{
    const pending=currentCancellations.filter(o=>o.cancel_pending);
    cancelShortcut.innerHTML='<i class="fa-solid fa-ban" aria-hidden="true"></i> Cancellations <span class="tab-count">'+pending.length+'</span>';
    cancelAlert.hidden=!pending.length;cancelAlert.textContent=pending.length+' customer cancellation'+(pending.length===1?'':'s')+' awaiting a decision. View requests';
    const term=cancelWorkspace.querySelector('[data-cancel-search]').value.toLowerCase();
    const filter=cancelWorkspace.querySelector('[data-cancel-filter]').value;
    const rows=currentCancellations.filter(o=>(filter==='all'||o.cancel_state===filter) && [o.order_no,o.customer_name,cancellationReason(o)].join(' ').toLowerCase().includes(term)).sort((a,b)=>String(b.cancel_requested_at||'').localeCompare(String(a.cancel_requested_at||'')));
    const pages=Math.max(1,Math.ceil(rows.length/10));cancelPage=Math.min(Math.max(1,cancelPage),pages);
    cancelWorkspace.querySelector('[data-cancellation-list]').innerHTML=rows.slice((cancelPage-1)*10,cancelPage*10).map(o=>{
      const paid=o.payment_status==='paid',automated=o.payment_is_automated;
      return `<tr><td><strong>${esc(o.order_no_display || o.order_no)}</strong><small>${esc(o.customer_name)}</small></td><td>${esc(dateLabel(o.cancel_requested_at))}</td><td>${esc(cancellationReason(o) || 'No reason recorded')}<small>${esc(o.cancel_decision_note || '')}</small></td><td>${esc(o.payment_method_label || o.payment_method)}<small>${esc(paid?'Paid':readable(o.payment_status))} &middot; ${money(Math.round(Number(o.total_amount || o.total || 0)*100))}</small></td><td><span class="status-pill ${statusClass(o.cancel_pending?'requested':o.cancel_state)}" data-status="${o.cancel_pending?'requested':esc(o.cancel_state)}">${esc(o.cancel_pending?'Awaiting decision':o.cancel_state_label || readable(o.cancel_state))}</span></td><td class="action-icons sticky-action gateway-actions">${o.cancel_pending?`<button class="gateway-primary" data-cancelapprove="${o.id}">${canApprove && automated && paid?'Cancel & refund':paid && automated?'Cancel & request refund':'Approve cancellation'}</button><button data-canceldecline="${o.id}">Decline</button>`:automated?`<button data-gateway-manage="${o.id}">Refund details</button>`:''}<button data-order-view="${o.id}">Order details</button></td></tr>`;
    }).join('') || emptyRow('No cancellations match these filters.');
    cancelWorkspace.querySelector('[data-cancel-page]').textContent='Page '+cancelPage+' of '+pages;
    cancelWorkspace.querySelector('[data-cancel-prev]').disabled=cancelPage===1;cancelWorkspace.querySelector('[data-cancel-next]').disabled=cancelPage===pages;
    styleActions(cancelWorkspace);
    const cancelInput=cancelWorkspace.querySelector('[data-cancel-page-input]'); cancelInput.value=cancelPage; cancelInput.max=pages;
    window.AdminTableResize?.refresh?.();
  };
  cancelWorkspace.querySelector('[data-cancel-search]').oninput=()=>{cancelPage=1;renderCancellations();};
  cancelWorkspace.querySelector('[data-cancel-filter]').onchange=()=>{cancelPage=1;renderCancellations();};
  cancelWorkspace.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.hasAttribute('data-cancel-prev')){cancelPage--;renderCancellations();}
    else if(b.hasAttribute('data-cancel-next')){cancelPage++;renderCancellations();}
    else if(b.dataset.cancelapprove)show('cancelapprove',b.dataset.cancelapprove);
    else if(b.dataset.canceldecline)show('canceldecline',b.dataset.canceldecline);
  });
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
    clearTimeout(timer); if (document.hidden) return;
    if (busy) { reloadPending = true; return; }
    busy = true;
    try {
      const data = await api('/admin/gateway-payments?page=' + page + (panel.querySelector('[data-gateway-review]').checked ? '&review=1' : '') + (panel.querySelector('[data-gateway-refund-filter]').checked ? '&refunds=1' : '') + (focusedOrder ? '&order_id='+encodeURIComponent(focusedOrder) : '') + '&search='+encodeURIComponent(panel.querySelector('[data-gateway-search]').value)+'&refund_status='+encodeURIComponent(panel.querySelector('[data-gateway-status-filter]').value));
      if (reloadPending) return;
      currentReceipts = data.receipts || []; currentRefunds = data.refunds; currentPayments = data.payments.data; canApprove = data.can_approve; pages = data.payments.last_page; renderCancellations();
      refundShortcut.innerHTML = '<i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Online refunds <span class="tab-count">'+Number(data.refunds_awaiting_approval || 0)+'</span>';
      refundShortcut.title = 'Refund requests awaiting Admin approval';
      const stats=data.refund_summary || {};
      panel.querySelector('[data-gateway-stats]').innerHTML=[['Awaiting approval',stats.requested||0],['Processing',stats.processing||0],['Needs attention',stats.failed||0],['Returned to customers',money(stats.refunded_centavos||0)]].map(([label,value])=>'<div><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></div>').join('');
      panel.querySelector('[data-gateway-health]').innerHTML = '<span>'+esc(data.checkout_label || methodLabel(data.checkout_method))+'</span>'+badge(data.livemode?'live':'test')+'<span>Last scheduled check: '+esc(dateLabel(data.last_reconciled_at))+'</span>';
      panel.querySelector('[data-gateway-focus]').textContent = focusedOrder ? 'Showing selected order' : '';
      const nextSnapshot = JSON.stringify([data.payments,data.attempts,data.refunds,data.receipts,data.can_approve]);
      if (nextSnapshot !== snapshot) {
        panel.querySelector('[data-payment-list]').innerHTML = data.payments.data.map(p=>{
          const refunds=data.refunds.filter(r=>Number(r.payment_id)===Number(p.id));
          const receipts=currentReceipts.filter(r=>Number(r.payment_id)===Number(p.id));
          const remaining=receipt=>Number(receipt.amount_centavos)-refunds.filter(f=>f.provider_payment_id===receipt.provider_payment_id && !['failed','rejected'].includes(f.status)).reduce((sum,f)=>sum+Number(f.amount_centavos||0),0);
          const refundable=receipts.some(r=>remaining(r)>=100);
          const visible=refunds.filter(r=>!['failed','rejected'].includes(r.status)||!refunds.some(n=>n.id>r.id && n.provider_payment_id===r.provider_payment_id));
          const actions=[];
          if(p.cancel_state==='requested')actions.push(`<button class="gateway-primary" data-cancellation-review="${p.order_id}">Review cancellation</button>`);
          for(const r of visible){
            if(canApprove && r.status==='requested')actions.push(`<button class="gateway-primary" data-approve="${r.id}">Issue refund</button><button data-reject="${r.id}">Decline refund</button>`);
            if(r.status==='failed' && receipts.some(x=>x.provider_payment_id===r.provider_payment_id && remaining(x)>=Number(r.amount_centavos)))actions.push(`<button data-retry="${r.id}">${canApprove?'Retry refund':'Request retry'}</button>`);
            if(r.provider_refund_id && ['pending','unknown','submitting'].includes(r.status))actions.push(`<button data-check-refund="${r.id}">Check refund</button>`);
            if(r.transfer_link)actions.push(`<button data-copy-claim="${r.id}">Copy claim link</button>`);
            if(canApprove && !r.provider_refund_id && ['unknown','submitting'].includes(r.status))actions.push(`<button data-recoverrefund="${r.id}">Match refund</button>`);
          }
          if(refundable && ['paid','refunded'].includes(p.status) && p.cancel_state!=='requested' && !visible.some(r=>['requested','submitting','pending','unknown','failed'].includes(r.status)))actions.push(`<button data-refund="${p.order_id}">${canApprove?'Issue refund':'Request refund'}</button>`);
          if(canApprove && data.attempts.some(a=>Number(a.payment_id)===Number(p.id) && !a.checkout_id && ['creating','unknown'].includes(a.status)))actions.push(`<button data-recovercheckout="${p.order_id}">Match checkout</button>`);
          actions.push(`<button data-check="${p.order_id}">Check payment</button><button data-history="${p.order_id}">Details</button>`);
          const status=visible.map(r=>`<div class="gateway-table-state"><span class="status-pill ${statusClass(r.status)}" data-status="${esc(r.status)}">${esc(r.transfer_link?'Awaiting customer claim':refundLabel(r.status))}</span><small>${money(r.amount_centavos)}${r.status==='failed'?' - '+esc(r.failure_message || 'Needs review'):''}</small></div>`).join('') || '<span class="gateway-secondary">'+(p.cancel_state==='requested'?'Review cancellation first':['cancelled','rejected'].includes(p.lifecycle_status) && p.status==='paid'?'Refund required':'No refund requested')+'</span>';
          return `<tr><td><strong>${esc(p.order_no)}</strong><small>${esc(p.customer_name || 'Customer')}</small><small>${esc(readable(p.lifecycle_status))} &middot; ${esc(readable(p.status))}</small></td><td>${esc(cancellationReason(p) || (p.lifecycle_status==='rejected'?'Order rejected':'-'))}${p.cancel_requested_at?'<small>'+esc(dateLabel(p.cancel_requested_at))+'</small>':''}</td><td class="gateway-money">${money(receipts.reduce((n,r)=>n+Number(r.amount_centavos),0))}</td><td class="gateway-money">${money(refunds.filter(r=>r.status==='succeeded').reduce((n,r)=>n+Number(r.amount_centavos),0))}</td><td>${status}</td><td class="action-icons sticky-action gateway-actions">${actions.join('')}</td></tr>`;
        }).join('') || emptyRow('No payments match these filters.');
        window.AdminTableResize?.refresh?.();
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
      const paymentInput=panel.querySelector('[data-payment-page]'); paymentInput.value=page; paymentInput.max=pages;
      styleActions(panel);
      delay = 5000;
    } catch (e) { panel.querySelector('[data-gateway-health]').textContent = e.message; delay = Math.min(delay*2,30000); }
    finally { busy = false; const nextDelay = reloadPending ? 0 : delay; reloadPending = false; timer = setTimeout(load, nextDelay); }
  };
  const modal = document.createElement('dialog'); modal.className = 'gateway-team-dialog modal-card product-modal';
  modal.setAttribute('aria-labelledby', 'gatewayTeamTitle');
  modal.setAttribute('aria-describedby', 'gatewayTeamDescription');
  modal.innerHTML = `<form>
    <header class="modal-header-fixed"><h3 class="modal-title" id="gatewayTeamTitle" data-title></h3>
    </header><div class="modal-body-scroll"><div data-context hidden></div><p id="gatewayTeamDescription" data-description></p>
      <div class="field-stack" data-receipt><label for="gatewayReceipt">Original payment</label><select id="gatewayReceipt" class="input-field" name="provider_payment_id" required></select></div>
      <div class="field-stack" data-amount><label for="gatewayAmount">Amount (PHP)</label><input id="gatewayAmount" class="input-field" name="amount" type="number" min="1" step="0.01" required></div>
      <div class="field-stack" data-reason><label for="gatewayReason">Reason</label><textarea id="gatewayReason" class="textarea-field" name="reason" maxlength="400" required></textarea></div>
      <div class="field-stack" data-provider hidden><label for="gatewayProvider">Provider reference</label><input id="gatewayProvider" class="input-field" name="provider_id" required></div>
      <div data-record hidden></div><p class="gateway-modal-error" data-error role="alert"></p>
    </div><footer class="modal-footer-fixed"><button class="btn-admin btn-secondary" type="button" data-cancel>Close</button><button class="btn-admin" type="submit">Confirm</button></footer>
  </form>`;
  document.body.append(modal); let action, submitting = false;
  const close = () => { if (!submitting) modal.close(); };
  modal.querySelector('[data-cancel]').onclick = close;
  modal.addEventListener('cancel', e => { if (submitting) e.preventDefault(); });
  modal.addEventListener('keydown', e => {
    if (submitting && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); }
  });
  const show = (type,id) => {
    if (submitting) return;
    action = {type,id,key:crypto.randomUUID()}; const request = type === 'refund'; const recovering = type.startsWith('recover');
    modal.querySelector('[data-context]').hidden=true;
    modal.querySelector('[data-context]').innerHTML='';
    modal.querySelector('[data-description]').hidden=false;
    modal.querySelector('[data-description]').classList.remove('gateway-action-note');
    modal.querySelector('.modal-body-scroll').scrollTop=0;
    modal.querySelector('form').reset(); modal.querySelector('[data-error]').textContent = '';
    modal.querySelector('[data-record]').hidden=true; modal.querySelector('[type=submit]').hidden=false; modal.querySelector('[data-cancel]').textContent='Close'; modal.querySelector('[name=reason]').required=true; modal.querySelector('[data-reason]').firstChild.textContent='Reason';
    modal.querySelector('[data-title]').textContent = request ? (canApprove?'Issue payment refund':'Request payment refund') : type === 'approve' ? 'Approve and issue refund' : 'Reject refund request';
    modal.querySelector('[data-description]').textContent = request ? (canApprove?'You are issuing this refund as Admin. For QR Ph, PayMongo creates a claim form for the customer. No separate Admin approval is needed.':'Send this refund request to Admin for approval. No money is returned until Admin issues it.') : type === 'approve' ? 'This sends the requested refund to the original payment method. Confirm only after reviewing the amount and reason in the payment history.' : 'No money will be returned for this request.';
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
    modal.querySelector('[type=submit]').textContent = request ? (canApprove?'Issue refund':'Send refund request') : type === 'approve' ? 'Issue refund' : recovering ? 'Verify record' : 'Reject request';
    if (type === 'retry') modal.querySelector('[type=submit]').textContent = canApprove ? 'Retry and issue refund' : 'Request retry';
    if(type==='history'){
      const p=currentPayments.find(p=>String(p.order_id)===String(id));
      const receipts=currentReceipts.filter(r=>Number(r.payment_id)===Number(p?.id));
      const refunds=currentRefunds.filter(r=>Number(r.payment_id)===Number(p?.id));
      modal.querySelector('[data-title]').textContent='Payment & refund details';
      modal.querySelector('[data-description]').textContent='Payment and refund records.';
      modal.querySelector('[data-description]').hidden=true;
      modal.querySelector('[data-context]').hidden=false;
      modal.querySelector('[data-context]').innerHTML=orderDetails(p || {},cancellationReason(p || {}) || 'No cancellation recorded');
      modal.querySelector('[data-record]').hidden=false;
      modal.querySelector('[data-record]').innerHTML=paymentHistory(receipts,refunds);
      modal.querySelector('[type=submit]').hidden=true;modal.querySelector('[data-cancel]').textContent='Done';
    }
    if(type==='cancelapprove' || type==='canceldecline'){
      const o=currentCancellations.find(o=>String(o.id)===String(id));
      if(!o?.cancel_pending){checkResult.hidden=false;checkResult.textContent='This cancellation is no longer awaiting a decision.';return;}
      action.issueRefund=type==='cancelapprove' && canApprove && o.payment_is_automated && o.payment_status==='paid';
      modal.querySelector('[data-title]').textContent=type==='canceldecline'?'Decline cancellation':action.issueRefund?'Cancel & refund':'Approve cancellation';
      modal.querySelector('[data-context]').hidden=false;
      modal.querySelector('[data-context]').innerHTML=orderDetails(o,cancellationReason(o) || 'No reason recorded')+`<dl class="form-grid gateway-detail-grid">${detailField('Payment',o.payment_method_label || methodLabel(o.payment_method))}${detailField('Status',readable(o.payment_status))}</dl>`;
      modal.querySelector('[data-description]').classList.add('gateway-action-note');
      modal.querySelector('[data-description]').textContent=type==='canceldecline'?'The order will continue. The customer will see your reason.':action.issueRefund?'Cancel this order and issue a refund. For QR Ph, the customer must claim the refund.':o.payment_is_automated && o.payment_status==='paid'?'Cancel this order and send the refund to Admin for approval.':'Cancel this order. Return and record any payment received.';
      modal.querySelector('[data-reason]').hidden=false;modal.querySelector('[data-reason]').firstChild.textContent=type==='canceldecline'?'Reason for declining':'Note to customer (optional)';
      modal.querySelector('[name=reason]').disabled=false;modal.querySelector('[name=reason]').required=type==='canceldecline';
      modal.querySelector('[type=submit]').textContent=type==='canceldecline'?'Decline cancellation':action.issueRefund?'Cancel & refund':o.payment_is_automated && o.payment_status==='paid'?'Cancel & request refund':'Approve cancellation';
    }
    if (!modal.open) modal.showModal();
  };
  modal.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    if (submitting || !action || action.type === 'history' || !modal.querySelector('form').reportValidity()) return;
    submitting = true; const button = modal.querySelector('[type=submit]'), label = button.textContent;
    modal.setAttribute('closedby', 'none');
    button.disabled = true; button.textContent = 'Processing\u2026';
    modal.querySelector('[data-cancel]').disabled = true;
    modal.querySelector('[data-error]').textContent = '';
    try {
      if (action.type === 'recovercheckout') await api('/admin/orders/'+action.id+'/payment-recover', {provider_id:modal.querySelector('[name=provider_id]').value.trim()});
      else if (action.type === 'recoverrefund') await api('/admin/gateway-refunds/'+action.id+'/recover', {provider_id:modal.querySelector('[name=provider_id]').value.trim()});
      else if(action.type==='cancelapprove' || action.type==='canceldecline'){
        const result=await api('/admin/orders/'+action.id+'/cancellation',{decision:action.type==='cancelapprove'?'approve':'decline',note:modal.querySelector('[name=reason]').value.trim(),issue_refund:!!action.issueRefund});
        if(result.order)currentCancellations=currentCancellations.map(o=>String(o.id)===String(result.order.id)?result.order:o);
        const feedback=cancelWorkspace.querySelector('[data-cancel-result]');feedback.hidden=false;
        const states=(result.refunds || []).map(r=>refundLabel(r.status)).filter((v,i,a)=>a.indexOf(v)===i).join(', ');
        feedback.textContent=result.refund_issue_error || result.message+(states?' Refund: '+states+'. Open Online refunds for details.':'');
        renderCancellations();
      }
      else if (action.type === 'refund'){
        const result=await api('/admin/orders/'+action.id+'/gateway-refunds',{amount_centavos:Math.round(Number(modal.querySelector('[name=amount]').value)*100),reason:modal.querySelector('[name=reason]').value,request_key:action.key,provider_payment_id:modal.querySelector('[name=provider_payment_id]').value,issue:canApprove});
        checkResult.hidden=false;checkResult.textContent=canApprove?refundLabel(result.data?.status)+'. '+(result.data?.failure_message || 'The customer can follow progress in Payment details.'):'Refund requested. Admin must approve it before it is sent to PayMongo.';
      }
      else {
        const result = await api('/admin/gateway-refunds/'+action.id+'/'+action.type, action.type === 'retry' ? {request_key:action.key,issue:canApprove} : action.type === 'reject' ? {reason:modal.querySelector('[name=reason]').value.trim()} : {});
        checkResult.hidden = false;
        checkResult.textContent = action.type === 'reject' ? 'Refund request declined. No money was sent.' : refundLabel(result.data?.status) + '. ' + (result.data?.failure_message || 'Open the refund history below for details.');
      }
      modal.close(); window.dispatchEvent(new CustomEvent('fmrc:orders-updated',{detail:{source:'gateway-payments',timestamp:Date.now()}})); snapshot = ''; await load();
    } catch (e) { modal.querySelector('[data-error]').textContent = e.message; }
    finally { submitting = false; modal.removeAttribute('closedby'); button.disabled = false; button.textContent = label; modal.querySelector('[data-cancel]').disabled = false; }
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
      checking.add(key); b.disabled=true; b.textContent='Checking...'; styleActions(panel);
      try { const result=await api('/admin/gateway-refunds/'+b.dataset.checkRefund+'/check',{});
        checkResult.hidden=false; checkResult.textContent=refundLabel(result.data?.status)+'. '+(result.data?.failure_message || 'Refund status checked.'); snapshot=''; void load();
      } catch(error) {checkResult.hidden=false;checkResult.textContent=error.message;}
      finally {checking.delete(key);b.disabled=false;b.textContent='Check refund'; styleActions(panel);}
      return;
    }
    if (b.hasAttribute('data-gateway-all')) { focusedOrder=null; page=1; snapshot=''; panel.querySelector('[data-gateway-search]').value=''; panel.querySelector('[data-gateway-status-filter]').value=''; panel.querySelector('[data-gateway-review]').checked=false; panel.querySelector('[data-gateway-refund-filter]').checked=false; return load(); }
    if (b.hasAttribute('data-prev')) { page--; snapshot=''; return load(); }
    if (b.hasAttribute('data-next')) { page++; snapshot=''; return load(); }
    for (const type of ['refund','retry','approve','reject','history','recovercheckout','recoverrefund']) if (b.dataset[type]) return show(type,b.dataset[type]);
    if (b.dataset.check) {
      const id = b.dataset.check; if (checking.has(id)) return;
      checking.add(id); b.disabled = true; b.textContent = 'Checking\u2026'; styleActions(panel);
      const order = currentPayments.find(p => String(p.order_id) === id);
      checkResult.hidden = false; checkResult.textContent = 'Checking payment for ' + (order?.order_no || 'this order') + '\u2026';
      try {
        const result = await api('/admin/orders/'+id+'/payment-reconcile', {});
        checkResult.textContent = (order?.order_no || 'Order') + ': ' + (result.exception ? 'Payment needs review.' : result.status === 'paid' ? 'Payment confirmed.' : result.status === 'refunded' ? 'Refund confirmed.' : 'Payment is not confirmed yet.') + ' Checked at ' + dateLabel(new Date().toISOString()) + '.';
        snapshot=''; void load();
      } catch(e) { checkResult.textContent = e.message; }
      finally {
        checking.delete(id);
        panel.querySelectorAll('[data-check]').forEach(button => { if(button.dataset.check === id) { button.disabled=false; button.textContent='Check payment'; styleActions(panel); } });
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
    panel.querySelector('[data-gateway-refund-filter]').checked=true;  void load(); panel.scrollIntoView({behavior:'smooth',block:'start'});
  };
  document.addEventListener('click',e=>{const button=e.target.closest('[data-cancellation-review]');if(!button)return;document.getElementById('modalOrderDetails')?.classList.remove('show');openWorkspace('cancellations');show('cancelapprove',button.dataset.cancellationReview);});
  document.addEventListener('click', e => {
    const button = e.target.closest('[data-gateway-manage]'); if (!button) return;
    openWorkspace();
    focusedOrder=button.dataset.gatewayManage; page=1; snapshot=''; panel.querySelector('[data-gateway-search]').value=''; panel.querySelector('[data-gateway-status-filter]').value='';
    panel.querySelector('[data-gateway-review]').checked=false; panel.querySelector('[data-gateway-refund-filter]').checked=false;
     void load(); panel.scrollIntoView({behavior:'smooth',block:'start'});
  });
  window.AdminPageNumberInput?.bind(panel.querySelector('[data-payment-page]'), {
    getPage:()=>page, getTotalPages:()=>pages,
    onChange:value=>{page=value;snapshot='';void load();}
  });
  window.AdminPageNumberInput?.bind(cancelWorkspace.querySelector('[data-cancel-page-input]'), {
    getPage:()=>cancelPage, getTotalPages:()=>Number(cancelWorkspace.querySelector('[data-cancel-page-input]').max) || 1,
    onChange:value=>{cancelPage=value;renderCancellations();}
  });
  void load();
  ['focus','online'].forEach(type => window.addEventListener(type, load));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
});
