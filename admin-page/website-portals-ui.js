/* Presentation only: keep the desktop preview in view, including short screens. */
(() => {
  'use strict';
  document.addEventListener('DOMContentLoaded', () => {
    if (!document.body.hasAttribute('data-portal-portals-dialogs')) return;
    const preview = document.querySelector('.portal-preview-column');
    const header = document.querySelector('.top-header');
    const saveBar = document.querySelector('.portal-save-bar');
    const content = preview?.querySelector('.portal-preview-content');
    if (!preview) return;
    let frame = 0;
    const sync = () => {
      frame = 0;
      const top = Math.max(0,header?.getBoundingClientRect().bottom || 0) + 16;
      const bottom = saveBar?.classList.contains('portal-bottom-bar') ? Math.max(0,innerHeight-saveBar.getBoundingClientRect().top) : 0;
      preview.style.setProperty('--portal-preview-top',`${Math.ceil(top)}px`);
      preview.style.setProperty('--portal-preview-max-height',`${Math.max(120,Math.floor(innerHeight-top-bottom-16))}px`);
      const sticky = matchMedia('(min-width:1101px)').matches;
      preview.classList.toggle('is-sticky',sticky);
      // The card stays anchored; tall content remains reachable by wheel or keyboard.
      if (content) content.tabIndex = sticky && content.scrollHeight > content.clientHeight + 1 ? 0 : -1;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(sync); };
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(schedule);
      [preview,content,header,saveBar].filter(Boolean).forEach(node => observer.observe(node));
    }
    window.addEventListener('resize',schedule,{passive:true});
    document.fonts?.ready.then(schedule);
    schedule();
  });
})();
