"use strict";

/**
 * Website Management -> Email Templates.
 *
 * One editor for every Gmail notification the system sends. The registry, the
 * compiled-in default wording and the rendered preview all come from the
 * backend (App\Support\EmailTemplate), so this file holds no copy of its own --
 * a template added in PHP shows up here without a front-end change.
 *
 * Only six parts per notification are editable: the header title, subtitle and
 * colour, the message heading and body, and the closing note. Order details,
 * OTP codes, buttons and the copyright line are code-owned and arrive through
 * the preview endpoint as read-only sample content.
 *
 * Saving reuses the untouched PUT /admin/site-settings, writing one JSON blob
 * per template under "email_tpl_{slug}". Restoring a default writes an empty
 * value, which the backend reads as "no override".
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

// Same channel reports.js uses for the letterhead, so an edit in one open tab
// refreshes the other admin/staff tabs without a manual reload.
const SITE_SETTINGS_REALTIME_CHANNEL = "fmrc-site-settings-realtime";

const DEFAULT_KEY_PREFIX = "email_tpl_";
const DEFAULT_EDITABLE_PARTS = [
  "header_title",
  "header_subtitle",
  "header_color",
  "body_heading",
  "body_text",
  "footer_note",
];
const DEFAULT_CLEARABLE_PARTS = ["header_subtitle", "footer_note"];
const FALLBACK_COLOR = "#800000";

/** part name -> the input that holds it. */
const FIELD_IDS = {
  header_title: "emailTplHeaderTitle",
  header_subtitle: "emailTplHeaderSubtitle",
  header_color: "emailTplHeaderColorText",
  body_heading: "emailTplBodyHeading",
  body_text: "emailTplBodyText",
  footer_note: "emailTplFooterNote",
};

/** Fields a token chip may be inserted into. */
const TOKEN_TARGETS = [
  "header_title",
  "header_subtitle",
  "body_heading",
  "body_text",
  "footer_note",
];

const token = () =>
  (window.AdminSession && window.AdminSession.getToken()) ||
  localStorage.getItem("auth_token");

const state = {
  keyPrefix: DEFAULT_KEY_PREFIX,
  groups: [],
  editableParts: DEFAULT_EDITABLE_PARTS.slice(),
  clearableParts: DEFAULT_CLEARABLE_PARTS.slice(),
  rows: [],
  bySlug: new Map(),
  activeSlug: "",
  search: "",
  saving: false,
  previewTimer: 0,
  previewSeq: 0,
  lastTokenTarget: "body_text",
};

const el = (id) => document.getElementById(id);

const escHtml = (value) => {
  const holder = document.createElement("div");
  holder.textContent = value === undefined || value === null ? "" : value;
  return holder.innerHTML;
};

