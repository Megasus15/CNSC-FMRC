/* Presentation only: keep the template list reachable alongside long edits. */
(() => {
  'use strict';
  document.addEventListener('DOMContentLoaded', () => {
    if(!document.body.hasAttribute('data-portal-email-dialogs'))return;
    const card=document.querySelector('.et-template-card'),header=document.querySelector('.top-header'),save=document.querySelector('.et-save-bar');
    if(!card)return;
    let frame=0;
    const sync=()=>{
      frame=0;
      const top=Math.max(0,header?.getBoundingClientRect().bottom||0)+16;
      const bottom=save&&getComputedStyle(save).position==='fixed'?save.getBoundingClientRect().height+16:16;
      const height=Math.max(0,innerHeight-top-bottom);
      card.style.setProperty('--et-template-top',`${Math.ceil(top)}px`);
      card.style.setProperty('--et-template-height',`${Math.floor(height)}px`);
      // Stacked and very short viewports keep normal page flow, with no clipped controls.
      card.classList.toggle('is-sticky',matchMedia('(min-width:1101px)').matches&&height>=300);
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(sync);};
    const observer=new ResizeObserver(schedule);
    [header,save,card.querySelector('.wm-section-header'),card.querySelector('.field-stack')].filter(Boolean).forEach(n=>observer.observe(n));
    window.addEventListener('resize',schedule,{passive:true});
    window.visualViewport?.addEventListener('resize',schedule,{passive:true});
    document.fonts?.ready.then(schedule);
    schedule();
  });
})();
