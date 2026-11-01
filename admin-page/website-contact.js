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
let settingsLoaded = false;
let settingsSaving = false;

function setSettingsLoaded(loaded) {
  settingsLoaded = Boolean(loaded);
  const button = document.getElementById("btnSaveContact");
  if (button) button.disabled = !settingsLoaded || settingsSaving;
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  document.getElementById("btnSaveContact").addEventListener("click", () => {
    window.showAdminConfirmPopup(
      "Save all Contact page changes to the live website?",
      {
        title: "Save All Changes",
        confirmText: "Save",
        onConfirm: doSave,
      },
    );
  });
});

async function loadSettings(...args) {
  const work = () => loadSettingsData(...args);
  return window.AdminWebsiteLoading ? window.AdminWebsiteLoading.during(work) : work();
}

async function loadSettingsData() {
  setSettingsLoaded(false);
  try {
    const res = await fetch(`${API}/site-settings`);
    if (!res.ok) throw Object.assign(new Error("Contact content could not be loaded."), { status: res.status });
    const json = await res.json();
    const s = json.data;
    if (!s || typeof s !== "object" || Array.isArray(s)) throw new Error("Contact content could not be loaded.");
    setVal("contactHeading", s.contact_heading || "");
    setVal("contactLead", s.contact_lead || "");
    setVal("contactLocation", s.contact_location || "");
    setVal("contactLocationUrl", s.contact_location_url || "");
    setVal("contactEmail", s.contact_email || "");
    setVal("contactPhone", s.contact_phone || "");
    setVal("contactFacebook", s.contact_facebook || "");
    setVal("contactFacebookUrl", s.contact_facebook_url || "");
    setVal("contactFormHeading", s.contact_form_heading || "");
    setVal("contactFormSubtitle", s.contact_form_subtitle || "");
    setVal(
      "contactConsentText",
      s.contact_consent_text ||
        "I hereby consent to the collection, processing, and storage of my personal information in accordance with the Data Privacy Act of 2012 (R.A. 10173).",
    );
    setSettingsLoaded(true);
    window.AdminPageNotice?.clear("contact");
    return true;
  } catch (error) {
    if (window.AdminPageNotice) window.AdminPageNotice.show(error, { key: "contact", retry: loadSettings });
    else window.showAdminPopup("Contact content could not be loaded. Please try again.");
    return false;
  }
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

async function doSave() {
  if (!settingsLoaded || settingsSaving) return;
  const saveButton = document.getElementById("btnSaveContact");
  const originalSaveButtonHtml = saveButton?.innerHTML || "";
  settingsSaving = true;
  if (saveButton) {
    saveButton.disabled = true;
    saveButton.innerHTML =
      '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
  }

  try {
    const payload = {
      contact_heading: document.getElementById("contactHeading").value,
      contact_lead: document.getElementById("contactLead").value,
      contact_location: document.getElementById("contactLocation").value,
      contact_location_url: document.getElementById("contactLocationUrl").value,
      contact_email: document.getElementById("contactEmail").value,
      contact_phone: document.getElementById("contactPhone").value,
      contact_facebook: document.getElementById("contactFacebook").value,
      contact_facebook_url: document.getElementById("contactFacebookUrl").value,
      contact_form_heading: document.getElementById("contactFormHeading").value,
      contact_form_subtitle: document.getElementById("contactFormSubtitle").value,
      contact_consent_text: document.getElementById("contactConsentText").value,
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
    window.showAdminPopup("Contact page settings saved!", { title: "Saved!" });
    if (typeof window.BroadcastChannel === "function") {
      new window.BroadcastChannel("fmrc-site-settings-realtime").postMessage({
        type: "updated",
      });
    }
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
  }
}
