/* jshint esversion: 9 */
"use strict";

const API = (() => {
  const proto = window.location.protocol;
  const host = window.location.hostname;
  const port = window.location.port;
  if (port === "8000") return `${proto}//${host}:${port}/api`;
  if (host === "localhost" || host === "127.0.0.1")
    return `${proto}//${host}:8000/api`;
  return `${proto}//${host}/api`;
})();
const token = () =>
  (window.AdminSession && window.AdminSession.getToken()) ||
  localStorage.getItem("auth_token");

// ── State ───────────────────────────────────────────────────────────────────
let currentSettings = {};
let servicesData = [];
let svcImageData = null; // base64 for current service modal image
let heroBgImageData = null;
let visionImageData = null;
let missionImageData = null;
let aboutVideoData = null; // base64 or null for video upload

// Hero background gradient: a preset id from ../home-page/hero-gradients.js, the
// same module the customer hero reads, so a swatch here and the live banner can
// never drift apart. Saved with Save All Changes, like the solid colour is.
let heroBgGradient = "";

/**
 * Brand logos. All six save the moment a crop is applied — like SDG badges and
 * service cards, and unlike the text fields that wait for Save All Changes —
 * because an upload is a finished action on its own.
 */
const BRAND_LOGOS = [
  {
    slot: "nav",
    key: "nav_logo_image",
    label: "Navbar Emblem",
    shape: "square",
    fallback: "/images/CNSC logo.png",
    hint: "Header of every customer page. Held in a square the size of the current emblem.",
  },
  {
    slot: "hero",
    key: "hero_logo_image",
    label: "Hero Logo",
    shape: "circle",
    fallback: "/images/FMRC Logo.png",
    hint: "The large mark beside the home page banner title. Fixed circle.",
  },
  {
    slot: "footer1",
    key: "footer_logo_primary_image",
    label: "Footer Logo — Left",
    shape: "circle",
    fallback: "/images/CNSC logo.png",
    hint: "First mark in the footer of every customer page. Fixed circle.",
  },
  {
    slot: "footer2",
    key: "footer_logo_secondary_image",
    label: "Footer Logo — Right",
    shape: "circle",
    fallback: "/images/FMRC Logo.png",
    hint: "Second mark in the footer of every customer page. Fixed circle.",
  },
  // The two marks above the sign-in card on BOTH portals. One shared pair, so
  // the admin/staff portal and the customer portal can never show different
  // branding. `.brand-logo` is a 60px border-radius:50% holder in both auth
  // sheets (admin-auth/auth.css:78), hence circle.
  {
    slot: "portal1",
    key: "portal_logo_primary_image",
    label: "Portal Login Logo — Left",
    shape: "circle",
    fallback: "/images/CNSC logo.png",
    hint: "First mark above the sign-in card on the admin/staff and customer portals. Fixed circle.",
  },
  {
    slot: "portal2",
    key: "portal_logo_secondary_image",
    label: "Portal Login Logo — Right",
    shape: "circle",
    fallback: "/images/FMRC Logo.png",
    hint: "Second mark above the sign-in card on both login portals. Fixed circle.",
  },
];
// Saved base64 per slot, or "" when the slot is on its bundled default.
let brandLogoData = {
  nav: "",
  hero: "",
  footer1: "",
  footer2: "",
  portal1: "",
  portal2: "",
};
let logoUploadSlot = null; // slot awaiting the shared file picker
let logoCropData = null; // artwork currently open in the crop editor

// SDG badge state (home hero strip)
let sdgsData = [];
let sdgMaxSlots = 8;
let sdgImageData = null; // base64 for the SDG currently being edited/uploaded
let sdgUploadTargetId = null; // id being replaced/adjusted, or null for a new badge

// Crop state
let cropTarget = null; // 'heroBg' | 'sdg:modal' | 'sdg:grid' | 'logo:<slot>' | 'vm:<kind>:<slot>'
let cropImgNaturalSrc = null;
let cropOffsetX = 0;
let cropOffsetY = 0;
let cropScale = 100;
let cropRotate = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;

// Vision/Mission photo fitter. Same modal as the SDG badges and brand logos, with
// a frame shaped like the deck the photo lands in.
let vmCropData = null; // photo currently open in the fitter
let vmCoverScale = 100; // the "Fill frame" scale worked out when it loaded

// ── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  await loadAllData();
  bindEvents();
});

async function loadAllData() {
  await Promise.all([loadSettings(), loadServices(), loadSdgs()]);
}

// ── API: Load settings ────────────────────────────────────────────────────────
async function loadSettings() {
  try {
    const res = await fetch(`${API}/site-settings`);
    const json = await res.json();
    currentSettings = json.data || {};
    populateForm();
  } catch {
    window.showAdminPopup(
      "Failed to load site settings. Check your backend connection.",
    );
  }
}

