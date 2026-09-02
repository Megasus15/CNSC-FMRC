// Execute as early as possible to prevent initial CSS transitions flashing
if (document.body) {
  document.body.classList.add("no-transitions");
}

document.addEventListener("DOMContentLoaded", () => {
  const MOBILE_BREAKPOINT = 1024;
  const SIDEBAR_PREF_KEY = "adminSidebarMobileState";
  const DASHBOARD_REQUEST_TIMEOUT_MS = 15000;
  /* #dashboardRefreshBtn deliberately has NO handler here. It reloads the page
     from `onclick="window.location.reload()"` in dashboard.html, the same as
     Inventory, Accounts, Appointments, Products and Promotions. */
  const DASHBOARD_MIN_SYNC_GAP_MS = 2500;
  const DASHBOARD_EVENT_DEBOUNCE_MS = 300;
  const DASHBOARD_LIVE_POLL_MS = 30000;
  const DASHBOARD_ORDERS_SIGNAL_KEY = "fmrc_orders_updated_at";
  const DASHBOARD_ORDERS_CHANNEL = "fmrc-orders-realtime";

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

  const body = document.body;
  const sidebar = document.querySelector(".sidebar");
  const sidebarHeader = document.querySelector(".sidebar-header");
  const sidebarNav = document.querySelector(".sidebar-nav");
  const indicatorThumb = document.querySelector(
    ".sidebar-scroll-indicator .indicator-thumb",
  );

  let sidebarToggleBtn = null;
  let sidebarBackdrop = null;
  let dashboardOrdersChannel = null;
  let dashboardSyncInProgress = false;
  let dashboardSyncController = null;
  let dashboardSyncRequestId = 0;
  let dashboardLastSyncAt = 0;
  let dashboardLastRealtimeSignalTs = 0;
  let dashboardPendingForceSync = false;
  let dashboardQueuedSyncTimer = null;
  let dashboardLiveCountsTimer = null;
  let dashboardLiveCountsController = null;
  let dashboardLastLiveCountsAt = 0;
  let dashboardHasGoodSummary = false;
  let unsubscribeAdminLiveData = null;

  const getDashboardOrdersChannel = () => {
    if (typeof window.BroadcastChannel !== "function") return null;
    if (!dashboardOrdersChannel) {
      dashboardOrdersChannel = new window.BroadcastChannel(
        DASHBOARD_ORDERS_CHANNEL,
      );
    }
    return dashboardOrdersChannel;
  };

  const isMobileSidebarMode = () => window.innerWidth <= MOBILE_BREAKPOINT;

  const saveSidebarState = (isOpen) => {
    try {
      localStorage.setItem(SIDEBAR_PREF_KEY, isOpen ? "open" : "closed");
    } catch {
      // Ignore storage failures in private/incognito modes.
    }
  };

  const getSavedSidebarState = () => {
    try {
      return localStorage.getItem(SIDEBAR_PREF_KEY) === "open";
    } catch {
      return false;
    }
  };

  const closeMobileSidebar = () => {
    body.classList.remove("admin-sidebar-open");
    if (sidebarToggleBtn)
      sidebarToggleBtn.setAttribute("aria-expanded", "false");
    saveSidebarState(false);
  };

  const openMobileSidebar = () => {
    if (!isMobileSidebarMode()) return;
    body.classList.add("admin-sidebar-open");
    if (sidebarToggleBtn)
      sidebarToggleBtn.setAttribute("aria-expanded", "true");
    saveSidebarState(true);
  };

  const toggleMobileSidebar = () => {
    if (!isMobileSidebarMode()) return;
    if (body.classList.contains("admin-sidebar-open")) {
      closeMobileSidebar();
    } else {
      openMobileSidebar();
    }
  };

  const ensureMobileSidebarChrome = () => {
    if (!sidebar || !sidebarHeader) return;

    sidebarToggleBtn = sidebarHeader.querySelector(".admin-sidebar-toggle");
    if (!sidebarToggleBtn) {
      sidebarToggleBtn = document.createElement("button");
      sidebarToggleBtn.type = "button";
      sidebarToggleBtn.className = "admin-sidebar-toggle";
      sidebarToggleBtn.setAttribute("aria-label", "Toggle sidebar navigation");
      sidebarToggleBtn.setAttribute("aria-expanded", "false");
      sidebarToggleBtn.innerHTML = "<span></span><span></span><span></span>";
      sidebarHeader.appendChild(sidebarToggleBtn);
    }

    sidebarBackdrop = document.querySelector(".admin-sidebar-backdrop");
    if (!sidebarBackdrop) {
      sidebarBackdrop = document.createElement("div");
      sidebarBackdrop.className = "admin-sidebar-backdrop";
      body.appendChild(sidebarBackdrop);
    }

    if (!sidebarToggleBtn.dataset.bound) {
      sidebarToggleBtn.addEventListener("click", toggleMobileSidebar);
      sidebarToggleBtn.dataset.bound = "1";
    }

    if (!sidebarBackdrop.dataset.bound) {
      sidebarBackdrop.addEventListener("click", closeMobileSidebar);
      sidebarBackdrop.dataset.bound = "1";
    }
  };

  const wrapTextAsNavLabel = (container) => {
    if (!container || container.querySelector(".nav-label")) return;

    const textNodes = Array.from(container.childNodes).filter(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
    );

    if (!textNodes.length) return;

    const labelText = textNodes
      .map((node) => node.textContent.trim())
      .join(" ");
    textNodes.forEach((node) => node.remove());

    const label = document.createElement("span");
    label.className = "nav-label";
    label.textContent = labelText;
    container.appendChild(label);
  };

  const decorateSidebarLabels = () => {
    sidebarNav?.querySelectorAll(".nav-link").forEach((link) => {
      const dropdownTitle = link.querySelector(".dropdown-title");
      if (dropdownTitle) {
        wrapTextAsNavLabel(dropdownTitle);
      } else {
        wrapTextAsNavLabel(link);
      }
    });

    sidebarNav?.querySelectorAll(".sub-link").forEach((link) => {
      wrapTextAsNavLabel(link);
    });

    const logoutBtn = document.querySelector(".sidebar-footer .logout-btn");
    if (logoutBtn) {
      wrapTextAsNavLabel(logoutBtn);
    }
  };

  const syncSidebarMode = () => {
    if (isMobileSidebarMode()) {
      if (getSavedSidebarState()) {
        body.classList.add("admin-sidebar-open");
        if (sidebarToggleBtn)
          sidebarToggleBtn.setAttribute("aria-expanded", "true");
      } else {
        body.classList.remove("admin-sidebar-open");
        if (sidebarToggleBtn)
          sidebarToggleBtn.setAttribute("aria-expanded", "false");
      }
    } else {
      body.classList.remove("admin-sidebar-open");
      if (sidebarToggleBtn)
        sidebarToggleBtn.setAttribute("aria-expanded", "false");
    }
    updateSidebarScrollIndicator();
  };

  const updateSidebarScrollIndicator = () => {
    if (!sidebar || !sidebarNav || !indicatorThumb) return;

    const maxScroll = sidebarNav.scrollHeight - sidebarNav.clientHeight;
    const isScrollable = maxScroll > 1;

    sidebar.classList.toggle("has-scroll-indicator", isScrollable);

    if (!isScrollable) {
      indicatorThumb.style.height = "100%";
      indicatorThumb.style.transform = "translateY(0)";
      return;
    }

    const thumbHeight = Math.max(
      (sidebarNav.clientHeight / sidebarNav.scrollHeight) * 100,
      16,
    );
    const travel = 100 - thumbHeight;
    const thumbTop = (sidebarNav.scrollTop / maxScroll) * travel;

    indicatorThumb.style.height = `${thumbHeight}%`;
    indicatorThumb.style.transform = `translateY(${thumbTop}%)`;
  };

  // Note: Dropdown logic is handled by admin-common.js with direct event listener on #adminControlBtn
  // Do not add duplicate listeners here to avoid conflicts

  sidebarNav?.addEventListener("scroll", updateSidebarScrollIndicator);
  window.addEventListener("resize", syncSidebarMode);

  const ensureMyAccountEntry = () => {
    if (!sidebarNav) return;

    let accountLink = sidebarNav.querySelector('a[href="my-account.html"]');
    if (!accountLink) {
      const archivesLink = sidebarNav.querySelector('a[href="archives.html"]');
      accountLink = document.createElement("a");
      accountLink.href = "my-account.html";
      accountLink.className = "nav-link";
      accountLink.innerHTML =
        '<i class="fa-regular fa-id-card"></i> My Account';
      if (archivesLink) {
        archivesLink.insertAdjacentElement("afterend", accountLink);
      } else {
        sidebarNav.appendChild(accountLink);
      }
    }

    if (window.location.pathname.toLowerCase().endsWith("/my-account.html")) {
      accountLink.classList.add("active");
    }

    const popup = document.getElementById("profilePopup");
    if (popup && !popup.querySelector('a[href="my-account.html"]')) {
      const popupLink = document.createElement("a");
      popupLink.href = "my-account.html";
      popupLink.className = "profile-popup-link";
      popupLink.innerHTML = '<i class="fa-regular fa-id-card"></i> My Account';
      const divider = popup.querySelector("hr");
      if (divider) {
        popup.insertBefore(popupLink, divider);
      } else {
        popup.appendChild(popupLink);
      }
    }
  };

  ensureMyAccountEntry();
  decorateSidebarLabels();
  ensureMobileSidebarChrome();
  updateSidebarScrollIndicator();

  // Remove the no-transitions class once the browser has painted the initial state
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      body.classList.remove("no-transitions");
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && body.classList.contains("admin-sidebar-open")) {
      closeMobileSidebar();
    }
  });

  // 2. Dashboard quick-link card navigation
  const normalizeText = (value) =>
    value.replace(/\s+/g, " ").trim().toLowerCase();
  const sidebarLinks = Array.from(
    document.querySelectorAll(".sidebar-nav .nav-link, .sidebar-nav .sub-link"),
  );

  const resolveSidebarRoute = (navLabel) => {
    const normalizedLabel = normalizeText(navLabel);
    return sidebarLinks.find((link) =>
      normalizeText(link.textContent).includes(normalizedLabel),
    );
  };

  document.querySelectorAll(".summary-cards .card-link").forEach((card) => {
    card.addEventListener("click", (e) => {
      const navLabel = card.dataset.navLabel;
      if (!navLabel) return;

      const sidebarMatch = resolveSidebarRoute(navLabel);
      if (!sidebarMatch) return;

      const targetHref = sidebarMatch.getAttribute("href") || "#";
      if (targetHref === "#") {
        e.preventDefault();
        sidebarMatch.classList.add("active");
        setTimeout(() => sidebarMatch.classList.remove("active"), 900);
      }
    });
  });

  const ensureLoader = () => {
    let loader = document.getElementById("global-loader");
    if (!loader) {
      loader = document.createElement("div");
      loader.id = "global-loader";
      loader.className = "global-loader-overlay";
      loader.innerHTML = '<div class="laravel-spinner"></div>';
      document.body.appendChild(loader);
    }
    return loader;
  };

  const setLoading = (active) => {
    ensureLoader().classList.toggle("active", active);
  };

  const ensureStatusModal = () => {
    let modal = document.getElementById("authStatusModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "authStatusModal";
      modal.className = "status-modal";
      modal.innerHTML = '<div class="status-box" id="authStatusText"></div>';
      document.body.appendChild(modal);
    }
    return {
      modal,
      text: document.getElementById("authStatusText"),
    };
  };

  const showStatus = (message) => {
    const { modal, text } = ensureStatusModal();
    if (text) text.textContent = message;
    modal.classList.add("show");
  };

  const showLogoutConfirmModal = (onConfirm) => {
    let modal = document.getElementById("laravelLogoutModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "laravelLogoutModal";
      modal.innerHTML = `
          <div style="position: fixed; inset: 0; background: rgba(17, 24, 39, 0.6); backdrop-filter: blur(2px); display: flex; justify-content: center; align-items: center; z-index: 100000; opacity: 0; transition: opacity 0.2s ease;">
            <div style="background: #fff; border-radius: 12px; width: 100%; max-width: 420px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04); transform: scale(0.95); transition: transform 0.2s ease; font-family: 'Montserrat', sans-serif; overflow: hidden;">
              <div style="padding: 24px;">
                <div style="display: flex; align-items: center; gap: 14px; margin-bottom: 16px;">
                  <div style="width: 40px; height: 40px; border-radius: 50%; background: #fee2e2; display: flex; justify-content: center; align-items: center; flex-shrink: 0;">
                    <svg width="24" height="24" fill="none" stroke="#dc2626" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                  </div>
                  <h2 style="font-size: 1.25rem; font-weight: 600; color: #111827; margin: 0;">Confirm Logout</h2>
                </div>
                <p style="font-size: 0.9rem; color: #4b5563; margin: 0 0 0 54px; line-height: 1.5;">Are you sure you want to log out from your account? You will need to sign in again to access the portal.</p>
              </div>
              <div style="display: flex; justify-content: flex-end; gap: 12px; background: #f9fafb; padding: 16px 24px; border-top: 1px solid #f3f4f6;">
                <button id="cancelLogoutBtn" style="padding: 8px 16px; background: #fff; border: 1px solid #d1d5db; border-radius: 6px; cursor: pointer; color: #374151; font-weight: 600; font-family: inherit; font-size: 0.875rem; transition: background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease, transform 0.08s ease;">Cancel</button>
                <button id="confirmLogoutBtn" style="padding: 8px 16px; background: var(--primary-color, #a80f0f); border: none; border-radius: 6px; cursor: pointer; color: #fff; font-weight: 600; font-family: inherit; font-size: 0.875rem; transition: background-color 0.2s ease, transform 0.08s ease, box-shadow 0.2s ease;">Log Out</button>
              </div>
            </div>
          </div>
        `;
      document.body.appendChild(modal);

      const cancelBtn = modal.querySelector("#cancelLogoutBtn");
      const confirmBtn = modal.querySelector("#confirmLogoutBtn");

      cancelBtn.onmouseenter = () => {
        cancelBtn.style.backgroundColor = "#fee2e2";
        cancelBtn.style.color = "#dc2626";
        cancelBtn.style.borderColor = "#fca5a5";
      };
      cancelBtn.onmouseleave = () => {
        cancelBtn.style.backgroundColor = "#fff";
        cancelBtn.style.color = "#374151";
        cancelBtn.style.borderColor = "#d1d5db";
        cancelBtn.style.transform = "scale(1)";
      };
      cancelBtn.onmousedown = () => (cancelBtn.style.transform = "scale(0.96)");
      cancelBtn.onmouseup = () => (cancelBtn.style.transform = "scale(1)");

      confirmBtn.onmouseenter = () => {
        confirmBtn.style.backgroundColor = "#7f1d1d";
        confirmBtn.style.boxShadow =
          "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)";
      };
      confirmBtn.onmouseleave = () => {
        confirmBtn.style.backgroundColor = "var(--primary-color, #a80f0f)";
        confirmBtn.style.boxShadow = "none";
        confirmBtn.style.transform = "scale(1)";
      };
      confirmBtn.onmousedown = () =>
        (confirmBtn.style.transform = "scale(0.96)");
      confirmBtn.onmouseup = () => (confirmBtn.style.transform = "scale(1)");

      cancelBtn.addEventListener("click", () => {
        modal.children[0].style.opacity = "0";
        modal.children[0].children[0].style.transform = "scale(0.95)";
        setTimeout(() => (modal.style.display = "none"), 200);
      });

      confirmBtn.addEventListener("click", () => {
        modal.children[0].style.opacity = "0";
        modal.children[0].children[0].style.transform = "scale(0.95)";
        setTimeout(() => {
          modal.style.display = "none";
          onConfirm();
        }, 200);
      });
    }

    modal.style.display = "block";
    requestAnimationFrame(() => {
      modal.children[0].style.opacity = "1";
      modal.children[0].children[0].style.transform = "scale(1)";
    });
  };

  const performLogout = async () => {
    const token =
      (window.AdminSession && window.AdminSession.getToken()) ||
      localStorage.getItem("auth_token");
    setLoading(true);
    try {
      if (token) {
        await fetch(`${API_BASE_URL}/logout`, {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            Accept: "application/json",
          },
        });
      }
    } catch {
      // Local session cleanup is still required.
    } finally {
      if (window.AdminSession) {
        window.AdminSession.clearSession();
      }
      localStorage.removeItem("auth_token");
      localStorage.removeItem("user_info");
      setLoading(false);
      showStatus("Logged out successfully.");
      window.location.href = "../admin-auth/auth.html";
    }
  };

  document.querySelectorAll(".logout-btn").forEach((button) => {
    if (button.dataset.logoutBound === "1") return;
    button.dataset.logoutBound = "1";
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      showLogoutConfirmModal(async () => {
        await performLogout();
      });
    });
  });

  const dashboardAppointmentsCount = document.getElementById(
    "dashboardAppointmentsCount",
  );
  const dashboardAccountsCount = document.getElementById(
    "dashboardAccountsCount",
  );
  const dashboardOrdersCount = document.getElementById("dashboardOrdersCount");
  const dashboardProductsCount = document.getElementById(
    "dashboardProductsCount",
  );
  const dashboardRevenueAmount = document.getElementById(
    "dashboardRevenueAmount",
  );
  const dashboardInventoryCount = document.getElementById(
    "dashboardInventoryCount",
  );
  const dashboardArchivesCount = document.getElementById(
    "dashboardArchivesCount",
  );
  // There is no "Generated Reports" counter any more: that tile is now a
  // quick action that links to the Reports page, so nothing on the dashboard
  // renders generated_reports. The API still returns the count for the audit
  // trail; the dashboard simply ignores it.
  const dashboardRecentAppointments = document.getElementById(
    "dashboardRecentAppointments",
  );
  const dashboardRecentOrders = document.getElementById(
    "dashboardRecentOrders",
  );
  const dashboardRecentInquiries = document.getElementById(
    "dashboardRecentInquiries",
  );

  // Analytics overview elements
  const aovTopSelling = document.getElementById("aovTopSelling");
  const aovSalesByCategory = document.getElementById("aovSalesByCategory");
  const aovProductPerformance = document.getElementById(
    "aovProductPerformance",
  );
  const aovYearlySalesTrend = document.getElementById("aovYearlySalesTrend");
  const aovTrendYear = document.getElementById("aovTrendYear");

  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");

  const toTimestamp = (value) => {
    const ts = Date.parse(String(value || ""));
    return Number.isFinite(ts) ? ts : 0;
  };

  const toNumericId = (value) => {
    const parsed = Number(String(value ?? "").replace(/[^0-9]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const sortLatestFirst = (rows) =>
    [...(Array.isArray(rows) ? rows : [])].sort(
      (a, b) =>
        toTimestamp(b?.created_at || b?.created_at_label) -
          toTimestamp(a?.created_at || a?.created_at_label) ||
        toNumericId(b?.id || b?.order_id || b?.reference_no) -
          toNumericId(a?.id || a?.order_id || a?.reference_no),
    );

  const formatCompactDate = (value) => {
    const date = new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return "N/A";

    return date.toLocaleString("en-PH", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const formatCount = (value) => {
    const number = Number(value || 0);
    return Number.isFinite(number) ? number.toLocaleString("en-PH") : "--";
  };

  const formatCurrency = (value) => {
    if (value === null || value === undefined) return "₱ --";
    const number = Number(value || 0);
    if (!Number.isFinite(number)) return "₱ --";
    return `₱ ${number.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatCurrencyCompact = (value) => {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) return "₱0";
    if (number >= 1000000) return `₱${(number / 1000000).toFixed(1)}M`;
    if (number >= 1000) return `₱${(number / 1000).toFixed(1)}k`;
    return `₱${number.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  /* ── Stat figures shrink themselves to fit ──────────────────────────────────
     `.card-info h3` is a fixed size in dashboard.css — 25.6px, 16.8px at <=720 —
     inside `.card-info { flex: 1; min-width: 0 }` beside a fixed 48px icon box.
     `₱ 1,004,650.00` does not fit that on any dashboard, and the h3 is now
     `white-space: nowrap`, so instead of breaking the peso sign onto its own line
     it would clip to an ellipsis. The size has to come down to meet the text.

     CSS alone cannot do it. `clamp()` and viewport units react to how wide the
     CONTAINER is, never to how many characters are in it, so the one card that
     overflows and the six counts that never will would shrink together.
     Measurement is the only thing that is genuinely automatic, and `scrollWidth`
     vs `clientWidth` is the browser's own answer to "does this text fit" — which
     is only meaningful because of the nowrap: a wrapped h3 reports its widest
     LINE, and a line fits by definition.

     Read-then-write, once per node: nothing here reads a layout property after
     setting a style except the correction loop, whose whole purpose is to
     re-measure. `.card-info`'s width comes from `flex: 1` over `flex-basis: 0`,
     so it does not depend on the h3's content — shrinking the text never widens
     the box that was just measured.
     -------------------------------------------------------------------------- */
  const STAT_FIT_MIN_PX = 13; // still legible on a 320px phone
  const statFitWidths = new WeakMap(); // h3 -> inline width it was last fitted at

  const fitStatValue = (node) => {
    if (!node || !node.isConnected) return;
    // The shimmer is a fixed 52-60px box. It always fits, and fitting it would
    // pin a size chosen for the wrong content.
    if (node.querySelector(".card-value-loading")) return;
    if (!node.textContent.trim()) return;

    // Drop whatever this function set last time, so the measurement starts from
    // the stylesheet size for the CURRENT breakpoint (1.6rem, or 1.05rem <=720).
    node.style.fontSize = "";

    const available = node.clientWidth;
    if (!available) return; // hidden card: nothing to measure against
    if (node.scrollWidth <= available) return; // fits as authored, leave the sheet alone

    const base = parseFloat(window.getComputedStyle(node).fontSize) || 16;
    let size = Math.max(STAT_FIT_MIN_PX, (base * available) / node.scrollWidth);
    node.style.fontSize = `${size.toFixed(2)}px`;

    // The ratio is a close first guess, not an exact one — glyph advance widths
    // do not scale perfectly linearly once hinting and sub-pixel rounding are in
    // play. A few half-pixel steps close the gap; the ellipsis is the floor for a
    // figure too long even at 13px.
    for (let i = 0; i < 4; i += 1) {
      if (size <= STAT_FIT_MIN_PX || node.scrollWidth <= node.clientWidth) break;
      size = Math.max(STAT_FIT_MIN_PX, size - 0.5);
      node.style.fontSize = `${size.toFixed(2)}px`;
    }
  };

  const fitStatValues = () => {
    document
      .querySelectorAll(".summary-cards .card-info h3")
      .forEach(fitStatValue);
  };

  /* Every card, not just revenue: the counts never overflow today, so in practice
     nothing but the peso figure moves — but a five-digit count on a 320px phone
     behaves the same way without anyone having to come back here.

     The observer covers what a one-shot fit cannot: window resize, orientation
     change, the sidebar collapsing, and the 4 -> 2 -> 1 column changes in the
     `.summary-cards` grid, where the grid's own width does not change but each
     card's does. It has to be guarded, though — shrinking the font changes the
     h3's HEIGHT, `.card-info` is the observed box, and a height-only callback
     that refits would wake itself forever. Only an inline-size change is news. */
  const observeStatCards = () => {
    if (typeof ResizeObserver !== "function") return;

    const observer = new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        const value = entry.target.querySelector("h3");
        if (!value) return;

        const width = Math.round(entry.contentRect.width);
        if (statFitWidths.get(value) === width) return;
        statFitWidths.set(value, width);
        fitStatValue(value);
      });
    });

    document
      .querySelectorAll(".summary-cards .card-info")
      .forEach((card) => observer.observe(card));
  };

  const appointmentStatusClass = (status) => {
    const normalized = String(status || "").toLowerCase();
    if (normalized.includes("completed")) return "priority-low";
    if (
      normalized.includes("cancel") ||
      normalized.includes("reject") ||
      normalized.includes("archive")
    ) {
      return "priority-neutral";
    }
    return "priority-high";
  };

  const orderStatusClass = (status) => {
    const normalized = String(status || "").toLowerCase();
    if (normalized === "completed") return "priority-low";
    if (normalized === "rejected") return "priority-neutral";
    return "priority-high";
  };

  const inquiryStatusClass = (status) => {
    const normalized = String(status || "").toLowerCase();
    if (normalized === "resolved") return "priority-low";
    return "priority-high";
  };

  const setCountCards = ({
    appointments,
    accounts,
    orders,
    products,
    total_archives,
    total_revenue,
    total_inventory_items,
  }) => {
    if (dashboardAppointmentsCount && appointments !== undefined)
      dashboardAppointmentsCount.textContent = formatCount(appointments);
    if (dashboardAccountsCount && accounts !== undefined)
      dashboardAccountsCount.textContent = formatCount(accounts);
    if (dashboardOrdersCount && orders !== undefined)
      dashboardOrdersCount.textContent = formatCount(orders);
    if (dashboardProductsCount && products !== undefined)
      dashboardProductsCount.textContent = formatCount(products);
    if (dashboardArchivesCount && total_archives !== undefined)
      dashboardArchivesCount.textContent = formatCount(total_archives);
    if (dashboardRevenueAmount && total_revenue !== undefined)
      dashboardRevenueAmount.textContent = formatCurrency(total_revenue);
    if (dashboardInventoryCount && total_inventory_items !== undefined)
      dashboardInventoryCount.textContent = formatCount(total_inventory_items);

    // The single funnel every card value goes through — the summary endpoint, its
    // degraded path and the four legacy count endpoints all land here — so the
    // refit happens in the same task as the write and the card paints already
    // fitted, with no flash of the oversized figure.
    fitStatValues();
  };

  const renderRecentAppointments = (appointments) => {
    if (!dashboardRecentAppointments) return;

    const latest = sortLatestFirst(appointments).slice(0, 3);
    if (!latest.length) {
      dashboardRecentAppointments.innerHTML = `
          <li class="recent-empty">
            <div class="recent-info">
              <strong>No appointment records yet.</strong>
              <span>Recent appointments will appear once customers submit requests.</span>
            </div>
          </li>
        `;
      return;
    }

    dashboardRecentAppointments.innerHTML = latest
      .map((appointment, index) => {
        const schedule = [
          appointment?.appointment_date,
          appointment?.appointment_time,
        ]
          .filter(Boolean)
          .join(" @ ");
        const status = appointment?.status || "Scheduled";

        return `
            <li class="${index === 0 ? "latest-entry" : ""}">
              <div class="recent-info">
                <strong>${escapeHtml(appointment?.client_name || "Unknown Client")}</strong>
                <span>${escapeHtml((appointment?.purpose || "Appointment") + (schedule ? ` • ${schedule}` : ""))}</span>
              </div>
              <div class="recent-side">
                ${index === 0 ? '<span class="latest-chip">Latest</span>' : ""}
                <span class="badge-status ${appointmentStatusClass(status)}">${escapeHtml(status)}</span>
                <span class="recent-date">${escapeHtml(formatCompactDate(appointment?.created_at))}</span>
              </div>
            </li>
          `;
      })
      .join("");
  };

  const renderRecentOrders = (incomingOrders, directoryOrders) => {
    if (!dashboardRecentOrders) return;

    const preferredSource =
      Array.isArray(incomingOrders) && incomingOrders.length
        ? incomingOrders
        : directoryOrders;

    const latest = sortLatestFirst(preferredSource).slice(0, 3);
    if (!latest.length) {
      dashboardRecentOrders.innerHTML = `
          <li class="recent-empty">
            <div class="recent-info">
              <strong>No order records yet.</strong>
              <span>Recent orders will appear once customers place orders.</span>
            </div>
          </li>
        `;
      return;
    }

    dashboardRecentOrders.innerHTML = latest
      .map((order, index) => {
        const quantity = Math.max(
          1,
          Number.parseInt(String(order?.quantity || "1"), 10) || 1,
        );
        const status =
          order?.status_label ||
          order?.lifecycle_status_label ||
          order?.customer_stage_label ||
          "Pending";

        return `
            <li class="${index === 0 ? "latest-entry" : ""}">
              <div class="recent-info">
                <strong>${escapeHtml(order?.order_no_display || `#${order?.order_no || order?.id || "N/A"}`)}</strong>
                <span>${escapeHtml((order?.product_name || "Custom Order") + ` • ${quantity} item${quantity > 1 ? "s" : ""}`)}</span>
              </div>
              <div class="recent-side">
                ${index === 0 ? '<span class="latest-chip">Latest</span>' : ""}
                <span class="badge-status ${orderStatusClass(order?.lifecycle_status || order?.customer_stage)}">${escapeHtml(status)}</span>
                <span class="recent-date">${escapeHtml(formatCompactDate(order?.created_at || order?.created_at_label))}</span>
              </div>
            </li>
          `;
      })
      .join("");
  };

  const renderRecentCustomerInquiries = (inquiries) => {
    if (!dashboardRecentInquiries) return;

    const latest = sortLatestFirst(inquiries).slice(0, 3);
    if (!latest.length) {
      dashboardRecentInquiries.innerHTML = `
          <li class="recent-empty">
            <div class="recent-info">
              <strong>No customer inquiries yet.</strong>
              <span>Recent inquiries will appear once customers submit messages.</span>
            </div>
          </li>
        `;
      return;
    }

    dashboardRecentInquiries.innerHTML = latest
      .map((inquiry, index) => {
        const status = inquiry?.status || "New";
        const senderName = inquiry?.sender_name || "Anonymous";
        const messagePreview = inquiry?.message_preview || "No message";

        return `
            <li class="${index === 0 ? "latest-entry" : ""}">
              <div class="recent-info">
                <strong>${escapeHtml(senderName)}</strong>
                <span>${escapeHtml(messagePreview)}</span>
              </div>
              <div class="recent-side">
                ${index === 0 ? '<span class="latest-chip">Latest</span>' : ""}
                <span class="badge-status ${inquiryStatusClass(status)}">${escapeHtml(status)}</span>
                <span class="recent-date">${escapeHtml(formatCompactDate(inquiry?.created_at))}</span>
              </div>
            </li>
          `;
      })
      .join("");
  };

  // ── Degraded-data notice ───────────────────────────────────────────────────
  // This page used to fail in silence. When /admin/dashboard/summary threw, the
  // catch in syncDashboardData() dropped the error and the legacy fallback then
  // filled four of the seven cards — so Total Revenue, Total Inventory Items,
  // all four analytics cards and Recent Customer Inquiries kept shimmering as
  // placeholders forever with nothing on screen to say why. Anything that
  // degrades now says so in one line, and offers a Retry.
  //
  // Built here rather than in dashboard.html so the admin and staff copies of
  // the page cannot drift apart.
  const DASHBOARD_SECTION_LABELS = {
    "counts.appointments": "Total Appointments",
    "counts.accounts": "Total Accounts",
    "counts.orders": "Total Orders",
    "counts.products": "Total Products",
    "counts.customer_inquiries": "Recent Customer Inquiries",
    "counts.total_inventory_items": "Total Inventory Items",
    "revenue.completed_orders": "Total Revenue",
    "revenue.gcash_advance": "Total Revenue",
    "revenue.walkins": "Total Revenue",
    "revenue.refunds": "Total Revenue",
    "analytics.top_selling": "Top Selling Products",
    "analytics.sales_by_category": "Sales by Category",
    "analytics.top_performance": "Product Performance",
    "analytics.yearly_trend": "Yearly Sales Trend",
    "recent.appointments": "Recent Appointments",
    "recent.orders": "Recent Orders",
    "recent.customer_inquiries": "Recent Customer Inquiries",
  };

  let dashboardNoticeEl = null;

  const ensureDashboardNotice = () => {
    if (dashboardNoticeEl?.isConnected) return dashboardNoticeEl;

    const anchor = document.querySelector(".dashboard-content .summary-cards");
    if (!anchor?.parentNode) return null;

    dashboardNoticeEl = document.createElement("div");
    dashboardNoticeEl.className = "dashboard-data-notice";
    dashboardNoticeEl.id = "dashboardDataNotice";
    dashboardNoticeEl.setAttribute("role", "status");
    dashboardNoticeEl.hidden = true;
    dashboardNoticeEl.innerHTML = `
        <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
        <div class="dashboard-data-notice-copy">
          <strong class="dashboard-data-notice-title"></strong>
          <span class="dashboard-data-notice-text"></span>
        </div>
        <button type="button" class="btn-admin btn-secondary dashboard-data-notice-retry">
          <i class="fa-solid fa-arrows-rotate"></i> Retry
        </button>`;
    anchor.parentNode.insertBefore(dashboardNoticeEl, anchor);
    dashboardNoticeEl
      .querySelector(".dashboard-data-notice-retry")
      ?.addEventListener("click", () => {
        void syncDashboardData({ force: true, source: "manual" });
      });

    return dashboardNoticeEl;
  };

  const showDashboardNotice = (title, text) => {
    const notice = ensureDashboardNotice();
    if (!notice) return;
    notice.querySelector(".dashboard-data-notice-title").textContent = title;
    notice.querySelector(".dashboard-data-notice-text").textContent = text;
    notice.hidden = false;
  };

  const hideDashboardNotice = () => {
    if (dashboardNoticeEl) dashboardNoticeEl.hidden = true;
  };

  // "Total Revenue, Sales by Category and 1 more" — four revenue terms share one
  // card, so the keys are de-duplicated by label before being counted.
  const describeUnavailableSections = (sections) => {
    const labels = [];
    (Array.isArray(sections) ? sections : []).forEach((key) => {
      const label = DASHBOARD_SECTION_LABELS[key] || null;
      if (label && !labels.includes(label)) labels.push(label);
    });
    if (!labels.length) return "";
    if (labels.length === 1) return labels[0];
    if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
    return `${labels.slice(0, 2).join(", ")} and ${labels.length - 2} more`;
  };

  const renderDashboardLoading = () => {
    const loaderHTML = `
        <li class="recent-item" style="pointer-events:none; padding:12px 16px; border-bottom:1px solid #f3f4f6; display:flex; align-items:center;">
          <div class="recent-info" style="flex:1;">
            <div style="height:14px;border-radius:4px;background:linear-gradient(90deg,#f3f4f6 25%,#e5e7eb 50%,#f3f4f6 75%);background-size:200% 100%;animation:shimmer 1.4s infinite;margin-bottom:8px;width:160px;"></div>
            <div style="height:10px;border-radius:4px;background:linear-gradient(90deg,#f3f4f6 25%,#e5e7eb 50%,#f3f4f6 75%);background-size:200% 100%;animation:shimmer 1.4s infinite;width:90px;"></div>
          </div>
          <div class="recent-side" style="display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
            <div style="height:18px;border-radius:12px;background:linear-gradient(90deg,#f3f4f6 25%,#e5e7eb 50%,#f3f4f6 75%);background-size:200% 100%;animation:shimmer 1.4s infinite;width:60px;"></div>
            <div style="height:10px;border-radius:4px;background:linear-gradient(90deg,#f3f4f6 25%,#e5e7eb 50%,#f3f4f6 75%);background-size:200% 100%;animation:shimmer 1.4s infinite;width:70px;"></div>
          </div>
        </li>`.repeat(4);

    if (dashboardRecentAppointments) {
      dashboardRecentAppointments.innerHTML = loaderHTML;
    }
    if (dashboardRecentOrders) {
      dashboardRecentOrders.innerHTML = loaderHTML;
    }
    if (dashboardRecentInquiries) {
      dashboardRecentInquiries.innerHTML = loaderHTML;
    }
  };

  const renderDashboardSyncError = (message) => {
    if (dashboardRecentAppointments) {
      dashboardRecentAppointments.innerHTML = `
          <li class="recent-empty">
            <div class="recent-info">
              <strong>Unable to load appointments.</strong>
              <span>${escapeHtml(message)}</span>
            </div>
          </li>
        `;
    }

    if (dashboardRecentOrders) {
      dashboardRecentOrders.innerHTML = `
          <li class="recent-empty">
            <div class="recent-info">
              <strong>Unable to load orders.</strong>
              <span>${escapeHtml(message)}</span>
            </div>
          </li>
        `;
    }

    if (dashboardRecentInquiries) {
      dashboardRecentInquiries.innerHTML = `
          <li class="recent-empty">
            <div class="recent-info">
              <strong>Unable to load inquiries.</strong>
              <span>${escapeHtml(message)}</span>
            </div>
          </li>
        `;
    }
  };

  /**
   * A driver error is a diagnostic, not dashboard copy.
   *
   * A failed query arrives as the raw PDO string - "SQLSTATE[42S02]: Base table
   * or view not found: 1146 Table '..._db.inventory_items' doesn't exist" - which
   * would be printed straight onto the page. The admin needs one plain sentence;
   * the table name belongs in the console here and in laravel.log on the server,
   * where safely() already writes it.
   */
  const plainDashboardReason = (message) => {
    const raw = String(message || "").trim();
    if (!raw) return "The server could not build the dashboard summary.";

    if (/SQLSTATE|Base table or view not found|doesn't exist|SQL:/i.test(raw)) {
      console.warn("[dashboard] summary failed:", raw);
      return "The server could not read one of the dashboard tables.";
    }

    return raw;
  };

  /**
   * One wording for "this server cannot read that table", used by both paths.
   *
   * The whole summary can fail (renderDashboardSummaryUnavailable) or a single
   * section can (markDegradedDashboardRegions). Either way the region must not
   * fall back to its ordinary "no records yet" copy: that tells the admin the
   * business has no data when the truth is the figure could not be read, and it
   * would contradict the notice sitting directly above the cards.
   */
  const analyticsUnavailableMarkup = (icon) =>
    `<div class="aov-empty"><i class="fa-solid ${icon}"></i> Not available right now</div>`;

  const feedUnavailableMarkup = (title, hint) => `
          <li class="recent-empty">
            <div class="recent-info">
              <strong>${escapeHtml(title)}</strong>
              <span>${escapeHtml(hint)}</span>
            </div>
          </li>
        `;

  const DASHBOARD_ANALYTICS_REGIONS = () => [
    ["analytics.top_selling", aovTopSelling, "fa-chart-bar"],
    ["analytics.sales_by_category", aovSalesByCategory, "fa-chart-pie"],
    ["analytics.top_performance", aovProductPerformance, "fa-ranking-star"],
    ["analytics.yearly_trend", aovYearlySalesTrend, "fa-chart-line"],
  ];

  /**
   * The summary endpoint failed but the legacy count endpoints answered.
   *
   * Only /admin/dashboard/summary carries revenue, inventory, the analytics
   * cards and the inquiries feed, so those five regions have no fallback source.
   * They are given a resolved state — a dash, or one line of plain copy — rather
   * than being left shimmering as though data were still on its way.
   */
  const renderDashboardSummaryUnavailable = (message) => {
    setCountCards({ total_revenue: null, total_inventory_items: "--" });

    DASHBOARD_ANALYTICS_REGIONS().forEach(([, el, icon]) => {
      if (el) el.innerHTML = analyticsUnavailableMarkup(icon);
    });

    if (dashboardRecentInquiries) {
      dashboardRecentInquiries.innerHTML = feedUnavailableMarkup(
        "Customer inquiries are not available right now.",
        "Open the Customer Inquiries page to read them.",
      );
    }

    showDashboardNotice(
      "Some dashboard data could not be loaded.",
      `${message} Total Revenue, Total Inventory Items, Product Analytics and Recent Customer Inquiries are affected. The other cards are live.`,
    );
  };

  /**
   * The summary answered, but named individual sections it could not read.
   *
   * Those sections arrive as their empty value, so the renderers above have
   * already written "no records yet" into them. Replace just those regions, and
   * only those, so one missing table costs one card and says so.
   */
  const markDegradedDashboardRegions = (degraded) => {
    if (!degraded?.size) return;

    DASHBOARD_ANALYTICS_REGIONS().forEach(([key, el, icon]) => {
      if (el && degraded.has(key)) el.innerHTML = analyticsUnavailableMarkup(icon);
    });

    if (dashboardRecentAppointments && degraded.has("recent.appointments")) {
      dashboardRecentAppointments.innerHTML = feedUnavailableMarkup(
        "Appointments are not available right now.",
        "Open the Appointments page to review them.",
      );
    }

    if (dashboardRecentOrders && degraded.has("recent.orders")) {
      dashboardRecentOrders.innerHTML = feedUnavailableMarkup(
        "Orders are not available right now.",
        "Open the Orders page to review them.",
      );
    }

    if (
      dashboardRecentInquiries &&
      (degraded.has("recent.customer_inquiries") ||
        degraded.has("counts.customer_inquiries"))
    ) {
      dashboardRecentInquiries.innerHTML = feedUnavailableMarkup(
        "Customer inquiries are not available right now.",
        "Open the Customer Inquiries page to read them.",
      );
    }
  };

  const requestDashboardJson = async (
    path,
    requiresAuth = false,
    options = {},
  ) => {
    const timeoutController = new AbortController();
    const timeoutId = window.setTimeout(() => {
      timeoutController.abort();
    }, DASHBOARD_REQUEST_TIMEOUT_MS);
    const externalSignal = options.signal;
    let abortFromExternal = null;

    const headers = {
      Accept: "application/json",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    };

    const token =
      (window.AdminSession && window.AdminSession.getToken()) ||
      localStorage.getItem("auth_token");
    if (requiresAuth) {
      if (!token) {
        const authError = new Error("Session expired. Please login again.");
        authError.code = "AUTH";
        throw authError;
      }
      headers.Authorization = `Bearer ${token}`;
    }

    abortFromExternal = () => {
      timeoutController.abort();
    };

    if (externalSignal) {
      if (externalSignal.aborted) {
        timeoutController.abort();
      } else {
        externalSignal.addEventListener("abort", abortFromExternal, {
          once: true,
        });
      }
    }

    let response;

    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        headers,
        cache: "no-store",
        signal: timeoutController.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        if (externalSignal?.aborted) {
          const cancelledError = new Error("Request cancelled.");
          cancelledError.code = "CANCELLED";
          throw cancelledError;
        }

        const timeoutError = new Error(
          "Request timed out. Please check your network and backend server.",
        );
        timeoutError.code = "TIMEOUT";
        throw timeoutError;
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
      if (externalSignal && abortFromExternal) {
        externalSignal.removeEventListener("abort", abortFromExternal);
      }
    }

    const payload = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
      const authError = new Error(
        payload?.message || "Session expired. Please login again.",
      );
      authError.code = "AUTH";
      authError.status = response.status;
      throw authError;
    }

    if (!response.ok) {
      const requestError = new Error(
        payload?.message || `Unable to load ${path}.`,
      );
      requestError.status = response.status;
      throw requestError;
    }

    return payload;
  };

  const ANALYTICS_PALETTE = [
    "#800000",
    "#d4a017",
    "#0284c7",
    "#16a34a",
    "#7c3aed",
    "#db2777",
    "#ea580c",
    "#0d9488",
    "#6366f1",
    "#94a3b8",
  ];

  const renderAnalyticsOverview = (analyticsSummary) => {
    if (!analyticsSummary) return;

    // ── Top Selling Products ──
    if (aovTopSelling) {
      const topSelling = Array.isArray(analyticsSummary?.top_selling)
        ? analyticsSummary.top_selling
        : [];
      if (!topSelling.length) {
        aovTopSelling.innerHTML =
          '<div class="aov-empty"><i class="fa-solid fa-chart-bar"></i> No sales data this month</div>';
      } else {
        aovTopSelling.innerHTML = topSelling
          .map(
            (item, idx) => `
            <div class="aov-item">
              <div class="aov-item-left">
                <span class="aov-rank ${idx < 3 ? `rank-${idx + 1}` : ""}">${idx + 1}</span>
                <span class="aov-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
              </div>
              <span class="aov-value">${Number(item.total_sold || 0).toLocaleString("en-PH")} sold</span>
            </div>
          `,
          )
          .join("");
      }
    }

    // ── Sales by Category ──
    if (aovSalesByCategory) {
      const categories = Array.isArray(analyticsSummary?.sales_by_category)
        ? analyticsSummary.sales_by_category
        : [];
      if (!categories.length) {
        aovSalesByCategory.innerHTML =
          '<div class="aov-empty"><i class="fa-solid fa-chart-pie"></i> No category data yet</div>';
      } else {
        aovSalesByCategory.innerHTML = categories
          .map(
            (item, idx) => `
            <div class="aov-item">
              <div class="aov-item-left">
                <span class="aov-category-dot" style="background:${ANALYTICS_PALETTE[idx % ANALYTICS_PALETTE.length]}"></span>
                <span class="aov-name" title="${escapeHtml(item.category)}">${escapeHtml(item.category)}</span>
              </div>
              <div style="text-align:right;">
                <span class="aov-value">${formatCurrencyCompact(item.total_revenue)}</span>
                <span class="aov-category-revenue">${Number(item.total_sold || 0)} sold</span>
              </div>
            </div>
          `,
          )
          .join("");
      }
    }

    // ── Product Performance ──
    if (aovProductPerformance) {
      const performance = Array.isArray(analyticsSummary?.top_performance)
        ? analyticsSummary.top_performance
        : [];
      if (!performance.length) {
        aovProductPerformance.innerHTML =
          '<div class="aov-empty"><i class="fa-solid fa-ranking-star"></i> No performance data yet</div>';
      } else {
        aovProductPerformance.innerHTML = performance
          .map(
            (item, idx) => `
            <div class="aov-item">
              <div class="aov-item-left">
                <span class="aov-rank ${idx < 3 ? `rank-${idx + 1}` : ""}">${idx + 1}</span>
                <span class="aov-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
              </div>
              <span class="aov-value">${formatCurrencyCompact(item.total_revenue)}</span>
            </div>
          `,
          )
          .join("");
      }
    }

    // ── Yearly Sales Trend (mini bar chart) ──
    if (aovYearlySalesTrend) {
      const trend = Array.isArray(analyticsSummary?.yearly_trend)
        ? analyticsSummary.yearly_trend
        : [];
      const year = analyticsSummary?.year || new Date().getFullYear();
      if (aovTrendYear) aovTrendYear.textContent = `${year} monthly totals`;

      const monthLabels = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
      ];
      const maxSales = Math.max(
        ...monthLabels.map((_, i) => trend[i]?.total_sales || 0),
        1,
      );
      const hasTrendData = monthLabels.some(
        (_, i) => (trend[i]?.total_sales || 0) > 0,
      );

      if (!hasTrendData) {
        aovYearlySalesTrend.innerHTML =
          '<div class="aov-empty"><i class="fa-solid fa-chart-line"></i> No sales data for this year</div>';
      } else {
        const bars = monthLabels
          .map((label, i) => {
            const totalSales = trend[i]?.total_sales || 0;
            const pct =
              maxSales > 0
                ? Math.max((totalSales / maxSales) * 100, 4)
                : 4;
            return `<div class="aov-trend-bar" style="height:${pct}%" title="${label}: ${formatCurrencyCompact(totalSales)}"></div>`;
          })
          .join("");
        const labels = monthLabels
          .map((label) => `<span>${label}</span>`)
          .join("");

        aovYearlySalesTrend.innerHTML = `
            <div class="aov-trend-bars">${bars}</div>
            <div class="aov-trend-label">${labels}</div>
          `;
      }
    }
  };

  const applyDashboardSummaryPayload = (summary) => {
    const counts = summary?.counts || {};
    const appointments = Array.isArray(summary?.recent_appointments)
      ? summary.recent_appointments
      : [];
    const orders = Array.isArray(summary?.recent_orders)
      ? summary.recent_orders
      : [];
    const inquiries = Array.isArray(summary?.recent_customer_inquiries)
      ? summary.recent_customer_inquiries
      : [];

    // The server names any figure it could not read (a Hostinger deploy copies
    // files and never runs migrations, so it can sit a table behind the code).
    // An empty list is the normal case and clears the notice.
    const availability = summary?.availability || {};
    const unavailableSections = Array.isArray(
      availability?.sections?.unavailable,
    )
      ? availability.sections.unavailable
      : [];
    const degraded = new Set(unavailableSections);

    // A count that could not be read arrives as 0, and 0 is a lie a back office
    // would act on — it reads as "no inventory" rather than "not counted". Show
    // a dash instead. Revenue is one card summing four terms, so any one of them
    // failing makes the total untrustworthy: an unsubtracted refund would
    // overstate money taken, which is the one figure that must never be guessed.
    const dash = (key, value) => (degraded.has(key) ? "--" : value);
    const revenueDegraded = [
      "revenue.completed_orders",
      "revenue.gcash_advance",
      "revenue.walkins",
      "revenue.refunds",
    ].some((key) => degraded.has(key));

    setCountCards({
      appointments: dash("counts.appointments", counts?.appointments),
      accounts: dash("counts.accounts", counts?.accounts),
      orders: dash("counts.orders", counts?.orders),
      products: dash("counts.products", counts?.products),
      total_archives: counts?.total_archives,
      total_revenue: revenueDegraded ? null : counts?.total_revenue,
      total_inventory_items: dash(
        "counts.total_inventory_items",
        counts?.total_inventory_items,
      ),
    });

    const archiveAvailability = availability?.archives || {};
    const allArchiveModulesAvailable = [
      "inventory",
      "appointments",
      "orders",
      "returns",
      "ratings",
      "promotions",
      "announcements",
    ].every((module) => archiveAvailability?.[module] !== false);
    window.AdminLiveData?.setAvailability?.(
      "dashboard-counts",
      availability?.report_generations !== false && allArchiveModulesAvailable,
    );

    dashboardLastLiveCountsAt = Date.now();
    dashboardHasGoodSummary = true;

    if (unavailableSections.length) {
      const affected = describeUnavailableSections(unavailableSections);
      showDashboardNotice(
        "Some dashboard figures are unavailable on this server.",
        `${affected} could not be read on this server, so ${unavailableSections.length === 1 ? "that figure is" : "those figures are"} shown as unavailable. Everything else on this page is live.`,
      );
    } else {
      hideDashboardNotice();
    }

    renderRecentAppointments(appointments);
    renderRecentOrders(orders, []);
    renderRecentCustomerInquiries(inquiries);

    // Render analytics overview
    renderAnalyticsOverview(summary?.analytics_summary || null);

    // Last, so it overwrites the "no records yet" copy the renderers above just
    // wrote into any section the server could not read.
    markDegradedDashboardRegions(degraded);
  };

  const syncDashboardDataLegacy = async () => {
    const syncSignal = dashboardSyncController?.signal;
    const [appointmentsPayload, usersPayload, ordersPayload, productsPayload] =
      await Promise.all([
        requestDashboardJson("/appointments", false, { signal: syncSignal }),
        requestDashboardJson("/users", true, { signal: syncSignal }),
        requestDashboardJson("/admin/orders", true, { signal: syncSignal }),
        requestDashboardJson("/admin/products", true, { signal: syncSignal }),
      ]);

    const appointments = Array.isArray(appointmentsPayload?.data)
      ? appointmentsPayload.data
      : [];
    const users = Array.isArray(usersPayload?.data) ? usersPayload.data : [];
    const incomingOrders = Array.isArray(ordersPayload?.incoming)
      ? ordersPayload.incoming
      : [];
    const directoryOrders = Array.isArray(ordersPayload?.directory)
      ? ordersPayload.directory
      : [];
    const products = Array.isArray(productsPayload?.data)
      ? productsPayload.data
      : [];

    setCountCards({
      appointments: appointments.length,
      accounts: users.length,
      orders: incomingOrders.length + directoryOrders.length,
      products: products.length,
    });

    dashboardHasGoodSummary = true;

    renderRecentAppointments(appointments);
    renderRecentOrders(incomingOrders, directoryOrders);
  };

  const syncDashboardData = async (options = {}) => {
    const force = Boolean(options.force);
    const source = String(options.source || "auto").toLowerCase();
    const now = Date.now();

    if (dashboardSyncInProgress) {
      if (force) {
        dashboardPendingForceSync = true;
      }
      if (force && source !== "realtime" && dashboardSyncController) {
        dashboardSyncController.abort();
      }
      return;
    }

    if (!force && now - dashboardLastSyncAt < DASHBOARD_MIN_SYNC_GAP_MS) {
      return;
    }

    const requestId = dashboardSyncRequestId + 1;
    dashboardSyncRequestId = requestId;
    dashboardSyncController = new AbortController();
    dashboardSyncInProgress = true;

    if (source === "manual" && !dashboardHasGoodSummary) {
      renderDashboardLoading();
    }

    try {
      let usedSummaryEndpoint = false;
      let summaryFailure = null;
      const syncSignal = dashboardSyncController?.signal;

      try {
        const summaryPayload = await requestDashboardJson(
          "/admin/dashboard/summary",
          true,
          { signal: syncSignal },
        );
        applyDashboardSummaryPayload(summaryPayload?.data || {});
        usedSummaryEndpoint = true;
      } catch (summaryError) {
        if (summaryError?.code === "AUTH") {
          throw summaryError;
        }
        // Held, not dropped. The legacy fallback below cannot fill revenue,
        // inventory, the analytics cards or the inquiries feed, so the reason
        // has to survive long enough to be shown next to the cards it cost.
        summaryFailure = summaryError;
      }

      if (!usedSummaryEndpoint) {
        await syncDashboardDataLegacy();

        if (summaryFailure?.code === "CANCELLED") {
          return;
        }
        renderDashboardSummaryUnavailable(
          summaryFailure?.code === "TIMEOUT"
            ? "The server took too long to answer."
            : plainDashboardReason(summaryFailure?.message),
        );
      }
    } catch (error) {
      if (error?.code === "CANCELLED") {
        return;
      }

      if (error?.code === "AUTH") {
        if (window.AdminSession) {
          window.AdminSession.clearSession();
        }
        localStorage.removeItem("auth_token");
        localStorage.removeItem("user_info");
        window.location.href = "../admin-auth/auth.html";
        return;
      }

      if (!dashboardHasGoodSummary) {
        setCountCards({
          appointments: "--",
          accounts: "--",
          orders: "--",
          products: "--",
          total_archives: "--",
          total_revenue: null,
          total_inventory_items: null,
        });
        const reason =
          error?.message || "Please check your network and backend server.";
        renderDashboardSyncError(reason);
        showDashboardNotice("The dashboard could not be loaded.", reason);
      }
    } finally {
      if (requestId === dashboardSyncRequestId) {
        dashboardSyncInProgress = false;
        dashboardSyncController = null;
        dashboardLastSyncAt = Date.now();
      }

      if (dashboardPendingForceSync) {
        dashboardPendingForceSync = false;
        queueDashboardSync({ force: true, source: "realtime" });
      }
    }
  };

  const applyDashboardLiveCounts = (payload = {}) => {
    const data = payload?.data || {};
    // Archived Records is the only card left that has to move on its own; the
    // Reports tile is a static quick action now, so data.generated_reports is
    // deliberately not rendered.
    setCountCards({
      total_archives: data.total_archives,
    });
    dashboardLastLiveCountsAt = Date.now();

    const availability = data?.availability || {};
    const archiveAvailability = availability?.archives || {};
    const allArchiveModulesAvailable = [
      "inventory",
      "appointments",
      "orders",
      "returns",
      "ratings",
      "promotions",
      "announcements",
    ].every((module) => archiveAvailability?.[module] !== false);
    window.AdminLiveData?.setAvailability?.(
      "dashboard-counts",
      availability?.report_generations !== false && allArchiveModulesAvailable,
    );
  };

  const syncDashboardLiveCounts = async ({ force = false } = {}) => {
    if (document.hidden) return;
    if (dashboardLiveCountsController) {
      if (!force) return;
      dashboardLiveCountsController.abort();
    }

    const controller = new AbortController();
    dashboardLiveCountsController = controller;
    try {
      const payload = await requestDashboardJson(
        "/admin/dashboard/live-counts",
        true,
        { signal: controller.signal },
      );
      if (dashboardLiveCountsController !== controller) return;
      applyDashboardLiveCounts(payload);
    } catch (error) {
      if (error?.code === "CANCELLED") return;
      if (error?.code === "AUTH") {
        window.AdminSession?.clearSession();
        localStorage.removeItem("auth_token");
        localStorage.removeItem("user_info");
        window.location.href = "../admin-auth/auth.html";
      }
      // Preserve the last-good cards. The shared status chip already reflects
      // the failed request and the next visible poll will retry.
    } finally {
      if (dashboardLiveCountsController === controller) {
        dashboardLiveCountsController = null;
      }
    }
  };

  const scheduleDashboardLiveCounts = (delay = DASHBOARD_LIVE_POLL_MS) => {
    window.clearTimeout(dashboardLiveCountsTimer);
    dashboardLiveCountsTimer = null;
    if (document.hidden) return;
    dashboardLiveCountsTimer = window.setTimeout(async () => {
      dashboardLiveCountsTimer = null;
      await syncDashboardLiveCounts();
      scheduleDashboardLiveCounts();
    }, Math.max(0, delay));
  };

  const refreshDashboardLiveCounts = async () => {
    window.clearTimeout(dashboardLiveCountsTimer);
    dashboardLiveCountsTimer = null;
    await syncDashboardLiveCounts({ force: true });
    scheduleDashboardLiveCounts();
  };

  const shouldProcessRealtimeSignal = (payload = {}) => {
    const ts = Number(payload?.timestamp || 0);
    if (!Number.isFinite(ts) || ts <= 0) return true;
    if (ts <= dashboardLastRealtimeSignalTs) return false;
    dashboardLastRealtimeSignalTs = ts;
    return true;
  };

  const queueDashboardSync = (options = {}) => {
    const force = Boolean(options.force);
    const source = String(options.source || "auto").toLowerCase();
    if (force) {
      dashboardPendingForceSync = true;
    }

    if (dashboardSyncInProgress) return;

    const elapsed = Date.now() - dashboardLastSyncAt;
    const shouldForce = dashboardPendingForceSync;
    const waitMs = shouldForce
      ? DASHBOARD_EVENT_DEBOUNCE_MS
      : Math.max(
          DASHBOARD_EVENT_DEBOUNCE_MS,
          DASHBOARD_MIN_SYNC_GAP_MS - elapsed,
        );

    if (waitMs <= 0) {
      dashboardPendingForceSync = false;
      void syncDashboardData({ force: shouldForce, source });
      return;
    }

    if (dashboardQueuedSyncTimer) return;

    dashboardQueuedSyncTimer = window.setTimeout(() => {
      dashboardQueuedSyncTimer = null;
      const nextForce = dashboardPendingForceSync;
      dashboardPendingForceSync = false;
      void syncDashboardData({ force: nextForce, source });
    }, waitMs);
  };

  window.addEventListener("storage", (event) => {
    if (event.key !== DASHBOARD_ORDERS_SIGNAL_KEY) return;
    if (document.hidden) return;

    let payload = {};
    try {
      payload = JSON.parse(event.newValue || "{}");
    } catch {
      payload = {};
    }
    if (!shouldProcessRealtimeSignal(payload)) return;

    queueDashboardSync({ force: true, source: "realtime" });
  });

  window.addEventListener("fmrc:orders-updated", (event) => {
    if (document.hidden) return;
    const payload = event?.detail || {};
    if (!shouldProcessRealtimeSignal(payload)) return;
    queueDashboardSync({ force: true, source: "realtime" });
  });

  const ordersChannel = getDashboardOrdersChannel();
  ordersChannel?.addEventListener("message", (event) => {
    if (document.hidden) return;
    const payload = event?.data || {};
    if (!shouldProcessRealtimeSignal(payload)) return;
    queueDashboardSync({ force: true, source: "realtime" });
  });

  unsubscribeAdminLiveData = window.AdminLiveData?.subscribe((payload = {}) => {
    if (document.hidden) return;
    if (!["reports", "archives"].includes(String(payload.scope || ""))) {
      return;
    }
    void refreshDashboardLiveCounts();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      window.clearTimeout(dashboardLiveCountsTimer);
      dashboardLiveCountsTimer = null;
      dashboardLiveCountsController?.abort();
      return;
    }

    const age = Date.now() - dashboardLastLiveCountsAt;
    if (!dashboardLastLiveCountsAt || age >= DASHBOARD_LIVE_POLL_MS) {
      void refreshDashboardLiveCounts();
    } else {
      scheduleDashboardLiveCounts(DASHBOARD_LIVE_POLL_MS - age);
    }
  });

  window.addEventListener("beforeunload", () => {
    if (dashboardQueuedSyncTimer) {
      clearTimeout(dashboardQueuedSyncTimer);
    }
    if (dashboardSyncController) {
      dashboardSyncController.abort();
    }
    window.clearTimeout(dashboardLiveCountsTimer);
    dashboardLiveCountsController?.abort();
    unsubscribeAdminLiveData?.();
    dashboardOrdersChannel?.close();
  });

  observeStatCards();

  // A webfont swapping in changes the text width under a size that was already
  // chosen, so re-measure once the fonts settle. Optional-chained: this is a
  // progressive enhancement, not a dependency.
  document.fonts?.ready.then(fitStatValues);

  void syncDashboardData({ force: true, source: "manual" }).finally(() => {
    void refreshDashboardLiveCounts();
  });

  syncSidebarMode();
});
