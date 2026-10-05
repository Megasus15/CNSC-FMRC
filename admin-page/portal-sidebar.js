/* One account-aware sidebar for every authenticated Admin and Staff page. */
(() => {
  'use strict';
  function init() {
    const sidebar = document.querySelector('.sidebar'), prefs = window.AdminPreferences;
    if (!sidebar || !prefs || sidebar.querySelector('.portal-sidebar-edge')) return;
    const root = document.documentElement, header = sidebar.querySelector('.sidebar-header');
    const logo = header?.querySelector('.logo'), title = header?.querySelector('h2');
    const defaultLogo = logo?.getAttribute('src') || '../images/FMRC Brand Logo.png';
    const desktop = window.matchMedia('(min-width:1025px)');
    const tablet = window.matchMedia('(min-width:721px) and (max-width:1024px)');
    const toggle = document.querySelector('.admin-sidebar-toggle');
    const headerLeft = document.querySelector('.top-header .header-left');
    function syncToggle() {
      if (!toggle || !headerLeft || !header) return;
      const host = tablet.matches ? headerLeft : header;
      if (toggle.parentElement !== host) host.prepend(toggle);
    }
    const owner = () => { const info = window.AdminSession?.getUserInfo(); return String((info?.data || info)?.id || '')+':'+window.AdminSession?.getToken(); };
    let drag = null, lastExpanded = 270, sidebarOwner = owner();
    for (const menu of [sidebar.querySelector('.sidebar-nav'),document.getElementById('profilePopup')]) {
      const account = menu?.querySelector('a[href="my-account.html"]'), settings = menu?.querySelector('a[href="settings.html"]');
      if (account && settings && (settings.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING)) settings.before(account);
    }
    const edge = document.createElement('div');
    edge.className = 'portal-sidebar-edge'; edge.tabIndex = 0;
    edge.setAttribute('role','separator'); edge.setAttribute('aria-orientation','vertical');
    edge.setAttribute('aria-label','Resize sidebar navigation');
    edge.setAttribute('aria-valuemin','76'); edge.setAttribute('aria-valuemax','270');
    edge.title = 'Drag to resize. Click to collapse or expand. Use arrow keys to adjust.';
    if (!sidebar.id) sidebar.id = 'portalSidebar';
    edge.setAttribute('aria-controls',sidebar.id); sidebar.appendChild(edge);
    function preview(value) {
      const width = Math.round(Math.max(76,Math.min(270,Number(value) || 270)));
      root.style.setProperty('--portal-sidebar-width',width+'px');
      root.dataset.sidebarMode = width < 180 ? 'rail' : 'expanded';
      edge.setAttribute('aria-valuenow',String(width));
      edge.setAttribute('aria-valuetext',width < 180 ? 'Collapsed navigation' : 'Sidebar width '+width+' pixels');
      return width;
    }
    function commit(value) {
      const width = value < 180 ? 76 : preview(value);
      if (width >= 180) lastExpanded = width;
      prefs.set({sidebarWidth:width});
    }
    function sync() {
      const state = prefs.get();
      if (sidebarOwner !== owner()) { sidebarOwner = owner(); lastExpanded = 270; if (drag) finish({pointerId:drag.id},true); }
      if (!drag) preview(state.sidebarWidth);
      if (state.sidebarWidth >= 180) lastExpanded = state.sidebarWidth;
      if (logo) { const src = state.sidebarLogo || defaultLogo; if (logo.getAttribute('src') !== src) logo.src = src; logo.alt = state.sidebarLabel+' logo'; }
      if (title) { title.textContent = state.sidebarLabel; title.title = state.sidebarLabel; }
      sidebar.querySelectorAll('.nav-link,.sidebar-footer .logout-btn').forEach(link => {
        const label = link.querySelector('.nav-label')?.textContent?.trim() || link.textContent.trim();
        if (label) { link.title = label; link.setAttribute('aria-label',label); }
      });
      edge.tabIndex = desktop.matches ? 0 : -1;
    }
    edge.addEventListener('pointerdown',event => {
      if (!desktop.matches || event.button !== 0) return;
      event.preventDefault(); edge.focus(); edge.setPointerCapture(event.pointerId);
      drag = {id:event.pointerId,x:event.clientX,width:prefs.get().sidebarWidth,current:prefs.get().sidebarWidth,moved:false};
      root.dataset.sidebarResizing = 'true';
    });
    edge.addEventListener('pointermove',event => {
      if (!drag || event.pointerId !== drag.id) return;
      const delta = event.clientX-drag.x;
      if (Math.abs(delta)>3) drag.moved = true;
      drag.current = preview(drag.width+delta);
    });
    function finish(event,cancelled=false) {
      if (!drag || event.pointerId !== drag.id) return;
      const previous = drag; drag = null; delete root.dataset.sidebarResizing;
      if (edge.hasPointerCapture(previous.id)) edge.releasePointerCapture(previous.id);
      if (cancelled || !desktop.matches) { sync(); return; }
      commit(previous.moved ? previous.current : previous.width < 180 ? lastExpanded : 76);
    }
    edge.addEventListener('pointerup',event=>finish(event));
    edge.addEventListener('pointercancel',event=>finish(event,true));
    edge.addEventListener('lostpointercapture',event=>finish(event,true));
    edge.addEventListener('keydown',event => {
      if (!desktop.matches) return;
      const width = prefs.get().sidebarWidth;
      if (event.key === 'Escape' && drag) { event.preventDefault(); finish({pointerId:drag.id},true); return; }
      let next;
      if (['Enter',' '].includes(event.key)) next = width < 180 ? lastExpanded : 76;
      if (event.key === 'Home') next = 76;
      if (event.key === 'End') next = 270;
      if (event.key === 'ArrowLeft') next = width <= 180 ? 76 : Math.max(180,width-(event.shiftKey?25:10));
      if (event.key === 'ArrowRight') next = width < 180 ? 180 : Math.min(270,width+(event.shiftKey?25:10));
      if (next !== undefined) { event.preventDefault(); commit(next); }
    });
    sidebar.addEventListener('click',event => {
      const toggle = event.target.closest('.dropdown-toggle');
      if (!toggle || !desktop.matches || root.dataset.sidebarMode !== 'rail') return;
      event.preventDefault(); event.stopPropagation();
      toggle.closest('.has-dropdown')?.classList.add('open');
      toggle.setAttribute('aria-expanded','true'); commit(lastExpanded);
    },true);
    desktop.addEventListener('change',()=>{ if (drag) finish({pointerId:drag.id},true); sync(); });
    tablet.addEventListener('change',syncToggle);
    window.addEventListener('admin:session-updated',()=>{ if (drag) finish({pointerId:drag.id},true); sync(); });
    window.addEventListener('adminPreferencesChanged',sync);
    window.AdminSidebar = {preview,reset:()=>commit(270)};
    if (logo) logo.addEventListener('error',()=>{ if (logo.getAttribute('src') !== defaultLogo) logo.src = defaultLogo; });
    syncToggle(); sync();
  }
  if (document.readyState === 'complete') init();
  else document.addEventListener('DOMContentLoaded',init,{once:true});
})();
