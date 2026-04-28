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

  const token = localStorage.getItem("auth_token") || "";
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

  // Summary metrics
  const metricTotal = document.getElementById("metricTotalItems");
  const metricGood = document.getElementById("metricGood");
  const metricLow = document.getElementById("metricLowStock");
  const metricOut = document.getElementById("metricOutOfStock");

  // Add/Edit modal
  const modalForm = document.getElementById("modalAddInventoryItem");
  const invModalTitle = document.getElementById("invModalTitle");
  const formCategory = document.getElementById("invFormCategory");
  const formItemName = document.getElementById("invFormItemName");
  const formDescription = document.getElementById("invFormDescription");
  const formUnit = document.getElementById("invFormUnit");
  const formLastInvent = document.getElementById("invFormLastInvent");
  const formOnHand = document.getElementById("invFormOnHand");
  const formStatus = document.getElementById("invFormStatus");
  const formRemarks = document.getElementById("invFormRemarks");
  const btnCancelForm = document.getElementById("btnCancelInvForm");
  const btnSaveForm = document.getElementById("btnSaveInvForm");

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

  // ─── State ────────────────────────────────────────────────────────────────────
  let allItems = [];
  let editingItemId = null;
  let deletingItemId = null;
  let viewingItemId = null;
  const PAGE_SIZE = 5;
  const categoryPages = {};

  const openModal = (m) => m?.classList.add("show");
  const closeModal = (m) => m?.classList.remove("show");

  // ─── Status helpers ───────────────────────────────────────────────────────────
  const statusClass = (status) => {
    if (status === "Good") return "status-green";
    if (status === "Low Stock") return "status-yellow";
    if (status === "Out of Stock") return "status-red";
    return "status-blue";
  };

  const remarksClass = (r) => {
    if (!r) return "remarks-default";
    if (r.includes("Acquired")) return "remarks-acquired";
    if (r.includes("Included")) return "remarks-included";
    if (r.includes("Restock")) return "remarks-restock";
    return "remarks-default";
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
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  };

  // ─── Summary metrics ──────────────────────────────────────────────────────────
  const updateMetrics = (summary) => {
    if (metricTotal) metricTotal.textContent = String(summary?.total_items ?? 0);
    if (metricGood) metricGood.textContent = String(summary?.good ?? 0);
    if (metricLow) metricLow.textContent = String(summary?.low_stock ?? 0);
    if (metricOut) metricOut.textContent = String(summary?.out_of_stock ?? 0);
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
      tableRows = `<tr class="table-empty-row"><td colspan="9"><div class="table-empty-state"><i class="fa-regular fa-folder-open"></i><span>No items found in this category.</span></div></td></tr>`;
    } else {
      tableRows = paged.map((item, idx) => {
        const rowNum = start + idx + 1;
        const statusHtml = `<span class="status-pill ${statusClass(item.status)}">${escHtml(item.status)}</span>`;
        const remarksHtml = item.remarks
          ? `<span class="remarks-pill ${remarksClass(item.remarks)}">${escHtml(item.remarks)}</span>`
          : `<span style="color:#9ca3af;font-size:0.75rem;">—</span>`;
        return `<tr>
          <td>${rowNum}</td>
          <td title="${escHtml(item.item_name)}">${escHtml(item.item_name)}</td>
          <td title="${escHtml(item.description || "")}">${escHtml(item.description || "—")}</td>
          <td>${escHtml(item.unit)}</td>
          <td>${item.last_invent}</td>
          <td>${item.on_hand}</td>
          <td>${statusHtml}</td>
          <td>${remarksHtml}</td>
          <td class="action-icons sticky-action">
            <button type="button" data-tooltip="View Item" data-inv-view="${item.id}"><i class="fa-regular fa-eye"></i></button>
            <button type="button" data-tooltip="Delete Item" data-inv-delete="${item.id}"><i class="fa-regular fa-trash-can"></i></button>
          </td>
        </tr>`;
      }).join("");
    }

    const from = items.length ? start + 1 : 0;
    const to = items.length ? Math.min(items.length, start + PAGE_SIZE) : 0;

    card.innerHTML = `
      <div class="inv-category-header">
        <div class="inv-category-header-left">
          <div class="inv-category-icon"><i class="fa-solid ${icon}"></i></div>
          <span class="inv-category-title">Inventory of ${escHtml(category)}</span>
        </div>
        <span class="inv-category-badge">${items.length} item${items.length !== 1 ? "s" : ""}</span>
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
                <th>Last Invent</th>
                <th>On Hand</th>
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
                    <th>Last Invent</th><th>On Hand</th><th>Status</th><th>Remarks</th>
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

  // ─── Form helpers ─────────────────────────────────────────────────────────────
  const resetForm = () => {
    editingItemId = null;
    if (invModalTitle) invModalTitle.innerHTML = '<i class="fa-solid fa-plus" style="margin-right:6px;"></i>Add New Item';
    if (btnSaveForm) btnSaveForm.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Add to Inventory';
    if (formCategory) formCategory.value = "Consumable Materials";
    if (formItemName) formItemName.value = "";
    if (formDescription) formDescription.value = "";
    if (formUnit) formUnit.value = "pcs";
    if (formLastInvent) formLastInvent.value = "";
    if (formOnHand) formOnHand.value = "";
    if (formStatus) formStatus.value = "Good";
    if (formRemarks) formRemarks.value = "";
  };

  const populateFormForEdit = (item) => {
    editingItemId = item.id;
    if (invModalTitle) invModalTitle.innerHTML = '<i class="fa-regular fa-pen-to-square" style="margin-right:6px;"></i>Edit Item';
    if (btnSaveForm) btnSaveForm.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Update Item';
    if (formCategory) formCategory.value = item.category;
    if (formItemName) formItemName.value = item.item_name || "";
    if (formDescription) formDescription.value = item.description || "";
    if (formUnit) formUnit.value = item.unit || "pcs";
    if (formLastInvent) formLastInvent.value = item.last_invent ?? "";
    if (formOnHand) formOnHand.value = item.on_hand ?? "";
    if (formStatus) formStatus.value = item.status || "Good";
    if (formRemarks) formRemarks.value = item.remarks || "";
  };

  // ─── Open Add Modal ───────────────────────────────────────────────────────────
  btnOpenAdd?.addEventListener("click", () => {
    resetForm();
    openModal(modalForm);
  });

  btnCancelForm?.addEventListener("click", () => closeModal(modalForm));

  // ─── Save / Update ────────────────────────────────────────────────────────────
  btnSaveForm?.addEventListener("click", async () => {
    const itemName = (formItemName?.value || "").trim();
    const category = formCategory?.value || "Consumable Materials";
    const unit = formUnit?.value || "pcs";
    const lastInvent = Number(formLastInvent?.value || 0);
    const onHand = Number(formOnHand?.value || 0);
    const status = formStatus?.value || "Good";
    const remarks = formRemarks?.value || "";
    const description = (formDescription?.value || "").trim();

    if (!itemName) { showPopup("Item Name is required.", { title: "Validation Error" }); formItemName?.focus(); return; }
    if (formLastInvent?.value === "" || formLastInvent?.value === null) { showPopup("Last Invent is required.", { title: "Validation Error" }); formLastInvent?.focus(); return; }
    if (formOnHand?.value === "" || formOnHand?.value === null) { showPopup("On Hand is required.", { title: "Validation Error" }); formOnHand?.focus(); return; }

    const body = { category, item_name: itemName, description, unit, last_invent: lastInvent, on_hand: onHand, status, remarks };

    btnSaveForm.disabled = true;
    btnSaveForm.textContent = editingItemId ? "Updating…" : "Saving…";

    try {
      const url = editingItemId ? `${API_BASE_URL}/admin/inventory/${editingItemId}` : `${API_BASE_URL}/admin/inventory`;
      const method = editingItemId ? "PUT" : "POST";

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
        showPopup(editingItemId ? "Item updated successfully." : "Item added successfully.", { title: "Success ✓" });
      }, 200);
    } catch (err) {
      console.error("Save inventory error:", err);
      showPopup("Cannot connect to server.", { title: "Error" });
    } finally {
      btnSaveForm.disabled = false;
      btnSaveForm.innerHTML = editingItemId
        ? '<i class="fa-solid fa-floppy-disk"></i> Update Item'
        : '<i class="fa-solid fa-floppy-disk"></i> Add to Inventory';
    }
  });

  // ─── View Modal ───────────────────────────────────────────────────────────────
  const openViewModal = (item) => {
    viewingItemId = item.id;
    if (invViewTitle) invViewTitle.textContent = item.item_name || "Item Details";
    if (invViewSubtitle) invViewSubtitle.textContent = `${item.category} — ${item.unit}`;

    const statusCls = statusClass(item.status);
    const remarksCls = remarksClass(item.remarks);
    const remarksHtml = item.remarks
      ? `<span class="remarks-pill ${remarksCls}">${escHtml(item.remarks)}</span>`
      : '<span style="color:#9ca3af;">—</span>';

    if (invViewContent) {
      invViewContent.innerHTML = `
        <div class="inv-view-grid">
          <div><div class="inv-view-label">Category</div><div class="inv-view-value">${escHtml(item.category)}</div></div>
          <div><div class="inv-view-label">Unit</div><div class="inv-view-value">${escHtml(item.unit)}</div></div>
          <div><div class="inv-view-label">Last Invent</div><div class="inv-view-value">${item.last_invent}</div></div>
          <div><div class="inv-view-label">On Hand</div><div class="inv-view-value">${item.on_hand}</div></div>
          <div><div class="inv-view-label">Status</div><div><span class="status-pill ${statusCls}">${escHtml(item.status)}</span></div></div>
          <div><div class="inv-view-label">Remarks</div><div>${remarksHtml}</div></div>
          <div class="full"><div class="inv-view-label">Description</div><div class="inv-view-value">${escHtml(item.description || "—")}</div></div>
        </div>`;
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

  // ─── Event delegation for table clicks ────────────────────────────────────────
  document.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

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
