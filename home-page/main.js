document.addEventListener("DOMContentLoaded", () => {
  let navLinks = document.querySelectorAll(".nav-link");
  const sections = document.querySelectorAll("main, section");

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
  // SERVICES 3D CAROUSEL LOGIC
  // =========================================
  const track = document.querySelector(".carousel-track");

  if (track) {
    // Ensures this only runs on the services page
    const items = Array.from(track.querySelectorAll(".carousel-item"));
    const prevBtn = document.querySelector(".prev-btn");
    const nextBtn = document.querySelector(".next-btn");
    let currentIndex = 0;
    let autoPlayInterval;

    // Core function to update classes for 3D effect
    function updateCarousel() {
      items.forEach((item, index) => {
        // Reset all classes
        item.className = "carousel-item";

        // Calculate dynamic positions relative to current index
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
    }

    // Movement Functions
    function moveNext() {
      currentIndex = (currentIndex + 1) % items.length;
      updateCarousel();
    }

    function movePrev() {
      currentIndex = (currentIndex - 1 + items.length) % items.length;
      updateCarousel();
    }

    // Button Listeners
    nextBtn.addEventListener("click", () => {
      moveNext();
      resetAutoPlay();
    });
    prevBtn.addEventListener("click", () => {
      movePrev();
      resetAutoPlay();
    });

    // Allow clicking the side cards to bring them to the front
    items.forEach((item) => {
      item.addEventListener("click", (e) => {
        if (item.classList.contains("prev")) {
          movePrev();
          resetAutoPlay();
        } else if (item.classList.contains("next")) {
          moveNext();
          resetAutoPlay();
        }
      });
    });

    // Mobile Swipe (Touch) Support
    let startX = 0;
    let endX = 0;

    track.addEventListener(
      "touchstart",
      (e) => {
        startX = e.touches[0].clientX;
        clearInterval(autoPlayInterval); // Pause auto-play on touch
      },
      { passive: true },
    );

    track.addEventListener("touchend", (e) => {
      endX = e.changedTouches[0].clientX;
      handleSwipe();
      startAutoPlay(); // Resume auto-play
    });

    function handleSwipe() {
      const swipeThreshold = 40; // Minimum distance to trigger swipe
      if (startX - endX > swipeThreshold) {
        moveNext(); // Swipe left
      } else if (endX - startX > swipeThreshold) {
        movePrev(); // Swipe right
      }
    }

    // Slow Automatic Sliding Animation (Loops every 4 seconds)
    function startAutoPlay() {
      autoPlayInterval = setInterval(moveNext, 5000);
    }

    function resetAutoPlay() {
      clearInterval(autoPlayInterval);
      startAutoPlay();
    }

    // Pause animation when user hovers over the carousel
    const wrapper = document.querySelector(".carousel-wrapper");
    wrapper.addEventListener("mouseenter", () =>
      clearInterval(autoPlayInterval),
    );
    wrapper.addEventListener("mouseleave", startAutoPlay);

    // Initialize the carousel on load
    updateCarousel();
    startAutoPlay();
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
  const appointmentBtn = document.querySelector(".btn-appointment");
  const appointmentOverlay = document.getElementById("appointmentFlow");
  const closeAppointmentBtn = document.getElementById("closeAppointmentBtn");

  const privacyModal = document.getElementById("aptPrivacyModal");
  const confirmModal = document.getElementById("aptConfirmModal");
  const APPOINTMENTS_STORAGE_KEY = "fmrcAppointments";
  const CALENDAR_BLOCKS_STORAGE_KEY = "fmrcAppointmentCalendarBlocks";

  let appointmentSubmitted = false;
  let uploadedAppointmentFile = { name: "", dataUrl: "" };

  const fileToDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });

  const readStoredAppointments = () => {
    try {
      const raw = localStorage.getItem(APPOINTMENTS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const nextAppointmentNo = (records) => {
    const max = records.reduce((acc, record) => {
      const val = Number(String(record?.apNo || "").replace(/[^0-9]/g, "") || 0);
      return Math.max(acc, val);
    }, 175);
    return `AP-${String(max + 1).padStart(5, "0")}`;
  };

  const toReadableDate = (isoDate) => {
    const match = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return isoDate || "N/A";
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
    return `${months[Number(match[2]) - 1]} ${Number(match[3])}, ${match[1]}`;
  };

  const persistAppointmentRecord = () => {
    const records = readStoredAppointments();

    const firstName = document.getElementById("aptFName")?.value?.trim() || "";
    const lastName = document.getElementById("aptLName")?.value?.trim() || "";
    const email = document.getElementById("aptEmail")?.value?.trim() || "N/A";
    const contactNumber = document.getElementById("aptPhone")?.value?.trim() || "N/A";
    const purpose = document.getElementById("aptPurpose")?.value?.trim() || "Inquiries";
    const type = document.getElementById("aptRole")?.value?.trim() || "Student";
    const notes = document.getElementById("aptDesc")?.value?.trim() || "N/A";

    const province = document.getElementById("aptProvince")?.value?.trim() || "";
    const municipality = document.getElementById("aptMunicipality")?.value?.trim() || "";
    const barangay = document.getElementById("aptAddress")?.value?.trim() || "";
    const address = [barangay, municipality, province].filter(Boolean).join(", ") || "N/A";

    const selections = window.appointmentSelections || {};
    const selectedDates = Object.keys(selections).sort();
    const firstDate = selectedDates[0] || "N/A";
    const firstTime = selections[firstDate]?.[0] || "N/A";

    const appointment = {
      apNo: nextAppointmentNo(records),
      clientName: `${firstName} ${lastName}`.trim() || "N/A",
      contactNumber,
      email,
      address,
      type,
      purpose,
      fileAttach: uploadedAppointmentFile.name
        ? {
            name: uploadedAppointmentFile.name,
            dataUrl: uploadedAppointmentFile.dataUrl || "",
          }
        : { name: "N/A", dataUrl: "" },
      notes,
      date: firstDate,
      time: firstTime,
      status: "Scheduled",
      submittedAt: new Date().toISOString(),
      schedulePreview: toReadableDate(firstDate),
    };

    records.unshift(appointment);
    localStorage.setItem(APPOINTMENTS_STORAGE_KEY, JSON.stringify(records));
  };

  // 1. Open Flow
  if (appointmentBtn && appointmentOverlay) {
    appointmentBtn.addEventListener("click", () => {
      appointmentOverlay.classList.add("show-modal");
      document.body.style.overflow = "hidden";
      appointmentSubmitted = false;
      switchAptStep(1);
    });
  }

  const aptFileInput = document.getElementById("aptFile");
  aptFileInput?.addEventListener("change", async () => {
    const file = aptFileInput.files?.[0];
    if (!file) {
      uploadedAppointmentFile = { name: "", dataUrl: "" };
      return;
    }

    if (!file.type || (!file.type.startsWith("image/") && file.type !== "application/pdf")) {
      uploadedAppointmentFile = { name: file.name, dataUrl: "" };
      return;
    }

    try {
      const dataUrl = await fileToDataUrl(file);
      uploadedAppointmentFile = { name: file.name, dataUrl };
    } catch {
      uploadedAppointmentFile = { name: file.name, dataUrl: "" };
    }
  });

  const aptProvince = document.getElementById("aptProvince");
  const aptMunicipality = document.getElementById("aptMunicipality");
  const aptBarangay = document.getElementById("aptAddress");

  if (aptProvince && aptMunicipality && aptBarangay) {
    const phAddressData = {
      "Camarines Norte": {
        Daet: ["Barangay I", "Barangay II", "Barangay III", "Barangay IV"],
        Labo: ["Baay", "Canapawan", "Daguit", "Talobatib"],
        Basud: ["Angas", "Bactas", "Mocong", "Poblacion 1"],
      },
      "Camarines Sur": {
        Naga: ["Abella", "Bagumbayan Norte", "Concepcion Grande", "Tinago"],
        Iriga: ["San Agustin", "San Isidro", "Santa Cruz Sur", "Santiago"],
        Pili: ["Anayan", "Cadlan", "Del Rosario", "San Jose"],
      },
      Albay: {
        Legazpi: ["Bitano", "Bogtong", "Cabangan", "Puro"],
        Ligao: ["Busay", "Dunao", "Herrera", "Tuburan"],
        Tabaco: ["Basud", "Bombon", "Cobo", "Tagas"],
      },
      Sorsogon: {
        "Sorsogon City": ["Balogo", "Bibincahan", "Burabod", "Talisay"],
        Bulan: ["A. Bonifacio", "Aquino", "Calpi", "Zone 8"],
        Gubat: ["Ariman", "Bagacay", "Bentuco", "Balud del Sur"],
      },
      Quezon: {
        Lucena: ["Bocohan", "Dalahican", "Ibabang Dupay", "Mayao Crossing"],
        Candelaria: ["Bukal Sur", "Kinatihan I", "Malabanban Norte", "Pahinga Norte"],
        Sariaya: ["Balubal", "Concepcion 1", "Concepcion Banahaw", "Sampaloc 1"],
      },
      "Metro Manila": {
        Manila: ["Barangay 659", "Barangay 699", "Barangay 734", "Barangay 750"],
        Quezon: ["Bagumbayan", "Batasan Hills", "Commonwealth", "UP Campus"],
        Makati: ["Bel-Air", "Poblacion", "San Lorenzo", "Urdaneta"],
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

    fillSelect(aptProvince, Object.keys(phAddressData), "Select Province");

    aptProvince.addEventListener("change", () => {
      const selectedProvince = aptProvince.value;
      const municipalities = Object.keys(phAddressData[selectedProvince] || {});

      aptMunicipality.disabled = municipalities.length === 0;
      aptBarangay.disabled = true;
      fillSelect(aptMunicipality, municipalities, "Select Municipality");
      fillSelect(aptBarangay, [], "Select Barangay");
    });

    aptMunicipality.addEventListener("change", () => {
      const selectedProvince = aptProvince.value;
      const selectedMunicipality = aptMunicipality.value;
      const barangays =
        phAddressData[selectedProvince]?.[selectedMunicipality] || [];

      aptBarangay.disabled = barangays.length === 0;
      fillSelect(aptBarangay, barangays, "Select Barangay");
    });
  }

  // =========================================
  // CONTACT PAGE FORM
  // =========================================
  const contactMessageForm = document.getElementById("contactMessageForm");
  if (contactMessageForm) {
    contactMessageForm.addEventListener("submit", (event) => {
      event.preventDefault();
      alert("Thank you! Your message has been sent successfully.");
      contactMessageForm.reset();
    });
  }

  // 2. Close Flow via Back Arrow
  if (closeAppointmentBtn) {
    closeAppointmentBtn.addEventListener("click", () => {
      appointmentOverlay.classList.remove("show-modal");
      document.body.style.overflow = ""; // Resets to CSS
      appointmentSubmitted = false;
    });
  }

  // 3. Step Switching Engine
  function switchAptStep(stepNumber) {
    document
      .querySelectorAll(".apt-content-section")
      .forEach((sec) => sec.classList.remove("active"));

    document.querySelectorAll(".apt-step").forEach((step, index) => {
      const icon = step.querySelector(".apt-icon");
      if (index < stepNumber) {
        step.classList.add("active");
        icon.style.background = "#4caf50";
        icon.style.color = "#fff";
        icon.style.borderColor = "#fff";
      } else {
        step.classList.remove("active");
        icon.style.background = "#fff";
        icon.style.color = "#8b0000";
      }
    });

    const targetSection = document.getElementById("aptStep" + stepNumber);
    if (targetSection) targetSection.classList.add("active");

    if (stepNumber === 4 || stepNumber === 5) populateReviewData(stepNumber);
  }

  // 4. Data Transfer to Review Screen
  function populateReviewData(step) {
    const prefix = step === 4 ? "rev" : "com";

    const fName = document.getElementById("aptFName").value;
    const lName = document.getElementById("aptLName").value;
    const phone = document.getElementById("aptPhone").value;
    const email = document.getElementById("aptEmail").value;
    const address = document.getElementById("aptAddress").value;
    const purpose = document.getElementById("aptPurpose").value;
    const desc = document.getElementById("aptDesc").value;
    
    // New Logic for Time & Date from Step 3
    let schedHTML = "<div style='margin-top:5px;'>";
    
    // Use the global appointmentSelections object
    const selections = window.appointmentSelections || {};
    const dates = Object.keys(selections).sort();
    
    if (dates.length === 0) {
        schedHTML += "<div>No Date Selected</div>";
    } else {
        dates.forEach(dateKey => {
            const times = selections[dateKey];
            if (times && times.length > 0) {
                // Convert YYYY-MM-DD to readable format
                const dObj = new Date(dateKey);
                // Adjust for timezone offset or just parse string manually to avoid UTC issues
                // Simple parsing:
                const [y, m, d] = dateKey.split("-");
                const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
                const readableDate = `${months[parseInt(m)-1]} ${parseInt(d)}, ${y}`;
                
                schedHTML += `<div style="margin-bottom: 4px;"><strong>${readableDate}</strong>: ${times.join(", ")}</div>`;
            }
        });
    }
    schedHTML += "</div>";

    const setText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.innerText = text;
    };

    setText(prefix + "Name", `${fName} ${lName}`.trim() || "Kevin Arevalo");
    setText(prefix + "Email", email || "kevin@gmail.com");
    setText(prefix + "Address", address || "Masalong, Labo");
    setText(prefix + "Phone", phone || "09911341158");
    setText(prefix + "Purpose", purpose);
    
    // For the Ticket View, we use innerHTML to support multiple lines
    const schedEl = document.getElementById(prefix + "Sched");
    if(schedEl) schedEl.innerHTML = schedHTML;
    
    setText(prefix + "Desc", desc || "N/A");
  }

  // 5. Button Bindings (No inline onclicks used)
  const bindClick = (id, callback) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", callback);
  };

  // Step 1 to Privacy
  bindClick("btnGoToPrivacy", () => privacyModal.classList.add("show-modal"));
  bindClick("cancelPrivacyBtn", () =>
    privacyModal.classList.remove("show-modal"),
  );
  bindClick("acceptPrivacyBtn", () => {
    privacyModal.classList.remove("show-modal");
    switchAptStep(2);
  });

  // Step 2 to Step 3
  bindClick("btnCancelTo1", () => switchAptStep(1));
  bindClick("btnGoToStep3", () => switchAptStep(3));

  // Step 3 to Confirm
  bindClick("btnCancelTo2", () => switchAptStep(2));
  bindClick("btnGoToConfirm", () => confirmModal.classList.add("show-modal"));
  bindClick("cancelConfirmBtn", () =>
    confirmModal.classList.remove("show-modal"),
  );
  bindClick("acceptConfirmBtn", () => {
    confirmModal.classList.remove("show-modal");
    switchAptStep(4);
  });

  // Step 4 to Step 5 (Immediate View)
  bindClick("btnCancelTo3", () => switchAptStep(3));
  
  bindClick("btnGoToStep5", () => {
    switchAptStep(5); 
    // No timeout anymore - show the actual ticket immediately
  });

  // Step 5 Actions
  bindClick("btnGenerateReport", () => {
      // Simulate PDF generation
      alert("Report generated successfully! Check your downloads.");
  });

  bindClick("btnFinishStep5", () => {
      if (!appointmentSubmitted) {
        persistAppointmentRecord();
        appointmentSubmitted = true;
      }

      // Show Success Modal on Finish
      const successModal = document.getElementById("successAppointmentModal");
      if(successModal) {
          successModal.classList.add("active");
          successModal.style.visibility = "visible";
          successModal.style.opacity = "1";
      }
  });

  // Success Modal Home Button
  bindClick("btnSuccessHome", () => {
    const successModal = document.getElementById("successAppointmentModal");
    if(successModal) {
        successModal.classList.remove("active");
        successModal.style.visibility = "hidden";
        successModal.style.opacity = "0";
    }
    appointmentOverlay.classList.remove("show-modal");
    document.body.style.overflow = ""; // Resets to CSS (which keeps overflow-x: hidden)
    // Optional: Reset form here
    appointmentSubmitted = false;
    switchAptStep(1);
  });
});

// =========================================
// NEW CALENDAR LOGIC (Step 3)
// =========================================
document.addEventListener("DOMContentLoaded", () => {
  const CALENDAR_BLOCKS_STORAGE_KEY = "fmrcAppointmentCalendarBlocks";
  const calGrid = document.getElementById("calDaysGrid");
  const monthDisplay = document.getElementById("calMonthYear");
  const prevBtn = document.getElementById("calPrevBtn");
  const nextBtn = document.getElementById("calNextBtn");
  const timeContainer = document.getElementById("timeSlotsContainer");
  const selectedDateDisplay = document.getElementById("selectedDateDisplay");
  const slotCounter = document.getElementById("slotCounter");
  const limitMsg = document.getElementById("maxLimitMsg");

  // State
  let today = new Date(2026, 2, 23); // March 23, 2026 (Fixed Context Date)
  let currentMonth = today.getMonth();
  let currentYear = today.getFullYear();
  let selectedDateKey = null; // Format "YYYY-MM-DD"

  // User selections: one slot per date -> { "2026-03-25": ["9:00 - 10:00 AM"] }
  window.appointmentSelections = {};

  // Demo booked slots from other users per date.
  window.bookedAppointmentSlots = {
    "2026-03-24": ["9:00 - 10:00 AM", "2:00 - 3:00 PM"],
    "2026-03-26": ["10:00 - 11:00 AM"],
    "2026-03-30": ["1:00 - 2:00 PM", "3:00 - 4:00 PM"]
  };

  const readAdminCalendarBlocks = () => {
    try {
      const raw = localStorage.getItem(CALENDAR_BLOCKS_STORAGE_KEY);
      if (!raw) return { blockedDays: [], blockedSlots: {} };
      const parsed = JSON.parse(raw);
      return {
        blockedDays: Array.isArray(parsed?.blockedDays) ? parsed.blockedDays : [],
        blockedSlots:
          parsed?.blockedSlots && typeof parsed.blockedSlots === "object"
            ? parsed.blockedSlots
            : {},
      };
    } catch {
      return { blockedDays: [], blockedSlots: {} };
    }
  };

  const getAdminBlocks = () => readAdminCalendarBlocks();

  const timeSlots = [
    { label: "9:00 - 10:00 AM", type: "AM" },
    { label: "10:00 - 11:00 AM", type: "AM" },
    { label: "11:00 - 12:00 AM", type: "AM" },
    { label: "1:00 - 2:00 PM", type: "PM" },
    { label: "2:00 - 3:00 PM", type: "PM" },
    { label: "3:00 - 4:00 PM", type: "PM" }
  ];

  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  // Initialize
  if (calGrid) {
    renderCalendar(currentMonth, currentYear);
    
    prevBtn.addEventListener("click", () => {
      currentMonth--;
      if (currentMonth < 0) { currentMonth = 11; currentYear--; }
      renderCalendar(currentMonth, currentYear);
    });

    nextBtn.addEventListener("click", () => {
      currentMonth++;
      if (currentMonth > 11) { currentMonth = 0; currentYear++; }
      renderCalendar(currentMonth, currentYear);
    });
  }

  function renderCalendar(month, year) {
    calGrid.innerHTML = "";
    monthDisplay.innerText = `${months[month]} ${year}`;

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Empty cells for previous month
    for (let i = 0; i < firstDay; i++) {
      const emptyCell = document.createElement("div");
      calGrid.appendChild(emptyCell);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const cell = document.createElement("div");
      cell.classList.add("cal-day-cell");
      cell.innerText = day;

      const cellDate = new Date(year, month, day);
      const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      
      // Determine Status
      const isWeekend = cellDate.getDay() === 0 || cellDate.getDay() === 6;
      const isPast = cellDate < new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const adminBlocks = getAdminBlocks();
      const isAdminBlockedDay = adminBlocks.blockedDays.includes(dateKey);
      
      if (isWeekend) {
        cell.classList.add("disabled", "unavailable");
        cell.setAttribute("title", "Unavailable: Weekend");
      } else if (isPast) {
        cell.classList.add("disabled");
        cell.style.opacity = "0.5";
        cell.setAttribute("title", "Unavailable: Past Date");
      } else if (isAdminBlockedDay) {
        cell.classList.add("disabled", "unavailable");
        cell.setAttribute("title", "Unavailable: Blocked by admin");
      } else {
        // Active Date
        cell.addEventListener("click", () => handleDateClick(cell, dateKey, day, month, year));
        
        if (dateKey === selectedDateKey) {
            cell.classList.add("selected");
        }
        
        // Check indicators state
        updateDayIndicators(cell, dateKey);
      }

      calGrid.appendChild(cell);
    }
  }

  function showSlotMessage(message, color = "#b01c1c") {
    if (!limitMsg) return;
    limitMsg.style.display = "block";
    limitMsg.style.color = color;
    limitMsg.innerText = message;
    setTimeout(() => {
      limitMsg.style.display = "none";
    }, 3500);
  }

  function getCombinedSlotsForDate(dateKey) {
    const selected = window.appointmentSelections[dateKey] || [];
    const booked = window.bookedAppointmentSlots[dateKey] || [];
    const adminBlocked = getAdminBlocks().blockedSlots?.[dateKey] || [];
    return [...new Set([...selected, ...booked, ...adminBlocked])];
  }

  function updateDayIndicators(cell, dateKey) {
    const apps = getCombinedSlotsForDate(dateKey);
    const hasAM = apps.some((t) => t.includes("AM"));
    const hasPM = apps.some((t) => t.includes("PM"));
    
    cell.classList.remove("has-am", "has-pm", "has-full");

    if (hasAM && hasPM) {
      cell.classList.add("has-full");
      cell.setAttribute("title", "AM and PM slots have booked/selected times");
    } else if (hasAM) {
        cell.classList.add("has-am");
      cell.setAttribute("title", "AM has booked/selected time");
    } else if (hasPM) {
        cell.classList.add("has-pm");
      cell.setAttribute("title", "PM has booked/selected time");
    } else {
        cell.setAttribute("title", "Available");
    }
  }

  function handleDateClick(cell, dateKey, day, month, year) {
    // Remove selected from others
    document.querySelectorAll(".cal-day-cell").forEach(c => c.classList.remove("selected"));
    cell.classList.add("selected");
    
    selectedDateKey = dateKey;
    selectedDateDisplay.innerText = `${months[month]} ${day}, ${year}`;
    
    // Show Counter
    if(slotCounter) slotCounter.style.display = "block";
    
    renderTimeSlots(dateKey);
  }

  function renderTimeSlots(dateKey) {
    timeContainer.innerHTML = "";
    const currentApps = window.appointmentSelections[dateKey] || [];
    const selectedSlot = currentApps[0] || null;
    const bookedSlots = window.bookedAppointmentSlots[dateKey] || [];
    const adminBlocks = getAdminBlocks();
    const adminBlockedSlots = adminBlocks.blockedSlots?.[dateKey] || [];
    const isAdminBlockedDay = adminBlocks.blockedDays.includes(dateKey);

    if (slotCounter) {
      slotCounter.innerText = "Allowed: 1 time slot for this selected date";
      slotCounter.style.color = "#555";
    }

    timeSlots.forEach(slot => {
        const btn = document.createElement("div");
        btn.classList.add("time-slot-btn");

        const isSelected = selectedSlot === slot.label;
        const isBooked = bookedSlots.includes(slot.label);
        const isAdminBlockedSlot = adminBlockedSlots.includes(slot.label);

        if (isSelected) btn.classList.add("selected");

        if (isBooked || isAdminBlockedSlot || isAdminBlockedDay) {
          btn.classList.add("disabled");
          if (isAdminBlockedDay) {
            btn.setAttribute("title", "Unavailable: blocked by admin for the whole day");
          } else if (isAdminBlockedSlot) {
            btn.setAttribute("title", "Unavailable: blocked by admin for this time slot");
          } else {
            btn.setAttribute("title", "Unavailable: already selected by another user for this date");
          }
        }

        btn.innerHTML = `
            <span>${slot.label}</span>
            <span class="time-slot-label">${slot.type}</span>
        `;

        btn.addEventListener("click", () => {
            if (isAdminBlockedDay) {
              showSlotMessage("This date is blocked by admin.");
              return;
            }
            if (isAdminBlockedSlot) {
              showSlotMessage("This time is blocked by admin for the selected date.");
              return;
            }
            if (isBooked) {
              showSlotMessage("This time is disabled because another user already booked this date and time.");
              return;
            }
            toggleTimeSlot(dateKey, slot.label);
        });

        timeContainer.appendChild(btn);
    });
  }

  function toggleTimeSlot(dateKey, timeLabel) {
    if (!window.appointmentSelections[dateKey]) window.appointmentSelections[dateKey] = [];

    const currentSelection = window.appointmentSelections[dateKey][0] || null;

    if (currentSelection === timeLabel) {
      // Deselect the same time when clicked again.
      window.appointmentSelections[dateKey] = [];
      if (limitMsg) limitMsg.style.display = "none";
    } else {
      // Enforce only one selected time slot for the chosen date.
      window.appointmentSelections[dateKey] = [timeLabel];
      if (currentSelection && currentSelection !== timeLabel) {
        showSlotMessage("Only one time slot can be selected per day. Your previous selection was replaced.", "#0b6f36");
      } else if (limitMsg) {
        limitMsg.style.display = "none";
      }
    }
    
    // Re-render to show updates
    renderTimeSlots(dateKey);
    
    // Update date indicators with booked + selected slot states.
    renderCalendar(currentMonth, currentYear);
  }

});

// --- USER PROFILE AND AUTHENTICATION LOGIC ---
(() => {
  const userProfileBtn = document.querySelector(".user-profile");
  if (!userProfileBtn) return;

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

  const token = localStorage.getItem("customer_token");
  const userInfoStr = localStorage.getItem("customer_info");
  let userInfo = null;

  try {
    if (userInfoStr) userInfo = JSON.parse(userInfoStr);
  } catch {
    userInfo = null;
  }

  if (!(token && userInfo)) {
    const guestDropdown = document.createElement("div");
    guestDropdown.className = "profile-popup guest-profile-popup";
    guestDropdown.innerHTML = `
      <div class="popup-header">
        <div class="popup-profile-row">
          <span class="popup-profile-icon">?</span>
          <div class="popup-profile-meta">
            <p class="popup-identity">Welcome, guest</p>
            <span class="popup-role">Customer Portal</span>
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
          <p class="popup-identity">${userInfo.email || userInfo.username || userInfo.name || "Customer"}</p>
          <span class="popup-role">Customer</span>
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
