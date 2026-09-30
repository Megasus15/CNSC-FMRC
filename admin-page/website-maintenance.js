/* jshint esversion: 9 */
"use strict";

/**
 * Maintenance Mode control panel (STEP 11, Part B) — ADMIN ONLY.
 *
 * 13 scopes: the whole customer website, 2 account gates, 6 customer pages,
 * and 4 Home-page sections. Each has
 * its own switch and concise message. The full website screen also has its own
 * copy, theme and illustration, edited here before anything is published.
 *
 * Two deliberate choices:
 *
 *  - A switch marks the form dirty instead of publishing straight away, so you
 *    can line several scopes up and take them offline in one move.
 *  - The form stays inert until the first snapshot has been read. Publishing all
 *    scopes from a state that never loaded could switch something off that you
 *    had switched on from another device.
 *
 * The endpoint (PUT /api/admin/maintenance) refuses anything but an admin token,
 * so a staff member who guesses this URL can read the page but never save.
 */

/**
 * The API base resolver every other admin script uses, byte for byte. This file
 * and website-home.js were the last two carrying a shorter inline copy that had
 * no override hook, no branch for `file://` or an empty hostname, and dropped
 * whatever port a non-localhost host was served on — so the panel could point at
 * an address nothing answers on and blame the backend for it.
 */
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

const MAX_LEN = 75;
const SITE_MAX_LEN = 200;
const PAGE_DEFAULTS = {
  eyebrow: "A little work in progress",
  headline: "We’ll be back",
  headline_accent: "soon.",
  supporting_line: "Thank you for your patience.",
  image_url: "",
  image_alt: "Technician maintaining a website server",
  theme: "cream_maroon",
};
const PAGE_LIMITS = { eyebrow: 48, headline: 60, headline_accent: 30, supporting_line: 100, image_alt: 120 };
const PAGE_THEMES = ["cream_maroon", "warm_maroon", "soft_gold"];
const DEFAULT_IMAGE = "../home-page/maintenance-illustration.svg?v=2.1";

/** Keys and default wording mirror MaintenanceSetting::DEFAULTS exactly. */
const SCOPES = [
  {
    key: "site_portal",
    group: "mtRowsWebsite",
    icon: "fa-solid fa-globe",
    label: "Customer Website",
    hint: "Takes the public website at ucn-fabmanlab.com offline for guests and customers. Admin and Staff portals remain available.",
    def: "The FMRC website is temporarily unavailable. Please check back soon.",
  },
  {
    key: "customer_register",
    group: "mtRowsAccess",
    icon: "fa-solid fa-user-plus",
    label: "Customer Registration",
    hint: "Blocks new accounts from the sign-up form and from Google sign-up.",
    def: "Account registration is temporarily closed for scheduled maintenance.",
  },
  {
    key: "customer_login",
    group: "mtRowsAccess",
    icon: "fa-solid fa-right-to-bracket",
    label: "Customer Sign-In",
    hint: "Refuses new customer log-ins. Anyone already signed in stays signed in.",
    def: "Customer sign-in is temporarily unavailable while we perform maintenance.",
  },
  {
    key: "page_home",
    group: "mtRowsPages",
    icon: "fa-solid fa-house",
    label: "Home Page",
    hint: "Covers the Home page and its sections. The separate About Us page stays available.",
    def: "Our home page is briefly offline for maintenance. Please check back soon.",
  },
  {
    key: "page_about",
    group: "mtRowsPages",
    icon: "fa-solid fa-circle-info",
    label: "About Us Page",
    hint: "Takes only the standalone About Us page offline. The Home page About section remains available.",
    def: "The About Us page is under maintenance. Please check back shortly.",
  },
  {
    key: "page_services",
    group: "mtRowsPages",
    icon: "fa-solid fa-screwdriver-wrench",
    label: "Services Page",
    hint: "Hides the services list and its filters.",
    def: "The Services page is under maintenance. It will be back shortly.",
  },
  {
    key: "page_products",
    group: "mtRowsPages",
    icon: "fa-solid fa-box-open",
    label: "Products Page & My Orders",
    hint: "Hides the catalogue, the cart and My Orders, and refuses new orders.",
    def: "The Products page is under maintenance. Orders will reopen shortly.",
  },
  {
    key: "page_contact",
    group: "mtRowsPages",
    icon: "fa-regular fa-envelope",
    label: "Contact Us Page",
    hint: "Hides the contact form and refuses new messages.",
    def: "Our contact form is under maintenance. Please reach us again later.",
  },
  {
    key: "page_appointment",
    group: "mtRowsPages",
    icon: "fa-regular fa-calendar-check",
    label: "Appointment Booking",
    hint: "Disables the Book Appointment flow and refuses new appointments.",
    def: "Appointment booking is paused for maintenance. Please try again later.",
  },
  {
    key: "home_about",
    group: "mtRowsSections",
    icon: "fa-solid fa-circle-info",
    label: "About Us Section",
    hint: "The About band on the Home page, video included.",
    def: "The About Us section is being updated. Please check back shortly.",
  },
  {
    key: "home_mission",
    group: "mtRowsSections",
    icon: "fa-solid fa-bullseye",
    label: "Mission Section",
    hint: "The Mission band on the Home page.",
    def: "The Mission section is being updated. Please check back shortly.",
  },
  {
    key: "home_vision",
    group: "mtRowsSections",
    icon: "fa-regular fa-eye",
    label: "Vision Section",
    hint: "The Vision band on the Home page.",
    def: "The Vision section is being updated. Please check back shortly.",
  },
  {
    key: "home_offer",
    group: "mtRowsSections",
    icon: "fa-solid fa-list-check",
    label: "What We Offer Section",
    hint: "The services preview band on the Home page.",
    def: "What We Offer is being updated. Please check back shortly.",
  },
];

