document.addEventListener("DOMContentLoaded", () => {
  const STORAGE_KEY = "productItems";
  const tableBody = document.getElementById("productTableBody");
  const tableMeta = document.getElementById("productTableMeta");
  const currentPageEl = document.getElementById("productCurrentPage");
  const prevBtn = document.getElementById("productPrevPage");
  const nextBtn = document.getElementById("productNextPage");
  const searchInput = document.getElementById("productSearchInput");
  const categoryFilter = document.getElementById("productCategoryFilter");
  const tableWrapper = document.querySelector(".table-wrapper");

  const btnSaveProduct = document.getElementById("btnSaveProduct");
  const btnUpdateProduct = document.getElementById("btnUpdateProduct");
  const btnConfirmProductDelete = document.getElementById("btnConfirmProductDelete");
  const btnConfirmProductArchive = document.getElementById("btnConfirmProductArchive");
  const deleteProductTargetLabel = document.getElementById("deleteProductTargetLabel");
  const archiveProductTargetLabel = document.getElementById("archiveProductTargetLabel");

  const addProductName = document.getElementById("addProductName");
  const addProductCategory = document.getElementById("addProductCategory");
  const addProductCode = document.getElementById("addProductCode");
  const addProductStock = document.getElementById("addProductStock");
  const addProductPrice = document.getElementById("addProductPrice");
  const addProductSpecification = document.getElementById("addProductSpecification");
  const addProductDescription = document.getElementById("addProductDescription");
  const addProductPhoto = document.getElementById("addProductPhoto");
  const btnEditProductPhoto = document.getElementById("btnEditProductPhoto");

  const editProductName = document.getElementById("editProductName");
  const editProductCategory = document.getElementById("editProductCategory");
  const editProductCode = document.getElementById("editProductCode");
  const editProductStock = document.getElementById("editProductStock");
  const editProductPrice = document.getElementById("editProductPrice");
  const editProductSpecification = document.getElementById("editProductSpecification");
  const editProductDescription = document.getElementById("editProductDescription");
  const editProductPhoto = document.getElementById("editProductPhoto");
  const btnEditProductPhotoInEditModal = document.getElementById(
    "btnEditProductPhotoInEditModal"
  );

  const photoPreviewModal = document.getElementById("modalProductPhotoPreview");
  const photoPreviewImg = document.getElementById("productPhotoPreview");

  const photoEditorModal = document.getElementById("modalProductPhotoEditor");
  const photoEditorPreview = document.getElementById("productPhotoEditorPreview");
  const photoRotate = document.getElementById("productPhotoRotate");
  const photoScale = document.getElementById("productPhotoScale");
  const btnApplyPhotoEdit = document.getElementById("btnApplyProductPhotoEdit");

  const defaultItems = [
    {
      id: "001",
      name: "3D Printed Phone Holder",
      category: "3D Print",
      code: "S2P-PH001",
      description: "Custom desk phone holder",
      specification: "- 1kg spool\n- 1.75mm diameter\n- 220C nozzle temp",
      photo: "",
      stock: 20,
      price: 200,
      status: "In Stock",
    },
    {
      id: "002",
      name: "3D Printed Miniature Set",
      category: "3D Print",
      code: "S2P-MM002",
      description: "Detailed model set",
      specification: "- SLA resin\n- 0.05mm layer height\n- UV cured",
      photo: "",
      stock: 7,
      price: 520,
      status: "Low Stock",
    },
    {
      id: "003",
      name: "Acrylic Keychain Pack",
      category: "Laser Cut",
      code: "S2P-AK003",
      description: "Laser engraved keychains",
      specification: "- 3mm acrylic\n- 40W laser\n- Mirror polished edges",
      photo: "",
      stock: 58,
      price: 130,
      status: "In Stock",
    },
    {
      id: "004",
      name: "Machine Bracket",
      category: "CNC",
      code: "S2P-MB004",
      description: "Precision aluminum bracket",
      specification: "- 6061 aluminum\n- +/-0.1mm tolerance\n- Deburred finish",
      photo: "",
      stock: 12,
      price: 840,
      status: "Low Stock",
    },
  ];

  const readItems = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [...defaultItems];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [...defaultItems];
      return parsed;
    } catch {
      return [...defaultItems];
    }
  };

  let items = readItems();
  let currentPage = 1;
  let activeEditProductId = "";
  let sourcePhotoData = "";
  let editedPhotoData = "";

  const statusClass = (status) => {
    if (status === "In Stock") return "status-green";
    if (status === "Low Stock") return "status-yellow";
    if (status === "Out of Stock") return "status-red";
    return "status-blue";
  };

  const inferStatus = (stock) => {
    if (stock <= 0) return "Out of Stock";
    if (stock <= 20) return "Low Stock";
    return "In Stock";
  };

  const safeValue = (value) => {
    if (value === undefined || value === null || String(value).trim() === "") {
      return "N/A";
    }
    return String(value);
  };

  const formatSpecification = (text) => {
    const cleaned = safeValue(text);
    return cleaned.replace(/\n/g, "<br />");
  };

  const formatPrice = (value) => {
    const number = Number(value || 0);
    return `₱${number.toLocaleString("en-PH", {
      minimumFractionDigits: number % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const filteredItems = () => {
    const q = (searchInput?.value || "").trim().toLowerCase();
    const category = categoryFilter?.value || "all";

    return items.filter((item) => {
      const matchesCategory = category === "all" || item.category === category;
      const composed = `${item.id} ${item.name} ${item.code} ${item.description} ${item.specification}`.toLowerCase();
      const matchesSearch = !q || composed.includes(q);
      return matchesCategory && matchesSearch;
    });
  };

  const calculateRowsPerPage = () => {
    const firstRow = tableBody?.querySelector("tr");
    const rowHeight = firstRow?.offsetHeight || 42;

    const sidebarFooter = document.querySelector(".sidebar-footer");
    const footerTop = sidebarFooter
      ? sidebarFooter.getBoundingClientRect().top
      : window.innerHeight - 70;

    const tableTop = tableWrapper?.getBoundingClientRect().top || 200;
    const available = Math.max(180, footerTop - tableTop - 70);
    const rows = Math.floor(available / rowHeight);
    return Math.max(5, rows);
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
          <td>${safeValue(item.code)}</td>
          <td title="${safeValue(item.description)}">${safeValue(item.description)}</td>
          <td class="specification-cell">${formatSpecification(item.specification)}</td>
          <td>${photoCell}</td>
          <td>${safeValue(item.stock)}</td>
          <td>${formatPrice(item.price)}</td>
          <td><span class="status-pill ${statusClass(item.status)}">${safeValue(item.status)}</span></td>
          <td class="action-icons sticky-action">
            <button type="button" data-tooltip="Edit Product" data-edit-id="${item.id}"><i class="fa-regular fa-pen-to-square"></i></button>
            <button type="button" data-tooltip="View Product" data-view-id="${item.id}"><i class="fa-regular fa-eye"></i></button>
            <button type="button" data-tooltip="Move to Archives" data-archive-id="${item.id}"><i class="fa-solid fa-box-archive"></i></button>
            <button type="button" data-tooltip="Delete Product" data-delete-id="${item.id}"><i class="fa-regular fa-trash-can"></i></button>
          </td>
        </tr>`;
      })
      .join("");

    if (pagedItems.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="11">No products found.</td></tr>`;
    }

    if (tableMeta) {
      tableMeta.textContent = `Page ${currentPage} of ${pageCount} • Showing ${Math.min(
        source.length,
        start + 1
      )}-${Math.min(source.length, start + rowsPerPage)} of ${source.length}`;
    }
    if (currentPageEl) currentPageEl.textContent = String(currentPage);
    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= pageCount;
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

  // Keep modal actions design-only to mirror inventory behavior.
  btnSaveProduct?.addEventListener("click", (e) => e.preventDefault());
  btnUpdateProduct?.addEventListener("click", (e) => e.preventDefault());
  btnConfirmProductDelete?.addEventListener("click", (e) => e.preventDefault());
  btnConfirmProductArchive?.addEventListener("click", (e) => e.preventDefault());

  addProductPhoto?.addEventListener("change", async (e) => {
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

  editProductPhoto?.addEventListener("change", async (e) => {
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

  btnEditProductPhoto?.addEventListener("click", () => {
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

  btnEditProductPhotoInEditModal?.addEventListener("click", () => {
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

    const deleteBtn = target.closest("[data-delete-id]");
    if (deleteBtn) {
      const id = deleteBtn.getAttribute("data-delete-id") || "";
      activeEditProductId = id;
      const selected = items.find((x) => x.id === id);
      if (deleteProductTargetLabel) {
        deleteProductTargetLabel.textContent = selected?.name || id || "this product";
      }
      openModal(document.getElementById("modalDeleteProduct"));
      return;
    }

    const archiveBtn = target.closest("[data-archive-id]");
    if (archiveBtn) {
      const id = archiveBtn.getAttribute("data-archive-id") || "";
      activeEditProductId = id;
      const selected = items.find((x) => x.id === id);
      if (archiveProductTargetLabel) {
        archiveProductTargetLabel.textContent = selected?.name || id || "this product";
      }
      openModal(document.getElementById("modalArchiveProduct"));
      return;
    }

    const viewBtn = target.closest("[data-view-id]");
    if (viewBtn) {
      const id = viewBtn.getAttribute("data-view-id") || "";
      const selected = items.find((x) => x.id === id);
      if (!selected) return;

      if (editProductName) editProductName.value = safeValue(selected.name) === "N/A" ? "" : selected.name;
      if (editProductCategory) editProductCategory.value = selected.category || "3D Print";
      if (editProductCode) editProductCode.value = safeValue(selected.code) === "N/A" ? "" : selected.code;
      if (editProductStock) editProductStock.value = String(selected.stock ?? "");
      if (editProductPrice) editProductPrice.value = String(selected.price ?? "");
      if (editProductSpecification) {
        editProductSpecification.value =
          safeValue(selected.specification) === "N/A" ? "" : selected.specification;
      }
      if (editProductDescription) {
        editProductDescription.value =
          safeValue(selected.description) === "N/A" ? "" : selected.description;
      }

      sourcePhotoData = selected.photo || "";
      editedPhotoData = selected.photo || "";
      if (editProductPhoto) editProductPhoto.value = "";

      openModal(document.getElementById("modalEditProduct"));
      return;
    }

    const editBtn = target.closest("[data-edit-id]");
    if (editBtn) {
      const id = editBtn.getAttribute("data-edit-id") || "";
      activeEditProductId = id;
      const selected = items.find((x) => x.id === id);
      if (!selected) return;

      if (editProductName) editProductName.value = safeValue(selected.name) === "N/A" ? "" : selected.name;
      if (editProductCategory) editProductCategory.value = selected.category || "3D Print";
      if (editProductCode) editProductCode.value = safeValue(selected.code) === "N/A" ? "" : selected.code;
      if (editProductStock) editProductStock.value = String(selected.stock ?? "");
      if (editProductPrice) editProductPrice.value = String(selected.price ?? "");
      if (editProductSpecification) {
        editProductSpecification.value =
          safeValue(selected.specification) === "N/A" ? "" : selected.specification;
      }
      if (editProductDescription) {
        editProductDescription.value =
          safeValue(selected.description) === "N/A" ? "" : selected.description;
      }

      sourcePhotoData = selected.photo || "";
      editedPhotoData = selected.photo || "";
      if (editProductPhoto) editProductPhoto.value = "";

      openModal(document.getElementById("modalEditProduct"));
      return;
    }
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

  // Keep status current even when mock data is edited via devtools/localStorage.
  items = items.map((item) => ({
    ...item,
    status: inferStatus(Number(item.stock || 0)),
  }));

  // Ensure ids stay deterministic if localStorage has custom values.
  items = items.map((item, index) => ({
    ...item,
    id: String(item.id || String(index + 1).padStart(3, "0")),
  }));

  renderTable();
});
