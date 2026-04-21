document.addEventListener("DOMContentLoaded", () => {
  const tableBody = document.getElementById("inventoryTableBody");
  const tableMeta = document.getElementById("inventoryTableMeta");
  const currentPageEl = document.getElementById("inventoryCurrentPage");
  const prevBtn = document.getElementById("inventoryPrevPage");
  const nextBtn = document.getElementById("inventoryNextPage");
  const searchInput = document.getElementById("inventorySearchInput");
  const categoryFilter = document.getElementById("inventoryCategoryFilter");
  const tableWrapper = document.querySelector(".table-wrapper");

  const btnExportCsv = document.getElementById("btnExportCsv");

  const addItemPhoto = document.getElementById("addItemPhoto");
  const btnEditPhoto = document.getElementById("btnEditPhoto");
  const editItemPhoto = document.getElementById("editItemPhoto");
  const btnEditExistingPhoto = document.getElementById("btnEditPhotoInEditModal");

  const modalEditItem = document.getElementById("modalEditItem");
  const modalDeleteItem = document.getElementById("modalDeleteItem");
  const deleteItemTargetLabel = document.getElementById("deleteItemTargetLabel");
  const modalArchiveItem = document.getElementById("modalArchiveItem");
  const archiveItemTargetLabel = document.getElementById("archiveItemTargetLabel");
  const editItemName = document.getElementById("editItemName");
  const editItemCategory = document.getElementById("editItemCategory");
  const editItemQty = document.getElementById("editItemQty");
  const editItemUnit = document.getElementById("editItemUnit");
  const editItemDescription = document.getElementById("editItemDescription");
  const editDeductionType = document.getElementById("editDeductionType");
  const editDeductQty = document.getElementById("editDeductQty");
  const btnSaveItem = document.getElementById("btnSaveItem");
  const btnUpdateItem = document.getElementById("btnUpdateItem");
  const btnConfirmDelete = document.getElementById("btnConfirmDelete");
  const modalViewItem = document.getElementById("modalViewItem");
  const viewItemTitle = document.getElementById("viewItemTitle");
  const viewItemContent = document.getElementById("viewItemContent");
  const btnCloseViewItem = document.getElementById("btnCloseViewItem");
  const btnOpenEditFromViewItem = document.getElementById("btnOpenEditFromViewItem");

  const photoPreviewModal = document.getElementById("modalPhotoPreview");
  const photoPreviewImg = document.getElementById("inventoryPhotoPreview");

  const photoEditorModal = document.getElementById("modalPhotoEditor");
  const photoEditorPreview = document.getElementById("photoEditorPreview");
  const photoRotate = document.getElementById("photoRotate");
  const photoScale = document.getElementById("photoScale");
  const btnApplyPhotoEdit = document.getElementById("btnApplyPhotoEdit");

  const metricTotalItems = document.getElementById("metricTotalItems");
  const metricInStock = document.getElementById("metricInStock");
  const metricLowStock = document.getElementById("metricLowStock");
  const metricOutOfStock = document.getElementById("metricOutOfStock");

  const defaultItems = [
    {
      id: "INV-001",
      name: "Mild Steel Sheet 4x8",
      category: "Raw Materials",
      description: "Fabrication sheet",
      photo: "",
      qty: 145,
      unit: "pcs",
      status: "In Stock",
    },
    {
      id: "INV-002",
      name: "Welding Wire ER70S-6",
      category: "Consumables",
      description: "MIG welding wire",
      photo: "",
      qty: 43,
      unit: "rolls",
      status: "Low Stock",
    },
    {
      id: "INV-003",
      name: "Stainless Rod 12mm",
      category: "Raw Materials",
      description: "Round bar stock",
      photo: "",
      qty: 90,
      unit: "pcs",
      status: "In Stock",
    },
    {
      id: "INV-004",
      name: "CNC Cutting Disc",
      category: "Consumables",
      description: "Machine cutting disc",
      photo: "",
      qty: 12,
      unit: "boxes",
      status: "Out of Stock",
    },
  ];

  let items = [...defaultItems];
  let currentPage = 1;
  let editedPhotoData = "";
  let sourcePhotoData = "";
  let activeEditId = "";
  let pendingDeleteId = "";

  const statusClass = (status) => {
    if (status === "In Stock") return "status-green";
    if (status === "Low Stock") return "status-yellow";
    if (status === "Out of Stock") return "status-red";
    return "status-blue";
  };

  const inferStatus = (qty) => {
    if (qty <= 0) return "Out of Stock";
    if (qty <= 50) return "Low Stock";
    return "In Stock";
  };

  const safeValue = (value) => {
    if (value === undefined || value === null || String(value).trim() === "") {
      return "N/A";
    }
    return String(value);
  };

  const filteredItems = () => {
    const q = (searchInput?.value || "").trim().toLowerCase();
    const category = categoryFilter?.value || "all";
    return items.filter((item) => {
      const matchesCategory = category === "all" || item.category === category;
      const composed = `${item.id} ${item.name} ${item.description}`.toLowerCase();
      const matchesSearch = !q || composed.includes(q);
      return matchesCategory && matchesSearch;
    });
  };

  const calculateRowsPerPage = () => {
    return 5;
  };

  const refreshMetrics = () => {
    const inStockCount = items.filter((item) => item.status === "In Stock").length;
    const lowStockCount = items.filter((item) => item.status === "Low Stock").length;
    const outOfStockCount = items.filter((item) => item.status === "Out of Stock").length;

    if (metricTotalItems) metricTotalItems.textContent = String(items.length);
    if (metricInStock) metricInStock.textContent = String(inStockCount);
    if (metricLowStock) metricLowStock.textContent = String(lowStockCount);
    if (metricOutOfStock) metricOutOfStock.textContent = String(outOfStockCount);
  };

  const renderTable = () => {
    if (!tableBody) return;
    const source = filteredItems();
    const rowsPerPage = calculateRowsPerPage();
    const pageCount = Math.max(1, Math.ceil(source.length / rowsPerPage));
    if (currentPage > pageCount) currentPage = pageCount;

    const start = (currentPage - 1) * rowsPerPage;
    const pagedItems = source.slice(start, start + rowsPerPage);

    tableBody.innerHTML = pagedItems
      .map((item) => {
        const photoCell = item.photo
          ? `<button class="photo-link" data-photo-preview="${item.id}">View Photo</button>`
          : "N/A";

        return `<tr>
          <td>${safeValue(item.id)}</td>
          <td title="${safeValue(item.name)}">${safeValue(item.name)}</td>
          <td>${safeValue(item.category)}</td>
          <td title="${safeValue(item.description)}">${safeValue(item.description)}</td>
          <td>${photoCell}</td>
          <td>${safeValue(item.qty)}</td>
          <td>${safeValue(item.unit)}</td>
          <td><span class="status-pill ${statusClass(item.status)}">${safeValue(item.status)}</span></td>
          <td class="action-icons sticky-action">
            <button type="button" data-tooltip="View Item" data-view-id="${item.id}"><i class="fa-regular fa-eye"></i></button>
            <button type="button" data-tooltip="Move to Archives" data-archive-id="${item.id}"><i class="fa-solid fa-box-archive"></i></button>
            <button type="button" data-tooltip="Delete Item" data-delete-id="${item.id}"><i class="fa-regular fa-trash-can"></i></button>
          </td>
        </tr>`;
      })
      .join("");

    if (pagedItems.length === 0) {
      tableBody.innerHTML = `<tr class="table-empty-row"><td colspan="9"><div class="table-empty-state"><i class="fa-regular fa-folder-open"></i><span>No inventory items found.</span></div></td></tr>`;
    }

    if (tableMeta) {
      const from = source.length ? start + 1 : 0;
      const to = source.length ? Math.min(source.length, start + rowsPerPage) : 0;
      tableMeta.textContent = `Page ${currentPage} of ${pageCount} • Showing ${from}-${to} of ${source.length}`;
    }
    if (currentPageEl) currentPageEl.textContent = String(currentPage);
    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= pageCount;
    refreshMetrics();
  };

  const openModal = (modal) => {
    modal?.classList.add("show");
  };

  const closeModal = (modal) => {
    modal?.classList.remove("show");
  };

  const fileToDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });

  const applyEditorTransform = () => {
    if (!photoEditorPreview) return;
    const rotateDeg = Number(photoRotate?.value || 0);
    const scalePct = Number(photoScale?.value || 100) / 100;
    photoEditorPreview.style.transform = `rotate(${rotateDeg}deg) scale(${scalePct})`;
  };

  const renderToCanvas = async () => {
    if (!photoEditorPreview || !photoEditorPreview.src) return "";
    const img = new Image();
    img.src = photoEditorPreview.src;
    await new Promise((resolve) => {
      if (img.complete) resolve(true);
      else img.onload = () => resolve(true);
    });

    const rotateRad = (Number(photoRotate?.value || 0) * Math.PI) / 180;
    const scale = Number(photoScale?.value || 100) / 100;

    const w = img.width;
    const h = img.height;
    const cos = Math.abs(Math.cos(rotateRad));
    const sin = Math.abs(Math.sin(rotateRad));
    const rw = Math.ceil((w * cos + h * sin) * scale);
    const rh = Math.ceil((w * sin + h * cos) * scale);

    const canvas = document.createElement("canvas");
    canvas.width = rw;
    canvas.height = rh;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";

    ctx.translate(rw / 2, rh / 2);
    ctx.rotate(rotateRad);
    ctx.scale(scale, scale);
    ctx.drawImage(img, -w / 2, -h / 2);

    return canvas.toDataURL("image/png");
  };

  addItemPhoto?.addEventListener("change", async (e) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("Image files only.");
      input.value = "";
      return;
    }

    sourcePhotoData = await fileToDataUrl(file);
    editedPhotoData = sourcePhotoData;
  });

  btnEditPhoto?.addEventListener("click", () => {
    if (!sourcePhotoData && !editedPhotoData) {
      alert("Upload an image first.");
      return;
    }

    const workingPhoto = editedPhotoData || sourcePhotoData;
    if (!photoEditorPreview || !workingPhoto) return;

    photoEditorPreview.src = workingPhoto;
    if (photoRotate) photoRotate.value = "0";
    if (photoScale) photoScale.value = "100";
    applyEditorTransform();
    openModal(photoEditorModal);
  });

  editItemPhoto?.addEventListener("change", async (e) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("Image files only.");
      input.value = "";
      return;
    }

    sourcePhotoData = await fileToDataUrl(file);
    editedPhotoData = sourcePhotoData;
  });

  btnEditExistingPhoto?.addEventListener("click", () => {
    if (!sourcePhotoData && !editedPhotoData) {
      alert("Upload an image first.");
      return;
    }

    const workingPhoto = editedPhotoData || sourcePhotoData;
    if (!photoEditorPreview || !workingPhoto) return;

    photoEditorPreview.src = workingPhoto;
    if (photoRotate) photoRotate.value = "0";
    if (photoScale) photoScale.value = "100";
    applyEditorTransform();
    openModal(photoEditorModal);
  });

  photoRotate?.addEventListener("input", applyEditorTransform);
  photoScale?.addEventListener("input", applyEditorTransform);

  btnApplyPhotoEdit?.addEventListener("click", async () => {
    const dataUrl = await renderToCanvas();
    if (!dataUrl) return;
    editedPhotoData = dataUrl;
    sourcePhotoData = dataUrl;
    closeModal(photoEditorModal);
  });

  btnExportCsv?.addEventListener("click", () => {
    const source = filteredItems();
    const header = [
      "Item ID",
      "Material Name",
      "Category",
      "Description",
      "Photo",
      "Qty",
      "Unit",
      "Status",
    ];
    const rows = source.map((item) => [
      item.id,
      item.name,
      item.category,
      item.description,
      item.photo ? "Available" : "N/A",
      item.qty,
      item.unit,
      item.status,
    ]);
    const csv = [header, ...rows]
      .map((line) => line.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "inventory-export.csv";
    a.click();
    URL.revokeObjectURL(url);
  });

  tableBody?.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    const photoBtn = target.closest("[data-photo-preview]");
    if (photoBtn) {
      const id = photoBtn.getAttribute("data-photo-preview") || "";
      const item = items.find((x) => x.id === id);
      if (!item?.photo) return;
      if (photoPreviewImg) photoPreviewImg.src = item.photo;
      openModal(photoPreviewModal);
      return;
    }

    const editBtn = target.closest("[data-edit-id]");
    if (editBtn) {
      const id = editBtn.getAttribute("data-edit-id") || "";
      const item = items.find((x) => x.id === id);
      if (!item) return;

      if (editItemName) editItemName.value = safeValue(item.name);
      if (editItemCategory) editItemCategory.value = safeValue(item.category);
      if (editItemQty) editItemQty.value = safeValue(item.qty);
      if (editItemUnit) editItemUnit.value = safeValue(item.unit);
      if (editItemDescription) editItemDescription.value = safeValue(item.description);
      if (editDeductionType) editDeductionType.value = "Production";
      if (editDeductQty) editDeductQty.value = "0";

      sourcePhotoData = item.photo || "";
      editedPhotoData = item.photo || "";
      activeEditId = item.id;
      openModal(modalEditItem);
      return;
    }

    const viewBtn = target.closest("[data-view-id]");
    if (viewBtn) {
      const id = viewBtn.getAttribute("data-view-id") || "";
      const item = items.find((x) => x.id === id);
      if (!item) return;

      activeEditId = item.id;
      if (viewItemTitle) viewItemTitle.textContent = `${item.id} — ${item.name}`;
      if (viewItemContent) {
        const statusCls = statusClass(item.status);
        viewItemContent.innerHTML = `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 18px;">
            <div><div style="font-size:.73rem;color:#9ca3af;font-weight:700;text-transform:uppercase;letter-spacing:.04em;">Item ID</div><div style="font-size:.88rem;color:#111827;font-weight:500;">${item.id}</div></div>
            <div><div style="font-size:.73rem;color:#9ca3af;font-weight:700;text-transform:uppercase;">Category</div><div style="font-size:.88rem;color:#111827;font-weight:500;">${item.category}</div></div>
            <div><div style="font-size:.73rem;color:#9ca3af;font-weight:700;text-transform:uppercase;">Quantity</div><div style="font-size:.88rem;color:#111827;font-weight:500;">${item.qty} ${item.unit}</div></div>
            <div><div style="font-size:.73rem;color:#9ca3af;font-weight:700;text-transform:uppercase;">Status</div><div><span class="status-pill ${statusCls}">${item.status}</span></div></div>
            <div style="grid-column:1/-1;"><div style="font-size:.73rem;color:#9ca3af;font-weight:700;text-transform:uppercase;">Description</div><div style="font-size:.88rem;color:#111827;">${item.description || '—'}</div></div>
            ${item.photo ? `<div style="grid-column:1/-1;"><img src="${item.photo}" style="max-height:120px;border-radius:8px;object-fit:contain;" /></div>` : ''}
          </div>`;
      }
      openModal(modalViewItem);
      return;
    }

    const archiveBtn = target.closest("[data-archive-id]");
    if (archiveBtn) {
      const id = archiveBtn.getAttribute("data-archive-id") || "";
      const item = items.find((x) => x.id === id);
      if (archiveItemTargetLabel) {
        archiveItemTargetLabel.textContent = item ? `${item.id} - ${item.name}` : "this item";
      }
      openModal(modalArchiveItem);
      return;
    }

    const deleteBtn = target.closest("[data-delete-id]");
    if (deleteBtn) {
      const id = deleteBtn.getAttribute("data-delete-id") || "";
      const item = items.find((x) => x.id === id);
      if (deleteItemTargetLabel) {
        deleteItemTargetLabel.textContent = item ? `${item.id} - ${item.name}` : "this item";
      }
      pendingDeleteId = item?.id || "";
      openModal(modalDeleteItem);
      return;
    }
  });

  btnCloseViewItem?.addEventListener("click", () => closeModal(modalViewItem));

  btnOpenEditFromViewItem?.addEventListener("click", () => {
    const item = items.find((x) => x.id === activeEditId);
    if (!item) return;
    closeModal(modalViewItem);

    if (editItemName) editItemName.value = safeValue(item.name);
    if (editItemCategory) editItemCategory.value = safeValue(item.category);
    if (editItemQty) editItemQty.value = safeValue(item.qty);
    if (editItemUnit) editItemUnit.value = safeValue(item.unit);
    if (editItemDescription) editItemDescription.value = safeValue(item.description);
    if (editDeductionType) editDeductionType.value = "Production";
    if (editDeductQty) editDeductQty.value = "0";

    sourcePhotoData = item.photo || "";
    editedPhotoData = item.photo || "";
    openModal(modalEditItem);
  });

  btnSaveItem?.addEventListener("click", () => {
    const addName = (document.getElementById("addItemName")?.value || "").trim();
    const addCategory = document.getElementById("addItemCategory")?.value || "Raw Materials";
    const addQtyRaw = Number(document.getElementById("addItemQty")?.value || 0);
    const addUnit = document.getElementById("addItemUnit")?.value || "pcs";
    const addDescription = (document.getElementById("addItemDescription")?.value || "").trim();

    if (!addName) {
      window.showAdminPopup?.("Material name is required.", { title: "Validation Error" });
      return;
    }

    const cleanQty = Math.max(0, Number.isFinite(addQtyRaw) ? addQtyRaw : 0);
    const nextIdNumber =
      items.reduce((maxId, item) => {
        const numericPart = Number(String(item.id).replace("INV-", ""));
        return Number.isFinite(numericPart) ? Math.max(maxId, numericPart) : maxId;
      }, 0) + 1;

    const newItem = {
      id: `INV-${String(nextIdNumber).padStart(3, "0")}`,
      name: addName,
      category: addCategory,
      description: addDescription,
      photo: editedPhotoData || "",
      qty: cleanQty,
      unit: addUnit,
      status: inferStatus(cleanQty),
    };

    items.unshift(newItem);
    currentPage = 1;
    renderTable();
    closeModal(document.getElementById("modalAddItem"));
    setTimeout(() => window.showAdminPopup?.("Item added successfully.", { title: "Success ✓" }), 200);
  });

  btnUpdateItem?.addEventListener("click", () => {
    if (!activeEditId) return;
    const item = items.find((entry) => entry.id === activeEditId);
    if (!item) return;

    const baseQty = Number(editItemQty?.value || 0);
    const deductQty = Number(editDeductQty?.value || 0);
    const validBaseQty = Math.max(0, Number.isFinite(baseQty) ? baseQty : 0);
    const validDeductQty = Math.max(0, Number.isFinite(deductQty) ? deductQty : 0);
    const finalQty = Math.max(0, validBaseQty - validDeductQty);

    item.name = (editItemName?.value || "").trim() || item.name;
    item.category = editItemCategory?.value || item.category;
    item.unit = editItemUnit?.value || item.unit;
    item.description = (editItemDescription?.value || "").trim();
    item.qty = finalQty;
    item.status = inferStatus(finalQty);
    item.photo = editedPhotoData || item.photo;

    if (validDeductQty > 0) {
      const deductionLabel = editDeductionType?.value || "Production";
      window.showAdminPopup?.(`${deductionLabel} deduction applied: -${validDeductQty} ${item.unit}.`, { title: "Deduction Applied" });
    }

    renderTable();
    closeModal(modalEditItem);
    setTimeout(() => window.showAdminPopup?.("Item updated successfully.", { title: "Success ✓" }), 200);
  });

  btnConfirmDelete?.addEventListener("click", () => {
    if (!pendingDeleteId) {
      closeModal(modalDeleteItem);
      return;
    }
    items = items.filter((item) => item.id !== pendingDeleteId);
    pendingDeleteId = "";
    renderTable();
    closeModal(modalDeleteItem);
    setTimeout(() => window.showAdminPopup?.("Item deleted successfully.", { title: "Success ✓" }), 200);
  });

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

  window.addEventListener("resize", renderTable);
  renderTable();
});
