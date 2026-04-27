/**
 * products.js — Customer Products Page
 * Fetches products from the Laravel API and renders them dynamically.
 * Replaces all hardcoded product cards.
 */
document.addEventListener("DOMContentLoaded", () => {
  const API_BASE_URL = `${window.location.protocol}//${window.location.hostname}:8000/api`;

  const productGrid   = document.getElementById("productGrid");
  const emptyState    = document.getElementById("productsEmptyState");
  const searchInput   = document.getElementById("productSearchInput");
  const categorySelect= document.getElementById("productCategorySelect");
  const filterSelect  = document.getElementById("productFilterSelect");

  // View Info Modal elements
  const productInfoModal      = document.getElementById("productInfoModal");
  const productInfoTitle      = document.getElementById("productInfoTitle");
  const productInfoImage      = document.getElementById("productInfoImage");
  const productInfoSummary    = document.getElementById("productInfoSummary");
  const productInfoChips      = document.getElementById("productInfoChips");
  const productInfoAvailability  = document.getElementById("productInfoAvailability");
  const productInfoRecommended   = document.getElementById("productInfoRecommended");
  const closeProductInfoModal    = document.getElementById("closeProductInfoModal");
  const productInfoAddToCart     = document.getElementById("productInfoAddToCart");
  const productInfoBuyNow        = document.getElementById("productInfoBuyNow");

  let allProducts     = [];
  let displayedProducts = [];

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const formatPrice = (v) =>
    `₱${Number(v || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const escHtml = (v) =>
    String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  const CART_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>`;
  const BUY_SVG  = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path></svg>`;
  const INFO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;

  // ── Build a product card HTML ─────────────────────────────────────────────────
  const buildCard = (p) => {
    const isOutOfStock = p.stock_status === "out_of_stock" || Number(p.stock) <= 0;
    const stockBadgeClass = isOutOfStock ? "out-of-stock" : "in-stock";
    const stockBadgeText  = isOutOfStock ? "Out of Stock" : "In Stock";
    const stockText       = isOutOfStock ? "Out of stock" : `${p.stock} in stock`;

    const imgHtml = p.image_data
      ? `<img src="${p.image_data}" alt="${escHtml(p.name)}" />`
      : `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#9ca3af;font-size:0.8rem;flex-direction:column;gap:6px;">
           <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
           No image
        </div>`;

    const disabledAttr = isOutOfStock ? "disabled" : "";
    const disabledClass = isOutOfStock ? "disabled" : "";

    return `
      <div class="shop-card" data-product-id="${p.id}">
        <div class="product-img-wrapper">${imgHtml}</div>
        <div class="product-info">
          <h3 class="product-name">${escHtml(p.name)}</h3>
          <div class="product-code-row">
            <span class="code-label">PRODUCT CODE:</span>
            <span class="code-value">${escHtml(p.code || "—")}</span>
          </div>
          <div class="product-price">${formatPrice(p.price)}</div>
          <div class="product-stock-row">
            <span class="stock-text">${stockText}</span>
            <span class="stock-badge ${stockBadgeClass}">${stockBadgeText}</span>
          </div>
        </div>
        <div class="product-actions">
          <button class="action-btn btn-view-info" data-action="view-info" data-product-id="${p.id}" title="View product details">
            ${INFO_SVG} View Info
          </button>
          <button class="action-btn btn-add-cart ${disabledClass}" ${disabledAttr} data-action="add-cart" data-product-id="${p.id}">
            ${CART_SVG} Add to Cart
          </button>
          <button class="action-btn btn-buy-now ${disabledClass}" ${disabledAttr} data-action="buy-now" data-product-id="${p.id}">
            ${BUY_SVG} Buy Now
          </button>
        </div>
      </div>`;
  };

  // ── Render the grid ─────────────────────────────────────────────────────────
  const renderGrid = () => {
    const q      = (searchInput?.value || "").trim().toLowerCase();
    const cat    = categorySelect?.value || "all";
    const filter = filterSelect?.value  || "all";

    let result = allProducts.slice();

    // Category filter
    if (cat !== "all") {
      const catMap = { "3dprint": "3D Print", "laser": "Laser Cut", "cnc": "CNC" };
      const catVal = catMap[cat] || cat;
      result = result.filter(p => p.category === catVal || p.category.toLowerCase().includes(cat));
    }

    // Search
    if (q) {
      result = result.filter(p =>
        `${p.name} ${p.code} ${p.category}`.toLowerCase().includes(q)
      );
    }

    // Filter (stock / price sort)
    if (filter === "in-stock")      result = result.filter(p => p.stock_status === "in_stock" && Number(p.stock) > 0);
    if (filter === "out-of-stock")  result = result.filter(p => p.stock_status === "out_of_stock" || Number(p.stock) <= 0);
    if (filter === "price-low")     result = result.sort((a, b) => Number(a.price) - Number(b.price));
    if (filter === "price-high")    result = result.sort((a, b) => Number(b.price) - Number(a.price));

    displayedProducts = result;

    if (!productGrid) return;

    if (!result.length) {
      productGrid.innerHTML = "";
      if (emptyState) emptyState.style.display = "flex";
      return;
    }

    if (emptyState) emptyState.style.display = "none";
    productGrid.innerHTML = result.map(buildCard).join("");
  };

  // ── Open View Info Modal ─────────────────────────────────────────────────────
  const openViewInfo = (product) => {
    if (!productInfoModal) return;

    if (productInfoTitle)   productInfoTitle.textContent = product.name;
    if (productInfoImage)   {
      productInfoImage.src = product.image_data || "";
      productInfoImage.style.display = product.image_data ? "" : "none";
    }
    if (productInfoSummary) productInfoSummary.textContent = product.summary || "No description available.";

    // Chips
    if (productInfoChips) {
      const chips = product.details_chips || [];
      productInfoChips.innerHTML = chips.length
        ? chips.map(c => `<span class="feature-chip">${escHtml(c)}</span>`).join("")
        : "<span style='color:#9ca3af;font-size:0.82rem;'>No details specified.</span>";
    }

    // Availability
    if (productInfoAvailability) {
      const avail = product.availability || [];
      productInfoAvailability.innerHTML = avail.length
        ? avail.map(a => `<li>${escHtml(a)}</li>`).join("")
        : "<li style='color:#9ca3af;'>Not specified.</li>";
    }

    // Recommended for
    if (productInfoRecommended) {
      const rec = product.recommended_for || [];
      productInfoRecommended.innerHTML = rec.length
        ? rec.map(r => `<li>${escHtml(r)}</li>`).join("")
        : "<li style='color:#9ca3af;'>Not specified.</li>";
    }

    // Wire up the modal action buttons to this product
    if (productInfoAddToCart) {
      const isOutOfStock = product.stock_status === "out_of_stock" || Number(product.stock) <= 0;
      productInfoAddToCart.disabled = isOutOfStock;
      productInfoAddToCart.className = `modal-btn outline-btn${isOutOfStock ? " disabled" : ""}`;
      productInfoAddToCart.onclick = isOutOfStock ? null : (e) => {
        if (e) e.preventDefault();
        productInfoModal.classList.remove("show-modal");
        // Delegate to existing cart logic via custom event
        document.dispatchEvent(new CustomEvent("product:add-to-cart", { detail: product }));
      };
    }
    if (productInfoBuyNow) {
      const isOutOfStock = product.stock_status === "out_of_stock" || Number(product.stock) <= 0;
      productInfoBuyNow.disabled = isOutOfStock;
      productInfoBuyNow.className = `modal-btn solid-btn${isOutOfStock ? " disabled" : ""}`;
      productInfoBuyNow.onclick = isOutOfStock ? null : (e) => {
        if (e) e.preventDefault();
        productInfoModal.classList.remove("show-modal");
        document.dispatchEvent(new CustomEvent("product:buy-now", { detail: product }));
      };
    }

    productInfoModal.classList.add("show-modal");
  };

  closeProductInfoModal?.addEventListener("click", () => {
    productInfoModal?.classList.remove("show-modal");
  });

  productInfoModal?.addEventListener("click", (e) => {
    if (e.target === productInfoModal) productInfoModal.classList.remove("show-modal");
  });

  // ── Grid click delegation ────────────────────────────────────────────────────
  productGrid?.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    const btn = target.closest("[data-action]");
    if (!btn) return;

    e.preventDefault(); // Prevent any form submission or page reload

    const id      = Number(btn.getAttribute("data-product-id"));
    const product = allProducts.find(p => p.id === id);
    if (!product) return;

    const action = btn.getAttribute("data-action");
    if (action === "view-info") {
      openViewInfo(product);
    } else if (action === "add-cart") {
      document.dispatchEvent(new CustomEvent("product:add-to-cart", { detail: product }));
    } else if (action === "buy-now") {
      document.dispatchEvent(new CustomEvent("product:buy-now", { detail: product }));
    }
  });

  // ── Filters ──────────────────────────────────────────────────────────────────
  searchInput?.addEventListener("input", renderGrid);
  categorySelect?.addEventListener("change", renderGrid);
  filterSelect?.addEventListener("change", renderGrid);

  // ── Fetch products from API ──────────────────────────────────────────────────
  const loadProducts = async () => {
    // Show loading skeleton
    if (productGrid) {
      productGrid.innerHTML = Array.from({ length: 4 }).map(() => `
        <div class="shop-card" style="pointer-events:none;">
          <div class="product-img-wrapper" style="background:linear-gradient(90deg,#f3f4f6 25%,#e5e7eb 50%,#f3f4f6 75%);background-size:200% 100%;animation:shimmer 1.4s infinite;"></div>
          <div class="product-info">
            <div style="height:14px;border-radius:6px;background:linear-gradient(90deg,#f3f4f6 25%,#e5e7eb 50%,#f3f4f6 75%);background-size:200% 100%;animation:shimmer 1.4s infinite;margin-bottom:8px;"></div>
            <div style="height:10px;border-radius:6px;background:linear-gradient(90deg,#f3f4f6 25%,#e5e7eb 50%,#f3f4f6 75%);background-size:200% 100%;animation:shimmer 1.4s infinite;width:60%;"></div>
          </div>
        </div>`).join("");
    }
    if (emptyState) emptyState.style.display = "none";

    try {
      const res = await fetch(`${API_BASE_URL}/products`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error("Failed to fetch products");
      const payload = await res.json();
      allProducts = Array.isArray(payload?.data) ? payload.data : [];
      renderGrid();
    } catch (err) {
      console.error("Failed to load products:", err);
      allProducts = [];
      if (productGrid) productGrid.innerHTML = "";
      if (emptyState) emptyState.style.display = "flex";
    }
  };

  void loadProducts();

  // ── Realtime updates ─────────────────────────────────────────────────────────
  // Debounce guard: prevent multiple rapid loadProducts() calls triggered
  // by simultaneous BroadcastChannel + window events for the same action.
  let _reloadDebounceTimer = null;
  const debouncedLoadProducts = () => {
    if (_reloadDebounceTimer) clearTimeout(_reloadDebounceTimer);
    _reloadDebounceTimer = setTimeout(() => {
      _reloadDebounceTimer = null;
      void loadProducts();
    }, 600);
  };

  // Helper: only refresh for genuine order-related types
  const isOrderRelevantType = (type) =>
    type === "created" || type === "updated";

  // Listen for order events from OTHER tabs (BroadcastChannel only).
  // Only react to actual order creation/update — not profile changes.
  const ORDERS_REALTIME_CHANNEL = "fmrc-orders-realtime";
  if (typeof window.BroadcastChannel === "function") {
    const ordersChannel = new window.BroadcastChannel(ORDERS_REALTIME_CHANNEL);
    ordersChannel.addEventListener("message", (event) => {
      if (document.hidden) return; // Don't refresh in background tabs
      const payload = event?.data || {};
      // Only refresh stock when an order is actually created/updated
      if (isOrderRelevantType(payload.type)) {
        debouncedLoadProducts();
      }
    });
  }

  // Listen to product-specific real-time updates broadcast by the Admin portal.
  const PRODUCTS_REALTIME_CHANNEL = "fmrc-products-realtime";
  if (typeof window.BroadcastChannel === "function") {
    const productsChannel = new window.BroadcastChannel(PRODUCTS_REALTIME_CHANNEL);
    productsChannel.addEventListener("message", (event) => {
      if (document.hidden) return; // Don't refresh in background tabs
      const payload = event?.data || {};
      if (payload.type === "updated" || payload.type === "created" || payload.type === "deleted") {
        debouncedLoadProducts();
      }
    });
  }

  // Listen to the local window event so that the product list refreshes
  // immediately when the customer places an order on this same page.
  // Only react to actual order creation — not profile updates.
  // The debounce ensures this doesn't double-fire with the BroadcastChannel.
  window.addEventListener("fmrc:orders-updated", (event) => {
    const payload = event?.detail || {};
    // Skip profile-updated signals — they don't affect product stock
    if (payload.type === "profile-updated") return;
    if (!isOrderRelevantType(payload.type)) return;
    debouncedLoadProducts();
  });
});