// ── State ───────────────────────────────────────────────────────────────────
/** key -> { active, message }. `message` is "" when the default is in use. */
const form = {};
/** The last snapshot read from the server, used to spot newly-activated scopes. */
const serverState = {};
let loaded = false;
let dirty = false;
let pageForm = { ...PAGE_DEFAULTS };
let pageInstalled = false;
let pendingImage;
let imageLoading = false;
let imageRevision = 0;
let saving = false;
/**
 * null while things are fine, otherwise { title, html } describing why the
 * snapshot could not be read. Kept in state rather than written straight to the
 * DOM so Refresh can clear it through the same paint path as everything else.
 */
let fault = null;

SCOPES.forEach((cfg) => {
  form[cfg.key] = { active: false, message: "" };
  serverState[cfg.key] = { active: false, message: "" };
});

function esc(value) {
  return String(value === null || value === undefined ? "" : value).replace(
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

// ── Render ──────────────────────────────────────────────────────────────────
function rowHtml(cfg) {
  const max = cfg.key === "site_portal" ? SITE_MAX_LEN : MAX_LEN;
  const messageField = cfg.key === "site_portal"
    ? `<textarea class="wm-input" id="mtMsg_${cfg.key}" data-msg="${cfg.key}"
                 maxlength="${max}" placeholder="${esc(cfg.def)}"></textarea>`
    : `<input type="text" class="wm-input" id="mtMsg_${cfg.key}"
                 data-msg="${cfg.key}" maxlength="${max}" placeholder="${esc(cfg.def)}" />`;
  return `
    <div class="mt-row" data-row="${cfg.key}">
      <div class="mt-row-main">
        <div class="mt-row-title">
          <i class="${esc(cfg.icon)}"></i>
          <div>
            <h4>${esc(cfg.label)}</h4>
            <p>${esc(cfg.hint)}</p>
          </div>
        </div>
        <label class="mt-switch">
          <input type="checkbox" data-toggle="${cfg.key}"
                 aria-label="Put ${esc(cfg.label)} under maintenance" />
          <span class="mt-switch-track"><span class="mt-switch-knob"></span></span>
          <span class="mt-switch-state" data-state="${cfg.key}">Off</span>
        </label>
      </div>
      <div class="mt-row-msg">
        <label for="mtMsg_${cfg.key}">${cfg.key === "site_portal" ? "Maintenance message" : "Message shown to customers"}</label>
        <div class="mt-msg-field">
          ${messageField}
          <span class="mt-counter" data-counter="${cfg.key}">0/${max}</span>
        </div>
        <button type="button" class="mt-default-link" data-default="${cfg.key}">
          Use the default wording
        </button>
      </div>
    </div>`;
}

function renderRows() {
  const buckets = {};
  SCOPES.forEach((cfg) => {
    if (!buckets[cfg.group]) buckets[cfg.group] = [];
    buckets[cfg.group].push(rowHtml(cfg));
  });
  Object.keys(buckets).forEach((id) => {
    const host = document.getElementById(id);
    if (host) host.innerHTML = buckets[id].join("");
  });
  SCOPES.forEach(wireRow);
}

function wireRow(cfg) {
  const toggle = document.querySelector(`[data-toggle="${cfg.key}"]`);
  const input = document.querySelector(`[data-msg="${cfg.key}"]`);
  const useDefault = document.querySelector(`[data-default="${cfg.key}"]`);

  if (toggle) {
    toggle.addEventListener("change", () => {
      form[cfg.key].active = toggle.checked;
      markDirty();
      paintRow(cfg);
      paintSummary();
    });
  }
  if (input) {
    input.addEventListener("input", () => {
      form[cfg.key].message = input.value;
      markDirty();
      paintCounter(cfg);
      if (cfg.key === "site_portal") paintPagePreview();
    });
  }
  if (useDefault) {
    useDefault.addEventListener("click", () => {
      form[cfg.key].message = "";
      if (input) input.value = "";
      markDirty();
      paintCounter(cfg);
      if (cfg.key === "site_portal") paintPagePreview();
    });
  }
}

// ── Paint ───────────────────────────────────────────────────────────────────
function paintRow(cfg) {
  const on = !!form[cfg.key].active;
  const toggle = document.querySelector(`[data-toggle="${cfg.key}"]`);
  const state = document.querySelector(`[data-state="${cfg.key}"]`);
  const input = document.querySelector(`[data-msg="${cfg.key}"]`);

  if (toggle) toggle.checked = on;
  if (state) state.textContent = on ? "On" : "Off";
  if (input && input.value !== form[cfg.key].message)
    input.value = form[cfg.key].message;
  paintCounter(cfg);
}

function paintCounter(cfg) {
  const counter = document.querySelector(`[data-counter="${cfg.key}"]`);
  if (!counter) return;
  const len = (form[cfg.key].message || "").length;
  const max = cfg.key === "site_portal" ? SITE_MAX_LEN : MAX_LEN;
  counter.textContent = `${len}/${max}`;
  counter.classList.toggle("is-max", len >= max);
}

function safeImageUrl(value) {
  return typeof value === "string" && /^\/storage\/maintenance\/site-page-[a-f0-9]{24}\.(png|jpg|webp)$/.test(value) ? value : "";
}

function applyPageSnapshot(snapshot) {
  pageForm = { ...PAGE_DEFAULTS };
  if (snapshot && typeof snapshot === "object") {
    Object.keys(PAGE_LIMITS).forEach((field) => {
      if (typeof snapshot[field] === "string") pageForm[field] = snapshot[field];
    });
    if (PAGE_THEMES.includes(snapshot.theme)) pageForm.theme = snapshot.theme;
    pageForm.image_url = safeImageUrl(snapshot.image_url);
  }
  pendingImage = undefined;
  imageRevision += 1;
  imageLoading = false;
  const file = document.getElementById("mtPageImage");
  if (file) file.value = "";
  setImageStatus(pageForm.image_url ? "Custom maintenance illustration" : "Default maintenance illustration");
}

function setImageStatus(message, error = false) {
  const status = document.getElementById("mtPageImageStatus");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("is-error", error);
}

function paintPagePreview() {
  Object.keys(PAGE_LIMITS).forEach((field) => {
    const input = document.querySelector(`[data-page-field="${field}"]`);
    if (input && input.value !== pageForm[field]) input.value = pageForm[field];
    const counter = document.querySelector(`[data-page-counter="${field}"]`);
    if (counter) {
      counter.textContent = `${pageForm[field].length}/${PAGE_LIMITS[field]}`;
      counter.classList.toggle("is-max", pageForm[field].length >= PAGE_LIMITS[field]);
    }
  });
  const text = form.site_portal.message || "";
  const preview = {
    mtPreviewEyebrow: pageForm.eyebrow.trim(),
    mtPreviewHeadline: pageForm.headline.trim() || PAGE_DEFAULTS.headline,
    mtPreviewAccent: pageForm.headline_accent.trim(),
    mtPreviewMessage: text.trim() || SCOPES[0].def,
    mtPreviewSupport: pageForm.supporting_line.trim(),
  };
  Object.entries(preview).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = value;
      el.hidden = !value.trim();
    }
  });
  document.getElementById("mtPagePreview")?.setAttribute("data-theme", pageForm.theme);
  document.querySelectorAll('[name="mtPageTheme"]').forEach((input) => { input.checked = input.value === pageForm.theme; });
  const image = document.getElementById("mtPreviewImage");
  if (image) {
    const source = typeof pendingImage === "string" && pendingImage ? pendingImage : pendingImage === null ? DEFAULT_IMAGE : pageForm.image_url || DEFAULT_IMAGE;
    if (image.getAttribute("src") !== source) image.setAttribute("src", source);
    image.alt = pageForm.image_alt;
  }
  const fields = document.getElementById("mtPageFields");
  if (fields) fields.disabled = !loaded || !pageInstalled;
  const notice = document.getElementById("mtPageMigrationNotice");
  if (notice) notice.hidden = !loaded || pageInstalled;
}