function populateForm() {
  const s = currentSettings;
  setText("heroTitle", s.hero_title || "");
  setVal("heroBgType", s.hero_bg_type || "color");
  toggleBgType(s.hero_bg_type || "color");
  document.getElementById("heroBgColor").value = s.hero_bg_color || "#8b1a1a";

  const G = window.FMRC_HERO_GRADIENTS;
  heroBgGradient = s.hero_bg_gradient || (G ? G.DEFAULT_ID : "");
  renderHeroGradients();

  // Brand logos: a blank setting means "on the bundled default".
  BRAND_LOGOS.forEach(function (conf) {
    brandLogoData[conf.slot] = s[conf.key] || "";
  });
  renderBrandLogos();

  if (s.hero_bg_image) {
    setImgPreview("heroBgImgPreview", "heroBgImgPlaceholder", s.hero_bg_image);
    heroBgImageData = s.hero_bg_image;
  }
  if (s.vision_image) {
    setImgPreview("visionImgPreview", "visionImgPlaceholder", s.vision_image);
    visionImageData = s.vision_image;
  }
  if (s.mission_image) {
    setImgPreview(
      "missionImgPreview",
      "missionImgPlaceholder",
      s.mission_image,
    );
    missionImageData = s.mission_image;
  }
  // The decks that sit behind those two single images. Called from here rather
  // than from loadSettings() so every re-populate (including the one after a
  // gallery save) redraws the grids from the server's copy.
  loadGalleries();

  setText("aboutHeading", s.about_heading || "ABOUT US");
  setText("homeSdgHeading", s.home_sdg_heading || "");
  setText("aboutText1", s.about_text_1 || "");
  setText("aboutText2", s.about_text_2 || "");
  // Restore saved video
  if (s.about_video_url) {
    aboutVideoData = s.about_video_url;
    restoreVideoPreview(s.about_video_url);
  }
  setText("visionHeading", s.vision_heading || "OUR VISION");
  setText("visionText", s.vision_text || "");
  setText("missionHeading", s.mission_heading || "OUR MISSION");
  setText("missionText", s.mission_text || "");
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

// ── API: Load services ────────────────────────────────────────────────────────
async function loadServices() {
  try {
    const res = await fetch(`${API}/services`);
    const json = await res.json();
    servicesData = json.data || [];
    renderServiceCards();
  } catch {
    document.getElementById("homeServicesGrid").innerHTML =
      '<p style="color:#9ca3af;text-align:center;padding:20px;grid-column:1/-1;">Failed to load services.</p>';
  }
}

function renderServiceCards() {
  const grid = document.getElementById("homeServicesGrid");
  if (!servicesData.length) {
    grid.innerHTML =
      '<p style="color:#9ca3af;text-align:center;padding:20px;grid-column:1/-1;">No services yet. Add one!</p>';
    return;
  }
  grid.innerHTML = servicesData
    .map(
      (s) => `
    <div class="wm-service-card">
      <div class="card-img">
        ${
          s.image_data
            ? `<img src="${s.image_data}" alt="${s.title}" />`
            : `<span class="no-img"><i class="fa-regular fa-image"></i></span>`
        }
      </div>
      <div class="card-body">
        <div class="card-cat">${s.category}</div>
        <div class="card-title">${s.title}</div>
        <div class="card-desc">${s.description || ""}</div>
      </div>
      <div class="card-actions">
        <button class="btn-edit-sm" onclick="openEditService(${s.id})"><i class="fa-regular fa-pen-to-square"></i> Edit</button>
        <button class="btn-del-sm" onclick="deleteService(${s.id},'${escHtml(s.title)}')"><i class="fa-solid fa-trash"></i> Delete</button>
      </div>
    </div>
  `,
    )
    .join("");
}

function escHtml(str) {
  return (str || "").replace(/'/g, "\\'");
}

// ── Save All ──────────────────────────────────────────────────────────────────
function bindEvents() {
  document.getElementById("btnSaveAllHome").addEventListener("click", () => {
    window.showAdminConfirmPopup(
      "Save all Home page changes to the live website?",
      {
        title: "Save All Changes",
        confirmText: "Save",
        onConfirm: doSaveAll,
      },
    );
  });

  document.getElementById("heroBgType").addEventListener("change", function () {
    toggleBgType(this.value);
  });

  // Gradient presets: one delegated listener, so re-rendering the swatches
  // never leaves stale handlers behind.
  document
    .getElementById("heroGradientGrid")
    ?.addEventListener("click", function (ev) {
      const btn = ev.target?.closest?.("[data-grad]");
      if (!btn) return;
      heroBgGradient = btn.getAttribute("data-grad");
      renderHeroGradients();
    });

  // Brand logos share one hidden file input, the way the SDG grid does.
  document
    .getElementById("brandLogoInput")
    ?.addEventListener("change", function () {
      const file = this.files[0];
      this.value = "";
      if (!file || !logoUploadSlot) return;
      const reader = new FileReader();
      const slot = logoUploadSlot;
      reader.onload = (e) => {
        logoCropData = e.target.result;
        openCropModal("logo:" + slot);
      };
      reader.readAsDataURL(file);
    });

  // Image file inputs
  setupImgInput(
    "heroBgImgInput",
    "heroBgImgPreview",
    "heroBgImgPlaceholder",
    (b64) => {
      heroBgImageData = b64;
      openCropModal("heroBg");
    },
  );
  // Vision and Mission photos go through the same fitter as the SDG badges and
  // the brand logos: the frame is the shape the deck draws on the home page, so
  // what is framed here is what the visitor sees. Cancelling puts the preview
  // back (see closeCropModal), and Apply replaces it with the fitted JPEG —
  // which is also what stops a 4MB phone photo being stored as-is.
  setupImgInput(
    "visionImgInput",
    "visionImgPreview",
    "visionImgPlaceholder",
    (b64) => {
      vmCropData = b64;
      openCropModal("vm:vision:single");
    },
  );
  setupImgInput(
    "missionImgInput",
    "missionImgPreview",
    "missionImgPlaceholder",
    (b64) => {
      vmCropData = b64;
      openCropModal("vm:mission:single");
    },
  );
  setupImgInput(
    "svcImgInput",
    "svcImgPreview",
    "svcImgPlaceholder",
    (b64) => {
      svcImageData = b64;
    },
    true,
  ); // requireSquare = true for service card images

  // Gallery pickers. These bypass setupImgInput() on purpose: it stores the raw
  // FileReader result, and a gallery of ten untouched phone photos would be
  // downloaded by every visitor on their first page load. Every pick goes to the
  // fitter instead, which is what fixes the size *and* lets the operator choose
  // what stays in frame; the fitter's Apply is what saves the deck.
  Object.keys(GALLERIES).forEach(function (kind) {
    const conf = GALLERIES[kind];
    const input = document.getElementById(conf.input);
    if (!input) return;
    input.addEventListener("change", function () {
      const file = this.files && this.files[0];
      this.value = "";
      if (!file) return;
      if (!/^image\//.test(file.type || "")) {
        window.showAdminPopup("Pick an image file for the gallery.", {
          title: "Not an image",
        });
        return;
      }
      const target = galleryUploadTarget || { kind: kind, index: null };
      galleryUploadTarget = null;
      const isAppend = target.index === null || target.index === undefined;
      if (isAppend && galleryData[target.kind].length >= GALLERY_MAX) return;
      const reader = new FileReader();
      reader.onerror = () =>
        window.showAdminPopup(
          "That image could not be read. Try a different file.",
          { title: "Upload failed" },
        );
      reader.onload = (e) => {
        vmCropData = e.target.result;
        openCropModal(
          "vm:" + target.kind + ":" + (isAppend ? "add" : target.index),
        );
      };
      reader.readAsDataURL(file);
    });
  });

  // Crop sliders
  document.getElementById("cropScale").addEventListener("input", function () {
    cropScale = Number(this.value);
    document.getElementById("cropScaleVal").textContent = cropScale + "%";
    applyCropTransform();
  });
  document.getElementById("cropRotate").addEventListener("input", function () {
    cropRotate = Number(this.value);
    document.getElementById("cropRotateVal").textContent = cropRotate + "°";
    applyCropTransform();
  });
  document
    .getElementById("btnApplyCrop")
    .addEventListener("click", applyCropAndSave);

  // Service modal save
  document
    .getElementById("btnSaveService")
    .addEventListener("click", saveService);

  // Add service
  document.getElementById("btnAddService").addEventListener("click", () => {
    openAddService();
  });

  // Chip input
  setupChipInput("svcFeaturesArea", "svcFeaturesInput");

  // Crop drag
  const circle = document.getElementById("cropCircle");
  circle.addEventListener("mousedown", startDrag);
  window.addEventListener("mousemove", doDrag);
  window.addEventListener("mouseup", endDrag);

  // ── SDG badges ──
  document
    .getElementById("btnFitCrop")
    ?.addEventListener("click", fitCropToCircle);
  document
    .getElementById("btnFillCrop")
    ?.addEventListener("click", fillCropToFrame);

  // Shared grid file input: "+ Upload SDG" (new) and "Replace" (existing).
  document
    .getElementById("homeSdgInput")
    ?.addEventListener("change", function () {
      const file = this.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        sdgImageData = e.target.result;
        openCropModal("sdg:grid");
      };
      reader.readAsDataURL(file);
      this.value = "";
    });

  // Modal file input: replaces the image of the badge open in #sdgModal.
  document
    .getElementById("sdgModalImgInput")
    ?.addEventListener("change", function () {
      const file = this.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        sdgImageData = e.target.result;
        setImgPreview("sdgImgPreview", "sdgImgPlaceholder", sdgImageData);
        openCropModal("sdg:modal");
      };
      reader.readAsDataURL(file);
      this.value = "";
    });

  document.getElementById("btnSdgModalCrop")?.addEventListener("click", () => {
    if (!sdgImageData) {
      window.showAdminPopup(
        "Upload an image first, then fit it in the circle.",
      );
      return;
    }
    openCropModal("sdg:modal");
  });

  document.getElementById("btnSaveSdg")?.addEventListener("click", saveSdg);
}

function toggleBgType(type) {
  document.getElementById("heroBgColorRow").style.display =
    type === "color" ? "flex" : "none";
  document.getElementById("heroBgImageRow").style.display =
    type === "image" ? "block" : "none";
  const gradRow = document.getElementById("heroBgGradientRow");
  if (gradRow) gradRow.style.display = type === "gradient" ? "block" : "none";
}

/**
 * Gradient swatches, built from the shared preset list. Each chip paints the
 * preset's own CSS (scaled for a small tile), so what the admin clicks is
 * literally what the hero renders.
 */
function renderHeroGradients() {
  const grid = document.getElementById("heroGradientGrid");
  const G = window.FMRC_HERO_GRADIENTS;
  if (!grid) return;
  if (!G) {
    grid.innerHTML =
      '<p class="field-hint" style="grid-column:1/-1">Gradient presets could not be loaded.</p>';
    return;
  }
  grid.innerHTML = G.presets
    .map(function (p) {
      const on = p.id === heroBgGradient;
      return (
        '<button type="button" class="wm-grad-swatch' +
        (on ? " is-selected" : "") +
        '" data-grad="' +
        sdgEsc(p.id) +
        '" title="' +
        sdgEsc(p.label) +
        '" aria-pressed="' +
        (on ? "true" : "false") +
        '">' +
        '<span class="wm-grad-chip" style="background:' +
        G.swatch(p.id) +
        '"></span>' +
        '<span class="wm-grad-label">' +
        sdgEsc(p.label) +
        "</span>" +
        (on
          ? '<span class="wm-grad-check"><i class="fa-solid fa-check"></i></span>'
          : "") +
        "</button>"
      );
    })
    .join("");
}

// ── Brand logos ───────────────────────────────────────────────────────────────
function logoConf(slot) {
  return BRAND_LOGOS.find((l) => l.slot === slot) || null;
}

