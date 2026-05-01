document.addEventListener("DOMContentLoaded", () => {
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

  const token = localStorage.getItem("auth_token");
  if (!token) {
    window.location.href = "../admin-auth/auth.html";
    return;
  }

  // ─── DOM References ──────────────────────────────────────────────────────────
  const tableBody = document.getElementById("productTableBody");
  const tableMeta = document.getElementById("productTableMeta");
  const currentPageEl = document.getElementById("productCurrentPage");
  const prevBtn = document.getElementById("productPrevPage");
  const nextBtn = document.getElementById("productNextPage");
  const searchInput = document.getElementById("productSearchInput");
  const categoryFilter = document.getElementById("productCategoryFilter");

  // Buttons
  const btnOpenAddProduct = document.getElementById("btnOpenAddProduct");
  const btnCancelAddProduct = document.getElementById("btnCancelAddProduct");
  const btnSaveProduct = document.getElementById("btnSaveProduct");
  const btnCancelEditProduct = document.getElementById("btnCancelEditProduct");
  const btnUpdateProduct = document.getElementById("btnUpdateProduct");
  const btnCloseViewProduct = document.getElementById("btnCloseViewProduct");
  const btnOpenEditFromView = document.getElementById("btnOpenEditFromView");
  const btnCancelDeleteProduct = document.getElementById(
    "btnCancelDeleteProduct",
  );
  const btnConfirmProductDelete = document.getElementById(
    "btnConfirmProductDelete",
  );

  // Modals
  const modalAdd = document.getElementById("modalAddProduct");
  const modalEdit = document.getElementById("modalEditProduct");
  const modalView = document.getElementById("modalViewProduct");
  const modalDelete = document.getElementById("modalDeleteProduct");
  const modalPhotoEditor = document.getElementById("modalProductPhotoEditor");

  // Add form fields
  const addName = document.getElementById("addProductName");
  const addCategory = document.getElementById("addProductCategory");
  const addCode = document.getElementById("addProductCode");
  const addStock = document.getElementById("addProductStock");
  const addPrice = document.getElementById("addProductPrice");
  const addStockStatus = document.getElementById("addProductStockStatus");
  const addBlocked = document.getElementById("addProductBlocked");
  const addBlockRow = document.getElementById("addBlockToggleRow");
  const addBlockLabel = document.getElementById("addBlockLabel");
  const addPhoto = document.getElementById("addProductPhoto");
  const addUploadArea = document.getElementById("addUploadArea");
  const addUploadLabel = document.getElementById("addUploadLabel");
  const addSummary = document.getElementById("addProductSummary");
  const addChips = document.getElementById("addProductChips");
  const addAvailability = document.getElementById("addProductAvailability");
  const addRecommended = document.getElementById("addProductRecommended");

  // Edit form fields
  const editName = document.getElementById("editProductName");
  const editCategory = document.getElementById("editProductCategory");
  const editCode = document.getElementById("editProductCode");
  const editStock = document.getElementById("editProductStock");
  const editPrice = document.getElementById("editProductPrice");
  const editStockStatus = document.getElementById("editProductStockStatus");
  const editBlocked = document.getElementById("editProductBlocked");
  const editBlockRow = document.getElementById("editBlockToggleRow");
  const editBlockLabel = document.getElementById("editBlockLabel");
  const editPhoto = document.getElementById("editProductPhoto");
  const editUploadArea = document.getElementById("editUploadArea");
  const editUploadLabel = document.getElementById("editUploadLabel");
  const editSummary = document.getElementById("editProductSummary");
  const editChips = document.getElementById("editProductChips");
  const editAvailability = document.getElementById("editProductAvailability");
  const editRecommended = document.getElementById("editProductRecommended");

  // Photo editor
  const photoEditorPreview = document.getElementById(
    "productPhotoEditorPreview",
  );
  const photoRotate = document.getElementById("productPhotoRotate");
  const photoScale = document.getElementById("productPhotoScale");
  const rotateVal = document.getElementById("rotateVal");
  const scaleVal = document.getElementById("scaleVal");
  const btnApplyPhotoEdit = document.getElementById("btnApplyProductPhotoEdit");
  const btnCancelPhotoEdit = document.getElementById("btnCancelPhotoEdit");

  // Delete modal
  const deleteTargetLabel = document.getElementById("deleteProductTargetLabel");

  // View modal content
  const viewTitle = document.getElementById("viewProductTitle");
  const viewSubtitle = document.getElementById("viewProductSubtitle");
  const viewContent = document.getElementById("viewProductContent");

  // ─── State ──────────────────────────────────────────────────────────────────
  let products = [];
  let currentPage = 1;
  const PAGE_SIZE = 5;
  let activeProductId = null;
  let activePhotoData = ""; // final edited image data URL
  let photoEditSource = "add"; // "add" or "edit"

  // ─── Helpers ────────────────────────────────────────────────────────────────
  const openModal = (m) => m?.classList.add("show");
  const closeModal = (m) => m?.classList.remove("show");

  const escHtml = (v) =>
    String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const formatPrice = (v) =>
    `₱${Number(v || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const fileToDataUrl = (file) =>
    new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result || ""));
      r.onerror = () => rej(new Error("Failed to read file"));
      r.readAsDataURL(file);
    });

  const linesToArray = (text) =>
    (text || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

  const arrayToLines = (arr) => (Array.isArray(arr) ? arr.join("\n") : "");

  const setUnauthorized = () => {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("user_info");
    window.location.href = "../admin-auth/auth.html";
  };

  // ─── Stock Status Toggle ─────────────────────────────────────────────────────
  const setupStockToggle = (form) => {
    const inBtn = document.getElementById(`${form}StockStatusInStock`);
    const outBtn = document.getElementById(`${form}StockStatusOutOfStock`);
    const hidden = document.getElementById(`${form}ProductStockStatus`);

    const set = (val) => {
      hidden.value = val;
      if (val === "in_stock") {
        inBtn.classList.add("active-in-stock");
        inBtn.classList.remove("active-out-of-stock");
        outBtn.classList.remove("active-out-of-stock", "active-in-stock");
      } else {
        outBtn.classList.add("active-out-of-stock");
        outBtn.classList.remove("active-in-stock");
        inBtn.classList.remove("active-in-stock", "active-out-of-stock");
      }
    };

    inBtn?.addEventListener("click", () => set("in_stock"));
    outBtn?.addEventListener("click", () => set("out_of_stock"));

    return set;
  };

  const setAddStockStatus = setupStockToggle("add");
  const setEditStockStatus = setupStockToggle("edit");

  // ─── Block Toggle ───────────────────────────────────────────────────────────
  const syncBlockToggle = (checkbox, row, label) => {
    checkbox?.addEventListener("change", () => {
      const blocked = checkbox.checked;
      row?.classList.toggle("is-blocked", blocked);
      if (label)
        label.textContent = blocked
          ? "Product Blocked (Hidden from Customers)"
          : "Product Active (Visible to Customers)";
    });
  };
  syncBlockToggle(addBlocked, addBlockRow, addBlockLabel);
  syncBlockToggle(editBlocked, editBlockRow, editBlockLabel);

  // ─── Upload Area click-through ───────────────────────────────────────────────
  addUploadArea?.addEventListener("click", () => addPhoto?.click());
  editUploadArea?.addEventListener("click", () => editPhoto?.click());

  // ─── Photo Selection → open editor ───────────────────────────────────────────
  const handlePhotoSelect = async (input, source) => {
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      window.showAdminPopup?.("Please select a valid image file.", {
        title: "Invalid File",
      });
      input.value = "";
      return;
    }
    photoEditSource = source;
    const dataUrl = await fileToDataUrl(file);
    photoEditorPreview.src = dataUrl;
    if (photoRotate) {
      photoRotate.value = "0";
      rotateVal.textContent = "0°";
    }
    if (photoScale) {
      photoScale.value = "100";
      scaleVal.textContent = "100%";
    }
    applyEditorTransform();
    openModal(modalPhotoEditor);
  };

  addPhoto?.addEventListener("change", (e) =>
    handlePhotoSelect(e.target, "add"),
  );
  editPhoto?.addEventListener("change", (e) =>
    handlePhotoSelect(e.target, "edit"),
  );

  // ─── Photo Editor Sliders ────────────────────────────────────────────────────
  const applyEditorTransform = () => {
    const r = Number(photoRotate?.value || 0);
    const s = Number(photoScale?.value || 100) / 100;
    if (photoEditorPreview) {
      photoEditorPreview.style.transform = `rotate(${r}deg) scale(${s})`;
    }
    if (rotateVal) rotateVal.textContent = `${r}°`;
    if (scaleVal) scaleVal.textContent = `${Number(photoScale?.value || 100)}%`;
  };

  photoRotate?.addEventListener("input", applyEditorTransform);
  photoScale?.addEventListener("input", applyEditorTransform);

  // ─── Render to canvas → save image ───────────────────────────────────────────
  const renderToCanvas = () =>
    new Promise((resolve) => {
      const src = photoEditorPreview?.src;
      if (!src) return resolve("");
      const img = new Image();
      img.src = src;
      const doRender = () => {
        const rotateDeg = Number(photoRotate?.value || 0);
        const scale = Number(photoScale?.value || 100) / 100;
        const rotateRad = (rotateDeg * Math.PI) / 180;
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        const cos = Math.abs(Math.cos(rotateRad));
        const sin = Math.abs(Math.sin(rotateRad));
        const rw = Math.ceil((w * cos + h * sin) * scale);
        const rh = Math.ceil((w * sin + h * cos) * scale);
        const canvas = document.createElement("canvas");
        canvas.width = rw;
        canvas.height = rh;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve("");
        ctx.translate(rw / 2, rh / 2);
        ctx.rotate(rotateRad);
        ctx.scale(scale, scale);
        ctx.drawImage(img, -w / 2, -h / 2);
        resolve(canvas.toDataURL("image/png"));
      };
      if (img.complete) {
        doRender();
      } else {
        img.onload = doRender;
      }
    });

  btnApplyPhotoEdit?.addEventListener("click", async () => {
    const dataUrl = await renderToCanvas();
    if (!dataUrl) return;
    activePhotoData = dataUrl;
    closeModal(modalPhotoEditor);
    // Update upload area UI
    const area = photoEditSource === "add" ? addUploadArea : editUploadArea;
    const label = photoEditSource === "add" ? addUploadLabel : editUploadLabel;
    area?.classList.add("has-image");
    if (label) label.textContent = "Image selected & edited ✓";
    // Reset file input
    if (photoEditSource === "add" && addPhoto) addPhoto.value = "";
    if (photoEditSource === "edit" && editPhoto) editPhoto.value = "";
  });

  btnCancelPhotoEdit?.addEventListener("click", () => {
    closeModal(modalPhotoEditor);
    // Reset file inputs so they don't retain unsaved selection
    if (photoEditSource === "add" && addPhoto) addPhoto.value = "";
    if (photoEditSource === "edit" && editPhoto) editPhoto.value = "";
  });

  // ─── Skeleton rows ───────────────────────────────────────────────────────────
  const renderSkeletonRows = () => {
    if (!tableBody) return;
    tableBody.innerHTML = Array.from({ length: PAGE_SIZE })
      .map(
        () => `
      <tr class="skeleton-row">
        ${Array(10).fill('<td><div class="skeleton-cell"></div></td>').join("")}
      </tr>
    `,
      )
      .join("");
    if (tableMeta) tableMeta.textContent = "Loading products...";
    if (currentPageEl) currentPageEl.textContent = "1";
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
  };

  // ─── Render Table ────────────────────────────────────────────────────────────
  const getFilteredProducts = () => {
    const q = (searchInput?.value || "").trim().toLowerCase();
    const cat = categoryFilter?.value || "all";
    return products.filter((p) => {
      const matchCat = cat === "all" || p.category === cat;
      const haystack = `${p.name} ${p.code} ${p.category}`.toLowerCase();
      const matchQ = !q || haystack.includes(q);
      return matchCat && matchQ;
    });
  };

  const renderTable = () => {
    if (!tableBody) return;
    const source = getFilteredProducts();
    const totalPages = Math.max(1, Math.ceil(source.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;

    const start = (currentPage - 1) * PAGE_SIZE;
    const paged = source.slice(start, start + PAGE_SIZE);

    if (!paged.length) {
      tableBody.innerHTML = `
        <tr class="table-empty-row">
          <td colspan="10">
            <div class="table-empty-state">
              <i class="fa-regular fa-folder-open"></i>
              <span>No products found. Click "Add Product" to get started.</span>
            </div>
          </td>
        </tr>`;
    } else {
      tableBody.innerHTML = paged
        .map((p, idx) => {
          const rowNum = String(start + idx + 1).padStart(3, "0");
          const imgCell = p.image_data
            ? `<img src="${p.image_data}" alt="${escHtml(p.name)}" style="height:36px;width:48px;object-fit:cover;border-radius:6px;" />`
            : `<span style="color:#9ca3af;font-size:0.75rem;">No image</span>`;
          const stockStatusHtml =
            p.stock_status === "in_stock"
              ? `<span class="status-pill status-green">In Stock</span>`
              : `<span class="status-pill status-red">Out of Stock</span>`;
          const visibilityHtml = p.is_blocked
            ? `<span class="status-pill status-red">Blocked</span>`
            : `<span class="status-pill status-green">Active</span>`;
          return `
          <tr class="${p.is_blocked ? "row-blocked" : ""}">
            <td>${rowNum}</td>
            <td title="${escHtml(p.name)}">${escHtml(p.name)}</td>
            <td>${escHtml(p.category)}</td>
            <td>${escHtml(p.code || "—")}</td>
            <td>${imgCell}</td>
            <td>${p.stock ?? 0}</td>
            <td>${formatPrice(p.price)}</td>
            <td>${stockStatusHtml}</td>
            <td>${visibilityHtml}</td>
            <td class="action-icons sticky-action">
              <button type="button" data-tooltip="View Product" data-view-id="${p.id}"><i class="fa-regular fa-eye"></i></button>
              <button type="button" data-tooltip="Delete Product" data-delete-id="${p.id}"><i class="fa-regular fa-trash-can"></i></button>
            </td>
          </tr>`;
        })
        .join("");
    }

    if (tableMeta) {
      const from = source.length ? start + 1 : 0;
      const to = source.length ? Math.min(source.length, start + PAGE_SIZE) : 0;
      tableMeta.textContent = `Page ${currentPage} of ${totalPages} • Showing ${from}–${to} of ${source.length} products`;
    }
    if (currentPageEl) currentPageEl.textContent = String(currentPage);
    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
  };

  // ─── Chart instances (reusable so we can destroy before re-render) ───────────
  let chartTopSelling = null;
  let chartSalesByCategory = null;
  let chartYearlyTrend = null;

  const CHART_PALETTE = [
    "#800000", "#d4a017", "#0284c7", "#16a34a", "#7c3aed",
    "#db2777", "#ea580c", "#0d9488", "#6366f1", "#94a3b8",
  ];

  // Yearly trend should mirror Orders page totals in real time.
  const YEARLY_TREND_DATE_BASIS = "created_at";

  // ── Populate year dropdown for Yearly Sales Trend ──
  const yearDropdown = document.getElementById("yearlySalesTrendYear");
  if (yearDropdown) {
    const currentYear = new Date().getFullYear();
    yearDropdown.innerHTML = "";
    for (let y = currentYear; y >= currentYear - 5; y--) {
      const opt = document.createElement("option");
      opt.value = y;
      opt.textContent = `Year ${y}`;
      if (y === currentYear) opt.selected = true;
      yearDropdown.appendChild(opt);
    }
  }

  // ── 1. Top Selling Products (vertical bar, from API) ──
  const loadTopSelling = async (period = "month") => {
    const topCtx = document.getElementById("topSellingChart");
    const emptyEl = document.getElementById("topSellingEmpty");
    if (!topCtx) return;

    try {
      const res = await fetch(`${API_BASE_URL}/admin/product-analytics/top-selling?period=${period}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      if (res.status === 401 || res.status === 403) { setUnauthorized(); return; }
      const payload = await res.json();
      const data = Array.isArray(payload?.data) ? payload.data : [];

      if (chartTopSelling) chartTopSelling.destroy();

      if (!data.length) {
        topCtx.style.display = "none";
        if (emptyEl) emptyEl.style.display = "flex";
        return;
      }

      topCtx.style.display = "";
      if (emptyEl) emptyEl.style.display = "none";

      chartTopSelling = new Chart(topCtx, {
        type: "bar",
        data: {
          labels: data.map((p) => p.name?.length > 18 ? p.name.slice(0, 18) + "..." : p.name),
          datasets: [{
            label: "Qty Sold",
            data: data.map((p) => p.total_sold),
            backgroundColor: data.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length]),
            borderRadius: 6,
            barThickness: 22,
          }],
        },
        options: {
          indexAxis: "x",
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: "#1a1a2e",
              titleFont: { family: "Poppins", size: 12 },
              bodyFont: { family: "Poppins", size: 11 },
              padding: 10,
              cornerRadius: 8,
            },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { font: { family: "Poppins", size: 10 }, color: "#374151", maxRotation: 45, minRotation: 0 },
            },
            y: {
              grid: { color: "#f3f4f6" },
              ticks: { font: { family: "Poppins", size: 11 }, color: "#6b7280", beginAtZero: true },
            },
          },
        },
      });
    } catch (err) {
      console.error("Top selling load error:", err);
      topCtx.style.display = "none";
      if (emptyEl) emptyEl.style.display = "flex";
    }
  };

  // Period dropdown listener
  const topSellingPeriod = document.getElementById("topSellingPeriod");
  topSellingPeriod?.addEventListener("change", () => {
    void loadTopSelling(topSellingPeriod.value);
  });

  // ── 2. Sales by Category (doughnut, from API) ──
  const loadSalesByCategory = async () => {
    const catCtx = document.getElementById("salesByCategoryChart");
    const emptyEl = document.getElementById("salesByCategoryEmpty");
    const layoutEl = document.getElementById("salesByCategoryLayout");
    const listEl = document.getElementById("salesByCategoryList");
    const centerMetricEl = document.getElementById("salesCategoryCenterMetric");
    const centerPercentEl = document.getElementById("salesCategoryCenterPercent");
    const centerLabelEl = document.getElementById("salesCategoryCenterLabel");
    if (!catCtx) return;

    try {
      const res = await fetch(`${API_BASE_URL}/admin/product-analytics/sales-by-category`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      if (res.status === 401 || res.status === 403) { setUnauthorized(); return; }
      const payload = await res.json();
      const data = Array.isArray(payload?.data) ? payload.data : [];

      if (chartSalesByCategory) chartSalesByCategory.destroy();

      if (!data.length) {
        catCtx.style.display = "none";
        if (layoutEl) layoutEl.style.display = "none";
        if (listEl) listEl.innerHTML = "";
        if (centerMetricEl) centerMetricEl.style.display = "none";
        if (emptyEl) emptyEl.style.display = "flex";
        return;
      }

      catCtx.style.display = "";
      if (layoutEl) layoutEl.style.display = "flex";
      if (centerMetricEl) centerMetricEl.style.display = "flex";
      if (emptyEl) emptyEl.style.display = "none";

      const sorted = [...data].sort((a, b) => Number(b.total_revenue || 0) - Number(a.total_revenue || 0));
      const totalRevenue = sorted.reduce((sum, item) => sum + Number(item.total_revenue || 0), 0);

      const mapped = sorted.map((item, index) => {
        const revenue = Number(item.total_revenue || 0);
        const percentage = totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0;

        return {
          category: item.category || "Uncategorized",
          total_revenue: revenue,
          total_sold: Number(item.total_sold || 0),
          percentage,
          color: CHART_PALETTE[index % CHART_PALETTE.length],
        };
      });

      const topCategory = mapped[0] || null;
      if (centerPercentEl) {
        centerPercentEl.textContent = `${(topCategory?.percentage || 0).toFixed(1)}%`;
      }
      if (centerLabelEl) {
        centerLabelEl.textContent = topCategory?.category
          ? `Top: ${topCategory.category}`
          : "Top share";
      }

      if (listEl) {
        listEl.innerHTML = mapped.map((item) => `
          <li class="sales-category-item">
            <div class="sales-category-item-left">
              <span class="sales-category-dot" style="background:${item.color}"></span>
              <span class="sales-category-name">${escHtml(item.category)}</span>
            </div>
            <div class="sales-category-metrics">
              <strong>${formatPrice(item.total_revenue)}</strong>
              <span>${item.percentage.toFixed(1)}% • ${item.total_sold} sold</span>
            </div>
          </li>
        `).join("");
      }

      chartSalesByCategory = new Chart(catCtx, {
        type: "doughnut",
        data: {
          labels: mapped.map((d) => d.category),
          datasets: [{
            data: mapped.map((d) => d.total_revenue),
            backgroundColor: mapped.map((d) => d.color),
            borderWidth: 2,
            borderColor: "#fff",
            hoverOffset: 8,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: "62%",
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: "#1a1a2e",
              titleFont: { family: "Poppins", size: 12 },
              bodyFont: { family: "Poppins", size: 11 },
              padding: 10,
              cornerRadius: 8,
              callbacks: {
                label: (ctx) => {
                  const val = ctx.parsed || 0;
                  const share = totalRevenue > 0 ? (val / totalRevenue) * 100 : 0;
                  return `${ctx.label}: ₱${val.toLocaleString("en-PH", { minimumFractionDigits: 2 })} (${share.toFixed(1)}%)`;
                },
              },
            },
          },
        },
      });
    } catch (err) {
      console.error("Sales by category load error:", err);
      catCtx.style.display = "none";
      if (layoutEl) layoutEl.style.display = "none";
      if (listEl) listEl.innerHTML = "";
      if (centerMetricEl) centerMetricEl.style.display = "none";
      if (emptyEl) emptyEl.style.display = "flex";
    }
  };

  // ── 3. Product Performance Table (from API) ──
  const loadProductPerformance = async () => {
    const perfBody = document.getElementById("productPerformanceBody");
    const emptyEl = document.getElementById("productPerformanceEmpty");
    const tableEl = document.getElementById("productPerformanceTable");
    if (!perfBody) return;

    try {
      const res = await fetch(`${API_BASE_URL}/admin/product-analytics/product-performance`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      if (res.status === 401 || res.status === 403) { setUnauthorized(); return; }
      const payload = await res.json();
      const data = Array.isArray(payload?.data) ? payload.data : [];

      if (!data.length) {
        perfBody.innerHTML = "";
        if (tableEl) tableEl.style.display = "none";
        if (emptyEl) emptyEl.style.display = "flex";
        return;
      }

      if (tableEl) tableEl.style.display = "";
      if (emptyEl) emptyEl.style.display = "none";

      perfBody.innerHTML = data.map((p) => {
        let statusClass = "perf-status--low";
        let statusLabel = p.status || "Low";
        if (p.status_class === "top") statusClass = "perf-status--top";
        else if (p.status_class === "high") statusClass = "perf-status--high";

        const revenue = parseFloat(p.total_revenue || 0).toLocaleString("en-PH", {
          style: "currency",
          currency: "PHP",
        });

        return `<tr>
          <td>${p.product_code || "N/A"}</td>
          <td>${p.product_name || "Unnamed"}</td>
          <td>${p.category || "N/A"}</td>
          <td>${p.total_sold ?? 0}</td>
          <td>${revenue}</td>
          <td><span class="perf-status ${statusClass}">${statusLabel}</span></td>
        </tr>`;
      }).join("");
    } catch (err) {
      console.error("Product performance load error:", err);
      perfBody.innerHTML = "";
      if (tableEl) tableEl.style.display = "none";
      if (emptyEl) emptyEl.style.display = "flex";
    }
  };

  // ── 4. Yearly Sales Trend (line chart, from API) ──
  const loadYearlySalesTrend = async (year) => {
    const trendCtx = document.getElementById("yearlySalesTrendChart");
    const emptyEl = document.getElementById("yearlySalesTrendEmpty");
    if (!trendCtx) return;

    const selectedYear = year || new Date().getFullYear();

    try {
      const res = await fetch(`${API_BASE_URL}/admin/product-analytics/yearly-sales-trend?year=${selectedYear}&date_basis=${YEARLY_TREND_DATE_BASIS}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        cache: "no-store",
      });
      if (res.status === 401 || res.status === 403) { setUnauthorized(); return; }
      const payload = await res.json();
      const monthsData = Array.isArray(payload?.data) ? payload.data : [];
      const hasData = payload?.has_data ?? false;

      if (chartYearlyTrend) chartYearlyTrend.destroy();

      if (!hasData) {
        trendCtx.style.display = "none";
        if (emptyEl) emptyEl.style.display = "flex";
        return;
      }

      trendCtx.style.display = "";
      if (emptyEl) emptyEl.style.display = "none";

      const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

      chartYearlyTrend = new Chart(trendCtx, {
        type: "line",
        data: {
          labels: months,
          datasets: [{
            label: "Total Sales (PHP)",
            data: monthsData.map((m) => m.total_sales),
            borderColor: "#800000",
            backgroundColor: "rgba(128,0,0,0.08)",
            fill: true,
            tension: 0.4,
            pointBackgroundColor: "#800000",
            pointBorderColor: "#fff",
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: "#1a1a2e",
              titleFont: { family: "Poppins", size: 12 },
              bodyFont: { family: "Poppins", size: 11 },
              padding: 10,
              cornerRadius: 8,
              callbacks: {
                label: (ctx) => {
                  const val = ctx.parsed.y || 0;
                  return "₱" + val.toLocaleString("en-PH", { minimumFractionDigits: 2 });
                },
              },
            },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { font: { family: "Poppins", size: 10 }, color: "#9ca3af" },
            },
            y: {
              grid: { color: "#f3f4f6" },
              ticks: {
                font: { family: "Poppins", size: 10 },
                color: "#6b7280",
                callback: (value) => "₱" + (value / 1000).toFixed(0) + "k",
              },
            },
          },
        },
      });
    } catch (err) {
      console.error("Yearly sales trend load error:", err);
      trendCtx.style.display = "none";
      if (emptyEl) emptyEl.style.display = "flex";
    }
  };

  // Year dropdown listener
  yearDropdown?.addEventListener("change", () => {
    void loadYearlySalesTrend(Number(yearDropdown.value));
  });

  // ── Shimmer loading skeleton for analytics cards ──
  const renderAnalyticsSkeletons = () => {
    const shimmerHTML = `
      <div style="display:flex;flex-direction:column;gap:10px;padding:8px 0;">
        <div style="height:16px;border-radius:6px;background:linear-gradient(90deg,#f3f4f6 25%,#e5e7eb 50%,#f3f4f6 75%);background-size:200% 100%;animation:shimmer 1.4s infinite;width:85%;"></div>
        <div style="height:16px;border-radius:6px;background:linear-gradient(90deg,#f3f4f6 25%,#e5e7eb 50%,#f3f4f6 75%);background-size:200% 100%;animation:shimmer 1.4s infinite;width:70%;animation-delay:0.15s;"></div>
        <div style="height:16px;border-radius:6px;background:linear-gradient(90deg,#f3f4f6 25%,#e5e7eb 50%,#f3f4f6 75%);background-size:200% 100%;animation:shimmer 1.4s infinite;width:55%;animation-delay:0.3s;"></div>
        <div style="height:16px;border-radius:6px;background:linear-gradient(90deg,#f3f4f6 25%,#e5e7eb 50%,#f3f4f6 75%);background-size:200% 100%;animation:shimmer 1.4s infinite;width:40%;animation-delay:0.45s;"></div>
      </div>
    `;

    // Top Selling - hide chart, show shimmer
    const topCtx = document.getElementById("topSellingChart");
    const topEmpty = document.getElementById("topSellingEmpty");
    const topBody = document.getElementById("topSellingBody");
    if (topCtx) topCtx.style.display = "none";
    if (topEmpty) topEmpty.style.display = "none";
    if (topBody) {
      let shimmerEl = topBody.querySelector(".analytics-shimmer-loader");
      if (!shimmerEl) {
        shimmerEl = document.createElement("div");
        shimmerEl.className = "analytics-shimmer-loader";
        topBody.appendChild(shimmerEl);
      }
      shimmerEl.innerHTML = shimmerHTML;
      shimmerEl.style.display = "";
    }

    // Sales by Category - hide chart & layout, show shimmer
    const catCtx = document.getElementById("salesByCategoryChart");
    const catLayout = document.getElementById("salesByCategoryLayout");
    const catEmpty = document.getElementById("salesByCategoryEmpty");
    const catBody = document.getElementById("salesByCategoryBody");
    if (catCtx) catCtx.style.display = "none";
    if (catLayout) catLayout.style.display = "none";
    if (catEmpty) catEmpty.style.display = "none";
    if (catBody) {
      let shimmerEl = catBody.querySelector(".analytics-shimmer-loader");
      if (!shimmerEl) {
        shimmerEl = document.createElement("div");
        shimmerEl.className = "analytics-shimmer-loader";
        catBody.appendChild(shimmerEl);
      }
      shimmerEl.innerHTML = shimmerHTML;
      shimmerEl.style.display = "";
    }

    // Product Performance - hide table, show shimmer
    const perfTable = document.getElementById("productPerformanceTable");
    const perfEmpty = document.getElementById("productPerformanceEmpty");
    const perfWrapper = document.getElementById("productPerformanceTableWrapper");
    if (perfTable) perfTable.style.display = "none";
    if (perfEmpty) perfEmpty.style.display = "none";
    if (perfWrapper) {
      let shimmerEl = perfWrapper.querySelector(".analytics-shimmer-loader");
      if (!shimmerEl) {
        shimmerEl = document.createElement("div");
        shimmerEl.className = "analytics-shimmer-loader";
        perfWrapper.appendChild(shimmerEl);
      }
      const tableShimmer = `
        <div style="padding:12px 14px;">
          <div style="display:flex;gap:12px;margin-bottom:12px;">
            <div style="height:28px;border-radius:6px;background:linear-gradient(90deg,#f3f4f6 25%,#e5e7eb 50%,#f3f4f6 75%);background-size:200% 100%;animation:shimmer 1.4s infinite;flex:1;"></div>
          </div>
          ${Array.from({length: 4}).map((_, i) => `
            <div style="display:flex;gap:12px;margin-bottom:10px;">
              <div style="height:14px;border-radius:4px;background:linear-gradient(90deg,#f3f4f6 25%,#e5e7eb 50%,#f3f4f6 75%);background-size:200% 100%;animation:shimmer 1.4s infinite;width:60px;animation-delay:${i * 0.1}s;"></div>
              <div style="height:14px;border-radius:4px;background:linear-gradient(90deg,#f3f4f6 25%,#e5e7eb 50%,#f3f4f6 75%);background-size:200% 100%;animation:shimmer 1.4s infinite;flex:1;animation-delay:${i * 0.12}s;"></div>
              <div style="height:14px;border-radius:4px;background:linear-gradient(90deg,#f3f4f6 25%,#e5e7eb 50%,#f3f4f6 75%);background-size:200% 100%;animation:shimmer 1.4s infinite;width:70px;animation-delay:${i * 0.15}s;"></div>
              <div style="height:14px;border-radius:4px;background:linear-gradient(90deg,#f3f4f6 25%,#e5e7eb 50%,#f3f4f6 75%);background-size:200% 100%;animation:shimmer 1.4s infinite;width:50px;animation-delay:${i * 0.18}s;"></div>
            </div>
          `).join("")}
        </div>
      `;
      shimmerEl.innerHTML = tableShimmer;
      shimmerEl.style.display = "";
    }

    // Yearly Sales Trend - hide chart, show shimmer
    const trendCtx = document.getElementById("yearlySalesTrendChart");
    const trendEmpty = document.getElementById("yearlySalesTrendEmpty");
    const trendBody = document.getElementById("yearlySalesTrendBody");
    if (trendCtx) trendCtx.style.display = "none";
    if (trendEmpty) trendEmpty.style.display = "none";
    if (trendBody) {
      let shimmerEl = trendBody.querySelector(".analytics-shimmer-loader");
      if (!shimmerEl) {
        shimmerEl = document.createElement("div");
        shimmerEl.className = "analytics-shimmer-loader";
        trendBody.appendChild(shimmerEl);
      }
      shimmerEl.innerHTML = shimmerHTML;
      shimmerEl.style.display = "";
    }
  };

  // ── Remove shimmer loaders after data loads ──
  const clearAnalyticsShimmers = () => {
    document.querySelectorAll(".analytics-shimmer-loader").forEach((el) => {
      el.style.display = "none";
    });
  };

  // ── Combined function to load all analytics cards ──
  const updateSummaryCards = () => {
    renderAnalyticsSkeletons();

    const onDone = () => clearAnalyticsShimmers();

    Promise.all([
      loadTopSelling(topSellingPeriod?.value || "month"),
      loadSalesByCategory(),
      loadProductPerformance(),
      loadYearlySalesTrend(yearDropdown ? Number(yearDropdown.value) : new Date().getFullYear()),
    ]).then(onDone).catch(onDone);
  };

  // ─── Load Products from API ───────────────────────────────────────────────────
  const loadProducts = async () => {
    renderSkeletonRows();
    try {
      const res = await fetch(`${API_BASE_URL}/admin/products`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });
      if (res.status === 401 || res.status === 403) {
        setUnauthorized();
        return;
      }
      if (!res.ok) throw new Error("Failed to fetch products");
      const payload = await res.json();
      products = Array.isArray(payload?.data) ? payload.data : [];
      currentPage = 1;
      renderTable();
      updateSummaryCards();
    } catch (err) {
      console.error("Load products error:", err);
      if (tableBody) {
        tableBody.innerHTML = `<tr><td colspan="10" style="text-align:center;color:#991b1b;">Could not load products. Ensure Laravel server is running.</td></tr>`;
      }
      if (tableMeta) tableMeta.textContent = "Failed to load.";
    }
  };

  // ─── Add Product ─────────────────────────────────────────────────────────────
  const resetAddForm = () => {
    addName.value = "";
    addCode.value = "";
    addStock.value = "";
    addPrice.value = "";
    addSummary.value = "";
    addChips.value = "";
    addAvailability.value = "";
    addRecommended.value = "";
    addCategory.value = "3D Print";
    addBlocked.checked = false;
    syncBlockToggle_manual(addBlocked, addBlockRow, addBlockLabel);
    setAddStockStatus("in_stock");
    activePhotoData = "";
    addUploadArea?.classList.remove("has-image");
    if (addUploadLabel) addUploadLabel.textContent = "Click to choose an image";
    if (addPhoto) addPhoto.value = "";
  };

  const syncBlockToggle_manual = (checkbox, row, label) => {
    const blocked = checkbox.checked;
    row?.classList.toggle("is-blocked", blocked);
    if (label)
      label.textContent = blocked
        ? "Product Blocked (Hidden from Customers)"
        : "Product Active (Visible to Customers)";
  };

  btnOpenAddProduct?.addEventListener("click", () => {
    resetAddForm();
    openModal(modalAdd);
  });

  btnCancelAddProduct?.addEventListener("click", () => closeModal(modalAdd));

  btnSaveProduct?.addEventListener("click", async (e) => {
    if (e) e.preventDefault();
    const name = (addName?.value || "").trim();
    const stock = addStock?.value;
    const price = addPrice?.value;
    const stockStatus = addStockStatus?.value || "in_stock";

    if (!name) {
      window.showAdminPopup?.("Product Name is required.", {
        title: "Validation Error",
      });
      addName?.focus();
      return;
    }
    if (stock === "" || stock === null) {
      window.showAdminPopup?.("In Stock quantity is required.", {
        title: "Validation Error",
      });
      addStock?.focus();
      return;
    }
    if (price === "" || price === null) {
      window.showAdminPopup?.("Price is required.", {
        title: "Validation Error",
      });
      addPrice?.focus();
      return;
    }

    const body = {
      name,
      category: addCategory?.value || "3D Print",
      code: (addCode?.value || "").trim() || null,
      stock: Number(stock),
      price: Number(price),
      stock_status: stockStatus,
      is_blocked: addBlocked?.checked ?? false,
      image_data: activePhotoData || null,
      summary: (addSummary?.value || "").trim() || null,
      details_chips: linesToArray(addChips?.value),
      availability: linesToArray(addAvailability?.value),
      recommended_for: linesToArray(addRecommended?.value),
    };

    btnSaveProduct.disabled = true;
    btnSaveProduct.textContent = "Saving…";

    try {
      const res = await fetch(`${API_BASE_URL}/admin/products`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });
      if (res.status === 401 || res.status === 403) {
        setUnauthorized();
        return;
      }
      const payload = await res.json();
      if (!res.ok) {
        const msg =
          payload?.message ||
          Object.values(payload?.errors || {})[0]?.[0] ||
          "Failed to save product.";
        window.showAdminPopup?.(msg, { title: "Save Failed" });
        return;
      }
      closeModal(modalAdd);
      resetAddForm();
      broadcastProductChange("created");
      await loadProducts();
      setTimeout(() => {
        window.showAdminPopup?.("Product added successfully.", { title: "Success ✓" });
      }, 200);
    } catch (err) {
      console.error("Save product error:", err);
      window.showAdminPopup?.("Cannot connect to server.", { title: "Error" });
    } finally {
      btnSaveProduct.disabled = false;
      btnSaveProduct.innerHTML =
        '<i class="fa-solid fa-floppy-disk"></i> Save Product';
    }
  });

  // ─── View Product ────────────────────────────────────────────────────────────
  const openViewModal = (product) => {
    activeProductId = product.id;
    if (viewTitle) viewTitle.textContent = escHtml(product.name);
    if (viewSubtitle)
      viewSubtitle.textContent = `${product.category} — ${product.code || "No Code"}`;

    const chipsHtml = (product.details_chips || []).length
      ? `<div class="chips-preview">${(product.details_chips || []).map((c) => `<span class="chip-tag">${escHtml(c)}</span>`).join("")}</div>`
      : `<span style="color:#9ca3af;font-size:0.82rem;">No chips defined</span>`;

    const availHtml = (product.availability || []).length
      ? `<ul style="margin:0;padding-left:16px;font-size:0.82rem;color:#374151;">${(product.availability || []).map((a) => `<li>${escHtml(a)}</li>`).join("")}</ul>`
      : `<span style="color:#9ca3af;font-size:0.82rem;">Not set</span>`;

    const recHtml = (product.recommended_for || []).length
      ? `<ul style="margin:0;padding-left:16px;font-size:0.82rem;color:#374151;">${(product.recommended_for || []).map((r) => `<li>${escHtml(r)}</li>`).join("")}</ul>`
      : `<span style="color:#9ca3af;font-size:0.82rem;">Not set</span>`;

    const imgHtml = product.image_data
      ? `<div class="view-product-image"><img src="${product.image_data}" alt="${escHtml(product.name)}" /></div>`
      : `<div class="view-product-image"><div class="no-image-placeholder"><i class="fa-regular fa-image" style="font-size:2rem;margin-bottom:6px;display:block;"></i>No image uploaded</div></div>`;

    const stockBadge =
      product.stock_status === "in_stock"
        ? `<span class="status-pill status-green">In Stock</span>`
        : `<span class="status-pill status-red">Out of Stock</span>`;

    const blockedBadge = product.is_blocked
      ? `<span class="status-pill status-red">Blocked</span>`
      : `<span class="status-pill status-green">Active</span>`;

    if (viewContent) {
      viewContent.innerHTML = `
        ${imgHtml}
        <div class="view-product-grid" style="margin-top:14px;">
          <div><div class="vp-label">Category</div><div class="vp-value">${escHtml(product.category)}</div></div>
          <div><div class="vp-label">Product Code</div><div class="vp-value">${escHtml(product.code || "—")}</div></div>
          <div><div class="vp-label">Stock Quantity</div><div class="vp-value">${product.stock}</div></div>
          <div><div class="vp-label">Price</div><div class="vp-value">${formatPrice(product.price)}</div></div>
          <div><div class="vp-label">Stock Status</div><div class="vp-value">${stockBadge}</div></div>
          <div><div class="vp-label">Visibility</div><div class="vp-value">${blockedBadge}</div></div>
          <div style="grid-column:1/-1;"><div class="vp-label">Summary</div><div class="vp-value">${escHtml(product.summary || "—")}</div></div>
          <div style="grid-column:1/-1;"><div class="vp-label">Product Detail Chips</div><div class="vp-value">${chipsHtml}</div></div>
          <div><div class="vp-label">Availability</div><div class="vp-value">${availHtml}</div></div>
          <div><div class="vp-label">Recommended For</div><div class="vp-value">${recHtml}</div></div>
        </div>`;
    }
    openModal(modalView);
  };

  btnCloseViewProduct?.addEventListener("click", () => closeModal(modalView));

  // ─── Edit Product (opened from View modal) ────────────────────────────────────
  btnOpenEditFromView?.addEventListener("click", () => {
    const product = products.find((p) => p.id === activeProductId);
    if (!product) return;
    closeModal(modalView);
    openEditModal(product);
  });

  const openEditModal = (product) => {
    activeProductId = product.id;
    editName.value = product.name || "";
    editCode.value = product.code || "";
    editStock.value = product.stock ?? "";
    editPrice.value = product.price ?? "";
    editSummary.value = product.summary || "";
    editChips.value = arrayToLines(product.details_chips);
    editAvailability.value = arrayToLines(product.availability);
    editRecommended.value = arrayToLines(product.recommended_for);
    if (editCategory) editCategory.value = product.category || "3D Print";

    setEditStockStatus(product.stock_status || "in_stock");

    editBlocked.checked = !!product.is_blocked;
    syncBlockToggle_manual(editBlocked, editBlockRow, editBlockLabel);

    // Image
    activePhotoData = product.image_data || "";
    editUploadArea?.classList.toggle("has-image", !!product.image_data);
    if (editUploadLabel) {
      editUploadLabel.textContent = product.image_data
        ? "Image loaded — click to replace"
        : "Click to replace image";
    }
    if (editPhoto) editPhoto.value = "";

    openModal(modalEdit);
  };

  btnCancelEditProduct?.addEventListener("click", () => closeModal(modalEdit));

  btnUpdateProduct?.addEventListener("click", async (e) => {
    if (e) e.preventDefault();
    if (!activeProductId) return;

    const name = (editName?.value || "").trim();
    const stock = editStock?.value;
    const price = editPrice?.value;
    const stockStatus = editStockStatus?.value || "in_stock";

    if (!name) {
      window.showAdminPopup?.("Product Name is required.", {
        title: "Validation Error",
      });
      editName?.focus();
      return;
    }
    if (stock === "" || stock === null) {
      window.showAdminPopup?.("In Stock quantity is required.", {
        title: "Validation Error",
      });
      editStock?.focus();
      return;
    }
    if (price === "" || price === null) {
      window.showAdminPopup?.("Price is required.", {
        title: "Validation Error",
      });
      editPrice?.focus();
      return;
    }

    const body = {
      name,
      category: editCategory?.value || "3D Print",
      code: (editCode?.value || "").trim() || null,
      stock: Number(stock),
      price: Number(price),
      stock_status: stockStatus,
      is_blocked: editBlocked?.checked ?? false,
      image_data: activePhotoData || null,
      summary: (editSummary?.value || "").trim() || null,
      details_chips: linesToArray(editChips?.value),
      availability: linesToArray(editAvailability?.value),
      recommended_for: linesToArray(editRecommended?.value),
    };

    btnUpdateProduct.disabled = true;
    btnUpdateProduct.textContent = "Updating…";

    try {
      const res = await fetch(
        `${API_BASE_URL}/admin/products/${activeProductId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
          body: JSON.stringify(body),
        },
      );
      if (res.status === 401 || res.status === 403) {
        setUnauthorized();
        return;
      }
      const payload = await res.json();
      if (!res.ok) {
        const msg =
          payload?.message ||
          Object.values(payload?.errors || {})[0]?.[0] ||
          "Failed to update product.";
        window.showAdminPopup?.(msg, { title: "Update Failed" });
        return;
      }
      closeModal(modalEdit);
      broadcastProductChange("updated");
      await loadProducts();
      setTimeout(() => {
        window.showAdminPopup?.("Product updated successfully.", { title: "Success ✓" });
      }, 200);
    } catch (err) {
      console.error("Update product error:", err);
      window.showAdminPopup?.("Cannot connect to server.", { title: "Error" });
    } finally {
      btnUpdateProduct.disabled = false;
      btnUpdateProduct.innerHTML =
        '<i class="fa-solid fa-floppy-disk"></i> Update Product';
    }
  });

  // ─── Delete Product ───────────────────────────────────────────────────────────
  btnCancelDeleteProduct?.addEventListener("click", () =>
    closeModal(modalDelete),
  );

  btnConfirmProductDelete?.addEventListener("click", async (e) => {
    if (e) e.preventDefault();
    if (!activeProductId) return;
    btnConfirmProductDelete.disabled = true;
    btnConfirmProductDelete.textContent = "Deleting…";

    try {
      const res = await fetch(
        `${API_BASE_URL}/admin/products/${activeProductId}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        },
      );
      if (res.status === 401 || res.status === 403) {
        setUnauthorized();
        return;
      }
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        window.showAdminPopup?.(
          payload?.message || "Failed to delete product.",
          { title: "Delete Failed" },
        );
        return;
      }
      closeModal(modalDelete);
      const deletedId = activeProductId;
      activeProductId = null;
      broadcastProductChange("deleted", deletedId);
      await loadProducts();
      setTimeout(() => {
        window.showAdminPopup?.("Product deleted successfully.", { title: "Success ✓" });
      }, 200);
    } catch (err) {
      console.error("Delete product error:", err);
      window.showAdminPopup?.("Cannot connect to server.", { title: "Error" });
    } finally {
      btnConfirmProductDelete.disabled = false;
      btnConfirmProductDelete.textContent = "Delete Product";
    }
  });

  // ─── Table Actions (event delegation) ────────────────────────────────────────
  tableBody?.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    const viewBtn = target.closest("[data-view-id]");
    if (viewBtn) {
      const id = Number(viewBtn.getAttribute("data-view-id"));
      const product = products.find((p) => p.id === id);
      if (product) openViewModal(product);
      return;
    }

    const delBtn = target.closest("[data-delete-id]");
    if (delBtn) {
      const id = Number(delBtn.getAttribute("data-delete-id"));
      activeProductId = id;
      const product = products.find((p) => p.id === id);
      if (deleteTargetLabel)
        deleteTargetLabel.textContent = product?.name || "this product";
      openModal(modalDelete);
      return;
    }
  });

  // ─── Pagination ───────────────────────────────────────────────────────────────
  prevBtn?.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage -= 1;
      renderTable();
    }
  });
  nextBtn?.addEventListener("click", () => {
    currentPage += 1;
    renderTable();
  });
  searchInput?.addEventListener("input", () => {
    currentPage = 1;
    renderTable();
  });
  categoryFilter?.addEventListener("change", () => {
    currentPage = 1;
    renderTable();
  });


  // ─── Initialize ───────────────────────────────────────────────────────────────

  void loadProducts();

  // ── Realtime updates ─────────────────────────────────────────────────────────
  // Debounce guard: prevent multiple rapid loadProducts() calls.
  let _adminReloadDebounceTimer = null;
  const debouncedLoadProducts = () => {
    if (_adminReloadDebounceTimer) clearTimeout(_adminReloadDebounceTimer);
    _adminReloadDebounceTimer = setTimeout(() => {
      _adminReloadDebounceTimer = null;
      void loadProducts();
    }, 600);
  };

  // Reusable BroadcastChannel instances (created once, never duplicated)
  const PRODUCTS_REALTIME_CHANNEL = "fmrc-products-realtime";
  const ORDERS_REALTIME_CHANNEL = "fmrc-orders-realtime";

  const ORDER_ANALYTICS_EVENT_TYPES = new Set([
    "created",
    "updated",
    "deleted",
    "order-approve",
    "order-reject",
    "order-delete",
    "payment-status-updated",
    "payment-deleted",
  ]);

  const shouldRefreshFromOrderEvent = (payload) => {
    const type = String(payload?.type || "").toLowerCase();
    return ORDER_ANALYTICS_EVENT_TYPES.has(type);
  };

  let _productsChannel = null;
  const getProductsChannel = () => {
    if (typeof window.BroadcastChannel !== "function") return null;
    if (!_productsChannel) {
      _productsChannel = new window.BroadcastChannel(PRODUCTS_REALTIME_CHANNEL);
    }
    return _productsChannel;
  };

  // Expose a helper for broadcasting product changes from this admin page.
  // Uses a source tag so our own listener can ignore messages we sent.
  const broadcastProductChange = (type, productId = null) => {
    const ch = getProductsChannel();
    ch?.postMessage({ type, source: "admin-products", productId });
  };

  // Listen for product changes from OTHER tabs (e.g., another admin tab)
  const productsChannel = getProductsChannel();
  productsChannel?.addEventListener("message", (event) => {
    if (document.hidden) return;
    const payload = event?.data || {};
    // Ignore messages this tab sent
    if (payload.source === "admin-products") return;
    if (payload.type === "updated" || payload.type === "created" || payload.type === "deleted") {
      debouncedLoadProducts();
    }
  });

  // Listen for order events — only refresh when an order is actually created
  // (stock changes). Ignore profile-updated and other non-stock-relevant events.
  if (typeof window.BroadcastChannel === "function") {
    const ordersChannel = new window.BroadcastChannel(ORDERS_REALTIME_CHANNEL);
    ordersChannel.addEventListener("message", (event) => {
      if (document.hidden) return;
      const payload = event?.data || {};
      // Keep analytics cards in sync with Orders page mutations.
      if (shouldRefreshFromOrderEvent(payload)) {
        debouncedLoadProducts();
      }
    });
  }

  window.addEventListener("fmrc:orders-updated", (event) => {
    if (document.hidden) return;
    const payload = event?.detail || {};
    if (shouldRefreshFromOrderEvent(payload)) {
      debouncedLoadProducts();
    }
  });
});