async function choosePageImage(event) {
  const file = event.target.files?.[0];
  if (!file || !loaded || !pageInstalled) return;
  const revision = ++imageRevision;
  imageLoading = true;
  setImageStatus("Checking image…");
  try {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Choose a PNG, JPG, or WebP image.");
    if (file.size > 1024 * 1024) throw new Error("Choose an image no larger than 1 MB.");
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("The image could not be read. Please try another file."));
      reader.readAsDataURL(file);
    });
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("The image could not be opened. Please choose another file."));
      image.src = data;
    });
    if (image.naturalWidth > 2400 || image.naturalHeight > 2400) throw new Error("Choose an image up to 2400 × 2400 pixels.");
    if (revision !== imageRevision) return;
    pendingImage = data;
    setImageStatus(`${file.name} · Ready to save`);
    markDirty();
    paintPagePreview();
  } catch (error) {
    if (revision !== imageRevision) return;
    event.target.value = "";
    setImageStatus(error.message || "The image could not be opened.", true);
  } finally {
    if (revision === imageRevision) imageLoading = false;
  }
}

function wirePageEditor() {
  document.querySelectorAll("[data-page-field]").forEach((input) => {
    input.addEventListener("input", () => {
      pageForm[input.dataset.pageField] = input.value;
      markDirty();
      paintPagePreview();
    });
  });
  document.querySelectorAll('[name="mtPageTheme"]').forEach((input) => {
    input.addEventListener("change", () => {
      pageForm.theme = input.value;
      markDirty();
      paintPagePreview();
    });
  });
  document.getElementById("mtPageImage")?.addEventListener("change", choosePageImage);
  document.getElementById("mtPageImageChoose")?.addEventListener("click", () => { document.getElementById("mtPageImage")?.click(); });
  document.getElementById("mtPageImageReset")?.addEventListener("click", () => {
    imageRevision += 1;
    imageLoading = false;
    pendingImage = null;
    document.getElementById("mtPageImage").value = "";
    setImageStatus("Default illustration · Ready to save");
    markDirty();
    paintPagePreview();
  });
  document.getElementById("mtPageRestore")?.addEventListener("click", () => {
    pageForm = { ...PAGE_DEFAULTS };
    form.site_portal.message = "";
    pendingImage = null;
    imageRevision += 1;
    imageLoading = false;
    document.getElementById("mtPageImage").value = "";
    setImageStatus("Default illustration · Ready to save");
    markDirty();
    paintAll();
  });
}