/** Slot cards showing what each holder currently renders on the live site. */
function renderBrandLogos() {
  const grid = document.getElementById("brandLogoGrid");
  if (!grid) return;
  grid.innerHTML = BRAND_LOGOS.map(function (conf) {
    const custom = !!brandLogoData[conf.slot];
    const src = custom ? brandLogoData[conf.slot] : conf.fallback;
    return (
      '<div class="wm-logo-slot">' +
      '<span class="wm-logo-name">' +
      sdgEsc(conf.label) +
      "</span>" +
      '<div class="wm-logo-thumb ' +
      (conf.shape === "square" ? "is-square" : "is-circle") +
      '"><img src="' +
      src +
      '" alt="' +
      sdgEsc(conf.label) +
      '" /></div>' +
      '<span class="wm-logo-tag' +
      (custom ? " is-custom" : "") +
      '">' +
      (custom ? "Custom upload" : "Default artwork") +
      "</span>" +
      '<p class="wm-logo-hint">' +
      sdgEsc(conf.hint) +
      "</p>" +
      '<div class="wm-logo-actions">' +
      '<button class="btn-edit-sm" type="button" onclick="openLogoUpload(\'' +
      conf.slot +
      '\')"><i class="fa-regular fa-image"></i> Upload</button>' +
      '<button class="btn-edit-sm" type="button" onclick="adjustLogo(\'' +
      conf.slot +
      "')\" " +
      (custom ? "" : "disabled") +
      '><i class="fa-solid fa-crop-simple"></i> Adjust</button>' +
      '<button class="btn-del-sm" type="button" onclick="resetLogo(\'' +
      conf.slot +
      "')\" " +
      (custom ? "" : "disabled") +
      '><i class="fa-solid fa-rotate-left"></i> Default</button>' +
      "</div>" +
      "</div>"
    );
  }).join("");
}

/** Open the shared picker for one slot. */
function openLogoUpload(slot) {
  if (!logoConf(slot)) return;
  logoUploadSlot = slot;
  const input = document.getElementById("brandLogoInput");
  if (!input) return;
  input.value = "";
  input.click();
}

/** Re-open the editor on the artwork already saved for a slot. */
function adjustLogo(slot) {
  const conf = logoConf(slot);
  if (!conf || !brandLogoData[slot]) return;
  logoUploadSlot = slot;
  logoCropData = brandLogoData[slot];
  openCropModal("logo:" + slot);
}

/** Clear a slot: "" persists, and every customer page falls back to the bundled art. */
function resetLogo(slot) {
  const conf = logoConf(slot);
  if (!conf || !brandLogoData[slot]) return;
  window.showAdminConfirmPopup(
    `Restore the default artwork for ${conf.label}? The uploaded image will be removed from the live site.`,
    {
      title: "Restore Default",
      confirmText: "Restore",
      onConfirm: () =>
        saveLogoSetting(conf, "", `${conf.label} restored to default.`),
    },
  );
}

/**
 * One-key PUT. /admin/site-settings upserts whatever keys the body carries, so a
 * single logo saves on its own without touching the fields the admin is still
 * editing elsewhere on the page.
 */
async function saveLogoSetting(conf, value, successMsg) {
  const payload = {};
  payload[conf.key] = value;
  try {
    const res = await fetch(`${API}/admin/site-settings`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token(),
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("Save failed");
    brandLogoData[conf.slot] = value;
    renderBrandLogos();
    window.showAdminPopup(successMsg, { title: "Saved!" });
    broadcastSiteUpdate("updated");
    await loadSettings();
  } catch {
    window.showAdminPopup(
      `Failed to save ${conf.label}. Check your connection and try again.`,
      { title: "Error" },
    );
  }
}

async function doSaveAll() {
  const saveButton = document.getElementById("btnSaveAllHome");
  const originalSaveButtonHtml = saveButton?.innerHTML || "";
  if (saveButton) {
    saveButton.disabled = true;
    saveButton.innerHTML =
      '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
  }

  const payload = {
    hero_title: document.getElementById("heroTitle").value,
    hero_bg_type: document.getElementById("heroBgType").value,
    hero_bg_color: document.getElementById("heroBgColor").value,
    hero_bg_gradient: heroBgGradient || "",
    hero_bg_image: heroBgImageData || "",
    // hero_logo_image is deliberately absent: the Brand Logos section saves it
    // the moment a crop is applied, so re-sending it here could only overwrite a
    // newer upload with whatever this form happened to load with.
    home_sdg_heading: document.getElementById("homeSdgHeading")?.value || "",
    about_heading: document.getElementById("aboutHeading").value,
    about_text_1: document.getElementById("aboutText1").value,
    about_text_2: document.getElementById("aboutText2").value,
    about_video_url: aboutVideoData || "",
    vision_heading: document.getElementById("visionHeading").value,
    vision_text: document.getElementById("visionText").value,
    vision_image: visionImageData || "",
    mission_heading: document.getElementById("missionHeading").value,
    mission_text: document.getElementById("missionText").value,
    mission_image: missionImageData || "",
  };

  try {
    const res = await fetch(`${API}/admin/site-settings`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token(),
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("Save failed");
    window.showAdminPopup("Home page settings saved successfully!", {
      title: "Saved!",
    });
    broadcastSiteUpdate("updated");
    await loadSettings();
  } catch {
    window.showAdminPopup(
      "Failed to save. Check your connection and try again.",
      { title: "Error" },
    );
  } finally {
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.innerHTML =
        originalSaveButtonHtml ||
        '<i class="fa-solid fa-floppy-disk"></i> Save All Changes';
    }
  }
}

// ── Service CRUD ──────────────────────────────────────────────────────────────
function openAddService() {
  svcImageData = null;
  document.getElementById("serviceEditId").value = "";
  document.getElementById("serviceModalTitle").textContent = "Add Service Card";
  clearServiceModal();
  document.getElementById("serviceModal").classList.add("show");
}

function openEditService(id) {
  const svc = servicesData.find((s) => s.id === id);
  if (!svc) return;
  svcImageData = svc.image_data || null;
  document.getElementById("serviceEditId").value = id;
  document.getElementById("serviceModalTitle").textContent =
    "Edit Service Card";

  document.getElementById("svcTitle").value = svc.title || "";
  document.getElementById("svcCategory").value = svc.category || "Prototyping";
  document.getElementById("svcDesc").value = svc.description || "";

  // Image
  if (svc.image_data) {
    setImgPreview("svcImgPreview", "svcImgPlaceholder", svc.image_data);
  } else {
    resetImgPreview("svcImgPreview", "svcImgPlaceholder");
  }

  document.getElementById("serviceModal").classList.add("show");
}

function closeServiceModal() {
  document.getElementById("serviceModal").classList.remove("show");
}

function clearServiceModal() {
  document.getElementById("svcTitle").value = "";
  document.getElementById("svcCategory").value = "Prototyping";
  document.getElementById("svcDesc").value = "";
  resetImgPreview("svcImgPreview", "svcImgPlaceholder");
}

async function saveService() {
  const id = document.getElementById("serviceEditId").value;
  const title = document.getElementById("svcTitle").value.trim();
  const category = document.getElementById("svcCategory").value;
  if (!title) {
    window.showAdminPopup("Please enter a service title.");
    return;
  }

  const payload = {
    title,
    category,
    description: document.getElementById("svcDesc").value,
    image_data: svcImageData || null,
    sort_order: id
      ? servicesData.find((s) => s.id == id)?.sort_order || 0
      : servicesData.length,
  };

  const action = id
    ? () =>
        window.showAdminConfirmPopup(`Save changes to "${title}"?`, {
          title: "Confirm Edit",
          confirmText: "Save",
          onConfirm: () => doSaveService("PUT", id, payload),
        })
    : () =>
        window.showAdminConfirmPopup(`Add "${title}" as a new service?`, {
          title: "Confirm Add",
          confirmText: "Add",
          onConfirm: () => doSaveService("POST", null, payload),
        });
  action();
}

async function doSaveService(method, id, payload) {
  const url = id ? `${API}/admin/services/${id}` : `${API}/admin/services`;
  try {
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
    closeServiceModal();
    window.showAdminPopup("Service saved successfully!", { title: "Saved!" });
    await loadServices();
  } catch {
    window.showAdminPopup("Failed to save service. Try again.", {
      title: "Error",
    });
  }
}

function deleteService(id, name) {
  window.showAdminConfirmPopup(
    `Delete "${name}"? This will remove it from both the Home and Services pages.`,
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
          window.showAdminPopup("Failed to delete service.", {
            title: "Error",
          });
        }
      },
    },
  );
}

