/* Opt-in Services presentation; feature owners retain data, drafts and save logic. */
document.addEventListener('DOMContentLoaded', () => {
  'use strict';
  if (!document.body.hasAttribute('data-portal-services-dialogs')) return;
  const svg = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const icons = {
    service: svg('<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 5v10l9 5 9-5V8M12 13v10"/>'),
    text: svg('<path d="M5 3h14v18H5V3Zm4 5h6M9 12h6M9 16h4"/>'),
    category: svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
    image: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/>'),
    close: svg('<path d="m6 6 12 12M18 6 6 18"/>'),
  };
  const sectionHeading = (title, icon) => {
    const header = document.createElement('div'); header.className = 'services-section-heading';
    const tile = document.createElement('span'); tile.className = 'home-editor-section-icon'; tile.innerHTML = icon;
    header.append(tile,title); return header;
  };
  [['servicePageCopyTitle',icons.text],['serviceCategoryTitle',icons.category]].forEach(([id,icon]) => {
    const title = document.getElementById(id); if (!title) return;
    const panel = title.closest('.panel'), header = sectionHeading(title,icon); panel?.prepend(header);
  });
  const grid = document.getElementById('servicesGrid'), panel = grid?.closest('.panel');
  if (panel) {
    panel.classList.add('services-catalog-panel');
    const title = document.createElement('h2'); title.id = 'serviceCardsTitle'; title.textContent = 'Service Cards';
    panel.setAttribute('aria-labelledby',title.id); panel.prepend(sectionHeading(title,icons.service));
  }
  const root = document.getElementById('serviceModal'), card = root?.querySelector('.wm-modal-card');
  if (!root || !card) return;
  const header = root.querySelector('.wm-modal-header'), title = document.getElementById('serviceModalTitle');
  root.classList.add('modal-overlay','portal-detail-dialog','portal-detail-dialog--form'); root.dataset.backdropClose = 'false';
  card.classList.add('portal-detail-dialog__card'); card.setAttribute('role','dialog'); card.setAttribute('aria-modal','true'); card.setAttribute('aria-labelledby',title.id);
  header.classList.add('portal-detail-dialog__header');
  const tile = document.createElement('span'); tile.className = 'portal-detail-dialog__icon'; tile.innerHTML = icons.service;
  const heading = document.createElement('div'); heading.className = 'portal-detail-dialog__heading';
  const eyebrow = document.createElement('p'); eyebrow.className = 'portal-detail-dialog__eyebrow'; eyebrow.textContent = 'Services';
  title.classList.add('portal-detail-dialog__title'); title.dataset.portalDetailHeading = ''; title.tabIndex = -1;
  heading.append(eyebrow,title); header.prepend(tile,heading);
  // The existing button owns cancellation. The shared controller only owns Escape.
  const close = document.getElementById('btnCloseServiceModal'); close.className = 'portal-detail-dialog__close'; close.innerHTML = icons.close;
  const body = root.querySelector('.wm-modal-body'); body.classList.add('portal-detail-dialog__body','modal-body-scroll'); body.tabIndex = 0; body.setAttribute('role','region'); body.setAttribute('aria-labelledby',title.id);
  root.querySelector('.wm-modal-footer').classList.add('portal-detail-dialog__footer');
  const form = root.querySelector('.wm-form-grid'), imageField = document.getElementById('svcImgInput').closest('.field-stack');
  const addLabel = (label,icon) => {
    const node = document.createElement('div'); node.className = 'services-form-heading full';
    const title = document.createElement('h4'); title.textContent = label; node.innerHTML = icon; node.append(title); return node;
  };
  imageField.before(addLabel('Service image',icons.image));
  document.getElementById('svcCategory').closest('.field-stack').before(addLabel('Service information',icons.service));
  const oldDetails = [...form.children].find(node => node.querySelector('p')?.textContent.trim() === 'View Details Modal Content');
  if (oldDetails) oldDetails.replaceWith(addLabel('Customer-facing details',icons.text));
  const placeholder = document.getElementById('svcImgPlaceholder'); placeholder.tabIndex = 0; placeholder.setAttribute('role','button'); placeholder.setAttribute('aria-label','Upload service image');
  placeholder.addEventListener('keydown',event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); placeholder.click(); } });
  window.PortalDetailDialog?.adopt(root,{close: () => close.click()});
});
