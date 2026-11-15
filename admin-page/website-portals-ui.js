/* Presentation only: fit the complete desktop preview without nested scrolling. */
(() => {
  'use strict';
  document.addEventListener('DOMContentLoaded', () => {
    if (!document.body.hasAttribute('data-portal-portals-dialogs')) return;
    const preview = document.querySelector('.portal-preview-column');
    const header = document.querySelector('.top-header');
    const saveBar = document.querySelector('.portal-save-bar');
    const content = preview?.querySelector('.portal-preview-content');
    const artwork = document.getElementById('portalPreview');
    const artworkFrame = preview?.querySelector('.portal-preview-frame');
    if (!preview || !artwork || !artworkFrame) return;
    let frame = 0;
    const sync = () => {
      frame = 0;
      const top = Math.max(0,header?.getBoundingClientRect().bottom || 0) + 16;
      const bottom = saveBar?.classList.contains('portal-bottom-bar') ? Math.max(0,innerHeight-saveBar.getBoundingClientRect().top) : 0;
      preview.style.setProperty('--portal-preview-top',`${Math.ceil(top)}px`);
      const naturalHeight = artwork.offsetHeight;
      const surroundingHeight = preview.getBoundingClientRect().height-artworkFrame.getBoundingClientRect().height;
      const availableHeight = innerHeight-top-bottom-20;
      const scale = Math.min(1,Math.floor(Math.max(0,Math.floor(availableHeight-surroundingHeight))/Math.max(1,naturalHeight)*1000)/1000);
      // Keep guidance at its normal text size; only the miniature portal scales.
      // Long copy or very short screens use full page flow instead of clipping.
      const sticky = matchMedia('(min-width:1101px)').matches && scale >= .68;
      preview.classList.toggle('is-sticky',sticky);
      artwork.style.transform = sticky && scale < 1 ? `scale(${scale})` : '';
      artworkFrame.style.height = sticky ? `${naturalHeight*scale}px` : '';
      content?.removeAttribute('tabindex');
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(sync); };
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(schedule);
      [preview,artwork,header,saveBar].filter(Boolean).forEach(node => observer.observe(node));
    }
    window.addEventListener('resize',schedule,{passive:true});
    document.fonts?.ready.then(schedule);
    schedule();
  });
})();
