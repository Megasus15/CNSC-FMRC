/* Keep visible action order and keyboard order together as phone cards reflow. */
(() => {
  'use strict';
  const phone = matchMedia('(min-width: 320px) and (max-width: 480px)');
  const originalLabels = new WeakMap();
  function syncActions() {
    document.querySelectorAll(':is(.home-editorial-page, .services-page-body) .service-card .service-card-footer').forEach(footer => {
      const booking = footer.querySelector('.ap-consult-link');
      const details = footer.querySelector('.open-modal-btn');
      if (!booking || !details) return;
      let label = booking.querySelector('.service-booking-label');
      if (!label) {
        const text = [...booking.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
        if (!text) return;
        label = document.createElement('span');
        label.className = 'service-booking-label';
        label.textContent = text.textContent.trim();
        originalLabels.set(booking, label.textContent);
        text.replaceWith(label);
        const service = booking.closest('.service-card')?.querySelector('.card-title')?.textContent.trim();
        booking.setAttribute('aria-label', service ? `Book a consultation for ${service}` : 'Book a consultation');
        booking.title = 'Book a consultation';
      }
      label.textContent = phone.matches ? 'Book Now' : originalLabels.get(booking);
      const active = document.activeElement;
      if (phone.matches && details.nextElementSibling !== booking) details.after(booking);
      else if (!phone.matches && details.previousElementSibling !== booking) details.before(booking);
      if (active === booking && document.activeElement !== active) active.focus({preventScroll: true});
    });
  }
  document.addEventListener('DOMContentLoaded', syncActions);
  document.addEventListener('fmrc-page-content-applied', syncActions);
  phone.addEventListener('change', syncActions);
  if (document.readyState !== 'loading') syncActions();
})();
