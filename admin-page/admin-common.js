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
      currentPath.endsWith(`/${route}`)
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
    if (sidebarToggleBtn) sidebarToggleBtn.setAttribute("aria-expanded", "false");
    saveSidebarState(false);
  };

  const openMobileSidebar = () => {
    if (!isMobileSidebarMode()) return;
    body.classList.add("admin-sidebar-open");
    if (sidebarToggleBtn) sidebarToggleBtn.setAttribute("aria-expanded", "true");
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
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
    );

    if (!textNodes.length) return;

    const labelText = textNodes.map((node) => node.textContent.trim()).join(" ");
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
        if (sidebarToggleBtn) sidebarToggleBtn.setAttribute("aria-expanded", "true");
      } else {
        body.classList.remove("admin-sidebar-open");
        if (sidebarToggleBtn) sidebarToggleBtn.setAttribute("aria-expanded", "false");
      }
    } else {
      body.classList.remove("admin-sidebar-open");
      if (sidebarToggleBtn) sidebarToggleBtn.setAttribute("aria-expanded", "false");
    }
  };

  const WEBSITE_MGMT_ROUTES = ["website-home.html", "website-services.html", "website-contact.html", "website-footer.html"];
  const isWebsiteMgmtPage = WEBSITE_MGMT_ROUTES.some(route => window.location.pathname.toLowerCase().endsWith(`/${route}`));
  
  // Support both admin and staff control button IDs (adminControlBtn, staffControlBtn)
  const controlBtn = document.getElementById("adminControlBtn") || document.getElementById("staffControlBtn");
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
        if (isMobileSidebarMode() && !body.classList.contains("admin-sidebar-open")) {
          e.preventDefault();
          openMobileSidebar();
          return;
        }
        e.preventDefault();
        hasDropdown.classList.toggle("open");
        localStorage.setItem("websiteMgmtDropdownState", hasDropdown.classList.contains("open") ? "open" : "closed");
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
      accountLink.innerHTML = '<i class="fa-regular fa-id-card"></i> My Account';
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
      const configured = window.APP_API_BASE_URL || document.querySelector('meta[name="api-base-url"]')?.getAttribute('content') || "";
      if (configured.trim()) return configured.replace(/\/+$/, '');
      const proto = window.location.protocol;
      const host  = window.location.hostname;
      const port  = window.location.port;
      if (port === '8000') return `${proto}//${host}:${port}/api`;
      if (host === 'localhost' || host === '127.0.0.1') return `${proto}//${host}:8000/api`;
      return `${proto}//${host}/api`;
    })();

    const token = (window.AdminSession && window.AdminSession.getToken()) || localStorage.getItem('auth_token') || '';
    if (!token) return;

    fetch(`${API_BASE}/user`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    }).then((res) => {
      if (!res.ok) return null;
      return res.json();
    }).then((user) => {
      if (!user) return;
      const email = user.email || (user.data && user.data.email) || '';
      if (!email) return;
      document.querySelectorAll('.profile-initial').forEach((el) => {
        el.dataset.email = email;
        el.textContent = email.trim().charAt(0).toUpperCase();
      });
      const popupIdentity = document.querySelector('.popup-identity');
      if (popupIdentity) popupIdentity.textContent = email;
      const currentGmailEl = document.getElementById('currentGmailValue');
      if (currentGmailEl) currentGmailEl.textContent = email;
      try {
        if (window.AdminSession) {
          window.AdminSession.setUserInfo(user);
        } else {
          localStorage.setItem('user_info', JSON.stringify(user));
        }
      } catch (e) { /* ignore */ }
    }).catch(() => { /* ignore network errors */ });
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
      const configured = window.APP_API_BASE_URL ||
        document.querySelector('meta[name="api-base-url"]')?.getAttribute("content") || "";
      if (configured.trim()) return configured.replace(/\/+$/, "");
      const proto = window.location.protocol;
      const host  = window.location.hostname;
      const port  = window.location.port;
      if (port === "8000") return `${proto}//${host}:${port}/api`;
      if (host === "localhost" || host === "127.0.0.1") return `${proto}//${host}:8000/api`;
      return `${proto}//${host}/api`;
    })();

    const NOTIF_POLL_INTERVAL = 30000; // 30 seconds
    let notifPollTimer = null;
    let currentUnreadCount = 0;

    // Ensure dropdown exists
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
      `;
      notifBtn.appendChild(notifDropdown);
    }

    const notifBody       = notifDropdown.querySelector("#notifBody");
    const notifEmptyState = notifDropdown.querySelector("#notifEmptyState");
    const notifMarkAllBtn = notifDropdown.querySelector("#notifMarkAllBtn");
    const notifBadge      = notifBtn.querySelector(".badge") || notifBtn.querySelector("#notifBadge");

    // Helper: get auth token
    const getToken = () => (window.AdminSession && window.AdminSession.getToken()) || localStorage.getItem("auth_token") || "";

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
      const mins  = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days  = Math.floor(diff / 86400000);
      if (mins < 1)   return "just now";
      if (mins < 60)  return `${mins}m ago`;
      if (hours < 24) return `${hours}h ago`;
      return `${days}d ago`;
    };

    // Type icon map
    const typeIcon = {
      order:       "fa-box-open",
      appointment: "fa-calendar-check",
      success:     "fa-circle-check",
      warning:     "fa-triangle-exclamation",
      error:       "fa-circle-xmark",
      info:        "fa-circle-info",
    };

    // Render notifications
    const renderNotifications = (notifications) => {
      if (!notifBody) return;

      // Remove existing items (keep empty state)
      Array.from(notifBody.querySelectorAll(".notif-item")).forEach((el) => el.remove());

      if (!notifications.length) {
        if (notifEmptyState) notifEmptyState.style.display = "";
        if (notifMarkAllBtn) notifMarkAllBtn.style.display = "none";
        return;
      }

      if (notifEmptyState) notifEmptyState.style.display = "none";

      const hasUnread = notifications.some((n) => !n.is_read);
      if (notifMarkAllBtn) notifMarkAllBtn.style.display = hasUnread ? "" : "none";

      const frag = document.createDocumentFragment();
      notifications.forEach((n) => {
        const item = document.createElement("div");
        item.className = `notif-item${n.is_read ? "" : " notif-unread"}`;
        item.dataset.notifId = n.id;

        const icon = typeIcon[n.type] || "fa-circle-info";
        item.innerHTML = `
          <div class="notif-icon-col">
            <i class="fa-solid ${icon}"></i>
          </div>
          <div class="notif-content-col">
            <div class="notif-title">${String(n.title || "").replace(/</g, "&lt;")}</div>
            <div class="notif-msg">${String(n.message || "").replace(/</g, "&lt;")}</div>
            <div class="notif-time">${formatRelTime(n.created_at)}</div>
          </div>
          <div class="notif-actions-col">
            ${!n.is_read ? `<button class="notif-read-btn" title="Mark as read" data-notif-id="${n.id}"><i class="fa-solid fa-check"></i></button>` : ""}
            <button class="notif-del-btn" title="Dismiss" data-notif-id="${n.id}"><i class="fa-solid fa-xmark"></i></button>
          </div>
        `;
        frag.appendChild(item);
      });
      if (notifEmptyState) {
        notifBody.insertBefore(frag, notifEmptyState);
      } else {
        notifBody.appendChild(frag);
      }
    };

    // Fetch & render notifications
    const fetchNotifications = async () => {
      const token = getToken();
      if (!token) return;
      try {
        const res = await fetch(`${NOTIF_API_BASE}/admin/notifications`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        });
        if (!res.ok) return;
        const payload = await res.json();
        const notifications = Array.isArray(payload?.data) ? payload.data : [];
        const unread = typeof payload?.unread_count === "number" ? payload.unread_count : 0;
        updateBadge(unread);
        renderNotifications(notifications);
      } catch {
        // Silently ignore — network errors shouldn't disrupt the admin UI
      }
    };

    // Mark single as read
    const markAsRead = async (id) => {
      const token = getToken();
      if (!token) return;
      try {
        await fetch(`${NOTIF_API_BASE}/admin/notifications/${id}/read`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        });
        await fetchNotifications();
      } catch { /* ignore */ }
    };

    // Mark all as read
    const markAllRead = async () => {
      const token = getToken();
      if (!token) return;
      try {
        await fetch(`${NOTIF_API_BASE}/admin/notifications/mark-all-read`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        });
        await fetchNotifications();
      } catch { /* ignore */ }
    };

    // Delete notification
    const deleteNotification = async (id) => {
      const token = getToken();
      if (!token) return;
      try {
        await fetch(`${NOTIF_API_BASE}/admin/notifications/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        });
        await fetchNotifications();
      } catch { /* ignore */ }
    };

    // Bell click — open/close dropdown, stop ringing
    notifBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      notifDropdown.classList.toggle("show");
      if (profilePopup) profilePopup.classList.remove("show");
      // When user opens the dropdown, we refresh to show latest
      if (notifDropdown.classList.contains("show")) {
        void fetchNotifications();
      }
    });

    // Close when clicking outside
    document.addEventListener("click", (e) => {
      if (!notifBtn.contains(e.target)) {
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

    // Mark all button
    if (notifMarkAllBtn) {
      notifMarkAllBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        void markAllRead();
      });
    }

    // Start polling for notifications
    void fetchNotifications();
    notifPollTimer = setInterval(fetchNotifications, NOTIF_POLL_INTERVAL);

    // Expose globally so other scripts can trigger a refresh
    window.refreshAdminNotifications = fetchNotifications;
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
      cancelBtn.onmousedown = () => cancelBtn.style.transform = "scale(0.96)";
      cancelBtn.onmouseup = () => cancelBtn.style.transform = "scale(1)";

      confirmBtn.onmouseenter = () => {
        confirmBtn.style.backgroundColor = "#7f1d1d"; // Darker red
        confirmBtn.style.boxShadow = "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)";
      };
      confirmBtn.onmouseleave = () => {
        confirmBtn.style.backgroundColor = "var(--primary-color, #a80f0f)";
        confirmBtn.style.boxShadow = "none";
        confirmBtn.style.transform = "scale(1)";
      };
      confirmBtn.onmousedown = () => confirmBtn.style.transform = "scale(0.96)";
      confirmBtn.onmouseup = () => confirmBtn.style.transform = "scale(1)";

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
    const token = (window.AdminSession && window.AdminSession.getToken()) || localStorage.getItem("auth_token");
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
    left = Math.max(viewportPadding, Math.min(left, window.innerWidth - tipRect.width - viewportPadding));

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
    const target = e.target instanceof Element ? e.target.closest("[data-tooltip]") : null;
    if (!target) return;
    activeTooltipTarget = target;
    placeTooltip(target);
  });

  document.addEventListener("mousemove", (e) => {
    if (!activeTooltipTarget) return;
    const current = e.target instanceof Element ? e.target.closest("[data-tooltip]") : null;
    if (current !== activeTooltipTarget) return;
    placeTooltip(activeTooltipTarget);
  });

  document.addEventListener("mouseout", (e) => {
    if (!activeTooltipTarget) return;
    const from = e.target instanceof Element ? e.target.closest("[data-tooltip]") : null;
    if (from !== activeTooltipTarget) return;
    const to = e.relatedTarget instanceof Element ? e.relatedTarget.closest("[data-tooltip]") : null;
    if (to === activeTooltipTarget) return;
    hideTooltip();
  });

  document.addEventListener("focusin", (e) => {
    const target = e.target instanceof Element ? e.target.closest("[data-tooltip]") : null;
    if (!target) return;
    activeTooltipTarget = target;
    placeTooltip(target);
  });

  document.addEventListener("focusout", (e) => {
    const target = e.target instanceof Element ? e.target.closest("[data-tooltip]") : null;
    if (target && target === activeTooltipTarget) {
      hideTooltip();
    }
  });

  window.addEventListener("scroll", () => {
    if (activeTooltipTarget) placeTooltip(activeTooltipTarget);
  }, true);

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

    const isConfirm = Boolean(options.isConfirm);

    if (actions) {
      actions.classList.toggle("is-confirm", isConfirm);
    }

    if (okBtn) {
      okBtn.textContent = options.okText || (isConfirm ? "Confirm" : "Okay");
      okBtn.onclick = () => closePopup(options.onOk);
    }

    if (cancelBtn) {
      cancelBtn.textContent = options.cancelText || "Cancel";
      cancelBtn.style.display = isConfirm ? "inline-flex" : "none";
      cancelBtn.onclick = () => closePopup(options.onCancel);
    }

    if (backdrop) {
      backdrop.onclick = isConfirm
        ? () => closePopup(options.onCancel)
        : () => closePopup();
    }

    popup.classList.add("show");

    if (isConfirm && cancelBtn) {
      cancelBtn.focus();
    } else if (okBtn) {
      okBtn.focus();
    }
  };

  window.showAdminPopup = (message, options = {}) => {
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
      isConfirm: true,
    });
  };

  // Replace native browser alert on admin pages with system popup.
  window.alert = (message) => {
    window.showAdminPopup(message);
  };

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
      const emptyMessage = table.dataset.emptyMessage || "No data available yet.";
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
      (row) => !row.classList.contains("table-empty-row")
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

    const pageSize = Math.max(Number.parseInt(table.dataset.pageSize || "5", 10), 1);

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
          rowText.includes(filterValue)
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
      if (pageMeta) pageMeta.textContent = `Page ${currentPage} of ${totalPages}`;
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
