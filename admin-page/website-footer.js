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

let quickLinks = [];
let settingsLoaded = false;
let settingsSaving = false;
let pageDraft = null;

function setSettingsLoaded(loaded) {
  settingsLoaded = Boolean(loaded);
  const button = document.getElementById("btnSaveFooter");
  if (button) button.disabled = !settingsLoaded || settingsSaving;
  pageDraft?.refresh();
}

document.addEventListener("DOMContentLoaded", async () => {
  pageDraft = window.AdminWebsiteDraft?.create({ button: "btnSaveFooter",
    read: () => window.AdminWebsiteDraft.readFields(document.querySelector(".module-content")),
    ready: () => settingsLoaded, busy: () => settingsSaving });
  await loadSettings();
  document.getElementById("btnSaveFooter").addEventListener("click", () => {
    window.showAdminConfirmPopup(
      "Save all Footer changes? This updates the footer across all customer pages.",
      {
        title: "Save Footer Changes",
        confirmText: "Save",
        onConfirm: doSave,
      },
    );
  });
  document.getElementById("btnAddLink").addEventListener("click", () => {
    addLinkRow({ label: "", url: "" });
  });
});

async function loadSettings(...args) {
  const work = () => loadSettingsData(...args);
  const load = () => window.AdminWebsiteLoading ? window.AdminWebsiteLoading.during(work) : work();
  return settingsSaving ? load() : window.AdminWebsiteDraft.confirmDiscard(load);
}

