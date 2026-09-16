"use strict";

const resolveApiBaseUrl = () => {
  const configured =
    window.APP_API_BASE_URL ||
    document
      .querySelector('meta[name="api-base-url"]')
      ?.getAttribute("content") ||
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

const API = resolveApiBaseUrl();
const token = () =>
  (window.AdminSession && window.AdminSession.getToken()) ||
  localStorage.getItem("auth_token");

let servicesData = [];
let svcImageData = null;
let serviceDiscardGuard = null;
const DEFAULT_SERVICE_CATEGORIES = [
  "Prototyping",
  "Manufacturing",
  "Design & Labelling",
  "Training & Workshops",
];
let serviceCategories = [...DEFAULT_SERVICE_CATEGORIES];
let categoriesLoaded = false;
let categoriesSaving = false;

document.addEventListener("DOMContentLoaded", () => {
  loadServices();
  bindEvents();
  initializePageCopyEditor();
  initializeCategoryManager();
});

function categorySlug(value) {
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
  return aliases[category] || category.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "category";
}

function setServiceCategoryOptions(selected) {
  const select = document.getElementById("svcCategory");
  if (!select) return;
  const values = [...serviceCategories];
  const explicit = selected !== undefined && selected !== null;
  const current = String(explicit ? selected : select.value || "").trim();
  if (explicit && current && !values.some((value) => value.toLowerCase() === current.toLowerCase())) values.push(current);
  select.replaceChildren(...values.map((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    return option;
  }));
  select.value = values.find((value) => value.toLowerCase() === current.toLowerCase()) || values[0] || "";
}

function syncCategoryControls() {
  const enabled = categoriesLoaded && !categoriesSaving;
  const input = document.getElementById("newServiceCategory");
  const add = document.getElementById("btnAddCategory");
  const save = document.getElementById("btnSaveCategories");
  if (input) input.disabled = !enabled;
  if (add) add.disabled = !enabled;
  if (save) save.disabled = !enabled;
  document.querySelectorAll("#serviceCategoryList input, #serviceCategoryList button").forEach((control) => {
    control.disabled = !enabled;
  });
}

function renderCategoryManager() {
  const list = document.getElementById("serviceCategoryList");
  if (!list) return;
  list.replaceChildren(...serviceCategories.map((category, index) => {
    const row = document.createElement("div");
    row.className = "service-category-row";
    row.setAttribute("role", "listitem");
    const input = document.createElement("input");
    input.className = "wm-input";
    input.type = "text";
    input.maxLength = 60;
    input.value = category;
    input.setAttribute("aria-label", `Category ${index + 1}`);
    input.addEventListener("input", () => {
      serviceCategories[index] = input.value;
      input.setCustomValidity(duplicateCategory(index) ? "Category labels must be unique." : "");
      setServiceCategoryOptions();
      document.getElementById("serviceCategoryStatus").textContent = "Unsaved category changes.";
    });
    const remove = document.createElement("button");
    remove.className = "btn-del-sm";
    remove.type = "button";
    remove.setAttribute("aria-label", `Delete ${category || "category"}`);
    remove.innerHTML = '<i class="fa-solid fa-trash" aria-hidden="true"></i> Delete';
    remove.addEventListener("click", () => {
      if (serviceCategories.length <= 1) {
        window.showAdminPopup("Keep at least one service category.", { title: "Category required" });
        return;
      }
      window.showAdminConfirmPopup(`Delete “${category || "this category"}”? Existing services keep their saved category until you edit them.`, {
        title: "Delete Category",
        confirmText: "Delete",
        onConfirm: () => {
          serviceCategories.splice(index, 1);
          renderCategoryManager();
          setServiceCategoryOptions();
          document.getElementById("serviceCategoryStatus").textContent = "Unsaved category changes.";
        },
      });
    });
    row.append(input, remove);
    return row;
  }));
  setServiceCategoryOptions();
  syncCategoryControls();
}

function duplicateCategory(index) {
  const value = categorySlug(serviceCategories[index]);
  return !String(serviceCategories[index] || "").trim() || serviceCategories.some((category, other) => other !== index && categorySlug(category) === value);
}

function categoryPayload() {
  const clean = serviceCategories.map((category) => String(category || "").trim());
  if (!clean.length || clean.length > 30 || clean.some((category) => !category || category.length > 60)) return null;
  const normalized = clean.map((category) => categorySlug(category));
  if (new Set(normalized).size !== normalized.length) return null;
  return clean;
}

async function loadServiceCategories() {
  const status = document.getElementById("serviceCategoryStatus");
  try {
    const response = await fetch(`${API}/site-settings`, { cache: "no-store", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("Unable to load service categories.");
    const result = await response.json();
    let parsed = [];
    const raw = result.data?.editorial_services_categories;
    try { parsed = Array.isArray(raw) ? raw : JSON.parse(raw || "[]"); } catch {}
    if (!Array.isArray(parsed)) parsed = [];
    // A saved list is authoritative so an intentionally deleted label does
    // not reappear from old service records or the defaults.
    const source = parsed.length ? parsed : DEFAULT_SERVICE_CATEGORIES;
    serviceCategories = [...new Set(source.map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 30);
    categoriesLoaded = true;
    renderCategoryManager();
    if (status) {
      status.classList.remove("is-invalid");
      status.textContent = "Categories loaded. Edit, add, or delete labels, then save changes.";
    }
    syncCategoryControls();
  } catch (error) {
    categoriesLoaded = false;
    if (status) { status.textContent = error.message || "Unable to load service categories. Please retry."; status.classList.add("is-invalid"); }
    renderCategoryManager();
    syncCategoryControls();
  }
}

function initializeCategoryManager() {
  const add = document.getElementById("btnAddCategory");
  const input = document.getElementById("newServiceCategory");
  const save = document.getElementById("btnSaveCategories");
  if (save) save.disabled = true;
  syncCategoryControls();
  input?.addEventListener("input", () => {
    const count = document.getElementById("newServiceCategoryCount");
    if (count) count.textContent = `${input.value.length} / 60 characters`;
    input.setCustomValidity(input.value.length > 60 ? "Use 60 characters or fewer." : "");
  });
  add?.addEventListener("click", () => {
    if (!categoriesLoaded || categoriesSaving) return;
    const value = String(input?.value || "").trim();
    if (!value || value.length > 60 || serviceCategories.length >= 30 || serviceCategories.some((category) => categorySlug(category) === categorySlug(value))) {
      input?.setCustomValidity("Enter a unique category label of 1–60 characters; up to 30 categories are allowed.");
      input?.reportValidity();
      return;
    }
    serviceCategories.push(value);
    input.value = "";
    input.dispatchEvent(new Event("input"));
    renderCategoryManager();
    document.getElementById("serviceCategoryStatus").textContent = "Unsaved category changes.";
  });
  save?.addEventListener("click", () => {
    if (!categoriesLoaded || categoriesSaving) return;
    const categories = categoryPayload();
    if (!categories) {
      window.showAdminPopup("Use unique category labels, each 1–60 characters, with at most 30 categories.", { title: "Invalid Categories" });
      return;
    }
    window.showAdminConfirmPopup("Save these service category changes for the customer filter and Add Service form?", {
      title: "Save Categories",
      confirmText: "Save Changes",
      keepOpenWhilePending: true,
      loadingText: "Saving...",
      onConfirm: () => saveServiceCategories(categories),
      onError: (error) => {
        const message = error.message || "Unable to save categories.";
        const status = document.getElementById("serviceCategoryStatus");
        if (status) {
          status.textContent = message;
          status.classList.add("is-invalid");
        }
        window.showAdminPopup(message, { title: "Save failed" });
      },
      onSuccess: () => window.showAdminSuccessNotification?.("Service categories saved successfully.", { title: "Saved!" }),
    });
  });
  renderCategoryManager();
  void loadServiceCategories();
}

async function saveServiceCategories(categories) {
  categoriesSaving = true;
  const save = document.getElementById("btnSaveCategories");
  syncCategoryControls();
  try {
    const response = await fetch(`${API}/admin/site-settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ editorial_services_categories: JSON.stringify(categories) }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(Object.values(error.errors || {}).flat().join(" ") || error.message || "Unable to save categories.");
    }
    serviceCategories = [...categories];
    renderCategoryManager();
    document.getElementById("serviceCategoryStatus").textContent = "Service categories saved successfully.";
    broadcastSiteUpdate("updated");
  } finally {
    categoriesSaving = false;
    syncCategoryControls();
  }
}

async function loadServices() {
  const grid = document.getElementById("servicesGrid");
  try {
    const res = await fetch(`${API}/services`);
    if (!res.ok) throw new Error("Unable to load services.");
    const json = await res.json();
    if (!Array.isArray(json.data)) throw new Error("Unexpected services response.");
    servicesData = json.data;
    renderCategoryManager();
    setServiceCategoryOptions();
    renderCards();
  } catch {
    grid.innerHTML =
      '<p class="empty-state">Failed to load services. Check backend connection.</p>';
  }
}

function renderCards() {
  const grid = document.getElementById("servicesGrid");
  if (!servicesData.length) {
    grid.innerHTML =
      '<div class="empty-state"><i class="fa-regular fa-folder-open" style="font-size:2rem;display:block;margin-bottom:10px;"></i>No services yet. Click "Add Service" to get started.</div>';
    return;
  }
  grid.innerHTML = servicesData
    .map(
      (s) => `
    <div class="wm-service-card">
      <div class="card-img">
        ${
          s.image_data
            ? `<img src="${escHtml(s.image_data)}" alt="${escHtml(s.title)}" />`
            : `<div class="no-img"><i class="fa-regular fa-image" style="font-size:1.8rem;display:block;margin-bottom:4px;"></i>No image</div>`
        }
      </div>
      <div class="card-body">
        <div class="card-cat">${escHtml(s.category)}</div>
        <div class="card-title">${escHtml(s.title)}</div>
        <div class="card-desc">${escHtml(s.description || "")}</div>
      </div>
      <div class="card-actions">
        <button class="btn-edit-sm" data-service-action="edit" data-service-id="${escHtml(s.id)}"><i class="fa-regular fa-pen-to-square"></i> Edit</button>
        <button class="btn-del-sm" data-service-action="delete" data-service-id="${escHtml(s.id)}"><i class="fa-solid fa-trash"></i> Delete</button>
      </div>
    </div>
  `,
    )
    .join("");
}

function escHtml(str) {
  return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function bindEvents() {
  serviceDiscardGuard = window.createAdminFormDiscardGuard?.({
    getSnapshot: getServiceFormSnapshot,
    close: closeModal,
  });

  document.getElementById("btnAddService").addEventListener("click", openAdd);
  document.getElementById("servicesGrid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-service-action]");
    if (!button) return;
    const service = servicesData.find((item) => String(item.id) === button.dataset.serviceId);
    if (!service) return;
    if (button.dataset.serviceAction === "edit") openEdit(service.id);
    else doDelete(service.id, service.title);
  });
  document
    .getElementById("btnCancelService")
    .addEventListener("click", () => {
      if (serviceDiscardGuard) {
        serviceDiscardGuard.cancel();
        return;
      }
      closeModal();
    });
  document
    .getElementById("btnCloseServiceModal")
    .addEventListener("click", closeModal);
  document.getElementById("btnSaveService").addEventListener("click", onSave);
  document
    .getElementById("svcImgInput")
    .addEventListener("change", function () {
      const file = this.files[0];
      if (!file) return;

      // Cards crop consistently to 16:10; the preview preserves the full image.
      const img = new Image();
      const reader = new FileReader();
      reader.onload = (e) => {
        img.src = e.target.result;
        img.onload = () => {
          svcImageData = e.target.result;
          const preview = document.getElementById("svcImgPreview");
          const placeholder = document.getElementById("svcImgPlaceholder");
          const removeBtn = document.getElementById("svcImgPreviewRemoveBtn");
          preview.src = svcImageData;
          preview.classList.add("visible");
          placeholder.classList.add("hidden");
          if (removeBtn) removeBtn.style.display = "inline-flex";
        };
        img.onerror = () => {
          window.showAdminPopup?.("Choose a valid image file.", { title: "Image unavailable" });
          this.value = "";
        };
      };
      reader.readAsDataURL(file);
    });
  setupChipInput("svcFeaturesArea", "svcFeaturesInput");
  initializeServiceLimits();
}

function clearImage(target) {
  if (target === "svc") {
    svcImageData = null;
    const preview = document.getElementById("svcImgPreview");
    const placeholder = document.getElementById("svcImgPlaceholder");
    const removeBtn = document.getElementById("svcImgPreviewRemoveBtn");
    if (preview) {
      preview.src = "";
      preview.classList.remove("visible");
    }
    if (placeholder) placeholder.classList.remove("hidden");
    if (removeBtn) removeBtn.style.display = "none";
  }
}

function openAdd() {
  svcImageData = null;
  document.getElementById("serviceEditId").value = "";
  document.getElementById("serviceModalTitle").textContent = "Add Service";
  clearForm();
  setServiceCategoryOptions();
  serviceDiscardGuard?.capture();
  updateServiceLimits();
  document.getElementById("serviceModal").classList.add("show");
}

function openEdit(id) {
  const s = servicesData.find((x) => x.id === id);
  if (!s) return;
  svcImageData = s.image_data || null;
  document.getElementById("serviceEditId").value = id;
  document.getElementById("serviceModalTitle").textContent = "Edit Service";
  document.getElementById("svcTitle").value = s.title || "";
  setServiceCategoryOptions(s.category || "Prototyping");
  document.getElementById("svcDesc").value = s.description || "";
  document.getElementById("svcModalDesc").value = s.modal_description || "";
  document.getElementById("svcMaterials").value = (
    s.modal_materials || []
  ).join("\n");
  document.getElementById("svcBestFor").value = (s.modal_best_for || []).join(
    "\n",
  );
  document.getElementById("svcFeaturesInput").value = "";
  renderChips("svcFeaturesArea", "svcFeaturesInput", s.modal_features || []);
  if (s.image_data) {
    document.getElementById("svcImgPreview").src = s.image_data;
    document.getElementById("svcImgPreview").classList.add("visible");
    document.getElementById("svcImgPlaceholder").classList.add("hidden");
    const btn = document.getElementById("svcImgPreviewRemoveBtn");
    if (btn) btn.style.display = "inline-flex";
  } else {
    document.getElementById("svcImgPreview").classList.remove("visible");
    document.getElementById("svcImgPlaceholder").classList.remove("hidden");
    const btn = document.getElementById("svcImgPreviewRemoveBtn");
    if (btn) btn.style.display = "none";
  }
  serviceDiscardGuard?.capture();
  updateServiceLimits();
  document.getElementById("serviceModal").classList.add("show");
}

function closeModal() {
  document.getElementById("serviceModal").classList.remove("show");
}

function clearForm() {
  document.getElementById("svcTitle").value = "";
  setServiceCategoryOptions(serviceCategories[0] || "Prototyping");
  document.getElementById("svcDesc").value = "";
  document.getElementById("svcModalDesc").value = "";
  document.getElementById("svcMaterials").value = "";
  document.getElementById("svcBestFor").value = "";
  document.getElementById("svcFeaturesInput").value = "";
  renderChips("svcFeaturesArea", "svcFeaturesInput", []);
  document.getElementById("svcImgPreview").classList.remove("visible");
  document.getElementById("svcImgPlaceholder").classList.remove("hidden");
  const btn = document.getElementById("svcImgPreviewRemoveBtn");
  if (btn) btn.style.display = "none";
  const input = document.getElementById("svcImgInput");
  if (input) input.value = "";
}

function getServiceFormSnapshot() {
  return {
    id: String(document.getElementById("serviceEditId")?.value || ""),
    title: String(document.getElementById("svcTitle")?.value || ""),
    category: String(document.getElementById("svcCategory")?.value || ""),
    description: String(document.getElementById("svcDesc")?.value || ""),
    modalDescription: String(
      document.getElementById("svcModalDesc")?.value || "",
    ),
    features: getChips("svcFeaturesArea"),
    featureDraft: String(document.getElementById("svcFeaturesInput")?.value || ""),
    materials: String(document.getElementById("svcMaterials")?.value || ""),
    bestFor: String(document.getElementById("svcBestFor")?.value || ""),
    image: String(svcImageData || ""),
  };
}

function onSave() {
  if (!validateServiceForm()) return;
  const id = document.getElementById("serviceEditId").value;
  const title = document.getElementById("svcTitle").value.trim();
  if (!title) {
    window.showAdminPopup("Please enter a service title.");
    return;
  }
  if (!id) {
    window.showAdminConfirmPopup(`Add “${title}” to the Services and Home pages?`, {
      title: "Add Service",
      confirmText: "Add Service",
      cancelText: "Keep Editing",
      onConfirm: () => doSave(id),
    });
    return;
  }

  window.showAdminConfirmPopup(`Save changes to service "${title}"?`, {
    title: "Confirm Edit",
    confirmText: "Save",
    onConfirm: () => doSave(id),
  });
}

async function doSave(id) {
  if (!validateServiceForm()) return;
  const submitButton = document.getElementById("btnSaveService");
  const originalSubmitButtonHtml = submitButton?.innerHTML || "";
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.innerHTML =
      '<i class="fa-solid fa-spinner fa-spin"></i> Saving Service...';
  }

  const payload = {
    title: document.getElementById("svcTitle").value.trim(),
    category: document.getElementById("svcCategory").value,
    description: document.getElementById("svcDesc").value,
    image_data: svcImageData || null,
    modal_description: document.getElementById("svcModalDesc").value,
    modal_features: getChips("svcFeaturesArea"),
    modal_materials: document
      .getElementById("svcMaterials")
      .value.split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
    modal_best_for: document
      .getElementById("svcBestFor")
      .value.split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
    sort_order: id
      ? (servicesData.find((s) => s.id == id)?.sort_order ?? 0)
      : servicesData.length,
  };

  try {
    const url = id ? `${API}/admin/services/${id}` : `${API}/admin/services`;
    const method = id ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token(),
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(Object.values(error.errors || {}).flat().join(" ") || error.message || "Unable to save the service.");
    }
    serviceDiscardGuard?.clear();
    closeModal();
    window.showAdminPopup("Service saved successfully!", { title: "Saved!" });
    // The home page's offer cards are built from this list, so an open
    // customer tab has to hear the change the same way a Home or Contact save
    // announces itself. main.js re-reads /services on this signal.
    broadcastSiteUpdate();
    await loadServices();
  } catch (error) {
    window.showAdminPopup(error.message || "Failed to save. Try again.", { title: "Error" });
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.innerHTML =
        originalSubmitButtonHtml ||
        '<i class="fa-solid fa-floppy-disk"></i> Save Service';
    }
  }
}

function doDelete(id, name) {
  window.showAdminConfirmPopup(
    `Delete "${name}"? It will be removed from both Services and Home pages.`,
    {
      title: "Delete Service",
      confirmText: "Delete",
      onConfirm: async () => {
        try {
          const res = await fetch(`${API}/admin/services/${id}`, {
            method: "DELETE",
            headers: {
              Authorization: "Bearer " + token(),
              Accept: "application/json",
            },
          });
          if (!res.ok) throw new Error();
          window.showAdminPopup("Service deleted.", { title: "Deleted" });
          // Same reason as the save path: this dialog promises the service is
          // gone from the Home page too, so say so on the realtime channel.
          broadcastSiteUpdate();
          await loadServices();
        } catch {
          window.showAdminPopup("Failed to delete.", { title: "Error" });
        }
      },
    },
  );
}

// Chip helpers
function setupChipInput(areaId, inputId) {
  const area = document.getElementById(areaId);
  const input = document.getElementById(inputId);
  area.addEventListener("click", () => input.focus());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const val = input.value.trim();
      if (val) {
        if (val.length > 120 || getChips(areaId).length >= 12) {
          input.setCustomValidity("Use up to 12 features, with at most 120 characters each.");
          input.reportValidity();
          return;
        }
        addChip(areaId, inputId, val);
        input.value = "";
        updateServiceLimits();
      }
    }
  });
}

function addChip(areaId, inputId, text) {
  const area = document.getElementById(areaId);
  const input = document.getElementById(inputId);
  const chip = document.createElement("span");
  chip.className = "chip-tag-item";
  chip.dataset.value = text;
  chip.innerHTML = `${escHtml(text)}<button class="chip-remove" type="button">×</button>`;
  chip
    .querySelector(".chip-remove")
    .addEventListener("click", () => { chip.remove(); updateServiceLimits(); });
  area.insertBefore(chip, input);
}

function renderChips(areaId, inputId, arr) {
  const area = document.getElementById(areaId);
  Array.from(area.querySelectorAll(".chip-tag-item")).forEach((c) =>
    c.remove(),
  );
  arr.forEach((v) => addChip(areaId, inputId, v));
}

function getChips(areaId) {
  return Array.from(
    document.getElementById(areaId).querySelectorAll(".chip-tag-item"),
  ).map((c) => c.dataset.value);
}

const SERVICE_TEXT_LIMITS = {
  svcTitle: { label: "Service title", max: 100 },
  svcDesc: { label: "Card description", max: 360 },
  svcModalDesc: { label: "Detailed description", max: 2500 },
};

function initializeServiceLimits() {
  const ids = [...Object.keys(SERVICE_TEXT_LIMITS), "svcFeaturesInput", "svcMaterials", "svcBestFor"];
  ids.forEach((id) => {
    const field = document.getElementById(id);
    const count = document.createElement("small");
    count.id = `${id}Count`;
    count.className = "service-field-count";
    field.setAttribute("aria-describedby", count.id);
    if (SERVICE_TEXT_LIMITS[id]) field.maxLength = SERVICE_TEXT_LIMITS[id].max;
    field.closest(".field-stack").append(count);
    field.addEventListener("input", updateServiceLimits);
  });
  document.getElementById("svcTitle").required = true;
  document.getElementById("svcCategory").required = true;
  updateServiceLimits();
}

function updateServiceLimits() {
  Object.entries(SERVICE_TEXT_LIMITS).forEach(([id, definition]) => {
    const field = document.getElementById(id);
    const count = document.getElementById(`${id}Count`);
    if (!field || !count) return;
    const invalid = field.value.length > definition.max;
    field.setCustomValidity(invalid ? `${definition.label} must be ${definition.max} characters or fewer.` : "");
    field.setAttribute("aria-invalid", String(invalid));
    count.textContent = `${field.value.length} / ${definition.max} characters`;
    count.classList.toggle("is-invalid", invalid);
  });
  ["svcMaterials", "svcBestFor", "svcFeaturesInput"].forEach((id) => {
    const field = document.getElementById(id);
    const count = document.getElementById(`${id}Count`);
    if (!field || !count) return;
    const entries = id === "svcFeaturesInput"
      ? [...getChips("svcFeaturesArea"), ...(field.value.trim() ? [field.value.trim()] : [])]
      : field.value.split("\n").map((value) => value.trim()).filter(Boolean);
    const invalid = entries.length > 12 || entries.some((entry) => entry.length > 120);
    field.setCustomValidity(invalid ? "Use at most 12 entries, with 120 characters or fewer per entry." : "");
    field.setAttribute("aria-invalid", String(invalid));
    const longest = Math.max(0, ...entries.map((entry) => entry.length));
    count.textContent = `${entries.length} / 12 entries · ${longest} / 120 characters in the longest entry`;
    count.classList.toggle("is-invalid", invalid);
  });
}

function validateServiceForm() {
  updateServiceLimits();
  const ids = ["svcTitle", "svcCategory", "svcDesc", "svcModalDesc", "svcFeaturesInput", "svcMaterials", "svcBestFor"];
  for (const id of ids) {
    const field = document.getElementById(id);
    if (!field.reportValidity()) { field.focus(); return false; }
  }
  const feature = document.getElementById("svcFeaturesInput");
  if (feature.value.trim()) {
    addChip("svcFeaturesArea", "svcFeaturesInput", feature.value.trim());
    feature.value = "";
    updateServiceLimits();
  }
  return true;
}

function initializePageCopyEditor() {
  const form = document.getElementById("servicePageCopyForm");
  const fieldset = document.getElementById("servicePageCopyFields");
  const status = document.getElementById("servicePageCopyStatus");
  const save = document.getElementById("servicePageCopySave");
  const retry = document.getElementById("servicePageCopyRetry");
  const definitions = (window.FMRC_PAGE_CONTENT?.fields || []).filter((field) => field.page === "services");
  if (!form || !definitions.length) {
    if (status) status.textContent = "The page editor could not load. Please refresh this page.";
    return;
  }
  let loaded = false;
  let saving = false;
  const fields = new Map();
  const describe = (field, definition) => {
    const invalid = field.value.length > definition.maxLength;
    field.setCustomValidity(invalid ? `Use ${definition.maxLength} characters or fewer.` : "");
    field.setAttribute("aria-invalid", String(invalid));
    const count = document.getElementById(`${field.id}Count`);
    count.textContent = `${field.value.length} / ${definition.maxLength} characters`;
    count.classList.toggle("is-invalid", invalid);
  };
  definitions.forEach((definition) => {
    const wrapper = document.createElement("div");
    wrapper.className = "field-stack" + (definition.maxLength > 100 ? " full" : "");
    const label = document.createElement("label");
    const field = document.createElement(definition.maxLength > 100 ? "textarea" : "input");
    field.id = `pageCopy_${definition.key}`;
    field.name = definition.key;
    field.maxLength = definition.maxLength;
    field.className = definition.maxLength > 100 ? "wm-textarea" : "wm-input";
    if (field.tagName === "TEXTAREA") field.rows = 2;
    else field.type = "text";
    label.htmlFor = field.id;
    label.textContent = definition.label;
    const count = document.createElement("small");
    count.id = `${field.id}Count`;
    count.className = "service-field-count";
    field.setAttribute("aria-describedby", count.id);
    wrapper.append(label, field, count);
    fieldset.append(wrapper);
    field.addEventListener("input", () => describe(field, definition));
    fields.set(definition.key, field);
  });
  async function load() {
    loaded = false;
    fieldset.disabled = true;
    save.disabled = true;
    retry.hidden = true;
    status.classList.remove("is-invalid");
    status.textContent = "Loading saved page content...";
    try {
      const response = await fetch(`${API}/site-settings`, { cache: "no-store", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Unable to load saved page content. Retry before editing.");
      const result = await response.json();
      if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) throw new Error("The saved page content was not returned. Please retry.");
      definitions.forEach((definition) => {
        const field = fields.get(definition.key);
        field.value = result.data[definition.key] ?? definition.default;
        describe(field, definition);
      });
      loaded = true;
      fieldset.disabled = false;
      save.disabled = false;
      status.textContent = "All fields show their exact character limit. Existing over-limit text must be shortened before saving.";
    } catch (error) {
      status.textContent = error.message || "Unable to load page content. Please retry.";
      status.classList.add("is-invalid");
      retry.hidden = false;
    }
  }
  retry.addEventListener("click", load);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!loaded || saving) return;
    const payload = {};
    for (const definition of definitions) {
      const field = fields.get(definition.key);
      describe(field, definition);
      if (!field.reportValidity()) { field.focus(); return; }
      payload[definition.key] = field.value;
    }
    const savePageContent = async () => {
      saving = true;
      fieldset.disabled = true;
      save.disabled = true;
      save.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Saving...';
      status.classList.remove("is-invalid");
      status.textContent = "Saving Services page content...";
      try {
        const response = await fetch(`${API}/admin/site-settings`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token()}` },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(Object.values(error.errors || {}).flat().join(" ") || error.message || "The page content was not saved. Please try again.");
        }
        broadcastSiteUpdate();
        status.textContent = "Services page content saved successfully.";
      } finally {
        saving = false;
        fieldset.disabled = false;
        save.disabled = false;
        save.innerHTML = '<i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Save Changes';
      }
    };
    window.showAdminConfirmPopup?.("Save these Services page content changes?", {
      title: "Save Page Content",
      confirmText: "Save Changes",
      cancelText: "Keep Editing",
      loadingText: "Saving...",
      keepOpenWhilePending: true,
      onConfirm: savePageContent,
      onError: (error) => {
        status.textContent = error.message || "The page content was not saved. Please try again.";
        status.classList.add("is-invalid");
        window.showAdminPopup?.(error.message || "The page content was not saved. Please try again.", { title: "Save failed" });
      },
      onSuccess: () => window.showAdminSuccessNotification?.("Services page content saved successfully.", { title: "Saved!" }),
    });
  });
  void load();
}

/**
 * Tell every open customer/admin tab that site content changed. Byte-identical
 * to the copy in website-home.js:1719 on purpose — both signals matter, and the
 * customer listener (main.js:14566) only reacts to these exact type strings.
 */
function broadcastSiteUpdate(type) {
  try {
    if ("BroadcastChannel" in window) {
      const ch = new BroadcastChannel("fmrc-site-settings-realtime");
      ch.postMessage({ type: type || "updated", at: Date.now() });
      ch.close();
    }
  } catch {
    /* BroadcastChannel unsupported — the storage signal below still fires. */
  }
  try {
    localStorage.setItem("fmrc_site_content_updated_at", String(Date.now()));
  } catch {
    /* storage blocked — ETag polling still picks the change up */
  }
}
