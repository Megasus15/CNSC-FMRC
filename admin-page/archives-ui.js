/* Shared presentation for Admin/Staff Archives; keep the owner's search binding. */
(() => {
  'use strict';
  document.addEventListener('DOMContentLoaded', () => {
    if(!document.body.hasAttribute('data-portal-archive-dialogs'))return;
    const search=document.querySelector('.archive-search-bar');
    const title=document.querySelector('.archives-page-toolbar .toolbar-title');
    if(title){const icon=document.createElement('i'),copy=document.createElement('div');icon.className='fa-solid fa-box-archive archive-heading-icon';icon.setAttribute('aria-hidden','true');copy.className='archive-title-copy';copy.append(...title.childNodes);title.append(icon,copy);}
    document.querySelectorAll('.archive-section .panel-header h3').forEach(heading=>{
      const icon=heading.querySelector('.archive-badge i');
      if(icon){icon.classList.add('archive-heading-icon');icon.setAttribute('aria-hidden','true');heading.prepend(icon);}
    });
    const placeSearch=()=>{const header=document.querySelector('.archive-section.active .panel-header');if(header&&search&&search.parentElement!==header)header.append(search);};
    document.querySelectorAll('.archive-tab-btn').forEach(button=>button.addEventListener('click',placeSearch));
    placeSearch();
  });
})();
