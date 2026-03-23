document.addEventListener("DOMContentLoaded", () => {
  const navLinks = document.querySelectorAll(".nav-link");
  const sections = document.querySelectorAll("main, section");

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
          navLinks.forEach((link) => link.classList.remove("active"));
          const activeLink = document.querySelector(
            `.nav-link[href*="#${id}"]`,
          );
          if (activeLink) {
            activeLink.classList.add("active");
          }
        }
      }
    });
  }, observerOptions);

  sections.forEach((section) => {
    if (section.id) {
      observer.observe(section);
    }
  });

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
    clone.style.transition = "all 0.8s cubic-bezier(0.25, 0.8, 0.25, 1)";
    clone.style.pointerEvents = "none";

    document.body.appendChild(clone);
    clone.getBoundingClientRect(); // Trigger reflow

    const translateX =
      cartRect.left - imgRect.left + cartRect.width / 2 - imgRect.width / 2;
    const translateY =
      cartRect.top - imgRect.top + cartRect.height / 2 - imgRect.height / 2;

    clone.style.transform = `translate(${translateX}px, ${translateY}px) scale(0.1)`;
    clone.style.opacity = "0.3";

    setTimeout(() => clone.remove(), 800);
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

  // 1. Open Flow
  if (appointmentBtn && appointmentOverlay) {
    appointmentBtn.addEventListener("click", () => {
      appointmentOverlay.classList.add("show-modal");
      document.body.style.overflow = "hidden";
      switchAptStep(1);
    });
  }

  // 2. Close Flow via Back Arrow
  if (closeAppointmentBtn) {
    closeAppointmentBtn.addEventListener("click", () => {
      appointmentOverlay.classList.remove("show-modal");
      document.body.style.overflow = ""; // Resets to CSS
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
    switchAptStep(1);
  });
});

// =========================================
// NEW CALENDAR LOGIC (Step 3)
// =========================================
document.addEventListener("DOMContentLoaded", () => {
  const calGrid = document.getElementById("calDaysGrid");
  const monthDisplay = document.getElementById("calMonthYear");
  const prevBtn = document.getElementById("calPrevBtn");
  const nextBtn = document.getElementById("calNextBtn");
  const timeContainer = document.getElementById("timeSlotsContainer");
  const selectedDateDisplay = document.getElementById("selectedDateDisplay");
  const slotCounter = document.getElementById("slotCounter"); // New
  const limitMsg = document.getElementById("maxLimitMsg");    // New

  // State
  let today = new Date(2026, 2, 23); // March 23, 2026 (Fixed Context Date)
  let currentMonth = today.getMonth();
  let currentYear = today.getFullYear();
  let selectedDateKey = null; // Format "YYYY-MM-DD"

  // "Database" of selections for demo purposes
  // storing array of selected times: { "2026-03-25": ["9:00-10:00 AM"] }
  window.appointmentSelections = {};

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
      
      if (isWeekend) {
        cell.classList.add("disabled", "unavailable");
        cell.setAttribute("title", "Unavailable: Weekend");
      } else if (isPast) {
        cell.classList.add("disabled");
        cell.style.opacity = "0.5";
        cell.setAttribute("title", "Unavailable: Past Date");
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

  function updateDayIndicators(cell, dateKey) {
    const apps = window.appointmentSelections[dateKey] || [];
    const hasAM = apps.some(t => t.includes("AM"));
    const hasPM = apps.some(t => t.includes("PM"));
    
    cell.classList.remove("has-am", "has-pm", "has-full");

    if (hasAM && hasPM) {
        cell.classList.add("has-full");
        cell.setAttribute("title", "Full Booking (AM & PM)");
    } else if (hasAM) {
        cell.classList.add("has-am");
        cell.setAttribute("title", "AM Selected");
    } else if (hasPM) {
        cell.classList.add("has-pm");
        cell.setAttribute("title", "PM Selected");
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
    
    // Calculate Total Selected across ALL dates
    const totalSelected = Object.values(window.appointmentSelections).reduce((sum, arr) => sum + arr.length, 0);

    // Update Counter Text
    if (slotCounter) {
        slotCounter.innerText = `Total Selected: ${totalSelected}/6`;
        slotCounter.style.color = (totalSelected >= 6) ? "#b01c1c" : "#555";
    }

    timeSlots.forEach(slot => {
        const btn = document.createElement("div");
        btn.classList.add("time-slot-btn");
        
        // Check if selected
        const isSelected = currentApps.includes(slot.label);
        if (isSelected) btn.classList.add("selected");
        
        // If limit reached and not selected, disable it
        if (!isSelected && totalSelected >= 6) {
           btn.classList.add("disabled");
           btn.style.opacity = "0.5";
           btn.style.cursor = "not-allowed";
        }

        btn.innerHTML = `
            <span>${slot.label}</span>
            <span class="time-slot-label">${slot.type}</span>
        `;
        
        btn.addEventListener("click", () => {
            toggleTimeSlot(dateKey, slot.label);
        });

        timeContainer.appendChild(btn);
    });
  }

  function toggleTimeSlot(dateKey, timeLabel) {
    if (!window.appointmentSelections[dateKey]) window.appointmentSelections[dateKey] = [];
    
    const index = window.appointmentSelections[dateKey].indexOf(timeLabel);
    
    // Check Total Count
    const totalSelected = Object.values(window.appointmentSelections).reduce((sum, arr) => sum + arr.length, 0);

    if (index > -1) {
        // Deselecting is always allowed
        window.appointmentSelections[dateKey].splice(index, 1);
        if (limitMsg) limitMsg.style.display = "none"; 
    } else {
        // SELECTING: Check Global Limit
        if (totalSelected >= 6) {
            if (limitMsg) {
                limitMsg.style.display = "block";
                limitMsg.innerText = "Maximum limit of 6 slots (total across all dates) reached!";
                setTimeout(() => { limitMsg.style.display = "none"; }, 3000);
            }
            return; // STOP HERE
        }
        
        window.appointmentSelections[dateKey].push(timeLabel); 
    }
    
    // Re-render to show updates
    renderTimeSlots(dateKey);
    
    // Update Calendar Indicator as before
    renderCalendar(currentMonth, currentYear);
  }

});

