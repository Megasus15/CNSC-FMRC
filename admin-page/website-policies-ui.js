/* Admin-only presentation; policy wording, bindings and publication stay with the owner. */
(() => {
  'use strict';
  document.addEventListener('DOMContentLoaded', () => {
    if (!document.body.hasAttribute('data-portal-policy-dialogs')) return;
    const root = document.querySelector('.policy-settings-page');
    if (!root) return;
    const paths = {
      document:'<path d="M14 3H5v18h14V8Z"/><path d="M14 3v5h5M8 12h8M8 16h8"/>',
      edit:'<path d="M15 5 19 9M4 20l5-1L20 8a3 3 0 0 0-4-4L5 15Z"/>',
      publish:'<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>',
      preview:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>'
    };
    const decorate = (node,key,small=false) => {
      if (node.querySelector(':scope > [data-policy-ui-icon]')) return;
      const icon=document.createElement('span');icon.dataset.policyUiIcon='';icon.className=small?'policy-inline-icon':'policy-section-icon';icon.setAttribute('aria-hidden','true');
      icon.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[key]}</svg>`;node.prepend(icon);
    };
    const refresh = () => {
      root.querySelectorAll('h3,h4').forEach(node=>decorate(node,node.closest('.policy-publish-card')?'publish':node.matches('h3')&&node.closest('#policyDraftEditor')?'edit':'document'));
      root.querySelectorAll('summary').forEach(node=>decorate(node,'preview',true));
      root.querySelectorAll('.policy-customer-links a').forEach(node=>decorate(node,'document',true));
    };
    let frame=0;new MutationObserver(()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;refresh();});}).observe(root,{childList:true,subtree:true});refresh();
  });
})();
