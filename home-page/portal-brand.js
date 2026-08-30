/* jshint esversion: 9 */
"use strict";

/**
 * Portal login logos (STEP 11, Part C).
 *
 * Applies the two admin-editable marks above the sign-in card on BOTH portals
 * (admin-auth/auth.html and customer-auth/auth.html). The pair is shared: one
 * upload in Website Management -> Home -> Brand Logos drives both pages, so the
 * two portals can never show different branding.
 *
 * There is no new backend for this. The images live in the existing flat
 * `site_settings` table under `portal_logo_primary_image` /
 * `portal_logo_secondary_image`, are written by the existing
 * PUT /api/admin/site-settings, and are read from the already-public
 * GET /api/site-settings.
 *
 * Paint order matters on a login page: a logo that pops in after a network
 * round-trip looks broken. So the last-known pair is written from localStorage
 * synchronously while the script parses, and the network answer only ever
 * corrects it.
 */
(function () {
  var CACHE_KEY = "fmrc_portal_logos";
  var CHANNEL = "fmrc-site-settings-realtime";
  var STAMP_KEY = "fmrc_site_content_updated_at";

  var SLOTS = [
    { id: "portalLogoPrimary", key: "portal_logo_primary_image" },
    { id: "portalLogoSecondary", key: "portal_logo_secondary_image" },
  ];

  var API = (function () {
    var proto = window.location.protocol;
    var host = window.location.hostname;
    var port = window.location.port;
    if (port === "8000") return proto + "//" + host + ":" + port + "/api";
    if (host === "localhost" || host === "127.0.0.1")
      return proto + "//" + host + ":8000/api";
    return proto + "//" + host + "/api";
  })();

  /** The bundled artwork each <img> shipped with, captured before anything is swapped. */
  var defaults = {};

  function el(id) {
    return document.getElementById(id);
  }

  function captureDefaults() {
    SLOTS.forEach(function (slot) {
      if (defaults[slot.key] !== undefined) return;
      var img = el(slot.id);
      defaults[slot.key] = img ? img.getAttribute("src") || "" : "";
    });
  }

  function apply(map) {
    if (!map) return;
    captureDefaults();

    SLOTS.forEach(function (slot) {
      var img = el(slot.id);
      if (!img) return;

      var value = typeof map[slot.key] === "string" ? map[slot.key] : "";
      var next = value !== "" ? value : defaults[slot.key];
      if (!next || img.getAttribute("src") === next) return;

      // A slot that had been hidden by the inline onerror handler is shown
      // again, otherwise a good upload after a bad one would stay invisible.
      img.style.display = "";
      img.setAttribute("src", next);
    });
  }

  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  function writeCache(map) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(map));
    } catch (e) {
      // A quota failure only costs the instant repaint on the next load.
    }
  }

  /** Paint from cache now; the DOM may not be parsed yet, hence the readyState check. */
  function paintFromCache() {
    var cached = readCache();
    if (!cached) return;

    if (document.readyState === "loading") {
      document.addEventListener(
        "DOMContentLoaded",
        function () {
          apply(cached);
        },
        { once: true },
      );
    } else {
      apply(cached);
    }
  }

  var inFlight = false;

  function refresh() {
    if (inFlight) return Promise.resolve();
    inFlight = true;

    return fetch(API + "/site-settings", { headers: { Accept: "application/json" } })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (json) {
        var data = (json && json.data) || {};
        var map = {};
        SLOTS.forEach(function (slot) {
          map[slot.key] =
            typeof data[slot.key] === "string" ? data[slot.key] : "";
        });
        writeCache(map);
        apply(map);
      })
      .catch(function () {
        // Offline or backend down: whatever is on screen (cache, else the
        // bundled files) is already the right answer, so this is a no-op.
      })
      .then(function () {
        inFlight = false;
      });
  }

  paintFromCache();

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      function () {
        captureDefaults();
        void refresh();
      },
      { once: true },
    );
  } else {
    captureDefaults();
    void refresh();
  }

  // Realtime, riding the two signals Website Management already fires. No new
  // channel, no new storage key, and no interval on a login page.
  try {
    if (typeof BroadcastChannel === "function") {
      var chan = new BroadcastChannel(CHANNEL);
      chan.addEventListener("message", function () {
        void refresh();
      });
    }
  } catch (e) {
    // Older browser: the storage listener below is the fallback.
  }

  window.addEventListener("storage", function (event) {
    if (!event) return;
    if (event.key === STAMP_KEY || event.key === CACHE_KEY) void refresh();
  });

  window.addEventListener("focus", function () {
    void refresh();
  });

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) void refresh();
  });

  window.FMRC_PORTAL_LOGOS = { refresh: refresh };
})();
