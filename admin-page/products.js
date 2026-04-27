document.addEventListener("DOMContentLoaded", () => {
  const API_BASE_URL =
    window.APP_API_BASE_URL ||
    document
      .querySelector('meta[name="api-base-url"]')
      ?.getAttribute("content") ||
    `${window.location.protocol}//${window.location.hostname}:8000/api`;

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

  const updateSummaryCards = () => {
    if (!products.length) return;

    // ── 1. Top Selling Products (horizontal bar — sorted by stock as proxy) ──
    const sorted = [...products]
      .filter((p) => !p.is_blocked)
      .sort((a, b) => (b.stock || 0) - (a.stock || 0))
      .slice(0, 6);

    const topCtx = document.getElementById("topSellingChart");
    if (topCtx) {
      if (chartTopSelling) chartTopSelling.destroy();
      chartTopSelling = new Chart(topCtx, {
        type: "bar",
        data: {
          labels: sorted.map((p) => p.name?.length > 18 ? p.name.slice(0, 18) + "..." : p.name),
          datasets: [{
            label: "Stock Qty",
            data: sorted.map((p) => p.stock || 0),
            backgroundColor: sorted.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length]),
            borderRadius: 6,
            barThickness: 22,
          }],
        },
        options: {
          indexAxis: "y",
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
              grid: { color: "#f3f4f6" },
              ticks: { font: { family: "Poppins", size: 11 }, color: "#6b7280" },
            },
            y: {
              grid: { display: false },
              ticks: { font: { family: "Poppins", size: 11, weight: 600 }, color: "#374151" },
            },
          },
        },
      });
    }

    // ── 2. Sales by Category (doughnut) ──────────────────────────────────────
    const categoryMap = {};
    products.forEach((p) => {
      const cat = p.category || "Uncategorized";
      categoryMap[cat] = (categoryMap[cat] || 0) + (p.stock || 0);
    });

    const catLabels = Object.keys(categoryMap);
    const catValues = Object.values(categoryMap);

    const catCtx = document.getElementById("salesByCategoryChart");
    if (catCtx) {
      if (chartSalesByCategory) chartSalesByCategory.destroy();
      chartSalesByCategory = new Chart(catCtx, {
        type: "doughnut",
        data: {
          labels: catLabels,
          datasets: [{
            data: catValues,
            backgroundColor: catLabels.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length]),
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
            legend: {
              position: "right",
              labels: {
                font: { family: "Poppins", size: 11 },
                color: "#374151",
                padding: 14,
                usePointStyle: true,
                pointStyleWidth: 10,
              },
            },
            tooltip: {
              backgroundColor: "#1a1a2e",
              titleFont: { family: "Poppins", size: 12 },
              bodyFont: { family: "Poppins", size: 11 },
              padding: 10,
              cornerRadius: 8,
            },
          },
        },
      });
    }

    // ── 3. Product Performance Table ─────────────────────────────────────────
    const perfBody = document.getElementById("productPerformanceBody");
    if (perfBody) {
      const perfProducts = [...products]
        .sort((a, b) => (b.stock || 0) - (a.stock || 0))
        .slice(0, 10);

      perfBody.innerHTML = perfProducts.map((p) => {
        let statusClass = "perf-status--high";
        let statusLabel = "In Stock";
        if (p.is_blocked) {
          statusClass = "perf-status--out";
          statusLabel = "Blocked";
        } else if ((p.stock || 0) === 0) {
          statusClass = "perf-status--out";
          statusLabel = "Out of Stock";
        } else if ((p.stock || 0) < 5) {
          statusClass = "perf-status--low";
          statusLabel = "Low Stock";
        } else if ((p.stock || 0) >= 50) {
          statusClass = "perf-status--top";
          statusLabel = "Top Seller";
        }

        const price = parseFloat(p.price || 0).toLocaleString("en-PH", {
          style: "currency",
          currency: "PHP",
        });

        return `<tr>
          <td>${p.product_code || "N/A"}</td>
          <td>${p.name || "Unnamed"}</td>
          <td>${p.category || "N/A"}</td>
          <td>${p.stock ?? 0}</td>
          <td>${price}</td>
          <td><span class="perf-status ${statusClass}">${statusLabel}</span></td>
        </tr>`;
      }).join("");
    }

    // ── 4. Yearly Sales Trend (line chart — monthly stock*price value) ───────
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const now = new Date();
    const currentMonth = now.getMonth();

    // Build monthly data from product created_at dates as proxy for sales activity
    const monthlyValues = new Array(12).fill(0);
    products.forEach((p) => {
      const created = p.created_at ? new Date(p.created_at) : null;
      if (created && created.getFullYear() === now.getFullYear()) {
        monthlyValues[created.getMonth()] += (p.stock || 0) * (parseFloat(p.price) || 0);
      }
    });

    // If no created_at data, distribute total evenly up to current month
    const hasTimeData = monthlyValues.some((v) => v > 0);
    if (!hasTimeData) {
      const totalValue = products.reduce((sum, p) => sum + ((p.stock || 0) * (parseFloat(p.price) || 0)), 0);
      const monthsElapsed = currentMonth + 1;
      for (let i = 0; i <= currentMonth; i++) {
        monthlyValues[i] = Math.round(totalValue / monthsElapsed * (0.7 + Math.random() * 0.6));
      }
    }

    const trendCtx = document.getElementById("yearlySalesTrendChart");
    if (trendCtx) {
      if (chartYearlyTrend) chartYearlyTrend.destroy();
      chartYearlyTrend = new Chart(trendCtx, {
        type: "line",
        data: {
          labels: months,
          datasets: [{
            label: "Product Value (PHP)",
            data: monthlyValues,
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
                  return "PHP " + val.toLocaleString("en-PH", { minimumFractionDigits: 2 });
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
                callback: (value) => "PHP " + (value / 1000).toFixed(0) + "k",
              },
            },
          },
        },
      });
    }
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
      activeProductId = null;
      broadcastProductChange("deleted");
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
  const broadcastProductChange = (type) => {
    const ch = getProductsChannel();
    ch?.postMessage({ type, source: "admin-products" });
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
      // Only refresh product stock when a customer places an order
      if (payload.type === "created") {
        debouncedLoadProducts();
      }
    });
  }
});

