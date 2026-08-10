// Execute as early as possible to prevent initial CSS transitions flashing
if (document.body) {
  document.body.classList.add("no-transitions");
}

document.addEventListener("DOMContentLoaded", () => {
  const MOBILE_BREAKPOINT = 1024;
  const SIDEBAR_PREF_KEY = "adminSidebarMobileState";
  const body = document.body;
  const sidebar = document.querySelector(".sidebar");
  const sidebarHeader = document.querySelector(".sidebar-header");
  const sidebarNav = document.querySelector(".sidebar-nav");
  const REMOVED_ROUTES = ["payment-monitoring.html", "payments.html"];

  let sidebarToggleBtn = null;
  let sidebarBackdrop = null;

  const isMobileSidebarMode = () => window.innerWidth <= MOBILE_BREAKPOINT;

  const sanitizeRemovedPageLinks = () => {
    const currentPath = window.location.pathname.toLowerCase();
    const openedRemovedPage = REMOVED_ROUTES.some((route) =>
      currentPath.endsWith(`/${route}`),
    );

    if (openedRemovedPage) {
      window.location.replace("dashboard.html");
      return;
    }

    REMOVED_ROUTES.forEach((route) => {
      document
        .querySelectorAll(`a[href="${route}"]`)
        .forEach((link) => link.remove());
    });
  };

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
  };

  const WEBSITE_MGMT_ROUTES = [
    "website-home.html",
    "website-services.html",
    "website-contact.html",
    "website-footer.html",
  ];
  const isWebsiteMgmtPage = WEBSITE_MGMT_ROUTES.some((route) =>
    window.location.pathname.toLowerCase().endsWith(`/${route}`),
  );

  // Support both admin and staff control button IDs (adminControlBtn, staffControlBtn)
  const controlBtn =
    document.getElementById("adminControlBtn") ||
    document.getElementById("staffControlBtn");
  if (controlBtn) {
    const hasDropdown = controlBtn.parentElement;

    if (isWebsiteMgmtPage) {
      hasDropdown.classList.add("open");
      localStorage.setItem("websiteMgmtDropdownState", "open");
    } else {
      const savedState = localStorage.getItem("websiteMgmtDropdownState");
      if (savedState === "open") {
        hasDropdown.classList.add("open");
      } else {
        hasDropdown.classList.remove("open");
      }
    }

    if (!controlBtn.dataset.boundDropdown) {
      controlBtn.addEventListener("click", (e) => {
        if (
          isMobileSidebarMode() &&
          !body.classList.contains("admin-sidebar-open")
        ) {
          e.preventDefault();
          openMobileSidebar();
          return;
        }
        e.preventDefault();
        hasDropdown.classList.toggle("open");
        localStorage.setItem(
          "websiteMgmtDropdownState",
          hasDropdown.classList.contains("open") ? "open" : "closed",
        );
      });
      controlBtn.dataset.boundDropdown = "1";
    }
  }

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

  const ensureCustomerInquiriesEntry = () => {
    if (!sidebarNav) return;

    let inquiriesLink = sidebarNav.querySelector(
      'a[href="customer-inquiries.html"]',
    );
    if (!inquiriesLink) {
      const ordersLink = sidebarNav.querySelector('a[href="orders.html"]');
      inquiriesLink = document.createElement("a");
      inquiriesLink.href = "customer-inquiries.html";
      inquiriesLink.className = "nav-link";
      inquiriesLink.innerHTML =
        '<i class="fa-regular fa-envelope-open"></i> Customer Inquiries';

      if (ordersLink) {
        ordersLink.insertAdjacentElement("afterend", inquiriesLink);
      } else {
        sidebarNav.appendChild(inquiriesLink);
      }
    }

    if (
      window.location.pathname
        .toLowerCase()
        .endsWith("/customer-inquiries.html")
    ) {
      inquiriesLink.classList.add("active");
    }
  };

  ensureMyAccountEntry();
  ensureCustomerInquiriesEntry();
  sanitizeRemovedPageLinks();
  decorateSidebarLabels();
  ensureMobileSidebarChrome();

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

  const userProfile = document.querySelector(".user-profile");
  const profilePopup = document.getElementById("profilePopup");
  const profileInitials = document.querySelectorAll(".profile-initial");

  profileInitials.forEach((profileInitial) => {
    const seedValue =
      profileInitial.dataset.email ||
      profilePopup?.querySelector(".popup-identity")?.textContent ||
      userProfile?.querySelector(".role")?.textContent ||
      "A";

    profileInitial.textContent = seedValue.trim().charAt(0).toUpperCase();
  });

  // Fetch current authenticated user and update UI (keeps email in sync after changes)
  (function fetchAndApplyUserProfile() {
    const API_BASE = (() => {
      const configured =
        window.APP_API_BASE_URL ||
        document
          .querySelector('meta[name="api-base-url"]')
          ?.getAttribute("content") ||
        "";
      if (configured.trim()) return configured.replace(/\/+$/, "");
      const proto = window.location.protocol;
      const host = window.location.hostname;
      const port = window.location.port;
      if (port === "8000") return `${proto}//${host}:${port}/api`;
      if (host === "localhost" || host === "127.0.0.1")
        return `${proto}//${host}:8000/api`;
      return `${proto}//${host}/api`;
    })();

    const token =
      (window.AdminSession && window.AdminSession.getToken()) ||
      localStorage.getItem("auth_token") ||
      "";
    if (!token) return;

    fetch(`${API_BASE}/user`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    })
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((user) => {
        if (!user) return;
        const email = user.email || (user.data && user.data.email) || "";
        if (!email) return;
        document.querySelectorAll(".profile-initial").forEach((el) => {
          el.dataset.email = email;
          el.textContent = email.trim().charAt(0).toUpperCase();
        });
        const popupIdentity = document.querySelector(".popup-identity");
        if (popupIdentity) popupIdentity.textContent = email;
        const currentGmailEl = document.getElementById("currentGmailValue");
        if (currentGmailEl) currentGmailEl.textContent = email;
        try {
          if (window.AdminSession) {
            window.AdminSession.setUserInfo(user);
          } else {
            localStorage.setItem("user_info", JSON.stringify(user));
          }
        } catch (e) {
          /* ignore */
        }
      })
      .catch(() => {
        /* ignore network errors */
      });
  })();

  if (userProfile && profilePopup) {
    userProfile.addEventListener("click", (e) => {
      e.stopPropagation();
      profilePopup.classList.toggle("show");
    });

    document.addEventListener("click", (e) => {
      if (!userProfile.contains(e.target)) {
        profilePopup.classList.remove("show");
      }
    });

    profilePopup.addEventListener("click", (e) => {
      e.stopPropagation();
    });
  }

  // --- NOTIFICATION BELL LOGIC (Dynamic — Laravel Backend) ---
  const notifBtn = document.querySelector(".notifications");

  if (notifBtn) {
    const NOTIF_API_BASE = (() => {
      const configured =
        window.APP_API_BASE_URL ||
        document
          .querySelector('meta[name="api-base-url"]')
          ?.getAttribute("content") ||
        "";
      if (configured.trim()) return configured.replace(/\/+$/, "");
      const proto = window.location.protocol;
      const host = window.location.hostname;
      const port = window.location.port;
      if (port === "8000") return `${proto}//${host}:${port}/api`;
      if (host === "localhost" || host === "127.0.0.1")
        return `${proto}//${host}:8000/api`;
      return `${proto}//${host}/api`;
    })();

    const NOTIF_POLL_INTERVAL = 10000; // 10 seconds — near real-time
    let notifPollTimer = null;
    let currentUnreadCount = 0;
    const NOTIF_REALTIME_SIGNAL_KEY = "fmrc_admin_notif_updated_at";
    const NOTIF_REALTIME_CHANNEL = "fmrc-admin-notifs-realtime";
    let notifRealtimeChannel = null;
    let lastNotifSignalTs = 0;
    let notifSyncTimer = null;

    // Ensure dropdown exists — attach to body (not notifBtn) for correct positioning
    let notifDropdown = document.getElementById("notificationDropdown");
    if (!notifDropdown) {
      notifDropdown = document.createElement("div");
      notifDropdown.id = "notificationDropdown";
      notifDropdown.className = "notification-dropdown";
      notifDropdown.innerHTML = `
        <div class="notif-header">
          <h3>Notifications</h3>
          <button class="notif-mark-all-btn" id="notifMarkAllBtn" title="Mark all as read" style="display:none;">
            <i class="fa-solid fa-check-double"></i>
          </button>
        </div>
        <div class="notif-body" id="notifBody">
          <div class="notif-empty" id="notifEmptyState">
            <i class="fa-regular fa-bell-slash"></i>
            <p>Nothing right now</p>
          </div>
        </div>
        <div class="notif-footer">
          <button type="button" class="notif-view-all-btn" id="notifViewAllBtn">
            View All Notifications <i class="fa-solid fa-arrow-right"></i>
          </button>
        </div>
      `;
      // Attach to body so it is never a descendant of notifBtn
      document.body.appendChild(notifDropdown);
    }

    const notifBody = notifDropdown.querySelector("#notifBody");
    const notifEmptyState = notifDropdown.querySelector("#notifEmptyState");
    const notifMarkAllBtn = notifDropdown.querySelector("#notifMarkAllBtn");
    const notifBadge =
      notifBtn.querySelector(".badge") || notifBtn.querySelector("#notifBadge");

    // Helper: get auth token
    const getToken = () =>
      (window.AdminSession && window.AdminSession.getToken()) ||
      localStorage.getItem("auth_token") ||
      "";

    const getNotifRealtimeChannel = () => {
      if (typeof window.BroadcastChannel !== "function") return null;
      if (!notifRealtimeChannel) {
        notifRealtimeChannel = new window.BroadcastChannel(
          NOTIF_REALTIME_CHANNEL,
        );
      }
      return notifRealtimeChannel;
    };

    const emitNotifSignal = (detail = {}) => {
      const payload = {
        source: "admin-notifications",
        timestamp: Date.now(),
        ...detail,
      };

      window.dispatchEvent(
        new CustomEvent("fmrc:notifs-updated", { detail: payload }),
      );

      try {
        localStorage.setItem(
          NOTIF_REALTIME_SIGNAL_KEY,
          JSON.stringify(payload),
        );
      } catch {
        // Ignore storage write issues.
      }

      const channel = getNotifRealtimeChannel();
      channel?.postMessage(payload);
    };

    const shouldProcessNotifSignal = (payload = {}) => {
      const ts = Number(payload?.timestamp || 0);
      if (!Number.isFinite(ts) || ts <= 0) return true;
      if (ts <= lastNotifSignalTs) return false;
      lastNotifSignalTs = ts;
      return true;
    };

    // Helper: update badge display
    const updateBadge = (count) => {
      currentUnreadCount = count;
      if (notifBadge) {
        if (count > 0) {
          notifBadge.textContent = count > 99 ? "99+" : String(count);
          notifBadge.style.display = "";
          notifBtn.classList.add("has-new"); // bell swings when there are notifications
        } else {
          notifBadge.textContent = "";
          notifBadge.style.display = "none";
          notifBtn.classList.remove("has-new"); // stop swinging when no notifications
        }
      } else {
        if (count > 0) {
          notifBtn.classList.add("has-new");
        } else {
          notifBtn.classList.remove("has-new");
        }
      }
    };

    // Format relative time
    const formatRelTime = (dateStr) => {
      if (!dateStr) return "";
      const diff = Date.now() - new Date(dateStr).getTime();
      const mins = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);
      if (mins < 1) return "just now";
      if (mins < 60) return `${mins}m ago`;
      if (hours < 24) return `${hours}h ago`;
      return `${days}d ago`;
    };

    // Render notifications (dropdown — 5 most recent)
    const NOTIF_TYPE_ICONS = {
      order: "fa-box-open",
      appointment: "fa-calendar-check",
      success: "fa-circle-check",
      warning: "fa-triangle-exclamation",
      error: "fa-circle-xmark",
      info: "fa-circle-info",
    };

    const escHtml = (s) =>
      String(s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

    const buildNotifItemHTML = (n, compact = true) => {
      const icon = NOTIF_TYPE_ICONS[n.type] || "fa-circle-info";
      const typeClass = `notif-type-${n.type || "info"}`;
      const readClass = n.is_read ? "" : " notif-unread";
      const msgClamp = compact ? "notif-item-msg" : "notif-item-msg";
      return `
        <div class="notif-item${readClass}" data-notif-id="${n.id}">
          <div class="notif-type-dot ${typeClass}"><i class="fa-solid ${icon}"></i></div>
          <div class="notif-item-body">
            <div class="notif-item-title">${escHtml(n.title)}</div>
            <div class="${msgClamp}">${escHtml(n.message)}</div>
            <div class="notif-item-time">${formatRelTime(n.created_at)}</div>
          </div>
          <div class="notif-item-actions">
            ${!n.is_read ? `<button class="notif-read-btn" title="Mark as read" data-notif-id="${n.id}"><i class="fa-solid fa-check"></i></button>` : '<div class="notif-unread-dot" style="visibility:hidden"></div>'}
            <button class="notif-del-btn" title="Dismiss" data-notif-id="${n.id}"><i class="fa-solid fa-xmark"></i></button>
          </div>
        </div>`;
    };

    let _lastNotifData = [];

    const renderNotifications = (notifications) => {
      if (!notifBody) return;
      _lastNotifData = notifications;

      // Remove existing items (keep empty state)
      Array.from(notifBody.querySelectorAll(".notif-item")).forEach((el) =>
        el.remove(),
      );

      const recent = notifications.slice(0, 5);

      if (!recent.length) {
        if (notifEmptyState) notifEmptyState.style.display = "";
        if (notifMarkAllBtn) notifMarkAllBtn.style.display = "none";
        return;
      }

      if (notifEmptyState) notifEmptyState.style.display = "none";

      const hasUnread = recent.some((n) => !n.is_read);
      if (notifMarkAllBtn)
        notifMarkAllBtn.style.display = hasUnread ? "" : "none";

      const frag = document.createDocumentFragment();
      recent.forEach((n) => {
        const wrapper = document.createElement("div");
        wrapper.innerHTML = buildNotifItemHTML(n, true);
        frag.appendChild(wrapper.firstElementChild);
      });
      if (notifEmptyState) {
        notifBody.insertBefore(frag, notifEmptyState);
      } else {
        notifBody.appendChild(frag);
      }

      // Sync All-Notif panel if open
      if (
        document.getElementById("allNotifOverlay")?.classList.contains("show")
      ) {
        renderAllNotifPanel(notifications);
      }
    };

    // Fetch & render notifications
    const fetchNotifications = async () => {
      const token = getToken();
      if (!token) return;
      try {
        const res = await fetch(`${NOTIF_API_BASE}/admin/notifications`, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        });
        if (!res.ok) return;
        const payload = await res.json();
        const notifications = Array.isArray(payload?.data) ? payload.data : [];
        const unread =
          typeof payload?.unread_count === "number" ? payload.unread_count : 0;
        updateBadge(unread);
        renderNotifications(notifications);
      } catch {
        // Silently ignore — network errors shouldn't disrupt the admin UI
      }
    };

    const scheduleNotifSync = (delay = 0) => {
      if (notifSyncTimer) window.clearTimeout(notifSyncTimer);
      notifSyncTimer = window.setTimeout(() => {
        void fetchNotifications();
      }, delay);
    };

    const handleNotifSignal = (payload = {}) => {
      if (!shouldProcessNotifSignal(payload)) return;
      scheduleNotifSync(0);
    };

    window.addEventListener("fmrc:notifs-updated", (event) => {
      handleNotifSignal(event.detail);
    });

    window.addEventListener("storage", (event) => {
      if (event.key !== NOTIF_REALTIME_SIGNAL_KEY || !event.newValue) return;
      try {
        const payload = JSON.parse(event.newValue);
        handleNotifSignal(payload);
      } catch {
        // Ignore invalid payloads.
      }
    });

    const realtimeChannel = getNotifRealtimeChannel();
    realtimeChannel?.addEventListener("message", (event) => {
      handleNotifSignal(event.data);
    });

    const reconcileNotifications = () => {
      scheduleNotifSync(150);
    };

    // Mark single as read — INSTANT UI + backend sync
    const markAsRead = async (id) => {
      const token = getToken();
      if (!token) return;
      // Optimistic: update local data immediately
      const n = _lastNotifData.find((x) => String(x.id) === String(id));
      if (n && !n.is_read) {
        n.is_read = true;
        currentUnreadCount = Math.max(0, currentUnreadCount - 1);
        updateBadge(currentUnreadCount);
        renderNotifications(_lastNotifData);
        if (typeof renderAllNotifPanel === "function")
          renderAllNotifPanel(_lastNotifData);
      }
      // API runs in background — reconcile silently
      try {
        const res = await fetch(
          `${NOTIF_API_BASE}/admin/notifications/${id}/read`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
            },
          },
        );
        if (res.ok) {
          emitNotifSignal({ action: "read", id });
        }
        reconcileNotifications();
      } catch {
        reconcileNotifications();
      }
    };

    // Mark all as read — INSTANT UI + backend sync
    const markAllRead = async () => {
      const token = getToken();
      if (!token) return;
      // Optimistic
      _lastNotifData.forEach((n) => {
        n.is_read = true;
      });
      currentUnreadCount = 0;
      updateBadge(0);
      renderNotifications(_lastNotifData);
      if (typeof renderAllNotifPanel === "function")
        renderAllNotifPanel(_lastNotifData);
      // API runs in background
      try {
        const res = await fetch(
          `${NOTIF_API_BASE}/admin/notifications/mark-all-read`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
            },
          },
        );
        if (res.ok) {
          emitNotifSignal({ action: "mark-all-read" });
        }
        reconcileNotifications();
      } catch {
        reconcileNotifications();
      }
    };

    // Delete notification — INSTANT UI + backend sync
    const deleteNotification = async (id) => {
      const token = getToken();
      if (!token) return;
      // Optimistic: remove from local data immediately
      const idx = _lastNotifData.findIndex((x) => String(x.id) === String(id));
      if (idx !== -1) {
        const wasUnread = !_lastNotifData[idx].is_read;
        _lastNotifData.splice(idx, 1);
        if (wasUnread) {
          currentUnreadCount = Math.max(0, currentUnreadCount - 1);
          updateBadge(currentUnreadCount);
        }
        renderNotifications(_lastNotifData);
        if (typeof renderAllNotifPanel === "function")
          renderAllNotifPanel(_lastNotifData);
      }
      // API runs in background
      try {
        const res = await fetch(`${NOTIF_API_BASE}/admin/notifications/${id}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        });
        if (res.ok) {
          emitNotifSignal({ action: "delete", id });
        }
        reconcileNotifications();
      } catch {
        reconcileNotifications();
      }
    };

    const clearAllNotifications = async () => {
      const token = getToken();
      if (!token) return;
      // Optimistic: wipe local data immediately
      _lastNotifData.length = 0;
      currentUnreadCount = 0;
      updateBadge(0);
      renderNotifications(_lastNotifData);
      if (typeof renderAllNotifPanel === "function")
        renderAllNotifPanel(_lastNotifData);

      try {
        const res = await fetch(
          `${NOTIF_API_BASE}/admin/notifications/clear-all`,
          {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
            },
          },
        );
        if (res.ok) {
          emitNotifSignal({ action: "clear-all" });
        }
        reconcileNotifications();
      } catch {
        reconcileNotifications();
      }
    };

    // Helper: position the dropdown below the bell button (works even when attached to body)
    const positionDropdown = () => {
      const rect = notifBtn.getBoundingClientRect();
      const dropW = 320;
      const gap = 12;
      // Right-align dropdown under the bell, with 12px right-edge padding
      let left = rect.left + rect.width / 2 - dropW / 2;
      const maxLeft = window.innerWidth - dropW - 12;
      if (left > maxLeft) left = maxLeft;
      if (left < 8) left = 8;
      notifDropdown.style.position = "fixed";
      notifDropdown.style.top =
        rect.bottom + gap + window.scrollY - window.scrollY + "px";
      notifDropdown.style.left = left + "px";
      notifDropdown.style.width = dropW + "px";
    };

    // Bell click — open/close dropdown, stop ringing
    notifBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      // Ignore clicks that already originated inside the dropdown itself
      if (notifDropdown.contains(e.target)) return;
      const wasOpen = notifDropdown.classList.contains("show");
      notifDropdown.classList.toggle("show");
      if (profilePopup) profilePopup.classList.remove("show");
      // When user opens the dropdown, position it and refresh to show latest
      if (!wasOpen && notifDropdown.classList.contains("show")) {
        positionDropdown();
        void fetchNotifications();
      }
    });

    // Close when clicking outside
    document.addEventListener("click", (e) => {
      if (!notifBtn.contains(e.target) && !notifDropdown.contains(e.target)) {
        notifDropdown.classList.remove("show");
      }
    });

    notifDropdown.addEventListener("click", (e) => {
      e.stopPropagation();
    });

    // Event delegation for mark-read and delete buttons inside dropdown
    notifDropdown.addEventListener("click", (e) => {
      const readBtn = e.target.closest(".notif-read-btn");
      if (readBtn) {
        const id = readBtn.dataset.notifId;
        if (id) void markAsRead(id);
        return;
      }
      const delBtn = e.target.closest(".notif-del-btn");
      if (delBtn) {
        const id = delBtn.dataset.notifId;
        if (id) void deleteNotification(id);
        return;
      }
    });

    // Mark all button (dropdown header)
    if (notifMarkAllBtn) {
      notifMarkAllBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        void markAllRead();
      });
    }

    // ── All Notifications Panel ───────────────────────────────────
    let _allNotifFilter = "all"; // 'all' | 'unread' | 'order' | 'appointment'

    const formatFullDate = (dateStr) => {
      if (!dateStr) return "";
      return new Date(dateStr).toLocaleString("en-PH", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    };

    const getFilteredNotifs = (notifications) => {
      switch (_allNotifFilter) {
        case "unread":
          return notifications.filter((n) => !n.is_read);
        case "order":
          return notifications.filter((n) => n.type === "order");
        case "appointment":
          return notifications.filter((n) => n.type === "appointment");
        default:
          return notifications;
      }
    };

    const renderAllNotifPanel = (notifications) => {
      const list = document.getElementById("allNotifList");
      if (!list) return;

      const filtered = getFilteredNotifs(notifications);
      list.innerHTML = "";

      if (!filtered.length) {
        list.innerHTML = `
          <div class="all-notif-empty">
            <i class="fa-regular fa-bell-slash"></i>
            <p>${_allNotifFilter === "unread" ? "All caught up!" : "No notifications here."}</p>
          </div>`;
        return;
      }

      // Group by date
      let lastDateLabel = "";
      filtered.forEach((n) => {
        const d = n.created_at ? new Date(n.created_at) : new Date();
        const lbl = d.toLocaleDateString("en-PH", {
          month: "long",
          day: "numeric",
          year: "numeric",
        });
        if (lbl !== lastDateLabel) {
          lastDateLabel = lbl;
          const sep = document.createElement("div");
          sep.className = "all-notif-date-sep";
          sep.textContent = lbl;
          list.appendChild(sep);
        }
        const wrapper = document.createElement("div");
        wrapper.innerHTML = buildNotifItemHTML(n, false);
        list.appendChild(wrapper.firstElementChild);
      });
    };

    const openAllNotifPanel = () => {
      let overlay = document.getElementById("allNotifOverlay");
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "allNotifOverlay";
        overlay.className = "all-notif-overlay";
        overlay.innerHTML = `
          <div class="all-notif-backdrop" id="allNotifBackdrop"></div>
          <div class="all-notif-panel" role="dialog" aria-modal="true" aria-label="All Notifications">
            <div class="all-notif-head">
              <div class="all-notif-head-left">
                <h2><i class="fa-solid fa-bell" style="margin-right:8px;font-size:.9em;"></i>All Notifications</h2>
                <p>Your complete activity feed</p>
              </div>
              <button type="button" class="all-notif-close" id="allNotifClose" aria-label="Close">&times;</button>
            </div>
            <div class="all-notif-filter">
              <button type="button" class="all-notif-filter-btn active" data-filter="all">All</button>
              <button type="button" class="all-notif-filter-btn" data-filter="unread">Unread</button>
              <button type="button" class="all-notif-filter-btn" data-filter="order">Orders</button>
              <button type="button" class="all-notif-filter-btn" data-filter="appointment">Appointments</button>
            </div>
            <div class="all-notif-actions-bar">
              <button type="button" class="all-notif-action-btn" id="allNotifMarkAll">
                <i class="fa-solid fa-check-double"></i> Mark All Read
              </button>
              <button type="button" class="all-notif-action-btn danger" id="allNotifClearAll">
                <i class="fa-solid fa-trash"></i> Clear All
              </button>
            </div>
            <div class="all-notif-list" id="allNotifList">
              <div class="all-notif-loading">
                <i class="fa-solid fa-spinner fa-spin"></i>
                <p>Loading notifications...</p>
              </div>
            </div>
          </div>`;
        document.body.appendChild(overlay);

        // Filter tabs
        overlay.querySelectorAll(".all-notif-filter-btn").forEach((btn) => {
          btn.addEventListener("click", () => {
            overlay
              .querySelectorAll(".all-notif-filter-btn")
              .forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            _allNotifFilter = btn.dataset.filter || "all";
            renderAllNotifPanel(_lastNotifData);
          });
        });

        // Close button & backdrop
        document
          .getElementById("allNotifClose")
          ?.addEventListener("click", closeAllNotifPanel);
        document
          .getElementById("allNotifBackdrop")
          ?.addEventListener("click", closeAllNotifPanel);

        // Mark all read — optimistic
        document
          .getElementById("allNotifMarkAll")
          ?.addEventListener("click", () => {
            void markAllRead();
            renderAllNotifPanel(_lastNotifData);
          });

        // Clear all — optimistic: wipe local data, re-render, API in background
        document
          .getElementById("allNotifClearAll")
          ?.addEventListener("click", () => {
            void clearAllNotifications();
          });

        // Delegation: read/delete inside panel
        document
          .getElementById("allNotifList")
          ?.addEventListener("click", (e) => {
            const readBtn = e.target.closest(".notif-read-btn");
            if (readBtn) {
              void markAsRead(readBtn.dataset.notifId);
              return;
            }
            const delBtn = e.target.closest(".notif-del-btn");
            if (delBtn) {
              void deleteNotification(delBtn.dataset.notifId);
              return;
            }
          });

        // Keyboard close
        document.addEventListener("keydown", (e) => {
          if (e.key === "Escape" && overlay.classList.contains("show"))
            closeAllNotifPanel();
        });
      }

      // Render current data immediately, then refresh
      void fetchNotifications().then(() => renderAllNotifPanel(_lastNotifData));
      // Slight delay to trigger CSS transition
      requestAnimationFrame(() => {
        requestAnimationFrame(() => overlay.classList.add("show"));
      });
      document.body.style.overflow = "hidden";
    };

    const closeAllNotifPanel = () => {
      const overlay = document.getElementById("allNotifOverlay");
      overlay?.classList.remove("show");
      document.body.style.overflow = "";
    };

    // Wire View All button
    notifDropdown
      .querySelector("#notifViewAllBtn")
      ?.addEventListener("click", (e) => {
        e.stopPropagation();
        notifDropdown.classList.remove("show");
        openAllNotifPanel();
      });

    // Start polling for notifications
    void fetchNotifications();
    notifPollTimer = setInterval(fetchNotifications, NOTIF_POLL_INTERVAL);

    // Expose globally so other scripts can trigger a refresh
    window.refreshAdminNotifications = fetchNotifications;
    window.openAllNotificationsPanel = openAllNotifPanel;
  }

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
          <div style="background: #fff; border-radius: 12px; width: 100%; max-width: 420px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04); transform: scale(0.95); transition: transform 0.2s ease; font-family: 'Open Sans', sans-serif; overflow: hidden;">
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
        confirmBtn.style.backgroundColor = "#7f1d1d"; // Darker red
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
        await fetch("http://127.0.0.1:8000/api/logout", {
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
      // Clear role-specific session via helper
      if (window.AdminSession) {
        window.AdminSession.clearSession();
      }
      // Also clear any legacy keys
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

  const openers = document.querySelectorAll("[data-modal-open]");
  const closers = document.querySelectorAll("[data-modal-close]");

  openers.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-modal-open");
      const modal = document.querySelector(target);
      modal?.classList.add("show");
    });
  });

  closers.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-modal-close");
      const modal = document.querySelector(target);
      modal?.classList.remove("show");
    });
  });

  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (overlay.getAttribute("data-backdrop-close") === "false") {
        return;
      }
      if (e.target === overlay) {
        overlay.classList.remove("show");
      }
    });
  });

  const tooltipEl = document.createElement("div");
  tooltipEl.className = "admin-global-tooltip";
  document.body.appendChild(tooltipEl);

  let activeTooltipTarget = null;

  const hideTooltip = () => {
    activeTooltipTarget = null;
    tooltipEl.classList.remove("show");
  };

  const placeTooltip = (target) => {
    const text = target.getAttribute("data-tooltip") || "";
    if (!text) {
      hideTooltip();
      return;
    }

    tooltipEl.textContent = text;
    tooltipEl.classList.add("show");

    const rect = target.getBoundingClientRect();
    const tipRect = tooltipEl.getBoundingClientRect();
    const gap = 10;
    const viewportPadding = 8;

    let left = rect.left + rect.width / 2 - tipRect.width / 2;
    left = Math.max(
      viewportPadding,
      Math.min(left, window.innerWidth - tipRect.width - viewportPadding),
    );

    let top = rect.top - tipRect.height - gap;
    if (top < viewportPadding) {
      top = rect.bottom + gap;
      tooltipEl.style.setProperty("--tooltip-arrow-rotation", "180deg");
      tooltipEl.style.setProperty("--tooltip-arrow-bottom", "auto");
      tooltipEl.style.setProperty("--tooltip-arrow-top", "-5px");
    } else {
      tooltipEl.style.setProperty("--tooltip-arrow-rotation", "0deg");
      tooltipEl.style.setProperty("--tooltip-arrow-bottom", "-5px");
      tooltipEl.style.setProperty("--tooltip-arrow-top", "auto");
    }

    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;
  };

  document.addEventListener("mouseover", (e) => {
    const target =
      e.target instanceof Element ? e.target.closest("[data-tooltip]") : null;
    if (!target) return;
    activeTooltipTarget = target;
    placeTooltip(target);
  });

  document.addEventListener("mousemove", (e) => {
    if (!activeTooltipTarget) return;
    const current =
      e.target instanceof Element ? e.target.closest("[data-tooltip]") : null;
    if (current !== activeTooltipTarget) return;
    placeTooltip(activeTooltipTarget);
  });

  document.addEventListener("mouseout", (e) => {
    if (!activeTooltipTarget) return;
    const from =
      e.target instanceof Element ? e.target.closest("[data-tooltip]") : null;
    if (from !== activeTooltipTarget) return;
    const to =
      e.relatedTarget instanceof Element
        ? e.relatedTarget.closest("[data-tooltip]")
        : null;
    if (to === activeTooltipTarget) return;
    hideTooltip();
  });

  document.addEventListener("focusin", (e) => {
    const target =
      e.target instanceof Element ? e.target.closest("[data-tooltip]") : null;
    if (!target) return;
    activeTooltipTarget = target;
    placeTooltip(target);
  });

  document.addEventListener("focusout", (e) => {
    const target =
      e.target instanceof Element ? e.target.closest("[data-tooltip]") : null;
    if (target && target === activeTooltipTarget) {
      hideTooltip();
    }
  });

  window.addEventListener(
    "scroll",
    () => {
      if (activeTooltipTarget) placeTooltip(activeTooltipTarget);
    },
    true,
  );

  window.addEventListener("resize", () => {
    if (activeTooltipTarget) placeTooltip(activeTooltipTarget);
  });

  const ensureAdminSystemPopup = () => {
    let popup = document.getElementById("adminSystemPopup");
    if (popup) return popup;

    popup = document.createElement("div");
    popup.id = "adminSystemPopup";
    popup.className = "admin-system-popup";
    popup.innerHTML = `
      <div class="admin-system-popup__backdrop"></div>
      <div class="admin-system-popup__card" role="dialog" aria-modal="true" aria-labelledby="adminSystemPopupTitle">
        <h3 id="adminSystemPopupTitle" class="admin-system-popup__title">System Message</h3>
        <hr class="admin-system-popup__separator" />
        <p id="adminSystemPopupMessage" class="admin-system-popup__message"></p>
        <hr class="admin-system-popup__separator" />
        <div class="admin-system-popup__actions">
          <button id="adminSystemPopupCancel" type="button" class="btn-admin btn-secondary">Cancel</button>
          <button id="adminSystemPopupOk" type="button" class="btn-admin">Okay</button>
        </div>
      </div>
    `;

    document.body.appendChild(popup);
    return popup;
  };

  const showAdminSystemPopup = (message, options = {}) => {
    const popup = ensureAdminSystemPopup();
    const titleEl = popup.querySelector("#adminSystemPopupTitle");
    const msgEl = popup.querySelector("#adminSystemPopupMessage");
    const okBtn = popup.querySelector("#adminSystemPopupOk");
    const cancelBtn = popup.querySelector("#adminSystemPopupCancel");
    const actions = popup.querySelector(".admin-system-popup__actions");
    const backdrop = popup.querySelector(".admin-system-popup__backdrop");

    if (titleEl) titleEl.textContent = options.title || "System Message";
    if (msgEl) msgEl.textContent = String(message || "Done.");

    const closePopup = (callback) => {
      popup.classList.remove("show");
      if (typeof callback === "function") {
        callback();
      }
    };

    const setConfirmLoading = (isLoading) => {
      if (!okBtn) return;
      if (isLoading) {
        okBtn.disabled = true;
        okBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${options.loadingText || "Processing..."}`;
      } else {
        okBtn.disabled = false;
        okBtn.textContent = options.okText || (isConfirm ? "Confirm" : "Okay");
      }
      if (cancelBtn) {
        cancelBtn.disabled = isLoading;
      }
    };

    const isConfirm = Boolean(options.isConfirm);

    if (actions) {
      actions.classList.toggle("is-confirm", isConfirm);
    }

    if (okBtn) {
      okBtn.disabled = false;
      okBtn.textContent = options.okText || (isConfirm ? "Confirm" : "Okay");
      okBtn.onclick = async () => {
        if (!options.keepOpenWhilePending) {
          closePopup(options.onOk);
          return;
        }

        try {
          setConfirmLoading(true);
          const result =
            typeof options.onOk === "function" ? options.onOk() : undefined;
          const resolvedResult =
            result && typeof result.then === "function" ? await result : result;
          closePopup();
          if (typeof options.onSuccess === "function") {
            window.setTimeout(() => options.onSuccess(resolvedResult), 0);
          }
        } catch (error) {
          setConfirmLoading(false);
          if (typeof options.onError === "function") {
            options.onError(error);
          }
        }
      };
    }

    if (cancelBtn) {
      cancelBtn.disabled = false;
      cancelBtn.textContent = options.cancelText || "Cancel";
      cancelBtn.style.display = isConfirm ? "inline-flex" : "none";
      cancelBtn.onclick = () => closePopup(options.onCancel);
    }

    if (backdrop) {
      // Only allow backdrop dismiss for confirm dialogs (Cancel action).
      // Informational and error dialogs retain an explicit Okay action.
      if (isConfirm) {
        backdrop.onclick = () => closePopup(options.onCancel);
      } else {
        backdrop.onclick = null;
      }
    }

    popup.classList.add("show");

    if (isConfirm && cancelBtn) {
      cancelBtn.focus();
    } else if (okBtn) {
      okBtn.focus();
    }
  };

  const ADMIN_SUCCESS_NOTIFICATION_DURATION = 3000;
  const ADMIN_SUCCESS_NOTIFICATION_FADE_OUT = 220;
  const SUCCESS_TITLE_PATTERN =
    /\b(success|successful|saved|created|updated|deleted|archived|restored|approved|rejected|resolved|published|applied|sent|added|removed|completed|confirmed)\b/i;
  const SUCCESS_MESSAGE_PATTERN =
    /\b(successfully|saved|created|updated|deleted|archived|restored|approved|rejected|resolved|published|applied|sent|added|removed|completed|confirmed)\b/i;
  const NON_SUCCESS_PATTERN =
    /\b(error|failed|failure|unable|cannot|invalid|required|warning|notice|session|unauthorized|forbidden|not found|try again|please select|please enter|please choose|please log in|login)\b/i;

  const ensureAdminSuccessNotificationStack = () => {
    let stack = document.getElementById("adminSuccessNotificationStack");
    if (stack) return stack;

    stack = document.createElement("div");
    stack.id = "adminSuccessNotificationStack";
    stack.className = "admin-success-notification-stack";
    stack.setAttribute("role", "region");
    stack.setAttribute("aria-label", "Success notifications");
    stack.setAttribute("aria-live", "polite");
    document.body.appendChild(stack);
    return stack;
  };

  const showAdminSuccessNotification = (message, options = {}) => {
    const stack = ensureAdminSuccessNotificationStack();
    const notification = document.createElement("div");
    const title = String(options.title || "Success!");
    const text = String(message || "Your changes were saved successfully.");

    notification.className = "admin-success-notification";
    notification.setAttribute("role", "status");
    notification.setAttribute("aria-atomic", "true");
    notification.innerHTML = `
      <span class="admin-success-notification__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <path d="m5 12 4 4L19 6"></path>
        </svg>
      </span>
      <span class="admin-success-notification__content">
        <strong class="admin-success-notification__title"></strong>
        <span class="admin-success-notification__message"></span>
      </span>
      <button class="admin-success-notification__close" type="button" aria-label="Close success notification" title="Close notification">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
          <path d="M6 6 18 18M18 6 6 18"></path>
        </svg>
      </button>
      <svg class="admin-success-notification__progress" aria-hidden="true" focusable="false" preserveAspectRatio="none">
        <path class="admin-success-notification__progress-path"></path>
      </svg>
    `;
    notification.querySelector(
      ".admin-success-notification__title",
    ).textContent = title;
    notification.querySelector(
      ".admin-success-notification__message",
    ).textContent = text;
    stack.appendChild(notification);

    // Follow the rounded top-right corner, right edge, bottom edge, left edge,
    // and rounded top-left corner. There is intentionally no top-edge segment.
    const progress = notification.querySelector(
      ".admin-success-notification__progress",
    );
    const progressPath = notification.querySelector(
      ".admin-success-notification__progress-path",
    );
    const bounds = notification.getBoundingClientRect();
    const progressWidth = Math.max(bounds.width, 1);
    const progressHeight = Math.max(bounds.height, 1);
    const progressInset = 2;
    const progressRadius = Math.min(
      13,
      Math.max(1, progressHeight / 2 - progressInset),
    );
    const progressRight = progressWidth - progressInset;
    const progressBottom = progressHeight - progressInset;
    const progressTop = progressInset + progressRadius;

    progress?.setAttribute(
      "viewBox",
      `0 0 ${progressWidth.toFixed(3)} ${progressHeight.toFixed(3)}`,
    );
    progressPath?.setAttribute(
      "d",
      [
        `M ${(progressRight - progressRadius).toFixed(3)} ${progressInset.toFixed(3)}`,
        `Q ${progressRight.toFixed(3)} ${progressInset.toFixed(3)} ${progressRight.toFixed(3)} ${progressTop.toFixed(3)}`,
        `V ${(progressBottom - progressRadius).toFixed(3)}`,
        `Q ${progressRight.toFixed(3)} ${progressBottom.toFixed(3)} ${(progressRight - progressRadius).toFixed(3)} ${progressBottom.toFixed(3)}`,
        `H ${(progressInset + progressRadius).toFixed(3)}`,
        `Q ${progressInset.toFixed(3)} ${progressBottom.toFixed(3)} ${progressInset.toFixed(3)} ${(progressBottom - progressRadius).toFixed(3)}`,
        `V ${progressTop.toFixed(3)}`,
        `Q ${progressInset.toFixed(3)} ${progressInset.toFixed(3)} ${(progressInset + progressRadius).toFixed(3)} ${progressInset.toFixed(3)}`,
      ].join(" "),
    );

    if (progressPath) {
      const pathTotalLength = Math.max(1, progressPath.getTotalLength());
      progressPath.style.strokeDasharray = `${pathTotalLength.toFixed(2)} ${(pathTotalLength * 2).toFixed(2)}`;
      progressPath.style.strokeDashoffset = `${pathTotalLength.toFixed(2)}`;
      progressPath.style.setProperty(
        "--path-total-length",
        `${pathTotalLength.toFixed(2)}px`,
      );
    }

    progress?.style.setProperty(
      "--admin-success-progress-duration",
      `${ADMIN_SUCCESS_NOTIFICATION_DURATION}ms`,
    );

    let removalTimer = 0;
    let isDismissed = false;
    const dismissNotification = () => {
      if (isDismissed) return;
      isDismissed = true;
      window.clearTimeout(removalTimer);
      notification.classList.remove("is-visible");
      notification.classList.add("is-leaving");
      removalTimer = window.setTimeout(() => {
        notification.remove();
        if (!stack.childElementCount) stack.remove();
      }, ADMIN_SUCCESS_NOTIFICATION_FADE_OUT);
    };

    notification
      .querySelector(".admin-success-notification__close")
      ?.addEventListener("click", dismissNotification);
    progressPath?.addEventListener(
      "animationend",
      (event) => {
        if (event.animationName === "adminSuccessNotificationPerimeter") {
          dismissNotification();
        }
      },
      { once: true },
    );

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (isDismissed) return;
        notification.classList.add("is-visible");
      });
    });

    window.dispatchEvent(
      new CustomEvent("admin:success-notification", {
        detail: {
          title,
          message: text,
          duration: ADMIN_SUCCESS_NOTIFICATION_DURATION,
        },
      }),
    );

    return notification;
  };

  const shouldUseAdminSuccessNotification = (message, options = {}) => {
    if (options.type === "success" || options.variant === "success") return true;
    if (options.type === "modal" || options.variant === "modal") return false;

    const title = String(options.title || "").trim();
    const text = String(message || "").trim();
    if (NON_SUCCESS_PATTERN.test(title) || NON_SUCCESS_PATTERN.test(text)) {
      return false;
    }
    if (title) return SUCCESS_TITLE_PATTERN.test(title);
    return SUCCESS_MESSAGE_PATTERN.test(text);
  };

  window.showAdminSuccessNotification = showAdminSuccessNotification;

  window.showAdminPopup = (message, options = {}) => {
    if (shouldUseAdminSuccessNotification(message, options)) {
      showAdminSuccessNotification(message, { title: "Success!" });
      if (typeof options.onOk === "function") {
        window.setTimeout(() => {
          try {
            options.onOk();
          } catch (error) {
            console.error("Success notification callback failed:", error);
          }
        }, 0);
      }
      return;
    }

    showAdminSystemPopup(message, {
      title: options.title,
      okText: options.okText,
      onOk: options.onOk,
      isConfirm: false,
    });
  };

  window.showAdminConfirmPopup = (message, options = {}) => {
    showAdminSystemPopup(message, {
      title: options.title || "Please Confirm",
      okText: options.confirmText || "Confirm",
      cancelText: options.cancelText || "Cancel",
      onOk: options.onConfirm,
      onCancel: options.onCancel,
      keepOpenWhilePending: Boolean(options.keepOpenWhilePending),
      loadingText: options.loadingText,
      onError: options.onError,
      onSuccess: options.onSuccess,
      isConfirm: true,
    });
  };

  // Replace native browser alert on admin pages with system popup.
  window.alert = (message) => {
    window.showAdminPopup(message);
  };

  // Shared bulk-selection controller used by Admin and Staff data tables.
  // Page scripts own their row rendering and API calls; this controller keeps
  // selection state, footer controls, and checkbox behavior consistent.
  const bulkSelectionControllers = new Map();
  const escapeBulkHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const resolveBulkElement = (value) => {
    if (value instanceof Element) return value;
    if (typeof value === "string") return document.querySelector(value);
    return null;
  };

  window.AdminBulkSelection = {
    create(options = {}) {
      const key = String(options.key || "").trim();
      const table = resolveBulkElement(options.table);
      const footer = resolveBulkElement(options.footer);
      if (!key || !table || !footer) return null;

      bulkSelectionControllers.get(key)?.destroy?.();

      const selectedIds = new Set();
      let selectionMode = false;
      let busy = false;
      const getId =
        typeof options.getId === "function"
          ? options.getId
          : (row) => row?.id;
      const getEligibleRows = () => {
        const rows =
          typeof options.getEligibleRows === "function"
            ? options.getEligibleRows()
            : [];
        return Array.isArray(rows) ? rows : [];
      };
      const getPageRows = () => {
        const rows =
          typeof options.getPageRows === "function"
            ? options.getPageRows()
            : getEligibleRows();
        return Array.isArray(rows) ? rows : [];
      };
      const normalizeId = (value) => String(value ?? "").trim();
      const deserializeId = (value) =>
        typeof options.deserializeId === "function"
          ? options.deserializeId(value)
          : /^\d+$/.test(value)
            ? Number(value)
            : value;
      const tableLabel = options.tableLabel || "table records";
      const idleAction = options.idleAction || {
        label: `Select ${tableLabel}`,
        icon: "fa-list-check",
      };
      const actions = Array.isArray(options.actions) ? options.actions : [];

      let tools = footer.querySelector(`[data-admin-bulk-tools="${key}"]`);
      if (!tools) {
        tools = document.createElement("div");
        tools.className = "admin-bulk-selection-tools";
        tools.dataset.adminBulkTools = key;
        const pagination = footer.querySelector(".table-pagination");
        footer.insertBefore(tools, pagination || null);
      }

      table.classList.add("admin-bulk-table");

      const eligibleIdSet = () =>
        new Set(
          getEligibleRows()
            .map((row) => normalizeId(getId(row)))
            .filter(Boolean),
        );

      const pageIdSet = (eligible) =>
        new Set(
          getPageRows()
            .map((row) => normalizeId(getId(row)))
            .filter((id) => id && eligible.has(id)),
        );

      const prune = () => {
        const eligible = eligibleIdSet();
        selectedIds.forEach((id) => {
          if (!eligible.has(id)) selectedIds.delete(id);
        });
        return eligible;
      };

      const renderTools = (eligible) => {
        if (!tools) return;
        const allIds = [...eligible];
        const allSelected =
          allIds.length > 0 && allIds.every((id) => selectedIds.has(id));

        if (!selectionMode) {
          const label = idleAction.label || `Select ${tableLabel}`;
          tools.innerHTML = `
            <button type="button" class="btn-admin icon-only-btn admin-bulk-mode-toggle ${escapeBulkHtml(idleAction.className || "")}" data-admin-bulk-enter="${escapeBulkHtml(key)}" data-tooltip="${escapeBulkHtml(label)}" aria-label="${escapeBulkHtml(label)}" title="${escapeBulkHtml(label)}" ${allIds.length && !busy ? "" : "disabled"}>
              <i class="fa-solid ${escapeBulkHtml(idleAction.icon || "fa-list-check")}" aria-hidden="true"></i>
            </button>`;
          return;
        }

        const actionButtons = actions
          .map((action) => {
            const label = action.label || "Apply to selected records";
            return `
              <button type="button" class="btn-admin icon-only-btn admin-bulk-action ${escapeBulkHtml(action.className || "")}" data-admin-bulk-action="${escapeBulkHtml(action.key || "default")}" data-tooltip="${escapeBulkHtml(label)}" aria-label="${escapeBulkHtml(label)}" title="${escapeBulkHtml(label)}" ${selectedIds.size && !busy ? "" : "disabled"}>
                <i class="fa-solid ${escapeBulkHtml(action.icon || "fa-check")}" aria-hidden="true"></i>
              </button>`;
          })
          .join("");

        const selectAllLabel = allSelected
          ? `Clear all ${allIds.length} selected ${tableLabel}`
          : `Select all ${allIds.length} matching ${tableLabel} across every page`;

        tools.innerHTML = `
          <span class="admin-bulk-selection-count">${selectedIds.size} selected</span>
          <button type="button" class="btn-admin btn-secondary icon-only-btn admin-bulk-select-all-pages${allSelected ? " is-active" : ""}" data-admin-bulk-all="${escapeBulkHtml(key)}" data-tooltip="${escapeBulkHtml(selectAllLabel)}" aria-pressed="${String(allSelected)}" aria-label="${escapeBulkHtml(selectAllLabel)}" title="${escapeBulkHtml(selectAllLabel)}" ${allIds.length && !busy ? "" : "disabled"}>
            <i class="fa-solid fa-check-double" aria-hidden="true"></i>
          </button>
          <button type="button" class="btn-admin btn-secondary icon-only-btn admin-bulk-cancel" data-admin-bulk-cancel="${escapeBulkHtml(key)}" data-tooltip="Cancel selection" aria-label="Cancel selection for ${escapeBulkHtml(tableLabel)}" title="Cancel selection" ${busy ? "disabled" : ""}>
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
          ${actionButtons}`;
      };

      const sync = () => {
        const eligible = prune();
        const visible = pageIdSet(eligible);
        const selectedVisibleCount = [...visible].filter((id) =>
          selectedIds.has(id),
        ).length;

        table.classList.toggle("is-bulk-selecting", selectionMode);
        table
          .closest(".panel, .inv-category-card")
          ?.classList.toggle("is-bulk-selection-mode", selectionMode);

        table
          .querySelectorAll(`input[data-admin-bulk-row="${key}"]`)
          .forEach((input) => {
            const id = normalizeId(input.value || input.dataset.id);
            input.checked = selectedIds.has(id);
            input.disabled = busy || !selectionMode || !eligible.has(id);
          });

        table
          .querySelectorAll(`input[data-admin-bulk-page="${key}"]`)
          .forEach((input) => {
            input.checked =
              visible.size > 0 && selectedVisibleCount === visible.size;
            input.indeterminate =
              selectedVisibleCount > 0 && selectedVisibleCount < visible.size;
            input.disabled = busy || !selectionMode || visible.size === 0;
          });

        renderTools(eligible);
        if (typeof options.onSelectionChange === "function") {
          options.onSelectionChange({
            active: selectionMode,
            selectedIds: [...selectedIds].map(deserializeId),
          });
        }
      };

      const onTableChange = (event) => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement)) return;

        if (input.dataset.adminBulkRow === key) {
          if (!selectionMode) return;
          const id = normalizeId(input.value || input.dataset.id);
          if (!id) return;
          if (input.checked) selectedIds.add(id);
          else selectedIds.delete(id);
          sync();
          return;
        }

        if (input.dataset.adminBulkPage === key) {
          if (!selectionMode) return;
          const eligible = eligibleIdSet();
          const visible = pageIdSet(eligible);
          visible.forEach((id) => {
            if (input.checked) selectedIds.add(id);
            else selectedIds.delete(id);
          });
          sync();
        }
      };

      const onToolsClick = (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;

        if (target.closest(`[data-admin-bulk-enter="${key}"]`)) {
          selectedIds.clear();
          selectionMode = true;
          sync();
          return;
        }

        if (target.closest(`[data-admin-bulk-cancel="${key}"]`)) {
          selectedIds.clear();
          selectionMode = false;
          sync();
          return;
        }

        if (target.closest(`[data-admin-bulk-all="${key}"]`)) {
          const eligible = eligibleIdSet();
          const ids = [...eligible];
          const allSelected =
            ids.length > 0 && ids.every((id) => selectedIds.has(id));
          ids.forEach((id) => {
            if (allSelected) selectedIds.delete(id);
            else selectedIds.add(id);
          });
          sync();
          return;
        }

        const actionButton = target.closest("[data-admin-bulk-action]");
        if (!actionButton || busy || !selectedIds.size) return;
        const action = actions.find(
          (candidate) =>
            String(candidate.key || "default") ===
            actionButton.getAttribute("data-admin-bulk-action"),
        );
        if (!action || typeof action.onClick !== "function") return;
        action.onClick(
          [...selectedIds].map(deserializeId),
          controller,
        );
      };

      const controller = {
        key,
        table,
        footer,
        sync,
        isActive: () => selectionMode,
        getSelectedIds: () => [...selectedIds].map(deserializeId),
        clear(options = {}) {
          selectedIds.clear();
          if (options.exit !== false) selectionMode = false;
          sync();
        },
        setBusy(value) {
          busy = Boolean(value);
          sync();
        },
        destroy() {
          table.removeEventListener("change", onTableChange);
          tools?.removeEventListener("click", onToolsClick);
          tools?.remove();
          table.classList.remove("admin-bulk-table", "is-bulk-selecting");
          bulkSelectionControllers.delete(key);
        },
      };

      table.addEventListener("change", onTableChange);
      tools.addEventListener("click", onToolsClick);
      bulkSelectionControllers.set(key, controller);
      sync();
      return controller;
    },
    get(key) {
      return bulkSelectionControllers.get(String(key || "")) || null;
    },
  };

  window.runAdminBulkAction = (options = {}) => {
    const controller = options.controller;
    const ids = [
      ...new Set(
        (Array.isArray(options.ids) ? options.ids : []).filter(
          (id) => Number.isInteger(Number(id)) && Number(id) > 0,
        ),
      ),
    ].map(Number);
    if (!controller || !ids.length || typeof options.execute !== "function") {
      return;
    }

    const action = String(options.action || "process").toLowerCase();
    const tableLabel = String(options.tableLabel || "selected records");
    const actionLabels = {
      approve: "approve",
      archive: "archive",
      delete: "permanently delete",
      reject: "reject",
      restore: "restore",
    };
    const pastLabels = {
      approve: "approved",
      archive: "archived",
      delete: "deleted",
      reject: "rejected",
      restore: "restored",
    };
    const actionLabel = actionLabels[action] || action;
    const pastLabel = pastLabels[action] || "processed";
    const irreversibleNote = options.irreversible
      ? " This permanent deletion cannot be undone."
      : "";
    const confirmationMessage =
      options.confirmMessage ||
      `Are you sure you want to ${actionLabel} ${ids.length} selected ${tableLabel}?${irreversibleNote}`;

    window.showAdminConfirmPopup?.(confirmationMessage, {
      title:
        options.confirmTitle ||
        `${actionLabel.charAt(0).toUpperCase()}${actionLabel.slice(1)} Selected`,
      confirmText:
        options.confirmText ||
        `${actionLabel.charAt(0).toUpperCase()}${actionLabel.slice(1)}`,
      cancelText: "Cancel",
      keepOpenWhilePending: true,
      loadingText: options.loadingText || "Processing...",
      onConfirm: async () => {
        controller.setBusy(true);
        try {
          const payload = await options.execute(ids);
          controller.clear();
          if (typeof options.afterSuccess === "function") {
            await options.afterSuccess(payload);
          }
          return payload;
        } finally {
          controller.setBusy(false);
        }
      },
      onSuccess: (payload = {}) => {
        const processed = Number(
          payload.processed_count ?? payload.processed_ids?.length ?? 0,
        );
        const skipped = Number(
          payload.skipped_count ?? payload.skipped_ids?.length ?? 0,
        );
        window.showAdminPopup?.(
          `${tableLabel}: ${processed} ${pastLabel}; ${skipped} skipped.`,
          {
            title:
              options.successTitle ||
              `${pastLabel.charAt(0).toUpperCase()}${pastLabel.slice(1)} Successfully`,
          },
        );
      },
      onError: (error) => {
        window.showAdminPopup?.(
          error?.message || `Unable to ${actionLabel} the selected records.`,
          { title: options.errorTitle || "Action Failed" },
        );
      },
    });
  };

  // Dock Save All Changes bars at the viewport bottom until their natural
  // page-end position becomes visible. Moving the docked bar to <body> avoids
  // transformed content containers changing fixed-position behavior.
  const dockedSaveBars = new Set();
  let saveBarFrame = 0;
  const saveBarResizeObserver =
    typeof window.ResizeObserver === "function"
      ? new window.ResizeObserver(() => scheduleSaveBarSync())
      : null;

  const syncDockedSaveBars = () => {
    saveBarFrame = 0;
    dockedSaveBars.forEach(({ bar, slot }) => {
      if (!bar.isConnected || !slot.isConnected) return;

      const slotRect = slot.getBoundingClientRect();
      const shouldDock = slotRect.top > window.innerHeight - 20;

      if (shouldDock) {
        if (bar.parentElement !== document.body) document.body.appendChild(bar);
        bar.classList.add("is-docked");
        bar.style.left = `${Math.max(12, slotRect.left)}px`;
        bar.style.width = `${Math.max(0, slotRect.width)}px`;
        bar.style.bottom = "20px";
      } else {
        if (bar.parentElement !== slot) slot.appendChild(bar);
        bar.classList.remove("is-docked");
        bar.style.removeProperty("left");
        bar.style.removeProperty("width");
        bar.style.removeProperty("bottom");
      }

      slot.style.minHeight = `${Math.ceil(bar.getBoundingClientRect().height)}px`;
    });
  };

  const scheduleSaveBarSync = () => {
    if (saveBarFrame) return;
    saveBarFrame = window.requestAnimationFrame(syncDockedSaveBars);
  };

  const setupDockedSaveBars = (root = document) => {
    root.querySelectorAll?.(".wm-save-bar[data-dock-save-bar]").forEach((bar) => {
      if (bar.dataset.dockReady === "1") return;
      const slot = document.createElement("div");
      slot.className = "wm-save-bar-slot";
      bar.parentNode?.insertBefore(slot, bar);
      slot.appendChild(bar);
      bar.dataset.dockReady = "1";
      dockedSaveBars.add({ bar, slot });
      saveBarResizeObserver?.observe(slot);
      saveBarResizeObserver?.observe(bar);
      const content = slot.closest(".module-content, .main-content");
      if (content) saveBarResizeObserver?.observe(content);
    });
    scheduleSaveBarSync();
  };

  window.refreshAdminDockedSaveBars = setupDockedSaveBars;
  window.addEventListener("scroll", scheduleSaveBarSync, { passive: true });
  window.addEventListener("resize", scheduleSaveBarSync);
  setupDockedSaveBars();

  syncSidebarMode();

  const getFilterValue = (value) => {
    const normalized = (value || "").trim().toLowerCase();
    if (!normalized || normalized === "all") return "";
    if (normalized.startsWith("all ")) return "";
    return normalized;
  };

  const ensureEmptyStateRow = (table, tbody) => {
    let emptyRow = tbody.querySelector(".table-empty-row");
    if (!emptyRow) {
      emptyRow = document.createElement("tr");
      emptyRow.className = "table-empty-row";

      const cell = document.createElement("td");
      const headerCount = table.querySelectorAll("thead th").length || 1;
      const emptyMessage =
        table.dataset.emptyMessage || "No data available yet.";
      cell.colSpan = headerCount;
      cell.innerHTML = `<div class="table-empty-state"><i class="fa-regular fa-folder-open"></i><span>${emptyMessage}</span></div>`;

      emptyRow.appendChild(cell);
      tbody.appendChild(emptyRow);
    }

    return emptyRow;
  };

  const tablePanels = document.querySelectorAll(".panel");

  tablePanels.forEach((panel) => {
    const table = panel.querySelector("table.enhanced-table");
    if (!table) return;

    const tbody = table.querySelector("tbody");
    if (!tbody) return;

    const allRows = Array.from(tbody.querySelectorAll("tr")).filter(
      (row) => !row.classList.contains("table-empty-row"),
    );

    const emptyStateRow = ensureEmptyStateRow(table, tbody);

    const footer = panel.querySelector(".table-footer");
    if (!footer) {
      emptyStateRow.style.display = allRows.length ? "none" : "table-row";
      return;
    }

    const pageButtons = footer.querySelectorAll(".page-btn");
    const prevButton = pageButtons[0] || null;
    const nextButton = pageButtons[1] || null;
    const pageNumber = footer.querySelector(".page-number");
    const pageMeta = footer.querySelector(".table-footer-meta");

    const moduleSection = panel.closest(".module-content");
    const toolbar = moduleSection?.querySelector(".page-toolbar") || null;

    const searchInputs = [
      panel.querySelector(".search-input"),
      toolbar?.querySelector(".search-input") || null,
    ].filter(Boolean);

    const filterSelects = [
      ...panel.querySelectorAll(".filter-select"),
      ...(toolbar ? toolbar.querySelectorAll(".filter-select") : []),
    ];

    const pageSize = Math.max(
      Number.parseInt(table.dataset.pageSize || "5", 10),
      1,
    );

    let currentPage = 1;
    let filteredRows = allRows;

    const applyFilters = () => {
      const query = (searchInputs[0]?.value || "").trim().toLowerCase();
      const activeFilters = Array.from(filterSelects)
        .map((select) => getFilterValue(select.value))
        .filter(Boolean);

      filteredRows = allRows.filter((row) => {
        const rowText = row.textContent.toLowerCase();
        const matchesSearch = !query || rowText.includes(query);
        const matchesFilters = activeFilters.every((filterValue) =>
          rowText.includes(filterValue),
        );
        return matchesSearch && matchesFilters;
      });
    };

    const renderPage = () => {
      const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
      if (currentPage > totalPages) currentPage = totalPages;

      const start = (currentPage - 1) * pageSize;
      const end = start + pageSize;

      allRows.forEach((row) => {
        row.style.display = "none";
      });

      if (!filteredRows.length) {
        emptyStateRow.style.display = "table-row";
      } else {
        emptyStateRow.style.display = "none";
      }

      filteredRows.slice(start, end).forEach((row) => {
        row.style.display = "";
      });

      if (pageNumber) pageNumber.textContent = String(currentPage);
      if (pageMeta)
        pageMeta.textContent = `Page ${currentPage} of ${totalPages}`;
      if (prevButton) prevButton.disabled = currentPage <= 1;
      if (nextButton) nextButton.disabled = currentPage >= totalPages;
    };

    const rerenderFromStart = () => {
      currentPage = 1;
      applyFilters();
      renderPage();
    };

    prevButton?.addEventListener("click", () => {
      if (currentPage <= 1) return;
      currentPage -= 1;
      renderPage();
    });

    nextButton?.addEventListener("click", () => {
      const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
      if (currentPage >= totalPages) return;
      currentPage += 1;
      renderPage();
    });

    searchInputs.forEach((input) => {
      input.addEventListener("input", rerenderFromStart);
    });

    filterSelects.forEach((select) => {
      select.addEventListener("change", rerenderFromStart);
    });

    applyFilters();
    renderPage();
  });
});