// ── Image helpers ─────────────────────────────────────────────────────────────
function setupImgInput(
  inputId,
  previewId,
  placeholderId,
  callback,
  requireSquare = false,
) {
  const inputEl = document.getElementById(inputId);
  if (!inputEl) return; // field not present on this page
  inputEl.addEventListener("change", function () {
    const file = this.files[0];
    if (!file) return;

    // For service card images, validate 1:1 aspect ratio
    if (requireSquare) {
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
          const b64 = e.target.result;
          setImgPreview(previewId, placeholderId, b64);
          callback(b64);
        };
      };
      reader.readAsDataURL(file);
    } else {
      // No aspect ratio requirement
      const reader = new FileReader();
      reader.onload = (e) => {
        const b64 = e.target.result;
        setImgPreview(previewId, placeholderId, b64);
        callback(b64);
      };
      reader.readAsDataURL(file);
    }
  });
}

// ── Video upload helpers ──────────────────────────────────────────────────────
function handleVideoUpload(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    aboutVideoData = e.target.result;
    restoreVideoPreview(aboutVideoData, file.name);
  };
  reader.readAsDataURL(file);
}

function restoreVideoPreview(src, fileName) {
  const preview = document.getElementById("aboutVideoPreview");
  const placeholder = document.getElementById("aboutVideoPlaceholder");
  const removeBtn = document.getElementById("aboutVideoRemoveBtn");
  const fileNameEl = document.getElementById("aboutVideoFileName");
  if (preview) {
    preview.src = src;
    preview.style.display = "block";
  }
  if (placeholder) placeholder.classList.add("hidden");
  if (removeBtn) removeBtn.style.display = "inline-flex";
  if (fileNameEl && fileName) {
    fileNameEl.textContent = fileName;
    fileNameEl.style.display = "block";
  }
}

function clearVideoUpload() {
  aboutVideoData = null;
  const preview = document.getElementById("aboutVideoPreview");
  const placeholder = document.getElementById("aboutVideoPlaceholder");
  const removeBtn = document.getElementById("aboutVideoRemoveBtn");
  const fileNameEl = document.getElementById("aboutVideoFileName");
  const input = document.getElementById("aboutVideoInput");
  if (preview) {
    preview.src = "";
    preview.style.display = "none";
  }
  if (placeholder) placeholder.classList.remove("hidden");
  if (removeBtn) removeBtn.style.display = "none";
  if (fileNameEl) {
    fileNameEl.textContent = "";
    fileNameEl.style.display = "none";
  }
  if (input) input.value = "";
}

function setImgPreview(previewId, placeholderId, src) {
  const preview = document.getElementById(previewId);
  const placeholder = document.getElementById(placeholderId);
  const removeBtn = document.getElementById(previewId + "RemoveBtn");
  // Only the Vision/Mission photos have a re-fit button; it rides the same
  // show/hide as Remove because both only make sense once a photo is there.
  const fitBtn = document.getElementById(previewId + "FitBtn");
  if (preview) {
    preview.src = src;
    preview.classList.add("visible");
  }
  if (placeholder) placeholder.classList.add("hidden");
  if (removeBtn) removeBtn.style.display = "inline-flex";
  if (fitBtn) fitBtn.style.display = "inline-flex";
}

function resetImgPreview(previewId, placeholderId) {
  const preview = document.getElementById(previewId);
  const placeholder = document.getElementById(placeholderId);
  const removeBtn = document.getElementById(previewId + "RemoveBtn");
  const fitBtn = document.getElementById(previewId + "FitBtn");
  if (preview) {
    preview.src = "";
    preview.classList.remove("visible");
  }
  if (placeholder) placeholder.classList.remove("hidden");
  if (removeBtn) removeBtn.style.display = "none";
  if (fitBtn) fitBtn.style.display = "none";
}

/** Re-frame the stored fallback photo without picking the file again. */
function adjustSingleFit(kind) {
  const src = kind === "mission" ? missionImageData : visionImageData;
  if (!src) return;
  vmCropData = src;
  openCropModal("vm:" + kind + ":single");
}

function clearImage(target) {
  if (target === "heroBg") {
    heroBgImageData = null;
    resetImgPreview("heroBgImgPreview", "heroBgImgPlaceholder");
  } else if (target === "vision") {
    visionImageData = null;
    resetImgPreview("visionImgPreview", "visionImgPlaceholder");
  } else if (target === "mission") {
    missionImageData = null;
    resetImgPreview("missionImgPreview", "missionImgPlaceholder");
  } else if (target === "svc") {
    svcImageData = null;
    resetImgPreview("svcImgPreview", "svcImgPlaceholder");
  }
}

// ── Crop ──────────────────────────────────────────────────────────────────────
function isSdgCrop(target) {
  return typeof target === "string" && target.startsWith("sdg");
}

function isLogoCrop(target) {
  return typeof target === "string" && target.startsWith("logo:");
}

function cropLogoSlot(target) {
  return isLogoCrop(target) ? target.slice(5) : null;
}

function isVmCrop(target) {
  return typeof target === "string" && target.startsWith("vm:");
}

/**
 * `vm:<kind>:<slot>` → what the fitter should do once the operator hits Apply.
 * `single` is the one photo the section falls back to when its deck is empty,
 * `add` appends to the deck, and a number replaces that deck slot in place.
 */
function cropVmParts(target) {
  if (!isVmCrop(target)) return null;
  const bits = String(target).split(":");
  const kind = bits[1] === "mission" ? "mission" : "vision";
  const slot = bits[2] || "single";
  if (slot === "single") return { kind, mode: "single", index: null };
  if (slot === "add") return { kind, mode: "add", index: null };
  return { kind, mode: "index", index: Number(slot) };
}

/** Move slider, readout and crop state to one scale, clamped to the slider. */
function setCropScale(pct) {
  const slider = document.getElementById("cropScale");
  const min = slider ? Number(slider.min) || 50 : 50;
  const max = slider ? Number(slider.max) || 300 : 300;
  cropScale = Math.min(max, Math.max(min, Math.round(pct)));
  if (slider) slider.value = cropScale;
  const out = document.getElementById("cropScaleVal");
  if (out) out.textContent = cropScale + "%";
}

/**
 * The scale at which the photo just covers the frame — the sensible start state,
 * and the one that reproduces what the gallery used to store automatically. The
 * preview img is capped at 100% of the frame, so scale 100 is "whole photo
 * visible" and anything above it crops.
 */
function vmFrameCoverScale(conf) {
  const imgEl = document.getElementById("cropImg");
  const wrapper = document.getElementById("cropCircle");
  if (!imgEl || !wrapper) return 100;
  const fw = wrapper.clientWidth || conf.width;
  const fh = wrapper.clientHeight || conf.height;
  const iw = imgEl.offsetWidth || imgEl.naturalWidth || fw;
  const ih = imgEl.offsetHeight || imgEl.naturalHeight || fh;
  if (!iw || !ih) return 100;
  return Math.max(100, Math.round(Math.max(fw / iw, fh / ih) * 100));
}

/** Cover the frame, and give the slider room to go further than 300%. */
function vmApplyCoverDefault(conf) {
  const slider = document.getElementById("cropScale");
  vmCoverScale = vmFrameCoverScale(conf);
  if (slider) slider.max = String(Math.max(300, vmCoverScale + 200));
  setCropScale(vmCoverScale);
  applyCropTransform();
}

