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

let servicesData = [], savedServices = [];
let servicesLoaded = false, copyLoaded = false, pageSaving = false, pageDraft = null;
let nextDraftId = -1;
let copyFields = new Map();
const SERVICE_FIELDS = ['title','category','description','image_data','modal_description','modal_features','modal_materials','modal_best_for','sort_order','accepts_custom_requests'];
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
let categoryDraft = null;
let serviceDraft = null;
let serviceSaving = false, serviceImagePreparing = false, serviceImageSequence = 0;

document.addEventListener("DOMContentLoaded", () => {
  serviceDraft = window.AdminWebsiteDraft?.create({ button: "btnSaveService", read: getServiceFormSnapshot,
    ready: () => document.getElementById("serviceModal")?.classList.contains("show"), busy: () => serviceSaving || serviceImagePreparing, page: false });
  pageDraft = window.AdminWebsiteDraft.create({ button: 'btnSaveAllServices', read: servicesSnapshot,
    ready: () => servicesLoaded && copyLoaded && categoriesLoaded, busy: () => pageSaving || serviceImagePreparing });
  document.getElementById('btnSaveAllServices').addEventListener('click', () => {
    if (pageSaving || !pageDraft.isDirty()) return;
    window.showAdminConfirmPopup('Save all Services page changes to the live website?', { title: 'Save All Changes', confirmText: 'Save', onConfirm: saveAllServices });
  });
  window.AdminWebsiteDraft.register({ isDirty: () => !!document.getElementById('serviceModal')?.classList.contains('show') && !!serviceDiscardGuard?.isDirty() });
  bindEvents();
  initializePageCopyEditor();
  initializeCategoryManager();
  void refreshServicesPage();
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
  categoryDraft?.refresh();
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
      syncCategoryControls();
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

async function loadServiceCategories(...args) {
  const work = () => loadServiceCategoriesData(...args);
  return window.AdminWebsiteLoading ? window.AdminWebsiteLoading.during(work) : work();
}

async function loadServiceCategoriesData() {
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
    categoryDraft?.capture();
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
  categoryDraft = window.AdminWebsiteDraft?.create({ button: "btnSaveCategories",
    read: () => serviceCategories.map((value) => String(value || "").trim()), page: false,
    ready: () => categoriesLoaded, busy: () => categoriesSaving });
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
  renderCategoryManager();

}

function saveServiceCategories() { return saveAllServices(); }

async function loadServices(...args) {
  const work = () => loadServicesData(...args);
  return window.AdminWebsiteLoading ? window.AdminWebsiteLoading.during(work) : work();
}

async function loadServicesData() {
  servicesLoaded = false;
  const grid = document.getElementById("servicesGrid");
  try {
    const res = await fetch(`${API}/services`);
    if (!res.ok) throw new Error("Unable to load services.");
    const json = await res.json();
    if (!Array.isArray(json.data)) throw new Error("Unexpected services response.");
    servicesData = json.data;
    savedServices = JSON.parse(JSON.stringify(servicesData));
    servicesLoaded = true;
    renderCategoryManager();
    setServiceCategoryOptions();
    renderCards();
  } catch {
    grid.innerHTML =
      '<p class="empty-state">Failed to load services. Please try again.</p>';
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
    .addEventListener("click", () => serviceDiscardGuard ? serviceDiscardGuard.cancel() : closeModal());
  document.getElementById("btnSaveService").addEventListener("click", onSave);
  document
    .getElementById("svcImgInput")
    .addEventListener("change", function () {
      const file = this.files[0];
      if (!file) return;

      const imageSequence = ++serviceImageSequence;
      serviceImagePreparing = true; serviceDraft?.refresh(); pageDraft?.refresh();
      const finishImage = () => { if (imageSequence === serviceImageSequence) { serviceImagePreparing = false; serviceDraft?.refresh(); pageDraft?.refresh(); } };
      // Cards crop consistently to 16:10; the preview preserves the full image.
      const img = new Image();
      const reader = new FileReader();
      reader.onload = (e) => {
        img.onload = () => {
          if (imageSequence !== serviceImageSequence) return;
          svcImageData = e.target.result;
          const preview = document.getElementById("svcImgPreview");
          const placeholder = document.getElementById("svcImgPlaceholder");
          const removeBtn = document.getElementById("svcImgPreviewRemoveBtn");
          preview.src = svcImageData;
          preview.classList.add("visible");
          placeholder.classList.add("hidden");
          if (removeBtn) removeBtn.style.display = "inline-flex";
          finishImage();
        };
        img.onerror = () => {
          if (imageSequence !== serviceImageSequence) return;
          finishImage();
          window.showAdminPopup?.("Choose a valid image file.", { title: "Image unavailable" });
          this.value = "";
        };
        img.src = e.target.result;
      };
      reader.onerror = () => { finishImage(); window.showAdminPopup('The image could not be read. Choose it again.', { title: 'Image unavailable' }); };
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
  if (!servicesLoaded || pageSaving) return;
  svcImageData = null;
  document.getElementById("serviceEditId").value = "";
  document.getElementById("serviceModalTitle").textContent = "Add Service";
  clearForm();
  setServiceCategoryOptions();
  serviceDiscardGuard?.capture();
  serviceDraft?.capture();
  updateServiceLimits();
  document.getElementById("serviceModal").classList.add("show");
}

function openEdit(id) {
  if (!servicesLoaded || pageSaving) return;
  const s = servicesData.find((x) => x.id === id);
  if (!s) return;
  svcImageData = s.image_data || null;
  document.getElementById("serviceEditId").value = id;
  document.getElementById("serviceModalTitle").textContent = "Edit Service";
  document.getElementById("svcTitle").value = s.title || "";
  document.getElementById("svcAcceptsCustom").checked = !!s.accepts_custom_requests;
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
  serviceDraft?.capture();
  updateServiceLimits();
  document.getElementById("serviceModal").classList.add("show");
}

function closeModal() {
  serviceImageSequence++; serviceImagePreparing = false;
  document.getElementById("serviceModal").classList.remove("show");
}

function clearForm() {
  document.getElementById("svcTitle").value = "";
  document.getElementById("svcAcceptsCustom").checked = false;
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
    accepts_custom_requests: !!document.getElementById("svcAcceptsCustom")?.checked,
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
  if (serviceSaving || (serviceDraft && !serviceDraft.isDirty())) return;
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

  window.showAdminConfirmPopup(`Apply changes to service "${title}" in this draft? Publish them with Save All Changes.`, {
    title: "Confirm Edit",
    confirmText: "Apply Changes",
    onConfirm: () => doSave(id),
  });
}

function doSave(id) {
  if (!servicesLoaded || pageSaving || serviceImagePreparing || !validateServiceForm()) return;
  const existing = servicesData.find(item => item.id == id);
  const payload = {
    accepts_custom_requests: !!document.getElementById('svcAcceptsCustom').checked,
    title: document.getElementById('svcTitle').value.trim(),
    category: document.getElementById('svcCategory').value,
    description: document.getElementById('svcDesc').value,
    image_data: svcImageData || null,
    modal_description: document.getElementById('svcModalDesc').value,
    modal_features: getChips('svcFeaturesArea'),
    modal_materials: document.getElementById('svcMaterials').value.split('\n').map(value => value.trim()).filter(Boolean),
    modal_best_for: document.getElementById('svcBestFor').value.split('\n').map(value => value.trim()).filter(Boolean),
    sort_order: existing?.sort_order ?? Math.max(-1, ...servicesData.map(item => item.sort_order || 0)) + 1,
  };
  if (existing) Object.assign(existing, payload);
  else servicesData.push({ id: nextDraftId--, ...payload });
  serviceDiscardGuard?.clear(); closeModal(); renderCards(); pageDraft?.refresh();
}

function doDelete(id, name) {
  if (!servicesLoaded || pageSaving) return;
  window.showAdminConfirmPopup(`Remove "${name}"? This applies after Save All Changes.`, {
    title: 'Remove Service', confirmText: 'Remove', onConfirm: () => {
      servicesData = servicesData.filter(item => item.id !== id); renderCards(); pageDraft?.refresh();
    },
  });
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
  const customFields = document.getElementById("serviceCustomCopyFields");
  const generalFields = document.getElementById("serviceGeneralCopyFields");
  const status = document.getElementById("servicePageCopyStatus");
  const save = document.getElementById("servicePageCopySave");
  const retry = document.getElementById("servicePageCopyRetry");
  const content = window.FMRC_PAGE_CONTENT;
  const definitions = (content?.fields || []).filter((field) => field.page === "services");
  if (!form || !definitions.length) {
    if (status) status.textContent = "The page editor could not load. Please refresh this page.";
    return;
  }
  let loaded = false;
  let saving = false;
  const fields = copyFields;
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
    const group = definition.key.startsWith("editorial_services_custom_") ? customFields : generalFields;
    group.append(wrapper);
    field.addEventListener("input", () => describe(field, definition));
    fields.set(definition.key, field);
  });
  const contentDraft = window.AdminWebsiteDraft?.create({ button: save, page: false,
    read: () => Object.fromEntries([...fields].map(([key, field]) => [key, field.value])),
    ready: () => loaded, busy: () => saving });
  async function load(...args) {
    const work = () => loadData(...args);
    return window.AdminWebsiteLoading ? window.AdminWebsiteLoading.during(work) : work();
  }

  async function loadData() {
    loaded = false; copyLoaded = false;
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
        field.value = content.get(definition.key, result.data);
        describe(field, definition);
      });
      loaded = true; copyLoaded = true;
      fieldset.disabled = false;
      contentDraft?.capture();
      status.textContent = "";
    } catch (error) {
      status.textContent = error.message || "Unable to load page content. Please retry.";
      status.classList.add("is-invalid");
      retry.hidden = false;
    }
  }
  retry.addEventListener("click", refreshServicesPage);
  form.addEventListener('submit', event => event.preventDefault());
  window.loadServicePageCopy = load;

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

function servicesSnapshot() {
  return { services: servicesData, categories: serviceCategories,
    copy: Object.fromEntries([...copyFields].map(([key, field]) => [key, field.value])) };
}

async function refreshServicesPage() {
  const load = async () => {
    await Promise.all([loadServices(), loadServiceCategories(), window.loadServicePageCopy()]);
    pageDraft.capture();
    if (servicesLoaded && copyLoaded && categoriesLoaded) window.AdminPageNotice?.clear('services-content');
    else window.AdminPageNotice?.show('Services content unavailable.', { key: 'services-content', retry: refreshServicesPage });
    pageDraft.refresh();
  };
  return window.AdminWebsiteDraft.confirmDiscard(load);
}

async function saveAllServices() {
  if (pageSaving || serviceImagePreparing || !servicesLoaded || !copyLoaded || !categoriesLoaded || !pageDraft.isDirty()) return;
  const categories = categoryPayload();
  if (!categories || !document.getElementById('servicePageCopyForm').reportValidity()) {
    window.showAdminPopup('Review the page content and use unique category labels before saving.', { title: 'Review Changes' }); return;
  }
  pageSaving = true;
  const button = document.getElementById('btnSaveAllServices');
  button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
  pageDraft.refresh();
  document.querySelector('.module-content').inert = true;
  try {
    const response = await fetch(`${API}/admin/website-pages/services`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + token() },
      body: JSON.stringify({ settings: { ...Object.fromEntries([...copyFields].map(([key, field]) => [key, field.value])),
        editorial_services_categories: JSON.stringify(categories) }, services: window.AdminWebsiteDraft.changes(savedServices, servicesData, SERVICE_FIELDS) }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(Object.values(error.errors || {}).flat()[0] || 'Your changes could not be saved. Please try again.');
    }
    broadcastSiteUpdate('updated');
    await Promise.all([loadServices(), loadServiceCategories(), window.loadServicePageCopy()]);
    if (!servicesLoaded || !categoriesLoaded || !copyLoaded) throw new Error('Your changes were saved, but could not be loaded. Refresh before editing again.');
    pageDraft.capture(); window.showAdminPopup('All Services page changes saved.', { title: 'Saved!', type: 'success' });
  } catch (error) {
    if (error instanceof TypeError || ['AbortError','TimeoutError'].includes(error.name)) servicesLoaded = false;
    window.showAdminPopup(error instanceof TypeError ? 'Connection lost. Refresh to check whether your changes were saved.' : error.message, { title: 'Changes Not Saved' });
  } finally {
    pageSaving = false; document.querySelector('.module-content').inert = false;
    button.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save All Changes'; pageDraft.refresh();
  }
}
