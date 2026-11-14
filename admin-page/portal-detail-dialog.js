/* Opt-in detail dialogs, including markup loaded later by Staff page modules. */
(() => {
  'use strict';
  const roots = () => [...document.querySelectorAll('[data-portal-detail-dialog]')];
  const layerSelector = '[data-portal-detail-dialog], .modal-overlay.show, .admin-system-popup.show, .admin-session-warning:not([hidden]), dialog[open]';
  const tabbable = 'button:not(:disabled),a[href],input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';
  const closeHandlers = new WeakMap();
  let session = null;
  const visible = node => node?.isConnected && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
  const isOpen = node => node.dataset.portalDetailVisibility === 'hidden' ? !node.hidden && visible(node) : node.classList.contains('show') && visible(node);
  const layers = () => [...document.querySelectorAll(layerSelector)].filter(node => node.matches('[data-portal-detail-dialog]') ? isOpen(node) : visible(node))
    .sort((a, b) => (parseInt(getComputedStyle(a).zIndex) || 0) - (parseInt(getComputedStyle(b).zIndex) || 0));
  const controls = layer => [...layer.querySelectorAll(tabbable)].filter(node => visible(node) && !node.closest('[inert]') && node.getAttribute('aria-disabled') !== 'true');
  const capture = (node, properties) => properties.map(name => [name, node.style.getPropertyValue(name), node.style.getPropertyPriority(name)]);
  const restore = (node, properties) => properties.forEach(([name, value, priority]) => value ? node.style.setProperty(name, value, priority) : node.style.removeProperty(name));
  const focus = node => { if (!node) return; if (!node.matches(tabbable) && !node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1'); node.focus({preventScroll: true}); };
  const requestClose = root => {
    const handler = closeHandlers.get(root);
    if (handler) handler();
    else if (!root.hasAttribute('data-portal-detail-guarded')) root.classList.remove('show');
    sync();
  };
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
    const openRoot = dialogs.find(isOpen);
    dialogs.forEach(root => root.setAttribute('aria-hidden', String(!isOpen(root))));
    if (!session && openRoot) begin(openRoot);
    if (!session) return;
    const openLayers = layers();
    if (!openRoot && !openLayers.length) { finish(); return; }
    const top = openLayers.at(-1);
    if (!top) { finish(); return; }
    const inertNodes = new Set(openLayers.filter(layer => layer !== top && !layer.contains(top)));
    // Inert siblings along the active dialog's ancestry, including header tools.
    for (let branch = top; branch && branch !== document.body; branch = branch.parentElement) {
      [...branch.parentElement.children].forEach(node => { if (node !== branch && !node.matches('script,style,link')) inertNodes.add(node); });
    }
    session.inert.forEach((value, node) => { if (!inertNodes.has(node)) { node.inert = value; session.inert.delete(node); } });
    inertNodes.forEach(node => { if (!session.inert.has(node)) session.inert.set(node, node.inert); node.inert = true; });
    if (session.top !== top) {
      session.top = top;
      if (!top.contains(document.activeElement) || document.activeElement.closest('[inert]')) {
        const previousFocus = session.lastFocus.get(top);
        focus(visible(previousFocus) ? previousFocus : top.querySelector('[data-portal-detail-initial-focus]') || top.querySelector('[data-portal-detail-heading]') || controls(top)[0] || top.querySelector('.modal-title'));
      }
    }
  }
  const observer = new MutationObserver(records => {
    if (records.some(record => record.type === 'childList' || record.target.matches('[data-portal-detail-dialog],.modal-overlay,.admin-system-popup,.admin-session-warning,dialog'))) sync();
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
    if (top.hasAttribute('data-portal-detail-keyboard-owner')) return;
    if (event.key === 'Escape' && top.matches('[data-portal-detail-dialog]')) {
      // Let a form's expanded picker consume Escape before closing its owner.
      if (event.target.closest('[data-portal-detail-escape-owner]')) return;
      event.preventDefault(); event.stopImmediatePropagation(); requestClose(top); return;
    }
    if (event.key === 'Tab') {
      const nodes = controls(top), first = nodes[0], last = nodes.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !nodes.includes(document.activeElement))) { event.preventDefault(); focus(last); }
      else if (!event.shiftKey && (document.activeElement === last || !nodes.includes(document.activeElement))) { event.preventDefault(); focus(first); }
    }
    if (top.matches('[data-portal-detail-dialog]') && !event.target.closest('input,textarea,select,button,a,[contenteditable="true"]')) {
      const body = top.querySelector('.portal-detail-dialog__body');
      if (!body) return;
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
    if (root) requestClose(root);
  });
  window.PortalDetailDialog = {
    registerClose(root, handler) { if (root && typeof handler === 'function') closeHandlers.set(root, handler); },
    adopt(root, {close, visibility = 'class'} = {}) {
      if (!root) return;
      root.setAttribute('data-portal-detail-dialog', '');
      root.setAttribute('data-portal-detail-guarded', '');
      root.dataset.portalDetailVisibility = visibility;
      if (typeof close === 'function') closeHandlers.set(root, close);
      sync();
    },
    open(root, options = {}) {
      if (!root?.matches('[data-portal-detail-dialog]')) return;
      const wasOpen = isOpen(root);
      begin(root, options);
      if (root.dataset.portalDetailVisibility === 'hidden') root.hidden = false;
      else root.classList.add('show');
      sync();
      if (!wasOpen) root.querySelector('.portal-detail-dialog__body')?.scrollTo({top: 0, behavior: 'instant'});
    },
    handoff(root, target) { if (session?.root === root) session.handoff = target; },
  };
  sync();
})();

