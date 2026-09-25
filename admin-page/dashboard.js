// Execute as early as possible to prevent initial CSS transitions flashing
if (document.body) {
  document.body.classList.add("no-transitions");
}

document.addEventListener("DOMContentLoaded", () => {
  /* The mobile sidebar state machine lives in admin-common.js only. This file
     used to carry a second copy of it without the 720px drawer guard, and
     because admin-common.js loads first, that copy's resize handler ran last
     and re-opened the drawer from a remembered preference. */
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
    await window.FMRCAdminLoader?.show("Signing you out.");
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
      window.FMRCAdminLoader?.hide();
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
    // Total Revenue is no longer painted here. It is a period-aware hero owned
    // by loadDashboardRevenue() (the /admin/dashboard/revenue endpoint), so the
    // figure follows the toolbar rather than showing the lifetime count the
    // summary endpoint carries. total_revenue is still accepted (and ignored)
    // so every existing caller keeps working unchanged.
    void total_revenue;
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
              <strong>No appointments yet.</strong>
              <span>New customer appointments will appear here.</span>
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
              <strong>No online orders yet.</strong>
              <span>New customer orders will appear here.</span>
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
              <span>New customer messages will appear here.</span>
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
    setCountCards({ total_inventory_items: "--" });

    // The analytics cards and the revenue hero are no longer fed by the summary
    // endpoint — they load independently from /admin/dashboard/revenue and
    // /admin/product-analytics/* and carry their own empty/error states — so a
    // summary outage must not blank them here.

    if (dashboardRecentInquiries) {
      dashboardRecentInquiries.innerHTML = feedUnavailableMarkup(
        "Customer inquiries are not available right now.",
        "Open the Customer Inquiries page to read them.",
      );
    }

    showDashboardNotice(
      "Some dashboard data could not be loaded.",
      `${message} Total Inventory Items and Recent Customer Inquiries are affected. The other cards are live.`,
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

    // Analytics cards are intentionally not marked here: they no longer read
    // from summary.analytics_summary and manage their own states.

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

  // ─────────────────────────────────────────────────────────────
  // Period-aware revenue hero + analytics, driven by the shared
  // toolbar. One period key feeds both /admin/dashboard/revenue and
  // /admin/product-analytics/*, so every widget moves together.
  // ─────────────────────────────────────────────────────────────
  const AOV_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dashboardCharts = {
    revenueSpark: null,
    topSelling: null,
    salesByCategory: null,
    yearlyTrend: null,
  };
  let dashboardAnalyticsToolbarApi = null;
  // Monotonic staleness token: each (re)load bumps it, and any response
  // tagged with an older token is dropped, so a fast run of period clicks
  // never lets a slow earlier response paint over a newer one.
  let dashboardAnalyticsGen = 0;

  const destroyDashboardChart = (key) => {
    if (dashboardCharts[key]) {
      dashboardCharts[key].destroy();
      dashboardCharts[key] = null;
    }
  };

  const aovCanvasCtx = (id) => {
    const el = document.getElementById(id);
    return el && el.getContext ? el.getContext("2d") : null;
  };

  const aovCards = [
    ["aovTopSelling", "topSelling"],
    ["aovSalesByCategory", "salesByCategory"],
    ["aovProductPerformance", null],
    ["aovYearlySalesTrend", "yearlyTrend"],
  ];
  const currentManilaYear = () => Number(new Intl.DateTimeFormat("en-PH", {
    year: "numeric", timeZone: "Asia/Manila",
  }).format(new Date()));
  const yearlyTrendYear = (state) => {
    const chosen = state?.period === "custom" ? Number(String(state.to || "").slice(0, 4)) : NaN;
    return Number.isInteger(chosen) && chosen >= 2000 && chosen <= 2100
      ? chosen : currentManilaYear();
  };
  const aovPeriodCopy = (state) => {
    const period = typeof state === "object" ? state?.period : state;
    const names = {
      day: ["Today", "today"], week: ["This Week", "this week"],
      month: ["This Month", "this month"], year: ["This Year", "this year"],
      all: ["All Time", "to date"],
    };
    if (period === "custom" && /^\d{4}-\d{2}-\d{2}$/.test(state?.from || "") &&
        /^\d{4}-\d{2}-\d{2}$/.test(state?.to || "")) {
      const short = (date) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-PH", {
        day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
      });
      const range = state.from === state.to ? short(state.from) : `${short(state.from)}–${short(state.to)}`;
      return { heading: range, empty: `for ${range}` };
    }
    const [heading, empty] = names[period] || names.month;
    return { heading, empty };
  };
  const setAovPeriod = (state) => {
    const { heading } = aovPeriodCopy(state);
    [
      ["aovTopSellingPeriod", "units sold"],
      ["aovSalesByCategoryPeriod", "category sales"],
      ["aovProductPerformancePeriod", "ranked by units"],
    ].forEach(([id, measure]) => {
      const node = document.getElementById(id);
      if (node) node.textContent = `${heading} · ${measure}`;
    });
    if (aovTrendYear) aovTrendYear.textContent = `${yearlyTrendYear(state)} calendar year · monthly sales`;
  };
  const aovEmptyMessages = (state) => {
    const { empty } = aovPeriodCopy(state);
    return {
      aovTopSelling: `No products sold ${empty}.`,
      aovSalesByCategory: `No online category sales ${empty}.`,
      aovProductPerformance: `No online product sales ${empty}.`,
      aovYearlySalesTrend: yearlyTrendYear(state) === currentManilaYear()
        ? `No completed online sales so far in ${yearlyTrendYear(state)}.`
        : `No completed online sales in ${yearlyTrendYear(state)}.`,
    };
  };
  let aovCurrentEmptyMessages = aovEmptyMessages({ period: "month" });
  const finishAovLoading = (baseId) => {
    const card = document.getElementById(baseId + "Card");
    card?.classList.remove("is-analytics-loading");
    card?.setAttribute("aria-busy", "false");
  };
  const setAovLoading = (state) => {
    aovCurrentEmptyMessages = aovEmptyMessages(state);
    setAovPeriod(state);
    aovCards.forEach(([baseId, chartKey]) => {
      const card = document.getElementById(baseId + "Card");
      card?.classList.add("is-analytics-loading");
      card?.setAttribute("aria-busy", "true");
      const canvas = document.getElementById(baseId + "Chart");
      if (canvas) canvas.style.display = "none";
      const empty = document.getElementById(baseId + "Empty");
      empty?.classList.add("aov-empty--hidden");
      if (chartKey) destroyDashboardChart(chartKey);
    });
    const legend = document.getElementById("aovSalesByCategoryLegend");
    if (legend) legend.innerHTML = "";
    const list = document.getElementById("aovProductPerformanceList");
    if (list) list.innerHTML = "";
    const trendCaption = document.getElementById("aovYearlySalesTrendCaption");
    if (trendCaption) trendCaption.textContent = "Completed online orders · by order month · before returns";
  };
  // Chart cards carry a sibling ".aov-empty" overlay (initially ".aov-empty--hidden",
  // whose display:none is !important, so the toggle is by class, not inline style).
  const toggleAov = (baseId, hasData, message) => {
    const canvas = document.getElementById(baseId + "Chart");
    const empty = document.getElementById(baseId + "Empty");
    if (canvas) {
      canvas.style.display = hasData ? "" : "none";
      canvas.style.visibility = "";
    }
    if (empty) {
      empty.classList.toggle("aov-empty--hidden", hasData);
      const copy = empty.querySelector("span");
      if (copy) copy.textContent = message || aovCurrentEmptyMessages[baseId] || "No sales for this period.";
    }
    finishAovLoading(baseId);
  };
  const prepareAovCanvas = (baseId) => {
    const canvas = document.getElementById(baseId + "Chart");
    if (canvas) {
      canvas.style.display = "";
      canvas.style.visibility = "hidden";
    }
    // Chart.js needs a laid-out container. The canvas stays invisible while
    // this synchronous render finishes, then toggleAov reveals the chart.
    finishAovLoading(baseId);
    return aovCanvasCtx(baseId + "Chart");
  };

  // ── Revenue hero ─────────────────────────────────────────────
  const revenueHero = dashboardRevenueAmount?.closest(".card-revenue-hero");
  const revenueChart = document.getElementById("dashboardRevenueSparkline");
  const revenueChartTitle = document.getElementById("dashboardRevenueChartTitle");
  const revenueChartRange = document.getElementById("dashboardRevenueChartRange");
  const revenueChartNote = document.getElementById("dashboardRevenueChartNote");
  const revenueChartStatus = document.getElementById("dashboardRevenueChartStatus");
  // A touch on the chart should reveal its tooltip without following the card link.
  revenueChart?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  // The initial placeholders are the shared template for every period reload.
  const revenueLoadingMarkup = {
    amount: dashboardRevenueAmount?.innerHTML || "",
    delta: document.getElementById("dashboardRevenueDelta")?.innerHTML || "",
    breakdown: document.getElementById("dashboardRevenueBreakdown")?.innerHTML || "",
    range: revenueChartRange?.innerHTML || "",
  };
  const setRevenueChartStatus = (message = "") => {
    if (revenueChartStatus) {
      revenueChartStatus.textContent = message;
      revenueChartStatus.hidden = !message;
    }
    if (revenueChart) revenueChart.hidden = !!message;
    if (revenueChartNote) revenueChartNote.hidden = !!message;
  };
  const finishRevenueHeroLoading = () => {
    revenueHero?.classList.remove("is-revenue-loading");
    revenueHero?.setAttribute("aria-busy", "false");
    revenueHero?.removeAttribute("aria-label");
  };
  const setRevenueHeroLoading = () => {
    revenueHero?.classList.add("is-revenue-loading");
    revenueHero?.setAttribute("aria-busy", "true");
    revenueHero?.setAttribute("aria-label", "Total Revenue, loading");
    destroyDashboardChart("revenueSpark");
    setRevenueChartStatus();
    if (revenueChartTitle) revenueChartTitle.textContent = "Revenue trend";
    if (revenueChartRange) revenueChartRange.innerHTML = revenueLoadingMarkup.range;
    revenueChart?.setAttribute("aria-label", "Revenue trend loading");
    if (dashboardRevenueAmount) {
      dashboardRevenueAmount.style.fontSize = "";
      dashboardRevenueAmount.innerHTML = revenueLoadingMarkup.amount;
    }
    const delta = document.getElementById("dashboardRevenueDelta");
    if (delta) {
      delta.className = "revenue-hero__delta revenue-hero__delta--loading";
      delta.innerHTML = revenueLoadingMarkup.delta;
      delta.title = "";
    }
    const breakdown = document.getElementById("dashboardRevenueBreakdown");
    if (breakdown) breakdown.innerHTML = revenueLoadingMarkup.breakdown;
  };

  const setRevenueHeroError = () => {
    destroyDashboardChart("revenueSpark");
    finishRevenueHeroLoading();
    if (revenueChartTitle) revenueChartTitle.textContent = "Revenue trend";
    if (revenueChartRange) revenueChartRange.textContent = "";
    setRevenueChartStatus("Revenue trend unavailable.");
    if (dashboardRevenueAmount) dashboardRevenueAmount.textContent = "₱ --";
    const delta = document.getElementById("dashboardRevenueDelta");
    if (delta) {
      delta.className = "revenue-hero__delta revenue-hero__delta--none";
      delta.textContent = "";
      delta.title = "";
    }
    const breakdown = document.getElementById("dashboardRevenueBreakdown");
    if (breakdown) breakdown.textContent = "Revenue could not be loaded right now.";
    fitStatValues();
  };

  const renderRevenueHero = (d) => {
    finishRevenueHeroLoading();
    const period = (d && d.period) || {};
    const unavailableSections = Array.isArray(d?.availability?.unavailable)
      ? d.availability.unavailable : [];
    const currentUnavailable = unavailableSections.includes("revenue.current");
    const change = currentUnavailable ? {} : (d && d.change) || {};
    const previous = currentUnavailable ? null : (d && d.previous) || null;

    const periodEl = document.getElementById("dashboardRevenuePeriod");
    if (periodEl) periodEl.textContent = period.label || "This Month";

    if (dashboardRevenueAmount)
      dashboardRevenueAmount.textContent = currentUnavailable
        ? "₱ --" : formatCurrency(Number(period.collected || 0));
    fitStatValues();

    const delta = document.getElementById("dashboardRevenueDelta");
    if (delta) {
      const dir = change.direction || "none";
      const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "";
      let text = "";
      if (dir === "up" || dir === "down" || dir === "flat") {
        text =
          change.percent != null
            ? `${arrow} ${Math.abs(Number(change.percent)).toFixed(1)}%`.trim()
            : `${arrow} ${formatCurrencyCompact(Math.abs(Number(change.amount || 0)))}`.trim();
      }
      delta.className = `revenue-hero__delta revenue-hero__delta--${dir}`;
      delta.textContent = text && previous?.label
        ? `${text} vs ${previous.label.toLowerCase()}`
        : text;
      delta.title =
        previous && previous.label
          ? `vs ${previous.label}: ${formatCurrency(Number(previous.collected || 0))}`
          : "";
    }

    const breakdown = document.getElementById("dashboardRevenueBreakdown");
    if (breakdown) {
      const b = period.breakdown || {};
      let line = [
        `Online ${formatCurrencyCompact(b.online || 0)}`,
        `Walk-in ${formatCurrencyCompact(b.walkins || 0)}`,
        `GCash ${formatCurrencyCompact(b.gcash_advance || 0)}`,
      ].join("  ·  ");
      if (Number(b.refunds || 0) > 0)
        line += `  ·  −${formatCurrencyCompact(b.refunds || 0)} refunds`;
      breakdown.textContent = currentUnavailable
        ? "Revenue total could not be loaded right now." : line;
    }

    const series = Array.isArray(d && d.series) ? d.series : [];
    const monthly = period.key === "year" || period.key === "all";
    const chartTitle = monthly ? "Monthly revenue trend" : "Daily revenue trend";
    if (revenueChartTitle) revenueChartTitle.textContent = chartTitle;
    const formatDate = (value) => {
      const date = new Date(value);
      return value && Number.isFinite(date.getTime())
        ? date.toLocaleDateString("en-PH", {
          day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Manila",
        })
        : "";
    };
    const from = formatDate(period.from);
    const to = formatDate(period.to);
    if (revenueChartRange) {
      const firstLabel = series[0]?.label || "";
      const lastLabel = series[series.length - 1]?.label || "";
      revenueChartRange.textContent = period.key === "all"
        ? `Last 12 months${firstLabel && lastLabel ? ` · ${firstLabel} – ${lastLabel}` : ""}`
        : from && to ? (from === to ? from : `${from} – ${to}`) : period.label || "";
    }
    // Daily API labels omit the year; keep full dates in point details, including
    // custom ranges crossing New Year. Advance Manila calendar dates in UTC.
    const firstDay = /^\d{4}-\d{2}-\d{2}/.exec(period.from || "")?.[0];
    const firstDayTime = firstDay ? Date.parse(`${firstDay}T00:00:00Z`) : NaN;
    const tooltipLabels = series.map((point, index) =>
      !monthly && Number.isFinite(firstDayTime)
        ? new Date(firstDayTime + index * 86400000).toLocaleDateString("en-PH", {
          day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
        })
        : String(point.label || ""),
    );
    destroyDashboardChart("revenueSpark");
    const spark = aovCanvasCtx("dashboardRevenueSparkline");
    const unavailable = unavailableSections.includes("revenue.series");
    setRevenueChartStatus();
    if (!unavailable && spark && series.length && window.AnalyticsCharts) {
      dashboardCharts.revenueSpark = window.AnalyticsCharts.sparkline(spark, {
        data: series.map((p) => Number(p.amount || 0)),
        labels: series.map((p) => String(p.label || "")),
        tooltipLabels,
      });
    }
    if (!dashboardCharts.revenueSpark) {
      setRevenueChartStatus("Revenue trend unavailable.");
    } else {
      const peak = series.reduce((best, point, index) =>
        Number(point.amount || 0) > Number(series[best].amount || 0) ? index : best, 0);
      const description = Number(series[peak].amount || 0) > 0
        ? `Highest plotted revenue: ${formatCurrency(Number(series[peak].amount))} on ${tooltipLabels[peak]}.`
        : "All plotted values are zero.";
      revenueChart?.setAttribute("aria-label", `${chartTitle}. ${description}`);
    }
  };

  // Build the querystring shared by the revenue + product-analytics endpoints.
  // A preset is just period=key; a custom range carries &from&to (YYYY-MM-DD),
  // which App\Support\AnalyticsPeriod resolves in Asia/Manila. Accepts either a
  // toolbar state object ({period[,from,to]}) or a bare period string.
  const periodQuery = (state) => {
    const st = state && typeof state === "object" ? state : { period: state };
    const key = st.period || "month";
    let q = `period=${encodeURIComponent(key)}`;
    if (key === "custom" && st.from && st.to) {
      q += `&from=${encodeURIComponent(st.from)}&to=${encodeURIComponent(st.to)}`;
    }
    return q;
  };

  const loadDashboardRevenue = async (state, gen) => {
    try {
      const payload = await requestDashboardJson(
        `/admin/dashboard/revenue?${periodQuery(state)}`,
        true,
      );
      if (gen !== dashboardAnalyticsGen) return;
      renderRevenueHero((payload && payload.data) || {});
    } catch (err) {
      if (gen !== dashboardAnalyticsGen || (err && err.code === "CANCELLED")) return;
      setRevenueHeroError();
    }
  };

  // ── Top selling → horizontal bar ─────────────────────────────
  const renderTopSellingChart = (rows) => {
    const data = (Array.isArray(rows) ? rows : []).filter((r) => Number(r.total_sold || 0) > 0);
    destroyDashboardChart("topSelling");
    const ctx = data.length && window.AnalyticsCharts
      ? prepareAovCanvas("aovTopSelling") : null;
    if (data.length && ctx && window.AnalyticsCharts) {
      dashboardCharts.topSelling = window.AnalyticsCharts.renderBar(ctx, {
        labels: data.map((r) => r.name),
        data: data.map((r) => Number(r.total_sold || 0)),
        horizontal: true,
        label: "Units sold",
        tooltip: {
          callbacks: {
            label: (i) => ` ${Number(i.parsed.x || 0).toLocaleString("en-PH")} sold`,
          },
        },
      });
    }
    toggleAov("aovTopSelling", !!dashboardCharts.topSelling,
      data.length ? "Top-selling chart unavailable." : undefined);
  };

  // ── Sales by category → donut + custom legend ────────────────
  const renderSalesByCategoryChart = (rows) => {
    const data = (Array.isArray(rows) ? rows : []).filter((r) => Number(r.total_revenue || 0) > 0);
    const legend = document.getElementById("aovSalesByCategoryLegend");
    destroyDashboardChart("salesByCategory");
    if (legend) legend.innerHTML = "";
    const ctx = data.length && window.AnalyticsCharts
      ? prepareAovCanvas("aovSalesByCategory") : null;
    if (data.length && ctx && window.AnalyticsCharts) {
      dashboardCharts.salesByCategory = window.AnalyticsCharts.renderDonut(ctx, {
        labels: data.map((r) => r.category),
        data: data.map((r) => Number(r.total_revenue || 0)),
      });
    }
    if (dashboardCharts.salesByCategory && legend) {
      const palette = window.AnalyticsCharts.PALETTE;
      legend.innerHTML = data.map((r, i) => `
          <div class="aov-legend__item">
            <span class="aov-legend__dot" style="background:${palette[i % palette.length]}"></span>
            <span class="aov-legend__name" title="${escapeHtml(r.category)}">${escapeHtml(r.category)}</span>
            <span class="aov-legend__value">${formatCurrencyCompact(r.total_revenue)}</span>
          </div>`).join("");
    }
    toggleAov("aovSalesByCategory", !!dashboardCharts.salesByCategory,
      data.length ? "Category sales chart unavailable." : undefined);
  };

  // ── Product performance → compact top-5 ranked list ──────────
  const renderPerformanceList = (rows) => {
    const list = document.getElementById("aovProductPerformanceList");
    if (!list) return;
    const data = (Array.isArray(rows) ? rows : []).slice(0, 5);
    if (!data.length) {
      list.innerHTML = `<div class="aov-empty" role="status"><i class="fa-solid fa-ranking-star" aria-hidden="true"></i><span>${escapeHtml(aovCurrentEmptyMessages.aovProductPerformance)}</span></div>`;
      finishAovLoading("aovProductPerformance");
      return;
    }
    list.innerHTML = data
      .map(
        (item, idx) => `
        <div class="aov-item">
          <div class="aov-item-left">
            <span class="aov-rank ${idx < 3 ? `rank-${idx + 1}` : ""}" title="${Number(item.total_sold || 0).toLocaleString("en-PH")} units sold">${idx + 1}</span>
            <span class="aov-name" title="${escapeHtml(item.product_name)}">${escapeHtml(item.product_name)}</span>
          </div>
          <span class="aov-value" title="${formatCurrency(Number(item.total_revenue || 0))} before returns">${formatCurrencyCompact(item.total_revenue)}</span>
        </div>`,
      )
      .join("");
    finishAovLoading("aovProductPerformance");
  };

  // ── Yearly trend → line ──────────────────────────────────────
  const renderYearlyTrendChart = (payload) => {
    const trend = Array.isArray(payload && payload.data) ? payload.data : [];
    const year = Number(payload?.year) || currentManilaYear();
    if (aovTrendYear) aovTrendYear.textContent = `${year} calendar year · monthly sales`;
    const totals = AOV_MONTHS.map((_, i) => Number(trend[i] ? trend[i].total_sales || 0 : 0));
    const currentMonth = Number(new Intl.DateTimeFormat("en-PH", {
      month: "numeric", timeZone: "Asia/Manila",
    }).format(new Date()));
    const plottedTotals = totals.map((amount, index) =>
      year === currentManilaYear() && index + 1 > currentMonth ? null : amount);
    const plottedValues = plottedTotals.map((amount) => amount == null ? 0 : amount);
    const hasData = plottedValues.some((v) => v > 0);
    destroyDashboardChart("yearlyTrend");
    const ctx = hasData && window.AnalyticsCharts
      ? prepareAovCanvas("aovYearlySalesTrend") : null;
    if (hasData && ctx && window.AnalyticsCharts) {
      dashboardCharts.yearlyTrend = window.AnalyticsCharts.renderLine(ctx, {
        labels: AOV_MONTHS,
        tooltipLabels: AOV_MONTHS.map((month) => `${month} ${year}`),
        data: plottedTotals,
        label: "Sales before returns",
        currency: true,
      });
    }
    const chart = document.getElementById("aovYearlySalesTrendChart");
    const caption = document.getElementById("aovYearlySalesTrendCaption");
    if (chart && dashboardCharts.yearlyTrend) {
      const peak = plottedValues.reduce((best, amount, index) => amount > plottedValues[best] ? index : best, 0);
      chart.setAttribute("role", "img");
      chart.setAttribute("aria-label", `Monthly sales before returns in ${year}. Highest month: ${AOV_MONTHS[peak]} ${year}, ${formatCurrency(plottedValues[peak])}.`);
      if (caption) caption.textContent = `Completed online orders · by order month · before returns · Peak ${AOV_MONTHS[peak]} ${formatCurrencyCompact(plottedValues[peak])}`;
    } else if (caption) {
      caption.textContent = "Completed online orders · by order month · before returns";
    }
    toggleAov("aovYearlySalesTrend", !!dashboardCharts.yearlyTrend,
      hasData ? "Yearly sales chart unavailable." : year === currentManilaYear()
        ? `No completed online sales so far in ${year}.`
        : `No completed online sales in ${year}.`);
  };

  const setAovFailure = (baseId) => {
    const messages = {
      aovTopSelling: "Top-selling products unavailable.",
      aovSalesByCategory: "Category sales unavailable.",
      aovProductPerformance: "Product performance unavailable.",
      aovYearlySalesTrend: "Yearly sales unavailable.",
    };
    if (baseId === "aovProductPerformance") {
      const list = document.getElementById("aovProductPerformanceList");
      if (list) list.innerHTML = `<div class="aov-empty" role="status"><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i><span>${messages[baseId]}</span></div>`;
      finishAovLoading(baseId);
    } else {
      toggleAov(baseId, false, messages[baseId]);
    }
  };

  // ── Orchestration ────────────────────────────────────────────
  const loadDashboardAnalytics = async (state, gen) => {
    const q = `?${periodQuery(state)}`;
    const year = yearlyTrendYear(state);
    const jobs = [
      [`top-selling${q}`, "aovTopSelling", renderTopSellingChart],
      [`sales-by-category${q}`, "aovSalesByCategory", renderSalesByCategoryChart],
      [`product-performance${q}`, "aovProductPerformance", renderPerformanceList],
      [`yearly-sales-trend?year=${year}`, "aovYearlySalesTrend", renderYearlyTrendChart],
    ];
    await Promise.all(
      jobs.map(async ([path, baseId, render]) => {
        try {
          const payload = await requestDashboardJson(
            `/admin/product-analytics/${path}`,
            true,
          );
          if (gen !== dashboardAnalyticsGen) return;
          // yearly-sales-trend returns the whole envelope; the rest wrap {data:[…]}.
          render(path.indexOf("yearly-sales-trend") === 0 ? payload : payload && payload.data);
        } catch (err) {
          if (gen !== dashboardAnalyticsGen || (err && err.code === "CANCELLED")) return;
          setAovFailure(baseId);
        }
      }),
    );
  };

  // Public: repaint the hero + all analytics cards for one period. Accepts a
  // toolbar state object ({period[,from,to]}) or a bare period string.
  const refreshDashboardAnalytics = (state) => {
    const st =
      state && typeof state === "object" ? state : { period: state || "month" };
    dashboardAnalyticsGen += 1;
    const gen = dashboardAnalyticsGen;
    setRevenueHeroLoading();
    setAovLoading(st);
    dashboardAnalyticsToolbarApi?.setBusy?.(true);
    return Promise.all([
      loadDashboardRevenue(st, gen),
      loadDashboardAnalytics(st, gen),
    ]).finally(() => {
      if (gen === dashboardAnalyticsGen) dashboardAnalyticsToolbarApi?.setBusy?.(false);
    });
  };

  // Debounced refresh for realtime events (order updates, tab refocus) so a
  // burst of signals collapses into a single reload at the current period.
  let dashboardReloadTimer = null;
  const reloadDashboardAnalytics = () => {
    if (dashboardReloadTimer) return;
    dashboardReloadTimer = window.setTimeout(() => {
      dashboardReloadTimer = null;
      const state =
        (dashboardAnalyticsToolbarApi && dashboardAnalyticsToolbarApi.getState()) || {
          period: "month",
        };
      refreshDashboardAnalytics(state);
    }, 400);
  };

  const mountDashboardAnalyticsToolbar = () => {
    const host = document.getElementById("dashboardAnalyticsToolbar");
    if (!host || !window.AnalyticsToolbar) return;
    dashboardAnalyticsToolbarApi = window.AnalyticsToolbar.mount(host, {
      storageKey: "fmrc_dashboard_analytics_period",
      initialPeriod: "month",
      ariaLabel: "Select reporting period for revenue and analytics",
      onChange: (state) => {
        refreshDashboardAnalytics(state);
      },
    });
    // The page owns its first load: mount never fires onChange.
    refreshDashboardAnalytics(dashboardAnalyticsToolbarApi.getState());
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

    // The Analytics Overview + revenue hero are now decoupled from this
    // summary payload — they load themselves per the period toolbar (see
    // refreshDashboardAnalytics), so a summary outage no longer blanks them.

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
    reloadDashboardAnalytics();
  });

  window.addEventListener("fmrc:orders-updated", (event) => {
    if (document.hidden) return;
    const payload = event?.detail || {};
    if (!shouldProcessRealtimeSignal(payload)) return;
    queueDashboardSync({ force: true, source: "realtime" });
    reloadDashboardAnalytics();
  });

  const ordersChannel = getDashboardOrdersChannel();
  ordersChannel?.addEventListener("message", (event) => {
    if (document.hidden) return;
    const payload = event?.data || {};
    if (!shouldProcessRealtimeSignal(payload)) return;
    queueDashboardSync({ force: true, source: "realtime" });
    reloadDashboardAnalytics();
  });

  unsubscribeAdminLiveData = window.AdminLiveData?.subscribe((payload = {}) => {
    if (document.hidden) return;
    if (!["reports", "archives"].includes(String(payload.scope || ""))) {
      return;
    }
    void refreshDashboardLiveCounts();
    reloadDashboardAnalytics();
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

  // Mount the period toolbar and kick off the first revenue + analytics load.
  // This is independent of the summary sync below, so the charts populate even
  // if the summary endpoint is degraded.
  mountDashboardAnalyticsToolbar();

  // A webfont swapping in changes the text width under a size that was already
  // chosen, so re-measure once the fonts settle. Optional-chained: this is a
  // progressive enhancement, not a dependency.
  document.fonts?.ready.then(fitStatValues);

  void syncDashboardData({ force: true, source: "manual" }).finally(() => {
    void refreshDashboardLiveCounts();
  });
});