async function loadSettingsData() {
  setSettingsLoaded(false);
  try {
    const res = await fetch(`${API}/site-settings`);
    if (!res.ok) throw Object.assign(new Error("Footer content could not be loaded."), { status: res.status });
    const json = await res.json();
    const s = json.data;
    if (!s || typeof s !== "object" || Array.isArray(s)) throw new Error("Footer content could not be loaded.");
    setVal("footerBrandName", s.footer_brand_name || s.footerBrandName || "UCN-FMRC");
    setVal("footerBrandSubtitle", s.footer_brand_subtitle || s.footerBrandSubtitle || "Fabrication & Manufacturing Research Center");
    setVal("footerCampusTag", s.footer_campus_tag || s.footerCampusTag || "Main Campus • Daet, Camarines Norte, Philippines, 4600");
    setVal("footerHoursDays", s.footer_hours_days || s.footerHoursDays || "Monday - Friday");
    setVal("footerHoursTime", s.footer_hours_time || s.footerHoursTime || "7:00am - 6:00pm");
    setVal("footerContactLocation", s.footer_contact_location || s.footerContactLocation || "First Flr., Graduate School Building, University of Camarines Norte, Daet, Philippines");
    setVal("footerContactLocationUrl", s.footer_contact_location_url || s.footerContactLocationUrl || "https://www.google.com/maps/search/?api=1&query=Camarines+Norte+State+College,+Daet,+Philippines");
    setVal("footerContactEmail", s.footer_contact_email || s.footerContactEmail || "fmrc@cnsc.edu.ph");
    setVal("footerContactPhone", s.footer_contact_phone || s.footerContactPhone || "0909-099-0000");
    setVal("footerContactFacebook", s.footer_contact_facebook || s.footerContactFacebook || "UCN FMRC");
    setVal("footerContactFacebookUrl", s.footer_contact_facebook_url || s.footerContactFacebookUrl || "https://www.facebook.com/share/18MJcUvJeM/");
    setVal("footerPublicWebsiteLabel", s.footer_public_website_label || s.footerPublicWebsiteLabel || "Official UCN website");
    setVal("footerPublicWebsiteUrl", s.footer_public_website_url || s.footerPublicWebsiteUrl || "https://ucn.edu.ph");
    setVal("footerPublicUcnFbLabel", s.footer_public_ucn_fb_label || s.footerPublicUcnFbLabel || "UCN official Facebook page");
    setVal("footerPublicUcnFbUrl", s.footer_public_ucn_fb_url || s.footerPublicUcnFbUrl || "https://www.facebook.com/ucnofficial");
    setVal("footerCopyright", s.footer_copyright || s.footerCopyright || "© 2026 UCN Fabrication and Manufacturing Research Center. All rights reserved.");
    setVal("footerBottomDev", s.footer_bottom_dev || s.footerBottomDev || "Developed for UCN – Fabrication and Manufacturing Research Center.");

    try {
      quickLinks = JSON.parse(s.footer_quick_links || "[]");
    } catch {
      quickLinks = [];
    }
    renderQuickLinks();
    setSettingsLoaded(true);
    pageDraft?.capture();
    window.AdminPageNotice?.clear("footer");
    return true;
  } catch (error) {
    if (window.AdminPageNotice) window.AdminPageNotice.show(error, { key: "footer", retry: loadSettings });
    else window.showAdminPopup("Footer content could not be loaded. Please try again.");
    return false;
  }
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

function renderQuickLinks() {
  const container = document.getElementById("quickLinksContainer");
  container.innerHTML = "";
  if (!quickLinks.length) {
    addLinkRow({ label: "Home", url: "/home-page/main.html" });
    return;
  }
  quickLinks.forEach((link, i) => addLinkRow(link, i));
}

function addLinkRow(link = { label: "", url: "" }, insertIdx = null) {
  const container = document.getElementById("quickLinksContainer");
  const row = document.createElement("div");
  row.className = "ql-row";
  row.innerHTML = `
    <input type="text" class="ql-label wm-input" placeholder="Label (e.g. Home)" value="${escHtml(link.label)}" />
    <input type="text" class="ql-url wm-input" placeholder="URL (e.g. /home-page/main.html)" value="${escHtml(link.url)}" />
    <button class="ql-del" title="Remove link">×</button>
  `;
  row.querySelector(".ql-del").addEventListener("click", () => {
    window.showAdminConfirmPopup("Remove this quick link?", {
      title: "Remove Link",
      confirmText: "Remove",
      onConfirm: () => row.remove(),
    });
  });
  container.appendChild(row);
}

function escHtml(str) {
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML;
}

function collectQuickLinks() {
  return Array.from(document.querySelectorAll("#quickLinksContainer .ql-row"))
    .map((row) => ({
      label: row.querySelector(".ql-label").value.trim(),
      url: row.querySelector(".ql-url").value.trim(),
    }))
    .filter((l) => l.label || l.url);
}

async function doSave() {
  if (!settingsLoaded || settingsSaving || (pageDraft && !pageDraft.isDirty())) return;
  const saveButton = document.getElementById("btnSaveFooter");
  const originalSaveButtonHtml = saveButton?.innerHTML || "";
  settingsSaving = true;
  if (saveButton) {
    saveButton.disabled = true;
    saveButton.innerHTML =
      '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
  }

  try {
    const links = collectQuickLinks();
    const getV = (id) => (document.getElementById(id)?.value || "").trim();
    const payload = {
      footer_brand_name: getV("footerBrandName"),
      footer_brand_subtitle: getV("footerBrandSubtitle"),
      footer_campus_tag: getV("footerCampusTag"),
      footer_quick_links: JSON.stringify(links),
      footer_hours_days: getV("footerHoursDays"),
      footer_hours_time: getV("footerHoursTime"),
      footer_contact_location: getV("footerContactLocation"),
      footer_contact_location_url: getV("footerContactLocationUrl"),
      footer_contact_email: getV("footerContactEmail"),
      footer_contact_phone: getV("footerContactPhone"),
      footer_contact_facebook: getV("footerContactFacebook"),
      footer_contact_facebook_url: getV("footerContactFacebookUrl"),
      footer_public_website_label: getV("footerPublicWebsiteLabel"),
      footer_public_website_url: getV("footerPublicWebsiteUrl"),
      footer_public_ucn_fb_label: getV("footerPublicUcnFbLabel"),
      footer_public_ucn_fb_url: getV("footerPublicUcnFbUrl"),
      footer_copyright: getV("footerCopyright"),
      footer_bottom_dev: getV("footerBottomDev"),
      footerBrandName: getV("footerBrandName"),
      footerBrandSubtitle: getV("footerBrandSubtitle"),
      footerCampusTag: getV("footerCampusTag"),
      footerHoursDays: getV("footerHoursDays"),
      footerHoursTime: getV("footerHoursTime"),
      footerPublicWebsiteLabel: getV("footerPublicWebsiteLabel"),
      footerPublicWebsiteUrl: getV("footerPublicWebsiteUrl"),
      footerPublicUcnFbLabel: getV("footerPublicUcnFbLabel"),
      footerPublicUcnFbUrl: getV("footerPublicUcnFbUrl"),
      footerCopyright: getV("footerCopyright"),
      footerBottomDev: getV("footerBottomDev"),
    };
    const res = await fetch(`${API}/admin/site-settings`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token(),
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error();
    window.showAdminPopup("Footer settings saved!", { title: "Saved!" });
    // The footer is on every customer page, so a saved change here has to reach
    // open tabs the same way a Home or Contact save does. Without this the only
    // thing that ever noticed was main.js's 20 s poll, which made an identical
    // edit look instant on some panels and delayed on this one.
    broadcastSiteUpdate();
    await loadSettings();
  } catch (error) {
    const uncertain = error?.name === "TimeoutError" || error?.name === "AbortError";
    if (uncertain) setSettingsLoaded(false);
    window.showAdminPopup(uncertain
      ? "We couldn't confirm whether your changes were saved. Refresh the page content to check before trying again."
      : "Changes could not be saved. Please try again.", { title: uncertain ? "Save Not Confirmed" : "Changes Not Saved" });
  } finally {
    settingsSaving = false;
    if (saveButton) {
      saveButton.disabled = !settingsLoaded;
      saveButton.innerHTML =
        originalSaveButtonHtml ||
        '<i class="fa-solid fa-floppy-disk"></i> Save All Changes';
    }
    pageDraft?.refresh();
  }
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