function openCropModal(target) {
  cropTarget = target;
  cropOffsetX = 0;
  cropOffsetY = 0;
  cropScale = 100;
  cropRotate = 0;
  document.getElementById("cropScale").value = 100;
  document.getElementById("cropScaleVal").textContent = "100%";
  document.getElementById("cropRotate").value = 0;
  document.getElementById("cropRotateVal").textContent = "0°";

  const sdg = isSdgCrop(target);
  const logo = isLogoCrop(target);
  const vm = cropVmParts(target);
  const conf = logo ? logoConf(cropLogoSlot(target)) : null;
  const vmConf = vm ? GALLERIES[vm.kind] : null;
  const src = sdg
    ? sdgImageData
    : logo
      ? logoCropData
      : vm
        ? vmCropData
        : heroBgImageData;
  const imgEl = document.getElementById("cropImg");
  const circle = document.getElementById("cropCircle");
  const fitBtn = document.getElementById("btnFitCrop");
  const fillBtn = document.getElementById("btnFillCrop");
  const scaleInput = document.getElementById("cropScale");

  // SDG badges and brand logos must fit *entirely* inside the holder, so the
  // preview is constrained to the wrapper: at 100% the browser letterboxes the
  // image instead of drawing it at natural size (which center-crops big
  // uploads). Vision/Mission photos want the same constraint for the opposite
  // reason — it makes 100% mean "whole photo", so "Fit whole photo" and "Fill
  // frame" are two ends of one slider. The hero background path keeps its
  // unconstrained behaviour.
  if (sdg || logo || vm) {
    imgEl.style.maxWidth = "100%";
    imgEl.style.maxHeight = "100%";
    circle?.classList.toggle("is-transparent", !vm);
    if (fitBtn) {
      fitBtn.style.display = "inline-flex";
      // The button label names the holder the artwork snaps back into.
      const shapeWord = conf && conf.shape === "square" ? "square" : "circle";
      fitBtn.innerHTML = vm
        ? '<i class="fa-solid fa-compress"></i> Fit whole photo'
        : `<i class="fa-solid fa-compress"></i> Fit to ${shapeWord}`;
    }
  } else {
    imgEl.style.maxWidth = "";
    imgEl.style.maxHeight = "";
    circle?.classList.remove("is-transparent");
    if (fitBtn) fitBtn.style.display = "none";
  }
  // "Fill frame" only means something where the frame has a shape to fill.
  if (fillBtn) fillBtn.style.display = vm ? "inline-flex" : "none";
  // Photos routinely need more than 300% to cover a tall frame; that ceiling is
  // raised per-photo once its size is known (vmApplyCoverDefault).
  if (scaleInput && !vm) scaleInput.max = "300";

  // The navbar emblem sits in a square holder on the live site, so its editor
  // shows a square too — the frame has to match what the visitor will see. Same
  // rule for the two home-page decks: Vision is a 16:10 card, Mission is the
  // organic blob, and the frame here is that exact silhouette.
  circle?.classList.toggle("is-square", !!conf && conf.shape === "square");
  circle?.classList.toggle("is-wide-frame", !!vm && vm.kind === "vision");
  circle?.classList.toggle("is-blob-frame", !!vm && vm.kind === "mission");

  // Covering the frame is the start state, worked out from the photo's own size,
  // so it can only be measured once the browser has laid the image out.
  imgEl.onload = vmConf ? () => vmApplyCoverDefault(vmConf) : null;
  imgEl.src = src;
  cropImgNaturalSrc = src;
  if (vmConf && imgEl.complete && imgEl.naturalWidth) {
    setTimeout(() => vmApplyCoverDefault(vmConf), 0);
  }

  const title = sdg
    ? "Fit SDG in Circle"
    : vmConf
      ? `Fit ${vmConf.label} Photo`
      : conf
        ? `Fit ${conf.label} in ${conf.shape === "square" ? "Square" : "Circle"}`
        : "Adjust Background Image";
  document.getElementById("cropModalTitle").textContent = title;

  const hintEl = document.getElementById("cropModalHint");
  if (hintEl) {
    const holder = conf && conf.shape === "square" ? "square" : "circle";
    hintEl.textContent = vmConf
      ? "The frame is the exact shape the home page draws. Drag the photo to choose what stays in view, then resize and rotate."
      : sdg || logo
        ? `Drag the image to position it within the ${holder}. Use the sliders to resize and rotate.`
        : "Drag the image to position it. Use the sliders to resize and rotate.";
  }

  applyCropTransform();
  document.getElementById("cropModal").classList.add("show");
}

/** Back to the fully-contained default: whole badge visible, no offset/rotation. */
function fitCropToCircle() {
  cropOffsetX = 0;
  cropOffsetY = 0;
  cropRotate = 0;
  document.getElementById("cropRotate").value = 0;
  document.getElementById("cropRotateVal").textContent = "0°";
  setCropScale(100);
  applyCropTransform();
}

/** The other end of the same slider: photo covers the frame, nothing letterboxed. */
function fillCropToFrame() {
  cropOffsetX = 0;
  cropOffsetY = 0;
  cropRotate = 0;
  document.getElementById("cropRotate").value = 0;
  document.getElementById("cropRotateVal").textContent = "0°";
  setCropScale(vmCoverScale);
  applyCropTransform();
}

/**
 * setupImgInput() paints the preview *before* it hands the photo to the fitter, so
 * a cancelled fit would leave the raw upload on screen while the stored value is
 * still the old photo. Repaint from state, whatever that state now is.
 */
function restoreVmSinglePreview(kind) {
  const prefix = kind === "mission" ? "mission" : "vision";
  const data = prefix === "mission" ? missionImageData : visionImageData;
  if (data) {
    setImgPreview(prefix + "ImgPreview", prefix + "ImgPlaceholder", data);
  } else {
    resetImgPreview(prefix + "ImgPreview", prefix + "ImgPlaceholder");
  }
}

function closeCropModal() {
  document.getElementById("cropModal").classList.remove("show");
  const vm = cropVmParts(cropTarget);
  if (vm && vm.mode === "single") restoreVmSinglePreview(vm.kind);
  vmCropData = null;
}

function applyCropTransform() {
  const imgEl = document.getElementById("cropImg");
  imgEl.style.transform = `translate(${cropOffsetX}px, ${cropOffsetY}px) scale(${cropScale / 100}) rotate(${cropRotate}deg)`;
}

function applyCropAndSave() {
  if (isSdgCrop(cropTarget)) {
    applySdgCropAndSave();
    return;
  }
  if (isLogoCrop(cropTarget)) {
    applyLogoCropAndSave();
    return;
  }
  if (isVmCrop(cropTarget)) {
    applyVmCropAndSave();
    return;
  }
  // Capture rendered circle area via canvas
  const circle = document.getElementById("cropCircle");
  const imgEl = document.getElementById("cropImg");
  const size = 220;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();

  const rect = circle.getBoundingClientRect();
  const imgRect = imgEl.getBoundingClientRect();
  const dx = imgRect.left - rect.left;
  const dy = imgRect.top - rect.top;
  const scale = cropScale / 100;

  const tmpImg = new Image();
  tmpImg.onload = () => {
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate((cropRotate * Math.PI) / 180);
    ctx.scale(scale, scale);
    ctx.drawImage(
      tmpImg,
      -tmpImg.width / 2 + dx / scale,
      -tmpImg.height / 2 + dy / scale,
    );
    ctx.restore();
    heroBgImageData = canvas.toDataURL("image/jpeg", 0.9);
    setImgPreview("heroBgImgPreview", "heroBgImgPlaceholder", heroBgImageData);
    closeCropModal();
  };
  tmpImg.src = cropImgNaturalSrc;
}

/**
 * Vision/Mission photo fit. Same recomposed-from-state maths as the logo path — a
 * getBoundingClientRect() delta already carries the CSS transform, so it would
 * double-count scale and rotation. Three differences: the output size is the
 * deck's own pixel size from GALLERIES, which is also why the preview frame's
 * aspect ratio has to equal the output's (one uniform frame→canvas `k`); the
 * canvas starts on a white matte because JPEG has no alpha; and the Mission blob
 * is *not* baked in — the live site cuts that silhouette in CSS, so the file
 * stays a full rectangle and stays reusable if the shape ever changes.
 */
function applyVmCropAndSave() {
  const vm = cropVmParts(cropTarget);
  const conf = vm ? GALLERIES[vm.kind] : null;
  if (!vm || !conf) return;

  const imgEl = document.getElementById("cropImg");
  const wrapper = document.getElementById("cropCircle");
  const outW = conf.width;
  const outH = conf.height;
  const D = wrapper?.clientWidth || 214; // frame content box
  const k = outW / D;
  const dispW = imgEl.offsetWidth || imgEl.naturalWidth || D;
  const dispH = imgEl.offsetHeight || imgEl.naturalHeight || D;

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, outW, outH);

  const tmpImg = new Image();
  tmpImg.onload = () => {
    ctx.save();
    // Mirrors the CSS order: translate(...) scale(...) rotate(...).
    ctx.translate(outW / 2 + cropOffsetX * k, outH / 2 + cropOffsetY * k);
    ctx.scale(cropScale / 100, cropScale / 100);
    ctx.rotate((cropRotate * Math.PI) / 180);
    ctx.drawImage(
      tmpImg,
      (-dispW * k) / 2,
      (-dispH * k) / 2,
      dispW * k,
      dispH * k,
    );
    ctx.restore();

    const fitted = canvas.toDataURL("image/jpeg", 0.82);
    if (vm.mode === "single") {
      // The fallback photo is part of the page form, exactly like the hero
      // background: it lands in state and in the preview, and Save Changes is
      // what writes it. Deck slots are their own settings key and save at once.
      if (vm.kind === "mission") missionImageData = fitted;
      else visionImageData = fitted;
      setImgPreview(
        vm.kind + "ImgPreview",
        vm.kind + "ImgPlaceholder",
        fitted,
      );
      closeCropModal();
      return;
    }

    const next = galleryData[vm.kind].slice();
    if (vm.mode === "add") {
      if (next.length >= GALLERY_MAX) {
        closeCropModal();
        return;
      }
      next.push(fitted);
    } else {
      if (vm.index < 0 || vm.index >= next.length) {
        closeCropModal();
        return;
      }
      next[vm.index] = fitted;
    }
    closeCropModal();
    saveGallery(
      vm.kind,
      next,
      vm.mode === "add" ? "Photo added to the deck." : "Photo replaced.",
    );
  };
  tmpImg.src = cropImgNaturalSrc;
}

