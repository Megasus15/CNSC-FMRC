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

  const adminControlBtn = document.getElementById("adminControlBtn");
  if (adminControlBtn) {
    adminControlBtn.addEventListener("click", (e) => {
      if (isMobileSidebarMode() && !body.classList.contains("admin-sidebar-open")) {
        e.preventDefault();
        openMobileSidebar();
        return;
      }
      e.preventDefault();
      const hasDropdown = adminControlBtn.parentElement;
      hasDropdown.classList.toggle("open");
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

  syncSidebarMode();

  const getFilterValue = (value) => {
    const normalized = (value || "").trim().toLowerCase();
    if (!normalized || normalized === "all") return "";
    if (normalized.startsWith("all ")) return "";
    return normalized;
  };

  const tablePanels = document.querySelectorAll(".panel");

  tablePanels.forEach((panel) => {
    const table = panel.querySelector("table.enhanced-table");
    if (!table) return;

    const tbody = table.querySelector("tbody");
    if (!tbody) return;

    const allRows = Array.from(tbody.querySelectorAll("tr"));
    if (!allRows.length) return;

    const footer = panel.querySelector(".table-footer");
    if (!footer) return;

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
