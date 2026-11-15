/* Presentation only: keep a fitting desktop preview in view during page scroll. */
(() => {
  'use strict';
  document.addEventListener('DOMContentLoaded', () => {
    if (!document.body.hasAttribute('data-portal-portals-dialogs')) return;
    const preview = document.querySelector('.portal-preview-column');
    const header = document.querySelector('.top-header');
    const saveBar = document.querySelector('.portal-save-bar');
    if (!preview) return;
    let frame = 0;
    const sync = () => {
      frame = 0;
      const top = Math.max(0,header?.getBoundingClientRect().bottom || 0) + 16;
      const bottom = saveBar?.classList.contains('portal-bottom-bar') ? Math.max(0,innerHeight-saveBar.getBoundingClientRect().top) : 0;
      preview.style.setProperty('--portal-preview-top',`${Math.ceil(top)}px`);
      // Tall content, text zoom and short screens stay in normal flow, fully readable.
      preview.classList.toggle('is-sticky',matchMedia('(min-width:1201px)').matches && preview.offsetHeight <= innerHeight-top-bottom-16);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(sync); };
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(schedule);
      [preview,header,saveBar].filter(Boolean).forEach(node => observer.observe(node));
    }
    window.addEventListener('resize',schedule,{passive:true});
    document.fonts?.ready.then(schedule);
    schedule();
  });
})();