/**
 * Brand logo crop. Shares the SDG maths — the transform is recomposed from crop
 * *state* against the pre-transform layout size, never from
 * getBoundingClientRect() deltas, which already include the CSS transform and so
 * would double-count scale and rotation. Output is a square PNG on a transparent
 * canvas so logo artwork keeps its transparency; circular slots get an arc clip
 * as well, so the corners the live holder rounds off are already gone.
 */
function applyLogoCropAndSave() {
  const slot = cropLogoSlot(cropTarget);
  const conf = logoConf(slot);
  if (!conf) return;

  const imgEl = document.getElementById("cropImg");
  const wrapper = document.getElementById("cropCircle");
  const S = 512; // exported size — covers the hero circle's ~470px at 1x
  const D = wrapper?.clientWidth || 214; // live holder size (content box)
  const k = S / D;
  const dispW = imgEl.offsetWidth || imgEl.naturalWidth || D;
  const dispH = imgEl.offsetHeight || imgEl.naturalHeight || D;

  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d");
  if (conf.shape === "circle") {
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    ctx.clip();
  }

  const tmpImg = new Image();
  tmpImg.onload = () => {
    ctx.save();
    // Mirrors the CSS order: translate(...) scale(...) rotate(...).
    ctx.translate(S / 2 + cropOffsetX * k, S / 2 + cropOffsetY * k);
    ctx.scale(cropScale / 100, cropScale / 100);
    ctx.rotate((cropRotate * Math.PI) / 180);
    ctx.drawImage(
      tmpImg,
      (-dispW * k) / 2,
      (-dispH * k) / 2,
      dispW * k,
      dispH * k,
    );
    ctx.restore();

    const cropped = canvas.toDataURL("image/png");
    closeCropModal();
    logoCropData = cropped;
    saveLogoSetting(conf, cropped, `${conf.label} updated.`);
  };
  tmpImg.src = cropImgNaturalSrc;
}

/**
 * SDG badge crop. Two deliberate differences from the hero path:
 *  - the transform is recomposed from crop *state* against the pre-transform
 *    layout size, instead of reading getBoundingClientRect() deltas (which
 *    already include the CSS transform and so double-count scale/rotation);
 *  - output is PNG on a transparent canvas, so the corners clipped off by the
 *    circle stay transparent instead of turning into the #111 plate.
 */
function applySdgCropAndSave() {
  const imgEl = document.getElementById("cropImg");
  const wrapper = document.getElementById("cropCircle");
  const S = 256; // exported badge size
  const D = wrapper?.clientWidth || 214; // live circle diameter (content box)
  const k = S / D;
  const dispW = imgEl.offsetWidth || imgEl.naturalWidth || D;
  const dispH = imgEl.offsetHeight || imgEl.naturalHeight || D;

  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d");
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  ctx.clip();

  const tmpImg = new Image();
  tmpImg.onload = () => {
    ctx.save();
    // Mirrors the CSS order: translate(...) scale(...) rotate(...).
    ctx.translate(S / 2 + cropOffsetX * k, S / 2 + cropOffsetY * k);
    ctx.scale(cropScale / 100, cropScale / 100);
    ctx.rotate((cropRotate * Math.PI) / 180);
    ctx.drawImage(
      tmpImg,
      (-dispW * k) / 2,
      (-dispH * k) / 2,
      dispW * k,
      dispH * k,
    );
    ctx.restore();

    const cropped = canvas.toDataURL("image/png");
    sdgImageData = cropped;
    closeCropModal();

    if (cropTarget === "sdg:modal") {
      setImgPreview("sdgImgPreview", "sdgImgPlaceholder", cropped);
      return;
    }
    finishSdgGridUpload(cropped);
  };
  tmpImg.src = cropImgNaturalSrc;
}

/**
 * Grid-initiated crop finished: an existing badge saves straight away, a brand
 * new one opens the detail modal so the admin can type a title first.
 */
function finishSdgGridUpload(cropped) {
  const id = sdgUploadTargetId;
  sdgUploadTargetId = null;

  if (id) {
    const existing = sdgsData.find((s) => s.id === id);
    if (!existing) return;
    doSaveSdg(
      "PUT",
      id,
      {
        title: existing.title,
        description: existing.description || "",
        image_data: cropped,
        sort_order: existing.sort_order,
        is_visible: !!existing.is_visible,
      },
      "Badge image updated.",
    );
    return;
  }
  openSdgModal(null, cropped);
}

function startDrag(e) {
  isDragging = true;
  dragStartX = e.clientX - cropOffsetX;
  dragStartY = e.clientY - cropOffsetY;
  document.getElementById("cropCircle").classList.add("grabbing");
}

function doDrag(e) {
  if (!isDragging) return;
  cropOffsetX = e.clientX - dragStartX;
  cropOffsetY = e.clientY - dragStartY;
  applyCropTransform();
}

function endDrag() {
  isDragging = false;
  document.getElementById("cropCircle").classList.remove("grabbing");
}

// ── Chip input ────────────────────────────────────────────────────────────────
function setupChipInput(areaId, inputId) {
  const area = document.getElementById(areaId);
  const input = document.getElementById(inputId);
  if (!area || !input) return;
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
  chip.innerHTML = `${text}<button class="chip-remove" type="button">×</button>`;
  chip
    .querySelector(".chip-remove")
    .addEventListener("click", () => chip.remove());
  area.insertBefore(chip, input);
}

