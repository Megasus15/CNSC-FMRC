document.addEventListener("DOMContentLoaded", () => {
  // ─── API helpers ──────────────────────────────────────────────────────────────
  const API_BASE_URL = (() => {
    const proto = window.location.protocol;
    const host = window.location.hostname;
    const port = window.location.port;
    if (port === "8000") return `${proto}//${host}:${port}/api`;
    if (host === "localhost" || host === "127.0.0.1") return `${proto}//${host}:8000/api`;
    return `${proto}//${host}/api`;
  })();

  const token = (window.AdminSession && window.AdminSession.getToken()) || localStorage.getItem("auth_token") || "";
  const showPopup = (msg, opts = {}) => window.showAdminPopup?.(msg, opts);
  const escHtml = (str) => String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const setUnauthorized = () => {
    showPopup("Session expired or unauthorized. Please login again.", {
      title: "Access Required",
      onOk: () => { window.location.href = "../admin-auth/auth.html"; },
    });
  };

  // ─── Categories ───────────────────────────────────────────────────────────────
  const CATEGORIES = [
    "Consumable Materials",
    "Office Supplies",
    "Inventory Tools",
    "Electronics and Electrical Equipments",
  ];

  const UNIT_OPTIONS = ["pcs", "set", "ream", "box", "roll", "pack", "unit", "bottle", "pair"];

  const CATEGORY_ICONS = {
    "Consumable Materials": "fa-flask",
    "Office Supplies": "fa-pen-ruler",
    "Inventory Tools": "fa-screwdriver-wrench",
    "Electronics and Electrical Equipments": "fa-microchip",
  };

  // ─── DOM refs ─────────────────────────────────────────────────────────────────
  const categoryTablesWrap = document.getElementById("inventoryCategoryTables");
  const searchInput = document.getElementById("inventorySearchInput");
  const categoryFilter = document.getElementById("inventoryCategoryFilter");
  const btnOpenAdd = document.getElementById("btnOpenAddItem");
  const btnExportExcelAll = document.getElementById("btnExportExcelAll");

  // Summary metrics
  const metricTotal = document.getElementById("metricTotalItems");
  const metricGood = document.getElementById("metricGood");
  const metricLow = document.getElementById("metricLowStock");

  // Add/Edit modal
  const modalForm = document.getElementById("modalAddInventoryItem");
  const invModalTitle = document.getElementById("invModalTitle");
  const formCategory = document.getElementById("invFormCategory");
  const formItemName = document.getElementById("invFormItemName");
  const formDescription = document.getElementById("invFormDescription");
  const formUnit = document.getElementById("invFormUnit");
  const formOnHand = document.getElementById("invFormOnHand");
  const formRemarks = document.getElementById("invFormRemarks");
  const btnCancelForm = document.getElementById("btnCancelInvForm");
  const btnSaveForm = document.getElementById("btnSaveInvForm");
  const variantList = document.getElementById("invVariantList");
  const variantEmpty = document.getElementById("invVariantEmpty");
  const btnAddVariant = document.getElementById("btnAddVariant");

  // View modal
  const modalView = document.getElementById("modalViewInventoryItem");
  const invViewTitle = document.getElementById("invViewTitle");
  const invViewSubtitle = document.getElementById("invViewSubtitle");
  const invViewContent = document.getElementById("invViewContent");
  const btnCloseView = document.getElementById("btnCloseViewInv");
  const btnEditFromView = document.getElementById("btnEditFromViewInv");

  // Delete modal
  const modalDelete = document.getElementById("modalDeleteInventoryItem");
  const invDeleteLabel = document.getElementById("invDeleteTargetLabel");
  const btnCancelDelete = document.getElementById("btnCancelDeleteInv");
  const btnConfirmDelete = document.getElementById("btnConfirmDeleteInv");

  // Deduct modal refs
  const modalDeduct = document.getElementById("modalDeductInventoryItem");
  const deductCategory = document.getElementById("deductCategory");
  const deductItemName = document.getElementById("deductItemName");
  const deductTargetWrap = document.getElementById("deductTargetWrap");
  const deductTarget = document.getElementById("deductTarget");
  const deductOnHand = document.getElementById("deductOnHand");
  const deductAmount = document.getElementById("deductAmount");
  const deductAmountAdd = document.getElementById("deductAmountAdd");
  const deductAmountDeduct = document.getElementById("deductAmountDeduct");
  const deductName = document.getElementById("deductName");
  const deductPurpose = document.getElementById("deductPurpose");
  const deductRemarks = document.getElementById("deductRemarks");
  const btnCancelDeduct = document.getElementById("btnCancelDeduct");
  const btnSaveDeduct = document.getElementById("btnSaveDeduct");
  const btnModeAdd = document.getElementById("btnModeAdd");
  const btnModeDeduct = document.getElementById("btnModeDeduct");
  const deductAddFields = document.getElementById("deductAddFields");
  const deductDeductFields = document.getElementById("deductDeductFields");

  // ─── State ────────────────────────────────────────────────────────────────────
  let allItems = [];
  let editingItemId = null;
  let deletingItemId = null;
  let viewingItemId = null;
  const deductMetaByItemId = new Map();
  const deductMetaByVariantId = new Map();
  let activeDeductItem = null;
  let deductMode = "add"; // "add" or "deduct"
  const PAGE_SIZE = 5;
  const categoryPages = {};

  const openModal = (m) => m?.classList.add("show");
  const closeModal = (m) => m?.classList.remove("show");

  // ─── Status helpers ───────────────────────────────────────────────────────────
  const statusClass = (status) => {
    if (status === "Good") return "status-green";
    if (status === "Low Stock" || status === "Out of Stock") return "status-yellow";
    return "status-blue";
  };

  const displayStatus = (status) => (status === "Out of Stock" ? "Low Stock" : status);

  const remarksClass = (r) => {
    if (!r) return "remarks-default";
    if (r.includes("Acquired")) return "remarks-acquired";
    if (r.includes("Included")) return "remarks-included";
    if (r.includes("Restock")) return "remarks-restock";
    return "remarks-default";
  };

  const computeStatus = (onHand) => {
    const n = Number(onHand || 0);
    if (n <= 0) return "Out of Stock";
    if (n <= 5) return "Low Stock";
    return "Good";
  };

  // ─── Variant form helpers ───────────────────────────────────────────────────
  const refreshVariantEmptyState = () => {
    if (!variantEmpty) return;
    const hasRows = Boolean(variantList?.querySelector(".inv-variant-card"));
    variantEmpty.style.display = hasRows ? "none" : "block";
  };

  const refreshVariantIndices = () => {
    if (!variantList) return;
    const rows = Array.from(variantList.querySelectorAll(".inv-variant-card"));
    rows.forEach((row, idx) => {
      const chip = row.querySelector(".inv-variant-chip");
      if (chip) chip.textContent = `Variant ${idx + 1}`;
    });
  };

  const createVariantCard = (variant = {}, opts = {}) => {
    const card = document.createElement("div");
    card.className = "inv-variant-card";
    const unitOptions = UNIT_OPTIONS.map((unit) => `<option value="${escHtml(unit)}">${escHtml(unit)}</option>`).join("");

    card.innerHTML = `
      <div class="inv-variant-card-header">
        <span class="inv-variant-chip">Variant</span>
        <button class="btn-admin btn-secondary icon-only-btn inv-variant-remove" type="button" data-variant-remove title="Remove variant">
          <i class="fa-regular fa-trash-can"></i>
        </button>
      </div>
      <div class="inv-variant-grid">
        <div class="field-stack">
          <label>Variant Name <span style="color:#dc2626">*</span></label>
          <input class="input-field" data-variant-name maxlength="255" placeholder="e.g. Size A" />
        </div>
        <div class="field-stack">
          <label>Description</label>
          <input class="input-field" data-variant-description maxlength="500" placeholder="Optional" />
        </div>
        <div class="field-stack">
          <label>Unit <span style="color:#dc2626">*</span></label>
          <select class="filter-select" data-variant-unit>${unitOptions}</select>
        </div>
        <div class="field-stack">
          <label>Stocks On Hand <span style="color:#dc2626">*</span></label>
          <input class="input-field" data-variant-on-hand type="number" min="0" placeholder="0" />
        </div>
        <div class="field-stack full">
          <label>Remarks</label>
          <input class="input-field" data-variant-remarks maxlength="200" placeholder="Optional remarks" />
        </div>
      </div>
    `;

    const nameInput = card.querySelector("[data-variant-name]");
    const descInput = card.querySelector("[data-variant-description]");
    const unitSelect = card.querySelector("[data-variant-unit]");
    const onHandInput = card.querySelector("[data-variant-on-hand]");
    const remarksInput = card.querySelector("[data-variant-remarks]");

    if (nameInput) nameInput.value = variant.name || "";
    if (descInput) descInput.value = variant.description || "";
    if (unitSelect) {
      const unitVal = variant.unit || "pcs";
      unitSelect.value = UNIT_OPTIONS.includes(unitVal) ? unitVal : "pcs";
    }
    if (onHandInput) onHandInput.value = variant.on_hand ?? "";
    if (remarksInput) remarksInput.value = variant.remarks || "";

    if (opts.disableOnHand && onHandInput) {
      onHandInput.setAttribute("readonly", "true");
      onHandInput.setAttribute("disabled", "disabled");
    }

    return card;
  };

  const setVariantFormRows = (variants = [], opts = {}) => {
    if (!variantList) return;
    variantList.innerHTML = "";
    variants.forEach((variant) => variantList.appendChild(createVariantCard(variant, opts)));
    refreshVariantIndices();
    refreshVariantEmptyState();
  };

  const collectVariantsFromForm = () => {
    if (!variantList) return [];
    const rows = Array.from(variantList.querySelectorAll(".inv-variant-card"));
    const variants = [];

    for (const row of rows) {
      const nameVal = (row.querySelector("[data-variant-name]")?.value || "").trim();
      const descVal = (row.querySelector("[data-variant-description]")?.value || "").trim();
      const unitVal = row.querySelector("[data-variant-unit]")?.value || "pcs";
      const onHandInput = row.querySelector("[data-variant-on-hand]");
      const onHandRaw = onHandInput?.value ?? "";
      const remarksVal = (row.querySelector("[data-variant-remarks]")?.value || "").trim();

      const isEmpty = !nameVal && !descVal && !onHandRaw && !remarksVal;
      if (isEmpty) continue;

      if (!nameVal) {
        showPopup("Variant name is required.", { title: "Validation Error" });
        row.querySelector("[data-variant-name]")?.focus();
        return null;
      }

      if (onHandRaw === "") {
        showPopup("Variant stocks on hand is required.", { title: "Validation Error" });
        onHandInput?.focus();
        return null;
      }

      const onHandNum = Number(onHandRaw);
      if (Number.isNaN(onHandNum) || onHandNum < 0) {
        showPopup("Variant stocks on hand must be 0 or higher.", { title: "Validation Error" });
        onHandInput?.focus();
        return null;
      }

      variants.push({
        name: nameVal,
        description: descVal,
        unit: unitVal,
        on_hand: onHandNum,
        remarks: remarksVal,
      });
    }

    return variants;
  };

  const updateDeductTargetFields = () => {
    if (!activeDeductItem) return;
    const variants = Array.isArray(activeDeductItem.variants) ? activeDeductItem.variants : [];
    const hasVariants = Boolean(activeDeductItem.has_variants ?? variants.length > 0);
    const targetVal = deductTarget?.value || "";
    let displayName = activeDeductItem.item_name;
    let onHandVal = activeDeductItem.on_hand;

    if (hasVariants) {
      const variantId = Number(targetVal.replace("variant:", ""));
      const variant = variants.find((v) => Number(v.id) === variantId) || variants[0];
      if (variant) {
        displayName = `${activeDeductItem.item_name} — ${variant.name}`;
        onHandVal = variant.on_hand ?? 0;
      }
    }

    if (deductItemName) deductItemName.value = displayName;
    if (deductOnHand) deductOnHand.value = String(onHandVal ?? 0);
  };

  // ─── Filter items ─────────────────────────────────────────────────────────────
  const getFilteredItemsByCategory = (category) => {
    const q = (searchInput?.value || "").trim().toLowerCase();
    const filterCat = categoryFilter?.value || "all";

    // If a specific category is selected in the filter and doesn't match, return empty
    if (filterCat !== "all" && filterCat !== category) return [];

    return allItems.filter((item) => {
      if (item.category !== category) return false;
      if (q) {
        const haystack = `${item.item_name} ${item.description || ""}`.toLowerCase();
        const variants = Array.isArray(item.variants) ? item.variants : [];
        const variantHit = variants.some((variant) => {
          const variantText = `${variant.name || ""} ${variant.description || ""}`.toLowerCase();
          return variantText.includes(q);
        });
        if (!haystack.includes(q) && !variantHit) return false;
      }
      return true;
    });
  };

  // ─── Summary metrics ──────────────────────────────────────────────────────────
  const updateMetrics = (summary) => {
    if (metricTotal) metricTotal.textContent = String(summary?.total_items ?? 0);
    if (metricGood) metricGood.textContent = String(summary?.good ?? 0);
    if (metricLow) metricLow.textContent = String(summary?.low_stock ?? 0);
  };

  // ─── Render one category table ────────────────────────────────────────────────
  const renderCategoryTable = (category) => {
    const containerId = `inv-cat-${category.replace(/\s+/g, "-").toLowerCase()}`;
    let card = document.getElementById(containerId);
    const items = getFilteredItemsByCategory(category);
    const filterCat = categoryFilter?.value || "all";

    // Hide entire card if a specific category is selected and doesn't match
    if (filterCat !== "all" && filterCat !== category) {
      if (card) card.style.display = "none";
      return;
    }

    if (!card) {
      card = document.createElement("div");
      card.id = containerId;
      card.className = "inv-category-card";
      categoryTablesWrap?.appendChild(card);
    }
    card.style.display = "";

    const icon = CATEGORY_ICONS[category] || "fa-box";
    const page = categoryPages[category] || 1;
    const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    const validPage = Math.min(page, totalPages);
    categoryPages[category] = validPage;
    const start = (validPage - 1) * PAGE_SIZE;
    const paged = items.slice(start, start + PAGE_SIZE);

    let tableRows = "";
    if (!paged.length) {
      tableRows = `<tr class="table-empty-row"><td colspan="8"><div class="table-empty-state"><i class="fa-regular fa-folder-open"></i><span>No items found in this category.</span></div></td></tr>`;
    } else {
      const rows = [];
      paged.forEach((item, idx) => {
        const rowNum = start + idx + 1;
        const variants = Array.isArray(item.variants) ? item.variants : [];
        const hasVariants = Boolean(item.has_variants ?? variants.length > 0);
        const statusText = displayStatus(item.status);
        const statusHtml = `<span class="status-pill ${statusClass(statusText)}">${escHtml(statusText)}</span>`;
        const remarksHtml = item.remarks
          ? `<span class="remarks-pill ${remarksClass(item.remarks)}">${escHtml(item.remarks)}</span>`
          : `<span style="color:#9ca3af;font-size:0.75rem;">—</span>`;
        const baseDescriptionHtml = hasVariants ? "" : escHtml(item.description || "—");
        const baseUnitHtml = hasVariants ? "" : escHtml(item.unit || "—");
        const baseOnHandHtml = hasVariants ? "" : escHtml(item.on_hand ?? 0);
        const baseStatusHtml = hasVariants ? "" : statusHtml;
        const baseRemarksHtml = hasVariants ? "" : remarksHtml;
        const toggleHtml = hasVariants
          ? `<button type="button" class="inv-variant-toggle" data-inv-toggle="${item.id}" aria-expanded="false" title="Toggle variants">
              <i class="fa-solid fa-chevron-right"></i>
            </button>`
          : "";
        const itemNameHtml = hasVariants
          ? `<div class="inv-name-cell">${toggleHtml}<span>${escHtml(item.item_name)}</span><span class="inv-variant-count">${variants.length} variant${variants.length !== 1 ? "s" : ""}</span></div>`
          : escHtml(item.item_name);

        rows.push(`
          <tr${hasVariants ? ' class="inv-has-variants"' : ''}>
            <td>${rowNum}</td>
            <td title="${escHtml(item.item_name)}">${itemNameHtml}</td>
            <td title="${hasVariants ? "" : escHtml(item.description || "")}">${baseDescriptionHtml}</td>
            <td>${baseUnitHtml}</td>
            <td>${baseOnHandHtml}</td>
            <td>${baseStatusHtml}</td>
            <td>${baseRemarksHtml}</td>
            <td class="action-icons sticky-action">
              <button type="button" data-tooltip="View Item" data-inv-view="${item.id}"><i class="fa-regular fa-eye"></i></button>
              <button type="button" data-tooltip="Update Stocks" data-inv-deduct="${item.id}"><i class="fa-solid fa-square-minus"></i></button>
              <button type="button" data-tooltip="Download Item Form" data-inv-download="${item.id}"><i class="fa-solid fa-file-arrow-down"></i></button>
              <button type="button" data-tooltip="Delete Item" data-inv-delete="${item.id}"><i class="fa-regular fa-trash-can"></i></button>
            </td>
          </tr>
        `);

        if (hasVariants) {
          variants.forEach((variant) => {
            const variantStatus = displayStatus(computeStatus(variant.on_hand));
            const variantStatusHtml = `<span class="status-pill ${statusClass(variantStatus)}">${escHtml(variantStatus)}</span>`;
            const variantRemarksHtml = variant.remarks
              ? `<span class="remarks-pill ${remarksClass(variant.remarks)}">${escHtml(variant.remarks)}</span>`
              : `<span style="color:#9ca3af;font-size:0.75rem;">—</span>`;
            rows.push(`
              <tr class="inv-variant-row" data-variant-parent="${item.id}" style="display:none;">
                <td>&nbsp;</td>
                <td title="${escHtml(variant.name || "")}">
                  <span class="inv-variant-name">
                    <span class="inv-variant-chip">Variant</span>
                    <span class="inv-variant-indent">${escHtml(variant.name || "—")}</span>
                  </span>
                </td>
                <td title="${escHtml(variant.description || "")}">${escHtml(variant.description || "—")}</td>
                <td>${escHtml(variant.unit || "—")}</td>
                <td>${variant.on_hand ?? 0}</td>
                <td>${variantStatusHtml}</td>
                <td>${variantRemarksHtml}</td>
                <td class="sticky-action" aria-hidden="true"><span style="color:#cbd5f5;">—</span></td>
              </tr>
            `);
          });
        }
      });
      tableRows = rows.join("");
    }

    const from = items.length ? start + 1 : 0;
    const to = items.length ? Math.min(items.length, start + PAGE_SIZE) : 0;

    card.innerHTML = `
      <div class="inv-category-header">
        <div class="inv-category-header-left">
          <div class="inv-category-icon"><i class="fa-solid ${icon}"></i></div>
          <span class="inv-category-title">Inventory of ${escHtml(category)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="inv-category-badge">${items.length} item${items.length !== 1 ? "s" : ""}</span>
          <button type="button" class="btn-admin btn-secondary" data-cat-export="${escHtml(category)}" title="Export this category to Excel">
            <i class="fa-solid fa-file-excel"></i> Export Excel
          </button>
        </div>
      </div>
      <div class="inv-category-body">
        <div class="table-wrapper">
          <table class="admin-table inventory-table inv-table">
            <thead>
              <tr>
                <th>No.</th>
                <th>Item Name</th>
                <th>Description</th>
                <th>Unit</th>
                <th>Stocks On Hand</th>
                <th>Status</th>
                <th>Remarks</th>
                <th class="th-action sticky-action">Action</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
        <div class="inv-cat-footer">
          <span>Page ${validPage} of ${totalPages} &bull; Showing ${from}&ndash;${to} of ${items.length}</span>
          <div class="table-pagination">
            <button class="page-btn" data-cat-prev="${category}" ${validPage <= 1 ? "disabled" : ""}><i class="fa-solid fa-chevron-left"></i></button>
            <div class="page-number">${validPage}</div>
            <button class="page-btn" data-cat-next="${category}" ${validPage >= totalPages ? "disabled" : ""}><i class="fa-solid fa-chevron-right"></i></button>
          </div>
        </div>
      </div>
    `;
  };

  // ─── Render all category tables ───────────────────────────────────────────────
  const renderAllTables = () => {
    CATEGORIES.forEach((cat) => renderCategoryTable(cat));
  };

  // ─── Skeleton loading for category tables ──────────────────────────────────
  const SKELETON_ROWS_PER_TABLE = 3;

  const renderSkeletonTables = () => {
    if (!categoryTablesWrap) return;
    categoryTablesWrap.innerHTML = CATEGORIES.map((category) => {
      const containerId = `inv-cat-${category.replace(/\s+/g, "-").toLowerCase()}`;
      const icon = CATEGORY_ICONS[category] || "fa-box";
      const skeletonRows = Array.from({ length: SKELETON_ROWS_PER_TABLE }).map(() => `
        <tr class="inv-skeleton-row">
          <td><div class="inv-skeleton-cell" style="width:28px;"></div></td>
          <td><div class="inv-skeleton-cell" style="width:120px;"></div></td>
          <td><div class="inv-skeleton-cell" style="width:100px;"></div></td>
          <td><div class="inv-skeleton-cell" style="width:40px;"></div></td>
          <td><div class="inv-skeleton-cell" style="width:50px;"></div></td>
          <td><div class="inv-skeleton-cell" style="width:70px;"></div></td>
          <td><div class="inv-skeleton-cell" style="width:80px;"></div></td>
          <td><div class="inv-skeleton-cell" style="width:60px;"></div></td>
        </tr>
      `).join("");

      return `
        <div class="inv-category-card" id="${containerId}">
          <div class="inv-category-header">
            <div class="inv-category-header-left">
              <div class="inv-category-icon"><i class="fa-solid ${icon}"></i></div>
              <span class="inv-category-title">Inventory of ${escHtml(category)}</span>
            </div>
            <span class="inv-category-badge"><div class="inv-skeleton-cell" style="width:50px;height:12px;display:inline-block;"></div></span>
          </div>
          <div class="inv-category-body">
            <div class="table-wrapper">
              <table class="admin-table inventory-table inv-table">
                <thead>
                  <tr>
                    <th>No.</th><th>Item Name</th><th>Description</th><th>Unit</th>
                    <th>Stocks On Hand</th><th>Status</th><th>Remarks</th>
                    <th class="th-action sticky-action">Action</th>
                  </tr>
                </thead>
                <tbody>${skeletonRows}</tbody>
              </table>
            </div>
            <div class="inv-cat-footer">
              <span><div class="inv-skeleton-cell" style="width:130px;height:10px;display:inline-block;"></div></span>
              <div class="table-pagination">
                <button class="page-btn" disabled><i class="fa-solid fa-chevron-left"></i></button>
                <div class="page-number">1</div>
                <button class="page-btn" disabled><i class="fa-solid fa-chevron-right"></i></button>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join("");
  };

  // Inject skeleton loading styles
  const skeletonStyle = document.createElement("style");
  skeletonStyle.textContent = `
    .inv-skeleton-cell {
      height: 14px;
      border-radius: 6px;
      background: linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 50%, #f3f4f6 75%);
      background-size: 200% 100%;
      animation: invShimmer 1.4s infinite;
    }
    @keyframes invShimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
    .inv-skeleton-row td { padding: 10px 14px; }
  `;
  document.head.appendChild(skeletonStyle);

  // ─── Load inventory from API ──────────────────────────────────────────────────
  const loadInventory = async () => {
    renderSkeletonTables();
    try {
      const res = await fetch(`${API_BASE_URL}/admin/inventory`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      if (res.status === 401 || res.status === 403) { setUnauthorized(); return; }
      if (!res.ok) throw new Error("Failed to load inventory");
      const payload = await res.json();
      allItems = Array.isArray(payload?.data) ? payload.data : [];
      if (payload?.summary) updateMetrics(payload.summary);
      renderAllTables();
    } catch (err) {
      console.error("Load inventory error:", err);
      if (categoryTablesWrap) {
        categoryTablesWrap.innerHTML = `<div class="panel" style="text-align:center;padding:40px;color:#991b1b;">Could not load inventory. Ensure Laravel server is running.</div>`;
      }
    }
  };

  const formatPHDate = (isoDate) => {
    const d = isoDate ? new Date(isoDate) : new Date();
    return d.toLocaleDateString("en-PH", { timeZone: "Asia/Manila" });
  };

  const todayPH = () => formatPHDate();

  const sanitizeFilename = (name) => String(name || "inventory").replace(/[^a-z0-9\-_]+/gi, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "inventory";

  const fetchTransactions = async (params = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    });
    const endpoint = `${API_BASE_URL}/admin/inventory/transactions${qs.toString() ? `?${qs.toString()}` : ""}`;
    const res = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (res.status === 401 || res.status === 403) { setUnauthorized(); return []; }
    if (!res.ok) throw new Error("Failed to load inventory transactions");
    const payload = await res.json();
    return Array.isArray(payload?.data) ? payload.data : [];
  };

  const buildHorizontalExportRows = (items, transactions) => {
    const nowDate = todayPH();

    // Group items with their variants for hierarchical structure
    const itemsWithVariants = items.map((item, idx) => ({
      itemNumber: idx + 1,
      ...item,
      variants: Array.isArray(item.variants) ? item.variants : [],
    }));

    // Helper: Get symbol for variant by index
    const getVariantSymbol = (vIdx) => {
      const symbolMap = ["*", ">", "▸", "◆", "●"];
      return symbolMap[vIdx % symbolMap.length];
    };

    // Build Stock In rows: initial on-hand values
    const stockInRows = [];
    itemsWithVariants.forEach((item) => {
      stockInRows.push({
        itemNumber: item.itemNumber,
        variantSymbol: null,
        date: nowDate,
        item_name: item.item_name,
        description: item.description || "—",
        stock: Number(item.last_invent ?? item.on_hand ?? 0),
      });
      item.variants.forEach((variant, vIdx) => {
        stockInRows.push({
          itemNumber: item.itemNumber,
          variantSymbol: getVariantSymbol(vIdx),
          date: nowDate,
          item_name: variant.name || "Variant",
          description: variant.description || "—",
          stock: Number(variant.initial_on_hand ?? variant.on_hand ?? 0),
        });
      });
    });

    // Build Balance Stock rows: current on-hand values
    const balanceRows = [];
    itemsWithVariants.forEach((item) => {
      balanceRows.push({
        itemNumber: item.itemNumber,
        variantSymbol: null,
        date: nowDate,
        item_name: item.item_name,
        description: item.description || "—",
        stock: Number(item.on_hand ?? 0),
      });
      item.variants.forEach((variant, vIdx) => {
        balanceRows.push({
          itemNumber: item.itemNumber,
          variantSymbol: getVariantSymbol(vIdx),
          date: nowDate,
          item_name: variant.name || "Variant",
          description: variant.description || "—",
          stock: Number(variant.on_hand ?? 0),
        });
      });
    });

    // Build Stock Out rows from transactions
    const stockOutRows = [];
    (transactions || []).forEach((tx) => {
      const matchItem = itemsWithVariants.find((it) => it.id === tx.inventory_item_id);
      let itemNumber = null;
      let variantSymbol = null;
      if (matchItem) {
        itemNumber = matchItem.itemNumber;
        if (tx.variant_id) {
          const variantIdx = matchItem.variants.findIndex((v) => v.id === tx.variant_id);
          if (variantIdx >= 0) {
            variantSymbol = getVariantSymbol(variantIdx);
          }
        }
      }
      stockOutRows.push({
        itemNumber: itemNumber,
        variantSymbol: variantSymbol,
        date: formatPHDate(tx.created_at),
        item_name: tx.item_name || "—",
        description: tx.description || "—",
        stock: Number(tx.signed_amount ?? 0),
        by: tx.name || "—",
        purpose: tx.purpose || "—",
        remarks: tx.remarks || "—",
      });
    });

    return { stockInRows, stockOutRows, balanceRows };
  };

  const createHorizontalWorkbook = ({ stockInRows, stockOutRows, balanceRows, sheetName = "Inventory", isPerItem = false }) => {
    if (!window.XLSX) {
      showPopup("Excel library failed to load. Please refresh this page.", { title: "Export Error" });
      return null;
    }

    // Prepare column structure
    const maxRows = Math.max(stockInRows.length, stockOutRows.length, balanceRows.length, 1) + 5;
    const aoa = Array.from({ length: maxRows }, () => Array(24).fill(""));

    // Column indices for each section
    const cols = {
      stockIn: { start: 0, no: 0, date: 1, name: 2, desc: 3, stock: 4 },
      stockOut: { start: 6, no: 6, date: 7, name: 8, desc: 9, stock: 10, by: 11, purpose: 12, remarks: 13 },
      balance: { start: 14, no: 14, date: 15, name: 16, desc: 17, stock: 18 },
    };

    // Row indices
    const blankRow = 0;
    const titleRow = 1;
    const headerRow = 2;
    const dataStartRow = 3;

    // Title row (centered across first 5 columns)
    aoa[titleRow][0] = "INVENTORY EXPORT";

    // Table name headers
    aoa[headerRow][cols.stockIn.start] = "STOCK IN";
    aoa[headerRow][cols.stockOut.start] = "STOCK OUT";
    aoa[headerRow][cols.balance.start] = "BALANCE STOCK";

    // Column headers
    // Stock In
    aoa[headerRow + 1][cols.stockIn.no] = "No.";
    aoa[headerRow + 1][cols.stockIn.date] = "Date";
    aoa[headerRow + 1][cols.stockIn.name] = "Item Name";
    aoa[headerRow + 1][cols.stockIn.desc] = "Description";
    aoa[headerRow + 1][cols.stockIn.stock] = "Stock";

    // Stock Out - with extra columns for per-item exports
    aoa[headerRow + 1][cols.stockOut.no] = "No.";
    aoa[headerRow + 1][cols.stockOut.date] = "Date";
    aoa[headerRow + 1][cols.stockOut.name] = "Item Name";
    aoa[headerRow + 1][cols.stockOut.desc] = "Description";
    aoa[headerRow + 1][cols.stockOut.stock] = "Stock";
    if (isPerItem) {
      aoa[headerRow + 1][cols.stockOut.by] = "By";
      aoa[headerRow + 1][cols.stockOut.purpose] = "Purpose";
      aoa[headerRow + 1][cols.stockOut.remarks] = "Remarks";
    }

    // Balance Stock
    aoa[headerRow + 1][cols.balance.no] = "No.";
    aoa[headerRow + 1][cols.balance.date] = "Date";
    aoa[headerRow + 1][cols.balance.name] = "Item Name";
    aoa[headerRow + 1][cols.balance.desc] = "Description";
    aoa[headerRow + 1][cols.balance.stock] = "Stock";

    // Fill data rows
    const maxDataRows = Math.max(stockInRows.length, stockOutRows.length, balanceRows.length);
    for (let i = 0; i < maxDataRows; i++) {
      const rowIdx = dataStartRow + i;

      // Stock In data
      if (i < stockInRows.length) {
        const row = stockInRows[i];
        const no = row.variantSymbol ? row.variantSymbol : String(row.itemNumber || "");
        aoa[rowIdx][cols.stockIn.no] = no;
        aoa[rowIdx][cols.stockIn.date] = row.date;
        aoa[rowIdx][cols.stockIn.name] = row.variantSymbol ? `  ${row.item_name}` : row.item_name;
        aoa[rowIdx][cols.stockIn.desc] = row.description;
        aoa[rowIdx][cols.stockIn.stock] = row.stock;
      }

      // Stock Out data
      if (i < stockOutRows.length) {
        const row = stockOutRows[i];
        const no = row.variantSymbol ? row.variantSymbol : String(row.itemNumber || "");
        aoa[rowIdx][cols.stockOut.no] = no;
        aoa[rowIdx][cols.stockOut.date] = row.date;
        aoa[rowIdx][cols.stockOut.name] = row.variantSymbol ? `  ${row.item_name}` : row.item_name;
        aoa[rowIdx][cols.stockOut.desc] = row.description;
        aoa[rowIdx][cols.stockOut.stock] = row.stock;
        if (isPerItem) {
          aoa[rowIdx][cols.stockOut.by] = row.by || "—";
          aoa[rowIdx][cols.stockOut.purpose] = row.purpose || "—";
          aoa[rowIdx][cols.stockOut.remarks] = row.remarks || "—";
        }
      }

      // Balance Stock data
      if (i < balanceRows.length) {
        const row = balanceRows[i];
        const no = row.variantSymbol ? row.variantSymbol : String(row.itemNumber || "");
        aoa[rowIdx][cols.balance.no] = no;
        aoa[rowIdx][cols.balance.date] = row.date;
        aoa[rowIdx][cols.balance.name] = row.variantSymbol ? `  ${row.item_name}` : row.item_name;
        aoa[rowIdx][cols.balance.desc] = row.description;
        aoa[rowIdx][cols.balance.stock] = row.stock;
      }
    }

    // Create sheet
    const ws = window.XLSX.utils.aoa_to_sheet(aoa);

    // Set column widths
    ws["!cols"] = [
      { wch: 5 },   // Stock In: No.
      { wch: 12 },  // Date
      { wch: 24 },  // Item Name
      { wch: 22 },  // Description
      { wch: 10 },  // Stock
      { wch: 2 },   // Gap
      { wch: 5 },   // Stock Out: No.
      { wch: 12 },  // Date
      { wch: 24 },  // Item Name
      { wch: 22 },  // Description
      { wch: 10 },  // Stock
      isPerItem ? { wch: 18 } : { wch: 2 },  // By / Gap
      isPerItem ? { wch: 20 } : { wch: 2 },  // Purpose / Gap
      isPerItem ? { wch: 20 } : { wch: 2 },  // Remarks / Gap
      { wch: 5 },   // Balance: No.
      { wch: 12 },  // Date
      { wch: 24 },  // Item Name
      { wch: 22 },  // Description
      { wch: 10 },  // Stock
    ];

    // Set up merges for table name headers
    ws["!merges"] = [
      { s: { r: titleRow, c: 0 }, e: { r: titleRow, c: 4 } },
      { s: { r: headerRow, c: cols.stockIn.start }, e: { r: headerRow, c: cols.stockIn.stock } },
      { s: { r: headerRow, c: cols.stockOut.start }, e: { r: headerRow, c: isPerItem ? cols.stockOut.remarks : cols.stockOut.stock } },
      { s: { r: headerRow, c: cols.balance.start }, e: { r: headerRow, c: cols.balance.stock } },
    ];

    // Apply styling
    const range = window.XLSX.utils.decode_range(ws["!ref"]);
    for (let R = range.s.r; R <= range.e.r; R++) {
      for (let C = range.s.c; C < 19; C++) {
        const cellRef = window.XLSX.utils.encode_cell({ r: R, c: C });
        if (!ws[cellRef]) {
          ws[cellRef] = { v: "", t: "s" };
        }

        const cellVal = ws[cellRef].v;
        let style = {
          border: {
            top: { style: "thin", color: { rgb: "FF999999" } },
            bottom: { style: "thin", color: { rgb: "FF999999" } },
            left: { style: "thin", color: { rgb: "FF999999" } },
            right: { style: "thin", color: { rgb: "FF999999" } },
          },
        };

        // Main title row
        if (R === titleRow && cellVal === "INVENTORY EXPORT") {
          style.fill = { fgColor: { rgb: "FF4472C4" } };
          style.font = { bold: true, sz: 14, color: { rgb: "FFFFFFFF" } };
          style.alignment = { horizontal: "center", vertical: "center" };
          style.border = {
            top: { style: "medium", color: { rgb: "FF000000" } },
            bottom: { style: "medium", color: { rgb: "FF000000" } },
            left: { style: "medium", color: { rgb: "FF000000" } },
            right: { style: "medium", color: { rgb: "FF000000" } },
          };
        }
        // Table name headers (STOCK IN, STOCK OUT, BALANCE STOCK)
        else if (
          R === headerRow &&
          (cellVal === "STOCK IN" || cellVal === "STOCK OUT" || cellVal === "BALANCE STOCK")
        ) {
          style.fill = { fgColor: { rgb: "FFD9E1F2" } };
          style.font = { bold: true, sz: 11, color: { rgb: "FF000000" } };
          style.alignment = { horizontal: "center", vertical: "center" };
          style.border = {
            top: { style: "thin", color: { rgb: "FF000000" } },
            bottom: { style: "thin", color: { rgb: "FF000000" } },
            left: { style: "thin", color: { rgb: "FF000000" } },
            right: { style: "thin", color: { rgb: "FF000000" } },
          };
        }
        // Column headers
        else if (
          R === headerRow + 1 &&
          (cellVal === "No." ||
            cellVal === "Date" ||
            cellVal === "Item Name" ||
            cellVal === "Description" ||
            cellVal === "Stock" ||
            cellVal === "By" ||
            cellVal === "Purpose" ||
            cellVal === "Remarks")
        ) {
          style.fill = { fgColor: { rgb: "FFE8E8E8" } };
          style.font = { bold: true, sz: 10, color: { rgb: "FF000000" } };
          style.alignment = { horizontal: "center", vertical: "center" };
          style.border = {
            top: { style: "thin", color: { rgb: "FF000000" } },
            bottom: { style: "thin", color: { rgb: "FF000000" } },
            left: { style: "thin", color: { rgb: "FF000000" } },
            right: { style: "thin", color: { rgb: "FF000000" } },
          };
        }
        // Data rows
        else if (R >= dataStartRow && cellVal !== "") {
          style.alignment = { horizontal: typeof cellVal === "number" ? "right" : "left", vertical: "center", wrapText: true };
          if (typeof cellVal === "number") {
            style.numFmt = "0";
          }
        }

        ws[cellRef].s = style;
      }
    }

    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31) || "Inventory");
    return wb;
  };

  const downloadWorkbook = (wb, filenameBase) => {
    if (!wb || !window.XLSX) return;
    window.XLSX.writeFile(wb, `${sanitizeFilename(filenameBase)}.xlsx`);
  };

  const exportItemsToXlsx = async ({ items, filenameBase, txFilter = {} }) => {
    if (!Array.isArray(items) || !items.length) {
      showPopup("No items available to export.", { title: "Export Notice" });
      return;
    }
    const txRows = await fetchTransactions(txFilter);
    const rows = buildHorizontalExportRows(items, txRows);
    const isPerItem = items.length === 1;
    const wb = createHorizontalWorkbook({ ...rows, sheetName: "Inventory", isPerItem });
    downloadWorkbook(wb, filenameBase);
  };

  btnExportExcelAll?.addEventListener("click", async () => {
    try {
      await exportItemsToXlsx({
        items: allItems,
        filenameBase: `inventory_all_${todayPH().replace(/\//g, '-')}`,
      });
    } catch (err) {
      console.error("Export all error:", err);
      showPopup("Failed to export all inventory items.", { title: "Export Error" });
    }
  });

  // ─── Form helpers ─────────────────────────────────────────────────────────────
  const resetForm = () => {
    editingItemId = null;
    if (invModalTitle) invModalTitle.innerHTML = '<i class="fa-solid fa-plus" style="margin-right:6px;"></i>Add New Item';
    if (btnSaveForm) btnSaveForm.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Add to Inventory';
    if (formCategory) formCategory.value = "Consumable Materials";
    if (formItemName) formItemName.value = "";
    if (formDescription) formDescription.value = "";
    if (formUnit) formUnit.value = "pcs";
    if (formOnHand) { formOnHand.value = ""; formOnHand.removeAttribute('readonly'); formOnHand.removeAttribute('disabled'); }
    if (formRemarks) formRemarks.value = "";
    setVariantFormRows([]);
    // Exit variant mode
    if (modalForm) modalForm.classList.remove("variant-mode");
    // Show required asterisks for Unit and Stocks On Hand
    const unitTag = document.getElementById("unitRequiredTag");
    const onHandTag = document.getElementById("onHandRequiredTag");
    if (unitTag) unitTag.style.display = "inline";
    if (onHandTag) onHandTag.style.display = "inline";
  };

  const populateFormForEdit = (item) => {
    editingItemId = item.id;
    if (invModalTitle) invModalTitle.innerHTML = '<i class="fa-regular fa-pen-to-square" style="margin-right:6px;"></i>Edit Item';
    if (btnSaveForm) btnSaveForm.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Update Item';
    if (formCategory) formCategory.value = item.category;
    if (formItemName) formItemName.value = item.item_name || "";
    if (formDescription) formDescription.value = item.description || "";
    if (formUnit) formUnit.value = item.unit || "pcs";
    // On edit: Category, Item Name, Description, Unit are editable only.
    if (formOnHand) { formOnHand.value = item.on_hand ?? ""; formOnHand.setAttribute('readonly', 'true'); formOnHand.setAttribute('disabled', 'disabled'); }
    if (formRemarks) formRemarks.value = item.remarks || "";
    setVariantFormRows(Array.isArray(item.variants) ? item.variants : [], { disableOnHand: true });
  };

  // ─── Open Add Modal ───────────────────────────────────────────────────────────
  btnOpenAdd?.addEventListener("click", () => {
    resetForm();
    openModal(modalForm);
  });

  btnCancelForm?.addEventListener("click", () => closeModal(modalForm));

  btnAddVariant?.addEventListener("click", () => {
    if (!variantList) return;
    
    // Check if this is the first variant
    const hasVariants = Boolean(variantList.querySelector(".inv-variant-card"));
    if (!hasVariants) {
      // Entering variant mode - hide base item fields and clear them
      if (modalForm) {
        modalForm.classList.add("variant-mode");
      }
      // Clear base item fields so they won't be saved
      if (formDescription) formDescription.value = "";
      if (formRemarks) formRemarks.value = "";
      if (formUnit) formUnit.value = "pcs";
      if (formOnHand) formOnHand.value = "";
      
      // Hide required asterisks for Unit and Stocks On Hand
      const unitTag = document.getElementById("unitRequiredTag");
      const onHandTag = document.getElementById("onHandRequiredTag");
      if (unitTag) unitTag.style.display = "none";
      if (onHandTag) onHandTag.style.display = "none";
    }
    
    variantList.appendChild(createVariantCard({}, { disableOnHand: false }));
    refreshVariantIndices();
    refreshVariantEmptyState();
  });

  variantList?.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const removeBtn = target.closest("[data-variant-remove]");
    if (removeBtn) {
      removeBtn.closest(".inv-variant-card")?.remove();
      refreshVariantIndices();
      refreshVariantEmptyState();
      
      // Check if there are any variants left
      const hasVariants = Boolean(variantList.querySelector(".inv-variant-card"));
      if (!hasVariants && modalForm) {
        // Exiting variant mode - show base item fields again
        modalForm.classList.remove("variant-mode");
        
        // Show required asterisks for Unit and Stocks On Hand
        const unitTag = document.getElementById("unitRequiredTag");
        const onHandTag = document.getElementById("onHandRequiredTag");
        if (unitTag) unitTag.style.display = "inline";
        if (onHandTag) onHandTag.style.display = "inline";
      }
    }
  });

  // ─── Save / Update ────────────────────────────────────────────────────────────
  btnSaveForm?.addEventListener("click", async () => {
    const isEditing = editingItemId !== null;
    const itemName = (formItemName?.value || "").trim();
    const category = formCategory?.value || "Consumable Materials";
    const unit = formUnit?.value || "pcs";
    const onHand = Number(formOnHand?.value || 0);
    const remarks = formRemarks?.value || "";
    const description = (formDescription?.value || "").trim();
    const variants = collectVariantsFromForm();
    if (variants === null) return;

    if (!itemName) { showPopup("Item Name is required.", { title: "Validation Error" }); formItemName?.focus(); return; }
    
    // Unit and Stocks On Hand are only required if there are no variants
    const hasVariants = variants.length > 0;
    if (!hasVariants) {
      if (formOnHand?.value === "" || formOnHand?.value === null) { showPopup("Stocks On Hand is required when no variants are added.", { title: "Validation Error" }); formOnHand?.focus(); return; }
      if (!unit || unit === "") { showPopup("Unit is required when no variants are added.", { title: "Validation Error" }); formUnit?.focus(); return; }
    }

    const body = { category, item_name: itemName, description, unit, on_hand: onHand, remarks, variants };

    btnSaveForm.disabled = true;
    btnSaveForm.textContent = isEditing ? "Updating…" : "Saving…";

    try {
      const url = isEditing ? `${API_BASE_URL}/admin/inventory/${editingItemId}` : `${API_BASE_URL}/admin/inventory`;
      const method = isEditing ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, Accept: "application/json" },
        body: JSON.stringify(body),
      });

      if (res.status === 401 || res.status === 403) { setUnauthorized(); return; }
      const payload = await res.json();
      if (!res.ok) {
        const msg = payload?.message || Object.values(payload?.errors || {})[0]?.[0] || "Failed to save item.";
        showPopup(msg, { title: "Save Failed" });
        return;
      }

      closeModal(modalForm);
      resetForm();
      await loadInventory();
      setTimeout(() => {
        showPopup(isEditing ? "Item updated successfully." : "Item added successfully.", { title: "Success ✓" });
      }, 200);
    } catch (err) {
      console.error("Save inventory error:", err);
      showPopup("Cannot connect to server.", { title: "Error" });
    } finally {
      btnSaveForm.disabled = false;
      btnSaveForm.innerHTML = isEditing
        ? '<i class="fa-solid fa-floppy-disk"></i> Update Item'
        : '<i class="fa-solid fa-floppy-disk"></i> Add to Inventory';
    }
  });

  // ─── View Modal ───────────────────────────────────────────────────────────────
  const openViewModal = (item) => {
    viewingItemId = item.id;
    if (invViewTitle) invViewTitle.textContent = item.item_name || "Item Details";
    if (invViewSubtitle) invViewSubtitle.textContent = `${item.category} — ${item.unit}`;

    const statusText = displayStatus(item.status);
    const statusCls = statusClass(statusText);
    const remarksCls = remarksClass(item.remarks);
    const remarksHtml = item.remarks
      ? `<span class="remarks-pill ${remarksCls}">${escHtml(item.remarks)}</span>`
      : '<span style="color:#9ca3af;">—</span>';

    const variants = Array.isArray(item.variants) ? item.variants : [];
    const variantRows = variants.map((variant) => {
      const variantStatus = displayStatus(computeStatus(variant.on_hand));
      const variantStatusHtml = `<span class="status-pill ${statusClass(variantStatus)}">${escHtml(variantStatus)}</span>`;
      const variantRemarksHtml = variant.remarks
        ? `<span class="remarks-pill ${remarksClass(variant.remarks)}">${escHtml(variant.remarks)}</span>`
        : '<span style="color:#9ca3af;">—</span>';
      return `
        <tr>
          <td>${escHtml(variant.name || "—")}</td>
          <td>${escHtml(variant.description || "—")}</td>
          <td>${escHtml(variant.unit || "—")}</td>
          <td>${variant.on_hand ?? 0}</td>
          <td>${variantStatusHtml}</td>
          <td>${variantRemarksHtml}</td>
        </tr>
      `;
    }).join("");

    const variantsHtml = variants.length
      ? `
        <div class="inv-view-variants">
          <div class="inv-view-section-title">Variants</div>
          <table class="inv-variant-table">
            <thead>
              <tr>
                <th>Variant Name</th>
                <th>Description</th>
                <th>Unit</th>
                <th>Stocks</th>
                <th>Status</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>${variantRows}</tbody>
          </table>
        </div>
      `
      : `
        <div class="inv-view-variants">
          <div class="inv-view-section-title">Variants</div>
          <div class="field-hint">No variants added.</div>
        </div>
      `;

    if (invViewContent) {
      invViewContent.innerHTML = `
        <div class="inv-view-grid">
          <div><div class="inv-view-label">Category</div><div class="inv-view-value">${escHtml(item.category)}</div></div>
          <div><div class="inv-view-label">Unit</div><div class="inv-view-value">${escHtml(item.unit)}</div></div>
          <div><div class="inv-view-label">Stocks On Hand</div><div class="inv-view-value">${item.on_hand}</div></div>
          <div><div class="inv-view-label">Status</div><div><span class="status-pill ${statusCls}">${escHtml(statusText)}</span></div></div>
          <div><div class="inv-view-label">Remarks</div><div>${remarksHtml}</div></div>
          <div class="full"><div class="inv-view-label">Description</div><div class="inv-view-value">${escHtml(item.description || "—")}</div></div>
        </div>
        ${variantsHtml}`;
    }
    openModal(modalView);
  };

  btnCloseView?.addEventListener("click", () => closeModal(modalView));

  btnEditFromView?.addEventListener("click", () => {
    const item = allItems.find((x) => x.id === viewingItemId);
    if (!item) return;
    closeModal(modalView);
    populateFormForEdit(item);
    openModal(modalForm);
  });

  // ─── Delete ───────────────────────────────────────────────────────────────────
  const openDeleteModal = (item) => {
    deletingItemId = item.id;
    if (invDeleteLabel) invDeleteLabel.textContent = item.item_name || "this item";
    openModal(modalDelete);
  };

  btnCancelDelete?.addEventListener("click", () => { closeModal(modalDelete); deletingItemId = null; });

  btnConfirmDelete?.addEventListener("click", async () => {
    if (!deletingItemId) return;
    btnConfirmDelete.disabled = true;
    btnConfirmDelete.textContent = "Deleting…";

    try {
      const res = await fetch(`${API_BASE_URL}/admin/inventory/${deletingItemId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      if (res.status === 401 || res.status === 403) { setUnauthorized(); return; }
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        showPopup(payload?.message || "Failed to delete item.", { title: "Delete Failed" });
        return;
      }
      closeModal(modalDelete);
      deletingItemId = null;
      await loadInventory();
      setTimeout(() => showPopup("Item deleted successfully.", { title: "Success ✓" }), 200);
    } catch (err) {
      console.error("Delete inventory error:", err);
      showPopup("Cannot connect to server.", { title: "Error" });
    } finally {
      btnConfirmDelete.disabled = false;
      btnConfirmDelete.textContent = "Delete Item";
    }
  });

  // Deduct modal actions
  btnCancelDeduct?.addEventListener('click', () => {
    if (modalDeduct) { closeModal(modalDeduct); modalDeduct.removeAttribute('data-inv-id'); }
    activeDeductItem = null;
  });

  // ─── Deduct Mode Toggle (Add / Deduct) ────────────────────────────────
  const setDeductMode = (mode) => {
    deductMode = mode;
    if (mode === "add") {
      if (btnModeAdd) btnModeAdd.classList.add("active");
      if (btnModeDeduct) btnModeDeduct.classList.remove("active");
      if (deductAddFields) deductAddFields.classList.add("active");
      if (deductDeductFields) deductDeductFields.classList.remove("active");
    } else {
      if (btnModeAdd) btnModeAdd.classList.remove("active");
      if (btnModeDeduct) btnModeDeduct.classList.add("active");
      if (deductAddFields) deductAddFields.classList.remove("active");
      if (deductDeductFields) deductDeductFields.classList.add("active");
    }
  };

  btnModeAdd?.addEventListener("click", () => {
    setDeductMode("add");
    if (deductAmountDeduct) deductAmountDeduct.value = "";
  });

  btnModeDeduct?.addEventListener("click", () => {
    setDeductMode("deduct");
    if (deductAmountAdd) deductAmountAdd.value = "";
  });

  deductTarget?.addEventListener("change", () => {
    updateDeductTargetFields();
  });

  btnSaveDeduct?.addEventListener('click', async () => {
    const id = Number(modalDeduct?.getAttribute('data-inv-id')) || 0;
    if (!id) return;
    
    // Get amount based on mode
    let amountInput, amountValue;
    if (deductMode === "add") {
      amountInput = deductAmountAdd;
      amountValue = Number(deductAmountAdd?.value || 0);
    } else {
      amountInput = deductAmountDeduct;
      amountValue = Number(deductAmountDeduct?.value || 0);
      amountValue = -Math.abs(amountValue); // Make it negative for deduct
    }
    
    if (!amountInput || amountInput.value === "") { 
      showPopup(`Please enter a ${deductMode === "add" ? "add" : "deduct"} amount.`, { title: 'Validation Error' }); 
      amountInput?.focus(); 
      return; 
    }
    if (!Number.isFinite(amountValue) || amountValue === 0) { 
      showPopup(`${deductMode === "add" ? "Add" : "Deduct"} amount cannot be zero.`, { title: 'Validation Error' }); 
      amountInput?.focus(); 
      return; 
    }
    
    const nameVal = (deductName?.value || '').trim();
    const purposeVal = (deductPurpose?.value || '').trim();
    const remarksVal = (deductRemarks?.value || '').trim();
    const variants = Array.isArray(activeDeductItem?.variants) ? activeDeductItem.variants : [];
    const hasVariants = Boolean(activeDeductItem?.has_variants ?? variants.length > 0);
    const targetVal = deductTarget?.value || "";
    const variantId = targetVal.startsWith("variant:") ? Number(targetVal.replace("variant:", "")) : null;

    if (hasVariants && !variantId) {
      showPopup("Please choose a variant to adjust stock for this item.", { title: 'Validation Error' });
      deductTarget?.focus();
      return;
    }

    btnSaveDeduct.disabled = true; btnSaveDeduct.textContent = 'Saving…';
    try {
      const requestBody = { adjust_amount: amountValue, name: nameVal, purpose: purposeVal, remarks: remarksVal };
      if (variantId) requestBody.variant_id = variantId;
      const res = await fetch(`${API_BASE_URL}/admin/inventory/${id}/adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Accept: 'application/json' },
        body: JSON.stringify(requestBody),
      });
      if (res.status === 401 || res.status === 403) { setUnauthorized(); return; }
      const responsePayload = await res.json().catch(() => ({}));
      if (!res.ok) { showPopup(responsePayload?.message || 'Failed to update stocks.', { title: 'Error' }); return; }

      const metaPayload = {
        name: nameVal || "--",
        purpose: purposeVal || "--",
        remarks: remarksVal || "--",
      };
      if (variantId) {
        deductMetaByVariantId.set(variantId, metaPayload);
      } else {
        deductMetaByItemId.set(id, metaPayload);
      }

      closeModal(modalDeduct);
      modalDeduct?.removeAttribute('data-inv-id');
      activeDeductItem = null;
      await loadInventory();
      setTimeout(() => showPopup('Stocks updated successfully.', { title: 'Success ✓' }), 200);
    } catch (err) {
      console.error('Deduct error:', err);
      showPopup('Cannot connect to server.', { title: 'Error' });
    } finally {
      btnSaveDeduct.disabled = false; btnSaveDeduct.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save';
    }
  });

  // ─── Event delegation for table clicks ────────────────────────────────────────
  document.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    // Variant toggle button
    const toggleBtn = target.closest("[data-inv-toggle]");
    if (toggleBtn) {
      const id = toggleBtn.getAttribute("data-inv-toggle");
      const table = toggleBtn.closest("table");
      if (!id || !table) return;
      const expanded = toggleBtn.getAttribute("aria-expanded") === "true";
      table.querySelectorAll(`tr[data-variant-parent="${id}"]`).forEach((row) => {
        row.style.display = expanded ? "none" : "table-row";
      });
      toggleBtn.setAttribute("aria-expanded", String(!expanded));
      return;
    }

    // View button
    const viewBtn = target.closest("[data-inv-view]");
    if (viewBtn) {
      const id = Number(viewBtn.getAttribute("data-inv-view"));
      const item = allItems.find((x) => x.id === id);
      if (item) openViewModal(item);
      return;
    }

    // Delete button
    const deleteBtn = target.closest("[data-inv-delete]");
    if (deleteBtn) {
      const id = Number(deleteBtn.getAttribute("data-inv-delete"));
      const item = allItems.find((x) => x.id === id);
      if (item) openDeleteModal(item);
      return;
    }

    // Deduct button
    const deductBtn = target.closest("[data-inv-deduct]");
    if (deductBtn) {
      const id = Number(deductBtn.getAttribute("data-inv-deduct"));
      const item = allItems.find((x) => x.id === id);
      if (item) {
        // populate deduct modal
        activeDeductItem = item;
        if (deductCategory) deductCategory.value = item.category;
        const variants = Array.isArray(item.variants) ? item.variants : [];
        const hasVariants = Boolean(item.has_variants ?? variants.length > 0);
        if (deductTargetWrap && deductTarget) {
          if (hasVariants) {
            deductTargetWrap.style.display = "";
            deductTarget.innerHTML = [
              ...variants.map((variant) => `<option value="variant:${variant.id}">${escHtml(variant.name || "Variant")}</option>`),
            ].join("");
            deductTarget.value = variants.length ? `variant:${variants[0].id}` : "";
          } else {
            deductTargetWrap.style.display = "none";
            deductTarget.innerHTML = "";
            deductTarget.value = "";
          }
        }
        updateDeductTargetFields();
        if (deductAmountAdd) deductAmountAdd.value = "";
        if (deductAmountDeduct) deductAmountDeduct.value = "";
        if (deductAmount) deductAmount.value = "";
        if (deductName) deductName.value = "";
        if (deductPurpose) deductPurpose.value = "";
        if (deductRemarks) deductRemarks.value = "";
        // Reset deduct mode to "add"
        setDeductMode("add");
        // store viewing id in modal dataset
        modalDeduct?.setAttribute('data-inv-id', String(item.id));
        openModal(modalDeduct);
      }
      return;
    }

    // Per-item Excel download button
    const dlBtn = target.closest("[data-inv-download]");
    if (dlBtn) {
      const id = Number(dlBtn.getAttribute("data-inv-download"));
      const item = allItems.find((x) => x.id === id);
      if (item) {
        void exportItemsToXlsx({
          items: [item],
          filenameBase: `${item.item_name}_inventory_form_${todayPH().replace(/\//g, '-')}`,
          txFilter: { item_id: item.id },
        }).catch((err) => {
          console.error("Per-item export error:", err);
          showPopup("Failed to export this item.", { title: "Export Error" });
        });
      }
      return;
    }

    // Category-level Excel export button
    const catExportBtn = target.closest("[data-cat-export]");
    if (catExportBtn) {
      const category = catExportBtn.getAttribute("data-cat-export") || "";
      if (!category) return;
      const categoryItems = allItems.filter((item) => item.category === category);
      void exportItemsToXlsx({
        items: categoryItems,
        filenameBase: `inventory_${category}_${todayPH().replace(/\//g, '-')}`,
        txFilter: { category },
      }).catch((err) => {
        console.error("Category export error:", err);
        showPopup("Failed to export this category.", { title: "Export Error" });
      });
      return;
    }

    // Category pagination prev
    const prevBtn = target.closest("[data-cat-prev]");
    if (prevBtn) {
      const cat = prevBtn.getAttribute("data-cat-prev");
      if (categoryPages[cat] > 1) {
        categoryPages[cat] -= 1;
        renderCategoryTable(cat);
      }
      return;
    }

    // Category pagination next
    const nextBtn = target.closest("[data-cat-next]");
    if (nextBtn) {
      const cat = nextBtn.getAttribute("data-cat-next");
      const items = getFilteredItemsByCategory(cat);
      const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
      if ((categoryPages[cat] || 1) < totalPages) {
        categoryPages[cat] = (categoryPages[cat] || 1) + 1;
        renderCategoryTable(cat);
      }
      return;
    }
  });

  // ─── Filters ──────────────────────────────────────────────────────────────────
  searchInput?.addEventListener("input", () => {
    CATEGORIES.forEach((cat) => { categoryPages[cat] = 1; });
    renderAllTables();
  });

  categoryFilter?.addEventListener("change", () => {
    CATEGORIES.forEach((cat) => { categoryPages[cat] = 1; });
    renderAllTables();
  });

  // ─── Auth check + initial load ────────────────────────────────────────────────
  if (!token) {
    showPopup("Please login first to access inventory management.", {
      title: "Session Required",
      onOk: () => { window.location.href = "../admin-auth/auth.html"; },
    });
    return;
  }

  void loadInventory();
});
