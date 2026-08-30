/* jshint esversion: 9 */
"use strict";

/**
 * Maintenance Mode control panel (STEP 11, Part B) — ADMIN ONLY.
 *
 * 11 scopes: 2 account gates, 5 customer pages, 4 Home-page sections. Each has
 * its own switch and its own message of at most 75 characters.
 *
 * Two deliberate choices:
 *
 *  - A switch marks the form dirty instead of publishing straight away, so you
 *    can line several scopes up and take them offline in one move.
 *  - The form stays inert until the first snapshot has been read. Publishing 11
 *    scopes from a state that never loaded could switch something off that you
 *    had switched on from another device.
 *
 * The endpoint (PUT /api/admin/maintenance) refuses anything but an admin token,
 * so a staff member who guesses this URL can read the page but never save.
 */

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

const MAX_LEN = 75;

/** Keys and default wording mirror MaintenanceSetting::DEFAULTS exactly. */
const SCOPES = [
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
    hint: "Covers the banner, About Us, Mission, Vision, What We Offer and booking.",
    def: "Our home page is briefly offline for maintenance. Please check back soon.",
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
        <label for="mtMsg_${cfg.key}">Message shown to customers</label>
        <div class="mt-msg-field">
          <input type="text" class="wm-input" id="mtMsg_${cfg.key}"
                 data-msg="${cfg.key}" maxlength="${MAX_LEN}"
                 placeholder="${esc(cfg.def)}" />
          <span class="mt-counter" data-counter="${cfg.key}">0/${MAX_LEN}</span>
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
    });
  }
  if (useDefault) {
    useDefault.addEventListener("click", () => {
      form[cfg.key].message = "";
      if (input) input.value = "";
      markDirty();
      paintCounter(cfg);
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
  counter.textContent = `${len}/${MAX_LEN}`;
  counter.classList.toggle("is-max", len >= MAX_LEN);
}

function paintSummary() {
  const active = SCOPES.filter((cfg) => form[cfg.key].active);
  const pill = document.getElementById("mtLivePill");
  const pillText = document.getElementById("mtLivePillText");
  const banner = document.getElementById("mtBanner");
  const bannerIcon = document.getElementById("mtBannerIcon");
  const bannerTitle = document.getElementById("mtBannerTitle");
  const bannerText = document.getElementById("mtBannerText");

  if (pill) pill.classList.toggle("is-on", active.length > 0);
  if (pillText) {
    pillText.textContent = fault
      ? "Not loaded"
      : !loaded
        ? "Loading…"
        : active.length === 0
          ? "Everything online"
          : `${active.length} of ${SCOPES.length} under maintenance`;
  }

  // A fault outranks the live count: if the snapshot never arrived, "0 items are
  // offline" would be a claim the page is in no position to make.
  const liveCount = SCOPES.filter((cfg) => serverState[cfg.key].active).length;
  if (banner) {
    banner.hidden = !fault && liveCount === 0;
    banner.classList.toggle("is-fault", Boolean(fault));
  }
  if (bannerIcon) {
    bannerIcon.className = fault
      ? "fa-solid fa-circle-exclamation"
      : "fa-solid fa-triangle-exclamation";
  }
  if (bannerTitle) {
    bannerTitle.textContent = fault ? fault.title : "Maintenance is live.";
  }
  if (bannerText) {
    if (fault) {
      bannerText.innerHTML = fault.html;
    } else {
      bannerText.textContent =
        liveCount === 1
          ? "One item is currently offline for customers."
          : `${liveCount} items are currently offline for customers.`;
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
  paintSummary();
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
 * The controls stay locked in every case: publishing 11 scopes from a state that
 * never loaded could switch something off that was switched on elsewhere.
 */
function failLoad(title, html) {
  fault = { title, html };
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
    // customer gate's 20s revalidation, but the admin panel must never paint 11
    // switches from a cached body — it is the screen you open to confirm what is
    // actually live right now.
    res = await fetch(`${API}/maintenance`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    failLoad(
      "Could not reach the server.",
      ` The request to <code>${esc(API)}/maintenance</code> did not complete, so the switches below are locked. Check that the backend is running, then click Refresh.`,
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
        "Maintenance Mode is not installed on this server yet.",
        ' The database table is missing, so nothing can be taken offline. Run <code>php artisan migrate</code> once on the server, then click Refresh.',
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

    fault = null;
    loaded = true;
    dirty = false;
    document.getElementById("mtStack")?.classList.remove("mt-loading");
    paintAll();
  } catch {
    failLoad(
      "Could not read the maintenance settings.",
      ` The server answered <code>HTTP ${esc(res.status)}</code>, so the switches below are locked and nothing can be published by mistake. Click Refresh to try again.`,
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
  if (!loaded) return;

  const turningOn = newlyActivated();
  if (turningOn.length === 0) {
    void doSave();
    return;
  }

  const names = turningOn.map((cfg) => cfg.label).join(", ");
  const message =
    turningOn.length === 1
      ? `${names} will go offline for customers straight away. Your message is what they will see.`
      : `These will go offline for customers straight away: ${names}. Your messages are what they will see.`;

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
        first || `Each message must be ${MAX_LEN} characters or fewer.`,
        { title: "Check your messages" },
      );
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
    if (button) {
      button.disabled = false;
      button.innerHTML =
        originalHtml ||
        '<i class="fa-solid fa-floppy-disk"></i> Save All Changes';
    }
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
 * this browser reacts without a reload; other devices pick it up on the next
 * 20 s ETag poll that main.js already runs.
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
  const run = () => {
    fault = null;
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
  paintAll();
  document
    .getElementById("btnSaveMaintenance")
    ?.addEventListener("click", requestSave);
  document
    .getElementById("btnRefreshMaintenance")
    ?.addEventListener("click", requestRefresh);
  void load();
});
