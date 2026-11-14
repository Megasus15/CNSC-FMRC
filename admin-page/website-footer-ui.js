/* Footer presentation only: preserve fields, quick-link owners and publishing. */
document.addEventListener('DOMContentLoaded', () => {
  'use strict';
  if (!document.body.hasAttribute('data-portal-footer-dialogs')) return;
  const svg = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const paths = ['<path d="M4 21V7l8-4 8 4v14M2 21h20M8 8h2M14 8h2M8 12h2M14 12h2M10 21v-5h4v5"/>','<path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0"/>','<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>','<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="10" r="2"/><path d="M5 17v-1a3 3 0 0 1 6 0v1M15 9h3M15 13h3"/>','<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>','<circle cx="12" cy="12" r="9"/><path d="M15 8a5 5 0 1 0 0 8"/>'];
  const titles = ['Brand & Location','Quick Links','Opening Hours','Contact Information','University Links','Copyright & Attribution'];
  document.querySelectorAll('.wm-section-header').forEach((header,index) => {
    const old = header.querySelector(':scope > i'), title = header.querySelector('h3'), tile = document.createElement('span');
    tile.className = 'home-editor-section-icon'; tile.innerHTML = svg(paths[index] || paths[0]);
    if (old) old.replaceWith(tile); else header.prepend(tile); if (title) title.textContent = titles[index] || title.textContent;
  });
  document.querySelectorAll('.field-stack').forEach(field => {
    const label = field.querySelector(':scope > label'), input = field.querySelector('input,textarea'); if (label && input?.id) label.htmlFor = input.id;
  });
  ['footerContactLocationUrl','footerCopyright','footerBottomDev'].forEach(id => document.getElementById(id)?.closest('.field-stack').classList.add('full'));
});
