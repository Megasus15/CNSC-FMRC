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

  /* ==========================================================================
     SHARED ANNOUNCEMENT / PROMOTION THEME
     --------------------------------------------------------------------------
     This theme paints the promotion card in the product page header. The
     announcement dialog has its own fixed palette. The theme is edited on the admin/staff Promotions page and
     saved to site_settings, so every customer sees it — localStorage is only a
     same-browser cache and the editor's own instant preview.

     Resolution order: what main.js published from /site-settings → what this
     script fetched itself → this browser's cache → the shipped defaults.
     ========================================================================== */

  const THEME_STORAGE_KEY = "fmrc_global_announcement_theme";

  const THEME_DEFAULTS = Object.freeze({
    primary: "#c0392b",
    secondary: "#800000",
    emojiLeft: "🎉",
    emojiRight: "🎉",
    eyebrow: "LIMITED-TIME PROMOTION",
  });

  // Clamp by code point, not by length: one emoji is a single glyph but two
  // UTF-16 units, so slicing the string could cut it in half.
  const safeEmoji = (value, fallback) =>
    typeof value === "string"
      ? [...value.trim()].slice(0, 4).join("")
      : fallback;

  const safeLabel = (value, fallback, limit = 48) =>
    typeof value === "string" ? value.trim().slice(0, limit) : fallback;

  // Filled by load() on customer pages that main.js does not publish for.
  let serverTheme = null;

  const storedTheme = () => {
    try {
      const parsed = JSON.parse(
        localStorage.getItem(THEME_STORAGE_KEY) || "null",
      );
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  };

  /**
   * A blank emoji or label survives — an admin who clears it wants it gone. Only
   * a value that was never saved falls through to the next source, so a site
   * that has never opened the theme editor looks exactly as it shipped.
   */
  const resolveTheme = () => {
    const published = window.FMRC_PROMO_THEME;
    const source =
      (published && typeof published === "object" ? published : null) ||
      serverTheme ||
      storedTheme() ||
      {};

    return {
      primary: safeColor(source.primary, THEME_DEFAULTS.primary),
      secondary: safeColor(source.secondary, THEME_DEFAULTS.secondary),
      emojiLeft: safeEmoji(source.emojiLeft, THEME_DEFAULTS.emojiLeft),
      emojiRight: safeEmoji(source.emojiRight, THEME_DEFAULTS.emojiRight),
      eyebrow: safeLabel(source.eyebrow, THEME_DEFAULTS.eyebrow),
      // True only once a colour has actually been saved. main.js publishes the
      // flag because it fills the defaults in itself; the other two sources
      // carry a colour only when one was stored.
      explicit:
        typeof source.explicit === "boolean"
          ? source.explicit
          : typeof source.primary === "string" ||
            typeof source.secondary === "string",
    };
  };

  /**
   * Keep only the keys the server actually stores, so a site with no theme row
   * yet leaves the browser cache and the defaults in charge instead of being
   * shadowed by an object full of undefined.
   */
  const readServerTheme = (settings) => {
    const map = {
      primary: "announcement_theme_primary",
      secondary: "announcement_theme_secondary",
      emojiLeft: "promo_spotlight_emoji_left",
      emojiRight: "promo_spotlight_emoji_right",
      eyebrow: "promo_spotlight_eyebrow",
    };
    const theme = {};
    Object.keys(map).forEach((field) => {
      const value = settings?.[map[field]];
      if (typeof value === "string") theme[field] = value;
    });
    return Object.keys(theme).length > 0 ? theme : null;
  };

  window.getGlobalFMRCTheme = () => resolveTheme();

  /**
   * Clear legacy announcement-theme overrides from an already-open dialog.
   * Custom colors belong exclusively to the Product promotion card; the
   * announcement dialog always keeps the shared maroon UX shell.
   */
  const applyModalTheme = (el) => {
    if (!el?.style) return;
    el.style.removeProperty("--announcement-band");
    el.style.removeProperty("--announcement-accent-primary");
    el.style.removeProperty("--announcement-accent-secondary");
  };

  /**
   * The three promotion-card decorations, resolved from the same source as the
   * colors so the Product promotion card and its editor preview can never drift
   * apart.
   */
  window.getGlobalFMRCPromoDecor = () => {
    const theme = resolveTheme();
    return {
      emojiLeft: theme.emojiLeft,
      emojiRight: theme.emojiRight,
      eyebrow: theme.eyebrow,
    };
  };

  /**
   * Cache the theme in this browser. The admin/staff Promotions page calls this
   * for the instant preview while editing; the saved-for-everyone copy is the
   * one written to site_settings. `decor` is optional, so the preset colour
   * cards keep working with two arguments.
   */
  window.setGlobalFMRCTheme = (primary, secondary, decor) => {
    const current = storedTheme() || {};
    const theme = {
      primary: safeColor(primary, THEME_DEFAULTS.primary),
      secondary: safeColor(secondary, THEME_DEFAULTS.secondary),
      emojiLeft: safeEmoji(
        decor?.emojiLeft ?? current.emojiLeft,
        THEME_DEFAULTS.emojiLeft,
      ),
      emojiRight: safeEmoji(
        decor?.emojiRight ?? current.emojiRight,
        THEME_DEFAULTS.emojiRight,
      ),
      eyebrow: safeLabel(
        decor?.eyebrow ?? current.eyebrow,
        THEME_DEFAULTS.eyebrow,
      ),
    };
    try {
      localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme));
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
  let badgeLabelEl;
  let titleEl;
  let messageEl;
  let ctaEl;
  let counterEl;
  let nextBtn;
  let previousBtn;
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

  // Both the live customer modal and the portal preview use this exact markup.
  const createAnnouncementCardMarkup = (item, counterText, {
    customer = false, navigation = false,
  } = {}) => {
    const id = (name) => customer ? ` id="announcementModal${name}"` : "";
    const title = item?.title || "Announcements";
    const message = item?.message || "There are no active announcements right now.";
    const badge = item?.is_promotion ? "SPECIAL PROMOTION" : "FMRC ANNOUNCEMENT";
    const hasCta = Boolean(item?.cta_label && item?.cta_url);
    return `
      <header class="fmrc-announcement__header">
        <button type="button" class="fmrc-announcement__close" data-announcement-close${id("CloseX")} aria-label="Close announcement">&times;</button>
        <span class="fmrc-announcement__badge" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h4l11-5v16l-11-5H4z"/><path d="M5 15l2 6h3l-2-6M8 9v6"/></svg></span>
        <div class="fmrc-announcement__heading">
          <p class="fmrc-announcement__eyebrow"${id("BadgeLabel")}>${badge}</p>
          <h2 class="fmrc-announcement__title"${id("Title")}>${esc(title)}</h2>
        </div>
      </header>
      <div class="fmrc-announcement__body">
        <p class="fmrc-announcement__message"${id("Message")}>${esc(message)}</p>
      </div>
      <footer class="fmrc-announcement__footer">
        <div class="fmrc-announcement__pager" role="group" aria-label="Announcement navigation">
          <button type="button" class="fmrc-announcement__button fmrc-announcement__arrow" data-announcement-previous${id("Previous")} aria-label="Previous announcement" ${navigation ? "" : "disabled"}>&lsaquo;</button>
          <span class="fmrc-announcement__counter"${id("Counter")} aria-live="polite" aria-atomic="true">${esc(counterText)}</span>
          <button type="button" class="fmrc-announcement__button fmrc-announcement__arrow" data-announcement-next${id("Next")} aria-label="Next announcement" ${navigation ? "" : "disabled"}>&rsaquo;</button>
        </div>
        <div class="fmrc-announcement__actions">
          <a class="fmrc-announcement__button fmrc-announcement__button--primary"${id("Cta")} data-announcement-cta ${hasCta ? `href="${esc(item.cta_url)}"` : "hidden"}>${esc(item?.cta_label || "View Details")}</a>
          <button type="button" class="fmrc-announcement__button" data-announcement-close${id("Close")}>Got it</button>
        </div>
      </footer>
    `;
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

    applyModalTheme(modal);
    if (badgeLabelEl) {
      badgeLabelEl.textContent = item?.is_promotion
        ? "SPECIAL PROMOTION"
        : "FMRC ANNOUNCEMENT";
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
        ? `${activeIndex + 1} of ${announcements.length}`
        : "0 of 0";
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

    [previousBtn, nextBtn].forEach((button) => {
      if (button) button.disabled = announcements.length < 2;
    });

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
          background: #fdfaf6;
          color: #870b14;
          cursor: pointer;
          font-size: 1.15rem;
          transform: none;
          transition: background-color 0.2s ease, border-color 0.2s ease;
        }
        .announcement-bell:hover {
          background: #fffbed;
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
          border: 2px solid #fdfaf6 !important;
          border-radius: 50% !important;
          background: var(--customer-wine, #6b202b) !important;
          color: #f7f2ec !important;
          font-family: "Montserrat", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
          font-weight: 800 !important;
          line-height: 1 !important;
          text-align: center !important;
          white-space: nowrap !important;
          box-shadow: 0 2px 6px rgba(58, 18, 18, 0.28);
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
          border-radius: 8px;
          background: #fdfaf6;
          border: 1px solid #eadc9a;
          box-shadow: 0 12px 35px rgba(128, 0, 0, 0.2), 0 2px 10px rgba(58, 18, 18, 0.08);
          color: #4b5563;
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
          border-bottom: 8px solid #fdfaf6;
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

        /* box-shadow used to be interpolated here alongside opacity and the
           translate. It is not a compositable property, and a keyframe set that
           touches even one non-compositable property cannot be promoted at all
           — so this pill woke the main thread for a style recalc, paint and
           raster on every single vsync, forever, and because the translate kept
           moving the sampled region its backdrop blur could never be cached.
           Opacity + transform only: same pulse, now entirely on the compositor.
           The static shadow on the rule above keeps the depth. */
        @keyframes fmrcGlassPulse {
          0%, 100% {
            opacity: 0.92;
            transform: translateY(0);
          }
          50% {
            opacity: 1;
            transform: translateY(5px);
          }
        }
        
        .announcement-modal {
          position: fixed;
          inset: 0;
          z-index: 10050;
          display: grid;
          place-items: center;
          padding: 20px;
          background: var(--ux-dlg-scrim, rgba(15, 23, 42, 0.55));
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.25s ease;
        }
        .announcement-modal.is-visible {
          opacity: 1;
          pointer-events: auto;
        }
        .announcement-modal[hidden] { display: none !important; }
        
        @media (max-width: 280px) {
          .announcement-glass-tooltip {
            position: fixed;
            top: max(78px, calc(env(safe-area-inset-top, 0px) + 78px));
            right: 5px;
            left: 5px;
            width: auto;
            max-width: none;
            padding: 8px;
          }
          .announcement-glass-tooltip__arrow { display: none; }
          .announcement-glass-tooltip__content { align-items: flex-start; gap: 6px; }
        }

        /* Transform only — "opacity" is deliberately NOT animated here.
           "animation-fill-mode" is "none", so while this animation is *active*
           its first frame is what paints, and a timeline that is frozen or
           throttled (a background tab, a page under paint-holding) sits on
           frame 0 indefinitely. With "opacity: 0" in that frame the scrim came
           up fully while the card stayed invisible — a dialog that is open,
           interactive and impossible to see. The overlay above already fades
           0 → 1 on ".is-visible", so the fade was duplicated anyway; dropping
           it from here means the worst a stalled timeline can do is leave the
           card 18px low and 4% small, still fully legible. */
        @keyframes fmrcAnnouncementIn {
          from { transform: translateY(18px) scale(0.96); }
          to { transform: translateY(0) scale(1); }
        }
      `;
      document.head.appendChild(style);
    }

    window.renderFMRCAnnouncementPreviewCard = (
      container, item, counterText = "", { navigation = false, onPrevious, onNext } = {},
    ) => {
      if (!container) return;
      container.classList.remove("announcement-modal__card", "ux-dlg__card");
      container.classList.add("fmrc-announcement-card");
      applyModalTheme(container);
      container.innerHTML = createAnnouncementCardMarkup(item, counterText, { navigation });
      container.querySelector("[data-announcement-previous]")?.addEventListener("click", () => onPrevious?.());
      container.querySelector("[data-announcement-next]")?.addEventListener("click", () => onNext?.());
      container.querySelector("[data-announcement-cta]")?.addEventListener("click", (event) => event.preventDefault());
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
        <div class="fmrc-announcement-card">
          ${createAnnouncementCardMarkup({ message: "Loading announcements..." }, "0 of 0", { customer: true })}
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
      modal.setAttribute("aria-labelledby", "announcementModalTitle");

      const requiredModalControls = [
        "#announcementModalCloseX",
        "#announcementModalClose",
        "#announcementModalNext",
        "#announcementModalPrevious",
        "#announcementModalCta",
        ".fmrc-announcement__actions",
        ".fmrc-announcement__footer",
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
      badgeLabelEl = modal.querySelector("#announcementModalBadgeLabel");
      messageEl = modal.querySelector("#announcementModalMessage");
      ctaEl = modal.querySelector("#announcementModalCta");
      counterEl = modal.querySelector("#announcementModalCounter");
      nextBtn = modal.querySelector("#announcementModalNext");
      previousBtn = modal.querySelector("#announcementModalPrevious");

      const closeElements = modal.querySelectorAll("[data-announcement-close]");
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

      previousBtn?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        showModal(activeIndex - 1);
      });

      // Announcements are a modal, so clicking the scrim must NOT dismiss them —
      // the customer has to use the in-card close X or the action buttons. Escape
      // stays wired up below so keyboard users are never trapped.

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
        <span style="font-size:1.15rem; filter:drop-shadow(0 2px 4px rgba(58,18,18,0.15));">✨</span>
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
      const theme = resolveTheme();
      spotlight.style.display = "block";
      spotlight.classList.add("is-visible");
      // The card's gradient reads these two variables, so it carries the
      // promotion-card colors selected in Admin or Staff.
      spotlight.style.setProperty(
        "--announcement-accent-primary",
        theme.primary,
      );
      spotlight.style.setProperty(
        "--announcement-accent-secondary",
        theme.secondary,
      );
      applySpotlightDecor(theme);

      const headline = document.getElementById("promotionSpotlightTitle");
      const copy = document.getElementById("promotionSpotlightMessage");

      const appliesToDetail =
        activePromo.scope === "all_products"
          ? "all products in our store"
          : getProductNamesString(activePromo.product_ids);

      if (headline) {
        const lead = theme.emojiLeft ? `${esc(theme.emojiLeft)} ` : "";
        headline.innerHTML = `${lead}${esc(activePromo.title)}`;
      }
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

  /**
   * The two side emojis and the small label above the title. Each element has an
   * inline style already, so visibility is set through style.display — the
   * `hidden` attribute would lose to the element's own inline display.
   */
  const applySpotlightDecor = (theme) => {
    const setEmoji = (id, value) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = value;
      el.style.display = value === "" ? "none" : "";
    };
    setEmoji("promotionSpotlightEmojiLeft", theme.emojiLeft);
    setEmoji("promotionSpotlightEmojiRight", theme.emojiRight);

    const eyebrowText = document.getElementById("promotionSpotlightEyebrowText");
    if (eyebrowText) eyebrowText.textContent = theme.eyebrow;
    const eyebrow = document.getElementById("promotionSpotlightEyebrow");
    // Clearing the label hides its icon and pill too, rather than leaving a
    // stray flame floating above the headline.
    if (eyebrow)
      eyebrow.style.display = theme.eyebrow === "" ? "none" : "inline-flex";
  };

  /** Recolour an already-open pop-up without re-running its render. */
  const repaintOpenModalTheme = () => {
    if (!modal) return;
    applyModalTheme(modal);
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
      const [annRes, promRes, prodRes, setRes] = await Promise.all([
        fetch(`${API_BASE_URL}/announcements`, {
          headers: { Accept: "application/json" },
        }).catch(() => null),
        fetch(`${API_BASE_URL}/promotions/active`, {
          headers: { Accept: "application/json" },
        }).catch(() => null),
        fetch(`${API_BASE_URL}/products`, {
          headers: { Accept: "application/json" },
        }).catch(() => null),
        // The shared theme arrives from main.js, which already reads
        // /site-settings on load and re-reads it every 20 s, then publishes
        // window.FMRC_PROMO_THEME and fires `fmrc:promotion-theme` — which the
        // listener at the bottom of this file repaints from. So this request is
        // only a fallback for a page that ships without main.js.
        //
        // It is gated on the ownership flag main.js sets at parse time, not on
        // the published theme: the theme only exists after main.js's own response
        // lands, so on a cold load this fallback always fired and every customer
        // page read the heaviest payload on the site twice.
        window.FMRC_SITE_CONTENT_OWNER || window.FMRC_PROMO_THEME
          ? Promise.resolve(null)
          : fetch(`${API_BASE_URL}/site-settings`, {
              headers: { Accept: "application/json" },
            }).catch(() => null),
      ]);

      isLoading = false;

      const annPayload = annRes && annRes.ok ? await annRes.json() : null;
      const promPayload = promRes && promRes.ok ? await promRes.json() : null;
      const prodPayload = prodRes && prodRes.ok ? await prodRes.json() : null;
      if (setRes && setRes.ok) {
        const setPayload = await setRes.json().catch(() => null);
        const fetchedTheme = readServerTheme(setPayload?.data);
        if (fetchedTheme) serverTheme = fetchedTheme;
      }
      const theme = resolveTheme();

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
          title: `${theme.emojiLeft ? `${theme.emojiLeft} ` : ""}${p.title} (${p.discount_percent}% OFF)`,
          message: `Special Product Promotion: Enjoy ${p.discount_percent}% OFF on ${appliesToDetail}!\n\nLimited-time campaign. Don't miss out on these savings!`,
          cta_label: "Shop Sale Items",
          cta_url: isProductsPage
            ? "#productCatalogGrid"
            : "/products-page/product.html",
          accent_color: theme.primary,
          secondary_color: theme.secondary,
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
          /* Only close a dialog that was showing a real item which has since
             gone away — an announcement that expires mid-read should not be
             left on screen. `previousOpenItemId` is exactly that test: it is
             null when the open dialog was the "no active announcements right
             now" state, which is what the customer sees after tapping the bell
             on a site with nothing published.

             Without this guard that empty state could not be read at all. Three
             things call `load()` — the 30s poll at :1279, `visibilitychange`,
             and the boot load — and every one of them found `!modal.hidden` and
             `announcements.length === 0` true and closed the dialog the
             customer had just opened. The bell → focus-the-tab → click order is
             the common one, so the boot/refocus load was usually still in
             flight when the dialog appeared and shut it within the same tick:
             the reported "the announcement doesn't open". It did open. It was
             being closed again immediately. */
          if (previousOpenItemId) closeModal();
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

  // main.js re-reads /site-settings every 20 s and announces a changed
  // promotion-card theme, so an admin's save reaches an open Products page
  // without a reload.
  document.addEventListener("fmrc:promotion-theme", () => {
    if (isAdminOrStaff) return;
    if (isProductsPage) applyProductSpotlight();
    repaintOpenModalTheme();
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
