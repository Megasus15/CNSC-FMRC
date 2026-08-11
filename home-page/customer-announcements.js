(() => {
  "use strict";

  const resolveApiBaseUrl = () => {
    if (window.APP_API_BASE_URL)
      return window.APP_API_BASE_URL.replace(/\/+$/, "");
    const protocol = String(window.location.protocol || "").toLowerCase();
    const hostname = String(
      window.location.hostname || "127.0.0.1",
    ).toLowerCase();
    if (!/^https?:$/.test(protocol) || !hostname) {
      return "http://127.0.0.1:8000/api";
    }
    const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1";
    if (isLocalHost) return `${protocol}//${hostname}:8000/api`;
    return `${window.location.origin.replace(/\/+$/, "")}/api`;
  };

  const API_BASE_URL = resolveApiBaseUrl();
  const pathname = String(window.location.pathname || "").toLowerCase();
  const isHomePage =
    pathname === "/" ||
    pathname === "" ||
    pathname.endsWith("/main.html") ||
    /(?:^|\/)home-page\/?$/.test(pathname);
  const isProductsPage = /products-page/i.test(pathname);
  const isAdminOrStaff = /admin-page|staff-page|cashier-page|admin-auth/i.test(
    pathname,
  );

  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>'"]/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          "'": "&#39;",
          '"': "&quot;",
        })[char],
    );

  const safeColor = (value, fallback = "#c0392b") =>
    /^#[0-9a-f]{3,8}$/i.test(String(value || "")) ? value : fallback;

  const toTimestamp = (value) => {
    if (!value) return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  };

  const isWithinCampaignWindow = (item, now = Date.now()) => {
    if (!item || item.is_enabled === false) return false;

    const startsAt = toTimestamp(item.starts_at);
    const endsAt = toTimestamp(item.ends_at);

    return (startsAt === null || startsAt <= now) &&
      (endsAt === null || endsAt > now);
  };

  const filterActiveCampaigns = (items) =>
    (Array.isArray(items) ? items : []).filter((item) =>
      isWithinCampaignWindow(item),
    );

  window.getGlobalFMRCTheme = () => {
    try {
      const stored = localStorage.getItem("fmrc_global_announcement_theme");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.primary && parsed.secondary) return parsed;
      }
    } catch {
      /* ignore storage errors */
    }
    return { primary: "#c0392b", secondary: "#800000" };
  };

  window.setGlobalFMRCTheme = (primary, secondary) => {
    const theme = {
      primary: safeColor(primary, "#c0392b"),
      secondary: safeColor(secondary, "#800000"),
    };
    try {
      localStorage.setItem(
        "fmrc_global_announcement_theme",
        JSON.stringify(theme),
      );
    } catch {
      /* ignore */
    }
    window.dispatchEvent(
      new CustomEvent("fmrc_theme_changed", { detail: theme }),
    );
    return theme;
  };

  const hasSeen = (id) => {
    try {
      return sessionStorage.getItem(`fmrc_announcement_seen_${id}`) === "1";
    } catch {
      return false;
    }
  };
  const markSeen = (id) => {
    try {
      sessionStorage.setItem(`fmrc_announcement_seen_${id}`, "1");
    } catch {
      /* storage optional */
    }
  };

  const isTooltipDismissed = () => {
    try {
      return (
        localStorage.getItem("fmrc_announcement_tooltip_dismissed") === "1"
      );
    } catch {
      return false;
    }
  };
  const markTooltipDismissed = () => {
    try {
      localStorage.setItem("fmrc_announcement_tooltip_dismissed", "1");
    } catch {
      /* storage optional */
    }
    const tip = document.getElementById("announcementGlassTooltip");
    if (tip) {
      tip.style.opacity = "0";
      tip.style.transform = "translateY(-6px)";
      setTimeout(() => tip.remove(), 250);
    }
  };

  let announcements = [];
  let rawPromotions = [];
  let productsCatalog = [];
  let activeIndex = 0;
  let modal;
  let titleEl;
  let messageEl;
  let ctaEl;
  let counterEl;
  let nextBtn;
  let isLoading = true;
  let campaignExpiryTimer = null;
  let campaignPollTimer = null;
  let lastPromotionSignature = "";

  const getProductNamesString = (productIds) => {
    if (!Array.isArray(productIds) || !productIds.length)
      return "selected products";
    const names = productIds
      .map((id) => {
        const p = productsCatalog.find(
          (prod) => String(prod.id) === String(id),
        );
        return p ? p.name : null;
      })
      .filter(Boolean);
    return names.length
      ? names.join(", ")
      : `${productIds.length} selected product(s)`;
  };

  const showModal = (index = 0) => {
    if (!modal) return;
    markTooltipDismissed();

    const activeCampaigns = filterActiveCampaigns(announcements);
    if (activeCampaigns.length !== announcements.length) {
      announcements = activeCampaigns;
      activeIndex = Math.min(activeIndex, Math.max(0, announcements.length - 1));
      updateBadges(announcements.length);
    }

    const hasAnnouncements = announcements.length > 0;
    const item = hasAnnouncements
      ? announcements[(index + announcements.length) % announcements.length]
      : null;

    if (item) activeIndex = announcements.indexOf(item);

    const theme = window.getGlobalFMRCTheme();
    const primaryAccent = safeColor(theme.primary, "#c0392b");
    const secondaryAccent = safeColor(theme.secondary, "#800000");

    if (modal.style) {
      modal.style.setProperty("--announcement-accent-primary", primaryAccent);
      modal.style.setProperty(
        "--announcement-accent-secondary",
        secondaryAccent,
      );
    }
    if (titleEl) titleEl.textContent = item?.title || "Announcements";
    if (messageEl) {
      messageEl.textContent =
        item?.message ||
        (isLoading
          ? "Loading announcements..."
          : "There are no active announcements right now.");
    }
    if (counterEl) {
      counterEl.textContent = item
        ? announcements.length > 1
          ? `${activeIndex + 1} of ${announcements.length}`
          : "Latest Announcement"
        : "";
    }

    if (ctaEl) {
      if (item?.cta_label && item?.cta_url) {
        ctaEl.hidden = false;
        ctaEl.style.display = "inline-flex";
        ctaEl.textContent = item.cta_label;
        ctaEl.href = item.cta_url;
      } else {
        ctaEl.hidden = true;
        ctaEl.style.display = "none";
        ctaEl.removeAttribute("href");
      }
    }

    if (nextBtn) {
      const canShowNext = announcements.length > 1;
      nextBtn.hidden = !canShowNext;
      nextBtn.style.display = canShowNext ? "inline-flex" : "none";
    }

    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    modal.classList.add("is-visible");
    document.body.classList.add("fmrc-announcement-open");
    if (item) markSeen(item.id);
  };

  const closeModal = () => {
    if (modal) {
      modal.hidden = true;
      modal.setAttribute("aria-hidden", "true");
      modal.classList.remove("is-visible");
    }
    document.body.classList.remove("fmrc-announcement-open");
  };

  const mountModalAndButtons = () => {
    // 1. Inject Styles if not present
    if (!document.getElementById("fmrcAnnouncementStyles")) {
      const style = document.createElement("style");
      style.id = "fmrcAnnouncementStyles";
      style.textContent = `
        .announcement-bell-wrapper {
          position: relative;
          display: inline-flex;
          align-items: center;
        }
        .announcement-bell {
          position: relative;
          display: inline-grid;
          width: 42px;
          height: 42px;
          place-items: center;
          margin-right: 4px;
          border: 1px solid #ead9d9;
          border-radius: 50%;
          background: #ffffff;
          color: #870b14;
          cursor: pointer;
          font-size: 1.15rem;
          transform: none;
          transition: background-color 0.2s ease, border-color 0.2s ease;
        }
        .announcement-bell:hover {
          background: #fff4f4;
          border-color: #c0392b;
          transform: none;
        }
        .announcement-bell:active {
          transform: scale(0.96);
        }
        .announcement-bell__badge {
          position: absolute;
          top: -3px;
          right: -3px;
          min-width: 19px;
          height: 19px;
          padding: 0 5px;
          border: 2px solid #ffffff;
          border-radius: 999px;
          background: linear-gradient(135deg, #ef4444, #800000);
          color: #ffffff;
          font-size: 10px;
          font-weight: 800;
          line-height: 15px;
          text-align: center;
        }
        .announcement-bell__badge[hidden] { display: none !important; }
        .fmrc-announcement-open { overflow: hidden !important; }
        
        /* Glassmorphism Navbar Tooltip Pointer Pointing directly to Bell Icon */
        .announcement-glass-tooltip {
          position: absolute;
          top: calc(100% + 12px);
          right: -6px;
          z-index: 10040;
          width: max-content;
          max-width: 280px;
          padding: 10px 14px;
          border-radius: 16px;
          background: rgba(255, 255, 255, 0.78);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          border: 1px solid rgba(255, 255, 255, 0.95);
          box-shadow: 0 12px 35px rgba(128, 0, 0, 0.2), 0 2px 10px rgba(0, 0, 0, 0.08);
          color: #1e293b;
          pointer-events: auto;
          animation: fmrcGlassPulse 3s infinite ease-in-out;
          transition: opacity 0.25s ease, transform 0.25s ease;
          cursor: pointer;
        }
        .announcement-glass-tooltip__arrow {
          position: absolute;
          top: -8px;
          right: 20px;
          width: 0;
          height: 0;
          border-left: 7px solid transparent;
          border-right: 7px solid transparent;
          border-bottom: 8px solid rgba(255, 255, 255, 0.95);
        }
        .announcement-glass-tooltip__content {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .announcement-glass-tooltip__text {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .announcement-glass-tooltip__text strong {
          font-size: 0.78rem;
          font-weight: 800;
          color: #800000;
          line-height: 1.2;
        }
        .announcement-glass-tooltip__text span {
          font-size: 0.72rem;
          color: #475569;
          line-height: 1.25;
        }
        .announcement-glass-tooltip__close {
          background: transparent;
          border: none;
          color: #94a3b8;
          font-size: 1.1rem;
          cursor: pointer;
          margin-left: 4px;
          padding: 0;
          line-height: 1;
        }
        .announcement-glass-tooltip__close:hover {
          color: #1e293b;
        }

        @keyframes fmrcGlassPulse {
          0%, 100% {
            opacity: 0.92;
            transform: translateY(0);
            box-shadow: 0 10px 28px rgba(128, 0, 0, 0.18);
          }
          50% {
            opacity: 1;
            transform: translateY(5px);
            box-shadow: 0 16px 40px rgba(128, 0, 0, 0.28);
          }
        }
        
        .announcement-modal {
          position: fixed;
          inset: 0;
          z-index: 10050;
          display: grid;
          place-items: center;
          padding: 20px;
          background: rgba(0, 0, 0, 0.65);
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.25s ease;
        }
        .announcement-modal.is-visible {
          opacity: 1;
          pointer-events: auto;
        }
        .announcement-modal[hidden] { display: none !important; }
        
        .announcement-modal__card {
          width: min(520px, 92vw);
          overflow: hidden;
          border-radius: 20px;
          background: #ffffff;
          box-shadow: 0 25px 65px rgba(0, 0, 0, 0.35);
          animation: fmrcAnnouncementIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          position: relative;
        }
        
        .announcement-modal__hero {
          position: relative;
          padding: 26px 28px 20px;
          background: linear-gradient(135deg, var(--announcement-accent-primary, #c0392b), var(--announcement-accent-secondary, #800000));
          color: #ffffff;
        }
        
        .announcement-modal__label {
          margin: 0 0 6px;
          font-size: 0.72rem;
          font-weight: 800;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          opacity: 0.92;
          color: #ffffff;
        }
        
        .announcement-modal__title {
          margin: 0;
          font-size: 1.45rem;
          font-weight: 700;
          line-height: 1.25;
          color: #ffffff;
        }
        
        .announcement-modal__close-x {
          position: absolute;
          top: 16px;
          right: 18px;
          background: rgba(255, 255, 255, 0.22);
          border: none;
          color: #ffffff;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          font-size: 1.2rem;
          display: grid;
          place-items: center;
          cursor: pointer;
          transition: background-color 0.2s ease, transform 0.08s ease;
          z-index: 10;
          line-height: 1;
        }
        .announcement-modal__close-x:hover {
          background: rgba(255, 255, 255, 0.4);
        }
        .announcement-modal__close-x:active {
          transform: scale(0.94);
        }
        
        .announcement-modal__body {
          padding: 24px 28px;
          position: relative;
          background: #ffffff;
        }
        
        .announcement-modal__message {
          margin: 0 0 20px;
          color: #374151;
          font-size: 0.96rem;
          line-height: 1.65;
          white-space: pre-line;
        }
        
        .announcement-modal__actions {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
        }
        
        .announcement-modal__counter {
          font-size: 0.78rem;
          color: #6b7280;
          font-weight: 600;
        }
        
        .announcement-modal__button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 10px 18px;
          border-radius: 10px;
          border: none;
          font-size: 0.88rem;
          font-weight: 700;
          cursor: pointer;
          text-decoration: none;
          transition: background-color 0.2s ease, filter 0.2s ease, transform 0.08s ease;
        }
        
        .announcement-modal__button--primary {
          background: var(--announcement-accent-secondary, #800000);
          color: #ffffff !important;
        }
        /* Dynamic darkening on hover for WHICHEVER preset gradient color is active */
        .announcement-modal__button--primary:hover {
          filter: brightness(0.84);
        }
        .announcement-modal__button--primary:active {
          transform: scale(0.96);
        }
        
        .announcement-modal__button--secondary {
          background: #f1f5f9;
          color: #374151;
          border: 1px solid #e2e8f0;
        }
        .announcement-modal__button--secondary:hover {
          background: #e2e8f0;
        }
        .announcement-modal__button--secondary:active {
          transform: scale(0.96);
        }
        
        @keyframes fmrcAnnouncementIn {
          from { opacity: 0; transform: translateY(18px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `;
      document.head.appendChild(style);
    }

    // Export preview card renderer for Admin/Staff dashboard live preview (EXACT 1:1 MATCH WITH CUSTOMER MODAL)
    window.renderFMRCAnnouncementPreviewCard = (
      container,
      item,
      counterText = "",
    ) => {
      if (!container) return;
      const theme = window.getGlobalFMRCTheme();
      const primary = safeColor(theme.primary, "#c0392b");
      const secondary = safeColor(theme.secondary, "#800000");
      const title = item?.title || "Announcements";
      const message =
        item?.message || "There are no active announcements right now.";
      const ctaLabel = item?.cta_label || "";
      const ctaUrl = item?.cta_url || "#";
      const badgeText = item?.badge_text || "FMRC ANNOUNCEMENT";

      container.style.setProperty("--announcement-accent-primary", primary);
      container.style.setProperty("--announcement-accent-secondary", secondary);

      container.innerHTML = `
        <button type="button" class="announcement-modal__close-x" aria-label="Close preview" onclick="event.preventDefault()">&times;</button>
        <div class="announcement-modal__hero">
          <p class="announcement-modal__label">${esc(badgeText)}</p>
          <h2 class="announcement-modal__title">${esc(title)}</h2>
        </div>
        <div class="announcement-modal__body">
          <p class="announcement-modal__message">${esc(message)}</p>
          <div class="announcement-modal__actions">
            <span class="announcement-modal__counter">${esc(counterText || "")}</span>
            <div style="display:flex; gap:8px; align-items:center; margin-left:auto;">
              ${ctaLabel ? `<a href="${esc(ctaUrl)}" class="announcement-modal__button announcement-modal__button--primary" onclick="event.preventDefault()">${esc(ctaLabel)} <i class="fa-solid fa-arrow-right"></i></a>` : ""}
              <button type="button" class="announcement-modal__button announcement-modal__button--secondary" onclick="event.preventDefault()">Got it</button>
            </div>
          </div>
        </div>
      `;
    };

    // 2. Ensure Bell Button & Wrapper exist ONLY on Customer Pages (NOT Admin/Staff)
    if (!isAdminOrStaff) {
      const headerRight = document.querySelector(
        ".header-right-actions, .header-right, .nav-right",
      );
      if (headerRight) {
        let bellBtn = document.getElementById("announcementBell");
        let bellWrapper = bellBtn?.closest(".announcement-bell-wrapper");

        if (!bellWrapper) {
          bellWrapper = document.createElement("div");
          bellWrapper.className = "announcement-bell-wrapper";
          bellWrapper.style.position = "relative";
          bellWrapper.style.display = "inline-flex";
          bellWrapper.style.alignItems = "center";

          if (bellBtn) {
            bellBtn.parentNode.insertBefore(bellWrapper, bellBtn);
            bellWrapper.appendChild(bellBtn);
          } else {
            bellBtn = document.createElement("button");
            bellBtn.className = "announcement-bell";
            bellBtn.id = "announcementBell";
            bellBtn.type = "button";
            bellBtn.setAttribute("aria-label", "Open announcements");
            bellBtn.setAttribute("title", "Announcements");
            bellBtn.innerHTML = `
              <i class="fa-solid fa-bell" aria-hidden="true"></i>
              <span class="announcement-bell__badge" id="announcementBellBadge" hidden>0</span>
            `;
            bellWrapper.appendChild(bellBtn);

            const userProfile = headerRight.querySelector(
              ".user-profile, .profile-container",
            );
            if (userProfile) {
              headerRight.insertBefore(bellWrapper, userProfile);
            } else {
              headerRight.appendChild(bellWrapper);
            }
          }
        }
      }

      document
        .querySelectorAll("#announcementBell, .announcement-bell")
        .forEach((bell) => {
          bell.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopImmediatePropagation();
            showModal(activeIndex);
          });
        });
    }

    // 3. Ensure Modal HTML exists for customer pages
    if (!isAdminOrStaff) {
      modal = document.getElementById("announcementModal");
      const createModalInnerHtml = () => `
        <div class="announcement-modal__card">
          <button type="button" class="announcement-modal__close-x" id="announcementModalCloseX" aria-label="Close announcement">&times;</button>
          <div class="announcement-modal__hero">
            <p class="announcement-modal__label" id="announcementModalBadgeLabel">FMRC ANNOUNCEMENT</p>
            <h2 class="announcement-modal__title" id="announcementModalTitle">Announcements</h2>
          </div>
          <div class="announcement-modal__body">
            <p class="announcement-modal__message" id="announcementModalMessage">Loading announcements...</p>
            <div class="announcement-modal__actions">
              <span class="announcement-modal__counter" id="announcementModalCounter"></span>
              <div style="display:flex; gap:8px; align-items:center; margin-left:auto;">
                <button type="button" class="announcement-modal__button announcement-modal__button--secondary" id="announcementModalNext" hidden>Next</button>
                <a class="announcement-modal__button announcement-modal__button--primary" id="announcementModalCta" hidden>View Details</a>
                <button type="button" class="announcement-modal__button announcement-modal__button--secondary" id="announcementModalClose">Got it</button>
              </div>
            </div>
          </div>
        </div>
      `;

      if (!modal) {
        modal = document.createElement("div");
        modal.className = "announcement-modal";
        modal.id = "announcementModal";
        modal.hidden = true;
        modal.setAttribute("role", "dialog");
        modal.setAttribute("aria-modal", "true");
        modal.innerHTML = createModalInnerHtml();
        document.body.appendChild(modal);
      }

      const requiredModalControls = [
        "#announcementModalCloseX",
        "#announcementModalClose",
        "#announcementModalNext",
        "#announcementModalCta",
      ];
      if (
        !requiredModalControls.every((selector) =>
          modal.querySelector(selector),
        )
      ) {
        modal.innerHTML = createModalInnerHtml();
      }
      modal.hidden = true;
      modal.setAttribute("aria-hidden", "true");
      modal.classList.remove("is-visible", "is-open");

      titleEl = modal.querySelector("#announcementModalTitle");
      messageEl = modal.querySelector("#announcementModalMessage");
      ctaEl = modal.querySelector("#announcementModalCta");
      counterEl = modal.querySelector("#announcementModalCounter");
      nextBtn = modal.querySelector("#announcementModalNext");

      const closeElements = modal.querySelectorAll(
        "#announcementModalClose, #announcementModalCloseX, #announcementModalAcknowledge, .announcement-modal__close, .announcement-modal__close-x",
      );
      closeElements.forEach((el) => {
        el.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopImmediatePropagation();
          closeModal();
        });
      });

      if (nextBtn) {
        nextBtn.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopImmediatePropagation();
          showModal(activeIndex + 1);
        });
      }

      modal.addEventListener("click", (event) => {
        if (event.target === modal) closeModal();
      });

      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !modal.hidden) closeModal();
      });
    }
  };

  const mountGlassTooltip = () => {
    if (isAdminOrStaff || isTooltipDismissed()) return;
    const bellBtn = document.getElementById("announcementBell");
    if (!bellBtn) return;
    let bellWrapper = bellBtn.closest(".announcement-bell-wrapper");
    if (!bellWrapper) {
      bellWrapper = document.createElement("div");
      bellWrapper.className = "announcement-bell-wrapper";
      bellWrapper.style.position = "relative";
      bellWrapper.style.display = "inline-flex";
      bellWrapper.style.alignItems = "center";
      bellBtn.parentNode.insertBefore(bellWrapper, bellBtn);
      bellWrapper.appendChild(bellBtn);
    }

    if (document.getElementById("announcementGlassTooltip")) return;

    const tip = document.createElement("div");
    tip.className = "announcement-glass-tooltip";
    tip.id = "announcementGlassTooltip";
    tip.innerHTML = `
      <div class="announcement-glass-tooltip__arrow"></div>
      <div class="announcement-glass-tooltip__content">
        <span style="font-size:1.15rem; filter:drop-shadow(0 2px 4px rgba(0,0,0,0.15));">✨</span>
        <div class="announcement-glass-tooltip__text">
          <strong>New Announcement!</strong>
          <span>Click to view live campus promos &amp; updates</span>
        </div>
        <button type="button" class="announcement-glass-tooltip__close" id="announcementGlassTooltipClose" aria-label="Dismiss">&times;</button>
      </div>
    `;

    tip.addEventListener("click", (event) => {
      if (event.target.closest("#announcementGlassTooltipClose")) {
        event.preventDefault();
        event.stopPropagation();
        markTooltipDismissed();
      } else {
        showModal(activeIndex);
      }
    });

    bellWrapper.appendChild(tip);
  };

  const applyProductSpotlight = () => {
    const spotlight = document.getElementById("promotionSpotlight");
    if (!spotlight) return;

    // Task 2 requirement: Spotlight header card on product page MUST ONLY display Saved Product Promotions
    const activePromo = rawPromotions.length > 0 ? rawPromotions[0] : null;

    if (activePromo) {
      spotlight.style.display = "block";
      spotlight.classList.add("is-visible");
      const headline = document.getElementById("promotionSpotlightTitle");
      const copy = document.getElementById("promotionSpotlightMessage");

      const appliesToDetail =
        activePromo.scope === "all_products"
          ? "all products in our store"
          : getProductNamesString(activePromo.product_ids);

      if (headline) headline.innerHTML = `🎉 ${esc(activePromo.title)}`;
      if (copy)
        copy.textContent = `Special Product Promotion: Enjoy ${activePromo.discount_percent}% OFF on ${appliesToDetail}! Limited-time offer.`;

      spotlight.onclick = () => {
        const promoItemInAnnouncements = announcements.find(
          (a) => a.id === `promo_${activePromo.id}`,
        );
        if (promoItemInAnnouncements) {
          showModal(announcements.indexOf(promoItemInAnnouncements));
        } else {
          showModal(0);
        }
      };
    } else {
      spotlight.style.display = "none";
    }
  };

  const updateBadges = (count) => {
    document
      .querySelectorAll("#announcementBellBadge, .announcement-bell__badge")
      .forEach((badge) => {
        if (count > 0) {
          badge.textContent = count > 99 ? "99+" : String(count);
          badge.hidden = false;
          badge.style.display = "inline-block";
        } else {
          badge.hidden = true;
          badge.style.display = "none";
        }
      });
  };

  const scheduleKnownCampaignBoundary = () => {
    if (campaignExpiryTimer) {
      window.clearTimeout(campaignExpiryTimer);
      campaignExpiryTimer = null;
    }

    const now = Date.now();
    const boundaries = [...announcements, ...rawPromotions]
      .flatMap((item) => [item?.starts_at, item?.ends_at])
      .map(toTimestamp)
      .filter((timestamp) => timestamp !== null && timestamp > now);

    if (!boundaries.length) return;

    const nextBoundary = Math.min(...boundaries);
    campaignExpiryTimer = window.setTimeout(() => {
      campaignExpiryTimer = null;
      void load();
    }, Math.max(50, nextBoundary - now + 25));
  };

  const ensureCampaignPolling = () => {
    if (campaignPollTimer) return;

    campaignPollTimer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 30_000);
  };

  const load = async () => {
    try {
      const [annRes, promRes, prodRes] = await Promise.all([
        fetch(`${API_BASE_URL}/announcements`, {
          headers: { Accept: "application/json" },
        }).catch(() => null),
        fetch(`${API_BASE_URL}/promotions/active`, {
          headers: { Accept: "application/json" },
        }).catch(() => null),
        fetch(`${API_BASE_URL}/products`, {
          headers: { Accept: "application/json" },
        }).catch(() => null),
      ]);

      isLoading = false;

      const annPayload = annRes && annRes.ok ? await annRes.json() : null;
      const promPayload = promRes && promRes.ok ? await promRes.json() : null;
      const prodPayload = prodRes && prodRes.ok ? await prodRes.json() : null;

      if (Array.isArray(prodPayload?.data)) {
        productsCatalog = prodPayload.data;
      }

      // Task 1 requirement: Show ALL Saved Visitor Announcements across ALL customer website pages (Home, Services, Contact, Products)
      const visitorAnnouncements = Array.isArray(annPayload?.data)
        ? annPayload.data
        : announcements.filter((item) => !item.is_promotion);

      const nextRawPromotions = Array.isArray(promPayload?.data)
        ? promPayload.data
        : rawPromotions;
      rawPromotions = filterActiveCampaigns(nextRawPromotions);

      const activePromotions = rawPromotions.map((p) => {
        const appliesToDetail =
          p.scope === "all_products"
            ? "all products in our store"
            : getProductNamesString(p.product_ids);
        return {
          id: `promo_${p.id}`,
          title: `🎉 ${p.title} (${p.discount_percent}% OFF)`,
          message: `Special Product Promotion: Enjoy ${p.discount_percent}% OFF on ${appliesToDetail}!\n\nLimited-time campaign. Don't miss out on these savings!`,
          cta_label: "Shop Sale Items",
          cta_url: isProductsPage
            ? "#productCatalogGrid"
            : "/products-page/product.html",
          accent_color: "#c0392b",
          secondary_color: "#800000",
          placement: "both",
          is_enabled: true,
          is_live: true,
          is_promotion: true,
          starts_at: p.starts_at || null,
          ends_at: p.ends_at || null,
        };
      });

      const previousAnnouncements = announcements;
      const previousOpenItemId =
        modal && !modal.hidden
          ? previousAnnouncements[activeIndex]?.id
          : null;
      announcements = filterActiveCampaigns([
        ...visitorAnnouncements,
        ...activePromotions,
      ]);

      const promotionSignature = rawPromotions
        .map((promotion) =>
          [promotion.id, promotion.ends_at, promotion.discount_percent].join(":"),
        )
        .join("|");
      if (promotionSignature !== lastPromotionSignature) {
        lastPromotionSignature = promotionSignature;
        window.dispatchEvent(
          new CustomEvent("fmrc:promotions-updated", {
            detail: { promotions: rawPromotions },
          }),
        );
      }

      updateBadges(announcements.length);

      if (modal && !modal.hidden) {
        if (!announcements.length) {
          closeModal();
        } else {
          const nextIndex = previousOpenItemId
            ? announcements.findIndex((item) => item.id === previousOpenItemId)
            : -1;
          activeIndex =
            nextIndex >= 0
              ? nextIndex
              : Math.min(activeIndex, announcements.length - 1);
          showModal(activeIndex);
        }
      }

      if (announcements.length > 0 && !isTooltipDismissed()) {
        mountGlassTooltip();
      }

      if (isProductsPage) {
        applyProductSpotlight();
      }

      scheduleKnownCampaignBoundary();
      ensureCampaignPolling();

      // Auto pop surprise announcement modal ONLY on Homepage if not seen this session
      if (isHomePage && !isAdminOrStaff && announcements.length > 0) {
        const unseenIndex = announcements.findIndex(
          (item) => !hasSeen(item.id),
        );
        if (unseenIndex >= 0) {
          window.setTimeout(() => showModal(unseenIndex), 450);
        }
      }
    } catch (error) {
      isLoading = false;
      console.info(
        "Announcements and promotions are currently unavailable.",
        error,
      );
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    mountModalAndButtons();
    // Admin and Staff Promotions reuse the preview renderer from this file,
    // but their page module already owns the data request. Avoid a second
    // polling/foreground-refresh system on those management pages.
    if (!isAdminOrStaff) void load();
  });

  document.addEventListener("visibilitychange", () => {
    if (!isAdminOrStaff && !document.hidden) void load();
  });
})();
