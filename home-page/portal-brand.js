/* Live login branding. Website Configuration > Login Portals owns appearance;
   authentication fields and actions are intentionally outside this module. */
(function () {
  "use strict";
  const appearance = window.FMRC_PORTAL_APPEARANCE;
  if (!appearance || !document.body.classList.contains("fmrc-auth")) return;
  const portal = document.body.dataset.portal === "admin" ? "admin" : "customer";
  const CACHE_KEY = "fmrc_portal_appearance_v1";
  const LEGACY_CACHE_KEY = "fmrc_portal_logos_v2";
  const STAMP_KEY = "fmrc_site_content_updated_at";
  const CHANNEL = "fmrc-site-settings-realtime";
  const api = (() => {
    const configured = String(window.APP_API_BASE_URL || document.querySelector('meta[name="api-base-url"]')?.content || "").trim();
    if (configured) return configured.replace(/\/+$/, "");
    const { protocol, hostname, origin, port } = window.location;
    if (["localhost", "127.0.0.1"].includes(hostname) && port !== "8000") return `${protocol}//${hostname}:8000/api`;
    return `${origin}/api`;
  })();
  const favicon = document.querySelector('link[rel~="icon"]');
  const faviconDefault = favicon?.getAttribute("href") || "/images/FMRC%20Brand%20Logo.png?v=1";
  const faviconType = favicon?.getAttribute("type") || "";
  let inFlight = null;
  let refreshQueued = false;

  function apply(settings) {
    appearance.apply(document.body, appearance.read(settings, portal));
    if (favicon) {
      const custom = appearance.safeImage(settings.favicon_image);
      favicon.setAttribute("href", custom || faviconDefault);
      if (custom) favicon.setAttribute("type", "image/png");
      else if (faviconType) favicon.setAttribute("type", faviconType);
      else favicon.removeAttribute("type");
    }
  }

  function readCache(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      return value && typeof value === "object" && !Array.isArray(value) ? value : null;
    } catch (_) { return null; }
  }

  function pickSettings(data) {
    const settings = {};
    ["portal_logo_primary_image", "portal_logo_secondary_image", "favicon_image"].forEach(key => {
      if (Object.prototype.hasOwnProperty.call(data, key)) settings[key] = data[key];
    });
    ["customer", "admin"].forEach(name => appearance.fields.forEach(field => {
      const key = appearance.key(name, field);
      if (Object.prototype.hasOwnProperty.call(data, key)) settings[key] = data[key];
    }));
    return settings;
  }

  function refresh() {
    if (inFlight) { refreshQueued = true; return inFlight; }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    inFlight = fetch(`${api}/site-settings`, { headers: { Accept: "application/json" }, cache: "no-cache", signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
      .then(json => {
        const settings = pickSettings(json?.data || {});
        apply(settings);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(settings)); } catch (_) { /* Bundled fallback remains available. */ }
      })
      .catch(() => { /* An offline portal keeps its last saved appearance. */ })
      .finally(() => {
        clearTimeout(timeout);
        inFlight = null;
        if (refreshQueued) { refreshQueued = false; void refresh(); }
      });
    return inFlight;
  }

  apply(readCache(CACHE_KEY) || readCache(LEGACY_CACHE_KEY) || {});
  void refresh();
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.addEventListener("message", () => { void refresh(); });
  } catch (_) { /* The storage listener supports browsers without channels. */ }
  window.addEventListener("storage", event => {
    if ([STAMP_KEY, CACHE_KEY, LEGACY_CACHE_KEY].includes(event.key)) void refresh();
  });
  window.FMRC_PORTAL_LOGOS = { refresh };
})();