/** Mirrors the backend colour guard: anything else falls back to maroon. */
const safeColor = (value, fallback = FALLBACK_COLOR) => {
  const raw = String(value ?? "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toLowerCase() : fallback;
};

const setStatus = (message, isError = false) => {
  const node = el("emailTemplateStatus");
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("is-error", Boolean(isError));
};

const setPreviewState = (message) => {
  const node = el("emailTemplatePreviewState");
  if (node) node.textContent = message;
};

const setButtonPending = (button, pending, label) => {
  if (!button) return;
  if (pending) {
    if (!button.dataset.idleHtml) button.dataset.idleHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${escHtml(label)}`;
    return;
  }
  button.disabled = false;
  if (button.dataset.idleHtml) {
    button.innerHTML = button.dataset.idleHtml;
    delete button.dataset.idleHtml;
  }
};

/**
 * The saved override merged over the defaults, using the same rule the backend
 * merge() applies: a blank saved value only wins for the two optional lines, so
 * a cleared heading or body can never ship an empty email.
 */
const partsOf = (row) => {
  const defaults = row?.defaults || {};
  const saved = row?.saved || {};
  const out = {};

  state.editableParts.forEach((part) => {
    const has = typeof saved[part] === "string";
    const value = has ? saved[part] : "";
    const blankAllowed = state.clearableParts.includes(part);
    out[part] =
      has && (value.trim() !== "" || blankAllowed)
        ? value
        : String(defaults[part] ?? "");
  });

  out.header_color = safeColor(
    out.header_color,
    safeColor(defaults.header_color),
  );
  return out;
};

const hasOverride = (row) =>
  Boolean(row?.saved && Object.keys(row.saved).length > 0);

const groupOrder = () =>
  state.groups.length
    ? state.groups
    : Array.from(new Set(state.rows.map((row) => row.group)));

const matchesSearch = (row) =>
  !state.search ||
  `${row.label} ${row.group} ${row.slug}`.toLowerCase().includes(state.search);

const renderList = () => {
  const list = el("emailTemplateList");
  if (!list) return;

  const visible = state.rows.filter(matchesSearch);
  const count = el("emailTemplateCount");
  if (count) {
    count.textContent = state.rows.length
      ? `${visible.length}/${state.rows.length}`
      : "";
  }

  if (!visible.length) {
    list.innerHTML = `<p class="et-hint">No notification matches that search.</p>`;
    return;
  }

  const html = [];
  groupOrder().forEach((group) => {
    const rows = visible.filter((row) => row.group === group);
    if (!rows.length) return;
    html.push(`<span class="et-group-label">${escHtml(group)}</span>`);
    rows.forEach((row) => {
      const active = row.slug === state.activeSlug ? " active" : "";
      const edited = hasOverride(row) ? " edited" : "";
      const hint = hasOverride(row) ? "Edited" : "Original wording";
      html.push(
        `<button type="button" class="et-item${active}${edited}" data-slug="${escHtml(row.slug)}" title="${hint}">` +
          `<span class="et-dot"></span><span>${escHtml(row.label)}</span></button>`,
      );
    });
  });

  list.innerHTML = html.join("");
};

const renderTokens = (row) => {
  const holder = el("emailTemplateTokens");
  if (!holder) return;
  const tokens = Array.isArray(row?.tokens) ? row.tokens : [];
  holder.innerHTML = tokens.length
    ? tokens
        .map(
          (name) =>
            `<button type="button" class="et-token" data-token="${escHtml(name)}">{${escHtml(name)}}</button>`,
        )
        .join("")
    : `<span class="et-hint">This notification has no insertable details.</span>`;
};

const currentParts = () => {
  const row = state.bySlug.get(state.activeSlug);
  const out = {};
  state.editableParts.forEach((part) => {
    out[part] = String(el(FIELD_IDS[part])?.value ?? "");
  });
  out.header_color = safeColor(
    out.header_color,
    safeColor(row?.defaults?.header_color),
  );
  return out;
};

const isDirty = () => {
  const row = state.bySlug.get(state.activeSlug);
  if (!row) return false;
  const saved = partsOf(row);
  const now = currentParts();
  return state.editableParts.some((part) => saved[part] !== now[part]);
};

/** What the status line reads while the form matches what is stored. */
const savedStatusMessage = (row) =>
  hasOverride(row)
    ? "Showing your saved wording."
    : "Showing the original wording. Edits apply to new emails only.";

/**
 * Keep the status line honest about unsaved work. The preview updates as you
 * type, so without this an admin can read an edited preview and believe it is
 * already live.
 */
const syncDirty = () => {
  const row = state.bySlug.get(state.activeSlug);
  if (!row) return;
  setStatus(
    isDirty()
      ? "Unsaved changes. Choose Save Template to apply them to new emails."
      : savedStatusMessage(row),
  );
};

const selectTemplate = (slug) => {
  const row = state.bySlug.get(slug);
  if (!row) return;

  state.activeSlug = slug;
  const parts = partsOf(row);
  const edited = hasOverride(row);

  const title = el("emailTemplateTitle");
  if (title) title.textContent = row.label;

  const chip = el("emailTemplateGroup");
  if (chip) {
    chip.textContent = row.group || "";
    chip.style.display = row.group ? "" : "none";
  }

  const hint = el("emailTemplateHint");
  if (hint) {
    hint.textContent = edited
      ? "This notification uses your saved wording. Restore Default puts the original back."
      : "This notification still uses its original wording.";
  }

  const form = el("emailTemplateForm");
  if (form) form.style.display = "";

  state.editableParts.forEach((part) => {
    const input = el(FIELD_IDS[part]);
    if (input) input.value = parts[part] ?? "";
  });
  const picker = el("emailTplHeaderColor");
  if (picker) picker.value = safeColor(parts.header_color);

  renderTokens(row);
  state.lastTokenTarget = "body_text";

  const saveBtn = el("emailTemplateSaveBtn");
  if (saveBtn) saveBtn.disabled = false;
  const resetBtn = el("emailTemplateResetBtn");
  if (resetBtn) resetBtn.disabled = !edited;

  setStatus(savedStatusMessage(row));
  renderList();
  requestPreview(true);
};

const insertToken = (name) => {
  const part = TOKEN_TARGETS.includes(state.lastTokenTarget)
    ? state.lastTokenTarget
    : "body_text";
  const input = el(FIELD_IDS[part]);
  if (!input) return;

  const chunk = `{${name}}`;
  const start = Number.isInteger(input.selectionStart)
    ? input.selectionStart
    : input.value.length;
  const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;

  input.value = `${input.value.slice(0, start)}${chunk}${input.value.slice(end)}`;
  const caret = start + chunk.length;
  input.focus();
  try {
    input.setSelectionRange(caret, caret);
  } catch {
    /* type="color" and friends have no selection range */
  }
  requestPreview();
};

/**
 * Render through the real backend renderer so the iframe shows exactly what a
 * recipient gets -- including the code-owned blocks this page cannot edit.
 */
const renderPreview = async () => {
  const slug = state.activeSlug;
  if (!slug) return;

  const authToken = token();
  if (!authToken) {
    setPreviewState("Preview unavailable");
    return;
  }

  const seq = ++state.previewSeq;
  setPreviewState("Updating...");

  try {
    const response = await fetch(`${API}/admin/email-templates/preview`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ slug, parts: currentParts() }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(
        body?.message ||
          (response.status === 403
            ? "Only admin or staff accounts can preview email templates."
            : "The preview could not be rendered."),
      );
    }
    const html = String((await response.json())?.data?.html || "");
    // A slower earlier request must not overwrite a newer preview.
    if (seq !== state.previewSeq || slug !== state.activeSlug) return;
    const frame = el("emailTemplatePreview");
    if (frame) frame.srcdoc = html;
    setPreviewState("Sample content");
  } catch (error) {
    if (seq !== state.previewSeq) return;
    setPreviewState("Preview unavailable");
    setStatus(error?.message || "The preview could not be rendered.", true);
  }
};

const requestPreview = (immediate = false) => {
  syncDirty();
  window.clearTimeout(state.previewTimer);
  state.previewTimer = window.setTimeout(renderPreview, immediate ? 0 : 450);
};

const broadcastUpdate = () => {
  if (typeof window.BroadcastChannel !== "function") return;
  try {
    const channel = new window.BroadcastChannel(SITE_SETTINGS_REALTIME_CHANNEL);
    channel.postMessage({ type: "updated" });
    channel.close();
  } catch {
    /* best effort only */
  }
};

/**
 * Save (or restore) one template through the untouched PUT /admin/site-settings.
 * Restoring writes an empty value, which the backend reads as "no override" and
 * falls back to the compiled-in default wording.
 */
const persist = async (isReset) => {
  if (state.saving) return;
  const slug = state.activeSlug;
  const row = state.bySlug.get(slug);
  if (!row) return;

  const authToken = token();
  if (!authToken) {
    setStatus(
      "Your session expired. Sign in again to save this template.",
      true,
    );
    return;
  }

  const parts = currentParts();
  const button = isReset
    ? el("emailTemplateResetBtn")
    : el("emailTemplateSaveBtn");
  const sibling = isReset
    ? el("emailTemplateSaveBtn")
    : el("emailTemplateResetBtn");

  state.saving = true;
  setButtonPending(button, true, isReset ? "Restoring..." : "Saving...");
  if (sibling) sibling.disabled = true;

  try {
    const response = await fetch(`${API}/admin/site-settings`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        [`${state.keyPrefix}${slug}`]: isReset ? "" : JSON.stringify(parts),
      }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(
        body?.message ||
          (response.status === 403
            ? "Only admin or staff accounts can edit email templates."
            : "The template could not be saved. Try again."),
      );
    }

    row.saved = isReset ? {} : { ...parts };
    state.saving = false;
    setButtonPending(button, false);
    selectTemplate(slug);
    broadcastUpdate();
    setStatus(
      isReset
        ? `"${row.label}" is back to its original wording.`
        : `"${row.label}" saved. New emails use it right away.`,
    );
    window.showAdminPopup?.(
      isReset
        ? `"${row.label}" has been restored to its original wording.`
        : `"${row.label}" saved. Every new email of this type uses it right away.`,
      { title: "Saved!" },
    );
  } catch (error) {
    const message =
      error?.message || "The template could not be saved. Try again.";
    state.saving = false;
    setButtonPending(button, false);
    if (sibling) sibling.disabled = isReset ? false : !hasOverride(row);
    setStatus(message, true);
    window.showAdminPopup?.(message, { title: "Error" });
  }
};

const loadTemplates = async ({ keepActive = true } = {}) => {
  const list = el("emailTemplateList");
  const authToken = token();

  if (!authToken) {
    if (list) {
      list.innerHTML = `<p class="et-hint">Sign in as admin or staff to edit the email templates.</p>`;
    }
    setStatus(
      "Your session expired. Sign in again to edit the email templates.",
      true,
    );
    return;
  }

  try {
    const response = await fetch(`${API}/admin/email-templates`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${authToken}`,
      },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(
        body?.message ||
          (response.status === 403
            ? "Only admin or staff accounts can edit email templates."
            : "The email templates could not be loaded."),
      );
    }

    const data = (await response.json())?.data || {};
    state.keyPrefix =
      typeof data.key_prefix === "string" && data.key_prefix
        ? data.key_prefix
        : DEFAULT_KEY_PREFIX;
    state.groups = Array.isArray(data.groups) ? data.groups : [];
    state.editableParts = Array.isArray(data.editable_parts)
      ? data.editable_parts.filter((part) => FIELD_IDS[part])
      : DEFAULT_EDITABLE_PARTS.slice();
    if (!state.editableParts.length) {
      state.editableParts = DEFAULT_EDITABLE_PARTS.slice();
    }
    state.clearableParts = Array.isArray(data.clearable_parts)
      ? data.clearable_parts
      : DEFAULT_CLEARABLE_PARTS.slice();
    state.rows = Array.isArray(data.templates) ? data.templates : [];
    state.bySlug = new Map(state.rows.map((row) => [row.slug, row]));

    const wanted =
      keepActive && state.bySlug.has(state.activeSlug)
        ? state.activeSlug
        : state.rows[0]?.slug || "";
    state.activeSlug = "";
    renderList();
    if (wanted) {
      selectTemplate(wanted);
    } else {
      setStatus("No notifications are registered.", true);
    }
  } catch (error) {
    const message =
      error?.message || "The email templates could not be loaded.";
    if (list) list.innerHTML = `<p class="et-hint">${escHtml(message)}</p>`;
    setStatus(message, true);
  }
};

