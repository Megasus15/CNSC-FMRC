/**
 * services.js — Customer Services Page
 * Renders skeleton loading state first, then populates services dynamically.
 * Handles search and category filtering.
 */
document.addEventListener("DOMContentLoaded", () => {
  const servicesGrid = document.getElementById("servicesGrid");
  const searchInput = document.querySelector(".products-toolbar .search-input");
  const categorySelect = document.querySelector(".products-toolbar .category-select");

  const API_BASE_URL = (() => {
    const configured =
      window.APP_API_BASE_URL ||
      document.querySelector('meta[name="api-base-url"]')?.getAttribute("content") ||
      "";
    if (configured.trim()) return configured.replace(/\/+$/, "");

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
    if (isLocalHost) return `${protocol}//${hostname}:8000/api`;
    return `${origin.replace(/\/+$/, "")}/api`;
  })();

  let servicesData = [];
  let servicesState = "loading";
  const defaultCategoryLabels = ["Prototyping", "Manufacturing", "Design & Labelling", "Training & Workshops"];
  let categoryLabels = [...defaultCategoryLabels];
  let servicesSnapshot = "";
  let requestPending = false;

  const escHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const escAttr = (value) =>
    escHtml(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  const normalizeCategory = (value) => {
    const category = String(value || "").toLowerCase().trim().replace(/\s+/g, " ");
    const aliases = {
      prototype: "prototyping",
      prototyping: "prototyping",
      manufacturing: "manufacturing",
      design: "design",
      "design & labelling": "design",
      "design and labelling": "design",
      training: "training",
      "training & workshops": "training",
      "training and workshops": "training",
    };
    return aliases[category] || category.replace(/[^a-z0-9]+/g, "-") || "other";
  };

  const renderCategoryOptions = () => {
    if (!categorySelect) return;
    const selected = categorySelect.value || "all";
    const seen = new Set();
    categorySelect.replaceChildren();
    const all = document.createElement("option");
    all.value = "all";
    all.textContent = "All Categories";
    categorySelect.appendChild(all);
    categoryLabels.forEach((label) => {
      const value = normalizeCategory(label);
      if (seen.has(value)) return;
      seen.add(value);
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      categorySelect.appendChild(option);
    });
    categorySelect.value = [...categorySelect.options].some((option) => option.value === selected) ? selected : "all";
  };

  const loadCategoryLabels = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/site-settings`, { cache: "no-store", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Unable to load category labels");
      const result = await response.json();
      const raw = result?.data?.editorial_services_categories;
      const parsed = Array.isArray(raw) ? raw : JSON.parse(raw || "[]");
      if (Array.isArray(parsed) && parsed.length) {
        // The saved list is authoritative; deleted labels must stay deleted.
        categoryLabels = [...new Set(parsed.map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 30);
      } else {
        categoryLabels = [...defaultCategoryLabels];
      }
    } catch {
      // Keep the last known list during a transient poll failure. Replacing a
      // custom saved list with defaults would make the filter visibly flicker.
    }
    renderCategoryOptions();
    if (servicesState === "ready") filterServices();
  };

  // Preserve each card's layout with the shared skeleton shimmer.
  const renderSkeleton = () => {
    if (!servicesGrid) return;
    // Keep two placeholder rows at the same breakpoints as the service grid.
    const viewportWidth = window.innerWidth || 1100;
    const cardCount = viewportWidth >= 1100 ? 6 : viewportWidth >= 640 ? 4 : 2;
    servicesGrid.setAttribute("aria-busy", "true");
    servicesGrid.innerHTML = Array.from({ length: cardCount })
      .map(
        () => `
      <article class="service-card service-skeleton-card" aria-hidden="true">
        <div class="card-content">
          <div class="service-card-heading">
            <span class="service-skeleton-line service-skeleton-category"></span>
          </div>
          <span class="service-skeleton-line service-skeleton-title"></span>
          <div class="service-skeleton-description">
            <span class="service-skeleton-line"></span>
            <span class="service-skeleton-line"></span>
            <span class="service-skeleton-line"></span>
          </div>
          <div class="service-card-footer">
            <span class="service-skeleton-line service-skeleton-action"></span>
          </div>
        </div>
        <div class="service-skeleton-img"></div>
      </article>
    `,
      )
      .join("");
  };

  // Render Service Cards
  const renderServices = (items) => {
    if (!servicesGrid) return;
    servicesGrid.setAttribute("aria-busy", "false");
    if (!items.length) {
      servicesGrid.innerHTML = `<div class="services-empty-state" role="status" data-editorial-copy="editorial_services_empty_message">No services found matching your search.</div>`;
      window.FMRC_PAGE_CONTENT?.apply();
      return;
    }

    servicesGrid.innerHTML = items.map((item) => {
      const title = String(item.title || "FMRC Service");
      const category = String(item.category || "FMRC Service");
      const categoryKey = normalizeCategory(category);
      const description = String(item.description || "");
      const image = String(item.image_data || "");
      const titleAttr = escAttr(title);
      const imageAttr = escAttr(image);
      const modalDescription = escAttr(
        item.modal_description || item.description || "",
      );
      const featuresAttr = escAttr(JSON.stringify(item.modal_features || []));
      const materialsAttr = escAttr(JSON.stringify(item.modal_materials || []));
      const bestForAttr = escAttr(JSON.stringify(item.modal_best_for || []));
      const imageMarkup = image
        ? `<button class="service-image-trigger" type="button" aria-label="Open full-size preview of ${titleAttr}" title="Open image preview" data-image-src="${imageAttr}" data-image-title="${titleAttr}">
             <img src="${imageAttr}" alt="${titleAttr} preview" loading="lazy" decoding="async" />
             <span class="service-image-preview-label" aria-hidden="true"><i class="fa-solid fa-expand"></i></span>
           </button>`
        : `<div class="service-image-placeholder"><span class="service-image-placeholder__content"><i class="fa-regular fa-image" aria-hidden="true"></i><span data-editorial-copy="editorial_services_image_placeholder">Image coming soon</span></span></div>`;

      return `
        <article class="service-card" data-category="${categoryKey}">
          <div class="card-content">
            <div class="service-card-heading">
              <span class="service-chip">${escHtml(category)}</span>
            </div>
            <h3 class="card-title">${escHtml(title)}</h3>
            <p class="card-desc">${escHtml(description)}</p>
            <div class="service-card-footer">
              <button class="details-btn open-modal-btn" type="button" aria-label="Learn more about ${titleAttr}" title="View details for ${titleAttr}" data-title="${titleAttr}" data-desc="${modalDescription}" data-features="${featuresAttr}" data-materials="${materialsAttr}" data-best-for="${bestForAttr}" data-img="${imageAttr}">
                <span class="details-btn-label" data-editorial-copy="editorial_services_learn_more">Learn more</span><i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
              </button>
            </div>
          </div>
          ${imageMarkup}
        </article>
      `;
    }).join("");
    window.FMRC_PAGE_CONTENT?.apply();
  };

  // Filter & Search
  const filterServices = () => {
    // Preserve the current loading or error state while filters are being edited.
    if (servicesState !== "ready") return;
    const query = (searchInput?.value || "").toLowerCase().trim();
    const cat = categorySelect?.value || "all";

    let filtered = servicesData;
    if (cat !== "all") {
      filtered = filtered.filter((service) => normalizeCategory(service.category) === cat);
    }
    if (query) {
      filtered = filtered.filter((service) =>
        `${service.title || ""} ${service.description || ""} ${service.category || ""}`
          .toLowerCase()
          .includes(query),
      );
    }

    renderServices(filtered);
  };

  const loadServices = async (refresh = false) => {
    if (!servicesGrid || requestPending) return;
    requestPending = true;
    const retainCards = refresh && servicesState === "ready";
    if (!retainCards) {
      servicesState = "loading";
      renderSkeleton();
    }

    try {
      const response = await fetch(`${API_BASE_URL}/services`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`Services request failed: ${response.status}`);

      const payload = await response.json();
      if (!Array.isArray(payload?.data)) throw new Error("Unexpected services response");
      const nextSnapshot = JSON.stringify(payload.data);
      if (retainCards && nextSnapshot === servicesSnapshot) return;
      servicesSnapshot = nextSnapshot;
      servicesData = payload.data;
      renderCategoryOptions();
      servicesState = "ready";
      filterServices();
    } catch (error) {
      console.error("Unable to load realtime services.", error);
      if (retainCards) return;
      servicesData = [];
      servicesState = "error";
      servicesGrid.setAttribute("aria-busy", "false");
      servicesGrid.innerHTML = `<div class="services-load-error" role="status" data-editorial-copy="editorial_services_error_message">Unable to load services right now. Please refresh and try again.</div>`;
      window.FMRC_PAGE_CONTENT?.apply();
    } finally {
      requestPending = false;
    }
  };

  // The grid intentionally has no service fallback data: skeleton first, API data second.
  void loadServices();
  void loadCategoryLabels();
  // Keep open pages in sync with both editors without resetting current filters.
  if ("BroadcastChannel" in window) {
    const channel = new BroadcastChannel("fmrc-site-settings-realtime");
    channel.addEventListener("message", () => { void loadServices(true); void loadCategoryLabels(); });
  }
  window.addEventListener("storage", (event) => {
    if (event.key === "fmrc_site_content_updated_at") { void loadServices(true); void loadCategoryLabels(); }
  });
  setInterval(() => { if (!document.hidden) void loadServices(true); }, 20000);
  setInterval(() => { if (!document.hidden) void loadCategoryLabels(); }, 20000);

  searchInput?.addEventListener("input", filterServices);
  categorySelect?.addEventListener("change", filterServices);

  servicesGrid?.addEventListener("error", (event) => {
    if (event.target.tagName !== "IMG") return;
    const trigger = event.target.closest(".service-image-trigger");
    if (!trigger) return;
    const details = trigger.closest(".service-card")?.querySelector(".open-modal-btn");
    if (details) details.dataset.img = "";
    trigger.outerHTML = '<div class="service-image-placeholder"><span class="service-image-placeholder__content"><i class="fa-regular fa-image" aria-hidden="true"></i><span data-editorial-copy="editorial_services_image_placeholder">Image coming soon</span></span></div>';
    window.FMRC_PAGE_CONTENT?.apply();
  }, true);

});
