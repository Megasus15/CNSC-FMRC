/* Decorate native selects without replacing their picker or event handlers. */
(() => {
  'use strict';
  const nativeOpen = CSS.supports?.('selector(select:open)');
  const enhance = root => {
    const selects = [...(root.querySelectorAll?.('select') || [])];
    if (root.matches?.('select')) selects.unshift(root);
    for (const select of selects) {
      if (select.hidden || select.multiple || select.size > 1 || select.closest('.combobox-wrap,.custom-select-wrapper') || select.parentElement?.classList.contains('admin-select-wrap')) continue;
      if (getComputedStyle(select).display === 'none') continue;
      const wrap = document.createElement('span');
      wrap.className = 'admin-select-wrap';
      // Keep the select's existing width/flex/grid placement on its wrapper.
      const style = getComputedStyle(select);
      wrap.style.width = select.style.width || 'auto';
      const declaredWidth = select.computedStyleMap?.().get('width')?.toString();
      if (declaredWidth && declaredWidth !== 'auto') wrap.style.width = declaredWidth;
      if (select.classList.contains('wm-select') || select.classList.contains('input-field')) wrap.style.width = '100%';
      if (style.flexGrow !== '0') wrap.style.flex = style.flex;
      if (style.gridColumn !== 'auto') wrap.style.gridColumn = style.gridColumn;
      select.before(wrap); wrap.append(select);
      const arrow = document.createElement('span');
      arrow.className = 'admin-select-chevron'; arrow.setAttribute('aria-hidden', 'true'); wrap.append(arrow);
      if (!nativeOpen) {
        const close = () => wrap.classList.remove('is-interacting');
        select.addEventListener('pointerdown', () => wrap.classList.toggle('is-interacting'));
        select.addEventListener('keydown', event => { if (['ArrowDown', 'ArrowUp', ' ', 'Enter'].includes(event.key)) wrap.classList.add('is-interacting'); if (['Escape','Tab'].includes(event.key)) close(); });
        select.addEventListener('change', close); select.addEventListener('blur', close);
      }
    }
  };
  const start = () => {
    enhance(document);
    new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) if (node.nodeType === 1) enhance(node);
        if (record.type === 'attributes') enhance(record.target);
      }
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'disabled', 'class', 'style'] });
    document.addEventListener('focusin', event => { if (event.target.matches?.('select')) enhance(event.target); });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
