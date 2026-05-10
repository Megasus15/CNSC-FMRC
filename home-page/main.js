const getCustomerSession = () => {
  const token = localStorage.getItem("customer_token");
  const userInfoRaw = localStorage.getItem("customer_info");

  let userInfo = null;
  try {
    if (userInfoRaw) userInfo = JSON.parse(userInfoRaw);
  } catch {
    userInfo = null;
  }

  return {
    token,
    userInfo,
    isAuthenticated: Boolean(token && userInfo),
  };
};

const ORDER_STAGE_FLOW = ["to_pay", "to_ship", "to_receive", "completed"];
const PHILIPPINES_TIME_ZONE = "Asia/Manila";
const API_REQUEST_TIMEOUT_MS = 8000;
const ORDERS_REALTIME_SIGNAL_KEY = "fmrc_orders_updated_at";
const ORDERS_REALTIME_CHANNEL = "fmrc-orders-realtime";
const CUSTOMER_ORDERS_FALLBACK_SYNC_MS = 6000;
const CUSTOMER_ORDERS_MIN_REFRESH_GAP_MS = 2500;
const CART_STORAGE_KEY = "fmrc_cart_items";
const CART_STORAGE_SIGNAL_KEY = "fmrc_cart_updated_at";

let ordersRealtimeChannel = null;

const getOrdersRealtimeChannel = () => {
  if (typeof window.BroadcastChannel !== "function") return null;
  if (!ordersRealtimeChannel) {
    ordersRealtimeChannel = new window.BroadcastChannel(
      ORDERS_REALTIME_CHANNEL,
    );
  }
  return ordersRealtimeChannel;
};

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