function paintSummary() {
  // This card reports the saved state. Draft toggles become live only after save.
  const liveCount = SCOPES.filter((cfg) => serverState[cfg.key].active).length;
  const online = !fault && loaded && liveCount === 0;
  const pill = document.getElementById("mtLivePill");
  const pillText = document.getElementById("mtLivePillText");
  const banner = document.getElementById("mtBanner");
  const bannerIcon = document.getElementById("mtBannerIcon");
  const bannerTitle = document.getElementById("mtBannerTitle");
  const bannerText = document.getElementById("mtBannerText");

  if (pill) {
    pill.classList.toggle("is-on", !fault && loaded && liveCount > 0);
    pill.classList.toggle("is-live", online);
  }
  if (pillText) {
    pillText.textContent = fault
      ? "Not loaded"
      : !loaded
        ? "Loading…"
        : online
          ? "Everything online"
          : `${liveCount} of ${SCOPES.length} under maintenance`;
  }

  if (banner) {
    banner.hidden = Boolean(fault);
    banner.classList.toggle("is-fault", Boolean(fault));
    banner.classList.toggle("is-online", online);
    banner.classList.toggle("is-loading", !fault && !loaded);
  }
  if (bannerIcon) {
    bannerIcon.className = fault
      ? "fa-solid fa-circle-exclamation"
      : !loaded
        ? "fa-solid fa-circle-info"
        : online
          ? "fa-solid fa-circle-check"
          : "fa-solid fa-triangle-exclamation";
  }
  if (bannerTitle) {
    bannerTitle.textContent = fault
      ? fault.title
      : !loaded
        ? "Checking availability."
        : online
          ? "Website availability."
          : "Maintenance is live.";
  }
  if (bannerText) {
    if (fault) {
      bannerText.innerHTML = fault.html;
    } else if (!loaded) {
      bannerText.textContent = "Loading the saved maintenance settings.";
    } else if (online) {
      bannerText.textContent = "The public website and customer access are available.";
    } else {
      bannerText.textContent =
        liveCount === 1
          ? "One item is currently offline for visitors."
          : `${liveCount} items are currently offline for visitors.`;
    }
  }
  paintSaveHint();
}

