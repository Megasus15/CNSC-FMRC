/* Presentation only for Admin Shipping & Delivery; owners retain all workflows. */
(() => {
  'use strict';
  document.addEventListener('DOMContentLoaded', () => {
    if (!document.body.hasAttribute('data-portal-shipping-dialogs')) return;
    const root = document.querySelector('.shipping-page');
    if (!root) return;
    const paths = {
      delivery:'<path d="M3 7h11v11H3zM14 11h4l3 4v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
      tracking:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
      edit:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="currentColor"/><circle cx="15" cy="17" r="3" fill="currentColor"/>',
      area:'<path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
      calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 11h18M7 15h2M13 15h2"/>',
      publish:'<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>',
      info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
      preview:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>'
    };
    const decorate = (heading, key, small = false) => {
      if (!heading || heading.querySelector(':scope > [data-shipping-ui-icon]')) return;
      const icon = document.createElement('span');
      icon.className = small ? 'shipping-inline-icon' : 'shipping-section-icon';
      icon.dataset.shippingUiIcon = ''; icon.setAttribute('aria-hidden','true');
      icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[key]}</svg>`;
      const existing = heading.querySelector(':scope > i');
      if (existing) existing.replaceWith(icon); else heading.prepend(icon);
    };
    const refresh = () => {
      root.querySelectorAll('h3,h4').forEach(heading => {
        const key = heading.closest('.shipping-tracking-status') ? 'tracking'
          : heading.closest('.shipping-zone,.shipping-areas-card') ? 'area'
          : heading.closest('.shipping-publish') ? 'publish'
          : heading.closest('.shipping-editor-section') ? 'calendar'
          : heading.closest('#shippingEditor') ? 'edit' : 'delivery';
        decorate(heading,key);
      });
      root.querySelectorAll('.shipping-preview > summary').forEach(heading => decorate(heading,'preview',true));
      root.querySelectorAll('.shipping-help > summary,.shipping-readiness > strong,.shipping-pending > strong,.shipping-empty > strong').forEach(heading => decorate(heading,'info',true));
      root.querySelectorAll('[data-province-search]').forEach(input => { input.placeholder = 'Search'; });
    };
    let frame = 0;
    new MutationObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; refresh(); });
    }).observe(root,{childList:true,subtree:true});
    refresh();
  });
})();
