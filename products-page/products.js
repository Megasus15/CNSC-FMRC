/**
 * products.js — Customer Products Page
 * Fetches products from the Laravel API and renders them dynamically.
 * Replaces all hardcoded product cards.
 */
document.addEventListener("DOMContentLoaded", () => {
  const API_BASE_URL = (() => {
    const proto = window.location.protocol;
    const host = window.location.hostname;
    const port = window.location.port;
    if (port === "8000") return `${proto}//${host}:${port}/api`;
    if (host === "localhost" || host === "127.0.0.1")
      return `${proto}//${host}:8000/api`;
    return `${proto}//${host}/api`;
  })();

  const productGrid = document.getElementById("productGrid");
  const emptyState = document.getElementById("productsEmptyState");
  const searchInput = document.getElementById("productSearchInput");
  const categorySelect = document.getElementById("productCategorySelect");
  const filterSelect = document.getElementById("productFilterSelect");

  // View Info Modal elements
  const productInfoModal = document.getElementById("productInfoModal");
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
  const closeProductInfoModal = document.getElementById(
    "closeProductInfoModal",
  );
  const productInfoAddToCart = document.getElementById("productInfoAddToCart");
  const productInfoBuyNow = document.getElementById("productInfoBuyNow");
  const productInfoReviews = document.getElementById("productInfoReviews");
  const productInfoReviewsCount = document.getElementById("productInfoReviewsCount");

  const customerReviewsModal = document.getElementById("customerReviewsModal");
  const closeCustomerReviewsModal = document.getElementById("closeCustomerReviewsModal");
  const customerReviewsProductName = document.getElementById("customerReviewsProductName");
  const customerReviewsAverage = document.getElementById("customerReviewsAverage");
  const customerReviewsTotal = document.getElementById("customerReviewsTotal");
  const customerReviewsFilters = document.getElementById("customerReviewsFilters");
  const customerReviewsStatus = document.getElementById("customerReviewsStatus");
  const customerReviewsList = document.getElementById("customerReviewsList");
  const customerReviewsLoadMore = document.getElementById("customerReviewsLoadMore");

  let allProducts = [];
  let displayedProducts = [];
  const reviewState = {
    product: null,
    filter: "all",
    page: 1,
    lastPage: 1,
    reviews: [],
    loading: false,
    requestId: 0,
    abortController: null,
  };

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const formatPrice = (v) =>
    `₱${Number(v || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const escHtml = (v) =>
    String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const escAttr = (v) =>
    escHtml(v).replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  const resolveMediaUrl = (value) => {
    if (!value) return "";
    try {
      return new URL(value, API_BASE_URL).href;
    } catch {
      return String(value);
    }
  };

  const notifyCustomer = async (message, options = {}) => {
    if (typeof showCustomerPopup === "function") {
      await showCustomerPopup(message, options);
      return;
    }
    window.alert(message);
  };

  const renderReviewStars = (stars) => {
    const count = Math.max(0, Math.min(5, Number(stars) || 0));
    return Array.from({ length: 5 }, (_, index) =>
      `<span class="customer-review-star${index < count ? " filled" : ""}" aria-hidden="true">★</span>`,
    ).join("");
  };

  // ── Product card rating row (real data from customer reviews) ─────────────────
  // Averages come from the API (`rating_average` / `review_count`), which Laravel
  // aggregates from the `product_ratings` rows submitted through the
  // "My Orders → To Rate" modal. Half stars are rounded to the nearest half.
  const getRatingAverage = (product) => {
    const value = Number(product?.rating_average);
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.max(0, Math.min(5, value));
  };

  const getReviewCount = (product) => {
    const value = Number(product?.review_count);
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
  };

  const renderCardStars = (average) => {
    const rounded = Math.round(Number(average || 0) * 2) / 2;
    return Array.from({ length: 5 }, (_, index) => {
      const position = index + 1;
      let stateClass = "";
      if (rounded >= position) stateClass = " filled";
      else if (rounded >= position - 0.5) stateClass = " half";
      return `<span class="product-star${stateClass}" aria-hidden="true">★</span>`;
    }).join("");
  };

  const buildRatingRow = (product) => {
    const average = getRatingAverage(product);
    const count = getReviewCount(product);
    const label = count
      ? `Rated ${average.toFixed(1)} out of 5 from ${count} customer review${count === 1 ? "" : "s"}`
      : "No customer reviews yet";

    return `
      <button type="button" class="product-rating-row" data-action="view-reviews" data-product-id="${escAttr(product.id)}" title="${escAttr(label)}" aria-label="${escAttr(label)}">
        <span class="rating-score"><span class="rating-score-value">${average.toFixed(1)}</span>/5</span>
        <span class="rating-stars">
          ${renderCardStars(average)}
          <span class="rating-count">(${count})</span>
        </span>
      </button>
    `;
  };

  /** Repaint one card's rating row in place (no full grid re-render). */
  const updateCardRatingRow = (product) => {
    if (!productGrid || !product) return;
    const card = productGrid.querySelector(`.shop-card[data-product-id="${CSS.escape(String(product.id))}"]`);
    const row = card?.querySelector(".product-rating-row");
    if (!row) return;
    row.outerHTML = buildRatingRow(product);
  };

  const formatReviewDate = (value) => {
    const date = new Date(value || "");
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("en-PH", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const renderReviewMedia = (media) => {
    if (!Array.isArray(media) || !media.length) return "";

    return `
      <div class="customer-review-media" aria-label="Review photos and videos">
        ${media.map((item) => {
          const src = escAttr(resolveMediaUrl(item?.url));
          if (!src) return "";
          if (item?.type === "video") {
            return `<video class="customer-review-media-item" src="${src}" controls preload="metadata" aria-label="Customer review video"></video>`;
          }
          return `<img class="customer-review-media-item" src="${src}" alt="Customer review photo" loading="lazy" />`;
        }).join("")}
      </div>
    `;
  };

  const isAnonymousReview = (review) => {
    const value = review?.is_anonymous;
    return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
  };

  const getReviewAuthorName = (review) =>
    isAnonymousReview(review) ? "Anonymous customer" : (review?.author_name || "Customer");

  const renderReviewRows = () => {
    if (!customerReviewsList) return;
    if (reviewState.loading && !reviewState.reviews.length) {
      customerReviewsList.innerHTML = `<div class="customer-reviews-loading"><span class="customer-reviews-spinner"></span> Loading reviews...</div>`;
      return;
    }

    if (!reviewState.reviews.length) {
      const hasActiveFilter = reviewState.filter !== "all";
      customerReviewsList.innerHTML = `
        <div class="customer-reviews-empty">
          <i class="fa-regular fa-comment-dots" aria-hidden="true"></i>
          <strong>${hasActiveFilter ? "No reviews match this filter" : "No customer reviews yet"}</strong>
          <span>${hasActiveFilter ? "Try another review filter." : "Be the first customer to review this product."}</span>
        </div>
      `;
      return;
    }

    customerReviewsList.innerHTML = reviewState.reviews.map((review) => {
      const authorName = getReviewAuthorName(review);
      return `
        <article class="customer-review-card" data-review-id="${escAttr(review.id)}">
          <div class="customer-review-card-head">
            <div class="customer-review-avatar" aria-hidden="true">${escHtml(authorName.charAt(0).toUpperCase())}</div>
            <div class="customer-review-author">
              <strong>${escHtml(authorName)}</strong>
              <div class="customer-review-meta">
                <span class="customer-review-stars" aria-label="${Number(review.stars) || 0} out of 5 stars">${renderReviewStars(review.stars)}</span>
                <span>${escHtml(formatReviewDate(review.created_at))}</span>
              </div>
            </div>
          </div>
          ${review.feedback ? `<p class="customer-review-feedback">${escHtml(review.feedback)}</p>` : `<p class="customer-review-feedback muted">No written review.</p>`}
          ${renderReviewMedia(review.media)}
          ${review.admin_reply ? `<div class="customer-review-reply"><strong>FMRC reply</strong><span>${escHtml(review.admin_reply)}</span></div>` : ""}
          <div class="customer-review-card-footer">
            <span class="customer-review-item-label">Verified purchase</span>
            <button type="button" class="customer-review-like${review.liked_by_me ? " is-liked" : ""}" data-review-like="${escAttr(review.id)}" aria-label="${review.liked_by_me ? "Unlike" : "Like"} this review">
              <i class="fa-${review.liked_by_me ? "solid" : "regular"} fa-thumbs-up" aria-hidden="true"></i>
              <span>${Number(review.likes_count) || 0}</span>
            </button>
          </div>
        </article>
      `;
    }).join("");
  };

  const updateReviewSummary = (summary = {}) => {
    if (customerReviewsAverage) customerReviewsAverage.textContent = Number(summary.average || 0).toFixed(1);
    if (customerReviewsTotal) customerReviewsTotal.textContent = `${Number(summary.total) || 0} review${Number(summary.total) === 1 ? "" : "s"}`;
    if (productInfoReviewsCount) productInfoReviewsCount.textContent = String(Number(summary.total) || 0);

    // Keep the product grid stars in sync with the freshly loaded review summary
    // so a newly submitted rating shows up without waiting for a full reload.
    const activeId = reviewState.product?.id;
    if (activeId !== undefined && activeId !== null) {
      const cached = allProducts.find((item) => String(item.id) === String(activeId));
      if (cached) {
        cached.rating_average = Number(summary.average) || 0;
        cached.review_count = Number(summary.total) || 0;
        updateCardRatingRow(cached);
      }
    }

    customerReviewsFilters?.querySelectorAll("[data-review-filter]").forEach((button) => {
      const filter = button.dataset.reviewFilter;
      if (filter === "visuals") {
        const count = Number(summary.with_visuals) || 0;
        button.innerHTML = `<i class="fa-regular fa-image" aria-hidden="true"></i> Includes visuals${count ? ` (${count})` : ""}`;
      } else if (filter !== "all") {
        const count = Number(summary.stars?.[filter]) || 0;
        button.innerHTML = `<span aria-hidden="true">★</span> ${filter} Star${count ? ` (${count})` : ""}`;
      }
    });
  };

  const loadCustomerReviews = async ({ append = false } = {}) => {
    const product = reviewState.product;
    if (!product || (append && reviewState.loading)) return;

    reviewState.abortController?.abort();
    const requestId = ++reviewState.requestId;
    const abortController = new AbortController();
    reviewState.abortController = abortController;

    reviewState.loading = true;
    if (!append) {
      reviewState.reviews = [];
      if (customerReviewsLoadMore) {
        customerReviewsLoadMore.hidden = true;
        customerReviewsLoadMore.disabled = true;
      }
      renderReviewRows();
    }
    if (customerReviewsStatus) customerReviewsStatus.textContent = append ? "Loading more reviews..." : "";

    try {
      const params = new URLSearchParams({ page: String(reviewState.page) });
      if (reviewState.filter === "visuals") params.set("visuals", "1");
      if (/^[1-5]$/.test(reviewState.filter)) params.set("stars", reviewState.filter);

      const token = localStorage.getItem("customer_token") || "";
      const headers = { Accept: "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetch(`${API_BASE_URL}/products/${encodeURIComponent(product.id)}/reviews?${params.toString()}`, {
        headers,
        cache: "no-store",
        signal: abortController.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "Unable to load customer reviews.");
      if (requestId !== reviewState.requestId) return;

      reviewState.reviews = append
        ? reviewState.reviews.concat(Array.isArray(payload.data) ? payload.data : [])
        : (Array.isArray(payload.data) ? payload.data : []);
      reviewState.lastPage = Number(payload.meta?.last_page) || 1;
      reviewState.loading = false;
      updateReviewSummary(payload.summary || {});
      renderReviewRows();
      if (customerReviewsLoadMore) customerReviewsLoadMore.hidden = reviewState.page >= reviewState.lastPage;
      if (customerReviewsStatus && !reviewState.reviews.length) customerReviewsStatus.textContent = "";
    } catch (error) {
      if (error?.name === "AbortError" || requestId !== reviewState.requestId) return;
      reviewState.loading = false;
      if (customerReviewsStatus) customerReviewsStatus.textContent = error.message || "Unable to load customer reviews.";
      if (!reviewState.reviews.length) {
        customerReviewsList.innerHTML = `<div class="customer-reviews-empty"><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i><strong>Reviews are unavailable right now.</strong><span>Please try again shortly.</span></div>`;
      }
    } finally {
      if (requestId !== reviewState.requestId) return;
      reviewState.loading = false;
      reviewState.abortController = null;
      if (customerReviewsLoadMore) customerReviewsLoadMore.disabled = false;
    }
  };

  const openCustomerReviews = (product) => {
    if (!customerReviewsModal || !product) return;
    reviewState.product = product;
    reviewState.filter = "all";
    reviewState.page = 1;
    reviewState.lastPage = 1;
    reviewState.reviews = [];
    if (customerReviewsProductName) customerReviewsProductName.textContent = product.name || "";
    if (customerReviewsStatus) customerReviewsStatus.textContent = "";
    if (customerReviewsLoadMore) {
      customerReviewsLoadMore.hidden = true;
      customerReviewsLoadMore.disabled = true;
    }
    updateReviewSummary({
      average: getRatingAverage(product),
      total: getReviewCount(product),
      with_visuals: 0,
      stars: {},
    });
    customerReviewsFilters?.querySelectorAll("[data-review-filter]").forEach((button) => button.classList.toggle("active", button.dataset.reviewFilter === "all"));
    productInfoModal?.classList.remove("show-modal");
    customerReviewsModal.classList.add("show-modal");
    customerReviewsModal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    void loadCustomerReviews();
  };

  const closeCustomerReviews = () => {
    reviewState.abortController?.abort();
    reviewState.abortController = null;
    reviewState.requestId += 1;
    reviewState.loading = false;
    customerReviewsModal?.classList.remove("show-modal");
    customerReviewsModal?.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  };

  customerReviewsFilters?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-review-filter]");
    if (!button || !reviewState.product) return;
    reviewState.filter = button.dataset.reviewFilter || "all";
    reviewState.page = 1;
    customerReviewsFilters.querySelectorAll("[data-review-filter]").forEach((item) => item.classList.toggle("active", item === button));
    void loadCustomerReviews();
  });

  customerReviewsLoadMore?.addEventListener("click", () => {
    if (reviewState.page >= reviewState.lastPage || reviewState.loading) return;
    reviewState.page += 1;
    customerReviewsLoadMore.disabled = true;
    void loadCustomerReviews({ append: true });
  });

  customerReviewsList?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-review-like]");
    if (!button || !reviewState.product || button.disabled) return;
    const token = localStorage.getItem("customer_token") || "";
    if (!token) {
      await notifyCustomer("Please sign in to like customer reviews.", { title: "Sign in required" });
      return;
    }

    button.disabled = true;
    try {
      const response = await fetch(`${API_BASE_URL}/products/${encodeURIComponent(reviewState.product.id)}/reviews/${encodeURIComponent(button.dataset.reviewLike)}/like`, {
        method: "POST",
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "Unable to save your like.");
      const review = reviewState.reviews.find((item) => String(item.id) === String(button.dataset.reviewLike));
      if (review) {
        review.liked_by_me = Boolean(payload.data?.liked);
        review.likes_count = Number(payload.data?.likes_count) || 0;
      }
      renderReviewRows();
    } catch (error) {
      await notifyCustomer(error.message || "Unable to save your like.", { title: "Like not saved" });
    } finally {
      const refreshedButton = customerReviewsList.querySelector(`[data-review-like="${CSS.escape(button.dataset.reviewLike || "")}"]`);
      if (refreshedButton) refreshedButton.disabled = false;
    }
  });

  closeCustomerReviewsModal?.addEventListener("click", closeCustomerReviews);
  customerReviewsModal?.addEventListener("click", (event) => {
    if (event.target === customerReviewsModal) closeCustomerReviews();
  });

  const CART_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>`;
  const BUY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path></svg>`;
  const INFO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;

  const getDiscountPercent = (product) =>
    Math.max(0, Math.min(100, Number(product?.discount_percent || 0)) || 0);

  const getSalePrice = (product) => {
    const rawApiPrice = product?.sale_price;
    const apiPrice = Number(rawApiPrice);
    if (rawApiPrice !== null && rawApiPrice !== undefined && rawApiPrice !== "" && Number.isFinite(apiPrice)) return apiPrice;
    const basePrice = Number(product?.price || 0);
    return Math.max(0, basePrice * (1 - getDiscountPercent(product) / 100));
  };

  const getCustomerPrice = (product) => ({
    ...product,
    original_price: Number(product?.original_price ?? product?.price ?? 0),
    price: getSalePrice(product),
  });

  // ── Build a product card HTML ─────────────────────────────────────────────────
  const buildCard = (p) => {
    const isOutOfStock =
      p.stock_status === "out_of_stock" || Number(p.stock) <= 0;
    const stockBadgeClass = isOutOfStock ? "out-of-stock" : "in-stock";
    const stockBadgeText = isOutOfStock ? "Out of Stock" : "In Stock";
    const stockText = isOutOfStock ? "Out of stock" : `${p.stock} in stock`;
    const productA11yName = escAttr(p.name || "product");

    const imgHtml = p.image_data
      ? `<img src="${escAttr(p.image_data)}" alt="${escHtml(p.name)}" loading="lazy" decoding="async" />`
      : `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#9ca3af;font-size:0.8rem;flex-direction:column;gap:6px;">
           <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
           No image
        </div>`;

    const disabledAttr = isOutOfStock ? "disabled" : "";
    const disabledClass = isOutOfStock ? "disabled" : "";
    const discountPercent = getDiscountPercent(p);
    const salePrice = getSalePrice(p);
    const priceHtml = discountPercent > 0
      ? `<div class="product-price product-price-sale"><span class="sale-price">${formatPrice(salePrice)}</span><span class="original-price">${formatPrice(p.price)}</span></div>`
      : `<div class="product-price">${formatPrice(p.price)}</div>`;

    return `
      <div class="shop-card" data-product-id="${p.id}">
        <div class="product-img-wrapper">${discountPercent > 0 ? `<span class="product-discount-badge">${discountPercent}% OFF</span>` : ""}${imgHtml}</div>
        <div class="product-info">
          <h3 class="product-name">${escHtml(p.name)}</h3>
          <div class="product-code-row">
            <span class="code-label">PRODUCT CODE:</span>
            <span class="code-value">${escHtml(p.code || "—")}</span>
          </div>
          ${priceHtml}
          ${buildRatingRow(p)}
          <div class="product-stock-row">
            <span class="stock-text">${stockText}</span>
            <span class="stock-badge ${stockBadgeClass}">${stockBadgeText}</span>
          </div>
        </div>
        <div class="product-actions">
          <button type="button" class="action-btn btn-view-info" data-action="view-info" data-product-id="${p.id}" aria-label="View details for ${productA11yName}" title="View details for ${productA11yName}">
            ${INFO_SVG}<span class="action-btn-label">View Info</span>
          </button>
          <button type="button" class="action-btn btn-add-cart ${disabledClass}" ${disabledAttr} data-action="add-cart" data-product-id="${p.id}" aria-label="Add ${productA11yName} to cart" title="Add ${productA11yName} to cart">
            ${CART_SVG}<span class="action-btn-label">Add to Cart</span>
          </button>
          <button type="button" class="action-btn btn-buy-now ${disabledClass}" ${disabledAttr} data-action="buy-now" data-product-id="${p.id}" aria-label="Buy ${productA11yName} now" title="Buy ${productA11yName} now">
            ${BUY_SVG}<span class="action-btn-label">Buy Now</span>
          </button>
        </div>
      </div>`;
  };

  // ── Render the grid ─────────────────────────────────────────────────────────
  const renderGrid = () => {
    const q = (searchInput?.value || "").trim().toLowerCase();
    const cat = categorySelect?.value || "all";
    const filter = filterSelect?.value || "all";

    let result = allProducts.slice();

    // Category filter
    if (cat !== "all") {
      const catMap = { "3dprint": "3D Print", laser: "Laser Cut", cnc: "CNC" };
      const catVal = catMap[cat] || cat;
      result = result.filter(
        (p) => p.category === catVal || p.category.toLowerCase().includes(cat),
      );
    }

    // Search
    if (q) {
      result = result.filter((p) =>
        `${p.name} ${p.code} ${p.category}`.toLowerCase().includes(q),
      );
    }

    // Filter (stock / price sort)
    if (filter === "in-stock")
      result = result.filter(
        (p) => p.stock_status === "in_stock" && Number(p.stock) > 0,
      );
    if (filter === "out-of-stock")
      result = result.filter(
        (p) => p.stock_status === "out_of_stock" || Number(p.stock) <= 0,
      );
    if (filter === "price-low")
      result = result.sort((a, b) => Number(a.price) - Number(b.price));
    if (filter === "price-high")
      result = result.sort((a, b) => Number(b.price) - Number(a.price));
    if (filter === "top-rated")
      result = result.sort((a, b) => {
        const diff = getRatingAverage(b) - getRatingAverage(a);
        return diff !== 0 ? diff : getReviewCount(b) - getReviewCount(a);
      });

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

    if (productInfoTitle) productInfoTitle.textContent = product.name;
    if (productInfoImage) {
      productInfoImage.src = product.image_data || "";
      productInfoImage.style.display = product.image_data ? "" : "none";
    }
    if (productInfoSummary)
      productInfoSummary.textContent =
        product.summary || "No description available.";

    // Chips
    if (productInfoChips) {
      const chips = product.details_chips || [];
      productInfoChips.innerHTML = chips.length
        ? chips
            .map((c) => `<span class="feature-chip">${escHtml(c)}</span>`)
            .join("")
        : "<span style='color:#9ca3af;font-size:0.82rem;'>No details specified.</span>";
    }

    // Availability
    if (productInfoAvailability) {
      const avail = product.availability || [];
      productInfoAvailability.innerHTML = avail.length
        ? avail.map((a) => `<li>${escHtml(a)}</li>`).join("")
        : "<li style='color:#9ca3af;'>Not specified.</li>";
    }

    // Recommended for
    if (productInfoRecommended) {
      const rec = product.recommended_for || [];
      productInfoRecommended.innerHTML = rec.length
        ? rec.map((r) => `<li>${escHtml(r)}</li>`).join("")
        : "<li style='color:#9ca3af;'>Not specified.</li>";
    }
    if (productInfoReviewsCount) productInfoReviewsCount.textContent = String(Number(product.review_count) || 0);

    // Wire up the modal action buttons to this product
    if (productInfoAddToCart) {
      const isOutOfStock =
        product.stock_status === "out_of_stock" || Number(product.stock) <= 0;
      productInfoAddToCart.disabled = isOutOfStock;
      productInfoAddToCart.className = `modal-btn outline-btn${isOutOfStock ? " disabled" : ""}`;
      productInfoAddToCart.onclick = isOutOfStock
        ? null
        : (e) => {
            if (e) e.preventDefault();
            productInfoModal.classList.remove("show-modal");
            // Delegate to existing cart logic via custom event
            document.dispatchEvent(
              new CustomEvent("product:add-to-cart", { detail: getCustomerPrice(product) }),
            );
          };
    }
    if (productInfoBuyNow) {
      const isOutOfStock =
        product.stock_status === "out_of_stock" || Number(product.stock) <= 0;
      productInfoBuyNow.disabled = isOutOfStock;
      productInfoBuyNow.className = `modal-btn solid-btn${isOutOfStock ? " disabled" : ""}`;
      productInfoBuyNow.onclick = isOutOfStock
        ? null
        : (e) => {
            if (e) e.preventDefault();
            productInfoModal.classList.remove("show-modal");
            document.dispatchEvent(
              new CustomEvent("product:buy-now", { detail: getCustomerPrice(product) }),
            );
          };
    }

    if (productInfoReviews) {
      productInfoReviews.onclick = (event) => {
        event.preventDefault();
        openCustomerReviews(product);
      };
    }

    productInfoModal.classList.add("show-modal");
  };

  closeProductInfoModal?.addEventListener("click", () => {
    productInfoModal?.classList.remove("show-modal");
  });

  productInfoModal?.addEventListener("click", (e) => {
    if (e.target === productInfoModal)
      productInfoModal.classList.remove("show-modal");
  });

  // Lightbox Modal elements
  const imageLightboxModal = document.getElementById("imageLightboxModal");
  const lightboxImage = document.getElementById("lightboxImage");
  const lightboxCaption = document.getElementById("lightboxCaption");
  const closeLightboxBtn = document.getElementById("closeLightboxBtn");

  const openLightbox = (src, title) => {
    if (!imageLightboxModal || !lightboxImage) return;
    lightboxImage.src = src;
    lightboxImage.alt = title ? `${title} large preview` : "Product large preview";
    if (lightboxCaption) lightboxCaption.textContent = title || "";
    imageLightboxModal.classList.add("show-modal");
  };

  const closeLightbox = () => {
    imageLightboxModal?.classList.remove("show-modal");
  };

  closeLightboxBtn?.addEventListener("click", closeLightbox);

  imageLightboxModal?.addEventListener("click", (e) => {
    if (e.target === imageLightboxModal) {
      closeLightbox();
    }
  });

  // Close only the preview on Escape while it is open.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!imageLightboxModal?.classList.contains("show-modal")) return;
    closeLightbox();
  });

  // ── Clickable image previews inside the modals ───────────────────────────────
  // View Info modal, Order summary modal (single + cart rows) and Shopping cart
  // modal thumbnails all open the same fullscreen preview as the product cards.
  const MODAL_PREVIEW_IMAGE_SELECTOR = [
    "#productInfoModal .modal-img-holder img",
    "#checkoutSingleProductCard img",
    "#checkoutCartItemsList .checkout-cart-item img",
    "#cartItemsContainer .cart-item-card .cart-item-img img",
  ].join(", ");

  const resolveModalPreviewTitle = (img) => {
    if (img.closest("#productInfoModal")) {
      return productInfoTitle?.textContent?.trim() || "Product Image";
    }
    if (img.closest("#checkoutSingleProductCard")) {
      return (
        document.getElementById("checkoutProductTitle")?.textContent?.trim() ||
        "Product Image"
      );
    }
    const row = img.closest(".checkout-cart-item, .cart-item-card");
    return row?.querySelector("h4")?.textContent?.trim() || "Product Image";
  };

  document.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    const img = target.closest(MODAL_PREVIEW_IMAGE_SELECTOR);
    if (!(img instanceof HTMLImageElement) || !img.src) return;

    e.preventDefault();
    openLightbox(img.currentSrc || img.src, resolveModalPreviewTitle(img));
  });

  // ── Grid click delegation ────────────────────────────────────────────────────
  productGrid?.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    // Check if clicked an image inside wrapper
    const imgEl = target.closest(".product-img-wrapper img");
    if (imgEl && imgEl instanceof HTMLImageElement && imgEl.src) {
      const card = target.closest(".shop-card");
      const nameEl = card?.querySelector(".product-name");
      openLightbox(imgEl.src, nameEl?.textContent?.trim() || "Product Image");
      return;
    }

    const btn = target.closest("[data-action]");
    if (!btn) return;

    e.preventDefault(); // Prevent any form submission or page reload

    const id = Number(btn.getAttribute("data-product-id"));
    const product = allProducts.find((p) => p.id === id);
    if (!product) return;

    const action = btn.getAttribute("data-action");
    if (action === "view-info") {
      openViewInfo(product);
    } else if (action === "view-reviews") {
      openCustomerReviews(product);
    } else if (action === "add-cart") {
      document.dispatchEvent(
        new CustomEvent("product:add-to-cart", { detail: getCustomerPrice(product) }),
      );
    } else if (action === "buy-now") {
      document.dispatchEvent(
        new CustomEvent("product:buy-now", { detail: getCustomerPrice(product) }),
      );
    }
  });

  // ── Filters ──────────────────────────────────────────────────────────────────
  searchInput?.addEventListener("input", renderGrid);
  categorySelect?.addEventListener("change", renderGrid);
  filterSelect?.addEventListener("change", renderGrid);

  // ── Show order success modal AFTER grid reload ────────────────────────────────
  // When a customer places an order, main.js saves the order number to
  // sessionStorage under "fmrc_pending_order_success" and immediately triggers
  // a real-time grid reload. This function is called at the END of every
  // loadProducts() run — both on success and on error — so the modal always
  // appears AFTER the page has fully refreshed, never during it.
  const checkAndShowPendingOrderSuccess = () => {
    let raw;
    try {
      raw = sessionStorage.getItem("fmrc_pending_order_success");
    } catch {
      return;
    }
    if (!raw) return;

    let orderNo = "";
    try {
      const parsed = JSON.parse(raw);
      orderNo = String(parsed?.orderNo || "");
      const ts = Number(parsed?.ts || 0);
      // Discard stale entries older than 60 seconds (safety guard)
      if (Date.now() - ts > 60_000) {
        try {
          sessionStorage.removeItem("fmrc_pending_order_success");
        } catch {
          /* ignore */
        }
        return;
      }
    } catch {
      try {
        sessionStorage.removeItem("fmrc_pending_order_success");
      } catch {
        /* ignore */
      }
      return;
    }

    // Clear the entry BEFORE showing the modal to prevent duplicate shows
    try {
      sessionStorage.removeItem("fmrc_pending_order_success");
    } catch {
      /* ignore */
    }

    // Locate the dedicated success modal elements (defined in product.html)
    const modal = document.getElementById("orderSuccessModal");
    const numEl = document.getElementById("orderSuccessNumber");
    const okBtn = document.getElementById("orderSuccessOkBtn");

    if (!modal || !okBtn) {
      // Fallback: dedicated modal not found on this page
      console.info(`[FMRC] Order placed successfully: ${orderNo}`);
      return;
    }

    // Populate and show the modal
    if (numEl) numEl.textContent = orderNo || "—";
    modal.classList.add("active");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";

    // Single-fire OK handler — cleans itself up on click
    const handleOk = () => {
      okBtn.removeEventListener("click", handleOk);
      modal.classList.remove("active");
      modal.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
    };
    okBtn.addEventListener("click", handleOk);
  };

  // ── "Buy Again" handoff from My Orders ───────────────────────────────────────
  // main.js stores { productId, ts } under "fmrc_buy_again_intent" when a
  // customer taps Buy Again on a completed order, then either navigates here or
  // — when this page is already open — calls the consumer directly. Same three
  // guards as the order-success handoff above: a 60-second staleness window,
  // remove-before-act so a reload can never re-fire it, and a full try/catch
  // around every sessionStorage touch.
  const BUY_AGAIN_INTENT_KEY = "fmrc_buy_again_intent";

  const consumeBuyAgainIntent = () => {
    let raw;
    try {
      raw = sessionStorage.getItem(BUY_AGAIN_INTENT_KEY);
    } catch {
      return;
    }
    if (!raw) return;

    const discard = () => {
      try {
        sessionStorage.removeItem(BUY_AGAIN_INTENT_KEY);
      } catch {
        /* ignore */
      }
    };

    let productId = 0;
    try {
      const parsed = JSON.parse(raw);
      productId = Number(parsed?.productId || 0);
      const ts = Number(parsed?.ts || 0);
      // Discard stale entries older than 60 seconds (safety guard)
      if (Date.now() - ts > 60_000) {
        discard();
        return;
      }
    } catch {
      discard();
      return;
    }

    // Clear the entry BEFORE acting to prevent duplicate checkouts
    discard();

    if (!Number.isFinite(productId) || productId <= 0) return;

    const product = allProducts.find((p) => p.id === productId);
    if (!product) {
      void notifyCustomer("This product is no longer available.", {
        title: "Buy Again unavailable",
      });
      return;
    }

    // Same availability test the grid cards use, so a card that reads
    // "Out of Stock" can never open a checkout.
    if (product.stock_status === "out_of_stock" || Number(product.stock) <= 0) {
      void notifyCustomer("This product is currently out of stock.", {
        title: "Out of stock",
      });
      return;
    }

    document.dispatchEvent(
      new CustomEvent("product:buy-now", { detail: getCustomerPrice(product) }),
    );
  };

  // Lets My Orders reorder without a page reload when the customer is already
  // browsing this page.
  window.__fmrcConsumeBuyAgainIntent = consumeBuyAgainIntent;

  // ── Fetch products from API ──────────────────────────────────────────────────
  const loadProducts = async () => {
    // Show loading skeleton
    if (productGrid) {
      productGrid.innerHTML = Array.from({ length: 4 })
        .map(
          () => `
        <div class="shop-card" style="pointer-events:none;">
          <div class="product-img-wrapper" style="background:linear-gradient(90deg,#f3f4f6 25%,#e5e7eb 50%,#f3f4f6 75%);background-size:200% 100%;animation:shimmer 1.4s infinite;"></div>
          <div class="product-info">
            <div style="height:14px;border-radius:6px;background:linear-gradient(90deg,#f3f4f6 25%,#e5e7eb 50%,#f3f4f6 75%);background-size:200% 100%;animation:shimmer 1.4s infinite;margin-bottom:8px;"></div>
            <div style="height:10px;border-radius:6px;background:linear-gradient(90deg,#f3f4f6 25%,#e5e7eb 50%,#f3f4f6 75%);background-size:200% 100%;animation:shimmer 1.4s infinite;width:60%;"></div>
          </div>
        </div>`,
        )
        .join("");
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
      // ── Grid has fully loaded — show the success modal if one is pending ──
      checkAndShowPendingOrderSuccess();
      consumeBuyAgainIntent();
    } catch (err) {
      console.error("Failed to load products:", err);
      allProducts = [];
      if (productGrid) productGrid.innerHTML = "";
      if (emptyState) emptyState.style.display = "flex";
      // Show the success modal even if the product fetch failed
      checkAndShowPendingOrderSuccess();
      consumeBuyAgainIntent();
    }
  };

  void loadProducts();

  // ── Realtime updates ─────────────────────────────────────────────────────────
  // Debounce guard: prevents multiple rapid loadProducts() calls triggered by
  // simultaneous BroadcastChannel + window events for the same action.
  let _reloadDebounceTimer = null;
  const debouncedLoadProducts = () => {
    if (_reloadDebounceTimer) clearTimeout(_reloadDebounceTimer);
    _reloadDebounceTimer = setTimeout(() => {
      _reloadDebounceTimer = null;
      void loadProducts();
    }, 600);
  };

  window.addEventListener("fmrc:promotions-updated", () => {
    if (document.hidden) return;
    debouncedLoadProducts();
  });

  // Helper: only refresh for genuine order-related types
  // A refunded return puts stock back, so return events belong here too.
  const ORDER_RELEVANT_TYPES = new Set([
    "created",
    "updated",
    "rating-submitted",
    "return-requested",
    "return-cancelled",
    "return-shipped",
    "return-updated",
    "return-refunded",
  ]);

  const isOrderRelevantType = (type) => ORDER_RELEVANT_TYPES.has(String(type));

  // Listen for order events from OTHER tabs (BroadcastChannel only).
  const ORDERS_REALTIME_CHANNEL = "fmrc-orders-realtime";
  if (typeof window.BroadcastChannel === "function") {
    const ordersChannel = new window.BroadcastChannel(ORDERS_REALTIME_CHANNEL);
    ordersChannel.addEventListener("message", (event) => {
      if (document.hidden) return;
      const payload = event?.data || {};
      if (isOrderRelevantType(payload.type)) {
        debouncedLoadProducts();
      }
    });
  }

  // Listen to product-specific real-time updates broadcast by the Admin portal.
  const PRODUCTS_REALTIME_CHANNEL = "fmrc-products-realtime";
  if (typeof window.BroadcastChannel === "function") {
    const productsChannel = new window.BroadcastChannel(
      PRODUCTS_REALTIME_CHANNEL,
    );
    productsChannel.addEventListener("message", (event) => {
      if (document.hidden) return;
      const payload = event?.data || {};
      if (
        payload.type === "updated" ||
        payload.type === "created" ||
        payload.type === "deleted"
      ) {
        debouncedLoadProducts();

        // If a product was deleted, remove it from the customer's cart immediately
        if (payload.type === "deleted" && payload.productId) {
          const deletedId = String(payload.productId);
          const cartContainer = document.getElementById("cartItemsContainer");
          if (cartContainer) {
            cartContainer
              .querySelectorAll(
                `.cart-item-card[data-product-id="${deletedId}"]`,
              )
              .forEach((card) => card.remove());
          }
          try {
            const customerInfoRaw = localStorage.getItem("customer_info");
            const customerInfo = customerInfoRaw
              ? JSON.parse(customerInfoRaw)
              : null;
            const cartKey = customerInfo?.id
              ? `fmrc_cart_items_${customerInfo.id}`
              : "fmrc_cart_items";
            const cartRaw = localStorage.getItem(cartKey);
            if (cartRaw) {
              const cartItems = JSON.parse(cartRaw);
              if (Array.isArray(cartItems)) {
                const filtered = cartItems.filter(
                  (item) => String(item.product_id) !== deletedId,
                );
                if (filtered.length !== cartItems.length) {
                  localStorage.setItem(cartKey, JSON.stringify(filtered));
                  localStorage.setItem(
                    "fmrc_cart_updated_at",
                    JSON.stringify({ type: "updated", timestamp: Date.now() }),
                  );
                }
              }
            }
          } catch {
            /* ignore */
          }
        }
      }
    });
  }

  // Listen to the local window event fired by main.js when the customer places
  // an order on this same page. loadProducts() will reload the grid and then
  // automatically call checkAndShowPendingOrderSuccess() — so the success modal
  // always appears AFTER the grid finishes refreshing.
  window.addEventListener("fmrc:orders-updated", (event) => {
    const payload = event?.detail || {};
    if (payload.type === "profile-updated") return;
    if (!isOrderRelevantType(payload.type)) return;
    debouncedLoadProducts();
  });
});
