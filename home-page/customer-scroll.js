// Shared by all five public Customer pages, with no sign-in dependency.
(() => {
  const init = () => {
    const footer = document.querySelector('.site-footer');
    if (!footer || document.getElementById('customerBackToTop')) return;
    const button = document.createElement('button');
    button.id = 'customerBackToTop';
    button.className = 'customer-back-to-top';
    button.type = 'button';
    button.setAttribute('aria-label', 'Back to top');
    button.setAttribute('aria-hidden', 'true');
    button.tabIndex = -1;
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5m-7 7 7-7 7 7"/></svg>';
    document.body.appendChild(button);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let previousY = Math.max(0, window.scrollY);
    let frame = 0;
    let animation = 0;
    let returning = false;
    let scrollingUp = false;
    const show = (visible) => {
      button.classList.toggle('is-visible', visible);
      button.tabIndex = visible ? 0 : -1;
      button.setAttribute('aria-hidden', String(!visible));
    };
    const update = () => {
      frame = 0;
      const y = Math.max(0, window.scrollY);
      const height = document.documentElement.scrollHeight;
      const bottom = height - (y + window.innerHeight);
      if (y < previousY - 1) scrollingUp = true;
      else if (y > previousY + 1) scrollingUp = false;
      show(!returning && !scrollingUp && y > 80 && bottom <= 24 && footer.getBoundingClientRect().top < window.innerHeight);
      previousY = y;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const cancel = () => { cancelAnimationFrame(animation); returning = false; };
    button.addEventListener('click', () => {
      cancel();
      show(false);
      returning = true;
      const startY = window.scrollY;
      const start = performance.now();
      const finish = () => {
        returning = false;
        const target = document.querySelector('main, h1, .hero-section');
        if (target) {
          const hadTabindex = target.hasAttribute('tabindex');
          if (!hadTabindex) target.setAttribute('tabindex', '-1');
          target.focus({ preventScroll: true });
          if (!hadTabindex) target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
        }
      };
      const step = (now) => {
        const progress = reduced.matches ? 1 : Math.min(1, (now - start) / 320);
        window.scrollTo({ top: startY * Math.pow(1 - progress, 3), behavior: 'instant' });
        if (progress < 1) animation = requestAnimationFrame(step);
        else finish();
      };
      animation = requestAnimationFrame(step);
    });
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    window.addEventListener('wheel', cancel, { passive: true });
    window.addEventListener('touchstart', cancel, { passive: true });
    window.addEventListener('keydown', (event) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) cancel();
    });
    new ResizeObserver(schedule).observe(document.body);
    update();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
