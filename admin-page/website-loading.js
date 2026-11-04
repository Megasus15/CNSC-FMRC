/* Section-shaped loading states shared by every Website Management editor. */
(() => {
  "use strict";
  if (window.AdminWebsiteLoading) return;

  // Every editor compares its own saved snapshot and retains ownership of
  // loading, validation and pending-upload eligibility.
  const drafts = new Set();
  const guards = new Set();
  let leaving = false;
  window.AdminWebsiteDraft = {
    readFields(root) {
      return [...(root?.querySelectorAll("input:not([type=file]),textarea,select") || [])]
        .map((input, index) => [input.id || input.name || index, input.type === "checkbox" || input.type === "radio" ? input.checked : input.value]);
    },
    create({ button, read, ready = () => true, busy = () => false, page = true }) {
      const target = typeof button === "string" ? document.getElementById(button) : button;
      let baseline = null;
      const snapshot = () => JSON.stringify(read());
      const draft = {
        page,
        busy,
        isDirty() {
          try { return baseline !== null && snapshot() !== baseline; }
          catch { return false; }
        },
        refresh() {
          if (target) target.disabled = !ready() || busy() || !draft.isDirty();
        },
        capture() { baseline = snapshot(); draft.refresh(); },
      };
      drafts.add(draft);
      draft.refresh();
      return draft;
    },
    register(guard) { guards.add(guard); return () => guards.delete(guard); },
    isDirty() { return [...drafts].some(draft => draft.page && (draft.isDirty() || draft.busy())) || [...guards].some(guard => guard.isDirty() || guard.busy?.()); },
    confirmDiscard(action, options = {}) {
      if (!window.AdminWebsiteDraft.isDirty()) return action();
      return new Promise(resolve => {
        const discard = () => { if (options.leaving) leaving = true; resolve(action()); };
        const message = options.message || 'Discard your unsaved changes and load the saved content?';
        if (window.showAdminConfirmPopup) window.showAdminConfirmPopup(message, {
          title: 'Discard changes?', confirmText: 'Discard changes', cancelText: 'Keep editing',
          onConfirm: discard, onCancel: () => resolve(false),
        });
        else if (window.confirm?.(message)) discard();
        else resolve(false);
      });
    },
    // Send only changed model fields. Negative IDs belong to this page draft.
    changes(saved, current, fields) {
      const upsert = [];
      for (const row of current) {
        const original = saved.find(item => item.id === row.id);
        const values = Object.fromEntries(fields.filter(key => key in row && (!original || JSON.stringify(row[key]) !== JSON.stringify(original[key]))).map(key => [key, row[key]]));
        if (Object.keys(values).length) upsert.push(original ? { id: row.id, ...values } : values);
      }
      return { upsert, delete: saved.filter(row => !current.some(item => item.id === row.id)).map(row => row.id) };
    },
    refresh() { drafts.forEach((draft) => draft.refresh()); },
  };
  document.addEventListener("input", () => window.AdminWebsiteDraft.refresh());
  document.addEventListener("change", () => window.AdminWebsiteDraft.refresh());
  document.addEventListener("click", () => queueMicrotask(() => window.AdminWebsiteDraft.refresh()));
  window.addEventListener?.('beforeunload', event => {
    if (leaving || !window.AdminWebsiteDraft.isDirty()) return;
    event.preventDefault(); event.returnValue = '';
  });
  document.addEventListener('click', event => {
    const link = event.target?.closest?.('a[href]');
    if (!link || link.target === '_blank' || link.hasAttribute('download') || event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || (event.button && event.button !== 0)) return;
    const href = link.getAttribute('href');
    if (!href || /^(#|javascript:|mailto:|tel:)/i.test(href) || !window.AdminWebsiteDraft.isDirty()) return;
    event.preventDefault(); event.stopImmediatePropagation();
    window.AdminWebsiteDraft.confirmDiscard(() => window.location.assign(link.href), { leaving: true, message: 'Leave this page and discard your unsaved changes?' });
  }, true);

  // A saved video can be tens of MB. Editors need its URL, not its bytes in
  // every settings read. Keep the timeout active while response bodies load.
  const nativeFetch = window.fetch.bind(window);
  const requestSignal = (caller, milliseconds) => {
    const timeout = typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(milliseconds)
      : (() => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(new DOMException("Request timed out.", "TimeoutError")), milliseconds);
        return controller.signal;
      })();
    if (!caller) return timeout;
    if (typeof AbortSignal.any === "function") return AbortSignal.any([caller, timeout]);
    const controller = new AbortController();
    const abort = (event) => {
      controller.abort(event.target.reason);
      caller.removeEventListener("abort", abort);
      timeout.removeEventListener("abort", abort);
    };
    if (caller.aborted) controller.abort(caller.reason);
    else {
      caller.addEventListener("abort", abort, { once: true });
      timeout.addEventListener("abort", abort, { once: true });
    }
    return controller.signal;
  };
  window.fetch = (input, options = {}) => {
    const request = typeof Request !== "undefined" && input instanceof Request ? input : null;
    const url = new URL(request ? request.url : input, document.baseURI);
    if (!/\/api\//.test(url.pathname)) return nativeFetch(input, options);
    const method = String(options.method || request?.method || "GET").toUpperCase();
    if (method === "GET" && /\/site-settings\/?$/.test(url.pathname) && !url.searchParams.has("media")) {
      url.searchParams.set("media", "references");
      input = request ? new Request(url.href, request) : url.href;
    }
    return nativeFetch(input, {
      ...options,
      signal: requestSignal(options.signal || request?.signal, method === "GET" || method === "HEAD" ? 30000 : 120000),
    });
  };

  const selector = ".module-content :is(.page-toolbar,.wm-section,.panel,.payment-settings-card,.portal-tabs,.portal-editor-panel),.wm-save-bar";
  const entries = new Map();
  let pending = 0;
  let releaseTimer = 0;
  let frame = 0;
  let started = 0;
  let status;
  const observed = new ResizeObserver(() => schedulePaint());
  const mutations = new MutationObserver(() => schedulePaint());

  const paint = () => {
    frame = 0;
    entries.forEach(({ overlay }, section) => {
      const box = section.getBoundingClientRect();
      const fragment = document.createDocumentFragment();
      const quickLinks = section.querySelector("#quickLinksContainer");
      const nodes = section.querySelectorAll("h2,h3,h4,p,label,input:not([type=hidden]),textarea,select,button,img,iframe,canvas,.wm-img-placeholder,.portal-layout-option,.et-item,.service-category-row");
      nodes.forEach((node) => {
        if (overlay.contains(node)) return;
        if (quickLinks && node.tagName === "BUTTON") return;
        const rect = node.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const bar = document.createElement("span");
        bar.className = "admin-global-skeleton-bar";
        const text = /^(H[2-4]|P|LABEL)$/.test(node.tagName);
        const height = text ? Math.min(rect.height, node.tagName === "P" ? 12 : 16) : rect.height;
        const width = text ? Math.min(rect.width, Math.max(64, (node.textContent || "").trim().length * 7)) : rect.width;
        Object.assign(bar.style, {
          left: `${rect.left - box.left - section.clientLeft}px`,
          top: `${rect.top - box.top - section.clientTop + (text ? (rect.height - height) / 2 : 0)}px`,
          width: `${width}px`, height: `${height}px`,
        });
        fragment.append(bar);
      });
      if (section.querySelector("#servicesGrid") || section.id === "servicesGrid") {
        const cards = document.createElement("div");
        cards.className = "website-skeleton-cards";
        cards.innerHTML = Array.from({ length: 3 }, () => '<div><span class="admin-global-skeleton-bar website-skeleton-image"></span><span class="admin-global-skeleton-bar"></span><span class="admin-global-skeleton-bar"></span></div>').join("");
        fragment.replaceChildren(cards);
      } else if (quickLinks) {
        const links = document.createElement("div");
        links.className = "website-skeleton-links";
        links.innerHTML = Array.from({ length: 3 }, () => '<div><span class="admin-global-skeleton-bar"></span><span class="admin-global-skeleton-bar"></span><span class="admin-global-skeleton-bar"></span></div>').join("");
        fragment.append(links);
      } else if (fragment.childElementCount < 2) {
        const fallback = document.createElement("div");
        fallback.className = "website-skeleton-fallback";
        fallback.innerHTML = '<span class="admin-global-skeleton-bar"></span><span class="admin-global-skeleton-bar"></span><span class="admin-global-skeleton-bar"></span>';
        fragment.append(fallback);
      }
      // Do not observe our own placeholder writes.
      mutations.disconnect();
      overlay.replaceChildren(fragment);
    });
    if (pending && document.querySelector(".module-content")) {
      mutations.observe(document.querySelector(".module-content"), { childList: true, subtree: true });
    }
  };

  function schedulePaint() {
    if (!frame && entries.size) frame = requestAnimationFrame(paint);
  }

  const show = (scope) => {
    if (!entries.size) started = performance.now();
    const sections = typeof scope === "string" ? [...document.querySelectorAll(scope)] : scope ? [scope] : [...document.querySelectorAll(selector)];
    // Keep nested sections as one surface, preserving the editor's real grid.
    sections.filter((section) => !sections.some((other) => other !== section && other.contains(section))).forEach((section) => {
      if (entries.has(section) || [...entries.keys()].some((existing) => existing.contains(section))) return;
      const overlay = document.createElement("div");
      overlay.className = "website-section-skeleton";
      overlay.setAttribute("aria-hidden", "true");
      entries.set(section, {
        overlay, inert: section.inert, hadInert: section.hasAttribute("inert"),
        busy: section.getAttribute("aria-busy"), hidden: section.getAttribute("aria-hidden"),
      });
      section.classList.add("website-section-loading");
      section.inert = true;
      section.setAttribute("aria-busy", "true");
      section.setAttribute("aria-hidden", "true");
      section.append(overlay);
      observed.observe(section);
    });
    if (!status?.isConnected) {
      status = document.createElement("span");
      status.className = "admin-loading-sr-only";
      status.setAttribute("role", "status");
      status.textContent = "Loading website settings";
      document.querySelector(".module-content")?.append(status);
    }
    schedulePaint();
  };

  const hide = () => {
    observed.disconnect();
    mutations.disconnect();
    cancelAnimationFrame(frame);
    frame = 0;
    entries.forEach((state, section) => {
      state.overlay.remove();
      section.classList.remove("website-section-loading");
      section.inert = state.inert;
      if (!state.hadInert) section.removeAttribute("inert");
      for (const [attribute, value] of [["aria-busy", state.busy], ["aria-hidden", state.hidden]]) {
        if (value === null) section.removeAttribute(attribute);
        else section.setAttribute(attribute, value);
      }
    });
    entries.clear();
    status?.remove();
  };

  const begin = (scope = selector) => {
    clearTimeout(releaseTimer);
    pending++;
    show(scope);
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      if (--pending === 0) {
        // Let the caller finish rendering; avoid flashing on fast cached reads.
        releaseTimer = setTimeout(hide, Math.max(80, 200 - (performance.now() - started)));
      }
    };
  };

  window.AdminWebsiteLoading = {
    begin,
    async during(work, scope) {
      const finish = begin(scope);
      try { return await work(); }
      finally { finish(); }
    },
  };
  document.addEventListener("DOMContentLoaded", () => {
    const finish = begin();
    setTimeout(finish, 0);
  }, { once: true });
})();