function paintSaveHint() {
  const bar = document.querySelector(".wm-save-bar p");
  if (!bar) return;
  bar.innerHTML = dirty
    ? '<i class="fa-solid fa-circle-exclamation" style="margin-right: 5px; color: #ca8a04"></i>You have unsaved changes. Nothing is live until you click Save All Changes.'
    : '<i class="fa-solid fa-circle-info" style="margin-right: 5px; color: var(--primary-color)"></i>Changes only apply after clicking Save All Changes.';
}

function paintAll() {
  SCOPES.forEach(paintRow);
  paintPagePreview();
  paintSummary();
  document.querySelectorAll('[data-toggle], [data-msg], [data-default]').forEach((control) => { control.disabled = !loaded || saving; });
  const save = document.getElementById("btnSaveMaintenance");
  if (save) save.disabled = !loaded || saving;
}

function markDirty() {
  if (dirty) return;
  dirty = true;
  paintSaveHint();
}

// ── Load ────────────────────────────────────────────────────────────────────
/**
 * Why this reports the cause instead of one generic message.
 *
 * The three ways this read can fail look identical on screen but need three
 * different actions, and the first version of this function collapsed all of
 * them into "check your connection", which is wrong advice for two of the three:
 *
 *   - the table is missing  -> run `php artisan migrate` on the server. A
 *     files-only Hostinger deploy always lands here first.
 *   - the API answered with an error status -> a server problem; the status code
 *     is the only useful thing to hand over.
 *   - the request never completed -> the API is genuinely unreachable (Laravel
 *     not running, wrong host, offline).
 *
 * The controls stay locked in every case: publishing all scopes from a state that
 * never loaded could switch something off that was switched on elsewhere.
 */
