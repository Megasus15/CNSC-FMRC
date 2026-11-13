/* Opt-in detail dialogs, including markup loaded later by Staff page modules. */
(() => {
  'use strict';
  const roots = () => [...document.querySelectorAll('[data-portal-detail-dialog]')];
  const layerSelector = '.modal-overlay.show, .admin-system-popup.show, .admin-session-warning, dialog[open]';
  const tabbable = 'button:not(:disabled),a[href],input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';
  let session = null;
  const visible = node => node?.isConnected && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
  const layers = () => [...document.querySelectorAll(layerSelector)].filter(visible)
    .sort((a, b) => (parseInt(getComputedStyle(a).zIndex) || 0) - (parseInt(getComputedStyle(b).zIndex) || 0));
  const controls = layer => [...layer.querySelectorAll(tabbable)].filter(node => visible(node) && !node.closest('[inert]') && node.getAttribute('aria-disabled') !== 'true');
  const capture = (node, properties) => properties.map(name => [name, node.style.getPropertyValue(name), node.style.getPropertyPriority(name)]);
  const restore = (node, properties) => properties.forEach(([name, value, priority]) => value ? node.style.setProperty(name, value, priority) : node.style.removeProperty(name));
  const focus = node => { if (!node) return; if (!node.matches(tabbable) && !node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1'); node.focus({preventScroll: true}); };
  function begin(root, options = {}) {
    if (session) return;
    const html = document.documentElement, body = document.body;
    const gap = Math.max(0, innerWidth - html.clientWidth);
    session = {root, opener: options.trigger || document.activeElement, returnSelector: options.returnSelector, x: scrollX, y: scrollY,
      html: capture(html, ['overflow', 'overscroll-behavior']), body: capture(body, ['position', 'top', 'left', 'width', 'overflow', 'padding-right']),
      inert: new Map(), fixed: new Map(), lastFocus: new Map(), top: null, handoff: null};
    html.style.overflow = 'hidden'; html.style.overscrollBehavior = 'none';
    body.style.paddingRight = `${parseFloat(getComputedStyle(body).paddingRight) + gap}px`;
    body.style.position = 'fixed'; body.style.top = `-${session.y}px`; body.style.left = `-${session.x}px`; body.style.width = '100%'; body.style.overflow = 'hidden';
    if (gap) document.querySelectorAll('.top-header').forEach(header => {
      if (getComputedStyle(header).position !== 'fixed') return;
      session.fixed.set(header, capture(header, ['right']));
      const right = getComputedStyle(header).right;
      if (right !== 'auto') header.style.right = `calc(${right} + ${gap}px)`;
    });
  }
  function finish() {
    const previous = session;
    if (!previous) return;
    session = null;
    previous.inert.forEach((value, node) => { node.inert = value; });
    previous.fixed.forEach((properties, node) => restore(node, properties));
    restore(document.documentElement, previous.html); restore(document.body, previous.body);
    window.scrollTo({left: previous.x, top: previous.y, behavior: 'instant'});
    const target = visible(previous.opener) ? previous.opener : previous.returnSelector ? document.querySelector(previous.returnSelector) : null;
    focus(target || document.querySelector('.main-content h1'));
  }
  function sync() {
    const dialogs = roots();
    const openRoot = dialogs.find(root => root.classList.contains('show'));
    dialogs.forEach(root => root.setAttribute('aria-hidden', String(!root.classList.contains('show'))));
    if (!session && openRoot) begin(openRoot);
    if (!session) return;
    const openLayers = layers();
    if (!openRoot && !openLayers.length) { finish(); return; }
    const top = openLayers.at(-1);
    if (!top) { finish(); return; }
    const inertNodes = new Set([...document.querySelectorAll('.dashboard-container'), ...openLayers.filter(layer => layer !== top)]);
    session.inert.forEach((value, node) => { if (!inertNodes.has(node)) { node.inert = value; session.inert.delete(node); } });
    inertNodes.forEach(node => { if (!session.inert.has(node)) session.inert.set(node, node.inert); node.inert = true; });
    if (session.top !== top) {
      session.top = top;
      if (!top.contains(document.activeElement) || document.activeElement.closest('[inert]')) {
        const previousFocus = session.lastFocus.get(top);
        focus(visible(previousFocus) ? previousFocus : top.querySelector('[data-portal-detail-heading]') || controls(top)[0] || top.querySelector('.modal-title'));
      }
    }
  }
  const observer = new MutationObserver(records => {
    if (records.some(record => record.type === 'childList' || record.target.matches('.modal-overlay,.admin-system-popup,.admin-session-warning,dialog'))) sync();
  });
  observer.observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'open', 'hidden']});
  document.addEventListener('focusin', event => {
    if (!session?.top) return;
    if (session.top.contains(event.target)) session.lastFocus.set(session.top, event.target);
    else focus(controls(session.top)[0] || session.top.querySelector('[data-portal-detail-heading],.modal-title'));
  });
  document.addEventListener('keydown', event => {
    if (!session?.top) return;
    const top = session.top;
    if (event.key === 'Escape' && top === session.root && top.classList.contains('show')) { event.preventDefault(); event.stopPropagation(); top.classList.remove('show'); sync(); return; }
    if (event.key === 'Tab') {
      const nodes = controls(top), first = nodes[0], last = nodes.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !nodes.includes(document.activeElement))) { event.preventDefault(); focus(last); }
      else if (!event.shiftKey && (document.activeElement === last || !nodes.includes(document.activeElement))) { event.preventDefault(); focus(first); }
    }
    if (top === session.root && !event.target.closest('input,textarea,select,button,a,[contenteditable="true"]')) {
      const body = top.querySelector('.portal-detail-dialog__body');
      const delta = {ArrowDown: 40, ArrowUp: -40, PageDown: body.clientHeight * .85, PageUp: -body.clientHeight * .85, ' ': body.clientHeight * (event.shiftKey ? -.85 : .85)}[event.key];
      if (delta !== undefined) { event.preventDefault(); body.scrollTop += delta; }
      else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); body.scrollTop = event.key === 'Home' ? 0 : body.scrollHeight; }
    }
  }, true);
  const preventBackgroundScroll = event => {
    if (!session?.top) return;
    const scrollBody = event.target.closest('.modal-body-scroll,.portal-detail-dialog__body');
    if (!scrollBody || !session.top.contains(scrollBody)) event.preventDefault();
  };
  document.addEventListener('wheel', preventBackgroundScroll, {capture: true, passive: false});
  document.addEventListener('touchmove', preventBackgroundScroll, {capture: true, passive: false});
  document.addEventListener('click', event => {
    const close = event.target.closest('[data-portal-detail-close]');
    const root = close?.closest('[data-portal-detail-dialog]');
    if (root) { root.classList.remove('show'); sync(); }
  });
  window.PortalDetailDialog = {
    open(root, options = {}) {
      if (!root?.matches('[data-portal-detail-dialog]')) return;
      const wasOpen = root.classList.contains('show');
      begin(root, options); root.classList.add('show'); sync();
      if (!wasOpen) root.querySelector('.portal-detail-dialog__body').scrollTop = 0;
    },
    handoff(root, target) { if (session?.root === root) session.handoff = target; },
  };
  sync();
})();
