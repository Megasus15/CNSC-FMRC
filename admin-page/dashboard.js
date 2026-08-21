// Execute as early as possible to prevent initial CSS transitions flashing
if (document.body) {
  document.body.classList.add("no-transitions");
}

document.addEventListener("DOMContentLoaded", () => {
  const MOBILE_BREAKPOINT = 1024;
  const SIDEBAR_PREF_KEY = "adminSidebarMobileState";
  const DASHBOARD_REQUEST_TIMEOUT_MS = 15000;
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
  const dashboardReportsCount = document.getElementById(
    "dashboardReportsCount",
  );
  const dashboardRecentAppointments = document.getElementById(
    "dashboardRecentAppointments",
  );
  const dashboardRecentOrders = document.getElementById(
    "dashboardRecentOrders",
  );
  const dashboardRecentInquiries = document.getElementById(
    "dashboardRecentInquiries",
  );
  const dashboardRefreshBtn = document.getElementById("dashboardRefreshBtn");

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
    generated_reports,
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
    if (dashboardReportsCount && generated_reports !== undefined)
      dashboardReportsCount.textContent = formatCount(generated_reports);
    if (dashboardArchivesCount && total_archives !== undefined)
      dashboardArchivesCount.textContent = formatCount(total_archives);
    if (dashboardRevenueAmount && total_revenue !== undefined)
      dashboardRevenueAmount.textContent = formatCurrency(total_revenue);
    if (dashboardInventoryCount && total_inventory_items !== undefined)
      dashboardInventoryCount.textContent = formatCount(total_inventory_items);
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

    setCountCards({
      appointments: counts?.appointments,
      accounts: counts?.accounts,
      orders: counts?.orders,
      products: counts?.products,
      generated_reports: counts?.generated_reports,
      total_archives: counts?.total_archives,
      total_revenue: counts?.total_revenue,
      total_inventory_items: counts?.total_inventory_items,
    });

    const availability = summary?.availability || {};
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

    renderRecentAppointments(appointments);
    renderRecentOrders(orders, []);
    renderRecentCustomerInquiries(inquiries);

    // Render analytics overview
    renderAnalyticsOverview(summary?.analytics_summary || null);
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
      }

      if (!usedSummaryEndpoint) {
        await syncDashboardDataLegacy();
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
          generated_reports: "--",
          total_archives: "--",
          total_revenue: null,
          total_inventory_items: null,
        });
        renderDashboardSyncError(
          error?.message || "Please check your network and backend server.",
        );
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
    setCountCards({
      generated_reports: data.generated_reports,
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

  if (dashboardRefreshBtn) {
    dashboardRefreshBtn.addEventListener("click", async () => {
      if (dashboardRefreshBtn.disabled) return;
      const originalMarkup = dashboardRefreshBtn.innerHTML;
      dashboardRefreshBtn.disabled = true;
      dashboardRefreshBtn.setAttribute("aria-busy", "true");
      dashboardRefreshBtn.innerHTML =
        '<i class="fa-solid fa-arrows-rotate fa-spin" aria-hidden="true"></i><span>Refreshing...</span>';
      try {
        if (dashboardSyncController) dashboardSyncController.abort();
        const waitStartedAt = Date.now();
        while (
          dashboardSyncInProgress &&
          Date.now() - waitStartedAt < DASHBOARD_REQUEST_TIMEOUT_MS
        ) {
          await new Promise((resolve) => window.setTimeout(resolve, 25));
        }
        window.clearTimeout(dashboardQueuedSyncTimer);
        dashboardQueuedSyncTimer = null;
        dashboardPendingForceSync = false;
        await Promise.all([
          syncDashboardData({ force: true, source: "manual" }),
          syncDashboardLiveCounts({ force: true }),
        ]);
      } finally {
        dashboardRefreshBtn.innerHTML = originalMarkup;
        dashboardRefreshBtn.removeAttribute("aria-busy");
        dashboardRefreshBtn.disabled = false;
        scheduleDashboardLiveCounts();
      }
    });
  }

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

  void syncDashboardData({ force: true, source: "manual" }).finally(() => {
    void refreshDashboardLiveCounts();
  });

  syncSidebarMode();
});
