/* Orders-only presentation adapter. Existing owners retain fields, events and guards. */
document.addEventListener('DOMContentLoaded', () => {
  'use strict';
  if (!document.getElementById('ordersModuleTabs')) return;
  const svg = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const box = svg('<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 5v10l9 5 9-5V8M12 13v10M7.5 5.5l9 5"/>');
  const cross = svg('<path d="m6 6 12 12M18 6 6 18"/>');
  const search = svg('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>');
  const glyphs = {
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    receipt: '<path d="M5 3h14v18l-3-2-4 2-4-2-3 2V3Zm4 5h6M9 12h6"/>',
    truck: '<path d="M3 5h12v12H3V5Zm12 5h4l3 4v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    'credit-card': '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h3"/>',
  };
  const decorate = () => document.querySelectorAll('.orders-dialog .order-section-title > i').forEach(icon => {
    const name = Object.keys(glyphs).find(key => icon.classList.contains('fa-'+key));
    const tile = document.createElement('span'); tile.className = 'orders-section-icon'; tile.innerHTML = name ? svg(glyphs[name]) : box; icon.replaceWith(tile);
  });
  const pending = root => root.getAttribute('aria-busy') === 'true' || root.getAttribute('closedby') === 'none' || [...root.querySelectorAll('button:disabled')].some(b => /saving|processing|archiving|deleting|submitting/i.test(b.textContent));
  const closeSelectors = {
    modalOrderDetails: '[data-modal-close]', modalTrackingUpdate: '#btnCancelTrackingUpdate',
    modalReturnDetails: '[data-modal-close]', modalReturnAction: '#btnCancelReturnAction',
    modalAddWalkInOrder: '#cancelWalkInOrderBtn', modalWalkInDetails: '#btnCloseWalkInDetails',
    rejectIncomingOrderDialog: '#cancelIncomingOrderRejection',
  };
  const adopt = root => {
    if (root.hasAttribute('data-orders-refined')) return;
    const native = root.matches('dialog');
    const card = native ? root.querySelector('form') : root.querySelector('.modal-card');
    const title = root.querySelector('.modal-title');
    if (!card || !title) return;
    root.dataset.ordersRefined = '';
    const compact = !native && card.classList.contains('modal-confirm');
    root.classList.add('portal-detail-dialog', 'portal-detail-dialog--form', 'orders-dialog');
    root.classList.toggle('portal-detail-dialog--compact', compact);
    if (native) root.classList.add('orders-native-dialog');
    card.classList.add('portal-detail-dialog__card');
    let header = card.querySelector('.modal-header-fixed');
    if (!header) {
      header = document.createElement('header');
      // Old archive headings contain a decorative tile in a wrapper. Move the title,
      // then discard only that obsolete decoration, leaving message bindings intact.
      const old = title.parentElement === card ? title : title.parentElement;
      card.prepend(header); header.append(title); if (old !== title) old.remove();
    }
    header.classList.add('portal-detail-dialog__header');
    const heading = document.createElement('div'); heading.className = 'portal-detail-dialog__heading';
    const eyebrow = document.createElement('p'); eyebrow.className = 'portal-detail-dialog__eyebrow'; eyebrow.textContent = 'Orders';
    title.classList.add('portal-detail-dialog__title'); title.dataset.portalDetailHeading = ''; title.tabIndex = -1;
    if (!title.id) title.id = (root.id || 'gatewayTeam') + 'Heading';
    heading.append(eyebrow, title);
    const icon = document.createElement('span'); icon.className = 'portal-detail-dialog__icon'; icon.innerHTML = box;
    header.prepend(icon, heading);
    const footer = card.querySelector('.modal-footer-fixed,.modal-actions');
    footer?.classList.add('portal-detail-dialog__footer');
    footer?.querySelectorAll('.btn-admin').forEach(button => { button.style.removeProperty('background'); button.style.removeProperty('border-color'); });
    let body = card.querySelector('.modal-body-scroll');
    if (!body) {
      body = document.createElement('div'); body.className = 'modal-body-scroll';
      [...card.children].filter(n => n !== header && n !== footer).forEach(n => n.matches('hr') ? n.remove() : body.append(n));
      card.insertBefore(body, footer);
    }
    body.classList.add('portal-detail-dialog__body'); body.tabIndex = 0; body.setAttribute('role', 'region'); body.setAttribute('aria-labelledby', title.id);
    header.querySelectorAll('.field-hint').forEach(hint => body.prepend(hint));
    card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-labelledby', title.id);
    if (native) card.removeAttribute('role');
    const ownerClose = root.querySelector(closeSelectors[root.id] || '[data-cancel],.modal-actions .btn-secondary,.modal-footer-fixed .btn-secondary');
    const close = () => { if (!pending(root)) ownerClose?.click(); };
    if (!compact) {
      const x = document.createElement('button'); x.type = 'button'; x.className = 'portal-detail-dialog__close'; x.dataset.portalDetailClose = ''; x.setAttribute('aria-label', 'Close dialog'); x.innerHTML = cross; header.append(x);
    }
    window.PortalDetailDialog?.adopt(root, {close, visibility: native ? 'native' : 'class'});
    // Backdrops never dismiss Orders forms; all closing goes through the owner.
    root.addEventListener('click', e => { if (e.target === root) { e.stopImmediatePropagation(); } }, true);
    ownerClose?.addEventListener('click', e => { if (pending(root)) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  };
  const refine = () => {
    document.querySelectorAll('.modal-overlay[id^="modal"],dialog.gateway-team-dialog,dialog#rejectIncomingOrderDialog').forEach(adopt);
    document.querySelectorAll('.orders-layout-stack input[type="search"],.orders-layout-stack input.search-input').forEach(input => {
      input.placeholder = 'Search';
      if (input.closest('.portal-search-field')) return;
      const wrap = document.createElement('div'); wrap.className = 'portal-search-field orders-search';
      input.before(wrap); wrap.innerHTML = search; wrap.append(input);
      input.setAttribute('aria-label', input.getAttribute('aria-label') || 'Search orders');
    });
  };
  refine();
  decorate();
  new MutationObserver(records => {
    const added = records.flatMap(r => [...r.addedNodes]).filter(n => n.nodeType === 1);
    if (added.some(n => n.matches('dialog,.archive-section') || n.querySelector('dialog'))) refine();
    if (added.some(n => n.matches('.order-section-title') || n.querySelector('.order-section-title > i'))) decorate();
  }).observe(document.body, {childList: true, subtree: true});
});
