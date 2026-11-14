/* Contact presentation only. Existing feature owners retain settings and draft logic. */
document.addEventListener('DOMContentLoaded', () => {
  'use strict';
  if (!document.body.hasAttribute('data-portal-contact-dialogs')) return;
  const svg = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const icons = [svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="10" r="2"/><path d="M5 17v-1a3 3 0 0 1 6 0v1M15 9h3M15 13h3"/>'),svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>')];
  document.querySelectorAll('.wm-section-header').forEach((header,index) => {
    const old = header.querySelector(':scope > i'), title = header.querySelector('h3');
    const tile = document.createElement('span'); tile.className = 'home-editor-section-icon'; tile.innerHTML = icons[index] || icons[0];
    if (old) old.replaceWith(tile); else header.prepend(tile);
    if (title) title.textContent = index === 0 ? 'Contact Information' : 'Message Form';
  });
  document.querySelectorAll('.field-stack').forEach(field => {
    const label = field.querySelector(':scope > label'), input = field.querySelector('input,textarea,select');
    if (label && input?.id) label.htmlFor = input.id;
  });
  ['contactHeading','contactFormHeading','contactLocationUrl'].forEach(id => document.getElementById(id)?.closest('.field-stack').classList.add('full'));
});