function renderChips(areaId, inputId, arr) {
  const area = document.getElementById(areaId);
  const input = document.getElementById(inputId);
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

// ── SDG badges (customer home hero strip) ─────────────────────────────────────
/** Tell every open customer/admin tab that site content changed. */
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

/* ==========================================================================
   VISION / MISSION GALLERIES
   --------------------------------------------------------------------------
   Up to ten photos per section, each gallery stored as one JSON array of data
   URLs under a single site_settings key. Those keys needed no migration:
   /admin/site-settings upserts whatever the body carries and `value` is a
   longText — which is what let this ship as a copy-only deploy.

   Two consequences of base64-in-a-setting, both handled here rather than on the
   server:

   * Every upload goes through the fit modal before it is stored, which is what
     holds it to the deck's own pixel size. The customer page polls
     /api/site-settings, so an untouched 4MB phone photo would be paid for on
     every visitor's first load. Fixed output sizes hold a full pair of galleries
     to roughly 2.5MB worst case.
   * The meter under each grid shows what that costs and turns amber past 1.5MB,
     so the size of the decision is visible while it is being made.
   ========================================================================== */
const GALLERY_MAX = 10;

const GALLERIES = {
  vision: {
    key: "vision_gallery",
    label: "Vision",
    grid: "visionGalleryGrid",
    input: "visionGalleryInput",
    meter: "visionGalleryMeter",
    // 16:10 and 1:1 are the ratios `.vision-img` and the mission blob already
    // use on the customer page, so the fit modal frames exactly what the deck
    // will show. `shape` makes the editor thumb match too, so what is previewed
    // here is what the visitor sees.
    width: 1000,
    height: 625,
    shape: "is-wide",
  },
  mission: {
    key: "mission_gallery",
    label: "Mission",
    grid: "missionGalleryGrid",
    input: "missionGalleryInput",
    meter: "missionGalleryMeter",
    width: 760,
    height: 760,
    shape: "is-square",
  },
};

let galleryData = { vision: [], mission: [] };
let galleryUploadTarget = null; // { kind, index }; a null index means "append"

// One save at a time per deck. Every entry point works out its next list from
// `galleryData`, which is only updated once the PUT has come back, so two clicks
// inside one round-trip would both start from the same stale list and the second
// would silently undo the first. Refusing the overlap is the honest behaviour:
// the list on screen is still the truth, and the click just needs repeating.
let gallerySaving = { vision: false, mission: false };

/** Tolerant on purpose: the key is absent until the first upload. */
function parseGallery(raw) {
  if (!raw) return [];
  let list = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list
    .filter((src) => typeof src === "string" && src.trim() !== "")
    .slice(0, GALLERY_MAX);
}

function loadGalleries() {
  Object.keys(GALLERIES).forEach((kind) => {
    galleryData[kind] = parseGallery(currentSettings[GALLERIES[kind].key]);
    renderGallerySlots(kind);
  });
}

/* The grid markup is the SDG grid's, class for class, so this section needs no
   admin CSS of its own beyond the handful of `wm-gal-*` shape overrides that
   turn a round badge thumb into a photo thumb. */
function renderGallerySlots(kind) {
  const conf = GALLERIES[kind];
  const grid = document.getElementById(conf.grid);
  if (!grid) return;
  const list = galleryData[kind];

  const filled = list
    .map(
      (src, i) => `
    <div class="wm-sdg-slot">
      <span class="wm-sdg-slot-index">Photo ${i + 1}${i === 0 ? " — on top" : ""}</span>
      <div class="wm-sdg-thumb wm-gal-thumb ${conf.shape}"><img src="${sdgEsc(src)}" alt="${conf.label} photo ${i + 1}" /></div>
      <div class="wm-sdg-actions">
        <button class="btn-edit-sm wm-sdg-move" title="Move earlier" onclick="moveGalleryImage('${kind}', ${i}, -1)" ${i === 0 ? "disabled" : ""}><i class="fa-solid fa-arrow-left"></i></button>
        <button class="btn-edit-sm wm-sdg-move" title="Move later" onclick="moveGalleryImage('${kind}', ${i}, 1)" ${i === list.length - 1 ? "disabled" : ""}><i class="fa-solid fa-arrow-right"></i></button>
        <button class="btn-edit-sm wm-sdg-move" title="Adjust how this photo sits in the frame" onclick="adjustGalleryFit('${kind}', ${i})"><i class="fa-solid fa-crop-simple"></i></button>
        <button class="btn-edit-sm wm-sdg-move" title="Replace this photo" onclick="openGalleryUpload('${kind}', ${i})"><i class="fa-regular fa-image"></i></button>
        <button class="btn-del-sm" onclick="removeGalleryImage('${kind}', ${i})"><i class="fa-solid fa-trash"></i> Remove</button>
      </div>
    </div>`,
    )
    .join("");

  const empty = Array.from(
    { length: Math.max(0, GALLERY_MAX - list.length) },
    (_, i) => `
    <div class="wm-sdg-slot is-empty">
      <span class="wm-sdg-slot-index">Slot ${list.length + i + 1}</span>
      <button class="wm-sdg-add wm-gal-add ${conf.shape}" type="button" title="Upload a ${conf.label.toLowerCase()} photo"
              onclick="openGalleryUpload('${kind}', null)"><i class="fa-solid fa-plus"></i></button>
      <div class="wm-sdg-title" style="color:#9ca3af;font-weight:600">Upload photo</div>
    </div>`,
  ).join("");

  grid.innerHTML = filled + empty;
  renderGalleryMeter(kind);
}

function renderGalleryMeter(kind) {
  const meter = document.getElementById(GALLERIES[kind].meter);
  if (!meter) return;
  const list = galleryData[kind];
  if (!list.length) {
    meter.textContent =
      "No gallery set — the single image above is used on its own.";
    meter.style.color = "#9ca3af";
    return;
  }
  // Bytes on the wire, not characters of base64: every 4 characters carry 3.
  const bytes = list.reduce(
    (sum, src) => sum + Math.ceil((src.length * 3) / 4),
    0,
  );
  const kb = Math.round(bytes / 1024);
  const size = kb >= 1024 ? (kb / 1024).toFixed(2) + " MB" : kb + " KB";
  const heavy = bytes > 1.5 * 1024 * 1024;
  meter.textContent =
    `${list.length} photo${list.length === 1 ? "" : "s"} · about ${size} added ` +
    `to every visitor's first page load` +
    (heavy ? " — consider trimming this gallery." : ".");
  meter.style.color = heavy ? "#b45309" : "#9ca3af";
}

/** Open the shared picker. index = null appends, an index replaces that photo. */
function openGalleryUpload(kind, index) {
  const conf = GALLERIES[kind];
  if (index === null && galleryData[kind].length >= GALLERY_MAX) {
    window.showAdminPopup(
      `The ${conf.label} deck holds at most ${GALLERY_MAX} photos. Remove one first.`,
      { title: "All slots used" },
    );
    return;
  }
  galleryUploadTarget = { kind, index };
  const input = document.getElementById(conf.input);
  if (!input) return;
  input.value = "";
  input.click();
}

/**
 * Re-frame a photo that is already in the deck. The stored JPEG is the source, so
 * this is a second pass over an already-fitted image rather than over the
 * original upload — good enough to nudge the framing, and it means a saved deck
 * can be corrected without hunting for the file again.
 */
function adjustGalleryFit(kind, index) {
  const src = galleryData[kind] && galleryData[kind][index];
  if (!src) return;
  galleryUploadTarget = null;
  vmCropData = src;
  openCropModal("vm:" + kind + ":" + index);
}

/* Order is the deck order: photo 1 is the card the visitor sees on top. */
function moveGalleryImage(kind, index, dir) {
  const list = galleryData[kind];
  const to = index + dir;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return;
  const next = list.slice();
  next.splice(to, 0, next.splice(index, 1)[0]);
  void saveGallery(kind, next, "Photo order updated.");
}

function removeGalleryImage(kind, index) {
  const next = galleryData[kind].slice();
  if (index < 0 || index >= next.length) return;
  next.splice(index, 1);
  void saveGallery(
    kind,
    next,
    next.length
      ? "Photo removed."
      : "Gallery cleared. The single image above is used on its own again.",
  );
}

/**
 * One-key PUT, shaped on saveLogoSetting(): the gallery saves the moment it is
 * changed and is deliberately absent from doSaveAll()'s payload, so a form that
 * was loaded before an upload cannot overwrite it on the next "Save All".
 */
async function saveGallery(kind, list, successMsg) {
  const conf = GALLERIES[kind];
  if (gallerySaving[kind]) {
    window.showAdminPopup(
      `The ${conf.label} gallery is still saving your last change. Please try again in a moment.`,
      { title: "One at a time" },
    );
    return;
  }
  gallerySaving[kind] = true;
  const payload = {};
  // Always a JSON array, even when empty: "[]" is what tells the customer page
  // to hand the section back to its single-image rules.
  payload[conf.key] = JSON.stringify(list.slice(0, GALLERY_MAX));
  try {
    const res = await fetch(`${API}/admin/site-settings`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token(),
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("Save failed");
    galleryData[kind] = list.slice(0, GALLERY_MAX);
    renderGallerySlots(kind);
    window.showAdminPopup(successMsg, { title: "Saved!" });
    broadcastSiteUpdate("updated");
    await loadSettings();
  } catch {
    window.showAdminPopup(
      `Failed to save the ${conf.label} gallery. Check your connection and try again.`,
      { title: "Error" },
    );
  } finally {
    gallerySaving[kind] = false;
  }
}

function sdgEsc(str) {
  return String(str === null || str === undefined ? "" : str).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}

async function loadSdgs() {
  const grid = document.getElementById("homeSdgGrid");
  if (!grid) return;
  try {
    const res = await fetch(`${API}/admin/site-sdgs`, {
      headers: {
        Authorization: "Bearer " + token(),
        Accept: "application/json",
      },
    });
    if (!res.ok) throw new Error();
    const json = await res.json();
    sdgsData = json.data || [];
    sdgMaxSlots = Number(json.max_slots) || 8;
    renderSdgSlots();
  } catch {
    grid.innerHTML =
      '<p style="color:#9ca3af;text-align:center;padding:20px;grid-column:1/-1;">Failed to load SDG badges.</p>';
  }
}

function renderSdgSlots() {
  const grid = document.getElementById("homeSdgGrid");
  if (!grid) return;

  const filled = sdgsData.map((s, i) => sdgSlotHtml(s, i)).join("");
  const emptySlots = Math.max(0, sdgMaxSlots - sdgsData.length);
  const empty = Array.from(
    { length: emptySlots },
    (_, i) => `
    <div class="wm-sdg-slot is-empty">
      <span class="wm-sdg-slot-index">Slot ${sdgsData.length + i + 1}</span>
      <button class="wm-sdg-add" type="button" title="Upload an SDG badge"
              onclick="openSdgUpload(null)"><i class="fa-solid fa-plus"></i></button>
      <div class="wm-sdg-title" style="color:#9ca3af;font-weight:600">Upload SDG</div>
    </div>`,
  ).join("");

  grid.innerHTML = filled + empty;
}

function sdgSlotHtml(s, i) {
  const isLast = i === sdgsData.length - 1;
  const thumb = s.image_data
    ? `<img src="${s.image_data}" alt="${sdgEsc(s.title)}" />`
    : '<span style="color:#d1d5db"><i class="fa-regular fa-image"></i></span>';
  return `
    <div class="wm-sdg-slot">
      <span class="wm-sdg-slot-index">Slot ${i + 1}</span>
      <div class="wm-sdg-thumb">${thumb}</div>
      <div class="wm-sdg-title">${sdgEsc(s.title)}</div>
      ${s.is_visible ? "" : '<span class="wm-sdg-hidden-tag">Hidden</span>'}
      <div class="wm-sdg-actions">
        <button class="btn-edit-sm wm-sdg-move" title="Move left" onclick="reorderSdg(${s.id}, -1)" ${i === 0 ? "disabled" : ""}><i class="fa-solid fa-arrow-left"></i></button>
        <button class="btn-edit-sm wm-sdg-move" title="Move right" onclick="reorderSdg(${s.id}, 1)" ${isLast ? "disabled" : ""}><i class="fa-solid fa-arrow-right"></i></button>
        <button class="btn-edit-sm" onclick="openSdgModal(${s.id})"><i class="fa-regular fa-pen-to-square"></i> Edit</button>
        <button class="btn-edit-sm" onclick="adjustSdg(${s.id})" ${s.image_data ? "" : "disabled"}><i class="fa-solid fa-crop-simple"></i> Adjust</button>
        <button class="btn-edit-sm wm-sdg-move" title="Replace image" onclick="openSdgUpload(${s.id})"><i class="fa-regular fa-image"></i></button>
        <button class="btn-del-sm" onclick="deleteSdg(${s.id})"><i class="fa-solid fa-trash"></i> Remove</button>
      </div>
    </div>`;
}

/** Open the shared file picker. id = null adds a badge, an id replaces its art. */
function openSdgUpload(id) {
  if (!id && sdgsData.length >= sdgMaxSlots) {
    window.showAdminPopup(
      `The home page shows at most ${sdgMaxSlots} SDG badges. Remove one first.`,
      { title: "All slots used" },
    );
    return;
  }
  sdgUploadTargetId = id || null;
  const input = document.getElementById("homeSdgInput");
  if (!input) return;
  input.value = "";
  input.click();
}

/** Re-open the circle editor on a badge's existing artwork. */
function adjustSdg(id) {
  const sdg = sdgsData.find((s) => s.id === id);
  if (!sdg || !sdg.image_data) return;
  sdgUploadTargetId = id;
  sdgImageData = sdg.image_data;
  openCropModal("sdg:grid");
}

function openSdgModal(id, presetImage) {
  const modal = document.getElementById("sdgModal");
  if (!modal) return;
  const sdg = id ? sdgsData.find((s) => s.id === id) : null;

  document.getElementById("sdgEditId").value = sdg ? sdg.id : "";
  document.getElementById("sdgModalTitle").textContent = sdg
    ? "Edit SDG"
    : "Add SDG";
  document.getElementById("sdgTitle").value = sdg ? sdg.title || "" : "";
  document.getElementById("sdgDescription").value = sdg
    ? sdg.description || ""
    : "";
  document.getElementById("sdgIsVisible").checked = sdg
    ? !!sdg.is_visible
    : true;

  sdgImageData = presetImage || (sdg && sdg.image_data) || null;
  if (sdgImageData) {
    setImgPreview("sdgImgPreview", "sdgImgPlaceholder", sdgImageData);
  } else {
    resetImgPreview("sdgImgPreview", "sdgImgPlaceholder");
  }

  modal.classList.add("show");
}

function closeSdgModal() {
  document.getElementById("sdgModal")?.classList.remove("show");
}

function saveSdg() {
  const id = document.getElementById("sdgEditId").value;
  const title = document.getElementById("sdgTitle").value.trim();
  if (!title) {
    window.showAdminPopup("Please enter a title for this SDG.");
    return;
  }
  if (!sdgImageData) {
    window.showAdminPopup("Please upload an image for this SDG badge.");
    return;
  }
  if (!id && sdgsData.length >= sdgMaxSlots) {
    window.showAdminPopup(
      `The home page shows at most ${sdgMaxSlots} SDG badges. Remove one first.`,
      { title: "All slots used" },
    );
    return;
  }

  const existing = id ? sdgsData.find((s) => s.id == id) : null;
  const payload = {
    title,
    description: document.getElementById("sdgDescription").value,
    image_data: sdgImageData,
    sort_order: existing ? existing.sort_order : sdgsData.length,
    is_visible: document.getElementById("sdgIsVisible").checked,
  };

  window.showAdminConfirmPopup(
    id ? `Save changes to "${title}"?` : `Add "${title}" to the home page?`,
    {
      title: id ? "Confirm Edit" : "Confirm Add",
      confirmText: id ? "Save" : "Add",
      onConfirm: () => doSaveSdg(id ? "PUT" : "POST", id || null, payload),
    },
  );
}

async function doSaveSdg(method, id, payload, successMsg) {
  const url = id ? `${API}/admin/site-sdgs/${id}` : `${API}/admin/site-sdgs`;
  const btn = document.getElementById("btnSaveSdg");
  const btnHtml = btn ? btn.innerHTML : "";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
  }
  try {
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token(),
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.message || "");
    closeSdgModal();
    window.showAdminPopup(successMsg || "SDG badge saved successfully!", {
      title: "Saved!",
    });
    broadcastSiteUpdate("sdgs-updated");
    await loadSdgs();
  } catch (err) {
    window.showAdminPopup(
      (err && err.message) || "Failed to save the SDG badge. Try again.",
      { title: "Error" },
    );
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML =
        btnHtml || '<i class="fa-solid fa-floppy-disk"></i> Save SDG';
    }
  }
}

