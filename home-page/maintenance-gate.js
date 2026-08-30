/* jshint esversion: 9 */
"use strict";

/**
 * Maintenance Mode — customer-side gate (STEP 11, Part B).
 *
 * The admin flips 11 scopes in Website Management -> Maintenance. This script is
 * what a visitor sees when one of them is on: the affected block is replaced by
 * an explanatory panel and a one-time dialog carries the admin's own wording.
 *
 * Three rules shaped this file:
 *
 *  1. The footer and the navbar are NEVER hidden and footer links are NEVER
 *     intercepted, so a visitor who lands on a page that is offline can always
 *     read the contact details and navigate away.
 *  2. No flash of content that is supposed to be hidden. The last-known snapshot
 *     is applied from localStorage synchronously while this script parses, and
 *     the network answer only ever corrects it. That is also why this file is
 *     loaded BEFORE main.js on every customer page.
 *  3. This is a courtesy, not a security boundary. The authority is server side:
 *     EnsureNotUnderMaintenance on /register, /appointments, /orders and
 *     /customer/messages, plus the two role-aware checks in AuthController.
 *     A phone holding a cached page still cannot post into a disabled page.
 *
 * Realtime rides the pipeline that already exists — the BroadcastChannel and the
 * storage stamp Website Management already fires, and main.js's existing 20 s
 * tick. No new channel, no new storage key, no new interval.
 */