function failLoad(title) {
  fault = { title: "Temporarily unavailable", html: "Refresh to try again." };
  window.AdminPageNotice.show(title, { key: "maintenance", retry: () => { void load(); } });
  loaded = false;
  document.getElementById("mtStack")?.classList.add("mt-loading");
  paintAll();
}

/**
 * A blank message means "use the default": the server stores NULL and fills the
 * default in when it answers. Folding an answer that equals the default back to
 * "" is what keeps the placeholder — and "Use the default wording" — meaningful.
 */
async function load() {
  let res;
  try {
    // `cache: "no-store"` on purpose. The endpoint ships an ETag for the
    // customer gate's background revalidation, but the admin panel must never paint
    // switches from a cached body — it is the screen you open to confirm what is
    // actually live right now.
    res = await fetch(`${API}/maintenance`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    failLoad(
      "Connection lost. Please try again.",
    );
    return;
  }

  try {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const data = json && json.data ? json.data : {};

    // The table has not been created on this server yet. Everything reads as
    // online because the backend fails open, so say so plainly rather than
    // letting the admin trust a form that cannot save.
    if (json && json.installed === false) {
      failLoad(
        "Temporarily unavailable.",
      );
      return;
    }

    SCOPES.forEach((cfg) => {
      const row = data[cfg.key] && typeof data[cfg.key] === "object" ? data[cfg.key] : {};
      const raw = typeof row.message === "string" ? row.message.trim() : "";
      const message = raw === cfg.def ? "" : raw;
      form[cfg.key] = { active: row.active === true, message };
      serverState[cfg.key] = { active: row.active === true, message };
    });

    pageInstalled = json.site_page_installed === true;
    applyPageSnapshot(json.site_page);

    fault = null;
    window.AdminPageNotice.clear("maintenance");
    loaded = true;
    dirty = false;
    document.getElementById("mtStack")?.classList.remove("mt-loading");
    paintAll();
  } catch {
    failLoad(
      "Temporarily unavailable.",
    );
  }
}

// ── Save ────────────────────────────────────────────────────────────────────
function newlyActivated() {
  return SCOPES.filter(
    (cfg) => form[cfg.key].active && !serverState[cfg.key].active,
  );
}

function requestSave() {
  if (!loaded || saving) return;
  if (imageLoading) {
    window.showAdminPopup?.("Please wait until your illustration finishes loading.", { title: "Checking image" });
    return;
  }

  const turningOn = newlyActivated();
  if (turningOn.length === 0) {
    void doSave();
    return;
  }

  const names = turningOn.map((cfg) => cfg.label).join(", ");
  const message =
    turningOn.length === 1
      ? `${names} will go offline for visitors straight away. Your message is what they will see.`
      : `These will go offline for visitors straight away: ${names}. Your messages are what they will see.`;

  if (typeof window.showAdminConfirmPopup === "function") {
    window.showAdminConfirmPopup(message, {
      title: "Turn maintenance on?",
      confirmText: "Turn On & Save",
      cancelText: "Cancel",
      onConfirm: () => void doSave(),
    });
    return;
  }
  void doSave();
}

async function doSave() {
  if (saving) return;
  saving = true;
  const stack = document.getElementById("mtStack");
  if (stack) { stack.inert = true; stack.setAttribute("aria-busy", "true"); }
  const button = document.getElementById("btnSaveMaintenance");
  const originalHtml = button?.innerHTML || "";
  if (button) {
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
  }

  const payload = { scopes: {} };
  SCOPES.forEach((cfg) => {
    const text = (form[cfg.key].message || "").trim();
    payload.scopes[cfg.key] = {
      is_active: !!form[cfg.key].active,
      message: text === "" ? null : text,
    };
  });
  if (pageInstalled) {
    payload.site_page = {};
    Object.keys(PAGE_LIMITS).forEach((field) => { payload.site_page[field] = pageForm[field].trim(); });
    payload.site_page.theme = pageForm.theme;
    if (pendingImage !== undefined) payload.site_page.image_data = pendingImage;
  }

  try {
    const res = await fetch(`${API}/admin/maintenance`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token()}`,
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));

    if (res.status === 403) {
      window.showAdminPopup?.(
        data.message ||
          "Only an administrator can change Maintenance Mode. Nothing was saved.",
        { title: "Not allowed" },
      );
      return;
    }
    if (res.status === 422) {
      const first = data.errors
        ? Object.values(data.errors)[0]?.[0]
        : data.message;
      window.showAdminPopup?.(
        first || "Check the character limits and illustration, then try again.",
        { title: "Check your messages" },
      );
      return;
    }
    if (res.status === 503 && data.site_page_installed === false) {
      pageInstalled = false;
      paintAll();
      window.showAdminPopup?.(data.message || "Maintenance screen customization is not installed yet. Run the database migration, then click Refresh.", { title: "Screen settings unavailable" });
      return;
    }
    // The table is missing, so there is nowhere to write. Say what to run rather
    // than "check your connection" — the connection is fine.
    if (res.status === 503 && data.installed === false) {
      window.showAdminPopup?.(
        data.message ||
          'Maintenance Mode is not installed on this server yet. Run "php artisan migrate" once, then reload this page.',
        { title: "Not installed" },
      );
      failLoad(
        "Maintenance Mode is not installed on this server yet.",
        ' The database table is missing, so nothing can be taken offline. Run <code>php artisan migrate</code> once on the server, then click Refresh.',
      );
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    applySnapshot(data.data);
    applyPageSnapshot(data.site_page);
    dirty = false;
    paintAll();
    broadcastSiteUpdate("updated");
    window.showAdminPopup?.("Maintenance settings saved.", { title: "Saved!" });
  } catch {
    window.showAdminPopup?.(
      "Failed to save. Check your connection and try again.",
      { title: "Error" },
    );
  } finally {
    saving = false;
    if (stack) { stack.inert = false; stack.removeAttribute("aria-busy"); }
    if (button) {
      button.disabled = !loaded;
      button.innerHTML =
        originalHtml ||
        '<i class="fa-solid fa-floppy-disk"></i> Save All Changes';
    }
    paintAll();
  }
}

function applySnapshot(data) {
  if (!data || typeof data !== "object") return;
  SCOPES.forEach((cfg) => {
    const row = data[cfg.key] && typeof data[cfg.key] === "object" ? data[cfg.key] : {};
    const raw = typeof row.message === "string" ? row.message.trim() : "";
    const message = raw === cfg.def ? "" : raw;
    form[cfg.key] = { active: row.active === true, message };
    serverState[cfg.key] = { active: row.active === true, message };
  });
}

/**
 * The same two signals Website Management already fires — no new channel and no
 * new storage key. maintenance-gate.js listens on both, so every customer tab in
 * this browser reacts without a reload; other devices pick it up on the gate's
 * background checks or before opening a page, image or other content.
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

// ── Boot ────────────────────────────────────────────────────────────────────
/**
 * Refresh re-reads the snapshot in place instead of reloading the document. The
 * button used to be `onclick="window.location.reload()"`, which threw away
 * unsaved switch positions without a word — and the fault banners tell you to
 * press this button, so it must not be a trap. Unsaved work is confirmed first.
 */
function requestRefresh() {
  if (saving || imageLoading) return;
  const run = () => {
    fault = null;
    window.AdminPageNotice.clear("maintenance");
    loaded = false;
    document.getElementById("mtStack")?.classList.add("mt-loading");
    paintAll();
    void load();
  };

  if (!dirty) {
    run();
    return;
  }

  if (typeof window.showAdminConfirmPopup === "function") {
    window.showAdminConfirmPopup(
      "You have unsaved changes. Refreshing reads the live settings again and discards them.",
      {
        title: "Discard unsaved changes?",
        confirmText: "Discard & Refresh",
        cancelText: "Keep Editing",
        onConfirm: run,
      },
    );
    return;
  }
  run();
}

document.addEventListener("DOMContentLoaded", () => {
  renderRows();
  wirePageEditor();
  paintAll();
  document
    .getElementById("btnSaveMaintenance")
    ?.addEventListener("click", requestSave);
  document
    .getElementById("btnRefreshMaintenance")
    ?.addEventListener("click", requestRefresh);
  void load();
});
