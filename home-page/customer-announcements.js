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
  const isAdminOrStaff = /admin-page|staff-page|admin-auth/i.test(
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

  // ── Read tracking ───────────────────────────────────────────────────────────
  // The bell badge counts UNREAD announcements only. Read state is stored per
  // customer (falling back to a shared guest bucket) so the count stays in sync
  // across Home, Services, Products and Contact.
  const READ_STATE_PREFIX = "fmrc_announcements_read_";

  const getReadStateKey = () => {
    let scope = "guest";
    try {
      const raw = localStorage.getItem("customer_info");
      if (raw) {
        const info = JSON.parse(raw);
        if (info?.id) scope = String(info.id);
        else if (info?.email) scope = String(info.email);
      }
    } catch {
      scope = "guest";
    }
    return `${READ_STATE_PREFIX}${scope}`;
  };

  const loadReadIds = () => {
    try {
      const raw = localStorage.getItem(getReadStateKey());
      const parsed = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
    } catch {
      return new Set();
    }
  };

  const saveReadIds = (readIds) => {
    try {
      localStorage.setItem(getReadStateKey(), JSON.stringify([...readIds]));
    } catch {
      /* storage optional */
    }
  };

  const markAnnouncementRead = (id) => {
    if (id === undefined || id === null || id === "") return false;
    const readIds = loadReadIds();
    if (readIds.has(String(id))) return false;
    readIds.add(String(id));
    saveReadIds(readIds);
    return true;
  };

  const getUnreadCount = () => {
    const readIds = loadReadIds();
    return announcements.filter((item) => !readIds.has(String(item?.id)))
      .length;
  };

  // Drop read IDs for campaigns that no longer exist so the store cannot grow
  // without bound as announcements and promotions expire.
  const pruneReadIds = () => {
    const readIds = loadReadIds();
    if (!readIds.size) return;
    const liveIds = new Set(announcements.map((item) => String(item?.id)));
    let changed = false;
    readIds.forEach((id) => {
      if (!liveIds.has(id)) {
        readIds.delete(id);
        changed = true;
      }
    });
    if (changed) saveReadIds(readIds);
  };

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
      updateBadges(getUnreadCount());
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
    if (item) {
      markSeen(item.id);
      // Viewing an announcement marks it read, which decrements the bell badge.
      if (markAnnouncementRead(item.id)) updateBadges(getUnreadCount());
    }
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
          top: -2px !important;
          right: -2px !important;
          box-sizing: border-box;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 22px !important;
          min-width: 22px !important;
          max-width: 22px !important;
          height: 22px !important;
          min-height: 22px !important;
          max-height: 22px !important;
          padding: 0 !important;
          border: 2px solid #ffffff !important;
          border-radius: 50% !important;
          background: linear-gradient(135deg, #ef4444, #991b1b) !important;
          color: #ffffff !important;
          font-family: "Montserrat", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
          font-weight: 800 !important;
          line-height: 1 !important;
          text-align: center !important;
          white-space: nowrap !important;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.28);
          pointer-events: none;
          user-select: none;
          font-size: 8px;
          letter-spacing: -0.04em;
        }
        .announcement-bell__badge[data-length="1"] { font-size: 10.5px !important; letter-spacing: 0 !important; }
        .announcement-bell__badge[data-length="2"] { font-size: 8.5px !important; letter-spacing: -0.04em !important; }
        .announcement-bell__badge[data-length="3"] { font-size: 7.5px !important; letter-spacing: -0.06em !important; }
        .announcement-bell__badge[hidden], .announcement-bell__badge:empty { display: none !important; }
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
          color: #ffffff;
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

        /* Runtime styles are appended after the shared stylesheets, so the
           responsive safeguards live here as well. This keeps announcement
           content and every action reachable on narrow and short screens. */
        @media (max-width: 420px) {
          .announcement-modal {
            padding: max(8px, env(safe-area-inset-top, 0px))
              max(8px, env(safe-area-inset-right, 0px))
              max(8px, env(safe-area-inset-bottom, 0px))
              max(8px, env(safe-area-inset-left, 0px));
            overflow-y: auto;
          }

          .announcement-modal__card {
            width: 100%;
            max-width: 100%;
            max-height: calc(100dvh - 16px);
            overflow-y: auto;
            border-radius: 16px;
          }

          .announcement-modal__hero {
            padding: 22px 50px 18px 20px;
          }

          .announcement-modal__body {
            padding: 20px;
          }

          .announcement-modal__message {
            overflow-wrap: anywhere;
          }

          .announcement-modal__actions,
          .announcement-modal__actions > div {
            display: grid !important;
            grid-template-columns: 1fr;
            width: 100%;
            gap: 8px !important;
          }

          .announcement-modal__actions > div {
            margin-left: 0 !important;
          }

          .announcement-modal__button {
            width: 100%;
            min-width: 0;
            white-space: normal;
            overflow-wrap: anywhere;
          }
        }

        @media (max-width: 280px) {
          .announcement-glass-tooltip {
            position: fixed;
            top: max(78px, calc(env(safe-area-inset-top, 0px) + 78px));
            right: max(5px, env(safe-area-inset-right, 0px));
            left: max(5px, env(safe-area-inset-left, 0px));
            width: auto;
            max-width: none;
            padding: 8px;
            border-radius: 12px;
          }

          .announcement-glass-tooltip__arrow {
            display: none;
          }

          .announcement-glass-tooltip__content {
            align-items: flex-start;
            gap: 6px;
          }

          .announcement-modal {
            padding: max(5px, env(safe-area-inset-top, 0px))
              max(5px, env(safe-area-inset-right, 0px))
              max(5px, env(safe-area-inset-bottom, 0px))
              max(5px, env(safe-area-inset-left, 0px));
          }

          .announcement-modal__card {
            max-height: calc(100dvh - 10px);
            border-radius: 12px;
          }

          .announcement-modal__hero,
          .announcement-modal__body {
            padding: 10px;
          }

          .announcement-modal__hero {
            padding-right: 42px;
          }

          .announcement-modal__title {
            font-size: clamp(0.82rem, 10vw, 1.1rem);
            overflow-wrap: anywhere;
          }

          .announcement-modal__label,
          .announcement-modal__counter {
            font-size: 0.6rem;
            overflow-wrap: anywhere;
          }

          .announcement-modal__message,
          .announcement-modal__button {
            font-size: clamp(0.62rem, 7.5vw, 0.78rem);
          }

          .announcement-modal__close-x {
            top: 6px;
            right: 6px;
            width: 32px;
            height: 32px;
          }
        }

        @media (max-height: 430px) {
          .announcement-modal {
            place-items: start center;
          }
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
              <span class="announcement-bell__badge" id="announcementBellBadge" hidden></span>
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
            // Open on the first unread item so repeated bell clicks work
            // through the queue and the badge counts down to zero.
            const readIds = loadReadIds();
            const firstUnread = announcements.findIndex(
              (item) => !readIds.has(String(item?.id)),
            );
            showModal(firstUnread >= 0 ? firstUnread : activeIndex);
          });
        });
    }

    // 3. Ensure Modal HTML exists for customer pages
    if (!isAdminOrStaff) {
      modal = document.getElementById("announcementModal");
      const createModalInnerHtml = () => `
        <div class="announcement-modal__card ux-dlg__card">
          <div class="announcement-modal__hero ux-dlg__head">
            <button type="button" class="announcement-modal__close-x ux-dlg__close" id="announcementModalCloseX" aria-label="Close announcement">&times;</button>
            <span class="ux-dlg__badge" aria-hidden="true"><i class="fa-solid fa-bullhorn"></i></span>
            <p class="announcement-modal__label ux-dlg__eyebrow" id="announcementModalBadgeLabel">FMRC ANNOUNCEMENT</p>
            <h2 class="announcement-modal__title ux-dlg__title" id="announcementModalTitle">Announcements</h2>
          </div>
          <div class="announcement-modal__body ux-dlg__body">
            <p class="announcement-modal__message ux-dlg__text" id="announcementModalMessage">Loading announcements...</p>
          </div>
          <div class="announcement-modal__actions ux-dlg__foot">
            <span class="announcement-modal__counter" id="announcementModalCounter"></span>
            <button type="button" class="announcement-modal__button announcement-modal__button--secondary ux-dlg__btn ux-dlg__btn--ghost" id="announcementModalNext" hidden>Next</button>
            <a class="announcement-modal__button announcement-modal__button--primary ux-dlg__btn ux-dlg__btn--ghost" id="announcementModalCta" hidden>View Details</a>
            <button type="button" class="announcement-modal__button announcement-modal__button--secondary ux-dlg__btn ux-dlg__btn--primary" id="announcementModalClose">Got it</button>
          </div>
        </div>
      `;

      if (!modal) {
        modal = document.createElement("div");
        modal.className = "announcement-modal ux-dlg";
        modal.id = "announcementModal";
        modal.hidden = true;
        modal.setAttribute("role", "dialog");
        modal.setAttribute("aria-modal", "true");
        modal.innerHTML = createModalInnerHtml();
        document.body.appendChild(modal);
      }

      // The shared dialog shell is scoped to `.ux-dlg`, so guarantee the hook
      // even when the page shipped the markup before the unified redesign.
      modal.classList.add("ux-dlg");

      const requiredModalControls = [
        "#announcementModalCloseX",
        "#announcementModalClose",
        "#announcementModalNext",
        "#announcementModalCta",
        ".ux-dlg__foot",
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
    const total = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
    const displayCount = total > 99 ? "99+" : String(total);
    document
      .querySelectorAll("#announcementBellBadge, .announcement-bell__badge")
      .forEach((badge) => {
        if (total > 0) {
          // Keep the navbar badge compact: 99 is the largest numeric value;
          // larger counts use 99+ so a third digit never overflows the circle.
          badge.textContent = displayCount;
          badge.dataset.length = String(displayCount.length);
          badge.hidden = false;
          badge.style.display = "flex";
        } else {
          badge.textContent = "";
          badge.dataset.length = "0";
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

      pruneReadIds();
      updateBadges(getUnreadCount());

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

  // Keep the bell badge in sync when the customer reads an announcement in
  // another open tab (Home, Services, Products or Contact).
  window.addEventListener("storage", (event) => {
    if (isAdminOrStaff) return;
    const key = String(event?.key || "");
    if (key === "customer_info" || key.startsWith(READ_STATE_PREFIX)) {
      updateBadges(getUnreadCount());
    }
  });
})();
