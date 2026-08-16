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

  const escHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const escAttr = (value) =>
    escHtml(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  const normalizeCategory = (value) => {
    const category = String(value || "").toLowerCase();
    if (category.includes("prototype")) return "prototyping";
    if (category.includes("manufactur")) return "manufacturing";
    if (category.includes("design") || category.includes("label")) return "design";
    if (category.includes("training") || category.includes("workshop")) return "training";
    return category.replace(/[^a-z0-9]+/g, "-") || "other";
  };

  // Render Skeleton Loading
  const renderSkeleton = () => {
    if (!servicesGrid) return;
    servicesGrid.innerHTML = Array.from({ length: 8 })
      .map(
        () => `
      <article class="service-card service-skeleton-card" aria-hidden="true">
        <div class="service-skeleton-img"></div>
        <div class="card-content">
          <div class="service-card-heading">
            <span class="service-skeleton-line" style="width:42%;height:24px;border-radius:999px;"></span>
            <span class="service-skeleton-line" style="width:24px;height:12px;"></span>
          </div>
          <span class="service-skeleton-line" style="width:70%;height:20px;"></span>
          <span class="service-skeleton-line" style="width:100%;"></span>
          <span class="service-skeleton-line" style="width:86%;"></span>
          <div class="service-card-footer" style="margin-top:auto;">
            <span class="service-skeleton-line" style="width:52%;height:16px;"></span>
          </div>
        </div>
      </article>
    `,
      )
      .join("");
  };

  // Render Service Cards
  const renderServices = (items) => {
    if (!servicesGrid) return;
    if (!items.length) {
      servicesGrid.innerHTML = `<div style="grid-column: 1 / -1; text-align:center; padding: 50px 20px; color: #6d7480; font-weight:700;">No services found matching your search.</div>`;
      return;
    }

    servicesGrid.innerHTML = items.map((item, index) => {
      const title = String(item.title || "FMRC Service");
      const category = String(item.category || "FMRC Service");
      const categoryKey = normalizeCategory(category);
      const description = String(item.description || "");
      const image = String(item.image_data || "");
      const serviceNumber = String(index + 1).padStart(2, "0");
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
             <img src="${imageAttr}" alt="${titleAttr} preview" loading="lazy" />
             <span class="service-image-preview-label"><i class="fa-solid fa-expand" aria-hidden="true"></i> Preview</span>
           </button>`
        : `<div class="service-image-placeholder"><span class="service-image-placeholder__content"><i class="fa-regular fa-image" aria-hidden="true"></i><span>Image coming soon</span></span></div>`;

      return `
        <article class="service-card" data-category="${categoryKey}">
          ${imageMarkup}
          <div class="card-content">
            <div class="service-card-heading">
              <span class="service-chip">${escHtml(category)}</span>
              <span class="service-index" aria-label="Service ${serviceNumber}">${serviceNumber}</span>
            </div>
            <h3 class="card-title">${escHtml(title)}</h3>
            <p class="card-desc">${escHtml(description)}</p>
            <div class="service-card-footer">
              <button class="details-btn open-modal-btn" type="button" aria-label="View details for ${titleAttr}" title="View details for ${titleAttr}" data-title="${titleAttr}" data-desc="${modalDescription}" data-features="${featuresAttr}" data-materials="${materialsAttr}" data-best-for="${bestForAttr}" data-img="${imageAttr}">
                <span>View service details</span><i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
              </button>
            </div>
          </div>
        </article>
      `;
    }).join("");
  };

  // Filter & Search
  const filterServices = () => {
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

  const loadServices = async () => {
    renderSkeleton();

    try {
      const response = await fetch(`${API_BASE_URL}/services`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`Services request failed: ${response.status}`);

      const payload = await response.json();
      servicesData = Array.isArray(payload?.data) ? payload.data : [];
      filterServices();
    } catch (error) {
      console.error("Unable to load realtime services.", error);
      servicesData = [];
      servicesGrid.innerHTML = `<div class="services-load-error" role="status">Unable to load services right now. Please refresh and try again.</div>`;
    }
  };

  // The grid intentionally has no service fallback data: skeleton first, API data second.
  void loadServices();

  searchInput?.addEventListener("input", filterServices);
  categorySelect?.addEventListener("change", filterServices);
});