/* Opt-in edit-save state. Owners supply their existing form snapshot and guards.
   Loading this helper never changes buttons on pages that have not adopted it. */
(() => {
  'use strict';
  const bindings = new WeakMap();
  // Snapshots are normalized fields/arrays. Keep immutable strings by reference
  // so a large image data URL is not serialized again on every keystroke.
  const copy = value => Array.isArray(value) ? value.map(copy) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)])) : value;
  const equal = (left, right) => {
    if (Object.is(left, right)) return true;
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false;
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every(key => Object.prototype.hasOwnProperty.call(right, key) && equal(left[key], right[key]));
  };
  window.AdminEditSave = {
    bind({root, button, getSnapshot, isEditing = () => true, isBlocked = () => false}) {
      if (!root || !button || typeof getSnapshot !== 'function') return null;
      bindings.get(button)?.destroy();
      let baseline, captured = false;
      const originalTitle = button.getAttribute('title');
      const isDirty = () => captured && !equal(getSnapshot(), baseline);
      const canSave = () => !isBlocked() && (!isEditing() || isDirty());
      const sync = () => {
        const blocked = Boolean(isBlocked()), unchanged = isEditing() && !isDirty();
        button.disabled = blocked || unchanged;
        button.dataset.editSaveState = blocked ? 'pending' : unchanged ? 'unchanged' : 'ready';
        if (unchanged && !blocked) button.title = 'Make changes to enable saving.';
        else if (originalTitle === null) button.removeAttribute('title');
        else button.title = originalTitle;
      };
      const observer = new MutationObserver(sync);
      observer.observe(root, {childList: true, subtree: true});
      ['input', 'change', 'click'].forEach(event => root.addEventListener(event, sync));
      const binding = {
        capture() { baseline = copy(getSnapshot()); captured = true; sync(); },
        clear() { baseline = undefined; captured = false; sync(); },
        sync, isDirty, canSave,
        destroy() {
          observer.disconnect();
          ['input', 'change', 'click'].forEach(event => root.removeEventListener(event, sync));
          bindings.delete(button);
        },
      };
      bindings.set(button, binding);
      sync();
      return binding;
    },
  };
})();
