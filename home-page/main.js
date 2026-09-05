const getCustomerSession = () => {
  const token = localStorage.getItem("customer_token");
  const userInfoRaw = localStorage.getItem("customer_info");

  let userInfo = null;
  try {
    if (userInfoRaw) userInfo = JSON.parse(userInfoRaw);
  } catch {
    userInfo = null;
  }

  return {
    token,
    userInfo,
    isAuthenticated: Boolean(token && userInfo),
  };
};

const getCustomerToken = () => {
  const raw = localStorage.getItem("customer_token") || "";
  return raw.replace(/^Bearer\s+/i, "").trim();
};

const ORDER_STAGE_FLOW = ["to_pay", "to_ship", "to_receive", "completed"];
// "All" tab urgency ranking: what is arriving now, then what is being shipped,
// then what still needs paying, and finally everything already finished.
const ALL_TAB_STAGE_PRIORITY = {
  to_receive: 0,
  to_ship: 1,
  to_pay: 2,
  completed: 3,
};
const ALL_TAB_UNKNOWN_STAGE_RANK = 4;
const ALL_TAB_REJECTED_RANK = 5;
const BUY_AGAIN_INTENT_KEY = "fmrc_buy_again_intent";
const BUY_AGAIN_INTENT_MAX_AGE_MS = 60000;
const PHILIPPINES_TIME_ZONE = "Asia/Manila";
const API_REQUEST_TIMEOUT_MS = 8000;
const CUSTOMER_ORDERS_REQUEST_TIMEOUT_MS = 7000;
const ORDERS_REALTIME_SIGNAL_KEY = "fmrc_orders_updated_at";
const ORDERS_REALTIME_CHANNEL = "fmrc-orders-realtime";
const CUSTOMER_ORDERS_FALLBACK_SYNC_MS = 3000;
const CUSTOMER_ORDERS_MIN_REFRESH_GAP_MS = 1200;
const CUSTOMER_ORDER_IMAGE_MAX_CONCURRENT = 2;
const CUSTOMER_ORDERS_CACHE_PREFIX = "fmrc_customer_orders_v2:";
const CUSTOMER_ORDER_IMAGE_PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 240 240'%3E%3Crect width='240' height='240' fill='%23fff7f7'/%3E%3C/svg%3E";
const CART_STORAGE_KEY = "fmrc_cart_items";
const CART_STORAGE_SIGNAL_KEY = "fmrc_cart_updated_at";

let ordersRealtimeChannel = null;

const getOrdersRealtimeChannel = () => {
  if (typeof window.BroadcastChannel !== "function") return null;
  if (!ordersRealtimeChannel) {
    ordersRealtimeChannel = new window.BroadcastChannel(
      ORDERS_REALTIME_CHANNEL,
    );
  }
  return ordersRealtimeChannel;
};

const resolveApiBaseUrl = () => {
  const configured =
    window.APP_API_BASE_URL ||
    document
      .querySelector('meta[name="api-base-url"]')
      ?.getAttribute("content") ||
    "";

  if (configured.trim()) {
    return configured.replace(/\/+$/, "");
  }

  const protocol = String(window.location.protocol || "").toLowerCase();
  const hostname = String(window.location.hostname || "").toLowerCase();
  const origin = String(window.location.origin || "");
  const port = String(window.location.port || "");

  if (!/^https?:$/.test(protocol) || !hostname) {
    return "http://127.0.0.1:8000/api";
  }

  const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1";
  const isPort8000 = port === "8000";
  const isStandardWebPort = port === "" || port === "80" || port === "443";

  if (isPort8000 || (!isLocalHost && isStandardWebPort)) {
    return `${origin.replace(/\/+$/, "")}/api`;
  }

  if (isLocalHost) {
    return `${protocol}//${hostname}:8000/api`;
  }

  return `${origin.replace(/\/+$/, "")}/api`;
};

const API_BASE_URL = resolveApiBaseUrl();

/**
 * "This page's site content is mine." Set here, at parse time, because the only
 * other reader — customer-announcements.js — has to know before it builds its
 * own request batch, which it does from a DOMContentLoaded handler. Both files
 * are deferred on all four customer pages, in either order, so a top-level flag
 * is the one thing guaranteed to be visible in time.
 *
 * Why it exists: that file used to fall back to its own /site-settings request
 * whenever window.FMRC_PROMO_THEME was not published *yet* — which, on a cold
 * load, is always, because this file only publishes it after its own response
 * arrives. So every customer page fetched the same payload twice, and that
 * payload is the heaviest read on the site (it carries the base64 logos). One of
 * the two was pure waste on a queue that the page's other requests were already
 * waiting in.
 */
window.FMRC_SITE_CONTENT_OWNER = true;

const emitCustomerOrdersUpdated = (detail = {}) => {
  const payload = {
    source: "customer-portal",
    timestamp: Date.now(),
    ...detail,
  };

  window.dispatchEvent(
    new CustomEvent("fmrc:orders-updated", { detail: payload }),
  );

  try {
    localStorage.setItem(ORDERS_REALTIME_SIGNAL_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage write issues.
  }

  const realtimeChannel = getOrdersRealtimeChannel();
  realtimeChannel?.postMessage(payload);
};

// â”€â”€ Customer System Popup (global â€” accessible from all page IIFEs) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Every customer dialog shares the "ux-dlg" shell: a maroon header band with a
// yellow badge + eyebrow + white title, a white body, and a cream footer strip
// of pill buttons. Tones only swap the badge glyph and the eyebrow wording.
const CUSTOMER_POPUP_TONES = {
  success: { icon: "fa-solid fa-check", eyebrow: "Success" },
  error: { icon: "fa-solid fa-circle-exclamation", eyebrow: "Request failed" },
  warning: { icon: "fa-solid fa-triangle-exclamation", eyebrow: "Action needed" },
  confirm: { icon: "fa-solid fa-circle-question", eyebrow: "Confirmation" },
  info: { icon: "fa-solid fa-circle-info", eyebrow: "Notice" },
};

const resolveCustomerPopupTone = (title, isConfirm, options = {}) => {
  const requested = String(options.tone || "").toLowerCase();
  if (CUSTOMER_POPUP_TONES[requested]) {
    return { key: requested, ...CUSTOMER_POPUP_TONES[requested] };
  }
  const label = String(title || "").toLowerCase();
  let key = "info";
  if (isConfirm || /^confirm|confirmation|are you sure|discard/.test(label)) {
    key = "confirm";
  } else if (
    /success|sent|submitted|received|placed|thank|complete|saved|updated|added|approved|cancell?ed|removed/.test(
      label,
    )
  ) {
    key = "success";
  } else if (/fail|error|unable|denied|rejected|problem|wrong/.test(label)) {
    key = "error";
  } else if (
    /valid|required|limit|locked|unavailable|missing|select|stock|expired|warning|notice|restrict/.test(
      label,
    )
  ) {
    key = "warning";
  }
  return { key, ...CUSTOMER_POPUP_TONES[key] };
};

const ensureCustomerSystemPopup = () => {
  let popup = document.getElementById("customerSystemPopup");
  if (popup) return popup;

  popup = document.createElement("div");
  popup.id = "customerSystemPopup";
  popup.className = "admin-system-popup ux-dlg";
  popup.innerHTML = `
    <div class="admin-system-popup__backdrop ux-dlg__backdrop"></div>
    <div class="admin-system-popup__card ux-dlg__card" role="dialog" aria-modal="true" aria-labelledby="customerSystemPopupTitle">
      <div class="ux-dlg__head">
        <span class="ux-dlg__badge" id="customerSystemPopupBadge" aria-hidden="true"><i class="fa-solid fa-circle-info"></i></span>
        <p class="ux-dlg__eyebrow" id="customerSystemPopupEyebrow">Notice</p>
        <h3 id="customerSystemPopupTitle" class="admin-system-popup__title ux-dlg__title">System Message</h3>
      </div>
      <div class="ux-dlg__body">
        <p id="customerSystemPopupMessage" class="admin-system-popup__message ux-dlg__text"></p>
      </div>
      <div class="admin-system-popup__actions ux-dlg__foot">
        <button id="customerSystemPopupCancel" type="button" class="btn-admin btn-secondary ux-dlg__btn ux-dlg__btn--ghost">Cancel</button>
        <button id="customerSystemPopupOk" type="button" class="btn-admin ux-dlg__btn ux-dlg__btn--primary">Okay</button>
      </div>
    </div>
  `;

  document.body.appendChild(popup);
  return popup;
};

const showCustomerPopup = (message, options = {}) =>
  new Promise((resolve) => {
    const popup = ensureCustomerSystemPopup();
    const card = popup.querySelector(".admin-system-popup__card");
    const titleEl = popup.querySelector("#customerSystemPopupTitle");
    const msgEl = popup.querySelector("#customerSystemPopupMessage");
    const badgeEl = popup.querySelector("#customerSystemPopupBadge");
    const eyebrowEl = popup.querySelector("#customerSystemPopupEyebrow");
    const okBtn = popup.querySelector("#customerSystemPopupOk");
    const cancelBtn = popup.querySelector("#customerSystemPopupCancel");
    const actions = popup.querySelector(".admin-system-popup__actions");
    const backdrop = popup.querySelector(".admin-system-popup__backdrop");

    const resolvedTitle = options.title || "System Message";
    if (titleEl) titleEl.textContent = resolvedTitle;
    if (msgEl) msgEl.textContent = String(message || "Done.");

    const isConfirm = Boolean(options.isConfirm);
    if (actions) {
      actions.classList.toggle("is-confirm", isConfirm);
    }

    const tone = resolveCustomerPopupTone(resolvedTitle, isConfirm, options);
    if (card) card.dataset.tone = tone.key;
    if (badgeEl) badgeEl.innerHTML = `<i class="${tone.icon}"></i>`;
    if (eyebrowEl) eyebrowEl.textContent = options.eyebrow || tone.eyebrow;

    const closePopup = (accepted) => {
      popup.classList.remove("show");
      resolve(Boolean(accepted));
    };

    if (okBtn) {
      okBtn.textContent = options.okText || (isConfirm ? "Confirm" : "Okay");
      okBtn.onclick = (ev) => {
        ev?.stopPropagation();
        closePopup(true);
      };
    }

    if (cancelBtn) {
      cancelBtn.textContent = options.cancelText || "Cancel";
      cancelBtn.style.display = isConfirm ? "inline-flex" : "none";
      cancelBtn.onclick = (ev) => {
        ev?.stopPropagation();
        closePopup(false);
      };
    }

    // This is a modal, so the scrim is inert: the customer dismisses it with the
    // Okay/Confirm/Cancel buttons inside the card, never by clicking outside. That
    // also removes the old race where the click that opened the popup could close
    // it again on the way back up the tree.
    popup.classList.add("show");

    if (backdrop) {
      backdrop.onclick = null;
    }

    if (isConfirm && cancelBtn) {
      cancelBtn.focus();
    } else if (okBtn) {
      okBtn.focus();
    }
  });

document.addEventListener("DOMContentLoaded", () => {
  let navLinks = document.querySelectorAll(".nav-link");
  const sections = document.querySelectorAll("main, section");
  const customerSession = getCustomerSession();
  const isGuestUser = !customerSession.isAuthenticated;

  // Mobile Sidebar Navigation (shared across all pages)
  const siteHeader = document.querySelector(".site-header");
  const mainNav = siteHeader?.querySelector(".main-nav");
  const logoContainer = siteHeader?.querySelector(".logo-container");
  const headerActions = siteHeader?.querySelector(".header-right-actions");

  if (
    siteHeader &&
    mainNav &&
    logoContainer &&
    !document.querySelector(".mobile-menu-toggle")
  ) {
    const menuToggle = document.createElement("button");
    menuToggle.type = "button";
    menuToggle.className = "mobile-menu-toggle";
    menuToggle.id = "mobileMenuToggle";
    menuToggle.setAttribute("aria-label", "Open navigation menu");
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.innerHTML = "<span></span><span></span><span></span>";

    siteHeader.insertBefore(menuToggle, logoContainer);

    const sidebarBackdrop = document.createElement("div");
    sidebarBackdrop.className = "sidebar-backdrop";

    const mobileSidebar = document.createElement("aside");
    mobileSidebar.className = "mobile-sidebar";
    mobileSidebar.setAttribute("aria-hidden", "true");

    const sidebarHeader = document.createElement("div");
    sidebarHeader.className = "sidebar-header";

    const sidebarCloseBtn = document.createElement("button");
    sidebarCloseBtn.type = "button";
    sidebarCloseBtn.className = "sidebar-close-btn";
    sidebarCloseBtn.setAttribute("aria-label", "Close sidebar menu");
    sidebarCloseBtn.innerHTML = "&times;";

    const sidebarBrand = document.createElement("a");
    sidebarBrand.className = "sidebar-logo-container";
    sidebarBrand.href =
      logoContainer.getAttribute("href") || "/home-page/main.html";
    sidebarBrand.innerHTML = logoContainer.innerHTML;

    sidebarHeader.append(sidebarCloseBtn, sidebarBrand);

    const sidebarNav = document.createElement("nav");
    sidebarNav.className = "sidebar-nav";
    const navListClone = mainNav.querySelector("ul")?.cloneNode(true);
    if (navListClone) {
      sidebarNav.appendChild(navListClone);
    }

    mobileSidebar.append(sidebarHeader, sidebarNav);
    document.body.append(sidebarBackdrop, mobileSidebar);

    const openSidebar = () => {
      mobileSidebar.classList.add("open");
      sidebarBackdrop.classList.add("show");
      menuToggle.classList.add("is-open");
      menuToggle.setAttribute("aria-expanded", "true");
      mobileSidebar.setAttribute("aria-hidden", "false");
      document.body.classList.add("sidebar-open");
    };

    const closeSidebar = () => {
      mobileSidebar.classList.remove("open");
      sidebarBackdrop.classList.remove("show");
      menuToggle.classList.remove("is-open");
      menuToggle.setAttribute("aria-expanded", "false");
      mobileSidebar.setAttribute("aria-hidden", "true");
      document.body.classList.remove("sidebar-open");
    };

    menuToggle.addEventListener("click", () => {
      if (mobileSidebar.classList.contains("open")) {
        closeSidebar();
      } else {
        openSidebar();
      }
    });

    sidebarCloseBtn.addEventListener("click", closeSidebar);
    sidebarBackdrop.addEventListener("click", closeSidebar);

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && mobileSidebar.classList.contains("open")) {
        closeSidebar();
      }
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 900 && mobileSidebar.classList.contains("open")) {
        closeSidebar();
      }
    });

    mobileSidebar.querySelectorAll(".nav-link").forEach((link) => {
      link.addEventListener("click", (event) => {
        const href = link.getAttribute("href") || "";

        if (href.startsWith("#")) {
          event.preventDefault();
          navLinks.forEach((navLink) => navLink.classList.remove("active"));
          document
            .querySelectorAll(`.nav-link[href="${href}"]`)
            .forEach((navLink) => navLink.classList.add("active"));
          closeSidebar();
          const target = document.querySelector(href);
          if (target) target.scrollIntoView({ behavior: "smooth" });
          return;
        }

        closeSidebar();
      });
    });

    navLinks = document.querySelectorAll(".nav-link");
  }

  const ensureGuestAccessModal = () => {
    let modal = document.getElementById("guestAccessModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "guestAccessModal";
      modal.className = "guest-access-modal ux-dlg";
      modal.innerHTML = `
        <div class="guest-access-card ux-dlg__card" role="dialog" aria-modal="true" aria-labelledby="guestAccessTitle">
          <div class="ux-dlg__head">
            <button type="button" class="guest-access-close ux-dlg__close" id="closeGuestAccessModal" aria-label="Close guest access prompt">&times;</button>
            <span class="ux-dlg__badge" aria-hidden="true"><i class="fa-solid fa-user-lock"></i></span>
            <p class="ux-dlg__eyebrow">Guest access</p>
            <h2 class="guest-access-title ux-dlg__title" id="guestAccessTitle">Welcome, Guest</h2>
          </div>
          <div class="ux-dlg__body">
            <p class="guest-access-copy ux-dlg__text" id="guestAccessCopy">Please log in or create an account to continue.</p>
          </div>
          <div class="guest-access-actions ux-dlg__foot">
            <a href="../customer-auth/auth.html#login" class="guest-access-btn login ux-dlg__btn ux-dlg__btn--primary">Login</a>
            <a href="../customer-auth/auth.html#signup" class="guest-access-btn signup ux-dlg__btn ux-dlg__btn--ghost">Sign Up</a>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal
        .querySelector("#closeGuestAccessModal")
        ?.addEventListener("click", () => {
          modal.classList.remove("show");
          document.body.style.overflow = "";
        });

      // No scrim-click dismissal: this is a modal, so the close X and the
      // Login / Sign Up buttons are the only ways out. Escape is kept as the
      // keyboard equivalent of the close X so the card is never a dead end.
      document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        if (!modal.classList.contains("show")) return;
        modal.classList.remove("show");
        document.body.style.overflow = "";
      });
    }
    return modal;
  };

  const openGuestAccessModal = (actionLabel) => {
    const modal = ensureGuestAccessModal();
    const copy = modal.querySelector("#guestAccessCopy");
    if (copy) {
      copy.textContent = `Please log in or create an account to ${actionLabel}.`;
    }
    modal.classList.add("show");
    document.body.style.overflow = "hidden";
  };

  const requireCustomerAuth = (actionLabel) => {
    if (!isGuestUser) return true;
    openGuestAccessModal(actionLabel);
    return false;
  };

  const fetchWithTimeout = async (
    url,
    options = {},
    timeoutMs = API_REQUEST_TIMEOUT_MS,
  ) => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    const { signal: _ignoredSignal, ...restOptions } = options;

    try {
      return await fetch(url, {
        ...restOptions,
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(
          "Request timed out. Please check your connection and try again.",
        );
      }

      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  // â”€â”€ Dedicated Order Success Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Opens the #orderSuccessModal (in product.html) with the given order number.
  // Returns a Promise that resolves ONLY when the customer clicks the OK button.
  // Falls back to showCustomerPopup on pages that don't have the element.
  const openOrderSuccessModal = (orderNoDisplay) =>
    new Promise((resolve) => {
      const modal = document.getElementById("orderSuccessModal");
      const numEl = document.getElementById("orderSuccessNumber");
      const okBtn = document.getElementById("orderSuccessOkBtn");

      // Fallback: page doesn't have the dedicated modal
      if (!modal || !okBtn) {
        void showCustomerPopup(
          `Order placed successfully${orderNoDisplay ? ` (${orderNoDisplay})` : ""}!`,
          { title: "Success", allowBackdropClose: false },
        ).then(resolve);
        return;
      }

      // Populate the order number
      if (numEl) {
        numEl.textContent = orderNoDisplay || "—";
      }

      // Show the modal using the shared appointment-success overlay states
      modal.classList.add("active");
      modal.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";

      // Single-fire OK handler â€” cleans itself up
      const handleOk = () => {
        okBtn.removeEventListener("click", handleOk);
        modal.classList.remove("active");
        modal.setAttribute("aria-hidden", "true");
        document.body.style.overflow = "";
        resolve();
      };

      okBtn.addEventListener("click", handleOk);
    });

  // Disable sticky header when any modal/overlay/form is open
  const headerBlockingSelectors = [
    ".modal-overlay.show-modal",
    ".shop-modal-overlay.show-modal",
    ".image-lightbox-overlay.show-lightbox",
    ".about-video-modal.show-video-modal",
    ".apt-overlay.show-modal",
    ".apt-nested-modal.show-modal",
    ".success-modal-overlay.active",
    "#appointmentFlow.show-modal",
    "#checkoutModal.show-modal",
    "#addressSelectionModal.show-modal",
    "#editInfoModal.show-modal",
    "#addInfoModal.show-modal",
    "#cartModal.show-modal",
    "#serviceModal.show-modal",
    "#productInfoModal.show-modal",
    "#customerOrdersModal.show",
  ];

  const syncHeaderStickyState = () => {
    const hasOpenLayer = headerBlockingSelectors.some((selector) =>
      document.querySelector(selector),
    );
    document.body.classList.toggle("modal-open-state", hasOpenLayer);
  };

  syncHeaderStickyState();

  const modalStateObserver = new MutationObserver(() => {
    syncHeaderStickyState();
  });

  modalStateObserver.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style"],
  });

  const observerOptions = {
    root: null,
    rootMargin: "-40% 0px -40% 0px",
    threshold: 0,
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const id = entry.target.getAttribute("id");
        if (id) {
          const navSectionId = id === "services-preview" ? "about" : id;
          const activeLinks = document.querySelectorAll(
            `.nav-link[href*="#${navSectionId}"]`,
          );

          // Some dynamically revealed sections (for example the Products
          // promotion spotlight) are not navigation destinations. Do not let
          // those sections clear the page's existing active nav indicator.
          if (!activeLinks.length) return;

          navLinks.forEach((link) => link.classList.remove("active"));
          activeLinks.forEach((link) => link.classList.add("active"));
        }
      }
    });
  }, observerOptions);

  sections.forEach((section) => {
    if (section.id) {
      observer.observe(section);
    }
  });

  // Landing page reveal animation (home -> footer)
  // `.about-video-holder` rather than `.about-content-right`: that column also
  // holds `.about-video-modal` (position: fixed), and a transformed ancestor
  // would make the full-screen video modal size to the column instead of the
  // viewport.
  // `.scroll-indicator` is deliberately not in this list: its own `bounce`
  // animation owns `transform` forever, so the reveal lift could never be seen
  // on it, and registering it only meant two systems writing the same property
  // and a `will-change` that the settle handler could never usefully release.
  const revealTargets = document.querySelectorAll(
    ".hero-content-left, .hero-content-right, .about-content-left, .about-video-holder, .vision-content-left, .vision-content-right, .mission-content-left, .mission-content-right, #services-preview .section-title, #services-preview .carousel-wrapper, #services-preview .view-all-container, .products-toolbar, .services-carousel-section .carousel-wrapper, .shop-section .shop-card, .contact-info-card, .contact-form-card",
  );

  revealTargets.forEach((element) => element.classList.add("reveal-on-scroll"));

  // One block at a time. A phone shows a whole stacked section at once, so the
  // observer used to hand `show-reveal` to every child of that section in the
  // same frame and they all rose together. Sorting each batch by its on-screen
  // top and spacing `--reveal-delay` plays them in the order the eye reads
  // them, which also fixes pairs that CSS reorders (the vision photo sits below
  // its text on phones although it comes first in the DOM).
  const REVEAL_STEP_MS = 90;
  const REVEAL_MAX_STEPS = 5;

  // Presentational only: drops `will-change` once the lift has finished so a
  // dozen sections are not each holding a compositor layer for the whole visit.
  // Not `{ once: true }` — `transitionend` bubbles, so the first transition to
  // finish anywhere inside the block (a button, the video poster) would spend
  // the one-shot listener on an event the guard below discards, and the block's
  // own lift would never be settled.
  const settleReveal = (element) => {
    const onRevealEnd = (event) => {
      if (event.target !== element || event.propertyName !== "transform") {
        return;
      }
      element.removeEventListener("transitionend", onRevealEnd);
      element.classList.add("reveal-settled");
      element.style.removeProperty("--reveal-delay");
    };

    element.addEventListener("transitionend", onRevealEnd);
  };

  const revealObserver = new IntersectionObserver(
    (entries, activeObserver) => {
      entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        .forEach((entry, index) => {
          const step = Math.min(index, REVEAL_MAX_STEPS);
          entry.target.style.setProperty(
            "--reveal-delay",
            `${step * REVEAL_STEP_MS}ms`,
          );
          settleReveal(entry.target);
          entry.target.classList.add("show-reveal");
          activeObserver.unobserve(entry.target);
        });
    },
    {
      threshold: 0.14,
      rootMargin: "0px 0px -12% 0px",
    },
  );

  revealTargets.forEach((element) => revealObserver.observe(element));

  // About video holder interactions
  const aboutVideoHolder = document.getElementById("aboutVideoHolder");
  const aboutPreviewVideo = document.getElementById("aboutPreviewVideo");
  const aboutVideoToggle = document.getElementById("aboutVideoToggle");
  const aboutVideoModal = document.getElementById("aboutVideoModal");
  const aboutVideoClose = document.getElementById("aboutVideoClose");
  const aboutFullVideo = document.getElementById("aboutFullVideo");

  if (
    aboutVideoHolder &&
    aboutPreviewVideo &&
    aboutVideoToggle &&
    aboutVideoModal &&
    aboutVideoClose &&
    aboutFullVideo
  ) {
    document.body.appendChild(aboutVideoModal);

    const syncPreviewIcon = () => {
      const isPaused = aboutPreviewVideo.paused;
      aboutVideoToggle.classList.toggle("is-paused", isPaused);
      aboutVideoToggle.classList.toggle("is-playing", !isPaused);
      aboutVideoToggle.setAttribute(
        "aria-label",
        isPaused ? "Play preview video" : "Pause preview video",
      );
    };

    aboutVideoToggle.addEventListener("click", (event) => {
      event.stopPropagation();
      if (aboutPreviewVideo.paused) {
        aboutPreviewVideo.play().catch(() => {});
      } else {
        aboutPreviewVideo.pause();
      }
    });

    // Both elements point at the same 1080p file, so leaving the preview
    // running behind the modal made the phone decode the clip twice at once.
    // The preview only resumes if it was actually playing when the modal opened.
    let previewWasPlaying = false;

    const closeAboutVideoModal = () => {
      aboutVideoModal.classList.remove("show-video-modal");
      aboutFullVideo.pause();
      document.body.style.overflow = "";
      if (previewWasPlaying) {
        aboutPreviewVideo.play().catch(() => {});
      }
    };

    aboutVideoHolder.addEventListener("click", () => {
      previewWasPlaying = !aboutPreviewVideo.paused;
      aboutVideoModal.classList.add("show-video-modal");
      aboutFullVideo.currentTime = aboutPreviewVideo.currentTime || 0;
      aboutPreviewVideo.pause();
      aboutFullVideo.play().catch(() => {});
      document.body.style.overflow = "hidden";
    });

    aboutVideoClose.addEventListener("click", (event) => {
      event.stopPropagation();
      closeAboutVideoModal();
    });

    aboutVideoModal.addEventListener("click", (event) => {
      if (event.target === aboutVideoModal) {
        closeAboutVideoModal();
      }
    });

    aboutPreviewVideo.addEventListener("play", syncPreviewIcon);
    aboutPreviewVideo.addEventListener("pause", syncPreviewIcon);
    aboutPreviewVideo.addEventListener("ended", syncPreviewIcon);
    syncPreviewIcon();
  }

  // Modal Logic
  const modal = document.getElementById("serviceModal");
  const modalTitle = document.getElementById("modalTitle");
  const modalImage = document.getElementById("modalImage");
  const modalImageHolder = document.querySelector(
    "#serviceModal .service-modal-image-trigger",
  );
  const modalDesc = document.querySelector("#serviceModal .modal-desc");
  const featureChips = document.querySelector("#serviceModal .feature-chips");
  const modalList1 = document.querySelector(
    "#serviceModal .modal-columns .modal-col:first-child .modal-list",
  );
  const modalList2 = document.querySelector(
    "#serviceModal .modal-columns .modal-col:last-child .modal-list",
  );
  const modalSub1 = document.querySelector(
    "#serviceModal .modal-columns .modal-col:first-child .modal-subtitle",
  );
  const modalSub2 = document.querySelector(
    "#serviceModal .modal-columns .modal-col:last-child .modal-subtitle",
  );

  function escHtmlModal(str) {
    const d = document.createElement("div");
    d.textContent = str || "";
    return d.innerHTML;
  }

  // Service image lightbox: mirrors the product-image preview interaction.
  const serviceImageLightboxModal = document.getElementById(
    "serviceImageLightboxModal",
  );
  const serviceLightboxImage = document.getElementById("serviceLightboxImage");
  const serviceLightboxCaption = document.getElementById(
    "serviceLightboxCaption",
  );
  const closeServiceLightboxBtn = document.getElementById(
    "closeServiceLightboxBtn",
  );

  const openServiceImageLightbox = (src, title) => {
    if (!src || !serviceImageLightboxModal || !serviceLightboxImage) return;
    serviceLightboxImage.src = src;
    serviceLightboxImage.alt = title
      ? `${title} large preview`
      : "Service large preview";
    if (serviceLightboxCaption) serviceLightboxCaption.textContent = title || "";
    serviceImageLightboxModal.classList.add("show-modal");
    closeServiceLightboxBtn?.focus();
  };

  const closeServiceImageLightbox = () => {
    serviceImageLightboxModal?.classList.remove("show-modal");
  };

  closeServiceLightboxBtn?.addEventListener("click", closeServiceImageLightbox);
  serviceImageLightboxModal?.addEventListener("click", (event) => {
    if (event.target === serviceImageLightboxModal) closeServiceImageLightbox();
  });

  document.body.addEventListener("click", function (e) {
    const imageTrigger = e.target.closest(
      ".service-image-trigger, .service-modal-image-trigger",
    );
    if (imageTrigger) {
      const image = imageTrigger.querySelector("img");
      const src =
        imageTrigger.dataset.imageSrc || image?.currentSrc || image?.src || "";
      const title =
        imageTrigger.dataset.imageTitle ||
        image?.alt ||
        imageTrigger.closest(".service-card")?.querySelector(".card-title")
          ?.textContent ||
        modalTitle?.textContent ||
        "Service Image";
      openServiceImageLightbox(src, title.replace(/\s+(preview|banner)$/i, ""));
      return;
    }

    // Open Modal logic
    const openBtn = e.target.closest(".open-modal-btn");
    if (openBtn) {
      if (modal) {
        const card = openBtn.closest(".service-card");
        if (card) {
          // Title
          const title =
            openBtn.dataset.title ||
            card.querySelector(".card-title")?.innerText ||
            "";
          if (modalTitle) modalTitle.innerText = title;

          // Image
          if (modalImage) {
            const img =
              openBtn.dataset.img ||
              card.querySelector(".card-img-holder img")?.src ||
              card.querySelector(".service-image-trigger img")?.src ||
              "";
            modalImage.src = img;
            modalImage.alt = title ? `${title} preview` : "Service preview";
            modalImage.style.display = img ? "block" : "none";
            if (modalImageHolder) {
              modalImageHolder.style.display = img ? "flex" : "none";
              modalImageHolder.dataset.imageSrc = img;
              modalImageHolder.dataset.imageTitle = title;
            }
          }

          // Description
          if (modalDesc) {
            modalDesc.textContent =
              openBtn.dataset.desc ||
              card.querySelector(".card-desc")?.innerText ||
              "";
          }

          // Feature chips
          let features = [];
          try {
            features = JSON.parse(openBtn.dataset.features || "[]");
          } catch {}
          if (featureChips) {
            const subEl = featureChips.previousElementSibling;
            if (features.length) {
              featureChips.innerHTML = features
                .map((f) => `<span class="chip">${escHtmlModal(f)}</span>`)
                .join("");
              featureChips.style.display = "";
              if (subEl && subEl.classList.contains("modal-subtitle"))
                subEl.style.display = "";
            } else {
              featureChips.innerHTML = "";
              featureChips.style.display = "none";
              if (subEl && subEl.classList.contains("modal-subtitle"))
                subEl.style.display = "none";
            }
          }

          // Materials
          let materials = [];
          try {
            materials = JSON.parse(openBtn.dataset.materials || "[]");
          } catch {}
          if (modalList1) {
            if (materials.length) {
              modalList1.innerHTML = materials
                .map((m) => `<li>${escHtmlModal(m)}</li>`)
                .join("");
              if (modalSub1) modalSub1.style.display = "";
              modalList1.style.display = "";
            } else {
              modalList1.innerHTML = "";
              if (modalSub1) modalSub1.style.display = "none";
            }
          }

          // Best For
          let bestFor = [];
          try {
            bestFor = JSON.parse(
              openBtn.dataset.bestFor || openBtn.dataset["best-for"] || "[]",
            );
          } catch {}
          if (modalList2) {
            if (bestFor.length) {
              modalList2.innerHTML = bestFor
                .map((b) => `<li>${escHtmlModal(b)}</li>`)
                .join("");
              if (modalSub2) modalSub2.style.display = "";
              modalList2.style.display = "";
            } else {
              modalList2.innerHTML = "";
              if (modalSub2) modalSub2.style.display = "none";
            }
          }
        }

        modal.classList.add("show-modal");
        document.body.style.overflow = "hidden";
      }
    }

    // Close Modal via 'X' button
    if (e.target.closest(".close-modal-btn")) {
      if (modal) {
        modal.classList.remove("show-modal");
        document.body.style.overflow = "";
      }
    }

    // The service detail modal is only dismissed from inside the card — clicking
    // the dark overlay deliberately does nothing.
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;

    if (serviceImageLightboxModal?.classList.contains("show-modal")) {
      closeServiceImageLightbox();
      return;
    }

    if (modal?.classList.contains("show-modal")) {
      modal.classList.remove("show-modal");
      document.body.style.overflow = "";
    }
  });

  // =========================================
  // SERVICES LIST FILTERING LOGIC
  // =========================================
  const isServicesPage = document.body.classList.contains("services-page-body");

  if (isServicesPage) {
    const searchInput = document.querySelector(".toolbar-search .search-input");
    const categorySelect = document.querySelector(".category-select");
    const serviceCards = Array.from(
      document.querySelectorAll(".services-grid .service-card"),
    );

    const normalize = (value) =>
      String(value || "")
        .toLowerCase()
        .trim();

    const applyServiceFilters = () => {
      const query = normalize(searchInput?.value || "");
      const selectedCategory = normalize(categorySelect?.value || "all");

      serviceCards.forEach((card) => {
        const title = normalize(
          card.querySelector(".card-title")?.textContent || "",
        );
        const desc = normalize(
          card.querySelector(".card-desc")?.textContent || "",
        );
        const category = normalize(card.dataset.category || "");

        const matchesSearch =
          !query || title.includes(query) || desc.includes(query);
        const matchesCategory =
          selectedCategory === "all" || category === selectedCategory;
        card.style.display = matchesSearch && matchesCategory ? "" : "none";
      });
    };

    searchInput?.addEventListener("input", applyServiceFilters);
    categorySelect?.addEventListener("change", applyServiceFilters);
    applyServiceFilters();
  }

  // =========================================
  // SERVICES 3D CAROUSEL LOGIC (Homepage)
  // =========================================
  const track = document.querySelector(".carousel-track");

  if (track) {
    const items = Array.from(track.querySelectorAll(".carousel-item"));
    const prevBtn = document.querySelector(".prev-btn");
    const nextBtn = document.querySelector(".next-btn");
    const wrapper = document.querySelector(".carousel-wrapper");

    if (items.length > 0 && prevBtn && nextBtn && wrapper) {
      let currentIndex = 0;
      let autoPlayInterval;

      const updateCarousel = () => {
        items.forEach((item, index) => {
          item.className = "carousel-item";

          if (index === currentIndex) {
            item.classList.add("active");
          } else if (
            index ===
            (currentIndex - 1 + items.length) % items.length
          ) {
            item.classList.add("prev");
          } else if (index === (currentIndex + 1) % items.length) {
            item.classList.add("next");
          } else if (
            index ===
            (currentIndex - 2 + items.length) % items.length
          ) {
            item.classList.add("prev-hidden");
          } else if (index === (currentIndex + 2) % items.length) {
            item.classList.add("next-hidden");
          }
        });
      };

      const moveNext = () => {
        currentIndex = (currentIndex + 1) % items.length;
        updateCarousel();
      };

      const movePrev = () => {
        currentIndex = (currentIndex - 1 + items.length) % items.length;
        updateCarousel();
      };

      const startAutoPlay = () => {
        autoPlayInterval = setInterval(moveNext, 5000);
        // `applyServices` replaces this track's children and calls
        // `initCarousel` on it, which arms a second, 6s timer — but this 5s one
        // was a closure-local with no handle reachable from there, so both ran
        // for the rest of the visit and the offers advanced on two beats.
        // Parking the handle on the element lets `initCarousel` clear it.
        track._fmrcPlaceholderTimer = autoPlayInterval;
      };

      const resetAutoPlay = () => {
        clearInterval(autoPlayInterval);
        startAutoPlay();
      };

      nextBtn.addEventListener("click", () => {
        moveNext();
        resetAutoPlay();
      });

      prevBtn.addEventListener("click", () => {
        movePrev();
        resetAutoPlay();
      });

      items.forEach((item) => {
        item.addEventListener("click", () => {
          if (item.classList.contains("prev")) {
            movePrev();
            resetAutoPlay();
          } else if (item.classList.contains("next")) {
            moveNext();
            resetAutoPlay();
          }
        });
      });

      let startX = 0;
      let endX = 0;

      track.addEventListener(
        "touchstart",
        (e) => {
          startX = e.touches[0].clientX;
          clearInterval(autoPlayInterval);
        },
        { passive: true },
      );

      track.addEventListener("touchend", (e) => {
        endX = e.changedTouches[0].clientX;
        const swipeThreshold = 40;

        if (startX - endX > swipeThreshold) {
          moveNext();
        } else if (endX - startX > swipeThreshold) {
          movePrev();
        }

        startAutoPlay();
      });

      wrapper.addEventListener("mouseenter", () =>
        clearInterval(autoPlayInterval),
      );
      wrapper.addEventListener("mouseleave", startAutoPlay);

      updateCarousel();
      startAutoPlay();
    }
  }

  // =========================================
  // FULLSCREEN IMAGE LIGHTBOX LOGIC
  // =========================================
  const imageLightbox = document.getElementById("imageLightbox");
  const lightboxImg = document.getElementById("lightboxImg");
  const closeLightboxBtn = document.getElementById("closeLightbox");

  // When the user clicks the image inside the service modal
  if (modalImage && imageLightbox && lightboxImg) {
    modalImage.addEventListener("click", () => {
      lightboxImg.src = modalImage.src; // Copy source from modal image
      lightboxImg.alt = modalImage.alt;
      imageLightbox.classList.add("show-lightbox");
    });
  }

  // Close the lightbox when clicking the 'X' or the dark background
  if (imageLightbox) {
    imageLightbox.addEventListener("click", (e) => {
      if (e.target === imageLightbox || e.target === closeLightboxBtn) {
        imageLightbox.classList.remove("show-lightbox");
      }
    });
  }

  // =========================================
  // PRODUCTS PAGE: INFO, RATING, FILTERS
  // =========================================
  const isProductsPage = document.body.classList.contains("products-page-body");
  const productCards = Array.from(document.querySelectorAll(".shop-card"));

  if (isProductsPage && productCards.length > 0) {
    const shopGrid = document.querySelector(".shop-grid");
    const searchInput = document.getElementById("productSearchInput");
    const categorySelect = document.getElementById("productCategorySelect");
    const filterSelect = document.getElementById("productFilterSelect");

    const productInfoModal = document.getElementById("productInfoModal");
    const closeProductInfoModal = document.getElementById(
      "closeProductInfoModal",
    );
    const productInfoTitle = document.getElementById("productInfoTitle");
    const productInfoImage = document.getElementById("productInfoImage");
    const productInfoSummary = document.getElementById("productInfoSummary");
    const productInfoChips = document.getElementById("productInfoChips");
    const productInfoAvailability = document.getElementById(
      "productInfoAvailability",
    );
    const productInfoRecommended = document.getElementById(
      "productInfoRecommended",
    );
    const productInfoAddToCart = document.getElementById(
      "productInfoAddToCart",
    );
    const productInfoBuyNow = document.getElementById("productInfoBuyNow");

    let activeProductCard = null;

    const getCategoryFromName = (name) => {
      const normalized = name.toLowerCase();
      if (normalized.includes("laser")) return "laser";
      if (normalized.includes("cnc")) return "cnc";
      return "3dprint";
    };

    const paintStars = (container, ratingValue) => {
      const stars = container.querySelectorAll(".rating-star-btn");
      stars.forEach((star) => {
        const starValue = parseInt(star.dataset.star || "0");
        star.classList.toggle("filled", starValue <= ratingValue);
      });
    };

    productCards.forEach((card, index) => {
      const nameEl = card.querySelector(".product-name");
      const nameText = nameEl
        ? nameEl.innerText.trim()
        : `Product ${index + 1}`;
      const inferredCategory = getCategoryFromName(nameText);

      card.dataset.category = card.dataset.category || inferredCategory;
      card.dataset.userRating = card.dataset.userRating || "4";

      const productInfo = card.querySelector(".product-info");
      const priceEl = card.querySelector(".product-price");

      if (
        productInfo &&
        priceEl &&
        !card.querySelector(".product-rating-row")
      ) {
        const ratingRow = document.createElement("div");
        ratingRow.className = "product-rating-row";
        ratingRow.innerHTML = `
          <span class="rating-score"><span class="rating-score-value">4.0</span>/5</span>
          <div class="rating-stars" aria-label="Product rating">
            <button type="button" class="rating-star-btn filled" data-star="1">&#9733;</button>
            <button type="button" class="rating-star-btn filled" data-star="2">&#9733;</button>
            <button type="button" class="rating-star-btn filled" data-star="3">&#9733;</button>
            <button type="button" class="rating-star-btn filled" data-star="4">&#9733;</button>
            <button type="button" class="rating-star-btn" data-star="5">&#9733;</button>
            <span class="rating-count">(${12 + index * 3})</span>
          </div>
        `;

        priceEl.insertAdjacentElement("afterend", ratingRow);

        const starsContainer = ratingRow.querySelector(".rating-stars");
        paintStars(starsContainer, parseInt(card.dataset.userRating));

        starsContainer.addEventListener("click", (event) => {
          const clickedStar = event.target.closest(".rating-star-btn");
          if (!clickedStar) return;

          const selectedRating = parseInt(clickedStar.dataset.star || "4");
          card.dataset.userRating = String(selectedRating);
          const scoreValue = ratingRow.querySelector(".rating-score-value");
          if (scoreValue) scoreValue.innerText = `${selectedRating}.0`;
          paintStars(starsContainer, selectedRating);

          if (filterSelect && filterSelect.value === "top-rated") {
            applyProductFilters();
          }
        });
      }

      const actionContainer = card.querySelector(".product-actions");
      if (actionContainer && !actionContainer.querySelector(".btn-view-info")) {
        const infoBtn = document.createElement("button");
        infoBtn.type = "button";
        infoBtn.className = "action-btn btn-view-info";
        infoBtn.innerHTML = '<span class="action-btn-label">VIEW INFO</span>';

        const divider = document.createElement("span");
        divider.className = "action-divider";
        divider.setAttribute("aria-hidden", "true");

        actionContainer.insertBefore(divider, actionContainer.firstChild);
        actionContainer.insertBefore(infoBtn, divider);
      }
    });

    const openProductInfoModal = (card) => {
      if (!productInfoModal) return;

      activeProductCard = card;
      const title = card.querySelector(".product-name")?.innerText || "Product";
      const image = card.querySelector(".product-img-wrapper img");
      const price = card.querySelector(".product-price")?.innerText || "₱0.00";
      const code = card.querySelector(".code-value")?.innerText || "N/A";
      const stock = card.querySelector(".stock-text")?.innerText || "N/A";
      const badge = card.querySelector(".stock-badge")?.innerText || "N/A";
      const currentRating = parseInt(card.dataset.userRating || "4");

      if (productInfoTitle) productInfoTitle.innerText = title;
      if (productInfoImage && image) {
        productInfoImage.src = image.src;
        productInfoImage.alt = image.alt || title;
      }

      if (productInfoSummary) {
        productInfoSummary.innerText = `${title} is available for request and processing through CNSC-FMRC. This item includes quality production support with consistent output standards.`;
      }

      if (productInfoChips) {
        productInfoChips.innerHTML = `
          <span class="chip">Price ${price}</span>
          <span class="chip">Code ${code}</span>
          <span class="chip">Rated ${currentRating}.0 / 5</span>
          <span class="chip">Service-backed production</span>
        `;
      }

      if (productInfoAvailability) {
        productInfoAvailability.innerHTML = `
          <li>Stock status: ${stock}</li>
          <li>Availability badge: ${badge}</li>
          <li>Direct checkout supported</li>
        `;
      }

      if (productInfoRecommended) {
        productInfoRecommended.innerHTML = `
          <li>Academic prototypes and demos</li>
          <li>Business sample production</li>
          <li>Event and presentation materials</li>
        `;
      }

      productInfoModal.classList.add("show-modal");
      document.body.style.overflow = "hidden";
    };

    const closeInfoModal = () => {
      if (!productInfoModal) return;
      productInfoModal.classList.remove("show-modal");
      document.body.style.overflow = "";
    };

    document.body.addEventListener("click", (event) => {
      const viewInfoBtn = event.target.closest(".btn-view-info");
      if (viewInfoBtn) {
        const relatedCard = viewInfoBtn.closest(".shop-card");
        if (relatedCard) openProductInfoModal(relatedCard);
      }
    });

    if (closeProductInfoModal) {
      closeProductInfoModal.addEventListener("click", closeInfoModal);
    }

    // Modal: no overlay-click dismissal, the close X handles it. Escape lives in
    // products.js, which is what actually owns this card — the block around here
    // only runs when `.shop-card` markup is already in the DOM at load, and the
    // cards are fetched in after that.

    if (productInfoAddToCart) {
      productInfoAddToCart.addEventListener("click", () => {
        const addBtn = activeProductCard?.querySelector(
          ".btn-add-cart:not(.disabled)",
        );
        if (addBtn) {
          closeInfoModal();
          addBtn.click();
        }
      });
    }

    if (productInfoBuyNow) {
      productInfoBuyNow.addEventListener("click", () => {
        const buyBtn = activeProductCard?.querySelector(
          ".btn-buy-now:not(.disabled)",
        );
        if (buyBtn) {
          closeInfoModal();
          buyBtn.click();
        }
      });
    }

    const applyProductFilters = () => {
      const searchValue = (searchInput?.value || "").trim().toLowerCase();
      const selectedCategory = categorySelect?.value || "all";
      const selectedFilter = filterSelect?.value || "all";

      const cards = Array.from(shopGrid?.querySelectorAll(".shop-card") || []);

      cards.forEach((card) => {
        const nameText =
          card.querySelector(".product-name")?.innerText.toLowerCase() || "";
        const category = card.dataset.category || "all";
        const stockBadge = card.querySelector(".stock-badge");
        const isOutOfStock = stockBadge?.classList.contains("out-of-stock");
        const userRating = parseInt(card.dataset.userRating || "4");

        let visible = true;

        if (searchValue && !nameText.includes(searchValue)) visible = false;
        if (selectedCategory !== "all" && category !== selectedCategory)
          visible = false;

        if (selectedFilter === "in-stock" && isOutOfStock) visible = false;
        if (selectedFilter === "out-of-stock" && !isOutOfStock) visible = false;
        if (selectedFilter === "top-rated" && userRating < 4) visible = false;

        card.style.display = visible ? "flex" : "none";
      });

      if (
        selectedFilter === "price-low" ||
        selectedFilter === "price-high" ||
        selectedFilter === "top-rated"
      ) {
        const visibleCards = cards.filter(
          (card) => card.style.display !== "none",
        );

        visibleCards.sort((a, b) => {
          if (selectedFilter === "top-rated") {
            return (
              parseInt(b.dataset.userRating || "4") -
              parseInt(a.dataset.userRating || "4")
            );
          }

          const getPrice = (cardEl) => {
            const priceText =
              cardEl.querySelector(".product-price")?.innerText || "₱0";
            return parseFloat(priceText.replace(/[^0-9.]/g, ""));
          };

          const priceA = getPrice(a);
          const priceB = getPrice(b);
          return selectedFilter === "price-low"
            ? priceA - priceB
            : priceB - priceA;
        });

        visibleCards.forEach((card) => shopGrid.appendChild(card));
      }
    };

    if (searchInput) searchInput.addEventListener("input", applyProductFilters);
    if (categorySelect)
      categorySelect.addEventListener("change", applyProductFilters);
    if (filterSelect)
      filterSelect.addEventListener("change", applyProductFilters);

    applyProductFilters();
  }

  // =========================================
  // E-COMMERCE CHECKOUT LOGIC (3-STEP FLOW)
  // =========================================
  const checkoutModal = document.getElementById("checkoutModal");
  const addressSelectionModal = document.getElementById(
    "addressSelectionModal",
  );
  const editInfoModal = document.getElementById("editInfoModal");

  // Checkout DOM elements
  const checkoutImg = document.getElementById("checkoutProductImg");
  const checkoutTitle = document.getElementById("checkoutProductTitle");
  const checkoutPrice = document.getElementById("checkoutProductPrice");
  const checkoutSubtotal = document.getElementById("checkoutSubtotal");
  const checkoutGrandTotal = document.getElementById("checkoutGrandTotal");
  const footerTotalDisplay = document.getElementById("footerTotalDisplay");
  const checkoutMaxStock = document.getElementById("checkoutMaxStock");
  // Order summary â€” single vs. multiple (cart) product views
  const checkoutSingleProductCard = document.getElementById(
    "checkoutSingleProductCard",
  );
  const checkoutCartItemsList = document.getElementById(
    "checkoutCartItemsList",
  );
  const checkoutStockNotice = document.getElementById("checkoutStockNotice");


  // Quantity DOM elements
  const inputQty = document.getElementById("inputQty");
  const btnMinusQty = document.getElementById("btnMinusQty");
  const btnPlusQty = document.getElementById("btnPlusQty");
  const footerItemCount = document.getElementById("footerItemCount");

  // Edit Guide DOM elements
  const guideImg = document.getElementById("guideProductImg");
  const guideTitle = document.getElementById("guideProductTitle");

  let currentItemPrice = 0;
  let currentMaxStock = Infinity;
  let currentProductId = null;
  let currentCheckoutMode = "single";
  let currentCheckoutItems = [];
  let isCheckoutQtyLocked = false;
  let protectionFee = 5.0;

  const setCheckoutQtyLock = (locked) => {
    isCheckoutQtyLocked = Boolean(locked);
    if (btnMinusQty) btnMinusQty.disabled = isCheckoutQtyLocked;
    if (btnPlusQty) btnPlusQty.disabled = isCheckoutQtyLocked;
  };

  const setCheckoutStockNotice = (value) => {
    if (!checkoutMaxStock) return;
    checkoutMaxStock.innerText = String(value || "0");
  };

  function parsePrice(priceStr) {
    return parseFloat(priceStr.replace(/[^0-9.-]+/g, ""));
  }
  function formatPrice(num) {
    return "₱" + num.toFixed(2);
  }

  // Renders the Order summary product area based on the current checkout mode.
  // - "single": shows one product card (Buy Now / single item)
  // - "cart":   shows each selected cart product individually, editable via +/-
  function renderCheckoutOrderSummary() {
    const isCartMode =
      currentCheckoutMode === "cart" &&
      Array.isArray(currentCheckoutItems) &&
      currentCheckoutItems.length > 0;

    if (checkoutSingleProductCard) {
      checkoutSingleProductCard.style.display = isCartMode ? "none" : "flex";
    }

    if (!checkoutCartItemsList) return;

    if (!isCartMode) {
      checkoutCartItemsList.style.display = "none";
      checkoutCartItemsList.innerHTML = "";
      if (checkoutStockNotice) checkoutStockNotice.style.display = "";
      return;
    }

    // Cart mode â€” render each product on its own editable row.
    if (checkoutStockNotice) checkoutStockNotice.style.display = "none";
    checkoutCartItemsList.style.display = "flex";
    checkoutCartItemsList.innerHTML = currentCheckoutItems
      .map((item, index) => {
        const name = escapeCustomerHtml(item.product_name || "Custom Order");
        const image = escapeCustomerHtml(
          item.product_image || "/images/FMRC Logo.png",
        );
        const qty = Math.max(
          1,
          Number.parseInt(item.quantity || "1", 10) || 1,
        );
        const unitPrice = Number.isFinite(Number(item.unit_price))
          ? Number(item.unit_price)
          : 0;
        const hasStockCap = Number.isFinite(Number(item.max_stock));
        const stockLabel = hasStockCap
          ? `Stock left: ${Math.max(0, Number(item.max_stock))}`
          : "Made to order";

        return `
          <div class="checkout-cart-item" data-checkout-index="${index}">
            <img src="${image}" alt="Product" />
            <div class="checkout-cart-item-details">
              <h4>${name}</h4>
              <div class="checkout-cart-item-meta">${stockLabel}</div>
              <div class="product-price-row">
                <span class="c-price">${formatPrice(unitPrice)}</span>
                <div class="qty-selector">
                  <button type="button" class="qty-btn checkout-item-minus" data-index="${index}">-</button>
                  <input type="number" class="checkout-item-qty" value="${qty}" min="1" readonly />
                  <button type="button" class="qty-btn checkout-item-plus" data-index="${index}">+</button>
                </div>
              </div>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function updateCheckoutMath() {
    const isCartMode =
      currentCheckoutMode === "cart" &&
      Array.isArray(currentCheckoutItems) &&
      currentCheckoutItems.length > 0;

    let subtotal = 0;
    let totalQty = 0;

    if (isCartMode) {
      currentCheckoutItems.forEach((item) => {
        const qty = Math.max(
          1,
          Number.parseInt(item.quantity || "1", 10) || 1,
        );
        const unitPrice = Number.isFinite(Number(item.unit_price))
          ? Number(item.unit_price)
          : 0;
        item.line_total = unitPrice * qty;
        subtotal += item.line_total;
        totalQty += qty;
      });
    } else {
      const qty = Math.max(1, parseInt(inputQty?.value || "1", 10) || 1);
      subtotal = currentItemPrice * qty;
      totalQty = qty;
    }

    let total = subtotal;

    // Add protection fee if checked
    const protectionCheckEl = document.getElementById("protectionCheck");
    if (protectionCheckEl && protectionCheckEl.checked) {
      total += protectionFee;
    }

    if (checkoutSubtotal) checkoutSubtotal.innerText = formatPrice(subtotal);
    if (checkoutGrandTotal) checkoutGrandTotal.innerText = formatPrice(total);
    if (footerTotalDisplay) footerTotalDisplay.innerText = formatPrice(total);
    if (footerItemCount) footerItemCount.innerText = String(totalQty);

    // The GCash panel quotes the exact peso amount to send, so it has to follow
    // the total as quantities change. Safe to call even though it is defined
    // further down: every caller of this function is an event handler.
    renderGcashSection();
  }

  // Delegated +/- handlers for individual cart items inside the Order summary.
  if (checkoutCartItemsList) {
    checkoutCartItemsList.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      const minusBtn = target.closest(".checkout-item-minus");
      const plusBtn = target.closest(".checkout-item-plus");
      if (!minusBtn && !plusBtn) return;

      const index = Number(
        (minusBtn || plusBtn).getAttribute("data-index") || "-1",
      );
      const item = currentCheckoutItems[index];
      if (!item) return;

      let qty = Math.max(1, Number.parseInt(item.quantity || "1", 10) || 1);
      const hasStockCap = Number.isFinite(Number(item.max_stock));
      const maxStock = hasStockCap ? Math.max(0, Number(item.max_stock)) : null;

      if (minusBtn) {
        if (qty > 1) qty -= 1;
      } else if (plusBtn) {
        if (maxStock != null && qty >= maxStock) {
          void showCustomerPopup(
            `Only ${maxStock} stock(s) available for "${item.product_name}".`,
            { title: "Stock Limit" },
          );
          return;
        }
        qty += 1;
      }

      item.quantity = qty;
      item.line_total =
        (Number.isFinite(Number(item.unit_price)) ? Number(item.unit_price) : 0) *
        qty;

      // Reflect the change directly in the row's quantity input.
      const row = checkoutCartItemsList.querySelector(
        `.checkout-cart-item[data-checkout-index="${index}"] .checkout-item-qty`,
      );
      if (row instanceof HTMLInputElement) {
        row.value = String(qty);
      }

      updateCheckoutMath();
    });
  }


  // Update math when Protection checkbox is clicked
  const protectionCheck = document.getElementById("protectionCheck");
  if (protectionCheck) {
    protectionCheck.addEventListener("change", updateCheckoutMath);
  }

  if (btnMinusQty && btnPlusQty && inputQty) {
    btnMinusQty.addEventListener("click", () => {
      if (isCheckoutQtyLocked) {
        void showCustomerPopup(
          "Edit quantities directly in your cart for cart checkout.",
          {
            title: "Quantity Locked",
          },
        );
        return;
      }

      let currentVal = parseInt(inputQty.value);
      if (currentVal > 1) {
        inputQty.value = currentVal - 1;
        updateCheckoutMath();
      }
    });
    btnPlusQty.addEventListener("click", () => {
      if (isCheckoutQtyLocked) {
        void showCustomerPopup(
          "Edit quantities directly in your cart for cart checkout.",
          {
            title: "Quantity Locked",
          },
        );
        return;
      }

      let currentVal = parseInt(inputQty.value);
      if (currentVal < currentMaxStock) {
        inputQty.value = currentVal + 1;
        updateCheckoutMath();
      } else if (currentMaxStock === 9999) {
        inputQty.value = currentVal + 1;
        updateCheckoutMath();
      } else {
        void showCustomerPopup("Maximum stock reached for this item.", {
          title: "Stock Limit",
        });
      }
    });
  }

  // --- MODAL 1: OPEN CHECKOUT ---
  const buyNowBtns = document.querySelectorAll(".btn-buy-now:not(.disabled)");
  buyNowBtns.forEach((btn) => {
    btn.addEventListener("click", function (e) {
      if (!requireCustomerAuth("buy products")) return;
      if (!isGuestUser) {
        void fetchCustomerCheckoutProfile();
      }

      const card = e.target.closest(".shop-card");
      if (card) {
        const imgScr = card.querySelector(".product-img-wrapper img").src;
        const title = card.querySelector(".product-name").innerText;
        const priceStr = card.querySelector(".product-price").innerText;
        const stockText = card.querySelector(".stock-text").innerText;

        currentCheckoutMode = "single";
        currentCheckoutItems = [];
        setCheckoutQtyLock(false);
        currentProductId =
          Number(card.getAttribute("data-product-id") || "") || null;

        if (stockText.toLowerCase().includes("unlimited")) {
          currentMaxStock = 9999;
          setCheckoutStockNotice("Unlimited");
        } else {
          currentMaxStock = Math.max(
            0,
            parseInt(stockText.replace(/[^0-9]/g, ""), 10) || 0,
          );
          setCheckoutStockNotice(currentMaxStock);
        }

        currentItemPrice = parsePrice(priceStr);
        inputQty.value = 1;
        inputQty.max = currentMaxStock;
        if (protectionCheck) protectionCheck.checked = false; // Reset protection

        if (checkoutImg) checkoutImg.src = imgScr;
        if (checkoutTitle) checkoutTitle.innerText = title;
        if (checkoutPrice) checkoutPrice.innerText = priceStr;

        renderCheckoutOrderSummary();
        updateCheckoutMath();

        if (guideImg) guideImg.src = imgScr;
        if (guideTitle) guideTitle.innerText = title;

        checkoutModal.classList.add("show-modal");
        document.body.style.overflow = "hidden";
      }
    });
  });


  // Dynamically rendered products buy-now listener
  document.addEventListener("product:buy-now", (e) => {
    const product = e.detail;
    if (!product) return;
    if (typeof requireCustomerAuth === "function") {
      if (!requireCustomerAuth("buy products")) return;
    }
    if (typeof fetchCustomerCheckoutProfile === "function") {
      void fetchCustomerCheckoutProfile();
    }

    const imgScr = product.image_data || "/images/FMRC Logo.png";
    const title = String(product.name || "");
    const unitPrice = Number.isFinite(Number(product.price))
      ? Number(product.price)
      : 0;

    currentCheckoutMode = "single";
    currentCheckoutItems = [];
    setCheckoutQtyLock(false);
    currentMaxStock =
      product.stock_status === "in_stock"
        ? Math.max(0, Number(product.stock) || 0)
        : 0;
    setCheckoutStockNotice(
      currentMaxStock === 0 ? "Out of Stock" : currentMaxStock,
    );

    currentItemPrice = unitPrice;
    currentProductId = product.id || null;
    if (inputQty) {
      inputQty.value = 1;
      inputQty.max = currentMaxStock;
    }
    if (protectionCheck) protectionCheck.checked = false;

    if (checkoutImg) checkoutImg.src = imgScr;
    if (checkoutTitle) checkoutTitle.innerText = title;
    if (checkoutPrice)
      checkoutPrice.innerText =
        typeof formatPrice === "function"
          ? formatPrice(unitPrice)
          : "₱" + unitPrice.toFixed(2);

    if (guideImg) guideImg.src = imgScr;
    if (guideTitle) guideTitle.innerText = title;

    // Reset the Order summary to the single-product view. Without this, a
    // previous cart checkout could leave the multi-item list visible and make
    // Buy Now appear to include every cart product.
    renderCheckoutOrderSummary();
    updateCheckoutMath();
    checkoutModal.classList.add("show-modal");
    document.body.style.overflow = "hidden";
  });


  const closeCheckoutBtn = document.getElementById("closeCheckoutBtn");
  if (closeCheckoutBtn) {
    closeCheckoutBtn.addEventListener("click", () => {
      checkoutModal.classList.remove("show-modal");
      /* "" and not "auto": an inline overflow: auto on <body> outranks the
         stylesheet's overflow-x: clip, and because <html> has no overflow of its
         own it is body's value that propagates to the viewport — so this one line
         used to re-enable sideways panning site-wide until the next navigation.
         Every other close handler in this file already restores "". */
      document.body.style.overflow = "";
      currentCheckoutMode = "single";
      currentCheckoutItems = [];
      setCheckoutQtyLock(false);
    });
  }

  // --- MODAL 2: OPEN ADDRESS SELECTION ---
  const openAddressSelectionBtn = document.getElementById(
    "openAddressSelectionBtn",
  );
  if (openAddressSelectionBtn) {
    openAddressSelectionBtn.addEventListener("click", () => {
      setAddressEditMode(false);
      addressSelectionModal.classList.add("show-modal");
    });
  }

  const backToCheckoutFromAddressBtn = document.getElementById(
    "backToCheckoutFromAddressBtn",
  );
  if (backToCheckoutFromAddressBtn) {
    backToCheckoutFromAddressBtn.addEventListener("click", () => {
      setAddressEditMode(false);
      addressSelectionModal.classList.remove("show-modal");
    });
  }

  // Select and manage checkout addresses using profile data + local address book.
  const openAddAddressBtn = document.getElementById("openAddAddressBtn");
  const addInfoModal = document.getElementById("addInfoModal");
  const addressList =
    document.getElementById("addressList") ||
    document.querySelector(".address-list");
  const addressEditModeBtn = document.getElementById("addressEditModeBtn");
  const addressSelectionFooter = document.getElementById(
    "addressSelectionFooter",
  );
  const selectAllAddressBtn = document.getElementById("selectAllAddressBtn");
  const deleteSelectedAddressBtn = document.getElementById(
    "deleteSelectedAddressBtn",
  );
  const deleteAllAddressBtn = document.getElementById("deleteAllAddressBtn");
  const cartShortAddressText = document.getElementById("cartShortAddressText");

  const displayClientName = document.getElementById("displayClientName");
  const displayClientPhone = document.getElementById("displayClientPhone");
  const displayClientAddress = document.getElementById("displayClientAddress");
  const displayClientAddressGrid = document.getElementById(
    "displayClientAddressGrid",
  );
  const displayClientAddressAlert = document.getElementById(
    "displayClientAddressAlert",
  );
  const displayClientRole = document.getElementById("displayClientRole");
  const displayClientDept = document.getElementById("displayClientDept");
  const displayAddrStreet = document.getElementById("displayAddrStreet");
  const displayAddrBarangay = document.getElementById("displayAddrBarangay");
  const displayAddrCity = document.getElementById("displayAddrCity");
  const displayAddrProvince = document.getElementById("displayAddrProvince");
  const displayAddrPostal = document.getElementById("displayAddrPostal");
  const displayAddrLandmark = document.getElementById("displayAddrLandmark");
  const fulfillPickupRadio = document.getElementById("fulfillPickupRadio");
  const fulfillDeliveryRadio = document.getElementById("fulfillDeliveryRadio");
  const fulfillmentNote = document.getElementById("fulfillmentNote");

  const gcashPaymentSection = document.getElementById("gcashPaymentSection");
  const gcashAmountDue = document.getElementById("gcashAmountDue");
  const gcashAccountNameEl = document.getElementById("gcashAccountName");
  const gcashAccountNumberEl = document.getElementById("gcashAccountNumber");
  const gcashCopyNumberBtn = document.getElementById("gcashCopyNumberBtn");
  const gcashQrBlock = document.getElementById("gcashQrBlock");
  const gcashQrImage = document.getElementById("gcashQrImage");
  const gcashQrDownload = document.getElementById("gcashQrDownload");
  const gcashMobileBlock = document.getElementById("gcashMobileBlock");
  const gcashOpenAppBtn = document.getElementById("gcashOpenAppBtn");
  const gcashOpenAppHint = document.getElementById("gcashOpenAppHint");
  const gcashSteps = document.getElementById("gcashSteps");
  const gcashReferenceInput = document.getElementById("gcashReferenceInput");
  const gcashPayLaterNote = document.getElementById("gcashPayLaterNote");
  const gcashUnconfiguredNote = document.getElementById(
    "gcashUnconfiguredNote",
  );

  const inpFullName = document.getElementById("inpFullName");
  const inpPhone = document.getElementById("inpPhone");
  const inpAddress = document.getElementById("inpAddress");
  const inpPostal = document.getElementById("inpPostal");
  const inpDetails = document.getElementById("inpDetails");
  const inpDept = document.getElementById("inpDept");
  const inpSetDefault = document.getElementById("inpSetDefault");
  const addInpFullName = document.getElementById("addInpFullName");
  const addInpPhone = document.getElementById("addInpPhone");
  const addInpAddress = document.getElementById("addInpAddress");
  const addInpPostal = document.getElementById("addInpPostal");
  const addInpDetails = document.getElementById("addInpDetails");
  const addInpDept = document.getElementById("addInpDept");
  const addInpSetDefault = document.getElementById("addInpSetDefault");

  const saveInfoBtn = document.getElementById("saveInfoBtn");
  const saveNewInfoBtn = document.getElementById("saveNewInfoBtn");
  const backToAddressBtn = document.getElementById("backToAddressBtn");
  const backToAddressFromAddBtn = document.getElementById(
    "backToAddressFromAddBtn",
  );

  const ADDRESS_STORAGE_NAMESPACE = "fmrc_checkout_addresses_v1";

  let customerCheckoutProfile = null;
  let customerAddressBook = [];
  let selectedCheckoutAddressId = null;
  let editingCheckoutAddressId = null;
  let isAddressEditMode = false;
  const addressDeleteSelection = new Set();

  const escapeCustomerHtml = (value) =>
    String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const getMaskedPhone = (rawDigits) => {
    const digits = String(rawDigits || "").replace(/\D/g, "");
    if (!digits) return "(+63)N/A";
    if (digits.length <= 4) return `(+63)${digits}`;
    return `(+63)${digits.substring(0, 2)}******${digits.substring(digits.length - 2)}`;
  };

  const getShortAddress = (addressLine) => {
    const clean = String(addressLine || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!clean) return "No saved address";
    if (clean.length <= 40) return clean;
    return `${clean.slice(0, 37)}...`;
  };

  const getAddressStorageKey = () => {
    const customerKey =
      customerSession.userInfo?.id ||
      customerSession.userInfo?.email ||
      customerSession.userInfo?.username ||
      "guest";

    return `${ADDRESS_STORAGE_NAMESPACE}:${String(customerKey).toLowerCase()}`;
  };

  const normalizePhoneDigits = (value) =>
    String(value || "")
      .replace(/\D/g, "")
      .slice(0, 11);

  const createAddressId = () =>
    `addr-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const normalizeAddressEntry = (entry = {}) => ({
    id: String(entry.id || createAddressId()),
    name: String(entry.name || "").trim(),
    phone_number: normalizePhoneDigits(entry.phone_number || entry.phone || ""),
    // `address_line` keeps its original meaning: the house/unit number and
    // street only. The parts a courier needs separated live on their own so a
    // missing one can actually be detected instead of hiding inside a blob.
    address_line: String(entry.address_line || "").trim(),
    barangay: String(entry.barangay || "").trim(),
    city_municipality: String(
      entry.city_municipality || entry.city || "",
    ).trim(),
    province: String(entry.province || "").trim(),
    postal_code: String(entry.postal_code || "")
      .replace(/\D/g, "")
      .slice(0, 4),
    address_details: String(entry.address_details || "").trim(),
    department: String(entry.department || "").trim(),
    customer_type: String(entry.customer_type || "Student").trim() || "Student",
    is_default: Boolean(entry.is_default),
    updated_at: String(entry.updated_at || new Date().toISOString()),
  });

  /** The address parts a courier cannot deliver without, in reading order. */
  const REQUIRED_DELIVERY_PARTS = [
    { key: "address_line", label: "Street", field: "address" },
    { key: "barangay", label: "Barangay", field: "barangay" },
    { key: "city_municipality", label: "City / Municipality", field: "city" },
    { key: "province", label: "Province", field: "province" },
    { key: "postal_code", label: "Postal code", field: "postal" },
    { key: "address_details", label: "Landmark", field: "details" },
  ];

  /** Which required parts of a saved address are still blank. */
  const getMissingAddressParts = (entry) =>
    REQUIRED_DELIVERY_PARTS.filter(
      (part) => !String(entry?.[part.key] || "").trim(),
    );

  /** The saved address on one line, in Philippine address order. */
  const buildAddressOneLine = (entry) =>
    [
      entry?.address_line,
      entry?.barangay ? `Brgy. ${entry.barangay}` : "",
      entry?.city_municipality,
      entry?.province,
      entry?.postal_code,
    ]
      .map((part) => String(part || "").trim())
      .filter(Boolean)
      .join(", ");

  const setRoleByRadioName = (radioName, value) => {
    const targetValue = String(value || "Student");
    const radios = document.querySelectorAll(`input[name="${radioName}"]`);
    let matched = false;
    radios.forEach((radio) => {
      if (!(radio instanceof HTMLInputElement)) return;
      const isMatch = radio.value === targetValue;
      radio.checked = isMatch;
      if (isMatch) matched = true;
    });

    if (!matched) {
      const first = radios[0];
      if (first instanceof HTMLInputElement) {
        first.checked = true;
      }
    }
  };

  const getSelectedRole = (name) => {
    const checked = document.querySelector(`input[name="${name}"]:checked`);
    return checked instanceof HTMLInputElement ? checked.value : "Student";
  };

  const getAddressFieldIds = (mode) => {
    if (mode === "add") {
      return {
        name: "addInpFullName",
        phone: "addInpPhone",
        address: "addInpAddress",
        region: "addInpRegion",
        barangay: "addInpBarangay",
        city: "addInpCity",
        province: "addInpProvince",
        postal: "addInpPostal",
        details: "addInpDetails",
        dept: "addInpDept",
        roleOther: "addInpRoleOther",
      };
    }

    return {
      name: "inpFullName",
      phone: "inpPhone",
      address: "inpAddress",
      region: "inpRegion",
      barangay: "inpBarangay",
      city: "inpCity",
      province: "inpProvince",
      postal: "inpPostal",
      details: "inpDetails",
      dept: "inpDept",
      roleOther: "inpRoleOther",
    };
  };

  const clearCheckoutFieldError = (fieldId) => {
    const field = document.getElementById(fieldId);
    if (!(field instanceof HTMLElement)) return;

    const group = field.closest(".form-group");
    if (!(group instanceof HTMLElement)) return;

    group.classList.remove("has-error");
    field.removeAttribute("aria-invalid");
  };

  const setCheckoutFieldError = (fieldId, message) => {
    const field = document.getElementById(fieldId);
    if (!(field instanceof HTMLElement)) return;

    const group = field.closest(".form-group");
    if (!(group instanceof HTMLElement)) return;

    let bubble = group.querySelector(".checkout-field-error-bubble");
    if (!(bubble instanceof HTMLElement)) {
      bubble = document.createElement("div");
      bubble.className = "checkout-field-error-bubble";
      bubble.setAttribute("role", "alert");
      group.appendChild(bubble);
    }

    bubble.textContent = String(message || "Please check this field.");
    group.classList.add("has-error");
    field.setAttribute("aria-invalid", "true");
  };

  const clearCheckoutFormErrors = (mode) => {
    const ids = getAddressFieldIds(mode);
    Object.values(ids).forEach((fieldId) => clearCheckoutFieldError(fieldId));
  };

  // ─── "Others" customer type in the Add / Edit Details forms ───────────────────
  // Same contract as appointment step 2: the radio grid stays the source of the
  // choice, and picking "Others" reveals one free-text box whose value is stored
  // as `Others: <text>` in the very same customer_type field. No new API field.

  const getRoleOtherIds = (mode) =>
    mode === "add"
      ? { field: "addInpRoleOtherField", input: "addInpRoleOther" }
      : { field: "inpRoleOtherField", input: "inpRoleOther" };

  const getRoleRadioName = (mode) =>
    mode === "add" ? "addUserRole" : "userRole";

  const isOtherCustomerType = (mode) =>
    getSelectedRole(getRoleRadioName(mode)) === "Others";

  /** Reveal the box only while Others is picked, and never keep a stale value. */
  const syncRoleOtherField = (mode) => {
    const { field, input } = getRoleOtherIds(mode);
    const wrapper = document.getElementById(field);
    const box = document.getElementById(input);
    if (!(wrapper instanceof HTMLElement) || !(box instanceof HTMLInputElement)) {
      return;
    }

    const showOther = isOtherCustomerType(mode);
    wrapper.style.display = showOther ? "" : "none";
    if (!showOther) {
      box.value = "";
      clearCheckoutFieldError(input);
    }
  };

  /**
   * Fill the radio grid from a stored customer_type. A saved
   * "Others: Local cooperative" checks Others and puts the remainder in the box,
   * so what the customer typed once is what they see next time.
   */
  const applyCustomerTypeToForm = (mode, value) => {
    const raw = String(value || "").trim();
    const otherMatch = raw.match(/^Others\s*:\s*(.*)$/i);
    const box = document.getElementById(getRoleOtherIds(mode).input);

    if (otherMatch || /^others$/i.test(raw)) {
      setRoleByRadioName(getRoleRadioName(mode), "Others");
      if (box instanceof HTMLInputElement) {
        box.value = String(otherMatch?.[1] || "").trim();
      }
    } else {
      setRoleByRadioName(getRoleRadioName(mode), raw || "Student");
      if (box instanceof HTMLInputElement) box.value = "";
    }

    syncRoleOtherField(mode);
  };

  /** The value saved to customer_type — `Others: <text>` when Others is picked. */
  const getCustomerTypeValue = (mode) => {
    const selected = getSelectedRole(getRoleRadioName(mode));
    if (selected !== "Others") return selected;

    const other = String(
      document.getElementById(getRoleOtherIds(mode).input)?.value || "",
    ).trim();
    return other ? `Others: ${other}` : "Others";
  };

  ["add", "edit"].forEach((mode) => {
    document
      .querySelectorAll(`input[name="${getRoleRadioName(mode)}"]`)
      .forEach((radio) => {
        radio.addEventListener("change", () => syncRoleOtherField(mode));
      });

    const otherInputId = getRoleOtherIds(mode).input;
    document
      .getElementById(otherInputId)
      ?.addEventListener("input", () =>
        clearCheckoutFieldError(otherInputId),
      );
  });

  // ─── PSGC address dropdowns for the Add / Edit Details forms ──────────────────
  // The same Region → Province → Municipality → Barangay chain as appointment
  // step 2, reusing its psgcGet()/setLoading() network layer further down this
  // file. One deliberate difference: each option's value is the place NAME and
  // the PSGC code rides in dataset.code, so validateAddressForm(),
  // normalizeAddressEntry() and the order payload keep reading plain names
  // exactly as they do today. Nothing about the saved shape changes.

  /**
   * Municipality → postal code. PSGC publishes no ZIPs, so this is curated:
   * every Camarines Norte municipality (the centre's own province) plus the
   * Bicol capitals. Keyed by province so a "San Vicente" elsewhere in the
   * country can never inherit Camarines Norte's code. A municipality that is
   * not listed simply leaves the field for the customer to type.
   */
  const PH_POSTAL_CODES = Object.freeze({
    "camarines norte": {
      daet: "4600",
      mercedes: "4601",
      talisay: "4602",
      "san vicente": "4603",
      "san lorenzo ruiz": "4604",
      labo: "4605",
      vinzons: "4606",
      capalonga: "4607",
      basud: "4608",
      "jose panganiban": "4610",
      paracale: "4611",
      "santa elena": "4612",
    },
    "camarines sur": { naga: "4400", pili: "4418", iriga: "4431" },
    albay: { legazpi: "4500", ligao: "4504", tabaco: "4511" },
    sorsogon: { sorsogon: "4700" },
    masbate: { masbate: "5400" },
    catanduanes: { virac: "4800" },
  });

  /** Compare place names loosely: "City of Naga", "Naga City" and "Naga" match. */
  const normalizePlaceKey = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/\(.*?\)/g, " ")
      .replace(/^city of\s+/, "")
      .replace(/\s+city$/, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const lookupPostalCode = (province, city) =>
    PH_POSTAL_CODES[normalizePlaceKey(province)]?.[normalizePlaceKey(city)] ||
    "";

  /** Fill a place select with { code, name } items — value is the name. */
  const fillPlaceSelect = (el, items, placeholder, keepDisabled = false) => {
    if (!(el instanceof HTMLSelectElement)) return;

    el.innerHTML = `<option value="" selected disabled hidden>${placeholder}</option>`;
    if (!Array.isArray(items) || items.length === 0) {
      el.disabled = true;
      return;
    }

    items.forEach(({ code, name }) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.dataset.code = code;
      opt.textContent = name;
      el.appendChild(opt);
    });
    el.disabled = keepDisabled;
  };

  /**
   * Select a saved place by name. When PSGC has no such option — a different
   * spelling, a renamed barangay, or the API being down — the name is added as
   * an option instead, because silently blanking a customer's saved province is
   * how a parcel goes to the wrong town.
   */
  const setPlaceSelect = (el, name) => {
    if (!(el instanceof HTMLSelectElement)) return false;

    const wanted = String(name || "").trim();
    if (!wanted) return false;

    const match = Array.from(el.options).find(
      (opt) => opt.value && normalizePlaceKey(opt.value) === normalizePlaceKey(wanted),
    );

    if (match) {
      el.value = match.value;
      el.disabled = false;
      return true;
    }

    const opt = document.createElement("option");
    opt.value = wanted;
    opt.textContent = wanted;
    el.appendChild(opt);
    el.value = wanted;
    el.disabled = false;
    return false;
  };

  /** The PSGC code behind the currently selected option, if it came from PSGC. */
  const selectedPlaceCode = (el) =>
    el instanceof HTMLSelectElement
      ? String(el.selectedOptions?.[0]?.dataset?.code || "")
      : "";

  /** Bicol. Tried first when resolving a saved province — most orders are local. */
  const BICOL_REGION_CODE = "0500000000";

  /**
   * Build the four-select cascade for one form mode ("add" or "edit").
   * Returns { hydrate } — everything else is wired internally, once.
   */
  const createPlaceCascade = (mode) => {
    const ids = getAddressFieldIds(mode);
    const el = (key) => document.getElementById(ids[key]);
    const postalHintId = mode === "add" ? "addInpPostalHint" : "inpPostalHint";

    // Guards a slow hydrate from filling the form after the customer has already
    // opened a different address.
    let hydrateToken = 0;

    const showPostalHint = (show) => {
      const hint = document.getElementById(postalHintId);
      if (hint instanceof HTMLElement) hint.style.display = show ? "" : "none";
    };

    /** Prefill the postal code from the picked municipality, still editable. */
    const fillPostalFromCity = () => {
      const postal = el("postal");
      if (!(postal instanceof HTMLInputElement)) return;

      const zip = lookupPostalCode(el("province")?.value, el("city")?.value);
      if (!zip) {
        showPostalHint(false);
        return;
      }

      postal.value = zip;
      clearCheckoutFieldError(ids.postal);
      showPostalHint(true);
    };

    /** Blank every select below the one that just changed. */
    const resetBelow = (from) => {
      if (from === "region") {
        fillPlaceSelect(el("province"), [], "Select Province", true);
      }
      if (from === "region" || from === "province") {
        fillPlaceSelect(el("city"), [], "Select Municipality", true);
      }
      fillPlaceSelect(el("barangay"), [], "Select Barangay", true);
    };

    const loadRegions = async () => {
      const region = el("region");
      if (!(region instanceof HTMLSelectElement)) return [];

      setLoading(region, "Region");
      const regions = await psgcGet(`${PSGC_BASE}/regions`);
      fillPlaceSelect(region, regions, "Select Region", false);
      return regions;
    };

    const loadProvinces = async (regionCode) => {
      setLoading(el("province"), "Province");
      const provinces = await psgcGet(
        `${PSGC_BASE}/regions/${regionCode}/provinces`,
      );
      fillPlaceSelect(el("province"), provinces, "Select Province", false);
      return provinces;
    };

    const loadCities = async (provinceCode) => {
      setLoading(el("city"), "Municipality");
      const cities = await psgcGet(
        `${PSGC_BASE}/provinces/${provinceCode}/cities-municipalities`,
      );
      fillPlaceSelect(el("city"), cities, "Select Municipality", false);
      return cities;
    };

    const loadBarangays = async (cityCode) => {
      setLoading(el("barangay"), "Barangay");
      const barangays = await psgcGet(
        `${PSGC_BASE}/cities-municipalities/${cityCode}/barangays`,
      );
      fillPlaceSelect(el("barangay"), barangays, "Select Barangay", false);
      return barangays;
    };

    /**
     * Find which region owns a saved province name. Bicol is tried on its own
     * first because almost every order is local — that is one request instead of
     * a scan; only an out-of-region address pays for the rest, and psgcGet caches
     * every answer for the session.
     */
    const findProvinceLocation = async (regions, provinceName) => {
      const wanted = normalizePlaceKey(provinceName);
      if (!wanted || !Array.isArray(regions) || regions.length === 0) return null;

      const match = (provinces, region) => {
        const hit = (provinces || []).find(
          (p) => normalizePlaceKey(p.name) === wanted,
        );
        return hit ? { region, province: hit, provinces } : null;
      };

      const bicol = regions.find((r) => r.code === BICOL_REGION_CODE);
      if (bicol) {
        const found = match(
          await psgcGet(`${PSGC_BASE}/regions/${bicol.code}/provinces`),
          bicol,
        );
        if (found) return found;
      }

      const others = regions.filter((r) => r.code !== BICOL_REGION_CODE);
      const lists = await Promise.all(
        others.map((r) => psgcGet(`${PSGC_BASE}/regions/${r.code}/provinces`)),
      );

      for (let i = 0; i < others.length; i += 1) {
        const found = match(lists[i], others[i]);
        if (found) return found;
      }
      return null;
    };

    /**
     * Re-select a saved address across the four dropdowns. Runs in the background
     * while the modal is already open, so nothing waits on the network.
     */
    const hydrate = async (source) => {
      const token = (hydrateToken += 1);
      const stale = () => token !== hydrateToken;

      const wantedProvince = String(source?.province || "").trim();
      const wantedCity = String(
        source?.city_municipality || source?.city || "",
      ).trim();
      const wantedBarangay = String(source?.barangay || "").trim();

      const regions = await loadRegions();
      if (stale()) return;
      resetBelow("region");
      showPostalHint(false);

      if (!wantedProvince && !wantedCity && !wantedBarangay) return;

      const located = await findProvinceLocation(regions, wantedProvince);
      if (stale()) return;

      // PSGC could not place the province: keep every saved name as-is so the
      // customer never loses an address to a third-party lookup.
      if (!located) {
        setPlaceSelect(el("province"), wantedProvince);
        setPlaceSelect(el("city"), wantedCity);
        setPlaceSelect(el("barangay"), wantedBarangay);
        return;
      }

      setPlaceSelect(el("region"), located.region.name);
      fillPlaceSelect(el("province"), located.provinces, "Select Province", false);
      setPlaceSelect(el("province"), located.province.name);

      const cities = await loadCities(located.province.code);
      if (stale()) return;

      const cityHit = cities.find(
        (c) => normalizePlaceKey(c.name) === normalizePlaceKey(wantedCity),
      );
      if (!cityHit) {
        setPlaceSelect(el("city"), wantedCity);
        setPlaceSelect(el("barangay"), wantedBarangay);
        return;
      }

      setPlaceSelect(el("city"), cityHit.name);
      await loadBarangays(cityHit.code);
      if (stale()) return;
      setPlaceSelect(el("barangay"), wantedBarangay);
    };

    el("region")?.addEventListener("change", async () => {
      hydrateToken += 1;
      clearCheckoutFieldError(ids.region);
      resetBelow("region");
      showPostalHint(false);

      const code = selectedPlaceCode(el("region"));
      if (code) await loadProvinces(code);
    });

    el("province")?.addEventListener("change", async () => {
      hydrateToken += 1;
      clearCheckoutFieldError(ids.province);
      resetBelow("province");
      showPostalHint(false);

      const code = selectedPlaceCode(el("province"));
      if (code) await loadCities(code);
    });

    el("city")?.addEventListener("change", async () => {
      hydrateToken += 1;
      clearCheckoutFieldError(ids.city);
      resetBelow("city");
      fillPostalFromCity();

      const code = selectedPlaceCode(el("city"));
      if (code) await loadBarangays(code);
    });

    el("barangay")?.addEventListener("change", () =>
      clearCheckoutFieldError(ids.barangay),
    );

    el("postal")?.addEventListener("input", () => showPostalHint(false));

    return { hydrate };
  };

  // One cascade per form, built on first use so the page pays nothing until a
  // customer actually opens an address form.
  const placeCascades = {};
  const getPlaceCascade = (mode) => {
    const key = mode === "add" ? "add" : "edit";
    if (!placeCascades[key]) placeCascades[key] = createPlaceCascade(key);
    return placeCascades[key];
  };

  const ensureSingleDefaultAddress = () => {
    if (!customerAddressBook.length) {
      selectedCheckoutAddressId = null;
      return;
    }

    let defaultIndex = customerAddressBook.findIndex(
      (entry) => entry.is_default,
    );
    if (defaultIndex < 0) {
      defaultIndex = 0;
      customerAddressBook[0].is_default = true;
    }

    customerAddressBook = customerAddressBook.map((entry, index) => ({
      ...entry,
      is_default: index === defaultIndex,
    }));

    const hasSelected = customerAddressBook.some(
      (entry) => String(entry.id) === String(selectedCheckoutAddressId),
    );
    if (!hasSelected) {
      selectedCheckoutAddressId =
        customerAddressBook[defaultIndex]?.id ||
        customerAddressBook[0]?.id ||
        null;
    }
  };

  const loadAddressBookFromStorage = () => {
    try {
      const raw = localStorage.getItem(getAddressStorageKey());
      const parsed = JSON.parse(raw || "[]");
      customerAddressBook = Array.isArray(parsed)
        ? parsed.map((entry) => normalizeAddressEntry(entry))
        : [];
    } catch {
      customerAddressBook = [];
    }

    ensureSingleDefaultAddress();
  };

  const saveAddressBookToStorage = () => {
    try {
      localStorage.setItem(
        getAddressStorageKey(),
        JSON.stringify(customerAddressBook),
      );
    } catch {
      // Ignore localStorage quota/write issues.
    }
  };

  const getSelectedCheckoutAddress = () => {
    if (!customerAddressBook.length) return null;

    const selected = customerAddressBook.find(
      (entry) => String(entry.id) === String(selectedCheckoutAddressId),
    );
    if (selected) return selected;

    return (
      customerAddressBook.find((entry) => entry.is_default) ||
      customerAddressBook[0] ||
      null
    );
  };

  /**
   * Collapse the checkout dropdown label to the code the API expects.
   * Returns "" when the customer has not chosen yet.
   */
  const normalizeCheckoutPaymentKey = (raw) => {
    const value = String(raw || "").toLowerCase();
    if (!value || value.includes("choose payment method")) return "";
    if (value.includes("gcash")) return "GCash";
    if (value.includes("pickup")) return "COP";
    if (value.includes("delivery")) return "COD";
    return "";
  };

  const getCheckoutPaymentKey = () =>
    normalizeCheckoutPaymentKey(
      document.querySelector("#checkoutModal .payment-select")?.value,
    );

  /**
   * Cash payments already answer "pickup or delivery": Cash on Pickup is paid
   * at the FMRC counter, Cash on Delivery is paid to the courier at the door.
   * GCash is prepaid and works either way, so it stays the customer's choice.
   */
  const getLockedFulfillmentForPayment = (paymentKey) => {
    if (paymentKey === "COP") return "pickup";
    if (paymentKey === "COD") return "delivery";
    return null;
  };

  const getSelectedFulfillmentType = () => {
    const locked = getLockedFulfillmentForPayment(getCheckoutPaymentKey());
    if (locked) return locked;

    if (fulfillPickupRadio?.checked) return "pickup";
    if (fulfillDeliveryRadio?.checked) return "delivery";
    return "";
  };

  /**
   * Keep the pickup/delivery block honest about the chosen payment method:
   * locked and explained for cash, open for GCash, and loud about an
   * incomplete address while delivery is selected.
   */
  const syncFulfillmentUi = () => {
    if (!fulfillPickupRadio || !fulfillDeliveryRadio) return;

    const paymentKey = getCheckoutPaymentKey();
    const locked = getLockedFulfillmentForPayment(paymentKey);
    const missing = getMissingAddressParts(getEffectiveCheckoutAddress());

    fulfillPickupRadio.disabled = Boolean(locked);
    fulfillDeliveryRadio.disabled = Boolean(locked);

    if (locked === "pickup") {
      fulfillPickupRadio.checked = true;
      fulfillDeliveryRadio.checked = false;
    } else if (locked === "delivery") {
      fulfillDeliveryRadio.checked = true;
      fulfillPickupRadio.checked = false;
    }

    if (!fulfillmentNote) return;

    let note = "";
    if (locked === "pickup") {
      note =
        "Cash on Pickup is collected at the FMRC office, so this order is set to pickup. No delivery address is needed.";
    } else if (locked === "delivery") {
      note =
        "Cash on Delivery is paid to the courier at your door, so this order is set to delivery. Complete delivery details are required.";
    } else if (!paymentKey) {
      note = "Choose a payment method first.";
    } else {
      note =
        "GCash is paid in advance, so you can either collect the order at FMRC or have it delivered.";
    }

    if (getSelectedFulfillmentType() === "delivery" && missing.length) {
      note += ` Your saved address is still missing: ${missing
        .map((part) => part.label)
        .join(", ")}.`;
    }

    fulfillmentNote.innerText = note;
    fulfillmentNote.hidden = false;
  };

  // ── GCash payment step ─────────────────────────────────────────────────────
  // FMRC collects GCash on the free "manual" rail: the centre's own QR and
  // number are shown, the customer pays from their own GCash app, and the
  // 13-digit reference number GCash prints is what staff match against the FMRC
  // account. There is no gateway call here, so nothing on this screen can claim
  // the money arrived - only that the customer says it did.
  const GCASH_REFERENCE_DIGITS = 13;
  // GCash registers this scheme, so a phone can be handed straight to the app.
  // A laptop has no app to open, which is the whole reason the QR exists.
  const GCASH_APP_SCHEME = "gcash://";
  let gcashOpenAppTimer = null;

  const getGcashSettings = () => {
    const published = window.FMRC_GCASH_SETTINGS;
    return {
      accountName: String(published?.accountName || "").trim(),
      accountNumber: String(published?.accountNumber || "").trim(),
      qrImage: String(published?.qrImage || "").trim(),
    };
  };

  /**
   * True when GCash can actually be paid: staff must have published a number to
   * send to, or a QR to scan. Without either there is nowhere for the money to
   * go, so the option is blocked rather than failing at submit.
   */
  const isGcashCollectionReady = () => {
    const settings = getGcashSettings();
    return Boolean(settings.accountNumber || settings.qrImage);
  };

  /**
   * Phone-or-laptop decides which half of the panel is useful. The UA string is
   * the only signal that survives a desktop browser resized narrow, so a coarse
   * pointer is required as well before we promise an app that is not there.
   */
  const isMobileCheckoutDevice = () => {
    const ua = String(navigator.userAgent || "");
    if (/Android|iPhone|iPod|IEMobile|Opera Mini/i.test(ua)) return true;
    // iPads report a desktop UA, so they are recognised by touch instead.
    const touchPoints = Number(navigator.maxTouchPoints || 0);
    if (/Macintosh/i.test(ua) && touchPoints > 1) return true;
    return (
      touchPoints > 0 &&
      window.matchMedia?.("(pointer: coarse)")?.matches === true
    );
  };

  const getNormalizedGcashReference = () =>
    String(gcashReferenceInput?.value || "").replace(/\D/g, "");

  /**
   * Build one numbered step. Segments flagged `strong` carry the amount and the
   * account number, which are the two things a mistyped payment turns on, so
   * they are set as text nodes rather than interpolated into markup.
   */
  const buildGcashStep = (segments) => {
    const li = document.createElement("li");
    segments.forEach((segment) => {
      if (typeof segment === "string") {
        li.appendChild(document.createTextNode(segment));
        return;
      }
      const strong = document.createElement("strong");
      strong.textContent = String(segment?.strong ?? "");
      li.appendChild(strong);
    });
    return li;
  };

  const renderGcashSteps = (isMobile, amountText, settings) => {
    if (!gcashSteps) return;
    gcashSteps.textContent = "";

    const sendTarget = settings.accountNumber
      ? [
          "Send ",
          { strong: amountText },
          " to ",
          { strong: settings.accountNumber },
          settings.accountName ? ` (${settings.accountName}).` : ".",
        ]
      : ["Send ", { strong: amountText }, " to the account in the QR code."];

    const steps = isMobile
      ? [
          ["Tap ", { strong: "Open the GCash app" }, ", then Send Money."],
          sendTarget,
          [
            "Copy the ",
            { strong: `${GCASH_REFERENCE_DIGITS}-digit Ref. No.` },
            " from your GCash receipt.",
          ],
          [
            "Paste it below, then place the order — or ",
            { strong: "place the order now" },
            " and pay from My Orders.",
          ],
        ]
      : [
          [
            "Open GCash on your phone and tap ",
            { strong: "Scan QR" },
            settings.qrImage
              ? " to scan the code above."
              : ", or use Send Money.",
          ],
          sendTarget,
          [
            "Copy the ",
            { strong: `${GCASH_REFERENCE_DIGITS}-digit Ref. No.` },
            " from your GCash receipt.",
          ],
          [
            "Type it below, then place the order — or ",
            { strong: "place the order now" },
            " and pay from My Orders.",
          ],
        ];

    steps.forEach((segments) => gcashSteps.appendChild(buildGcashStep(segments)));
  };

  /**
   * Show, hide and fill the GCash step. Called on every checkout re-render, so
   * an admin publishing a new QR mid-session reaches an already-open checkout on
   * the next settings poll instead of only after a reload.
   */
  const renderGcashSection = () => {
    if (!gcashPaymentSection) return;

    const isGcash = getCheckoutPaymentKey() === "GCash";
    gcashPaymentSection.hidden = !isGcash;
    if (!isGcash) {
      clearCheckoutFieldError("gcashReferenceInput");
      return;
    }

    const settings = getGcashSettings();
    const ready = isGcashCollectionReady();
    const isMobile = isMobileCheckoutDevice();
    const amountText =
      checkoutGrandTotal?.innerText?.trim() ||
      gcashAmountDue?.textContent?.trim() ||
      "₱0.00";

    if (gcashAmountDue) gcashAmountDue.textContent = amountText;
    if (gcashAccountNameEl)
      gcashAccountNameEl.textContent = settings.accountName || "—";
    if (gcashAccountNumberEl)
      gcashAccountNumberEl.textContent = settings.accountNumber || "—";
    if (gcashCopyNumberBtn)
      gcashCopyNumberBtn.hidden = !settings.accountNumber;

    // A saved QR is the centre's own GCash QR image. It cannot be generated
    // here: the QR Ph payload is issued to the merchant, not derived from a
    // phone number, so with no upload there is simply no code to show.
    const showQr = Boolean(settings.qrImage) && !isMobile;
    if (gcashQrBlock) gcashQrBlock.hidden = !showQr;
    if (showQr && gcashQrImage && gcashQrImage.src !== settings.qrImage) {
      gcashQrImage.src = settings.qrImage;
    }
    if (gcashQrDownload) gcashQrDownload.href = settings.qrImage || "#";

    // Opening GCash with nothing to send to would just strand the customer in
    // another app, so the button waits until FMRC has published a destination.
    const showOpenApp = isMobile && ready;
    if (gcashMobileBlock) gcashMobileBlock.hidden = !showOpenApp;
    if (gcashOpenAppHint && !showOpenApp) gcashOpenAppHint.textContent = "";

    renderGcashSteps(isMobile, amountText, settings);

    if (gcashUnconfiguredNote) {
      gcashUnconfiguredNote.textContent = ready
        ? ""
        : "FMRC has not published its GCash details yet, so there is nowhere to send the payment. Please choose Cash on Pickup or Cash on Delivery for now, or contact FMRC.";
      gcashUnconfiguredNote.hidden = ready;
    }
    if (gcashSteps) gcashSteps.hidden = !ready;
    // Promising a pay-later window while there is nowhere to send the money
    // would be worse than saying nothing, so it hides with the rest.
    if (gcashPayLaterNote) gcashPayLaterNote.hidden = !ready;
    if (gcashReferenceInput) gcashReferenceInput.disabled = !ready;
  };

  /**
   * The submit gate for GCash. Nothing here proves the money moved, and an
   * empty reference is not an error: the order is allowed through and waits in
   * "To Pay" until the customer submits the reference from My Orders. What it
   * still refuses is a *wrong* reference, which staff would have no way to
   * reconcile, and GCash with nowhere to send the money.
   */
  const validateGcashPaymentStep = () => {
    if (!isGcashCollectionReady()) {
      return {
        ok: false,
        title: "GCash Not Available Yet",
        message:
          "FMRC has not published its GCash number or QR code yet, so there is nowhere to send the payment. Please choose Cash on Pickup or Cash on Delivery.",
      };
    }

    const reference = getNormalizedGcashReference();

    // Paying later is a supported choice, not an omission.
    if (reference === "") {
      clearCheckoutFieldError("gcashReferenceInput");
      return { ok: true, reference: "" };
    }

    if (reference.length !== GCASH_REFERENCE_DIGITS) {
      const message = `That reference number has ${reference.length} digit${reference.length === 1 ? "" : "s"}. GCash reference numbers are ${GCASH_REFERENCE_DIGITS} digits long — check the "Ref. No." on your receipt, or clear the field and pay later from My Orders.`;
      setCheckoutFieldError("gcashReferenceInput", message);
      return {
        ok: false,
        title: "Check Your GCash Reference",
        message,
        focusReference: true,
      };
    }

    clearCheckoutFieldError("gcashReferenceInput");
    return { ok: true, reference };
  };

  if (gcashCopyNumberBtn) {
    gcashCopyNumberBtn.addEventListener("click", async () => {
      const number = getGcashSettings().accountNumber;
      if (!number) return;
      const original = gcashCopyNumberBtn.textContent;
      try {
        await navigator.clipboard.writeText(number);
        gcashCopyNumberBtn.textContent = "Copied";
      } catch {
        // Clipboard access is denied on insecure origins and in some in-app
        // browsers, so fall back to selecting the number for a manual copy.
        try {
          const range = document.createRange();
          range.selectNodeContents(gcashAccountNumberEl);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          gcashCopyNumberBtn.textContent = "Copy it";
        } catch {
          gcashCopyNumberBtn.textContent = "Copy it";
        }
      }
      window.setTimeout(() => {
        gcashCopyNumberBtn.textContent = original || "Copy";
      }, 1600);
    });
  }

  // Handing the phone to GCash is a convenience, not a payment request: the
  // manual rail has no gateway to build a pay-this-amount link from, so the app
  // opens on its own home screen and the steps above say what to do next.
  if (gcashOpenAppBtn) {
    gcashOpenAppBtn.addEventListener("click", () => {
      if (gcashOpenAppHint) gcashOpenAppHint.textContent = "Opening GCash…";
      window.clearTimeout(gcashOpenAppTimer);

      try {
        window.location.href = GCASH_APP_SCHEME;
      } catch {
        // Some browsers throw instead of ignoring an unknown scheme.
      }

      // If the app took over, this tab is hidden by the time the timer fires.
      // Still visible means the scheme went nowhere - most likely GCash is not
      // installed on this device - so say so instead of leaving "Opening…".
      gcashOpenAppTimer = window.setTimeout(() => {
        if (!gcashOpenAppHint) return;
        gcashOpenAppHint.textContent = document.hidden
          ? ""
          : "GCash did not open. Install or open the GCash app yourself, then send the amount to the number above.";
      }, 1500);
    });
  }

  if (gcashReferenceInput) {
    // GCash receipts are sometimes copied with spaces or dashes, so the field
    // keeps only digits and clears its own error as soon as 13 of them exist.
    gcashReferenceInput.addEventListener("input", () => {
      const digits = gcashReferenceInput.value
        .replace(/\D/g, "")
        .slice(0, GCASH_REFERENCE_DIGITS);
      if (gcashReferenceInput.value !== digits) gcashReferenceInput.value = digits;
      if (digits.length === GCASH_REFERENCE_DIGITS) {
        clearCheckoutFieldError("gcashReferenceInput");
      }
    });
  }

  // An admin can publish or change the GCash details while a checkout is open;
  // the settings poller announces it and the panel repaints in place.
  document.addEventListener("fmrc:gcash-settings", () => {
    renderGcashSection();
  });

  /**
   * The address the checkout will actually send: the selected book entry, with
   * the saved server profile filling any gap so a customer who only ever edited
   * their profile is not treated as having no address.
   */
  const getEffectiveCheckoutAddress = () => {
    const selected = getSelectedCheckoutAddress();
    const profile = customerCheckoutProfile || {};

    return normalizeAddressEntry({
      id: selected?.id || "profile",
      name:
        selected?.name ||
        profile.name ||
        customerSession.userInfo?.name ||
        "",
      phone_number: selected?.phone_number || profile.phone_number || "",
      address_line: selected?.address_line || profile.address_line || "",
      barangay: selected?.barangay || profile.barangay || "",
      city_municipality:
        selected?.city_municipality || profile.city_municipality || "",
      province: selected?.province || profile.province || "",
      postal_code: selected?.postal_code || profile.postal_code || "",
      address_details: selected?.address_details || profile.address_details || "",
      department: selected?.department || profile.department || "",
      customer_type: selected?.customer_type || profile.customer_type || "Student",
      is_default: Boolean(selected?.is_default),
    });
  };

  const renderCheckoutAddress = () => {
    const selected = getSelectedCheckoutAddress();
    const effective = getEffectiveCheckoutAddress();
    const name = effective.name || "No Name Provided";
    const department = effective.department || "Not set";
    const role = effective.customer_type || "Not set";
    const hasAnyAddress = Boolean(
      selected ||
        effective.address_line ||
        effective.barangay ||
        effective.city_municipality,
    );
    // A pickup order never ships, so the address is reference only: still shown,
    // but not flagged as blocking.
    const isPickupSelected = getSelectedFulfillmentType() === "pickup";

    if (displayClientName) displayClientName.innerText = name;
    if (displayClientPhone)
      displayClientPhone.innerText = getMaskedPhone(effective.phone_number);

    // Each part on its own row. A blank required part is shown as "Required"
    // in red rather than omitted, so the customer sees what is still missing.
    const partValues = {
      address_line: displayAddrStreet,
      barangay: displayAddrBarangay,
      city_municipality: displayAddrCity,
      province: displayAddrProvince,
      postal_code: displayAddrPostal,
      address_details: displayAddrLandmark,
    };

    REQUIRED_DELIVERY_PARTS.forEach((part) => {
      const node = partValues[part.key];
      if (!(node instanceof HTMLElement)) return;

      const value = String(effective[part.key] || "").trim();
      node.innerText = value || (isPickupSelected ? "Not set" : "Required");
      const row = node.closest(".client-address-row");
      if (row instanceof HTMLElement) {
        row.classList.toggle("is-missing", !value && !isPickupSelected);
      }
    });

    if (displayClientAddressGrid) {
      displayClientAddressGrid.hidden = !hasAnyAddress;
    }

    if (displayClientAddress) {
      displayClientAddress.innerText = hasAnyAddress
        ? buildAddressOneLine(effective) || "No saved address"
        : "No saved address yet. Add your details first.";
    }

    const missing = getMissingAddressParts(effective);
    if (displayClientAddressAlert) {
      if (isPickupSelected) {
        displayClientAddressAlert.hidden = false;
        displayClientAddressAlert.classList.add("is-info");
        displayClientAddressAlert.innerText =
          "Pickup order: collect it at the FMRC Office, University of Camarines Norte, Daet. Bring a valid ID and your pickup code.";
      } else if (missing.length) {
        displayClientAddressAlert.hidden = false;
        displayClientAddressAlert.classList.remove("is-info");
        displayClientAddressAlert.innerText = `Still missing: ${missing
          .map((part) => part.label)
          .join(", ")}. Complete it before choosing delivery.`;
      } else {
        displayClientAddressAlert.hidden = true;
        displayClientAddressAlert.classList.remove("is-info");
        displayClientAddressAlert.innerText = "";
      }
    }

    if (displayClientRole) displayClientRole.innerText = role;
    if (displayClientDept) displayClientDept.innerText = department;
    if (cartShortAddressText) {
      cartShortAddressText.innerText = getShortAddress(
        buildAddressOneLine(effective) || effective.address_details,
      );
    }

    syncFulfillmentUi();
  };

  const syncAddressEditUi = () => {
    if (!customerAddressBook.length) {
      isAddressEditMode = false;
      addressDeleteSelection.clear();
    }

    if (addressEditModeBtn) {
      addressEditModeBtn.innerText = isAddressEditMode ? "Done" : "Edit";
      addressEditModeBtn.disabled = !customerAddressBook.length;
    }

    if (addressSelectionFooter) {
      addressSelectionFooter.style.display = isAddressEditMode
        ? "flex"
        : "none";
    }

    const total = customerAddressBook.length;
    const selectedCount = addressDeleteSelection.size;

    if (selectAllAddressBtn) {
      selectAllAddressBtn.disabled = !isAddressEditMode || total === 0;
      selectAllAddressBtn.checked =
        isAddressEditMode && total > 0 && selectedCount === total;
      selectAllAddressBtn.indeterminate =
        isAddressEditMode && selectedCount > 0 && selectedCount < total;
    }

    if (deleteSelectedAddressBtn) {
      deleteSelectedAddressBtn.disabled =
        !isAddressEditMode || selectedCount === 0;
    }

    if (deleteAllAddressBtn) {
      deleteAllAddressBtn.disabled = !isAddressEditMode || total === 0;
    }
  };

  const renderAddressList = () => {
    if (!addressList) return;

    if (!customerAddressBook.length) {
      addressList.innerHTML = `
        <div class="address-item address-item-empty">
          <div class="address-item-left">
            <div class="a-address-text">No saved address yet. Tap <strong>Add details</strong> to create one.</div>
          </div>
        </div>
      `;
      syncAddressEditUi();
      return;
    }

    addressList.innerHTML = customerAddressBook
      .map((entry) => {
        const safeId = escapeCustomerHtml(entry.id);
        const isSelected =
          String(entry.id) === String(selectedCheckoutAddressId);
        const isChecked = addressDeleteSelection.has(String(entry.id));
        const oneLine = buildAddressOneLine(entry);
        const displayAddress = [oneLine, entry.address_details]
          .filter(Boolean)
          .map((part) => escapeCustomerHtml(part))
          .join("<br>");
        const missing = getMissingAddressParts(entry);

        return `
          <div class="address-item ${isSelected ? "selected" : ""} ${isAddressEditMode ? "select-mode" : ""}" data-address-id="${safeId}">
            <div class="address-item-main">
              <div class="address-edit-selector">
                <label class="cart-checkbox-container">
                  <input type="checkbox" class="address-edit-check" data-address-check="${safeId}" ${isChecked ? "checked" : ""}>
                  <span class="cart-checkmark"></span>
                </label>
              </div>

              <div class="address-item-left">
                <div class="address-name-row">
                  <span class="a-name">${escapeCustomerHtml(entry.name || "No Name Provided")}</span>
                  <span class="a-phone">${getMaskedPhone(entry.phone_number)}</span>
                </div>
                <div class="a-address-text">${displayAddress || "No saved address"}</div>
                <div class="a-badges">
                  ${entry.is_default ? '<span class="a-badge default-badge">Default</span>' : ""}
                  ${
                    missing.length
                      ? `<span class="a-badge incomplete-badge">Incomplete: ${escapeCustomerHtml(
                          missing.map((part) => part.label).join(", "),
                        )}</span>`
                      : ""
                  }
                </div>
              </div>

              ${
                isAddressEditMode
                  ? `<button class="delete-address-inline" type="button" data-address-delete="${safeId}">Delete</button>`
                  : `<div class="address-item-right"><button class="edit-address-btn" type="button" data-address-edit="${safeId}">Edit</button></div>`
              }
            </div>
          </div>
        `;
      })
      .join("");

    syncAddressEditUi();
  };

  /**
   * Recover what can be recovered from a one-line address saved before the
   * structured fields existed.
   *
   * Every customer who ordered before the address split has their whole address
   * sitting inside `address_line` - "Purok 6, Brgy. Masalong, Labo, Camarines
   * Norte, 4604" - and blank Barangay / City / Province / Postal boxes. Making
   * them retype what the system already knows is the kind of friction that loses
   * an order, so the parts that can be identified beyond doubt are lifted out.
   *
   * Deliberately timid: it only claims a barangay when the text says "Brgy." or
   * "Barangay", and only claims a city and province when what is left is two
   * clean comma-separated names. Anything else is left for the customer, because
   * a guessed province is printed on a parcel and misdelivers it. The saved
   * record is never touched - this only fills the form.
   */
  const splitLegacyAddressLine = (source) => {
    const line = String(source?.address_line || "").trim();
    const alreadyStructured = ["barangay", "city_municipality", "province", "postal_code"]
      .some((key) => String(source?.[key] || "").trim() !== "");

    if (!line || alreadyStructured || !line.includes(",")) {
      return source;
    }

    const tokens = line
      .split(",")
      .map((token) => token.trim())
      .filter(Boolean);

    let barangay = "";
    let postalCode = "";

    // The postal code is the only token that can be recognised on its own.
    const postalIndex = tokens.findIndex((token) => /^\d{4}$/.test(token));
    if (postalIndex >= 0) {
      postalCode = tokens[postalIndex];
      tokens.splice(postalIndex, 1);
    } else {
      // Often it is written without its own comma - "Camarines Norte 4600".
      const lastIndex = tokens.length - 1;
      const trailing = tokens[lastIndex].match(/^(.*\S)\s+(\d{4})$/);
      if (trailing) {
        tokens[lastIndex] = trailing[1];
        postalCode = trailing[2];
      }
    }

    const barangayIndex = tokens.findIndex((token) =>
      /^(?:brgy\.?|bgy\.?|barangay)\s+\S/i.test(token),
    );
    if (barangayIndex >= 0) {
      barangay = tokens[barangayIndex]
        .replace(/^(?:brgy\.?|bgy\.?|barangay)\s+/i, "")
        .trim();
      tokens.splice(barangayIndex, 1);
    }

    let city = "";
    let province = "";

    // A place name carries no digits and no street keyword. "Camarines Norte
    // Purok 6" fails both, which is exactly the case that must not be split.
    const looksLikePlaceName = (token) =>
      token.length <= 40 &&
      !/\d/.test(token) &&
      !/\b(?:st|st\.|street|ave|ave\.|avenue|rd|rd\.|road|purok|blk|block|unit|room|rm\.?|apt|floor|bldg|building)\b/i.test(
        token,
      );

    if (
      tokens.length >= 3 &&
      looksLikePlaceName(tokens[tokens.length - 1]) &&
      looksLikePlaceName(tokens[tokens.length - 2])
    ) {
      province = tokens.pop();
      city = tokens.pop();
    }

    const street = tokens.join(", ").trim();

    return {
      ...source,
      address_line: street || line,
      barangay: barangay || source?.barangay || "",
      city_municipality: city || source?.city_municipality || "",
      province: province || source?.province || "",
      postal_code: postalCode || source?.postal_code || "",
    };
  };

  /**
   * Fill one address form from a saved entry.
   *
   * `hydratePlaces` is off for the page-load priming pass: the PSGC chain costs
   * real requests and its helpers are declared further down this file, so it is
   * only ever run from a modal-open path — every one of which calls this again.
   */
  const applyAddressToForm = (mode, addressEntry, { hydratePlaces = true } = {}) => {
    const source = splitLegacyAddressLine(addressEntry || {});
    const isAddMode = mode === "add";

    // The four place selects fill themselves in the background — the modal opens
    // straight away and the chain lands a moment later.
    if (hydratePlaces) void getPlaceCascade(mode).hydrate(source);

    if (isAddMode) {
      if (addInpFullName) {
        addInpFullName.value =
          source.name || customerSession.userInfo?.name || "";
      }
      if (addInpPhone) addInpPhone.value = source.phone_number || "";
      if (addInpAddress) addInpAddress.value = source.address_line || "";
      if (addInpPostal) addInpPostal.value = source.postal_code || "";
      if (addInpDetails) addInpDetails.value = source.address_details || "";
      if (addInpDept) addInpDept.value = source.department || "";
      if (addInpSetDefault) {
        addInpSetDefault.checked =
          customerAddressBook.length === 0 || Boolean(source.is_default);
      }
      applyCustomerTypeToForm("add", source.customer_type || "Student");
      return;
    }

    if (inpFullName)
      inpFullName.value = source.name || customerSession.userInfo?.name || "";
    if (inpPhone) inpPhone.value = source.phone_number || "";
    if (inpAddress) inpAddress.value = source.address_line || "";
    if (inpPostal) inpPostal.value = source.postal_code || "";
    if (inpDetails) inpDetails.value = source.address_details || "";
    if (inpDept) inpDept.value = source.department || "";
    if (inpSetDefault) inpSetDefault.checked = Boolean(source.is_default);
    applyCustomerTypeToForm("edit", source.customer_type || "Student");
  };

  const validateAddressForm = (mode) => {
    const ids = getAddressFieldIds(mode);
    const isAddMode = mode === "add";

    clearCheckoutFormErrors(mode);

    const readField = (fieldKey) =>
      String(document.getElementById(ids[fieldKey])?.value || "").trim();

    const nameInput = document.getElementById(ids.name);
    const phoneInput = document.getElementById(ids.phone);

    const name = String(nameInput?.value || "").trim();
    const phone = normalizePhoneDigits(phoneInput?.value || "");
    const addressLine = readField("address");
    const region = readField("region");
    const barangay = readField("barangay");
    const city = readField("city");
    const province = readField("province");
    const postalCode = readField("postal").replace(/\D/g, "").slice(0, 4);
    const addressDetails = readField("details");
    const department = readField("dept");
    const customerType = getCustomerTypeValue(mode);
    const setDefault = isAddMode
      ? Boolean(addInpSetDefault?.checked)
      : Boolean(inpSetDefault?.checked);

    if (phoneInput instanceof HTMLInputElement) {
      phoneInput.value = phone;
    }

    const postalInput = document.getElementById(ids.postal);
    if (postalInput instanceof HTMLInputElement) {
      postalInput.value = postalCode;
    }

    let firstInvalidInput = null;
    let firstInvalidField = null;

    const registerError = (fieldId, message) => {
      setCheckoutFieldError(fieldId, message);
      const field = document.getElementById(fieldId);
      if (!firstInvalidField) firstInvalidField = field;
      // A place select below an unpicked one is still disabled, and a disabled
      // control cannot take focus — so the first *focusable* invalid field wins
      // the focus while the first invalid field still decides the scroll target.
      if (!firstInvalidInput && field instanceof HTMLElement && !field.disabled) {
        firstInvalidInput = field;
      }
    };

    if (!name) {
      registerError(ids.name, "Please enter your full name.");
    }

    if (!phone) {
      registerError(ids.phone, "Please enter your mobile number.");
    } else if (!/^9\d{9,10}$/.test(phone)) {
      registerError(
        ids.phone,
        "Use a valid PH number after +63. Example: 9XXXXXXXXX.",
      );
    }

    // Every address part is required. A courier cannot deliver to a partial
    // address, and a half-saved one only fails later at checkout.
    if (!addressLine) {
      registerError(
        ids.address,
        "Please enter the house/unit number and street.",
      );
    }

    // The region select is only enforced once it actually holds options: if PSGC
    // is unreachable the chain stays empty, and a customer must still be able to
    // save an address the modal hydrated from their saved record.
    const regionSelect = document.getElementById(ids.region);
    const hasRegionOptions =
      regionSelect instanceof HTMLSelectElement &&
      Array.from(regionSelect.options).some((opt) => opt.value);

    if (!region && hasRegionOptions) {
      registerError(ids.region, "Please select your region.");
    }

    if (!barangay) {
      registerError(ids.barangay, "Please select your barangay.");
    }

    if (!city) {
      registerError(ids.city, "Please select your city or municipality.");
    }

    if (!province) {
      registerError(ids.province, "Please select your province.");
    }

    if (!postalCode) {
      registerError(ids.postal, "Please enter your 4-digit postal code.");
    } else if (postalCode.length !== 4) {
      registerError(
        ids.postal,
        "A Philippine postal code is exactly 4 digits (Daet is 4600).",
      );
    }

    if (!addressDetails) {
      registerError(
        ids.details,
        "Please add a landmark or a detail like room or unit.",
      );
    }

    if (!department) {
      registerError(ids.dept, "Please enter your department or organization.");
    }

    // Same rules the appointment form applies to its own Others box, so one
    // customer filling both forms is judged by one standard. The 100-character
    // cap is the input's maxlength: the value is saved as `Others: <text>` and
    // the prefix eats 8 of the server's 120.
    if (isOtherCustomerType(mode)) {
      const otherType = readField("roleOther");
      if (!otherType) {
        registerError(ids.roleOther, "Please specify your type of client.");
      } else if (otherType.length > 100) {
        registerError(
          ids.roleOther,
          "Type of client must not exceed 100 characters.",
        );
      } else if (!/^[A-Za-z0-9 .,'()\/&-]+$/.test(otherType)) {
        registerError(
          ids.roleOther,
          "Type of client is invalid. Use letters, numbers and basic punctuation only.",
        );
      }
    }

    if (firstInvalidField instanceof HTMLElement) {
      firstInvalidField.scrollIntoView({ block: "center", behavior: "smooth" });
      if (firstInvalidInput instanceof HTMLElement) firstInvalidInput.focus();
      return null;
    }

    return {
      entry: normalizeAddressEntry({
        name,
        phone_number: phone,
        address_line: addressLine,
        barangay,
        city_municipality: city,
        province,
        postal_code: postalCode,
        address_details: addressDetails,
        department,
        customer_type: customerType || "Student",
        is_default: setDefault,
      }),
    };
  };

  const applyServerAddressErrors = (mode, errors, fallbackMessage) => {
    const ids = getAddressFieldIds(mode);
    let didSetFieldError = false;

    const pushFieldError = (fieldId, message) => {
      if (!message) return;
      setCheckoutFieldError(fieldId, message);
      didSetFieldError = true;
    };

    if (errors && typeof errors === "object") {
      pushFieldError(ids.name, errors.name?.[0]);
      pushFieldError(ids.phone, errors.phone_number?.[0]);
      pushFieldError(ids.address, errors.address_line?.[0]);
      pushFieldError(ids.region, errors.region?.[0]);
      pushFieldError(ids.barangay, errors.barangay?.[0]);
      pushFieldError(ids.city, errors.city_municipality?.[0]);
      pushFieldError(ids.province, errors.province?.[0]);
      pushFieldError(ids.postal, errors.postal_code?.[0]);
      pushFieldError(ids.details, errors.address_details?.[0]);
      pushFieldError(ids.dept, errors.department?.[0]);
      // A customer_type complaint belongs on the Others box whenever that box is
      // what produced the value; otherwise it stays on the department field, as
      // the radio grid itself has no error slot of its own.
      pushFieldError(
        isOtherCustomerType(mode) ? ids.roleOther : ids.dept,
        errors.customer_type?.[0],
      );
    }

    if (!didSetFieldError && fallbackMessage) {
      pushFieldError(ids.address, fallbackMessage);
    }
  };

  const syncProfileFromAddress = async (addressEntry) => {
    const token =
      customerSession.token || localStorage.getItem("customer_token") || "";
    if (!token) {
      return {
        ok: false,
        message: "Login session not found. Please sign in again.",
      };
    }

    const payload = {
      name: addressEntry?.name || customerSession.userInfo?.name || null,
      phone_number: addressEntry?.phone_number || null,
      address_line: addressEntry?.address_line || null,
      barangay: addressEntry?.barangay || null,
      city_municipality: addressEntry?.city_municipality || null,
      province: addressEntry?.province || null,
      postal_code: addressEntry?.postal_code || null,
      address_details: addressEntry?.address_details || null,
      department: addressEntry?.department || null,
      customer_type: addressEntry?.customer_type || "Student",
    };

    try {
      const response = await fetchWithTimeout(
        `${API_BASE_URL}/customer/profile`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        },
      );

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          ok: false,
          message: result?.message || "Unable to save your details right now.",
          errors: result?.errors || null,
        };
      }

      customerCheckoutProfile = result?.data || {
        ...(customerCheckoutProfile || {}),
        ...payload,
      };

      if (customerSession.userInfo && customerCheckoutProfile?.name) {
        customerSession.userInfo.name = customerCheckoutProfile.name;
        try {
          localStorage.setItem(
            "customer_info",
            JSON.stringify(customerSession.userInfo),
          );
        } catch {
          // Ignore storage write issues.
        }
      }

      return {
        ok: true,
      };
    } catch (error) {
      // A network failure surfaces as the raw "Failed to fetch", which means
      // nothing to a customer, so say what actually went wrong.
      const isOffline =
        error?.name === "TypeError" || /failed to fetch/i.test(error?.message || "");

      return {
        ok: false,
        message: isOffline
          ? "Cannot reach the server. Check your connection and try again."
          : error?.message || "Unable to save your details right now.",
      };
    }
  };

  const setSelectedAddress = (addressId, markAsDefault = false) => {
    const id = String(addressId || "");
    if (!id) return;

    selectedCheckoutAddressId = id;
    if (!markAsDefault) return;

    customerAddressBook = customerAddressBook.map((entry) => ({
      ...entry,
      is_default: String(entry.id) === id,
    }));
  };

  const removeAddressesByIds = async (addressIds, message, title) => {
    const idsToRemove = Array.from(
      new Set((addressIds || []).map((id) => String(id || "")).filter(Boolean)),
    );
    if (!idsToRemove.length) return;

    const confirmed = await showCustomerPopup(message, {
      title,
      isConfirm: true,
      okText: "Delete",
      cancelText: "Cancel",
    });

    if (!confirmed) return;

    customerAddressBook = customerAddressBook.filter(
      (entry) => !idsToRemove.includes(String(entry.id)),
    );
    addressDeleteSelection.clear();
    ensureSingleDefaultAddress();
    saveAddressBookToStorage();
    renderAddressList();
    renderCheckoutAddress();
    applyAddressToForm(
      "edit",
      getSelectedCheckoutAddress() || customerCheckoutProfile,
      { hydratePlaces: false },
    );
    applyAddressToForm(
      "add",
      getSelectedCheckoutAddress() || customerCheckoutProfile,
      { hydratePlaces: false },
    );

    if (!customerAddressBook.length) {
      isAddressEditMode = false;
    }

    const profileSyncResult = await syncProfileFromAddress(
      getSelectedCheckoutAddress(),
    );
    if (profileSyncResult.ok) {
      emitCustomerOrdersUpdated({ type: "profile-updated" });
    }

    renderAddressList();
  };

  const setAddressEditMode = (nextMode) => {
    isAddressEditMode = Boolean(nextMode) && customerAddressBook.length > 0;
    addressDeleteSelection.clear();
    renderAddressList();
  };

  const openEditAddressModal = (addressId) => {
    const target = customerAddressBook.find(
      (entry) => String(entry.id) === String(addressId),
    );
    if (!target || !editInfoModal) return;

    editingCheckoutAddressId = String(target.id);
    clearCheckoutFormErrors("edit");
    applyAddressToForm("edit", target);
    editInfoModal.classList.add("show-modal");
  };

  const openAddAddressModal = () => {
    if (!addInfoModal) return;

    const selected = getSelectedCheckoutAddress() || customerCheckoutProfile;
    clearCheckoutFormErrors("add");
    applyAddressToForm("add", {
      ...(selected || {}),
      address_line: "",
      address_details: "",
      is_default: customerAddressBook.length === 0,
    });

    addInfoModal.classList.add("show-modal");
  };

  /**
   * Send the customer straight to the form that can fix an incomplete address.
   * Edits the saved entry when there is one; otherwise opens the add form
   * prefilled with whatever we already know, so nothing is retyped.
   */
  const openAddressCompletionModal = (fallbackEntry) => {
    const selected = getSelectedCheckoutAddress();
    if (selected) {
      openEditAddressModal(selected.id);
      return;
    }

    if (!addInfoModal) return;

    clearCheckoutFormErrors("add");
    applyAddressToForm("add", {
      ...(fallbackEntry || customerCheckoutProfile || {}),
      is_default: customerAddressBook.length === 0,
    });
    addInfoModal.classList.add("show-modal");
  };

  const saveAddressFromModal = async (mode) => {
    const validated = validateAddressForm(mode);
    if (!validated) return false;

    const isAddMode = mode === "add";
    const confirmMessage = isAddMode
      ? "Save this new address?"
      : "Update this address?";

    const confirmed = await showCustomerPopup(confirmMessage, {
      title: isAddMode ? "Confirm Save" : "Confirm Update",
      isConfirm: true,
      okText: isAddMode ? "Save" : "Update",
      cancelText: "Cancel",
    });

    if (!confirmed) return false;

    if (isAddMode) {
      const nextEntry = {
        ...validated.entry,
        id: createAddressId(),
        is_default:
          customerAddressBook.length === 0 ||
          Boolean(validated.entry.is_default),
      };

      if (nextEntry.is_default) {
        customerAddressBook = customerAddressBook.map((entry) => ({
          ...entry,
          is_default: false,
        }));
      }

      customerAddressBook.push(nextEntry);
      setSelectedAddress(nextEntry.id, nextEntry.is_default);
    } else {
      if (!editingCheckoutAddressId) {
        applyServerAddressErrors(
          "edit",
          null,
          "Choose an address first, then try again.",
        );
        return false;
      }

      customerAddressBook = customerAddressBook.map((entry) => {
        if (String(entry.id) !== String(editingCheckoutAddressId)) {
          return validated.entry.is_default
            ? { ...entry, is_default: false }
            : entry;
        }

        return {
          ...entry,
          ...validated.entry,
          id: entry.id,
        };
      });

      setSelectedAddress(
        editingCheckoutAddressId,
        Boolean(validated.entry.is_default),
      );
    }

    ensureSingleDefaultAddress();
    saveAddressBookToStorage();
    renderAddressList();
    renderCheckoutAddress();
    applyAddressToForm(
      "edit",
      getSelectedCheckoutAddress() || customerCheckoutProfile,
      { hydratePlaces: false },
    );
    applyAddressToForm(
      "add",
      getSelectedCheckoutAddress() || customerCheckoutProfile,
      { hydratePlaces: false },
    );

    const syncResult = await syncProfileFromAddress(
      getSelectedCheckoutAddress(),
    );
    if (!syncResult.ok) {
      applyServerAddressErrors(
        mode,
        syncResult.errors,
        syncResult.message || "Unable to save your details.",
      );
      return false;
    }

    emitCustomerOrdersUpdated({ type: "profile-updated" });
    return true;
  };

  const seedAddressBookFromProfile = (profile) => {
    const hasSeedData = Boolean(
      profile?.name ||
      profile?.phone_number ||
      profile?.address_line ||
      profile?.address_details ||
      profile?.department,
    );

    if (!hasSeedData || customerAddressBook.length) return;

    const seeded = normalizeAddressEntry({
      id: createAddressId(),
      name: profile?.name || customerSession.userInfo?.name || "",
      phone_number: profile?.phone_number || "",
      address_line: profile?.address_line || "",
      barangay: profile?.barangay || "",
      city_municipality: profile?.city_municipality || "",
      province: profile?.province || "",
      postal_code: profile?.postal_code || "",
      address_details: profile?.address_details || "",
      department: profile?.department || "",
      customer_type: profile?.customer_type || "Student",
      is_default: true,
    });

    customerAddressBook = [seeded];
    selectedCheckoutAddressId = seeded.id;
    saveAddressBookToStorage();
  };

  const fetchCustomerCheckoutProfile = async () => {
    const token =
      customerSession.token || localStorage.getItem("customer_token") || "";
    if (!token) return;

    try {
      const response = await fetchWithTimeout(
        `${API_BASE_URL}/customer/profile`,
        {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
          },
        },
      );

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        return;
      }

      customerCheckoutProfile = payload?.data || null;
      seedAddressBookFromProfile(customerCheckoutProfile);
      ensureSingleDefaultAddress();
      renderAddressList();
      renderCheckoutAddress();
      // Priming only: re-running the PSGC chain here could land while the
      // customer is already picking their own municipality in an open modal.
      applyAddressToForm(
        "edit",
        getSelectedCheckoutAddress() || customerCheckoutProfile,
        { hydratePlaces: false },
      );
      applyAddressToForm(
        "add",
        getSelectedCheckoutAddress() || customerCheckoutProfile,
        { hydratePlaces: false },
      );
    } catch {
      // Keep UI usable with local/session fallback values.
    }
  };

  [inpPhone, addInpPhone].forEach((phoneInput) => {
    phoneInput?.addEventListener("input", () => {
      phoneInput.value = normalizePhoneDigits(phoneInput.value);
    });
  });

  if (openAddAddressBtn && addInfoModal) {
    openAddAddressBtn.addEventListener("click", () => {
      openAddAddressModal();
    });
  }

  if (addressEditModeBtn) {
    addressEditModeBtn.addEventListener("click", () => {
      setAddressEditMode(!isAddressEditMode);
    });
  }

  if (selectAllAddressBtn) {
    selectAllAddressBtn.addEventListener("change", () => {
      addressDeleteSelection.clear();
      if (selectAllAddressBtn.checked) {
        customerAddressBook.forEach((entry) => {
          addressDeleteSelection.add(String(entry.id));
        });
      }
      renderAddressList();
    });
  }

  if (deleteSelectedAddressBtn) {
    deleteSelectedAddressBtn.addEventListener("click", () => {
      void removeAddressesByIds(
        Array.from(addressDeleteSelection),
        "Delete selected address details?",
        "Delete Selected",
      );
    });
  }

  if (deleteAllAddressBtn) {
    deleteAllAddressBtn.addEventListener("click", () => {
      void removeAddressesByIds(
        customerAddressBook.map((entry) => entry.id),
        "Delete all saved addresses?",
        "Delete All",
      );
    });
  }

  if (addressList) {
    addressList.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      const deleteBtn = target.closest("[data-address-delete]");
      if (deleteBtn) {
        const addressId = String(
          deleteBtn.getAttribute("data-address-delete") || "",
        );
        void removeAddressesByIds(
          [addressId],
          "Delete this saved address?",
          "Delete Address",
        );
        return;
      }

      const checkInput = target.closest(".address-edit-check");
      if (checkInput instanceof HTMLInputElement) {
        const checkId = String(
          checkInput.getAttribute("data-address-check") || "",
        );
        if (!checkId) return;

        if (checkInput.checked) {
          addressDeleteSelection.add(checkId);
        } else {
          addressDeleteSelection.delete(checkId);
        }
        syncAddressEditUi();
        return;
      }

      const editBtn = target.closest("[data-address-edit]");
      if (editBtn) {
        const editId = String(editBtn.getAttribute("data-address-edit") || "");
        openEditAddressModal(editId);
        return;
      }

      const item = target.closest(".address-item");
      if (!(item instanceof HTMLElement)) return;
      const addressId = String(item.getAttribute("data-address-id") || "");
      if (!addressId) return;

      if (isAddressEditMode) {
        if (addressDeleteSelection.has(addressId)) {
          addressDeleteSelection.delete(addressId);
        } else {
          addressDeleteSelection.add(addressId);
        }
        renderAddressList();
        return;
      }

      setSelectedAddress(addressId, true);
      ensureSingleDefaultAddress();
      saveAddressBookToStorage();
      renderAddressList();
      renderCheckoutAddress();
      addressSelectionModal?.classList.remove("show-modal");

      void (async () => {
        const syncResult = await syncProfileFromAddress(
          getSelectedCheckoutAddress(),
        );
        if (syncResult.ok) {
          emitCustomerOrdersUpdated({ type: "profile-updated" });
        }
      })();
    });
  }

  if (backToAddressBtn) {
    backToAddressBtn.addEventListener("click", () => {
      editInfoModal?.classList.remove("show-modal");
    });
  }

  if (backToAddressFromAddBtn && addInfoModal) {
    backToAddressFromAddBtn.addEventListener("click", () => {
      addInfoModal.classList.remove("show-modal");
    });
  }

  if (saveInfoBtn) {
    saveInfoBtn.addEventListener("click", async () => {
      const saved = await saveAddressFromModal("edit");
      if (!saved) return;
      editInfoModal?.classList.remove("show-modal");
    });
  }

  if (saveNewInfoBtn && addInfoModal) {
    saveNewInfoBtn.addEventListener("click", async () => {
      const saved = await saveAddressFromModal("add");
      if (!saved) return;
      addInfoModal.classList.remove("show-modal");
      setAddressEditMode(false);
    });
  }

  loadAddressBookFromStorage();
  renderAddressList();
  renderCheckoutAddress();
  applyAddressToForm(
    "edit",
    getSelectedCheckoutAddress() || customerCheckoutProfile,
    { hydratePlaces: false },
  );
  applyAddressToForm(
    "add",
    getSelectedCheckoutAddress() || customerCheckoutProfile,
    { hydratePlaces: false },
  );
  if (!isGuestUser) {
    void fetchCustomerCheckoutProfile();
  }

  // Changing the payment method can lock pickup/delivery, and changing
  // pickup/delivery changes whether the address block is even relevant, so both
  // re-render the summary. The payment method also decides whether the GCash
  // step is on screen at all.
  document
    .querySelector("#checkoutModal .payment-select")
    ?.addEventListener("change", () => {
      renderCheckoutAddress();
      renderGcashSection();
    });

  [fulfillPickupRadio, fulfillDeliveryRadio].forEach((radio) => {
    radio?.addEventListener("change", () => {
      renderCheckoutAddress();
    });
  });

  renderGcashSection();

  // Submit Order logic
  const submitOrderBtn = document.getElementById("submitOrderBtn");
  if (submitOrderBtn) {
    submitOrderBtn.addEventListener("click", async function (event) {
      event?.preventDefault();
      const terms = document.getElementById("orderTerms");
      if (terms && !terms.checked) {
        await showCustomerPopup(
          "Please check the terms and payment agreement box first.",
          {
            title: "Validation",
          },
        );
        return;
      }

      const paymentSelect = document.querySelector(
        "#checkoutModal .payment-select",
      );
      const paymentMethod = String(paymentSelect?.value || "").trim();
      const paymentKey = getCheckoutPaymentKey();
      if (!paymentKey) {
        await showCustomerPopup("Please choose a payment method first.", {
          title: "Validation",
        });
        return;
      }

      // GCash is paid before the order exists, so the reference number that
      // proves it has to be on the form. The server refuses the order without
      // one too; this only turns that 422 into a pointed message.
      let gcashReference = "";
      if (paymentKey === "GCash") {
        const gcashCheck = validateGcashPaymentStep();
        if (!gcashCheck.ok) {
          await showCustomerPopup(gcashCheck.message, {
            title: gcashCheck.title,
          });
          if (gcashCheck.focusReference) {
            gcashReferenceInput?.scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
            gcashReferenceInput?.focus();
          }
          return;
        }
        gcashReference = gcashCheck.reference;
      }

      // Pickup vs delivery decides whether an address is needed at all, so it
      // has to be settled before the address is validated.
      const fulfillmentType = getSelectedFulfillmentType();
      if (!fulfillmentType) {
        await showCustomerPopup(
          "Please choose whether you will pick this order up at FMRC or have it delivered.",
          { title: "Pickup or Delivery" },
        );
        fulfillPickupRadio?.focus();
        return;
      }

      const effectiveAddress = getEffectiveCheckoutAddress();

      if (fulfillmentType === "delivery") {
        const missingParts = getMissingAddressParts(effectiveAddress);
        const missingContact = !String(
          effectiveAddress.phone_number || "",
        ).trim();

        if (missingParts.length || missingContact) {
          const missingLabels = [
            ...(missingContact ? ["Mobile number"] : []),
            ...missingParts.map((part) => part.label),
          ].join(", ");

          await showCustomerPopup(
            `A courier delivery needs your complete address. Still missing: ${missingLabels}.`,
            { title: "Complete Your Delivery Details" },
          );
          openAddressCompletionModal(effectiveAddress);
          return;
        }
      } else if (!String(effectiveAddress.phone_number || "").trim()) {
        await showCustomerPopup(
          "Please add your mobile number so we can text you when the order is ready for pickup.",
          { title: "Contact Number Required" },
        );
        openAddressCompletionModal(effectiveAddress);
        return;
      }

      const useCartCheckout =
        currentCheckoutMode === "cart" &&
        Array.isArray(currentCheckoutItems) &&
        currentCheckoutItems.length > 0;

      const quantity = useCartCheckout
        ? currentCheckoutItems.reduce(
            (sum, item) =>
              sum +
              Math.max(1, Number.parseInt(item?.quantity || "1", 10) || 1),
            0,
          )
        : Math.max(1, Number.parseInt(inputQty?.value || "1", 10) || 1);

      const totalText =
        checkoutGrandTotal?.innerText || checkoutPrice?.innerText || "₱0.00";
      const parsedDisplayedTotal = Number.isFinite(parsePrice(totalText))
        ? parsePrice(totalText)
        : 0;
      const totalAmount = useCartCheckout
        ? currentCheckoutItems.reduce((sum, item) => {
            const qty = Math.max(
              1,
              Number.parseInt(item?.quantity || "1", 10) || 1,
            );
            const lineTotal = Number(item?.line_total);
            if (Number.isFinite(lineTotal) && lineTotal >= 0) {
              return sum + lineTotal;
            }
            const unitPrice = Number(item?.unit_price || 0);
            return sum + (Number.isFinite(unitPrice) ? unitPrice * qty : 0);
          }, 0)
        : parsedDisplayedTotal;

      const originalText = this.innerText;
      this.disabled = true;
      this.innerText = "Processing...";

      /* The hint earns its place here: the server sends the confirmation email
         inside this request, which is why the timeout below is 25s and not 15s.
         The curtain also covers the checkout modal taking itself apart on the
         success path, so the last thing the visitor sees is the mark, not a
         form dismantling itself. */
      window.FMRCLoader?.show(
        "Placing your order",
        "This can take a moment. Please keep this tab open.",
      );

      try {
        const token = getCustomerToken() || customerSession.token || "";
        if (!token) {
          throw new Error("Login session not found. Please sign in again.");
        }

        const contactNumber = String(
          effectiveAddress.phone_number || "",
        ).replace(/\D/g, "");
        const isPickupOrder = fulfillmentType === "pickup";
        const orderNotes = [
          isPickupOrder ? "" : buildAddressOneLine(effectiveAddress),
          effectiveAddress.address_details,
          effectiveAddress.department
            ? `Department: ${effectiveAddress.department}`
            : "",
          effectiveAddress.customer_type
            ? `Role: ${effectiveAddress.customer_type}`
            : "",
        ]
          .filter(Boolean)
          .join(" | ");

        const customerName =
          effectiveAddress.name ||
          customerCheckoutProfile?.name ||
          customerSession.userInfo?.name ||
          customerSession.userInfo?.username ||
          customerSession.userInfo?.email ||
          "Customer";

        const customerContact = contactNumber
          ? `+63${contactNumber}`
          : customerSession.userInfo?.email || "N/A";

        const basePayload = {
          payment_method: paymentMethod,
          customer_name: customerName,
          customer_contact: customerContact,
          notes: orderNotes,
          fulfillment_type: fulfillmentType,
        };

        // The reference the customer read off their GCash receipt. It is a
        // claim, not a confirmation: the order still waits at "To Pay" until
        // staff match it in the FMRC GCash account.
        if (gcashReference) {
          basePayload.payment_reference = gcashReference;
        }

        // A pickup order has no destination to ship to: the server pins the
        // location to the FMRC office, so we send no address and no courier.
        if (!isPickupOrder) {
          Object.assign(basePayload, {
            location_name: buildAddressOneLine(effectiveAddress) || null,
            // Courier deliberately left out: config/couriers.php holds the
            // default, so the checkout cannot drift from the admin dropdown.

            delivery_recipient_name: customerName,
            delivery_contact_no: contactNumber ? `+63${contactNumber}` : "",
            delivery_street: effectiveAddress.address_line || "",
            delivery_barangay: effectiveAddress.barangay || "",
            delivery_city: effectiveAddress.city_municipality || "",
            delivery_province: effectiveAddress.province || "",
            delivery_postal_code: effectiveAddress.postal_code || "",
            delivery_landmark: effectiveAddress.address_details || "",
          });
        }

        let payload;

        if (useCartCheckout) {
          const items = currentCheckoutItems.map((item) => {
            const lineQty = Math.max(
              1,
              Number.parseInt(item?.quantity || "1", 10) || 1,
            );
            const lineUnitPrice = Number.isFinite(Number(item?.unit_price))
              ? Number(item.unit_price)
              : 0;
            const lineTotal = Number.isFinite(Number(item?.line_total))
              ? Number(item.line_total)
              : lineUnitPrice * lineQty;

            return {
              product_id: item?.product_id ?? null,
              product_name: String(item?.product_name || "Custom Order"),
              product_image: String(
                item?.product_image || "/images/FMRC Logo.png",
              ),
              quantity: lineQty,
              unit_price: lineUnitPrice,
              line_total: lineTotal,
            };
          });

          const firstItem = items[0] || {};
          const summaryName =
            items.length > 1
              ? `${firstItem.product_name || "Custom Order"} (+${items.length - 1} more)`
              : firstItem.product_name || "Custom Order";

          payload = {
            ...basePayload,
            product_id: firstItem.product_id ?? null,
            product_name: summaryName,
            product_image:
              firstItem.product_image ||
              checkoutImg?.src ||
              "/images/FMRC Logo.png",
            quantity,
            unit_price:
              quantity > 0 ? Number((totalAmount / quantity).toFixed(2)) : 0,
            total_amount: totalAmount,
            items,
          };
        } else {
          payload = {
            ...basePayload,
            product_id: currentProductId,
            product_name: checkoutTitle?.innerText?.trim() || "Custom Order",
            product_image: checkoutImg?.src || "/images/FMRC Logo.png",
            quantity,
            unit_price: Number.isFinite(currentItemPrice)
              ? Number(currentItemPrice)
              : 0,
            total_amount: totalAmount,
          };
        }

        const response = await fetchWithTimeout(
          `${API_BASE_URL}/orders`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
          },
          25000,
        ); // 25s timeout since SMTP email might take a few seconds on Windows local server

        const data = await response.json().catch(() => ({}));
        if (response.status === 401) {
          try {
            localStorage.removeItem("customer_token");
            localStorage.removeItem("customer_info");
          } catch {
            // Ignore storage write issues.
          }
          throw new Error("Session expired. Please sign in again.");
        }
        if (!response.ok) {
          throw new Error(
            data.message || "Unable to place order at the moment.",
          );
        }

        const orderNoRaw = String(
          data?.data?.order_no || data?.order_no || "",
        ).trim();
        const orderNoDisplay = String(
          data?.data?.order_no_display ||
            data?.order_no_display ||
            (orderNoRaw ? `#${orderNoRaw}` : ""),
        ).trim();

        // â”€â”€ Step 1: Persist order-success info so products.js can show the
        //   success modal AFTER the product grid finishes reloading.
        //   This prevents the refresh cycle from dismissing the modal.
        try {
          sessionStorage.setItem(
            "fmrc_pending_order_success",
            JSON.stringify({
              orderNo: orderNoDisplay || orderNoRaw || "",
              ts: Date.now(),
            }),
          );
        } catch {
          /* ignore storage errors (e.g. private browsing) */
        }

        // â”€â”€ Step 2: Clear cart items & close the checkout modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        if (useCartCheckout && cartItemsContainer) {
          const checkedCartInputs = cartItemsContainer.querySelectorAll(
            ".cart-item-check:checked",
          );
          checkedCartInputs.forEach((checkedInput) => {
            checkedInput.closest(".cart-item-card")?.remove();
          });
          updateCartTotals();
          await persistCartItems();
        }

        currentCheckoutMode = "single";
        currentCheckoutItems = [];
        setCheckoutQtyLock(false);

        // A reference number belongs to exactly one payment, so it must not be
        // left in the field for the next order to reuse.
        if (gcashReferenceInput) gcashReferenceInput.value = "";
        clearCheckoutFieldError("gcashReferenceInput");
        if (gcashOpenAppHint) gcashOpenAppHint.textContent = "";

        checkoutModal.classList.remove("show-modal");
        document.body.style.overflow = "";

        // Re-enable the submit button right away
        this.disabled = false;
        this.innerText = originalText;

        // â”€â”€ Step 3: Emit the real-time update immediately â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        //   products.js will catch this, reload the product grid, and THEN show
        //   the success modal (after the grid has fully refreshed).
        emitCustomerOrdersUpdated({
          type: "created",
          orderId: data?.data?.id || null,
        });

        /* Last thing on the success path: the order is placed, the cart is
           saved, the modal is closed and the grid reload is already in flight,
           so the curtain lifts onto a page that is finished changing. */
        window.FMRCLoader?.hide();

        return; // success path done; finally block still runs but is harmless
      } catch (error) {
        /* Before the popup, never after: the curtain sits above every dialog on
           the page, so a popup awaited underneath it could never be clicked.
           Exactly one of these two hides runs on any given attempt. */
        window.FMRCLoader?.hide();
        await showCustomerPopup(
          error?.message || "Unable to place order. Please try again.",
          {
            title: "Order Failed",
          },
        );
      } finally {
        this.disabled = false;
        this.innerText = originalText;
      }
    });
  }

  // =========================================
  // SHOPPING CART & FLY-ANIMATION LOGIC
  // =========================================
  const cartIconTrigger = document.querySelector(".cart-icon-container");
  const cartModal = document.getElementById("cartModal");
  const closeCartBtn = document.getElementById("closeCartBtn");
  const cartItemsContainer = document.getElementById("cartItemsContainer");
  const emptyCartMessage = document.getElementById("emptyCartMessage");
  const headerCartBadges = document.querySelectorAll(".cart-badge");
  const cartHeaderCount = document.getElementById("cartHeaderCount");

  const emitCartRealtimeUpdate = (detail = {}) => {
    const payload = {
      source: "customer-cart",
      timestamp: Date.now(),
      ...detail,
    };

    try {
      localStorage.setItem(CART_STORAGE_SIGNAL_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage write issues.
    }
  };

  const createCartItemCard = ({
    product_id,
    title,
    image,
    unitPrice,
    originalPrice = null,
    discountPercent = 0,
    quantity = 1,
    checked = true,
  }) => {
    const rawTitle = String(title || "Product");
    const safeTitle = escapeCustomerHtml(rawTitle);
    const safeImage = String(image || "/images/FMRC Logo.png");
    const numericPrice = Number.isFinite(Number(unitPrice))
      ? Number(unitPrice)
      : 0;
    const qty = Math.max(1, Number.parseInt(String(quantity || "1"), 10) || 1);
    const pid = product_id != null ? String(product_id) : "";

    const cartItem = document.createElement("div");
    cartItem.className = "cart-item-card";
    cartItem.dataset.productName = rawTitle;
    cartItem.dataset.unitPrice = String(numericPrice);
    cartItem.dataset.originalPrice = String(
      Number.isFinite(Number(originalPrice)) ? Number(originalPrice) : numericPrice,
    );
    cartItem.dataset.discountPercent = String(
      Math.max(0, Math.min(100, Number(discountPercent) || 0)),
    );
    if (pid) cartItem.dataset.productId = pid;
    cartItem.innerHTML = `
      <label class="cart-checkbox-container">
        <input type="checkbox" class="cart-item-check" ${checked ? "checked" : ""}>
        <span class="cart-checkmark"></span>
      </label>
      <div class="cart-item-img"><img src="${safeImage}" alt="Product"></div>
      <div class="cart-item-details">
        <h4>${safeTitle}</h4>
        <div class="cart-item-bottom">
          <span class="c-price" data-price="${numericPrice}">${formatPrice(numericPrice)}${Number(discountPercent) > 0 ? ` <small style="display:block;color:#a51d1d;font-weight:700;">${Math.round(Number(discountPercent))}% off</small>` : ""}</span>
          <div class="qty-selector">
            <button class="qty-btn c-minus-btn">-</button>
            <input type="number" class="c-qty-input" value="${qty}" min="1" max="99" readonly>
            <button class="qty-btn c-plus-btn">+</button>
          </div>
        </div>
      </div>
    `;

    return cartItem;
  };

  const collectCartItemsFromDom = () => {
    if (!cartItemsContainer) return [];

    return Array.from(
      cartItemsContainer.querySelectorAll(".cart-item-card"),
    ).map((item) => {
      const title = item.querySelector("h4")?.innerText || "Product";
      const image =
        item.querySelector("img")?.getAttribute("src") ||
        "/images/FMRC Logo.png";
      const unitPrice = Number(
        item.querySelector(".c-price")?.dataset.price || 0,
      );
      const quantity = Math.max(
        1,
        Number.parseInt(item.querySelector(".c-qty-input")?.value || "1", 10) ||
          1,
      );
      const checked = Boolean(item.querySelector(".cart-item-check")?.checked);
      const product_id = item.dataset.productId
        ? Number(item.dataset.productId)
        : null;
      const originalPrice = Number(item.dataset.originalPrice || unitPrice);
      const discountPercent = Number(item.dataset.discountPercent || 0);

      return {
        product_id,
        title,
        image,
        unitPrice,
        originalPrice,
        discountPercent,
        quantity,
        checked,
      };
    });
  };

  // Debounce timer for server sync (prevents rapid-fire API calls)
  let _cartSyncTimer = null;

  // Product images are stored as base64 data URIs and can be several hundred KB
  // each. Persisting them verbatim overflows the ~5 MB localStorage quota so the
  // whole cart fails to save and "disappears" on refresh. Strip heavy base64 data
  // URIs before storing â€” restoreCartItems() re-enriches images from the products
  // API (by product_id) on every page load.
  const stripHeavyImage = (image) => {
    const src = String(image || "");
    return src.startsWith("data:") ? null : src || null;
  };

  const buildStorableCartItems = (items) =>
    items.map((item) => ({ ...item, image: stripHeavyImage(item.image) }));

  const persistCartItems = async () => {
    const items = collectCartItemsFromDom();
    const storageKey = customerSession.isAuthenticated
      ? `${CART_STORAGE_KEY}_${customerSession.userInfo.id}`
      : CART_STORAGE_KEY;

    // Save lightweight items (base64 images stripped) so the cart reliably
    // survives a refresh without overflowing the localStorage quota.
    const storableItems = buildStorableCartItems(items);
    try {
      localStorage.setItem(storageKey, JSON.stringify(storableItems));
    } catch {
      // Ignore storage write issues.
    }

    // Sync to server with debounce (strip large image data to avoid 500 errors)
    if (customerSession.isAuthenticated) {
      if (_cartSyncTimer) clearTimeout(_cartSyncTimer);
      _cartSyncTimer = setTimeout(async () => {
        _cartSyncTimer = null;
        try {
          // Persist the FULL image (including base64) to the server so the
          // correct product image survives a refresh even when localStorage
          // is unavailable. The cart_items.image column is a longText, so it
          // can safely store base64 data URIs.
          const serverItems = items.map((item) => ({
            ...item,
            image: item.image || null,
          }));

          await fetchWithTimeout(`${API_BASE_URL}/customer/cart/sync`, {

            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              Authorization: `Bearer ${customerSession.token}`,
            },
            body: JSON.stringify({ items: serverItems }),
          });
        } catch (err) {
          // Silently fail â€” items are safely stored in localStorage
          console.error("Failed to sync cart to server", err);
        }
      }, 800);
    }

    emitCartRealtimeUpdate({ type: "updated" });
  };

  const restoreCartItems = async () => {
    if (!cartItemsContainer) return;

    let savedItems = [];
    const storageKey = customerSession.isAuthenticated
      ? `${CART_STORAGE_KEY}_${customerSession.userInfo.id}`
      : CART_STORAGE_KEY;

    // Helper to read from localStorage
    const readLocalStorage = () => {
      try {
        const raw = localStorage.getItem(storageKey);
        const parsed = JSON.parse(raw || "[]");
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    };

    if (customerSession.isAuthenticated) {
      const localItems = readLocalStorage();

      try {
        const res = await fetchWithTimeout(`${API_BASE_URL}/customer/cart`, {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${customerSession.token}`,
          },
        });
        if (res.ok) {
          const payload = await res.json();
          const apiItems = Array.isArray(payload?.data) ? payload.data : [];

          // If API returns items, use them as the source of truth for
          // quantity/checked state, but restore product images (and titles)
          // from localStorage. The server intentionally strips base64 images
          // during sync, so without this merge the correct product image and
          // name would be lost on refresh (showing the fallback logo instead).
          if (apiItems.length > 0) {
            const findLocalMatch = (apiItem) =>
              localItems.find((local) => {
                if (
                  apiItem.product_id != null &&
                  local.product_id != null &&
                  String(apiItem.product_id) === String(local.product_id)
                ) {
                  return true;
                }
                // Fall back to matching by title + unit price when there is
                // no product id (e.g. custom items).
                return (
                  String(local.title || "") === String(apiItem.title || "") &&
                  Number(local.unitPrice || 0) === Number(apiItem.unitPrice || 0)
                );
              });

            savedItems = apiItems.map((apiItem) => {
              const localMatch = findLocalMatch(apiItem);
              const hasValidApiImage =
                apiItem.image &&
                apiItem.image !== "null" &&
                apiItem.image !== "/images/FMRC Logo.png";

              return {
                ...apiItem,
                // Prefer the server image only when it's a real image;
                // otherwise restore the full image kept in localStorage.
                image: hasValidApiImage
                  ? apiItem.image
                  : localMatch?.image || apiItem.image || null,
                title: apiItem.title || localMatch?.title || "Product",
              };
            });

            const newCartString = JSON.stringify(savedItems);
            if (localStorage.getItem(storageKey) !== newCartString) {
              localStorage.setItem(storageKey, newCartString);
            }
          } else if (localItems.length > 0) {

            // API is empty but localStorage has items â€” keep localStorage
            // (this happens when server sync previously failed)
            savedItems = localItems;
          } else {
            savedItems = [];
          }
        } else {
          throw new Error("Failed to fetch cart");
        }
      } catch (err) {
        console.error("Failed to fetch cart from server", err);
        // On any error, fall back to localStorage
        savedItems = localItems;
      }
    } else {
      savedItems = readLocalStorage();
    }

    // Re-enrich each cart item from the live products API using product_id.
    // This is the single source of truth for the product's real name and
    // image, so a refresh always shows the correct product (not the fallback
    // "Product" title or the default FMRC logo) even if the stored copy was
    // incomplete. Items without a product_id (custom items) keep their data.
    try {
      const enrichableIds = savedItems
        .map((entry) => Number(entry.product_id || 0))
        .filter((id) => Number.isFinite(id) && id > 0);

      if (enrichableIds.length > 0) {
        const productsRes = await fetchWithTimeout(`${API_BASE_URL}/products`, {
          headers: { Accept: "application/json" },
        });

        if (productsRes.ok) {
          const productsPayload = await productsRes.json().catch(() => ({}));
          const productList = Array.isArray(productsPayload?.data)
            ? productsPayload.data
            : [];

          const productsById = new Map();
          productList.forEach((product) => {
            const pid = Number(product?.id || 0);
            if (pid > 0) productsById.set(pid, product);
          });

          savedItems = savedItems.map((entry) => {
            const pid = Number(entry.product_id || 0);
            const liveProduct = pid > 0 ? productsById.get(pid) : null;
            if (!liveProduct) return entry;

            return {
              ...entry,
              title: liveProduct.name || entry.title || "Product",
              image:
                liveProduct.image_data ||
                entry.image ||
                "/images/FMRC Logo.png",
            };
          });

          // Persist the corrected data back so subsequent reads are accurate.
          try {
            localStorage.setItem(storageKey, JSON.stringify(savedItems));
          } catch {
            // Ignore storage write issues.
          }
        }
      }
    } catch {
      // If the products API is unavailable, keep the stored/merged data.
    }

    if (cartItemsContainer) {
      cartItemsContainer
        .querySelectorAll(".cart-item-card")
        .forEach((item) => item.remove());

      savedItems.forEach((entry) => {
        cartItemsContainer.appendChild(createCartItemCard(entry));
      });
    }

    if (typeof updateCartTotals === "function") {
      updateCartTotals();
    }
  };

  // Open & Close Cart Modal
  if (cartIconTrigger && cartModal) {
    cartIconTrigger.addEventListener("click", (e) => {
      e.preventDefault();
      if (!requireCustomerAuth("view and manage your cart")) return;
      cartModal.classList.add("show-modal");
      document.body.style.overflow = "hidden";
    });
  }
  if (closeCartBtn) {
    closeCartBtn.addEventListener("click", () => {
      cartModal.classList.remove("show-modal");
      document.body.style.overflow = ""; // Resets to CSS
    });
  }

  // Animation: Fly product image to top-right cart icon
  function flyToCart(imgElement, cartIconElement) {
    // The cart icon only exists in the Products page navbar, so bail out
    // gracefully on pages that don't render it.
    if (!imgElement || !cartIconElement) return;

    const imgRect = imgElement.getBoundingClientRect();
    const cartRect = cartIconElement.getBoundingClientRect();

    const clone = imgElement.cloneNode(true);
    clone.style.position = "fixed";
    clone.style.zIndex = "99999";
    clone.style.left = `${imgRect.left}px`;
    clone.style.top = `${imgRect.top}px`;
    clone.style.width = `${imgRect.width}px`;
    clone.style.height = `${imgRect.height}px`;
    clone.style.borderRadius = "6px";
    clone.style.transition =
      "transform 1.2s cubic-bezier(0.1, 0.7, 0.2, 1), opacity 1.2s ease";
    clone.style.pointerEvents = "none";

    document.body.appendChild(clone);
    clone.getBoundingClientRect(); // Trigger reflow

    const translateX =
      cartRect.left - imgRect.left + cartRect.width / 2 - imgRect.width / 2;
    const translateY =
      cartRect.top - imgRect.top + cartRect.height / 2 - imgRect.height / 2;

    clone.style.transform = `translate(${translateX}px, ${translateY}px) scale(0.1)`;
    clone.style.opacity = "0.3";

    setTimeout(() => clone.remove(), 1200);
  }

  // Update Cart Totals and Counters
  const formatNavbarCount = (value) => {
    const numericValue = Number.parseInt(String(value ?? "0"), 10);
    const count = Number.isFinite(numericValue)
      ? Math.max(0, numericValue)
      : 0;
    return count > 99 ? "99+" : String(count);
  };

  function updateCartTotals() {
    const items = cartItemsContainer?.querySelectorAll(".cart-item-card") || [];
    let total = 0;
    let count = 0;

    if (items.length > 0) {
      items.forEach((item) => {
        const checkbox = item.querySelector(".cart-item-check");
        const qtyInput = item.querySelector(".c-qty-input");
        const priceElem = item.querySelector(".c-price");

        const qty = parseInt(qtyInput?.value || "1", 10) || 1;
        const price = parseFloat(priceElem?.dataset?.price || "0") || 0;

        if (checkbox && checkbox.checked) total += price * qty;
        count += qty; // Total items in cart regardless of checked state
      });
    } else {
      // Fallback to savedItems / localStorage if cart items container is not rendered on this page
      try {
        const storageKey = typeof getCustomerCartStorageKey === "function" ? getCustomerCartStorageKey() : "customer_cart";
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            count = parsed.reduce((sum, item) => {
              const q = Math.max(1, parseInt(item?.quantity || "1", 10) || 1);
              return sum + q;
            }, 0);
          }
        }
      } catch {
        // Ignore fallback errors
      }
    }

    const cartTotalPriceEl = document.getElementById("cartTotalPrice");
    if (cartTotalPriceEl) {
      cartTotalPriceEl.innerText = formatPrice(total);
    }
    if (cartHeaderCount) cartHeaderCount.innerText = String(count);
    
    const activeHeaderCartBadges = document.querySelectorAll(".cart-badge");
    if (activeHeaderCartBadges.length) {
      if (count > 0) {
        const displayStr = formatNavbarCount(count);
        activeHeaderCartBadges.forEach((badge) => {
          badge.textContent = displayStr;
          badge.dataset.length = String(displayStr.length);
          badge.hidden = false;
          badge.style.setProperty("display", "flex", "important");
        });
      } else {
        activeHeaderCartBadges.forEach((badge) => {
          badge.textContent = "";
          badge.dataset.length = "0";
          badge.hidden = true;
          badge.style.setProperty("display", "none", "important");
        });
      }
    }

    const allChecked =
      items.length > 0 &&
      Array.from(items).every(
        (i) => i.querySelector(".cart-item-check").checked,
      );
    const selectAll = document.getElementById("selectAllCartBtn");
    if (selectAll) {
      selectAll.checked = allChecked;
    }

    // Toggle the "Your cart is empty." message strictly based on item count.
    // It must be hidden the moment there is at least one product in the cart.
    if (emptyCartMessage) {
      emptyCartMessage.style.display = items.length === 0 ? "block" : "none";
    }
  }


  // Add To Cart Button Listener
  const addToCartBtns = document.querySelectorAll(
    ".btn-add-cart:not(.disabled)",
  );
  addToCartBtns.forEach((btn) => {
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      if (!requireCustomerAuth("add products to cart")) return;

      const card = e.target.closest(".shop-card");
      if (!card) return;

      const imgElement = card.querySelector(".product-img-wrapper img");
      const title = card.querySelector(".product-name").innerText;
      const priceStr = card.querySelector(".product-price").innerText;

      flyToCart(imgElement, cartIconTrigger); // Trigger the slow fly animation

      const unitPrice = parsePrice(priceStr);
      const existingItem = Array.from(
        cartItemsContainer.querySelectorAll(".cart-item-card"),
      ).find(
        (item) =>
          item.dataset.productName === title &&
          Number(item.dataset.unitPrice || 0) === unitPrice,
      );

      if (existingItem) {
        const qtyInput = existingItem.querySelector(".c-qty-input");
        if (qtyInput) {
          qtyInput.value = String(
            Math.max(1, Number.parseInt(qtyInput.value || "1", 10) + 1),
          );
        }
        const checkbox = existingItem.querySelector(".cart-item-check");
        if (checkbox) checkbox.checked = true;
      } else {
        if (emptyCartMessage) emptyCartMessage.style.display = "none";
        const cartItem = createCartItemCard({
          title,
          image: imgElement.src,
          unitPrice,
          quantity: 1,
          checked: true,
        });
        cartItemsContainer.appendChild(cartItem);
      }

      updateCartTotals();
      persistCartItems();
    });
  });

  // Dynamically rendered products add-to-cart listener
  document.addEventListener("product:add-to-cart", (e) => {
    const product = e.detail;
    if (!product) return;
    if (!requireCustomerAuth("add products to cart")) return;

    const title = String(product.name || "");
    const unitPrice = Number.isFinite(Number(product.price))
      ? Number(product.price)
      : 0;
    const originalPrice = Number.isFinite(Number(product.original_price))
      ? Number(product.original_price)
      : unitPrice;
    const discountPercent = Math.max(
      0,
      Math.min(100, Number(product.discount_percent || 0) || 0),
    );
    const imageSrc = product.image_data || "/images/FMRC Logo.png";

    // Trigger animation if card exists
    const card = document
      .querySelector(`.action-btn[data-product-id="${product.id}"]`)
      ?.closest(".shop-card");
    const imgElement = card
      ? card.querySelector(".product-img-wrapper img")
      : null;
    if (imgElement && typeof flyToCart === "function" && cartIconTrigger) {
      flyToCart(imgElement, cartIconTrigger);
    }

    const existingItem = Array.from(
      cartItemsContainer?.querySelectorAll(".cart-item-card") || [],
    ).find(
      (item) =>
        item.dataset.productName === title &&
        Number(item.dataset.unitPrice || 0) === unitPrice,
    );

    if (existingItem) {
      const qtyInput = existingItem.querySelector(".c-qty-input");
      if (qtyInput) {
        qtyInput.value = String(
          Math.max(1, Number.parseInt(qtyInput.value || "1", 10) + 1),
        );
      }
      const checkbox = existingItem.querySelector(".cart-item-check");
      if (checkbox) checkbox.checked = true;
    } else {
      if (emptyCartMessage) emptyCartMessage.style.display = "none";
      const cartItem = createCartItemCard({
        product_id: product.id || null,
        title,
        image: imageSrc,
        unitPrice,
        originalPrice,
        discountPercent,
        quantity: 1,
        checked: true,
      });
      if (cartItemsContainer) cartItemsContainer.appendChild(cartItem);
    }

    updateCartTotals();
    persistCartItems();
  });

  // Cart DOM Listeners (Delegation for +/- and checkboxes)
  if (cartItemsContainer) {
    cartItemsContainer.addEventListener("click", (e) => {
      if (e.target.classList.contains("c-minus-btn")) {
        e.preventDefault();
        const input = e.target.nextElementSibling;
        if (parseInt(input.value) > 1) {
          input.value = parseInt(input.value) - 1;
          updateCartTotals();
          persistCartItems();
        }
      } else if (e.target.classList.contains("c-plus-btn")) {
        e.preventDefault();
        const input = e.target.previousElementSibling;
        input.value = parseInt(input.value) + 1;
        updateCartTotals();
        persistCartItems();
      } else if (e.target.classList.contains("c-delete-btn")) {
        e.preventDefault();
        e.target.closest(".cart-item-card")?.remove();
        updateCartTotals();
        persistCartItems();
      } else if (e.target.classList.contains("cart-item-check")) {
        updateCartTotals();
        persistCartItems();
      }
    });
  }

  // Select All Logic
  const selectAllCartBtn = document.getElementById("selectAllCartBtn");
  if (selectAllCartBtn) {
    selectAllCartBtn.addEventListener("change", (e) => {
      const checks = cartItemsContainer.querySelectorAll(".cart-item-check");
      checks.forEach((c) => (c.checked = e.target.checked));
      updateCartTotals();
      persistCartItems();
    });
  }

  // Edit / Remove State Logic
  const cartEditBtn = document.getElementById("cartEditBtn");
  const cartCheckoutView = document.getElementById("cartCheckoutView");
  const cartDeleteView = document.getElementById("cartDeleteView");
  let isCartEditMode = false;

  if (cartEditBtn) {
    cartEditBtn.addEventListener("click", () => {
      isCartEditMode = !isCartEditMode;
      cartEditBtn.innerText = isCartEditMode ? "Done" : "Edit";
      cartCheckoutView.style.display = isCartEditMode ? "none" : "flex";
      cartDeleteView.style.display = isCartEditMode ? "flex" : "none";
    });
  }

  // Delete Selected Items
  const cartDeleteBtn = document.getElementById("cartDeleteBtn");
  if (cartDeleteBtn) {
    cartDeleteBtn.addEventListener("click", async () => {
      const selectedItems = Array.from(
        cartItemsContainer.querySelectorAll(".cart-item-card"),
      ).filter((item) => item.querySelector(".cart-item-check")?.checked);

      if (!selectedItems.length) {
        await showCustomerPopup("Select at least one item to remove.", {
          title: "No Selection",
        });
        return;
      }

      const shouldDelete = await showCustomerPopup(
        "Remove selected item(s) from your cart?",
        {
          title: "Confirm Removal",
          isConfirm: true,
          okText: "Remove",
          cancelText: "Cancel",
        },
      );

      if (!shouldDelete) return;

      selectedItems.forEach((item) => item.remove());
      updateCartTotals();
      persistCartItems();
    });
  }

  // Connect Cart Address to Address Selection Modal
  const cartAddressTrigger = document.getElementById("cartAddressTrigger");
  if (cartAddressTrigger && addressSelectionModal) {
    cartAddressTrigger.addEventListener("click", () => {
      addressSelectionModal.classList.add("show-modal");
    });
  }

  // Route Cart Checkout directly to Main Checkout
  const cartCheckoutSubmitBtn = document.getElementById(
    "cartCheckoutSubmitBtn",
  );
  if (cartCheckoutSubmitBtn) {
    cartCheckoutSubmitBtn.addEventListener("click", async () => {
      if (!requireCustomerAuth("buy products")) return;
      if (!isGuestUser) {
        void fetchCustomerCheckoutProfile();
      }

      const checkedInputs = Array.from(
        cartItemsContainer?.querySelectorAll(".cart-item-check:checked") || [],
      );
      if (!checkedInputs.length) {
        void showCustomerPopup("Please select an item to checkout.", {
          title: "Validation",
        });
        return;
      }

      const selectedItems = checkedInputs
        .map((inputEl) => {
          const card = inputEl.closest(".cart-item-card");
          if (!card) return null;

          const qtyInput = card.querySelector(".c-qty-input");
          const priceEl = card.querySelector(".c-price");
          const title = card.querySelector("h4")?.innerText || "Custom Order";
          const image =
            card.querySelector("img")?.getAttribute("src") ||
            "/images/FMRC Logo.png";
          const qty = Math.max(1, parseInt(qtyInput?.value || "1", 10) || 1);
          const price = parseFloat(priceEl?.dataset?.price || "0");

          return {
            product_id: card.dataset.productId
              ? Number(card.dataset.productId)
              : null,
            product_name: title,
            product_image: image,
            quantity: qty,
            unit_price: Number.isFinite(price) ? price : 0,
          };
        })
        .filter(Boolean);

      if (!selectedItems.length) {
        void showCustomerPopup("Please select at least one valid cart item.", {
          title: "Validation",
        });
        return;
      }

      const productIds = selectedItems
        .map((item) => Number(item.product_id || 0))
        .filter((id) => Number.isFinite(id) && id > 0);

      const liveStocks = new Map();
      if (productIds.length > 0) {
        try {
          const stockRes = await fetchWithTimeout(`${API_BASE_URL}/products`, {
            headers: {
              Accept: "application/json",
            },
          });

          if (!stockRes.ok) {
            throw new Error(
              "Unable to refresh product stock. Please try again.",
            );
          }

          const stockPayload = await stockRes.json().catch(() => ({}));
          const products = Array.isArray(stockPayload?.data)
            ? stockPayload.data
            : [];
          products.forEach((product) => {
            const stockQty =
              product?.stock_status === "in_stock"
                ? Math.max(0, Number(product?.stock || 0))
                : 0;
            liveStocks.set(Number(product?.id || 0), stockQty);
          });
        } catch (error) {
          void showCustomerPopup(
            error?.message || "Unable to verify stocks right now.",
            {
              title: "Stock Check Failed",
            },
          );
          return;
        }
      }

      const validatedItems = [];
      for (const item of selectedItems) {
        const productId = Number(item.product_id || 0);
        if (productId > 0) {
          if (!liveStocks.has(productId)) {
            void showCustomerPopup(
              `Product \"${item.product_name}\" is no longer available. Please update your cart.`,
              { title: "Product Unavailable" },
            );
            return;
          }

          const availableStock = Math.max(
            0,
            Number(liveStocks.get(productId) || 0),
          );
          if (availableStock <= 0) {
            void showCustomerPopup(
              `\"${item.product_name}\" is now out of stock.`,
              { title: "Out of Stock" },
            );
            return;
          }

          if (item.quantity > availableStock) {
            void showCustomerPopup(
              `Only ${availableStock} stock(s) left for \"${item.product_name}\". Please reduce quantity in cart.`,
              { title: "Stock Limit" },
            );
            return;
          }

          validatedItems.push({
            ...item,
            max_stock: availableStock,
            line_total: item.unit_price * item.quantity,
          });
          continue;
        }

        validatedItems.push({
          ...item,
          max_stock: null,
          line_total: item.unit_price * item.quantity,
        });
      }

      const firstItem = validatedItems[0];
      const totalQty = validatedItems.reduce(
        (sum, item) => sum + item.quantity,
        0,
      );
      const totalAmount = validatedItems.reduce(
        (sum, item) => sum + item.line_total,
        0,
      );

      currentCheckoutMode = "cart";
      currentCheckoutItems = validatedItems;
      currentProductId = firstItem?.product_id ?? null;
      currentItemPrice = totalQty > 0 ? totalAmount / totalQty : 0;

      if (checkoutImg)
        checkoutImg.src = firstItem?.product_image || "/images/FMRC Logo.png";
      if (checkoutTitle) {
        checkoutTitle.innerText =
          validatedItems.length > 1
            ? `${firstItem?.product_name || "Custom Order"} (+${validatedItems.length - 1} more)`
            : firstItem?.product_name || "Custom Order";
      }
      if (checkoutPrice) {
        checkoutPrice.innerText = formatPrice(currentItemPrice);
      }

      if (guideImg)
        guideImg.src = firstItem?.product_image || "/images/FMRC Logo.png";
      if (guideTitle) {
        guideTitle.innerText =
          validatedItems.length > 1
            ? `${firstItem?.product_name || "Custom Order"} (+${validatedItems.length - 1} more)`
            : firstItem?.product_name || "Custom Order";
      }

      if (
        validatedItems.length === 1 &&
        Number.isFinite(Number(firstItem?.max_stock))
      ) {
        currentMaxStock = Math.max(0, Number(firstItem.max_stock));
        setCheckoutStockNotice(
          currentMaxStock === 0 ? "Out of Stock" : currentMaxStock,
        );
      } else {
        currentMaxStock = 9999;
        setCheckoutStockNotice(`Multiple products (${validatedItems.length})`);
      }

      if (inputQty) {
        inputQty.value = String(totalQty);
        inputQty.max = String(totalQty);
      }

      // Cart checkout locks the single-card qty selector because each product
      // is edited individually in its own row inside the Order summary.
      setCheckoutQtyLock(true);
      if (protectionCheck) protectionCheck.checked = false;
      renderCheckoutOrderSummary();
      updateCheckoutMath();

      cartModal.classList.remove("show-modal");
      checkoutModal.classList.add("show-modal");

    });
  }

  restoreCartItems();
  updateCartTotals();

  window.addEventListener("storage", (event) => {
    if (
      !event.key ||
      (!event.key.startsWith(CART_STORAGE_KEY) &&
        event.key !== CART_STORAGE_SIGNAL_KEY)
    )
      return;
    restoreCartItems();
    updateCartTotals();
  });

  // =========================================
  // APPOINTMENT FLOW LOGIC (HOMEPAGE)
  // =========================================
  const appointmentBtn = document.querySelector(".btn-appointment");
  const appointmentOverlay = document.getElementById("appointmentFlow");
  const closeAppointmentBtn = document.getElementById("closeAppointmentBtn");
  const privacyModal = document.getElementById("aptPrivacyModal");
  const confirmModal = document.getElementById("aptConfirmModal");
  const successModal = document.getElementById("successAppointmentModal");
  const aptFileInput = document.getElementById("aptFile");
  const aptFileName = document.getElementById("aptFileName");

  const calGrid = document.getElementById("calDaysGrid");
  const monthDisplay = document.getElementById("calMonthYear");
  const prevBtn = document.getElementById("calPrevBtn");
  const nextBtn = document.getElementById("calNextBtn");
  const timeContainer = document.getElementById("timeSlotsContainer");
  const selectedDateDisplay = document.getElementById("selectedDateDisplay");
  const slotCounter = document.getElementById("slotCounter");
  const limitMsg = document.getElementById("maxLimitMsg");

  /* The Step 4 primary button's resting label. Three places have to agree on it —
     the markup (main.html:1178), the submit handler's restoreButtons(), and the
     flow reset that releases the lock on re-entry — so it is written once. */
  const APT_SUBMIT_LABEL = "Confirm & Submit";

  let appointmentSubmitted = false;
  let submittedAppointment = null;
  let selectedDateKey = null;
  const today = new Date();
  const todayOnly = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  let currentMonth = todayOnly.getMonth();
  let currentYear = todayOnly.getFullYear();
  let uploadedAppointmentFile = null;

  const defaultTimeSlots = [
    { label: "9:00 - 10:00 AM", type: "AM", sort_order: 1 },
    { label: "10:00 - 11:00 AM", type: "AM", sort_order: 2 },
    { label: "11:00 - 12:00", type: "AM", sort_order: 3 },
    { label: "1:00 - 2:00 PM", type: "PM", sort_order: 4 },
    { label: "2:00 - 3:00 PM", type: "PM", sort_order: 5 },
    { label: "3:00 - 4:00 PM", type: "PM", sort_order: 6 },
  ];

  const calendarState = {
    timeSlots: [...defaultTimeSlots],
    daySettings: {},
    bookedSlots: {},
  };

  const appointmentSelections = {};
  window.appointmentSelections = appointmentSelections;

  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const parseSlotStartMinutes = (slot) => {
    const label = String(slot?.label || "").trim();
    const start = label.split("-")[0].trim();
    const meridiemMatch = label.match(/\b(AM|PM)\b/i);
    const meridiem = (slot?.type || meridiemMatch?.[1] || "AM").toUpperCase();
    const match = start.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
    if (!match) return Number.MAX_SAFE_INTEGER;

    let hh = Number(match[1]);
    const mm = Number(match[2] || "0");
    if (
      Number.isNaN(hh) ||
      Number.isNaN(mm) ||
      hh < 1 ||
      hh > 12 ||
      mm < 0 ||
      mm > 59
    ) {
      return Number.MAX_SAFE_INTEGER;
    }

    if (meridiem === "AM") {
      if (hh === 12) hh = 0;
    } else if (hh < 12) {
      hh += 12;
    }

    return hh * 60 + mm;
  };

  const slotSortComparator = (a, b) => {
    const aTime = parseSlotStartMinutes(a);
    const bTime = parseSlotStartMinutes(b);
    if (aTime !== bTime) return aTime - bTime;
    return String(a?.label || "").localeCompare(String(b?.label || ""));
  };

  const bindClick = (id, callback) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", callback);
  };

  const focusAppointmentControl = (control) => {
    if (!control || typeof control.focus !== "function") return;
    window.requestAnimationFrame(() => control.focus());
  };

  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
  };

  const setHtml = (id, content) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = content;
  };

  const showSlotMessage = (message, color = "#b01c1c") => {
    if (!limitMsg) return;
    limitMsg.style.display = "block";
    limitMsg.style.color = color;
    limitMsg.innerText = message;
  };

  const clearSlotMessage = () => {
    if (!limitMsg) return;
    limitMsg.style.display = "none";
    limitMsg.innerText = "";
  };

  const toDateKey = (year, month, day) =>
    `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const toReadableDate = (isoDate) => {
    const match = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return "N/A";
    return `${months[Number(match[2]) - 1]} ${Number(match[3])}, ${match[1]}`;
  };

  const getAppointmentAddress = () => {
    const country =
      document.getElementById("aptCountry")?.value?.trim() || "Philippines";

    if (country !== "Philippines") {
      const intlAddress =
        document.getElementById("aptIntlAddress")?.value?.trim() || "";
      return [intlAddress, country].filter(Boolean).join(", ");
    }

    // Use selectedOptions[0].text to get the human-readable name (not the PSGC code)
    const getSelectText = (id) => {
      const el = document.getElementById(id);
      return el?.selectedOptions?.[0]?.text?.trim() || el?.value?.trim() || "";
    };

    const region = getSelectText("aptRegion");
    const province = getSelectText("aptProvince");
    const municipality = getSelectText("aptMunicipality");
    const barangay = getSelectText("aptAddress");

    // Filter out any placeholder strings that look like "Select â€¦" or "Loading â€¦"
    const isPlaceholder = (s) => /^(Select|Loading|No )/i.test(s);

    return [barangay, municipality, province, region, country]
      .filter((s) => Boolean(s) && !isPlaceholder(s))
      .join(", ");
  };

  const fetchCalendarAvailability = async () => {
    try {
      const response = await fetchWithTimeout(
        `${API_BASE_URL}/appointments/calendar`,
        {
          headers: {
            Accept: "application/json",
          },
        },
      );

      if (!response.ok) return;
      const data = await response.json();

      const incomingSlots = Array.isArray(data?.time_slots)
        ? data.time_slots
        : [];
      calendarState.timeSlots = incomingSlots.length
        ? incomingSlots
            .map((slot) => ({
              label: String(slot.label || ""),
              type: String(slot.type || "AM"),
              sort_order: Number(slot.sort_order || 1),
            }))
            .filter((slot) => slot.label)
            .sort(slotSortComparator)
            .map((slot, index) => ({ ...slot, sort_order: index + 1 }))
        : [...defaultTimeSlots];

      calendarState.daySettings = {};
      (Array.isArray(data?.day_settings) ? data.day_settings : []).forEach(
        (entry) => {
          if (!entry?.date) return;
          calendarState.daySettings[String(entry.date)] = {
            is_blocked: Boolean(entry.is_blocked),
            blocked_slots: Array.isArray(entry.blocked_slots)
              ? entry.blocked_slots
              : [],
            events: Array.isArray(entry.events) ? entry.events : [],
            custom_slots: Array.isArray(entry.custom_slots)
              ? entry.custom_slots
              : [],
          };
        },
      );

      calendarState.bookedSlots =
        data?.booked_slots && typeof data.booked_slots === "object"
          ? data.booked_slots
          : {};
    } catch {
      // Keep defaults when API is temporarily unavailable.
    }
  };

  /* ------------------------------------------------------------------
     Appointment field errors — portal-style summary alert.

     Mirrors the customer/admin portal pattern (customer-auth/auth.js):
     one fixed, out-of-flow panel that lists every invalid field, each
     line tappable to jump straight to that field. CSS reveals it on
     phones only, where the old in-flow bubbles used to push the form
     down by ~350px; on desktop the per-field bubbles are untouched.
     ------------------------------------------------------------------ */
  const aptAlert = { el: null, title: null, list: null };
  const APT_DISMISS_AFTER = 5000;
  const APT_DISMISS_FADE = 260;
  const APT_MAX_ATTACHMENT_BYTES = 51200 * 1024;
  let aptDismissTimer = null;
  let aptDismissRemoveTimer = null;

  const stopAptDismissTimer = () => {
    clearTimeout(aptDismissTimer);
    clearTimeout(aptDismissRemoveTimer);
    aptDismissTimer = null;
    aptDismissRemoveTimer = null;
    aptAlert.el?.classList.remove("is-leaving");
  };

  const removeAptAlert = () => {
    stopAptDismissTimer();
    aptAlert.el?.remove();
    aptAlert.el = null;
    aptAlert.title = null;
    aptAlert.list = null;
  };

  const startAptDismissTimer = () => {
    stopAptDismissTimer();
    // The panel disappears on its own, but the red rings stay until the
    // user actually edits the field — same as before this alert existed.
    aptDismissTimer = setTimeout(() => {
      if (!aptAlert.el) return;
      aptAlert.el.classList.add("is-leaving");
      aptDismissRemoveTimer = setTimeout(removeAptAlert, APT_DISMISS_FADE);
    }, APT_DISMISS_AFTER);
  };

  const syncAptAlert = () => {
    if (!aptAlert.el) return;
    const count = aptAlert.list.children.length;
    if (!count) {
      removeAptAlert();
      return;
    }
    aptAlert.title.hidden = count < 2;
  };

  const ensureAptAlert = () => {
    if (aptAlert.el?.isConnected) return aptAlert;

    const alert = document.createElement("div");
    alert.id = "aptErrorAlert";
    alert.className = "apt-error-alert";
    alert.setAttribute("role", "alert");
    alert.setAttribute("aria-live", "assertive");
    alert.innerHTML =
      '<span class="apt-error-mark" aria-hidden="true">!</span>' +
      '<div class="apt-error-body">' +
      '<p class="apt-error-title" hidden>Please check these fields</p>' +
      '<ul class="apt-error-list"></ul>' +
      "</div>" +
      '<button class="apt-error-close" type="button" aria-label="Dismiss messages">&times;</button>';

    alert
      .querySelector(".apt-error-close")
      .addEventListener("click", removeAptAlert);
    alert.addEventListener("pointerenter", stopAptDismissTimer);
    alert.addEventListener("pointerleave", startAptDismissTimer);
    alert.addEventListener("focusin", stopAptDismissTimer);
    alert.addEventListener("focusout", startAptDismissTimer);

    document.body.appendChild(alert);
    aptAlert.el = alert;
    aptAlert.title = alert.querySelector(".apt-error-title");
    aptAlert.list = alert.querySelector(".apt-error-list");
    return aptAlert;
  };

  const focusAptField = (key) => {
    const field = document.getElementById(key);
    // Keys that are not inputs (the attachment, the schedule) fall back to
    // the block the user has to act on.
    const target = field || document.querySelector(".apt-calendar-left");
    if (!target) return;

    if (field) field.focus({ preventScroll: true });

    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? "auto"
      : "smooth";

    // On a short phone with several messages open, centring the field parks it
    // behind the alert itself. Aim for the gap under the panel instead, and only
    // when the panel is actually on screen — desktop keeps plain centring.
    const panel = aptAlert.el;
    const panelBottom =
      panel && getComputedStyle(panel).display !== "none"
        ? panel.getBoundingClientRect().bottom
        : 0;
    const scroller = target.closest(".apt-overlay");

    if (panelBottom && scroller) {
      const rect = target.getBoundingClientRect();
      const view = scroller.getBoundingClientRect();
      const centred = view.top + (view.height - rect.height) / 2;
      const wanted = Math.max(panelBottom + 16, centred);
      scroller.scrollTo({
        top: scroller.scrollTop + (rect.top - wanted),
        behavior,
      });
      return;
    }

    target.scrollIntoView({ block: "center", behavior });
  };

  const pushAptAlertMessage = (key, message) => {
    const { list } = ensureAptAlert();
    let item = list.querySelector(`[data-error-for="${key}"]`);
    if (!item) {
      item = document.createElement("li");
      item.className = "apt-error-item";
      item.dataset.errorFor = key;
      const line = document.createElement("button");
      line.type = "button";
      line.className = "apt-error-link";
      line.addEventListener("click", () => focusAptField(key));
      item.appendChild(line);
      list.appendChild(item);
    }
    item.querySelector(".apt-error-link").textContent = message;
    syncAptAlert();
    startAptDismissTimer();
  };

  const dropAptAlertMessage = (key) => {
    if (!key || !aptAlert.list) return;
    aptAlert.list.querySelector(`[data-error-for="${key}"]`)?.remove();
    syncAptAlert();
  };

  // The attachment lives inside the "Purpose of Visit" group, so it gets its
  // own ring instead of reddening the select next to it.
  const setAptFileError = (message) => {
    aptFileInput?.closest(".file-upload-wrapper")?.classList.add("has-error");
    pushAptAlertMessage("aptFile", message);
  };

  const clearAptFileError = () => {
    aptFileInput?.closest(".file-upload-wrapper")?.classList.remove("has-error");
    dropAptAlertMessage("aptFile");
  };

  const setFieldError = (inputId, message) => {
    const input = document.getElementById(inputId);
    if (!input) return;

    const group = input.closest(".apt-input-group");
    if (!group) return;

    let bubble = group.querySelector(".apt-field-error-bubble");
    if (!bubble) {
      bubble = document.createElement("div");
      bubble.className = "apt-field-error-bubble";
      bubble.setAttribute("role", "alert");
      group.appendChild(bubble);
    }

    bubble.textContent = message;
    group.classList.add("has-error");
    input.setAttribute("aria-invalid", "true");
    pushAptAlertMessage(inputId, message);
  };

  const clearFieldError = (inputId) => {
    const input = document.getElementById(inputId);
    if (!input) return;

    const group = input.closest(".apt-input-group");
    if (!group) return;

    group.classList.remove("has-error");
    input.removeAttribute("aria-invalid");
    dropAptAlertMessage(inputId);
  };

  const clearAllFieldErrors = () => {
    document.querySelectorAll(".apt-input-group.has-error").forEach((group) => {
      group.classList.remove("has-error");
      const input = group.querySelector("input, select, textarea");
      if (input) input.removeAttribute("aria-invalid");
    });
    removeAptAlert();
  };

  [
    "aptLName",
    "aptFName",
    "aptMI",
    "aptPhone",
    "aptEmail",
    "aptCountry",
    "aptRegion",
    "aptProvince",
    "aptMunicipality",
    "aptAddress",
    "aptIntlAddress",
    "aptPurpose",
    "aptRole",
    "aptRoleOther",
    "aptDesc",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => clearFieldError(id));
    el.addEventListener("change", () => clearFieldError(id));
  });

  // "Others" client type: reveal a free-text box and store the combined value
  // (e.g. "Others: Local cooperative") in the same client_type field.
  const isOtherClientType = () =>
    (document.getElementById("aptRole")?.value || "").trim() === "Others";

  const syncAptRoleOtherField = () => {
    const wrapper = document.getElementById("aptRoleOtherField");
    const input = document.getElementById("aptRoleOther");
    if (!wrapper || !input) return;
    const showOther = isOtherClientType();
    wrapper.style.display = showOther ? "" : "none";
    if (!showOther) {
      input.value = "";
      clearFieldError("aptRoleOther");
    }
  };

  document
    .getElementById("aptRole")
    ?.addEventListener("change", syncAptRoleOtherField);
  syncAptRoleOtherField();

  const getAppointmentClientType = () => {
    const selected = (document.getElementById("aptRole")?.value || "").trim();
    if (selected !== "Others") return selected;
    const other = (
      document.getElementById("aptRoleOther")?.value || ""
    ).trim();
    return other ? `Others: ${other}` : "Others";
  };

  const getSelectedSchedule = () => {
    const date = Object.keys(appointmentSelections)[0] || "";
    const time = date ? appointmentSelections[date]?.[0] || "" : "";
    return { date, time };
  };

  const validateAppointmentStep2 = () => {
    clearAllFieldErrors();

    const lastName = document.getElementById("aptLName")?.value?.trim() || "";
    const firstName = document.getElementById("aptFName")?.value?.trim() || "";
    const middleInitial = document.getElementById("aptMI")?.value?.trim() || "";
    const mobile = document.getElementById("aptPhone")?.value?.trim() || "";
    const email = document.getElementById("aptEmail")?.value?.trim() || "";
    const purpose = document.getElementById("aptPurpose")?.value?.trim() || "";
    const clientType = document.getElementById("aptRole")?.value?.trim() || "";
    const country =
      document.getElementById("aptCountry")?.value?.trim() || "Philippines";

    let firstInvalidId = "";
    const markError = (id, message) => {
      setFieldError(id, message);
      if (!firstInvalidId) firstInvalidId = id;
    };

    if (!lastName) {
      markError("aptLName", "Last Name is required.");
    } else if (lastName.length > 20) {
      markError("aptLName", "Last Name must not exceed 20 letters.");
    } else if (!/^[A-Za-z]+(?:\s[A-Za-z]+)*$/.test(lastName)) {
      markError("aptLName", "Last Name is invalid. Use letters only.");
    }

    if (!firstName) {
      markError("aptFName", "First Name is required.");
    } else if (firstName.length > 25) {
      markError("aptFName", "First Name must not exceed 25 letters.");
    } else if (!/^[A-Za-z]+(?:\s[A-Za-z]+)*$/.test(firstName)) {
      markError("aptFName", "First Name is invalid. Use letters only.");
    }

    if (middleInitial && !/^[A-Za-z]$/.test(middleInitial)) {
      markError("aptMI", "M.I. is invalid. Use exactly 1 letter only.");
    }

    if (!mobile) {
      markError("aptPhone", "Mobile Number is required.");
    } else if (!/^\d{11}$/.test(mobile)) {
      markError("aptPhone", "Mobile Number is invalid. Use exactly 11 digits.");
    }

    if (!email) {
      markError("aptEmail", "Email Address is required.");
    } else if (!/^[A-Za-z0-9._%+-]+@gmail\.com$/i.test(email)) {
      markError(
        "aptEmail",
        "Email Address is invalid. Please use a Gmail address only.",
      );
    }

    if (!purpose) {
      markError("aptPurpose", "Purpose of Visit is required.");
    }

    if (!clientType) {
      markError("aptRole", "Type of Client is required.");
    } else if (clientType === "Others") {
      const otherClientType = (
        document.getElementById("aptRoleOther")?.value || ""
      ).trim();
      if (!otherClientType) {
        markError("aptRoleOther", "Please specify your type of client.");
      } else if (otherClientType.length > 100) {
        // Stays at 100 even though the server allows 120: this box is submitted
        // as `Others: <text>`, so the prefix eats 8 of the server's characters.
        // 100 also matches this input's own maxlength attribute.
        markError(
          "aptRoleOther",
          "Type of Client must not exceed 100 characters.",
        );
      } else if (!/^[A-Za-z0-9 .,'()\/&-]+$/.test(otherClientType)) {
        markError(
          "aptRoleOther",
          "Type of Client is invalid. Use letters, numbers and basic punctuation only.",
        );
      }
    }

    if (country === "Philippines") {
      if (!document.getElementById("aptRegion")?.value?.trim()) {
        markError("aptRegion", "Region is required.");
      }
      if (!document.getElementById("aptProvince")?.value?.trim()) {
        markError("aptProvince", "Province is required.");
      }
      if (!document.getElementById("aptMunicipality")?.value?.trim()) {
        markError("aptMunicipality", "Municipality is required.");
      }
      if (!document.getElementById("aptAddress")?.value?.trim()) {
        markError("aptAddress", "Barangay is required.");
      }
    } else {
      const intlAddress =
        document.getElementById("aptIntlAddress")?.value?.trim() || "";
      if (!intlAddress) {
        markError(
          "aptIntlAddress",
          "Complete Residential Address is required.",
        );
      } else if (intlAddress.length > 500) {
        markError(
          "aptIntlAddress",
          "Complete Residential Address must not exceed 500 characters.",
        );
      }
    }

    // Mirrors the server's additional_notes rule so an over-long request is
    // named here instead of coming back as a bare 422.
    const description = document.getElementById("aptDesc")?.value?.trim() || "";
    if (description.length > 2000) {
      markError(
        "aptDesc",
        "Description must not exceed 2000 characters.",
      );
    }

    if (firstInvalidId) {
      document.getElementById(firstInvalidId)?.focus();
      return false;
    }

    return true;
  };

  const updateQrDetails = (referenceNo, verifyUrl) => {
    const qrImage = document.getElementById("receiptQrImage");
    const qrLink = document.getElementById("receiptQrLink");
    const payloadUrl =
      verifyUrl ||
      `${window.location.origin}/appointments/verify/${referenceNo || "PENDING"}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(payloadUrl)}`;

    if (qrImage) {
      qrImage.crossOrigin = "anonymous";
      qrImage.src = qrUrl;
    }
    if (qrLink) {
      qrLink.href = payloadUrl;
      qrLink.textContent = "Open verification page";
    }
  };

  const populateReviewData = (step) => {
    const prefix = step === 4 ? "rev" : "com";
    const fName = document.getElementById("aptFName")?.value?.trim() || "N/A";
    const lName = document.getElementById("aptLName")?.value?.trim() || "N/A";
    const mi = document.getElementById("aptMI")?.value?.trim() || "";
    const fullName = [fName, mi ? `${mi.replace(/\.$/, "")}.` : "", lName]
      .filter(Boolean)
      .join(" ")
      .trim();

    const phone = document.getElementById("aptPhone")?.value?.trim() || "N/A";
    const email = document.getElementById("aptEmail")?.value?.trim() || "N/A";
    const purpose =
      document.getElementById("aptPurpose")?.value?.trim() || "N/A";
    const clientType = getAppointmentClientType() || "N/A";
    const country =
      document.getElementById("aptCountry")?.value?.trim() || "Philippines";
    const notes = document.getElementById("aptDesc")?.value?.trim() || "N/A";
    const address = getAppointmentAddress() || "N/A";
    const attachmentName = uploadedAppointmentFile?.name || "N/A";

    const { date, time } = getSelectedSchedule();
    const scheduleText =
      date && time ? `${toReadableDate(date)} @ ${time}` : "Not selected";
    const referenceNo = submittedAppointment?.reference_no || "PENDING";

    setText(`${prefix}Name`, fullName);
    setText(`${prefix}Phone`, phone);
    setText(`${prefix}Email`, email);
    setText(`${prefix}Address`, address);
    setText(`${prefix}Purpose`, purpose);
    setText(`${prefix}ClientType`, clientType);
    setText(`${prefix}Country`, country);
    setText(`${prefix}Desc`, notes);
    setText(`${prefix}FileAttach`, attachmentName);
    setText(`${prefix}TicketNo`, `Ticket #${referenceNo}`);
    setHtml(`${prefix}Sched`, scheduleText);

    setText("successReferenceNo", referenceNo);
    updateQrDetails(referenceNo, submittedAppointment?.qr_payload || "");
  };

  const switchAptStep = (stepNumber) => {
    // Messages belong to the step that raised them.
    removeAptAlert();
    document
      .querySelectorAll(".apt-content-section")
      .forEach((sec) => sec.classList.remove("active"));
    // The rail is painted entirely by CSS (main.css §8.2). This used to write
    // six inline styles per step, which beat the stylesheet and made the gold
    // "you are here" state unreachable — and because the old test was
    // `index < stepNumber`, the current step and every finished step painted
    // identically, so the rail could not tell you where you were. Three
    // classes, no inline styles: `.active` keeps its old meaning (this step and
    // everything before it), `.is-done` is strictly behind you, `.is-current`
    // is exactly where you are.
    document.querySelectorAll(".apt-step").forEach((step, index) => {
      step.classList.toggle("active", index < stepNumber);
      step.classList.toggle("is-done", index < stepNumber - 1);
      step.classList.toggle("is-current", index === stepNumber - 1);
    });

    const targetSection = document.getElementById(`aptStep${stepNumber}`);
    if (targetSection) targetSection.classList.add("active");

    // Each step can be much taller than a phone viewport. Start the new step
    // at its heading and keep the active progress item visible inside the
    // swipeable strip instead of leaving users halfway down the previous step.
    if (appointmentOverlay) {
      appointmentOverlay.scrollTop = 0;
    }

    const activeIndicator = document.getElementById(
      `stepIndicator${stepNumber}`,
    );
    const progressWrapper = activeIndicator?.closest(
      ".apt-progress-wrapper",
    );
    if (activeIndicator && progressWrapper) {
      const targetLeft =
        activeIndicator.offsetLeft -
        (progressWrapper.clientWidth - activeIndicator.offsetWidth) / 2;
      progressWrapper.scrollTo({
        left: Math.max(0, targetLeft),
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    }

    if (stepNumber === 3) {
      clearSlotMessage();
      renderCalendar(currentMonth, currentYear);
      if (selectedDateKey) renderTimeSlots(selectedDateKey);
      // Keeps the poll's change-detection in step with what is on screen.
      aptAvailabilitySignature = getAvailabilitySignature();
      showSlotMessage(
        "Reminder: You can select only 1 time slot for this appointment.",
        "#77610d",
      );
    }

    if (stepNumber === 4 || stepNumber === 5) {
      populateReviewData(stepNumber);
    }
  };

  const submitAppointment = async () => {
    const { date, time } = getSelectedSchedule();
    if (!date || !time) {
      const msg = "Please select a date and time first before continuing.";
      showSlotMessage(msg);
      pushAptAlertMessage("aptSchedule", msg);
      return { ok: false, error: msg };
    }

    let turnstileToken = "";
    try {
      if (typeof window.FMRC_TURNSTILE?.requireToken === "function") {
        turnstileToken = await window.FMRC_TURNSTILE.requireToken(
          "appointmentTurnstile",
        );
      }
    } catch (error) {
      const message =
        error?.message || "Please complete the security check before continuing.";
      showSlotMessage(message);
      return { ok: false, error: message };
    }

    const formData = new FormData();
    formData.append(
      "last_name",
      document.getElementById("aptLName")?.value?.trim() || "",
    );
    formData.append(
      "first_name",
      document.getElementById("aptFName")?.value?.trim() || "",
    );
    formData.append(
      "middle_initial",
      document.getElementById("aptMI")?.value?.trim() || "",
    );
    formData.append(
      "contact_number",
      document.getElementById("aptPhone")?.value?.trim() || "",
    );
    formData.append(
      "email",
      document.getElementById("aptEmail")?.value?.trim() || "",
    );
    formData.append(
      "country",
      document.getElementById("aptCountry")?.value?.trim() || "Philippines",
    );
    // Helper: get the human-readable text label of a PSGC dropdown (not the numeric code)
    const getSelectName = (id) => {
      const el = document.getElementById(id);
      return el?.selectedOptions?.[0]?.text?.trim() || el?.value?.trim() || "";
    };
    const isPlaceholder = (s) => /^(Select|Loading|No )/i.test(s);
    const psgcName = (id) => {
      const name = getSelectName(id);
      return isPlaceholder(name) ? "" : name;
    };

    formData.append("region", psgcName("aptRegion"));
    formData.append("province", psgcName("aptProvince"));
    formData.append("municipality", psgcName("aptMunicipality"));
    formData.append("barangay", psgcName("aptAddress"));

    formData.append(
      "intl_address",
      document.getElementById("aptIntlAddress")?.value?.trim() || "",
    );
    formData.append("full_address", getAppointmentAddress() || "");
    formData.append("client_type", getAppointmentClientType());
    formData.append(
      "purpose",
      document.getElementById("aptPurpose")?.value?.trim() || "",
    );
    formData.append(
      "additional_notes",
      document.getElementById("aptDesc")?.value?.trim() || "",
    );
    formData.append("appointment_date", date);
    formData.append("appointment_time", time);
    if (turnstileToken) {
      formData.append("cf-turnstile-response", turnstileToken);
    }

    if (uploadedAppointmentFile) {
      formData.append("attachment", uploadedAppointmentFile);
    }

    const token = localStorage.getItem("customer_token");

    try {
      const response = await fetchWithTimeout(
        `${API_BASE_URL}/appointments`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: formData,
        },
        60000,
      ); // 60s timeout â€” email is sent synchronously, so backend may take extra time for SMTP

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        window.FMRC_TURNSTILE?.reset("appointmentTurnstile");
        const message =
          payload?.message ||
          "Unable to submit appointment. Please review your details and try again.";
        showSlotMessage(message);
        return { ok: false, error: message };
      }

      submittedAppointment = payload?.data || null;
      appointmentSubmitted = true;
      stopAptPolling();
      return { ok: true, error: null };
    } catch (error) {
      console.error("[APPT SUBMIT] Error:", error);
      window.FMRC_TURNSTILE?.reset("appointmentTurnstile");
      const message =
        error?.message ||
        "Cannot connect to server. Please make sure Laravel is running.";
      showSlotMessage(message);
      return { ok: false, error: message };
    }
  };

  // html2canvas is 199KB and its only caller is this one button, inside step 5
  // of the appointment modal. It used to be a synchronous <script> in the head
  // of the landing page, so every visitor downloaded and compiled it before
  // first paint whether they booked anything or not. Fetch it on first use
  // instead; the guard below already handled "not loaded" gracefully.
  const HTML2CANVAS_SRC =
    "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
  let html2canvasPromise = null;
  const loadHtml2Canvas = () => {
    if (typeof window.html2canvas === "function") return Promise.resolve();
    if (html2canvasPromise) return html2canvasPromise;
    html2canvasPromise = new Promise((resolve, reject) => {
      const tag = document.createElement("script");
      tag.src = HTML2CANVAS_SRC;
      tag.crossOrigin = "anonymous";
      tag.referrerPolicy = "no-referrer";
      tag.onload = () => resolve();
      tag.onerror = () => {
        // Let a flaky network be retried on the next click.
        html2canvasPromise = null;
        reject(new Error("html2canvas failed to load"));
      };
      document.head.appendChild(tag);
    });
    return html2canvasPromise;
  };

  const downloadAppointmentReceipt = async () => {
    const receipt = document.getElementById("officialReceiptCard");
    const referenceNo = submittedAppointment?.reference_no || "PENDING";

    try {
      await loadHtml2Canvas();
    } catch {
      /* handled by the guard below */
    }

    if (!receipt || typeof window.html2canvas !== "function") {
      showSlotMessage(
        "Receipt download is unavailable right now. Please try again.",
      );
      return;
    }

    const canvas = await window.html2canvas(receipt, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
    });

    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `FMRC-Official-Receipt-${referenceNo}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const downloadQrCodeCard = () => {
    const qrImage = document.getElementById("receiptQrImage");
    const qrLink = document.getElementById("receiptQrLink")?.href || "";
    const referenceNo = submittedAppointment?.reference_no || "PENDING";
    if (!qrImage?.src) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 900;
      canvas.height = 1180;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = "#8b0000";
      ctx.font = "bold 42px Montserrat, Arial, sans-serif";
      ctx.fillText("CNSC-FMRC QR PASS", 180, 90);

      ctx.strokeStyle = "#d8dde6";
      ctx.lineWidth = 2;
      ctx.strokeRect(130, 140, 640, 640);
      ctx.drawImage(img, 180, 190, 540, 540);

      ctx.fillStyle = "#1f2937";
      ctx.font = "bold 28px Montserrat, Arial, sans-serif";
      ctx.fillText(`Reference: ${referenceNo}`, 180, 840);
      ctx.font = "22px Montserrat, Arial, sans-serif";
      ctx.fillText("Scan to verify this appointment receipt", 180, 895);
      ctx.fillText("FMRC Online Appointment Verification", 180, 940);
      ctx.font = "16px Montserrat, Arial, sans-serif";
      ctx.fillText("Scan to open the official verification page", 180, 988);

      const dl = document.createElement("a");
      dl.href = canvas.toDataURL("image/png");
      dl.download = `FMRC-Appointment-QR-${referenceNo}.png`;
      document.body.appendChild(dl);
      dl.click();
      dl.remove();
    };

    img.onerror = () => {
      const link = document.createElement("a");
      link.href = qrImage.src;
      link.download = `FMRC-Appointment-QR-${referenceNo}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    };

    img.src = qrImage.src;
  };

  const handleDateClick = (dateKey, day, month, year) => {
    selectedDateKey = dateKey;
    selectedDateDisplay.innerText = `${months[month]} ${day}, ${year}`;
    if (slotCounter) {
      slotCounter.style.display = "block";
      slotCounter.innerText = "Allowed: 1 time slot for this appointment";
      slotCounter.style.color = "#6d7480";
    }
    showSlotMessage(
      "Reminder: You can select only 1 time slot for this appointment.",
      "#77610d",
    );
    renderCalendar(currentMonth, currentYear);
    renderTimeSlots(dateKey);
  };

  const getCombinedSlotsForDate = (dateKey) => {
    const selected = appointmentSelections[dateKey] || [];
    const booked = calendarState.bookedSlots[dateKey] || [];
    const blocked = calendarState.daySettings[dateKey]?.blocked_slots || [];
    return [...new Set([...selected, ...booked, ...blocked])];
  };

  const getRenderableSlotsForDate = (dateKey) => {
    const baseSlots = [...calendarState.timeSlots].sort(slotSortComparator);
    const day = calendarState.daySettings[dateKey] || {};
    const customSlots = (
      Array.isArray(day.custom_slots) ? day.custom_slots : []
    )
      .map((slot) => ({
        label: String(slot?.label || "").trim(),
        type: String(slot?.type || "AM") === "PM" ? "PM" : "AM",
        sort_order: 999,
      }))
      .filter((slot) => slot.label);

    const seen = new Set(baseSlots.map((slot) => `${slot.label}|${slot.type}`));
    customSlots.forEach((slot) => {
      const key = `${slot.label}|${slot.type}`;
      if (!seen.has(key)) {
        baseSlots.push(slot);
        seen.add(key);
      }
    });

    return baseSlots.sort(slotSortComparator);
  };

  const updateDayIndicators = (cell, dateKey) => {
    const slots = getCombinedSlotsForDate(dateKey);
    const hasAM = slots.some((slot) => String(slot).includes("AM"));
    const hasPM = slots.some((slot) => String(slot).includes("PM"));

    cell.classList.remove("has-am", "has-pm", "has-full");
    if (hasAM && hasPM) {
      cell.classList.add("has-full");
    } else if (hasAM) {
      cell.classList.add("has-am");
    } else if (hasPM) {
      cell.classList.add("has-pm");
    }
  };

  const renderCalendar = (month, year) => {
    if (!calGrid || !monthDisplay) return;

    calGrid.innerHTML = "";
    monthDisplay.innerText = `${months[month]} ${year}`;

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < firstDay; i += 1) {
      const emptyCell = document.createElement("div");
      calGrid.appendChild(emptyCell);
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.classList.add("cal-day-cell");
      cell.innerText = String(day);

      const dateObj = new Date(year, month, day);
      const dateKey = toDateKey(year, month, day);
      const spokenDate = `${months[month]} ${day}, ${year}`;
      const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
      const isPast = dateObj < todayOnly;
      const daySettings = calendarState.daySettings[dateKey] || {
        is_blocked: false,
        blocked_slots: [],
        events: [],
      };

      if (isWeekend) {
        cell.classList.add("disabled", "unavailable");
        cell.disabled = true;
        cell.setAttribute("title", "Unavailable: Weekend");
        cell.setAttribute("aria-label", `${spokenDate}, unavailable: weekend`);
      } else if (isPast) {
        cell.classList.add("disabled");
        cell.disabled = true;
        cell.style.opacity = "0.55";
        cell.setAttribute("title", "Unavailable: Past Date");
        cell.setAttribute("aria-label", `${spokenDate}, unavailable: past date`);
      } else if (daySettings.is_blocked) {
        cell.classList.add("disabled", "unavailable");
        cell.disabled = true;
        cell.setAttribute("title", "Unavailable: Blocked by admin");
        cell.setAttribute(
          "aria-label",
          `${spokenDate}, unavailable: blocked by administrator`,
        );
      } else {
        cell.setAttribute("aria-label", `${spokenDate}, available`);
        cell.addEventListener("click", () =>
          handleDateClick(dateKey, day, month, year),
        );
        updateDayIndicators(cell, dateKey);
      }

      if (Array.isArray(daySettings.events) && daySettings.events.length) {
        cell.setAttribute("title", `Event: ${daySettings.events.join(", ")}`);
        cell.setAttribute(
          "aria-label",
          `${cell.getAttribute("aria-label")}. Schedule notice: ${daySettings.events.join(", ")}`,
        );
      }

      if (dateKey === selectedDateKey) {
        cell.classList.add("selected");
      }
      if (!cell.disabled) {
        cell.setAttribute(
          "aria-pressed",
          dateKey === selectedDateKey ? "true" : "false",
        );
      }

      calGrid.appendChild(cell);
    }
  };

  const renderTimeSlots = (dateKey) => {
    if (!timeContainer) return;
    const eventsDisplay = document.getElementById("userDateEventsDisplay");

    if (!dateKey) {
      timeContainer.innerHTML =
        '<p class="time-placeholder">Please pick a date first.</p>';
      if (eventsDisplay) {
        eventsDisplay.style.display = "none";
        eventsDisplay.innerHTML = "";
      }
      return;
    }

    const selectedSchedule = getSelectedSchedule();
    const selectedSlot =
      selectedSchedule.date === dateKey ? selectedSchedule.time : "";
    const daySettings = calendarState.daySettings[dateKey] || {
      is_blocked: false,
      blocked_slots: [],
      events: [],
      custom_slots: [],
    };
    const bookedSlots = calendarState.bookedSlots[dateKey] || [];

    if (eventsDisplay) {
      if (daySettings.events && daySettings.events.length > 0) {
        eventsDisplay.style.display = "block";
        eventsDisplay.innerHTML = `<div class="date-note-title">Schedule Notice for this Date</div><ul class="date-note-list">${daySettings.events
          .map((ev) => `<li>${String(ev)}</li>`)
          .join("")}</ul>`;
      } else {
        eventsDisplay.style.display = "none";
        eventsDisplay.innerHTML = "";
      }
    }

    timeContainer.innerHTML = "";
    getRenderableSlotsForDate(dateKey).forEach((slot) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "time-slot-btn";
      button.innerHTML = `<span>${slot.label}</span><span class="time-slot-label">${slot.type}</span>`;

      const isBooked = bookedSlots.includes(slot.label);
      const isBlocked =
        daySettings.blocked_slots.includes(slot.label) ||
        daySettings.is_blocked;
      const isSelected = selectedSlot === slot.label;

      button.setAttribute("aria-pressed", isSelected ? "true" : "false");
      if (isSelected) button.classList.add("selected");
      if (isBooked || isBlocked) {
        button.classList.add("disabled");
        button.title = isBlocked
          ? "Unavailable: blocked by admin"
          : "Unavailable: already booked";
        button.setAttribute("aria-disabled", "true");
        button.setAttribute(
          "aria-label",
          `${slot.label} ${slot.type}, ${button.title.toLowerCase()}`,
        );
      } else {
        button.setAttribute("aria-disabled", "false");
        button.setAttribute(
          "aria-label",
          `${slot.label} ${slot.type}${isSelected ? ", selected" : ""}`,
        );
      }

      button.addEventListener("click", () => {
        if (isBooked) {
          showSlotMessage(
            "This time slot is already booked by another customer.",
          );
          return;
        }
        if (isBlocked) {
          showSlotMessage(
            "This time slot is blocked by admin for the selected date.",
          );
          return;
        }

        const hasExistingSelection = Boolean(
          selectedSchedule.date && selectedSchedule.time,
        );
        const isReplacingSelection =
          hasExistingSelection &&
          (selectedSchedule.date !== dateKey ||
            selectedSchedule.time !== slot.label);

        Object.keys(appointmentSelections).forEach(
          (key) => delete appointmentSelections[key],
        );
        appointmentSelections[dateKey] = [slot.label];

        if (isReplacingSelection) {
          showSlotMessage(
            "Only 1 slot is allowed per appointment. Your previous slot was replaced.",
          );
        } else {
          showSlotMessage(
            "Reminder: You can select only 1 time slot for this appointment.",
            "#77610d",
          );
        }
        renderTimeSlots(dateKey);
        renderCalendar(currentMonth, currentYear);
      });

      timeContainer.appendChild(button);
    });
  };

  /* Every route back into the flow funnels through here — opening it, closing it
     with the back arrow, and finishing at Step 5 — which makes it the one place a
     reopen can be made to look like a first open.

     It used to clear exactly one of the sixteen controls (the file input), so a
     customer who finished an appointment and tapped "Set an Appointment" again
     found every name, phone, email, address and description still filled in. And
     because the submit handler's restoreButtons() closure is only reached when the
     submit *fails*, #btnGoToStep5 stayed disabled reading "Submitting…" for the
     life of the page, which turned Step 4 into a dead end. Both halves are
     released below. */
  const resetAppointmentFlowState = () => {
    Object.keys(appointmentSelections).forEach(
      (key) => delete appointmentSelections[key],
    );
    selectedDateKey = null;
    clearSlotMessage();
    submittedAppointment = null;
    appointmentSubmitted = false;
    uploadedAppointmentFile = null;
    /* Isolated: a widget that failed to load must not throw here and leave the
       form half-cleared. */
    try {
      window.FMRC_TURNSTILE?.reset("appointmentTurnstile");
    } catch {
      // Non-critical — the widget re-renders itself on the next open.
    }
    if (aptFileInput) aptFileInput.value = "";
    if (aptFileName) aptFileName.textContent = "No file selected";
    setText("successReferenceNo", "PENDING");

    /* The receipt QR goes back to the state main.html:1270 ships it in — no `src`
       at all. This used to call updateQrDetails("PENDING", ""), which built an
       api.qrserver.com URL and assigned it, so every open and every close fired a
       third-party image request for a placeholder nobody can scan. Removing the
       attribute is the same visual result without the connection; the real
       receipt path at 6086 is untouched and still fills both nodes in. */
    const qrImage = document.getElementById("receiptQrImage");
    if (qrImage) qrImage.removeAttribute("src");
    const qrLink = document.getElementById("receiptQrLink");
    if (qrLink) qrLink.href = "#";

    /* Step 3 is the other half of "all the datas input by the customer are still
       in there": clearing selectedDateKey alone leaves the heading reading the old
       date, the slot counter visible and the time column still listing that day's
       buttons. `renderTimeSlots(null)` is the supported teardown — it prints the
       "pick a date first" placeholder and hides #userDateEventsDisplay — and the
       month is walked back to the current one so a reopen never starts in a month
       the customer had browsed to. */
    if (selectedDateDisplay) selectedDateDisplay.innerText = "Select a Date";
    if (slotCounter) slotCounter.style.display = "none";
    currentMonth = todayOnly.getMonth();
    currentYear = todayOnly.getFullYear();
    renderCalendar(currentMonth, currentYear);
    renderTimeSlots(null);

    // The eight free-text controls, by id, so the list survives markup edits.
    [
      "aptLName",
      "aptFName",
      "aptMI",
      "aptPhone",
      "aptEmail",
      "aptRoleOther",
      "aptIntlAddress",
      "aptDesc",
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    /* The two plain selects go back to their placeholder option — index 0 in each
       is the disabled/hidden "Select …" — and the country back to its default. */
    const roleSelect = document.getElementById("aptRole");
    if (roleSelect) roleSelect.selectedIndex = 0;
    const purposeSelect = document.getElementById("aptPurpose");
    if (purposeSelect) purposeSelect.selectedIndex = 0;
    if (aptCountry) aptCountry.value = "Philippines";

    /* Never .value = "" or innerHTML = "" the four PSGC selects: fillSelect()
       owns their options and resetPhSelects() is the supported reset. Its
       loadRegions() is a cache hit after the first open (psgcGet memoises in
       _psgcCache), so this costs no extra network. */
    resetPhSelects();
    syncAptRoleOtherField(); // re-hides #aptRoleOtherField
    updateAddressMode(); // re-syncs the PH vs international address panes
    clearAllFieldErrors(); // drops stale has-error groups, aria-invalid, alerts

    /* Release the submit lock. Nothing else re-enables these two — on success the
       handler restores only the close button, and restoreButtons() lives inside
       the handler as a closure, so it is unreachable from here. */
    const submitBtn = document.getElementById("btnGoToStep5");
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = APT_SUBMIT_LABEL;
    }
    const backToCalendarBtn = document.getElementById("btnCancelTo3");
    if (backToCalendarBtn) backToCalendarBtn.disabled = false;
  };

  // â”€â”€â”€ PSGC Live Address Dropdowns â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Cascading dropdowns: Region â†’ Province â†’ City/Municipality â†’ Barangay
  // Data is fetched from our Laravel backend which proxies the PSGC Cloud API
  // (https://psgc.cloud/api) with 24-hour server-side caching.
  const aptCountry = document.getElementById("aptCountry");
  const aptRegion = document.getElementById("aptRegion");
  const aptProvince = document.getElementById("aptProvince");
  const aptMunicipality = document.getElementById("aptMunicipality");
  const aptBarangay = document.getElementById("aptAddress");
  const aptIntlAddress = document.getElementById("aptIntlAddress");
  const aptPhAddressFields = document.getElementById("aptPhAddressFields");
  const aptIntlAddressField = document.getElementById("aptIntlAddressField");

  /** Base URL for PSGC proxy endpoints â€” uses the same resolved backend URL as all other API calls */
  const PSGC_BASE = `${API_BASE_URL}/psgc`;

  /** In-memory cache so repeated visits to the same step skip re-fetching. */
  const _psgcCache = {};

  /**
   * Fetch a PSGC proxy endpoint with simple in-memory caching.
   * @param {string} url  Full URL to fetch
   * @returns {Promise<Array>} Parsed JSON array, or [] on failure
   */
  const psgcGet = async (url) => {
    if (_psgcCache[url]) return _psgcCache[url];
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      _psgcCache[url] = Array.isArray(json) ? json : [];
      return _psgcCache[url];
    } catch (err) {
      console.error("[PSGC] Fetch error:", url, err);
      return [];
    }
  };

  /**
   * Set a select element to a loading placeholder and disable it.
   * @param {HTMLSelectElement} el
   * @param {string} label  e.g. "Region"
   */
  const setLoading = (el, label) => {
    if (!el) return;
    const loadingLabels = {
      Region: "Regions",
      Province: "Provinces",
      Municipality: "Municipalities",
      Barangay: "Barangays",
    };
    const loadingLabel = loadingLabels[label] || `${label}s`;
    el.innerHTML = `<option value="" disabled selected>Loading ${loadingLabel}...</option>`;
    el.disabled = true;
  };

  /**
   * Fill a select element with an array of { code, name } objects.
   * @param {HTMLSelectElement} el
   * @param {Array}   items         Array of { code, name }
   * @param {string}  placeholder   e.g. "Select Region"
   * @param {boolean} keepDisabled  Leave the select disabled even if items loaded
   */
  const fillSelect = (el, items, placeholder, keepDisabled = false) => {
    if (!el) return;
    el.innerHTML = `<option value="" selected disabled hidden>${placeholder}</option>`;
    if (items.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = `No ${placeholder.replace("Select ", "")} available`;
      opt.disabled = true;
      el.appendChild(opt);
      el.disabled = true;
      return;
    }
    items.forEach(({ code, name }) => {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = name;
      el.appendChild(opt);
    });
    el.disabled = keepDisabled;
  };

  /** Reset all PH-address selects back to their placeholder state. */
  const resetPhSelects = () => {
    fillSelect(aptRegion, [], "Select Region", true);
    fillSelect(aptProvince, [], "Select Province", true);
    fillSelect(aptMunicipality, [], "Select Municipality", true);
    fillSelect(aptBarangay, [], "Select Barangay", true);
    // Immediately load regions (they're the top of the chain)
    loadRegions();
  };

  /** Show/hide PH vs international address fields based on country selection. */
  const updateAddressMode = () => {
    const isPh = aptCountry?.value === "Philippines";
    if (aptPhAddressFields)
      aptPhAddressFields.style.display = isPh ? "contents" : "none";
    if (aptIntlAddressField)
      aptIntlAddressField.style.display = isPh ? "none" : "block";
    if (aptIntlAddress) aptIntlAddress.required = !isPh;
  };

  // â”€â”€ Loader functions (each cascades to the next) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /** Load all Philippine regions into aptRegion. */
  const loadRegions = async () => {
    setLoading(aptRegion, "Region");
    const regions = await psgcGet(`${PSGC_BASE}/regions`);
    fillSelect(aptRegion, regions, "Select Region", false);
    // Reset downstream selects
    fillSelect(aptProvince, [], "Select Province", true);
    fillSelect(aptMunicipality, [], "Select Municipality", true);
    fillSelect(aptBarangay, [], "Select Barangay", true);
  };

  /** Load provinces for the selected region. */
  const loadProvinces = async (regionCode) => {
    setLoading(aptProvince, "Province");
    fillSelect(aptMunicipality, [], "Select Municipality", true);
    fillSelect(aptBarangay, [], "Select Barangay", true);

    const provinces = await psgcGet(
      `${PSGC_BASE}/regions/${regionCode}/provinces`,
    );
    fillSelect(aptProvince, provinces, "Select Province", false);
  };

  /** Load cities/municipalities for the selected province. */
  const loadCitiesMunicipalities = async (provinceCode) => {
    setLoading(aptMunicipality, "Municipality");
    fillSelect(aptBarangay, [], "Select Barangay", true);

    const cities = await psgcGet(
      `${PSGC_BASE}/provinces/${provinceCode}/cities-municipalities`,
    );
    fillSelect(aptMunicipality, cities, "Select Municipality", false);
  };

  /** Load barangays for the selected city/municipality. */
  const loadBarangays = async (cityMunCode) => {
    setLoading(aptBarangay, "Barangay");

    const barangays = await psgcGet(
      `${PSGC_BASE}/cities-municipalities/${cityMunCode}/barangays`,
    );
    fillSelect(aptBarangay, barangays, "Select Barangay", false);
  };

  // â”€â”€ Wire up change events â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  if (
    aptCountry &&
    aptRegion &&
    aptProvince &&
    aptMunicipality &&
    aptBarangay
  ) {
    aptCountry.addEventListener("change", updateAddressMode);

    aptRegion.addEventListener("change", () => {
      const code = aptRegion.value;
      if (code) loadProvinces(code);
    });

    aptProvince.addEventListener("change", () => {
      const code = aptProvince.value;
      if (code) loadCitiesMunicipalities(code);
    });

    aptMunicipality.addEventListener("change", () => {
      const code = aptMunicipality.value;
      if (code) loadBarangays(code);
    });

    // Initialise on first load
    resetPhSelects();
    updateAddressMode();
  }
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  aptFileInput?.addEventListener("change", () => {
    const file = aptFileInput.files?.[0];
    clearAptFileError();

    if (!file) {
      uploadedAppointmentFile = null;
      if (aptFileName) aptFileName.textContent = "No file selected";
      return;
    }

    const isAllowedMime =
      file.type.startsWith("image/") ||
      file.type === "application/pdf" ||
      file.type === "application/msword" ||
      file.type ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const isAllowedExt = /\.(png|jpg|jpeg|webp|gif|pdf|doc|docx)$/i.test(
      file.name,
    );

    if (!isAllowedMime && !isAllowedExt) {
      uploadedAppointmentFile = null;
      aptFileInput.value = "";
      if (aptFileName)
        aptFileName.textContent =
          "Invalid file. Use image, DOC/DOCX, or PDF only.";
      setAptFileError(
        "Attachment is invalid. Please upload an image, DOC/DOCX, or PDF file only.",
      );
      return;
    }

    // Matches the server's attachment rule (max:51200 KB).
    if (file.size > APT_MAX_ATTACHMENT_BYTES) {
      uploadedAppointmentFile = null;
      aptFileInput.value = "";
      if (aptFileName)
        aptFileName.textContent = "File is too large. Use 50 MB or smaller.";
      setAptFileError(
        "Attachment is too large. Please upload a file of 50 MB or smaller.",
      );
      return;
    }

    uploadedAppointmentFile = file;
    if (aptFileName) aptFileName.textContent = file.name;
  });

  const aptLName = document.getElementById("aptLName");
  const aptFName = document.getElementById("aptFName");
  const aptMI = document.getElementById("aptMI");
  const aptPhone = document.getElementById("aptPhone");
  const aptEmail = document.getElementById("aptEmail");

  aptLName?.addEventListener("input", () => {
    aptLName.value = aptLName.value.replace(/[^A-Za-z\s]/g, "").slice(0, 20);
  });

  aptFName?.addEventListener("input", () => {
    aptFName.value = aptFName.value.replace(/[^A-Za-z\s]/g, "").slice(0, 25);
  });

  aptMI?.addEventListener("input", () => {
    aptMI.value = aptMI.value
      .replace(/[^A-Za-z]/g, "")
      .slice(0, 1)
      .toUpperCase();
  });

  aptPhone?.addEventListener("input", () => {
    aptPhone.value = aptPhone.value.replace(/\D/g, "").slice(0, 11);
  });

  aptEmail?.addEventListener("blur", () => {
    aptEmail.value = aptEmail.value.trim().toLowerCase();
  });

  let aptPollTimer = null;
  let aptAvailabilitySignature = "";

  // Cheap fingerprint of everything the calendar and the slot list draw from.
  const getAvailabilitySignature = () =>
    JSON.stringify([
      calendarState.timeSlots,
      calendarState.daySettings,
      calendarState.bookedSlots,
    ]);

  const startAptPolling = () => {
    if (aptPollTimer) clearInterval(aptPollTimer);
    aptAvailabilitySignature = getAvailabilitySignature();
    aptPollTimer = setInterval(async () => {
      // Only fetch if Step 3 is visible inside the modal
      if (
        document.getElementById("aptStep3")?.classList.contains("active") &&
        appointmentOverlay?.classList.contains("show-modal") &&
        !document.hidden
      ) {
        await fetchCalendarAvailability();

        // Availability rarely moves between two ticks. Rebuilding all 37+ day
        // cells and every slot button anyway is what made Step 3 feel heavy on
        // phones, and it also blinked away the user's slot highlight.
        const signature = getAvailabilitySignature();
        if (signature === aptAvailabilitySignature) return;
        aptAvailabilitySignature = signature;

        renderCalendar(currentMonth, currentYear);
        renderTimeSlots(selectedDateKey);
      }
    }, 10000);
  };

  const stopAptPolling = () => {
    if (aptPollTimer) clearInterval(aptPollTimer);
    aptPollTimer = null;
    aptAvailabilitySignature = "";
  };

  if (appointmentBtn && appointmentOverlay) {
    appointmentBtn.addEventListener("click", () => {
      if (!requireCustomerAuth("make an appointment")) return;

      appointmentOverlay.classList.add("show-modal");
      document.body.style.overflow = "hidden";
      focusAppointmentControl(closeAppointmentBtn);

      /* Only the reset is guarded, and the guard now reports. Previously the whole
         block sat inside a silent `catch {}`: a throw anywhere in the reset also
         skipped switchAptStep(1) and startAptPolling(), so the overlay opened on
         whatever step it was last left on with no availability polling and nothing
         in the console to say why. The calendar and slot column are rendered by
         resetAppointmentFlowState() itself now, and again by the hydrate below. */
      try {
        resetAppointmentFlowState();
      } catch (error) {
        console.error("Appointment flow reset failed on open:", error);
      }
      switchAptStep(1);
      startAptPolling();

      // Open immediately, then hydrate availability in the background.
      void (async () => {
        await fetchCalendarAvailability();
        if (!appointmentOverlay.classList.contains("show-modal")) return;

        renderCalendar(currentMonth, currentYear);
        if (document.getElementById("aptStep3")?.classList.contains("active")) {
          renderTimeSlots(selectedDateKey);
        }
      })();
    });

    // Guard: stop clicks that land on the overlay BACKDROP from bubbling to any
    // outer handler. The appointment flow should ONLY be dismissed via the
    // dedicated close/back button â€” never by clicking outside the card.
    appointmentOverlay.addEventListener("click", (event) => {
      // Only act when the backdrop itself (not any child) is the target.
      // We intentionally do NOT close the overlay here â€” dismissal is
      // exclusively via closeAppointmentBtn to prevent accidental closure
      // during the async Step 4 submission.
      event.stopPropagation();
    });
  }

  // Guard: stop all clicks inside the apt-container from ever bubbling past
  // the overlay, which prevents any external click handler from seeing them.
  const aptContainerEl = appointmentOverlay?.querySelector(".apt-container");
  if (aptContainerEl) {
    aptContainerEl.addEventListener("click", (event) => {
      event.stopPropagation();
    });
  }

  /* One teardown for both ways out of the flow — the header's back arrow and Step
     5's "Back to Home". They had drifted: only the second stripped the overlay's
     leftover inline display/visibility/opacity and #aptStep5's inline display, so
     closing from the header could leave state behind for the next open to fight.
     Idempotent, so a double fire is harmless. */
  const closeAppointmentOverlay = () => {
    successModal?.classList.remove("active");
    appointmentOverlay?.classList.remove("show-modal");

    // Safeguard: strip any inline styles left over from previous bug fixes.
    if (appointmentOverlay) {
      appointmentOverlay.style.display = "";
      appointmentOverlay.style.visibility = "";
      appointmentOverlay.style.opacity = "";
    }
    const step5 = document.getElementById("aptStep5");
    if (step5) step5.style.display = "";

    document.body.style.overflow = "";
    /* Clearing the last inline property leaves style="" behind, and an empty style
       attribute is still an attribute. Removing it means the resting page after a
       close is identical to a fresh load, whichever route closed the flow. */
    if (!document.body.getAttribute("style")) {
      document.body.removeAttribute("style");
    }

    resetAppointmentFlowState();
    switchAptStep(1);
    stopAptPolling();
    focusAppointmentControl(appointmentBtn);
  };

  if (closeAppointmentBtn) {
    closeAppointmentBtn.addEventListener("click", closeAppointmentOverlay);
  }

  prevBtn?.addEventListener("click", () => {
    currentMonth -= 1;
    if (currentMonth < 0) {
      currentMonth = 11;
      currentYear -= 1;
    }
    renderCalendar(currentMonth, currentYear);
  });

  nextBtn?.addEventListener("click", () => {
    currentMonth += 1;
    if (currentMonth > 11) {
      currentMonth = 0;
      currentYear += 1;
    }
    renderCalendar(currentMonth, currentYear);
  });

  bindClick("btnGoToPrivacy", () => {
    removeAptAlert();
    privacyModal?.classList.add("show-modal");
    focusAppointmentControl(document.getElementById("cancelPrivacyBtn"));
  });
  bindClick("cancelPrivacyBtn", () => {
    privacyModal?.classList.remove("show-modal");
    focusAppointmentControl(document.getElementById("btnGoToPrivacy"));
  });
  bindClick("acceptPrivacyBtn", () => {
    privacyModal?.classList.remove("show-modal");
    switchAptStep(2);
    focusAppointmentControl(document.getElementById("aptLName"));
  });

  bindClick("btnCancelTo1", () => switchAptStep(1));
  bindClick("btnGoToStep3", async () => {
    if (!validateAppointmentStep2()) return;
    await fetchCalendarAvailability();
    switchAptStep(3);
  });

  bindClick("btnCancelTo2", () => switchAptStep(2));
  bindClick("btnGoToConfirm", () => {
    const { date, time } = getSelectedSchedule();
    if (!date || !time) {
      const msg = "Please select a date and time first before proceeding.";
      showSlotMessage(msg);
      pushAptAlertMessage("aptSchedule", msg);
      return;
    }
    clearSlotMessage();
    dropAptAlertMessage("aptSchedule");
    confirmModal?.classList.add("show-modal");
    focusAppointmentControl(document.getElementById("cancelConfirmBtn"));
  });

  bindClick("cancelConfirmBtn", () => {
    confirmModal?.classList.remove("show-modal");
    focusAppointmentControl(document.getElementById("btnGoToConfirm"));
  });
  bindClick("acceptConfirmBtn", () => {
    confirmModal?.classList.remove("show-modal");
    switchAptStep(4);
  });

  bindClick("btnCancelTo3", () => switchAptStep(3));

  // Step 4: "Confirm & Submit" â€” actually submits the appointment to backend
  bindClick("btnGoToStep5", async (event) => {
    // Prevent any click from bubbling to the overlay or triggering form submission
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }

    const btn = document.getElementById("btnGoToStep5");
    if (btn) btn.type = "button"; // Force button type to prevent form submission

    const backBtn = document.getElementById("btnCancelTo3");
    // Also lock the top-level close/back button so the user cannot accidentally
    // navigate away while the async submission is in flight.
    const closeBtn = closeAppointmentBtn;

    // Lock UI during submission to prevent accidental double-click or navigation
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Submitting\u2026";
    }
    if (backBtn) backBtn.disabled = true;
    if (closeBtn) closeBtn.disabled = true;

    /* The same curtain the site raises while it boots, now over the submit. The
       hint line is here and not on the shorter flows because this request sends
       the confirmation email before it answers, so it is the one wait long
       enough that a visitor might otherwise think the tab had stalled. Written
       with `?.` so a page where fmrc-loader.js failed to arrive keeps exactly
       today's behaviour — the buttons above are already locked either way. */
    window.FMRCLoader?.show(
      "Submitting your appointment",
      "This can take a moment. Please keep this tab open.",
    );

    const restoreButtons = () => {
      if (btn) {
        btn.disabled = false;
        btn.textContent = APT_SUBMIT_LABEL;
      }
      if (backBtn) backBtn.disabled = false;
      if (closeBtn) closeBtn.disabled = false;
    };

    try {
      if (!appointmentSubmitted) {
        const result = await submitAppointment();
        if (!result.ok) {
          restoreButtons();
          // Use the error returned directly from submitAppointment
          const errorMsg =
            result.error ||
            "Unable to submit appointment. Please check your details.";
          void showCustomerPopup(errorMsg, {
            title: "Submission Failed",
            allowBackdropClose: false,
          });
          return;
        }
      }
      // Success â€” restore close button then transition to Step 5
      if (closeBtn) closeBtn.disabled = false;

      // Explicitly ensure overlay remains visible using class
      if (
        appointmentOverlay &&
        !appointmentOverlay.classList.contains("show-modal")
      ) {
        appointmentOverlay.classList.add("show-modal");
      }

      try {
        switchAptStep(5);
      } catch (stepErr) {
        console.error("switchAptStep Error:", stepErr);
      }

      return false;
    } catch (err) {
      console.error("[APPT SUBMIT] Unexpected Error:", err);
      restoreButtons();
      const catchMsg =
        typeof err?.message === "string" && err.message.length > 0
          ? err.message
          : "Network error or timeout. Please try again.";
      void showCustomerPopup(catchMsg, {
        title: "Submission Error",
        allowBackdropClose: false,
      });
    } finally {
      /* Hide, and nothing else. `restoreButtons()` must never be called here:
         on the success path the confirm button is deliberately left disabled,
         and re-enabling it would make a second appointment submittable for the
         same booking. The two failure paths above already restore it themselves.

         Because this runs after the `try` has finished, Step 5 is already
         painted underneath the curtain by the time the curtain fades — the
         visitor never sees Step 4 flash back. The curtain lasts exactly as long
         as the request does; there is no duration chosen here. */
      window.FMRCLoader?.hide();
    }
    return false;
  });

  bindClick("btnGenerateReport", () => {
    void downloadAppointmentReceipt();
  });

  // Step 5: "Finish Transaction" â€” appointment already submitted, just show success
  bindClick("btnFinishStep5", () => {
    successModal?.classList.add("active");
    focusAppointmentControl(document.getElementById("btnSuccessHome"));
  });

  // Step 5 "Back to Home" and the header's back arrow share one teardown.
  bindClick("btnSuccessHome", closeAppointmentOverlay);

  const contactMessageForm = document.getElementById("contactMessageForm");
  if (contactMessageForm) {
    contactMessageForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      if (!requireCustomerAuth("send a message")) {
        return;
      }

      const nameInput = document.getElementById("contactName");
      const emailInput = document.getElementById("contactEmail");
      const messageInput = document.getElementById("contactMessage");
      const submitBtn = contactMessageForm.querySelector(".contact-submit-btn");

      const payload = {
        name: String(nameInput?.value || "").trim(),
        email: String(emailInput?.value || "").trim(),
        message: String(messageInput?.value || "").trim(),
      };

      if (!payload.name || !payload.email || !payload.message) {
        await showCustomerPopup(
          "Please complete Name, Email, and Message before sending.",
          {
            title: "Incomplete Form",
          },
        );
        return;
      }

      const confirmed = await showCustomerPopup(
        "Send this message to the FMRC customer support team now?",
        {
          title: "Confirm Send",
          isConfirm: true,
        },
      );

      if (!confirmed) {
        return;
      }

      const previousText = submitBtn?.textContent || "Send Message";
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.classList.add("is-loading");
        submitBtn.textContent = "Sending...";
      }

      /* No hint line here: this request only writes a row and answers, so it is
         short enough that a second sentence would be noise. */
      window.FMRCLoader?.show("Sending your message");

      try {
        const authToken =
          customerSession.token || localStorage.getItem("customer_token") || "";
        const response = await fetchWithTimeout(
          `${API_BASE_URL}/customer/messages`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              Authorization: `Bearer ${authToken}`,
            },
            body: JSON.stringify(payload),
          },
          15000,
        );

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            data?.message || "Unable to send your message right now.",
          );
        }

        /* Down as soon as the server has answered — the wait the curtain
           describes is over, and the popup below is awaited, so it has to be
           clickable. The curtain is the topmost layer on the page by design, so
           anything awaited underneath it could never be dismissed. */
        window.FMRCLoader?.hide();

        contactMessageForm.reset();
        await showCustomerPopup(
          data?.message ||
            "Thank you. Your message has been sent successfully.",
          {
            title: "Message Sent",
            allowBackdropClose: false,
          },
        );
      } catch (error) {
        /* The other end of the same rule: a failed or timed-out request has
           finished waiting too, and this popup is awaited as well. Exactly one
           of these two hides runs on any given attempt. */
        window.FMRCLoader?.hide();
        await showCustomerPopup(
          error?.message || "Unable to send your message. Please try again.",
          {
            title: "Send Failed",
          },
        );
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.classList.remove("is-loading");
          submitBtn.textContent = previousText;
        }
      }
    });
  }
});

// --- USER PROFILE AND AUTHENTICATION LOGIC ---
(() => {
  const userProfileBtn = document.querySelector(".user-profile");
  if (!userProfileBtn) return;
  userProfileBtn.removeAttribute("title");

  /* `ensureLoader()` and `setLoader()` used to live here: they built
     `#global-loader` with a `.laravel-spinner` inside it — the white scrim with
     a rotating ring, the second and last copy of the loader this round
     replaces. Both call sites now raise the shared UCN-FMRC curtain through
     `window.FMRCLoader`, so nothing on a customer page builds that node any
     more. The matching rules in main.css (`.global-loader-overlay`,
     `.laravel-spinner`) are left where they are on purpose: they are now
     unreachable, and editing a 573 KB render-blocking stylesheet to delete dead
     rules would force every visitor to re-download it for no visible gain. */

  const ensureStatusModal = () => {
    let modal = document.getElementById("userStatusModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "userStatusModal";
      modal.className = "status-modal";
      modal.innerHTML = '<div class="status-box" id="userStatusText"></div>';
      document.body.appendChild(modal);
    }
    return {
      modal,
      text: document.getElementById("userStatusText"),
    };
  };

  const showStatus = (message) => {
    const { modal, text } = ensureStatusModal();
    if (text) text.textContent = message;
    modal.classList.add("show");
  };

  const hideStatus = () => {
    const modal = document.getElementById("userStatusModal");
    modal?.classList.remove("show");
  };

  const hideDropdown = (dropdown) => {
    if (!dropdown.classList.contains("show")) return;
    dropdown.classList.add("is-closing");
    dropdown.classList.remove("show");
    setTimeout(() => dropdown.classList.remove("is-closing"), 180);
  };

  const hasCustomerSetPassword = (user) => {
    return user?.has_custom_password === true;
  };

  const openProfileModal = (userInfo, token) => {
    let overlay = document.getElementById("customerProfileModal");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "customerProfileModal";
      overlay.className = "customer-modal-overlay ux-dlg";
      document.body.appendChild(overlay);
    }

    const isPasswordSet = hasCustomerSetPassword(userInfo);
    const pwdBtnLabel = isPasswordSet ? "Change Password" : "Set Password";
    const pwdBtnIcon = isPasswordSet
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-right: 6px;"><path d="M21 2l-2 2m-1.5 1.5L4 19l-2 2 2-2 13.5-13.5z"/><path d="M15 5l4 4"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-right: 6px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>';

    overlay.innerHTML = `
      <section class="customer-modal ux-dlg__card" role="dialog" aria-modal="true" aria-labelledby="customerModalTitle">
        <div class="customer-modal-head ux-dlg__head">
          <button class="customer-modal-close ux-dlg__close" id="closeProfileModal" type="button" aria-label="Close">&times;</button>
          <span class="ux-dlg__badge" aria-hidden="true"><i class="fa-solid fa-user"></i></span>
          <p class="ux-dlg__eyebrow">Customer profile</p>
          <h2 class="customer-modal-title ux-dlg__title" id="customerModalTitle">My Account</h2>
        </div>
        <div class="ux-dlg__body">
          <div class="customer-card" id="customerInfoBox"></div>
        </div>
        <div class="ux-dlg__foot">
          <button type="button" class="change-password-trigger-btn ux-dlg__btn ux-dlg__btn--primary" id="openChangePasswordBtn">
            ${pwdBtnIcon}
            ${pwdBtnLabel}
          </button>
        </div>
      </section>
    `;

    const infoBox = overlay.querySelector("#customerInfoBox");
    if (infoBox) {
      const initial = (userInfo.name || userInfo.username || userInfo.email || "A").trim().charAt(0).toUpperCase();
      infoBox.innerHTML = `
        <div class="profile-header-avatar">
          <div class="user-avatar-initial">${initial}</div>
          <div class="user-avatar-meta">
            <h3 class="user-meta-name">${userInfo.name || userInfo.username || "Customer Profile"}</h3>
            <span class="user-meta-email">${userInfo.email || "customer@fmrc.edu.ph"}</span>
          </div>
        </div>
        <div class="profile-details-grid">
          <div class="profile-detail-item">
            <span class="detail-label">FULL NAME</span>
            <span class="detail-val">${userInfo.name || "N/A"}</span>
          </div>
          <div class="profile-detail-item">
            <span class="detail-label">USERNAME</span>
            <span class="detail-val">${userInfo.username || "N/A"}</span>
          </div>
          <div class="profile-detail-item">
            <span class="detail-label">EMAIL ADDRESS</span>
            <span class="detail-val">${userInfo.email || "N/A"}</span>
          </div>
        </div>
      `;
    }

    const closeModal = () => {
      overlay.classList.add("closing");
      overlay.classList.remove("show");
      setTimeout(() => {
        overlay.classList.remove("closing");
        document.body.style.overflow = "";
      }, 180);
    };

    overlay.classList.add("show");
    document.body.style.overflow = "hidden";

    overlay
      .querySelector("#closeProfileModal")
      ?.addEventListener("click", closeModal, {
        once: true,
      });

    overlay.querySelector("#openChangePasswordBtn")?.addEventListener("click", () => {
      closeModal();
      openChangePasswordModal(userInfo, token);
    });

    // Modal: dismissed only from inside the card — the close X, or Escape as its
    // keyboard equivalent. The overlay is reused across opens, so the key handler
    // is bound once and then just reads whatever `closeModal` is current.
    overlay._closeProfileModal = closeModal;
    if (!overlay.dataset.escBound) {
      overlay.dataset.escBound = "1";
      document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        if (!overlay.classList.contains("show")) return;
        overlay._closeProfileModal?.();
      });
    }
  };

  const openChangePasswordModal = (userInfo, token) => {
    let overlay = document.getElementById("customerPasswordModal");
    if (overlay) {
      overlay.remove();
    }
    overlay = document.createElement("div");
    overlay.id = "customerPasswordModal";
    overlay.className = "customer-modal-overlay ux-dlg";

    const isPasswordSet = hasCustomerSetPassword(userInfo);
    const eyeClosedSvg =
      '<svg class="eye-closed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';
    const eyeOpenSvg =
      '<svg class="eye-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';

    if (!isPasswordSet) {
      // MODE 1: Google Account creating password for the first time (2 fields only: Create Password & Confirm Password)
      overlay.innerHTML = `
        <section class="customer-modal ux-dlg__card" role="dialog" aria-modal="true" aria-labelledby="cpModalTitle">
          <div class="customer-modal-head ux-dlg__head">
            <button class="customer-modal-back-pill ux-dlg__back" id="backToProfileBtn" type="button" aria-label="Back to My Account">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 4px;"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
              <span>Back</span>
            </button>
            <span class="ux-dlg__badge" aria-hidden="true"><i class="fa-solid fa-lock"></i></span>
            <p class="ux-dlg__eyebrow">Account security</p>
            <h2 class="customer-modal-title ux-dlg__title" id="cpModalTitle">Create Password</h2>
          </div>
          <div class="ux-dlg__body">
            <p class="ux-dlg__note">
              <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
              <span><strong>Google Sign-In:</strong> Create a password for your account so you can also log in directly anytime using your email/username and password.</span>
            </p>
            <form id="changePasswordForm" novalidate>
              <div class="customer-field">
                <label for="cp_new">Create Password</label>
                <div class="password-wrapper">
                  <input type="password" id="cp_new" placeholder="Enter new password (min. 8 characters)" required />
                  <button class="toggle-pass" type="button" data-target="cp_new" aria-label="Show password">
                    ${eyeClosedSvg}
                  </button>
                </div>
              </div>
              <div class="customer-field">
                <label for="cp_confirm">Confirm Password</label>
                <div class="password-wrapper">
                  <input type="password" id="cp_confirm" placeholder="Confirm your new password" required />
                  <button class="toggle-pass" type="button" data-target="cp_confirm" aria-label="Show password">
                    ${eyeClosedSvg}
                  </button>
                </div>
              </div>
              <div class="customer-msg" id="cp_msg"></div>
            </form>
          </div>
          <div class="ux-dlg__foot">
            <button type="submit" form="changePasswordForm" class="change-password-submit-btn ux-dlg__btn ux-dlg__btn--primary">Create Password</button>
          </div>
        </section>
      `;
    } else {
      // MODE 2: Standard Account or Google Account that already has a password (Requires All 3 fields)
      overlay.innerHTML = `
        <section class="customer-modal ux-dlg__card" role="dialog" aria-modal="true" aria-labelledby="cpModalTitle">
          <div class="customer-modal-head ux-dlg__head">
            <button class="customer-modal-back-pill ux-dlg__back" id="backToProfileBtn" type="button" aria-label="Back to My Account">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 4px;"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
              <span>Back</span>
            </button>
            <span class="ux-dlg__badge" aria-hidden="true"><i class="fa-solid fa-lock"></i></span>
            <p class="ux-dlg__eyebrow">Account security</p>
            <h2 class="customer-modal-title ux-dlg__title" id="cpModalTitle">Change Password</h2>
          </div>
          <div class="ux-dlg__body">
            <form id="changePasswordForm" novalidate>
              <div class="customer-field">
                <label for="cp_current">Current Password</label>
                <div class="password-wrapper">
                  <input type="password" id="cp_current" placeholder="Enter your current password" required />
                  <button class="toggle-pass" type="button" data-target="cp_current" aria-label="Show password">
                    ${eyeClosedSvg}
                  </button>
                </div>
              </div>
              <div class="customer-field">
                <label for="cp_new">New Password</label>
                <div class="password-wrapper">
                  <input type="password" id="cp_new" placeholder="Enter new password (min. 8 characters)" required />
                  <button class="toggle-pass" type="button" data-target="cp_new" aria-label="Show password">
                    ${eyeClosedSvg}
                  </button>
                </div>
              </div>
              <div class="customer-field">
                <label for="cp_confirm">Confirm New Password</label>
                <div class="password-wrapper">
                  <input type="password" id="cp_confirm" placeholder="Confirm your new password" required />
                  <button class="toggle-pass" type="button" data-target="cp_confirm" aria-label="Show password">
                    ${eyeClosedSvg}
                  </button>
                </div>
              </div>
              <div class="customer-msg" id="cp_msg"></div>
            </form>
          </div>
          <div class="ux-dlg__foot">
            <button type="submit" form="changePasswordForm" class="change-password-submit-btn ux-dlg__btn ux-dlg__btn--primary">Update Password</button>
          </div>
        </section>
      `;
    }

    document.body.appendChild(overlay);

    // Password Toggle Logic (Masked -> Closed Eye; Revealed -> Open Eye)
    overlay.querySelectorAll(".toggle-pass").forEach((toggleBtn) => {
      toggleBtn.addEventListener("click", () => {
        const targetId = toggleBtn.getAttribute("data-target");
        const input = overlay.querySelector("#" + targetId);
        if (input) {
          if (input.type === "password") {
            input.type = "text";
            toggleBtn.innerHTML = eyeOpenSvg;
            toggleBtn.classList.add("active");
            toggleBtn.setAttribute("aria-label", "Hide password");
          } else {
            input.type = "password";
            toggleBtn.innerHTML = eyeClosedSvg;
            toggleBtn.classList.remove("active");
            toggleBtn.setAttribute("aria-label", "Show password");
          }
        }
      });
    });

    const closePwdModal = () => {
      overlay.classList.add("closing");
      overlay.classList.remove("show");
      document.removeEventListener("keydown", onPwdKeydown, true);
      setTimeout(() => {
        overlay.classList.remove("closing");
        document.body.style.overflow = "";
      }, 180);
    };

    // Modal: dismissed only from inside the card (Back button, or Escape as its
    // keyboard equivalent) so a stray click never throws away a half-typed
    // password. The overlay is rebuilt on every open, so the listener is torn
    // down again in `closePwdModal` instead of accumulating.
    function onPwdKeydown(event) {
      if (event.key !== "Escape") return;
      if (!overlay.classList.contains("show")) return;
      event.stopPropagation();
      closePwdModal();
    }
    document.addEventListener("keydown", onPwdKeydown, true);

    overlay.classList.add("show");
    document.body.style.overflow = "hidden";

    overlay.querySelector("#backToProfileBtn")?.addEventListener("click", () => {
      closePwdModal();
      openProfileModal(userInfo, token);
    });

    const form = overlay.querySelector("#changePasswordForm");
    const msgBox = overlay.querySelector("#cp_msg");

    if (form) {
      form.onsubmit = async (event) => {
        event.preventDefault();

        const currentPassword = overlay.querySelector("#cp_current")?.value || "";
        const newPassword = overlay.querySelector("#cp_new")?.value || "";
        const confirmPassword = overlay.querySelector("#cp_confirm")?.value || "";

        // If existing password is required (Mode 2)
        if (isPasswordSet) {
          if (!currentPassword) {
            msgBox.style.display = "block";
            msgBox.style.color = "#b91c1c";
            msgBox.textContent = "Current password is required.";
            return;
          }
        }

        if (!newPassword) {
          msgBox.style.display = "block";
          msgBox.style.color = "#b91c1c";
          msgBox.textContent = isPasswordSet ? "New password is required." : "Password is required.";
          return;
        }
        if (newPassword.length < 8) {
          msgBox.style.display = "block";
          msgBox.style.color = "#b91c1c";
          msgBox.textContent = "Password must be at least 8 characters.";
          return;
        }
        if (newPassword !== confirmPassword) {
          msgBox.style.display = "block";
          msgBox.style.color = "#b91c1c";
          msgBox.textContent = isPasswordSet
            ? "New password and confirmation do not match."
            : "Password confirmation does not match.";
          return;
        }

        // The submit pill lives in the dialog footer (outside the <form>), so
        // it has to be looked up on the overlay rather than on the form.
        const submitBtn = overlay.querySelector("button[type='submit']");
        const originalBtnText = submitBtn ? submitBtn.textContent : (isPasswordSet ? "Update Password" : "Create Password");
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = isPasswordSet ? "Updating..." : "Creating...";
        }

        try {
          const response = await fetch(`${API_BASE_URL}/change-password`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              Authorization: "Bearer " + token,
            },
            body: JSON.stringify({
              current_password: currentPassword,
              new_password: newPassword,
              new_password_confirmation: confirmPassword,
            }),
          });

          const data = await response.json();

          msgBox.style.display = "block";
          if (response.ok) {
            msgBox.style.color = "#0f7b35";
            const successText = !isPasswordSet
              ? "Password created successfully! You can now use your username/email and password to log in."
              : (data.message || "Password updated successfully.");
            msgBox.innerHTML =
              '<i class="fa-solid fa-circle-check"></i> ' + successText;
            form.reset();

            const savedPasswordState = data?.data || {};
            userInfo.has_custom_password =
              savedPasswordState.has_custom_password !== false;
            if (typeof savedPasswordState.signed_with_google === "boolean") {
              userInfo.signed_with_google = savedPasswordState.signed_with_google;
            }
            try {
              const currentInfo = JSON.parse(localStorage.getItem("customer_info") || "{}");
              currentInfo.has_custom_password = true;
              if (typeof userInfo.signed_with_google === "boolean") {
                currentInfo.signed_with_google = userInfo.signed_with_google;
              }
              localStorage.setItem("customer_info", JSON.stringify(currentInfo));
            } catch {}

            const floatingCard = document.getElementById("googlePwdFloatingCard");
            if (floatingCard) {
              floatingCard.classList.add("fade-out");
              setTimeout(() => floatingCard.remove(), 300);
            }

            setTimeout(() => {
              msgBox.style.display = "none";
              msgBox.textContent = "";
            }, 3500);
          } else if (response.status === 422 && data.errors) {
            const currentErr = data.errors.current_password?.[0];
            const newErr = data.errors.new_password?.[0];
            const confirmErr = data.errors.new_password_confirmation?.[0];
            msgBox.style.color = "#b91c1c";
            msgBox.textContent =
              currentErr ||
              newErr ||
              confirmErr ||
              data.message ||
              "Unable to process password request.";
          } else {
            msgBox.style.color = "#b91c1c";
            msgBox.textContent = data.message || "Unable to process password request.";
          }
        } catch {
          msgBox.style.display = "block";
          msgBox.style.color = "#b91c1c";
          msgBox.textContent =
            "Cannot connect to server. Ensure backend is running.";
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = originalBtnText;
          }
          /* A `setLoader(false)` used to sit here, hiding a scrim this flow
             never raised — its only effect was to build the old spinner node.
             The button lock above and the message box below are what report
             this particular wait; it answers inside the profile modal, so a
             full-screen curtain would hide the very panel the answer lands in. */
        }
      };
    }
  };

  const formatOrderCurrency = (amount) => {
    const parsed = Number(amount || 0);
    const safeAmount = Number.isFinite(parsed) ? parsed : 0;
    return `₱${safeAmount.toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const ORDER_STAGE_LABELS = {
    to_pay: "To Pay",
    to_ship: "To Ship",
    to_receive: "To Receive",
    completed: "Completed",
  };

  // A pickup order never travels, so "To Ship" and "To Receive" are the wrong
  // words for it: it is being packed for the FMRC counter, then waiting there.
  // The server decides the wording per order and sends it as `stage_labels`,
  // which keeps the customer's chip, the admin table and the staff tracking
  // dropdown reading the same thing. The map above is only the fallback for a
  // cached payload from before the server started sending them.
  const resolveStageLabels = (order) => {
    const sent = order?.stage_labels;
    return sent && typeof sent === "object" ? sent : ORDER_STAGE_LABELS;
  };

  const ORDER_LIFECYCLE_LABELS = {
    incoming: "Incoming",
    pending: "Pending",
    rejected: "Rejected",
    completed: "Completed",
    cancelled: "Cancelled",
  };

  const buildGoogleMapEmbedUrl = (latitude, longitude) => {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
    return `https://maps.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}&z=15&output=embed`;
  };

  const buildGoogleMapOpenUrl = (latitude, longitude) => {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
  };

  // FMRC has no courier API contract, so a tracking link can only ever be a
  // public web page. The server builds it in buildCourierState() and hands it
  // over as fulfillment.courier.tracking_url, already carrying the waybill: one
  // click and the checkpoints are on screen. 17TRACK is what makes that
  // possible for J&T, LBC, Flash and PHLPost, whose own pages only read the
  // number from an in-page form - it works out the carrier from the number
  // itself, so it also covers a courier the registry has never heard of.
  const UNIVERSAL_TRACKING_URL = "https://www.17track.net/en/tracking";

  const prefilledUniversalTrackingUrl = (trackingNo) => {
    const no = String(trackingNo || "").trim();
    return no
      ? `https://t.17track.net/en#nums=${encodeURIComponent(no)}`
      : UNIVERSAL_TRACKING_URL;
  };

  const isUniversalTrackingUrl = (url) =>
    /^https:\/\/(www|t)\.17track\.net\b/.test(String(url || ""));

  let customerOrdersController = null;
  const customerOrdersCache = new Map();
  const customerOrderImageCache = new Map();
  const customerOrderImageQueue = [];
  let activeCustomerOrderImageRequests = 0;

  const readCustomerOrdersCache = (cacheKey) => {
    if (!cacheKey) return null;

    const memoryEntry = customerOrdersCache.get(cacheKey);
    if (memoryEntry && Array.isArray(memoryEntry.orders)) return memoryEntry;

    try {
      const raw = sessionStorage.getItem(
        `${CUSTOMER_ORDERS_CACHE_PREFIX}${cacheKey}`,
      );
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.orders)) return null;
      customerOrdersCache.set(cacheKey, parsed);
      return parsed;
    } catch {
      return null;
    }
  };

  const writeCustomerOrdersCache = (
    cacheKey,
    orders,
    etag = "",
    returns = null,
    cancelReasonOptions = null,
  ) => {
    if (!cacheKey || !Array.isArray(orders)) return;

    // The reason list only arrives with a full 200 body. Five of the six writers
    // here are row-level touch-ups that know nothing about it, so an omitted
    // argument keeps whatever was cached rather than blanking it.
    const previous = readCustomerOrdersCache(cacheKey);
    const reasons =
      Array.isArray(cancelReasonOptions) && cancelReasonOptions.length
        ? cancelReasonOptions
        : Array.isArray(previous?.cancelReasonOptions)
          ? previous.cancelReasonOptions
          : [];

    const entry = {
      orders,
      // Returns arrive in the same response as the orders, so they are cached
      // together. Older entries simply have no `returns` key.
      returns: Array.isArray(returns) ? returns : [],
      // Cached for the same reason: a 304 reply carries no body at all, so on
      // every reload - where the very first request matches the cached ETag -
      // the cancel sheet was falling back to three hard-coded reasons instead of
      // the server's ten.
      cancelReasonOptions: reasons,
      etag: String(etag || ""),
      savedAt: Date.now(),
    };
    customerOrdersCache.set(cacheKey, entry);

    try {
      sessionStorage.setItem(
        `${CUSTOMER_ORDERS_CACHE_PREFIX}${cacheKey}`,
        JSON.stringify(entry),
      );
    } catch {
      // The lightweight cache is optional; live data still works without it.
    }
  };

  const fetchJsonWithTimeout = async (
    url,
    options = {},
    timeoutMs = API_REQUEST_TIMEOUT_MS,
  ) => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    const {
      headers: optionHeaders = {},
      signal: _ignoredSignal,
      ...restOptions
    } = options;
    const requestHeaders = {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      ...optionHeaders,
    };

    try {
      const response = await fetch(url, {
        ...restOptions,
        headers: requestHeaders,
        cache: restOptions.cache || "no-store",
        signal: controller.signal,
      });

      const data = await response.json().catch(() => ({}));
      return { response, data };
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(
          "Request timed out. Please check your connection and try again.",
        );
      }

      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  // Order thumbnails are binary responses, so they cannot reuse the JSON helper
  // above. This local helper keeps the abort/timeout behaviour inside the
  // customer-orders scope: the page-level `fetchWithTimeout` lives in the
  // DOMContentLoaded closure and is NOT reachable from here.
  const fetchBinaryWithTimeout = async (
    url,
    options = {},
    timeoutMs = API_REQUEST_TIMEOUT_MS,
  ) => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    const { signal: _ignoredSignal, ...restOptions } = options;

    try {
      return await fetch(url, {
        ...restOptions,
        signal: controller.signal,
      });
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  // Customer API failures are not all alike and the drawer has to tell them
  // apart. A 401 means the stored token no longer exists server-side (it was
  // revoked, or it belongs to another database), so retrying can never succeed
  // and the session has to be dropped; a timeout or a 5xx is worth retrying
  // quietly behind the cached rows. The status rides along on the error so
  // callers branch on it instead of string-matching "Unauthenticated.".
  const createCustomerApiError = (response, data, fallbackMessage) => {
    const status = Number(response?.status) || 0;
    const isSessionExpired = status === 401;
    const error = new Error(
      isSessionExpired
        ? "Your session has expired. Please login again."
        : data?.message || fallbackMessage,
    );
    error.status = status;
    error.isSessionExpired = isSessionExpired;
    return error;
  };

  const fetchCustomerOrders = async (customerToken, etag = "") => {
    const requestHeaders = {
      Accept: "application/json",
      Authorization: `Bearer ${customerToken}`,
    };
    if (etag) requestHeaders["If-None-Match"] = etag;

    const { response, data } = await fetchJsonWithTimeout(
      `${API_BASE_URL}/customer/orders`,
      {
        headers: requestHeaders,
      },
      CUSTOMER_ORDERS_REQUEST_TIMEOUT_MS,
    );

    if (response.status === 304) {
      return {
        notModified: true,
        orders: null,
        returns: null,
        counts: null,
        returnWindowDays: null,
        cancelReasonOptions: null,
        etag: response.headers.get("ETag") || etag,
      };
    }

    if (!response.ok) {
      throw createCustomerApiError(
        response,
        data,
        "Unable to load your orders.",
      );
    }

    return {
      notModified: false,
      orders: Array.isArray(data.data) ? data.data : [],
      // Returns/refunds ship with the order list so the Returns tab, the
      // per-order badges and the ETag all come from this one request.
      returns: Array.isArray(data.returns) ? data.returns : [],
      counts: data.counts && typeof data.counts === "object" ? data.counts : null,
      returnWindowDays: Number(data.return_window_days) || null,
      // One list for the whole page, not one per order - the codes are the same
      // for every order and the ETag covers the payload, so a new option would
      // invalidate the cache on its own.
      cancelReasonOptions: Array.isArray(data.cancel_reason_options)
        ? data.cancel_reason_options
        : [],
      etag: response.headers.get("ETag") || "",
    };
  };

  const fetchCustomerOrderDetail = async (
    customerToken,
    orderId,
    etag = "",
  ) => {
    const requestHeaders = {
      Accept: "application/json",
      Authorization: `Bearer ${customerToken}`,
    };
    if (etag) requestHeaders["If-None-Match"] = etag;

    const { response, data } = await fetchJsonWithTimeout(
      `${API_BASE_URL}/customer/orders/${orderId}`,
      {
        headers: requestHeaders,
      },
    );

    if (response.status === 304) {
      return {
        notModified: true,
        detail: null,
        etag: response.headers.get("ETag") || etag,
      };
    }

    if (!response.ok) {
      throw createCustomerApiError(
        response,
        data,
        "Unable to load order details.",
      );
    }

    return {
      notModified: false,
      detail: data.data || null,
      etag: response.headers.get("ETag") || "",
    };
  };

  // Return detail carries the audit timeline, which the order-list payload
  // deliberately leaves out, so the detail modal fetches it on demand.
  const fetchCustomerReturnDetail = async (customerToken, returnId) => {
    const { response, data } = await fetchJsonWithTimeout(
      `${API_BASE_URL}/customer/returns/${returnId}`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${customerToken}`,
        },
      },
    );

    if (!response.ok) {
      throw createCustomerApiError(
        response,
        data,
        "Unable to load return details.",
      );
    }

    return data.data || null;
  };

  const openOrdersModal = (activeUserInfo) => {
    if (!customerOrdersController) {
      const overlay = document.createElement("div");
      overlay.id = "customerOrdersModal";
      overlay.className = "customer-orders-overlay ux-dlg";
      overlay.innerHTML = `
        <section class="customer-orders-modal ux-dlg__card" role="dialog" aria-modal="true" aria-labelledby="customerOrdersTitle">
          <div class="customer-orders-head ux-dlg__head">
            <button type="button" class="customer-orders-close ux-dlg__close" id="closeCustomerOrdersModal" aria-label="Close">&times;</button>
            <span class="ux-dlg__badge" aria-hidden="true"><i class="fa-solid fa-bag-shopping"></i></span>
            <p class="ux-dlg__eyebrow">Order tracking</p>
            <h2 class="customer-orders-title ux-dlg__title" id="customerOrdersTitle">My Orders</h2>
            <p class="customer-orders-subtitle">Track every order from payment to completion.</p>
            <p class="customer-orders-sync-status is-syncing" id="customerOrdersSyncStatus" aria-live="polite">
              <span class="customer-orders-sync-dot" aria-hidden="true"></span>
              <span>Loading current orders...</span>
            </p>
          </div>

          <div class="customer-orders-tabs" id="customerOrdersTabs">
            <button type="button" class="customer-orders-tab active" data-tab="all">All <span class="customer-orders-tab-count">0</span></button>
            <button type="button" class="customer-orders-tab" data-tab="to_pay">To Pay <span class="customer-orders-tab-count">0</span></button>
            <button type="button" class="customer-orders-tab" data-tab="to_ship">To Ship <span class="customer-orders-tab-count">0</span></button>
            <button type="button" class="customer-orders-tab" data-tab="to_receive">To Receive <span class="customer-orders-tab-count">0</span></button>
            <button type="button" class="customer-orders-tab" data-tab="completed">Completed <span class="customer-orders-tab-count">0</span></button>
            <button type="button" class="customer-orders-tab" data-tab="to_rate">To Rate <span class="customer-orders-tab-count">0</span></button>
            <button type="button" class="customer-orders-tab" data-tab="returns">Returns <span class="customer-orders-tab-count">0</span></button>
            <button type="button" class="customer-orders-tab" data-tab="cancelled">Cancelled <span class="customer-orders-tab-count">0</span></button>
          </div>

          <div class="customer-orders-viewport" id="customerOrdersViewport">
            <div class="customer-orders-track" id="customerOrdersTrack">
              <section class="customer-orders-panel" data-panel="all"></section>
              <section class="customer-orders-panel" data-panel="to_pay"></section>
              <section class="customer-orders-panel" data-panel="to_ship"></section>
              <section class="customer-orders-panel" data-panel="to_receive"></section>
              <section class="customer-orders-panel" data-panel="completed"></section>
              <section class="customer-orders-panel" data-panel="to_rate"></section>
              <section class="customer-orders-panel" data-panel="returns"></section>
              <section class="customer-orders-panel" data-panel="cancelled"></section>
            </div>
          </div>

          <section class="customer-order-detail-modal ux-dlg__card" id="customerOrderDetailModal" aria-hidden="true">
            <div class="customer-order-detail-head ux-dlg__head">
              <button type="button" class="customer-orders-close ux-dlg__close" id="closeCustomerOrderDetail" aria-label="Close">&times;</button>
              <span class="ux-dlg__badge" aria-hidden="true"><i class="fa-solid fa-receipt"></i></span>
              <p class="ux-dlg__eyebrow">Order record</p>
              <h3 id="customerOrderDetailTitle" class="ux-dlg__title">Order Details</h3>
            </div>
            <div class="customer-order-detail-content" id="customerOrderDetailContent"></div>
          </section>
        </section>
      `;
      document.body.appendChild(overlay);

      const tabs = Array.from(overlay.querySelectorAll(".customer-orders-tab"));
      const panels = Array.from(
        overlay.querySelectorAll(".customer-orders-panel"),
      );
      const track = overlay.querySelector("#customerOrdersTrack");
      const viewport = overlay.querySelector("#customerOrdersViewport");
      // The chip strip is one scrolling line now, so the active chip has to be
      // scrolled into view whenever the panel changes by swipe.
      const tabStrip = overlay.querySelector("#customerOrdersTabs");
      const closeBtn = overlay.querySelector("#closeCustomerOrdersModal");
      const detailModal = overlay.querySelector("#customerOrderDetailModal");
      const detailContent = overlay.querySelector(
        "#customerOrderDetailContent",
      );
      const detailTitle = overlay.querySelector("#customerOrderDetailTitle");
      const closeDetailBtn = overlay.querySelector("#closeCustomerOrderDetail");
      const syncStatus = overlay.querySelector("#customerOrdersSyncStatus");
      const stageByPanel = [
        "all",
        "to_pay",
        "to_ship",
        "to_receive",
        "completed",
        "to_rate",
        "returns",
        // Cancelled orders keep the stage they died at, so they cannot live in a
        // stage panel. They get their own tab, the way Shopee and Lazada do it.
        "cancelled",
      ];
      // Panel indexes used by handlers that jump the drawer to a tab.
      const RETURNS_PANEL_INDEX = stageByPanel.indexOf("returns");

      const state = {
        activeIndex: 0,
        userInfo: null,
        cacheKey: "",
        token: "",
        orders: [],
        // Returns are their own records, not order rows. They ride along with
        // the order list response so the tab needs no extra request.
        returns: [],
        returnWindowDays: 7,
        // The reason list the cancel sheet offers. Sent once at the root of the
        // orders payload rather than per order, and kept here so the sheet never
        // shows a code the API would reject.
        cancelReasonOptions: [],
        returnDetailsById: new Map(),
        activeReturnDetailId: null,
        returnDetailLoading: false,
        detailsById: new Map(),
        detailEtagsById: new Map(),
        etag: "",
        loading: false,
        refreshInProgress: false,
        refreshQueued: false,
        lastRefreshAt: 0,
        detailLoading: false,
        activeDetailId: null,
        lastDetailRefreshAt: 0,
        lastRealtimeSignalTs: 0,
        refreshTimer: null,
        touchStartX: 0,
        touchStartY: 0,
        // Swipe bookkeeping. `dragging` flips only once the gesture has proven
        // itself horizontal, so taps on the buttons inside a panel are never
        // swallowed; `didDrag` suppresses the click the browser fires after a
        // drag release.
        dragging: false,
        didDrag: false,
        // "" until the finger has moved far enough to decide, then "x" (the
        // carousel takes over) or "y" (the panel keeps its own scroll).
        axisLock: "",
      };

      let orderImageObserver = null;

      const setSyncStatus = (mode, message) => {
        if (!syncStatus) return;
        syncStatus.classList.toggle("is-syncing", mode === "syncing");
        syncStatus.classList.toggle("is-live", mode === "live");
        syncStatus.classList.toggle("is-offline", mode === "offline");
        const label = syncStatus.querySelector("span:last-child");
        if (label) label.textContent = message;
      };

      const resolveCustomerOrderImageUrl = (endpoint) => {
        const value = String(endpoint || "").trim();
        if (!value) return "";
        if (/^https?:\/\//i.test(value)) return value;
        return `${API_BASE_URL}/${value.replace(/^\/+/, "")}`;
      };

      const resolveCustomerOrderFullImageEndpoint = (
        fullEndpoint,
        thumbnailEndpoint,
      ) => {
        const explicit = String(fullEndpoint || "").trim();
        if (explicit) return explicit;

        const thumbnail = String(thumbnailEndpoint || "").trim();
        if (!thumbnail) return "";
        const [path, query = ""] = thumbnail.split("?", 2);
        const params = new URLSearchParams(query);
        params.delete("thumbnail");
        const remainingQuery = params.toString();
        return remainingQuery ? `${path}?${remainingQuery}` : path;
      };

      const runCustomerOrderImageTask = async (task) => {
        // Always resolves. A rejected promise here used to leave the thumbnail
        // stuck on its loading spinner forever.
        try {
          const response = await fetchBinaryWithTimeout(
            resolveCustomerOrderImageUrl(task.endpoint),
            {
              headers: {
                Accept:
                  "application/json,image/avif,image/webp,image/png,image/jpeg,*/*",
                Authorization: `Bearer ${state.token}`,
              },
              cache: "force-cache",
            },
            task.timeoutMs || 15000,
          );

          if (!response.ok) return "";

          const blob = await response.blob();
          if (!blob || !blob.size) return "";

          return URL.createObjectURL(blob);
        } catch {
          return "";
        }
      };

      const pumpCustomerOrderImageQueue = () => {
        while (
          activeCustomerOrderImageRequests < CUSTOMER_ORDER_IMAGE_MAX_CONCURRENT &&
          customerOrderImageQueue.length
        ) {
          const task = customerOrderImageQueue.shift();
          if (!task) continue;

          activeCustomerOrderImageRequests += 1;

          // `runCustomerOrderImageTask` is async, so the settle callback always
          // runs on a later tick. The in-flight counter can never leak, which
          // keeps the queue draining even when a request fails.
          void runCustomerOrderImageTask(task).then((objectUrl) => {
            if (!objectUrl) {
              customerOrderImageCache.delete(task.endpoint);
            }
            activeCustomerOrderImageRequests -= 1;
            task.resolve(objectUrl);
            pumpCustomerOrderImageQueue();
          });
        }
      };

      const loadCustomerOrderImage = (
        endpoint,
        { priority = false, timeoutMs = 15000 } = {},
      ) => {
        const key = String(endpoint || "").trim();
        if (!key) return Promise.resolve("");
        if (customerOrderImageCache.has(key)) {
          return customerOrderImageCache.get(key);
        }

        const imagePromise = new Promise((resolve) => {
          const task = { endpoint: key, resolve, timeoutMs };
          if (priority) {
            customerOrderImageQueue.unshift(task);
          } else {
            customerOrderImageQueue.push(task);
          }
          pumpCustomerOrderImageQueue();
        });
        customerOrderImageCache.set(key, imagePromise);
        return imagePromise;
      };

      const settleCustomerOrderImageDecode = async (image, timeoutMs = 2000) => {
        if (!image || typeof image.decode !== "function") return;

        await Promise.race([
          image.decode().catch(() => {}),
          new Promise((resolve) => window.setTimeout(resolve, timeoutMs)),
        ]);
      };

      const hydrateCustomerOrderImages = (root = overlay) => {
        const images = Array.from(
          root.querySelectorAll("img[data-order-image-endpoint]"),
        ).filter((image) => image.dataset.orderImageObserved !== "true");
        if (!images.length) return;

        const hydrateImage = async (image) => {
          if (!image?.isConnected) return;
          image.dataset.orderImageObserved = "true";
          image.classList.add("is-loading");
          const trigger = image.closest(".customer-order-image-trigger");
          trigger?.classList.add("is-loading");
          trigger?.setAttribute("aria-busy", "true");

          let objectUrl = "";
          try {
            const endpoint = image.dataset.orderImageEndpoint || "";
            objectUrl = await loadCustomerOrderImage(endpoint);
            if (objectUrl && image.isConnected) {
              image.src = objectUrl;
              await settleCustomerOrderImageDecode(image);
            }
          } catch {
            // A failed thumbnail must still settle its placeholder below,
            // otherwise the spinner would spin forever.
            objectUrl = "";
          }

          const imageReady = Boolean(
            objectUrl && image.isConnected && image.naturalWidth > 0,
          );
          if (trigger) {
            trigger.classList.toggle("is-ready", imageReady);
            trigger.classList.toggle("is-unavailable", !imageReady);
            trigger.setAttribute("aria-busy", "false");
            if (!imageReady) trigger.setAttribute("aria-disabled", "true");
          }
          image.classList.remove("is-loading");
          trigger?.classList.remove("is-loading");
        };

        if (typeof IntersectionObserver !== "function") {
          images.forEach((image) => void hydrateImage(image));
          return;
        }

        if (!orderImageObserver) {
          orderImageObserver = new IntersectionObserver(
            (entries) => {
              entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                orderImageObserver?.unobserve(entry.target);
                void hydrateImage(entry.target);
              });
            },
            {
              root: null,
              rootMargin: "220px 0px",
              threshold: 0.01,
            },
          );
        }

        // Only visible cards (and a small scroll-ahead margin) request images.
        // Hidden tabs no longer compete with the realtime metadata request.
        images.forEach((image) => orderImageObserver.observe(image));
      };

      const shouldProcessRealtimeSignal = (payload = {}) => {
        const ts = Number(payload?.timestamp || 0);
        if (!Number.isFinite(ts) || ts <= 0) return true;
        if (ts <= state.lastRealtimeSignalTs) return false;
        state.lastRealtimeSignalTs = ts;
        return true;
      };

      const stopRealtimeRefresh = () => {
        if (state.refreshTimer) {
          window.clearInterval(state.refreshTimer);
          state.refreshTimer = null;
        }
      };

      // A 401 is terminal: the token in localStorage is gone server-side, so the
      // 3s poller would otherwise sit on "Showing saved orders - reconnecting..."
      // forever while every request failed, and a reload would land straight back
      // in the same dead session. Stop polling, drop the dead credentials and
      // hand the customer a way back in. Guarded because the list, the detail
      // sub-modal and the return detail can all fail in the same tick.
      let sessionExpiredHandled = false;
      const handleSessionExpired = async () => {
        if (sessionExpiredHandled) return;
        sessionExpiredHandled = true;

        stopRealtimeRefresh();
        state.token = "";
        state.loading = false;
        state.detailLoading = false;
        state.returnDetailLoading = false;
        state.refreshQueued = false;

        try {
          localStorage.removeItem("customer_token");
          localStorage.removeItem("customer_info");
        } catch {
          // Ignore storage write issues.
        }

        setSyncStatus("offline", "Session expired - please log in again");
        tabs.forEach((tab) => {
          const countEl = tab.querySelector(".customer-orders-tab-count");
          if (countEl) countEl.textContent = "0";
        });

        const expiredHtml = `
          <div class="customer-orders-empty">
            <i class="fa-regular fa-circle-xmark"></i>
            <p>Session expired. Please login again.</p>
            <a class="customer-orders-empty-action" href="../customer-auth/auth.html#login">Log in</a>
          </div>
        `;
        panels.forEach((panel) => {
          panel.innerHTML = expiredHtml;
        });
        if (detailModal?.classList.contains("show") && detailContent) {
          if (detailTitle) detailTitle.textContent = "Order Details";
          detailContent.innerHTML = expiredHtml;
        }

        await showCustomerPopup(
          "Your session has expired, so your orders cannot be loaded. You will be taken to the login page.",
          { title: "Login required" },
        );
        window.location.href = "../customer-auth/auth.html#login";
      };

      const startRealtimeRefresh = () => {
        stopRealtimeRefresh();
        state.refreshTimer = window.setInterval(() => {
          if (!overlay.classList.contains("show") || document.hidden) return;
          if (state.refreshInProgress) return;

          const popup = document.getElementById("customerSystemPopup");
          if (popup && popup.classList.contains("show")) return;

          const elapsed = Date.now() - state.lastRefreshAt;
          if (elapsed < CUSTOMER_ORDERS_MIN_REFRESH_GAP_MS) return;

          void refreshOrders(false);
        }, CUSTOMER_ORDERS_FALLBACK_SYNC_MS);
      };

      const close = () => {
        closeCustomerOrderImagePreview();
        overlay.classList.add("closing");
        overlay.classList.remove("show");
        stopRealtimeRefresh();
        state.activeDetailId = null;
        if (detailModal) {
          detailModal.classList.remove("show");
          detailModal.setAttribute("aria-hidden", "true");
        }
        setTimeout(() => {
          overlay.classList.remove("closing");
          document.body.style.overflow = "";
        }, 180);
      };

      const escapeHtml = (value) =>
        String(value || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\"/g, "&quot;")
          .replace(/'/g, "&#39;");

      let customerOrderImageLightbox = null;
      let customerOrderImagePreviewRequestId = 0;
      let customerOrderImagePreviewTrigger = null;

      // Single source of truth for every order thumbnail in the drawer
      // (All / To Pay / To Ship / To Receive / Completed / To Rate and the
      // Order Details list). Cards that only have an image endpoint start in
      // the loading state and are hydrated lazily by
      // `hydrateCustomerOrderImages`, so no tab renders a permanent spinner.
      const renderOrderThumbTrigger = (source, className = "") => {
        const name = escapeHtml(source?.product_name || "Custom Order");
        const imageSrc = escapeHtml(
          source?.product_image || CUSTOMER_ORDER_IMAGE_PLACEHOLDER,
        );
        const endpoint = escapeHtml(source?.product_image_endpoint || "");
        const fullEndpoint = escapeHtml(
          resolveCustomerOrderFullImageEndpoint(
            source?.product_image_full_endpoint,
            source?.product_image_endpoint,
          ),
        );
        const hasImage = Boolean(
          source?.product_image || source?.product_image_endpoint,
        );
        const imageState = source?.product_image_endpoint
          ? "is-loading"
          : source?.product_image
            ? "is-ready"
            : "is-unavailable";

        return `
          <button type="button" class="customer-order-image-trigger${className ? ` ${className}` : ""} ${imageState}" data-order-image-full-endpoint="${fullEndpoint}" data-order-image-title="${name}" aria-label="Expand image for ${name}" ${hasImage ? "" : 'aria-disabled="true" tabindex="-1"'}>
            <img src="${imageSrc}" ${endpoint ? `data-order-image-endpoint="${endpoint}"` : ""} alt="${name}" loading="lazy" />
            <span class="customer-order-image-loading" aria-hidden="true"><i class="fa-solid fa-spinner fa-spin"></i></span>
            <span class="customer-order-image-expand" aria-hidden="true"><i class="fa-solid fa-expand"></i></span>
            <span class="customer-order-image-unavailable" aria-hidden="true"><i class="fa-regular fa-image"></i></span>
          </button>
        `;
      };

      const ensureCustomerOrderImageLightbox = () => {
        if (customerOrderImageLightbox) return customerOrderImageLightbox;

        customerOrderImageLightbox = document.createElement("div");
        customerOrderImageLightbox.id = "customerOrderImageLightbox";
        customerOrderImageLightbox.className =
          "modal-overlay customer-order-image-lightbox";
        customerOrderImageLightbox.setAttribute("aria-hidden", "true");
        customerOrderImageLightbox.innerHTML = `
          <div class="lightbox-box customer-order-lightbox-box" role="dialog" aria-modal="true" aria-labelledby="customerOrderLightboxCaption">
            <button type="button" class="lightbox-close-btn" data-close-order-image aria-label="Close image preview">&times;</button>
            <div class="customer-order-lightbox-media">
              <div class="customer-order-lightbox-loading" role="status" aria-live="polite">
                <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
                <span>Loading full image...</span>
              </div>
              <img class="customer-order-lightbox-image" alt="" />
            </div>
            <p id="customerOrderLightboxCaption" class="lightbox-caption"></p>
          </div>
        `;
        document.body.appendChild(customerOrderImageLightbox);

        customerOrderImageLightbox
          .querySelector("[data-close-order-image]")
          ?.addEventListener("click", () => closeCustomerOrderImagePreview());
        customerOrderImageLightbox.addEventListener("click", (event) => {
          if (event.target === customerOrderImageLightbox) {
            closeCustomerOrderImagePreview();
          }
        });

        return customerOrderImageLightbox;
      };

      const closeCustomerOrderImagePreview = () => {
        customerOrderImagePreviewRequestId += 1;
        customerOrderImageLightbox?.classList.remove("show-modal");
        customerOrderImageLightbox?.classList.remove(
          "is-loading",
          "is-ready",
          "has-error",
        );
        customerOrderImageLightbox?.setAttribute("aria-hidden", "true");
        if (customerOrderImagePreviewTrigger?.isConnected) {
          customerOrderImagePreviewTrigger.focus({ preventScroll: true });
        }
        customerOrderImagePreviewTrigger = null;
      };

      const openCustomerOrderImagePreview = async (trigger) => {
        if (!trigger || trigger.getAttribute("aria-disabled") === "true") return;

        const sourceImage = trigger.querySelector("img");
        const fullEndpoint =
          trigger.getAttribute("data-order-image-full-endpoint") || "";
        const title =
          trigger.getAttribute("data-order-image-title") ||
          sourceImage?.alt ||
          "Product Image";
        const lightbox = ensureCustomerOrderImageLightbox();
        const previewImage = lightbox.querySelector(
          ".customer-order-lightbox-image",
        );
        const caption = lightbox.querySelector(".lightbox-caption");
        const loadingLabel = lightbox.querySelector(
          ".customer-order-lightbox-loading span",
        );
        const closeButton = lightbox.querySelector("[data-close-order-image]");
        const requestId = ++customerOrderImagePreviewRequestId;

        customerOrderImagePreviewTrigger = trigger;
        if (caption) caption.textContent = title;
        if (loadingLabel) loadingLabel.textContent = "Loading full image...";
        if (previewImage) {
          previewImage.alt = `${title} large preview`;
          if (trigger.classList.contains("is-ready") && sourceImage?.src) {
            previewImage.src = sourceImage.currentSrc || sourceImage.src;
          } else {
            previewImage.removeAttribute("src");
          }
        }

        lightbox.classList.remove("is-ready", "has-error");
        lightbox.classList.add("show-modal", "is-loading");
        lightbox.setAttribute("aria-hidden", "false");
        closeButton?.focus();

        const expandedSource = fullEndpoint
          ? await loadCustomerOrderImage(fullEndpoint, {
              priority: true,
              timeoutMs: 30000,
            })
          : sourceImage?.currentSrc || sourceImage?.src || "";

        if (
          requestId !== customerOrderImagePreviewRequestId ||
          !lightbox.classList.contains("show-modal")
        ) {
          return;
        }

        if (!expandedSource || !previewImage) {
          lightbox.classList.remove("is-loading");
          lightbox.classList.add("has-error");
          if (loadingLabel) loadingLabel.textContent = "Image unavailable.";
          return;
        }

        previewImage.src = expandedSource;
        await settleCustomerOrderImageDecode(previewImage, 4000);
        if (requestId !== customerOrderImagePreviewRequestId) return;

        lightbox.classList.remove("is-loading", "has-error");
        lightbox.classList.add("is-ready");
      };

      const formatOrderDate = (isoDate) => {
        if (!isoDate) return "-";
        const date = new Date(isoDate);
        if (Number.isNaN(date.getTime())) return String(isoDate);
        return date.toLocaleString("en-PH", {
          timeZone: PHILIPPINES_TIME_ZONE,
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
      };

      const renderEmptyState = (stageKey) => {
        const labels = {
          all: "No orders yet.",
          to_pay: "No orders are waiting for payment.",
          to_ship: "No orders are waiting for shipping.",
          to_receive: "No orders are waiting for delivery/pickup.",
          completed: "No completed orders yet.",
          to_rate: "No products to rate yet.",
          returns: "No return or refund requests yet.",
          cancelled: "No cancelled orders.",
        };

        return `
          <div class="customer-orders-empty">
            <i class="fa-regular fa-folder-open"></i>
            <p>${labels[stageKey] || "No orders found."}</p>
          </div>
        `;
      };

      const renderLoadingState = () => `
        <div class="customer-orders-empty">
          <i class="fa-solid fa-spinner fa-spin"></i>
          <p>Fetching your orders...</p>
        </div>
      `;

      // Rank used by the "All" tab. Rejected and cancelled orders stay visible
      // but are terminal, so they must never outrank a live order. They share a
      // rank because neither is more urgent than the other - the recency
      // tie-break below decides which dead order is listed first.
      const resolveAllTabRank = (order) => {
        const lifecycle = String(order?.lifecycle_status || "").toLowerCase();
        if (lifecycle === "rejected" || lifecycle === "cancelled") {
          return ALL_TAB_REJECTED_RANK;
        }

        const stage = String(order?.customer_stage || "");
        return Object.prototype.hasOwnProperty.call(
          ALL_TAB_STAGE_PRIORITY,
          stage,
        )
          ? ALL_TAB_STAGE_PRIORITY[stage]
          : ALL_TAB_UNKNOWN_STAGE_RANK;
      };

      const resolveOrderRecencyKey = (order) => {
        const parsed = Date.parse(order?.created_at || "");
        return Number.isFinite(parsed) ? parsed : null;
      };

      // Terminal states that must not be counted as live work in a stage tab. A
      // cancelled order keeps `customer_stage` as it was when it died, so
      // filtering on the stage alone would leave it sitting in To Pay or To Ship
      // as though FMRC were still waiting on it.
      const isDeadOrder = (order) => {
        const lifecycle = String(order?.lifecycle_status || "").toLowerCase();
        return lifecycle === "rejected" || lifecycle === "cancelled";
      };

      const getVisibleOrdersByPanel = (stageKey) => {
        if (stageKey === "returns") {
          // Returns are their own records. The server already sorts them
          // open-first/newest-first; the copy keeps state.returns untouched.
          return state.returns.slice();
        }
        if (stageKey === "cancelled") {
          // Newest first: a cancellation is something the customer just did, so
          // the most recent one is the one they are looking for.
          return state.orders
            .filter(
              (order) =>
                String(order.lifecycle_status || "").toLowerCase() ===
                "cancelled",
            )
            .sort((left, right) => {
              const leftTime = resolveOrderRecencyKey(left);
              const rightTime = resolveOrderRecencyKey(right);
              if (
                leftTime !== null &&
                rightTime !== null &&
                leftTime !== rightTime
              ) {
                return rightTime - leftTime;
              }
              return (Number(right?.id) || 0) - (Number(left?.id) || 0);
            });
        }
        if (stageKey === "all") {
          // A sorted copy: renderOrders(), the tab counters and the
          // sessionStorage cache all read state.orders in server order.
          return state.orders.slice().sort((left, right) => {
            const rankDiff = resolveAllTabRank(left) - resolveAllTabRank(right);
            if (rankDiff !== 0) return rankDiff;

            const leftTime = resolveOrderRecencyKey(left);
            const rightTime = resolveOrderRecencyKey(right);
            if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
              return rightTime - leftTime;
            }

            return (Number(right?.id) || 0) - (Number(left?.id) || 0);
          });
        }
        if (stageKey === "to_rate") {
          // Returns completed orders â€” split into rated/unrated is done in renderToRatePanel
          return state.orders.filter(
            (order) =>
              !isDeadOrder(order) &&
              String(order.customer_stage || "") === "completed",
          );
        }
        if (stageKey === "completed") {
          return state.orders.filter(
            (order) =>
              !isDeadOrder(order) &&
              String(order.customer_stage || "") === "completed",
          );
        }

        return state.orders.filter(
          (order) =>
            !isDeadOrder(order) &&
            String(order.customer_stage || "") === stageKey,
        );
      };

      const setActivePanel = (index) => {
        const nextIndex = Math.min(Math.max(index, 0), stageByPanel.length - 1);
        state.activeIndex = nextIndex;

        tabs.forEach((tab, tabIndex) => {
          tab.classList.toggle("active", tabIndex === nextIndex);
        });

        if (track) {
          // Clear any inline transition left behind by a finger drag so taps and
          // swipe releases both animate.
          track.style.transition = "";
          track.style.transform = `translateX(-${nextIndex * 100}%)`;
        }

        // With eight chips on one scrolling line the active chip can sit off
        // screen after a swipe. Only scroll when the strip actually overflows,
        // otherwise `scrollIntoView` nudges the page itself.
        const activeTab = tabs[nextIndex];
        if (
          activeTab &&
          tabStrip &&
          tabStrip.scrollWidth > tabStrip.clientWidth + 1
        ) {
          activeTab.scrollIntoView({
            inline: "center",
            block: "nearest",
            behavior: "smooth",
          });
        }
      };

      const resolveOrderStatusMeta = (order) => {
        const lifecycle = String(
          order?.lifecycle_status || "pending",
        ).toLowerCase();
        const stage = ORDER_STAGE_FLOW.includes(order?.customer_stage)
          ? order.customer_stage
          : "to_pay";

        if (lifecycle === "rejected") {
          return {
            label: ORDER_LIFECYCLE_LABELS.rejected,
            className: "status-rejected",
          };
        }

        // Both cancellation states are checked before anything stage-based: a
        // cancelled order keeps the stage it died at, so falling through would
        // label a cancelled To Pay order "To Pay" as though it were still live.
        if (lifecycle === "cancelled") {
          return {
            label: ORDER_LIFECYCLE_LABELS.cancelled,
            className: "status-cancelled",
          };
        }

        if (order?.cancel_pending) {
          return {
            label: "Cancelling",
            className: "status-cancel-pending",
          };
        }

        if (lifecycle === "completed" || stage === "completed") {
          return {
            label: ORDER_STAGE_LABELS.completed,
            className: "status-completed",
          };
        }

        // A GCash order sitting in To Pay has three meaningfully different
        // states, and "To Pay" describes only the first of them.
        if (stage === "to_pay") {
          if (order?.payment_under_review) {
            return { label: "Under Review", className: "status-to-pay is-review" };
          }
          if (order?.payment_is_overdue) {
            return { label: "Payment Overdue", className: "status-to-pay is-overdue" };
          }
        }

        return {
          label:
            order?.customer_stage_label ||
            resolveStageLabels(order)[stage] ||
            ORDER_LIFECYCLE_LABELS[lifecycle] ||
            "Pending",
          className: `status-${stage.replace("_", "-")}`,
        };
      };

      const renderStarsRow = (count) => {
        const n = Math.max(0, Math.min(5, Number(count) || 0));
        let out = "";
        for (let i = 1; i <= 5; i += 1) {
          out += `<span class="customer-rating-star-display${i <= n ? " filled" : ""}">&#9733;</span>`;
        }
        return out;
      };

      const renderToRatePanel = (completedOrders) => {
        const toRate = completedOrders.filter((order) => !order.has_rating);
        const rated = completedOrders.filter((order) => order.has_rating);

        const reviewItemSummary = (order) => {
          const names = (Array.isArray(order.items) ? order.items : [])
            .map((item) => item?.product_name || "Product")
            .filter(Boolean);
          const title = names.length > 1
            ? `${names.length} products to review`
            : (names[0] || "Custom Order");
          return {
            title,
            names: names.length ? names.join(" • ") : "Product details unavailable",
            count: names.length || 1,
          };
        };

        const toRateCards = toRate.length
          ? toRate
              .map((order) => {
                const reviewSummary = reviewItemSummary(order);
                const productName = escapeHtml(reviewSummary.title);
                const itemNames = escapeHtml(reviewSummary.names);
                const orderNo = escapeHtml(
                  order.order_no_display ||
                    `#${order.order_no || order.id || "-"}`,
                );
                const totalLabel = formatOrderCurrency(
                  Number(order.total_amount || 0) || 0,
                );
                return `
                  <article class="customer-torate-card">
                    <div class="customer-order-thumb">
                      ${renderOrderThumbTrigger(order)}
                    </div>
                    <div class="customer-torate-main">
                      <h4>${productName}</h4>
                      <p class="customer-order-item-names">${itemNames}</p>
                      <p class="customer-order-meta">Order ${orderNo}</p>
                      <p class="customer-order-meta">Delivered &bull; ${formatOrderDate(order.created_at)}</p>
                    </div>
                    <div class="customer-torate-side">
                      <strong class="customer-order-price">${totalLabel}</strong>
                      <button type="button" class="customer-order-rate-btn" data-order-rate="${escapeHtml(order.id)}" data-order-name="${productName}">Rate ${reviewSummary.count > 1 ? "products" : "now"}</button>
                    </div>
                  </article>
                `;
              })
              .join("")
          : `
              <div class="customer-orders-empty compact">
                <i class="fa-regular fa-star"></i>
                <p>No products waiting to be rated.</p>
              </div>
            `;

        const ratedCards = rated.length
          ? rated
              .map((order) => {
                const reviewSummary = reviewItemSummary(order);
                const productName = escapeHtml(reviewSummary.title);
                const itemNames = escapeHtml(reviewSummary.names);
                const orderNo = escapeHtml(
                  order.order_no_display ||
                    `#${order.order_no || order.id || "-"}`,
                );
                const feedback = escapeHtml(order.rating_feedback || "");
                const stars = Number(order.rating_stars || 0);
                const adminReply = escapeHtml(order.rating_admin_reply || "");
                return `
                  <article class="customer-rated-card">
                    <div class="customer-order-thumb">
                      ${renderOrderThumbTrigger(order)}
                    </div>
                    <div class="customer-rated-main">
                      <h4>${productName}</h4>
                      <p class="customer-order-item-names">${itemNames}</p>
                      <p class="customer-order-meta">Order ${orderNo}</p>
                      <div class="customer-rated-stars">${renderStarsRow(stars)}<span class="customer-rated-score">${stars}.0</span></div>
                      ${
                        feedback
                          ? `<p class="customer-rated-feedback">"${feedback}"</p>`
                          : `<p class="customer-rated-feedback muted">No written feedback.</p>`
                      }
                      ${
                        adminReply
                          ? `<div class="customer-rated-admin-reply"><i class="fa-solid fa-reply"></i> <strong>Store Reply:</strong> ${adminReply}</div>`
                          : ''
                      }
                    </div>
                    <div class="customer-rated-side">
                      <button type="button" class="customer-order-rate-btn ghost" data-order-rate="${escapeHtml(order.id)}" data-order-name="${productName}">Edit Reviews</button>
                    </div>
                  </article>
                `;
              })
              .join("")
          : `
              <div class="customer-orders-empty compact">
                <i class="fa-regular fa-comment-dots"></i>
                <p>You haven't rated any products yet.</p>
              </div>
            `;

        return `
          <div class="customer-torate-wrap">
            <section class="customer-torate-section">
              <div class="customer-torate-section-head">
                <h3><i class="fa-regular fa-star"></i> To Rate</h3>
                <span class="customer-torate-badge">${toRate.length}</span>
              </div>
              <div class="customer-torate-list">${toRateCards}</div>
            </section>
            <section class="customer-torate-section">
              <div class="customer-torate-section-head">
                <h3><i class="fa-solid fa-star"></i> My Ratings</h3>
                <span class="customer-torate-badge alt">${rated.length}</span>
              </div>
              <div class="customer-torate-list">${ratedCards}</div>
            </section>
          </div>
        `;
      };

      // ── Returns & Refunds ──────────────────────────────────────────────────
      // Return records live beside the orders in the same payload. They render
      // in their own tab with the order-card shell, so nothing new is invented
      // visually — only the status palette is extended.

      const RETURN_STATUS_PILL_CLASS = {
        requested: "status-requested",
        approved: "status-approved",
        item_in_transit: "status-in-transit",
        item_received: "status-received",
        refund_processing: "status-processing",
        refunded: "status-refunded",
        rejected: "status-rejected",
        cancelled: "status-cancelled",
      };

      const RETURN_STATUS_ICON = {
        requested: "fa-regular fa-clock",
        approved: "fa-solid fa-circle-check",
        item_in_transit: "fa-solid fa-truck-fast",
        item_received: "fa-solid fa-box-open",
        refund_processing: "fa-solid fa-rotate",
        refunded: "fa-solid fa-peso-sign",
        rejected: "fa-regular fa-circle-xmark",
        cancelled: "fa-solid fa-ban",
      };

      const RETURN_ACTOR_LABELS = {
        customer: "You",
        admin: "Store admin",
        staff: "Store staff",
        system: "System",
      };

      const resolveReturnPillClass = (status) =>
        RETURN_STATUS_PILL_CLASS[String(status || "")] || "status-requested";

      /**
       * Return items only carry names and prices. Borrow the thumbnail from the
       * matching order line already in memory so the card looks like every
       * other row instead of falling back to the placeholder.
       */
      const resolveReturnThumbSource = (returnRow) => {
        const firstLine = (Array.isArray(returnRow?.items) ? returnRow.items : [])[0];
        const order = state.orders.find(
          (row) => String(row.id) === String(returnRow?.order_id),
        );
        const orderItems = Array.isArray(order?.items) ? order.items : [];
        const matched =
          orderItems.find(
            (item) => String(item?.id) === String(firstLine?.order_item_id),
          ) ||
          orderItems.find(
            (item) => String(item?.product_id) === String(firstLine?.product_id),
          ) ||
          order ||
          null;

        return {
          ...(matched || {}),
          product_name:
            returnRow?.product_name || firstLine?.product_name || "Returned item",
        };
      };

      /** The money figure that matters most at this point of the lifecycle. */
      const resolveReturnAmount = (returnRow) => {
        if (returnRow?.refunded_amount_label) {
          return { label: returnRow.refunded_amount_label, caption: "Refunded" };
        }
        if (returnRow?.approved_amount_label) {
          return { label: returnRow.approved_amount_label, caption: "Approved" };
        }
        return {
          label:
            returnRow?.requested_amount_label ||
            formatOrderCurrency(Number(returnRow?.requested_amount || 0) || 0),
          caption: "Requested",
        };
      };

      const renderReturnCard = (returnRow) => {
        const status = String(returnRow?.status || "requested");
        const pillClass = resolveReturnPillClass(status);
        const statusIcon = RETURN_STATUS_ICON[status] || "fa-regular fa-clock";
        const returnNo = escapeHtml(
          returnRow?.return_no_display || `#${returnRow?.return_no || returnRow?.id || "-"}`,
        );
        const orderNo = escapeHtml(
          returnRow?.order_no_display || `#${returnRow?.order_no || returnRow?.order_id || "-"}`,
        );
        const quantity = Math.max(1, Number(returnRow?.quantity) || 1);
        const amount = resolveReturnAmount(returnRow);
        const latestEvent = returnRow?.latest_event || null;

        return `
          <article class="customer-order-card customer-return-card" data-return-row="${escapeHtml(returnRow?.id)}">
            <div class="customer-order-thumb">
              ${renderOrderThumbTrigger(resolveReturnThumbSource(returnRow))}
            </div>
            <div class="customer-order-main">
              <h4>${escapeHtml(returnRow?.product_name || "Returned item")}</h4>
              <p class="customer-order-meta">Return ${returnNo} &bull; Order ${orderNo}</p>
              <p class="customer-order-meta">${escapeHtml(returnRow?.reason_label || "Return request")} &bull; ${escapeHtml(returnRow?.resolution_label || "Refund")} &bull; ${quantity} item${quantity > 1 ? "s" : ""}</p>
              <p class="customer-order-meta">Filed ${escapeHtml(returnRow?.requested_at_label || formatOrderDate(returnRow?.requested_at || returnRow?.created_at))}</p>
              ${
                latestEvent
                  ? `<p class="customer-return-latest"><i class="${escapeHtml(statusIcon)}" aria-hidden="true"></i> ${escapeHtml(latestEvent.title || latestEvent.status_label || "Return update")}</p>`
                  : ""
              }
            </div>
            <div class="customer-order-side">
              <span class="customer-return-status ${pillClass}"><i class="${escapeHtml(statusIcon)}" aria-hidden="true"></i> ${escapeHtml(returnRow?.status_label || "Requested")}</span>
              <strong class="customer-order-price">${escapeHtml(amount.label)}</strong>
              <span class="customer-return-amount-caption">${escapeHtml(amount.caption)}</span>
            </div>
            <div class="customer-order-actions">
              <button type="button" class="customer-order-detail-btn" data-return-detail="${escapeHtml(returnRow?.id)}">Return Details</button>
              ${
                returnRow?.can_cancel
                  ? `<button type="button" class="customer-order-return-cancel-btn" data-return-cancel="${escapeHtml(returnRow?.id)}" data-return-no="${returnNo}">Cancel Request</button>`
                  : ""
              }
              ${
                returnRow?.can_ship_back
                  ? `<button type="button" class="customer-order-return-ship-btn" data-return-ship="${escapeHtml(returnRow?.id)}" data-return-no="${returnNo}"><i class="fa-solid fa-truck-fast" aria-hidden="true"></i> Item Shipped Back</button>`
                  : ""
              }
            </div>
          </article>
        `;
      };

      const renderReturnsPanel = (returnRows) => {
        const openRows = returnRows.filter(
          (row) => String(row?.status_group || "open") === "open",
        );
        const closedRows = returnRows.filter(
          (row) => String(row?.status_group || "open") !== "open",
        );

        const openMarkup = openRows.length
          ? openRows.map((row) => renderReturnCard(row)).join("")
          : `
              <div class="customer-orders-empty compact">
                <i class="fa-solid fa-rotate-left"></i>
                <p>No return or refund request is being processed.</p>
              </div>
            `;

        const closedMarkup = closedRows.length
          ? closedRows.map((row) => renderReturnCard(row)).join("")
          : `
              <div class="customer-orders-empty compact">
                <i class="fa-regular fa-folder-open"></i>
                <p>Completed and cancelled requests will appear here.</p>
              </div>
            `;

        return `
          <div class="customer-torate-wrap">
            <section class="customer-torate-section">
              <div class="customer-torate-section-head">
                <h3><i class="fa-solid fa-rotate-left"></i> In Progress</h3>
                <span class="customer-torate-badge">${openRows.length}</span>
              </div>
              <p class="customer-return-note">Returns can be filed within ${Number(state.returnWindowDays) || 7} days of completing an order. Keep the item and its packaging until the request is closed.</p>
              <div class="customer-torate-list">${openMarkup}</div>
            </section>
            <section class="customer-torate-section">
              <div class="customer-torate-section-head">
                <h3><i class="fa-solid fa-clipboard-check"></i> History</h3>
                <span class="customer-torate-badge alt">${closedRows.length}</span>
              </div>
              <div class="customer-torate-list">${closedMarkup}</div>
            </section>
          </div>
        `;
      };

      const handleOrderReceived = async (orderId, orderName, triggerBtn) => {
        if (!orderId) return;

        const token =
          state.token || localStorage.getItem("customer_token") || "";
        if (!token) {
          await showCustomerPopup("Your session has expired. Please login again.", {
            title: "Login required",
          });
          return;
        }

        // The same button closes a pickup and a delivery, but it means two
        // different things: "the courier handed it to me" versus "I walked into
        // the FMRC office and took it". The card marks which one this is.
        const isPickupOrder = triggerBtn?.dataset?.orderPickup === "1";
        const doneLabel = isPickupOrder ? "Order Collected" : "Order Received";

        const confirmed = await showCustomerPopup(
          isPickupOrder
            ? "Confirm that you have collected this order from the FMRC office? This action cannot be undone."
            : "Confirm that you have received this order? This action cannot be undone.",
          {
            title: doneLabel,
            isConfirm: true,
            okText: isPickupOrder ? "Yes, Collected" : "Yes, Received",
            cancelText: "Cancel",
            allowBackdropClose: false,
          },
        );

        if (!confirmed) return;

        if (triggerBtn) {
          triggerBtn.disabled = true;
          triggerBtn.textContent = "Processing...";
        }

        try {
          const { response: res, data } = await fetchJsonWithTimeout(
            `${API_BASE_URL}/customer/orders/${orderId}/received`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                Authorization: `Bearer ${token}`,
              },
            },
          );

          if (!res.ok) {
            throw new Error(data.message || "Unable to update order.");
          }

          state.lastDetailRefreshAt = 0;

          // Apply the persisted response immediately. This keeps the card out
          // of To Receive even when the follow-up order-list request is slow.
          const completedOrder = data?.data;
          if (completedOrder?.id !== undefined && completedOrder?.id !== null) {
            const completedId = String(completedOrder.id);
            const existingIndex = state.orders.findIndex(
              (order) => String(order.id) === completedId,
            );
            if (existingIndex >= 0) {
              state.orders[existingIndex] = {
                ...state.orders[existingIndex],
                ...completedOrder,
                customer_stage: "completed",
                lifecycle_status: "completed",
                has_rating: false,
              };
            } else {
              state.orders.unshift({
                ...completedOrder,
                customer_stage: "completed",
                lifecycle_status: "completed",
                has_rating: false,
              });
            }
            state.detailsById.set(completedId, completedOrder);
            state.etag = "";
            writeCustomerOrdersCache(state.cacheKey, state.orders, state.etag);
            renderOrders();
          }

          // Refresh in the background for server-calculated fields, rather
          // than blocking the completion feedback on a second API request.
          void refreshOrders(false, true);

          setActivePanel(4);

          const ratePromptPopup = document.createElement("div");
          ratePromptPopup.className = "customer-rate-prompt-popup";
          ratePromptPopup.setAttribute("data-order-id", orderId);
          ratePromptPopup.innerHTML = `
            <div class="customer-rate-prompt-inner">
              <span class="customer-rate-prompt-icon">&#127881;</span>
              <div class="customer-rate-prompt-text">
                <strong>${isPickupOrder ? "Order collected!" : "Order received!"}</strong>
                <p>How was your experience? <button type="button" class="customer-rate-prompt-link">Rate it now &rarr;</button></p>
              </div>
              <button type="button" class="customer-rate-prompt-close" aria-label="Close">&times;</button>
            </div>
          `;
          document.body.appendChild(ratePromptPopup);
          requestAnimationFrame(() => ratePromptPopup.classList.add("show"));

          const closePrompt = () => {
            ratePromptPopup.classList.remove("show");
            setTimeout(() => ratePromptPopup.remove(), 300);
          };

          ratePromptPopup
            .querySelector(".customer-rate-prompt-close")
            ?.addEventListener("click", closePrompt);
          ratePromptPopup
            .querySelector(".customer-rate-prompt-link")
            ?.addEventListener("click", () => {
              closePrompt();
              setActivePanel(5);
              const selectedOrder = state.orders.find((order) => String(order.id) === String(orderId));
              void openRatingModal(orderId, orderName, selectedOrder);
            });

          setTimeout(closePrompt, 8000);

          emitCustomerOrdersUpdated({
            type: "order-received",
            orderId: String(orderId),
            status: "completed",
          });
        } catch (err) {
          await showCustomerPopup(
            err?.message || "Unable to update order. Please try again.",
            { title: "Error" },
          );

          if (triggerBtn) {
            triggerBtn.disabled = false;
            triggerBtn.textContent = doneLabel;
          }
        }
      };

      // ── Buy Again ──────────────────────────────────────────────────────────
      // Completed orders can be reordered straight into the single-product
      // "Order summary" checkout on the products page. The handoff mirrors
      // `fmrc_pending_order_success`: a short-lived sessionStorage intent that
      // products.js consumes once the grid has finished loading.

      /** Order items that can still be reordered (they need a product_id). */
      const getBuyAgainItems = (order) =>
        (Array.isArray(order?.items) ? order.items : []).filter(
          (item) =>
            item &&
            item.product_id !== undefined &&
            item.product_id !== null &&
            String(item.product_id) !== "",
        );

      // Every customer page links to the products page, so resolve the URL from
      // the page's own link instead of guessing a relative depth.
      const resolveProductsPageUrl = () => {
        const link = document.querySelector(
          'a[href*="products-page/product.html"]',
        );
        return link?.href || "/products-page/product.html";
      };

      const isOnProductsPage = () =>
        typeof window.__fmrcConsumeBuyAgainIntent === "function";

      const startBuyAgain = (productId, productName) => {
        const id = Number(productId);
        if (!Number.isFinite(id) || id <= 0) {
          void showCustomerPopup(
            "This product can no longer be reordered because it is no longer listed.",
            { title: "Buy Again unavailable" },
          );
          return;
        }

        try {
          sessionStorage.setItem(
            BUY_AGAIN_INTENT_KEY,
            JSON.stringify({ productId: id, name: productName || "", ts: Date.now() }),
          );
        } catch {
          // Private-mode storage failure must not break the flow: the products
          // page simply won't auto-open the checkout.
        }

        close();

        // Already browsing the products page — no navigation, just replay the
        // intent through the same consumer the page uses on load. It waits for
        // the drawer's close animation because `close()` clears the body scroll
        // lock on a timer, which would otherwise undo the checkout modal's own.
        if (isOnProductsPage()) {
          window.setTimeout(() => window.__fmrcConsumeBuyAgainIntent(), 220);
          return;
        }

        window.location.href = resolveProductsPageUrl();
      };

      const openBuyAgainPicker = (order, items) => {
        const overlayEl = document.createElement("div");
        overlayEl.className = "customer-rating-overlay customer-buy-again-overlay ux-dlg";
        overlayEl.innerHTML = `
          <div class="customer-rating-card customer-buy-again-card ux-dlg__card" role="dialog" aria-modal="true" aria-labelledby="buyAgainTitle">
            <div class="customer-rating-head ux-dlg__head">
              <button type="button" class="customer-orders-close ux-dlg__close" data-buy-again-close aria-label="Close buy again picker">&times;</button>
              <span class="ux-dlg__badge" aria-hidden="true"><i class="fa-solid fa-cart-plus"></i></span>
              <div>
                <p class="customer-rating-eyebrow ux-dlg__eyebrow">Buy again</p>
                <h3 id="buyAgainTitle" class="ux-dlg__title">Choose a product to reorder</h3>
              </div>
            </div>
            <div class="customer-rating-body">
              <p class="customer-rating-product-name">Order ${escapeHtml(order.order_no_display || `#${order.order_no || order.id || "-"}`)} &bull; one product per checkout.</p>
              <div class="customer-order-detail-items-list customer-buy-again-list">
                ${items
                  .map((item) => {
                    const itemQty = Math.max(
                      1,
                      Number.parseInt(item.quantity || "1", 10) || 1,
                    );
                    const unitLabel = formatOrderCurrency(
                      Number(item.unit_price || 0),
                    );
                    return `
                      <div class="customer-order-detail-item customer-buy-again-option">
                        ${renderOrderThumbTrigger(item, "customer-order-detail-image-trigger")}
                        <div class="customer-order-detail-item-info">
                          <strong>${escapeHtml(item.product_name || "Custom Order")}</strong>
                          <span>Bought ${itemQty}&times; &nbsp;&bull;&nbsp; ${escapeHtml(unitLabel)} each</span>
                        </div>
                        <button type="button" class="customer-order-rate-btn customer-buy-again-pick" data-buy-again-pick="${escapeHtml(item.product_id)}" data-buy-again-name="${escapeHtml(item.product_name || "Custom Order")}">Buy Again</button>
                      </div>
                    `;
                  })
                  .join("")}
              </div>
            </div>
            <div class="customer-rating-actions ux-dlg__foot">
              <button type="button" class="customer-rating-cancel-btn ux-dlg__btn ux-dlg__btn--ghost" data-buy-again-close>Cancel</button>
            </div>
          </div>
        `;
        document.body.appendChild(overlayEl);
        hydrateCustomerOrderImages(overlayEl);
        requestAnimationFrame(() => overlayEl.classList.add("show"));
        document.body.style.overflow = "hidden";

        const dismiss = () => {
          overlayEl.classList.remove("show");
          document.removeEventListener("keydown", onKeydown, true);
          closeCustomerOrderImagePreview();
          setTimeout(() => overlayEl.remove(), 180);
        };

        const onKeydown = (event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          // The image preview stacks above the picker, so it unwinds first.
          if (customerOrderImageLightbox?.classList.contains("show-modal")) {
            closeCustomerOrderImagePreview();
            return;
          }
          dismiss();
        };
        document.addEventListener("keydown", onKeydown, true);

        overlayEl.addEventListener("click", (event) => {
          if (event.target?.closest?.("[data-buy-again-close]")) {
            event.preventDefault();
            dismiss();
            return;
          }

          const imageTrigger = event.target?.closest?.(".customer-order-image-trigger");
          if (imageTrigger) {
            event.preventDefault();
            event.stopPropagation();
            void openCustomerOrderImagePreview(imageTrigger);
            return;
          }

          const pickBtn = event.target?.closest?.("[data-buy-again-pick]");
          if (!pickBtn) return;
          event.preventDefault();
          event.stopPropagation();
          const productId = pickBtn.getAttribute("data-buy-again-pick") || "";
          const productName = pickBtn.getAttribute("data-buy-again-name") || "";
          dismiss();
          startBuyAgain(productId, productName);
        });
      };

      const handleBuyAgain = (orderId, fallbackProductId, fallbackName) => {
        const order = state.orders.find(
          (row) => String(row.id) === String(orderId),
        );
        const items = getBuyAgainItems(order);

        if (items.length > 1) {
          openBuyAgainPicker(order, items);
          return;
        }

        const picked = items[0];
        startBuyAgain(
          picked?.product_id ?? fallbackProductId,
          picked?.product_name ?? fallbackName,
        );
      };

      // Fallback click bridge: keeps actions working even if other page
      // listeners interfere with the modal's delegated handlers.
      window.__fmrcOrderReceived = (buttonEl) => {
        const orderId = buttonEl?.getAttribute?.("data-order-received") || "";
        const orderName = buttonEl?.getAttribute?.("data-order-name") || "Order";
        if (!orderId) return;
        void handleOrderReceived(orderId, orderName, buttonEl);
      };

      // Order cards are re-rendered whenever the customer order list refreshes.
      // Capture the click at document level so the receive action remains reliable
      // even if another card/modal listener stops event bubbling.
      document.addEventListener("click", (event) => {
        const receivedBtn = event.target?.closest?.("[data-order-received]");
        if (!receivedBtn || receivedBtn.dataset.receiveClickHandled === "true") return;

        receivedBtn.dataset.receiveClickHandled = "true";
        event.preventDefault();
        event.stopPropagation();
        window.__fmrcOrderReceived(receivedBtn);

        // A newly rendered card is a new element, so this only prevents duplicate
        // invocation from the same physical click.
        queueMicrotask(() => {
          delete receivedBtn.dataset.receiveClickHandled;
        });
      }, true);

      window.__fmrcOrderRate = (buttonEl) => {
        const orderId = buttonEl?.getAttribute?.("data-order-rate") || "";
        const orderName = buttonEl?.getAttribute?.("data-order-name") || "Order";
        if (!orderId) return;
        const selectedOrder = state.orders.find((order) => String(order.id) === String(orderId));
        void openRatingModal(orderId, orderName, selectedOrder);
      };

      window.__fmrcOrderBuyAgain = (buttonEl) => {
        const orderId = buttonEl?.getAttribute?.("data-order-buy-again") || "";
        if (!orderId) return;
        handleBuyAgain(
          orderId,
          buttonEl?.getAttribute?.("data-buy-again-product") || "",
          buttonEl?.getAttribute?.("data-buy-again-name") || "",
        );
      };

      document.addEventListener("click", (event) => {
        const buyAgainBtn = event.target?.closest?.("[data-order-buy-again]");
        if (!buyAgainBtn || buyAgainBtn.dataset.buyAgainClickHandled === "true") return;

        buyAgainBtn.dataset.buyAgainClickHandled = "true";
        event.preventDefault();
        event.stopPropagation();
        window.__fmrcOrderBuyAgain(buyAgainBtn);

        queueMicrotask(() => {
          delete buyAgainBtn.dataset.buyAgainClickHandled;
        });
      }, true);

      // ── Return actions ─────────────────────────────────────────────────────
      // Each handler follows handleOrderReceived step for step: token guard →
      // confirm → disable trigger → request → optimistic patch → cache write →
      // re-render → background refresh → jump to the Returns tab → toast →
      // realtime fan-out.

      /** Upsert a return record and keep the owning order's badge in step. */
      const applyReturnRecord = (record) => {
        if (!record || record.id === undefined || record.id === null) return;

        const key = String(record.id);
        const index = state.returns.findIndex((row) => String(row?.id) === key);
        if (index >= 0) {
          state.returns[index] = { ...state.returns[index], ...record };
        } else {
          state.returns.unshift(record);
        }
        state.returnDetailsById.set(key, record);

        const orderIndex = state.orders.findIndex(
          (row) => String(row?.id) === String(record.order_id),
        );
        if (orderIndex >= 0) {
          const isOpen = String(record.status_group || "open") === "open";
          state.orders[orderIndex] = {
            ...state.orders[orderIndex],
            has_return: true,
            return_open: isOpen,
            return_id: record.id,
            return_no: record.return_no,
            return_no_display: record.return_no_display,
            return_status: record.status,
            return_status_label: record.status_label,
            return_status_group: record.status_group,
            return_resolution: record.resolution,
            return_resolution_label: record.resolution_label,
            // A live request blocks a second one. Anything else is left for the
            // background refresh to recompute against the server's own rule.
            ...(isOpen
              ? {
                  return_eligible: false,
                  return_blocked_reason:
                    "A return request for this order is already being processed.",
                }
              : {}),
          };
        }

        state.etag = "";
        writeCustomerOrdersCache(
          state.cacheKey,
          state.orders,
          state.etag,
          state.returns,
        );
        renderOrders();

        // Keep an open return detail modal in step with the action just taken.
        if (state.activeReturnDetailId === key) {
          renderReturnDetailModal(state.returnDetailsById.get(key) || record);
        }
      };

      const showReturnToast = (title, message, returnId) => {
        const toast = document.createElement("div");
        toast.className = "customer-rate-prompt-popup customer-return-toast";
        toast.innerHTML = `
          <div class="customer-rate-prompt-inner">
            <span class="customer-rate-prompt-icon">&#128230;</span>
            <div class="customer-rate-prompt-text">
              <strong>${escapeHtml(title)}</strong>
              <p>${escapeHtml(message)} ${returnId ? '<button type="button" class="customer-rate-prompt-link">View return &rarr;</button>' : ""}</p>
            </div>
            <button type="button" class="customer-rate-prompt-close" aria-label="Close">&times;</button>
          </div>
        `;
        document.body.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add("show"));

        const closeToast = () => {
          toast.classList.remove("show");
          setTimeout(() => toast.remove(), 300);
        };

        toast
          .querySelector(".customer-rate-prompt-close")
          ?.addEventListener("click", closeToast);
        toast
          .querySelector(".customer-rate-prompt-link")
          ?.addEventListener("click", () => {
            closeToast();
            void openReturnDetail(returnId);
          });

        setTimeout(closeToast, 8000);
      };

      const requireCustomerTokenForReturn = async () => {
        const token = state.token || localStorage.getItem("customer_token") || "";
        if (!token) {
          await showCustomerPopup(
            "Your session has expired. Please login again.",
            { title: "Login required" },
          );
          return "";
        }
        return token;
      };

      const handleReturnRequest = async (orderId, orderName) => {
        if (!orderId) return;
        const token = await requireCustomerTokenForReturn();
        if (!token) return;

        await openReturnRequestModal(orderId, orderName, {
          onSubmitted: (record) => {
            applyReturnRecord(record);
            void refreshOrders(false, true);
            setActivePanel(RETURNS_PANEL_INDEX);
            showReturnToast(
              "Return request sent",
              "We will review your request and update you here.",
              record?.id,
            );
            emitCustomerOrdersUpdated({
              type: "return-requested",
              orderId: String(orderId),
              returnId: record?.id ? String(record.id) : "",
            });
          },
        });
      };

      const handleReturnCancel = async (returnId, returnNo, triggerBtn) => {
        if (!returnId) return;
        const token = await requireCustomerTokenForReturn();
        if (!token) return;

        const confirmed = await showCustomerPopup(
          `Withdraw return ${returnNo || ""}? This cannot be undone, but you may file a new request while the return window is open.`,
          {
            title: "Cancel Return Request",
            isConfirm: true,
            okText: "Yes, Cancel It",
            cancelText: "Keep Request",
            allowBackdropClose: false,
          },
        );
        if (!confirmed) return;

        const originalLabel = triggerBtn?.textContent || "Cancel Request";
        if (triggerBtn) {
          triggerBtn.disabled = true;
          triggerBtn.textContent = "Cancelling...";
        }

        try {
          const { response: res, data } = await fetchJsonWithTimeout(
            `${API_BASE_URL}/customer/returns/${returnId}/cancel`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({}),
            },
          );

          if (!res.ok) {
            throw new Error(data.message || "Unable to cancel this request.");
          }

          state.lastDetailRefreshAt = 0;
          applyReturnRecord(data?.data);
          void refreshOrders(false, true);
          setActivePanel(RETURNS_PANEL_INDEX);
          showReturnToast(
            "Return request cancelled",
            data?.message || "Your request has been withdrawn.",
            data?.data?.id,
          );
          emitCustomerOrdersUpdated({
            type: "return-cancelled",
            orderId: String(data?.data?.order_id || ""),
            returnId: String(returnId),
          });
        } catch (error) {
          await showCustomerPopup(
            error?.message || "Unable to cancel this request. Please try again.",
            { title: "Error" },
          );
          if (triggerBtn) {
            triggerBtn.disabled = false;
            triggerBtn.textContent = originalLabel;
          }
        }
      };

      const handleReturnShipped = async (returnId, returnNo, triggerBtn) => {
        if (!returnId) return;
        const token = await requireCustomerTokenForReturn();
        if (!token) return;

        const shipment = await openReturnShipBackForm(returnNo);
        if (!shipment) return;

        const originalHtml = triggerBtn?.innerHTML || "Item Shipped Back";
        if (triggerBtn) {
          triggerBtn.disabled = true;
          triggerBtn.textContent = "Saving...";
        }

        try {
          const { response: res, data } = await fetchJsonWithTimeout(
            `${API_BASE_URL}/customer/returns/${returnId}/shipped`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify(shipment),
            },
          );

          if (!res.ok) {
            const validationMessage = Object.values(data?.errors || {})[0]?.[0];
            throw new Error(
              validationMessage || data.message || "Unable to save the return shipment.",
            );
          }

          state.lastDetailRefreshAt = 0;
          applyReturnRecord(data?.data);
          void refreshOrders(false, true);
          setActivePanel(RETURNS_PANEL_INDEX);
          showReturnToast(
            "Item marked as sent back",
            data?.message || "We will let you know once the item arrives.",
            data?.data?.id,
          );
          emitCustomerOrdersUpdated({
            type: "return-shipped",
            orderId: String(data?.data?.order_id || ""),
            returnId: String(returnId),
          });
        } catch (error) {
          await showCustomerPopup(
            error?.message || "Unable to save the return shipment. Please try again.",
            { title: "Error" },
          );
          if (triggerBtn) {
            triggerBtn.disabled = false;
            triggerBtn.innerHTML = originalHtml;
          }
        }
      };

      /**
       * Courier + tracking prompt for "Item Shipped Back". Built on the same
       * overlay shell as the rating modal so it inherits every animation.
       * Resolves with the payload, or null when dismissed.
       */
      const openReturnShipBackForm = (returnNo) =>
        new Promise((resolve) => {
          const overlayEl = document.createElement("div");
          overlayEl.className =
            "customer-rating-overlay customer-return-form-overlay ux-dlg";
          overlayEl.innerHTML = `
            <div class="customer-rating-card customer-return-form-card ux-dlg__card" role="dialog" aria-modal="true" aria-labelledby="returnShipTitle">
              <div class="customer-rating-head ux-dlg__head">
                <button type="button" class="customer-orders-close ux-dlg__close" data-return-form-close aria-label="Close">&times;</button>
                <span class="ux-dlg__badge" aria-hidden="true"><i class="fa-solid fa-truck-fast"></i></span>
                <div>
                  <p class="customer-rating-eyebrow ux-dlg__eyebrow">Return shipment</p>
                  <h3 id="returnShipTitle" class="ux-dlg__title">Send the item back</h3>
                </div>
              </div>
              <div class="customer-rating-body">
                <p class="customer-rating-product-name">Return ${escapeHtml(returnNo || "")} &bull; Enter the courier you used so we can watch for the parcel.</p>
                <label class="customer-rating-field-label" for="returnCourierName">Courier / delivery service</label>
                <input id="returnCourierName" class="customer-return-input" type="text" maxlength="120" placeholder="e.g. J&T Express, LBC, hand delivered" autocomplete="off" />
                <label class="customer-rating-field-label" for="returnTrackingNo">Tracking number <span>(optional)</span></label>
                <input id="returnTrackingNo" class="customer-return-input" type="text" maxlength="140" placeholder="e.g. 830012345678" autocomplete="off" />
                <label class="customer-rating-field-label" for="returnShipNote">Note for the store <span>(optional)</span></label>
                <textarea id="returnShipNote" class="customer-rating-feedback" maxlength="400" rows="3" placeholder="Anything we should know about the parcel..."></textarea>
              </div>
              <div class="customer-rating-actions ux-dlg__foot is-confirm">
                <button type="button" class="customer-rating-cancel-btn ux-dlg__btn ux-dlg__btn--ghost" data-return-form-close>Cancel</button>
                <button type="button" class="btn-place-order customer-rating-submit-btn ux-dlg__btn ux-dlg__btn--primary" data-return-form-submit>
                  <span class="customer-rating-submit-spinner" aria-hidden="true"></span>
                  <span>Mark as sent back</span>
                </button>
              </div>
            </div>
          `;
          document.body.appendChild(overlayEl);
          requestAnimationFrame(() => overlayEl.classList.add("show"));
          document.body.style.overflow = "hidden";

          const courierInput = overlayEl.querySelector("#returnCourierName");
          const trackingInput = overlayEl.querySelector("#returnTrackingNo");
          const noteInput = overlayEl.querySelector("#returnShipNote");
          let settled = false;

          const finish = (value) => {
            if (settled) return;
            settled = true;
            overlayEl.classList.remove("show");
            document.removeEventListener("keydown", onKeydown, true);
            setTimeout(() => overlayEl.remove(), 180);
            resolve(value);
          };

          const onKeydown = (event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            finish(null);
          };
          document.addEventListener("keydown", onKeydown, true);

          overlayEl.addEventListener("click", (event) => {
            if (event.target?.closest?.("[data-return-form-close]")) {
              finish(null);
              return;
            }

            if (!event.target?.closest?.("[data-return-form-submit]")) return;

            const courier = String(courierInput?.value || "").trim();
            if (!courier) {
              courierInput?.classList.add("has-error");
              courierInput?.focus();
              return;
            }
            finish({
              return_courier_name: courier,
              return_tracking_no: String(trackingInput?.value || "").trim(),
              note: String(noteInput?.value || "").trim(),
            });
          });

          courierInput?.addEventListener("input", () => {
            courierInput.classList.remove("has-error");
          });

          setTimeout(() => courierInput?.focus(), 200);
        });

      /* ─────────────────── GCash: pay after checkout ───────────────────
         An order may be placed before the money is sent, exactly like Shopee
         and Lazada. Everything the customer needs to finish paying lives in one
         panel opened from the To Pay card: where to send it, how much, the
         deadline, and the field for the reference number GCash prints.

         Nothing here marks the order paid. The reference is a *claim*; staff
         confirm it against the FMRC GCash account, and that confirmation is
         what turns it into revenue. The copy is careful not to imply otherwise.
      ───────────────────────────────────────────────────────────────────── */

      const GCASH_REF_DIGITS = 13;

      // Published by the site-settings poller in another IIFE, so it is read
      // fresh on every open instead of being captured once.
      const readGcashSettings = () => {
        const published = window.FMRC_GCASH_SETTINGS;
        return {
          accountName: String(published?.accountName || "").trim(),
          accountNumber: String(published?.accountNumber || "").trim(),
          qrImage: String(published?.qrImage || "").trim(),
        };
      };

      /**
       * A phone can hand itself to the GCash app; a laptop cannot, and needs the
       * QR instead. Mirrors the checkout's own detection: UA first, because a
       * desktop browser resized narrow is still a desktop, then touch for iPads
       * that report a desktop UA.
       */
      const isHandheldDevice = () => {
        const ua = String(navigator.userAgent || "");
        if (/Android|iPhone|iPod|IEMobile|Opera Mini/i.test(ua)) return true;
        const touchPoints = Number(navigator.maxTouchPoints || 0);
        if (/Macintosh/i.test(ua) && touchPoints > 1) return true;
        return (
          touchPoints > 0 &&
          window.matchMedia?.("(pointer: coarse)")?.matches === true
        );
      };

      /**
       * How the deadline reads to the customer. Deliberately never says the
       * order will be cancelled: shared hosting gives FMRC no scheduler, so
       * nothing expires on its own and promising otherwise would be a lie.
       */
      const describePaymentDeadline = (order) => {
        const raw = order?.payment_due_at;
        if (!raw) return null;
        const due = new Date(raw);
        if (Number.isNaN(due.getTime())) return null;

        const label = order?.payment_due_label || formatOrderDate(raw);
        const msLeft = due.getTime() - Date.now();

        if (msLeft <= 0) {
          return {
            overdue: true,
            text: `This payment was due ${label}. You can still send it — FMRC will confirm it once the money arrives.`,
          };
        }

        const hoursLeft = msLeft / 3600000;
        const remaining =
          hoursLeft < 1
            ? `${Math.max(1, Math.round(msLeft / 60000))} minutes`
            : hoursLeft < 24
              ? `${Math.round(hoursLeft)} hour${Math.round(hoursLeft) === 1 ? "" : "s"}`
              : `${Math.round(hoursLeft / 24)} day${Math.round(hoursLeft / 24) === 1 ? "" : "s"}`;

        return {
          overdue: false,
          text: `Please pay within ${remaining} — by ${label}.`,
        };
      };

      /**
       * The instructions half of the panel: where the money goes, and how.
       * Split out so the QR/app choice and the numbered steps stay readable.
       */
      const renderGcashHowToPay = (settings, amountText) => {
        const handheld = isHandheldDevice();
        const showQr = Boolean(settings.qrImage) && !handheld;
        const target = settings.accountNumber
          ? `<strong>${escapeHtml(amountText)}</strong> to <strong>${escapeHtml(settings.accountNumber)}</strong>${settings.accountName ? ` (${escapeHtml(settings.accountName)})` : ""}`
          : `<strong>${escapeHtml(amountText)}</strong> to the account in the QR code`;

        const steps = handheld
          ? [
              `Tap <strong>Open the GCash app</strong>, then Send Money.`,
              `Send exactly ${target}.`,
              `Copy the <strong>${GCASH_REF_DIGITS}-digit Ref. No.</strong> from your GCash receipt.`,
              `Paste it below and submit. FMRC confirms it against their GCash account.`,
            ]
          : [
              settings.qrImage
                ? `Open GCash on your phone and tap <strong>Scan QR</strong> to scan the code below.`
                : `Open GCash on your phone and tap <strong>Send Money</strong>.`,
              `Send exactly ${target}.`,
              `Copy the <strong>${GCASH_REF_DIGITS}-digit Ref. No.</strong> from your GCash receipt.`,
              `Type it below and submit. FMRC confirms it against their GCash account.`,
            ];

        return `
          <div class="cgc-account">
            <div class="cgc-account-row">
              <span class="cgc-account-label">Account name</span>
              <span class="cgc-account-value">${escapeHtml(settings.accountName || "—")}</span>
            </div>
            <div class="cgc-account-row">
              <span class="cgc-account-label">GCash number</span>
              <span class="cgc-account-value" data-gcash-number>${escapeHtml(settings.accountNumber || "—")}</span>
              ${settings.accountNumber ? `<button type="button" class="cgc-copy-btn" data-gcash-copy="${escapeHtml(settings.accountNumber)}">Copy</button>` : ""}
            </div>
          </div>
          ${showQr ? `<div class="cgc-qr"><img class="cgc-qr-img" src="${escapeHtml(settings.qrImage)}" alt="FMRC GCash QR code" /><a class="cgc-qr-save" href="${escapeHtml(settings.qrImage)}" download="fmrc-gcash-qr.png">Save QR image</a></div>` : ""}
          ${handheld ? `<div class="cgc-openapp"><button type="button" class="cgc-openapp-btn" data-gcash-openapp>Open the GCash app</button><p class="cgc-openapp-hint" data-gcash-openapp-hint></p></div>` : ""}
          <ol class="cgc-steps">${steps.map((step) => `<li>${step}</li>`).join("")}</ol>
        `;
      };

      /**
       * The pay panel itself. Resolves with the updated order once a reference
       * is accepted, or null when the customer just closes it.
       */
      const openGcashPayPanel = (order) =>
        new Promise((resolve) => {
          const settings = readGcashSettings();
          const collectible = Boolean(
            settings.accountNumber || settings.qrImage,
          );
          const amountText =
            order?.total_label ||
            formatOrderCurrency(Number(order?.total_amount || 0));
          const deadline = describePaymentDeadline(order);
          const underReview = order?.payment_under_review === true;
          const submittedRef = String(order?.payment_reference || "");
          const claimedRef = /^\d+$/.test(submittedRef) ? submittedRef : "";

          const overlayEl = document.createElement("div");
          overlayEl.className =
            "customer-rating-overlay customer-gcash-overlay ux-dlg";
          overlayEl.innerHTML = `
            <div class="customer-rating-card customer-gcash-card ux-dlg__card" role="dialog" aria-modal="true" aria-labelledby="gcashPayTitle">
              <div class="customer-rating-head ux-dlg__head">
                <button type="button" class="customer-orders-close ux-dlg__close" data-gcash-close aria-label="Close">&times;</button>
                <span class="ux-dlg__badge" aria-hidden="true"><i class="fa-solid fa-mobile-screen-button"></i></span>
                <div>
                  <p class="customer-rating-eyebrow ux-dlg__eyebrow">Order ${escapeHtml(order?.order_no_display || `#${order?.order_no || order?.id || "-"}`)}</p>
                  <h3 id="gcashPayTitle" class="ux-dlg__title">${underReview ? "Payment under review" : "Pay with GCash"}</h3>
                </div>
              </div>
              <div class="customer-rating-body customer-gcash-body">
                <div class="cgc-amount">
                  <span class="cgc-amount-label">Amount to send</span>
                  <div class="cgc-amount-row">
                    <strong class="cgc-amount-value">${escapeHtml(amountText)}</strong>
                    <button type="button" class="cgc-copy-btn" data-gcash-copy="${escapeHtml(String(Number(order?.total_amount || 0).toFixed(2)))}">Copy</button>
                  </div>
                </div>
                ${
                  underReview
                    ? `<div class="cgc-review">
                        <p class="cgc-review-title"><i class="fa-regular fa-hourglass-half" aria-hidden="true"></i> FMRC is checking your payment</p>
                        <p class="cgc-review-body">Reference <strong>${escapeHtml(claimedRef || "submitted")}</strong>${order?.payment_submitted_at ? ` &bull; sent ${escapeHtml(formatOrderDate(order.payment_submitted_at))}` : ""}. Your order moves to <strong>To Ship</strong> once staff confirm the money arrived. Wrong number? Submit the correct one below.</p>
                        ${order?.payment_proof_url ? `<a class="cgc-review-proof" href="${escapeHtml(order.payment_proof_url)}" target="_blank" rel="noopener">View the screenshot you sent</a>` : ""}
                      </div>`
                    : deadline
                      ? `<p class="cgc-deadline${deadline.overdue ? " is-overdue" : ""}"><i class="fa-regular fa-clock" aria-hidden="true"></i> ${escapeHtml(deadline.text)}</p>`
                      : ""
                }
                ${
                  collectible
                    ? renderGcashHowToPay(settings, amountText)
                    : `<p class="cgc-unavailable">FMRC has not published its GCash number or QR code yet, so there is nowhere to send the payment. Please contact FMRC before paying.</p>`
                }
                <div class="cgc-field">
                  <label class="customer-rating-field-label" for="cgcReferenceInput">GCash reference number <span class="cgc-req">*</span></label>
                  <input id="cgcReferenceInput" class="customer-return-input cgc-ref-input" type="text" inputmode="numeric" maxlength="19" autocomplete="off" placeholder="${GCASH_REF_DIGITS} digits, e.g. 0123456789012" value="${escapeHtml(claimedRef)}" />
                  <p class="cgc-error" data-gcash-error hidden></p>
                </div>
                <div class="cgc-field">
                  <label class="customer-rating-field-label" for="cgcProofInput">Receipt screenshot <span>(optional, helps us confirm faster)</span></label>
                  <input id="cgcProofInput" class="cgc-file-input" type="file" accept="image/png,image/jpeg,image/webp" />
                  <p class="cgc-file-name" data-gcash-file-name hidden></p>
                </div>
                <p class="cgc-honesty">Submitting this tells FMRC you have sent the money. It does not mark the order paid — staff confirm it against the FMRC GCash account first.</p>
              </div>
              <div class="customer-rating-actions ux-dlg__foot is-confirm">
                <button type="button" class="customer-rating-cancel-btn ux-dlg__btn ux-dlg__btn--ghost" data-gcash-close>Close</button>
                <button type="button" class="btn-place-order customer-rating-submit-btn ux-dlg__btn ux-dlg__btn--primary" data-gcash-submit>
                  <span class="customer-rating-submit-spinner" aria-hidden="true"></span>
                  <span data-gcash-submit-label>${underReview ? "Update my reference" : "I've sent the payment"}</span>
                </button>
              </div>
            </div>
          `;
          document.body.appendChild(overlayEl);
          requestAnimationFrame(() => overlayEl.classList.add("show"));
          overlayEl.dataset.previousOverflow = document.body.style.overflow;
          document.body.style.overflow = "hidden";

          wireGcashPayPanel(overlayEl, order, resolve);
        });

      // Mirrors payments.gcash.proof_max_kb in the backend config. Checked here
      // only so an oversized screenshot fails instantly instead of after an
      // upload the server is going to reject anyway.
      const GCASH_PROOF_MAX_KB = 2048;

      /**
       * Behaviour for an open pay panel: the copy buttons, the GCash app hand-off,
       * input hygiene, and the submit that posts the claim.
       */
      const wireGcashPayPanel = (overlayEl, order, resolve) => {
        const referenceInput = overlayEl.querySelector("#cgcReferenceInput");
        const proofInput = overlayEl.querySelector("#cgcProofInput");
        const errorEl = overlayEl.querySelector("[data-gcash-error]");
        const fileNameEl = overlayEl.querySelector("[data-gcash-file-name]");
        const submitBtn = overlayEl.querySelector("[data-gcash-submit]");
        const submitLabel = overlayEl.querySelector("[data-gcash-submit-label]");
        let settled = false;
        let busy = false;
        let openAppTimer = null;
        // The My Orders drawer owns body scrolling and is still open underneath,
        // so this restores what it had rather than clearing the lock outright.
        const previousBodyOverflow = overlayEl.dataset.previousOverflow || "";

        const finish = (value) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(openAppTimer);
          overlayEl.classList.remove("show");
          document.removeEventListener("keydown", onKeydown, true);
          document.body.style.overflow = previousBodyOverflow;
          setTimeout(() => overlayEl.remove(), 180);
          resolve(value);
        };

        const onKeydown = (event) => {
          if (event.key !== "Escape" || busy) return;
          event.stopPropagation();
          finish(null);
        };
        document.addEventListener("keydown", onKeydown, true);

        const showError = (message) => {
          if (!errorEl) return;
          errorEl.textContent = message;
          errorEl.hidden = !message;
          referenceInput?.classList.toggle("has-error", Boolean(message));
        };

        referenceInput?.addEventListener("input", () => {
          const digits = referenceInput.value
            .replace(/\D/g, "")
            .slice(0, GCASH_REF_DIGITS);
          if (referenceInput.value !== digits) referenceInput.value = digits;
          if (digits.length === GCASH_REF_DIGITS) showError("");
        });

        proofInput?.addEventListener("change", () => {
          const file = proofInput.files?.[0];
          if (!file) {
            if (fileNameEl) fileNameEl.hidden = true;
            return;
          }
          const kb = Math.round(file.size / 1024);
          if (kb > GCASH_PROOF_MAX_KB) {
            proofInput.value = "";
            if (fileNameEl) fileNameEl.hidden = true;
            showError(
              `That screenshot is ${(kb / 1024).toFixed(1)} MB. Please attach an image under ${Math.floor(GCASH_PROOF_MAX_KB / 1024)} MB, or submit the reference number on its own.`,
            );
            return;
          }
          if (fileNameEl) {
            fileNameEl.textContent = `Attached: ${file.name} (${kb} KB)`;
            fileNameEl.hidden = false;
          }
        });

        // Single click handler for the whole card, so the markup builder above
        // stays declarative and nothing has to be re-bound after a re-render.
        overlayEl.addEventListener("click", async (event) => {
          const target = event.target;

          if (target?.closest?.("[data-gcash-close]")) {
            if (!busy) finish(null);
            return;
          }

          const copyBtn = target?.closest?.("[data-gcash-copy]");
          if (copyBtn) {
            const value = copyBtn.getAttribute("data-gcash-copy") || "";
            const original = copyBtn.textContent;
            try {
              await navigator.clipboard.writeText(value);
              copyBtn.textContent = "Copied";
            } catch {
              // Insecure origins and some in-app browsers deny the clipboard.
              copyBtn.textContent = "Copy it manually";
            }
            window.setTimeout(() => {
              copyBtn.textContent = original || "Copy";
            }, 1600);
            return;
          }

          if (target?.closest?.("[data-gcash-openapp]")) {
            const hint = overlayEl.querySelector("[data-gcash-openapp-hint]");
            if (hint) hint.textContent = "Opening GCash…";
            window.clearTimeout(openAppTimer);
            try {
              window.location.href = "gcash://";
            } catch {
              // Some browsers throw on an unknown scheme instead of ignoring it.
            }
            // Still visible after a beat means the scheme went nowhere, which
            // almost always means GCash is not installed on this device.
            openAppTimer = window.setTimeout(() => {
              if (!hint) return;
              hint.textContent = document.hidden
                ? ""
                : "GCash did not open. Open the app yourself, then send the amount above.";
            }, 1500);
            return;
          }

          if (!target?.closest?.("[data-gcash-submit]") || busy) return;

          const reference = String(referenceInput?.value || "").replace(
            /\D/g,
            "",
          );
          if (reference.length !== GCASH_REF_DIGITS) {
            showError(
              reference
                ? `That reference number has ${reference.length} digit${reference.length === 1 ? "" : "s"}. GCash reference numbers are ${GCASH_REF_DIGITS} digits — check the "Ref. No." on your receipt.`
                : `Send the payment in GCash first, then enter the ${GCASH_REF_DIGITS}-digit reference number from your receipt.`,
            );
            referenceInput?.focus();
            return;
          }

          showError("");
          busy = true;
          submitBtn?.classList.add("is-loading");
          if (submitBtn) submitBtn.disabled = true;
          const previousLabel = submitLabel?.textContent || "";
          if (submitLabel) submitLabel.textContent = "Sending…";

          const restore = () => {
            busy = false;
            submitBtn?.classList.remove("is-loading");
            if (submitBtn) submitBtn.disabled = false;
            if (submitLabel) submitLabel.textContent = previousLabel;
          };

          const updated = await submitGcashPayment(
            order?.id,
            reference,
            proofInput?.files?.[0] || null,
            showError,
          );
          if (!updated) {
            restore();
            return;
          }
          finish(updated);
        });

        setTimeout(() => referenceInput?.focus(), 200);
      };

      /**
       * Post the customer's GCash claim. Returns the updated order on success,
       * or null after reporting the reason through `showError` - validation
       * messages from the server are shown against the field rather than in a
       * popup, because the field is what has to change.
       */
      const submitGcashPayment = async (
        orderId,
        reference,
        proofFile,
        showError,
      ) => {
        if (!orderId) return null;

        const token =
          state.token || localStorage.getItem("customer_token") || "";
        if (!token) {
          showError("Your session has expired. Please log in again.");
          return null;
        }

        const body = new FormData();
        body.append("payment_reference", reference);
        if (proofFile) body.append("proof", proofFile);

        try {
          // A screenshot on a phone connection needs more than the shared 8s
          // budget, so this one request gets a longer leash.
          const { response: res, data } = await fetchJsonWithTimeout(
            `${API_BASE_URL}/customer/orders/${orderId}/payment`,
            {
              method: "POST",
              // Content-Type is deliberately unset: the browser has to add the
              // multipart boundary itself.
              headers: {
                Accept: "application/json",
                Authorization: `Bearer ${token}`,
              },
              body,
            },
            proofFile ? 30000 : 12000,
          );

          if (!res.ok) {
            const fieldError = data?.errors?.payment_reference?.[0];
            showError(
              fieldError ||
                data?.message ||
                "We could not record that reference number. Please try again.",
            );
            return null;
          }

          return data?.data || null;
        } catch (error) {
          showError(
            error?.message ||
              "We could not reach FMRC. Please check your connection and try again.",
          );
          return null;
        }
      };

      /**
       * "Pay Now" on a To Pay card. Opens the panel, then folds the server's
       * updated order straight back into the list so the card flips to "under
       * review" without waiting for the next poll.
       */
      const handleGcashPay = async (orderId) => {
        if (!orderId) return;

        const wanted = String(orderId);
        const order =
          state.orders.find((row) => String(row?.id) === wanted) ||
          state.detailsById.get(wanted) ||
          null;

        if (!order) {
          await showCustomerPopup(
            "We could not load that order. Please refresh and try again.",
            { title: "Order unavailable" },
          );
          return;
        }

        if (order.payment_is_confirmed) {
          await showCustomerPopup(
            "FMRC has already confirmed this payment. Nothing more is needed from you.",
            { title: "Payment confirmed" },
          );
          return;
        }

        if (String(order.lifecycle_status || "") === "rejected") {
          await showCustomerPopup(
            "This order was rejected, so there is nothing to pay. Contact FMRC if you already sent the money.",
            { title: "Order rejected" },
          );
          return;
        }

        const updated = await openGcashPayPanel(order);
        if (!updated) return;

        const updatedId = String(updated.id ?? wanted);
        const index = state.orders.findIndex(
          (row) => String(row?.id) === updatedId,
        );
        if (index >= 0) {
          state.orders[index] = { ...state.orders[index], ...updated };
        }
        state.detailsById.set(updatedId, updated);
        // The list ETag no longer describes what we are holding, so drop it and
        // let the next refresh fetch a full body instead of a 304.
        state.etag = "";
        state.lastDetailRefreshAt = 0;
        writeCustomerOrdersCache(state.cacheKey, state.orders, state.etag);
        renderOrders();
        void refreshOrders(false, true);

        await showCustomerPopup(
          "Thank you! FMRC will match your reference number against their GCash account. Your order moves to To Ship once the payment is confirmed.",
          { title: "Reference number received" },
        );
      };

      // Same capture-phase bridge the return controls use, for the same reason:
      // the panels are re-rendered wholesale, so per-button listeners would be
      // thrown away on every repaint.
      document.addEventListener(
        "click",
        (event) => {
          const payBtn = event.target?.closest?.("[data-order-pay]");
          if (!payBtn || payBtn.dataset.payClickHandled === "true") return;

          payBtn.dataset.payClickHandled = "true";
          event.preventDefault();
          event.stopPropagation();
          void handleGcashPay(payBtn.getAttribute("data-order-pay"));

          queueMicrotask(() => {
            delete payBtn.dataset.payClickHandled;
          });
        },
        true,
      );

      // ─── Cancel order ──────────────────────────────────────────────────────
      // Modelled on the Shopee/Lazada "Select reason" sheet: one screen, a radio
      // list of pre-written reasons, and a single confirm button. The reason list
      // comes from the server (`cancel_reason_options`) rather than being
      // hard-coded here, so the codes the customer picks are always ones the API
      // will accept. The fallback below only exists for a cached payload written
      // before this field was added.
      const FALLBACK_CANCEL_REASONS = [
        { value: "no_longer_needed", label: "No longer needed", requires_detail: false },
        { value: "ordered_by_mistake", label: "Ordered by mistake", requires_detail: false },
        { value: "other", label: "Other reason", requires_detail: true },
      ];

      const getCancelReasonOptions = () =>
        Array.isArray(state.cancelReasonOptions) &&
        state.cancelReasonOptions.length
          ? state.cancelReasonOptions
          : FALLBACK_CANCEL_REASONS;

      const openCancelReasonSheet = (order) =>
        new Promise((resolve) => {
          const options = getCancelReasonOptions();
          const immediate = order?.cancel_is_immediate === true;
          const amountText =
            order?.total_label ||
            formatOrderCurrency(Number(order?.total_amount || 0));
          // Money that FMRC is holding. A confirmed payment is a refund staff
          // have to send by hand, and an unverified claim still has to be
          // checked - promising either automatically would be a lie, because
          // there is no GCash API and no cron on this hosting.
          const paymentConfirmed = order?.payment_is_confirmed === true;
          const paymentClaimed = order?.payment_under_review === true;

          const overlayEl = document.createElement("div");
          overlayEl.className =
            "customer-rating-overlay customer-cancel-overlay ux-dlg";
          overlayEl.innerHTML = `
            <div class="customer-rating-card customer-cancel-card ux-dlg__card" role="dialog" aria-modal="true" aria-labelledby="cancelReasonTitle">
              <div class="customer-rating-head ux-dlg__head">
                <button type="button" class="customer-orders-close ux-dlg__close" data-cancel-close aria-label="Close">&times;</button>
                <span class="ux-dlg__badge" aria-hidden="true"><i class="fa-regular fa-circle-xmark"></i></span>
                <div>
                  <p class="customer-rating-eyebrow ux-dlg__eyebrow">Order ${escapeHtml(order?.order_no_display || `#${order?.order_no || order?.id || "-"}`)}</p>
                  <h3 id="cancelReasonTitle" class="ux-dlg__title">Select reason</h3>
                  <p class="ccx-subtitle">${
                    immediate
                      ? "Select a reason to cancel your order instantly."
                      : "Select a reason. FMRC staff review the request before the order is cancelled."
                  }</p>
                </div>
              </div>
              <div class="customer-rating-body customer-cancel-body">
                ${
                  immediate
                    ? ""
                    : `<p class="ccx-notice"><i class="fa-regular fa-hourglass-half" aria-hidden="true"></i> ${
                        paymentConfirmed
                          ? `FMRC has already confirmed your ${escapeHtml(amountText)} payment, so this sends a request instead of cancelling straight away. If staff approve it, they refund the ${escapeHtml(amountText)} to the GCash number you paid from — by hand, so allow a few working days.`
                          : `FMRC is holding a payment for this order, so this sends a request instead of cancelling straight away. Staff check the ${escapeHtml(amountText)} before closing the order.`
                      }</p>`
                }
                ${
                  immediate && paymentClaimed
                    ? `<p class="ccx-notice"><i class="fa-regular fa-circle-question" aria-hidden="true"></i> You have told FMRC you sent ${escapeHtml(amountText)} but staff have not confirmed it yet. Cancelling now still closes the order — if the money did arrive, staff will send it back.</p>`
                    : ""
                }
                <div class="ccx-reasons" role="radiogroup" aria-labelledby="cancelReasonTitle">
                  ${options
                    .map(
                      (option, index) => `
                        <label class="ccx-reason">
                          <input type="radio" name="cancelReason" value="${escapeHtml(option.value)}" data-requires-detail="${option.requires_detail ? "1" : "0"}"${index === 0 ? "" : ""} />
                          <span class="ccx-reason-mark" aria-hidden="true"></span>
                          <span class="ccx-reason-label">${escapeHtml(option.label)}</span>
                        </label>
                      `,
                    )
                    .join("")}
                </div>
                <div class="ccx-detail" data-cancel-detail hidden>
                  <label class="customer-rating-field-label" for="ccxDetailInput">Tell FMRC why <span class="cgc-req">*</span></label>
                  <textarea id="ccxDetailInput" class="customer-return-input ccx-detail-input" rows="3" maxlength="600" placeholder="A sentence is enough."></textarea>
                </div>
                <p class="ccx-error" data-cancel-error hidden></p>
              </div>
              <div class="customer-rating-actions ux-dlg__foot is-confirm">
                <button type="button" class="customer-rating-cancel-btn ux-dlg__btn ux-dlg__btn--ghost" data-cancel-close>Keep my order</button>
                <button type="button" class="btn-place-order customer-rating-submit-btn ux-dlg__btn ux-dlg__btn--primary" data-cancel-submit>
                  <span class="customer-rating-submit-spinner" aria-hidden="true"></span>
                  <span data-cancel-submit-label>${immediate ? "Cancel order" : "Send request"}</span>
                </button>
              </div>
            </div>
          `;
          document.body.appendChild(overlayEl);
          requestAnimationFrame(() => overlayEl.classList.add("show"));
          overlayEl.dataset.previousOverflow = document.body.style.overflow;
          document.body.style.overflow = "hidden";

          wireCancelReasonSheet(overlayEl, order, resolve);
        });

      /**
       * Behaviour for an open cancel sheet: reveal the detail box only for the
       * reason that needs it, block an empty submit, and post the cancellation.
       */
      const wireCancelReasonSheet = (overlayEl, order, resolve) => {
        const detailWrap = overlayEl.querySelector("[data-cancel-detail]");
        const detailInput = overlayEl.querySelector("#ccxDetailInput");
        const errorEl = overlayEl.querySelector("[data-cancel-error]");
        const submitBtn = overlayEl.querySelector("[data-cancel-submit]");
        const submitLabel = overlayEl.querySelector("[data-cancel-submit-label]");
        let settled = false;
        let busy = false;
        // The My Orders drawer owns body scrolling and is still open underneath.
        const previousBodyOverflow = overlayEl.dataset.previousOverflow || "";

        const finish = (value) => {
          if (settled) return;
          settled = true;
          overlayEl.classList.remove("show");
          document.removeEventListener("keydown", onKeydown, true);
          document.body.style.overflow = previousBodyOverflow;
          setTimeout(() => overlayEl.remove(), 180);
          resolve(value);
        };

        const onKeydown = (event) => {
          if (event.key !== "Escape" || busy) return;
          event.stopPropagation();
          finish(null);
        };
        document.addEventListener("keydown", onKeydown, true);

        const showError = (message) => {
          if (!errorEl) return;
          errorEl.textContent = message;
          errorEl.hidden = !message;
        };

        const selectedRadio = () =>
          overlayEl.querySelector('input[name="cancelReason"]:checked');

        overlayEl.addEventListener("change", () => {
          const radio = selectedRadio();
          const needsDetail = radio?.dataset.requiresDetail === "1";
          if (detailWrap) detailWrap.hidden = !needsDetail;
          if (needsDetail) {
            // The card's height is fixed, so revealing this box grows the
            // scroller rather than the dialog - and with ten reasons above it,
            // the box lands below the fold. Focusing it does not reliably bring
            // it back, so the wrapper is scrolled in by hand and focus is told
            // not to fight it.
            setTimeout(() => {
              detailWrap?.scrollIntoView({ block: "nearest", behavior: "smooth" });
              detailInput?.focus({ preventScroll: true });
            }, 60);
          }
          showError("");
        });

        overlayEl.addEventListener("click", async (event) => {
          const target = event.target;

          if (target?.closest?.("[data-cancel-close]")) {
            if (!busy) finish(null);
            return;
          }

          if (!target?.closest?.("[data-cancel-submit]") || busy) return;

          const radio = selectedRadio();
          if (!radio) {
            showError("Choose a reason so FMRC knows what went wrong.");
            return;
          }

          const needsDetail = radio.dataset.requiresDetail === "1";
          const detail = String(detailInput?.value || "").trim();
          if (needsDetail && !detail) {
            showError("Tell FMRC briefly why you are cancelling.");
            detailInput?.focus();
            return;
          }

          showError("");
          busy = true;
          submitBtn?.classList.add("is-loading");
          if (submitBtn) submitBtn.disabled = true;
          const previousLabel = submitLabel?.textContent || "";
          if (submitLabel) submitLabel.textContent = "Sending…";

          const result = await submitOrderCancellation(
            order?.id,
            radio.value,
            detail,
            showError,
          );

          if (!result) {
            busy = false;
            submitBtn?.classList.remove("is-loading");
            if (submitBtn) submitBtn.disabled = false;
            if (submitLabel) submitLabel.textContent = previousLabel;
            return;
          }

          finish(result);
        });
      };

      /**
       * Post the cancellation. Returns `{order, immediate, message}` on success,
       * or null after reporting the reason inside the sheet - the server decides
       * whether this cancelled the order or only filed a request, so its own
       * `immediate` flag is what the confirmation copy is based on.
       */
      const submitOrderCancellation = async (
        orderId,
        reason,
        reasonDetail,
        showError,
      ) => {
        if (!orderId) return null;

        const token =
          state.token || localStorage.getItem("customer_token") || "";
        if (!token) {
          showError("Your session has expired. Please log in again.");
          return null;
        }

        try {
          const { response: res, data } = await fetchJsonWithTimeout(
            `${API_BASE_URL}/customer/orders/${orderId}/cancel`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                reason,
                ...(reasonDetail ? { reason_detail: reasonDetail } : {}),
              }),
            },
            12000,
          );

          if (!res.ok) {
            showError(
              data?.errors?.reason?.[0] ||
                data?.errors?.reason_detail?.[0] ||
                data?.message ||
                "We could not cancel that order. Please refresh and try again.",
            );
            return null;
          }

          return {
            order: data?.data || null,
            immediate: data?.immediate === true,
            message: String(data?.message || ""),
          };
        } catch (error) {
          showError(
            error?.message ||
              "We could not reach FMRC. Please check your connection and try again.",
          );
          return null;
        }
      };

      /**
       * "Cancel Order" / "Request Cancellation" on a card. Folds the server's
       * updated order straight back into the list so the card flips without
       * waiting for the next poll, exactly like the GCash pay panel does.
       */
      const handleOrderCancel = async (orderId) => {
        if (!orderId) return;

        const wanted = String(orderId);
        const order =
          state.orders.find((row) => String(row?.id) === wanted) ||
          state.detailsById.get(wanted) ||
          null;

        if (!order) {
          await showCustomerPopup(
            "We could not load that order. Please refresh and try again.",
            { title: "Order unavailable" },
          );
          return;
        }

        if (!order.can_request_cancel) {
          await showCustomerPopup(
            order.cancel_blocked_reason ||
              "This order can no longer be cancelled.",
            { title: "Cancellation unavailable" },
          );
          return;
        }

        const result = await openCancelReasonSheet(order);
        if (!result) return;

        if (result.order) {
          const updatedId = String(result.order.id ?? wanted);
          const index = state.orders.findIndex(
            (row) => String(row?.id) === updatedId,
          );
          if (index >= 0) {
            state.orders[index] = { ...state.orders[index], ...result.order };
          }
          state.detailsById.set(updatedId, result.order);
        }

        // The list ETag no longer describes what we are holding, so drop it and
        // let the next refresh fetch a full body instead of a 304.
        state.etag = "";
        state.lastDetailRefreshAt = 0;
        writeCustomerOrdersCache(
          state.cacheKey,
          state.orders,
          state.etag,
          state.returns,
        );
        renderOrders();
        void refreshOrders(false, true);

        if (result.immediate) {
          // `cancel_refund_due` covers two different situations: staff already
          // matched the money, or the customer typed a reference nobody has
          // checked yet. Only the first one is a debt FMRC can promise to pay,
          // so the unverified case has to stay conditional.
          const refundDue = result.order?.cancel_refund_due === true;
          const paymentConfirmed = result.order?.payment_is_confirmed === true;
          await showCustomerPopup(
            paymentConfirmed
              ? "Your order is cancelled. FMRC will send your payment back by hand, so allow a few working days."
              : refundDue
                ? "Your order is cancelled. If your GCash payment reached FMRC, staff will check the account and send it back — allow a few working days."
                : "Your order is cancelled and the stock has been returned. Nothing is owed on it.",
            { title: "Order cancelled" },
          );
        } else {
          await showCustomerPopup(
            result.message ||
              "Cancellation request sent. FMRC staff will review it shortly.",
            { title: "Request sent" },
          );
        }
      };

      // Same capture-phase bridge as the pay and return controls.
      document.addEventListener(
        "click",
        (event) => {
          const cancelBtn = event.target?.closest?.(
            "[data-order-cancel],[data-cancel-blocked]",
          );
          if (!cancelBtn || cancelBtn.dataset.cancelClickHandled === "true") {
            return;
          }

          cancelBtn.dataset.cancelClickHandled = "true";
          event.preventDefault();
          event.stopPropagation();

          const blocked = cancelBtn.getAttribute("data-cancel-blocked");
          if (blocked) {
            void showCustomerPopup(blocked, { title: "Cancellation status" });
          } else {
            void handleOrderCancel(
              cancelBtn.getAttribute("data-order-cancel"),
            );
          }

          queueMicrotask(() => {
            delete cancelBtn.dataset.cancelClickHandled;
          });
        },
        true,
      );

      // Single capture-phase bridge for every return control, so the buttons
      // survive the drawer's innerHTML re-renders exactly like Buy Again.
      window.__fmrcReturnAction = (buttonEl) => {
        if (!buttonEl) return;

        const blocked = buttonEl.getAttribute("data-return-blocked");
        if (blocked) {
          void showCustomerPopup(blocked, { title: "Return unavailable" });
          return;
        }

        const detailId = buttonEl.getAttribute("data-return-detail");
        if (detailId) {
          void openReturnDetail(detailId);
          return;
        }

        const requestOrderId = buttonEl.getAttribute("data-order-return");
        if (requestOrderId) {
          void handleReturnRequest(
            requestOrderId,
            buttonEl.getAttribute("data-order-name") || "Order",
          );
          return;
        }

        const returnNo = buttonEl.getAttribute("data-return-no") || "";

        const cancelId = buttonEl.getAttribute("data-return-cancel");
        if (cancelId) {
          void handleReturnCancel(cancelId, returnNo, buttonEl);
          return;
        }

        const shipId = buttonEl.getAttribute("data-return-ship");
        if (shipId) {
          void handleReturnShipped(shipId, returnNo, buttonEl);
        }
      };

      document.addEventListener("click", (event) => {
        const returnBtn = event.target?.closest?.(
          "[data-order-return],[data-return-detail],[data-return-cancel],[data-return-ship],[data-return-blocked]",
        );
        if (!returnBtn || returnBtn.dataset.returnClickHandled === "true") return;

        returnBtn.dataset.returnClickHandled = "true";
        event.preventDefault();
        event.stopPropagation();
        window.__fmrcReturnAction(returnBtn);

        queueMicrotask(() => {
          delete returnBtn.dataset.returnClickHandled;
        });
      }, true);

      const renderOrders = () => {
        if (state.loading) {
          panels.forEach((panel) => {
            panel.innerHTML = renderLoadingState();
          });
          tabs.forEach((tab) => {
            const countEl = tab.querySelector(".customer-orders-tab-count");
            if (countEl) countEl.textContent = "0";
          });
          return;
        }

        stageByPanel.forEach((stageKey, panelIndex) => {
          const panel = panels[panelIndex];
          if (!panel) return;

          const scopedOrders = getVisibleOrdersByPanel(stageKey);

          // The "To Rate" panel uses a dedicated two-section layout
          // (To Rate / My Ratings) instead of the standard order cards.
          if (stageKey === "to_rate") {
            panel.innerHTML = renderToRatePanel(scopedOrders);
            return;
          }

          // Returns render their own record cards, split In Progress / History.
          if (stageKey === "returns") {
            panel.innerHTML = renderReturnsPanel(scopedOrders);
            return;
          }

          if (!scopedOrders.length) {
            panel.innerHTML = renderEmptyState(stageKey);
            return;
          }

          panel.innerHTML = scopedOrders
            .map((order) => {
              const statusMeta = resolveOrderStatusMeta(order);
              const quantity = Math.max(
                1,
                Number.parseInt(order.quantity || "1", 10) || 1,
              );
              const quantityLabel = `${quantity} item${quantity > 1 ? "s" : ""}`;
              const productName = escapeHtml(
                order.product_name || "Custom Order",
              );
              const orderNo = escapeHtml(
                order.order_no_display ||
                  `#${order.order_no || order.id || "-"}`,
              );
              const paymentMethod = escapeHtml(order.payment_method || "N/A");

              const numericTotal = Number(order.total_amount || 0);
              const totalLabel = formatOrderCurrency(
                Number.isFinite(numericTotal) ? numericTotal : 0,
              );

              // Single-item orders reorder straight away; the picker only opens
              // when there is more than one reorderable product.
              const buyAgainSeed = getBuyAgainItems(order)[0] || null;
              const isLive = !isDeadOrder(order);
              const isCompleted =
                String(order.customer_stage) === "completed" && isLive;

              // Return entry point. `return_eligible` and `return_blocked_reason`
              // come straight from the same rule the API enforces, so the button
              // can explain itself instead of failing on submit.
              const returnActionsHtml = !isCompleted
                ? ""
                : `${
                    order.has_return && order.return_id
                      ? `<button type="button" class="customer-order-return-view-btn" data-return-detail="${escapeHtml(order.return_id)}"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i> ${escapeHtml(order.return_status_label || "View Return")}</button>`
                      : ""
                  }${
                    order.return_eligible
                      ? `<button type="button" class="customer-order-return-btn" data-order-return="${escapeHtml(order.id)}" data-order-name="${escapeHtml(order.product_name || "Order")}">Return / Refund</button>`
                      : !order.has_return && order.return_blocked_reason
                        ? `<button type="button" class="customer-order-return-btn is-blocked" data-return-blocked="${escapeHtml(order.return_blocked_reason)}">Return / Refund</button>`
                        : ""
                  }`;

              // GCash placed before the money was sent. `awaiting_customer_payment`
              // and `payment_under_review` are the server's own read of the
              // payment row, so the button never contradicts what staff see.
              const payActionsHtml = order.awaiting_customer_payment
                ? `<button type="button" class="customer-order-pay-btn${order.payment_is_overdue ? " is-overdue" : ""}" data-order-pay="${escapeHtml(order.id)}"><i class="fa-solid fa-mobile-screen-button" aria-hidden="true"></i> Pay Now</button>`
                : order.payment_under_review
                  ? `<button type="button" class="customer-order-pay-btn is-review" data-order-pay="${escapeHtml(order.id)}"><i class="fa-regular fa-hourglass-half" aria-hidden="true"></i> Payment under review</button>`
                  : "";

              // Cancellation. `can_request_cancel` and `cancel_is_immediate` are
              // the server's own read of the same rule the API enforces, so the
              // button never promises something the POST will refuse: it only
              // appears while the order is still at To Pay, and there it cancels
              // outright unless FMRC has already confirmed the payment, in which
              // case it files a request so staff can arrange the refund.
              // `cancel_blocked_reason` explains a missing button.
              const cancelActionsHtml = order.can_request_cancel
                ? `<button type="button" class="customer-order-cancel-btn" data-order-cancel="${escapeHtml(order.id)}" data-order-name="${escapeHtml(order.product_name || "Order")}"><i class="fa-regular fa-circle-xmark" aria-hidden="true"></i> ${order.cancel_is_immediate ? "Cancel Order" : "Request Cancellation"}</button>`
                : order.cancel_pending
                  ? `<button type="button" class="customer-order-cancel-btn is-pending" data-cancel-blocked="${escapeHtml(order.cancel_blocked_reason || "Your cancellation request is already being reviewed.")}"><i class="fa-regular fa-hourglass-half" aria-hidden="true"></i> Cancellation pending</button>`
                  : "";

              const cancelBandHtml = order.is_cancelled
                ? `<p class="customer-order-cancel-band is-cancelled">
                     <i class="fa-regular fa-circle-xmark" aria-hidden="true"></i>
                     <span><strong>Cancelled${order.cancelled_at_label ? ` on ${escapeHtml(order.cancelled_at_label)}` : ""}.</strong>${order.cancel_reason_label ? ` ${escapeHtml(order.cancel_reason_label)}.` : ""}${
                       order.cancel_refund_due && order.payment_is_confirmed
                         ? " FMRC still owes you a refund — staff send it back to the GCash number you paid from."
                         : order.cancel_refund_due
                           ? " If your GCash payment reached FMRC, staff will send it back to the number you paid from."
                           : order.payment_is_refunded
                             ? ` Refunded${order.payment_refunded_label ? ` on ${escapeHtml(order.payment_refunded_label)}` : ""}${order.payment_refund_reference ? ` (ref. ${escapeHtml(order.payment_refund_reference)})` : ""}.`
                             : ""
                     }</span>
                   </p>`
                : order.cancel_pending
                  ? `<p class="customer-order-cancel-band is-pending">
                       <i class="fa-regular fa-hourglass-half" aria-hidden="true"></i>
                       <span><strong>Cancellation requested${order.cancel_requested_label ? ` ${escapeHtml(order.cancel_requested_label)}` : ""}.</strong> FMRC staff are reviewing it${order.cancel_reason_label ? ` — ${escapeHtml(order.cancel_reason_label)}` : ""}.</span>
                     </p>`
                  : String(order.cancel_state || "") === "declined"
                    ? `<p class="customer-order-cancel-band is-declined">
                         <i class="fa-regular fa-circle-question" aria-hidden="true"></i>
                         <span><strong>Cancellation declined.</strong>${order.cancel_decision_note ? ` ${escapeHtml(order.cancel_decision_note)}` : " FMRC has already started preparing this order."}</span>
                       </p>`
                    : "";

              return `
                <article class="customer-order-card${order.is_cancelled ? " is-cancelled" : ""}">
                  <div class="customer-order-thumb">
                    ${renderOrderThumbTrigger(order)}
                  </div>
                  <div class="customer-order-main">
                    <h4>${productName}</h4>
                    <p class="customer-order-meta">Order ${orderNo} &bull; ${quantityLabel}</p>
                    <p class="customer-order-meta">${paymentMethod} &bull; ${formatOrderDate(order.created_at)}</p>
                    ${cancelBandHtml}
                  </div>
                  <div class="customer-order-side">
                    <span class="customer-order-status ${statusMeta.className}">${statusMeta.label}</span>
                    <strong class="customer-order-price">${totalLabel}</strong>
                  </div>
                  <div class="customer-order-actions">
                    <button type="button" class="customer-order-detail-btn" data-order-detail="${escapeHtml(order.id)}">Order Details</button>
                    ${payActionsHtml}
                    ${String(order.customer_stage) === 'to_receive' && isLive
                      ? `<button type="button" class="customer-order-received-btn" data-order-received="${escapeHtml(order.id)}" data-order-name="${escapeHtml(order.product_name || 'Order')}" data-order-pickup="${order.is_pickup ? '1' : '0'}">${order.is_pickup ? 'Order Collected' : 'Order Received'}</button>`
                      : ''}
                    ${String(order.customer_stage) === 'completed' && isLive && !order.has_rating
                      ? `<button type="button" class="customer-order-rate-btn" data-order-rate="${escapeHtml(order.id)}" data-order-name="${escapeHtml(order.product_name || 'Order')}">Rate Product</button>`
                      : ''}
                    ${isCompleted
                      ? `<button type="button" class="customer-order-buy-again-btn" data-order-buy-again="${escapeHtml(order.id)}" data-buy-again-product="${escapeHtml(buyAgainSeed?.product_id ?? '')}" data-buy-again-name="${escapeHtml(buyAgainSeed?.product_name || order.product_name || 'Order')}"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i> Buy Again</button>`
                      : ''}
                    ${returnActionsHtml}
                    ${cancelActionsHtml}
                  </div>
                </article>
              `;
            })
            .join("");
        });

        tabs.forEach((tab, tabIndex) => {
          const stageKey = stageByPanel[tabIndex];
          const scoped = getVisibleOrdersByPanel(stageKey);
          // The "To Rate" tab badge should reflect only products still
          // awaiting a rating (unrated completed orders), not every
          // completed order. "Returns" follows the same needs-attention
          // rule: only requests that are still open are counted. "Cancelled"
          // is a history tab, so it counts everything in it.
          let count = scoped.length;
          if (stageKey === "to_rate") {
            count = scoped.filter((order) => !order.has_rating).length;
          } else if (stageKey === "returns") {
            count = scoped.filter(
              (row) => String(row?.status_group || "open") === "open",
            ).length;
          }
          const countEl = tab.querySelector(".customer-orders-tab-count");
          if (countEl) countEl.textContent = String(count);
        });

        hydrateCustomerOrderImages(overlay);
      };


      const renderDetailModal = (detail) => {
        if (!detailModal || !detailContent || !detailTitle) return;

        const safeOrderNo = escapeHtml(
          detail.order_no_display || `#${detail.order_no || detail.id || "-"}`,
        );
        const safeTitle = escapeHtml(detail.product_name || "Order Details");

        // Build the full list of ordered products so the Order Details modal
        // shows every item individually (with its quantity and line total)
        // instead of the collapsed "First Item (+N more)" label.
        const detailItems = Array.isArray(detail.items) ? detail.items : [];
        const itemsListHtml = detailItems.length
          ? detailItems
              .map((item) => {
                const itemName = escapeHtml(item.product_name || "Custom Order");
                const itemQty = Math.max(
                  1,
                  Number.parseInt(item.quantity || "1", 10) || 1,
                );
                const itemLineTotal = escapeHtml(
                  formatOrderCurrency(
                    Number(item.line_total || 0) ||
                      Number(item.unit_price || 0) * itemQty,
                  ),
                );
                return `
                  <div class="customer-order-detail-item">
                    ${renderOrderThumbTrigger(item, "customer-order-detail-image-trigger")}
                    <div class="customer-order-detail-item-info">
                      <strong>${itemName}</strong>
                      <span>Qty: ${itemQty} &nbsp;&bull;&nbsp; ${itemLineTotal}</span>
                    </div>
                  </div>
                `;
              })
              .join("")
          : `<div class="customer-order-detail-item">
                <div class="customer-order-detail-item-info">
                  <strong>${safeTitle}</strong>
                </div>
              </div>`;

        const safeStatus = escapeHtml(
          ORDER_LIFECYCLE_LABELS[
            String(detail.lifecycle_status || "").toLowerCase()
          ] ||
            ORDER_STAGE_LABELS[
              String(detail.customer_stage || "").toLowerCase()
            ] ||
            "Pending",
        );

        // The same three-way band the card shows, restated here because the
        // detail modal is where a customer goes to find out what happened to a
        // dead order - the reason, the decision note and the refund state all
        // have to be readable without closing it again.
        const cancelDetailHtml = detail.is_cancelled
          ? `<div class="customer-order-cancel-detail is-cancelled">
               <h4><i class="fa-regular fa-circle-xmark" aria-hidden="true"></i> ${
                 detail.cancelled_by_customer
                   ? "You cancelled this order"
                   : "This order was cancelled"
               }</h4>
               <p>${
                 detail.cancelled_at_label
                   ? `Cancelled on ${escapeHtml(detail.cancelled_at_label)}.`
                   : ""
               }${detail.cancel_reason_label ? ` Reason: ${escapeHtml(detail.cancel_reason_label)}.` : ""}</p>
               ${detail.cancel_reason_detail ? `<p class="customer-order-cancel-detail-note">&ldquo;${escapeHtml(detail.cancel_reason_detail)}&rdquo;</p>` : ""}
               <p>${
                 detail.cancel_refund_due && detail.payment_is_confirmed
                   ? "FMRC still has to send your payment back. Staff transfer it by hand to the GCash number you paid from, so allow a few working days."
                   : detail.cancel_refund_due
                     ? "You sent a GCash reference that nobody had verified yet. Staff will check the FMRC account and, if the money arrived, transfer it back by hand to the number you paid from."
                     : detail.payment_is_refunded
                       ? `Refunded${detail.payment_refunded_label ? ` on ${escapeHtml(detail.payment_refunded_label)}` : ""}${detail.payment_refund_reference ? ` — GCash ref. ${escapeHtml(detail.payment_refund_reference)}` : ""}.`
                       : "No payment was collected on this order, so there is nothing to refund."
               }</p>
               ${detail.cancel_decision_note ? `<p class="customer-order-cancel-detail-note">Staff note: ${escapeHtml(detail.cancel_decision_note)}</p>` : ""}
             </div>`
          : detail.cancel_pending
            ? `<div class="customer-order-cancel-detail is-pending">
                 <h4><i class="fa-regular fa-hourglass-half" aria-hidden="true"></i> Cancellation requested</h4>
                 <p>${detail.cancel_requested_label ? `Sent ${escapeHtml(detail.cancel_requested_label)}.` : ""}${detail.cancel_reason_label ? ` Reason: ${escapeHtml(detail.cancel_reason_label)}.` : ""} FMRC staff review it before the order is cancelled — the order carries on as normal until they decide.</p>
                 ${detail.cancel_reason_detail ? `<p class="customer-order-cancel-detail-note">&ldquo;${escapeHtml(detail.cancel_reason_detail)}&rdquo;</p>` : ""}
               </div>`
            : String(detail.cancel_state || "") === "declined"
              ? `<div class="customer-order-cancel-detail is-declined">
                   <h4><i class="fa-regular fa-circle-question" aria-hidden="true"></i> Cancellation declined</h4>
                   <p>${detail.cancel_decided_label ? `Decided ${escapeHtml(detail.cancel_decided_label)}.` : ""} ${escapeHtml(detail.cancel_decision_note || "FMRC has already started preparing this order.")}</p>
                 </div>`
              : "";

        const timeline = Array.isArray(detail.timeline) ? detail.timeline : [];
        // Prefer the newest checkpoint that carries coordinates; fall back to the
        // order's own last-known point, then to the destination (the FMRC counter
        // for a pickup) so the map is never blank when we know where it is going.
        const withCoords =
          timeline.find(
            (entry) =>
              Number.isFinite(Number(entry?.latitude)) &&
              Number.isFinite(Number(entry?.longitude)),
          ) ||
          (Number.isFinite(Number(detail?.latitude)) &&
          Number.isFinite(Number(detail?.longitude))
            ? detail
            : {
                latitude: detail?.destination_latitude,
                longitude: detail?.destination_longitude,
              });
        const mapEmbedUrl = buildGoogleMapEmbedUrl(
          withCoords?.latitude,
          withCoords?.longitude,
        );
        const mapOpenUrl = buildGoogleMapOpenUrl(
          withCoords?.latitude,
          withCoords?.longitude,
        );
        // The courier sub-object is the server's own read of the registry, so
        // the name, the waybill and the link can never disagree with what the
        // admin stamped on the order.
        const courierState =
          detail.courier && typeof detail.courier === "object"
            ? detail.courier
            : {};
        const courierName = escapeHtml(
          courierState.name || detail.courier_name || "Courier",
        );
        const courierTrackingNo = String(
          courierState.tracking_no || detail.courier_tracking_no || "",
        ).trim();
        const courierTrackingUrl = String(
          courierState.tracking_url || "",
        ).trim();
        // The courier's own tracking page, when the one-click link had to come
        // from 17TRACK instead. Secondary on purpose: it needs the number pasted
        // into a form, so it is the long way round to the same checkpoints.
        const courierOwnTrackingUrl = String(
          courierState.courier_tracking_url || "",
        ).trim();
        const trackingIsUniversal =
          courierState.tracking_url_provider === "universal" ||
          (!courierState.tracking_url_provider &&
            isUniversalTrackingUrl(courierTrackingUrl));

        // How this order is handed over. Pickup orders never ship, so they show
        // the FMRC counter and a pickup code instead of a courier address.
        const isPickupOrder = Boolean(detail.is_pickup);
        const fulfillmentLabel = escapeHtml(
          detail.fulfillment_label ||
            (isPickupOrder ? "Pickup at FMRC" : "Courier Delivery"),
        );
        const deliveryAddress =
          detail.delivery_address && typeof detail.delivery_address === "object"
            ? detail.delivery_address
            : {};
        const destinationLabel = String(
          detail.destination_label ||
            detail.delivery_address_line ||
            detail.location_name ||
            "",
        ).trim();
        const pickupCode = String(detail.pickup_code || "").trim();

        const fulfillmentRows = isPickupOrder
          ? [
              ["Pickup location", destinationLabel],
              ["Pickup code", pickupCode],
              ["Ready since", detail.pickup_ready_at_label],
              ["Collected", detail.picked_up_at_label],
            ]
          : [
              ["Recipient", deliveryAddress.recipient_name],
              ["Contact", deliveryAddress.contact_no],
              ["Street", deliveryAddress.street],
              ["Barangay", deliveryAddress.barangay],
              ["City / Municipality", deliveryAddress.city],
              ["Province", deliveryAddress.province],
              ["Postal code", deliveryAddress.postal_code],
              ["Landmark", deliveryAddress.landmark],
            ];

        const fulfillmentRowsHtml = fulfillmentRows
          .filter(([, value]) => String(value || "").trim())
          .map(
            ([label, value]) => `
              <div class="customer-order-fulfillment-row">
                <dt>${escapeHtml(label)}</dt>
                <dd>${escapeHtml(String(value))}</dd>
              </div>
            `,
          )
          .join("");

        const fulfillmentHtml = `
          <div class="customer-order-detail-fulfillment">
            <h4>${isPickupOrder ? "Pickup Details" : "Delivery Details"}</h4>
            <p class="customer-order-fulfillment-mode"><strong>${fulfillmentLabel}</strong></p>
            ${
              fulfillmentRowsHtml
                ? `<dl class="customer-order-fulfillment-grid">${fulfillmentRowsHtml}</dl>`
                : `<p class="customer-order-logistics-note">${
                    destinationLabel
                      ? escapeHtml(destinationLabel)
                      : "Address details are not on file for this order."
                  }</p>`
            }
          </div>
        `;

        detailTitle.textContent = `Order ${safeOrderNo}`;

        detailContent.innerHTML = `
          <div class="customer-order-detail-summary">
            <div class="customer-order-detail-chip"><span>Status</span><strong>${safeStatus}</strong></div>
            <div class="customer-order-detail-chip"><span>Payment</span><strong>${escapeHtml(detail.payment_method || "N/A")}</strong></div>
            <div class="customer-order-detail-chip"><span>Total</span><strong>${escapeHtml(detail.total_label || formatOrderCurrency(detail.total_amount))}</strong></div>
          </div>

          ${cancelDetailHtml}

          <div class="customer-order-detail-items">
            <h4>Items (${detailItems.length || 1})</h4>
            <div class="customer-order-detail-items-list">
              ${itemsListHtml}
            </div>
          </div>

          ${fulfillmentHtml}

          ${
            isPickupOrder
              ? ""
              : `<div class="customer-order-detail-logistics">
            <h4>Courier Tracking</h4>
            <p><strong>${courierName}</strong></p>
            ${
              courierTrackingNo
                ? `<div class="customer-order-waybill">
                     <span class="customer-order-waybill-label">Waybill no.</span>
                     <code class="customer-order-waybill-no">${escapeHtml(courierTrackingNo)}</code>
                     <button type="button" class="customer-order-waybill-copy" data-copy-text="${escapeHtml(courierTrackingNo)}">Copy</button>
                   </div>`
                : ""
            }
            ${
              courierTrackingUrl
                ? `<a class="customer-order-logistics-link" href="${escapeHtml(courierTrackingUrl)}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-location-crosshairs" aria-hidden="true"></i> ${
                    trackingIsUniversal
                      ? "Track this parcel on 17TRACK"
                      : `Track this parcel on ${courierName}`
                  }</a>
                   ${
                     courierOwnTrackingUrl
                       ? `<a class="customer-order-logistics-link customer-order-logistics-link--ghost" href="${escapeHtml(courierOwnTrackingUrl)}" target="_blank" rel="noopener noreferrer">Or open ${courierName}'s own site</a>`
                       : ""
                   }
                   <p class="customer-order-logistics-note">${
                     trackingIsUniversal
                       ? `The waybill number is already in that link — 17TRACK recognises ${courierName} from the number and lists their checkpoints, no typing needed. ${courierName}'s own site asks you to paste the number in yourself, which is why it is the second link.`
                       : `Opens ${courierName}'s tracking page with this waybill already filled in.`
                   } FMRC also copies each checkpoint into the timeline below as the courier reports it.</p>`
                : '<p class="customer-order-logistics-note">Tracking number will appear here once shipment info is available.</p>'
            }
          </div>`
          }

          <div class="customer-order-detail-map-wrap">
            <h4>${isPickupOrder ? "Pickup Location" : "Latest Known Location"}</h4>
            ${
              mapEmbedUrl
                ? `<iframe class="customer-order-map-frame" src="${escapeHtml(mapEmbedUrl)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Order location map"></iframe>
                   <div class="customer-order-map-actions">${
                     mapOpenUrl
                       ? `<a href="${escapeHtml(mapOpenUrl)}" target="_blank" rel="noopener noreferrer">Open in Google Maps</a>`
                       : ""
                   }</div>`
                : '<div class="customer-order-map-empty"><i class="fa-solid fa-map-location-dot"></i><p>Location updates will appear here once available.</p></div>'
            }
          </div>

          <div class="customer-order-detail-timeline">
            <h4>Order Timeline</h4>
            <div class="customer-order-timeline-list">
              ${
                timeline.length
                  ? timeline
                      .map(
                        (entry) => `
                          <article class="customer-order-timeline-item">
                            <div class="customer-order-timeline-dot"></div>
                            <div class="customer-order-timeline-body">
                              <div class="customer-order-timeline-top">
                                <strong>${escapeHtml(entry.title || "Order update")}</strong>
                                <span>${escapeHtml(formatOrderDate(entry.occurred_at || entry.occurred_at_label))}</span>
                              </div>
                              ${entry.description ? `<p>${escapeHtml(entry.description)}</p>` : ""}
                              <div class="customer-order-timeline-meta">
                                <span>${escapeHtml(entry.stage_label || ORDER_STAGE_LABELS[entry.stage] || "Stage update")}</span>
                                ${entry.location_name ? `<span>${escapeHtml(entry.location_name)}</span>` : ""}
                              </div>
                            </div>
                          </article>
                        `,
                      )
                      .join("")
                  : '<p class="customer-order-timeline-empty">Timeline updates will appear once your order is processed.</p>'
              }
            </div>
          </div>
        `;

        detailModal.classList.add("show");
        detailModal.setAttribute("aria-hidden", "false");
        hydrateCustomerOrderImages(detailContent);
      };

      const closeDetailModal = () => {
        if (!detailModal) return;
        detailModal.classList.remove("show");
        detailModal.setAttribute("aria-hidden", "true");
        state.activeDetailId = null;
        state.activeReturnDetailId = null;
      };

      // ── Return detail ──────────────────────────────────────────────────────
      // Rendered into the same sub-modal the order detail uses, so the open,
      // close, Escape and image-preview wiring is shared verbatim.

      const renderReturnEvidence = (media) => {
        const files = Array.isArray(media) ? media : [];
        if (!files.length) return "";

        const thumbs = files
          .map((file) => {
            const url = resolveCustomerOrderImageUrl(file?.url);
            if (!url) return "";
            const safeUrl = escapeHtml(url);
            const name = escapeHtml(file?.name || "Return evidence");
            return String(file?.type) === "video"
              ? `<a class="customer-return-evidence-item" href="${safeUrl}" target="_blank" rel="noopener noreferrer"><video src="${safeUrl}" muted preload="metadata"></video><span><i class="fa-solid fa-play" aria-hidden="true"></i> Video</span></a>`
              : `<a class="customer-return-evidence-item" href="${safeUrl}" target="_blank" rel="noopener noreferrer"><img src="${safeUrl}" alt="${name}" loading="lazy" /><span><i class="fa-solid fa-expand" aria-hidden="true"></i> Photo</span></a>`;
          })
          .join("");

        if (!thumbs) return "";

        return `
          <div class="customer-order-detail-items customer-return-evidence-block">
            <h4>Evidence (${files.length})</h4>
            <div class="customer-return-evidence-grid">${thumbs}</div>
          </div>
        `;
      };

      const renderReturnDetailModal = (detail) => {
        if (!detailModal || !detailContent || !detailTitle) return;

        const returnNo = escapeHtml(
          detail?.return_no_display || `#${detail?.return_no || detail?.id || "-"}`,
        );
        const status = String(detail?.status || "requested");
        const lines = Array.isArray(detail?.items) ? detail.items : [];
        const timeline = Array.isArray(detail?.timeline) ? detail.timeline : [];

        const itemsListHtml = lines.length
          ? lines
              .map((item) => {
                const qty = Math.max(1, Number(item?.quantity) || 1);
                return `
                  <div class="customer-order-detail-item">
                    ${renderOrderThumbTrigger(
                      resolveReturnThumbSource({
                        order_id: detail?.order_id,
                        items: [item],
                        product_name: item?.product_name,
                      }),
                      "customer-order-detail-image-trigger",
                    )}
                    <div class="customer-order-detail-item-info">
                      <strong>${escapeHtml(item?.product_name || "Returned item")}</strong>
                      <span>Qty: ${qty} &nbsp;&bull;&nbsp; ${escapeHtml(item?.line_total_label || formatOrderCurrency(Number(item?.line_total || 0) || 0))}</span>
                    </div>
                  </div>
                `;
              })
              .join("")
          : `<div class="customer-order-detail-item">
                <div class="customer-order-detail-item-info">
                  <strong>${escapeHtml(detail?.product_name || "Returned item")}</strong>
                </div>
              </div>`;

        const refundReceiptHtml =
          status === "refunded" || detail?.refunded_amount_label
            ? `
              <div class="customer-order-detail-logistics customer-return-receipt">
                <h4>Refund Receipt</h4>
                <p><strong>${escapeHtml(detail?.refunded_amount_label || "-")}</strong> via ${escapeHtml(detail?.refund_method_label || "-")}</p>
                ${detail?.refund_reference ? `<p class="customer-order-logistics-note">Reference: ${escapeHtml(detail.refund_reference)}</p>` : ""}
                ${detail?.refunded_at_label ? `<p class="customer-order-logistics-note">Released ${escapeHtml(detail.refunded_at_label)}</p>` : ""}
              </div>
            `
            : "";

        const shipBackHtml = detail?.return_courier_name
          ? `
            <div class="customer-order-detail-logistics">
              <h4>Return Shipment</h4>
              <p><strong>${escapeHtml(detail.return_courier_name)}</strong>${detail?.return_tracking_no ? ` &bull; ${escapeHtml(detail.return_tracking_no)}` : ""}</p>
              ${
                // The customer chose this courier themselves, so there is no
                // registry entry to look a tracking page up in - 17TRACK reads
                // the carrier off the number, which is already in the link.
                String(detail?.return_tracking_no || "").trim()
                  ? `<a class="customer-order-logistics-link" href="${escapeHtml(prefilledUniversalTrackingUrl(detail.return_tracking_no))}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-location-crosshairs" aria-hidden="true"></i> Track this return on 17TRACK</a>`
                  : '<p class="customer-order-logistics-note">Keep your shipping receipt until the refund is released.</p>'
              }
            </div>
          `
          : "";

        const notesHtml = [
          detail?.reason_detail
            ? `<div class="customer-return-note-row"><span>Your description</span><p>${escapeHtml(detail.reason_detail)}</p></div>`
            : "",
          detail?.customer_note
            ? `<div class="customer-return-note-row"><span>Your note</span><p>${escapeHtml(detail.customer_note)}</p></div>`
            : "",
          detail?.decision_note
            ? `<div class="customer-return-note-row is-store"><span>Store decision</span><p>${escapeHtml(detail.decision_note)}</p></div>`
            : "",
        ]
          .filter(Boolean)
          .join("");

        detailTitle.textContent = `Return ${returnNo}`;

        // The same two customer actions the list row offers, so a customer who
        // opened the detail first does not have to back out to act.
        const actionsHtml =
          detail?.can_cancel || detail?.can_ship_back
            ? `
              <div class="customer-order-actions customer-return-detail-actions">
                ${
                  detail?.can_ship_back
                    ? `<button type="button" class="customer-order-return-ship-btn" data-return-ship="${escapeHtml(detail?.id)}" data-return-no="${returnNo}"><i class="fa-solid fa-truck-fast" aria-hidden="true"></i> Item Shipped Back</button>`
                    : ""
                }
                ${
                  detail?.can_cancel
                    ? `<button type="button" class="customer-order-return-cancel-btn" data-return-cancel="${escapeHtml(detail?.id)}" data-return-no="${returnNo}">Cancel Request</button>`
                    : ""
                }
              </div>
            `
            : "";

        detailContent.innerHTML = `
          <div class="customer-order-detail-summary">
            <div class="customer-order-detail-chip"><span>Status</span><strong>${escapeHtml(detail?.status_label || "Requested")}</strong></div>
            <div class="customer-order-detail-chip"><span>Reason</span><strong>${escapeHtml(detail?.reason_label || "-")}</strong></div>
            <div class="customer-order-detail-chip"><span>Resolution</span><strong>${escapeHtml(detail?.resolution_label || "-")}</strong></div>
            <div class="customer-order-detail-chip"><span>Requested</span><strong>${escapeHtml(detail?.requested_amount_label || "-")}</strong></div>
            ${detail?.approved_amount_label ? `<div class="customer-order-detail-chip"><span>Approved</span><strong>${escapeHtml(detail.approved_amount_label)}</strong></div>` : ""}
            <div class="customer-order-detail-chip"><span>Order</span><strong>${escapeHtml(detail?.order_no_display || `#${detail?.order_no || detail?.order_id || "-"}`)}</strong></div>
          </div>

          ${actionsHtml}

          <div class="customer-order-detail-items">
            <h4>Items returned (${lines.length || 1})</h4>
            <div class="customer-order-detail-items-list">
              ${itemsListHtml}
            </div>
          </div>

          ${notesHtml ? `<div class="customer-order-detail-items customer-return-notes"><h4>Notes</h4>${notesHtml}</div>` : ""}

          ${renderReturnEvidence(detail?.media)}

          ${shipBackHtml}

          ${refundReceiptHtml}

          <div class="customer-order-detail-timeline">
            <h4>Return Timeline</h4>
            <div class="customer-order-timeline-list">
              ${
                timeline.length
                  ? timeline
                      .map(
                        (entry) => `
                          <article class="customer-order-timeline-item">
                            <div class="customer-order-timeline-dot"></div>
                            <div class="customer-order-timeline-body">
                              <div class="customer-order-timeline-top">
                                <strong>${escapeHtml(entry?.title || "Return update")}</strong>
                                <span>${escapeHtml(entry?.occurred_at_label || formatOrderDate(entry?.occurred_at))}</span>
                              </div>
                              ${entry?.description ? `<p>${escapeHtml(entry.description)}</p>` : ""}
                              <div class="customer-order-timeline-meta">
                                <span>${escapeHtml(entry?.status_label || "Return update")}</span>
                                ${entry?.actor_role ? `<span>${escapeHtml(RETURN_ACTOR_LABELS[String(entry.actor_role)] || entry.actor_role)}</span>` : ""}
                              </div>
                            </div>
                          </article>
                        `,
                      )
                      .join("")
                  : '<p class="customer-order-timeline-empty">Timeline updates will appear as your request moves forward.</p>'
              }
            </div>
          </div>
        `;

        detailModal.classList.add("show");
        detailModal.setAttribute("aria-hidden", "false");
        hydrateCustomerOrderImages(detailContent);
      };

      const openReturnDetail = async (returnId) => {
        if (!returnId || !state.token) return;
        if (!detailModal || !detailContent || !detailTitle) return;

        const key = String(returnId);
        state.activeDetailId = null;
        state.activeReturnDetailId = key;

        const cached = state.returnDetailsById.get(key);
        if (cached) {
          renderReturnDetailModal(cached);
          void refreshActiveReturnDetail();
          return;
        }

        // Render what the list already knows so the modal never opens blank,
        // then swap in the full record (with its timeline) when it lands.
        const listRow = state.returns.find((row) => String(row?.id) === key);
        if (listRow) {
          renderReturnDetailModal(listRow);
        } else {
          detailTitle.textContent = "Return Details";
          detailContent.innerHTML = `
            <div class="customer-orders-empty">
              <i class="fa-solid fa-spinner fa-spin"></i>
              <p>Preparing return details...</p>
            </div>
          `;
          detailModal.classList.add("show");
          detailModal.setAttribute("aria-hidden", "false");
        }

        state.returnDetailLoading = true;
        try {
          const detail = await fetchCustomerReturnDetail(state.token, key);
          if (detail && state.activeReturnDetailId === key) {
            state.returnDetailsById.set(key, detail);
            renderReturnDetailModal(detail);
          }
        } catch (error) {
          if (state.activeReturnDetailId === key && !listRow) {
            detailTitle.textContent = "Return Details";
            detailContent.innerHTML = `
              <div class="customer-orders-empty">
                <i class="fa-regular fa-circle-xmark"></i>
                <p>${escapeHtml(error?.message || "Unable to load return details.")}</p>
              </div>
            `;
          }
        } finally {
          state.returnDetailLoading = false;
        }
      };

      const refreshActiveReturnDetail = async () => {
        if (!state.activeReturnDetailId || !state.token) return;
        if (!detailModal?.classList.contains("show")) return;
        if (state.returnDetailLoading) return;

        const key = String(state.activeReturnDetailId);
        state.returnDetailLoading = true;
        try {
          const detail = await fetchCustomerReturnDetail(state.token, key);
          if (detail && state.activeReturnDetailId === key) {
            state.returnDetailsById.set(key, detail);
            renderReturnDetailModal(detail);
          }
        } catch (error) {
          if (error?.isSessionExpired) {
            void handleSessionExpired();
            return;
          }
          // Keep the current view; the poller will retry.
        } finally {
          state.returnDetailLoading = false;
        }
      };

      const openOrderDetail = async (orderId) => {
        if (!orderId || !state.token) return;

        const key = String(orderId);
        // The order and return details share one sub-modal, so opening one
        // must release the other's refresh claim.
        state.activeReturnDetailId = null;
        const cached = state.detailsById.get(key);
        if (cached) {
          state.activeDetailId = key;
          renderDetailModal(cached);
          void refreshActiveDetail(true);
          return;
        }

        if (!detailModal || !detailContent || !detailTitle) return;

        state.detailLoading = true;
        state.activeDetailId = key;
        detailTitle.textContent = "Order Details";
        detailContent.innerHTML = `
          <div class="customer-orders-empty">
            <i class="fa-solid fa-spinner fa-spin"></i>
            <p>Preparing order details...</p>
          </div>
        `;
        detailModal.classList.add("show");
        detailModal.setAttribute("aria-hidden", "false");

        try {
          const result = await fetchCustomerOrderDetail(state.token, key);
          if (result.detail) {
            state.detailsById.set(key, result.detail);
            state.detailEtagsById.set(key, result.etag || "");
            renderDetailModal(result.detail);
            state.lastDetailRefreshAt = Date.now();
          }
        } catch (error) {
          if (error?.isSessionExpired) {
            void handleSessionExpired();
            return;
          }
          detailTitle.textContent = "Order Details";
          detailContent.innerHTML = `
            <div class="customer-orders-empty">
              <i class="fa-regular fa-circle-xmark"></i>
              <p>${escapeHtml(error?.message || "Unable to load order details.")}</p>
            </div>
          `;
        } finally {
          state.detailLoading = false;
        }
      };

      const refreshActiveDetail = async (force = false) => {
        if (!state.activeDetailId || !state.token) return;
        if (!detailModal?.classList.contains("show")) return;
        if (state.detailLoading) return;
        if (!force && Date.now() - state.lastDetailRefreshAt < 1000) return;

        state.detailLoading = true;
        try {
          const detailKey = String(state.activeDetailId);
          const result = await fetchCustomerOrderDetail(
            state.token,
            detailKey,
            state.detailEtagsById.get(detailKey) || "",
          );
          if (result.etag) {
            state.detailEtagsById.set(detailKey, result.etag);
          }
          if (!result.notModified && result.detail) {
            state.detailsById.set(detailKey, result.detail);
            renderDetailModal(result.detail);
          }
          state.lastDetailRefreshAt = Date.now();
        } catch (error) {
          if (error?.isSessionExpired) {
            void handleSessionExpired();
            return;
          }
          // Keep current detail view; periodic refresh will retry.
        } finally {
          state.detailLoading = false;
        }
      };

      const refreshOrders = async (showLoading, force = false) => {
        if (state.refreshInProgress) {
          if (force) state.refreshQueued = true;
          return;
        }

        const now = Date.now();
        if (
          !force &&
          now - state.lastRefreshAt < CUSTOMER_ORDERS_MIN_REFRESH_GAP_MS
        ) {
          return;
        }

        if (!state.token) {
          // No credentials to send at all: same dead-session treatment as a 401.
          void handleSessionExpired();
          return;
        }

        state.refreshInProgress = true;

        if (showLoading) {
          state.loading = true;
          setSyncStatus("syncing", "Loading current orders...");
          renderOrders();
        }

        try {
          const result = await fetchCustomerOrders(state.token, state.etag);
          state.lastRefreshAt = Date.now();
          state.loading = false;

          if (!result.notModified && Array.isArray(result.orders)) {
            state.orders = result.orders;
            // Returns ride in the same response, so they refresh in lockstep
            // with the order rows and stay covered by the same ETag.
            if (Array.isArray(result.returns)) state.returns = result.returns;
            if (result.returnWindowDays) {
              state.returnWindowDays = result.returnWindowDays;
            }
            // Only overwrite when the server actually sent options: an empty
            // array here would leave the cancel sheet with nothing to show.
            if (
              Array.isArray(result.cancelReasonOptions) &&
              result.cancelReasonOptions.length
            ) {
              state.cancelReasonOptions = result.cancelReasonOptions;
            }
            state.etag = result.etag || "";
            writeCustomerOrdersCache(
              state.cacheKey,
              state.orders,
              state.etag,
              state.returns,
              state.cancelReasonOptions,
            );
            renderOrders();
          } else if (result.etag) {
            state.etag = result.etag;
          }

          setSyncStatus("live", "Live updates on");

          void refreshActiveDetail(false);
          void refreshActiveReturnDetail();
        } catch (error) {
          state.lastRefreshAt = Date.now();
          if (error?.isSessionExpired) {
            // Not a connectivity blip - retrying would never recover.
            void handleSessionExpired();
            return;
          }
          if (state.orders.length) {
            state.loading = false;
            setSyncStatus(
              "offline",
              "Showing saved orders - reconnecting...",
            );
          } else {
            tabs.forEach((tab) => {
              const countEl = tab.querySelector(".customer-orders-tab-count");
              if (countEl) countEl.textContent = "0";
            });

            panels.forEach((panel) => {
              panel.innerHTML = `
                <div class="customer-orders-empty">
                  <i class="fa-regular fa-circle-xmark"></i>
                  <p>${escapeHtml(error?.message || "Unable to load orders right now.")}</p>
                </div>
              `;
            });
            setSyncStatus("offline", "Unable to sync - retrying...");
          }
        } finally {
          state.loading = false;
          state.refreshInProgress = false;

          if (state.refreshQueued) {
            state.refreshQueued = false;
            void refreshOrders(false, true);
          }
        }
      };

      tabs.forEach((tab, index) => {
        tab.addEventListener("click", () => {
          setActivePanel(index);
        });
      });

      overlay.addEventListener("click", (event) => {
        const imageTrigger = event.target.closest(
          ".customer-order-image-trigger",
        );
        if (imageTrigger) {
          event.preventDefault();
          event.stopPropagation();
          void openCustomerOrderImagePreview(imageTrigger);
          return;
        }

        const detailBtn = event.target.closest("[data-order-detail]");
        if (detailBtn) {
          const orderId = detailBtn.getAttribute("data-order-detail") || "";
          if (!orderId) return;
          void openOrderDetail(orderId);
          return;
        }

        const receivedBtn = event.target.closest("[data-order-received]");
        if (receivedBtn) {
          event.preventDefault();
          event.stopPropagation();
          const orderId = receivedBtn.getAttribute("data-order-received") || "";
          const orderName = receivedBtn.getAttribute("data-order-name") || "Order";
          if (!orderId) return;
          void handleOrderReceived(orderId, orderName, receivedBtn);
          return;
        }

        const rateBtn = event.target.closest("[data-order-rate]");
        if (rateBtn) {
          event.preventDefault();
          event.stopPropagation();
          const orderId = rateBtn.getAttribute("data-order-rate") || "";
          const orderName = rateBtn.getAttribute("data-order-name") || "Order";
          if (!orderId) return;
          void openRatingModal(orderId, orderName);
          return;
        }

        // The orders drawer is the one dialog the user asked to stay dismissible
        // from the scrim, so it is a deliberate carve-out from the site-wide
        // "modals only close from their own controls" rule. The order of the
        // guards below mirrors the Escape handler further down: whatever is
        // stacked on top of the drawer closes first, and the drawer itself only
        // closes when nothing is layered over it.
        if (event.target !== overlay) return;
        // A horizontal swipe ends with a synthetic click; ignore it.
        if (state.didDrag) return;
        if (document.querySelector(".customer-buy-again-overlay.show")) return;
        if (customerOrderImageLightbox?.classList.contains("show-modal")) {
          closeCustomerOrderImagePreview();
          return;
        }
        if (detailModal?.classList.contains("show")) {
          closeDetailModal();
          return;
        }
        close();
      });

      closeBtn?.addEventListener("click", close);
      closeDetailBtn?.addEventListener("click", closeDetailModal);

      // Waybill numbers are long and get retyped into the courier's own site,
      // so copying beats transcribing. Delegated because the detail body is
      // re-rendered from innerHTML on every open.
      detailContent?.addEventListener("click", async (event) => {
        const button = event.target?.closest?.("[data-copy-text]");
        if (!button) return;

        const text = button.getAttribute("data-copy-text") || "";
        const original = button.textContent;
        let copied = false;
        try {
          await navigator.clipboard.writeText(text);
          copied = true;
        } catch {
          // Insecure origin or a browser without the clipboard API: select the
          // number so a manual copy is one keystroke away.
          const code = button
            .closest(".customer-order-waybill")
            ?.querySelector(".customer-order-waybill-no");
          if (code) {
            const range = document.createRange();
            range.selectNodeContents(code);
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
          }
        }

        button.textContent = copied ? "Copied" : "Copy it";
        window.setTimeout(() => {
          button.textContent = original;
        }, 1600);
      });

      document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || !overlay.classList.contains("show"))
          return;
        // The Buy Again picker sits on top of the drawer and closes itself.
        if (document.querySelector(".customer-buy-again-overlay.show")) return;
        if (customerOrderImageLightbox?.classList.contains("show-modal")) {
          closeCustomerOrderImagePreview();
          return;
        }
        if (detailModal?.classList.contains("show")) {
          closeDetailModal();
          return;
        }
        close();
      });

      // Panel swiping. The panels are full of tappable controls ("View details",
      // "Order received", "Rate"), so nothing is hijacked until the gesture has
      // proved itself horizontal: the axis is locked once the finger has moved
      // 12px, and only an x-lock starts dragging the track with the finger.
      const SWIPE_AXIS_LOCK = 12;
      const SWIPE_COMMIT = 45;
      const prefersLessMotion = () =>
        window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ===
        true;

      const settleTrack = () => {
        state.dragging = false;
        state.axisLock = "";
        if (!track) return;
        track.style.transition = "";
        track.style.transform = `translateX(-${state.activeIndex * 100}%)`;
      };

      viewport?.addEventListener(
        "touchstart",
        (event) => {
          const touch = event.changedTouches?.[0];
          if (!touch) return;
          state.touchStartX = touch.clientX;
          state.touchStartY = touch.clientY;
          state.dragging = false;
          state.didDrag = false;
          state.axisLock = "";
        },
        { passive: true },
      );

      viewport?.addEventListener(
        "touchmove",
        (event) => {
          const touch = event.changedTouches?.[0];
          if (!touch || !track) return;

          const deltaX = touch.clientX - state.touchStartX;
          const deltaY = touch.clientY - state.touchStartY;

          if (!state.axisLock) {
            if (Math.abs(deltaX) < SWIPE_AXIS_LOCK &&
              Math.abs(deltaY) < SWIPE_AXIS_LOCK)
              return;
            // A vertical lock hands the gesture back to the panel's own scroll.
            state.axisLock =
              Math.abs(deltaX) > Math.abs(deltaY) ? "x" : "y";
            if (state.axisLock === "x") {
              state.dragging = true;
              // The finger owns the position, so no easing while it is down.
              track.style.transition = "none";
            }
          }

          if (!state.dragging) return;
          state.didDrag = true;

          // Rubber-band the two ends so the first and last panels feel closed.
          const atStart = state.activeIndex === 0 && deltaX > 0;
          const atEnd =
            state.activeIndex === stageByPanel.length - 1 && deltaX < 0;
          const shift = atStart || atEnd ? deltaX * 0.32 : deltaX;
          track.style.transform = `translateX(calc(-${state.activeIndex * 100}% + ${Math.round(shift)}px))`;
        },
        { passive: true },
      );

      const finishSwipe = (event) => {
        const touch = event.changedTouches?.[0];
        if (!touch) return;

        const deltaX = touch.clientX - state.touchStartX;
        const deltaY = touch.clientY - state.touchStartY;
        const wasDragging = state.dragging;

        if (track && wasDragging && !prefersLessMotion()) {
          track.style.transition = "transform 0.24s cubic-bezier(0.22, 1, 0.36, 1)";
        }

        if (
          Math.abs(deltaX) >= SWIPE_COMMIT &&
          Math.abs(deltaX) > Math.abs(deltaY)
        ) {
          state.dragging = false;
          state.axisLock = "";
          setActivePanel(
            deltaX < 0 ? state.activeIndex + 1 : state.activeIndex - 1,
          );
        } else if (wasDragging) {
          // Under the commit distance: snap back to where we started.
          state.dragging = false;
          state.axisLock = "";
          if (track) {
            track.style.transform = `translateX(-${state.activeIndex * 100}%)`;
          }
        } else {
          settleTrack();
        }

        // The browser fires `click` right after `touchend`; keep the flag up long
        // enough for the scrim handler to ignore that one, then clear it so a
        // later real click still works.
        if (state.didDrag) {
          window.setTimeout(() => {
            state.didDrag = false;
          }, 350);
        }
      };

      viewport?.addEventListener("touchend", finishSwipe, { passive: true });
      viewport?.addEventListener("touchcancel", settleTrack, { passive: true });

      window.addEventListener("fmrc:orders-updated", (event) => {
        if (!overlay.classList.contains("show")) return;
        const popup = document.getElementById("customerSystemPopup");
        if (popup && popup.classList.contains("show")) return;
        const payload = event?.detail || {};
        if (!shouldProcessRealtimeSignal(payload)) return;
        state.lastDetailRefreshAt = 0;
        void refreshOrders(false, true);
      });

      window.addEventListener("storage", (event) => {
        if (event.key !== ORDERS_REALTIME_SIGNAL_KEY) return;
        if (!overlay.classList.contains("show") || document.hidden) return;
        const popup = document.getElementById("customerSystemPopup");
        if (popup && popup.classList.contains("show")) return;

        let payload = {};
        try {
          payload = JSON.parse(event.newValue || "{}");
        } catch {
          payload = {};
        }
        if (!shouldProcessRealtimeSignal(payload)) return;

        state.lastDetailRefreshAt = 0;
        void refreshOrders(false, true);
      });

      const realtimeChannel = getOrdersRealtimeChannel();
      realtimeChannel?.addEventListener("message", (event) => {
        if (!overlay.classList.contains("show") || document.hidden) return;
        const popup = document.getElementById("customerSystemPopup");
        if (popup && popup.classList.contains("show")) return;
        const payload = event?.data || {};
        if (payload?.source === "customer-portal") return;
        if (!shouldProcessRealtimeSignal(payload)) return;
        state.lastDetailRefreshAt = 0;
        void refreshOrders(false, true);
      });

      document.addEventListener("visibilitychange", () => {
        if (document.hidden || !overlay.classList.contains("show")) return;
        const popup = document.getElementById("customerSystemPopup");
        if (popup && popup.classList.contains("show")) return;
        state.lastDetailRefreshAt = 0;
        void refreshOrders(false, true);
      });

      window.addEventListener("focus", () => {
        if (!overlay.classList.contains("show")) return;
        state.lastDetailRefreshAt = 0;
        void refreshOrders(false, true);
      });

      customerOrdersController = {
        open: async (nextUserInfo) => {
          state.userInfo = nextUserInfo;
          state.cacheKey = String(
            nextUserInfo?.id || nextUserInfo?.email || "customer-orders",
          );
          state.token = getCustomerToken();
          state.detailsById.clear();
          state.detailEtagsById.clear();
          state.returnDetailsById.clear();
          state.activeReturnDetailId = null;
          state.refreshQueued = false;
          state.etag = "";
          setActivePanel(0);

          const cachedEntry = readCustomerOrdersCache(state.cacheKey);
          const hasCachedOrders = Boolean(
            cachedEntry && Array.isArray(cachedEntry.orders),
          );
          if (hasCachedOrders) {
            state.loading = false;
            state.orders = cachedEntry.orders;
            // Cache entries written before returns existed simply have none.
            state.returns = Array.isArray(cachedEntry.returns)
              ? cachedEntry.returns
              : [];
            // Restored with the rows because the request that follows will match
            // the cached ETag and come back 304 - bodiless - so this is the only
            // chance to have the server's reason list before the customer taps
            // Cancel Order.
            if (
              Array.isArray(cachedEntry.cancelReasonOptions) &&
              cachedEntry.cancelReasonOptions.length
            ) {
              state.cancelReasonOptions = cachedEntry.cancelReasonOptions;
            }
            state.etag = String(cachedEntry.etag || "");
            renderOrders();
            setSyncStatus("syncing", "Checking for new updates...");
          } else {
            state.orders = [];
            state.returns = [];
            state.loading = true;
            setSyncStatus("syncing", "Loading current orders...");
          }

          overlay.classList.add("show");
          document.body.style.overflow = "hidden";
          await refreshOrders(!hasCachedOrders, true);
          startRealtimeRefresh();
        },
      };
    }

  void customerOrdersController.open(activeUserInfo);
};

// â”€â”€ Rating Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const openRatingModal = (() => {
  let ratingOverlay = null;

  const RATING_LABELS = {
    1: "Terrible",
    2: "Bad",
    3: "Okay",
    4: "Good",
    5: "Excellent",
  };

  const escapeRatingHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const resolveRatingMediaUrl = (value) => {
    if (!value) return "";
    try {
      return new URL(value, API_BASE_URL).href;
    } catch {
      return String(value);
    }
  };

  const normalizeItems = (order) =>
    Array.isArray(order?.items)
      ? order.items.filter((item) => item && item.id !== undefined && item.id !== null)
      : [];

  const ensureModal = () => {
    if (ratingOverlay) return ratingOverlay;

    ratingOverlay = document.createElement("div");
    ratingOverlay.id = "customerRatingModal";
    ratingOverlay.className = "customer-rating-overlay ux-dlg";
    ratingOverlay.innerHTML = `
      <div class="customer-rating-card ux-dlg__card" role="dialog" aria-modal="true" aria-labelledby="ratingModalTitle">
        <div class="customer-rating-head ux-dlg__head">
          <button type="button" class="customer-orders-close ux-dlg__close" id="closeRatingModal" aria-label="Close rating modal">&times;</button>
          <span class="ux-dlg__badge" aria-hidden="true"><i class="fa-solid fa-star"></i></span>
          <div>
            <p class="customer-rating-eyebrow ux-dlg__eyebrow">Customer review</p>
            <h3 id="ratingModalTitle" class="ux-dlg__title">Rate each product</h3>
          </div>
        </div>
        <div class="customer-rating-body" id="ratingModalBody">
          <p class="customer-rating-product-name" id="ratingProductName">Rate each product individually.</p>
          <div class="customer-rating-items" id="ratingItems"></div>
        </div>
        <div class="customer-rating-actions ux-dlg__foot is-confirm">
          <button type="button" class="customer-rating-cancel-btn ux-dlg__btn ux-dlg__btn--ghost" id="cancelRatingBtn">Cancel</button>
          <button type="button" class="btn-place-order customer-rating-submit-btn ux-dlg__btn ux-dlg__btn--primary" id="submitRatingBtn">
            <span class="customer-rating-submit-spinner" aria-hidden="true"></span>
            <span data-rating-submit-label>Submit reviews</span>
          </button>
        </div>
      </div>
      <div class="customer-rating-discard-overlay ux-dlg" id="ratingDiscardModal" aria-hidden="true">
        <div class="customer-rating-discard-card ux-dlg__card" role="dialog" aria-modal="true" aria-labelledby="ratingDiscardTitle">
          <div class="ux-dlg__head">
            <span class="customer-rating-discard-icon ux-dlg__badge" aria-hidden="true"><i class="fa-solid fa-triangle-exclamation"></i></span>
            <p class="ux-dlg__eyebrow">Unsaved changes</p>
            <h3 id="ratingDiscardTitle" class="ux-dlg__title">Discard changes?</h3>
          </div>
          <div class="ux-dlg__body">
            <p class="ux-dlg__text">Your product ratings and review changes have not been submitted.</p>
          </div>
          <div class="customer-rating-discard-actions ux-dlg__foot is-confirm">
            <button type="button" class="customer-rating-cancel-btn ux-dlg__btn ux-dlg__btn--ghost" id="continueRatingBtn">Continue to rate or review</button>
            <button type="button" class="customer-rating-submit-btn ux-dlg__btn ux-dlg__btn--danger" id="discardRatingBtn">Discard</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(ratingOverlay);

    const itemsContainer = ratingOverlay.querySelector("#ratingItems");
    const submitBtn = ratingOverlay.querySelector("#submitRatingBtn");
    const submitLabel = submitBtn?.querySelector("[data-rating-submit-label]");
    const discardOverlay = ratingOverlay.querySelector("#ratingDiscardModal");
    const discardBtn = ratingOverlay.querySelector("#discardRatingBtn");
    const continueBtn = ratingOverlay.querySelector("#continueRatingBtn");
    let itemModels = [];
    let draftByItem = new Map();
    let filesByItem = new Map();
    let itemsLoading = false;

    const getDraft = (itemId) => draftByItem.get(String(itemId));
    const markDirty = () => { ratingOverlay._hasRatingDraft = true; };

    const renderMediaPreview = (itemId) => {
      const article = itemsContainer?.querySelector(`[data-rating-item="${String(itemId)}"]`);
      const preview = article?.querySelector("[data-media-preview]");
      if (!preview) return;
      const draft = getDraft(itemId) || {};
      const selectedFiles = filesByItem.get(String(itemId)) || [];
      const existingMedia = Array.isArray(draft.existingMedia) ? draft.existingMedia : [];
      const existingMarkup = existingMedia.map((media) => {
        const src = escapeRatingHtml(resolveRatingMediaUrl(media?.url));
        if (!src) return "";
        return media?.type === "video"
          ? `<span class="customer-rating-media-thumb"><video src="${src}" muted preload="metadata"></video><small>Existing video</small></span>`
          : `<span class="customer-rating-media-thumb"><img src="${src}" alt="Existing review media" /><small>Existing photo</small></span>`;
      }).join("");
      const selectedMarkup = selectedFiles.map((file, index) => {
        const src = escapeRatingHtml(URL.createObjectURL(file));
        const isVideo = String(file.type || "").startsWith("video/");
        return `<span class="customer-rating-media-thumb is-new"><${isVideo ? "video" : "img"} src="${src}" ${isVideo ? "muted preload=\"metadata\"" : `alt="${escapeRatingHtml(file.name)}"`} ></${isVideo ? "video" : "img"}><button type="button" data-remove-media="${index}" aria-label="Remove ${escapeRatingHtml(file.name)}">&times;</button><small>${escapeRatingHtml(file.name)}</small></span>`;
      }).join("");
      preview.innerHTML = existingMarkup + selectedMarkup;
      preview.hidden = !existingMarkup && !selectedMarkup;
    };

    const renderItem = (item) => {
      const id = String(item.id);
      const draft = getDraft(id) || { stars: 0, feedback: "", anonymous: false, existingMedia: [] };
      const productName = escapeRatingHtml(item.product_name || "Product");
      const image = item.product_image || "";
      const imageMarkup = image
        ? `<img src="${escapeRatingHtml(resolveRatingMediaUrl(image))}" alt="${productName}" />`
        : `<span class="customer-rating-item-placeholder"><i class="fa-solid fa-box" aria-hidden="true"></i></span>`;
      const stars = [1, 2, 3, 4, 5].map((star) => `<button type="button" class="rating-star-large${star <= Number(draft.stars) ? " filled" : ""}" data-star="${star}" aria-label="${RATING_LABELS[star]} (${star} star${star === 1 ? "" : "s"})">&#9733;</button>`).join("");
      const label = draft.stars ? RATING_LABELS[draft.stars] : "Select a star rating";
      const feedback = escapeRatingHtml(draft.feedback || "");

      return `
        <article class="customer-rating-item" data-rating-item="${escapeRatingHtml(id)}">
          <div class="customer-rating-item-head">
            <div class="customer-rating-item-image">${imageMarkup}</div>
            <div class="customer-rating-item-copy">
              <h4>${productName}</h4>
              <p>${Number(item.quantity || 1)} item${Number(item.quantity || 1) === 1 ? "" : "s"} &bull; Rate this product separately</p>
            </div>
          </div>
          <div class="customer-rating-stars rating-item-stars" role="group" aria-label="Star rating for ${productName}">${stars}</div>
          <p class="customer-rating-score-label rating-item-score" data-rating-score>${escapeRatingHtml(label)}</p>
          <label class="customer-rating-field-label" for="ratingFeedback-${escapeRatingHtml(id)}">Write 30+ characters <span>(optional)</span></label>
          <textarea id="ratingFeedback-${escapeRatingHtml(id)}" class="customer-rating-feedback" data-rating-feedback maxlength="300" minlength="30" placeholder="Share what you liked or disliked about this product..." rows="4">${feedback}</textarea>
          <div class="customer-rating-char-count"><span data-rating-char-count>${String((draft.feedback || "").length)}</span>/300</div>
          <div class="customer-rating-media-field">
            <span class="customer-rating-field-label">Add a photo or video <span>(optional)</span></span>
            <label class="customer-rating-upload" for="ratingMedia-${escapeRatingHtml(id)}"><i class="fa-regular fa-image" aria-hidden="true"></i><span>Choose photos or videos</span></label>
            <input id="ratingMedia-${escapeRatingHtml(id)}" type="file" data-rating-media accept="image/*,video/*" multiple hidden />
            <div class="customer-rating-media-preview" data-media-preview hidden></div>
          </div>
          <label class="customer-rating-anonymous"><input type="checkbox" data-rating-anonymous${draft.anonymous ? " checked" : ""} /><span>Post anonymously</span></label>
        </article>
      `;
    };

    const renderItems = () => {
      if (!itemsContainer) return;
      itemsContainer.setAttribute("aria-busy", itemsLoading ? "true" : "false");
      if (itemModels.length) {
        itemsContainer.innerHTML = itemModels.map((item) => renderItem(item)).join("");
      } else if (itemsLoading) {
        itemsContainer.innerHTML = `
          <div class="customer-rating-loading" role="status" aria-live="polite">
            <span class="customer-rating-loading-mark" aria-hidden="true"></span>
            <span class="customer-rating-loading-copy">
              <strong>Preparing your review form</strong>
              <span>Loading products in this order...</span>
            </span>
          </div>`;
      } else {
        itemsContainer.innerHTML = `
          <div class="customer-rating-empty" role="status">
            <i class="fa-solid fa-box-open" aria-hidden="true"></i>
            <strong>No products available to review</strong>
            <span>Please refresh your orders and try again.</span>
          </div>`;
      }

      itemModels.forEach((item) => renderMediaPreview(item.id));
      itemsContainer.querySelectorAll(".rating-item-stars").forEach((stars) => {
        stars.addEventListener("mouseover", (event) => {
          const star = event.target.closest("[data-star]");
          if (star) paintStars(stars.closest("[data-rating-item]")?.dataset.ratingItem, Number(star.dataset.star));
        });
        stars.addEventListener("mouseleave", () => {
          const itemId = stars.closest("[data-rating-item]")?.dataset.ratingItem;
          paintStars(itemId, Number(getDraft(itemId)?.stars || 0));
        });
      });
    };

    const paintStars = (itemId, fill) => {
      const article = itemsContainer?.querySelector(`[data-rating-item="${String(itemId)}"]`);
      if (!article) return;
      const value = Number(fill) || 0;
      article.querySelectorAll(".rating-star-large").forEach((button) => {
        button.classList.toggle("filled", Number(button.dataset.star) <= value);
      });
      const score = article.querySelector("[data-rating-score]");
      if (score) score.textContent = value ? RATING_LABELS[value] : "Select a star rating";
    };

    itemsContainer?.addEventListener("click", (event) => {
      const star = event.target.closest(".rating-star-large");
      if (star) {
        const article = star.closest("[data-rating-item]");
        const itemId = article?.dataset.ratingItem;
        const draft = getDraft(itemId);
        if (!draft) return;
        draft.stars = Number(star.dataset.star) || 0;
        markDirty();
        paintStars(itemId, draft.stars);
        return;
      }

      const removeMedia = event.target.closest("[data-remove-media]");
      if (removeMedia) {
        const article = removeMedia.closest("[data-rating-item]");
        const itemId = article?.dataset.ratingItem;
        const files = filesByItem.get(String(itemId)) || [];
        files.splice(Number(removeMedia.dataset.removeMedia), 1);
        filesByItem.set(String(itemId), files);
        markDirty();
        renderMediaPreview(itemId);
      }
    });

    itemsContainer?.addEventListener("input", (event) => {
      const input = event.target.closest("[data-rating-feedback]");
      if (!input) return;
      const itemId = input.closest("[data-rating-item]")?.dataset.ratingItem;
      const draft = getDraft(itemId);
      if (!draft) return;
      draft.feedback = input.value;
      markDirty();
      const count = input.closest("[data-rating-item]")?.querySelector("[data-rating-char-count]");
      if (count) count.textContent = String(input.value.length);
    });

    itemsContainer?.addEventListener("change", (event) => {
      const mediaInput = event.target.closest("[data-rating-media]");
      if (mediaInput) {
        const itemId = mediaInput.closest("[data-rating-item]")?.dataset.ratingItem;
        const selectedFiles = Array.from(mediaInput.files || []);
        const files = selectedFiles.slice(0, 6);
        filesByItem.set(String(itemId), files);
        markDirty();
        renderMediaPreview(itemId);
        mediaInput.value = "";
        if (selectedFiles.length > 6) {
          void showCustomerPopup("You can add up to 6 photos or videos per product.", { title: "Media limit" });
        }
        return;
      }

      const anonymous = event.target.closest("[data-rating-anonymous]");
      if (anonymous) {
        const itemId = anonymous.closest("[data-rating-item]")?.dataset.ratingItem;
        const draft = getDraft(itemId);
        if (draft) {
          draft.anonymous = Boolean(anonymous.checked);
          markDirty();
        }
      }
    });

    const closeModal = () => {
      ratingOverlay.classList.remove("show");
      discardOverlay?.classList.remove("show");
      discardOverlay?.setAttribute("aria-hidden", "true");
      ratingOverlay._hasRatingDraft = false;
      document.body.style.overflow = "";
    };

    const requestClose = () => {
      if (!ratingOverlay._hasRatingDraft) {
        closeModal();
        return;
      }
      discardOverlay?.classList.add("show");
      discardOverlay?.setAttribute("aria-hidden", "false");
    };

    ratingOverlay.querySelector("#closeRatingModal")?.addEventListener("click", requestClose);
    ratingOverlay.querySelector("#cancelRatingBtn")?.addEventListener("click", requestClose);
    // Modal: no scrim dismissal — a stray click must not discard a written review.
    // Escape is the keyboard twin of the close X, so it goes through the same
    // draft check: with a review in progress it raises the discard confirm rather
    // than throwing the text away. `ensureModal` runs once, so this binds once.
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!ratingOverlay.classList.contains("show")) return;
      event.stopPropagation();
      if (discardOverlay?.classList.contains("show")) {
        discardOverlay.classList.remove("show");
        discardOverlay.setAttribute("aria-hidden", "true");
        return;
      }
      requestClose();
    });
    continueBtn?.addEventListener("click", () => {
      discardOverlay?.classList.remove("show");
      discardOverlay?.setAttribute("aria-hidden", "true");
    });
    discardBtn?.addEventListener("click", closeModal);

    ratingOverlay._setItems = (items, ratings = []) => {
      const ratingsByItem = new Map((Array.isArray(ratings) ? ratings : []).map((rating) => [String(rating.order_item_id), rating]));
      itemsLoading = false;
      itemModels = normalizeItems({ items });
      draftByItem = new Map();
      filesByItem = new Map();
      itemModels.forEach((item) => {
        const existing = ratingsByItem.get(String(item.id));
        draftByItem.set(String(item.id), {
          stars: Number(existing?.stars) || 0,
          feedback: existing?.feedback || "",
          anonymous: Boolean(existing?.is_anonymous),
          existingMedia: Array.isArray(existing?.media) ? existing.media : [],
        });
      });
      ratingOverlay._hasRatingDraft = false;
      if (submitBtn && !submitBtn.classList.contains("is-loading")) {
        submitBtn.disabled = itemModels.length === 0;
      }
      renderItems();
    };

    ratingOverlay._setLoading = () => {
      itemsLoading = true;
      itemModels = [];
      draftByItem = new Map();
      filesByItem = new Map();
      ratingOverlay._hasRatingDraft = false;
      if (submitBtn) submitBtn.disabled = true;
      renderItems();
    };

    ratingOverlay._getState = () => itemModels.map((item) => ({
      item,
      ...getDraft(item.id),
      files: filesByItem.get(String(item.id)) || [],
    }));

    ratingOverlay._submit = async () => {
      const activeOrderId = ratingOverlay._activeOrderId;
      const token = getCustomerToken();
      const states = ratingOverlay._getState();
      if (!activeOrderId || !states.length) {
        await showCustomerPopup("No products were found in this order.", { title: "Review unavailable" });
        return;
      }

      const missingStars = states.find((state) => !state.stars);
      if (missingStars) {
        paintStars(missingStars.item.id, 0);
        missingStars.item && itemsContainer?.querySelector(`[data-rating-item="${String(missingStars.item.id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        await showCustomerPopup("Please choose a star rating for every product before submitting.", { title: "Rating required" });
        return;
      }

      const shortReview = states.find((state) => {
        const reviewLength = String(state.feedback || "").trim().length;
        return reviewLength > 0 && reviewLength < 30;
      });
      if (shortReview) {
        await showCustomerPopup("Written reviews need at least 30 characters, or you can leave the field blank.", { title: "Review too short" });
        return;
      }

      submitBtn.disabled = true;
      submitBtn.classList.add("is-loading");
      submitBtn.setAttribute("aria-busy", "true");
      if (submitLabel) submitLabel.textContent = "Saving reviews...";

      try {
        for (const state of states) {
          const formData = new FormData();
          formData.append("order_item_id", String(state.item.id));
          formData.append("stars", String(state.stars));
          formData.append("feedback", state.feedback.trim());
          formData.append("post_anonymously", state.anonymous ? "1" : "0");
          state.files.forEach((file) => formData.append("media[]", file, file.name));

          const response = await fetch(`${API_BASE_URL}/customer/orders/${activeOrderId}/rating`, {
            method: "POST",
            headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
            body: formData,
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            const validationMessage = Object.values(payload.errors || {})[0]?.[0];
            throw new Error(validationMessage || payload.message || "Unable to save one of the product reviews.");
          }
        }

        closeModal();
        emitCustomerOrdersUpdated({ type: "rating-submitted", orderId: activeOrderId });
        await showCustomerPopup("Thank you for reviewing every product in your order!", { title: "Reviews submitted" });
      } catch (error) {
        await showCustomerPopup(error?.message || "Unable to submit the product reviews.", { title: "Review not saved" });
      } finally {
        submitBtn.disabled = false;
        submitBtn.classList.remove("is-loading");
        submitBtn.removeAttribute("aria-busy");
        if (submitLabel) submitLabel.textContent = "Submit reviews";
      }
    };

    submitBtn?.addEventListener("click", () => void ratingOverlay._submit());

    return ratingOverlay;
  };

  return async (orderId, orderName, order = null) => {
    const token = getCustomerToken();
    if (!token) {
      await showCustomerPopup("Please sign in to rate your products.", { title: "Sign in required" });
      return;
    }

    const modal = ensureModal();
    modal._activeOrderId = String(orderId);
    const nameEl = modal.querySelector("#ratingProductName");
    if (nameEl) nameEl.textContent = "Rate each product individually. Your star rating is required.";
    const initialItems = normalizeItems(order);
    if (initialItems.length) modal._setItems(initialItems, []);
    else modal._setLoading();
    const modalBody = modal.querySelector("#ratingModalBody");
    if (modalBody) modalBody.scrollTop = 0;
    modal.classList.add("show");
    document.body.style.overflow = "hidden";

    let resolvedItems = initialItems;
    try {
      const detailPromise = initialItems.length
        ? Promise.resolve({ data: { items: initialItems } })
        : fetchJsonWithTimeout(`${API_BASE_URL}/customer/orders/${orderId}`, {
            headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
          }).then(({ response, data }) => {
            if (!response.ok) throw new Error(data.message || "Unable to load the order products.");
            return data;
          });
      const ratingsPromise = fetchJsonWithTimeout(
        `${API_BASE_URL}/customer/orders/${orderId}/rating`,
        { headers: { Accept: "application/json", Authorization: `Bearer ${token}` } },
      ).then(({ response, data }) => {
        if (!response.ok) throw new Error(data.message || "Unable to load existing reviews.");
        return { ratings: Array.isArray(data.data) ? data.data : (data.data ? [data.data] : []), error: null };
      }).catch((error) => ({ ratings: [], error }));

      const detailPayload = await detailPromise;
      const detailItems = normalizeItems(detailPayload?.data || detailPayload);
      resolvedItems = detailItems.length ? detailItems : initialItems;
      if (modal._activeOrderId !== String(orderId) || modal._hasRatingDraft) return;

      // Show the product controls as soon as the order detail arrives. Existing
      // reviews continue loading in parallel and hydrate only while untouched.
      modal._setItems(resolvedItems, []);

      const { ratings, error: ratingsError } = await ratingsPromise;
      if (ratingsError) throw ratingsError;
      if (modal._activeOrderId !== String(orderId) || modal._hasRatingDraft) return;
      modal._setItems(resolvedItems, ratings);
    } catch (error) {
      if (modal._activeOrderId === String(orderId) && !modal._hasRatingDraft) {
        modal._setItems(resolvedItems, []);
        await showCustomerPopup(error?.message || "Unable to load the review form.", { title: "Review unavailable" });
      }
    }
  };
})();

// ── Return Request Modal ──────────────────────────────────────────────────────
// Structurally a clone of the rating modal (same overlay shell, same discard
// guard, same media uploader) so the returns flow inherits every existing
// animation and never invents a new surface.
const openReturnRequestModal = (() => {
  let returnOverlay = null;

  const escapeReturnHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const pesoLabel = (amount) =>
    `₱ ${Number(amount || 0).toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const RETURN_REASON_HINTS = {
    damaged: "Tell us which part is damaged and how you found it.",
    wrong_item: "Describe what you received instead.",
    incomplete: "List the parts or pieces that are missing.",
    not_as_described: "Tell us how it differs from the listing.",
    quality_issue: "Describe the defect or finish problem.",
    other: "Please describe the problem in your own words.",
  };

  let returnItems = [];
  let returnDraft = null;
  let returnFiles = [];
  let returnLoading = false;
  let returnMeta = null;

  const buildReturnModalShell = () => {
    const overlay = document.createElement("div");
    overlay.id = "customerReturnRequestModal";
    overlay.className = "customer-rating-overlay customer-return-request-overlay ux-dlg";
    overlay.innerHTML = `
      <div class="customer-rating-card customer-return-request-card ux-dlg__card" role="dialog" aria-modal="true" aria-labelledby="returnRequestTitle">
        <div class="customer-rating-head ux-dlg__head">
          <button type="button" class="customer-orders-close ux-dlg__close" data-return-request-close aria-label="Close return request form">&times;</button>
          <span class="ux-dlg__badge" aria-hidden="true"><i class="fa-solid fa-rotate-left"></i></span>
          <div>
            <p class="customer-rating-eyebrow ux-dlg__eyebrow">Return &amp; refund</p>
            <h3 id="returnRequestTitle" class="ux-dlg__title">Request a return</h3>
          </div>
        </div>
        <div class="customer-rating-body" id="returnRequestBody"></div>
        <div class="customer-rating-actions ux-dlg__foot is-confirm">
          <button type="button" class="customer-rating-cancel-btn ux-dlg__btn ux-dlg__btn--ghost" data-return-request-close>Cancel</button>
          <button type="button" class="btn-place-order customer-rating-submit-btn ux-dlg__btn ux-dlg__btn--primary" data-return-request-submit>
            <span class="customer-rating-submit-spinner" aria-hidden="true"></span>
            <span data-return-submit-label>Submit request</span>
          </button>
        </div>
      </div>
      <div class="customer-rating-discard-overlay ux-dlg" data-return-discard aria-hidden="true">
        <div class="customer-rating-discard-card ux-dlg__card" role="dialog" aria-modal="true" aria-labelledby="returnDiscardTitle">
          <div class="ux-dlg__head">
            <span class="customer-rating-discard-icon ux-dlg__badge" aria-hidden="true"><i class="fa-solid fa-triangle-exclamation"></i></span>
            <p class="ux-dlg__eyebrow">Unsaved request</p>
            <h3 id="returnDiscardTitle" class="ux-dlg__title">Discard this request?</h3>
          </div>
          <div class="ux-dlg__body">
            <p class="ux-dlg__text">Your return details have not been submitted yet.</p>
          </div>
          <div class="customer-rating-discard-actions ux-dlg__foot is-confirm">
            <button type="button" class="customer-rating-cancel-btn ux-dlg__btn ux-dlg__btn--ghost" data-return-discard-continue>Continue the request</button>
            <button type="button" class="customer-rating-submit-btn ux-dlg__btn ux-dlg__btn--danger" data-return-discard-confirm>Discard</button>
          </div>
        </div>
      </div>
    `;
    return overlay;
  };

  const returnableQty = (item) =>
    Math.max(
      0,
      Number(item?.quantity || 0) - Number(item?.returned_quantity || 0),
    );

  const estimatedRefund = () =>
    returnItems.reduce((total, item) => {
      const picked = returnDraft?.selected.get(String(item.order_item_id)) || 0;
      return total + picked * Number(item.unit_price || 0);
    }, 0);

  const renderReturnPickRow = (item) => {
    const id = String(item.order_item_id);
    const available = returnableQty(item);
    const picked = returnDraft?.selected.get(id) || 0;
    const checked = picked > 0;

    return `
      <div class="customer-return-pick${checked ? " is-selected" : ""}${available < 1 ? " is-disabled" : ""}" data-return-pick="${escapeReturnHtml(id)}">
        <label class="customer-return-pick-check">
          <input type="checkbox" data-return-pick-toggle${checked ? " checked" : ""}${available < 1 ? " disabled" : ""} />
          <span class="customer-return-pick-copy">
            <strong>${escapeReturnHtml(item.product_name || "Product")}</strong>
            <span>${escapeReturnHtml(pesoLabel(item.unit_price))} each &bull; ${available < 1 ? "Already returned" : `${available} of ${Number(item.quantity || 0)} returnable`}</span>
          </span>
        </label>
        <div class="customer-return-qty" role="group" aria-label="Quantity to return">
          <button type="button" data-return-qty="-1" aria-label="Reduce quantity"${!checked || picked <= 1 ? " disabled" : ""}>&minus;</button>
          <span data-return-qty-value>${picked || 0}</span>
          <button type="button" data-return-qty="1" aria-label="Increase quantity"${!checked || picked >= available ? " disabled" : ""}>+</button>
        </div>
      </div>
    `;
  };

  const renderReturnEvidenceThumbs = () =>
    returnFiles
      .map((file, index) => {
        const src = escapeReturnHtml(URL.createObjectURL(file));
        const isVideo = String(file.type || "").startsWith("video/");
        const media = isVideo
          ? `<video src="${src}" muted preload="metadata"></video>`
          : `<img src="${src}" alt="${escapeReturnHtml(file.name)}" />`;
        return `<span class="customer-rating-media-thumb is-new">${media}<button type="button" data-remove-media="${index}" aria-label="Remove ${escapeReturnHtml(file.name)}">&times;</button><small>${escapeReturnHtml(file.name)}</small></span>`;
      })
      .join("");

  const renderReturnFormBody = () => {
    if (returnLoading || !returnDraft) {
      return `
        <div class="customer-rating-loading" role="status" aria-live="polite">
          <span class="customer-rating-loading-mark" aria-hidden="true"></span>
          <span class="customer-rating-loading-copy">
            <strong>Preparing your return form</strong>
            <span>Checking the return window for this order...</span>
          </span>
        </div>`;
    }

    if (!returnItems.length) {
      return `
        <div class="customer-rating-empty" role="status">
          <i class="fa-solid fa-box-open" aria-hidden="true"></i>
          <strong>No products available to return</strong>
          <span>Every item in this order has already been returned.</span>
        </div>`;
    }

    const hint = RETURN_REASON_HINTS[returnDraft.reason] || "";
    const detailRequired = returnDraft.reason === "other";

    return `
      <p class="customer-rating-product-name">${escapeReturnHtml(returnMeta?.orderName || "Order")}${returnMeta?.deadlineLabel ? ` &bull; you can file until ${escapeReturnHtml(returnMeta.deadlineLabel)}` : ""}</p>
      <div class="customer-return-window-note">
        <i class="fa-regular fa-clock" aria-hidden="true"></i>
        <span>Returns are accepted within ${Number(returnMeta?.windowDays || 7)} days of completion.${Number(returnMeta?.daysRemaining || 0) > 0 ? ` You have ${Number(returnMeta.daysRemaining)} day${Number(returnMeta.daysRemaining) === 1 ? "" : "s"} left.` : ""}</span>
      </div>

      <span class="customer-rating-field-label">1. Which products are you returning?</span>
      <div class="customer-return-pick-list" data-return-pick-list>
        ${returnItems.map((item) => renderReturnPickRow(item)).join("")}
      </div>

      <label class="customer-rating-field-label" for="returnReasonSelect">2. Why are you returning it?</label>
      <select id="returnReasonSelect" class="customer-return-select" data-return-reason>
        <option value="">Select a reason</option>
        ${(returnMeta?.reasons || [])
          .map(
            (reason) =>
              `<option value="${escapeReturnHtml(reason.value)}"${returnDraft.reason === reason.value ? " selected" : ""}>${escapeReturnHtml(reason.label)}</option>`,
          )
          .join("")}
      </select>
      ${
        returnDraft.reason
          ? `<label class="customer-rating-field-label" for="returnReasonDetail">Reason details ${detailRequired ? "<span>(required)</span>" : "<span>(optional)</span>"}</label>
      <textarea id="returnReasonDetail" class="customer-rating-feedback" data-return-reason-detail maxlength="600" rows="3" placeholder="${escapeReturnHtml(hint)}">${escapeReturnHtml(returnDraft.reasonDetail || "")}</textarea>`
          : ""
      }

      <span class="customer-rating-field-label">3. What would you like us to do?</span>
      <div class="customer-return-resolution" role="radiogroup" aria-label="Preferred resolution">
        ${(returnMeta?.resolutions || [])
          .map(
            (resolution) => `
          <label class="customer-return-resolution-option${returnDraft.resolution === resolution.value ? " is-active" : ""}">
            <input type="radio" name="returnResolution" value="${escapeReturnHtml(resolution.value)}" data-return-resolution${returnDraft.resolution === resolution.value ? " checked" : ""} />
            <span>${escapeReturnHtml(resolution.label)}</span>
          </label>`,
          )
          .join("")}
      </div>

      <label class="customer-rating-field-label" for="returnNote">4. Note for the store <span>(optional)</span></label>
      <textarea id="returnNote" class="customer-rating-feedback" data-return-note maxlength="1000" rows="3" placeholder="Anything else we should know...">${escapeReturnHtml(returnDraft.note || "")}</textarea>

      <div class="customer-rating-media-field">
        <span class="customer-rating-field-label">5. Photo or video evidence <span>(up to 6)</span></span>
        <label class="customer-rating-upload" for="returnEvidenceInput"><i class="fa-regular fa-image" aria-hidden="true"></i><span>Choose photos or videos</span></label>
        <input id="returnEvidenceInput" type="file" data-return-media accept="image/*,video/*" multiple hidden />
        <div class="customer-rating-media-preview" data-return-media-preview ${returnFiles.length ? "" : "hidden"}>${renderReturnEvidenceThumbs()}</div>
      </div>

      <div class="customer-return-estimate">
        <span>Estimated refund</span>
        <strong data-return-estimate>${escapeReturnHtml(pesoLabel(estimatedRefund()))}</strong>
      </div>
      <p class="customer-return-fineprint">The final amount is confirmed by the store after review. Keep the item and its packaging until then.</p>
    `;
  };

  const ensureReturnModal = () => {
    if (returnOverlay) return returnOverlay;

    returnOverlay = buildReturnModalShell();
    document.body.appendChild(returnOverlay);

    const body = returnOverlay.querySelector("#returnRequestBody");
    const submitBtn = returnOverlay.querySelector("[data-return-request-submit]");
    const submitLabel = returnOverlay.querySelector("[data-return-submit-label]");
    const discardOverlay = returnOverlay.querySelector("[data-return-discard]");

    const markReturnDirty = () => {
      returnOverlay._hasReturnDraft = true;
    };

    const renderBody = () => {
      if (!body) return;
      body.innerHTML = renderReturnFormBody();
      if (submitBtn && !submitBtn.classList.contains("is-loading")) {
        submitBtn.disabled = returnLoading || !returnItems.length;
      }
    };

    const syncEstimate = () => {
      const estimate = body?.querySelector("[data-return-estimate]");
      if (estimate) estimate.textContent = pesoLabel(estimatedRefund());
    };

    // Toggling a line only touches its own row, so the reason and note fields
    // keep their focus and caret position.
    const refreshPickRow = (id) => {
      const row = body?.querySelector(`[data-return-pick="${id}"]`);
      const item = returnItems.find(
        (entry) => String(entry.order_item_id) === id,
      );
      if (!row || !item) return;

      const picked = returnDraft?.selected.get(id) || 0;
      const available = returnableQty(item);
      row.classList.toggle("is-selected", picked > 0);

      const checkbox = row.querySelector("[data-return-pick-toggle]");
      if (checkbox) checkbox.checked = picked > 0;
      const value = row.querySelector("[data-return-qty-value]");
      if (value) value.textContent = String(picked || 0);
      const minus = row.querySelector('[data-return-qty="-1"]');
      const plus = row.querySelector('[data-return-qty="1"]');
      if (minus) minus.disabled = picked <= 1;
      if (plus) plus.disabled = picked < 1 || picked >= available;

      syncEstimate();
    };

    const syncMediaPreview = () => {
      const preview = body?.querySelector("[data-return-media-preview]");
      if (!preview) return;
      preview.innerHTML = renderReturnEvidenceThumbs();
      preview.hidden = returnFiles.length === 0;
    };

    body?.addEventListener("click", (event) => {
      const qtyBtn = event.target.closest("[data-return-qty]");
      if (qtyBtn) {
        const row = qtyBtn.closest("[data-return-pick]");
        const id = row?.getAttribute("data-return-pick") || "";
        const item = returnItems.find(
          (entry) => String(entry.order_item_id) === id,
        );
        if (!item || !returnDraft) return;
        const available = returnableQty(item);
        const next = Math.min(
          available,
          Math.max(
            1,
            (returnDraft.selected.get(id) || 0) + Number(qtyBtn.dataset.returnQty),
          ),
        );
        returnDraft.selected.set(id, next);
        markReturnDirty();
        refreshPickRow(id);
        return;
      }

      const removeMedia = event.target.closest("[data-remove-media]");
      if (removeMedia) {
        returnFiles.splice(Number(removeMedia.dataset.removeMedia), 1);
        markReturnDirty();
        syncMediaPreview();
      }
    });

    body?.addEventListener("change", (event) => {
      const toggle = event.target.closest("[data-return-pick-toggle]");
      if (toggle) {
        const row = toggle.closest("[data-return-pick]");
        const id = row?.getAttribute("data-return-pick") || "";
        const item = returnItems.find(
          (entry) => String(entry.order_item_id) === id,
        );
        if (!item || !returnDraft) return;
        if (toggle.checked) returnDraft.selected.set(id, Math.min(1, returnableQty(item)) || 1);
        else returnDraft.selected.delete(id);
        markReturnDirty();
        refreshPickRow(id);
        return;
      }

      const reasonSelect = event.target.closest("[data-return-reason]");
      if (reasonSelect) {
        if (!returnDraft) return;
        returnDraft.reason = reasonSelect.value;
        markReturnDirty();
        // The detail field appears/disappears with the reason, so this one
        // control does re-render the body.
        renderBody();
        return;
      }

      const resolutionInput = event.target.closest("[data-return-resolution]");
      if (resolutionInput) {
        if (!returnDraft) return;
        returnDraft.resolution = resolutionInput.value;
        markReturnDirty();
        body
          ?.querySelectorAll(".customer-return-resolution-option")
          .forEach((option) => {
            option.classList.toggle(
              "is-active",
              option.querySelector("input")?.value === returnDraft.resolution,
            );
          });
        return;
      }

      const mediaInput = event.target.closest("[data-return-media]");
      if (mediaInput) {
        const picked = Array.from(mediaInput.files || []);
        returnFiles = returnFiles.concat(picked).slice(0, 6);
        mediaInput.value = "";
        markReturnDirty();
        syncMediaPreview();
        if (returnFiles.length >= 6 && picked.length) {
          void showCustomerPopup(
            "You can attach up to 6 photos or videos per request.",
            { title: "Evidence limit" },
          );
        }
      }
    });

    body?.addEventListener("input", (event) => {
      if (!returnDraft) return;
      const detail = event.target.closest("[data-return-reason-detail]");
      if (detail) {
        returnDraft.reasonDetail = detail.value;
        markReturnDirty();
        return;
      }
      const note = event.target.closest("[data-return-note]");
      if (note) {
        returnDraft.note = note.value;
        markReturnDirty();
      }
    });

    const closeReturnModal = () => {
      returnOverlay.classList.remove("show");
      discardOverlay?.classList.remove("show");
      discardOverlay?.setAttribute("aria-hidden", "true");
      returnOverlay._hasReturnDraft = false;
      returnOverlay._activeOrderId = "";
      document.body.style.overflow = "";
    };

    const requestReturnClose = () => {
      if (!returnOverlay._hasReturnDraft) {
        closeReturnModal();
        return;
      }
      discardOverlay?.classList.add("show");
      discardOverlay?.setAttribute("aria-hidden", "false");
    };

    returnOverlay.addEventListener("click", (event) => {
      if (event.target?.closest?.("[data-return-request-close]")) {
        requestReturnClose();
        return;
      }
      if (event.target?.closest?.("[data-return-discard-continue]")) {
        discardOverlay?.classList.remove("show");
        discardOverlay?.setAttribute("aria-hidden", "true");
        return;
      }
      if (event.target?.closest?.("[data-return-discard-confirm]")) {
        closeReturnModal();
        return;
      }
      if (event.target?.closest?.("[data-return-request-submit]")) {
        void returnOverlay._submit();
      }
    });

    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Escape") return;
        if (!returnOverlay.classList.contains("show")) return;
        event.stopPropagation();
        requestReturnClose();
      },
      true,
    );

    returnOverlay._setLoading = (orderName) => {
      returnLoading = true;
      returnItems = [];
      returnFiles = [];
      returnDraft = null;
      returnMeta = { orderName: orderName || "Order" };
      returnOverlay._hasReturnDraft = false;
      renderBody();
    };

    returnOverlay._setData = (payload, orderName) => {
      returnLoading = false;
      returnItems = (Array.isArray(payload?.items) ? payload.items : []).filter(
        (item) => returnableQty(item) > 0,
      );
      returnFiles = [];
      returnMeta = {
        orderName: orderName || "Order",
        windowDays: Number(payload?.window_days) || 7,
        deadlineLabel: payload?.deadline_label || "",
        daysRemaining: Number(payload?.days_remaining) || 0,
        reasons: Array.isArray(payload?.reasons) ? payload.reasons : [],
        resolutions: Array.isArray(payload?.resolutions)
          ? payload.resolutions
          : [],
      };
      returnDraft = {
        selected: new Map(),
        reason: "",
        reasonDetail: "",
        resolution: returnMeta.resolutions[0]?.value || "refund",
        note: "",
      };
      // Single-item orders are the common case, so pre-select that line.
      if (returnItems.length === 1) {
        returnDraft.selected.set(String(returnItems[0].order_item_id), 1);
      }
      returnOverlay._hasReturnDraft = false;
      renderBody();
    };

    returnOverlay._close = closeReturnModal;

    returnOverlay._submit = async () => {
      const orderId = returnOverlay._activeOrderId;
      const token = getCustomerToken();
      if (!orderId || !returnDraft) return;

      const lines = returnItems
        .map((item) => ({
          order_item_id: item.order_item_id,
          quantity: returnDraft.selected.get(String(item.order_item_id)) || 0,
        }))
        .filter((line) => line.quantity > 0);

      if (!lines.length) {
        await showCustomerPopup(
          "Select at least one product you want to return.",
          { title: "Product required" },
        );
        return;
      }
      if (!returnDraft.reason) {
        await showCustomerPopup("Please choose why you are returning it.", {
          title: "Reason required",
        });
        return;
      }
      if (
        returnDraft.reason === "other" &&
        !String(returnDraft.reasonDetail || "").trim()
      ) {
        await showCustomerPopup(
          "Please describe the reason for your return.",
          { title: "Details required" },
        );
        body?.querySelector("[data-return-reason-detail]")?.focus();
        return;
      }

      submitBtn.disabled = true;
      submitBtn.classList.add("is-loading");
      submitBtn.setAttribute("aria-busy", "true");
      if (submitLabel) submitLabel.textContent = "Submitting...";

      try {
        const formData = new FormData();
        formData.append("reason", returnDraft.reason);
        formData.append(
          "reason_detail",
          String(returnDraft.reasonDetail || "").trim(),
        );
        formData.append("resolution", returnDraft.resolution);
        formData.append("customer_note", String(returnDraft.note || "").trim());
        lines.forEach((line, index) => {
          formData.append(`items[${index}][order_item_id]`, String(line.order_item_id));
          formData.append(`items[${index}][quantity]`, String(line.quantity));
        });
        returnFiles.forEach((file) =>
          formData.append("media[]", file, file.name),
        );

        const response = await fetch(
          `${API_BASE_URL}/customer/orders/${orderId}/return`,
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: formData,
          },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const validationMessage = Object.values(payload.errors || {})[0]?.[0];
          throw new Error(
            validationMessage ||
              payload.message ||
              "Unable to submit your return request.",
          );
        }

        returnOverlay._hasReturnDraft = false;
        const callback = returnOverlay._onSubmitted;
        closeReturnModal();
        if (callback) callback(payload?.data || null);
      } catch (error) {
        await showCustomerPopup(
          error?.message || "Unable to submit your return request.",
          { title: "Request not sent" },
        );
      } finally {
        submitBtn.disabled = false;
        submitBtn.classList.remove("is-loading");
        submitBtn.removeAttribute("aria-busy");
        if (submitLabel) submitLabel.textContent = "Submit request";
      }
    };


    return returnOverlay;
  };

  return async (orderId, orderName, options = {}) => {
    const token = getCustomerToken();
    if (!token) {
      await showCustomerPopup("Please sign in to request a return.", {
        title: "Sign in required",
      });
      return;
    }

    const modal = ensureReturnModal();
    modal._activeOrderId = String(orderId);
    modal._onSubmitted =
      typeof options.onSubmitted === "function" ? options.onSubmitted : null;
    modal._setLoading(orderName);
    modal.classList.add("show");
    document.body.style.overflow = "hidden";

    try {
      const { response, data } = await fetchJsonWithTimeout(
        `${API_BASE_URL}/customer/orders/${orderId}/return/eligibility`,
        {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
          },
        },
      );
      if (!response.ok) {
        throw new Error(data.message || "Unable to open the return form.");
      }
      if (modal._activeOrderId !== String(orderId)) return;

      if (!data.eligible) {
        modal._close();
        await showCustomerPopup(
          data.reason || "This order can no longer be returned.",
          { title: "Return unavailable" },
        );
        return;
      }

      modal._setData(data, orderName);
    } catch (error) {
      if (modal._activeOrderId !== String(orderId)) return;
      modal._close();
      await showCustomerPopup(
        error?.message || "Unable to open the return form. Please try again.",
        { title: "Return unavailable" },
      );
    }
  };
})();

  const { token, userInfo, isAuthenticated } = getCustomerSession();

  if (!isAuthenticated) {
    userProfileBtn.innerHTML = `
      <button
        class="guest-sign-in-trigger"
        type="button"
        aria-expanded="false"
        aria-haspopup="true"
        aria-label="Sign in or create an account"
      >
        <span class="guest-sign-in-mark" aria-hidden="true">
          <i class="fa-solid fa-user"></i>
          <span class="guest-sign-in-status"></span>
        </span>
        <span class="guest-sign-in-copy">
          <span class="guest-sign-in-kicker">Guest access</span>
          <span class="guest-sign-in-label">Sign In</span>
        </span>
        <i class="fa-solid fa-chevron-down guest-sign-in-chevron" aria-hidden="true"></i>
      </button>
    `;
    userProfileBtn.classList.add("guest-profile-host");

    const guestTrigger = userProfileBtn.querySelector(
      ".guest-sign-in-trigger",
    );

    const guestDropdown = document.createElement("div");
    guestDropdown.className = "profile-popup guest-profile-popup";
    guestDropdown.id = "guestProfilePopup";
    guestDropdown.setAttribute("aria-hidden", "true");
    guestDropdown.innerHTML = `
      <div class="popup-header guest-popup-header">
        <div class="popup-profile-row">
          <span class="popup-profile-icon guest-popup-icon" aria-hidden="true">
            <i class="fa-solid fa-user-shield"></i>
          </span>
          <div class="popup-profile-meta guest-popup-meta">
            <span class="guest-popup-eyebrow">Customer portal</span>
            <p class="popup-identity">Welcome to UCN-FMRC</p>
          </div>
        </div>
      </div>
      <p class="guest-popup-copy">Sign in for a smoother visit and keep your FMRC activity in one secure place.</p>
      <div class="guest-popup-benefits" aria-label="Customer account benefits">
        <span><i class="fa-solid fa-circle-check" aria-hidden="true"></i> Track orders</span>
        <span><i class="fa-solid fa-circle-check" aria-hidden="true"></i> Manage appointments</span>
      </div>
      <div class="guest-auth-stack">
        <a href="../customer-auth/auth.html#login" class="guest-auth-btn guest-auth-login">
          <span>Sign In</span>
          <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
        </a>
        <div class="guest-auth-separator"><span>New to FMRC?</span></div>
        <a href="../customer-auth/auth.html#signup" class="guest-auth-btn guest-auth-signup">
          <span>Create Account</span>
          <i class="fa-solid fa-user-plus" aria-hidden="true"></i>
        </a>
      </div>
    `;

    guestTrigger?.setAttribute("aria-controls", guestDropdown.id);
    userProfileBtn.appendChild(guestDropdown);

    const closeGuestDropdown = ({ restoreFocus = false } = {}) => {
      hideDropdown(guestDropdown);
      guestTrigger?.classList.remove("is-open");
      guestTrigger?.setAttribute("aria-expanded", "false");
      guestDropdown.setAttribute("aria-hidden", "true");
      if (restoreFocus) guestTrigger?.focus();
    };

    const openGuestDropdown = () => {
      guestDropdown.classList.remove("is-closing");
      guestDropdown.classList.add("show");
      guestTrigger?.classList.add("is-open");
      guestTrigger?.setAttribute("aria-expanded", "true");
      guestDropdown.setAttribute("aria-hidden", "false");
    };

    guestTrigger?.addEventListener("click", () => {
      if (guestDropdown.classList.contains("show")) {
        closeGuestDropdown();
      } else {
        openGuestDropdown();
      }
    });

    guestTrigger?.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeGuestDropdown();
    });

    guestDropdown.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeGuestDropdown({ restoreFocus: true });
    });

    document.addEventListener("click", (event) => {
      if (!userProfileBtn.contains(event.target)) {
        closeGuestDropdown();
      }
    });

    return;
  }

  const initial = (userInfo.username || userInfo.name || userInfo.email || "U")
    .trim()
    .charAt(0)
    .toUpperCase();
  const profileIdentity =
    String(
      userInfo.username || userInfo.name || userInfo.email || "User",
    ).trim() || "User";
  const profileIdentityLength = Array.from(profileIdentity).length;
  const profileIdentitySizeClass =
    profileIdentityLength > 38
      ? " is-very-long"
      : profileIdentityLength > 24
        ? " is-long"
        : "";

  userProfileBtn.innerHTML = `<span class="user-initial-badge">${initial}</span>`;
  userProfileBtn.classList.add("nav-profile-btn");

  const dropdown = document.createElement("div");
  dropdown.className = "profile-popup";
  dropdown.innerHTML = `
    <div class="popup-header">
      <div class="popup-profile-row">
        <span class="popup-profile-icon profile-initial">${initial}</span>
        <div class="popup-profile-meta">
          <p class="popup-identity${profileIdentitySizeClass}"></p>
        </div>
      </div>
    </div>
    <a href="#" id="viewProfileBtn" class="profile-popup-link">
      <i class="fa-regular fa-id-card"></i> My Account
    </a>
    <a href="#" id="viewOrdersBtn" class="profile-popup-link">
      <i class="fa-solid fa-box-archive"></i> My Orders
    </a>
    <hr />
    <button type="button" id="logoutBtn" class="logout-btn popup-logout" style="border: none; font-family: inherit;">
      <i class="fa-solid fa-right-from-bracket"></i> Logout
    </button>
  `;

  const profileIdentityElement = dropdown.querySelector(".popup-identity");
  if (profileIdentityElement) {
    profileIdentityElement.textContent = profileIdentity;
  }

  userProfileBtn.appendChild(dropdown);

  userProfileBtn.addEventListener("click", (event) => {
    // If we click inside the popup (but not the main button itself), do nothing
    if (event.target.closest(".profile-popup")) return;

    if (dropdown.classList.contains("show")) {
      hideDropdown(dropdown);
    } else {
      dropdown.classList.add("show");
    }
  });

  document.addEventListener("click", (event) => {
    if (!userProfileBtn.contains(event.target)) {
      hideDropdown(dropdown);
    }
  });

  dropdown.querySelector("#viewProfileBtn")?.addEventListener("click", () => {
    hideDropdown(dropdown);
    openProfileModal(userInfo, token);
  });

  dropdown
    .querySelector("#viewOrdersBtn")
    ?.addEventListener("click", (event) => {
      event.preventDefault();
      hideDropdown(dropdown);
      openOrdersModal(userInfo);
    });

  // Only the saved server flags determine whether this reminder is shown.
  // A Gmail address alone never means that the customer used Google sign-in.
  const showGooglePasswordTip = () => {
    const isGoogleUser = userInfo.signed_with_google === true;
    const isPasswordSet = hasCustomerSetPassword(userInfo);
    const isPromptDismissed = sessionStorage.getItem("google_pwd_prompt_dismissed") === "true";

    if (!isGoogleUser || isPasswordSet || isPromptDismissed) return;

    setTimeout(() => {
      const existingPrompt = document.getElementById("googlePwdFloatingCard");
      if (existingPrompt) return;

      const floatingCard = document.createElement("div");
      // `ux-dlg` on the root is purely the token unlock — bare `.ux-dlg` has no
      // rules of its own, so an anchored popover can share the dialog system's
      // radius, header band and footer strip without inheriting a modal's fixed
      // positioning. The card, head, body and foot then match the profile
      // dropdown directly above it part for part.
      floatingCard.className = "google-pwd-floating-card ux-dlg";
      floatingCard.id = "googlePwdFloatingCard";
      floatingCard.setAttribute("role", "dialog");
      floatingCard.setAttribute("aria-label", "Account tip");
      floatingCard.innerHTML = `
        <div class="google-pwd-card ux-dlg__card">
          <div class="google-pwd-card-header ux-dlg__head">
            <button type="button" class="google-pwd-close-btn ux-dlg__close" id="closeGooglePwdCard" aria-label="Dismiss">&times;</button>
            <span class="google-pwd-badge ux-dlg__badge" aria-hidden="true"><i class="fa-solid fa-key"></i></span>
            <p class="ux-dlg__eyebrow">Account Tip</p>
            <h3 class="ux-dlg__title">Create a password first!</h3>
          </div>
          <div class="ux-dlg__body">
            <p class="google-pwd-text ux-dlg__text">
              You signed in with Google. Set a password in My Account so you can
              also log in anytime using your username or Gmail.
            </p>
          </div>
          <div class="ux-dlg__foot is-confirm">
            <button type="button" class="ux-dlg__btn ux-dlg__btn--ghost" id="dismissPwdTipBtn">Not now</button>
            <button type="button" class="ux-dlg__btn ux-dlg__btn--primary" id="openPwdFromFloatingCard">
              <span>Set Password</span> <i class="fa-solid fa-arrow-right"></i>
            </button>
          </div>
        </div>
      `;

      userProfileBtn.style.position = "relative";
      userProfileBtn.appendChild(floatingCard);

      const dismissTip = (e) => {
        e.stopPropagation();
        sessionStorage.setItem("google_pwd_prompt_dismissed", "true");
        floatingCard.classList.add("fade-out");
        setTimeout(() => floatingCard.remove(), 300);
      };

      // The × and "Not now" are the same action, so they share the same path.
      floatingCard
        .querySelector("#closeGooglePwdCard")
        ?.addEventListener("click", dismissTip);
      floatingCard
        .querySelector("#dismissPwdTipBtn")
        ?.addEventListener("click", dismissTip);

      floatingCard.querySelector("#openPwdFromFloatingCard")?.addEventListener("click", (e) => {
        e.stopPropagation();
        floatingCard.classList.add("fade-out");
        setTimeout(() => floatingCard.remove(), 300);
        hideDropdown(dropdown);
        openChangePasswordModal(userInfo, token);
      });
    }, 1200);
  };

  const refreshGooglePasswordState = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/customer/profile`, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = await response.json().catch(() => ({}));
      const savedState = payload?.data;

      if (response.ok && savedState) {
        if (typeof savedState.signed_with_google === "boolean") {
          userInfo.signed_with_google = savedState.signed_with_google;
        }
        if (typeof savedState.has_custom_password === "boolean") {
          userInfo.has_custom_password = savedState.has_custom_password;
        }

        localStorage.setItem("customer_info", JSON.stringify({
          ...userInfo,
          signed_with_google: userInfo.signed_with_google === true,
          has_custom_password: userInfo.has_custom_password === true,
        }));
      }
    } catch {
      // The saved sign-in response remains a safe fallback while offline.
    }

    showGooglePasswordTip();
  };

  void refreshGooglePasswordState();

  // Kept outside the builder so a second logout always runs the newest
  // callback instead of the closure captured when the dialog was created.
  let pendingLogoutConfirm = null;

  const showLogoutConfirmModal = (onConfirm) => {
    pendingLogoutConfirm = typeof onConfirm === "function" ? onConfirm : null;
    let modal = document.getElementById("laravelLogoutModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "laravelLogoutModal";
      modal.className = "ux-dlg ux-dlg--standalone";
      modal.innerHTML = `
        <div class="ux-dlg__backdrop"></div>
        <div class="ux-dlg__card" role="dialog" aria-modal="true" aria-labelledby="laravelLogoutTitle">
          <div class="ux-dlg__head">
            <span class="ux-dlg__badge" aria-hidden="true"><i class="fa-solid fa-right-from-bracket"></i></span>
            <p class="ux-dlg__eyebrow">Account session</p>
            <h2 class="ux-dlg__title" id="laravelLogoutTitle">Confirm Logout</h2>
          </div>
          <div class="ux-dlg__body">
            <p class="ux-dlg__text">Are you sure you want to log out from your account? You will need to sign in again to access the portal.</p>
          </div>
          <div class="ux-dlg__foot is-confirm">
            <button id="cancelLogoutBtn" type="button" class="ux-dlg__btn ux-dlg__btn--ghost">Cancel</button>
            <button id="confirmLogoutBtn" type="button" class="ux-dlg__btn ux-dlg__btn--danger">Log Out</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      const closeLogoutModal = () => {
        modal.classList.remove("show");
        window.setTimeout(() => {
          if (!modal.classList.contains("show")) modal.style.display = "none";
        }, 220);
      };

      const dismiss = () => {
        pendingLogoutConfirm = null;
        closeLogoutModal();
      };

      modal.querySelector("#cancelLogoutBtn")?.addEventListener("click", dismiss);
      // Modal: the backdrop is inert, Cancel / Log Out are the only exits.
      modal
        .querySelector("#confirmLogoutBtn")
        ?.addEventListener("click", () => {
          const run = pendingLogoutConfirm;
          pendingLogoutConfirm = null;
          closeLogoutModal();
          window.setTimeout(() => {
            if (run) run();
          }, 180);
        });
      document.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape" && modal.classList.contains("show")) dismiss();
      });
    }

    modal.style.display = "flex";
    // A short delay (instead of rAF, which never fires on hidden documents)
    // guarantees the open transition runs from the closed state.
    window.setTimeout(() => modal.classList.add("show"), 12);
    window.setTimeout(() => modal.querySelector("#cancelLogoutBtn")?.focus(), 60);
  };

  dropdown.querySelector("#logoutBtn")?.addEventListener("click", async () => {
    hideDropdown(dropdown);
    showLogoutConfirmModal(async () => {
      hideStatus();
      /* The customer portal's last white-scrim spinner used to be raised here.
         It is the same curtain as the rest of the site now, so signing out
         looks like signing in. */
      window.FMRCLoader?.show("Signing you out");
      try {
        await fetch(`${API_BASE_URL}/logout`, {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            Accept: "application/json",
          },
        });
      } catch {
        // Token cleanup should still happen locally.
      } finally {
        localStorage.removeItem("customer_token");
        localStorage.removeItem("customer_info");
        /* Deliberately no hide here. The sign-in page raises this same curtain
           while it boots, so leaving it up hands the wait straight over instead
           of flashing a logged-out copy of this page for a frame or two. If the
           visitor comes Back later the browser restores this page from the
           bfcache, and fmrc-loader.js clears the curtain on `pageshow`. */
        showStatus("Logged out successfully.");
        window.location.href = "../customer-auth/auth.html";
      }
    });
  });
})();

// ============================================================================
// DYNAMIC SITE CONTENT LOADER
// ============================================================================
(function () {
  "use strict";

  const _API = (function () {
    if (typeof API_BASE_URL !== "undefined") return API_BASE_URL;
    return "http://127.0.0.1:8000/api";
  })();

  function _txt(id, val) {
    const el = document.getElementById(id);
    if (el && val) el.textContent = val;
  }
  function _html(id, val) {
    const el = document.getElementById(id);
    if (el && val) el.innerHTML = val;
  }
  function _src(id, val) {
    const el = document.getElementById(id);
    // Skip identical writes so a realtime re-apply never re-decodes the image.
    if (el && val && el.getAttribute("src") !== val) el.src = val;
  }
  /**
   * Uploadable brand logo. Unlike _src this handles the cleared case: when the
   * setting is blank the element goes back to the artwork the page ships with,
   * so an admin pressing "Default" reverts every customer page in realtime
   * instead of leaving the last upload frozen on screen.
   */
  function _logo(id, val, fallback) {
    const el = document.getElementById(id);
    if (!el) return;
    const next = val && String(val).trim() ? val : fallback;
    if (next && el.getAttribute("src") !== next) el.src = next;
  }
  function _esc(str) {
    const d = document.createElement("div");
    d.textContent = str || "";
    return d.innerHTML;
  }
  function _attr(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  let _settingsSnapshot = "";
  let _servicesSnapshot = "";

  async function loadSiteContent() {
    try {
      await Promise.all([reloadSettings(), reloadServices(), loadSdgs()]);
    } catch {
      /* silent fallback */
    }
  }

  /**
   * Re-read /services and repaint the home page's offer carousel. Split out of
   * loadSiteContent() so the realtime tick can call it too: before this the
   * realtime path re-read settings and badges but never services, so a service
   * saved or deleted in Website Management → Services stayed on an open customer
   * tab until someone reloaded it by hand — even though the delete dialog there
   * says the service is "removed from both Services and Home pages".
   *
   * The body comparison is not an optimisation, it is what makes this safe to
   * put on a 20 s timer: applyServices() replaces the whole track with
   * `innerHTML` and re-runs initCarousel(), so repainting an unchanged list
   * would snap a visitor back to the first slide every 20 s and re-arm the
   * autoplay interval. Unchanged payload, no DOM work, no listeners rebuilt.
   *
   * The Services page fetches and renders its own grid, so it is skipped here
   * exactly as it was on boot.
   */
  async function reloadServices() {
    if (document.body.classList.contains("services-page-body")) return;
    try {
      const res = await fetch(_API + "/services");
      if (!res.ok) return;
      const text = await res.text();
      if (text === _servicesSnapshot) return;
      _servicesSnapshot = text;
      applyServices(JSON.parse(text).data || []);
    } catch {
      /* offline — keep what is already on screen */
    }
  }

  /**
   * Realtime re-read of /site-settings. The endpoint answers with an ETag and
   * `no-cache, must-revalidate`, so the browser revalidates on its own and an
   * unchanged snapshot costs a zero-byte 304 on the wire. Comparing the raw
   * body then skips the DOM work when nothing actually changed.
   */
  async function reloadSettings() {
    try {
      const res = await fetch(_API + "/site-settings");
      if (!res.ok) return;
      const text = await res.text();
      if (text === _settingsSnapshot) return;
      _settingsSnapshot = text;
      applySettings(JSON.parse(text).data || {});
    } catch {
      /* offline — keep what is already on screen */
    }
  }

  function applySettings(s) {
    // Hero title. The markup ships empty, so this is the only place the wording
    // comes from; hero-title.js also keeps the snapshot the next load paints
    // from before its first frame. A blank setting clears both, so removing the
    // headline in the admin removes it here too instead of freezing stale text.
    const heroTitleEl = document.getElementById("heroTitleEl");
    if (window.FMRC_HERO_TITLE) {
      window.FMRC_HERO_TITLE.paint(heroTitleEl, s.hero_title);
      window.FMRC_HERO_TITLE.write(s.hero_title);
    }
    // Brand logos — the navbar emblem and the two footer marks live on every
    // customer page, the hero graphic only on the home page. Each falls back to
    // the bundled artwork when its setting is blank.
    _logo("navLogoEl", s.nav_logo_image, "/images/CNSC logo.png");
    _logo("heroLogoEl", s.hero_logo_image, "/images/FMRC Logo.png");
    _logo(
      "footerLogoPrimaryEl",
      s.footer_logo_primary_image,
      "/images/CNSC logo.png",
    );
    _logo(
      "footerLogoSecondaryEl",
      s.footer_logo_secondary_image,
      "/images/FMRC Logo.png",
    );
    // Hero background. One shorthand write per apply: the shorthand resets the
    // size/position/repeat longhands too, so switching type never leaves the
    // previous type's remnants behind. An unknown type clears the inline style
    // and hands the hero back to the stylesheet's own gradient.
    applyHeroBackground(s);
    // Hero SDG caption (blank hides the line entirely)
    applySdgCaption(s);
    // About
    _txt("aboutHeadingEl", s.about_heading);
    _html("aboutText1El", s.about_text_1);
    _html("aboutText2El", s.about_text_2);
    if (s.about_video_url) {
      ["aboutVideoSrc", "aboutFullVideoSrc"].forEach(function (id) {
        const src = document.getElementById(id);
        // Only reload when the URL actually changed, so a realtime re-apply
        // cannot restart a video the visitor is already watching.
        if (src && src.getAttribute("src") !== s.about_video_url) {
          src.src = s.about_video_url;
          src.parentElement &&
            src.parentElement.load &&
            src.parentElement.load();
        }
      });
    }
    // Vision / Mission
    _txt("visionHeadingEl", s.vision_heading);
    _txt("visionTextEl", s.vision_text);
    if (s.vision_image) _src("visionImgEl", s.vision_image);
    _txt("missionHeadingEl", s.mission_heading);
    _txt("missionTextEl", s.mission_text);
    if (s.mission_image) _src("missionImgEl", s.mission_image);
    // Galleries go on *after* the legacy single images, so a configured gallery
    // wins and an unconfigured site is left exactly as it was.
    applyVmGallery("vision", s.vision_gallery);
    applyVmGallery("mission", s.mission_gallery);
    // The only path where no `src` is ever written: with neither a single image
    // nor a gallery there is no `load` event coming, so settle the placeholder
    // here instead of letting the 8s timeout do it.
    ["vision", "mission"].forEach(function (k) {
      var hasGallery = vmParseGallery(s[k + "_gallery"]).length > 0;
      if (!s[k + "_image"] && !hasGallery) vmPhotoSettle(k, "empty");
    });
    // Footer
    _txt("footerBrandNameEl", s.footer_brand_name);
    _txt("footerBrandDescEl", s.footer_brand_desc);
    _txt("footerHoursDaysEl", s.footer_hours_days);
    _txt("footerHoursTimeEl", s.footer_hours_time);
    _txt("footerCopyrightEl", s.footer_copyright);
    if (s.footer_quick_links) {
      try {
        var links = JSON.parse(s.footer_quick_links);
        var ul = document.getElementById("footerQuickLinksEl");
        if (ul && links.length)
          ul.innerHTML = links
            .map(function (l) {
              return (
                '<li><a href="' +
                _attr(l.url || "#") +
                '">' +
                _esc(l.label || "") +
                "</a></li>"
              );
            })
            .join("");
      } catch (e) {}
    }
    var fLoc = document.getElementById("footerLocationLink");
    if (fLoc) {
      if (s.footer_contact_location)
        fLoc.textContent = s.footer_contact_location;
      if (s.footer_contact_location_url)
        fLoc.href = s.footer_contact_location_url;
    }
    var fEmail = document.getElementById("footerEmailLink");
    if (fEmail && s.footer_contact_email) {
      fEmail.textContent = s.footer_contact_email;
      fEmail.href = "mailto:" + s.footer_contact_email;
    }
    var fPhone = document.getElementById("footerPhoneLink");
    if (fPhone && s.footer_contact_phone) {
      fPhone.textContent = s.footer_contact_phone;
      fPhone.href = "tel:" + s.footer_contact_phone.replace(/[\s-]/g, "");
    }
    var fFb = document.getElementById("footerFacebookLink");
    if (fFb) {
      if (s.footer_contact_facebook)
        fFb.textContent = s.footer_contact_facebook;
      if (s.footer_contact_facebook_url)
        fFb.href = s.footer_contact_facebook_url;
    }
    // Contact page
    _txt("contactTitleEl", s.contact_heading);
    _txt("contactLeadEl", s.contact_lead);
    var cLoc = document.getElementById("contactLocationLink");
    if (cLoc) {
      if (s.contact_location) cLoc.textContent = s.contact_location;
      if (s.contact_location_url) cLoc.href = s.contact_location_url;
    }
    var cEmail = document.getElementById("contactEmailLink");
    if (cEmail && s.contact_email) {
      cEmail.textContent = s.contact_email;
      cEmail.href = "mailto:" + s.contact_email;
    }
    var cPhone = document.getElementById("contactPhoneLink");
    if (cPhone && s.contact_phone) {
      cPhone.textContent = s.contact_phone;
      cPhone.href = "tel:" + s.contact_phone.replace(/[\s-]/g, "");
    }
    var cFb = document.getElementById("contactFacebookLink");
    if (cFb) {
      if (s.contact_facebook) cFb.textContent = s.contact_facebook;
      if (s.contact_facebook_url) cFb.href = s.contact_facebook_url;
    }
    _txt("contactFormHeadingEl", s.contact_form_heading);
    _txt("contactFormSubtitleEl", s.contact_form_subtitle);
    _txt(
      "contactConsentTextEl",
      s.contact_consent_text ||
        "I hereby consent to the collection, processing, and storage of my personal information in accordance with the Data Privacy Act of 2012 (R.A. 10173).",
    );
    // GCash collection details for the checkout. The checkout modal lives in a
    // different IIFE, so the values are published on window and announced
    // instead of being written into the DOM here.
    publishGcashSettings(s);
    // Announcement / promotion theme — same reason: customer-announcements.js
    // owns the pop-up and the product-page promotion card from its own IIFE.
    publishPromotionTheme(s);
  }

  /**
   * Hand the three GCash fields the customer needs to pay to whichever page has
   * a checkout. Announced only when something actually changed, so the poller's
   * unchanged responses do not repaint an open panel on every tick.
   */
  function publishGcashSettings(s) {
    var next = {
      accountName: String(s.gcash_account_name || "").trim(),
      accountNumber: String(s.gcash_account_number || "").trim(),
      qrImage: String(s.gcash_qr_image || "").trim(),
    };
    var previous = window.FMRC_GCASH_SETTINGS;
    window.FMRC_GCASH_SETTINGS = next;
    if (
      previous &&
      previous.accountName === next.accountName &&
      previous.accountNumber === next.accountNumber &&
      previous.qrImage === next.qrImage
    ) {
      return;
    }
    document.dispatchEvent(
      new CustomEvent("fmrc:gcash-settings", { detail: next }),
    );
  }

  /**
   * One theme drives both the announcement pop-up and the promotion card in the
   * product page header, so the admin sets the colours once. Blank is a real
   * choice for the two emojis and the label — an admin who clears them wants
   * them gone — while a setting that was never saved falls back to the wording
   * the pages ship with, leaving an untouched site looking exactly as before.
   */
  function publishPromotionTheme(s) {
    var hex = function (value, fallback) {
      return /^#[0-9a-fA-F]{3,8}$/.test(String(value || ""))
        ? String(value)
        : fallback;
    };
    // Clamp by code point, not by length: one emoji is a single glyph but two
    // UTF-16 units, so slicing a string would cut it in half.
    var clamp = function (value, fallback, limit) {
      if (typeof value !== "string") return fallback;
      return Array.from(value.trim()).slice(0, limit).join("");
    };
    var next = {
      primary: hex(s.announcement_theme_primary, "#c0392b"),
      secondary: hex(s.announcement_theme_secondary, "#800000"),
      emojiLeft: clamp(s.promo_spotlight_emoji_left, "🎉", 4),
      emojiRight: clamp(s.promo_spotlight_emoji_right, "🎉", 4),
      eyebrow: clamp(s.promo_spotlight_eyebrow, "LIMITED-TIME PROMOTION", 48),
      // Whether a colour was really saved, as opposed to defaulted above. The
      // announcement pop-up wears the shared `ux-dlg` maroon band until an
      // admin picks a theme, so it needs to tell the two apart.
      explicit:
        /^#[0-9a-fA-F]{3,8}$/.test(String(s.announcement_theme_primary || "")) ||
        /^#[0-9a-fA-F]{3,8}$/.test(
          String(s.announcement_theme_secondary || ""),
        ),
    };
    var previous = window.FMRC_PROMO_THEME;
    window.FMRC_PROMO_THEME = next;
    if (
      previous &&
      previous.primary === next.primary &&
      previous.secondary === next.secondary &&
      previous.explicit === next.explicit &&
      previous.emojiLeft === next.emojiLeft &&
      previous.emojiRight === next.emojiRight &&
      previous.eyebrow === next.eyebrow
    ) {
      return;
    }
    document.dispatchEvent(
      new CustomEvent("fmrc:promotion-theme", { detail: next }),
    );
  }

  /**
   * Hero background for the three modes the admin picker offers. Always one
   * `background` shorthand write, so switching mode drops the longhands the
   * previous mode set instead of layering a colour under an old image.
   */
  function applyHeroBackground(s) {
    const heroSec = document.querySelector(".hero-section");
    if (!heroSec) return;
    const type = s.hero_bg_type || "";
    if (type === "gradient") {
      // hero-gradients.js is the one source both this page and the admin
      // swatches read, so a preset cannot render differently in the two.
      const G = window.FMRC_HERO_GRADIENTS;
      heroSec.style.background = G ? G.css(s.hero_bg_gradient) : "";
      return;
    }
    if (type === "color" && s.hero_bg_color) {
      heroSec.style.background = s.hero_bg_color;
      return;
    }
    if (type === "image" && s.hero_bg_image) {
      heroSec.style.background =
        "url('" + s.hero_bg_image + "') center center / cover no-repeat";
      return;
    }
    // Nothing chosen (or the chosen mode has no value yet) — hand the hero back
    // to the gradient in the stylesheet.
    heroSec.style.background = "";
  }

  function applyServices(services) {
    // Home carousel
    var track = document.getElementById("whatWeOfferTrack");
    if (track && services.length) {
      track.innerHTML = services
        .map(function (s) {
          return (
            '<div class="carousel-item"><div class="service-card landscape-card" data-service-id="' +
            s.id +
            '" data-category="' +
            _attr(s.category || "") +
            '">' +
            // The holder doubles as the lightbox trigger so the offer artwork
            // behaves exactly like the Services page's: zoom-in cursor, the same
            // 1.05 hover, and a click that opens the shared viewer. No Preview
            // pill here by design, so the scrim that exists to make that pill
            // legible is switched off in CSS as well.
            '<div class="card-img-holder' +
            (s.image_data ? " service-image-trigger" : "") +
            '"' +
            (s.image_data
              ? ' role="button" tabindex="0" title="Open image preview"' +
                ' aria-label="Open full-size preview of ' +
                _attr(s.title) +
                '" data-image-src="' +
                _attr(s.image_data) +
                '" data-image-title="' +
                _attr(s.title) +
                '"'
              : "") +
            ">" +
            (s.image_data
              ? '<img src="' +
                _attr(s.image_data) +
                '" alt="' +
                _attr(s.title) +
                '" />'
              : '<div style="width:100%;height:100%;background:#f3f4f6;display:flex;align-items:center;justify-content:center;"><span style="color:#9ca3af;font-size:.78rem;">No image</span></div>') +
            "</div>" +
            '<div class="card-content"><h3 class="card-title">' +
            _esc(s.title) +
            '</h3><p class="card-desc">' +
            _esc(s.description || "") +
            "</p></div>" +
            "</div></div>"
          );
        })
        .join("");
      initCarousel(track);
    }
    // Services page grid
    var grid = document.getElementById("servicesGrid");
    // services-page/services.js owns this grid so it can show its skeleton
    // until the realtime API response arrives. Keep the shared loader focused
    // on the homepage carousel here.
    if (
      grid &&
      services.length &&
      !document.body.classList.contains("services-page-body")
    ) {
      grid.innerHTML = services
        .map(function (s, index) {
          var title = s.title || "FMRC Service";
          var category = s.category || "FMRC Service";
          var image = s.image_data || "";
          var serviceNumber = String(index + 1).padStart(2, "0");
          var imageMarkup = image
            ? '<button class="service-image-trigger" type="button" aria-label="Open full-size preview of ' +
              _attr(title) +
              '" title="Open image preview" data-image-src="' +
              _attr(image) +
              '" data-image-title="' +
              _attr(title) +
              '"><img src="' +
              _attr(image) +
              '" alt="' +
              _attr(title) +
              ' preview" loading="lazy" /><span class="service-image-preview-label"><i class="fa-solid fa-expand" aria-hidden="true"></i> Preview</span></button>'
            : '<div class="service-image-placeholder"><span class="service-image-placeholder__content"><i class="fa-regular fa-image" aria-hidden="true"></i><span>Image coming soon</span></span></div>';
          return (
            '<article class="service-card" data-category="' +
            _attr(category.toLowerCase().replace(/\s+/g, "-")) +
            '">' +
            imageMarkup +
            '<div class="card-content"><div class="service-card-heading"><span class="service-chip">' +
            _esc(category) +
            '</span><span class="service-index" aria-label="Service ' +
            serviceNumber +
            '">' +
            serviceNumber +
            '</span></div><h3 class="card-title">' +
            _esc(title) +
            '</h3><p class="card-desc">' +
            _esc(s.description || "") +
            '</p><div class="service-card-footer">' +
            '<button class="details-btn open-modal-btn" type="button" data-title="' +
            _attr(title) +
            '" data-desc="' +
            _attr(s.modal_description || s.description || "") +
            '" data-features="' +
            _attr(JSON.stringify(s.modal_features || [])) +
            '" data-materials="' +
            _attr(JSON.stringify(s.modal_materials || [])) +
            '" data-best-for="' +
            _attr(JSON.stringify(s.modal_best_for || [])) +
            '" data-img="' +
            _attr(image) +
            '"><span>View service details</span><i class="fa-solid fa-arrow-right" aria-hidden="true"></i></button></div>' +
            "</div></article>"
          );
        })
        .join("");
    }
  }

  // ── Hero SDG badge strip ──────────────────────────────────────────────────
  // Source of truth: GET /site-sdgs, managed from Website Management → Home in
  // both the admin and staff portals. main.js also loads on the products,
  // services and contact pages, so every branch is null-guarded on the strip.
  const SDG_MAX = 8;
  const SDG_CHANNEL = "fmrc-site-settings-realtime";
  const SDG_STAMP_KEY = "fmrc_site_content_updated_at";
  let _sdgSnapshot = "";
  let _sdgs = [];

  function applySdgCaption(s) {
    const cap = document.getElementById("heroSdgCaptionEl");
    if (!cap) return;
    const text = String(s.home_sdg_heading || "").trim();
    cap.textContent = text;
    cap.hidden = !text; // blank caption leaves no gap above the circles
  }

  async function loadSdgs() {
    if (!document.getElementById("heroSdgRows")) return;
    try {
      // Server sends ETag + no-cache, so the browser revalidates and an
      // unchanged snapshot is a zero-byte 304 on the wire. The body compare
      // below keeps the badges from re-animating when nothing changed.
      const res = await fetch(_API + "/site-sdgs");
      if (!res.ok) return;
      const text = await res.text();
      if (text === _sdgSnapshot) return;
      _sdgSnapshot = text;
      const { data } = JSON.parse(text);
      renderSdgs(Array.isArray(data) ? data : []);
    } catch {
      /* offline — keep whatever is already on screen */
    }
  }

  function renderSdgs(list) {
    const strip = document.getElementById("heroSdgStrip");
    const rows = document.getElementById("heroSdgRows");
    if (!strip || !rows) return;

    _sdgs = list
      .filter(function (s) {
        return s && s.image_data;
      })
      .slice(0, SDG_MAX);

    if (!_sdgs.length) {
      rows.innerHTML = "";
      strip.hidden = true; // nothing uploaded → hero keeps its original layout
      return;
    }

    // Two centered flex rows (1-4, 5-8) so a partial second row self-centers.
    const groups = [_sdgs.slice(0, 4), _sdgs.slice(4)].filter(function (g) {
      return g.length;
    });

    rows.innerHTML = groups
      .map(function (group, gi) {
        return (
          '<ul class="hero-sdg-row">' +
          group
            .map(function (s, ii) {
              const i = gi * 4 + ii;
              const label =
                String(s.title || "").trim() ||
                "Sustainable Development Goal " + (i + 1);
              return (
                '<li class="hero-sdg-item">' +
                '<button type="button" class="hero-sdg-btn" style="--sdg-i: ' +
                i +
                '" data-sdg-id="' +
                _attr(s.id) +
                '" aria-label="' +
                _attr(label) +
                '" title="' +
                _attr(label) +
                '"><img class="hero-sdg-img" src="' +
                _attr(s.image_data) +
                '" alt="' +
                _attr(label) +
                '" loading="lazy" decoding="async" /></button>' +
                "</li>"
              );
            })
            .join("") +
          "</ul>"
        );
      })
      .join("");
    strip.hidden = false;
  }
  /**
   * Detail modal, built on the same .admin-system-popup shell every other
   * customer dialog uses, so the chrome/typography match exactly.
   */
  function ensureSdgDetailModal() {
    let popup = document.getElementById("heroSdgDetailPopup");
    if (popup) return popup;

    popup = document.createElement("div");
    popup.id = "heroSdgDetailPopup";
    popup.className = "admin-system-popup ux-dlg";
    popup.innerHTML = `
      <div class="admin-system-popup__backdrop ux-dlg__backdrop"></div>
      <div class="admin-system-popup__card ux-dlg__card" role="dialog" aria-modal="true" aria-labelledby="heroSdgDetailTitle">
        <div class="ux-dlg__head ux-dlg__head--figure">
          <img id="heroSdgDetailImg" class="sdg-detail-modal__img ux-dlg__figure" alt="" />
          <p class="ux-dlg__eyebrow">Sustainable Development Goal</p>
          <h3 id="heroSdgDetailTitle" class="admin-system-popup__title ux-dlg__title"></h3>
        </div>
        <div class="ux-dlg__body">
          <p id="heroSdgDetailMessage" class="admin-system-popup__message ux-dlg__text"></p>
        </div>
        <div class="admin-system-popup__actions ux-dlg__foot">
          <button id="heroSdgDetailClose" type="button" class="btn-admin ux-dlg__btn ux-dlg__btn--primary">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(popup);

    const close = function () {
      popup.classList.remove("show");
    };
    popup.querySelector("#heroSdgDetailClose")?.addEventListener("click", close);
    // Modal: the scrim is inert, the in-card Close button is the way out.
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && popup.classList.contains("show")) close();
    });
    return popup;
  }
  function openSdgDetail(id) {
    const sdg = _sdgs.find(function (x) {
      return String(x.id) === String(id);
    });
    if (!sdg) return;

    const popup = ensureSdgDetailModal();
    const img = popup.querySelector("#heroSdgDetailImg");
    const title = popup.querySelector("#heroSdgDetailTitle");
    const msg = popup.querySelector("#heroSdgDetailMessage");
    const body = popup.querySelector(".ux-dlg__body");
    const label = String(sdg.title || "").trim() || "Sustainable Development Goal";
    const desc = String(sdg.description || "").trim();

    if (img) {
      img.src = sdg.image_data || "";
      img.alt = label;
    }
    if (title) title.textContent = label;
    if (msg) {
      msg.textContent = desc;
      msg.style.display = desc ? "" : "none";
    }
    // Collapse the whole body when there is no description to frame.
    if (body) body.style.display = desc ? "" : "none";

    popup.classList.add("show");
    popup.querySelector("#heroSdgDetailClose")?.focus();
  }
  let _sdgRefreshAt = 0;

  /** Re-read badges + settings, collapsing duplicate triggers. */
  function refreshSiteContentRealtime() {
    const now = Date.now();
    if (now - _sdgRefreshAt < 400) return;
    _sdgRefreshAt = now;
    void loadSdgs();
    void reloadSettings();
    // Services rides the same tick: the offer carousel on this page is built
    // from /services, so a save in Website Management → Services has to land
    // here too. reloadServices() no-ops on an unchanged payload, so this costs
    // one small conditional GET and never rebuilds the carousel needlessly.
    void reloadServices();
    // Maintenance Mode rides this pipeline instead of adding one of its own:
    // same channel, same storage stamp, same tick. The /api/maintenance ETag
    // makes the extra request a 304 whenever nothing has changed.
    void window.FMRC_MAINTENANCE?.refresh();
  }

  let _revisitRefreshAt = 0;

  /**
   * The "visitor came back to this tab" trigger. Same work as the function
   * above, on a longer floor: an OS window switch raises `focus` *and*
   * `visibilitychange`, and some browsers fire visibilitychange for their own
   * chrome, so the raw events arrive in bursts — each one otherwise re-reading
   * the whole settings snapshot, which is the largest payload on the site.
   *
   * A save is deliberately left on the 400 ms floor: the channel message and
   * the storage stamp still call refreshSiteContentRealtime() directly, so an
   * edit made in Website Management still appears here immediately. This floor
   * only throttles "make sure nothing changed while I was away", where five
   * seconds is imperceptible.
   */
  function refreshSiteContentOnRevisit() {
    const now = Date.now();
    if (now - _revisitRefreshAt < 5000) return;
    _revisitRefreshAt = now;
    refreshSiteContentRealtime();
  }

  function initSdgRealtime() {
    // The boot read counts as the first refresh. Without this, the very first
    // focus/visibilitychange after load — which browsers routinely raise while
    // the page is still settling — sails through the floor below and re-reads a
    // snapshot that is milliseconds old.
    _revisitRefreshAt = Date.now();

    // Badge clicks are home-page only — the rows exist nowhere else.
    const rows = document.getElementById("heroSdgRows");
    if (rows) {
      rows.addEventListener("click", function (ev) {
        const btn = ev.target?.closest?.("[data-sdg-id]");
        if (btn) openSdgDetail(btn.getAttribute("data-sdg-id"));
      });
    }

    // The listeners below are not: the navbar emblem, the footer marks and the
    // footer/contact copy are on every customer page, so each one has to hear a
    // settings change. Gating them on #heroSdgRows would leave Products,
    // Services and Contact showing the previous logo until a manual reload.

    // Same browser: admin/staff Website Management → Home broadcasts on save.
    try {
      if ("BroadcastChannel" in window) {
        new BroadcastChannel(SDG_CHANNEL).addEventListener(
          "message",
          function (ev) {
            const type = ev?.data?.type;
            if (type === "updated" || type === "sdgs-updated")
              refreshSiteContentRealtime();
          },
        );
      }
    } catch {
      /* BroadcastChannel unavailable — the storage + poll paths still work */
    }
    window.addEventListener("storage", function (ev) {
      if (ev.key === SDG_STAMP_KEY) refreshSiteContentRealtime();
    });

    // Across devices: ETag poll, so unchanged snapshots answer 304 (~0 bytes).
    setInterval(function () {
      if (!document.hidden) {
        void loadSdgs();
        void reloadSettings();
        void reloadServices();
        void window.FMRC_MAINTENANCE?.refresh();
      }
    }, 20000);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) refreshSiteContentOnRevisit();
    });
    window.addEventListener("focus", refreshSiteContentOnRevisit);
  }


  /* ==========================================================================
     VISION / MISSION IMAGE DECKS
     --------------------------------------------------------------------------
     Each section can be given a gallery of up to ten photos from the admin
     editor, stored as one JSON array of data URLs under a single site_settings
     key (`vision_gallery` / `mission_gallery`). Vision cards are dragged aside
     and vanish; Mission cards are clicked and shuffle to the back. Both loop
     forever — the card that leaves re-enters at the deepest slot.

     Two invariants hold the whole thing together:

     1. A section with nothing configured must render byte-identically to before
        the decks existed. Every stacking rule is gated behind `.has-stack`,
        which is only ever added when there are two or more photos.
     2. The first card is the original markup, reused rather than regenerated, so
        `id="visionImgEl"` / `id="missionImgEl"` and `.vision-img` /
        `.mission-img` survive and every rule already written against them keeps
        applying — including to the clones, which copy the class.
     ========================================================================== */
  var VM_DECK_MAX = 10;
  var vmDeckSnapshots = { vision: null, mission: null };

  function vmDeckEl(kind) {
    return document.getElementById(
      kind === "mission" ? "missionDeck" : "visionDeck",
    );
  }

  function vmReducedMotion() {
    return !!(
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  // Tolerant on purpose: the key is absent on every site that has never opened
  // the editor, and a hand-edited row could hold anything at all.
  function vmParseGallery(raw) {
    if (!raw) return [];
    var list = raw;
    if (typeof raw === "string") {
      try {
        list = JSON.parse(raw);
      } catch (err) {
        return [];
      }
    }
    if (!Array.isArray(list)) return [];
    return list
      .filter(function (src) {
        return typeof src === "string" && src.trim() !== "";
      })
      .slice(0, VM_DECK_MAX);
  }

  /* Which card sits in which slot is a number on the deck, not the order of the
     nodes: moving a node inside its parent re-inserts it, and every browser
     restarts a running transition when that happens. So the cards stay exactly
     where the applier put them for the life of the page and only `data-slot`
     rotates. A card marked flying is skipped — it is being positioned inline by
     the gesture and must not be yanked back into a slot mid-flight. */
  function vmIndexSlots(deck) {
    var cards = Array.prototype.slice.call(
      deck.querySelectorAll(".vm-deck__card"),
    );
    var total = cards.length;
    if (!total) return;
    var offset = parseInt(deck.dataset.vmOffset || "0", 10) || 0;
    cards.forEach(function (card, i) {
      if (card.dataset.vmFlying === "1") {
        card.setAttribute("data-slot", "flying");
        return;
      }
      var pos = (((i - offset) % total) + total) % total;
      card.setAttribute("data-slot", pos < 3 ? String(pos) : "hidden");
      // Only the card on top is reachable, by pointer or by keyboard: the ones
      // behind are decoration until they get promoted.
      if (pos === 0) {
        card.setAttribute("role", "button");
        card.setAttribute("tabindex", "0");
        card.setAttribute("aria-label", deck.dataset.vmLabel || "");
      } else {
        card.removeAttribute("role");
        card.removeAttribute("tabindex");
        card.removeAttribute("aria-label");
      }
    });
  }

  function vmAdvance(deck) {
    var total = deck.querySelectorAll(".vm-deck__card").length || 1;
    var offset = parseInt(deck.dataset.vmOffset || "0", 10) || 0;
    deck.dataset.vmOffset = String((offset + 1) % total);
    vmIndexSlots(deck);
  }

  /* Raise the whole section while a card is off the stack.
     Vision and Mission are positioned siblings with no z-index, so Mission wins
     on document order and a card thrown downwards used to slide *under* it. The
     card cannot lift itself out — `.vision-content-left` is a stacking context —
     so the section is raised instead, and only for the length of the gesture.
     See `.vision-section.vm-card-aloft` in main.css for the z-index chosen. */
  function vmAloft(deck, on) {
    if (!deck || !deck.closest) return;
    var host = deck.closest(".vision-section, .mission-section");
    if (host) host.classList.toggle("vm-card-aloft", !!on);
  }

  /* -- First-paint placeholder ----------------------------------------------
     Both photos are admin uploads living as base64 in site_settings, so there is
     nothing to paint until /api/site-settings answers. The markup therefore
     ships its <img> with no `src` and the deck wearing `.is-loading`, which
     draws a grey card the exact shape of the photo it stands in for; a
     hardcoded /images/pic1.jpg used to flash on every single load instead.

     Two settled states, both `.is-empty`: nothing configured, and an image that
     failed to decode. Either way the section keeps a neutral card rather than a
     hole where a photo should be. */
  function vmPhotoSettle(kind, state) {
    var deck = vmDeckEl(kind);
    if (!deck) return;
    deck.classList.remove("is-loading");
    deck.classList.toggle("is-empty", state === "empty");
    // aria-busy is only meaningful while the deck is still waiting.
    deck.removeAttribute("aria-busy");
  }

  function initVmPhotoPlaceholder(kind) {
    var deck = vmDeckEl(kind);
    if (!deck) return;
    var img = deck.querySelector(".vm-deck__card img");
    if (!img) return;
    // `load` fires again for every later src, so a realtime photo swap re-shows
    // the placeholder for exactly as long as the new image takes to decode.
    img.addEventListener("load", function () {
      vmPhotoSettle(kind, "");
    });
    img.addEventListener("error", function () {
      vmPhotoSettle(kind, "empty");
    });
    // Already decoded before this ran (a warm cache beats the listener).
    if (img.getAttribute("src") && img.complete && img.naturalWidth) {
      vmPhotoSettle(kind, "");
      return;
    }
    // Never wait forever: an API that never answers settles to the neutral card
    // rather than leaving a placeholder on screen for the rest of the visit.
    setTimeout(function () {
      if (deck.classList.contains("is-loading")) vmPhotoSettle(kind, "empty");
    }, 8000);
  }

  // Drop every generated card, leaving the original markup untouched.
  function vmResetToFirstCard(deck) {
    var cards = Array.prototype.slice.call(
      deck.querySelectorAll(".vm-deck__card"),
    );
    cards.forEach(function (card, i) {
      if (i === 0) {
        card.removeAttribute("data-slot");
        card.removeAttribute("role");
        card.removeAttribute("tabindex");
        card.removeAttribute("aria-label");
        delete card.dataset.vmFlying;
        card.className = "vm-deck__card";
        card.style.transform = "";
        return;
      }
      card.remove();
    });
    deck.dataset.vmOffset = "0";
  }

  function applyVmGallery(kind, raw) {
    var deck = vmDeckEl(kind);
    if (!deck) return;
    var images = vmParseGallery(raw);

    // Never rebuild under the visitor's finger. Poll back shortly; the snapshot
    // below means the retry costs nothing once the gesture has finished.
    if (
      deck.querySelector(".is-dragging, .is-vanishing, .is-lifting, .is-tucking")
    ) {
      setTimeout(function () {
        applyVmGallery(kind, raw);
      }, 700);
      return;
    }

    // The gallery owns the top card whenever it holds anything, so a realtime
    // tick that only touched the legacy single image cannot leave the deck
    // showing a photo that is not part of it any more.
    if (images.length) {
      var lead = deck.querySelector(".vm-deck__card img");
      if (lead && lead.getAttribute("src") !== images[0]) lead.src = images[0];
    }

    // Rebuilding restarts the deck at card 1, so it has to happen only when the
    // gallery genuinely changed — not on every 20s poll.
    var snapshot = JSON.stringify(images);
    if (vmDeckSnapshots[kind] === snapshot) return;
    vmDeckSnapshots[kind] = snapshot;

    // Fewer than two photos is not a deck: hand the section back to its
    // original single-image rules.
    if (images.length < 2) {
      deck.classList.remove("has-stack", "is-peeking", "is-settling");
      vmResetToFirstCard(deck);
      return;
    }

    var first = deck.querySelector(".vm-deck__card");
    var template = first && first.querySelector("img");
    if (!template) return;
    vmResetToFirstCard(deck);

    var cls = template.className;
    var alt = template.getAttribute("alt") || "";
    for (var i = 1; i < images.length; i++) {
      var card = document.createElement("div");
      card.className = "vm-deck__card";
      var img = document.createElement("img");
      // Cloning the class is what gives every card the section's own shape and
      // sizing — Mission's organic border-radius, Vision's 12px and its shadow.
      if (cls) img.className = cls;
      img.setAttribute("alt", alt);
      img.setAttribute("draggable", "false");
      // Matches the markup's own first card. Without it a clone's decode runs on
      // the main thread, and the gallery photos are full-resolution admin
      // uploads carried as base64.
      img.setAttribute("decoding", "async");
      img.src = images[i];
      card.appendChild(img);
      deck.appendChild(card);
    }
    template.setAttribute("draggable", "false");

    deck.classList.add("has-stack");
    initVmDeck(deck, kind === "mission" ? "shuffle" : "drag");
    vmIndexSlots(deck);
    vmWarmDeckImages(deck);
  }

  /* Cards from slot 3 down sit at `opacity: 0`, and a browser does not raster a
     fully transparent layer — so a clone's first real decode happened when a
     throw promoted it into view, on the frames that can least afford it. That is
     the "sometimes" in the stutter: it costs tens of milliseconds once per
     photo, against an 8.3ms budget, and never again afterwards.

     `decode()` does that work off the critical path regardless of CSS
     visibility. Sequentially, not `Promise.all`, so ten large uploads cannot
     spike together; failures are ignored because a warm-up that did not happen
     is only the old behaviour. */
  function vmWarmDeckImages(deck) {
    var imgs = deck.querySelectorAll(".vm-deck__card img");
    if (!imgs.length) return;
    var i = 0;
    (function next() {
      if (i >= imgs.length) return;
      var img = imgs[i++];
      if (!img || typeof img.decode !== "function") {
        next();
        return;
      }
      img.decode().then(next, next);
    })();
  }

  function initVmDeck(deck, mode) {
    deck.dataset.vmLabel =
      mode === "shuffle"
        ? "Mission photo — press to send it to the back of the deck"
        : "Vision photo — drag it aside to reveal the next one";
    // The deck element itself outlives every rebuild, and both handlers are
    // delegated, so it is wired exactly once.
    if (deck.dataset.vmWired === "1") return;
    deck.dataset.vmWired = "1";
    if (mode === "shuffle") vmWireShuffle(deck);
    else vmWireDrag(deck);
  }

  /* -- Vision: press, drag, let go, vanish ----------------------------------
     Pointer Events only, so mouse, pen and touch all run the same path. */
  function vmWireDrag(deck) {
    var CLAIM_PX = 8;
    var active = null;
    var startX = 0;
    var startY = 0;
    var dx = 0;
    var dy = 0;
    var claimed = false;
    var busy = false;

    function focusTop() {
      var top = deck.querySelector('.vm-deck__card[data-slot="0"]');
      if (top) top.focus();
    }

    function land(card) {
      // One frame with transitions suppressed hands the card back to the slot
      // system without it flying home from wherever the throw left it. With four
      // or more photos it lands invisible; with exactly three it reappears in the
      // deepest slot, which by then has been empty for the length of the throw.
      deck.classList.add("is-settling");
      card.classList.remove("is-vanishing", "is-dragging");
      card.style.transform = "";
      card.style.opacity = "";
      card.style.filter = "";
      delete card.dataset.vmFlying;
      vmIndexSlots(deck);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          deck.classList.remove("is-settling");
          vmAloft(deck, false);
          busy = false;
        });
      });
    }

    function vanish(card, keyboard) {
      busy = true;
      var refocus = keyboard || deck.contains(document.activeElement);
      // Also covers the keyboard path, where no pointerdown ever raised it.
      vmAloft(deck, true);
      card.dataset.vmFlying = "1";
      card.setAttribute("data-slot", "flying");
      card.classList.remove("is-dragging");
      deck.classList.remove("is-peeking");

      // The cards behind come forward straight away rather than waiting for the
      // throw to finish — that is what makes the deck feel like it has depth.
      vmAdvance(deck);
      if (refocus) focusTop();

      var done = false;
      function finish() {
        if (done) return;
        done = true;
        card.removeEventListener("transitionend", finish);
        land(card);
      }

      card.classList.add("is-vanishing");
      if (vmReducedMotion()) {
        card.style.transform = "";
        setTimeout(finish, 240);
        return;
      }

      var throwX = dx;
      var throwY = dy;
      // A press with no travel still has to go somewhere, so it lifts away.
      if (Math.abs(throwX) < 6 && Math.abs(throwY) < 6) {
        throwX = 0;
        throwY = -110;
      } else {
        throwX *= 4;
        throwY *= 4;
      }
      var spin = Math.max(-18, Math.min(18, throwX * 0.06)) || 11;
      requestAnimationFrame(function () {
        card.style.transform =
          "translate(" +
          Math.round(throwX) +
          "px, " +
          Math.round(throwY) +
          "px) rotate(" +
          spin.toFixed(2) +
          "deg) scale(0.7)";
      });
      card.addEventListener("transitionend", finish);
      // transitionend never arrives if the section is scrolled out of view or the
      // tab is backgrounded mid-throw, and a stuck card would freeze the deck.
      setTimeout(finish, 640);
    }

    deck.addEventListener("pointerdown", function (e) {
      if (busy || active) return;
      if (typeof e.button === "number" && e.button !== 0) return;
      var card = e.target.closest && e.target.closest(".vm-deck__card");
      if (!card || card.getAttribute("data-slot") !== "0") return;
      active = card;
      startX = e.clientX;
      startY = e.clientY;
      dx = 0;
      dy = 0;
      claimed = false;
      deck.classList.add("is-peeking");
      vmAloft(deck, true);
      try {
        card.setPointerCapture(e.pointerId);
      } catch (err) {
        /* capture is a nicety; the deck still works without it */
      }
    });

    deck.addEventListener("pointermove", function (e) {
      if (!active) return;
      dx = e.clientX - startX;
      // Vertical travel is damped on touch only. The deck is `touch-action:
      // pan-y` on purpose, so a diagonal swipe can start the page's own scroll —
      // and once it has, the move events are no longer cancelable and the
      // `preventDefault()` below is a no-op, so the card was travelling with the
      // finger *and* with the page. `dy` carries no meaning in a gesture whose
      // own hint reads "drag a photo aside"; keeping a third of it preserves the
      // feel without letting the card double-move. Mouse and pen are unchanged.
      dy = (e.clientY - startY) * (e.pointerType === "touch" ? 0.35 : 1);
      if (!claimed) {
        // Nothing is claimed until the pointer has clearly gone sideways, so a
        // finger that came down to scroll the page keeps scrolling the page.
        if (Math.abs(dx) <= CLAIM_PX) return;
        claimed = true;
        active.classList.add("is-dragging");
      }
      if (e.cancelable) e.preventDefault();
      active.style.transform =
        "translate(" +
        Math.round(dx) +
        "px, " +
        Math.round(dy) +
        "px) rotate(" +
        (dx * 0.045).toFixed(2) +
        "deg) scale(0.955)";
    });

    deck.addEventListener("pointerup", function (e) {
      if (!active) return;
      var card = active;
      active = null;
      try {
        card.releasePointerCapture(e.pointerId);
      } catch (err) {
        /* already released */
      }
      // Letting go always sends the card away, drag or plain press.
      vanish(card, false);
    });

    // Cancel is not a release: the browser fires it when it takes the gesture
    // over to pan the page, and a card must not disappear because someone
    // scrolled past it.
    deck.addEventListener("pointercancel", function () {
      if (!active) return;
      var card = active;
      active = null;
      deck.classList.remove("is-peeking");
      if (claimed) {
        vanish(card, false);
        return;
      }
      card.classList.remove("is-dragging");
      card.style.transform = "";
      vmAloft(deck, false);
    });

    deck.addEventListener("keydown", function (e) {
      if (busy) return;
      if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
      var card =
        e.target.closest && e.target.closest('.vm-deck__card[data-slot="0"]');
      if (!card) return;
      e.preventDefault();
      dx = 0;
      dy = 0;
      vanish(card, true);
    });
  }

  /* -- Mission: the shuffle -------------------------------------------------
     Lift clear, carry back, drop in. The two cards behind promote during the
     carry rather than after it, so the whole thing reads as one movement. */
  function vmWireShuffle(deck) {
    var busy = false;

    function run(card) {
      if (busy) return;
      busy = true;
      var refocus = deck.contains(document.activeElement);
      card.dataset.vmFlying = "1";
      card.setAttribute("data-slot", "flying");
      // The lift below clears the top of the Mission card, so the section has to
      // be able to paint over the one above it for the length of the shuffle.
      vmAloft(deck, true);

      function settle() {
        deck.classList.add("is-settling");
        card.classList.remove("is-lifting", "is-tucking");
        delete card.dataset.vmFlying;
        vmIndexSlots(deck);
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            deck.classList.remove("is-settling");
            vmAloft(deck, false);
            busy = false;
          });
        });
      }

      if (vmReducedMotion()) {
        vmAdvance(deck);
        if (refocus) {
          var top = deck.querySelector('.vm-deck__card[data-slot="0"]');
          if (top) top.focus();
        }
        setTimeout(settle, 180);
        return;
      }

      card.classList.add("is-lifting");
      setTimeout(function () {
        // Halfway: the card starts its journey to the deepest slot and drops
        // below the deck at the same moment, and the cards behind are released
        // forward. Swapping z-index here rather than at the start is what makes
        // it read as going *behind* the others instead of under them.
        card.classList.remove("is-lifting");
        card.classList.add("is-tucking");
        vmAdvance(deck);
        if (refocus) {
          var top = deck.querySelector('.vm-deck__card[data-slot="0"]');
          if (top) top.focus();
        }
        // The hand-back waits for the card promoted into the deepest slot to
        // finish fading in (0.42s from here), so the two never overlap there.
        setTimeout(settle, 430);
        // The lift travels further than it used to (-72px, clear of the card's
        // own 48px padding), so the midpoint moved with it: 200ms matches the
        // 0.19s transform transition on `.is-lifting`, and the tuck now starts
        // from a card that has finished rising rather than interrupting one
        // still on its way up. Total shuffle ~630ms — still a quick one.
      }, 200);
    }

    deck.addEventListener("click", function (e) {
      var card = e.target.closest && e.target.closest(".vm-deck__card");
      if (!card || card.getAttribute("data-slot") !== "0") return;
      run(card);
    });

    deck.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
      var card =
        e.target.closest && e.target.closest('.vm-deck__card[data-slot="0"]');
      if (!card) return;
      e.preventDefault();
      run(card);
    });
  }

  function initCarousel(track) {
    // The placeholder carousel that ships in main.html arms its own 5s autoplay
    // before the services API answers. `applyServices` then rebuilds this
    // track's children and calls us, so without this the old timer keeps
    // firing against the new cards alongside our 6s one.
    if (track._fmrcPlaceholderTimer) {
      clearInterval(track._fmrcPlaceholderTimer);
      track._fmrcPlaceholderTimer = null;
    }
    var items = Array.from(track.querySelectorAll(".carousel-item"));
    var prevEl = document.querySelector(".prev-btn");
    var nextEl = document.querySelector(".next-btn");
    var wrapper = document.querySelector(".carousel-wrapper");
    if (!items.length || !prevEl || !nextEl || !wrapper) return;
    // One constant instead of the five literals this function used to carry, so
    // the autoplay beat is set in a single place and the arrows, the hover pause
    // and the swipe all restart on the same interval.
    var AUTOPLAY_MS = 6000;
    var cur = 0,
      timer;
    function upd() {
      items.forEach(function (it, i) {
        it.className = "carousel-item";
        if (i === cur) it.classList.add("active");
        else if (i === (cur - 1 + items.length) % items.length)
          it.classList.add("prev");
        else if (i === (cur + 1) % items.length) it.classList.add("next");
        else if (i === (cur - 2 + items.length) % items.length)
          it.classList.add("prev-hidden");
        else if (i === (cur + 2) % items.length)
          it.classList.add("next-hidden");
      });
    }
    function nxt() {
      cur = (cur + 1) % items.length;
      upd();
    }
    function prv() {
      cur = (cur - 1 + items.length) % items.length;
      upd();
    }

    // Autoplay used to be `setInterval(nxt, AUTOPLAY_MS)` with the only pause
    // bound to `mouseenter` — an event a touch device never fires. So on a
    // phone this rewrote `className` on every item and restarted five 0.6s
    // transitions every six seconds for the whole visit, including while the
    // tab was in the background or the section was nowhere near the screen.
    // `autoTick` is the interval callback everywhere now: it keeps the timer
    // running (so the beat is unchanged when the visitor comes back) but skips
    // the DOM work nobody can see. Same `document.hidden` idiom as the 20s
    // settings poll further up this file.
    var onScreen = true;
    function autoTick() {
      if (document.hidden || !onScreen) return;
      nxt();
    }
    function arm() {
      clearInterval(timer);
      timer = setInterval(autoTick, AUTOPLAY_MS);
    }
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(
        function (entries) {
          onScreen = entries[entries.length - 1].isIntersecting;
        },
        { threshold: 0 },
      ).observe(wrapper);
    }

    var nn = nextEl.cloneNode(true),
      np = prevEl.cloneNode(true);
    nextEl.parentNode.replaceChild(nn, nextEl);
    prevEl.parentNode.replaceChild(np, prevEl);
    nn.addEventListener("click", function () {
      nxt();
      arm();
    });
    np.addEventListener("click", function () {
      prv();
      arm();
    });
    items.forEach(function (it) {
      it.addEventListener("click", function (e) {
        // A drag that already moved the carousel must not also register as a
        // tap on whichever neighbour card the finger happened to land on.
        if (swiped) {
          swiped = false;
          // The offer artwork is now a lightbox trigger, and the click is on its
          // way to the delegated handler on document.body. Stop it here or a
          // swipe would also throw the viewer open.
          e.stopPropagation();
          return;
        }
        if (it.classList.contains("prev")) {
          prv();
          e.stopPropagation();
        } else if (it.classList.contains("next")) {
          nxt();
          e.stopPropagation();
        }
        // The active card falls through on purpose: only the card the visitor is
        // actually looking at should open its image.
      });
    });
    wrapper.addEventListener("mouseenter", function () {
      clearInterval(timer);
    });
    wrapper.addEventListener("mouseleave", function () {
      arm();
    });

    // Swipe. The original bindings near the top of this file belong to the
    // placeholder track that ships in main.html; as soon as the services API
    // answers, that track is rebuilt and this function re-binds the arrows,
    // the card taps, the hover pause and the autoplay — but touch was never
    // re-bound, so on the live site swiping did nothing at all.
    // One code path for both inputs: touch events for a finger, pointer
    // events for a trackpad or mouse drag, with pointerType "touch" ignored
    // so a phone cannot advance twice from a single swipe.
    var SWIPE_MIN = 40;
    var gx = 0,
      gy = 0,
      dragging = false,
      swiped = false;

    function gestureStart(x, y) {
      gx = x;
      gy = y;
      dragging = true;
      swiped = false;
      clearInterval(timer);
    }

    function restartAutoPlay() {
      arm();
    }

    function gestureEnd(x, y) {
      if (!dragging) return;
      dragging = false;
      var dx = x - gx;
      var dy = y - gy;
      // A mostly-vertical drag is the page being scrolled, not the cards being
      // browsed, so it must not steal the gesture.
      if (Math.abs(dx) > SWIPE_MIN && Math.abs(dx) > Math.abs(dy)) {
        swiped = true;
        if (dx < 0) nxt();
        else prv();
      }
      restartAutoPlay();
    }

    track.addEventListener(
      "touchstart",
      function (e) {
        gestureStart(e.touches[0].clientX, e.touches[0].clientY);
      },
      { passive: true },
    );

    track.addEventListener(
      "touchend",
      function (e) {
        var t = e.changedTouches[0];
        gestureEnd(t.clientX, t.clientY);
      },
      { passive: true },
    );

    track.addEventListener(
      "touchcancel",
      function () {
        dragging = false;
        restartAutoPlay();
      },
      { passive: true },
    );

    track.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "touch") return;
      gestureStart(e.clientX, e.clientY);
    });

    track.addEventListener("pointerup", function (e) {
      if (e.pointerType === "touch") return;
      gestureEnd(e.clientX, e.clientY);
    });

    setupStackedEntrance(wrapper);

    upd();
    arm();
  }

  // Stacked entrance for What We Offer. `.is-stacked` pins every carousel item to
  // the active card's position, so the section travels up from below as a single
  // card; taking the class off again lets `.carousel-item`'s pre-existing 0.6s
  // transform transition carry prev and next outward, left and right at the same
  // time. No keyframes, and not one line of the shared reveal system is touched.
  function setupStackedEntrance(wrapper) {
    // Only worth doing before the reveal has played. A services response that
    // lands after the visitor has already scrolled past would otherwise stack the
    // cards with no reveal left to unstack them.
    if (
      !wrapper ||
      !wrapper.classList.contains("reveal-on-scroll") ||
      wrapper.classList.contains("show-reveal")
    ) {
      return;
    }
    // Nothing here is essential, so reduced motion simply opts out rather than
    // getting a spread with the travel removed.
    if (
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    if (typeof MutationObserver !== "function") return;

    wrapper.classList.add("is-stacked");

    var unstacked = false;
    var safety = null;
    var watcher = null;
    var guard = null;

    var unstack = function () {
      if (unstacked) return;
      unstacked = true;
      if (watcher) watcher.disconnect();
      if (guard) guard.disconnect();
      if (safety) clearTimeout(safety);
      wrapper.classList.remove("is-stacked");
    };

    watcher = new MutationObserver(function () {
      if (!wrapper.classList.contains("show-reveal")) return;
      // A beat behind the reveal so the block finishes arriving before the cards
      // start spreading — two legible moves instead of one blur.
      setTimeout(unstack, 140);
    });
    watcher.observe(wrapper, { attributes: true, attributeFilter: ["class"] });

    // Fail open on a real signal instead of a clock. This section sits far down
    // the page, so a plain "unstack after N seconds" timer expires while the
    // visitor is still reading the hero and silently cancels the spread for
    // everyone who does not race down to it. The only way `show-reveal` never
    // lands is that the reveal observer itself did not run, and the honest test
    // for that is "the block is half on screen and still has not been revealed".
    if (typeof IntersectionObserver === "function") {
      guard = new IntersectionObserver(function (entries) {
        if (safety || wrapper.classList.contains("show-reveal")) return;
        var visible = entries.some(function (entry) {
          return entry.isIntersecting;
        });
        if (!visible) return;
        safety = setTimeout(unstack, 1600);
      }, { threshold: 0.5 });
      guard.observe(wrapper);
    } else {
      // No observer support at all: the reveal cannot fire either, so never stack.
      unstack();
    }
  }

  function bootSiteContent() {
    // Wired before the fetch so the `load` listener is in place by the time
    // applySettings writes the first src.
    initVmPhotoPlaceholder("vision");
    initVmPhotoPlaceholder("mission");
    loadSiteContent();
    initSdgRealtime();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootSiteContent);
  } else {
    bootSiteContent();
  }
})();

/* ===========================================================================
   HERO TITLE <-> LOGO OPTICAL ANCHOR — removed.
   This block used to nudge .hero-content-left downward by half the height of
   everything under the title (CTA pills + SDG band) so the title's mid-line
   landed on the logo's. It cost the hero the top of its screen: the pair sat
   ~45px lower and the badge band was pushed into the fold line.
   The band is now lifted out of the copy column's flow in CSS
   (see "Hero SDG band — pinned out of the copy column" in main.css), so the
   column measures the title and the pills only and the flex row centres the
   pair by itself. No script, nothing to re-measure on resize.
   =========================================================================== */
