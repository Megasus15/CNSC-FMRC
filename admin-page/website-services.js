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

document.addEventListener("DOMContentLoaded", () => {
  loadServices();
  bindEvents();
});

async function loadServices() {
  const grid = document.getElementById("servicesGrid");
  try {
    const res = await fetch(`${API}/services`);
    const json = await res.json();
    servicesData = json.data || [];
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
            ? `<img src="${s.image_data}" alt="${escHtml(s.title)}" />`
            : `<div class="no-img"><i class="fa-regular fa-image" style="font-size:1.8rem;display:block;margin-bottom:4px;"></i>No image</div>`
        }
      </div>
      <div class="card-body">
        <div class="card-cat">${s.category}</div>
        <div class="card-title">${escHtml(s.title)}</div>
        <div class="card-desc">${escHtml(s.description || "")}</div>
      </div>
      <div class="card-actions">
        <button class="btn-edit-sm" onclick="openEdit(${s.id})"><i class="fa-regular fa-pen-to-square"></i> Edit</button>
        <button class="btn-del-sm" onclick="doDelete(${s.id},'${escHtml(s.title).replace(/'/g, "\\'")}')"><i class="fa-solid fa-trash"></i> Delete</button>
      </div>
    </div>
  `,
    )
    .join("");
}

function escHtml(str) {
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML;
}

function bindEvents() {
  serviceDiscardGuard = window.createAdminFormDiscardGuard?.({
    getSnapshot: getServiceFormSnapshot,
    close: closeModal,
  });

  document.getElementById("btnAddService").addEventListener("click", openAdd);
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

      // Validate 1:1 aspect ratio for service card images
      const img = new Image();
      const reader = new FileReader();
      reader.onload = (e) => {
        img.src = e.target.result;
        img.onload = () => {
          const width = img.naturalWidth || img.width;
          const height = img.naturalHeight || img.height;
          const aspectRatio = width / height;

          // Check if aspect ratio is 1:1 (allow small tolerance)
          if (Math.abs(aspectRatio - 1) > 0.01) {
            window.showAdminPopup?.(
              `Service card image must have a 1:1 aspect ratio (square). Current ratio: ${aspectRatio.toFixed(2)}:1\n\nImage dimensions: ${width} × ${height}px`,
              { title: "Invalid Image Dimensions" },
            );
            this.value = "";
            return;
          }

          // Valid aspect ratio, proceed
          svcImageData = e.target.result;
          const preview = document.getElementById("svcImgPreview");
          const placeholder = document.getElementById("svcImgPlaceholder");
          const removeBtn = document.getElementById("svcImgPreviewRemoveBtn");
          preview.src = svcImageData;
          preview.classList.add("visible");
          placeholder.classList.add("hidden");
          if (removeBtn) removeBtn.style.display = "inline-flex";
        };
      };
      reader.readAsDataURL(file);
    });
  setupChipInput("svcFeaturesArea", "svcFeaturesInput");
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
  serviceDiscardGuard?.capture();
  document.getElementById("serviceModal").classList.add("show");
}

function openEdit(id) {
  const s = servicesData.find((x) => x.id === id);
  if (!s) return;
  svcImageData = s.image_data || null;
  document.getElementById("serviceEditId").value = id;
  document.getElementById("serviceModalTitle").textContent = "Edit Service";
  document.getElementById("svcTitle").value = s.title || "";
  document.getElementById("svcCategory").value = s.category || "Prototyping";
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
  document.getElementById("serviceModal").classList.add("show");
}

function closeModal() {
  document.getElementById("serviceModal").classList.remove("show");
}

function clearForm() {
  document.getElementById("svcTitle").value = "";
  document.getElementById("svcCategory").value = "Prototyping";
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
  const id = document.getElementById("serviceEditId").value;
  const title = document.getElementById("svcTitle").value.trim();
  if (!title) {
    window.showAdminPopup("Please enter a service title.");
    return;
  }
  if (!id) {
    void doSave(id);
    return;
  }

  window.showAdminConfirmPopup(`Save changes to service "${title}"?`, {
    title: "Confirm Edit",
    confirmText: "Save",
    onConfirm: () => doSave(id),
  });
}

async function doSave(id) {
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
    if (!res.ok) throw new Error();
    serviceDiscardGuard?.clear();
    closeModal();
    window.showAdminPopup("Service saved successfully!", { title: "Saved!" });
    await loadServices();
  } catch {
    window.showAdminPopup("Failed to save. Try again.", { title: "Error" });
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
        addChip(areaId, inputId, val);
        input.value = "";
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
    .addEventListener("click", () => chip.remove());
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
