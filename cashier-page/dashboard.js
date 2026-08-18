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
  const indicatorThumb = document.querySelector(
    ".sidebar-scroll-indicator .indicator-thumb"
  );

  let sidebarToggleBtn = null;
  let sidebarBackdrop = null;

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
      16
    );
    const travel = 100 - thumbHeight;
    const thumbTop = (sidebarNav.scrollTop / maxScroll) * travel;

    indicatorThumb.style.height = `${thumbHeight}%`;
    indicatorThumb.style.transform = `translateY(${thumbTop}%)`;
  };

  // 1. Sidebar 'Admin Control' Dropdown Logic
  const adminControlBtn = document.getElementById("adminControlBtn");

  if (adminControlBtn) {
    adminControlBtn.addEventListener("click", (e) => {
      if (isMobileSidebarMode() && !body.classList.contains("admin-sidebar-open")) {
        e.preventDefault();
        openMobileSidebar();
        return;
      }
      e.preventDefault(); // Prevents page reload
      const hasDropdown = adminControlBtn.parentElement;
      hasDropdown.classList.toggle("open");

      // Wait for layout update so scrollHeight reflects expanded/collapsed content.
      requestAnimationFrame(updateSidebarScrollIndicator);
    });
  }

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
  const normalizeText = (value) => value.replace(/\s+/g, " ").trim().toLowerCase();
  const sidebarLinks = Array.from(
    document.querySelectorAll(".sidebar-nav .nav-link, .sidebar-nav .sub-link")
  );

  const resolveSidebarRoute = (navLabel) => {
    const normalizedLabel = normalizeText(navLabel);
    return sidebarLinks.find((link) =>
      normalizeText(link.textContent).includes(normalizedLabel)
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

  // 3. Profile Message Box (Popup) Logic
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

  if (userProfile && profilePopup) {
    userProfile.addEventListener("click", (e) => {
      e.stopPropagation(); // Stops click from triggering document click immediately
      profilePopup.classList.toggle("show");
    });

    // Close the popup if clicking anywhere else on the screen
    document.addEventListener("click", (e) => {
      if (!userProfile.contains(e.target)) {
        profilePopup.classList.remove("show");
      }
    });

    // Keeps popup open if you click inside it
    profilePopup.addEventListener("click", (e) => {
      e.stopPropagation();
    });
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

    const performLogout = async () => {
      const token = localStorage.getItem("auth_token");
      setLoading(true);
      try {
        if (token) {
          await fetch((() => { const p = window.location.protocol, h = window.location.hostname, pt = window.location.port; if (pt === "8000") return `${p}//${h}:${pt}/api`; if (h === "localhost" || h === "127.0.0.1") return `${p}//${h}:8000/api`; return `${p}//${h}/api`; })() + "/logout", {
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
        await performLogout();
      });
    });

  syncSidebarMode();
});