function deleteSdg(id) {
  const sdg = sdgsData.find((s) => s.id === id);
  if (!sdg) return;
  window.showAdminConfirmPopup(
    `Remove "${sdg.title}" from the home page hero? This cannot be undone.`,
    {
      title: "Remove SDG",
      confirmText: "Remove",
      onConfirm: async () => {
        try {
          const res = await fetch(`${API}/admin/site-sdgs/${id}`, {
            method: "DELETE",
            headers: {
              Authorization: "Bearer " + token(),
              Accept: "application/json",
            },
          });
          if (!res.ok) throw new Error();
          window.showAdminPopup("SDG badge removed.", { title: "Removed" });
          broadcastSiteUpdate("sdgs-updated");
          await loadSdgs();
        } catch {
          window.showAdminPopup("Failed to remove the SDG badge.", {
            title: "Error",
          });
        }
      },
    },
  );
}

/** Move one badge left/right and persist the whole order in one PATCH. */
async function reorderSdg(id, dir) {
  const from = sdgsData.findIndex((s) => s.id === id);
  const to = from + dir;
  if (from < 0 || to < 0 || to >= sdgsData.length) return;

  const ids = sdgsData.map((s) => s.id);
  [ids[from], ids[to]] = [ids[to], ids[from]];

  // Optimistic swap so the arrows feel instant, then reconcile with the server.
  [sdgsData[from], sdgsData[to]] = [sdgsData[to], sdgsData[from]];
  renderSdgSlots();

  try {
    const res = await fetch(`${API}/admin/site-sdgs/reorder`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token(),
        Accept: "application/json",
      },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) throw new Error();
    broadcastSiteUpdate("sdgs-updated");
    await loadSdgs();
  } catch {
    window.showAdminPopup("Failed to reorder the SDG badges.", {
      title: "Error",
    });
    await loadSdgs();
  }
}
