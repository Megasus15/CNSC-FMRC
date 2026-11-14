/* Home/About editor presentation only. Feature owners retain their existing draft logic. */
document.addEventListener('DOMContentLoaded', () => {
  'use strict';
  const about = document.body.hasAttribute('data-portal-about-dialogs');
  if (!about && !document.body.hasAttribute('data-portal-home-dialogs')) return;
  const svg = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const star = svg('<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/>');
  const image = svg('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/>');
  const cube = svg('<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 5v10l9 5 9-5V8M12 13v10"/>');
  const globe = svg('<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 7h14M5 17h14"/>');
  const grid = svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>');
  const text = svg('<path d="M5 3h14v18H5V3Zm4 5h6M9 12h6M9 16h4"/>');
  const compass = svg('<circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6 6-2Z"/>');
  const book = svg('<path d="M12 5C8 3 5 3 2 4v16c3-1 6-1 10 1 4-2 7-2 10-1V4c-3-1-6-1-10 1Zm0 0v16"/>');
  const closeIcon = svg('<path d="m6 6 12 12M18 6 6 18"/>');
  const sections = [...document.querySelectorAll(`.wm-section[data-config-section="${about ? 'about' : 'home'}"],#editorialContentEditor`)];
  sections.forEach((section, index) => {
    const heading = section.querySelector('.wm-section-header'), oldIcon = heading?.querySelector(':scope > i');
    if (!heading || !oldIcon) return;
    const icon = document.createElement('span'); icon.className = 'home-editor-section-icon'; icon.innerHTML = (about ? [globe,compass,book,text] : [star,cube,image,globe,grid,text])[index] || text; oldIcon.replaceWith(icon);
  });
  if (about) ['vision','mission'].forEach(kind => {
    const fit = document.getElementById(kind+'ImgPreviewFitBtn'), remove = document.getElementById(kind+'ImgPreviewRemoveBtn');
    if (!fit || !remove) return;
    const actions = document.createElement('div'); actions.className = 'about-image-actions'; fit.before(actions); actions.append(fit,remove);
    fit.style.removeProperty('margin-top'); remove.style.removeProperty('margin-top');
  });
  const owners = {cropModal: () => window.closeCropModal(), sdgModal: () => window.closeSdgModal(), serviceModal: () => window.closeServiceModal()};
  Object.entries(owners).forEach(([id, close]) => {
    const root = document.getElementById(id), card = root?.querySelector('.wm-modal-card'), header = root?.querySelector('.wm-modal-header');
    if (!root || !card || !header) return;
    root.classList.add('modal-overlay','portal-detail-dialog','portal-detail-dialog--form'); root.dataset.backdropClose = 'false';
    card.classList.add('portal-detail-dialog__card'); card.style.removeProperty('max-width');
    const title = header.querySelector('h3'), button = header.querySelector('.btn-close-x');
    const heading = document.createElement('div'); heading.className = 'portal-detail-dialog__heading';
    const eyebrow = document.createElement('p'); eyebrow.className = 'portal-detail-dialog__eyebrow'; eyebrow.textContent = about ? 'About Us' : 'Home Page';
    title.classList.add('portal-detail-dialog__title'); title.dataset.portalDetailHeading = ''; title.tabIndex = -1; heading.append(eyebrow,title);
    const icon = document.createElement('span'); icon.className = 'portal-detail-dialog__icon'; icon.innerHTML = id === 'cropModal' ? image : id === 'sdgModal' ? globe : grid;
    header.classList.add('portal-detail-dialog__header'); header.prepend(icon,heading);
    button.removeAttribute('onclick'); button.type = 'button'; button.className = 'portal-detail-dialog__close'; button.dataset.portalDetailClose = ''; button.setAttribute('aria-label','Close dialog'); button.innerHTML = closeIcon;
    const body = root.querySelector('.wm-modal-body'); body.classList.add('modal-body-scroll','portal-detail-dialog__body'); body.tabIndex = 0; body.setAttribute('role','region'); body.setAttribute('aria-labelledby',title.id);
    root.querySelector('.wm-modal-footer').classList.add('portal-detail-dialog__footer');
    if (id === 'cropModal') body.querySelector('#cropCircle').after(root.querySelector('.wm-crop-fit-group'));
    card.setAttribute('role','dialog'); card.setAttribute('aria-modal','true'); card.setAttribute('aria-labelledby',title.id);
    window.PortalDetailDialog?.adopt(root,{close});
  });
  // Existing image upload placeholders keep their click handler and gain keyboard access.
  document.querySelectorAll('.wm-img-placeholder[onclick]').forEach(node => {
    node.tabIndex = 0; node.setAttribute('role','button'); node.setAttribute('aria-label',node.textContent.trim() || 'Upload image');
    node.addEventListener('keydown',event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); node.click(); } });
  });
  document.querySelectorAll('.field-stack').forEach(field => {
    const label = field.querySelector(':scope > label'), input = field.querySelector('input:not([type=hidden]):not([type=file]),select,textarea');
    if (label && input?.id && !label.htmlFor) label.htmlFor = input.id;
  });
  ['cropScale','cropRotate'].forEach(id => { const input = document.getElementById(id), label = input?.parentElement.querySelector('label'); if (label) label.htmlFor = id; });
});
