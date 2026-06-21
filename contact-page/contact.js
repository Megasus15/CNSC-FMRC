/**
 * contact.js — Customer Contact Page specific logic
 * Fetches site settings to populate the consent text dynamically and listens for realtime updates.
 */

document.addEventListener("DOMContentLoaded", () => {
  const API_BASE_URL = `${window.location.protocol}//${window.location.hostname}:8000/api`;
  const consentTextEl = document.getElementById("contactConsentTextEl");

  const loadContactSettings = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/site-settings`);
      if (!res.ok) return;
      const json = await res.json();
      const settings = json.data || {};

      if (consentTextEl && settings.contact_consent_text) {
        consentTextEl.textContent = settings.contact_consent_text;
      }
    } catch (err) {
      console.error("Failed to load contact settings:", err);
    }
  };

  void loadContactSettings();

  // Listen for real-time site settings updates from the admin
  const SITE_SETTINGS_CHANNEL = "fmrc-site-settings-realtime";
  if (typeof window.BroadcastChannel === "function") {
    const settingsChannel = new window.BroadcastChannel(SITE_SETTINGS_CHANNEL);
    settingsChannel.addEventListener("message", (event) => {
      const payload = event?.data || {};
      if (payload.type === "updated") {
        void loadContactSettings();
      }
    });
  }
});
