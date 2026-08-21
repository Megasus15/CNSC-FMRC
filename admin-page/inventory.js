document.addEventListener("DOMContentLoaded", () => {
  // ─── API helpers ──────────────────────────────────────────────────────────────
  const API_BASE_URL = (() => {
    const proto = window.location.protocol;
    const host = window.location.hostname;
    const port = window.location.port;
    if (port === "8000") return `${proto}//${host}:${port}/api`;
    if (host === "localhost" || host === "127.0.0.1")
      return `${proto}//${host}:8000/api`;
    return `${proto}//${host}/api`;
  })();

  const token =
    (window.AdminSession && window.AdminSession.getToken()) ||
    localStorage.getItem("auth_token") ||
    "";
  const showPopup = (msg, opts = {}) => window.showAdminPopup?.(msg, opts);
  const escHtml = (str) =>
    String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const setUnauthorized = () => {
    showPopup("Session expired or unauthorized. Please login again.", {
      title: "Access Required",
      onOk: () => {
        window.location.href = "../admin-auth/auth.html";
      },
    });
  };

  // ─── Categories ───────────────────────────────────────────────────────────────
  const CATEGORIES = [
    "Consumable Materials",
    "Office Supplies",
    "Inventory Tools",
    "Electronics and Electrical Equipments",
  ];

  const UNIT_OPTIONS = [
    "pcs",
    "set",
    "ream",
    "box",
    "roll",
    "pack",
    "unit",
    "bottle",
    "pair",
  ];

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

  // Stock level rules modal
  const btnOpenStockRules = document.getElementById("btnOpenStockRules");
  const modalStockRules = document.getElementById("modalStockRules");
  const stockRuleGlobalMode = document.getElementById("stockRuleGlobalMode");
  const stockRuleGlobalThreshold = document.getElementById(
    "stockRuleGlobalThreshold",
  );
  const stockRuleGlobalFormula = document.getElementById(
    "stockRuleGlobalFormula",
  );
  const stockRuleCategoryList = document.getElementById(
    "stockRuleCategoryList",
  );
  const stockRuleItemList = document.getElementById("stockRuleItemList");
  const stockRuleCategoryFilter = document.getElementById(
    "stockRuleCategoryFilter",
  );
  const stockRuleSearch = document.getElementById("stockRuleSearch");
  const btnCancelStockRules = document.getElementById("btnCancelStockRules");
  const btnSaveStockRules = document.getElementById("btnSaveStockRules");

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
  let viewingItemId = null;
  let inventoryFormBaseline = null;
  const selectedInventoryIdsByCategory = new Map(
    CATEGORIES.map((category) => [category, new Set()]),
  );
  const categoriesInSelectionMode = new Set();
  const deductMetaByItemId = new Map();
  const deductMetaByVariantId = new Map();
  let activeDeductItem = null;
  let deductMode = "add"; // "add" or "deduct"
  const PAGE_SIZE = window.AdminTablePagination?.PAGE_SIZE || 10;
  const categoryPages = {};
  const inlineVariantPages = new Map();
  let viewVariantPage = 1;

  const openModal = (m) => m?.classList.add("show");
  const closeModal = (m) => m?.classList.remove("show");

  const getFormValue = (element) => String(element?.value ?? "");

  const getInventoryFormSnapshot = () => ({
    category: getFormValue(formCategory),
    itemName: getFormValue(formItemName).trim(),
    description: getFormValue(formDescription).trim(),
    unit: getFormValue(formUnit),
    onHand: getFormValue(formOnHand).trim(),
    remarks: getFormValue(formRemarks).trim(),
    variants: Array.from(
      variantList?.querySelectorAll(".inv-variant-card") || [],
    ).map((row) => ({
      name: getFormValue(row.querySelector("[data-variant-name]")).trim(),
      description: getFormValue(
        row.querySelector("[data-variant-description]"),
      ).trim(),
      unit: getFormValue(row.querySelector("[data-variant-unit]")),
      onHand: getFormValue(row.querySelector("[data-variant-on-hand]")).trim(),
      remarks: getFormValue(row.querySelector("[data-variant-remarks]")).trim(),
    })).filter(
      (variant) =>
        Boolean(
          variant.name ||
            variant.description ||
            variant.onHand ||
            variant.remarks ||
            variant.unit !== "pcs",
        ),
    ),
  });

  const captureInventoryFormBaseline = () => {
    inventoryFormBaseline = getInventoryFormSnapshot();
  };

  const isInventoryFormDirty = () => {
    if (!inventoryFormBaseline) return false;
    return (
      JSON.stringify(getInventoryFormSnapshot()) !==
      JSON.stringify(inventoryFormBaseline)
    );
  };

  const capitalizeFirstLetter = (value) =>
    String(value ?? "").replace(
      /^(\s*)(\p{L})/u,
      (_, leadingWhitespace, firstLetter) =>
        `${leadingWhitespace}${firstLetter.toLocaleUpperCase()}`,
    );

  modalForm?.addEventListener("input", (event) => {
    const target = event.target;
    if (
      !(target instanceof HTMLInputElement) &&
      !(target instanceof HTMLTextAreaElement)
    ) {
      return;
    }
    if (target instanceof HTMLInputElement && target.type !== "text") return;

    const currentValue = target.value;
    const nextValue = capitalizeFirstLetter(currentValue);
    if (nextValue === currentValue) return;

    const selectionStart = target.selectionStart;
    const selectionEnd = target.selectionEnd;
    const lengthDelta = nextValue.length - currentValue.length;
    target.value = nextValue;
    if (selectionStart !== null && selectionEnd !== null) {
      target.setSelectionRange(
        selectionStart + lengthDelta,
        selectionEnd + lengthDelta,
      );
    }
  });

  // ─── Status helpers ───────────────────────────────────────────────────────────
  const statusClass = (status) => {
    if (status === "Good") return "status-green";
    if (status === "Low Stock" || status === "Out of Stock")
      return "status-yellow";
    return "status-blue";
  };

  const displayStatus = (status) => status;

  // ─── Stock level rules (admin-configurable Low / Good thresholds) ─────────────
  const STOCK_RULE_MODES = ["fixed", "percent"];
  const DEFAULT_STOCK_RULE = { mode: "fixed", threshold: 5 };

  // Working copy while the modal is open, plus the copy applied to the tables.
  let stockRules = {
    global: { ...DEFAULT_STOCK_RULE },
    categories: {},
    items: {},
    variants: {},
  };
  let stockRuleDraft = null;
  let stockRuleItemsIndex = [];

  const normalizeRule = (rule) => {
    if (!rule || typeof rule !== "object") return null;
    const mode = STOCK_RULE_MODES.includes(String(rule.mode))
      ? String(rule.mode)
      : "fixed";
    if (
      rule.threshold === null ||
      rule.threshold === undefined ||
      rule.threshold === ""
    ) {
      return null;
    }
    let threshold = Number.parseInt(String(rule.threshold), 10);
    if (!Number.isFinite(threshold) || threshold < 0) threshold = 0;
    if (mode === "percent" && threshold > 100) threshold = 100;
    return { mode, threshold };
  };

  const normalizeRuleMap = (map) => {
    const clean = {};
    Object.entries(map || {}).forEach(([key, value]) => {
      const rule = normalizeRule(value);
      if (rule) clean[String(key)] = rule;
    });
    return clean;
  };

  const cloneStockRules = (source) => ({
    global: normalizeRule(source?.global) || { ...DEFAULT_STOCK_RULE },
    categories: normalizeRuleMap(source?.categories),
    items: normalizeRuleMap(source?.items),
    variants: normalizeRuleMap(source?.variants),
  });

  // variant → item → category → global
  const resolveStockRule = ({ category, itemId, variantId } = {}, source) => {
    const rules = source || stockRules;
    const variantKey = itemId && variantId ? `${itemId}:${variantId}` : "";
    if (variantKey && rules.variants[variantKey]) {
      return { ...rules.variants[variantKey], scope: "variant" };
    }
    if (itemId && rules.items[String(itemId)]) {
      return { ...rules.items[String(itemId)], scope: "item" };
    }
    if (category && rules.categories[category]) {
      return { ...rules.categories[category], scope: "category" };
    }
    return { ...rules.global, scope: "global" };
  };

  const resolveLowThreshold = (rule, baseline) => {
    const threshold = Number(rule?.threshold ?? 0) || 0;
    if (rule?.mode === "percent") {
      const base = Math.max(0, Number(baseline) || 0);
      return Math.floor((base * threshold) / 100);
    }
    return Math.max(0, threshold);
  };

  const describeRule = (rule, baseline) => {
    if (rule?.mode === "percent") {
      const base = Number(baseline) || 0;
      // Category rows have no single baseline, so only show the resolved
      // quantity when an actual starting stock is known.
      return base > 0
        ? `Low Stock when on hand ≤ ${rule.threshold}% of starting stock (≤ ${resolveLowThreshold(rule, base)})`
        : `Low Stock when on hand ≤ ${rule.threshold}% of each item's starting stock`;
    }
    return `Low Stock when stocks on hand ≤ ${resolveLowThreshold(rule, baseline)}`;
  };

  const remarksClass = (r) => {
    if (!r) return "remarks-default";
    if (r.includes("Acquired")) return "remarks-acquired";
    if (r.includes("Included")) return "remarks-included";
    if (r.includes("Restock")) return "remarks-restock";
    return "remarks-default";
  };

  // Status resolver honouring the admin-managed rules. `context` carries the
  // category/item/variant so the correct override is applied.
  const computeStatus = (onHand, context = {}) => {
    const n = Number(onHand || 0);
    if (n <= 0) return "Out of Stock";

    const rule = resolveStockRule(context);
    const baseline = Number(context.baseline ?? n) || n;
    return n <= resolveLowThreshold(rule, baseline) ? "Low Stock" : "Good";
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
    const unitOptions = UNIT_OPTIONS.map(
      (unit) => `<option value="${escHtml(unit)}">${escHtml(unit)}</option>`,
    ).join("");

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
    variants.forEach((variant) =>
      variantList.appendChild(createVariantCard(variant, opts)),
    );
    refreshVariantIndices();
    refreshVariantEmptyState();
  };

  const collectVariantsFromForm = () => {
    if (!variantList) return [];
    const rows = Array.from(variantList.querySelectorAll(".inv-variant-card"));
    const variants = [];

    for (const row of rows) {
      const nameVal = (
        row.querySelector("[data-variant-name]")?.value || ""
      ).trim();
      const descVal = (
        row.querySelector("[data-variant-description]")?.value || ""
      ).trim();
      const unitVal = row.querySelector("[data-variant-unit]")?.value || "pcs";
      const onHandInput = row.querySelector("[data-variant-on-hand]");
      const onHandRaw = onHandInput?.value ?? "";
      const remarksVal = (
        row.querySelector("[data-variant-remarks]")?.value || ""
      ).trim();

      const isEmpty = !nameVal && !descVal && !onHandRaw && !remarksVal;
      if (isEmpty) continue;

      if (!nameVal) {
        showPopup("Variant name is required.", { title: "Validation Error" });
        row.querySelector("[data-variant-name]")?.focus();
        return null;
      }

      if (onHandRaw === "") {
        showPopup("Variant stocks on hand is required.", {
          title: "Validation Error",
        });
        onHandInput?.focus();
        return null;
      }

      const onHandNum = Number(onHandRaw);
      if (Number.isNaN(onHandNum) || onHandNum < 0) {
        showPopup("Variant stocks on hand must be 0 or higher.", {
          title: "Validation Error",
        });
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
    const variants = Array.isArray(activeDeductItem.variants)
      ? activeDeductItem.variants
      : [];
    const hasVariants = Boolean(
      activeDeductItem.has_variants ?? variants.length > 0,
    );
    const targetVal = deductTarget?.value || "";
    let displayName = activeDeductItem.item_name;
    let onHandVal = activeDeductItem.on_hand;

    if (hasVariants) {
      const variantId = Number(targetVal.replace("variant:", ""));
      const variant =
        variants.find((v) => Number(v.id) === variantId) || variants[0];
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
        const haystack =
          `${item.item_name} ${item.description || ""}`.toLowerCase();
        const variants = Array.isArray(item.variants) ? item.variants : [];
        const variantHit = variants.some((variant) => {
          const variantText =
            `${variant.name || ""} ${variant.description || ""}`.toLowerCase();
          return variantText.includes(q);
        });
        if (!haystack.includes(q) && !variantHit) return false;
      }
      return true;
    });
  };

  // ─── Summary metrics ──────────────────────────────────────────────────────────
  const updateMetrics = (summary) => {
    if (metricTotal)
      metricTotal.textContent = String(summary?.total_items ?? 0);
    if (metricGood) metricGood.textContent = String(summary?.good ?? 0);
    if (metricLow) metricLow.textContent = String(summary?.low_stock ?? 0);
  };

  const getCategoryPageState = (category) => {
    const items = getFilteredItemsByCategory(category);
    const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    const requestedPage = Number(categoryPages[category] || 1);
    const page = Number.isFinite(requestedPage)
      ? Math.min(Math.max(requestedPage, 1), totalPages)
      : 1;
    const start = (page - 1) * PAGE_SIZE;

    categoryPages[category] = page;

    return {
      items,
      totalPages,
      page,
      start,
      paged: items.slice(start, start + PAGE_SIZE),
    };
  };

  const getCategoryCardId = (category) =>
    `inv-cat-${category.replace(/\s+/g, "-").toLowerCase()}`;

  const getCategorySelection = (category) => {
    if (!selectedInventoryIdsByCategory.has(category)) {
      selectedInventoryIdsByCategory.set(category, new Set());
    }
    return selectedInventoryIdsByCategory.get(category);
  };

  const syncSelectedInventoryIds = () => {
    CATEGORIES.forEach((category) => {
      const availableIds = new Set(
        allItems
          .filter((item) => item.category === category)
          .map((item) => Number(item.id)),
      );
      const selectedIds = getCategorySelection(category);
      selectedIds.forEach((id) => {
        if (!availableIds.has(Number(id))) selectedIds.delete(id);
      });
    });
  };

  const updateSelectionUi = (onlyCategory = "") => {
    const categories = onlyCategory ? [onlyCategory] : CATEGORIES;

    categories.forEach((category) => {
      const card = document.getElementById(getCategoryCardId(category));
      if (!card) return;

      const isSelectionMode = categoriesInSelectionMode.has(category);
      const selectedIds = getCategorySelection(category);
      const selectedCount = selectedIds.size;
      const allTableIds = getFilteredItemsByCategory(category).map((item) =>
        Number(item.id),
      );
      const allTableItemsSelected =
        allTableIds.length > 0 &&
        allTableIds.every((id) => selectedIds.has(id));

      card.classList.toggle("is-selection-mode", isSelectionMode);
      card
        .querySelector(".inventory-table")
        ?.classList.toggle("is-selecting", isSelectionMode);

      card.querySelectorAll("[data-inv-select]").forEach((input) => {
        const id = Number(input.getAttribute("data-inv-select"));
        input.checked = selectedIds.has(id);
        input.disabled = !isSelectionMode;
      });

      const selectAllInput = card.querySelector("[data-inv-select-all]");
      const visibleIds = getCategoryPageState(category).paged.map((item) =>
        Number(item.id),
      );
      const selectedVisibleCount = visibleIds.filter((id) =>
        selectedIds.has(id),
      ).length;

      if (selectAllInput) {
        selectAllInput.checked =
          visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
        selectAllInput.indeterminate =
          selectedVisibleCount > 0 && selectedVisibleCount < visibleIds.length;
        selectAllInput.disabled = !isSelectionMode || visibleIds.length === 0;
      }

      const countLabel = card.querySelector("[data-inv-selection-count]");
      if (countLabel) {
        countLabel.textContent = `${selectedCount} selected`;
      }

      const selectAllPagesButton = card.querySelector(
        "[data-inv-select-all-pages]",
      );
      if (selectAllPagesButton) {
        const totalPages = Math.max(
          1,
          Math.ceil(allTableIds.length / PAGE_SIZE),
        );
        const label = allTableItemsSelected
          ? `Clear all ${category} selections`
          : `Select all ${allTableIds.length} ${category} item${allTableIds.length === 1 ? "" : "s"} across ${totalPages} page${totalPages === 1 ? "" : "s"}`;
        selectAllPagesButton.disabled = allTableIds.length === 0;
        selectAllPagesButton.classList.toggle(
          "is-active",
          allTableItemsSelected,
        );
        selectAllPagesButton.setAttribute(
          "aria-pressed",
          String(allTableItemsSelected),
        );
        selectAllPagesButton.setAttribute("aria-label", label);
        selectAllPagesButton.setAttribute("title", label);
      }

      const archiveButton = card.querySelector(
        "[data-inv-archive-selected]",
      );
      if (archiveButton) {
        archiveButton.disabled = selectedCount === 0;
        const label = selectedCount
          ? `Archive ${selectedCount} selected ${category} item${selectedCount === 1 ? "" : "s"}`
          : `Select ${category} items to archive`;
        archiveButton.setAttribute("aria-label", label);
        archiveButton.setAttribute("title", label);
      }
    });
  };

  const goToCategoryPage = (category, rawPage) => {
    const { totalPages } = getCategoryPageState(category);
    const raw = String(rawPage ?? "").trim();
    const parsed = /^\d+$/.test(raw) ? Number(raw) : categoryPages[category] || 1;
    categoryPages[category] = Math.min(Math.max(parsed, 1), totalPages);
    renderCategoryTable(category);
  };

  const goToInlineVariantPage = (itemId, rawPage) => {
    const id = Number(itemId);
    const item = allItems.find((entry) => Number(entry.id) === id);
    if (!item) return;

    const variants = Array.isArray(item.variants) ? item.variants : [];
    const totalPages = Math.max(1, Math.ceil(variants.length / PAGE_SIZE));
    const fallbackPage = inlineVariantPages.get(id) || 1;
    const raw = String(rawPage ?? "").trim();
    const requestedPage = /^\d+$/.test(raw) ? Number(raw) : fallbackPage;
    inlineVariantPages.set(
      id,
      Math.min(Math.max(requestedPage, 1), totalPages),
    );

    renderCategoryTable(item.category);
    const card = document.getElementById(getCategoryCardId(item.category));
    const toggle = card?.querySelector(`[data-inv-toggle="${id}"]`);
    toggle?.setAttribute("aria-expanded", "true");
    card
      ?.querySelectorAll(`tr[data-variant-parent="${id}"]`)
      .forEach((row) => {
        row.style.display = "table-row";
      });
  };

  // ─── Render one category table ────────────────────────────────────────────────
  const renderCategoryTable = (category) => {
    const containerId = getCategoryCardId(category);
    let card = document.getElementById(containerId);
    const items = getFilteredItemsByCategory(category);
    const filterCat = categoryFilter?.value || "all";
    const isSelectionMode = categoriesInSelectionMode.has(category);
    const selectedIds = getCategorySelection(category);

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
    card.dataset.inventoryCategory = category;
    card.classList.toggle("is-selection-mode", isSelectionMode);

    const icon = CATEGORY_ICONS[category] || "fa-box";
    const { totalPages, page: validPage, start, paged } =
      getCategoryPageState(category);

    let tableRows = "";
    if (!paged.length) {
      tableRows = `<tr class="table-empty-row"><td colspan="${isSelectionMode ? 9 : 8}"><div class="table-empty-state"><i class="fa-regular fa-folder-open"></i><span>No items found in this category.</span></div></td></tr>`;
    } else {
      const rows = [];
      paged.forEach((item, idx) => {
        const rowNum = start + idx + 1;
        const variants = Array.isArray(item.variants) ? item.variants : [];
        const hasVariants = Boolean(item.has_variants ?? variants.length > 0);
        const variantTotalPages = Math.max(
          1,
          Math.ceil(variants.length / PAGE_SIZE),
        );
        const variantPage = Math.min(
          Math.max(Number(inlineVariantPages.get(Number(item.id)) || 1), 1),
          variantTotalPages,
        );
        const variantStart = (variantPage - 1) * PAGE_SIZE;
        const pagedVariants = variants.slice(
          variantStart,
          variantStart + PAGE_SIZE,
        );
        inlineVariantPages.set(Number(item.id), variantPage);
        const statusText = displayStatus(item.status);
        const statusHtml = `<span class="status-pill ${statusClass(statusText)}">${escHtml(statusText)}</span>`;
        const remarksHtml = item.remarks
          ? `<span class="remarks-pill ${remarksClass(item.remarks)}">${escHtml(item.remarks)}</span>`
          : `<span style="color:#9ca3af;font-size:0.75rem;">—</span>`;
        const baseDescriptionHtml = hasVariants
          ? ""
          : escHtml(item.description || "—");
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
          <tr${hasVariants ? ' class="inv-has-variants"' : ""}>
            <td class="inv-select-cell"><input type="checkbox" data-inv-select="${item.id}" data-inv-category="${escHtml(category)}" aria-label="Select ${escHtml(item.item_name)}" ${selectedIds.has(Number(item.id)) ? "checked" : ""}></td>
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
              <button type="button" data-tooltip="Archive Item" data-inv-archive="${item.id}"><i class="fa-solid fa-box-archive"></i></button>
            </td>
          </tr>
        `);

        if (hasVariants) {
          pagedVariants.forEach((variant) => {
            const variantStatus = displayStatus(
              computeStatus(variant.on_hand, {
                category: item.category,
                itemId: item.id,
                variantId: variant.id,
                baseline: variant.initial_on_hand ?? variant.on_hand,
              }),
            );
            const variantStatusHtml = `<span class="status-pill ${statusClass(variantStatus)}">${escHtml(variantStatus)}</span>`;
            const variantRemarksHtml = variant.remarks
              ? `<span class="remarks-pill ${remarksClass(variant.remarks)}">${escHtml(variant.remarks)}</span>`
              : `<span style="color:#9ca3af;font-size:0.75rem;">—</span>`;
            rows.push(`
              <tr class="inv-variant-row" data-variant-parent="${item.id}" style="display:none;">
                <td aria-hidden="true"></td>
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
          if (variants.length > PAGE_SIZE) {
            const variantFrom = variantStart + 1;
            const variantTo = Math.min(
              variantStart + PAGE_SIZE,
              variants.length,
            );
            rows.push(`
              <tr class="inv-variant-row inv-variant-pagination-row" data-variant-parent="${item.id}" style="display:none;">
                <td aria-hidden="true"></td>
                <td colspan="8">
                  <div class="table-footer" style="padding:6px 0;background:transparent;border:0;">
                    <div class="table-footer-meta">Showing ${variantFrom}&ndash;${variantTo} of ${variants.length} variants</div>
                    <div class="table-pagination" aria-label="${escHtml(item.item_name)} variant pages">
                      <button type="button" class="page-btn" data-inv-variant-prev="${item.id}" ${variantPage <= 1 ? "disabled" : ""} aria-label="Previous variant page"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button>
                      <input class="page-number" data-inv-variant-page="${item.id}" type="number" min="1" max="${variantTotalPages}" value="${variantPage}" inputmode="numeric" aria-label="Go to variant page for ${escHtml(item.item_name)}">
                      <button type="button" class="page-btn" data-inv-variant-next="${item.id}" ${variantPage >= variantTotalPages ? "disabled" : ""} aria-label="Next variant page"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
                    </div>
                  </div>
                </td>
              </tr>
            `);
          }
        }
      });
      tableRows = rows.join("");
    }

    const from = items.length ? start + 1 : 0;
    const to = items.length ? Math.min(items.length, start + PAGE_SIZE) : 0;
    const selectedCount = selectedIds.size;
    const selectionControls = isSelectionMode
      ? `
          <span class="inv-selection-count" data-inv-selection-count>${selectedCount} selected</span>
          <button type="button" class="btn-admin btn-secondary icon-only-btn inv-select-all-pages" data-inv-select-all-pages="${escHtml(category)}" aria-label="Select every ${escHtml(category)} item across all pages" aria-pressed="false" title="Select all items across every page">
            <i class="fa-solid fa-check-double" aria-hidden="true"></i>
          </button>
          <button type="button" class="btn-admin btn-secondary icon-only-btn inv-selection-cancel" data-inv-selection-cancel="${escHtml(category)}" aria-label="Cancel archive selection for ${escHtml(category)}" title="Cancel selection">
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
          <button type="button" class="btn-admin icon-only-btn inv-archive-selected" data-inv-archive-selected="${escHtml(category)}" aria-label="Archive selected ${escHtml(category)} items" title="Archive selected items" ${selectedCount ? "" : "disabled"}>
            <i class="fa-solid fa-box-archive" aria-hidden="true"></i>
          </button>`
      : `
          <button type="button" class="btn-admin icon-only-btn inv-selection-toggle" data-inv-selection-toggle="${escHtml(category)}" aria-label="Select ${escHtml(category)} items to archive" title="Archive selected items">
            <i class="fa-solid fa-box-archive" aria-hidden="true"></i>
          </button>`;

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
            <table class="admin-table inventory-table inv-table${isSelectionMode ? " is-selecting" : ""}">
            <thead>
              <tr>
                <th class="inv-select-cell"><input type="checkbox" data-inv-select-all="${escHtml(category)}" aria-label="Select visible ${escHtml(category)} items"></th>
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
          <div class="inv-cat-footer-meta">Page ${validPage} of ${totalPages} &bull; Showing ${from}&ndash;${to} of ${items.length}</div>
          <div class="inv-cat-footer-actions">
            <div class="inv-selection-tools">
              ${selectionControls}
            </div>
            <div class="table-pagination">
            <button class="page-btn" data-cat-prev="${category}" ${validPage <= 1 ? "disabled" : ""}><i class="fa-solid fa-chevron-left"></i></button>
            <input class="page-number inv-page-number" data-cat-page="${escHtml(category)}" type="number" min="1" max="${totalPages}" value="${validPage}" inputmode="numeric" aria-label="Go to page for ${escHtml(category)}">
            <button class="page-btn" data-cat-next="${category}" ${validPage >= totalPages ? "disabled" : ""}><i class="fa-solid fa-chevron-right"></i></button>
            </div>
          </div>
        </div>
      </div>
    `;

    window.AdminPageNumberInput?.upgrade(card);
    updateSelectionUi(category);
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
      const containerId = getCategoryCardId(category);
      const icon = CATEGORY_ICONS[category] || "fa-box";
      const skeletonRows = Array.from({ length: SKELETON_ROWS_PER_TABLE })
        .map(
          () => `
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
      `,
        )
        .join("");

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
              <div class="inv-cat-footer-meta"><div class="inv-skeleton-cell" style="width:130px;height:10px;display:inline-block;"></div></div>
              <div class="inv-cat-footer-actions">
                <div class="inv-selection-tools">
                  <button class="btn-admin icon-only-btn inv-selection-toggle" type="button" disabled aria-label="Loading archive selection">
                    <i class="fa-solid fa-box-archive" aria-hidden="true"></i>
                  </button>
                </div>
                <div class="table-pagination">
                <button class="page-btn" disabled><i class="fa-solid fa-chevron-left"></i></button>
                <input class="page-number inv-page-number" type="number" value="1" disabled aria-label="Current page">
                <button class="page-btn" disabled><i class="fa-solid fa-chevron-right"></i></button>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join("");
  };

  // ─── Load inventory from API ──────────────────────────────────────────────────
  const loadStockRules = async ({ silent = true } = {}) => {
    try {
      const res = await fetch(`${API_BASE_URL}/admin/inventory/stock-rules`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });
      if (res.status === 401 || res.status === 403) {
        setUnauthorized();
        return false;
      }
      if (!res.ok) throw new Error("Failed to load stock level rules.");
      const payload = await res.json();
      const data = payload?.data || {};
      stockRules = cloneStockRules(data);
      stockRuleItemsIndex = Array.isArray(data.items_index)
        ? data.items_index
        : [];
      return true;
    } catch (err) {
      console.error("Load stock rules error:", err);
      if (!silent) {
        showPopup(
          "Could not load the stock level rules. Please try again once the server is reachable.",
          { title: "Stock Rules" },
        );
      }
      return false;
    }
  };

  const loadInventory = async () => {
    renderSkeletonTables();
    try {
      const res = await fetch(`${API_BASE_URL}/admin/inventory`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });
      if (res.status === 401 || res.status === 403) {
        setUnauthorized();
        return;
      }
      if (!res.ok) throw new Error("Failed to load inventory");
      const payload = await res.json();
      allItems = Array.isArray(payload?.data) ? payload.data : [];
      syncSelectedInventoryIds();
      // Keep the rules in sync so table pills match the backend statuses.
      await loadStockRules({ silent: true });
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

  const sanitizeFilename = (name) =>
    String(name || "inventory")
      .replace(/[^a-z0-9\-_]+/gi, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "inventory";

  const fetchTransactions = async (params = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    });
    const endpoint = `${API_BASE_URL}/admin/inventory/transactions${qs.toString() ? `?${qs.toString()}` : ""}`;
    const res = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (res.status === 401 || res.status === 403) {
      setUnauthorized();
      return [];
    }
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
      const matchItem = itemsWithVariants.find(
        (it) => it.id === tx.inventory_item_id,
      );
      let itemNumber = null;
      let variantSymbol = null;
      if (matchItem) {
        itemNumber = matchItem.itemNumber;
        if (tx.variant_id) {
          const variantIdx = matchItem.variants.findIndex(
            (v) => v.id === tx.variant_id,
          );
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

  const createHorizontalWorkbook = ({
    stockInRows,
    stockOutRows,
    balanceRows,
    sheetName = "Inventory",
    isPerItem = false,
  }) => {
    if (!window.XLSX) {
      showPopup("Excel library failed to load. Please refresh this page.", {
        title: "Export Error",
      });
      return null;
    }

    // Prepare column structure
    const maxRows =
      Math.max(stockInRows.length, stockOutRows.length, balanceRows.length, 1) +
      5;
    const aoa = Array.from({ length: maxRows }, () => Array(24).fill(""));

    // Column indices for each section
    const cols = {
      stockIn: { start: 0, no: 0, date: 1, name: 2, desc: 3, stock: 4 },
      stockOut: {
        start: 6,
        no: 6,
        date: 7,
        name: 8,
        desc: 9,
        stock: 10,
        by: 11,
        purpose: 12,
        remarks: 13,
      },
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
    const maxDataRows = Math.max(
      stockInRows.length,
      stockOutRows.length,
      balanceRows.length,
    );
    for (let i = 0; i < maxDataRows; i++) {
      const rowIdx = dataStartRow + i;

      // Stock In data
      if (i < stockInRows.length) {
        const row = stockInRows[i];
        const no = row.variantSymbol
          ? row.variantSymbol
          : String(row.itemNumber || "");
        aoa[rowIdx][cols.stockIn.no] = no;
        aoa[rowIdx][cols.stockIn.date] = row.date;
        aoa[rowIdx][cols.stockIn.name] = row.variantSymbol
          ? `  ${row.item_name}`
          : row.item_name;
        aoa[rowIdx][cols.stockIn.desc] = row.description;
        aoa[rowIdx][cols.stockIn.stock] = row.stock;
      }

      // Stock Out data
      if (i < stockOutRows.length) {
        const row = stockOutRows[i];
        const no = row.variantSymbol
          ? row.variantSymbol
          : String(row.itemNumber || "");
        aoa[rowIdx][cols.stockOut.no] = no;
        aoa[rowIdx][cols.stockOut.date] = row.date;
        aoa[rowIdx][cols.stockOut.name] = row.variantSymbol
          ? `  ${row.item_name}`
          : row.item_name;
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
        const no = row.variantSymbol
          ? row.variantSymbol
          : String(row.itemNumber || "");
        aoa[rowIdx][cols.balance.no] = no;
        aoa[rowIdx][cols.balance.date] = row.date;
        aoa[rowIdx][cols.balance.name] = row.variantSymbol
          ? `  ${row.item_name}`
          : row.item_name;
        aoa[rowIdx][cols.balance.desc] = row.description;
        aoa[rowIdx][cols.balance.stock] = row.stock;
      }
    }

    // Create sheet
    const ws = window.XLSX.utils.aoa_to_sheet(aoa);

    // Set column widths
    ws["!cols"] = [
      { wch: 5 }, // Stock In: No.
      { wch: 12 }, // Date
      { wch: 24 }, // Item Name
      { wch: 22 }, // Description
      { wch: 10 }, // Stock
      { wch: 2 }, // Gap
      { wch: 5 }, // Stock Out: No.
      { wch: 12 }, // Date
      { wch: 24 }, // Item Name
      { wch: 22 }, // Description
      { wch: 10 }, // Stock
      isPerItem ? { wch: 18 } : { wch: 2 }, // By / Gap
      isPerItem ? { wch: 20 } : { wch: 2 }, // Purpose / Gap
      isPerItem ? { wch: 20 } : { wch: 2 }, // Remarks / Gap
      { wch: 5 }, // Balance: No.
      { wch: 12 }, // Date
      { wch: 24 }, // Item Name
      { wch: 22 }, // Description
      { wch: 10 }, // Stock
    ];

    // Set up merges for table name headers
    ws["!merges"] = [
      { s: { r: titleRow, c: 0 }, e: { r: titleRow, c: 4 } },
      {
        s: { r: headerRow, c: cols.stockIn.start },
        e: { r: headerRow, c: cols.stockIn.stock },
      },
      {
        s: { r: headerRow, c: cols.stockOut.start },
        e: {
          r: headerRow,
          c: isPerItem ? cols.stockOut.remarks : cols.stockOut.stock,
        },
      },
      {
        s: { r: headerRow, c: cols.balance.start },
        e: { r: headerRow, c: cols.balance.stock },
      },
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
          (cellVal === "STOCK IN" ||
            cellVal === "STOCK OUT" ||
            cellVal === "BALANCE STOCK")
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
          style.alignment = {
            horizontal: typeof cellVal === "number" ? "right" : "left",
            vertical: "center",
            wrapText: true,
          };
          if (typeof cellVal === "number") {
            style.numFmt = "0";
          }
        }

        ws[cellRef].s = style;
      }
    }

    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(
      wb,
      ws,
      sheetName.slice(0, 31) || "Inventory",
    );
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
    const wb = createHorizontalWorkbook({
      ...rows,
      sheetName: "Inventory",
      isPerItem,
    });
    downloadWorkbook(wb, filenameBase);
  };

  btnExportExcelAll?.addEventListener("click", async () => {
    try {
      await exportItemsToXlsx({
        items: allItems,
        filenameBase: `inventory_all_${todayPH().replace(/\//g, "-")}`,
      });
    } catch (err) {
      console.error("Export all error:", err);
      showPopup("Failed to export all inventory items.", {
        title: "Export Error",
      });
    }
  });

  // ─── Form helpers ─────────────────────────────────────────────────────────────
  const resetForm = () => {
    inventoryFormBaseline = null;
    editingItemId = null;
    if (invModalTitle)
      invModalTitle.innerHTML =
        '<i class="fa-solid fa-plus" style="margin-right:6px;"></i>Add New Item';
    if (btnSaveForm)
      btnSaveForm.innerHTML =
        '<i class="fa-solid fa-floppy-disk"></i> Add to Inventory';
    // Restore last-used category from localStorage; default to "Consumable Materials"
    if (formCategory) {
      const lastCat = localStorage.getItem("fmrc_inv_last_category");
      formCategory.value = lastCat || "Consumable Materials";
    }
    if (formItemName) formItemName.value = "";
    if (formDescription) formDescription.value = "";
    if (formUnit) formUnit.value = "pcs";
    if (formOnHand) {
      formOnHand.value = "";
      formOnHand.removeAttribute("readonly");
      formOnHand.removeAttribute("disabled");
    }
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

  const closeInventoryForm = ({ discardChanges = false } = {}) => {
    const baseline = inventoryFormBaseline;
    if (editingItemId === null && formCategory) {
      const categoryToPersist =
        discardChanges && baseline ? baseline.category : formCategory.value;
      localStorage.setItem("fmrc_inv_last_category", categoryToPersist);
    }
    closeModal(modalForm);
    resetForm();
  };

  const populateFormForEdit = (item) => {
    editingItemId = item.id;
    if (invModalTitle)
      invModalTitle.innerHTML =
        '<i class="fa-regular fa-pen-to-square" style="margin-right:6px;"></i>Edit Item';
    if (btnSaveForm)
      btnSaveForm.innerHTML =
        '<i class="fa-solid fa-floppy-disk"></i> Update Item';
    if (formCategory) formCategory.value = item.category;
    if (formItemName) formItemName.value = item.item_name || "";
    if (formDescription) formDescription.value = item.description || "";
    if (formUnit) formUnit.value = item.unit || "pcs";
    // On edit: Category, Item Name, Description, Unit are editable only.
    if (formOnHand) {
      formOnHand.value = item.on_hand ?? "";
      formOnHand.setAttribute("readonly", "true");
      formOnHand.setAttribute("disabled", "disabled");
    }
    if (formRemarks) formRemarks.value = item.remarks || "";

    const hasVariants =
      Array.isArray(item.variants) && item.variants.length > 0;
    setVariantFormRows(hasVariants ? item.variants : [], {
      disableOnHand: true,
    });

    if (hasVariants) {
      if (modalForm) modalForm.classList.add("variant-mode");
    } else {
      if (modalForm) modalForm.classList.remove("variant-mode");
    }
  };

  // ─── Open Add Modal ───────────────────────────────────────────────────────────
  btnOpenAdd?.addEventListener("click", () => {
    resetForm();
    captureInventoryFormBaseline();
    openModal(modalForm);
  });

  // Save category to localStorage whenever it changes in the Add New Item modal
  formCategory?.addEventListener("change", () => {
    if (editingItemId === null) {
      // Only persist when in "Add" mode, not Edit mode
      localStorage.setItem("fmrc_inv_last_category", formCategory.value);
    }
  });

  btnCancelForm?.addEventListener("click", () => {
    if (!isInventoryFormDirty()) {
      closeInventoryForm();
      return;
    }

    const discardChanges = () => closeInventoryForm({ discardChanges: true });

    if (typeof window.showAdminConfirmPopup === "function") {
      window.showAdminConfirmPopup(
        "Any information entered in this item will be lost.",
        {
          title: "Discard changes?",
          confirmText: "Discard",
          cancelText: "Keep Editing",
          onConfirm: discardChanges,
        },
      );
      return;
    }

    if (window.confirm("Discard changes?")) {
      discardChanges();
    }
  });

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
      const hasVariants = Boolean(
        variantList.querySelector(".inv-variant-card"),
      );
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

    if (!itemName) {
      showPopup("Item Name is required.", { title: "Validation Error" });
      formItemName?.focus();
      return;
    }

    // Unit and Stocks On Hand are only required if there are no variants
    const hasVariants = variants.length > 0;
    if (!hasVariants) {
      if (formOnHand?.value === "" || formOnHand?.value === null) {
        showPopup("Stocks On Hand is required when no variants are added.", {
          title: "Validation Error",
        });
        formOnHand?.focus();
        return;
      }
      if (!unit || unit === "") {
        showPopup("Unit is required when no variants are added.", {
          title: "Validation Error",
        });
        formUnit?.focus();
        return;
      }
    }

    const body = {
      category,
      item_name: itemName,
      description,
      unit,
      on_hand: onHand,
      remarks,
      variants,
    };

    btnSaveForm.disabled = true;
    btnSaveForm.textContent = isEditing ? "Updating…" : "Saving…";

    try {
      const url = isEditing
        ? `${API_BASE_URL}/admin/inventory/${editingItemId}`
        : `${API_BASE_URL}/admin/inventory`;
      const method = isEditing ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
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
          "Failed to save item.";
        showPopup(msg, { title: "Save Failed" });
        return;
      }

      closeModal(modalForm);
      resetForm();
      if (!isEditing) {
        CATEGORIES.forEach((categoryName) => {
          categoryPages[categoryName] = 1;
        });
      }
      await loadInventory();
      setTimeout(() => {
        showPopup(
          isEditing ? "Item updated successfully." : "Item added successfully.",
          { title: "Success ✓" },
        );
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
  const openViewModal = (item, { resetVariantPage = true } = {}) => {
    viewingItemId = item.id;
    if (resetVariantPage) viewVariantPage = 1;
    if (invViewTitle)
      invViewTitle.textContent = item.item_name || "Item Details";
    if (invViewSubtitle)
      invViewSubtitle.textContent = `${item.category} — ${item.unit}`;

    const statusText = displayStatus(item.status);
    const statusCls = statusClass(statusText);
    const remarksCls = remarksClass(item.remarks);
    const remarksHtml = item.remarks
      ? `<span class="remarks-pill ${remarksCls}">${escHtml(item.remarks)}</span>`
      : '<span style="color:#9ca3af;">—</span>';

    const variants = Array.isArray(item.variants) ? item.variants : [];
    const variantTotalPages = Math.max(
      1,
      Math.ceil(variants.length / PAGE_SIZE),
    );
    viewVariantPage = Math.min(
      Math.max(Number(viewVariantPage || 1), 1),
      variantTotalPages,
    );
    const variantStart = (viewVariantPage - 1) * PAGE_SIZE;
    const pagedVariants = variants.slice(
      variantStart,
      variantStart + PAGE_SIZE,
    );
    const variantRows = pagedVariants
      .map((variant) => {
        const variantStatus = displayStatus(
          computeStatus(variant.on_hand, {
            category: item.category,
            itemId: item.id,
            variantId: variant.id,
            baseline: variant.initial_on_hand ?? variant.on_hand,
          }),
        );
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
      })
      .join("");

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
          ${
            variants.length > PAGE_SIZE
              ? `<div class="table-footer" style="padding:10px 0 0;background:transparent;border:0;">
                   <div class="table-footer-meta">Showing ${variantStart + 1}&ndash;${Math.min(variantStart + PAGE_SIZE, variants.length)} of ${variants.length} variants</div>
                   <div class="table-pagination" aria-label="Inventory variant pages">
                     <button type="button" class="page-btn" data-inv-view-variant-prev ${viewVariantPage <= 1 ? "disabled" : ""} aria-label="Previous variant page"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button>
                     <input class="page-number" data-inv-view-variant-page type="number" min="1" max="${variantTotalPages}" value="${viewVariantPage}" inputmode="numeric" aria-label="Go to inventory variant page">
                     <button type="button" class="page-btn" data-inv-view-variant-next ${viewVariantPage >= variantTotalPages ? "disabled" : ""} aria-label="Next variant page"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
                   </div>
                 </div>`
              : ""
          }
        </div>
      `
      : `
        <div class="inv-view-variants">
          <div class="inv-view-section-title">Variants</div>
          <div class="field-hint">No variants added.</div>
        </div>
      `;

    const hasVariants = variants.length > 0;
    if (invViewSubtitle) {
      invViewSubtitle.textContent = hasVariants
        ? `${variants.length} variant${variants.length !== 1 ? "s" : ""}`
        : `${item.category} — ${item.unit}`;
    }

    if (invViewContent) {
      invViewContent.innerHTML = `
        ${
          hasVariants
            ? `<div class="field-hint" style="margin-bottom:12px;">This item has ${variants.length} variant${variants.length !== 1 ? "s" : ""}. See individual variant stock details below.</div>`
            : `
          <div class="inv-view-grid">
            <div><div class="inv-view-label">Category</div><div class="inv-view-value">${escHtml(item.category)}</div></div>
            <div><div class="inv-view-label">Unit</div><div class="inv-view-value">${escHtml(item.unit)}</div></div>
            <div><div class="inv-view-label">Stocks On Hand</div><div class="inv-view-value">${item.on_hand}</div></div>
            <div><div class="inv-view-label">Status</div><div><span class="status-pill ${statusCls}">${escHtml(statusText)}</span></div></div>
            <div><div class="inv-view-label">Remarks</div><div>${remarksHtml}</div></div>
            <div class="full"><div class="inv-view-label">Description</div><div class="inv-view-value">${escHtml(item.description || "—")}</div></div>
          </div>`
        }
        ${variantsHtml}`;
      window.AdminPageNumberInput?.upgrade(invViewContent);
    }
    openModal(modalView);
  };

  btnCloseView?.addEventListener("click", () => closeModal(modalView));

  const goToViewVariantPage = (rawPage) => {
    const item = allItems.find(
      (entry) => Number(entry.id) === Number(viewingItemId),
    );
    if (!item) return;
    const variants = Array.isArray(item.variants) ? item.variants : [];
    const totalPages = Math.max(1, Math.ceil(variants.length / PAGE_SIZE));
    const raw = String(rawPage ?? "").trim();
    const requestedPage = /^\d+$/.test(raw) ? Number(raw) : viewVariantPage;
    viewVariantPage = Math.min(Math.max(requestedPage, 1), totalPages);
    openViewModal(item, { resetVariantPage: false });
  };

  invViewContent?.addEventListener("click", (event) => {
    if (event.target.closest("[data-inv-view-variant-prev]")) {
      goToViewVariantPage(viewVariantPage - 1);
      return;
    }
    if (event.target.closest("[data-inv-view-variant-next]")) {
      goToViewVariantPage(viewVariantPage + 1);
    }
  });

  invViewContent?.addEventListener("change", (event) => {
    const input = event.target.closest("[data-inv-view-variant-page]");
    if (input) goToViewVariantPage(input.value);
  });

  invViewContent?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const input = event.target.closest("[data-inv-view-variant-page]");
    if (!input) return;
    event.preventDefault();
    goToViewVariantPage(input.value);
  });

  btnEditFromView?.addEventListener("click", () => {
    const item = allItems.find((x) => x.id === viewingItemId);
    if (!item) return;
    closeModal(modalView);
    populateFormForEdit(item);
    captureInventoryFormBaseline();
    openModal(modalForm);
  });

  // ─── Archive ──────────────────────────────────────────────────────────────────
  const requestBulkArchive = async (category, ids) => {
    const res = await fetch(`${API_BASE_URL}/admin/inventory/archive-bulk`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      body: JSON.stringify({ category, ids }),
    });

    const payload = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) {
      const authError = new Error(
        "Session expired or unauthorized. Please login again.",
      );
      authError.isAuthError = true;
      setUnauthorized();
      throw authError;
    }
    if (!res.ok) {
      throw new Error(payload?.message || "Failed to archive inventory items.");
    }

    const archivedIds = Array.isArray(payload?.archived_ids)
      ? payload.archived_ids.map((id) => Number(id))
      : ids;

    return {
      count: Number(payload?.archived_count) || archivedIds.length,
      archivedIds,
      skipped: Array.isArray(payload?.skipped_ids) ? payload.skipped_ids : [],
    };
  };

  const openArchiveConfirmation = (category, ids, options = {}) => {
    if (!CATEGORIES.includes(category)) return;

    const uniqueIds = [
      ...new Set(
        ids
          .map((id) => Number(id))
          .filter((id) => {
            const item = allItems.find(
              (candidate) => Number(candidate.id) === id,
            );
            return Boolean(item && item.category === category);
          }),
      ),
    ];
    if (!uniqueIds.length) return;

    const targetItems = uniqueIds
      .map((id) => allItems.find((item) => Number(item.id) === id))
      .filter(Boolean);
    const count = targetItems.length;
    const targetLabel =
      count === 1
        ? `“${targetItems[0]?.item_name || "this item"}”`
        : `${count} selected items`;
    const message = `Are you sure you want to archive ${targetLabel} from Inventory of ${category}? Only the selected item${count === 1 ? "" : "s"} in this table will be moved to Archives.`;

    const showArchiveSuccess = (result) => {
      const skippedCount = result.skipped.length;
      const skippedText = skippedCount
        ? ` ${skippedCount} item${skippedCount === 1 ? " was" : "s were"} skipped because ${skippedCount === 1 ? "it was" : "they were"} no longer active in this table.`
        : "";
      showPopup(
        `${result.count} ${category} item${result.count === 1 ? " has" : "s have"} been archived successfully.${skippedText}`,
        { title: "Inventory Archived" },
      );
    };

    const executeArchive = async () => {
      const result = await requestBulkArchive(category, uniqueIds);
      const selectedIds = getCategorySelection(category);
      result.archivedIds.forEach((id) => selectedIds.delete(id));
      if (options.exitSelectionMode) {
        selectedIds.clear();
        categoriesInSelectionMode.delete(category);
      }
      await loadInventory();
      return result;
    };

    if (typeof window.showAdminConfirmPopup === "function") {
      window.showAdminConfirmPopup(message, {
        title: count === 1 ? "Archive Item" : "Archive Selected Items",
        confirmText: "Archive",
        cancelText: "Cancel",
        keepOpenWhilePending: true,
        loadingText: "Archiving...",
        onConfirm: executeArchive,
        onSuccess: showArchiveSuccess,
        onError: (error) => {
          if (!error?.isAuthError) {
            showPopup(error?.message || "Failed to archive inventory items.", {
              title: "Archive Failed",
            });
          }
        },
      });
      return;
    }

    if (window.confirm(message)) {
      void executeArchive()
        .then(showArchiveSuccess)
        .catch((error) => {
          showPopup(error?.message || "Failed to archive inventory items.", {
            title: "Archive Failed",
          });
        });
    }
  };

  // Deduct modal actions
  btnCancelDeduct?.addEventListener("click", () => {
    if (modalDeduct) {
      closeModal(modalDeduct);
      modalDeduct.removeAttribute("data-inv-id");
    }
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

  btnSaveDeduct?.addEventListener("click", async () => {
    const id = Number(modalDeduct?.getAttribute("data-inv-id")) || 0;
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
      showPopup(
        `Please enter a ${deductMode === "add" ? "add" : "deduct"} amount.`,
        { title: "Validation Error" },
      );
      amountInput?.focus();
      return;
    }
    if (!Number.isFinite(amountValue) || amountValue === 0) {
      showPopup(
        `${deductMode === "add" ? "Add" : "Deduct"} amount cannot be zero.`,
        { title: "Validation Error" },
      );
      amountInput?.focus();
      return;
    }

    const nameVal = (deductName?.value || "").trim();
    const purposeVal = (deductPurpose?.value || "").trim();
    const remarksVal = (deductRemarks?.value || "").trim();
    const variants = Array.isArray(activeDeductItem?.variants)
      ? activeDeductItem.variants
      : [];
    const hasVariants = Boolean(
      activeDeductItem?.has_variants ?? variants.length > 0,
    );
    const targetVal = deductTarget?.value || "";
    const variantId = targetVal.startsWith("variant:")
      ? Number(targetVal.replace("variant:", ""))
      : null;

    if (hasVariants && !variantId) {
      showPopup("Please choose a variant to adjust stock for this item.", {
        title: "Validation Error",
      });
      deductTarget?.focus();
      return;
    }

    btnSaveDeduct.disabled = true;
    btnSaveDeduct.textContent = "Saving…";
    try {
      const requestBody = {
        adjust_amount: amountValue,
        name: nameVal,
        purpose: purposeVal,
        remarks: remarksVal,
      };
      if (variantId) requestBody.variant_id = variantId;
      const res = await fetch(`${API_BASE_URL}/admin/inventory/${id}/adjust`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        body: JSON.stringify(requestBody),
      });
      if (res.status === 401 || res.status === 403) {
        setUnauthorized();
        return;
      }
      const responsePayload = await res.json().catch(() => ({}));
      if (!res.ok) {
        showPopup(responsePayload?.message || "Failed to update stocks.", {
          title: "Error",
        });
        return;
      }

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
      modalDeduct?.removeAttribute("data-inv-id");
      activeDeductItem = null;
      await loadInventory();
      setTimeout(
        () => showPopup("Stocks updated successfully.", { title: "Success ✓" }),
        200,
      );
    } catch (err) {
      console.error("Deduct error:", err);
      showPopup("Cannot connect to server.", { title: "Error" });
    } finally {
      btnSaveDeduct.disabled = false;
      btnSaveDeduct.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save';
    }
  });

  // ─── Event delegation for table clicks ────────────────────────────────────────
  document.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    const selectInput = target.closest("[data-inv-select]");
    if (selectInput) {
      const id = Number(selectInput.getAttribute("data-inv-select"));
      const category = selectInput.getAttribute("data-inv-category") || "";
      if (id && categoriesInSelectionMode.has(category)) {
        const selectedIds = getCategorySelection(category);
        if (selectInput.checked) selectedIds.add(id);
        else selectedIds.delete(id);
        updateSelectionUi(category);
      }
      return;
    }

    const selectAllInput = target.closest("[data-inv-select-all]");
    if (selectAllInput) {
      const category = selectAllInput.getAttribute("data-inv-select-all") || "";
      if (!categoriesInSelectionMode.has(category)) return;
      const selectedIds = getCategorySelection(category);
      const visibleIds = getCategoryPageState(category).paged.map((item) =>
        Number(item.id),
      );
      visibleIds.forEach((id) => {
        if (selectAllInput.checked) selectedIds.add(id);
        else selectedIds.delete(id);
      });
      updateSelectionUi(category);
      return;
    }

    const selectionToggle = target.closest("[data-inv-selection-toggle]");
    if (selectionToggle) {
      const category =
        selectionToggle.getAttribute("data-inv-selection-toggle") || "";
      if (!CATEGORIES.includes(category)) return;
      getCategorySelection(category).clear();
      categoriesInSelectionMode.add(category);
      renderCategoryTable(category);
      return;
    }

    const selectionCancel = target.closest("[data-inv-selection-cancel]");
    if (selectionCancel) {
      const category =
        selectionCancel.getAttribute("data-inv-selection-cancel") || "";
      getCategorySelection(category).clear();
      categoriesInSelectionMode.delete(category);
      renderCategoryTable(category);
      return;
    }

    const selectAllPagesButton = target.closest(
      "[data-inv-select-all-pages]",
    );
    if (selectAllPagesButton) {
      const category =
        selectAllPagesButton.getAttribute("data-inv-select-all-pages") || "";
      if (!categoriesInSelectionMode.has(category)) return;

      const selectedIds = getCategorySelection(category);
      const allTableIds = getFilteredItemsByCategory(category).map((item) =>
        Number(item.id),
      );
      const allTableItemsSelected =
        allTableIds.length > 0 &&
        allTableIds.every((id) => selectedIds.has(id));

      allTableIds.forEach((id) => {
        if (allTableItemsSelected) selectedIds.delete(id);
        else selectedIds.add(id);
      });
      updateSelectionUi(category);
      return;
    }

    const archiveSelectedBtn = target.closest("[data-inv-archive-selected]");
    if (archiveSelectedBtn) {
      const category =
        archiveSelectedBtn.getAttribute("data-inv-archive-selected") || "";
      openArchiveConfirmation(category, [...getCategorySelection(category)], {
        exitSelectionMode: true,
      });
      return;
    }

    const variantPrevBtn = target.closest("[data-inv-variant-prev]");
    if (variantPrevBtn) {
      const id = Number(variantPrevBtn.getAttribute("data-inv-variant-prev"));
      goToInlineVariantPage(id, (inlineVariantPages.get(id) || 1) - 1);
      return;
    }

    const variantNextBtn = target.closest("[data-inv-variant-next]");
    if (variantNextBtn) {
      const id = Number(variantNextBtn.getAttribute("data-inv-variant-next"));
      goToInlineVariantPage(id, (inlineVariantPages.get(id) || 1) + 1);
      return;
    }

    // Variant toggle button
    const toggleBtn = target.closest("[data-inv-toggle]");
    if (toggleBtn) {
      const id = toggleBtn.getAttribute("data-inv-toggle");
      const table = toggleBtn.closest("table");
      if (!id || !table) return;
      const expanded = toggleBtn.getAttribute("aria-expanded") === "true";
      table
        .querySelectorAll(`tr[data-variant-parent="${id}"]`)
        .forEach((row) => {
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

    // Archive button
    const archiveBtn = target.closest("[data-inv-archive]");
    if (archiveBtn) {
      const id = Number(archiveBtn.getAttribute("data-inv-archive"));
      const item = allItems.find((x) => x.id === id);
      if (item) openArchiveConfirmation(item.category, [item.id]);
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
              ...variants.map(
                (variant) =>
                  `<option value="variant:${variant.id}">${escHtml(variant.name || "Variant")}</option>`,
              ),
            ].join("");
            deductTarget.value = variants.length
              ? `variant:${variants[0].id}`
              : "";
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
        modalDeduct?.setAttribute("data-inv-id", String(item.id));
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
          filenameBase: `${item.item_name}_inventory_form_${todayPH().replace(/\//g, "-")}`,
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
      const categoryItems = allItems.filter(
        (item) => item.category === category,
      );
      void exportItemsToXlsx({
        items: categoryItems,
        filenameBase: `inventory_${category}_${todayPH().replace(/\//g, "-")}`,
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

  document.addEventListener("change", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement)) return;
    const variantItemId = target.getAttribute("data-inv-variant-page");
    if (variantItemId) {
      goToInlineVariantPage(variantItemId, target.value);
      return;
    }
    const category = target.getAttribute("data-cat-page");
    if (!category) return;
    goToCategoryPage(category, target.value);
  });

  document.addEventListener("keydown", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement)) return;
    const variantItemId = target.getAttribute("data-inv-variant-page");
    if (variantItemId && e.key === "Enter") {
      e.preventDefault();
      goToInlineVariantPage(variantItemId, target.value);
      return;
    }
    const category = target.getAttribute("data-cat-page");
    if (!category || e.key !== "Enter") return;
    e.preventDefault();
    goToCategoryPage(category, target.value);
  });

  // ─── Filters ──────────────────────────────────────────────────────────────────
  searchInput?.addEventListener("input", () => {
    CATEGORIES.forEach((cat) => {
      categoryPages[cat] = 1;
      const filteredIds = new Set(
        getFilteredItemsByCategory(cat).map((item) => Number(item.id)),
      );
      getCategorySelection(cat).forEach((id) => {
        if (!filteredIds.has(Number(id))) getCategorySelection(cat).delete(id);
      });
    });
    renderAllTables();
  });

  categoryFilter?.addEventListener("change", () => {
    CATEGORIES.forEach((cat) => {
      categoryPages[cat] = 1;
      const filteredIds = new Set(
        getFilteredItemsByCategory(cat).map((item) => Number(item.id)),
      );
      getCategorySelection(cat).forEach((id) => {
        if (!filteredIds.has(Number(id))) getCategorySelection(cat).delete(id);
      });
    });
    renderAllTables();
  });

  // ─── Stock Level Rules modal ──────────────────────────────────────────────────
  const ruleModeOptions = (selected) =>
    [
      { value: "fixed", label: "Fixed qty" },
      { value: "percent", label: "% of start" },
    ]
      .map(
        (opt) =>
          `<option value="${opt.value}"${opt.value === selected ? " selected" : ""}>${opt.label}</option>`,
      )
      .join("");

  // Placeholder text for a threshold field that is currently inheriting.
  // Percent rules resolve to 0 when the row has no single baseline (category
  // rows), so show the percentage itself instead of a misleading "0".
  const inheritPlaceholder = (rule, baseline) => {
    const base = Number(baseline) || 0;
    if (rule?.mode === "percent" && base <= 0) {
      return `Inherit (${rule.threshold}%)`;
    }
    return `Inherit (${resolveLowThreshold(rule, base)})`;
  };

  const renderStockRuleRow = ({
    scopeType,
    scopeKey,
    name,
    metaHtml,
    override,
    inheritedRule,
    baseline,
    isVariant = false,
  }) => {
    const effective = override || inheritedRule;
    const rowClasses = [
      "stock-rule-row",
      isVariant ? "is-variant" : "",
      override ? "is-overridden" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return `
      <div class="${rowClasses}" data-rule-scope="${scopeType}" data-rule-key="${escHtml(scopeKey)}" data-rule-baseline="${Number(baseline) || 0}">
        <div class="stock-rule-row-label">
          <div class="stock-rule-row-name">${escHtml(name)}</div>
          <div class="stock-rule-row-meta">
            ${metaHtml}
            <span class="stock-rule-chip ${override ? "stock-rule-chip--custom" : "stock-rule-chip--inherited"}">
              ${override ? "Custom rule" : `Inherits ${escHtml(inheritedRule.scope)}`}
            </span>
            <span data-rule-formula>${escHtml(describeRule(effective, baseline))}</span>
          </div>
        </div>
        <select class="filter-select" data-rule-mode>${ruleModeOptions(effective.mode)}</select>
        <div
          class="stock-rule-threshold${override ? " has-value" : ""}"
          data-rule-threshold-wrap
        >
          <input
            class="input-field"
            type="number"
            min="0"
            data-rule-threshold
            placeholder="${escHtml(inheritPlaceholder(inheritedRule, baseline))}"
            value="${override ? override.threshold : ""}"
          />
          <button
            type="button"
            class="stock-rule-clear"
            data-rule-clear
            title="Reset to inherited rule"
            aria-label="Reset ${escHtml(name)} to inherited rule"
            ${override ? "" : "disabled"}
          >
            <i class="fa-solid fa-rotate-left" aria-hidden="true"></i>
          </button>
        </div>
      </div>
    `;
  };

  const renderStockRuleGlobalFormula = () => {
    if (!stockRuleGlobalFormula || !stockRuleDraft) return;
    const label =
      stockRuleDraft.global.mode === "percent"
        ? `Low Stock when stocks on hand ≤ ${stockRuleDraft.global.threshold}% of the item's starting stock`
        : `Low Stock when stocks on hand ≤ ${stockRuleDraft.global.threshold}`;
    stockRuleGlobalFormula.innerHTML = `<i class="fa-solid fa-function"></i><span>${escHtml(label)}</span>`;
  };

  const renderStockRuleGlobal = () => {
    if (!stockRuleDraft) return;
    if (stockRuleGlobalMode)
      stockRuleGlobalMode.value = stockRuleDraft.global.mode;
    if (stockRuleGlobalThreshold)
      stockRuleGlobalThreshold.value = String(stockRuleDraft.global.threshold);
    renderStockRuleGlobalFormula();
  };

  const renderStockRuleCategories = () => {
    if (!stockRuleCategoryList || !stockRuleDraft) return;
    stockRuleCategoryList.innerHTML = CATEGORIES.map((category) => {
      const override = stockRuleDraft.categories[category] || null;
      const inherited = { ...stockRuleDraft.global, scope: "default" };
      const categoryItems = stockRuleItemsIndex.filter(
        (entry) => entry.category === category,
      );
      const icon = CATEGORY_ICONS[category] || "fa-box";

      return renderStockRuleRow({
        scopeType: "category",
        scopeKey: category,
        name: category,
        metaHtml: `<span class="stock-rule-chip"><i class="fa-solid ${icon}"></i> ${categoryItems.length} item${categoryItems.length === 1 ? "" : "s"}</span>`,
        override,
        inheritedRule: inherited,
        baseline: 0,
      });
    }).join("");
  };

  const renderStockRuleItems = () => {
    if (!stockRuleItemList || !stockRuleDraft) return;

    const query = (stockRuleSearch?.value || "").trim().toLowerCase();
    const filterCat = stockRuleCategoryFilter?.value || "all";
    const rows = [];

    stockRuleItemsIndex.forEach((entry) => {
      if (filterCat !== "all" && entry.category !== filterCat) return;

      const variants = Array.isArray(entry.variants) ? entry.variants : [];
      const itemMatches = query
        ? String(entry.item_name || "").toLowerCase().includes(query)
        : true;
      const matchingVariants = query
        ? variants.filter((variant) =>
            String(variant.name || "").toLowerCase().includes(query),
          )
        : variants;

      if (!itemMatches && !matchingVariants.length) return;

      const itemOverride = stockRuleDraft.items[String(entry.id)] || null;
      const categoryRule = stockRuleDraft.categories[entry.category]
        ? { ...stockRuleDraft.categories[entry.category], scope: "category" }
        : { ...stockRuleDraft.global, scope: "default" };

      rows.push(
        renderStockRuleRow({
          scopeType: "item",
          scopeKey: String(entry.id),
          name: entry.item_name || "Untitled item",
          metaHtml: `<span class="stock-rule-chip">${escHtml(entry.category)}</span><span>On hand: ${Number(entry.on_hand) || 0} ${escHtml(entry.unit || "")}</span>`,
          override: itemOverride,
          inheritedRule: categoryRule,
          baseline: entry.baseline ?? entry.on_hand ?? 0,
        }),
      );

      const variantsToRender = itemMatches ? variants : matchingVariants;
      variantsToRender.forEach((variant) => {
        const variantKey = `${entry.id}:${variant.id}`;
        const variantOverride = stockRuleDraft.variants[variantKey] || null;
        const inherited = itemOverride
          ? { ...itemOverride, scope: "item" }
          : categoryRule;

        rows.push(
          renderStockRuleRow({
            scopeType: "variant",
            scopeKey: variantKey,
            name: variant.name || "Variant",
            metaHtml: `<span class="stock-rule-chip">Variant</span><span>On hand: ${Number(variant.on_hand) || 0} ${escHtml(variant.unit || "")}</span>`,
            override: variantOverride,
            inheritedRule: inherited,
            baseline: variant.baseline ?? variant.on_hand ?? 0,
            isVariant: true,
          }),
        );
      });
    });

    stockRuleItemList.innerHTML = rows.length
      ? rows.join("")
      : `<div class="stock-rule-empty">No inventory items match this filter.</div>`;
  };

  const renderStockRuleModal = () => {
    renderStockRuleGlobal();
    renderStockRuleCategories();
    renderStockRuleItems();
  };

  const setStockRuleDraftValue = (scopeType, scopeKey, rule) => {
    if (!stockRuleDraft) return;
    const bucket =
      scopeType === "category"
        ? stockRuleDraft.categories
        : scopeType === "item"
          ? stockRuleDraft.items
          : scopeType === "variant"
            ? stockRuleDraft.variants
            : null;
    if (!bucket) return;

    if (rule === null) {
      delete bucket[scopeKey];
      return;
    }
    bucket[scopeKey] = rule;
  };

  const readStockRuleRow = (row) => {
    const scopeType = row.getAttribute("data-rule-scope") || "";
    const scopeKey = row.getAttribute("data-rule-key") || "";
    const modeSelect = row.querySelector("[data-rule-mode]");
    const thresholdInput = row.querySelector("[data-rule-threshold]");
    const raw = String(thresholdInput?.value ?? "").trim();

    if (raw === "") {
      return { scopeType, scopeKey, rule: null };
    }

    return {
      scopeType,
      scopeKey,
      rule: normalizeRule({
        mode: modeSelect?.value || "fixed",
        threshold: raw,
      }),
    };
  };

  // Snapshot of the draft right after the modal opens. Used to decide whether a
  // background refresh may safely re-render (it must never overwrite edits).
  let stockRuleOpenSnapshot = "";

  const isStockRuleModalOpen = () =>
    Boolean(modalStockRules?.classList.contains("show"));

  // Refresh the rules from the server after the modal is already visible. The
  // modal is only re-rendered when the admin/staff has not started editing.
  const refreshStockRulesInBackground = async () => {
    // Only surface an error popup when there was nothing cached to show.
    const hasCachedData = stockRuleItemsIndex.length > 0;
    const ok = await loadStockRules({ silent: hasCachedData });
    if (!ok || !isStockRuleModalOpen() || !stockRuleDraft) return;

    const draftUntouched =
      JSON.stringify(stockRuleDraft) === stockRuleOpenSnapshot;
    // Never re-render while a field inside the modal has focus — that would
    // wipe out whatever the admin/staff is currently typing.
    const isEditing = Boolean(
      document.activeElement &&
        document.activeElement !== document.body &&
        modalStockRules.contains(document.activeElement),
    );
    if (!draftUntouched || isEditing) return;

    stockRuleDraft = cloneStockRules(stockRules);
    stockRuleOpenSnapshot = JSON.stringify(stockRuleDraft);
    renderStockRuleModal();
  };

  // Opens instantly (same feel as "Add New Item") by rendering the rules that
  // were already cached on page load, then syncing with the server in the
  // background instead of blocking the modal behind a fetch.
  const openStockRulesModal = () => {
    if (!modalStockRules) return;

    stockRuleDraft = cloneStockRules(stockRules);
    stockRuleOpenSnapshot = JSON.stringify(stockRuleDraft);
    if (stockRuleSearch) stockRuleSearch.value = "";
    if (stockRuleCategoryFilter) stockRuleCategoryFilter.value = "all";
    renderStockRuleModal();
    openModal(modalStockRules);

    void refreshStockRulesInBackground();
  };

  btnOpenStockRules?.addEventListener("click", () => {
    openStockRulesModal();
  });

  btnCancelStockRules?.addEventListener("click", () => {
    stockRuleDraft = null;
    closeModal(modalStockRules);
  });

  stockRuleGlobalMode?.addEventListener("change", () => {
    if (!stockRuleDraft) return;
    const mode = STOCK_RULE_MODES.includes(stockRuleGlobalMode.value)
      ? stockRuleGlobalMode.value
      : "fixed";
    stockRuleDraft.global = normalizeRule({
      mode,
      threshold: stockRuleGlobalThreshold?.value || 0,
    }) || { ...DEFAULT_STOCK_RULE };
    renderStockRuleModal();
  });

  stockRuleGlobalThreshold?.addEventListener("input", () => {
    if (!stockRuleDraft) return;
    stockRuleDraft.global = normalizeRule({
      mode: stockRuleGlobalMode?.value || "fixed",
      threshold: stockRuleGlobalThreshold.value,
    }) || { ...DEFAULT_STOCK_RULE };
    // Don't re-write the input's value while typing — only refresh derived UI.
    renderStockRuleGlobalFormula();
    renderStockRuleCategories();
    renderStockRuleItems();
  });

  stockRuleCategoryFilter?.addEventListener("change", renderStockRuleItems);
  stockRuleSearch?.addEventListener("input", renderStockRuleItems);

  // Live-update a single row in place so typing never loses focus.
  const refreshStockRuleRowChrome = (row) => {
    if (!stockRuleDraft) return;

    const scopeType = row.getAttribute("data-rule-scope") || "";
    const scopeKey = row.getAttribute("data-rule-key") || "";
    const baseline = Number(row.getAttribute("data-rule-baseline")) || 0;
    const bucket =
      scopeType === "category"
        ? stockRuleDraft.categories
        : scopeType === "item"
          ? stockRuleDraft.items
          : stockRuleDraft.variants;
    const override = bucket?.[scopeKey] || null;

    let inherited = { ...stockRuleDraft.global, scope: "default" };
    if (scopeType === "item" || scopeType === "variant") {
      const itemId = scopeKey.split(":")[0];
      const entry = stockRuleItemsIndex.find(
        (candidate) => String(candidate.id) === itemId,
      );
      if (entry && stockRuleDraft.categories[entry.category]) {
        inherited = {
          ...stockRuleDraft.categories[entry.category],
          scope: "category",
        };
      }
      if (scopeType === "variant" && stockRuleDraft.items[itemId]) {
        inherited = { ...stockRuleDraft.items[itemId], scope: "item" };
      }
    }

    const effective = override || inherited;
    row.classList.toggle("is-overridden", Boolean(override));

    const chip = row.querySelector(".stock-rule-chip--custom, .stock-rule-chip--inherited");
    if (chip) {
      chip.classList.toggle("stock-rule-chip--custom", Boolean(override));
      chip.classList.toggle("stock-rule-chip--inherited", !override);
      chip.textContent = override
        ? "Custom rule"
        : `Inherits ${inherited.scope}`;
    }

    const formula = row.querySelector("[data-rule-formula]");
    if (formula) formula.textContent = describeRule(effective, baseline);

    const clearBtn = row.querySelector("[data-rule-clear]");
    const thresholdWrap = row.querySelector("[data-rule-threshold-wrap]");
    const thresholdInput = row.querySelector("[data-rule-threshold]");

    // The reset icon only exists while the admin/staff has actually typed a
    // number in the field. An empty field means "inherit", so nothing to reset.
    const hasTypedValue = String(thresholdInput?.value ?? "").trim() !== "";
    thresholdWrap?.classList.toggle("has-value", hasTypedValue);
    if (clearBtn) clearBtn.disabled = !hasTypedValue;

    if (thresholdInput) {
      thresholdInput.placeholder = inheritPlaceholder(inherited, baseline);
    }
  };

  modalStockRules?.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const row = target.closest("[data-rule-scope]");
    if (!row || !target.matches("[data-rule-threshold]")) return;

    const { scopeType, scopeKey, rule } = readStockRuleRow(row);
    setStockRuleDraftValue(scopeType, scopeKey, rule);
    refreshStockRuleRowChrome(row);
  });

  modalStockRules?.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const row = target.closest("[data-rule-scope]");
    if (!row || !row.isConnected) return;
    if (
      !target.matches("[data-rule-mode]") &&
      !target.matches("[data-rule-threshold]")
    ) {
      return;
    }

    const { scopeType, scopeKey, rule } = readStockRuleRow(row);
    setStockRuleDraftValue(scopeType, scopeKey, rule);
    // A committed change can cascade to children, so re-render the lists.
    renderStockRuleCategories();
    renderStockRuleItems();
  });

  // Keep focus on the field while the reset icon is pressed. Without this the
  // input blurs first, fires `change`, re-renders the row, and the click on the
  // freshly-destroyed button is lost.
  modalStockRules?.addEventListener("mousedown", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest("[data-rule-clear]")) event.preventDefault();
  });

  modalStockRules?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const clearBtn = target.closest("[data-rule-clear]");
    if (!clearBtn) return;

    const row = clearBtn.closest("[data-rule-scope]");
    if (!row) return;

    setStockRuleDraftValue(
      row.getAttribute("data-rule-scope") || "",
      row.getAttribute("data-rule-key") || "",
      null,
    );
    renderStockRuleCategories();
    renderStockRuleItems();
  });

  btnSaveStockRules?.addEventListener("click", async () => {
    if (!stockRuleDraft) return;

    const globalRule = normalizeRule({
      mode: stockRuleGlobalMode?.value || "fixed",
      threshold: stockRuleGlobalThreshold?.value,
    });

    if (!globalRule) {
      showPopup("The default threshold is required.", {
        title: "Validation Error",
      });
      stockRuleGlobalThreshold?.focus();
      return;
    }

    if (globalRule.mode === "percent" && globalRule.threshold > 100) {
      showPopup("Percentage thresholds cannot exceed 100%.", {
        title: "Validation Error",
      });
      stockRuleGlobalThreshold?.focus();
      return;
    }

    const body = {
      global: globalRule,
      categories: stockRuleDraft.categories,
      items: stockRuleDraft.items,
      variants: stockRuleDraft.variants,
    };

    const originalHtml = btnSaveStockRules.innerHTML;
    btnSaveStockRules.disabled = true;
    btnSaveStockRules.innerHTML =
      '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

    try {
      const res = await fetch(`${API_BASE_URL}/admin/inventory/stock-rules`, {
        method: "PUT",
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

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        showPopup(
          payload?.message ||
            Object.values(payload?.errors || {})[0]?.[0] ||
            "Failed to save the stock level rules.",
          { title: "Save Failed" },
        );
        return;
      }

      stockRules = cloneStockRules(payload?.data || body);
      stockRuleDraft = null;
      closeModal(modalStockRules);
      await loadInventory();
      setTimeout(
        () =>
          showPopup(
            payload?.message || "Stock level rules saved successfully.",
            { title: "Success ✓" },
          ),
        200,
      );
    } catch (err) {
      console.error("Save stock rules error:", err);
      showPopup("Cannot connect to server.", { title: "Error" });
    } finally {
      btnSaveStockRules.disabled = false;
      btnSaveStockRules.innerHTML = originalHtml;
    }
  });

  // ─── Auth check + initial load ────────────────────────────────────────────────
  if (!token) {
    showPopup("Please login first to access inventory management.", {
      title: "Session Required",
      onOk: () => {
        window.location.href = "../admin-auth/auth.html";
      },
    });
    return;
  }

  void loadInventory();
});
