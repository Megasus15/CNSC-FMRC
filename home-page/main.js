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
  let currentMaxStock = 1;
  let protectionFee = 5.0;

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
      let currentVal = parseInt(inputQty.value);
      if (currentVal > 1) {
        inputQty.value = currentVal - 1;
        updateCheckoutMath();
      }
    });
    btnPlusQty.addEventListener("click", () => {
      let currentVal = parseInt(inputQty.value);
      if (currentVal < currentMaxStock) {
        inputQty.value = currentVal + 1;
        updateCheckoutMath();
      } else if (currentMaxStock === 9999) {
        inputQty.value = currentVal + 1;
        updateCheckoutMath();
      } else {
        alert("Maximum stock reached for this item.");
      }
    });
  }

  // --- MODAL 1: OPEN CHECKOUT ---
  const buyNowBtns = document.querySelectorAll(".btn-buy-now:not(.disabled)");
  buyNowBtns.forEach((btn) => {
    btn.addEventListener("click", function (e) {
      if (!requireCustomerAuth("buy products")) return;

      const card = e.target.closest(".shop-card");
      if (card) {
        const imgScr = card.querySelector(".product-img-wrapper img").src;
        const title = card.querySelector(".product-name").innerText;
        const priceStr = card.querySelector(".product-price").innerText;
        const stockText = card.querySelector(".stock-text").innerText;

        if (stockText.toLowerCase().includes("unlimited")) {
          currentMaxStock = 9999;
          if (checkoutMaxStock) checkoutMaxStock.innerText = "Unlimited";
        } else {
          currentMaxStock = parseInt(stockText.replace(/[^0-9]/g, ""));
          if (checkoutMaxStock) checkoutMaxStock.innerText = currentMaxStock;
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

  const closeCheckoutBtn = document.getElementById("closeCheckoutBtn");
  if (closeCheckoutBtn) {
    closeCheckoutBtn.addEventListener("click", () => {
      checkoutModal.classList.remove("show-modal");
      document.body.style.overflow = "auto";
    });
  }

  // --- MODAL 2: OPEN ADDRESS SELECTION ---
  const openAddressSelectionBtn = document.getElementById(
    "openAddressSelectionBtn",
  );
  if (openAddressSelectionBtn) {
    openAddressSelectionBtn.addEventListener("click", () => {
      addressSelectionModal.classList.add("show-modal");
    });
  }

  const backToCheckoutFromAddressBtn = document.getElementById(
    "backToCheckoutFromAddressBtn",
  );
  if (backToCheckoutFromAddressBtn) {
    backToCheckoutFromAddressBtn.addEventListener("click", () => {
      addressSelectionModal.classList.remove("show-modal");
    });
  }

  // Select an address from the list to use in Checkout
  const addressItems = document.querySelectorAll(".address-item");
  addressItems.forEach((item) => {
    item.addEventListener("click", function (e) {
      // Ignore click if they clicked the Edit button
      if (e.target.classList.contains("edit-address-btn")) return;

      const name = this.dataset.name;
      const phone = this.dataset.phone;
      const address = this.dataset.address;
      const dept = this.dataset.dept;
      const role = this.dataset.role;

      document.getElementById("displayClientName").innerText = name;
      const maskedPhone =
        phone.length > 4
          ? `(+63)${phone.substring(0, 2)}******${phone.substring(phone.length - 2)}`
          : phone;
      document.getElementById("displayClientPhone").innerText = maskedPhone;
      document.getElementById("displayClientAddress").innerHTML = address;
      document.getElementById("displayClientRole").innerText = role;
      document.getElementById("displayClientDept").innerText = dept;

      addressSelectionModal.classList.remove("show-modal");
    });
  });

  // --- MODAL 3: OPEN EDIT/ADD FORM ---
  const openAddAddressBtn = document.getElementById("openAddAddressBtn");
  const editAddressBtns = document.querySelectorAll(".edit-address-btn");
  const addInfoModal = document.getElementById("addInfoModal");

  if (openAddAddressBtn) {
    if (addInfoModal) {
      openAddAddressBtn.addEventListener("click", () => {
        addInfoModal.classList.add("show-modal");
      });
    }
  }

  editAddressBtns.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation(); // Prevents the card click event from firing
      editInfoModal.classList.add("show-modal");
    });
  });

  const backToAddressBtn = document.getElementById("backToAddressBtn");
  if (backToAddressBtn) {
    backToAddressBtn.addEventListener("click", () => {
      editInfoModal.classList.remove("show-modal");
    });
  }

  const backToAddressFromAddBtn = document.getElementById(
    "backToAddressFromAddBtn",
  );
  if (backToAddressFromAddBtn && addInfoModal) {
    backToAddressFromAddBtn.addEventListener("click", () => {
      addInfoModal.classList.remove("show-modal");
    });
  }

  const saveInfoBtn = document.getElementById("saveInfoBtn");
  if (saveInfoBtn) {
    saveInfoBtn.addEventListener("click", () => {
      const name = document.getElementById("inpFullName").value;
      const phone = document.getElementById("inpPhone").value;
      const addr = document.getElementById("inpAddress").value;
      const dept = document.getElementById("inpDept").value;
      const roleRadio = document.querySelector(
        'input[name="userRole"]:checked',
      );
      const role = roleRadio ? roleRadio.value : "Student";

      // Update the first address item visually in the list
      const firstItem = document.querySelector(".address-item");
      if (firstItem) {
        firstItem.dataset.name = name;
        firstItem.dataset.phone = phone;
        firstItem.dataset.address = addr.replace(/\n/g, "<br>");
        firstItem.dataset.dept = dept;
        firstItem.dataset.role = role;

        firstItem.querySelector(".a-name").innerText =
          name || "No Name Provided";
        const maskedPhone =
          phone.length > 4
            ? `(+63)${phone.substring(0, 2)}******${phone.substring(phone.length - 2)}`
            : phone;
        firstItem.querySelector(".a-phone").innerText = maskedPhone;
        firstItem.querySelector(".a-address-text").innerHTML =
          addr.replace(/\n/g, "<br>") || "No Address Provided";
      }

      // Also auto-update the Checkout banner to ensure it uses the newly saved data
      document.getElementById("displayClientName").innerText =
        name || "No Name Provided";
      const maskedPhoneCheck =
        phone.length > 4
          ? `(+63)${phone.substring(0, 2)}******${phone.substring(phone.length - 2)}`
          : phone;
      document.getElementById("displayClientPhone").innerText =
        maskedPhoneCheck;
      document.getElementById("displayClientAddress").innerHTML =
        addr.replace(/\n/g, "<br>") || "No Address Provided";
      document.getElementById("displayClientRole").innerText = role;
      document.getElementById("displayClientDept").innerText =
        dept || "No Dept";

      editInfoModal.classList.remove("show-modal"); // Go back to address list
    });
  }

  const saveNewInfoBtn = document.getElementById("saveNewInfoBtn");
  if (saveNewInfoBtn && addInfoModal) {
    saveNewInfoBtn.addEventListener("click", () => {
      // Logic for saving new info would go here.
      // For now, we simulate success and close.
      alert("Address added!");
      addInfoModal.classList.remove("show-modal");
    });
  }

  // Submit Order logic
  const submitOrderBtn = document.getElementById("submitOrderBtn");
  if (submitOrderBtn) {
    submitOrderBtn.addEventListener("click", function () {
      const terms = document.getElementById("orderTerms");
      if (terms && !terms.checked) {
        alert("Please check the terms and payment agreement box first.");
        return;
      }
      const originalText = this.innerText;
      this.innerText = "Processing...";
      setTimeout(() => {
        alert("Order Placed Successfully!");
        checkoutModal.classList.remove("show-modal");
        document.body.style.overflow = ""; // Resets to CSS
        this.innerText = originalText;
      }, 1000);
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
    const items = cartItemsContainer.querySelectorAll(".cart-item-card");
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

    document.getElementById("cartTotalPrice").innerText = formatPrice(total);
    if (cartHeaderCount) cartHeaderCount.innerText = items.length;
    if (headerCartBadge) headerCartBadge.innerText = count;

    const allChecked =
      items.length > 0 &&
      Array.from(items).every(
        (i) => i.querySelector(".cart-item-check").checked,
      );
    document.getElementById("selectAllCartBtn").checked = allChecked;

    if (items.length === 0 && emptyCartMessage)
      emptyCartMessage.style.display = "block";
  }

  // Add To Cart Button Listener
  const addToCartBtns = document.querySelectorAll(
    ".btn-add-cart:not(.disabled)",
  );
  addToCartBtns.forEach((btn) => {
    btn.addEventListener("click", function (e) {
      if (!requireCustomerAuth("add products to cart")) return;

      const card = e.target.closest(".shop-card");
      if (!card) return;

      const imgElement = card.querySelector(".product-img-wrapper img");
      const title = card.querySelector(".product-name").innerText;
      const priceStr = card.querySelector(".product-price").innerText;

      flyToCart(imgElement, cartIconTrigger); // Trigger the slow fly animation

      const cartItem = document.createElement("div");
      cartItem.className = "cart-item-card";
      cartItem.innerHTML = `
        <label class="cart-checkbox-container">
          <input type="checkbox" class="cart-item-check" checked>
          <span class="cart-checkmark"></span>
        </label>
        <div class="cart-item-img"><img src="${imgElement.src}" alt="Product"></div>
        <div class="cart-item-details">
          <h4>${title}</h4>
          <div class="cart-item-bottom">
            <span class="c-price" data-price="${parsePrice(priceStr)}">${priceStr}</span>
            <div class="qty-selector">
              <button class="qty-btn c-minus-btn">-</button>
              <input type="number" class="c-qty-input" value="1" min="1" max="99" readonly>
              <button class="qty-btn c-plus-btn">+</button>
            </div>
          </div>
        </div>
      `;

      if (emptyCartMessage) emptyCartMessage.style.display = "none";
      cartItemsContainer.appendChild(cartItem);
      updateCartTotals();
    });
  });

  // Cart DOM Listeners (Delegation for +/- and checkboxes)
  if (cartItemsContainer) {
    cartItemsContainer.addEventListener("click", (e) => {
      if (e.target.classList.contains("c-minus-btn")) {
        const input = e.target.nextElementSibling;
        if (parseInt(input.value) > 1) {
          input.value = parseInt(input.value) - 1;
          updateCartTotals();
        }
      } else if (e.target.classList.contains("c-plus-btn")) {
        const input = e.target.previousElementSibling;
        input.value = parseInt(input.value) + 1;
        updateCartTotals();
      } else if (e.target.classList.contains("cart-item-check")) {
        updateCartTotals();
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
    cartDeleteBtn.addEventListener("click", () => {
      const items = cartItemsContainer.querySelectorAll(".cart-item-card");
      items.forEach((item) => {
        if (item.querySelector(".cart-item-check").checked) item.remove();
      });
      updateCartTotals();
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
    cartCheckoutSubmitBtn.addEventListener("click", () => {
      if (!requireCustomerAuth("buy products")) return;

      const checkedItems = cartItemsContainer.querySelectorAll(
        ".cart-item-check:checked",
      );
      if (checkedItems.length === 0) {
        alert("Please select an item to checkout.");
        return;
      }

      const firstItem = checkedItems[0].closest(".cart-item-card");
      const title = firstItem.querySelector("h4").innerText;
      const priceVal = document.getElementById("cartTotalPrice").innerText;

      if (checkoutImg) checkoutImg.src = firstItem.querySelector("img").src;
      if (checkoutTitle)
        checkoutTitle.innerText =
          checkedItems.length > 1
            ? `${title} (+${checkedItems.length - 1} more)`
            : title;
      if (checkoutPrice) checkoutPrice.innerText = priceVal;

      inputQty.value = 1;
      currentItemPrice = parsePrice(priceVal);
      updateCheckoutMath();

      cartModal.classList.remove("show-modal");
      checkoutModal.classList.add("show-modal");
    });
  }

  // =========================================
  // APPOINTMENT FLOW LOGIC (HOMEPAGE)
  // =========================================
  const API_BASE_URL =
    window.APP_API_BASE_URL ||
    document.querySelector('meta[name="api-base-url"]')?.getAttribute("content") ||
    `${window.location.protocol}//${window.location.hostname}:8000/api`;
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
    appointmentBtn.addEventListener("click", async () => {
      if (!requireCustomerAuth("set an appointment")) return;
      await fetchCalendarAvailability();
      resetAppointmentFlowState();
      renderCalendar(currentMonth, currentYear);
      renderTimeSlots(null);
      appointmentOverlay.classList.add("show-modal");
      document.body.style.overflow = "hidden";
      switchAptStep(1);
      startAptPolling();
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
  bindClick("btnGoToStep5", () => switchAptStep(5));

  bindClick("btnGenerateReport", () => {
    void downloadAppointmentReceipt();
  });

  bindClick("btnDownloadQr", downloadQrCodeCard);

  bindClick("btnFinishStep5", async () => {
    if (appointmentSubmitted) {
      successModal?.classList.add("active");
      return;
    }

    const ok = await submitAppointment();
    if (!ok) return;
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
    contactMessageForm.addEventListener("submit", (event) => {
      event.preventDefault();
      alert("Thank you! Your message has been sent successfully.");
      contactMessageForm.reset();
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
          const response = await fetch("http://127.0.0.1:8000/api/change-password", {
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
        await fetch("http://127.0.0.1:8000/api/logout", {
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