const requestSelect = (slug) => {
  if (slug === state.activeSlug) return;
  if (!isDirty()) {
    selectTemplate(slug);
    return;
  }
  const label = state.bySlug.get(state.activeSlug)?.label || "this notification";
  window.showAdminConfirmPopup?.(
    `You have unsaved changes to "${label}". Leave them behind?`,
    {
      title: "Discard Changes",
      confirmText: "Discard",
      onConfirm: () => selectTemplate(slug),
    },
  );
};

document.addEventListener("DOMContentLoaded", () => {
  const search = el("emailTemplateSearch");
  search?.addEventListener("input", () => {
    state.search = String(search.value || "")
      .trim()
      .toLowerCase();
    renderList();
  });

  el("emailTemplateList")?.addEventListener("click", (event) => {
    const button = event.target.closest?.(".et-item[data-slug]");
    if (button) requestSelect(button.dataset.slug || "");
  });

  el("emailTemplateTokens")?.addEventListener("click", (event) => {
    const chip = event.target.closest?.(".et-token[data-token]");
    if (chip) insertToken(chip.dataset.token || "");
  });

  TOKEN_TARGETS.forEach((part) => {
    const input = el(FIELD_IDS[part]);
    if (!input) return;
    input.addEventListener("focus", () => {
      state.lastTokenTarget = part;
    });
    input.addEventListener("input", () => requestPreview());
  });

  const picker = el("emailTplHeaderColor");
  const colorText = el("emailTplHeaderColorText");

  picker?.addEventListener("input", () => {
    if (colorText) colorText.value = safeColor(picker.value);
    requestPreview();
  });

  colorText?.addEventListener("input", () => {
    const raw = String(colorText.value || "").trim();
    if (/^#[0-9a-fA-F]{6}$/.test(raw) && picker) picker.value = raw.toLowerCase();
    requestPreview();
  });

  colorText?.addEventListener("blur", () => {
    // Anything unparseable snaps back to the colour actually being previewed,
    // so the field can never disagree with the email.
    const fixed = safeColor(colorText.value, safeColor(picker?.value));
    colorText.value = fixed;
    if (picker) picker.value = fixed;
  });

  el("emailTplColorSwatches")?.addEventListener("click", (event) => {
    const swatch = event.target.closest?.(".et-swatch[data-color]");
    if (!swatch) return;
    const color = safeColor(swatch.dataset.color);
    if (colorText) colorText.value = color;
    if (picker) picker.value = color;
    requestPreview();
  });

  el("emailTemplateSaveBtn")?.addEventListener("click", () => {
    const row = state.bySlug.get(state.activeSlug);
    if (!row) return;
    window.showAdminConfirmPopup?.(
      `Save "${row.label}"? Every new email of this type will use this wording.`,
      {
        title: "Save Template",
        confirmText: "Save",
        onConfirm: () => void persist(false),
      },
    );
  });

  el("emailTemplateResetBtn")?.addEventListener("click", () => {
    const row = state.bySlug.get(state.activeSlug);
    if (!row) return;
    window.showAdminConfirmPopup?.(
      `Restore the original wording of "${row.label}"? Your saved version is removed.`,
      {
        title: "Restore Default",
        confirmText: "Restore",
        onConfirm: () => void persist(true),
      },
    );
  });

  // A save on the other portal (or a second tab) refreshes this one, but never
  // over the top of wording the user is still typing.
  if (typeof window.BroadcastChannel === "function") {
    try {
      const channel = new window.BroadcastChannel(
        SITE_SETTINGS_REALTIME_CHANNEL,
      );
      channel.addEventListener("message", (event) => {
        if (event?.data?.type !== "updated") return;
        if (isDirty()) {
          setStatus(
            "Another tab saved a template. Save or restore this one to see the update.",
          );
          return;
        }
        void loadTemplates({ keepActive: true });
      });
    } catch {
      /* best effort only */
    }
  }

  void loadTemplates({ keepActive: false });
});