(function () {
  var CACHE_KEY = "fmrc_maintenance_snapshot";
  var CHANNEL = "fmrc-site-settings-realtime";
  var STAMP_KEY = "fmrc_site_content_updated_at";
  var STYLE_ID = "fmrcMaintenanceStyle";
  var HIDE_CLASS = "maint-hidden";

  /** Mirrors MaintenanceSetting::DEFAULTS, so a cold cache still reads well. */
  var DEFAULTS = {
    customer_register:
      "Account registration is temporarily closed for scheduled maintenance.",
    customer_login:
      "Customer sign-in is temporarily unavailable while we perform maintenance.",
    page_home:
      "Our home page is briefly offline for maintenance. Please check back soon.",
    page_services:
      "The Services page is under maintenance. It will be back shortly.",
    page_products:
      "The Products page is under maintenance. Orders will reopen shortly.",
    page_contact:
      "Our contact form is under maintenance. Please reach us again later.",
    page_appointment:
      "Appointment booking is paused for maintenance. Please try again later.",
    home_about: "The About Us section is being updated. Please check back shortly.",
    home_mission: "The Mission section is being updated. Please check back shortly.",
    home_vision: "The Vision section is being updated. Please check back shortly.",
    home_offer: "What We Offer is being updated. Please check back shortly.",
  };

  var API = (function () {
    var proto = window.location.protocol;
    var host = window.location.hostname;
    var port = window.location.port;
    if (port === "8000") return proto + "//" + host + ":" + port + "/api";
    if (host === "localhost" || host === "127.0.0.1")
      return proto + "//" + host + ":8000/api";
    return proto + "//" + host + "/api";
  })();

  /* ------------------------------------------------------------------ state */

  var snapshot = normalise(null);
  var announced = false;
  var inFlight = false;

  function normalise(raw) {
    var source = raw && typeof raw === "object" ? raw : {};
    var out = {};
    Object.keys(DEFAULTS).forEach(function (scope) {
      var row = source[scope] && typeof source[scope] === "object" ? source[scope] : {};
      var text = typeof row.message === "string" ? row.message.trim() : "";
      out[scope] = {
        active: row.active === true || row.active === 1 || row.is_active === true,
        message: text !== "" ? text : DEFAULTS[scope],
      };
    });
    return out;
  }

  function isActive(scope) {
    return !!(snapshot[scope] && snapshot[scope].active);
  }

  function message(scope) {
    return (snapshot[scope] && snapshot[scope].message) || DEFAULTS[scope] || "";
  }

  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
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

  /* ------------------------------------------------------------- page + map */

  /**
   * admin-auth is deliberately absent: admin and staff sign-in is never gated
   * by any scope, so this script is not loaded there at all.
   */
  var PAGE = (function () {
    var path = (window.location.pathname || "").toLowerCase();
    if (path.indexOf("/customer-auth/") !== -1) return "customer-auth";
    if (path.indexOf("/admin-auth/") !== -1) return "admin-auth";
    if (path.indexOf("service") !== -1) return "services";
    if (path.indexOf("product") !== -1) return "products";
    if (path.indexOf("contact") !== -1) return "contact";
    return "home";
  })();

  /**
   * scope -> what to hide on this page, and how to explain it.
   *
   *   page   = the whole page is offline: hide the content, drop one full-width
   *            panel in its place and announce it once with a dialog.
   *   inline = one home-page section is offline: swap it for a panel in place.
   *   silent = hide only; the block is a dialog that is display:none until
   *            opened, so the message is delivered by click interception.
   *
   * No entry anywhere targets footer.site-footer, .main-header or .main-nav.
   */
  var TARGETS = {
    home: {
      page_home: {
        kind: "page",
        hide: ["#home", "#about", "#services-preview", "#appointmentFlow"],
      },
      home_about: { kind: "inline", hide: [".about-section"] },
      home_vision: { kind: "inline", hide: [".vision-section"] },
      home_mission: { kind: "inline", hide: [".mission-section"] },
      home_offer: { kind: "inline", hide: ["#services-preview"] },
      page_appointment: { kind: "silent", hide: ["#appointmentFlow"] },
    },
    services: {
      page_services: {
        kind: "page",
        hide: [".products-toolbar", ".services-list-section"],
      },
    },
    products: {
      page_products: {
        kind: "page",
        hide: [".products-toolbar", "#promotionSpotlight", ".shop-section"],
      },
    },
    contact: {
      page_contact: { kind: "page", hide: ["main.contact-main-section"] },
    },
    "customer-auth": {},
    "admin-auth": {},
  };

  /* ------------------------------------------------------------------ styles */

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var host = document.head || document.documentElement;
    if (!host) return;

    var css = [
      "." + HIDE_CLASS + "{display:none !important;}",
      ".maint-panel{width:100%;box-sizing:border-box;padding:48px 20px;display:flex;",
      "align-items:center;justify-content:center;background:#fdf8f5;}",
      ".maint-panel--page{min-height:62vh;}",
      ".maint-panel--inline{padding:40px 20px;background:transparent;}",
      ".maint-panel__card{width:100%;max-width:560px;box-sizing:border-box;text-align:center;",
      "background:#fff;border:1px solid #f0dcd2;border-radius:18px;padding:34px 28px;",
      "box-shadow:0 12px 30px rgba(95,13,13,0.08);font-family:'Montserrat',sans-serif;}",
      ".maint-panel__icon{width:58px;height:58px;margin:0 auto 16px;border-radius:50%;",
      "display:flex;align-items:center;justify-content:center;background:#fdf1e3;color:#b45309;}",
      ".maint-panel__icon svg{width:28px;height:28px;}",
      ".maint-panel__title{margin:0 0 10px;font-size:1.32rem;font-weight:800;color:#5f0d0d;",
      "letter-spacing:0.2px;}",
      ".maint-panel__text{margin:0;font-size:0.98rem;line-height:1.6;color:#4b3a34;}",
      ".maint-panel__note{margin:14px 0 0;font-size:0.82rem;color:#8a7a74;}",
      ".maint-gated{opacity:0.55;cursor:not-allowed;}",
      "@media (max-width:560px){",
      ".maint-panel{padding:30px 14px;}.maint-panel--inline{padding:24px 14px;}",
      ".maint-panel__card{padding:24px 18px;border-radius:14px;}",
      ".maint-panel__title{font-size:1.1rem;}",
      ".maint-panel__text{font-size:0.9rem;}}",
    ].join("");

    var tag = document.createElement("style");
    tag.id = STYLE_ID;
    tag.textContent = css + fallbackDialogCss();
    host.appendChild(tag);
  }

  /**
   * The four customer pages borrow main.js's own dialog. The auth pages do not
   * load main.js and their sheets do not style .ux-dlg, so the fallback card
   * below carries its own look — deliberately the same maroon language.
   */
  function fallbackDialogCss() {
    return [
      ".maint-dlg{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;",
      "justify-content:center;padding:18px;background:rgba(28,12,12,0.55);",
      "font-family:'Montserrat',sans-serif;}",
      ".maint-dlg__card{width:100%;max-width:400px;box-sizing:border-box;background:#fff;",
      "border-radius:16px;padding:26px 22px;text-align:center;",
      "box-shadow:0 18px 44px rgba(0,0,0,0.28);}",
      ".maint-dlg__icon{width:52px;height:52px;margin:0 auto 14px;border-radius:50%;",
      "display:flex;align-items:center;justify-content:center;background:#fdf1e3;color:#b45309;}",
      ".maint-dlg__icon svg{width:26px;height:26px;}",
      ".maint-dlg__title{margin:0 0 8px;font-size:1.12rem;font-weight:800;color:#5f0d0d;}",
      ".maint-dlg__text{margin:0 0 20px;font-size:0.92rem;line-height:1.55;color:#4b3a34;}",
      ".maint-dlg__btn{width:100%;min-height:44px;border:0;border-radius:10px;cursor:pointer;",
      "background:#5f0d0d;color:#fff;font-family:inherit;font-size:0.95rem;font-weight:700;",
      "transform:none;transition:background-color .18s ease;}",
      ".maint-dlg__btn:hover{background:#4a0808;transform:none;}",
      ".maint-dlg__btn:active{background:#3d0606;transform:scale(0.97);}",
    ].join("");
  }

  var WARN_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>' +
    '<line x1="12" y1="9" x2="12" y2="13"></line>' +
    '<line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';

  /* ------------------------------------------------------------------ panels */

  function buildPanel(scope, kind) {
    var panel = document.createElement("section");
    panel.className =
      "maint-panel maint-panel--" + (kind === "page" ? "page" : "inline");
    panel.setAttribute("data-maint-scope", scope);
    panel.setAttribute("role", "status");
    panel.innerHTML =
      '<div class="maint-panel__card">' +
      '<div class="maint-panel__icon">' +
      WARN_SVG +
      "</div>" +
      '<h2 class="maint-panel__title">Under Maintenance</h2>' +
      '<p class="maint-panel__text"></p>' +
      '<p class="maint-panel__note">Thanks for your patience — please check back soon.</p>' +
      "</div>";
    setPanelText(panel, scope);
    return panel;
  }

  function setPanelText(panel, scope) {
    var textEl = panel.querySelector(".maint-panel__text");
    if (textEl) textEl.textContent = message(scope);
  }

  function collect(selectors) {
    var out = [];
    selectors.forEach(function (sel) {
      var found;
      try {
        found = document.querySelectorAll(sel);
      } catch (e) {
        return;
      }
      Array.prototype.forEach.call(found, function (el) {
        if (out.indexOf(el) === -1) out.push(el);
      });
    });
    return out;
  }

  function existingPanel(scope) {
    return document.querySelector('.maint-panel[data-maint-scope="' + scope + '"]');
  }

  function setScope(scope, cfg, on, keep) {
    var els = collect(cfg.hide);
    var panel = existingPanel(scope);

    if (!on) {
      els.forEach(function (el) {
        /* Never un-hide something another active scope is still hiding — see the
           note in apply(); page_home and home_offer share `#services-preview`. */
        if (keep && keep.indexOf(el) !== -1) return;
        el.classList.remove(HIDE_CLASS);
      });
      if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
      return;
    }

    els.forEach(function (el) {
      el.classList.add(HIDE_CLASS);
    });

    if (cfg.kind === "silent") {
      if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
      return;
    }
    if (panel) {
      setPanelText(panel, scope);
      return;
    }
    var anchor = els.length ? els[0] : null;
    if (!anchor || !anchor.parentNode) return;
    anchor.parentNode.insertBefore(buildPanel(scope, cfg.kind), anchor);
  }

  function apply() {
    if (!document.body) return;
    ensureStyles();

    var map = TARGETS[PAGE] || {};
    var pageScope = null;
    Object.keys(map).forEach(function (scope) {
      if (map[scope].kind === "page" && isActive(scope)) pageScope = scope;
    });

    // A page-level outage supersedes its own sections: one panel, not five.
    // Resolved up front because the union below has to know the final answer.
    var on = {};
    Object.keys(map).forEach(function (scope) {
      on[scope] =
        isActive(scope) &&
        (!pageScope || scope === pageScope || map[scope].kind === "silent");
    });

    /* Scopes deliberately share selectors: page_home hides `#services-preview`
       and `#appointmentFlow`, and so do home_offer and page_appointment. Without
       this union, an INACTIVE section scope's clean-up pass would strip the class
       the active page scope had just added — Object.keys order decides who wins,
       so What We Offer came back onto a Home page that was supposed to be down.
       Collect everything that must stay hidden first, then let each scope only
       clean up what nothing else still claims. */
    var keep = [];
    Object.keys(map).forEach(function (scope) {
      if (!on[scope]) return;
      collect(map[scope].hide).forEach(function (el) {
        if (keep.indexOf(el) === -1) keep.push(el);
      });
    });

    Object.keys(map).forEach(function (scope) {
      setScope(scope, map[scope], on[scope], keep);
    });

    applyAuthGate();
    if (pageScope) announce(pageScope);
  }

  /** The page-level dialog, once per load, and never before main.js has run. */
  function announce(scope) {
    if (announced) return;
    if (document.readyState === "loading") return;
    announced = true;
    window.setTimeout(function () {
      notify(scope);
    }, 400);
  }

  /* ----------------------------------------------------------------- dialogs */

  /**
   * showCustomerPopup is a top-level `const` in main.js, which loads AFTER this
   * file — so a bare reference throws a ReferenceError while it is still in its
   * temporal dead zone. That is why the lookup is lazy and inside try/catch, and
   * why the fallback exists at all (the auth pages never load main.js).
   *
   * Takes a scope key, or a literal message — customer-auth/auth.js passes the
   * text straight out of the server's 503 body, which is already authoritative.
   */
  function notify(scopeOrText) {
    var key = typeof scopeOrText === "string" ? scopeOrText : "";
    var text = Object.prototype.hasOwnProperty.call(DEFAULTS, key)
      ? message(key)
      : key.trim();
    if (!text) return;

    try {
      if (typeof showCustomerPopup === "function") {
        void showCustomerPopup(text, {
          title: "Under Maintenance",
          tone: "warning",
          okText: "Okay",
        });
        return;
      }
    } catch (e) {
      // main.js not evaluated yet, or not on this page.
    }
    fallbackDialog(text);
  }

  var openFallback = null;

  function fallbackDialog(text) {
    ensureStyles();
    if (!document.body) return;
    if (openFallback && openFallback.parentNode) {
      var live = openFallback.querySelector(".maint-dlg__text");
      if (live) live.textContent = text;
      return;
    }

    var overlay = document.createElement("div");
    overlay.className = "maint-dlg";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.innerHTML =
      '<div class="maint-dlg__card">' +
      '<div class="maint-dlg__icon">' +
      WARN_SVG +
      "</div>" +
      '<h3 class="maint-dlg__title">Under Maintenance</h3>' +
      '<p class="maint-dlg__text"></p>' +
      '<button type="button" class="maint-dlg__btn">Okay</button>' +
      "</div>";
    overlay.querySelector(".maint-dlg__text").textContent = text;

    function close() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      document.removeEventListener("keydown", onKey);
      openFallback = null;
    }
    function onKey(ev) {
      if (ev.key === "Escape") close();
    }

    overlay.querySelector(".maint-dlg__btn").addEventListener("click", close);
    overlay.addEventListener("click", function (ev) {
      if (ev.target === overlay) close();
    });
    document.addEventListener("keydown", onKey);

    document.body.appendChild(overlay);
    openFallback = overlay;
  }

  /* ------------------------------------------------------------ interception */

  /** Which scope, if any, a link's destination belongs to. */
  function scopeForLink(href) {
    var h = (href || "").toLowerCase();
    if (!h || h === "#" || h.indexOf("javascript:") === 0) return null;

    var candidates = [];
    if (h.indexOf("#about") !== -1) candidates.push("home_about");
    if (h.indexOf("service.html") !== -1 || h.indexOf("services-page") !== -1)
      candidates.push("page_services");
    if (h.indexOf("product.html") !== -1 || h.indexOf("products-page") !== -1)
      candidates.push("page_products");
    if (h.indexOf("contact.html") !== -1 || h.indexOf("contact-page") !== -1)
      candidates.push("page_contact");
    if (h.indexOf("main.html") !== -1 || h.indexOf("home-page") !== -1)
      candidates.push("page_home");

    for (var i = 0; i < candidates.length; i += 1) {
      if (isActive(candidates[i])) return candidates[i];
    }
    return null;
  }

  /**
   * Capture phase, so the event is stopped before it ever reaches the listeners
   * main.js binds on these very elements — that is how the appointment flow and
   * the orders modal are gated without touching main.js.
   *
   * Anything inside footer.site-footer is skipped on purpose: the footer stays
   * usable so a visitor can always navigate away from a page that is offline.
   */
  function onCaptureClick(ev) {
    var origin = ev.target;
    if (!origin || !origin.closest) return;
    if (origin.closest("footer.site-footer, .site-footer")) return;
    if (origin.closest(".maint-panel, .maint-dlg")) return;

    var scope = null;

    // Restricted to links and buttons on purpose: the gated <form> also carries
    // the attribute, and a broad match would fire the dialog on every click
    // inside the form, including its inputs.
    var gated = origin.closest("a[data-maint-gate], button[data-maint-gate]");
    if (gated) scope = gated.getAttribute("data-maint-gate");

    if (!scope && origin.closest(".btn-appointment")) scope = "page_appointment";
    if (!scope && origin.closest("#viewOrdersBtn")) scope = "page_products";
    if (!scope && origin.closest(".cart-icon-container")) scope = "page_products";

    if (!scope) {
      var link = origin.closest("a[href]");
      if (link) scope = scopeForLink(link.getAttribute("href"));
    }

    if (!scope || !isActive(scope)) return;

    ev.preventDefault();
    ev.stopPropagation();
    if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
    notify(scope);
  }

  /** Enter-in-a-field submits too, so the forms are gated at the submit event. */
  function onCaptureSubmit(ev) {
    var form = ev.target;
    if (!form || !form.getAttribute) return;
    var scope = form.getAttribute("data-maint-gate");
    if (!scope || !isActive(scope)) return;

    ev.preventDefault();
    ev.stopPropagation();
    if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
    notify(scope);
  }

  /* --------------------------------------------------------------- auth page */

  /**
   * Only the customer portal. Admin/staff sign-in is never gated, which is why
   * admin-auth/auth.html does not load this file and PAGE is checked here too.
   *
   * The server 503 is the authority; this only stops a customer wasting a submit
   * and, more importantly, tells them why in the admin's own words.
   */
  var AUTH_GATES = [
    {
      scope: "customer_login",
      selectors: [
        "#loginForm",
        '#loginForm button[type="submit"]',
        "#loginForm .google-auth-btn",
      ],
    },
    {
      scope: "customer_register",
      selectors: [
        "#signupForm",
        '#signupForm button[type="submit"]',
        "#signupForm .google-auth-btn",
        "#openSignupFromLogin",
      ],
    },
  ];

  function applyAuthGate() {
    if (PAGE !== "customer-auth") return;

    AUTH_GATES.forEach(function (gate) {
      var on = isActive(gate.scope);
      collect(gate.selectors).forEach(function (el) {
        var isForm = el.tagName === "FORM";
        if (on) {
          el.setAttribute("data-maint-gate", gate.scope);
          if (isForm) return;
          el.classList.add("maint-gated");
          el.setAttribute("aria-disabled", "true");
          el.setAttribute("title", message(gate.scope));
          return;
        }
        el.removeAttribute("data-maint-gate");
        if (isForm) return;
        el.classList.remove("maint-gated");
        el.removeAttribute("aria-disabled");
        el.removeAttribute("title");
      });
    });
  }

  /* ----------------------------------------------------------------- network */

  function refresh() {
    if (inFlight) return Promise.resolve();
    inFlight = true;

    return fetch(API + "/maintenance", { headers: { Accept: "application/json" } })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (json) {
        snapshot = normalise(json && json.data);
        writeCache(snapshot);
        apply();
      })
      .catch(function () {
        // Offline or backend down: the cached snapshot already on screen is the
        // best answer available, and the server still refuses any real submit.
      })
      .then(function () {
        inFlight = false;
      });
  }

  /* -------------------------------------------------------------------- boot */

  var cached = readCache();
  if (cached) snapshot = normalise(cached);

  document.addEventListener("click", onCaptureClick, true);
  document.addEventListener("submit", onCaptureSubmit, true);

  // This file is loaded at the end of <body>, before main.js, so the content it
  // has to hide is already parsed: the cached snapshot is applied in the same
  // tick and nothing that should be hidden is ever painted.
  apply();

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      function () {
        apply();
        void refresh();
      },
      { once: true },
    );
  } else {
    void refresh();
  }

  // Same browser, instantly: the two signals Website Management already fires.
  try {
    if (typeof BroadcastChannel === "function") {
      new BroadcastChannel(CHANNEL).addEventListener("message", function () {
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

  window.FMRC_MAINTENANCE = {
    get snapshot() {
      return JSON.parse(JSON.stringify(snapshot));
    },
    isActive: isActive,
    message: message,
    refresh: refresh,
    notify: notify,
  };
})();
