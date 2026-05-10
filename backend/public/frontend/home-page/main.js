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
const API_REQUEST_TIMEOUT_MS = 15000;
const ORDERS_REALTIME_SIGNAL_KEY = "fmrc_orders_updated_at";
const ORDERS_REALTIME_CHANNEL = "fmrc-orders-realtime";
const CUSTOMER_ORDERS_FALLBACK_SYNC_MS = 6000;
const CUSTOMER_ORDERS_MIN_REFRESH_GAP_MS = 2500;

let ordersRealtimeChannel = null;

const getOrdersRealtimeChannel = () => {
  if (typeof window.BroadcastChannel !== "function") return null;
  if (!ordersRealtimeChannel) {
    ordersRealtimeChannel = new window.BroadcastChannel(ORDERS_REALTIME_CHANNEL);
  }
  return ordersRealtimeChannel;
};

const resolveApiBaseUrl = () => {
  const configured =
    window.APP_API_BASE_URL ||
    document.querySelector('meta[name="api-base-url"]')?.getAttribute("content") ||
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

  window.dispatchEvent(new CustomEvent("fmrc:orders-updated", { detail: payload }));

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

  if (siteHeader && mainNav && logoContainer && !document.querySelector(".mobile-menu-toggle")) {
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
    sidebarBrand.href = logoContainer.getAttribute("href") || "/home-page/main.html";
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

      modal.querySelector("#closeGuestAccessModal")?.addEventListener("click", () => {
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
  const modalImage = document.getElementById("modalImage"); // Grab the new modal image element

  document.body.addEventListener("click", function (e) {
    // Open Modal logic
    const openBtn = e.target.closest(".open-modal-btn");
    if (openBtn) {
      if (modal) {
        // Find the specific card that was clicked
        const card = openBtn.closest(".service-card");

        if (card) {
          // 1. Update Title
          if (modalTitle) {
            const title = card.querySelector(".card-title").innerText;
            modalTitle.innerText = title;
          }

          // 2. Update Image
          if (modalImage) {
            const cardImg = card.querySelector(".card-img-holder img");
            if (cardImg) {
              modalImage.src = cardImg.src;
              modalImage.alt = cardImg.alt;
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
        document.body.style.overflow = ""; // Resets to CSS
      }
    }

    // Close Modal by clicking the dark overlay background
    if (e.target === modal) {
      modal.classList.remove("show-modal");
      document.body.style.overflow = ""; // Resets to CSS
    }
  });

  // =========================================
  // SERVICES LIST FILTERING LOGIC
  // =========================================
  const isServicesPage = document.body.classList.contains("services-page-body");

  if (isServicesPage) {
    const searchInput = document.querySelector(".toolbar-search .search-input");
    const categorySelect = document.querySelector(".category-select");
    const serviceCards = Array.from(document.querySelectorAll(".services-grid .service-card"));

    const normalize = (value) => String(value || "").toLowerCase().trim();

    const applyServiceFilters = () => {
      const query = normalize(searchInput?.value || "");
      const selectedCategory = normalize(categorySelect?.value || "all");

      serviceCards.forEach((card) => {
        const title = normalize(card.querySelector(".card-title")?.textContent || "");
        const desc = normalize(card.querySelector(".card-desc")?.textContent || "");
        const category = normalize(card.dataset.category || "");

        const matchesSearch = !query || title.includes(query) || desc.includes(query);
        const matchesCategory = selectedCategory === "all" || category === selectedCategory;
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
          } else if (index === (currentIndex - 1 + items.length) % items.length) {
            item.classList.add("prev");
          } else if (index === (currentIndex + 1) % items.length) {
            item.classList.add("next");
          } else if (index === (currentIndex - 2 + items.length) % items.length) {
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

      wrapper.addEventListener("mouseenter", () => clearInterval(autoPlayInterval));
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
    const closeProductInfoModal = document.getElementById("closeProductInfoModal");
    const productInfoTitle = document.getElementById("productInfoTitle");
    const productInfoImage = document.getElementById("productInfoImage");
    const productInfoSummary = document.getElementById("productInfoSummary");
    const productInfoChips = document.getElementById("productInfoChips");
    const productInfoAvailability = document.getElementById("productInfoAvailability");
    const productInfoRecommended = document.getElementById("productInfoRecommended");
    const productInfoAddToCart = document.getElementById("productInfoAddToCart");
    const productInfoBuyNow = document.getElementById("productInfoBuyNow");

    let activeProductCard = null;

    const getCategoryFromName = (name) => {
      const normalized = name.toLowerCase();
      if (normalized.includes("laser")) return "laser";
      if (normalized.includes("heat press") || normalized.includes("shirt"))
        return "apparel";
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
      const nameText = nameEl ? nameEl.innerText.trim() : `Product ${index + 1}`;
      const inferredCategory = getCategoryFromName(nameText);

      card.dataset.category = card.dataset.category || inferredCategory;
      card.dataset.userRating = card.dataset.userRating || "4";

      const productInfo = card.querySelector(".product-info");
      const priceEl = card.querySelector(".product-price");

      if (productInfo && priceEl && !card.querySelector(".product-rating-row")) {
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
        const addBtn = activeProductCard?.querySelector(".btn-add-cart:not(.disabled)");
        if (addBtn) {
          closeInfoModal();
          addBtn.click();
        }
      });
    }

    if (productInfoBuyNow) {
      productInfoBuyNow.addEventListener("click", () => {
        const buyBtn = activeProductCard?.querySelector(".btn-buy-now:not(.disabled)");
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
        const nameText = card.querySelector(".product-name")?.innerText.toLowerCase() || "";
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

      if (selectedFilter === "price-low" || selectedFilter === "price-high" || selectedFilter === "top-rated") {
        const visibleCards = cards.filter((card) => card.style.display !== "none");

        visibleCards.sort((a, b) => {
          if (selectedFilter === "top-rated") {
            return (
              parseInt(b.dataset.userRating || "4") -
              parseInt(a.dataset.userRating || "4")
            );
          }

          const getPrice = (cardEl) => {
            const priceText = cardEl.querySelector(".product-price")?.innerText || "₱0";
            return parseFloat(priceText.replace(/[^0-9.]/g, ""));
          };

          const priceA = getPrice(a);
          const priceB = getPrice(b);
          return selectedFilter === "price-low" ? priceA - priceB : priceB - priceA;
        });

        visibleCards.forEach((card) => shopGrid.appendChild(card));
      }
    };

    if (searchInput) searchInput.addEventListener("input", applyProductFilters);
    if (categorySelect)
      categorySelect.addEventListener("change", applyProductFilters);
    if (filterSelect) filterSelect.addEventListener("change", applyProductFilters);

    applyProductFilters();
  }

  // =========================================
  // E-COMMERCE CHECKOUT LOGIC (3-STEP FLOW)
  // =========================================
  if (document.body.classList.contains("products-page-body")) {
    const checkoutModal = document.getElementById("checkoutModal");
    const addressSelectionModal = document.getElementById("addressSelectionModal");
    const editInfoModal = document.getElementById("editInfoModal");
    const addInfoModal = document.getElementById("addInfoModal");

    const checkoutImg = document.getElementById("checkoutProductImg");
    const checkoutTitle = document.getElementById("checkoutProductTitle");
    const checkoutPrice = document.getElementById("checkoutProductPrice");
    const checkoutSubtotal = document.getElementById("checkoutSubtotal");
    const checkoutGrandTotal = document.getElementById("checkoutGrandTotal");
    const footerTotalDisplay = document.getElementById("footerTotalDisplay");
    const checkoutMaxStock = document.getElementById("checkoutMaxStock");
    const footerItemCount = document.getElementById("footerItemCount");
    const paymentSelect = document.querySelector("#checkoutModal .payment-select");
    const orderTermsCheckbox = document.getElementById("orderTerms");

    const inputQty = document.getElementById("inputQty");
    const btnMinusQty = document.getElementById("btnMinusQty");
    const btnPlusQty = document.getElementById("btnPlusQty");
    const protectionCheck = document.getElementById("protectionCheck");

    const guideImg = document.getElementById("guideProductImg");
    const guideTitle = document.getElementById("guideProductTitle");
    const guideImgAdd = document.getElementById("guideProductImgAdd");
    const guideTitleAdd = document.getElementById("guideProductTitleAdd");

    const openAddressSelectionBtn = document.getElementById("openAddressSelectionBtn");
    const backToCheckoutFromAddressBtn = document.getElementById("backToCheckoutFromAddressBtn");
    const openAddAddressBtn = document.getElementById("openAddAddressBtn");
    const backToAddressBtn = document.getElementById("backToAddressBtn");
    const backToAddressFromAddBtn = document.getElementById("backToAddressFromAddBtn");
    const saveInfoBtn = document.getElementById("saveInfoBtn");
    const saveNewInfoBtn = document.getElementById("saveNewInfoBtn");
    const deleteAddressBtn = document.getElementById("deleteAddressBtn");
    const submitOrderBtn = document.getElementById("submitOrderBtn");

    const displayClientName = document.getElementById("displayClientName");
    const displayClientPhone = document.getElementById("displayClientPhone");
    const displayClientAddress = document.getElementById("displayClientAddress");
    const displayClientRole = document.getElementById("displayClientRole");
    const displayClientDept = document.getElementById("displayClientDept");
    const cartShortAddressText = document.getElementById("cartShortAddressText");
    const addressList = document.getElementById("addressList");

    const cartIconTrigger = document.querySelector(".cart-icon-container");
    const cartModal = document.getElementById("cartModal");
    const closeCartBtn = document.getElementById("closeCartBtn");
    const cartItemsContainer = document.getElementById("cartItemsContainer");
    const headerCartBadge = document.querySelector(".cart-badge");
    const cartHeaderCount = document.getElementById("cartHeaderCount");
    const selectAllCartBtn = document.getElementById("selectAllCartBtn");
    const cartEditBtn = document.getElementById("cartEditBtn");
    const cartCheckoutView = document.getElementById("cartCheckoutView");
    const cartDeleteView = document.getElementById("cartDeleteView");
    const cartDeleteBtn = document.getElementById("cartDeleteBtn");
    const cartAddressTrigger = document.getElementById("cartAddressTrigger");
    const cartCheckoutSubmitBtn = document.getElementById("cartCheckoutSubmitBtn");
    const cartTotalPrice = document.getElementById("cartTotalPrice");

    const closeCheckoutBtn = document.getElementById("closeCheckoutBtn");
    const buyNowBtns = document.querySelectorAll(".btn-buy-now:not(.disabled)");
    const addToCartBtns = document.querySelectorAll(".btn-add-cart:not(.disabled)");

    let currentItemPrice = 0;
    let currentMaxStock = 1;
    const protectionFee = 5.0;

    let checkoutSource = "product";
    let checkoutCartItemIds = [];

    let isCartEditMode = false;
    let cartEntries = [];
    let cartRealtimeTimer = null;

    let customerAddresses = [];
    let selectedAddressId = null;
    let editingAddressId = null;

    const escapeHtml = (value) =>
      String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");

    const parsePrice = (priceStr) => {
      const parsed = Number.parseFloat(String(priceStr || "0").replace(/[^0-9.-]+/g, ""));
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const formatPrice = (num) => {
      const safe = Number.isFinite(Number(num)) ? Number(num) : 0;
      return `₱${safe.toFixed(2)}`;
    };

    const normalizePhoneDigits = (value) => {
      let digits = String(value || "").replace(/\D/g, "");
      if (digits.startsWith("63") && digits.length > 10) {
        digits = digits.slice(2);
      }
      if (digits.startsWith("0") && digits.length === 11) {
        digits = digits.slice(1);
      }
      return digits;
    };

    const formatPhoneDisplay = (digits) => {
      const normalized = normalizePhoneDigits(digits);
      return normalized ? `+63${normalized}` : "";
    };

    const formatPhoneMasked = (digits) => {
      const normalized = normalizePhoneDigits(digits);
      if (!normalized) return "";
      if (normalized.length <= 4) return `(+63)${normalized}`;
      return `(+63)${normalized.slice(0, 2)}******${normalized.slice(-2)}`;
    };

    const toPaymentMethodCode = (value) => {
      const normalized = String(value || "").trim().toLowerCase();
      if (!normalized || normalized.includes("choose")) return null;
      if (normalized.includes("pickup")) return "COP";
      if (normalized.includes("delivery")) return "COD";
      if (normalized.includes("gcash") || normalized.includes("g-cash")) return "GCash";
      return null;
    };

    const getCustomerToken = () => customerSession.token || localStorage.getItem("customer_token") || "";

    const ensureShopDialog = () => {
      let overlay = document.getElementById("shopDialogOverlay");
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "shopDialogOverlay";
        overlay.className = "shop-dialog-overlay";
        overlay.innerHTML = `
          <div class="shop-dialog-card" role="dialog" aria-modal="true" aria-labelledby="shopDialogTitle">
            <h3 id="shopDialogTitle" class="shop-dialog-title">Notice</h3>
            <p id="shopDialogMessage" class="shop-dialog-message"></p>
            <div class="shop-dialog-actions">
              <button type="button" id="shopDialogCancel" class="shop-dialog-btn cancel">Cancel</button>
              <button type="button" id="shopDialogConfirm" class="shop-dialog-btn confirm">OK</button>
            </div>
          </div>
        `;
        document.body.appendChild(overlay);
      }
      return {
        overlay,
        title: overlay.querySelector("#shopDialogTitle"),
        message: overlay.querySelector("#shopDialogMessage"),
        cancel: overlay.querySelector("#shopDialogCancel"),
        confirm: overlay.querySelector("#shopDialogConfirm"),
      };
    };

    const showShopDialog = ({
      title = "Notice",
      message = "",
      confirmText = "OK",
      cancelText = "",
      danger = false,
    }) =>
      new Promise((resolve) => {
        const dialog = ensureShopDialog();

        dialog.title.textContent = title;
        dialog.message.textContent = message;
        dialog.confirm.textContent = confirmText;
        dialog.confirm.classList.toggle("danger", Boolean(danger));

        const hasCancel = Boolean(cancelText);
        dialog.cancel.textContent = cancelText || "Cancel";
        dialog.cancel.style.display = hasCancel ? "inline-flex" : "none";

        const close = (result) => {
          dialog.overlay.classList.remove("show");
          dialog.confirm.onclick = null;
          dialog.cancel.onclick = null;
          dialog.overlay.onclick = null;
          resolve(result);
        };

        dialog.confirm.onclick = () => close(true);
        dialog.cancel.onclick = () => close(false);
        dialog.overlay.onclick = (event) => {
          if (event.target === dialog.overlay) {
            close(hasCancel ? false : true);
          }
        };

        dialog.overlay.classList.add("show");
      });

    const showShopAlert = (message, options = {}) =>
      showShopDialog({
        title: options.title || "Notice",
        message,
        confirmText: options.confirmText || "OK",
      });

    const showShopConfirm = (message, options = {}) =>
      showShopDialog({
        title: options.title || "Please Confirm",
        message,
        confirmText: options.confirmText || "Confirm",
        cancelText: options.cancelText || "Cancel",
        danger: Boolean(options.danger),
      });

    const requestCustomerApi = async (path, options = {}) => {
      const token = getCustomerToken();
      if (!token) {
        throw new Error("Login session not found. Please sign in again.");
      }

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);

      const hasBody = Object.prototype.hasOwnProperty.call(options, "body");
      const headers = {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      };

      if (hasBody) {
        headers["Content-Type"] = "application/json";
      }

      try {
        const response = await fetch(`${API_BASE_URL}${path}`, {
          method: options.method || "GET",
          headers,
          body: hasBody ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.message || "Unable to process your request right now.");
        }

        return data;
      } catch (error) {
        if (error?.name === "AbortError") {
          throw new Error("Request timed out. Please try again.");
        }
        throw error;
      } finally {
        window.clearTimeout(timeoutId);
      }
    };

    const getAddressById = (id) =>
      customerAddresses.find((address) => Number(address.id) === Number(id)) || null;

    const getSelectedAddress = () => {
      if (selectedAddressId) {
        const selected = getAddressById(selectedAddressId);
        if (selected) return selected;
      }
      return customerAddresses.find((address) => Boolean(address.is_default)) || customerAddresses[0] || null;
    };

    const toAddressDisplayHtml = (address) => {
      const lines = [address?.address_line, address?.address_details]
        .filter(Boolean)
        .join("\n");
      return escapeHtml(lines || "No address provided").replace(/\n/g, "<br>");
    };

    const updateSelectedAddressDisplay = () => {
      const selectedAddress = getSelectedAddress();

      if (!selectedAddress) {
        if (displayClientName) displayClientName.innerText = "Select delivery details";
        if (displayClientPhone) displayClientPhone.innerText = "";
        if (displayClientAddress) {
          displayClientAddress.innerHTML = "No saved address yet. Add details to continue.";
        }
        if (displayClientRole) displayClientRole.innerText = "Customer";
        if (displayClientDept) displayClientDept.innerText = "N/A";
        if (cartShortAddressText) cartShortAddressText.innerText = "No address selected";
        return;
      }

      selectedAddressId = Number(selectedAddress.id);

      if (displayClientName) {
        displayClientName.innerText = selectedAddress.full_name || "Customer";
      }
      if (displayClientPhone) {
        displayClientPhone.innerText =
          selectedAddress.phone_masked || formatPhoneMasked(selectedAddress.phone || "");
      }
      if (displayClientAddress) {
        displayClientAddress.innerHTML = toAddressDisplayHtml(selectedAddress);
      }
      if (displayClientRole) {
        displayClientRole.innerText = selectedAddress.role || "Customer";
      }
      if (displayClientDept) {
        displayClientDept.innerText = selectedAddress.department || "N/A";
      }
      if (cartShortAddressText) {
        const shortAddress = String(selectedAddress.address_line || "")
          .split(/[\n,]/)
          .map((part) => part.trim())
          .filter(Boolean)[0];
        cartShortAddressText.innerText = shortAddress || "Address selected";
      }
    };

    const renderAddressList = () => {
      if (!addressList) return;

      if (!customerAddresses.length) {
        addressList.innerHTML = `
          <div class="address-item address-item-empty">
            <div class="address-item-left">
              <div class="a-address-text">No saved address yet. Tap <strong>Add details</strong> to create one.</div>
            </div>
          </div>
        `;
        return;
      }

      addressList.innerHTML = customerAddresses
        .map((address) => {
          const isSelected = Number(address.id) === Number(selectedAddressId);
          return `
            <div class="address-item${isSelected ? " selected" : ""}" data-address-id="${Number(address.id)}">
              <div class="address-item-left">
                <div class="address-name-row">
                  <span class="a-name">${escapeHtml(address.full_name || "Customer")}</span>
                  <span class="a-phone">${escapeHtml(address.phone_masked || formatPhoneMasked(address.phone || ""))}</span>
                </div>
                <div class="a-address-text">${toAddressDisplayHtml(address)}</div>
                <div class="a-badges">
                  ${address.is_default ? '<span class="a-badge default-badge">Default</span>' : ""}
                </div>
              </div>
              <div class="address-item-right">
                <button class="edit-address-btn" data-address-edit="${Number(address.id)}">Edit</button>
              </div>
            </div>
          `;
        })
        .join("");
    };

    const openAddressModal = async () => {
      if (!addressSelectionModal) return;
      await loadAddresses({ silent: false });
      addressSelectionModal.classList.add("show-modal");
    };

    const closeAddressModal = () => {
      if (!addressSelectionModal) return;
      addressSelectionModal.classList.remove("show-modal");
    };

    const hydrateGuideMedia = (imgSrc, titleText) => {
      if (guideImg && imgSrc) guideImg.src = imgSrc;
      if (guideTitle && titleText) guideTitle.innerText = titleText;
      if (guideImgAdd && imgSrc) guideImgAdd.src = imgSrc;
      if (guideTitleAdd && titleText) guideTitleAdd.innerText = titleText;
    };

    const getAddressFormData = (formType) => {
      const isEdit = formType === "edit";
      const fullNameInput = document.getElementById(isEdit ? "inpFullName" : "addInpFullName");
      const phoneInput = document.getElementById(isEdit ? "inpPhone" : "addInpPhone");
      const addressInput = document.getElementById(isEdit ? "inpAddress" : "addInpAddress");
      const detailsInput = document.getElementById(isEdit ? "inpDetails" : "addInpDetails");
      const deptInput = document.getElementById(isEdit ? "inpDept" : "addInpDept");
      const defaultInput = document.getElementById(isEdit ? "inpSetDefault" : "addInpSetDefault");

      const roleRadio = document.querySelector(
        isEdit ? 'input[name="userRole"]:checked' : 'input[name="addUserRole"]:checked',
      );

      const fullName = String(fullNameInput?.value || "").trim();
      const phoneDigits = normalizePhoneDigits(phoneInput?.value || "");
      const addressLine = String(addressInput?.value || "").trim();

      if (!fullName) {
        fullNameInput?.focus();
        return { error: "Please enter the recipient name." };
      }
      if (phoneDigits.length < 10 || phoneDigits.length > 11) {
        phoneInput?.focus();
        return { error: "Please enter a valid PH phone number." };
      }
      if (!addressLine) {
        addressInput?.focus();
        return { error: "Please enter your delivery address." };
      }

      return {
        full_name: fullName,
        phone: phoneDigits,
        address_line: addressLine,
        address_details: String(detailsInput?.value || "").trim() || null,
        department: String(deptInput?.value || "").trim() || null,
        role: roleRadio?.value || "Customer",
        is_default: Boolean(defaultInput?.checked),
      };
    };

    const openEditAddressModal = (address) => {
      if (!editInfoModal || !address) return;
      editingAddressId = Number(address.id);

      const fullNameInput = document.getElementById("inpFullName");
      const phoneInput = document.getElementById("inpPhone");
      const addressInput = document.getElementById("inpAddress");
      const detailsInput = document.getElementById("inpDetails");
      const deptInput = document.getElementById("inpDept");
      const defaultInput = document.getElementById("inpSetDefault");

      if (fullNameInput) fullNameInput.value = address.full_name || "";
      if (phoneInput) phoneInput.value = normalizePhoneDigits(address.phone || "");
      if (addressInput) addressInput.value = address.address_line || "";
      if (detailsInput) detailsInput.value = address.address_details || "";
      if (deptInput) deptInput.value = address.department || "";
      if (defaultInput) defaultInput.checked = Boolean(address.is_default);

      const role = address.role || "Student";
      const radios = document.querySelectorAll('input[name="userRole"]');
      let roleMatched = false;
      radios.forEach((radio) => {
        const shouldCheck = radio.value === role;
        radio.checked = shouldCheck;
        if (shouldCheck) roleMatched = true;
      });
      if (!roleMatched) {
        const fallback = document.querySelector('input[name="userRole"][value="Others"]');
        if (fallback) fallback.checked = true;
      }

      editInfoModal.classList.add("show-modal");
    };

    const openAddAddressModal = () => {
      if (!addInfoModal) return;
      const fullNameInput = document.getElementById("addInpFullName");
      const phoneInput = document.getElementById("addInpPhone");
      const addressInput = document.getElementById("addInpAddress");
      const detailsInput = document.getElementById("addInpDetails");
      const deptInput = document.getElementById("addInpDept");
      const defaultInput = document.getElementById("addInpSetDefault");

      if (fullNameInput) {
        fullNameInput.value = customerSession.userInfo?.name || customerSession.userInfo?.username || "";
      }
      if (phoneInput) phoneInput.value = "";
      if (addressInput) addressInput.value = "";
      if (detailsInput) detailsInput.value = "";
      if (deptInput) deptInput.value = "";
      if (defaultInput) defaultInput.checked = customerAddresses.length === 0;

      const radios = document.querySelectorAll('input[name="addUserRole"]');
      radios.forEach((radio) => {
        radio.checked = radio.value === "Student";
      });

      addInfoModal.classList.add("show-modal");
    };

    const loadAddresses = async ({ silent = true } = {}) => {
      if (!getCustomerToken()) {
        customerAddresses = [];
        selectedAddressId = null;
        renderAddressList();
        updateSelectedAddressDisplay();
        return;
      }

      try {
        const data = await requestCustomerApi("/customer/addresses");
        customerAddresses = Array.isArray(data?.data) ? data.data : [];

        if (!customerAddresses.length) {
          selectedAddressId = null;
        } else if (selectedAddressId && getAddressById(selectedAddressId)) {
          // Keep active selection.
        } else if (data?.selected_address_id && getAddressById(data.selected_address_id)) {
          selectedAddressId = Number(data.selected_address_id);
        } else {
          selectedAddressId = Number(
            customerAddresses.find((address) => Boolean(address.is_default))?.id || customerAddresses[0].id,
          );
        }

        renderAddressList();
        updateSelectedAddressDisplay();
      } catch (error) {
        if (!silent) {
          await showShopAlert(error?.message || "Unable to load your saved addresses.", {
            title: "Address Error",
          });
        }
      }
    };

    const renderCartTotals = () => {
      const selected = cartEntries.filter((item) => Boolean(item.selected));
      const selectedTotal = selected.reduce(
        (sum, item) => sum + Number(item.unit_price || 0) * Number(item.quantity || 0),
        0,
      );
      const badgeCount = cartEntries.reduce(
        (sum, item) => sum + Math.max(1, Number.parseInt(String(item.quantity || "1"), 10) || 1),
        0,
      );

      if (cartTotalPrice) cartTotalPrice.innerText = formatPrice(selectedTotal);
      if (cartHeaderCount) cartHeaderCount.innerText = String(cartEntries.length);
      if (headerCartBadge) headerCartBadge.innerText = String(badgeCount);

      if (selectAllCartBtn) {
        selectAllCartBtn.checked = cartEntries.length > 0 && cartEntries.every((item) => Boolean(item.selected));
      }
    };

    const renderCartItems = () => {
      if (!cartItemsContainer) return;

      if (!cartEntries.length) {
        cartItemsContainer.innerHTML = `
          <div
            class="empty-cart-message"
            id="emptyCartMessage"
            style="text-align: center; padding: 40px 20px; color: #888; font-size: 14px;"
          >
            Your cart is empty.
          </div>
        `;
        renderCartTotals();
        return;
      }

      cartItemsContainer.innerHTML = cartEntries
        .map((item) => {
          const quantity = Math.max(1, Number.parseInt(String(item.quantity || "1"), 10) || 1);
          const unitPrice = Number(item.unit_price || 0);
          return `
            <div class="cart-item-card" data-cart-id="${Number(item.id)}">
              <label class="cart-checkbox-container">
                <input type="checkbox" class="cart-item-check" ${item.selected ? "checked" : ""}>
                <span class="cart-checkmark"></span>
              </label>
              <div class="cart-item-img">
                <img src="${escapeHtml(item.product_image || "/images/FMRC Logo.png")}" alt="Product">
              </div>
              <div class="cart-item-details">
                <h4>${escapeHtml(item.product_name || "Custom Product")}</h4>
                <div class="cart-item-bottom">
                  <span class="c-price" data-price="${unitPrice}">${escapeHtml(item.unit_price_label || formatPrice(unitPrice))}</span>
                  <div class="qty-selector">
                    <button type="button" class="qty-btn c-minus-btn">-</button>
                    <input type="number" class="c-qty-input" value="${quantity}" min="1" max="99" readonly>
                    <button type="button" class="qty-btn c-plus-btn">+</button>
                  </div>
                </div>
              </div>
            </div>
          `;
        })
        .join("");

      renderCartTotals();
    };

    const loadCart = async ({ silent = true } = {}) => {
      if (!getCustomerToken()) {
        cartEntries = [];
        renderCartItems();
        return;
      }

      try {
        const data = await requestCustomerApi("/customer/cart");
        cartEntries = Array.isArray(data?.data) ? data.data : [];
        renderCartItems();
      } catch (error) {
        if (!silent) {
          await showShopAlert(error?.message || "Unable to load your cart right now.", {
            title: "Cart Error",
          });
        }
      }
    };

    const updateCheckoutMath = () => {
      if (!inputQty) return;

      const qty = Math.max(1, Number.parseInt(String(inputQty.value || "1"), 10) || 1);
      let total = currentItemPrice * qty;

      if (protectionCheck?.checked) {
        total += protectionFee;
      }

      if (checkoutSubtotal) checkoutSubtotal.innerText = formatPrice(currentItemPrice * qty);
      if (checkoutGrandTotal) checkoutGrandTotal.innerText = formatPrice(total);
      if (footerTotalDisplay) footerTotalDisplay.innerText = formatPrice(total);
      if (footerItemCount) footerItemCount.innerText = String(qty);
    };

    const openCheckoutModal = () => {
      if (!checkoutModal) return;
      checkoutModal.classList.add("show-modal");
      document.body.style.overflow = "hidden";
    };

    const closeCheckoutModal = () => {
      if (!checkoutModal) return;
      checkoutModal.classList.remove("show-modal");
      document.body.style.overflow = "";
    };

    const closeCartModal = () => {
      if (!cartModal) return;
      cartModal.classList.remove("show-modal");
      document.body.style.overflow = "";
    };

    const readStockLimit = (card) => {
      const stockText = card.querySelector(".stock-text")?.innerText || "";
      if (stockText.toLowerCase().includes("unlimited")) return 9999;
      const stock = Number.parseInt(stockText.replace(/[^0-9]/g, ""), 10);
      return Number.isInteger(stock) && stock > 0 ? stock : 9999;
    };

    const openCheckoutForProductCard = (card) => {
      if (!card || !inputQty) return;

      const imgSrc = card.querySelector(".product-img-wrapper img")?.src || "/images/FMRC Logo.png";
      const title = card.querySelector(".product-name")?.innerText?.trim() || "Custom Product";
      const priceText = card.querySelector(".product-price")?.innerText || "₱0.00";

      checkoutSource = "product";
      checkoutCartItemIds = [];

      currentItemPrice = parsePrice(priceText);
      currentMaxStock = readStockLimit(card);

      inputQty.value = "1";
      inputQty.max = String(currentMaxStock);
      if (checkoutMaxStock) {
        checkoutMaxStock.innerText = currentMaxStock >= 9999 ? "Unlimited" : String(currentMaxStock);
      }

      if (protectionCheck) protectionCheck.checked = false;
      if (checkoutImg) checkoutImg.src = imgSrc;
      if (checkoutTitle) checkoutTitle.innerText = title;
      if (checkoutPrice) checkoutPrice.innerText = formatPrice(currentItemPrice);

      hydrateGuideMedia(imgSrc, title);
      updateCheckoutMath();
      openCheckoutModal();
    };

    const openCheckoutFromCartItem = async () => {
      const selectedItems = cartEntries.filter((item) => Boolean(item.selected));
      if (!selectedItems.length) {
        await showShopAlert("Please select at least one cart item to continue.", {
          title: "No Item Selected",
        });
        return;
      }

      if (selectedItems.length > 1) {
        await showShopAlert("Please select only one cart item for checkout.", {
          title: "Single-Item Checkout",
        });
        return;
      }

      const item = selectedItems[0];
      checkoutSource = "cart";
      checkoutCartItemIds = [Number(item.id)];

      currentItemPrice = Number(item.unit_price || 0);
      currentMaxStock = 9999;

      if (inputQty) {
        inputQty.value = String(Math.max(1, Number.parseInt(String(item.quantity || "1"), 10) || 1));
      }

      if (checkoutImg) checkoutImg.src = item.product_image || "/images/FMRC Logo.png";
      if (checkoutTitle) checkoutTitle.innerText = item.product_name || "Custom Product";
      if (checkoutPrice) checkoutPrice.innerText = item.unit_price_label || formatPrice(currentItemPrice);
      if (checkoutMaxStock) checkoutMaxStock.innerText = "In cart";

      hydrateGuideMedia(item.product_image || "/images/FMRC Logo.png", item.product_name || "Custom Product");
      updateCheckoutMath();

      closeCartModal();
      openCheckoutModal();
    };

    const addCardItemToCart = async (card) => {
      if (!card) return;

      const imageElement = card.querySelector(".product-img-wrapper img");
      const title = card.querySelector(".product-name")?.innerText?.trim() || "Custom Product";
      const priceText = card.querySelector(".product-price")?.innerText || "₱0.00";
      const unitPrice = parsePrice(priceText);

      if (imageElement && cartIconTrigger) {
        const imgRect = imageElement.getBoundingClientRect();
        const cartRect = cartIconTrigger.getBoundingClientRect();

        const clone = imageElement.cloneNode(true);
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
        clone.getBoundingClientRect();

        const translateX =
          cartRect.left - imgRect.left + cartRect.width / 2 - imgRect.width / 2;
        const translateY =
          cartRect.top - imgRect.top + cartRect.height / 2 - imgRect.height / 2;

        clone.style.transform = `translate(${translateX}px, ${translateY}px) scale(0.1)`;
        clone.style.opacity = "0.3";

        setTimeout(() => clone.remove(), 1200);
      }

      try {
        await requestCustomerApi("/customer/cart", {
          method: "POST",
          body: {
            product_name: title,
            product_image: imageElement?.src || "/images/FMRC Logo.png",
            unit_price: unitPrice,
            quantity: 1,
            selected: true,
          },
        });

        await loadCart({ silent: true });
      } catch (error) {
        await showShopAlert(error?.message || "Unable to add this item to your cart.", {
          title: "Cart Error",
        });
      }
    };

    const updateCartItem = async (cartId, payload) => {
      await requestCustomerApi(`/customer/cart/${cartId}`, {
        method: "PATCH",
        body: payload,
      });
      await loadCart({ silent: true });
    };

    const removeSelectedCartItems = async () => {
      const selectedIds = cartEntries
        .filter((item) => Boolean(item.selected))
        .map((item) => Number(item.id))
        .filter((id) => Number.isInteger(id) && id > 0);

      if (!selectedIds.length) {
        await showShopAlert("No selected cart items to remove.", {
          title: "Nothing to Remove",
        });
        return;
      }

      const confirmed = await showShopConfirm(
        `Remove ${selectedIds.length} selected item(s) from your cart?`,
        {
          title: "Remove Items",
          confirmText: "Remove",
          danger: true,
        },
      );

      if (!confirmed) return;

      try {
        await requestCustomerApi("/customer/cart", {
          method: "DELETE",
          body: { ids: selectedIds },
        });
        await loadCart({ silent: true });
      } catch (error) {
        await showShopAlert(error?.message || "Unable to remove selected items.", {
          title: "Cart Error",
        });
      }
    };

    const loadInitialCommerceData = async () => {
      if (!getCustomerToken()) {
        customerAddresses = [];
        cartEntries = [];
        renderAddressList();
        renderCartItems();
        updateSelectedAddressDisplay();
        return;
      }

      await Promise.all([loadAddresses({ silent: true }), loadCart({ silent: true })]);
    };

    const startCartRealtimeSync = () => {
      if (cartRealtimeTimer) {
        window.clearInterval(cartRealtimeTimer);
      }

      cartRealtimeTimer = window.setInterval(() => {
        if (document.hidden || !getCustomerToken()) return;
        void loadCart({ silent: true });
      }, 12000);
    };

    if (protectionCheck) {
      protectionCheck.addEventListener("change", updateCheckoutMath);
    }

    if (btnMinusQty && inputQty) {
      btnMinusQty.addEventListener("click", () => {
        const currentQty = Math.max(1, Number.parseInt(String(inputQty.value || "1"), 10) || 1);
        if (currentQty > 1) {
          inputQty.value = String(currentQty - 1);
          updateCheckoutMath();
        }
      });
    }

    if (btnPlusQty && inputQty) {
      btnPlusQty.addEventListener("click", async () => {
        const currentQty = Math.max(1, Number.parseInt(String(inputQty.value || "1"), 10) || 1);
        if (currentMaxStock >= 9999 || currentQty < currentMaxStock) {
          inputQty.value = String(currentQty + 1);
          updateCheckoutMath();
          return;
        }

        await showShopAlert("Maximum stock reached for this item.", {
          title: "Stock Limit",
        });
      });
    }

    buyNowBtns.forEach((btn) => {
      btn.addEventListener("click", (event) => {
        if (!requireCustomerAuth("buy products")) return;
        const card = event.target.closest(".shop-card");
        if (card) openCheckoutForProductCard(card);
      });
    });

    addToCartBtns.forEach((btn) => {
      btn.addEventListener("click", async (event) => {
        if (!requireCustomerAuth("add products to cart")) return;
        const card = event.target.closest(".shop-card");
        await addCardItemToCart(card);
      });
    });

    if (closeCheckoutBtn) {
      closeCheckoutBtn.addEventListener("click", closeCheckoutModal);
    }

    if (openAddressSelectionBtn) {
      openAddressSelectionBtn.addEventListener("click", () => {
        void openAddressModal();
      });
    }

    if (backToCheckoutFromAddressBtn) {
      backToCheckoutFromAddressBtn.addEventListener("click", closeAddressModal);
    }

    if (openAddAddressBtn) {
      openAddAddressBtn.addEventListener("click", () => {
        openAddAddressModal();
      });
    }

    if (backToAddressBtn) {
      backToAddressBtn.addEventListener("click", () => {
        editInfoModal?.classList.remove("show-modal");
      });
    }

    if (backToAddressFromAddBtn) {
      backToAddressFromAddBtn.addEventListener("click", () => {
        addInfoModal?.classList.remove("show-modal");
      });
    }

    if (addressList) {
      addressList.addEventListener("click", (event) => {
        const editButton = event.target.closest("[data-address-edit]");
        if (editButton) {
          const editId = Number.parseInt(String(editButton.getAttribute("data-address-edit") || "0"), 10);
          const address = getAddressById(editId);
          if (address) {
            event.stopPropagation();
            openEditAddressModal(address);
          }
          return;
        }

        const addressItem = event.target.closest("[data-address-id]");
        if (!addressItem) return;

        selectedAddressId = Number.parseInt(String(addressItem.getAttribute("data-address-id") || "0"), 10);
        renderAddressList();
        updateSelectedAddressDisplay();
        closeAddressModal();
      });
    }

    if (saveInfoBtn) {
      saveInfoBtn.addEventListener("click", async () => {
        if (!editingAddressId) return;

        const payload = getAddressFormData("edit");
        if (payload?.error) {
          await showShopAlert(payload.error, { title: "Invalid Address Details" });
          return;
        }

        try {
          await requestCustomerApi(`/customer/addresses/${editingAddressId}`, {
            method: "PUT",
            body: payload,
          });
          await loadAddresses({ silent: false });
          editInfoModal?.classList.remove("show-modal");
          await showShopAlert("Address updated successfully.", { title: "Saved" });
        } catch (error) {
          await showShopAlert(error?.message || "Unable to update your address.", {
            title: "Address Error",
          });
        }
      });
    }

    if (saveNewInfoBtn) {
      saveNewInfoBtn.addEventListener("click", async () => {
        const payload = getAddressFormData("add");
        if (payload?.error) {
          await showShopAlert(payload.error, { title: "Invalid Address Details" });
          return;
        }

        try {
          await requestCustomerApi("/customer/addresses", {
            method: "POST",
            body: payload,
          });
          await loadAddresses({ silent: false });
          addInfoModal?.classList.remove("show-modal");
          await showShopAlert("Address added successfully.", { title: "Saved" });
        } catch (error) {
          await showShopAlert(error?.message || "Unable to save your new address.", {
            title: "Address Error",
          });
        }
      });
    }

    if (deleteAddressBtn) {
      deleteAddressBtn.addEventListener("click", async () => {
        if (!editingAddressId) return;

        const confirmed = await showShopConfirm("Delete this saved address?", {
          title: "Delete Address",
          confirmText: "Delete",
          danger: true,
        });

        if (!confirmed) return;

        try {
          await requestCustomerApi(`/customer/addresses/${editingAddressId}`, {
            method: "DELETE",
          });

          editingAddressId = null;
          editInfoModal?.classList.remove("show-modal");
          await loadAddresses({ silent: false });
          await showShopAlert("Address deleted successfully.", { title: "Deleted" });
        } catch (error) {
          await showShopAlert(error?.message || "Unable to delete this address.", {
            title: "Address Error",
          });
        }
      });
    }

    if (submitOrderBtn) {
      submitOrderBtn.addEventListener("click", async function (event) {
        event?.preventDefault();
        if (!orderTermsCheckbox?.checked) {
          await showShopAlert("Please check the terms and payment agreement box first.", {
            title: "Terms Required",
          });
          return;
        }

        const paymentMethod = toPaymentMethodCode(paymentSelect?.value || "");
        if (!paymentMethod) {
          await showShopAlert("Please choose a valid payment method first.", {
            title: "Payment Method Required",
          });
          return;
        }

        const selectedAddress = getSelectedAddress();
        if (!selectedAddress) {
          await showShopAlert("Please add and select a delivery address first.", {
            title: "Address Required",
          });
          return;
        }

        const quantity = Math.max(1, Number.parseInt(String(inputQty?.value || "1"), 10) || 1);
        const totalText = checkoutGrandTotal?.innerText || checkoutPrice?.innerText || "₱0.00";
        const totalAmount = parsePrice(totalText);
        const originalText = this.innerText;

        this.disabled = true;
        this.innerText = "Processing...";

        try {
          const noteParts = [
            selectedAddress.address_line,
            selectedAddress.address_details,
            selectedAddress.department ? `Department: ${selectedAddress.department}` : "",
            selectedAddress.role ? `Role: ${selectedAddress.role}` : "",
          ].filter(Boolean);

          const payload = {
            product_name: checkoutTitle?.innerText?.trim() || "Custom Order",
            product_image: checkoutImg?.src || "/images/FMRC Logo.png",
            quantity,
            unit_price: Number.isFinite(currentItemPrice) ? Number(currentItemPrice) : 0,
            total_amount: totalAmount,
            payment_method: paymentMethod,
            customer_name:
              selectedAddress.full_name ||
              customerSession.userInfo?.name ||
              customerSession.userInfo?.username ||
              "Customer",
            customer_contact:
              selectedAddress.phone_display ||
              formatPhoneDisplay(selectedAddress.phone || "") ||
              customerSession.userInfo?.email ||
              "N/A",
            notes: noteParts.join(" | "),
            courier_name: "J&T Express",
          };

          const data = await requestCustomerApi("/orders", {
            method: "POST",
            body: payload,
          });

          if (checkoutSource === "cart" && checkoutCartItemIds.length) {
            await requestCustomerApi("/customer/cart", {
              method: "DELETE",
              body: { ids: checkoutCartItemIds },
            });
            checkoutCartItemIds = [];
            await loadCart({ silent: true });
          }

          const orderNo = data?.data?.order_no_display || "";
          await showShopAlert(
            `Order placed successfully${orderNo ? ` (${orderNo})` : ""}.`,
            { title: "Order Placed" },
          );

          emitCustomerOrdersUpdated({ type: "created", orderId: data?.data?.id || null });
          closeCheckoutModal();
        } catch (error) {
          await showShopAlert(error?.message || "Unable to place order. Please try again.", {
            title: "Order Failed",
          });
        } finally {
          this.disabled = false;
          this.innerText = originalText;
        }
      });
    }

    if (cartIconTrigger && cartModal) {
      cartIconTrigger.addEventListener("click", async (event) => {
        event.preventDefault();
        if (!requireCustomerAuth("view and manage your cart")) return;
        await loadCart({ silent: false });
        cartModal.classList.add("show-modal");
        document.body.style.overflow = "hidden";
      });
    }

    if (closeCartBtn) {
      closeCartBtn.addEventListener("click", closeCartModal);
    }

    if (cartItemsContainer) {
      cartItemsContainer.addEventListener("click", async (event) => {
        const minusBtn = event.target.closest(".c-minus-btn");
        const plusBtn = event.target.closest(".c-plus-btn");
        if (!minusBtn && !plusBtn) return;

        const card = event.target.closest("[data-cart-id]");
        if (!card) return;
        const cartId = Number.parseInt(String(card.getAttribute("data-cart-id") || "0"), 10);
        const cartItem = cartEntries.find((item) => Number(item.id) === cartId);
        if (!cartItem) return;

        const currentQuantity = Math.max(1, Number.parseInt(String(cartItem.quantity || "1"), 10) || 1);
        const nextQuantity = minusBtn
          ? Math.max(1, currentQuantity - 1)
          : Math.min(99, currentQuantity + 1);

        if (nextQuantity === currentQuantity) return;

        try {
          await updateCartItem(cartId, { quantity: nextQuantity });
        } catch (error) {
          await showShopAlert(error?.message || "Unable to update cart quantity.", {
            title: "Cart Error",
          });
        }
      });

      cartItemsContainer.addEventListener("change", async (event) => {
        const checkbox = event.target.closest(".cart-item-check");
        if (!checkbox) return;

        const card = checkbox.closest("[data-cart-id]");
        if (!card) return;

        const cartId = Number.parseInt(String(card.getAttribute("data-cart-id") || "0"), 10);
        const selected = Boolean(checkbox.checked);

        try {
          await updateCartItem(cartId, { selected });
        } catch (error) {
          checkbox.checked = !selected;
          await showShopAlert(error?.message || "Unable to update cart selection.", {
            title: "Cart Error",
          });
        }
      });
    }

    if (selectAllCartBtn) {
      selectAllCartBtn.addEventListener("change", async (event) => {
        const nextSelected = Boolean(event.target.checked);
        const targets = cartEntries.filter((item) => Boolean(item.selected) !== nextSelected);
        if (!targets.length) {
          renderCartTotals();
          return;
        }

        try {
          await Promise.all(
            targets.map((item) =>
              requestCustomerApi(`/customer/cart/${Number(item.id)}`, {
                method: "PATCH",
                body: { selected: nextSelected },
              }),
            ),
          );
          await loadCart({ silent: true });
        } catch (error) {
          event.target.checked = !nextSelected;
          await showShopAlert(error?.message || "Unable to update cart selection.", {
            title: "Cart Error",
          });
        }
      });
    }

    if (cartEditBtn && cartCheckoutView && cartDeleteView) {
      cartEditBtn.addEventListener("click", () => {
        isCartEditMode = !isCartEditMode;
        cartEditBtn.innerText = isCartEditMode ? "Done" : "Edit";
        cartCheckoutView.style.display = isCartEditMode ? "none" : "flex";
        cartDeleteView.style.display = isCartEditMode ? "flex" : "none";
      });
    }

    if (cartDeleteBtn) {
      cartDeleteBtn.addEventListener("click", () => {
        void removeSelectedCartItems();
      });
    }

    if (cartAddressTrigger) {
      cartAddressTrigger.addEventListener("click", () => {
        void openAddressModal();
      });
    }

    if (cartCheckoutSubmitBtn) {
      cartCheckoutSubmitBtn.addEventListener("click", () => {
        void openCheckoutFromCartItem();
      });
    }

    window.addEventListener("focus", () => {
      if (!document.hidden) {
        void loadCart({ silent: true });
      }
    });

    window.addEventListener("beforeunload", () => {
      if (cartRealtimeTimer) {
        window.clearInterval(cartRealtimeTimer);
      }
    });

    void loadInitialCommerceData();
    if (getCustomerToken()) {
      startCartRealtimeSync();
    }
  }

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
  const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
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
    if (Number.isNaN(hh) || Number.isNaN(mm) || hh < 1 || hh > 12 || mm < 0 || mm > 59) {
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
    const country = document.getElementById("aptCountry")?.value?.trim() || "Philippines";

    if (country !== "Philippines") {
      const intlAddress = document.getElementById("aptIntlAddress")?.value?.trim() || "";
      return [intlAddress, country].filter(Boolean).join(", ");
    }

    const region = document.getElementById("aptRegion")?.value?.trim() || "";
    const province = document.getElementById("aptProvince")?.value?.trim() || "";
    const municipality = document.getElementById("aptMunicipality")?.value?.trim() || "";
    const barangay = document.getElementById("aptAddress")?.value?.trim() || "";

    return [barangay, municipality, province, region, country].filter(Boolean).join(", ");
  };

  const fetchCalendarAvailability = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/appointments/calendar`, {
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) return;
      const data = await response.json();

      const incomingSlots = Array.isArray(data?.time_slots) ? data.time_slots : [];
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
      (Array.isArray(data?.day_settings) ? data.day_settings : []).forEach((entry) => {
        if (!entry?.date) return;
        calendarState.daySettings[String(entry.date)] = {
          is_blocked: Boolean(entry.is_blocked),
          blocked_slots: Array.isArray(entry.blocked_slots) ? entry.blocked_slots : [],
          events: Array.isArray(entry.events) ? entry.events : [],
          custom_slots: Array.isArray(entry.custom_slots) ? entry.custom_slots : [],
        };
      });

      calendarState.bookedSlots = data?.booked_slots && typeof data.booked_slots === "object"
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
    const country = document.getElementById("aptCountry")?.value?.trim() || "Philippines";

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
      markError("aptEmail", "Email Address is invalid. Please use a Gmail address only.");
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
      const intlAddress = document.getElementById("aptIntlAddress")?.value?.trim() || "";
      if (!intlAddress) {
        markError("aptIntlAddress", "Complete Residential Address is required.");
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
    const payloadUrl = verifyUrl || `${window.location.origin}/appointments/verify/${referenceNo || "PENDING"}`;
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
    const purpose = document.getElementById("aptPurpose")?.value?.trim() || "N/A";
    const clientType = document.getElementById("aptRole")?.value?.trim() || "N/A";
    const country = document.getElementById("aptCountry")?.value?.trim() || "Philippines";
    const notes = document.getElementById("aptDesc")?.value?.trim() || "N/A";
    const address = getAppointmentAddress() || "N/A";
    const attachmentName = uploadedAppointmentFile?.name || "N/A";

    const { date, time } = getSelectedSchedule();
    const scheduleText = date && time ? `${toReadableDate(date)} @ ${time}` : "Not selected";
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
    document.querySelectorAll(".apt-content-section").forEach((sec) => sec.classList.remove("active"));
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
      showSlotMessage("Reminder: You can select only 1 time slot for this appointment.", "#9a6a00");
    }

    if (stepNumber === 4 || stepNumber === 5) {
      populateReviewData(stepNumber);
    }
  };

  const submitAppointment = async () => {
    const { date, time } = getSelectedSchedule();
    if (!date || !time) {
      showSlotMessage("Please select a date and time first before continuing.");
      return false;
    }

    const formData = new FormData();
    formData.append("last_name", document.getElementById("aptLName")?.value?.trim() || "");
    formData.append("first_name", document.getElementById("aptFName")?.value?.trim() || "");
    formData.append("middle_initial", document.getElementById("aptMI")?.value?.trim() || "");
    formData.append("contact_number", document.getElementById("aptPhone")?.value?.trim() || "");
    formData.append("email", document.getElementById("aptEmail")?.value?.trim() || "");
    formData.append("country", document.getElementById("aptCountry")?.value?.trim() || "Philippines");
    formData.append("region", document.getElementById("aptRegion")?.value?.trim() || "");
    formData.append("province", document.getElementById("aptProvince")?.value?.trim() || "");
    formData.append("municipality", document.getElementById("aptMunicipality")?.value?.trim() || "");
    formData.append("barangay", document.getElementById("aptAddress")?.value?.trim() || "");
    formData.append("intl_address", document.getElementById("aptIntlAddress")?.value?.trim() || "");
    formData.append("full_address", getAppointmentAddress() || "");
    formData.append("client_type", document.getElementById("aptRole")?.value?.trim() || "");
    formData.append("purpose", document.getElementById("aptPurpose")?.value?.trim() || "");
    formData.append("additional_notes", document.getElementById("aptDesc")?.value?.trim() || "");
    formData.append("appointment_date", date);
    formData.append("appointment_time", time);

    if (uploadedAppointmentFile) {
      formData.append("attachment", uploadedAppointmentFile);
    }

    const token = localStorage.getItem("customer_token");

    try {
      const response = await fetch(`${API_BASE_URL}/appointments`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: formData,
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        const message = payload?.message || "Unable to submit appointment. Please review your details and try again.";
        showSlotMessage(message);
        return false;
      }

      submittedAppointment = payload?.data || null;
      appointmentSubmitted = true;
      populateReviewData(5);
      return true;
    } catch {
      showSlotMessage("Cannot connect to server. Please make sure Laravel is running.");
      return false;
    }
  };

  const downloadAppointmentReceipt = async () => {
    const receipt = document.getElementById("officialReceiptCard");
    const referenceNo = submittedAppointment?.reference_no || "PENDING";

    if (!receipt || typeof window.html2canvas !== "function") {
      showSlotMessage("Receipt download is unavailable right now. Please try again.");
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
    showSlotMessage("Reminder: You can select only 1 time slot for this appointment.", "#9a6a00");
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
    const customSlots = (Array.isArray(day.custom_slots) ? day.custom_slots : [])
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
        cell.addEventListener("click", () => handleDateClick(dateKey, day, month, year));
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
      timeContainer.innerHTML = '<p class="time-placeholder">Please pick a date first.</p>';
      if (eventsDisplay) {
        eventsDisplay.style.display = "none";
        eventsDisplay.innerHTML = "";
      }
      return;
    }

    const selectedSchedule = getSelectedSchedule();
    const selectedSlot = selectedSchedule.date === dateKey ? selectedSchedule.time : "";
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
      const isBlocked = daySettings.blocked_slots.includes(slot.label) || daySettings.is_blocked;
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
          showSlotMessage("This time slot is already booked by another customer.");
          return;
        }
        if (isBlocked) {
          showSlotMessage("This time slot is blocked by admin for the selected date.");
          return;
        }

        const hasExistingSelection = Boolean(selectedSchedule.date && selectedSchedule.time);
        const isReplacingSelection = hasExistingSelection && (selectedSchedule.date !== dateKey || selectedSchedule.time !== slot.label);

        Object.keys(appointmentSelections).forEach((key) => delete appointmentSelections[key]);
        appointmentSelections[dateKey] = [slot.label];

        if (isReplacingSelection) {
          showSlotMessage("Only 1 slot is allowed per appointment. Your previous slot was replaced.");
        } else {
          showSlotMessage("Reminder: You can select only 1 time slot for this appointment.", "#9a6a00");
        }
        renderTimeSlots(dateKey);
        renderCalendar(currentMonth, currentYear);
      });

      timeContainer.appendChild(button);
    });
  };

  const resetAppointmentFlowState = () => {
    Object.keys(appointmentSelections).forEach((key) => delete appointmentSelections[key]);
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

  if (aptCountry && aptRegion && aptProvince && aptMunicipality && aptBarangay) {
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
          Manila: ["Barangay 659", "Barangay 699", "Barangay 734", "Barangay 750"],
          "Quezon City": ["Bagumbayan", "Batasan Hills", "Commonwealth", "UP Campus"],
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
      if (aptPhAddressFields) aptPhAddressFields.style.display = isPhilippines ? "contents" : "none";
      if (aptIntlAddressField) aptIntlAddressField.style.display = isPhilippines ? "none" : "block";
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
      const municipalities = Object.keys(phAddressData[aptRegion.value]?.[aptProvince.value] || {});
      fillSelect(aptMunicipality, municipalities, "Select Municipality");
      fillSelect(aptBarangay, [], "Select Barangay");
      aptMunicipality.disabled = !municipalities.length;
      aptBarangay.disabled = true;
    });

    aptMunicipality.addEventListener("change", () => {
      const barangays = phAddressData[aptRegion.value]?.[aptProvince.value]?.[aptMunicipality.value] || [];
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
    const isAllowedExt = /\.(png|jpg|jpeg|webp|gif|pdf|doc|docx)$/i.test(file.name);

    if (!isAllowedMime && !isAllowedExt) {
      uploadedAppointmentFile = null;
      aptFileInput.value = "";
      if (aptFileName) aptFileName.textContent = "Invalid file. Use image, DOC/DOCX, or PDF only.";
      showSlotMessage("Attachment is invalid. Please upload an image, DOC/DOCX, or PDF file only.");
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
    aptMI.value = aptMI.value.replace(/[^A-Za-z]/g, "").slice(0, 1).toUpperCase();
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
      if (document.getElementById("aptStep3")?.classList.contains("active") && appointmentOverlay?.classList.contains("show-modal")) {
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
  bindClick("cancelPrivacyBtn", () => privacyModal?.classList.remove("show-modal"));
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

  bindClick("cancelConfirmBtn", () => confirmModal?.classList.remove("show-modal"));
  bindClick("acceptConfirmBtn", () => {
    confirmModal?.classList.remove("show-modal");
    switchAptStep(4);
  });

  bindClick("btnCancelTo3", () => switchAptStep(3));
  // Step 4: "Confirm & Submit" — actually submits the appointment to backend
  bindClick("btnGoToStep5", async (event) => {
    event?.preventDefault();
    const btn = document.getElementById("btnGoToStep5");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Submitting...";
    }
    try {
      if (!appointmentSubmitted) {
        const ok = await submitAppointment();
        if (!ok) {
          if (btn) {
            btn.disabled = false;
            btn.textContent = "Confirm & Submit";
          }
          return;
        }
      }
      switchAptStep(5);
    } catch {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Confirm & Submit";
      }
    }
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
    document.body.style.overflow = "";
    resetAppointmentFlowState();
    switchAptStep(1);
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
      const eyeClosedSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';
      const eyeOpenSvg = '<svg class="eye-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
      
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

    overlay.querySelector("#closeProfileModal")?.addEventListener("click", closeModal, {
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

        const currentPassword = overlay.querySelector("#cp_current")?.value || "";
        const newPassword = overlay.querySelector("#cp_new")?.value || "";
        const confirmPassword = overlay.querySelector("#cp_confirm")?.value || "";

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
            msgBox.innerHTML = "<i class=\"fa-solid fa-circle-check\"></i> you have changed your password successfully.";
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
              currentErr || newErr || confirmErr || data.message || "Unable to update password.";
          } else {
            msgBox.style.color = "#b91c1c";
            msgBox.textContent = data.message || "Unable to update password.";
          }
        } catch {
          msgBox.style.display = "block";
          msgBox.style.color = "#b91c1c";
          msgBox.textContent = "Cannot connect to server. Ensure Laravel is running.";
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

  const fetchJsonWithTimeout = async (url, options = {}, timeoutMs = API_REQUEST_TIMEOUT_MS) => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      const data = await response.json().catch(() => ({}));
      return { response, data };
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error("Request timed out. Please check your connection and try again.");
      }

      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  const fetchCustomerOrders = async (customerToken) => {
    const { response, data } = await fetchJsonWithTimeout(`${API_BASE_URL}/customer/orders`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${customerToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(data.message || "Unable to load your orders.");
    }

    return Array.isArray(data.data) ? data.data : [];
  };

  const fetchCustomerOrderDetail = async (customerToken, orderId) => {
    const { response, data } = await fetchJsonWithTimeout(`${API_BASE_URL}/customer/orders/${orderId}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${customerToken}`,
      },
    });

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
      const panels = Array.from(overlay.querySelectorAll(".customer-orders-panel"));
      const track = overlay.querySelector("#customerOrdersTrack");
      const viewport = overlay.querySelector("#customerOrdersViewport");
      const closeBtn = overlay.querySelector("#closeCustomerOrdersModal");
      const detailModal = overlay.querySelector("#customerOrderDetailModal");
      const detailContent = overlay.querySelector("#customerOrderDetailContent");
      const detailTitle = overlay.querySelector("#customerOrderDetailTitle");
      const closeDetailBtn = overlay.querySelector("#closeCustomerOrderDetail");
      const stageByPanel = ["all", "to_pay", "to_ship", "to_receive", "completed"];

      const state = {
        activeIndex: 0,
        userInfo: null,
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
          <p>Loading orders from server...</p>
        </div>
      `;

      const getVisibleOrdersByPanel = (stageKey) => {
        if (stageKey === "all") return state.orders;
        if (stageKey === "completed") {
          return state.orders.filter(
            (order) =>
              String(order.lifecycle_status || "").toLowerCase() !== "rejected" &&
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
        const lifecycle = String(order?.lifecycle_status || "pending").toLowerCase();
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
          label: ORDER_STAGE_LABELS[stage] || ORDER_LIFECYCLE_LABELS[lifecycle] || "Pending",
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
              const quantity = Math.max(1, Number.parseInt(order.quantity || "1", 10) || 1);
              const quantityLabel = `${quantity} item${quantity > 1 ? "s" : ""}`;
              const productImage = escapeHtml(order.product_image || "/images/FMRC Logo.png");
              const productName = escapeHtml(order.product_name || "Custom Order");
              const orderNo = escapeHtml(order.order_no_display || `#${order.order_no || order.id || "-"}`);
              const paymentMethod = escapeHtml(order.payment_method || "N/A");

              const numericTotal = Number(order.total_amount || 0);
              const totalLabel = formatOrderCurrency(Number.isFinite(numericTotal) ? numericTotal : 0);

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

        const safeOrderNo = escapeHtml(detail.order_no_display || `#${detail.order_no || detail.id || "-"}`);
        const safeTitle = escapeHtml(detail.product_name || "Order Details");
        const safeStatus = escapeHtml(
          ORDER_LIFECYCLE_LABELS[String(detail.lifecycle_status || "").toLowerCase()] ||
            ORDER_STAGE_LABELS[String(detail.customer_stage || "").toLowerCase()] ||
            "Pending",
        );

        const timeline = Array.isArray(detail.timeline) ? detail.timeline : [];
        const withCoords =
          timeline.find((entry) => Number.isFinite(Number(entry?.latitude)) && Number.isFinite(Number(entry?.longitude))) ||
          detail;
        const mapEmbedUrl = buildGoogleMapEmbedUrl(withCoords?.latitude, withCoords?.longitude);
        const mapOpenUrl = buildGoogleMapOpenUrl(withCoords?.latitude, withCoords?.longitude);
        const courierName = escapeHtml(detail.courier_name || "J&T Express");
        const courierTrackingNo = String(detail.courier_tracking_no || "").trim();
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
                : '<p class="customer-order-logistics-note">Tracking number will appear once admin updates shipment info.</p>'
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
                : '<div class="customer-order-map-empty"><i class="fa-solid fa-map-location-dot"></i><p>Location updates will appear here once posted by admin or courier.</p></div>'
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
        detailTitle.textContent = "Loading Order Details";
        detailContent.innerHTML = `
          <div class="customer-orders-empty">
            <i class="fa-solid fa-spinner fa-spin"></i>
            <p>Loading order timeline...</p>
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
          const detail = await fetchCustomerOrderDetail(state.token, state.activeDetailId);
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
        if (!force && now - state.lastRefreshAt < CUSTOMER_ORDERS_MIN_REFRESH_GAP_MS) {
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
        if (event.key !== "Escape" || !overlay.classList.contains("show")) return;
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

          if (Math.abs(deltaX) < 45 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
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
        const payload = event?.detail || {};
        if (!shouldProcessRealtimeSignal(payload)) return;
        state.lastDetailRefreshAt = 0;
        void refreshOrders(false, true);
      });

      window.addEventListener("storage", (event) => {
        if (event.key !== ORDERS_REALTIME_SIGNAL_KEY) return;
        if (!overlay.classList.contains("show") || document.hidden) return;

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
        const payload = event?.data || {};
        if (payload?.source === "customer-portal") return;
        if (!shouldProcessRealtimeSignal(payload)) return;
        state.lastDetailRefreshAt = 0;
        void refreshOrders(false, true);
      });

      document.addEventListener("visibilitychange", () => {
        if (document.hidden || !overlay.classList.contains("show")) return;
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
          state.token = localStorage.getItem("customer_token") || "";
          state.detailsById.clear();
          state.refreshQueued = false;
          setActivePanel(0);
          overlay.classList.add("show");
          document.body.style.overflow = "hidden";
          await refreshOrders(true, true);
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

  dropdown.querySelector("#viewOrdersBtn")?.addEventListener("click", (event) => {
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