const emitCustomerOrdersUpdated = (detail = {}) => {
  const payload = {
    source: "customer-portal",
    timestamp: Date.now(),
    ...detail,
  };

  window.dispatchEvent(
    new CustomEvent("fmrc:orders-updated", { detail: payload }),
  );

  try {
    localStorage.setItem(ORDERS_REALTIME_SIGNAL_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage write issues.
  }

  const realtimeChannel = getOrdersRealtimeChannel();
  realtimeChannel?.postMessage(payload);
};

document.addEventListener("DOMContentLoaded", () => {
  let navLinks = document.querySelectorAll(".nav-link");
  const sections = document.querySelectorAll("main, section");
  const customerSession = getCustomerSession();
  const isGuestUser = !customerSession.isAuthenticated;

  // Mobile Sidebar Navigation (shared across all pages)
  const siteHeader = document.querySelector(".site-header");
  const mainNav = siteHeader?.querySelector(".main-nav");
  const logoContainer = siteHeader?.querySelector(".logo-container");
  const headerActions = siteHeader?.querySelector(".header-right-actions");

  if (
    siteHeader &&
    mainNav &&
    logoContainer &&
    !document.querySelector(".mobile-menu-toggle")
  ) {
    const menuToggle = document.createElement("button");
    menuToggle.type = "button";
    menuToggle.className = "mobile-menu-toggle";
    menuToggle.id = "mobileMenuToggle";
    menuToggle.setAttribute("aria-label", "Open navigation menu");
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.innerHTML = "<span></span><span></span><span></span>";

    siteHeader.insertBefore(menuToggle, logoContainer);

    const sidebarBackdrop = document.createElement("div");
    sidebarBackdrop.className = "sidebar-backdrop";

    const mobileSidebar = document.createElement("aside");
    mobileSidebar.className = "mobile-sidebar";
    mobileSidebar.setAttribute("aria-hidden", "true");

    const sidebarHeader = document.createElement("div");
    sidebarHeader.className = "sidebar-header";

    const sidebarCloseBtn = document.createElement("button");
    sidebarCloseBtn.type = "button";
    sidebarCloseBtn.className = "sidebar-close-btn";
    sidebarCloseBtn.setAttribute("aria-label", "Close sidebar menu");
    sidebarCloseBtn.innerHTML = "&times;";

    const sidebarBrand = document.createElement("a");
    sidebarBrand.className = "sidebar-logo-container";
    sidebarBrand.href =
      logoContainer.getAttribute("href") || "/home-page/main.html";
    sidebarBrand.innerHTML = logoContainer.innerHTML;

    sidebarHeader.append(sidebarCloseBtn, sidebarBrand);

    const sidebarNav = document.createElement("nav");
    sidebarNav.className = "sidebar-nav";
    const navListClone = mainNav.querySelector("ul")?.cloneNode(true);
    if (navListClone) {
      sidebarNav.appendChild(navListClone);
    }

    mobileSidebar.append(sidebarHeader, sidebarNav);
    document.body.append(sidebarBackdrop, mobileSidebar);

    const openSidebar = () => {
      mobileSidebar.classList.add("open");
      sidebarBackdrop.classList.add("show");
      menuToggle.classList.add("is-open");
      menuToggle.setAttribute("aria-expanded", "true");
      mobileSidebar.setAttribute("aria-hidden", "false");
      document.body.classList.add("sidebar-open");
    };

    const closeSidebar = () => {
      mobileSidebar.classList.remove("open");
      sidebarBackdrop.classList.remove("show");
      menuToggle.classList.remove("is-open");
      menuToggle.setAttribute("aria-expanded", "false");
      mobileSidebar.setAttribute("aria-hidden", "true");
      document.body.classList.remove("sidebar-open");
    };

    menuToggle.addEventListener("click", () => {
      if (mobileSidebar.classList.contains("open")) {
        closeSidebar();
      } else {
        openSidebar();
      }
    });

    sidebarCloseBtn.addEventListener("click", closeSidebar);
    sidebarBackdrop.addEventListener("click", closeSidebar);

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && mobileSidebar.classList.contains("open")) {
        closeSidebar();
      }
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 900 && mobileSidebar.classList.contains("open")) {
        closeSidebar();
      }
    });

    mobileSidebar.querySelectorAll(".nav-link").forEach((link) => {
      link.addEventListener("click", (event) => {
        const href = link.getAttribute("href") || "";

        if (href.startsWith("#")) {
          event.preventDefault();
          navLinks.forEach((navLink) => navLink.classList.remove("active"));
          document
            .querySelectorAll(`.nav-link[href="${href}"]`)
            .forEach((navLink) => navLink.classList.add("active"));
          closeSidebar();
          const target = document.querySelector(href);
          if (target) target.scrollIntoView({ behavior: "smooth" });
          return;
        }

        closeSidebar();
      });
    });

    navLinks = document.querySelectorAll(".nav-link");
  }

  const ensureGuestAccessModal = () => {
    let modal = document.getElementById("guestAccessModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "guestAccessModal";
      modal.className = "guest-access-modal";
      modal.innerHTML = `
        <div class="guest-access-card" role="dialog" aria-modal="true" aria-labelledby="guestAccessTitle">
          <button type="button" class="guest-access-close" id="closeGuestAccessModal" aria-label="Close guest access prompt">&times;</button>
          <h2 class="guest-access-title" id="guestAccessTitle">Welcome, Guest</h2>
          <p class="guest-access-copy" id="guestAccessCopy">Please log in or create an account to continue.</p>
          <div class="guest-access-actions">
            <a href="../customer-auth/auth.html#login" class="guest-access-btn login">Login</a>
            <a href="../customer-auth/auth.html#signup" class="guest-access-btn signup">Sign Up</a>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal
        .querySelector("#closeGuestAccessModal")
        ?.addEventListener("click", () => {
          modal.classList.remove("show");
          document.body.style.overflow = "";
        });

      modal.addEventListener("click", (event) => {
        if (event.target === modal) {
          modal.classList.remove("show");
          document.body.style.overflow = "";
        }
      });
    }
    return modal;
  };

  const openGuestAccessModal = (actionLabel) => {
    const modal = ensureGuestAccessModal();
    const copy = modal.querySelector("#guestAccessCopy");
    if (copy) {
      copy.textContent = `Please log in or create an account to ${actionLabel}.`;
    }
    modal.classList.add("show");
    document.body.style.overflow = "hidden";
  };

  const requireCustomerAuth = (actionLabel) => {
    if (!isGuestUser) return true;
    openGuestAccessModal(actionLabel);
    return false;
  };

  const fetchWithTimeout = async (
    url,
    options = {},
    timeoutMs = API_REQUEST_TIMEOUT_MS,
  ) => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    const { signal: _ignoredSignal, ...restOptions } = options;

    try {
      return await fetch(url, {
        ...restOptions,
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(
          "Request timed out. Please check your connection and try again.",
        );
      }

      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  const ensureCustomerSystemPopup = () => {
    let popup = document.getElementById("customerSystemPopup");
    if (popup) return popup;

    popup = document.createElement("div");
    popup.id = "customerSystemPopup";
    popup.className = "admin-system-popup";
    popup.innerHTML = `
      <div class="admin-system-popup__backdrop"></div>
      <div class="admin-system-popup__card" role="dialog" aria-modal="true" aria-labelledby="customerSystemPopupTitle">
        <h3 id="customerSystemPopupTitle" class="admin-system-popup__title">System Message</h3>
        <hr class="admin-system-popup__separator" />
        <p id="customerSystemPopupMessage" class="admin-system-popup__message"></p>
        <hr class="admin-system-popup__separator" />
        <div class="admin-system-popup__actions">
          <button id="customerSystemPopupCancel" type="button" class="btn-admin btn-secondary">Cancel</button>
          <button id="customerSystemPopupOk" type="button" class="btn-admin">Okay</button>
        </div>
      </div>
    `;

    document.body.appendChild(popup);
    return popup;
  };

  const showCustomerPopup = (message, options = {}) =>
    new Promise((resolve) => {
      const popup = ensureCustomerSystemPopup();
      const titleEl = popup.querySelector("#customerSystemPopupTitle");
      const msgEl = popup.querySelector("#customerSystemPopupMessage");
      const okBtn = popup.querySelector("#customerSystemPopupOk");
      const cancelBtn = popup.querySelector("#customerSystemPopupCancel");
      const actions = popup.querySelector(".admin-system-popup__actions");
      const backdrop = popup.querySelector(".admin-system-popup__backdrop");

      if (titleEl) titleEl.textContent = options.title || "System Message";
      if (msgEl) msgEl.textContent = String(message || "Done.");

      const isConfirm = Boolean(options.isConfirm);
      const allowBackdropClose = Boolean(
        options.allowBackdropClose ?? isConfirm,
      );
      if (actions) {
        actions.classList.toggle("is-confirm", isConfirm);
      }

      const closePopup = (accepted) => {
        popup.classList.remove("show");
        resolve(Boolean(accepted));
      };

      if (okBtn) {
        okBtn.textContent = options.okText || (isConfirm ? "Confirm" : "Okay");
        okBtn.onclick = (ev) => {
          ev?.stopPropagation();
          closePopup(true);
        };
      }

      if (cancelBtn) {
        cancelBtn.textContent = options.cancelText || "Cancel";
        cancelBtn.style.display = isConfirm ? "inline-flex" : "none";
        cancelBtn.onclick = (ev) => {
          ev?.stopPropagation();
          closePopup(false);
        };
      }

      // Prevent the popup from being closed immediately by any residual click
      // event that bubbled from the original button press. Attach the
      // backdrop click handler after a short delay so the originating click
      // cannot close it instantly.
      popup.classList.add("show");

      if (backdrop) {
        backdrop.onclick = null;
        if (allowBackdropClose) {
          setTimeout(() => {
            backdrop.onclick = (ev) => {
              ev?.stopPropagation();
              closePopup(false);
            };
          }, 60);
        }
      }

      if (isConfirm && cancelBtn) {
        cancelBtn.focus();
      } else if (okBtn) {
        okBtn.focus();
      }
    });

  // ── Dedicated Order Success Modal ────────────────────────────────────────────
  // Opens the #orderSuccessModal (in product.html) with the given order number.
  // Returns a Promise that resolves ONLY when the customer clicks the OK button.
  // Falls back to showCustomerPopup on pages that don't have the element.
  const openOrderSuccessModal = (orderNoDisplay) =>
    new Promise((resolve) => {
      const modal = document.getElementById("orderSuccessModal");
      const numEl = document.getElementById("orderSuccessNumber");
      const okBtn = document.getElementById("orderSuccessOkBtn");

      // Fallback: page doesn't have the dedicated modal
      if (!modal || !okBtn) {
        void showCustomerPopup(
          `Order placed successfully${orderNoDisplay ? ` (${orderNoDisplay})` : ""}!`,
          { title: "Success", allowBackdropClose: false },
        ).then(resolve);
        return;
      }

      // Populate the order number
      if (numEl) {
        numEl.textContent = orderNoDisplay || "—";
      }

      // Show the modal (flex so it centres correctly)
      modal.style.display = "flex";
      document.body.style.overflow = "hidden";

      // Single-fire OK handler — cleans itself up
      const handleOk = () => {
        okBtn.removeEventListener("click", handleOk);
        modal.style.display = "none";
        document.body.style.overflow = "";
        resolve();
      };

      okBtn.addEventListener("click", handleOk);
    });

  // Disable sticky header when any modal/overlay/form is open
  const headerBlockingSelectors = [
    ".modal-overlay.show-modal",
    ".shop-modal-overlay.show-modal",
    ".image-lightbox-overlay.show-lightbox",
    ".about-video-modal.show-video-modal",
    ".apt-overlay.show-modal",
    ".apt-nested-modal.show-modal",
    ".success-modal-overlay.active",
    "#appointmentFlow.show-modal",
    "#checkoutModal.show-modal",
    "#addressSelectionModal.show-modal",
    "#editInfoModal.show-modal",
    "#addInfoModal.show-modal",
    "#cartModal.show-modal",
    "#serviceModal.show-modal",
    "#productInfoModal.show-modal",
    "#customerOrdersModal.show",
  ];

  const syncHeaderStickyState = () => {
    const hasOpenLayer = headerBlockingSelectors.some((selector) =>
      document.querySelector(selector),
    );
    document.body.classList.toggle("modal-open-state", hasOpenLayer);
  };

  syncHeaderStickyState();

  const modalStateObserver = new MutationObserver(() => {
    syncHeaderStickyState();
  });

  modalStateObserver.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style"],
  });

  const observerOptions = {
    root: null,
    rootMargin: "-40% 0px -40% 0px",
    threshold: 0,
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const id = entry.target.getAttribute("id");
        if (id) {
          const navSectionId = id === "services-preview" ? "about" : id;
          navLinks.forEach((link) => link.classList.remove("active"));
          const activeLinks = document.querySelectorAll(
            `.nav-link[href*="#${navSectionId}"]`,
          );
          activeLinks.forEach((link) => link.classList.add("active"));
        }
      }
    });
  }, observerOptions);

  sections.forEach((section) => {
    if (section.id) {
      observer.observe(section);
    }
  });

  // Landing page reveal animation (home -> footer)
  const revealTargets = document.querySelectorAll(
    ".hero-content-left, .hero-content-right, .scroll-indicator, .about-content-left, .vision-content-left, .vision-content-right, .mission-content-left, .mission-content-right, #services-preview .section-title, #services-preview .carousel-wrapper, #services-preview .view-all-container, .products-toolbar, .services-carousel-section .carousel-wrapper, .shop-section .shop-card, .contact-info-card, .contact-form-card",
  );

  revealTargets.forEach((element) => element.classList.add("reveal-on-scroll"));

  const revealObserver = new IntersectionObserver(
    (entries, activeObserver) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("show-reveal");
          activeObserver.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.14,
      rootMargin: "0px 0px -12% 0px",
    },
  );

  revealTargets.forEach((element) => revealObserver.observe(element));

  // About video holder interactions
  const aboutVideoHolder = document.getElementById("aboutVideoHolder");
  const aboutPreviewVideo = document.getElementById("aboutPreviewVideo");
  const aboutVideoToggle = document.getElementById("aboutVideoToggle");
  const aboutVideoModal = document.getElementById("aboutVideoModal");
  const aboutVideoClose = document.getElementById("aboutVideoClose");
  const aboutFullVideo = document.getElementById("aboutFullVideo");

  if (
    aboutVideoHolder &&
    aboutPreviewVideo &&
    aboutVideoToggle &&
    aboutVideoModal &&
    aboutVideoClose &&
    aboutFullVideo
  ) {
    document.body.appendChild(aboutVideoModal);

    const syncPreviewIcon = () => {
      aboutVideoToggle.textContent = aboutPreviewVideo.paused ? "▶" : "❚❚";
    };

    aboutVideoToggle.addEventListener("click", (event) => {
      event.stopPropagation();
      if (aboutPreviewVideo.paused) {
        aboutPreviewVideo.play().catch(() => {});
      } else {
        aboutPreviewVideo.pause();
      }
    });

    const closeAboutVideoModal = () => {
      aboutVideoModal.classList.remove("show-video-modal");
      aboutFullVideo.pause();
      document.body.style.overflow = "";
    };

    aboutVideoHolder.addEventListener("click", () => {
      aboutVideoModal.classList.add("show-video-modal");
      aboutFullVideo.currentTime = aboutPreviewVideo.currentTime || 0;
      aboutFullVideo.play().catch(() => {});
      document.body.style.overflow = "hidden";
    });

    aboutVideoClose.addEventListener("click", (event) => {
      event.stopPropagation();
      closeAboutVideoModal();
    });

    aboutVideoModal.addEventListener("click", (event) => {
      if (event.target === aboutVideoModal) {
        closeAboutVideoModal();
      }
    });

    aboutPreviewVideo.addEventListener("play", syncPreviewIcon);
    aboutPreviewVideo.addEventListener("pause", syncPreviewIcon);
    aboutPreviewVideo.addEventListener("ended", syncPreviewIcon);
    syncPreviewIcon();
  }

  // Modal Logic
  const modal = document.getElementById("serviceModal");
  const modalTitle = document.getElementById("modalTitle");
  const modalImage = document.getElementById("modalImage");
  const modalDesc = document.querySelector("#serviceModal .modal-desc");
  const featureChips = document.querySelector("#serviceModal .feature-chips");
  const modalList1 = document.querySelector(
    "#serviceModal .modal-columns .modal-col:first-child .modal-list",
  );
  const modalList2 = document.querySelector(
    "#serviceModal .modal-columns .modal-col:last-child .modal-list",
  );
  const modalSub1 = document.querySelector(
    "#serviceModal .modal-columns .modal-col:first-child .modal-subtitle",
  );
  const modalSub2 = document.querySelector(
    "#serviceModal .modal-columns .modal-col:last-child .modal-subtitle",
  );

  function escHtmlModal(str) {
    const d = document.createElement("div");
    d.textContent = str || "";
    return d.innerHTML;
  }

  document.body.addEventListener("click", function (e) {
    // Open Modal logic
    const openBtn = e.target.closest(".open-modal-btn");
    if (openBtn) {
      if (modal) {
        const card = openBtn.closest(".service-card");
        if (card) {
          // Title
          const title =
            openBtn.dataset.title ||
            card.querySelector(".card-title")?.innerText ||
            "";
          if (modalTitle) modalTitle.innerText = title;

          // Image
          if (modalImage) {
            const img =
              openBtn.dataset.img ||
              card.querySelector(".card-img-holder img")?.src ||
              "";
            modalImage.src = img;
            modalImage.style.display = img ? "block" : "none";
          }

          // Description
          if (modalDesc) {
            modalDesc.textContent =
              openBtn.dataset.desc ||
              card.querySelector(".card-desc")?.innerText ||
              "";
          }

          // Feature chips
          let features = [];
          try {
            features = JSON.parse(openBtn.dataset.features || "[]");
          } catch {}
          if (featureChips) {
            const subEl = featureChips.previousElementSibling;
            if (features.length) {
              featureChips.innerHTML = features
                .map((f) => `<span class="chip">${escHtmlModal(f)}</span>`)
                .join("");
              featureChips.style.display = "";
              if (subEl && subEl.classList.contains("modal-subtitle"))
                subEl.style.display = "";
            } else {
              featureChips.innerHTML = "";
              featureChips.style.display = "none";
              if (subEl && subEl.classList.contains("modal-subtitle"))
                subEl.style.display = "none";
            }
          }

          // Materials
          let materials = [];
          try {
            materials = JSON.parse(openBtn.dataset.materials || "[]");
          } catch {}
          if (modalList1) {
            if (materials.length) {
              modalList1.innerHTML = materials
                .map((m) => `<li>${escHtmlModal(m)}</li>`)
                .join("");
              if (modalSub1) modalSub1.style.display = "";
              modalList1.style.display = "";
            } else {
              modalList1.innerHTML = "";
              if (modalSub1) modalSub1.style.display = "none";
            }
          }

          // Best For
          let bestFor = [];
          try {
            bestFor = JSON.parse(
              openBtn.dataset.bestFor || openBtn.dataset["best-for"] || "[]",
            );
          } catch {}
          if (modalList2) {
            if (bestFor.length) {
              modalList2.innerHTML = bestFor
                .map((b) => `<li>${escHtmlModal(b)}</li>`)
                .join("");
              if (modalSub2) modalSub2.style.display = "";
              modalList2.style.display = "";
            } else {
              modalList2.innerHTML = "";
              if (modalSub2) modalSub2.style.display = "none";
            }
          }
        }

        modal.classList.add("show-modal");
        document.body.style.overflow = "hidden";
      }
    }

    // Close Modal via 'X' button
    if (e.target.closest(".close-modal-btn")) {
      if (modal) {
        modal.classList.remove("show-modal");
        document.body.style.overflow = "";
      }
    }

    // Close Modal by clicking the dark overlay background
    if (e.target === modal) {
      modal.classList.remove("show-modal");
      document.body.style.overflow = "";
    }
  });

  // =========================================
  // SERVICES LIST FILTERING LOGIC
  // =========================================
  const isServicesPage = document.body.classList.contains("services-page-body");

  if (isServicesPage) {
    const searchInput = document.querySelector(".toolbar-search .search-input");
    const categorySelect = document.querySelector(".category-select");
    const serviceCards = Array.from(
      document.querySelectorAll(".services-grid .service-card"),
    );

    const normalize = (value) =>
      String(value || "")
        .toLowerCase()
        .trim();

    const applyServiceFilters = () => {
      const query = normalize(searchInput?.value || "");
      const selectedCategory = normalize(categorySelect?.value || "all");

      serviceCards.forEach((card) => {
        const title = normalize(
          card.querySelector(".card-title")?.textContent || "",
        );
        const desc = normalize(
          card.querySelector(".card-desc")?.textContent || "",
        );
        const category = normalize(card.dataset.category || "");

        const matchesSearch =
          !query || title.includes(query) || desc.includes(query);
        const matchesCategory =
          selectedCategory === "all" || category === selectedCategory;
        card.style.display = matchesSearch && matchesCategory ? "" : "none";
      });
    };

    searchInput?.addEventListener("input", applyServiceFilters);
    categorySelect?.addEventListener("change", applyServiceFilters);
    applyServiceFilters();
  }

  // =========================================
  // SERVICES 3D CAROUSEL LOGIC (Homepage)
  // =========================================
  const track = document.querySelector(".carousel-track");

  if (track) {
    const items = Array.from(track.querySelectorAll(".carousel-item"));
    const prevBtn = document.querySelector(".prev-btn");
    const nextBtn = document.querySelector(".next-btn");
    const wrapper = document.querySelector(".carousel-wrapper");

    if (items.length > 0 && prevBtn && nextBtn && wrapper) {
      let currentIndex = 0;
      let autoPlayInterval;

      const updateCarousel = () => {
        items.forEach((item, index) => {
          item.className = "carousel-item";

          if (index === currentIndex) {
            item.classList.add("active");
          } else if (
            index ===
            (currentIndex - 1 + items.length) % items.length
          ) {
            item.classList.add("prev");
          } else if (index === (currentIndex + 1) % items.length) {
            item.classList.add("next");
          } else if (
            index ===
            (currentIndex - 2 + items.length) % items.length
          ) {
            item.classList.add("prev-hidden");
          } else if (index === (currentIndex + 2) % items.length) {
            item.classList.add("next-hidden");
          }
        });
      };

      const moveNext = () => {
        currentIndex = (currentIndex + 1) % items.length;
        updateCarousel();
      };

      const movePrev = () => {
        currentIndex = (currentIndex - 1 + items.length) % items.length;
        updateCarousel();
      };

      const startAutoPlay = () => {
        autoPlayInterval = setInterval(moveNext, 5000);
      };

      const resetAutoPlay = () => {
        clearInterval(autoPlayInterval);
        startAutoPlay();
      };

      nextBtn.addEventListener("click", () => {
        moveNext();
        resetAutoPlay();
      });

      prevBtn.addEventListener("click", () => {
        movePrev();
        resetAutoPlay();
      });

      items.forEach((item) => {
        item.addEventListener("click", () => {
          if (item.classList.contains("prev")) {
            movePrev();
            resetAutoPlay();
          } else if (item.classList.contains("next")) {
            moveNext();
            resetAutoPlay();
          }
        });
      });

      let startX = 0;
      let endX = 0;

      track.addEventListener(
        "touchstart",
        (e) => {
          startX = e.touches[0].clientX;
          clearInterval(autoPlayInterval);
        },
        { passive: true },
      );

      track.addEventListener("touchend", (e) => {
        endX = e.changedTouches[0].clientX;
        const swipeThreshold = 40;

        if (startX - endX > swipeThreshold) {
          moveNext();
        } else if (endX - startX > swipeThreshold) {
          movePrev();
        }

        startAutoPlay();
      });

      wrapper.addEventListener("mouseenter", () =>
        clearInterval(autoPlayInterval),
      );
      wrapper.addEventListener("mouseleave", startAutoPlay);

      updateCarousel();
      startAutoPlay();
    }
  }

  // =========================================
  // FULLSCREEN IMAGE LIGHTBOX LOGIC
  // =========================================
  const imageLightbox = document.getElementById("imageLightbox");
  const lightboxImg = document.getElementById("lightboxImg");
  const closeLightboxBtn = document.getElementById("closeLightbox");

  // When the user clicks the image inside the service modal
  if (modalImage && imageLightbox && lightboxImg) {
    modalImage.addEventListener("click", () => {
      lightboxImg.src = modalImage.src; // Copy source from modal image
      lightboxImg.alt = modalImage.alt;
      imageLightbox.classList.add("show-lightbox");
    });
  }

  // Close the lightbox when clicking the 'X' or the dark background
  if (imageLightbox) {
    imageLightbox.addEventListener("click", (e) => {
      if (e.target === imageLightbox || e.target === closeLightboxBtn) {
        imageLightbox.classList.remove("show-lightbox");
      }
    });
  }

  // =========================================
  // PRODUCTS PAGE: INFO, RATING, FILTERS
  // =========================================
  const isProductsPage = document.body.classList.contains("products-page-body");
  const productCards = Array.from(document.querySelectorAll(".shop-card"));

  if (isProductsPage && productCards.length > 0) {
    const shopGrid = document.querySelector(".shop-grid");
    const searchInput = document.getElementById("productSearchInput");
    const categorySelect = document.getElementById("productCategorySelect");
    const filterSelect = document.getElementById("productFilterSelect");

    const productInfoModal = document.getElementById("productInfoModal");
    const closeProductInfoModal = document.getElementById(
      "closeProductInfoModal",
    );
    const productInfoTitle = document.getElementById("productInfoTitle");
    const productInfoImage = document.getElementById("productInfoImage");
    const productInfoSummary = document.getElementById("productInfoSummary");
    const productInfoChips = document.getElementById("productInfoChips");
    const productInfoAvailability = document.getElementById(
      "productInfoAvailability",
    );
    const productInfoRecommended = document.getElementById(
      "productInfoRecommended",
    );
    const productInfoAddToCart = document.getElementById(
      "productInfoAddToCart",
    );
    const productInfoBuyNow = document.getElementById("productInfoBuyNow");

    let activeProductCard = null;

    const getCategoryFromName = (name) => {
      const normalized = name.toLowerCase();
      if (normalized.includes("laser")) return "laser";
      if (normalized.includes("cnc")) return "cnc";
      return "3dprint";
    };

    const paintStars = (container, ratingValue) => {
      const stars = container.querySelectorAll(".rating-star-btn");
      stars.forEach((star) => {
        const starValue = parseInt(star.dataset.star || "0");
        star.classList.toggle("filled", starValue <= ratingValue);
      });
    };

    productCards.forEach((card, index) => {
      const nameEl = card.querySelector(".product-name");
      const nameText = nameEl
        ? nameEl.innerText.trim()
        : `Product ${index + 1}`;
      const inferredCategory = getCategoryFromName(nameText);

      card.dataset.category = card.dataset.category || inferredCategory;
      card.dataset.userRating = card.dataset.userRating || "4";

      const productInfo = card.querySelector(".product-info");
      const priceEl = card.querySelector(".product-price");

      if (
        productInfo &&
        priceEl &&
        !card.querySelector(".product-rating-row")
      ) {
        const ratingRow = document.createElement("div");
        ratingRow.className = "product-rating-row";
        ratingRow.innerHTML = `
          <span class="rating-score"><span class="rating-score-value">4.0</span>/5</span>
          <div class="rating-stars" aria-label="Product rating">
            <button type="button" class="rating-star-btn filled" data-star="1">★</button>
            <button type="button" class="rating-star-btn filled" data-star="2">★</button>
            <button type="button" class="rating-star-btn filled" data-star="3">★</button>
            <button type="button" class="rating-star-btn filled" data-star="4">★</button>
            <button type="button" class="rating-star-btn" data-star="5">★</button>
            <span class="rating-count">(${12 + index * 3})</span>
          </div>
        `;

        priceEl.insertAdjacentElement("afterend", ratingRow);

        const starsContainer = ratingRow.querySelector(".rating-stars");
        paintStars(starsContainer, parseInt(card.dataset.userRating));

        starsContainer.addEventListener("click", (event) => {
          const clickedStar = event.target.closest(".rating-star-btn");
          if (!clickedStar) return;

          const selectedRating = parseInt(clickedStar.dataset.star || "4");
          card.dataset.userRating = String(selectedRating);
          const scoreValue = ratingRow.querySelector(".rating-score-value");
          if (scoreValue) scoreValue.innerText = `${selectedRating}.0`;
          paintStars(starsContainer, selectedRating);

          if (filterSelect && filterSelect.value === "top-rated") {
            applyProductFilters();
          }
        });
      }

      const actionContainer = card.querySelector(".product-actions");
      if (actionContainer && !actionContainer.querySelector(".btn-view-info")) {
        const infoBtn = document.createElement("button");
        infoBtn.type = "button";
        infoBtn.className = "action-btn btn-view-info";
        infoBtn.innerText = "VIEW INFO";

        const divider = document.createElement("span");
        divider.className = "action-divider";
        divider.setAttribute("aria-hidden", "true");

        actionContainer.insertBefore(divider, actionContainer.firstChild);
        actionContainer.insertBefore(infoBtn, divider);
      }
    });

    const openProductInfoModal = (card) => {
      if (!productInfoModal) return;

      activeProductCard = card;
      const title = card.querySelector(".product-name")?.innerText || "Product";
      const image = card.querySelector(".product-img-wrapper img");
      const price = card.querySelector(".product-price")?.innerText || "₱0.00";
      const code = card.querySelector(".code-value")?.innerText || "N/A";
      const stock = card.querySelector(".stock-text")?.innerText || "N/A";
      const badge = card.querySelector(".stock-badge")?.innerText || "N/A";
      const currentRating = parseInt(card.dataset.userRating || "4");

      if (productInfoTitle) productInfoTitle.innerText = title;
      if (productInfoImage && image) {
        productInfoImage.src = image.src;
        productInfoImage.alt = image.alt || title;
      }

      if (productInfoSummary) {
        productInfoSummary.innerText = `${title} is available for request and processing through CNSC-FMRC. This item includes quality production support with consistent output standards.`;
      }

      if (productInfoChips) {
        productInfoChips.innerHTML = `
          <span class="chip">Price ${price}</span>
          <span class="chip">Code ${code}</span>
          <span class="chip">Rated ${currentRating}.0 / 5</span>
          <span class="chip">Service-backed production</span>
        `;
      }

      if (productInfoAvailability) {
        productInfoAvailability.innerHTML = `
          <li>Stock status: ${stock}</li>
          <li>Availability badge: ${badge}</li>
          <li>Direct checkout supported</li>
        `;
      }

      if (productInfoRecommended) {
        productInfoRecommended.innerHTML = `
          <li>Academic prototypes and demos</li>
          <li>Business sample production</li>
          <li>Event and presentation materials</li>
        `;
      }

      productInfoModal.classList.add("show-modal");
      document.body.style.overflow = "hidden";
    };

    const closeInfoModal = () => {
      if (!productInfoModal) return;
      productInfoModal.classList.remove("show-modal");
      document.body.style.overflow = "";
    };

    document.body.addEventListener("click", (event) => {
      const viewInfoBtn = event.target.closest(".btn-view-info");
      if (viewInfoBtn) {
        const relatedCard = viewInfoBtn.closest(".shop-card");
        if (relatedCard) openProductInfoModal(relatedCard);
      }
    });

    if (closeProductInfoModal) {
      closeProductInfoModal.addEventListener("click", closeInfoModal);
    }

    if (productInfoModal) {
      productInfoModal.addEventListener("click", (event) => {
        if (event.target === productInfoModal) closeInfoModal();
      });
    }

    if (productInfoAddToCart) {
      productInfoAddToCart.addEventListener("click", () => {
        const addBtn = activeProductCard?.querySelector(
          ".btn-add-cart:not(.disabled)",
        );
        if (addBtn) {
          closeInfoModal();
          addBtn.click();
        }
      });
    }

    if (productInfoBuyNow) {
      productInfoBuyNow.addEventListener("click", () => {
        const buyBtn = activeProductCard?.querySelector(
          ".btn-buy-now:not(.disabled)",
        );
        if (buyBtn) {
          closeInfoModal();
          buyBtn.click();
        }
      });
    }

    const applyProductFilters = () => {
      const searchValue = (searchInput?.value || "").trim().toLowerCase();
      const selectedCategory = categorySelect?.value || "all";
      const selectedFilter = filterSelect?.value || "all";

      const cards = Array.from(shopGrid?.querySelectorAll(".shop-card") || []);

      cards.forEach((card) => {
        const nameText =
          card.querySelector(".product-name")?.innerText.toLowerCase() || "";
        const category = card.dataset.category || "all";
        const stockBadge = card.querySelector(".stock-badge");
        const isOutOfStock = stockBadge?.classList.contains("out-of-stock");
        const userRating = parseInt(card.dataset.userRating || "4");

        let visible = true;

        if (searchValue && !nameText.includes(searchValue)) visible = false;
        if (selectedCategory !== "all" && category !== selectedCategory)
          visible = false;

        if (selectedFilter === "in-stock" && isOutOfStock) visible = false;
        if (selectedFilter === "out-of-stock" && !isOutOfStock) visible = false;
        if (selectedFilter === "top-rated" && userRating < 4) visible = false;

        card.style.display = visible ? "flex" : "none";
      });

      if (
        selectedFilter === "price-low" ||
        selectedFilter === "price-high" ||
        selectedFilter === "top-rated"
      ) {
        const visibleCards = cards.filter(
          (card) => card.style.display !== "none",
        );

        visibleCards.sort((a, b) => {
          if (selectedFilter === "top-rated") {
            return (
              parseInt(b.dataset.userRating || "4") -
              parseInt(a.dataset.userRating || "4")
            );
          }

          const getPrice = (cardEl) => {
            const priceText =
              cardEl.querySelector(".product-price")?.innerText || "₱0";
            return parseFloat(priceText.replace(/[^0-9.]/g, ""));
          };

          const priceA = getPrice(a);
          const priceB = getPrice(b);
          return selectedFilter === "price-low"
            ? priceA - priceB
            : priceB - priceA;
        });

        visibleCards.forEach((card) => shopGrid.appendChild(card));
      }
    };

    if (searchInput) searchInput.addEventListener("input", applyProductFilters);
    if (categorySelect)
      categorySelect.addEventListener("change", applyProductFilters);
    if (filterSelect)
      filterSelect.addEventListener("change", applyProductFilters);

    applyProductFilters();
  }

  // =========================================
  // E-COMMERCE CHECKOUT LOGIC (3-STEP FLOW)
  // =========================================
  const checkoutModal = document.getElementById("checkoutModal");
  const addressSelectionModal = document.getElementById(
    "addressSelectionModal",
  );
  const editInfoModal = document.getElementById("editInfoModal");

  // Checkout DOM elements
  const checkoutImg = document.getElementById("checkoutProductImg");
  const checkoutTitle = document.getElementById("checkoutProductTitle");
  const checkoutPrice = document.getElementById("checkoutProductPrice");
  const checkoutSubtotal = document.getElementById("checkoutSubtotal");
  const checkoutGrandTotal = document.getElementById("checkoutGrandTotal");
  const footerTotalDisplay = document.getElementById("footerTotalDisplay");
  const checkoutMaxStock = document.getElementById("checkoutMaxStock");

  // Quantity DOM elements
  const inputQty = document.getElementById("inputQty");
  const btnMinusQty = document.getElementById("btnMinusQty");
  const btnPlusQty = document.getElementById("btnPlusQty");
  const footerItemCount = document.getElementById("footerItemCount");

  // Edit Guide DOM elements
  const guideImg = document.getElementById("guideProductImg");
  const guideTitle = document.getElementById("guideProductTitle");

  let currentItemPrice = 0;
  let currentMaxStock = Infinity;
  let currentProductId = null;
  let currentCheckoutMode = "single";
  let currentCheckoutItems = [];
  let isCheckoutQtyLocked = false;
  let protectionFee = 5.0;

  const setCheckoutQtyLock = (locked) => {
    isCheckoutQtyLocked = Boolean(locked);
    if (btnMinusQty) btnMinusQty.disabled = isCheckoutQtyLocked;
    if (btnPlusQty) btnPlusQty.disabled = isCheckoutQtyLocked;
  };

  const setCheckoutStockNotice = (value) => {
    if (!checkoutMaxStock) return;
    checkoutMaxStock.innerText = String(value || "0");
  };

  function parsePrice(priceStr) {
    return parseFloat(priceStr.replace(/[^0-9.-]+/g, ""));
  }
  function formatPrice(num) {
    return "₱" + num.toFixed(2);
  }

  function updateCheckoutMath() {
    let qty = parseInt(inputQty.value);
    let total = currentItemPrice * qty;

    // Add protection fee if checked
    const protectionCheck = document.getElementById("protectionCheck");
    if (protectionCheck && protectionCheck.checked) {
      total += protectionFee;
    }

    checkoutSubtotal.innerText = formatPrice(currentItemPrice * qty);
    checkoutGrandTotal.innerText = formatPrice(total);
    footerTotalDisplay.innerText = formatPrice(total);
    footerItemCount.innerText = qty;
  }

  // Update math when Protection checkbox is clicked
  const protectionCheck = document.getElementById("protectionCheck");
  if (protectionCheck) {
    protectionCheck.addEventListener("change", updateCheckoutMath);
  }

  if (btnMinusQty && btnPlusQty && inputQty) {
    btnMinusQty.addEventListener("click", () => {
      if (isCheckoutQtyLocked) {
        void showCustomerPopup(
          "Edit quantities directly in your cart for cart checkout.",
          {
            title: "Quantity Locked",
          },
        );
        return;
      }

      let currentVal = parseInt(inputQty.value);
      if (currentVal > 1) {
        inputQty.value = currentVal - 1;
        updateCheckoutMath();
      }
    });
    btnPlusQty.addEventListener("click", () => {
      if (isCheckoutQtyLocked) {
        void showCustomerPopup(
          "Edit quantities directly in your cart for cart checkout.",
          {
            title: "Quantity Locked",
          },
        );
        return;
      }

      let currentVal = parseInt(inputQty.value);
      if (currentVal < currentMaxStock) {
        inputQty.value = currentVal + 1;
        updateCheckoutMath();
      } else if (currentMaxStock === 9999) {
        inputQty.value = currentVal + 1;
        updateCheckoutMath();
      } else {
        void showCustomerPopup("Maximum stock reached for this item.", {
          title: "Stock Limit",
        });
      }
    });
  }

  // --- MODAL 1: OPEN CHECKOUT ---
  const buyNowBtns = document.querySelectorAll(".btn-buy-now:not(.disabled)");
  buyNowBtns.forEach((btn) => {
    btn.addEventListener("click", function (e) {
      if (!requireCustomerAuth("buy products")) return;
      if (!isGuestUser) {
        void fetchCustomerCheckoutProfile();
      }

      const card = e.target.closest(".shop-card");
      if (card) {
        const imgScr = card.querySelector(".product-img-wrapper img").src;
        const title = card.querySelector(".product-name").innerText;
        const priceStr = card.querySelector(".product-price").innerText;
        const stockText = card.querySelector(".stock-text").innerText;

        currentCheckoutMode = "single";
        currentCheckoutItems = [];
        setCheckoutQtyLock(false);
        currentProductId =
          Number(card.getAttribute("data-product-id") || "") || null;

        if (stockText.toLowerCase().includes("unlimited")) {
          currentMaxStock = 9999;
          setCheckoutStockNotice("Unlimited");
        } else {
          currentMaxStock = Math.max(
            0,
            parseInt(stockText.replace(/[^0-9]/g, ""), 10) || 0,
          );
          setCheckoutStockNotice(currentMaxStock);
        }

        currentItemPrice = parsePrice(priceStr);
        inputQty.value = 1;
        inputQty.max = currentMaxStock;
        if (protectionCheck) protectionCheck.checked = false; // Reset protection

        if (checkoutImg) checkoutImg.src = imgScr;
        if (checkoutTitle) checkoutTitle.innerText = title;
        if (checkoutPrice) checkoutPrice.innerText = priceStr;

        updateCheckoutMath();

        if (guideImg) guideImg.src = imgScr;
        if (guideTitle) guideTitle.innerText = title;

        checkoutModal.classList.add("show-modal");
        document.body.style.overflow = "hidden";
      }
    });
  });

  // Dynamically rendered products buy-now listener
  document.addEventListener("product:buy-now", (e) => {
    const product = e.detail;
    if (!product) return;
    if (!requireCustomerAuth("buy products")) return;
    if (!isGuestUser) {
      void fetchCustomerCheckoutProfile();
    }

    const imgScr = product.image_data || "/images/FMRC Logo.png";
    const title = String(product.name || "");
    const unitPrice = Number.isFinite(Number(product.price))
      ? Number(product.price)
      : 0;

    currentCheckoutMode = "single";
    currentCheckoutItems = [];
    setCheckoutQtyLock(false);
    currentMaxStock =
      product.stock_status === "in_stock"
        ? Math.max(0, Number(product.stock) || 0)
        : 0;
    setCheckoutStockNotice(
      currentMaxStock === 0 ? "Out of Stock" : currentMaxStock,
    );

    currentItemPrice = unitPrice;
    currentProductId = product.id || null;
    if (inputQty) {
      inputQty.value = 1;
      inputQty.max = currentMaxStock;
    }
    if (protectionCheck) protectionCheck.checked = false;

    if (checkoutImg) checkoutImg.src = imgScr;
    if (checkoutTitle) checkoutTitle.innerText = title;
    if (checkoutPrice)
      checkoutPrice.innerText =
        typeof formatPrice === "function"
          ? formatPrice(unitPrice)
          : "₱" + unitPrice.toFixed(2);

    if (guideImg) guideImg.src = imgScr;
    if (guideTitle) guideTitle.innerText = title;

    updateCheckoutMath();
    checkoutModal.classList.add("show-modal");
    document.body.style.overflow = "hidden";
  });

  const closeCheckoutBtn = document.getElementById("closeCheckoutBtn");
  if (closeCheckoutBtn) {
    closeCheckoutBtn.addEventListener("click", () => {
      checkoutModal.classList.remove("show-modal");
      document.body.style.overflow = "auto";
      currentCheckoutMode = "single";
      currentCheckoutItems = [];
      setCheckoutQtyLock(false);
    });
  }

  // --- MODAL 2: OPEN ADDRESS SELECTION ---
  const openAddressSelectionBtn = document.getElementById(
    "openAddressSelectionBtn",
  );
  if (openAddressSelectionBtn) {
    openAddressSelectionBtn.addEventListener("click", () => {
      setAddressEditMode(false);
      addressSelectionModal.classList.add("show-modal");
    });
  }

  const backToCheckoutFromAddressBtn = document.getElementById(
    "backToCheckoutFromAddressBtn",
  );
  if (backToCheckoutFromAddressBtn) {
    backToCheckoutFromAddressBtn.addEventListener("click", () => {
      setAddressEditMode(false);
      addressSelectionModal.classList.remove("show-modal");
    });
  }

  // Select and manage checkout addresses using profile data + local address book.
  const openAddAddressBtn = document.getElementById("openAddAddressBtn");
  const addInfoModal = document.getElementById("addInfoModal");
  const addressList =
    document.getElementById("addressList") ||
    document.querySelector(".address-list");
  const addressEditModeBtn = document.getElementById("addressEditModeBtn");
  const addressSelectionFooter = document.getElementById(
    "addressSelectionFooter",
  );
  const selectAllAddressBtn = document.getElementById("selectAllAddressBtn");
  const deleteSelectedAddressBtn = document.getElementById(
    "deleteSelectedAddressBtn",
  );
  const deleteAllAddressBtn = document.getElementById("deleteAllAddressBtn");
  const cartShortAddressText = document.getElementById("cartShortAddressText");

  const displayClientName = document.getElementById("displayClientName");
  const displayClientPhone = document.getElementById("displayClientPhone");
  const displayClientAddress = document.getElementById("displayClientAddress");
  const displayClientRole = document.getElementById("displayClientRole");
  const displayClientDept = document.getElementById("displayClientDept");

  const inpFullName = document.getElementById("inpFullName");
  const inpPhone = document.getElementById("inpPhone");
  const inpAddress = document.getElementById("inpAddress");
  const inpDetails = document.getElementById("inpDetails");
  const inpDept = document.getElementById("inpDept");
  const inpSetDefault = document.getElementById("inpSetDefault");
  const addInpFullName = document.getElementById("addInpFullName");
  const addInpPhone = document.getElementById("addInpPhone");
  const addInpAddress = document.getElementById("addInpAddress");
  const addInpDetails = document.getElementById("addInpDetails");
  const addInpDept = document.getElementById("addInpDept");
  const addInpSetDefault = document.getElementById("addInpSetDefault");

  const saveInfoBtn = document.getElementById("saveInfoBtn");
  const saveNewInfoBtn = document.getElementById("saveNewInfoBtn");
  const backToAddressBtn = document.getElementById("backToAddressBtn");
  const backToAddressFromAddBtn = document.getElementById(
    "backToAddressFromAddBtn",
  );

  const ADDRESS_STORAGE_NAMESPACE = "fmrc_checkout_addresses_v1";

  let customerCheckoutProfile = null;
  let customerAddressBook = [];
  let selectedCheckoutAddressId = null;
  let editingCheckoutAddressId = null;
  let isAddressEditMode = false;
  const addressDeleteSelection = new Set();

  const escapeCustomerHtml = (value) =>
    String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const getMaskedPhone = (rawDigits) => {
    const digits = String(rawDigits || "").replace(/\D/g, "");
    if (!digits) return "(+63)N/A";
    if (digits.length <= 4) return `(+63)${digits}`;
    return `(+63)${digits.substring(0, 2)}******${digits.substring(digits.length - 2)}`;
  };

  const getShortAddress = (addressLine) => {
    const clean = String(addressLine || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!clean) return "No saved address";
    if (clean.length <= 40) return clean;
    return `${clean.slice(0, 37)}...`;
  };

  const getAddressStorageKey = () => {
    const customerKey =
      customerSession.userInfo?.id ||
      customerSession.userInfo?.email ||
      customerSession.userInfo?.username ||
      "guest";

    return `${ADDRESS_STORAGE_NAMESPACE}:${String(customerKey).toLowerCase()}`;
  };

  const normalizePhoneDigits = (value) =>
    String(value || "")
      .replace(/\D/g, "")
      .slice(0, 11);

  const createAddressId = () =>
    `addr-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const normalizeAddressEntry = (entry = {}) => ({
    id: String(entry.id || createAddressId()),
    name: String(entry.name || "").trim(),
    phone_number: normalizePhoneDigits(entry.phone_number || entry.phone || ""),
    address_line: String(entry.address_line || "").trim(),
    address_details: String(entry.address_details || "").trim(),
    department: String(entry.department || "").trim(),
    customer_type: String(entry.customer_type || "Student").trim() || "Student",
    is_default: Boolean(entry.is_default),
    updated_at: String(entry.updated_at || new Date().toISOString()),
  });

  const setRoleByRadioName = (radioName, value) => {
    const targetValue = String(value || "Student");
    const radios = document.querySelectorAll(`input[name="${radioName}"]`);
    let matched = false;
    radios.forEach((radio) => {
      if (!(radio instanceof HTMLInputElement)) return;
      const isMatch = radio.value === targetValue;
      radio.checked = isMatch;
      if (isMatch) matched = true;
    });

    if (!matched) {
      const first = radios[0];
      if (first instanceof HTMLInputElement) {
        first.checked = true;
      }
    }
  };

  const getSelectedRole = (name) => {
    const checked = document.querySelector(`input[name="${name}"]:checked`);
    return checked instanceof HTMLInputElement ? checked.value : "Student";
  };

  const getAddressFieldIds = (mode) => {
    if (mode === "add") {
      return {
        name: "addInpFullName",
        phone: "addInpPhone",
        address: "addInpAddress",
        details: "addInpDetails",
        dept: "addInpDept",
      };
    }

    return {
      name: "inpFullName",
      phone: "inpPhone",
      address: "inpAddress",
      details: "inpDetails",
      dept: "inpDept",
    };
  };

  const clearCheckoutFieldError = (fieldId) => {
    const field = document.getElementById(fieldId);
    if (!(field instanceof HTMLElement)) return;

    const group = field.closest(".form-group");
    if (!(group instanceof HTMLElement)) return;

    group.classList.remove("has-error");
    field.removeAttribute("aria-invalid");
  };

  const setCheckoutFieldError = (fieldId, message) => {
    const field = document.getElementById(fieldId);
    if (!(field instanceof HTMLElement)) return;

    const group = field.closest(".form-group");
    if (!(group instanceof HTMLElement)) return;

    let bubble = group.querySelector(".checkout-field-error-bubble");
    if (!(bubble instanceof HTMLElement)) {
      bubble = document.createElement("div");
      bubble.className = "checkout-field-error-bubble";
      bubble.setAttribute("role", "alert");
      group.appendChild(bubble);
    }

    bubble.textContent = String(message || "Please check this field.");
    group.classList.add("has-error");
    field.setAttribute("aria-invalid", "true");
  };

  const clearCheckoutFormErrors = (mode) => {
    const ids = getAddressFieldIds(mode);
    Object.values(ids).forEach((fieldId) => clearCheckoutFieldError(fieldId));
  };

  const ensureSingleDefaultAddress = () => {
    if (!customerAddressBook.length) {
      selectedCheckoutAddressId = null;
      return;
    }

    let defaultIndex = customerAddressBook.findIndex(
      (entry) => entry.is_default,
    );
    if (defaultIndex < 0) {
      defaultIndex = 0;
      customerAddressBook[0].is_default = true;
    }

    customerAddressBook = customerAddressBook.map((entry, index) => ({
      ...entry,
      is_default: index === defaultIndex,
    }));

    const hasSelected = customerAddressBook.some(
      (entry) => String(entry.id) === String(selectedCheckoutAddressId),
    );
    if (!hasSelected) {
      selectedCheckoutAddressId =
        customerAddressBook[defaultIndex]?.id ||
        customerAddressBook[0]?.id ||
        null;
    }
  };

  const loadAddressBookFromStorage = () => {
    try {
      const raw = localStorage.getItem(getAddressStorageKey());
      const parsed = JSON.parse(raw || "[]");
      customerAddressBook = Array.isArray(parsed)
        ? parsed.map((entry) => normalizeAddressEntry(entry))
        : [];
    } catch {
      customerAddressBook = [];
    }

    ensureSingleDefaultAddress();
  };

  const saveAddressBookToStorage = () => {
    try {
      localStorage.setItem(
        getAddressStorageKey(),
        JSON.stringify(customerAddressBook),
      );
    } catch {
      // Ignore localStorage quota/write issues.
    }
  };

  const getSelectedCheckoutAddress = () => {
    if (!customerAddressBook.length) return null;

    const selected = customerAddressBook.find(
      (entry) => String(entry.id) === String(selectedCheckoutAddressId),
    );
    if (selected) return selected;

    return (
      customerAddressBook.find((entry) => entry.is_default) ||
      customerAddressBook[0] ||
      null
    );
  };

  const renderCheckoutAddress = () => {
    const selected = getSelectedCheckoutAddress();
    const fallbackName =
      customerCheckoutProfile?.name ||
      customerSession.userInfo?.name ||
      "No Name Provided";
    const name = selected?.name || fallbackName;
    const phone =
      selected?.phone_number || customerCheckoutProfile?.phone_number || "";
    const addressLine =
      selected?.address_line || customerCheckoutProfile?.address_line || "";
    const addressDetails =
      selected?.address_details ||
      customerCheckoutProfile?.address_details ||
      "";
    const department =
      selected?.department || customerCheckoutProfile?.department || "Not set";
    const role =
      selected?.customer_type ||
      customerCheckoutProfile?.customer_type ||
      "Not set";

    if (displayClientName) displayClientName.innerText = name;
    if (displayClientPhone)
      displayClientPhone.innerText = getMaskedPhone(phone);
    if (displayClientAddress) {
      displayClientAddress.innerHTML =
        [addressLine, addressDetails]
          .filter(Boolean)
          .map((entry) => escapeCustomerHtml(entry))
          .join("<br>") || "No saved address yet. Add your details first.";
    }
    if (displayClientRole) displayClientRole.innerText = role;
    if (displayClientDept) displayClientDept.innerText = department;
    if (cartShortAddressText) {
      cartShortAddressText.innerText = getShortAddress(
        addressLine || addressDetails,
      );
    }
  };

  const syncAddressEditUi = () => {
    if (!customerAddressBook.length) {
      isAddressEditMode = false;
      addressDeleteSelection.clear();
    }

    if (addressEditModeBtn) {
      addressEditModeBtn.innerText = isAddressEditMode ? "Done" : "Edit";
      addressEditModeBtn.disabled = !customerAddressBook.length;
    }

    if (addressSelectionFooter) {
      addressSelectionFooter.style.display = isAddressEditMode
        ? "flex"
        : "none";
    }

    const total = customerAddressBook.length;
    const selectedCount = addressDeleteSelection.size;

    if (selectAllAddressBtn) {
      selectAllAddressBtn.disabled = !isAddressEditMode || total === 0;
      selectAllAddressBtn.checked =
        isAddressEditMode && total > 0 && selectedCount === total;
      selectAllAddressBtn.indeterminate =
        isAddressEditMode && selectedCount > 0 && selectedCount < total;
    }

    if (deleteSelectedAddressBtn) {
      deleteSelectedAddressBtn.disabled =
        !isAddressEditMode || selectedCount === 0;
    }

    if (deleteAllAddressBtn) {
      deleteAllAddressBtn.disabled = !isAddressEditMode || total === 0;
    }
  };

  const renderAddressList = () => {
    if (!addressList) return;

    if (!customerAddressBook.length) {
      addressList.innerHTML = `
        <div class="address-item address-item-empty">
          <div class="address-item-left">
            <div class="a-address-text">No saved address yet. Tap <strong>Add details</strong> to create one.</div>
          </div>
        </div>
      `;
      syncAddressEditUi();
      return;
    }

    addressList.innerHTML = customerAddressBook
      .map((entry) => {
        const safeId = escapeCustomerHtml(entry.id);
        const isSelected =
          String(entry.id) === String(selectedCheckoutAddressId);
        const isChecked = addressDeleteSelection.has(String(entry.id));
        const displayAddress = [entry.address_line, entry.address_details]
          .filter(Boolean)
          .map((part) => escapeCustomerHtml(part))
          .join("<br>");

        return `
          <div class="address-item ${isSelected ? "selected" : ""} ${isAddressEditMode ? "select-mode" : ""}" data-address-id="${safeId}">
            <div class="address-item-main">
              <div class="address-edit-selector">
                <label class="cart-checkbox-container">
                  <input type="checkbox" class="address-edit-check" data-address-check="${safeId}" ${isChecked ? "checked" : ""}>
                  <span class="cart-checkmark"></span>
                </label>
              </div>

              <div class="address-item-left">
                <div class="address-name-row">
                  <span class="a-name">${escapeCustomerHtml(entry.name || "No Name Provided")}</span>
                  <span class="a-phone">${getMaskedPhone(entry.phone_number)}</span>
                </div>
                <div class="a-address-text">${displayAddress || "No saved address"}</div>
                <div class="a-badges">
                  ${entry.is_default ? '<span class="a-badge default-badge">Default</span>' : ""}
                </div>
              </div>

              ${
                isAddressEditMode
                  ? `<button class="delete-address-inline" type="button" data-address-delete="${safeId}">Delete</button>`
                  : `<div class="address-item-right"><button class="edit-address-btn" type="button" data-address-edit="${safeId}">Edit</button></div>`
              }
            </div>
          </div>
        `;
      })
      .join("");

    syncAddressEditUi();
  };

  const applyAddressToForm = (mode, addressEntry) => {
    const source = addressEntry || {};
    const isAddMode = mode === "add";

    if (isAddMode) {
      if (addInpFullName) {
        addInpFullName.value =
          source.name || customerSession.userInfo?.name || "";
      }
      if (addInpPhone) addInpPhone.value = source.phone_number || "";
      if (addInpAddress) addInpAddress.value = source.address_line || "";
      if (addInpDetails) addInpDetails.value = source.address_details || "";
      if (addInpDept) addInpDept.value = source.department || "";
      if (addInpSetDefault) {
        addInpSetDefault.checked =
          customerAddressBook.length === 0 || Boolean(source.is_default);
      }
      setRoleByRadioName("addUserRole", source.customer_type || "Student");
      return;
    }

    if (inpFullName)
      inpFullName.value = source.name || customerSession.userInfo?.name || "";
    if (inpPhone) inpPhone.value = source.phone_number || "";
    if (inpAddress) inpAddress.value = source.address_line || "";
    if (inpDetails) inpDetails.value = source.address_details || "";
    if (inpDept) inpDept.value = source.department || "";
    if (inpSetDefault) inpSetDefault.checked = Boolean(source.is_default);
    setRoleByRadioName("userRole", source.customer_type || "Student");
  };

  const validateAddressForm = (mode) => {
    const ids = getAddressFieldIds(mode);
    const isAddMode = mode === "add";

    clearCheckoutFormErrors(mode);

    const nameInput = document.getElementById(ids.name);
    const phoneInput = document.getElementById(ids.phone);
    const addressInput = document.getElementById(ids.address);
    const detailsInput = document.getElementById(ids.details);
    const deptInput = document.getElementById(ids.dept);

    const name = String(nameInput?.value || "").trim();
    const phone = normalizePhoneDigits(phoneInput?.value || "");
    const addressLine = String(addressInput?.value || "").trim();
    const addressDetails = String(detailsInput?.value || "").trim();
    const department = String(deptInput?.value || "").trim();
    const customerType = getSelectedRole(
      isAddMode ? "addUserRole" : "userRole",
    );
    const setDefault = isAddMode
      ? Boolean(addInpSetDefault?.checked)
      : Boolean(inpSetDefault?.checked);

    if (phoneInput instanceof HTMLInputElement) {
      phoneInput.value = phone;
    }

    let firstInvalidInput = null;

    const registerError = (fieldId, message) => {
      setCheckoutFieldError(fieldId, message);
      if (!firstInvalidInput) {
        firstInvalidInput = document.getElementById(fieldId);
      }
    };

    if (!name) {
      registerError(ids.name, "Please enter your full name.");
    }

    if (!phone) {
      registerError(ids.phone, "Please enter your mobile number.");
    } else if (!/^9\d{9,10}$/.test(phone)) {
      registerError(
        ids.phone,
        "Use a valid PH number after +63. Example: 9XXXXXXXXX.",
      );
    }

    if (!addressLine) {
      registerError(ids.address, "Please enter your main address.");
    }

    if (!addressDetails) {
      registerError(
        ids.details,
        "Please add a detail like room, unit, or landmark.",
      );
    }

    if (!department) {
      registerError(ids.dept, "Please enter your department or organization.");
    }

    if (firstInvalidInput instanceof HTMLElement) {
      firstInvalidInput.focus();
      return null;
    }

    return {
      entry: normalizeAddressEntry({
        name,
        phone_number: phone,
        address_line: addressLine,
        address_details: addressDetails,
        department,
        customer_type: customerType || "Student",
        is_default: setDefault,
      }),
    };
  };

  const applyServerAddressErrors = (mode, errors, fallbackMessage) => {
    const ids = getAddressFieldIds(mode);
    let didSetFieldError = false;

    const pushFieldError = (fieldId, message) => {
      if (!message) return;
      setCheckoutFieldError(fieldId, message);
      didSetFieldError = true;
    };

    if (errors && typeof errors === "object") {
      pushFieldError(ids.name, errors.name?.[0]);
      pushFieldError(ids.phone, errors.phone_number?.[0]);
      pushFieldError(ids.address, errors.address_line?.[0]);
      pushFieldError(ids.details, errors.address_details?.[0]);
      pushFieldError(ids.dept, errors.department?.[0]);
      pushFieldError(ids.dept, errors.customer_type?.[0]);
    }

    if (!didSetFieldError && fallbackMessage) {
      pushFieldError(ids.address, fallbackMessage);
    }
  };

  const syncProfileFromAddress = async (addressEntry) => {
    const token =
      customerSession.token || localStorage.getItem("customer_token") || "";
    if (!token) {
      return {
        ok: false,
        message: "Login session not found. Please sign in again.",
      };
    }

    const payload = {
      name: addressEntry?.name || customerSession.userInfo?.name || null,
      phone_number: addressEntry?.phone_number || null,
      address_line: addressEntry?.address_line || null,
      address_details: addressEntry?.address_details || null,
      department: addressEntry?.department || null,
      customer_type: addressEntry?.customer_type || "Student",
    };

    try {
      const response = await fetchWithTimeout(
        `${API_BASE_URL}/customer/profile`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        },
      );

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          ok: false,
          message: result?.message || "Unable to save your details right now.",
          errors: result?.errors || null,
        };
      }

      customerCheckoutProfile = result?.data || {
        ...(customerCheckoutProfile || {}),
        ...payload,
      };

      if (customerSession.userInfo && customerCheckoutProfile?.name) {
        customerSession.userInfo.name = customerCheckoutProfile.name;
        try {
          localStorage.setItem(
            "customer_info",
            JSON.stringify(customerSession.userInfo),
          );
        } catch {
          // Ignore storage write issues.
        }
      }

      return {
        ok: true,
      };
    } catch (error) {
      return {
        ok: false,
        message: error?.message || "Unable to save your details right now.",
      };
    }
  };

  const setSelectedAddress = (addressId, markAsDefault = false) => {
    const id = String(addressId || "");
    if (!id) return;

    selectedCheckoutAddressId = id;
    if (!markAsDefault) return;

    customerAddressBook = customerAddressBook.map((entry) => ({
      ...entry,
      is_default: String(entry.id) === id,
    }));
  };

  const removeAddressesByIds = async (addressIds, message, title) => {
    const idsToRemove = Array.from(
      new Set((addressIds || []).map((id) => String(id || "")).filter(Boolean)),
    );
    if (!idsToRemove.length) return;

    const confirmed = await showCustomerPopup(message, {
      title,
      isConfirm: true,
      okText: "Delete",
      cancelText: "Cancel",
    });

    if (!confirmed) return;

    customerAddressBook = customerAddressBook.filter(
      (entry) => !idsToRemove.includes(String(entry.id)),
    );
    addressDeleteSelection.clear();
    ensureSingleDefaultAddress();
    saveAddressBookToStorage();
    renderAddressList();
    renderCheckoutAddress();
    applyAddressToForm(
      "edit",
      getSelectedCheckoutAddress() || customerCheckoutProfile,
    );
    applyAddressToForm(
      "add",
      getSelectedCheckoutAddress() || customerCheckoutProfile,
    );

    if (!customerAddressBook.length) {
      isAddressEditMode = false;
    }

    const profileSyncResult = await syncProfileFromAddress(
      getSelectedCheckoutAddress(),
    );
    if (profileSyncResult.ok) {
      emitCustomerOrdersUpdated({ type: "profile-updated" });
    }

    renderAddressList();
  };

  const setAddressEditMode = (nextMode) => {
    isAddressEditMode = Boolean(nextMode) && customerAddressBook.length > 0;
    addressDeleteSelection.clear();
    renderAddressList();
  };

  const openEditAddressModal = (addressId) => {
    const target = customerAddressBook.find(
      (entry) => String(entry.id) === String(addressId),
    );
    if (!target || !editInfoModal) return;

    editingCheckoutAddressId = String(target.id);
    clearCheckoutFormErrors("edit");
    applyAddressToForm("edit", target);
    editInfoModal.classList.add("show-modal");
  };

  const openAddAddressModal = () => {
    if (!addInfoModal) return;

    const selected = getSelectedCheckoutAddress() || customerCheckoutProfile;
    clearCheckoutFormErrors("add");
    applyAddressToForm("add", {
      ...(selected || {}),
      address_line: "",
      address_details: "",
      is_default: customerAddressBook.length === 0,
    });

    addInfoModal.classList.add("show-modal");
  };

  const saveAddressFromModal = async (mode) => {
    const validated = validateAddressForm(mode);
    if (!validated) return false;

    const isAddMode = mode === "add";
    const confirmMessage = isAddMode
      ? "Save this new address?"
      : "Update this address?";

    const confirmed = await showCustomerPopup(confirmMessage, {
      title: isAddMode ? "Confirm Save" : "Confirm Update",
      isConfirm: true,
      okText: isAddMode ? "Save" : "Update",
      cancelText: "Cancel",
    });

    if (!confirmed) return false;

    if (isAddMode) {
      const nextEntry = {
        ...validated.entry,
        id: createAddressId(),
        is_default:
          customerAddressBook.length === 0 ||
          Boolean(validated.entry.is_default),
      };

      if (nextEntry.is_default) {
        customerAddressBook = customerAddressBook.map((entry) => ({
          ...entry,
          is_default: false,
        }));
      }

      customerAddressBook.push(nextEntry);
      setSelectedAddress(nextEntry.id, nextEntry.is_default);
    } else {
      if (!editingCheckoutAddressId) {
        applyServerAddressErrors(
          "edit",
          null,
          "Choose an address first, then try again.",
        );
        return false;
      }

      customerAddressBook = customerAddressBook.map((entry) => {
        if (String(entry.id) !== String(editingCheckoutAddressId)) {
          return validated.entry.is_default
            ? { ...entry, is_default: false }
            : entry;
        }

        return {
          ...entry,
          ...validated.entry,
          id: entry.id,
        };
      });

      setSelectedAddress(
        editingCheckoutAddressId,
        Boolean(validated.entry.is_default),
      );
    }

    ensureSingleDefaultAddress();
    saveAddressBookToStorage();
    renderAddressList();
    renderCheckoutAddress();
    applyAddressToForm(
      "edit",
      getSelectedCheckoutAddress() || customerCheckoutProfile,
    );
    applyAddressToForm(
      "add",
      getSelectedCheckoutAddress() || customerCheckoutProfile,
    );

    const syncResult = await syncProfileFromAddress(
      getSelectedCheckoutAddress(),
    );
    if (!syncResult.ok) {
      applyServerAddressErrors(
        mode,
        syncResult.errors,
        syncResult.message || "Unable to save your details.",
      );
      return false;
    }

    emitCustomerOrdersUpdated({ type: "profile-updated" });
    return true;
  };

  const seedAddressBookFromProfile = (profile) => {
    const hasSeedData = Boolean(
      profile?.name ||
      profile?.phone_number ||
      profile?.address_line ||
      profile?.address_details ||
      profile?.department,
    );

    if (!hasSeedData || customerAddressBook.length) return;

    const seeded = normalizeAddressEntry({
      id: createAddressId(),
      name: profile?.name || customerSession.userInfo?.name || "",
      phone_number: profile?.phone_number || "",
      address_line: profile?.address_line || "",
      address_details: profile?.address_details || "",
      department: profile?.department || "",
      customer_type: profile?.customer_type || "Student",
      is_default: true,
    });

    customerAddressBook = [seeded];
    selectedCheckoutAddressId = seeded.id;
    saveAddressBookToStorage();
  };

  const fetchCustomerCheckoutProfile = async () => {
    const token =
      customerSession.token || localStorage.getItem("customer_token") || "";
    if (!token) return;

    try {
      const response = await fetchWithTimeout(
        `${API_BASE_URL}/customer/profile`,
        {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
          },
        },
      );

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        return;
      }

      customerCheckoutProfile = payload?.data || null;
      seedAddressBookFromProfile(customerCheckoutProfile);
      ensureSingleDefaultAddress();
      renderAddressList();
      renderCheckoutAddress();
      applyAddressToForm(
        "edit",
        getSelectedCheckoutAddress() || customerCheckoutProfile,
      );
      applyAddressToForm(
        "add",
        getSelectedCheckoutAddress() || customerCheckoutProfile,
      );
    } catch {
      // Keep UI usable with local/session fallback values.
    }
  };

  [inpPhone, addInpPhone].forEach((phoneInput) => {
    phoneInput?.addEventListener("input", () => {
      phoneInput.value = normalizePhoneDigits(phoneInput.value);
    });
  });

  if (openAddAddressBtn && addInfoModal) {
    openAddAddressBtn.addEventListener("click", () => {
      openAddAddressModal();
    });
  }

  if (addressEditModeBtn) {
    addressEditModeBtn.addEventListener("click", () => {
      setAddressEditMode(!isAddressEditMode);
    });
  }

  if (selectAllAddressBtn) {
    selectAllAddressBtn.addEventListener("change", () => {
      addressDeleteSelection.clear();
      if (selectAllAddressBtn.checked) {
        customerAddressBook.forEach((entry) => {
          addressDeleteSelection.add(String(entry.id));
        });
      }
      renderAddressList();
    });
  }

  if (deleteSelectedAddressBtn) {
    deleteSelectedAddressBtn.addEventListener("click", () => {
      void removeAddressesByIds(
        Array.from(addressDeleteSelection),
        "Delete selected address details?",
        "Delete Selected",
      );
    });
  }

  if (deleteAllAddressBtn) {
    deleteAllAddressBtn.addEventListener("click", () => {
      void removeAddressesByIds(
        customerAddressBook.map((entry) => entry.id),
        "Delete all saved addresses?",
        "Delete All",
      );
    });
  }

  if (addressList) {
    addressList.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      const deleteBtn = target.closest("[data-address-delete]");
      if (deleteBtn) {
        const addressId = String(
          deleteBtn.getAttribute("data-address-delete") || "",
        );
        void removeAddressesByIds(
          [addressId],
          "Delete this saved address?",
          "Delete Address",
        );
        return;
      }

      const checkInput = target.closest(".address-edit-check");
      if (checkInput instanceof HTMLInputElement) {
        const checkId = String(
          checkInput.getAttribute("data-address-check") || "",
        );
        if (!checkId) return;

        if (checkInput.checked) {
          addressDeleteSelection.add(checkId);
        } else {
          addressDeleteSelection.delete(checkId);
        }
        syncAddressEditUi();
        return;
      }

      const editBtn = target.closest("[data-address-edit]");
      if (editBtn) {
        const editId = String(editBtn.getAttribute("data-address-edit") || "");
        openEditAddressModal(editId);
        return;
      }

      const item = target.closest(".address-item");
      if (!(item instanceof HTMLElement)) return;
      const addressId = String(item.getAttribute("data-address-id") || "");
      if (!addressId) return;

      if (isAddressEditMode) {
        if (addressDeleteSelection.has(addressId)) {
          addressDeleteSelection.delete(addressId);
        } else {
          addressDeleteSelection.add(addressId);
        }
        renderAddressList();
        return;
      }

      setSelectedAddress(addressId, true);
      ensureSingleDefaultAddress();
      saveAddressBookToStorage();
      renderAddressList();
      renderCheckoutAddress();
      addressSelectionModal?.classList.remove("show-modal");

      void (async () => {
        const syncResult = await syncProfileFromAddress(
          getSelectedCheckoutAddress(),
        );
        if (syncResult.ok) {
          emitCustomerOrdersUpdated({ type: "profile-updated" });
        }
      })();
    });
  }

  if (backToAddressBtn) {
    backToAddressBtn.addEventListener("click", () => {
      editInfoModal?.classList.remove("show-modal");
    });
  }

  if (backToAddressFromAddBtn && addInfoModal) {
    backToAddressFromAddBtn.addEventListener("click", () => {
      addInfoModal.classList.remove("show-modal");
    });
  }

  if (saveInfoBtn) {
    saveInfoBtn.addEventListener("click", async () => {
      const saved = await saveAddressFromModal("edit");
      if (!saved) return;
      editInfoModal?.classList.remove("show-modal");
    });
  }

  if (saveNewInfoBtn && addInfoModal) {
    saveNewInfoBtn.addEventListener("click", async () => {
      const saved = await saveAddressFromModal("add");
      if (!saved) return;
      addInfoModal.classList.remove("show-modal");
      setAddressEditMode(false);
    });
  }

  loadAddressBookFromStorage();
  renderAddressList();
  renderCheckoutAddress();
  applyAddressToForm(
    "edit",
    getSelectedCheckoutAddress() || customerCheckoutProfile,
  );
  applyAddressToForm(
    "add",
    getSelectedCheckoutAddress() || customerCheckoutProfile,
  );
  if (!isGuestUser) {
    void fetchCustomerCheckoutProfile();
  }

  // Submit Order logic
  const submitOrderBtn = document.getElementById("submitOrderBtn");
  if (submitOrderBtn) {
    submitOrderBtn.addEventListener("click", async function (event) {
      event?.preventDefault();
      const terms = document.getElementById("orderTerms");
      if (terms && !terms.checked) {
        await showCustomerPopup(
          "Please check the terms and payment agreement box first.",
          {
            title: "Validation",
          },
        );
        return;
      }

      const paymentSelect = document.querySelector(
        "#checkoutModal .payment-select",
      );
      const paymentMethod = String(paymentSelect?.value || "").trim();
      if (
        !paymentMethod ||
        paymentMethod.toLowerCase().includes("choose payment method")
      ) {
        await showCustomerPopup("Please choose a payment method first.", {
          title: "Validation",
        });
        return;
      }

      const selectedAddress = getSelectedCheckoutAddress();
      if (!selectedAddress) {
        await showCustomerPopup(
          "Please add and select your delivery details first.",
          {
            title: "Address Required",
          },
        );
        return;
      }

      const useCartCheckout =
        currentCheckoutMode === "cart" &&
        Array.isArray(currentCheckoutItems) &&
        currentCheckoutItems.length > 0;

      const quantity = useCartCheckout
        ? currentCheckoutItems.reduce(
            (sum, item) =>
              sum +
              Math.max(1, Number.parseInt(item?.quantity || "1", 10) || 1),
            0,
          )
        : Math.max(1, Number.parseInt(inputQty?.value || "1", 10) || 1);

      const totalText =
        checkoutGrandTotal?.innerText || checkoutPrice?.innerText || "₱0.00";
      const parsedDisplayedTotal = Number.isFinite(parsePrice(totalText))
        ? parsePrice(totalText)
        : 0;
      const totalAmount = useCartCheckout
        ? currentCheckoutItems.reduce((sum, item) => {
            const qty = Math.max(
              1,
              Number.parseInt(item?.quantity || "1", 10) || 1,
            );
            const lineTotal = Number(item?.line_total);
            if (Number.isFinite(lineTotal) && lineTotal >= 0) {
              return sum + lineTotal;
            }
            const unitPrice = Number(item?.unit_price || 0);
            return sum + (Number.isFinite(unitPrice) ? unitPrice * qty : 0);
          }, 0)
        : parsedDisplayedTotal;

      const originalText = this.innerText;
      this.disabled = true;
      this.innerText = "Processing...";

      try {
        const token =
          customerSession.token || localStorage.getItem("customer_token") || "";
        if (!token) {
          throw new Error("Login session not found. Please sign in again.");
        }

        const contactNumber = String(
          selectedAddress.phone_number || "",
        ).replace(/\D/g, "");
        const orderNotes = [
          selectedAddress.address_line,
          selectedAddress.address_details,
          selectedAddress.department
            ? `Department: ${selectedAddress.department}`
            : "",
          selectedAddress.customer_type
            ? `Role: ${selectedAddress.customer_type}`
            : "",
        ]
          .filter(Boolean)
          .join(" | ");

        const customerName =
          selectedAddress.name ||
          customerCheckoutProfile?.name ||
          customerSession.userInfo?.name ||
          customerSession.userInfo?.username ||
          customerSession.userInfo?.email ||
          "Customer";

        const customerContact = contactNumber
          ? `+63${contactNumber}`
          : customerSession.userInfo?.email || "N/A";

        const basePayload = {
          payment_method: paymentMethod,
          customer_name: customerName,
          customer_contact: customerContact,
          notes: orderNotes,
          location_name:
            selectedAddress.address_line ||
            customerCheckoutProfile?.address_line ||
            null,
          courier_name: "J&T Express",
        };

        let payload;

        if (useCartCheckout) {
          const items = currentCheckoutItems.map((item) => {
            const lineQty = Math.max(
              1,
              Number.parseInt(item?.quantity || "1", 10) || 1,
            );
            const lineUnitPrice = Number.isFinite(Number(item?.unit_price))
              ? Number(item.unit_price)
              : 0;
            const lineTotal = Number.isFinite(Number(item?.line_total))
              ? Number(item.line_total)
              : lineUnitPrice * lineQty;

            return {
              product_id: item?.product_id ?? null,
              product_name: String(item?.product_name || "Custom Order"),
              product_image: String(
                item?.product_image || "/images/FMRC Logo.png",
              ),
              quantity: lineQty,
              unit_price: lineUnitPrice,
              line_total: lineTotal,
            };
          });

          const firstItem = items[0] || {};
          const summaryName =
            items.length > 1
              ? `${firstItem.product_name || "Custom Order"} (+${items.length - 1} more)`
              : firstItem.product_name || "Custom Order";

          payload = {
            ...basePayload,
            product_id: firstItem.product_id ?? null,
            product_name: summaryName,
            product_image:
              firstItem.product_image ||
              checkoutImg?.src ||
              "/images/FMRC Logo.png",
            quantity,
            unit_price:
              quantity > 0 ? Number((totalAmount / quantity).toFixed(2)) : 0,
            total_amount: totalAmount,
            items,
          };
        } else {
          payload = {
            ...basePayload,
            product_id: currentProductId,
            product_name: checkoutTitle?.innerText?.trim() || "Custom Order",
            product_image: checkoutImg?.src || "/images/FMRC Logo.png",
            quantity,
            unit_price: Number.isFinite(currentItemPrice)
              ? Number(currentItemPrice)
              : 0,
            total_amount: totalAmount,
          };
        }

        const response = await fetchWithTimeout(
          `${API_BASE_URL}/orders`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
          },
          25000,
        ); // 25s timeout since SMTP email might take a few seconds on Windows local server

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            data.message || "Unable to place order at the moment.",
          );
        }

        const orderNoRaw = String(
          data?.data?.order_no || data?.order_no || "",
        ).trim();
        const orderNoDisplay = String(
          data?.data?.order_no_display ||
            data?.order_no_display ||
            (orderNoRaw ? `#${orderNoRaw}` : ""),
        ).trim();

        // ── Step 1: Persist order-success info so products.js can show the
        //   success modal AFTER the product grid finishes reloading.
        //   This prevents the refresh cycle from dismissing the modal.
        try {
          sessionStorage.setItem(
            "fmrc_pending_order_success",
            JSON.stringify({
              orderNo: orderNoDisplay || orderNoRaw || "",
              ts: Date.now(),
            }),
          );
        } catch {
          /* ignore storage errors (e.g. private browsing) */
        }

        // ── Step 2: Clear cart items & close the checkout modal ─────────────────
        if (useCartCheckout && cartItemsContainer) {
          const checkedCartInputs = cartItemsContainer.querySelectorAll(
            ".cart-item-check:checked",
          );
          checkedCartInputs.forEach((checkedInput) => {
            checkedInput.closest(".cart-item-card")?.remove();
          });
          updateCartTotals();
          await persistCartItems();
        }

        currentCheckoutMode = "single";
        currentCheckoutItems = [];
        setCheckoutQtyLock(false);

        checkoutModal.classList.remove("show-modal");
        document.body.style.overflow = "";

        // Re-enable the submit button right away
        this.disabled = false;
        this.innerText = originalText;

        // ── Step 3: Emit the real-time update immediately ────────────────────────
        //   products.js will catch this, reload the product grid, and THEN show
        //   the success modal (after the grid has fully refreshed).
        emitCustomerOrdersUpdated({
          type: "created",
          orderId: data?.data?.id || null,
        });

        return; // success path done; finally block still runs but is harmless
      } catch (error) {
        await showCustomerPopup(
          error?.message || "Unable to place order. Please try again.",
          {
            title: "Order Failed",
          },
        );
      } finally {
        this.disabled = false;
        this.innerText = originalText;
      }
    });
  }

  // =========================================
  // SHOPPING CART & FLY-ANIMATION LOGIC
  // =========================================
  const cartIconTrigger = document.querySelector(".cart-icon-container");
  const cartModal = document.getElementById("cartModal");
  const closeCartBtn = document.getElementById("closeCartBtn");
  const cartItemsContainer = document.getElementById("cartItemsContainer");
  const emptyCartMessage = document.getElementById("emptyCartMessage");
  const headerCartBadge = document.querySelector(".cart-badge");
  const cartHeaderCount = document.getElementById("cartHeaderCount");

  const emitCartRealtimeUpdate = (detail = {}) => {
    const payload = {
      source: "customer-cart",
      timestamp: Date.now(),
      ...detail,
    };

    try {
      localStorage.setItem(CART_STORAGE_SIGNAL_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage write issues.
    }
  };

  const createCartItemCard = ({
    product_id,
    title,
    image,
    unitPrice,
    quantity = 1,
    checked = true,
  }) => {
    const rawTitle = String(title || "Product");
    const safeTitle = escapeCustomerHtml(rawTitle);
    const safeImage = String(image || "/images/FMRC Logo.png");
    const numericPrice = Number.isFinite(Number(unitPrice))
      ? Number(unitPrice)
      : 0;
    const qty = Math.max(1, Number.parseInt(String(quantity || "1"), 10) || 1);
    const pid = product_id != null ? String(product_id) : "";

    const cartItem = document.createElement("div");
    cartItem.className = "cart-item-card";
    cartItem.dataset.productName = rawTitle;
    cartItem.dataset.unitPrice = String(numericPrice);
    if (pid) cartItem.dataset.productId = pid;
    cartItem.innerHTML = `
      <label class="cart-checkbox-container">
        <input type="checkbox" class="cart-item-check" ${checked ? "checked" : ""}>
        <span class="cart-checkmark"></span>
      </label>
      <div class="cart-item-img"><img src="${safeImage}" alt="Product"></div>
      <div class="cart-item-details">
        <h4>${safeTitle}</h4>
        <div class="cart-item-bottom">
          <span class="c-price" data-price="${numericPrice}">${formatPrice(numericPrice)}</span>
          <div class="qty-selector">
            <button class="qty-btn c-minus-btn">-</button>
            <input type="number" class="c-qty-input" value="${qty}" min="1" max="99" readonly>
            <button class="qty-btn c-plus-btn">+</button>
          </div>
        </div>
      </div>
    `;

    return cartItem;
  };

  const collectCartItemsFromDom = () => {
    if (!cartItemsContainer) return [];

    return Array.from(
      cartItemsContainer.querySelectorAll(".cart-item-card"),
    ).map((item) => {
      const title = item.querySelector("h4")?.innerText || "Product";
      const image =
        item.querySelector("img")?.getAttribute("src") ||
        "/images/FMRC Logo.png";
      const unitPrice = Number(
        item.querySelector(".c-price")?.dataset.price || 0,
      );
      const quantity = Math.max(
        1,
        Number.parseInt(item.querySelector(".c-qty-input")?.value || "1", 10) ||
          1,
      );
      const checked = Boolean(item.querySelector(".cart-item-check")?.checked);
      const product_id = item.dataset.productId
        ? Number(item.dataset.productId)
        : null;

      return {
        product_id,
        title,
        image,
        unitPrice,
        quantity,
        checked,
      };
    });
  };

  // Debounce timer for server sync (prevents rapid-fire API calls)
  let _cartSyncTimer = null;

  const persistCartItems = async () => {
    const items = collectCartItemsFromDom();
    const storageKey = customerSession.isAuthenticated
      ? `${CART_STORAGE_KEY}_${customerSession.userInfo.id}`
      : CART_STORAGE_KEY;

    // Always save full data (including images) to localStorage immediately
    try {
      localStorage.setItem(storageKey, JSON.stringify(items));
    } catch {
      // Ignore storage write issues.
    }

    // Sync to server with debounce (strip large image data to avoid 500 errors)
    if (customerSession.isAuthenticated) {
      if (_cartSyncTimer) clearTimeout(_cartSyncTimer);
      _cartSyncTimer = setTimeout(async () => {
        _cartSyncTimer = null;
        try {
          // Strip base64 data from images before sending to server.
          // Keep only URL references (non-base64) to avoid payload size issues.
          const serverItems = items.map((item) => ({
            ...item,
            image:
              item.image && !item.image.startsWith("data:") ? item.image : null,
          }));

          await fetchWithTimeout(`${API_BASE_URL}/customer/cart/sync`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              Authorization: `Bearer ${customerSession.token}`,
            },
            body: JSON.stringify({ items: serverItems }),
          });
        } catch (err) {
          // Silently fail — items are safely stored in localStorage
          console.error("Failed to sync cart to server", err);
        }
      }, 800);
    }

    emitCartRealtimeUpdate({ type: "updated" });
  };

  const restoreCartItems = async () => {
    if (!cartItemsContainer) return;

    let savedItems = [];
    const storageKey = customerSession.isAuthenticated
      ? `${CART_STORAGE_KEY}_${customerSession.userInfo.id}`
      : CART_STORAGE_KEY;

    // Helper to read from localStorage
    const readLocalStorage = () => {
      try {
        const raw = localStorage.getItem(storageKey);
        const parsed = JSON.parse(raw || "[]");
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    };

    if (customerSession.isAuthenticated) {
      const localItems = readLocalStorage();

      try {
        const res = await fetchWithTimeout(`${API_BASE_URL}/customer/cart`, {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${customerSession.token}`,
          },
        });
        if (res.ok) {
          const payload = await res.json();
          const apiItems = Array.isArray(payload?.data) ? payload.data : [];

          // If API returns items, use them and sync localStorage
          if (apiItems.length > 0) {
            savedItems = apiItems;
            const newCartString = JSON.stringify(savedItems);
            if (localStorage.getItem(storageKey) !== newCartString) {
              localStorage.setItem(storageKey, newCartString);
            }
          } else if (localItems.length > 0) {
            // API is empty but localStorage has items — keep localStorage
            // (this happens when server sync previously failed)
            savedItems = localItems;
          } else {
            savedItems = [];
          }
        } else {
          throw new Error("Failed to fetch cart");
        }
      } catch (err) {
        console.error("Failed to fetch cart from server", err);
        // On any error, fall back to localStorage
        savedItems = localItems;
      }
    } else {
      savedItems = readLocalStorage();
    }

    cartItemsContainer
      .querySelectorAll(".cart-item-card")
      .forEach((item) => item.remove());

    savedItems.forEach((entry) => {
      cartItemsContainer.appendChild(createCartItemCard(entry));
    });

    if (typeof updateCartTotals === "function") {
      updateCartTotals();
    }
  };

  // Open & Close Cart Modal
  if (cartIconTrigger && cartModal) {
    cartIconTrigger.addEventListener("click", (e) => {
      e.preventDefault();
      if (!requireCustomerAuth("view and manage your cart")) return;
      cartModal.classList.add("show-modal");
      document.body.style.overflow = "hidden";
    });
  }
  if (closeCartBtn) {
    closeCartBtn.addEventListener("click", () => {
      cartModal.classList.remove("show-modal");
      document.body.style.overflow = ""; // Resets to CSS
    });
  }

  // Animation: Fly product image to top-right cart icon
  function flyToCart(imgElement, cartIconElement) {
    const imgRect = imgElement.getBoundingClientRect();
    const cartRect = cartIconElement.getBoundingClientRect();

    const clone = imgElement.cloneNode(true);
    clone.style.position = "fixed";
    clone.style.zIndex = "99999";
    clone.style.left = `${imgRect.left}px`;
    clone.style.top = `${imgRect.top}px`;
    clone.style.width = `${imgRect.width}px`;
    clone.style.height = `${imgRect.height}px`;
    clone.style.borderRadius = "6px";
    clone.style.transition =
      "transform 1.2s cubic-bezier(0.1, 0.7, 0.2, 1), opacity 1.2s ease";
    clone.style.pointerEvents = "none";

    document.body.appendChild(clone);
    clone.getBoundingClientRect(); // Trigger reflow

    const translateX =
      cartRect.left - imgRect.left + cartRect.width / 2 - imgRect.width / 2;
    const translateY =
      cartRect.top - imgRect.top + cartRect.height / 2 - imgRect.height / 2;

    clone.style.transform = `translate(${translateX}px, ${translateY}px) scale(0.1)`;
    clone.style.opacity = "0.3";

    setTimeout(() => clone.remove(), 1200);
  }

  // Update Cart Totals and Counters
  function updateCartTotals() {
    const items = cartItemsContainer?.querySelectorAll(".cart-item-card") || [];
    let total = 0;
    let count = 0;

    items.forEach((item) => {
      const checkbox = item.querySelector(".cart-item-check");
      const qtyInput = item.querySelector(".c-qty-input");
      const priceElem = item.querySelector(".c-price");

      const qty = parseInt(qtyInput.value);
      const price = parseFloat(priceElem.dataset.price);

      if (checkbox.checked) total += price * qty;
      count += qty; // Total items in cart regardless of checked state
    });

    const cartTotalPriceEl = document.getElementById("cartTotalPrice");
    if (cartTotalPriceEl) {
      cartTotalPriceEl.innerText = formatPrice(total);
    }
    if (cartHeaderCount) cartHeaderCount.innerText = String(count);
    if (headerCartBadge) {
      if (count > 0) {
        headerCartBadge.innerText = String(count);
        headerCartBadge.style.display = "flex";
      } else {
        headerCartBadge.innerText = "";
        headerCartBadge.style.display = "none";
      }
    }

    const allChecked =
      items.length > 0 &&
      Array.from(items).every(
        (i) => i.querySelector(".cart-item-check").checked,
      );
    const selectAll = document.getElementById("selectAllCartBtn");
    if (selectAll) {
      selectAll.checked = allChecked;
    }

    if (items.length === 0 && emptyCartMessage)
      emptyCartMessage.style.display = "block";
  }

  // Add To Cart Button Listener
  const addToCartBtns = document.querySelectorAll(
    ".btn-add-cart:not(.disabled)",
  );
  addToCartBtns.forEach((btn) => {
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      if (!requireCustomerAuth("add products to cart")) return;

      const card = e.target.closest(".shop-card");
      if (!card) return;

      const imgElement = card.querySelector(".product-img-wrapper img");
      const title = card.querySelector(".product-name").innerText;
      const priceStr = card.querySelector(".product-price").innerText;

      flyToCart(imgElement, cartIconTrigger); // Trigger the slow fly animation

      const unitPrice = parsePrice(priceStr);
      const existingItem = Array.from(
        cartItemsContainer.querySelectorAll(".cart-item-card"),
      ).find(
        (item) =>
          item.dataset.productName === title &&
          Number(item.dataset.unitPrice || 0) === unitPrice,
      );

      if (existingItem) {
        const qtyInput = existingItem.querySelector(".c-qty-input");
        if (qtyInput) {
          qtyInput.value = String(
            Math.max(1, Number.parseInt(qtyInput.value || "1", 10) + 1),
          );
        }
        const checkbox = existingItem.querySelector(".cart-item-check");
        if (checkbox) checkbox.checked = true;
      } else {
        if (emptyCartMessage) emptyCartMessage.style.display = "none";
        const cartItem = createCartItemCard({
          title,
          image: imgElement.src,
          unitPrice,
          quantity: 1,
          checked: true,
        });
        cartItemsContainer.appendChild(cartItem);
      }

      updateCartTotals();
      persistCartItems();
    });
  });

  // Dynamically rendered products add-to-cart listener
  document.addEventListener("product:add-to-cart", (e) => {
    const product = e.detail;
    if (!product) return;
    if (!requireCustomerAuth("add products to cart")) return;

    const title = String(product.name || "");
    const unitPrice = Number.isFinite(Number(product.price))
      ? Number(product.price)
      : 0;
    const imageSrc = product.image_data || "/images/FMRC Logo.png";

    // Trigger animation if card exists
    const card = document
      .querySelector(`.action-btn[data-product-id="${product.id}"]`)
      ?.closest(".shop-card");
    const imgElement = card
      ? card.querySelector(".product-img-wrapper img")
      : null;
    if (imgElement && typeof flyToCart === "function" && cartIconTrigger) {
      flyToCart(imgElement, cartIconTrigger);
    }

    const existingItem = Array.from(
      cartItemsContainer?.querySelectorAll(".cart-item-card") || [],
    ).find(
      (item) =>
        item.dataset.productName === title &&
        Number(item.dataset.unitPrice || 0) === unitPrice,
    );

    if (existingItem) {
      const qtyInput = existingItem.querySelector(".c-qty-input");
      if (qtyInput) {
        qtyInput.value = String(
          Math.max(1, Number.parseInt(qtyInput.value || "1", 10) + 1),
        );
      }
      const checkbox = existingItem.querySelector(".cart-item-check");
      if (checkbox) checkbox.checked = true;
    } else {
      if (emptyCartMessage) emptyCartMessage.style.display = "none";
      const cartItem = createCartItemCard({
        product_id: product.id || null,
        title,
        image: imageSrc,
        unitPrice,
        quantity: 1,
        checked: true,
      });
      if (cartItemsContainer) cartItemsContainer.appendChild(cartItem);
    }

    updateCartTotals();
    persistCartItems();
  });

  // Cart DOM Listeners (Delegation for +/- and checkboxes)
  if (cartItemsContainer) {
    cartItemsContainer.addEventListener("click", (e) => {
      if (e.target.classList.contains("c-minus-btn")) {
        e.preventDefault();
        const input = e.target.nextElementSibling;
        if (parseInt(input.value) > 1) {
          input.value = parseInt(input.value) - 1;
          updateCartTotals();
          persistCartItems();
        }
      } else if (e.target.classList.contains("c-plus-btn")) {
        e.preventDefault();
        const input = e.target.previousElementSibling;
        input.value = parseInt(input.value) + 1;
        updateCartTotals();
        persistCartItems();
      } else if (e.target.classList.contains("c-delete-btn")) {
        e.preventDefault();
        e.target.closest(".cart-item-card")?.remove();
        updateCartTotals();
        persistCartItems();
      } else if (e.target.classList.contains("cart-item-check")) {
        updateCartTotals();
        persistCartItems();
      }
    });
  }

  // Select All Logic
  const selectAllCartBtn = document.getElementById("selectAllCartBtn");
  if (selectAllCartBtn) {
    selectAllCartBtn.addEventListener("change", (e) => {
      const checks = cartItemsContainer.querySelectorAll(".cart-item-check");
      checks.forEach((c) => (c.checked = e.target.checked));
      updateCartTotals();
      persistCartItems();
    });
  }

  // Edit / Remove State Logic
  const cartEditBtn = document.getElementById("cartEditBtn");
  const cartCheckoutView = document.getElementById("cartCheckoutView");
  const cartDeleteView = document.getElementById("cartDeleteView");
  let isCartEditMode = false;

  if (cartEditBtn) {
    cartEditBtn.addEventListener("click", () => {
      isCartEditMode = !isCartEditMode;
      cartEditBtn.innerText = isCartEditMode ? "Done" : "Edit";
      cartCheckoutView.style.display = isCartEditMode ? "none" : "flex";
      cartDeleteView.style.display = isCartEditMode ? "flex" : "none";
    });
  }

  // Delete Selected Items
  const cartDeleteBtn = document.getElementById("cartDeleteBtn");
  if (cartDeleteBtn) {
    cartDeleteBtn.addEventListener("click", async () => {
      const selectedItems = Array.from(
        cartItemsContainer.querySelectorAll(".cart-item-card"),
      ).filter((item) => item.querySelector(".cart-item-check")?.checked);

      if (!selectedItems.length) {
        await showCustomerPopup("Select at least one item to remove.", {
          title: "No Selection",
        });
        return;
      }

      const shouldDelete = await showCustomerPopup(
        "Remove selected item(s) from your cart?",
        {
          title: "Confirm Removal",
          isConfirm: true,
          okText: "Remove",
          cancelText: "Cancel",
        },
      );

      if (!shouldDelete) return;

      selectedItems.forEach((item) => item.remove());
      updateCartTotals();
      persistCartItems();
    });
  }

  // Connect Cart Address to Address Selection Modal
  const cartAddressTrigger = document.getElementById("cartAddressTrigger");
  if (cartAddressTrigger && addressSelectionModal) {
    cartAddressTrigger.addEventListener("click", () => {
      addressSelectionModal.classList.add("show-modal");
    });
  }

  // Route Cart Checkout directly to Main Checkout
  const cartCheckoutSubmitBtn = document.getElementById(
    "cartCheckoutSubmitBtn",
  );
  if (cartCheckoutSubmitBtn) {
    cartCheckoutSubmitBtn.addEventListener("click", async () => {
      if (!requireCustomerAuth("buy products")) return;
      if (!isGuestUser) {
        void fetchCustomerCheckoutProfile();
      }

      const checkedInputs = Array.from(
        cartItemsContainer?.querySelectorAll(".cart-item-check:checked") || [],
      );
      if (!checkedInputs.length) {
        void showCustomerPopup("Please select an item to checkout.", {
          title: "Validation",
        });
        return;
      }

      const selectedItems = checkedInputs
        .map((inputEl) => {
          const card = inputEl.closest(".cart-item-card");
          if (!card) return null;

          const qtyInput = card.querySelector(".c-qty-input");
          const priceEl = card.querySelector(".c-price");
          const title = card.querySelector("h4")?.innerText || "Custom Order";
          const image =
            card.querySelector("img")?.getAttribute("src") ||
            "/images/FMRC Logo.png";
          const qty = Math.max(1, parseInt(qtyInput?.value || "1", 10) || 1);
          const price = parseFloat(priceEl?.dataset?.price || "0");

          return {
            product_id: card.dataset.productId
              ? Number(card.dataset.productId)
              : null,
            product_name: title,
            product_image: image,
            quantity: qty,
            unit_price: Number.isFinite(price) ? price : 0,
          };
        })
        .filter(Boolean);

      if (!selectedItems.length) {
        void showCustomerPopup("Please select at least one valid cart item.", {
          title: "Validation",
        });
        return;
      }

      const productIds = selectedItems
        .map((item) => Number(item.product_id || 0))
        .filter((id) => Number.isFinite(id) && id > 0);

      const liveStocks = new Map();
      if (productIds.length > 0) {
        try {
          const stockRes = await fetchWithTimeout(`${API_BASE_URL}/products`, {
            headers: {
              Accept: "application/json",
            },
          });

          if (!stockRes.ok) {
            throw new Error(
              "Unable to refresh product stock. Please try again.",
            );
          }

          const stockPayload = await stockRes.json().catch(() => ({}));
          const products = Array.isArray(stockPayload?.data)
            ? stockPayload.data
            : [];
          products.forEach((product) => {
            const stockQty =
              product?.stock_status === "in_stock"
                ? Math.max(0, Number(product?.stock || 0))
                : 0;
            liveStocks.set(Number(product?.id || 0), stockQty);
          });
        } catch (error) {
          void showCustomerPopup(
            error?.message || "Unable to verify stocks right now.",
            {
              title: "Stock Check Failed",
            },
          );
          return;
        }
      }

      const validatedItems = [];
      for (const item of selectedItems) {
        const productId = Number(item.product_id || 0);
        if (productId > 0) {
          if (!liveStocks.has(productId)) {
            void showCustomerPopup(
              `Product \"${item.product_name}\" is no longer available. Please update your cart.`,
              { title: "Product Unavailable" },
            );
            return;
          }

          const availableStock = Math.max(
            0,
            Number(liveStocks.get(productId) || 0),
          );
          if (availableStock <= 0) {
            void showCustomerPopup(
              `\"${item.product_name}\" is now out of stock.`,
              { title: "Out of Stock" },
            );
            return;
          }

          if (item.quantity > availableStock) {
            void showCustomerPopup(
              `Only ${availableStock} stock(s) left for \"${item.product_name}\". Please reduce quantity in cart.`,
              { title: "Stock Limit" },
            );
            return;
          }

          validatedItems.push({
            ...item,
            max_stock: availableStock,
            line_total: item.unit_price * item.quantity,
          });
          continue;
        }

        validatedItems.push({
          ...item,
          max_stock: null,
          line_total: item.unit_price * item.quantity,
        });
      }

      const firstItem = validatedItems[0];
      const totalQty = validatedItems.reduce(
        (sum, item) => sum + item.quantity,
        0,
      );
      const totalAmount = validatedItems.reduce(
        (sum, item) => sum + item.line_total,
        0,
      );

      currentCheckoutMode = "cart";
      currentCheckoutItems = validatedItems;
      currentProductId = firstItem?.product_id ?? null;
      currentItemPrice = totalQty > 0 ? totalAmount / totalQty : 0;

      if (checkoutImg)
        checkoutImg.src = firstItem?.product_image || "/images/FMRC Logo.png";
      if (checkoutTitle) {
        checkoutTitle.innerText =
          validatedItems.length > 1
            ? `${firstItem?.product_name || "Custom Order"} (+${validatedItems.length - 1} more)`
            : firstItem?.product_name || "Custom Order";
      }
      if (checkoutPrice) {
        checkoutPrice.innerText = formatPrice(currentItemPrice);
      }

      if (guideImg)
        guideImg.src = firstItem?.product_image || "/images/FMRC Logo.png";
      if (guideTitle) {
        guideTitle.innerText =
          validatedItems.length > 1
            ? `${firstItem?.product_name || "Custom Order"} (+${validatedItems.length - 1} more)`
            : firstItem?.product_name || "Custom Order";
      }

      if (
        validatedItems.length === 1 &&
        Number.isFinite(Number(firstItem?.max_stock))
      ) {
        currentMaxStock = Math.max(0, Number(firstItem.max_stock));
        setCheckoutStockNotice(
          currentMaxStock === 0 ? "Out of Stock" : currentMaxStock,
        );
      } else {
        currentMaxStock = 9999;
        setCheckoutStockNotice(`Multiple products (${validatedItems.length})`);
      }

      if (inputQty) {
        inputQty.value = String(totalQty);
        inputQty.max = String(totalQty);
      }

      setCheckoutQtyLock(true);
      if (protectionCheck) protectionCheck.checked = false;
      updateCheckoutMath();

      cartModal.classList.remove("show-modal");
      checkoutModal.classList.add("show-modal");
    });
  }

  restoreCartItems();
  updateCartTotals();

  window.addEventListener("storage", (event) => {
    if (
      !event.key ||
      (!event.key.startsWith(CART_STORAGE_KEY) &&
        event.key !== CART_STORAGE_SIGNAL_KEY)
    )
      return;
    restoreCartItems();
    updateCartTotals();
  });

  // =========================================
  // APPOINTMENT FLOW LOGIC (HOMEPAGE)
  // =========================================
  const appointmentBtn = document.querySelector(".btn-appointment");
  const appointmentOverlay = document.getElementById("appointmentFlow");
  const closeAppointmentBtn = document.getElementById("closeAppointmentBtn");
  const privacyModal = document.getElementById("aptPrivacyModal");
  const confirmModal = document.getElementById("aptConfirmModal");
  const successModal = document.getElementById("successAppointmentModal");
  const aptFileInput = document.getElementById("aptFile");
  const aptFileName = document.getElementById("aptFileName");

  const calGrid = document.getElementById("calDaysGrid");
  const monthDisplay = document.getElementById("calMonthYear");
  const prevBtn = document.getElementById("calPrevBtn");
  const nextBtn = document.getElementById("calNextBtn");
  const timeContainer = document.getElementById("timeSlotsContainer");
  const selectedDateDisplay = document.getElementById("selectedDateDisplay");
  const slotCounter = document.getElementById("slotCounter");
  const limitMsg = document.getElementById("maxLimitMsg");

  let appointmentSubmitted = false;
  let submittedAppointment = null;
  let selectedDateKey = null;
  const today = new Date();
  const todayOnly = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  let currentMonth = todayOnly.getMonth();
  let currentYear = todayOnly.getFullYear();
  let uploadedAppointmentFile = null;

  const defaultTimeSlots = [
    { label: "9:00 - 10:00 AM", type: "AM", sort_order: 1 },
    { label: "10:00 - 11:00 AM", type: "AM", sort_order: 2 },
    { label: "11:00 - 12:00", type: "AM", sort_order: 3 },
    { label: "1:00 - 2:00 PM", type: "PM", sort_order: 4 },
    { label: "2:00 - 3:00 PM", type: "PM", sort_order: 5 },
    { label: "3:00 - 4:00 PM", type: "PM", sort_order: 6 },
  ];

  const calendarState = {
    timeSlots: [...defaultTimeSlots],
    daySettings: {},
    bookedSlots: {},
  };

  const appointmentSelections = {};
  window.appointmentSelections = appointmentSelections;

  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const parseSlotStartMinutes = (slot) => {
    const label = String(slot?.label || "").trim();
    const start = label.split("-")[0].trim();
    const meridiemMatch = label.match(/\b(AM|PM)\b/i);
    const meridiem = (slot?.type || meridiemMatch?.[1] || "AM").toUpperCase();
    const match = start.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
    if (!match) return Number.MAX_SAFE_INTEGER;

    let hh = Number(match[1]);
    const mm = Number(match[2] || "0");
    if (
      Number.isNaN(hh) ||
      Number.isNaN(mm) ||
      hh < 1 ||
      hh > 12 ||
      mm < 0 ||
      mm > 59
    ) {
      return Number.MAX_SAFE_INTEGER;
    }

    if (meridiem === "AM") {
      if (hh === 12) hh = 0;
    } else if (hh < 12) {
      hh += 12;
    }

    return hh * 60 + mm;
  };

  const slotSortComparator = (a, b) => {
    const aTime = parseSlotStartMinutes(a);
    const bTime = parseSlotStartMinutes(b);
    if (aTime !== bTime) return aTime - bTime;
    return String(a?.label || "").localeCompare(String(b?.label || ""));
  };

  const bindClick = (id, callback) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", callback);
  };

  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
  };

  const setHtml = (id, content) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = content;
  };

  const showSlotMessage = (message, color = "#b01c1c") => {
    if (!limitMsg) return;
    limitMsg.style.display = "block";
    limitMsg.style.color = color;
    limitMsg.innerText = message;
  };

  const clearSlotMessage = () => {
    if (!limitMsg) return;
    limitMsg.style.display = "none";
    limitMsg.innerText = "";
  };

  const toDateKey = (year, month, day) =>
    `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const toReadableDate = (isoDate) => {
    const match = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return "N/A";
    return `${months[Number(match[2]) - 1]} ${Number(match[3])}, ${match[1]}`;
  };

  const getAppointmentAddress = () => {
    const country =
      document.getElementById("aptCountry")?.value?.trim() || "Philippines";

    if (country !== "Philippines") {
      const intlAddress =
        document.getElementById("aptIntlAddress")?.value?.trim() || "";
      return [intlAddress, country].filter(Boolean).join(", ");
    }

    const region = document.getElementById("aptRegion")?.value?.trim() || "";
    const province =
      document.getElementById("aptProvince")?.value?.trim() || "";
    const municipality =
      document.getElementById("aptMunicipality")?.value?.trim() || "";
    const barangay = document.getElementById("aptAddress")?.value?.trim() || "";

    return [barangay, municipality, province, region, country]
      .filter(Boolean)
      .join(", ");
  };

  const fetchCalendarAvailability = async () => {
    try {
      const response = await fetchWithTimeout(
        `${API_BASE_URL}/appointments/calendar`,
        {
          headers: {
            Accept: "application/json",
          },
        },
      );

      if (!response.ok) return;
      const data = await response.json();

      const incomingSlots = Array.isArray(data?.time_slots)
        ? data.time_slots
        : [];
      calendarState.timeSlots = incomingSlots.length
        ? incomingSlots
            .map((slot) => ({
              label: String(slot.label || ""),
              type: String(slot.type || "AM"),
              sort_order: Number(slot.sort_order || 1),
            }))
            .filter((slot) => slot.label)
            .sort(slotSortComparator)
            .map((slot, index) => ({ ...slot, sort_order: index + 1 }))
        : [...defaultTimeSlots];

      calendarState.daySettings = {};
      (Array.isArray(data?.day_settings) ? data.day_settings : []).forEach(
        (entry) => {
          if (!entry?.date) return;
          calendarState.daySettings[String(entry.date)] = {
            is_blocked: Boolean(entry.is_blocked),
            blocked_slots: Array.isArray(entry.blocked_slots)
              ? entry.blocked_slots
              : [],
            events: Array.isArray(entry.events) ? entry.events : [],
            custom_slots: Array.isArray(entry.custom_slots)
              ? entry.custom_slots
              : [],
          };
        },
      );

      calendarState.bookedSlots =
        data?.booked_slots && typeof data.booked_slots === "object"
          ? data.booked_slots
          : {};
    } catch {
      // Keep defaults when API is temporarily unavailable.
    }
  };

  const setFieldError = (inputId, message) => {
    const input = document.getElementById(inputId);
    if (!input) return;

    const group = input.closest(".apt-input-group");
    if (!group) return;

    let bubble = group.querySelector(".apt-field-error-bubble");
    if (!bubble) {
      bubble = document.createElement("div");
      bubble.className = "apt-field-error-bubble";
      bubble.setAttribute("role", "alert");
      group.appendChild(bubble);
    }

    bubble.textContent = message;
    group.classList.add("has-error");
    input.setAttribute("aria-invalid", "true");
  };

  const clearFieldError = (inputId) => {
    const input = document.getElementById(inputId);
    if (!input) return;

    const group = input.closest(".apt-input-group");
    if (!group) return;

    group.classList.remove("has-error");
    input.removeAttribute("aria-invalid");
  };

  const clearAllFieldErrors = () => {
    document.querySelectorAll(".apt-input-group.has-error").forEach((group) => {
      group.classList.remove("has-error");
      const input = group.querySelector("input, select, textarea");
      if (input) input.removeAttribute("aria-invalid");
    });
  };

  [
    "aptLName",
    "aptFName",
    "aptMI",
    "aptPhone",
    "aptEmail",
    "aptCountry",
    "aptRegion",
    "aptProvince",
    "aptMunicipality",
    "aptAddress",
    "aptIntlAddress",
    "aptPurpose",
    "aptRole",
    "aptDesc",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => clearFieldError(id));
    el.addEventListener("change", () => clearFieldError(id));
  });

  const getSelectedSchedule = () => {
    const date = Object.keys(appointmentSelections)[0] || "";
    const time = date ? appointmentSelections[date]?.[0] || "" : "";
    return { date, time };
  };

  const validateAppointmentStep2 = () => {
    clearAllFieldErrors();

    const lastName = document.getElementById("aptLName")?.value?.trim() || "";
    const firstName = document.getElementById("aptFName")?.value?.trim() || "";
    const middleInitial = document.getElementById("aptMI")?.value?.trim() || "";
    const mobile = document.getElementById("aptPhone")?.value?.trim() || "";
    const email = document.getElementById("aptEmail")?.value?.trim() || "";
    const purpose = document.getElementById("aptPurpose")?.value?.trim() || "";
    const clientType = document.getElementById("aptRole")?.value?.trim() || "";
    const country =
      document.getElementById("aptCountry")?.value?.trim() || "Philippines";

    let firstInvalidId = "";
    const markError = (id, message) => {
      setFieldError(id, message);
      if (!firstInvalidId) firstInvalidId = id;
    };

    if (!lastName) {
      markError("aptLName", "Last Name is required.");
    } else if (lastName.length > 20) {
      markError("aptLName", "Last Name must not exceed 20 letters.");
    } else if (!/^[A-Za-z]+(?:\s[A-Za-z]+)*$/.test(lastName)) {
      markError("aptLName", "Last Name is invalid. Use letters only.");
    }

    if (!firstName) {
      markError("aptFName", "First Name is required.");
    } else if (firstName.length > 25) {
      markError("aptFName", "First Name must not exceed 25 letters.");
    } else if (!/^[A-Za-z]+(?:\s[A-Za-z]+)*$/.test(firstName)) {
      markError("aptFName", "First Name is invalid. Use letters only.");
    }

    if (middleInitial && !/^[A-Za-z]$/.test(middleInitial)) {
      markError("aptMI", "M.I. is invalid. Use exactly 1 letter only.");
    }

    if (!mobile) {
      markError("aptPhone", "Mobile Number is required.");
    } else if (!/^\d{11}$/.test(mobile)) {
      markError("aptPhone", "Mobile Number is invalid. Use exactly 11 digits.");
    }

    if (!email) {
      markError("aptEmail", "Email Address is required.");
    } else if (!/^[A-Za-z0-9._%+-]+@gmail\.com$/i.test(email)) {
      markError(
        "aptEmail",
        "Email Address is invalid. Please use a Gmail address only.",
      );
    }

    if (!purpose) {
      markError("aptPurpose", "Purpose of Visit is required.");
    }

    if (!clientType) {
      markError("aptRole", "Type of Client is required.");
    }

    if (country === "Philippines") {
      if (!document.getElementById("aptRegion")?.value?.trim()) {
        markError("aptRegion", "Region is required.");
      }
      if (!document.getElementById("aptProvince")?.value?.trim()) {
        markError("aptProvince", "Province is required.");
      }
      if (!document.getElementById("aptMunicipality")?.value?.trim()) {
        markError("aptMunicipality", "Municipality is required.");
      }
      if (!document.getElementById("aptAddress")?.value?.trim()) {
        markError("aptAddress", "Barangay is required.");
      }
    } else {
      const intlAddress =
        document.getElementById("aptIntlAddress")?.value?.trim() || "";
      if (!intlAddress) {
        markError(
          "aptIntlAddress",
          "Complete Residential Address is required.",
        );
      }
    }

    if (firstInvalidId) {
      document.getElementById(firstInvalidId)?.focus();
      return false;
    }

    return true;
  };

  const updateQrDetails = (referenceNo, verifyUrl) => {
    const qrImage = document.getElementById("receiptQrImage");
    const qrLink = document.getElementById("receiptQrLink");
    const payloadUrl =
      verifyUrl ||
      `${window.location.origin}/appointments/verify/${referenceNo || "PENDING"}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(payloadUrl)}`;

    if (qrImage) {
      qrImage.crossOrigin = "anonymous";
      qrImage.src = qrUrl;
    }
    if (qrLink) {
      qrLink.href = payloadUrl;
      qrLink.textContent = "Open verification page";
    }
  };

  const populateReviewData = (step) => {
    const prefix = step === 4 ? "rev" : "com";
    const fName = document.getElementById("aptFName")?.value?.trim() || "N/A";
    const lName = document.getElementById("aptLName")?.value?.trim() || "N/A";
    const mi = document.getElementById("aptMI")?.value?.trim() || "";
    const fullName = [fName, mi ? `${mi.replace(/\.$/, "")}.` : "", lName]
      .filter(Boolean)
      .join(" ")
      .trim();

    const phone = document.getElementById("aptPhone")?.value?.trim() || "N/A";
    const email = document.getElementById("aptEmail")?.value?.trim() || "N/A";
    const purpose =
      document.getElementById("aptPurpose")?.value?.trim() || "N/A";
    const clientType =
      document.getElementById("aptRole")?.value?.trim() || "N/A";
    const country =
      document.getElementById("aptCountry")?.value?.trim() || "Philippines";
    const notes = document.getElementById("aptDesc")?.value?.trim() || "N/A";
    const address = getAppointmentAddress() || "N/A";
    const attachmentName = uploadedAppointmentFile?.name || "N/A";

    const { date, time } = getSelectedSchedule();
    const scheduleText =
      date && time ? `${toReadableDate(date)} @ ${time}` : "Not selected";
    const referenceNo = submittedAppointment?.reference_no || "PENDING";

    setText(`${prefix}Name`, fullName);
    setText(`${prefix}Phone`, phone);
    setText(`${prefix}Email`, email);
    setText(`${prefix}Address`, address);
    setText(`${prefix}Purpose`, purpose);
    setText(`${prefix}ClientType`, clientType);
    setText(`${prefix}Country`, country);
    setText(`${prefix}Desc`, notes);
    setText(`${prefix}FileAttach`, attachmentName);
    setText(`${prefix}TicketNo`, `Ticket #${referenceNo}`);
    setHtml(`${prefix}Sched`, scheduleText);

    setText("successReferenceNo", referenceNo);
    updateQrDetails(referenceNo, submittedAppointment?.qr_payload || "");
  };

  const switchAptStep = (stepNumber) => {
    document
      .querySelectorAll(".apt-content-section")
      .forEach((sec) => sec.classList.remove("active"));
    document.querySelectorAll(".apt-step").forEach((step, index) => {
      const icon = step.querySelector(".apt-icon");
      if (index < stepNumber) {
        step.classList.add("active");
        if (icon) {
          icon.style.background = "#4caf50";
          icon.style.color = "#fff";
          icon.style.borderColor = "#fff";
        }
      } else {
        step.classList.remove("active");
        if (icon) {
          icon.style.background = "#fff";
          icon.style.color = "#8b0000";
        }
      }
    });

    const targetSection = document.getElementById(`aptStep${stepNumber}`);
    if (targetSection) targetSection.classList.add("active");

    if (stepNumber === 3) {
      clearSlotMessage();
      renderCalendar(currentMonth, currentYear);
      if (selectedDateKey) renderTimeSlots(selectedDateKey);
      showSlotMessage(
        "Reminder: You can select only 1 time slot for this appointment.",
        "#9a6a00",
      );
    }

    if (stepNumber === 4 || stepNumber === 5) {
      populateReviewData(stepNumber);
    }
  };

  const submitAppointment = async () => {
    const { date, time } = getSelectedSchedule();
    if (!date || !time) {
      const msg = "Please select a date and time first before continuing.";
      showSlotMessage(msg);
      return { ok: false, error: msg };
    }

    const formData = new FormData();
    formData.append(
      "last_name",
      document.getElementById("aptLName")?.value?.trim() || "",
    );
    formData.append(
      "first_name",
      document.getElementById("aptFName")?.value?.trim() || "",
    );
    formData.append(
      "middle_initial",
      document.getElementById("aptMI")?.value?.trim() || "",
    );
    formData.append(
      "contact_number",
      document.getElementById("aptPhone")?.value?.trim() || "",
    );
    formData.append(
      "email",
      document.getElementById("aptEmail")?.value?.trim() || "",
    );
    formData.append(
      "country",
      document.getElementById("aptCountry")?.value?.trim() || "Philippines",
    );
    formData.append(
      "region",
      document.getElementById("aptRegion")?.value?.trim() || "",
    );
    formData.append(
      "province",
      document.getElementById("aptProvince")?.value?.trim() || "",
    );
    formData.append(
      "municipality",
      document.getElementById("aptMunicipality")?.value?.trim() || "",
    );
    formData.append(
      "barangay",
      document.getElementById("aptAddress")?.value?.trim() || "",
    );
    formData.append(
      "intl_address",
      document.getElementById("aptIntlAddress")?.value?.trim() || "",
    );
    formData.append("full_address", getAppointmentAddress() || "");
    formData.append(
      "client_type",
      document.getElementById("aptRole")?.value?.trim() || "",
    );
    formData.append(
      "purpose",
      document.getElementById("aptPurpose")?.value?.trim() || "",
    );
    formData.append(
      "additional_notes",
      document.getElementById("aptDesc")?.value?.trim() || "",
    );
    formData.append("appointment_date", date);
    formData.append("appointment_time", time);

    if (uploadedAppointmentFile) {
      formData.append("attachment", uploadedAppointmentFile);
    }

    const token = localStorage.getItem("customer_token");

    try {
      const response = await fetchWithTimeout(
        `${API_BASE_URL}/appointments`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: formData,
        },
        60000,
      ); // 60s timeout — email is sent synchronously, so backend may take extra time for SMTP

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        const message =
          payload?.message ||
          "Unable to submit appointment. Please review your details and try again.";
        showSlotMessage(message);
        return { ok: false, error: message };
      }

      submittedAppointment = payload?.data || null;
      appointmentSubmitted = true;
      stopAptPolling();
      return { ok: true, error: null };
    } catch (error) {
      console.error("[APPT SUBMIT] Error:", error);
      const message =
        error?.message ||
        "Cannot connect to server. Please make sure Laravel is running.";
      showSlotMessage(message);
      return { ok: false, error: message };
    }
  };

  const downloadAppointmentReceipt = async () => {
    const receipt = document.getElementById("officialReceiptCard");
    const referenceNo = submittedAppointment?.reference_no || "PENDING";

    if (!receipt || typeof window.html2canvas !== "function") {
      showSlotMessage(
        "Receipt download is unavailable right now. Please try again.",
      );
      return;
    }

    const canvas = await window.html2canvas(receipt, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
    });

    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `FMRC-Official-Receipt-${referenceNo}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const downloadQrCodeCard = () => {
    const qrImage = document.getElementById("receiptQrImage");
    const qrLink = document.getElementById("receiptQrLink")?.href || "";
    const referenceNo = submittedAppointment?.reference_no || "PENDING";
    if (!qrImage?.src) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 900;
      canvas.height = 1180;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = "#8b0000";
      ctx.font = "bold 42px Montserrat, Arial, sans-serif";
      ctx.fillText("CNSC-FMRC QR PASS", 180, 90);

      ctx.strokeStyle = "#d8dde6";
      ctx.lineWidth = 2;
      ctx.strokeRect(130, 140, 640, 640);
      ctx.drawImage(img, 180, 190, 540, 540);

      ctx.fillStyle = "#1f2937";
      ctx.font = "bold 28px Montserrat, Arial, sans-serif";
      ctx.fillText(`Reference: ${referenceNo}`, 180, 840);
      ctx.font = "22px Montserrat, Arial, sans-serif";
      ctx.fillText("Scan to verify this appointment receipt", 180, 895);
      ctx.fillText("FMRC Online Appointment Verification", 180, 940);
      ctx.font = "16px Montserrat, Arial, sans-serif";
      ctx.fillText("Scan to open the official verification page", 180, 988);

      const dl = document.createElement("a");
      dl.href = canvas.toDataURL("image/png");
      dl.download = `FMRC-Appointment-QR-${referenceNo}.png`;
      document.body.appendChild(dl);
      dl.click();
      dl.remove();
    };

    img.onerror = () => {
      const link = document.createElement("a");
      link.href = qrImage.src;
      link.download = `FMRC-Appointment-QR-${referenceNo}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    };

    img.src = qrImage.src;
  };

  const handleDateClick = (dateKey, day, month, year) => {
    selectedDateKey = dateKey;
    selectedDateDisplay.innerText = `${months[month]} ${day}, ${year}`;
    if (slotCounter) {
      slotCounter.style.display = "block";
      slotCounter.innerText = "Allowed: 1 time slot for this appointment";
      slotCounter.style.color = "#555";
    }
    showSlotMessage(
      "Reminder: You can select only 1 time slot for this appointment.",
      "#9a6a00",
    );
    renderCalendar(currentMonth, currentYear);
    renderTimeSlots(dateKey);
  };

  const getCombinedSlotsForDate = (dateKey) => {
    const selected = appointmentSelections[dateKey] || [];
    const booked = calendarState.bookedSlots[dateKey] || [];
    const blocked = calendarState.daySettings[dateKey]?.blocked_slots || [];
    return [...new Set([...selected, ...booked, ...blocked])];
  };

  const getRenderableSlotsForDate = (dateKey) => {
    const baseSlots = [...calendarState.timeSlots].sort(slotSortComparator);
    const day = calendarState.daySettings[dateKey] || {};
    const customSlots = (
      Array.isArray(day.custom_slots) ? day.custom_slots : []
    )
      .map((slot) => ({
        label: String(slot?.label || "").trim(),
        type: String(slot?.type || "AM") === "PM" ? "PM" : "AM",
        sort_order: 999,
      }))
      .filter((slot) => slot.label);

    const seen = new Set(baseSlots.map((slot) => `${slot.label}|${slot.type}`));
    customSlots.forEach((slot) => {
      const key = `${slot.label}|${slot.type}`;
      if (!seen.has(key)) {
        baseSlots.push(slot);
        seen.add(key);
      }
    });

    return baseSlots.sort(slotSortComparator);
  };

  const updateDayIndicators = (cell, dateKey) => {
    const slots = getCombinedSlotsForDate(dateKey);
    const hasAM = slots.some((slot) => String(slot).includes("AM"));
    const hasPM = slots.some((slot) => String(slot).includes("PM"));

    cell.classList.remove("has-am", "has-pm", "has-full");
    if (hasAM && hasPM) {
      cell.classList.add("has-full");
    } else if (hasAM) {
      cell.classList.add("has-am");
    } else if (hasPM) {
      cell.classList.add("has-pm");
    }
  };

  const renderCalendar = (month, year) => {
    if (!calGrid || !monthDisplay) return;

    calGrid.innerHTML = "";
    monthDisplay.innerText = `${months[month]} ${year}`;

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < firstDay; i += 1) {
      const emptyCell = document.createElement("div");
      calGrid.appendChild(emptyCell);
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const cell = document.createElement("div");
      cell.classList.add("cal-day-cell");
      cell.innerText = String(day);

      const dateObj = new Date(year, month, day);
      const dateKey = toDateKey(year, month, day);
      const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
      const isPast = dateObj < todayOnly;
      const daySettings = calendarState.daySettings[dateKey] || {
        is_blocked: false,
        blocked_slots: [],
        events: [],
      };

      if (isWeekend) {
        cell.classList.add("disabled", "unavailable");
        cell.setAttribute("title", "Unavailable: Weekend");
      } else if (isPast) {
        cell.classList.add("disabled");
        cell.style.opacity = "0.55";
        cell.setAttribute("title", "Unavailable: Past Date");
      } else if (daySettings.is_blocked) {
        cell.classList.add("disabled", "unavailable");
        cell.setAttribute("title", "Unavailable: Blocked by admin");
      } else {
        cell.addEventListener("click", () =>
          handleDateClick(dateKey, day, month, year),
        );
        updateDayIndicators(cell, dateKey);
      }

      if (Array.isArray(daySettings.events) && daySettings.events.length) {
        cell.setAttribute("title", `Event: ${daySettings.events.join(", ")}`);
      }

      if (dateKey === selectedDateKey) {
        cell.classList.add("selected");
      }

      calGrid.appendChild(cell);
    }
  };

  const renderTimeSlots = (dateKey) => {
    if (!timeContainer) return;
    const eventsDisplay = document.getElementById("userDateEventsDisplay");

    if (!dateKey) {
      timeContainer.innerHTML =
        '<p class="time-placeholder">Please pick a date first.</p>';
      if (eventsDisplay) {
        eventsDisplay.style.display = "none";
        eventsDisplay.innerHTML = "";
      }
      return;
    }

    const selectedSchedule = getSelectedSchedule();
    const selectedSlot =
      selectedSchedule.date === dateKey ? selectedSchedule.time : "";
    const daySettings = calendarState.daySettings[dateKey] || {
      is_blocked: false,
      blocked_slots: [],
      events: [],
      custom_slots: [],
    };
    const bookedSlots = calendarState.bookedSlots[dateKey] || [];

    if (eventsDisplay) {
      if (daySettings.events && daySettings.events.length > 0) {
        eventsDisplay.style.display = "block";
        eventsDisplay.innerHTML = `<div class="date-note-title">Schedule Notice for this Date</div><ul class="date-note-list">${daySettings.events
          .map((ev) => `<li>${String(ev)}</li>`)
          .join("")}</ul>`;
      } else {
        eventsDisplay.style.display = "none";
        eventsDisplay.innerHTML = "";
      }
    }

    timeContainer.innerHTML = "";
    getRenderableSlotsForDate(dateKey).forEach((slot) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "time-slot-btn";
      button.innerHTML = `<span>${slot.label}</span><span class="time-slot-label">${slot.type}</span>`;

      const isBooked = bookedSlots.includes(slot.label);
      const isBlocked =
        daySettings.blocked_slots.includes(slot.label) ||
        daySettings.is_blocked;
      const isSelected = selectedSlot === slot.label;

      if (isSelected) button.classList.add("selected");
      if (isBooked || isBlocked) {
        button.classList.add("disabled");
        button.title = isBlocked
          ? "Unavailable: blocked by admin"
          : "Unavailable: already booked";
      }

      button.addEventListener("click", () => {
        if (isBooked) {
          showSlotMessage(
            "This time slot is already booked by another customer.",
          );
          return;
        }
        if (isBlocked) {
          showSlotMessage(
            "This time slot is blocked by admin for the selected date.",
          );
          return;
        }

        const hasExistingSelection = Boolean(
          selectedSchedule.date && selectedSchedule.time,
        );
        const isReplacingSelection =
          hasExistingSelection &&
          (selectedSchedule.date !== dateKey ||
            selectedSchedule.time !== slot.label);

        Object.keys(appointmentSelections).forEach(
          (key) => delete appointmentSelections[key],
        );
        appointmentSelections[dateKey] = [slot.label];

        if (isReplacingSelection) {
          showSlotMessage(
            "Only 1 slot is allowed per appointment. Your previous slot was replaced.",
          );
        } else {
          showSlotMessage(
            "Reminder: You can select only 1 time slot for this appointment.",
            "#9a6a00",
          );
        }
        renderTimeSlots(dateKey);
        renderCalendar(currentMonth, currentYear);
      });

      timeContainer.appendChild(button);
    });
  };

  const resetAppointmentFlowState = () => {
    Object.keys(appointmentSelections).forEach(
      (key) => delete appointmentSelections[key],
    );
    selectedDateKey = null;
    clearSlotMessage();
    submittedAppointment = null;
    appointmentSubmitted = false;
    uploadedAppointmentFile = null;
    if (aptFileInput) aptFileInput.value = "";
    if (aptFileName) aptFileName.textContent = "No file selected";
    setText("successReferenceNo", "PENDING");
    updateQrDetails("PENDING", "");
  };

  // Address dropdown behavior.
  const aptCountry = document.getElementById("aptCountry");
  const aptRegion = document.getElementById("aptRegion");
  const aptProvince = document.getElementById("aptProvince");
  const aptMunicipality = document.getElementById("aptMunicipality");
  const aptBarangay = document.getElementById("aptAddress");
  const aptIntlAddress = document.getElementById("aptIntlAddress");
  const aptPhAddressFields = document.getElementById("aptPhAddressFields");
  const aptIntlAddressField = document.getElementById("aptIntlAddressField");

  if (
    aptCountry &&
    aptRegion &&
    aptProvince &&
    aptMunicipality &&
    aptBarangay
  ) {
    const phAddressData = {
      "Bicol Region": {
        "Camarines Norte": {
          Daet: ["Barangay I", "Barangay II", "Barangay III", "Barangay IV"],
          Labo: ["Baay", "Canapawan", "Daguit", "Talobatib"],
          Basud: ["Angas", "Bactas", "Mocong", "Poblacion 1"],
        },
      },
      "National Capital Region (NCR)": {
        "Metro Manila": {
          Manila: [
            "Barangay 659",
            "Barangay 699",
            "Barangay 734",
            "Barangay 750",
          ],
          "Quezon City": [
            "Bagumbayan",
            "Batasan Hills",
            "Commonwealth",
            "UP Campus",
          ],
        },
      },
    };

    const fillSelect = (selectElement, options, placeholder) => {
      selectElement.innerHTML = `<option value="" selected disabled hidden>${placeholder}</option>`;
      options.forEach((optionText) => {
        const option = document.createElement("option");
        option.value = optionText;
        option.textContent = optionText;
        selectElement.appendChild(option);
      });
    };

    const resetPhSelects = () => {
      fillSelect(aptRegion, Object.keys(phAddressData), "Select Region");
      fillSelect(aptProvince, [], "Select Province");
      fillSelect(aptMunicipality, [], "Select Municipality");
      fillSelect(aptBarangay, [], "Select Barangay");
      aptProvince.disabled = true;
      aptMunicipality.disabled = true;
      aptBarangay.disabled = true;
    };

    const updateAddressMode = () => {
      const isPhilippines = aptCountry.value === "Philippines";
      if (aptPhAddressFields)
        aptPhAddressFields.style.display = isPhilippines ? "contents" : "none";
      if (aptIntlAddressField)
        aptIntlAddressField.style.display = isPhilippines ? "none" : "block";
      if (aptIntlAddress) aptIntlAddress.required = !isPhilippines;
    };

    resetPhSelects();
    updateAddressMode();

    aptCountry.addEventListener("change", updateAddressMode);

    aptRegion.addEventListener("change", () => {
      const provinces = Object.keys(phAddressData[aptRegion.value] || {});
      fillSelect(aptProvince, provinces, "Select Province");
      fillSelect(aptMunicipality, [], "Select Municipality");
      fillSelect(aptBarangay, [], "Select Barangay");
      aptProvince.disabled = !provinces.length;
      aptMunicipality.disabled = true;
      aptBarangay.disabled = true;
    });

    aptProvince.addEventListener("change", () => {
      const municipalities = Object.keys(
        phAddressData[aptRegion.value]?.[aptProvince.value] || {},
      );
      fillSelect(aptMunicipality, municipalities, "Select Municipality");
      fillSelect(aptBarangay, [], "Select Barangay");
      aptMunicipality.disabled = !municipalities.length;
      aptBarangay.disabled = true;
    });

    aptMunicipality.addEventListener("change", () => {
      const barangays =
        phAddressData[aptRegion.value]?.[aptProvince.value]?.[
          aptMunicipality.value
        ] || [];
      fillSelect(aptBarangay, barangays, "Select Barangay");
      aptBarangay.disabled = !barangays.length;
    });
  }

  aptFileInput?.addEventListener("change", () => {
    const file = aptFileInput.files?.[0];
    clearFieldError("aptFile");

    if (!file) {
      uploadedAppointmentFile = null;
      if (aptFileName) aptFileName.textContent = "No file selected";
      return;
    }

    const isAllowedMime =
      file.type.startsWith("image/") ||
      file.type === "application/pdf" ||
      file.type === "application/msword" ||
      file.type ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const isAllowedExt = /\.(png|jpg|jpeg|webp|gif|pdf|doc|docx)$/i.test(
      file.name,
    );

    if (!isAllowedMime && !isAllowedExt) {
      uploadedAppointmentFile = null;
      aptFileInput.value = "";
      if (aptFileName)
        aptFileName.textContent =
          "Invalid file. Use image, DOC/DOCX, or PDF only.";
      showSlotMessage(
        "Attachment is invalid. Please upload an image, DOC/DOCX, or PDF file only.",
      );
      return;
    }

    uploadedAppointmentFile = file;
    if (aptFileName) aptFileName.textContent = file.name;
  });

  const aptLName = document.getElementById("aptLName");
  const aptFName = document.getElementById("aptFName");
  const aptMI = document.getElementById("aptMI");
  const aptPhone = document.getElementById("aptPhone");
  const aptEmail = document.getElementById("aptEmail");

  aptLName?.addEventListener("input", () => {
    aptLName.value = aptLName.value.replace(/[^A-Za-z\s]/g, "").slice(0, 20);
  });

  aptFName?.addEventListener("input", () => {
    aptFName.value = aptFName.value.replace(/[^A-Za-z\s]/g, "").slice(0, 25);
  });

  aptMI?.addEventListener("input", () => {
    aptMI.value = aptMI.value
      .replace(/[^A-Za-z]/g, "")
      .slice(0, 1)
      .toUpperCase();
  });

  aptPhone?.addEventListener("input", () => {
    aptPhone.value = aptPhone.value.replace(/\D/g, "").slice(0, 11);
  });

  aptEmail?.addEventListener("blur", () => {
    aptEmail.value = aptEmail.value.trim().toLowerCase();
  });

  let aptPollTimer = null;

  const startAptPolling = () => {
    if (aptPollTimer) clearInterval(aptPollTimer);
    aptPollTimer = setInterval(async () => {
      // Only fetch if Step 3 is visible inside the modal
      if (
        document.getElementById("aptStep3")?.classList.contains("active") &&
        appointmentOverlay?.classList.contains("show-modal")
      ) {
        await fetchCalendarAvailability();
        renderCalendar(currentMonth, currentYear);
        renderTimeSlots(selectedDateKey);
      }
    }, 10000);
  };

  const stopAptPolling = () => {
    if (aptPollTimer) clearInterval(aptPollTimer);
  };

  if (appointmentBtn && appointmentOverlay) {
    appointmentBtn.addEventListener("click", () => {
      if (!requireCustomerAuth("make an appointment")) return;

      appointmentOverlay.classList.add("show-modal");
      document.body.style.overflow = "hidden";

      try {
        resetAppointmentFlowState();
        renderCalendar(currentMonth, currentYear);
        renderTimeSlots(null);
        switchAptStep(1);
        startAptPolling();
      } catch {
        // Keep modal open so the user can still proceed if a non-critical UI section fails.
      }

      // Open immediately, then hydrate availability in the background.
      void (async () => {
        await fetchCalendarAvailability();
        if (!appointmentOverlay.classList.contains("show-modal")) return;

        renderCalendar(currentMonth, currentYear);
        if (document.getElementById("aptStep3")?.classList.contains("active")) {
          renderTimeSlots(selectedDateKey);
        }
      })();
    });

    // Guard: stop clicks that land on the overlay BACKDROP from bubbling to any
    // outer handler. The appointment flow should ONLY be dismissed via the
    // dedicated close/back button — never by clicking outside the card.
    appointmentOverlay.addEventListener("click", (event) => {
      // Only act when the backdrop itself (not any child) is the target.
      // We intentionally do NOT close the overlay here — dismissal is
      // exclusively via closeAppointmentBtn to prevent accidental closure
      // during the async Step 4 submission.
      event.stopPropagation();
    });
  }

  // Guard: stop all clicks inside the apt-container from ever bubbling past
  // the overlay, which prevents any external click handler from seeing them.
  const aptContainerEl = appointmentOverlay?.querySelector(".apt-container");
  if (aptContainerEl) {
    aptContainerEl.addEventListener("click", (event) => {
      event.stopPropagation();
    });
  }

  if (closeAppointmentBtn) {
    closeAppointmentBtn.addEventListener("click", () => {
      appointmentOverlay.classList.remove("show-modal");
      document.body.style.overflow = "";
      resetAppointmentFlowState();
      switchAptStep(1);
      stopAptPolling();
    });
  }

  prevBtn?.addEventListener("click", () => {
    currentMonth -= 1;
    if (currentMonth < 0) {
      currentMonth = 11;
      currentYear -= 1;
    }
    renderCalendar(currentMonth, currentYear);
  });

  nextBtn?.addEventListener("click", () => {
    currentMonth += 1;
    if (currentMonth > 11) {
      currentMonth = 0;
      currentYear += 1;
    }
    renderCalendar(currentMonth, currentYear);
  });

  bindClick("btnGoToPrivacy", () => privacyModal?.classList.add("show-modal"));
  bindClick("cancelPrivacyBtn", () =>
    privacyModal?.classList.remove("show-modal"),
  );
  bindClick("acceptPrivacyBtn", () => {
    privacyModal?.classList.remove("show-modal");
    switchAptStep(2);
  });

  bindClick("btnCancelTo1", () => switchAptStep(1));
  bindClick("btnGoToStep3", async () => {
    if (!validateAppointmentStep2()) return;
    await fetchCalendarAvailability();
    switchAptStep(3);
  });

  bindClick("btnCancelTo2", () => switchAptStep(2));
  bindClick("btnGoToConfirm", () => {
    const { date, time } = getSelectedSchedule();
    if (!date || !time) {
      showSlotMessage("Please select a date and time first before proceeding.");
      return;
    }
    clearSlotMessage();
    confirmModal?.classList.add("show-modal");
  });

  bindClick("cancelConfirmBtn", () =>
    confirmModal?.classList.remove("show-modal"),
  );
  bindClick("acceptConfirmBtn", () => {
    confirmModal?.classList.remove("show-modal");
    switchAptStep(4);
  });

  bindClick("btnCancelTo3", () => switchAptStep(3));

  // Step 4: "Confirm & Submit" — actually submits the appointment to backend
  bindClick("btnGoToStep5", async (event) => {
    // Prevent any click from bubbling to the overlay or triggering form submission
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }

    const btn = document.getElementById("btnGoToStep5");
    if (btn) btn.type = "button"; // Force button type to prevent form submission

    const backBtn = document.getElementById("btnCancelTo3");
    // Also lock the top-level close/back button so the user cannot accidentally
    // navigate away while the async submission is in flight.
    const closeBtn = closeAppointmentBtn;

    // Lock UI during submission to prevent accidental double-click or navigation
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Submitting\u2026";
    }
    if (backBtn) backBtn.disabled = true;
    if (closeBtn) closeBtn.disabled = true;

    const restoreButtons = () => {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Confirm \u0026 Submit";
      }
      if (backBtn) backBtn.disabled = false;
      if (closeBtn) closeBtn.disabled = false;
    };

    try {
      if (!appointmentSubmitted) {
        const result = await submitAppointment();
        if (!result.ok) {
          restoreButtons();
          // Use the error returned directly from submitAppointment
          const errorMsg =
            result.error ||
            "Unable to submit appointment. Please check your details.";
          void showCustomerPopup(errorMsg, {
            title: "Submission Failed",
            allowBackdropClose: false,
          });
          return;
        }
      }
      // Success — restore close button then transition to Step 5
      if (closeBtn) closeBtn.disabled = false;
      
      // Explicitly ensure overlay remains visible using class
      if (appointmentOverlay && !appointmentOverlay.classList.contains("show-modal")) {
        appointmentOverlay.classList.add("show-modal");
      }
      
      try {
        switchAptStep(5);
      } catch (stepErr) {
        console.error("switchAptStep Error:", stepErr);
      }
      
      return false;
    } catch (err) {
      console.error("[APPT SUBMIT] Unexpected Error:", err);
      restoreButtons();
      const catchMsg =
        typeof err?.message === "string" && err.message.length > 0
          ? err.message
          : "Network error or timeout. Please try again.";
      void showCustomerPopup(catchMsg, {
        title: "Submission Error",
        allowBackdropClose: false,
      });
    }
    return false;
  });

  bindClick("btnGenerateReport", () => {
    void downloadAppointmentReceipt();
  });

  bindClick("btnDownloadQr", downloadQrCodeCard);

  // Step 5: "Finish Transaction" — appointment already submitted, just show success
  bindClick("btnFinishStep5", () => {
    successModal?.classList.add("active");
  });

  bindClick("btnSuccessHome", () => {
    successModal?.classList.remove("active");
    appointmentOverlay?.classList.remove("show-modal");
    
    // Safeguard: Strip any inline styles left over from previous bug fixes
    if (appointmentOverlay) {
      appointmentOverlay.style.display = "";
      appointmentOverlay.style.visibility = "";
      appointmentOverlay.style.opacity = "";
    }
    const step5 = document.getElementById("aptStep5");
    if (step5) step5.style.display = "";
    
    document.body.style.overflow = "";
    resetAppointmentFlowState();
    switchAptStep(1);
    stopAptPolling();
  });

  bindClick("btnSuccessDownload", () => {
    downloadQrCodeCard();
  });

  const contactMessageForm = document.getElementById("contactMessageForm");
  if (contactMessageForm) {
    contactMessageForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      if (!requireCustomerAuth("send a message")) {
        return;
      }

      const nameInput = document.getElementById("contactName");
      const emailInput = document.getElementById("contactEmail");
      const messageInput = document.getElementById("contactMessage");
      const submitBtn = contactMessageForm.querySelector(".contact-submit-btn");

      const payload = {
        name: String(nameInput?.value || "").trim(),
        email: String(emailInput?.value || "").trim(),
        message: String(messageInput?.value || "").trim(),
      };

      if (!payload.name || !payload.email || !payload.message) {
        await showCustomerPopup("Please complete Name, Email, and Message before sending.", {
          title: "Incomplete Form",
        });
        return;
      }

      const confirmed = await showCustomerPopup(
        "Send this message to the FMRC customer support team now?",
        {
          title: "Confirm Send",
          isConfirm: true,
        },
      );

      if (!confirmed) {
        return;
      }

      const previousText = submitBtn?.textContent || "Send Message";
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.classList.add("is-loading");
        submitBtn.textContent = "Sending...";
      }

      try {
        const authToken = customerSession.token || localStorage.getItem("customer_token") || "";
        const response = await fetchWithTimeout(`${API_BASE_URL}/customer/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify(payload),
        }, 15000);

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data?.message || "Unable to send your message right now.");
        }

        contactMessageForm.reset();
        await showCustomerPopup(
          data?.message || "Thank you. Your message has been sent successfully.",
          {
            title: "Message Sent",
            allowBackdropClose: false,
          },
        );
      } catch (error) {
        await showCustomerPopup(
          error?.message || "Unable to send your message. Please try again.",
          {
            title: "Send Failed",
          },
        );
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.classList.remove("is-loading");
          submitBtn.textContent = previousText;
        }
      }

    });
  }
});

// --- USER PROFILE AND AUTHENTICATION LOGIC ---
(() => {
  const userProfileBtn = document.querySelector(".user-profile");
  if (!userProfileBtn) return;
  userProfileBtn.removeAttribute("title");

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

  const setLoader = (active) => {
    ensureLoader().classList.toggle("active", active);
  };

  const ensureStatusModal = () => {
    let modal = document.getElementById("userStatusModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "userStatusModal";
      modal.className = "status-modal";
      modal.innerHTML = '<div class="status-box" id="userStatusText"></div>';
      document.body.appendChild(modal);
    }
    return {
      modal,
      text: document.getElementById("userStatusText"),
    };
  };

  const showStatus = (message) => {
    const { modal, text } = ensureStatusModal();
    if (text) text.textContent = message;
    modal.classList.add("show");
  };

  const hideStatus = () => {
    const modal = document.getElementById("userStatusModal");
    modal?.classList.remove("show");
  };

  const hideDropdown = (dropdown) => {
    if (!dropdown.classList.contains("show")) return;
    dropdown.classList.add("is-closing");
    dropdown.classList.remove("show");
    setTimeout(() => dropdown.classList.remove("is-closing"), 180);
  };

  const openProfileModal = (userInfo, token) => {
    let overlay = document.getElementById("customerProfileModal");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "customerProfileModal";
      overlay.className = "customer-modal-overlay";
      overlay.innerHTML = `
        <section class="customer-modal" role="dialog" aria-modal="true" aria-labelledby="customerModalTitle">
          <div class="customer-modal-head">
            <h2 class="customer-modal-title" id="customerModalTitle">My Account</h2>
            <button class="customer-modal-close" id="closeProfileModal" type="button" aria-label="Close">&times;</button>
          </div>
          <div class="customer-card" id="customerInfoBox"></div>
          <h3 class="customer-form-title">Change Password</h3>
          <form id="changePasswordForm" novalidate>
            <div class="customer-field">
              <label for="cp_current">Current Password</label>
              <div class="password-wrapper">
                <input type="password" id="cp_current" required />
                <button class="toggle-pass" type="button" data-target="cp_current" aria-label="Show password">
                  <svg class="eye-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                  </svg>
                </button>
              </div>
            </div>
            <div class="customer-field">
              <label for="cp_new">New Password</label>
              <div class="password-wrapper">
                <input type="password" id="cp_new" required />
                <button class="toggle-pass" type="button" data-target="cp_new" aria-label="Show password">
                  <svg class="eye-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                  </svg>
                </button>
              </div>
            </div>
            <div class="customer-field">
              <label for="cp_confirm">Confirm New Password</label>
              <div class="password-wrapper">
                <input type="password" id="cp_confirm" required />
                <button class="toggle-pass" type="button" data-target="cp_confirm" aria-label="Show password">
                  <svg class="eye-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                  </svg>
                </button>
              </div>
            </div>
            <div class="customer-msg" id="cp_msg"></div>
            <button type="submit" class="customer-btn">Update Password</button>
          </form>
        </section>
      `;
      document.body.appendChild(overlay);

      // Password Toggle Logic
      const eyeClosedSvg =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';
      const eyeOpenSvg =
        '<svg class="eye-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';

      overlay.querySelectorAll(".toggle-pass").forEach((toggleBtn) => {
        toggleBtn.addEventListener("click", () => {
          const targetId = toggleBtn.getAttribute("data-target");
          const input = overlay.querySelector("#" + targetId);
          if (input) {
            if (input.type === "password") {
              input.type = "text";
              toggleBtn.innerHTML = eyeClosedSvg;
              toggleBtn.classList.add("active");
            } else {
              input.type = "password";
              toggleBtn.innerHTML = eyeOpenSvg;
              toggleBtn.classList.remove("active");
            }
          }
        });
      });
    }

    const infoBox = overlay.querySelector("#customerInfoBox");
    if (infoBox) {
      infoBox.innerHTML = `
        <p><strong>Name:</strong> ${userInfo.name || "N/A"}</p>
        <p><strong>Username:</strong> ${userInfo.username || "N/A"}</p>
        <p><strong>Email:</strong> ${userInfo.email || "N/A"}</p>
      `;
    }

    const closeModal = () => {
      overlay.classList.add("closing");
      overlay.classList.remove("show");
      setTimeout(() => {
        overlay.classList.remove("closing");
        document.body.style.overflow = "";
      }, 180);
    };

    overlay.classList.add("show");
    document.body.style.overflow = "hidden";

    overlay
      .querySelector("#closeProfileModal")
      ?.addEventListener("click", closeModal, {
        once: true,
      });

    overlay.addEventListener(
      "click",
      (event) => {
        if (event.target === overlay) {
          closeModal();
        }
      },
      { once: true },
    );

    const form = overlay.querySelector("#changePasswordForm");
    const msgBox = overlay.querySelector("#cp_msg");

    if (form) {
      form.onsubmit = async (event) => {
        event.preventDefault();

        const currentPassword =
          overlay.querySelector("#cp_current")?.value || "";
        const newPassword = overlay.querySelector("#cp_new")?.value || "";
        const confirmPassword =
          overlay.querySelector("#cp_confirm")?.value || "";

        if (!currentPassword) {
          msgBox.style.display = "block";
          msgBox.style.color = "#b91c1c";
          msgBox.textContent = "Current password is required.";
          return;
        }
        if (!newPassword) {
          msgBox.style.display = "block";
          msgBox.style.color = "#b91c1c";
          msgBox.textContent = "New password is required.";
          return;
        }
        if (newPassword.length < 8) {
          msgBox.style.display = "block";
          msgBox.style.color = "#b91c1c";
          msgBox.textContent = "New password must be at least 8 characters.";
          return;
        }
        if (newPassword !== confirmPassword) {
          msgBox.style.display = "block";
          msgBox.style.color = "#b91c1c";
          msgBox.textContent = "Confirm password does not match.";
          return;
        }

        setLoader(true);
        try {
          const response = await fetch(`${API_BASE_URL}/change-password`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              Authorization: "Bearer " + token,
            },
            body: JSON.stringify({
              current_password: currentPassword,
              new_password: newPassword,
              new_password_confirmation: confirmPassword,
            }),
          });

          const data = await response.json();

          msgBox.style.display = "block";
          if (response.ok) {
            msgBox.style.color = "#0f7b35";
            msgBox.innerHTML =
              '<i class="fa-solid fa-circle-check"></i> you have changed your password successfully.';
            form.reset();

            setTimeout(() => {
              msgBox.style.display = "none";
              msgBox.textContent = "";
            }, 3500);
          } else if (response.status === 422 && data.errors) {
            const currentErr = data.errors.current_password?.[0];
            const newErr = data.errors.new_password?.[0];
            const confirmErr = data.errors.new_password_confirmation?.[0];
            msgBox.style.color = "#b91c1c";
            msgBox.textContent =
              currentErr ||
              newErr ||
              confirmErr ||
              data.message ||
              "Unable to update password.";
          } else {
            msgBox.style.color = "#b91c1c";
            msgBox.textContent = data.message || "Unable to update password.";
          }
        } catch {
          msgBox.style.display = "block";
          msgBox.style.color = "#b91c1c";
          msgBox.textContent =
            "Cannot connect to server. Ensure Laravel is running.";
        } finally {
          setLoader(false);
        }
      };
    }
  };

  const formatOrderCurrency = (amount) => {
    const parsed = Number(amount || 0);
    const safeAmount = Number.isFinite(parsed) ? parsed : 0;
    return `₱${safeAmount.toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const ORDER_STAGE_LABELS = {
    to_pay: "To Pay",
    to_ship: "To Ship",
    to_receive: "To Receive",
    completed: "Completed",
  };

  const ORDER_LIFECYCLE_LABELS = {
    incoming: "Incoming",
    pending: "Pending",
    rejected: "Rejected",
    completed: "Completed",
  };

  const buildGoogleMapEmbedUrl = (latitude, longitude) => {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
    return `https://maps.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}&z=15&output=embed`;
  };

  const buildGoogleMapOpenUrl = (latitude, longitude) => {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
  };

  const buildJntTrackingUrl = (trackingNo) => {
    const code = String(trackingNo || "").trim();
    if (!code) return "";
    return `https://www.jtexpress.ph/index/query/gzquery.html?waybillNo=${encodeURIComponent(code)}`;
  };

  let customerOrdersController = null;
  const customerOrdersCache = new Map();

  const fetchJsonWithTimeout = async (
    url,
    options = {},
    timeoutMs = API_REQUEST_TIMEOUT_MS,
  ) => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    const {
      headers: optionHeaders = {},
      signal: _ignoredSignal,
      ...restOptions
    } = options;
    const requestHeaders = {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      ...optionHeaders,
    };

    try {
      const response = await fetch(url, {
        ...restOptions,
        headers: requestHeaders,
        cache: restOptions.cache || "no-store",
        signal: controller.signal,
      });

      const data = await response.json().catch(() => ({}));
      return { response, data };
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(
          "Request timed out. Please check your connection and try again.",
        );
      }

      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  const fetchCustomerOrders = async (customerToken) => {
    const { response, data } = await fetchJsonWithTimeout(
      `${API_BASE_URL}/customer/orders`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${customerToken}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error(data.message || "Unable to load your orders.");
    }

    return Array.isArray(data.data) ? data.data : [];
  };

  const fetchCustomerOrderDetail = async (customerToken, orderId) => {
    const { response, data } = await fetchJsonWithTimeout(
      `${API_BASE_URL}/customer/orders/${orderId}`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${customerToken}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error(data.message || "Unable to load order details.");
    }

    return data.data || null;
  };

  const openOrdersModal = (activeUserInfo) => {
    if (!customerOrdersController) {
      const overlay = document.createElement("div");
      overlay.id = "customerOrdersModal";
      overlay.className = "customer-orders-overlay";
      overlay.innerHTML = `
        <section class="customer-orders-modal" role="dialog" aria-modal="true" aria-labelledby="customerOrdersTitle">
          <div class="customer-orders-head">
            <div class="customer-orders-title-wrap">
              <h2 class="customer-orders-title" id="customerOrdersTitle">My Orders</h2>
              <p class="customer-orders-subtitle">Track every order from payment to completion.</p>
            </div>
            <button type="button" class="customer-orders-close" id="closeCustomerOrdersModal" aria-label="Close">&times;</button>
          </div>

          <div class="customer-orders-tabs" id="customerOrdersTabs">
            <button type="button" class="customer-orders-tab active" data-tab="all">All <span class="customer-orders-tab-count">0</span></button>
            <button type="button" class="customer-orders-tab" data-tab="to_pay">To Pay <span class="customer-orders-tab-count">0</span></button>
            <button type="button" class="customer-orders-tab" data-tab="to_ship">To Ship <span class="customer-orders-tab-count">0</span></button>
            <button type="button" class="customer-orders-tab" data-tab="to_receive">To Receive <span class="customer-orders-tab-count">0</span></button>
            <button type="button" class="customer-orders-tab" data-tab="completed">Completed <span class="customer-orders-tab-count">0</span></button>
          </div>

          <div class="customer-orders-viewport" id="customerOrdersViewport">
            <div class="customer-orders-track" id="customerOrdersTrack">
              <section class="customer-orders-panel" data-panel="all"></section>
              <section class="customer-orders-panel" data-panel="to_pay"></section>
              <section class="customer-orders-panel" data-panel="to_ship"></section>
              <section class="customer-orders-panel" data-panel="to_receive"></section>
              <section class="customer-orders-panel" data-panel="completed"></section>
            </div>
          </div>

          <section class="customer-order-detail-modal" id="customerOrderDetailModal" aria-hidden="true">
            <div class="customer-order-detail-head">
              <h3 id="customerOrderDetailTitle">Order Details</h3>
              <button type="button" class="customer-orders-close" id="closeCustomerOrderDetail" aria-label="Close">&times;</button>
            </div>
            <div class="customer-order-detail-content" id="customerOrderDetailContent"></div>
          </section>
        </section>
      `;
      document.body.appendChild(overlay);

      const tabs = Array.from(overlay.querySelectorAll(".customer-orders-tab"));
      const panels = Array.from(
        overlay.querySelectorAll(".customer-orders-panel"),
      );
      const track = overlay.querySelector("#customerOrdersTrack");
      const viewport = overlay.querySelector("#customerOrdersViewport");
      const closeBtn = overlay.querySelector("#closeCustomerOrdersModal");
      const detailModal = overlay.querySelector("#customerOrderDetailModal");
      const detailContent = overlay.querySelector(
        "#customerOrderDetailContent",
      );
      const detailTitle = overlay.querySelector("#customerOrderDetailTitle");
      const closeDetailBtn = overlay.querySelector("#closeCustomerOrderDetail");
      const stageByPanel = [
        "all",
        "to_pay",
        "to_ship",
        "to_receive",
        "completed",
      ];

      const state = {
        activeIndex: 0,
        userInfo: null,
        cacheKey: "",
        token: "",
        orders: [],
        detailsById: new Map(),
        loading: false,
        refreshInProgress: false,
        refreshQueued: false,
        lastRefreshAt: 0,
        detailLoading: false,
        activeDetailId: null,
        lastDetailRefreshAt: 0,
        lastRealtimeSignalTs: 0,
        refreshTimer: null,
        touchStartX: 0,
        touchStartY: 0,
      };

      const shouldProcessRealtimeSignal = (payload = {}) => {
        const ts = Number(payload?.timestamp || 0);
        if (!Number.isFinite(ts) || ts <= 0) return true;
        if (ts <= state.lastRealtimeSignalTs) return false;
        state.lastRealtimeSignalTs = ts;
        return true;
      };

      const stopRealtimeRefresh = () => {
        if (state.refreshTimer) {
          window.clearInterval(state.refreshTimer);
          state.refreshTimer = null;
        }
      };

      const startRealtimeRefresh = () => {
        stopRealtimeRefresh();
        state.refreshTimer = window.setInterval(() => {
          if (!overlay.classList.contains("show") || document.hidden) return;
          if (state.refreshInProgress) return;

          const popup = document.getElementById("customerSystemPopup");
          if (popup && popup.classList.contains("show")) return;

          const elapsed = Date.now() - state.lastRefreshAt;
          if (elapsed < CUSTOMER_ORDERS_MIN_REFRESH_GAP_MS) return;

          void refreshOrders(false);
        }, CUSTOMER_ORDERS_FALLBACK_SYNC_MS);
      };

      const close = () => {
        overlay.classList.add("closing");
        overlay.classList.remove("show");
        stopRealtimeRefresh();
        state.activeDetailId = null;
        if (detailModal) {
          detailModal.classList.remove("show");
          detailModal.setAttribute("aria-hidden", "true");
        }
        setTimeout(() => {
          overlay.classList.remove("closing");
          document.body.style.overflow = "";
        }, 180);
      };

      const escapeHtml = (value) =>
        String(value || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\"/g, "&quot;")
          .replace(/'/g, "&#39;");

      const formatOrderDate = (isoDate) => {
        if (!isoDate) return "-";
        const date = new Date(isoDate);
        if (Number.isNaN(date.getTime())) return String(isoDate);
        return date.toLocaleString("en-PH", {
          timeZone: PHILIPPINES_TIME_ZONE,
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
      };

      const renderEmptyState = (stageKey) => {
        const labels = {
          all: "No orders yet.",
          to_pay: "No orders are waiting for payment.",
          to_ship: "No orders are waiting for shipping.",
          to_receive: "No orders are waiting for delivery/pickup.",
          completed: "No completed orders yet.",
        };

        return `
          <div class="customer-orders-empty">
            <i class="fa-regular fa-folder-open"></i>
            <p>${labels[stageKey] || "No orders found."}</p>
          </div>
        `;
      };

      const renderLoadingState = () => `
        <div class="customer-orders-empty">
          <i class="fa-solid fa-spinner fa-spin"></i>
          <p>Fetching your orders...</p>
        </div>
      `;

      const getVisibleOrdersByPanel = (stageKey) => {
        if (stageKey === "all") return state.orders;
        if (stageKey === "completed") {
          return state.orders.filter(
            (order) =>
              String(order.lifecycle_status || "").toLowerCase() !==
                "rejected" &&
              String(order.customer_stage || "") === "completed",
          );
        }

        return state.orders.filter(
          (order) =>
            String(order.lifecycle_status || "").toLowerCase() !== "rejected" &&
            String(order.customer_stage || "") === stageKey,
        );
      };

      const setActivePanel = (index) => {
        const nextIndex = Math.min(Math.max(index, 0), stageByPanel.length - 1);
        state.activeIndex = nextIndex;

        tabs.forEach((tab, tabIndex) => {
          tab.classList.toggle("active", tabIndex === nextIndex);
        });

        if (track) {
          track.style.transform = `translateX(-${nextIndex * 100}%)`;
        }
      };

      const resolveOrderStatusMeta = (order) => {
        const lifecycle = String(
          order?.lifecycle_status || "pending",
        ).toLowerCase();
        const stage = ORDER_STAGE_FLOW.includes(order?.customer_stage)
          ? order.customer_stage
          : "to_pay";

        if (lifecycle === "rejected") {
          return {
            label: ORDER_LIFECYCLE_LABELS.rejected,
            className: "status-rejected",
          };
        }

        if (lifecycle === "completed" || stage === "completed") {
          return {
            label: ORDER_STAGE_LABELS.completed,
            className: "status-completed",
          };
        }

        return {
          label:
            ORDER_STAGE_LABELS[stage] ||
            ORDER_LIFECYCLE_LABELS[lifecycle] ||
            "Pending",
          className: `status-${stage.replace("_", "-")}`,
        };
      };

      const renderOrders = () => {
        if (state.loading) {
          panels.forEach((panel) => {
            panel.innerHTML = renderLoadingState();
          });
          tabs.forEach((tab) => {
            const countEl = tab.querySelector(".customer-orders-tab-count");
            if (countEl) countEl.textContent = "0";
          });
          return;
        }

        stageByPanel.forEach((stageKey, panelIndex) => {
          const panel = panels[panelIndex];
          if (!panel) return;

          const scopedOrders = getVisibleOrdersByPanel(stageKey);

          if (!scopedOrders.length) {
            panel.innerHTML = renderEmptyState(stageKey);
            return;
          }

          panel.innerHTML = scopedOrders
            .map((order) => {
              const statusMeta = resolveOrderStatusMeta(order);
              const quantity = Math.max(
                1,
                Number.parseInt(order.quantity || "1", 10) || 1,
              );
              const quantityLabel = `${quantity} item${quantity > 1 ? "s" : ""}`;
              const productImage = escapeHtml(
                order.product_image || "/images/FMRC Logo.png",
              );
              const productName = escapeHtml(
                order.product_name || "Custom Order",
              );
              const orderNo = escapeHtml(
                order.order_no_display ||
                  `#${order.order_no || order.id || "-"}`,
              );
              const paymentMethod = escapeHtml(order.payment_method || "N/A");

              const numericTotal = Number(order.total_amount || 0);
              const totalLabel = formatOrderCurrency(
                Number.isFinite(numericTotal) ? numericTotal : 0,
              );

              return `
                <article class="customer-order-card">
                  <div class="customer-order-thumb">
                    <img src="${productImage}" alt="Order item" loading="lazy" />
                  </div>
                  <div class="customer-order-main">
                    <h4>${productName}</h4>
                    <p class="customer-order-meta">Order ${orderNo} • ${quantityLabel}</p>
                    <p class="customer-order-meta">${paymentMethod} • ${formatOrderDate(order.created_at)}</p>
                  </div>
                  <div class="customer-order-side">
                    <span class="customer-order-status ${statusMeta.className}">${statusMeta.label}</span>
                    <strong class="customer-order-price">${totalLabel}</strong>
                    <div class="customer-order-actions">
                      <button type="button" class="customer-order-detail-btn" data-order-detail="${escapeHtml(order.id)}">Order Details</button>
                    </div>
                  </div>
                </article>
              `;
            })
            .join("");
        });

        tabs.forEach((tab, tabIndex) => {
          const stageKey = stageByPanel[tabIndex];
          const count = getVisibleOrdersByPanel(stageKey).length;
          const countEl = tab.querySelector(".customer-orders-tab-count");
          if (countEl) countEl.textContent = String(count);
        });
      };

      const renderDetailModal = (detail) => {
        if (!detailModal || !detailContent || !detailTitle) return;

        const safeOrderNo = escapeHtml(
          detail.order_no_display || `#${detail.order_no || detail.id || "-"}`,
        );
        const safeTitle = escapeHtml(detail.product_name || "Order Details");
        const safeStatus = escapeHtml(
          ORDER_LIFECYCLE_LABELS[
            String(detail.lifecycle_status || "").toLowerCase()
          ] ||
            ORDER_STAGE_LABELS[
              String(detail.customer_stage || "").toLowerCase()
            ] ||
            "Pending",
        );

        const timeline = Array.isArray(detail.timeline) ? detail.timeline : [];
        const withCoords =
          timeline.find(
            (entry) =>
              Number.isFinite(Number(entry?.latitude)) &&
              Number.isFinite(Number(entry?.longitude)),
          ) || detail;
        const mapEmbedUrl = buildGoogleMapEmbedUrl(
          withCoords?.latitude,
          withCoords?.longitude,
        );
        const mapOpenUrl = buildGoogleMapOpenUrl(
          withCoords?.latitude,
          withCoords?.longitude,
        );
        const courierName = escapeHtml(detail.courier_name || "J&T Express");
        const courierTrackingNo = String(
          detail.courier_tracking_no || "",
        ).trim();
        const jntUrl = buildJntTrackingUrl(courierTrackingNo);

        detailTitle.textContent = `Order ${safeOrderNo}`;

        detailContent.innerHTML = `
          <div class="customer-order-detail-summary">
            <div class="customer-order-detail-chip"><span>Item</span><strong>${safeTitle}</strong></div>
            <div class="customer-order-detail-chip"><span>Status</span><strong>${safeStatus}</strong></div>
            <div class="customer-order-detail-chip"><span>Payment</span><strong>${escapeHtml(detail.payment_method || "N/A")}</strong></div>
            <div class="customer-order-detail-chip"><span>Total</span><strong>${escapeHtml(detail.total_label || formatOrderCurrency(detail.total_amount))}</strong></div>
          </div>

          <div class="customer-order-detail-logistics">
            <h4>Courier Tracking</h4>
            <p><strong>${courierName}</strong>${courierTrackingNo ? ` • ${escapeHtml(courierTrackingNo)}` : ""}</p>
            ${
              jntUrl
                ? `<a class="customer-order-logistics-link" href="${escapeHtml(jntUrl)}" target="_blank" rel="noopener noreferrer">Track on J&T Express</a>`
                : '<p class="customer-order-logistics-note">Tracking number will appear here once shipment info is available.</p>'
            }
          </div>

          <div class="customer-order-detail-map-wrap">
            <h4>Realtime Location</h4>
            ${
              mapEmbedUrl
                ? `<iframe class="customer-order-map-frame" src="${escapeHtml(mapEmbedUrl)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Order location map"></iframe>
                   <div class="customer-order-map-actions">${
                     mapOpenUrl
                       ? `<a href="${escapeHtml(mapOpenUrl)}" target="_blank" rel="noopener noreferrer">Open in Google Maps</a>`
                       : ""
                   }</div>`
                : '<div class="customer-order-map-empty"><i class="fa-solid fa-map-location-dot"></i><p>Location updates will appear here once available.</p></div>'
            }
          </div>

          <div class="customer-order-detail-timeline">
            <h4>Order Timeline</h4>
            <div class="customer-order-timeline-list">
              ${
                timeline.length
                  ? timeline
                      .map(
                        (entry) => `
                          <article class="customer-order-timeline-item">
                            <div class="customer-order-timeline-dot"></div>
                            <div class="customer-order-timeline-body">
                              <div class="customer-order-timeline-top">
                                <strong>${escapeHtml(entry.title || "Order update")}</strong>
                                <span>${escapeHtml(formatOrderDate(entry.occurred_at || entry.occurred_at_label))}</span>
                              </div>
                              ${entry.description ? `<p>${escapeHtml(entry.description)}</p>` : ""}
                              <div class="customer-order-timeline-meta">
                                <span>${escapeHtml(entry.stage_label || ORDER_STAGE_LABELS[entry.stage] || "Stage update")}</span>
                                ${entry.location_name ? `<span>${escapeHtml(entry.location_name)}</span>` : ""}
                              </div>
                            </div>
                          </article>
                        `,
                      )
                      .join("")
                  : '<p class="customer-order-timeline-empty">Timeline updates will appear once your order is processed.</p>'
              }
            </div>
          </div>
        `;

        detailModal.classList.add("show");
        detailModal.setAttribute("aria-hidden", "false");
      };

      const closeDetailModal = () => {
        if (!detailModal) return;
        detailModal.classList.remove("show");
        detailModal.setAttribute("aria-hidden", "true");
        state.activeDetailId = null;
      };

      const openOrderDetail = async (orderId) => {
        if (!orderId || !state.token) return;

        const key = String(orderId);
        const cached = state.detailsById.get(key);
        if (cached) {
          state.activeDetailId = key;
          renderDetailModal(cached);
          void refreshActiveDetail(true);
          return;
        }

        if (!detailModal || !detailContent || !detailTitle) return;

        state.detailLoading = true;
        state.activeDetailId = key;
        detailTitle.textContent = "Order Details";
        detailContent.innerHTML = `
          <div class="customer-orders-empty">
            <i class="fa-solid fa-spinner fa-spin"></i>
            <p>Preparing order details...</p>
          </div>
        `;
        detailModal.classList.add("show");
        detailModal.setAttribute("aria-hidden", "false");

        try {
          const detail = await fetchCustomerOrderDetail(state.token, key);
          if (detail) {
            state.detailsById.set(key, detail);
            renderDetailModal(detail);
            state.lastDetailRefreshAt = Date.now();
          }
        } catch (error) {
          detailTitle.textContent = "Order Details";
          detailContent.innerHTML = `
            <div class="customer-orders-empty">
              <i class="fa-regular fa-circle-xmark"></i>
              <p>${escapeHtml(error?.message || "Unable to load order details.")}</p>
            </div>
          `;
        } finally {
          state.detailLoading = false;
        }
      };

      const refreshActiveDetail = async (force = false) => {
        if (!state.activeDetailId || !state.token) return;
        if (!detailModal?.classList.contains("show")) return;
        if (state.detailLoading) return;
        if (!force && Date.now() - state.lastDetailRefreshAt < 1000) return;

        state.detailLoading = true;
        try {
          const detail = await fetchCustomerOrderDetail(
            state.token,
            state.activeDetailId,
          );
          if (detail) {
            state.detailsById.set(String(state.activeDetailId), detail);
            renderDetailModal(detail);
            state.lastDetailRefreshAt = Date.now();
          }
        } catch {
          // Keep current detail view; periodic refresh will retry.
        } finally {
          state.detailLoading = false;
        }
      };

      const refreshOrders = async (showLoading, force = false) => {
        if (state.refreshInProgress) {
          if (force) state.refreshQueued = true;
          return;
        }

        const now = Date.now();
        if (
          !force &&
          now - state.lastRefreshAt < CUSTOMER_ORDERS_MIN_REFRESH_GAP_MS
        ) {
          return;
        }

        if (!state.token) {
          state.loading = false;
          tabs.forEach((tab) => {
            const countEl = tab.querySelector(".customer-orders-tab-count");
            if (countEl) countEl.textContent = "0";
          });

          panels.forEach((panel) => {
            panel.innerHTML = `
              <div class="customer-orders-empty">
                <i class="fa-regular fa-circle-xmark"></i>
                <p>Session expired. Please login again.</p>
              </div>
            `;
          });
          stopRealtimeRefresh();
          return;
        }

        state.refreshInProgress = true;

        if (showLoading) {
          state.loading = true;
          renderOrders();
        }

        try {
          const orders = await fetchCustomerOrders(state.token);
          state.orders = orders;
          state.lastRefreshAt = Date.now();
          if (state.cacheKey) {
            customerOrdersCache.set(state.cacheKey, orders);
          }
          renderOrders();

          void refreshActiveDetail(false);
        } catch (error) {
          tabs.forEach((tab) => {
            const countEl = tab.querySelector(".customer-orders-tab-count");
            if (countEl) countEl.textContent = "0";
          });

          panels.forEach((panel) => {
            panel.innerHTML = `
              <div class="customer-orders-empty">
                <i class="fa-regular fa-circle-xmark"></i>
                <p>${escapeHtml(error?.message || "Unable to load orders right now.")}</p>
              </div>
            `;
          });
        } finally {
          state.loading = false;
          state.refreshInProgress = false;

          if (state.refreshQueued) {
            state.refreshQueued = false;
            void refreshOrders(false, true);
          }
        }
      };

      tabs.forEach((tab, index) => {
        tab.addEventListener("click", () => {
          setActivePanel(index);
        });
      });

      overlay.addEventListener("click", (event) => {
        const detailBtn = event.target.closest("[data-order-detail]");
        if (detailBtn) {
          const orderId = detailBtn.getAttribute("data-order-detail") || "";
          if (!orderId) return;
          void openOrderDetail(orderId);
          return;
        }

        if (event.target === overlay) {
          close();
        }
      });

      closeBtn?.addEventListener("click", close);
      closeDetailBtn?.addEventListener("click", closeDetailModal);

      document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || !overlay.classList.contains("show"))
          return;
        if (detailModal?.classList.contains("show")) {
          closeDetailModal();
          return;
        }
        close();
      });

      viewport?.addEventListener(
        "touchstart",
        (event) => {
          const touch = event.changedTouches?.[0];
          if (!touch) return;
          state.touchStartX = touch.clientX;
          state.touchStartY = touch.clientY;
        },
        { passive: true },
      );

      viewport?.addEventListener(
        "touchend",
        (event) => {
          const touch = event.changedTouches?.[0];
          if (!touch) return;

          const deltaX = touch.clientX - state.touchStartX;
          const deltaY = touch.clientY - state.touchStartY;

          if (Math.abs(deltaX) < 45 || Math.abs(deltaX) <= Math.abs(deltaY))
            return;
          if (deltaX < 0) {
            setActivePanel(state.activeIndex + 1);
          } else {
            setActivePanel(state.activeIndex - 1);
          }
        },
        { passive: true },
      );

      window.addEventListener("fmrc:orders-updated", (event) => {
        if (!overlay.classList.contains("show")) return;
        const popup = document.getElementById("customerSystemPopup");
        if (popup && popup.classList.contains("show")) return;
        const payload = event?.detail || {};
        if (!shouldProcessRealtimeSignal(payload)) return;
        state.lastDetailRefreshAt = 0;
        void refreshOrders(false, true);
      });

      window.addEventListener("storage", (event) => {
        if (event.key !== ORDERS_REALTIME_SIGNAL_KEY) return;
        if (!overlay.classList.contains("show") || document.hidden) return;
        const popup = document.getElementById("customerSystemPopup");
        if (popup && popup.classList.contains("show")) return;

        let payload = {};
        try {
          payload = JSON.parse(event.newValue || "{}");
        } catch {
          payload = {};
        }
        if (!shouldProcessRealtimeSignal(payload)) return;

        state.lastDetailRefreshAt = 0;
        void refreshOrders(false, true);
      });

      const realtimeChannel = getOrdersRealtimeChannel();
      realtimeChannel?.addEventListener("message", (event) => {
        if (!overlay.classList.contains("show") || document.hidden) return;
        const popup = document.getElementById("customerSystemPopup");
        if (popup && popup.classList.contains("show")) return;
        const payload = event?.data || {};
        if (payload?.source === "customer-portal") return;
        if (!shouldProcessRealtimeSignal(payload)) return;
        state.lastDetailRefreshAt = 0;
        void refreshOrders(false, true);
      });

      document.addEventListener("visibilitychange", () => {
        if (document.hidden || !overlay.classList.contains("show")) return;
        const popup = document.getElementById("customerSystemPopup");
        if (popup && popup.classList.contains("show")) return;
        state.lastDetailRefreshAt = 0;
        void refreshOrders(false, true);
      });

      window.addEventListener("focus", () => {
        if (!overlay.classList.contains("show")) return;
        state.lastDetailRefreshAt = 0;
        void refreshOrders(false, true);
      });

      customerOrdersController = {
        open: async (nextUserInfo) => {
          state.userInfo = nextUserInfo;
          state.cacheKey = String(
            nextUserInfo?.id || nextUserInfo?.email || "customer-orders",
          );
          state.token = localStorage.getItem("customer_token") || "";
          state.detailsById.clear();
          state.refreshQueued = false;
          setActivePanel(0);

          const cachedOrders = customerOrdersCache.get(state.cacheKey);
          if (Array.isArray(cachedOrders) && cachedOrders.length) {
            state.loading = false;
            state.orders = cachedOrders;
            renderOrders();
          }

          overlay.classList.add("show");
          document.body.style.overflow = "hidden";
          await refreshOrders(
            !Array.isArray(cachedOrders) || !cachedOrders.length,
            true,
          );
          startRealtimeRefresh();
        },
      };
    }

    void customerOrdersController.open(activeUserInfo);
  };

  const { token, userInfo, isAuthenticated } = getCustomerSession();

  if (!isAuthenticated) {
    const guestDropdown = document.createElement("div");
    guestDropdown.className = "profile-popup guest-profile-popup";
    guestDropdown.innerHTML = `
      <div class="popup-header">
        <div class="popup-profile-row">
          <span class="popup-profile-icon">?</span>
          <div class="popup-profile-meta">
            <p class="popup-identity">Welcome, Guest</p>
          </div>
        </div>
      </div>
      <p class="guest-popup-copy">Sign in to access your account, orders, and appointments.</p>
      <div class="guest-auth-stack">
        <a href="../customer-auth/auth.html#login" class="guest-auth-btn guest-auth-login">Login</a>
        <div class="guest-auth-or">OR</div>
        <a href="../customer-auth/auth.html#signup" class="guest-auth-btn guest-auth-signup">Sign Up</a>
      </div>
    `;

    userProfileBtn.appendChild(guestDropdown);

    userProfileBtn.addEventListener("click", (event) => {
      if (event.target.closest(".profile-popup")) return;

      if (guestDropdown.classList.contains("show")) {
        hideDropdown(guestDropdown);
      } else {
        guestDropdown.classList.add("show");
      }
    });

    document.addEventListener("click", (event) => {
      if (!userProfileBtn.contains(event.target)) {
        hideDropdown(guestDropdown);
      }
    });

    return;
  }

  const initial = (userInfo.username || userInfo.name || userInfo.email || "U")
    .trim()
    .charAt(0)
    .toUpperCase();

  userProfileBtn.innerHTML = `<span class="user-initial-badge">${initial}</span>`;
  userProfileBtn.classList.add("nav-profile-btn");

  const dropdown = document.createElement("div");
  dropdown.className = "profile-popup";
  dropdown.innerHTML = `
    <div class="popup-header">
      <div class="popup-profile-row">
        <span class="popup-profile-icon profile-initial">${initial}</span>
        <div class="popup-profile-meta">
          <p class="popup-identity">${userInfo.email || userInfo.username || userInfo.name || "User"}</p>
        </div>
      </div>
    </div>
    <a href="#" id="viewProfileBtn" class="profile-popup-link">
      <i class="fa-regular fa-id-card"></i> My Account
    </a>
    <a href="#" id="viewOrdersBtn" class="profile-popup-link">
      <i class="fa-solid fa-box-archive"></i> My Orders
    </a>
    <hr />
    <button type="button" id="logoutBtn" class="logout-btn popup-logout" style="border: none; font-family: inherit;">
      <i class="fa-solid fa-right-from-bracket"></i> Logout
    </button>
  `;

  userProfileBtn.appendChild(dropdown);

  userProfileBtn.addEventListener("click", (event) => {
    // If we click inside the popup (but not the main button itself), do nothing
    if (event.target.closest(".profile-popup")) return;

    if (dropdown.classList.contains("show")) {
      hideDropdown(dropdown);
    } else {
      dropdown.classList.add("show");
    }
  });

  document.addEventListener("click", (event) => {
    if (!userProfileBtn.contains(event.target)) {
      hideDropdown(dropdown);
    }
  });

  dropdown.querySelector("#viewProfileBtn")?.addEventListener("click", () => {
    hideDropdown(dropdown);
    openProfileModal(userInfo, token);
  });

  dropdown
    .querySelector("#viewOrdersBtn")
    ?.addEventListener("click", (event) => {
      event.preventDefault();
      hideDropdown(dropdown);
      openOrdersModal(userInfo);
    });

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

  dropdown.querySelector("#logoutBtn")?.addEventListener("click", async () => {
    hideDropdown(dropdown);
    showLogoutConfirmModal(async () => {
      hideStatus();
      setLoader(true);
      try {
        await fetch(`${API_BASE_URL}/logout`, {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            Accept: "application/json",
          },
        });
      } catch {
        // Token cleanup should still happen locally.
      } finally {
        localStorage.removeItem("customer_token");
        localStorage.removeItem("customer_info");
        setLoader(false);
        showStatus("Logged out successfully.");
        window.location.href = "../customer-auth/auth.html";
      }
    });
  });
})();

// ============================================================================
// DYNAMIC SITE CONTENT LOADER
// ============================================================================
(function () {
  "use strict";

  const _API = (function () {
    if (typeof API_BASE_URL !== "undefined") return API_BASE_URL;
    return "http://127.0.0.1:8000/api";
  })();

  function _txt(id, val) {
    const el = document.getElementById(id);
    if (el && val) el.textContent = val;
  }
  function _html(id, val) {
    const el = document.getElementById(id);
    if (el && val) el.innerHTML = val;
  }
  function _src(id, val) {
    const el = document.getElementById(id);
    if (el && val) el.src = val;
  }
  function _esc(str) {
    const d = document.createElement("div");
    d.textContent = str || "";
    return d.innerHTML;
  }
  function _attr(str) {
    return String(str || "")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  async function loadSiteContent() {
    try {
      const [sRes, svRes] = await Promise.all([
        fetch(_API + "/site-settings"),
        fetch(_API + "/services"),
      ]);
      if (sRes.ok) {
        const { data } = await sRes.json();
        applySettings(data || {});
      }
      if (svRes.ok) {
        const { data } = await svRes.json();
        applyServices(data || []);
      }
    } catch {
      /* silent fallback */
    }
  }

  function applySettings(s) {
    // Hero title
    if (s.hero_title) {
      const el = document.getElementById("heroTitleEl");
      if (el) {
        const lines = s.hero_title.split("\n");
        el.innerHTML = lines
          .map((l, i) =>
            i === lines.length - 1
              ? `<span class="hero-research-line">${_esc(l)}</span>`
              : _esc(l) + "<br />",
          )
          .join("");
      }
    }
    if (s.hero_logo_image) _src("heroLogoEl", s.hero_logo_image);
    // Hero bg
    const heroSec = document.querySelector(".hero-section");
    if (heroSec && s.hero_bg_type === "color" && s.hero_bg_color)
      heroSec.style.background = s.hero_bg_color;
    if (heroSec && s.hero_bg_type === "image" && s.hero_bg_image) {
      heroSec.style.backgroundImage = "url('" + s.hero_bg_image + "')";
      heroSec.style.backgroundSize = "cover";
      heroSec.style.backgroundPosition = "center";
    }
    // About
    _txt("aboutHeadingEl", s.about_heading);
    _html("aboutText1El", s.about_text_1);
    _html("aboutText2El", s.about_text_2);
    if (s.about_video_url) {
      ["aboutVideoSrc", "aboutFullVideoSrc"].forEach(function (id) {
        const src = document.getElementById(id);
        if (src) {
          src.src = s.about_video_url;
          src.parentElement &&
            src.parentElement.load &&
            src.parentElement.load();
        }
      });
    }
    // Vision / Mission
    _txt("visionHeadingEl", s.vision_heading);
    _txt("visionTextEl", s.vision_text);
    if (s.vision_image) _src("visionImgEl", s.vision_image);
    _txt("missionHeadingEl", s.mission_heading);
    _txt("missionTextEl", s.mission_text);
    if (s.mission_image) _src("missionImgEl", s.mission_image);
    // Footer
    _txt("footerBrandNameEl", s.footer_brand_name);
    _txt("footerBrandDescEl", s.footer_brand_desc);
    _txt("footerHoursDaysEl", s.footer_hours_days);
    _txt("footerHoursTimeEl", s.footer_hours_time);
    _txt("footerCopyrightEl", s.footer_copyright);
    if (s.footer_quick_links) {
      try {
        var links = JSON.parse(s.footer_quick_links);
        var ul = document.getElementById("footerQuickLinksEl");
        if (ul && links.length)
          ul.innerHTML = links
            .map(function (l) {
              return (
                '<li><a href="' +
                _attr(l.url || "#") +
                '">' +
                _esc(l.label || "") +
                "</a></li>"
              );
            })
            .join("");
      } catch (e) {}
    }
    var fLoc = document.getElementById("footerLocationLink");
    if (fLoc) {
      if (s.footer_contact_location)
        fLoc.textContent = s.footer_contact_location;
      if (s.footer_contact_location_url)
        fLoc.href = s.footer_contact_location_url;
    }
    var fEmail = document.getElementById("footerEmailLink");
    if (fEmail && s.footer_contact_email) {
      fEmail.textContent = s.footer_contact_email;
      fEmail.href = "mailto:" + s.footer_contact_email;
    }
    var fPhone = document.getElementById("footerPhoneLink");
    if (fPhone && s.footer_contact_phone) {
      fPhone.textContent = s.footer_contact_phone;
      fPhone.href = "tel:" + s.footer_contact_phone.replace(/[\s-]/g, "");
    }
    var fFb = document.getElementById("footerFacebookLink");
    if (fFb) {
      if (s.footer_contact_facebook)
        fFb.textContent = s.footer_contact_facebook;
      if (s.footer_contact_facebook_url)
        fFb.href = s.footer_contact_facebook_url;
    }
    // Contact page
    _txt("contactTitleEl", s.contact_heading);
    _txt("contactLeadEl", s.contact_lead);
    var cLoc = document.getElementById("contactLocationLink");
    if (cLoc) {
      if (s.contact_location) cLoc.textContent = s.contact_location;
      if (s.contact_location_url) cLoc.href = s.contact_location_url;
    }
    var cEmail = document.getElementById("contactEmailLink");
    if (cEmail && s.contact_email) {
      cEmail.textContent = s.contact_email;
      cEmail.href = "mailto:" + s.contact_email;
    }
    var cPhone = document.getElementById("contactPhoneLink");
    if (cPhone && s.contact_phone) {
      cPhone.textContent = s.contact_phone;
      cPhone.href = "tel:" + s.contact_phone.replace(/[\s-]/g, "");
    }
    var cFb = document.getElementById("contactFacebookLink");
    if (cFb) {
      if (s.contact_facebook) cFb.textContent = s.contact_facebook;
      if (s.contact_facebook_url) cFb.href = s.contact_facebook_url;
    }
    _txt("contactFormHeadingEl", s.contact_form_heading);
    _txt("contactFormSubtitleEl", s.contact_form_subtitle);
    _txt(
      "contactConsentTextEl",
      s.contact_consent_text ||
        "I hereby consent to the collection, processing, and storage of my personal information in accordance with the Data Privacy Act of 2012 (R.A. 10173).",
    );
  }

  function applyServices(services) {
    // Home carousel
    var track = document.getElementById("whatWeOfferTrack");
    if (track && services.length) {
      track.innerHTML = services
        .map(function (s) {
          return (
            '<div class="carousel-item"><div class="service-card landscape-card" data-service-id="' +
            s.id +
            '" data-category="' +
            _attr(s.category || "") +
            '">' +
            '<div class="card-img-holder">' +
            (s.image_data
              ? '<img src="' +
                _attr(s.image_data) +
                '" alt="' +
                _attr(s.title) +
                '" />'
              : '<div style="width:100%;height:100%;background:#f3f4f6;display:flex;align-items:center;justify-content:center;"><span style="color:#9ca3af;font-size:.78rem;">No image</span></div>') +
            "</div>" +
            '<div class="card-content"><h3 class="card-title">' +
            _esc(s.title) +
            '</h3><p class="card-desc">' +
            _esc(s.description || "") +
            "</p></div>" +
            "</div></div>"
          );
        })
        .join("");
      initCarousel(track);
    }
    // Services page grid
    var grid = document.getElementById("servicesGrid");
    if (grid && services.length) {
      grid.innerHTML = services
        .map(function (s) {
          return (
            '<article class="service-card" data-category="' +
            _attr((s.category || "").toLowerCase().replace(/\s+/g, "-")) +
            '">' +
            '<div class="card-img-holder">' +
            (s.image_data
              ? '<img src="' +
                _attr(s.image_data) +
                '" alt="' +
                _attr(s.title) +
                '" />'
              : '<div style="width:100%;height:100%;background:#f3f4f6;display:flex;align-items:center;justify-content:center;"><span style="color:#9ca3af;">No image</span></div>') +
            "</div>" +
            '<div class="card-content"><span class="service-chip">' +
            _esc(s.category) +
            '</span><h3 class="card-title">' +
            _esc(s.title) +
            '</h3><p class="card-desc">' +
            _esc(s.description || "") +
            "</p>" +
            '<button class="details-btn open-modal-btn" style="background:none;border:none;cursor:pointer;padding:0;text-align:left;display:inline-flex;align-items:center;gap:4px;" data-title="' +
            _attr(s.title) +
            '" data-desc="' +
            _attr(s.modal_description || s.description || "") +
            '" data-features="' +
            _attr(JSON.stringify(s.modal_features || [])) +
            '" data-materials="' +
            _attr(JSON.stringify(s.modal_materials || [])) +
            '" data-best-for="' +
            _attr(JSON.stringify(s.modal_best_for || [])) +
            '" data-img="' +
            _attr(s.image_data || "") +
            '">View service details</button>' +
            "</div></article>"
          );
        })
        .join("");
    }
  }

  function initCarousel(track) {
    var items = Array.from(track.querySelectorAll(".carousel-item"));
    var prevEl = document.querySelector(".prev-btn");
    var nextEl = document.querySelector(".next-btn");
    var wrapper = document.querySelector(".carousel-wrapper");
    if (!items.length || !prevEl || !nextEl || !wrapper) return;
    var cur = 0,
      timer;
    function upd() {
      items.forEach(function (it, i) {
        it.className = "carousel-item";
        if (i === cur) it.classList.add("active");
        else if (i === (cur - 1 + items.length) % items.length)
          it.classList.add("prev");
        else if (i === (cur + 1) % items.length) it.classList.add("next");
        else if (i === (cur - 2 + items.length) % items.length)
          it.classList.add("prev-hidden");
        else if (i === (cur + 2) % items.length)
          it.classList.add("next-hidden");
      });
    }
    function nxt() {
      cur = (cur + 1) % items.length;
      upd();
    }
    function prv() {
      cur = (cur - 1 + items.length) % items.length;
      upd();
    }
    var nn = nextEl.cloneNode(true),
      np = prevEl.cloneNode(true);
    nextEl.parentNode.replaceChild(nn, nextEl);
    prevEl.parentNode.replaceChild(np, prevEl);
    nn.addEventListener("click", function () {
      nxt();
      clearInterval(timer);
      timer = setInterval(nxt, 5000);
    });
    np.addEventListener("click", function () {
      prv();
      clearInterval(timer);
      timer = setInterval(nxt, 5000);
    });
    items.forEach(function (it) {
      it.addEventListener("click", function () {
        if (it.classList.contains("prev")) prv();
        else if (it.classList.contains("next")) nxt();
      });
    });
    wrapper.addEventListener("mouseenter", function () {
      clearInterval(timer);
    });
    wrapper.addEventListener("mouseleave", function () {
      timer = setInterval(nxt, 5000);
    });
    upd();
    timer = setInterval(nxt, 5000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadSiteContent);
  } else {
    loadSiteContent();
  }
})();
