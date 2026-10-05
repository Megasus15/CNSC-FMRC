/* Section-shaped loading states shared by every Website Management editor. */
(() => {
  "use strict";
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
