/* Shared by About Us and Product Details. Owns motion, navigation and media
   lifecycle; callers own their content, visibility and image preview action. */
(() => {
  window.FMRCMediaCarousel = {
    mount(deck, items, config = {}) {
      deck._editorialCleanup?.();
      const host = deck.parentElement;
      host.classList.add('fmrc-gallery-media');
      host.querySelector('.editorial-gallery-controls')?.remove();
      deck.replaceChildren();
      deck.classList.add('editorial-gallery', 'fmrc-gallery');
      deck.classList.remove('is-loading', 'is-empty');
      deck.setAttribute('role', 'region');
      deck.setAttribute('aria-roledescription', 'carousel');
      deck.setAttribute('aria-label', config.label || 'Product gallery');
      deck.removeAttribute('aria-busy');
      const abort = new AbortController();
      const options = { signal: abort.signal };
      const reduced = matchMedia('(prefers-reduced-motion: reduce)');
      let current = Math.min(config.initialIndex || 0, Math.max(0, items.length - 1));
      let timer, loadTimer, visible = true, hovered = false, focused = false, gesture = null;
      let suppressClickUntil = 0, destroyed = false, playAttempt = 0, manualVideo = false, userPaused = false, internalPause = false;
      const cards = [], dots = [];
      const status = document.createElement('span');
      status.className = 'fmrc-gallery-status';
      status.setAttribute('role', 'status');
      status.hidden = true;
      const fallback = document.createElement('button');
      fallback.type = 'button';
      fallback.className = 'fmrc-gallery-play';
      fallback.textContent = 'Play video';
      fallback.hidden = true;
      items.forEach((item, i) => {
        const video = item.type === 'video';
        const card = document.createElement(video ? 'div' : 'button');
        if (!video) card.type = 'button';
        card.className = 'vm-deck__card' + (video ? ' fmrc-gallery-video' : '');
        card.setAttribute('aria-label', video ? `Product video ${i + 1} of ${items.length}` : `Open ${config.label || 'product'} image ${i + 1} of ${items.length} preview`);
        const media = document.createElement(video ? 'video' : 'img');
        if (video) {
          media.controls = true;
          media.playsInline = true;
          media.muted = true;
          media.defaultMuted = true;
          media.preload = 'none';
          if (config.poster) media.poster = config.poster;
          media.dataset.src = item.url;
          media.addEventListener('ended', () => arm(), options);
          media.addEventListener('play', () => { fallback.hidden = true; clearTimeout(timer); }, options);
          media.addEventListener('pause', () => { if (!internalPause && active() && !media.ended) userPaused = true; }, options);
        } else {
          media.alt = config.label || 'Product image';
          media.decoding = 'async';
          media.draggable = false;
          if (item.url) media.src = item.url;
          if (config.imageClass) media.className = config.imageClass;
          if (i === 0 && config.imageId) media.id = config.imageId;
          card.addEventListener('click', () => {
            if (!card.disabled) config.onImage?.(media, card);
          }, options);
        }
        for (const event of [video ? 'loadeddata' : 'load', 'error']) {
          media.addEventListener(event, () => { if (current === i) { settle(); if (event === 'error') arm(); } }, options);
        }
        card.append(media);
        deck.append(card);
        cards.push(card);
      });
      deck.append(status, fallback);

      const controls = document.createElement('div');
      controls.className = 'editorial-gallery-controls';
      if (cards.length > 1) {
        const overlay = document.createElement('div');
        overlay.className = 'editorial-gallery-overlay';
        for (const [direction, step, path] of [['previous', -1, 'm14.5 5-7 7 7 7'], ['next', 1, 'm9.5 5 7 7-7 7']]) {
          const arrow = document.createElement('button');
          arrow.type = 'button';
          arrow.className = 'editorial-gallery-arrow editorial-gallery-arrow--' + direction;
          arrow.setAttribute('aria-label', `${direction === 'next' ? 'Next' : 'Previous'} gallery item`);
          arrow.setAttribute('aria-controls', deck.id);
          arrow.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" /></svg>`;
          arrow.addEventListener('click', event => navigate(current + step, event), options);
          overlay.append(arrow);
        }
        deck.append(overlay);
        const group = document.createElement('span');
        group.className = 'editorial-gallery-dots';
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', 'Select gallery item');
        cards.forEach((card, i) => {
          const dot = document.createElement('button');
          dot.type = 'button';
          dot.className = 'editorial-gallery-dot';
          dot.dataset.galleryDot = String(i);
          dot.setAttribute('aria-label', `Show ${items[i].type === 'video' ? 'video' : 'image'} ${i + 1} of ${cards.length}`);
          dot.setAttribute('aria-controls', deck.id);
          dot.addEventListener('click', event => navigate(i, event), options);
          dots.push(dot);
          group.append(dot);
        });
        controls.append(group);
        deck.after(controls);
      }
      const active = () => !destroyed && !document.hidden && visible && (config.isActive?.() ?? !document.body.classList.contains('modal-open-state'));
      const canRotate = () => active() && !reduced.matches && !hovered && !focused && !gesture && cards.length > 1;
      const video = () => cards[current]?.querySelector('video');
      function settle() {
        clearTimeout(loadTimer);
        const media = cards[current]?.querySelector('img,video');
        const isVideo = media?.tagName === 'VIDEO';
        const failed = !media || (isVideo ? !!media.error : media.complete && !media.naturalWidth);
        const loading = media && !failed && (isVideo ? media.readyState < 2 : !media.complete);
        deck.classList.toggle('is-loading', !!loading);
        deck.classList.toggle('is-empty', !!failed);
        deck.setAttribute('aria-busy', String(!!loading));
        status.hidden = !loading && !failed;
        status.textContent = loading ? (isVideo ? 'Loading video…' : 'Loading image…') : (items.length ? 'This media is unavailable.' : 'No product image available.');
        if (cards[current]?.tagName === 'BUTTON') cards[current].disabled = !!failed || !!loading;
        if (failed) fallback.hidden = true;
        if (loading) loadTimer = setTimeout(() => {
          deck.classList.remove('is-loading');
          deck.setAttribute('aria-busy', 'false');
          status.hidden = false;
          status.textContent = 'Media is taking longer to load. Try another item.';
        }, 15000);
        config.onSettle?.(failed ? 'empty' : loading ? 'loading' : 'ready');
      }
      function pauseVideos(reset = false) {
        playAttempt++;
        internalPause = true;
        cards.forEach(card => {
          const media = card.querySelector('video');
          if (!media) return;
          media.pause();
          if (reset) { try { media.currentTime = 0; } catch {} }
        });
        // pause events are queued tasks, so keep the flag through their turn.
        setTimeout(() => { internalPause = false; }, 0);
      }
      function playVideo() {
        const media = video();
        if (!media || userPaused || !active() || (reduced.matches && !manualVideo)) return;
        if (!media.getAttribute('src')) {
          media.src = media.dataset.src;
          media.load();
          settle();
        }
        const attempt = ++playAttempt;
        media.play()?.catch(() => {
          if (attempt === playAttempt && active() && video() === media && !media.error) fallback.hidden = false;
        });
      }
      function arm() {
        clearTimeout(timer);
        deck.setAttribute('aria-live', canRotate() ? 'off' : 'polite');
        if (!active()) { pauseVideos(); return; }
        if (!canRotate()) return;
        if (video() && !video().ended && !video().error) return;
        timer = setTimeout(() => { if (canRotate()) show(current + 1); }, 6000);
      }
      function show(index, manual = false) {
        pauseVideos(true);
        current = cards.length ? (index + cards.length) % cards.length : 0;
        deck._editorialIndex = current;
        manualVideo = manual;
        userPaused = false;
        if (video()) video().muted = true;
        fallback.hidden = true;
        cards.forEach((card, i) => {
          card.dataset.current = String(i === current);
          card.setAttribute('aria-hidden', String(i !== current));
          card.inert = i !== current;
          card.tabIndex = i === current ? 0 : -1;
        });
        dots.forEach((dot, i) => {
          dot.classList.toggle('is-active', i === current);
          dot.setAttribute('aria-current', String(i === current));
        });
        playVideo();
        settle();
        arm();
      }
      function navigate(index, event) {
        show(index, true);
        if (event?.detail > 0) event.currentTarget.blur();
      }
      fallback.addEventListener('click', () => { manualVideo = true; userPaused = false; playVideo(); }, options);
      host.addEventListener('focusin', () => { focused = true; arm(); }, options);
      host.addEventListener('focusout', event => { if (!host.contains(event.relatedTarget)) { focused = false; arm(); } }, options);
      host.addEventListener('keydown', event => {
        if (event.target.closest('video') || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const onDot = event.target.closest('.editorial-gallery-dot');
        navigate(event.key === 'Home' ? 0 : event.key === 'End' ? cards.length - 1 : current + (event.key === 'ArrowLeft' ? -1 : 1));
        (onDot ? dots[current] : cards[current])?.focus({ preventScroll: true });
      }, options);
      deck.addEventListener('dragstart', event => { if (!event.target.closest('video')) event.preventDefault(); }, options);
      deck.addEventListener('click', event => {
        if (event.target.closest('.editorial-gallery-overlay,video,.fmrc-gallery-play')) return;
        if (event.detail && performance.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
      }, { ...options, capture: true });
      deck.addEventListener('pointerdown', event => {
        if (event.target.closest('.editorial-gallery-overlay,video,.fmrc-gallery-play') || event.isPrimary === false || event.button !== 0 || gesture) return;
        gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, axis: null };
        deck._editorialInteracting = true;
        suppressClickUntil = 0;
        arm();
      }, options);
      window.addEventListener('pointermove', event => {
        if (!gesture || gesture.id !== event.pointerId) return;
        const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
        if (!gesture.axis && Math.max(Math.abs(dx), Math.abs(dy)) >= 8) {
          gesture.axis = Math.abs(dx) > Math.abs(dy) * 1.15 ? 'x' : 'y';
          if (gesture.axis === 'x') deck.setPointerCapture?.(event.pointerId);
        }
        if (gesture.axis === 'x' && event.cancelable) event.preventDefault();
      }, options);
      function finish(event) {
        if (!gesture || gesture.id !== event.pointerId) return;
        const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
        const cancelled = event.type === 'pointercancel';
        const horizontal = gesture.axis !== 'y' && Math.abs(dx) > Math.abs(dy) * 1.15;
        if (cancelled || Math.max(Math.abs(dx), Math.abs(dy)) >= 8) suppressClickUntil = performance.now() + 600;
        gesture = null;
        deck._editorialInteracting = false;
        if (deck.hasPointerCapture?.(event.pointerId)) deck.releasePointerCapture(event.pointerId);
        if (!cancelled && horizontal && Math.abs(dx) >= 44) navigate(current + (dx < 0 ? 1 : -1));
        else arm();
      }
      window.addEventListener('pointerup', finish, options);
      window.addEventListener('pointercancel', finish, options);
      window.addEventListener('blur', () => {
        if (gesture && deck.hasPointerCapture?.(gesture.id)) deck.releasePointerCapture(gesture.id);
        gesture = null;
        deck._editorialInteracting = false;
        arm();
      }, options);
      host.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') { hovered = true; arm(); } }, options);
      host.addEventListener('pointerleave', event => { if (event.pointerType !== 'touch') { hovered = false; arm(); } }, options);
      const refresh = () => { if (active() && video()?.paused && !video().ended) playVideo(); arm(); };
      reduced.addEventListener('change', refresh, options);
      document.addEventListener('visibilitychange', refresh, options);
      const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; refresh(); });
      observer.observe(deck);
      let wasActive = active();
      const modalObserver = new MutationObserver(() => {
        const nextActive = active();
        if (wasActive === nextActive) return;
        wasActive = nextActive;
        refresh();
      });
      modalObserver.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
      deck._editorialCleanup = () => {
        destroyed = true;
        clearTimeout(timer); clearTimeout(loadTimer);
        pauseVideos(true);
        observer.disconnect(); modalObserver.disconnect(); abort.abort(); controls.remove();
        cards.forEach(card => { const media = card.querySelector('video'); if (media) { media.removeAttribute('src'); media.load(); } });
      };
      show(current);
      return { destroy: deck._editorialCleanup, refresh, show: index => show(index, true) };
    },
  };
})();
