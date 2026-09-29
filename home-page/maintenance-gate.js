/* jshint esversion: 9 */
"use strict";

/**
 * Maintenance Mode — customer-side gate (STEP 11, Part B).
 *
 * The admin flips maintenance scopes in Website Management -> Maintenance. This script is
 * what a visitor sees when one of them is on: the site-wide switch displays a
 * full-screen notice, while individual scopes keep their panels and dialogs.
 *
 * Three rules shaped this file:
 *
 *  1. Individual page outages preserve the footer and navbar. The site-wide
 *     switch supersedes them and prevents customer interaction with the page.
 *  2. No flash of content that is supposed to be hidden. The last-known snapshot
 *     is applied from localStorage synchronously while this script parses, and
 *     the network answer only ever corrects it. That is also why this file is
 *     loaded BEFORE main.js on every customer page.
 *  3. This is a courtesy, not a security boundary. The authority is server side:
 *     EnsureNotUnderMaintenance on /register, /appointments, /orders and
 *     /customer/messages, the customer API middleware, and role-aware checks
 *     in AuthController.
 *     A phone holding a cached page still cannot post into a disabled page.
 *
 * Realtime uses the Website Management BroadcastChannel and storage stamp,
 * visible-tab polling, and a fresh check before visitor interactions.
 */
(function () {
  var CACHE_KEY = "fmrc_maintenance_snapshot";
  var SITE_PAGE_CACHE_KEY = "fmrc_maintenance_site_page";
  var CHANNEL = "fmrc-site-settings-realtime";
  var STAMP_KEY = "fmrc_site_content_updated_at";
  var STYLE_ID = "fmrcMaintenanceStyle";
  var HIDE_CLASS = "maint-hidden";
  var RIBBON_ID = "fmrcMaintenanceRibbon";
  var SITE_ID = "fmrcSiteMaintenance";
  var SITE_EVENT = "fmrc:site-portal-maintenance";
  var SITE_REFRESH_INTERVAL = 15000;
  var INTERACTION_REFRESH_INTERVAL = 1000;
  var illustrationUrl = (function () {
    var script = document.currentScript;
    return script && script.src
      ? new URL("maintenance-illustration.svg?v=2.1", script.src).href
      : "../home-page/maintenance-illustration.svg?v=2.1";
  })();

  /** Mirrors MaintenanceSetting::DEFAULTS, so a cold cache still reads well. */
  var DEFAULTS = {
    site_portal:
      "The FMRC website is temporarily unavailable. Please check back soon.",
    customer_register:
      "Account registration is temporarily closed for scheduled maintenance.",
    customer_login:
      "Customer sign-in is temporarily unavailable while we perform maintenance.",
    page_home:
      "Our home page is briefly offline for maintenance. Please check back soon.",
    page_about:
      "The About Us page is under maintenance. Please check back shortly.",
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

  var SITE_PAGE_DEFAULTS = {
    eyebrow: "A little work in progress",
    headline: "We’ll be back",
    headline_accent: "soon.",
    supporting_line: "Thank you for your patience.",
    image_url: "",
    image_alt: "Technician maintaining a website server",
    theme: "cream_maroon",
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
  var sitePage = normaliseSitePage(null);
  var announcedScope = null;
  var dismissedScope = null;
  var activePageScope = null;
  var ribbonResizeObserver = null;
  var inFlight = false;
  var siteVisible = false;
  var siteInertNodes = [];
  var siteBodyObserver = null;
  var siteResizeObserver = null;
  var siteFitFrame = null;
  var lastInteractionRefresh = 0;
  var pendingRefresh = null;
  var interactionRefresh = null;
  var replayingClick = false;
  var sitePreviousFocus = null;
  var sitePreviousTitle = null;

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

  function normaliseSitePage(raw) {
    var source = raw && typeof raw === "object" ? raw : {};
    var out = {};
    Object.keys(SITE_PAGE_DEFAULTS).forEach(function (key) {
      out[key] = Object.prototype.hasOwnProperty.call(source, key) &&
        typeof source[key] === "string"
        ? source[key].trim()
        : SITE_PAGE_DEFAULTS[key];
    });
    if (!out.headline) out.headline = SITE_PAGE_DEFAULTS.headline;
    if (["cream_maroon", "warm_maroon", "soft_gold"].indexOf(out.theme) === -1)
      out.theme = SITE_PAGE_DEFAULTS.theme;
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
    if (path.indexOf("/about-page/") !== -1) return "about";
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
      site_portal: {
        kind: "page",
        hide: ["#home", ".editorial-content", "#appointmentFlow"],
      },
      page_home: {
        kind: "page",
        hide: ["#home", ".editorial-content", "#appointmentFlow"],
      },
      home_about: { kind: "inline", hide: [".about-section"] },
      home_vision: { kind: "inline", hide: [".vision-section"] },
      home_mission: { kind: "inline", hide: [".mission-section"] },
      home_offer: { kind: "inline", hide: ["#services-preview"] },
      page_appointment: { kind: "silent", hide: ["#appointmentFlow"] },
    },
    about: {
      site_portal: { kind: "page", hide: ["main.editorial-content"] },
      page_about: { kind: "page", hide: ["main.editorial-content"] },
    },
    services: {
      site_portal: {
        kind: "page",
        hide: [".services-list-section"],
      },
      page_services: {
        kind: "page",
        hide: [".services-list-section"],
      },
    },
    products: {
      site_portal: {
        kind: "page",
        hide: [".products-page-intro", ".products-toolbar", "#promotionSpotlight", ".shop-section"],
      },
      page_products: {
        kind: "page",
        hide: [".products-page-intro", ".products-toolbar", "#promotionSpotlight", ".shop-section"],
      },
    },
    contact: {
      site_portal: { kind: "page", hide: [".contact-page-header", "main.contact-main-section"] },
      page_contact: { kind: "page", hide: [".contact-page-header", "main.contact-main-section"] },
    },
    "customer-auth": {
      site_portal: { kind: "page", hide: ["main.auth-page"] },
    },
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
      "body.fmrc-auth > .maint-panel--page{min-height:calc(100dvh - var(--maint-ribbon-height,0px));}",
      ".maint-panel--inline{padding:40px 20px;background:transparent;}",
      ".maint-panel__card{width:100%;max-width:560px;box-sizing:border-box;text-align:center;",
      "background:var(--customer-paper,#fff);border:1px solid #f0dcd2;border-radius:18px;padding:34px 28px;",
      "box-shadow:0 12px 30px rgba(95,13,13,0.08);font-family:'Montserrat',sans-serif;}",
      ".maint-panel__icon{width:58px;height:58px;margin:0 auto 16px;border-radius:50%;",
      "display:flex;align-items:center;justify-content:center;background:#fdf1e3;color:#b45309;}",
      ".maint-panel__icon svg{width:28px;height:28px;}",
      ".maint-panel__title{margin:0 0 10px;font-size:1.32rem;font-weight:800;color:var(--customer-wine,#5f0d0d);",
      "letter-spacing:0.2px;}",
      ".maint-panel__text{margin:0;font-size:0.98rem;line-height:1.6;color:#4b3a34;}",
      ".maint-panel__note{margin:14px 0 0;font-size:0.82rem;color:#8a7a74;}",
      ".maint-gated{opacity:0.55;cursor:not-allowed;}",
      "body.maint-ribbon-visible{padding-bottom:var(--maint-ribbon-height,72px);}",
      ".maint-ribbon{position:fixed;inset:auto auto 0 0;z-index:20000;box-sizing:border-box;width:100vw;",
      "overflow:hidden;padding:12px max(16px,env(safe-area-inset-right)) ",
      "calc(12px + env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));",
      "border-top:1px solid #e6c9c4;background:#fff7f5;color:#563033;",
      "box-shadow:0 -8px 25px rgba(45,12,12,.1);font-family:'Montserrat',sans-serif;}",
      ".maint-ribbon__inner{display:flex;flex-wrap:nowrap;align-items:center;justify-content:center;gap:12px;",
      "width:100%;max-width:1180px;margin:0 auto;text-align:left;font-size:14px;line-height:1.5;}",
      ".maint-ribbon__heading{display:inline-flex;flex:0 0 auto;align-items:center;gap:8px;",
      "margin:0;padding:0;border:0;border-radius:4px;background:none;color:#74151b;",
      "font:inherit;white-space:nowrap;cursor:pointer;transform:none;}",
      ".maint-ribbon__heading:hover,.maint-ribbon__heading:active{background:none;transform:none;}",
      ".maint-ribbon__heading:focus-visible{outline:2px solid #74151b;outline-offset:4px;}",
      ".maint-ribbon__heading strong{color:inherit;font-weight:800;}",
      ".maint-ribbon__icon{display:inline-flex;flex:0 0 24px;width:24px;height:24px;color:inherit;}",
      ".maint-ribbon__icon svg{display:block;width:100%;height:100%;}",
      ".maint-ribbon__text{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:#563033;}",
      "#customerSystemPopup.maint-system-popup .admin-system-popup__card .ux-dlg__head{",
      "display:flex;flex-direction:column;align-items:flex-start;padding:20px 24px 18px;text-align:left;}",
      "#customerSystemPopup.maint-system-popup .admin-system-popup__card .ux-dlg__badge{",
      "flex:0 0 54px;align-self:flex-start;width:54px;height:54px;margin:0 0 12px;}",
      "#customerSystemPopup.maint-system-popup .admin-system-popup__card .ux-dlg__badge svg{width:27px;height:27px;}",
      "#customerSystemPopup.maint-system-popup .admin-system-popup__card .ux-dlg__eyebrow,",
      "#customerSystemPopup.maint-system-popup .admin-system-popup__card .ux-dlg__title{",
      "width:100%;max-width:100%;text-align:left;}",
      "@media (max-width:560px){",
      ".maint-panel{padding:30px 14px;}.maint-panel--inline{padding:24px 14px;}",
      ".maint-panel__card{padding:24px 18px;border-radius:14px;}",
      ".maint-panel__title{font-size:1.1rem;}",
      ".maint-panel__text{font-size:0.9rem;}",
      ".maint-ribbon{padding-left:max(12px,env(safe-area-inset-left));padding-right:max(12px,env(safe-area-inset-right));}",
      ".maint-ribbon__inner{font-size:12px;gap:8px;}",
      ".maint-ribbon__heading{gap:6px;}",
      ".maint-ribbon__icon{flex-basis:19px;width:19px;height:19px;}",
      "#customerSystemPopup.maint-system-popup .admin-system-popup__card .ux-dlg__head{",
      "padding:16px 18px 15px;}",
      "#customerSystemPopup.maint-system-popup .admin-system-popup__card .ux-dlg__badge{",
      "width:48px;height:48px;flex-basis:48px;margin-bottom:9px;}}",
    ].join("");

    var tag = document.createElement("style");
    tag.id = STYLE_ID;
    tag.textContent = css + fallbackDialogCss() + sitePageCss();
    host.appendChild(tag);
  }

  function readSitePageCache() {
    try {
      var raw = localStorage.getItem(SITE_PAGE_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeSitePageCache(settings) {
    try {
      localStorage.setItem(SITE_PAGE_CACHE_KEY, JSON.stringify(settings));
    } catch (e) {
      // The live response still paints correctly when storage is unavailable.
    }
  }

  function sitePageCss() {
    return [
      "html.maint-site-visible,body.maint-site-visible{overflow:hidden!important;scrollbar-gutter:auto!important;}",
      ".maint-site{position:fixed;inset:0 auto auto 0;width:100vw;height:100vh;height:100dvh;",
      "z-index:2147483000;overflow:hidden;overscroll-behavior:none;touch-action:pinch-zoom;box-sizing:border-box;",
      "--ms-bg:#fcf9f4;--ms-blob:#f7eee7;--ms-title:#53202b;",
      "--ms-accent:#9a4b45;--ms-eyebrow:#7a2938;--ms-message:#5d5255;",
      "background:var(--ms-bg);",
      "color:#33242a;font-family:'Montserrat',Arial,sans-serif;}",
      ".maint-site--warm_maroon{--ms-bg:#faf3f1;--ms-blob:#f3e1dd;",
      "--ms-title:#4e1827;--ms-accent:#a13f4d;--ms-eyebrow:#822b3b;",
      "--ms-message:#5b4c51;}",
      ".maint-site--soft_gold{--ms-bg:#fcf9f0;--ms-blob:#f5ecd9;",
      "--ms-title:#583126;--ms-accent:#a97734;--ms-eyebrow:#81552c;",
      "--ms-message:#5d554d;}",
      ".maint-site *{box-sizing:border-box;}",
      ".maint-site [hidden]{display:none!important;}",
      ".maint-site__shell{position:relative;display:grid;grid-template-rows:minmax(0,1fr) auto;",
      "width:min(100%,1440px);height:100%;margin:0 auto;overflow:hidden;",
      "padding:calc(clamp(18px,4dvh,54px) + env(safe-area-inset-top)) ",
      "max(clamp(24px,5vw,76px),env(safe-area-inset-right)) ",
      "calc(clamp(16px,3dvh,28px) + env(safe-area-inset-bottom)) ",
      "max(clamp(24px,5vw,76px),env(safe-area-inset-left));}",
      "#fmrcSiteMaintenance main.maint-site__content{display:grid;",
      "grid-template-columns:minmax(0,.92fr) minmax(0,1.08fr);grid-template-rows:minmax(0,1fr);",
      "align-items:stretch;gap:clamp(20px,4vw,70px);padding:0 0 clamp(14px,3dvh,30px);",
      "width:100%;height:100%;min-width:0;min-height:0;max-width:none;margin:0;",
      "border:0!important;outline:0!important;box-shadow:none!important;background:none;}",
      ".maint-site__copy-frame{position:relative;min-width:0;min-height:0;}",
      ".maint-site__copy{position:absolute;inset:50% auto auto 50%;isolation:isolate;",
      "width:100%;max-width:650px;transform:translate(-50%,-50%) scale(var(--ms-fit,1));",
      "padding:clamp(28px,4vw,64px) clamp(26px,4vw,60px);}",
      ".maint-site__copy:before{content:'';position:absolute;z-index:-1;",
      "inset:0;border-radius:42% 58% 48% 52% / 39% 43% 57% 61%;",
      "background:var(--ms-blob);transform:rotate(-4deg);}",
      ".maint-site__eyebrow{display:block;overflow-wrap:anywhere;",
      "margin:0 0 19px;color:var(--ms-eyebrow);font-size:11px;font-weight:800;",
      "letter-spacing:.17em;text-transform:uppercase;}",
      ".maint-site__eyebrow:before{content:'';display:inline-block;width:32px;height:3px;",
      "margin-right:11px;vertical-align:middle;background:#c8954c;border-radius:4px;}",
      ".maint-site__title{max-width:650px;margin:0;color:var(--ms-title);",
      "font-size:clamp(38px,5.1vw,78px);line-height:1.07;overflow-wrap:anywhere;",
      "font-weight:800;letter-spacing:-.057em;}",
      ".maint-site__title span{display:block;}",
      ".maint-site__title-accent{color:var(--ms-accent);}",
      ".maint-site__message{max-width:520px;margin:25px 0 0;",
      "color:var(--ms-message);font-size:clamp(15px,1.23vw,18px);line-height:1.7;",
      "font-weight:500;overflow-wrap:anywhere;}",
      ".maint-site__rule{display:flex;align-items:center;gap:11px;margin:35px 0 0;",
      "color:#745f62;font-size:12px;font-weight:700;letter-spacing:.015em;overflow-wrap:anywhere;}",
      ".maint-site__rule span{min-width:0;}",
      ".maint-site__rule svg{flex:0 0 19px;width:19px;height:19px;color:#8e3340;}",
      ".maint-site__art{display:flex;align-items:center;justify-content:center;min-width:0;min-height:0;}",
      ".maint-site__art img{display:block;width:100%;height:100%;max-width:720px;max-height:100%;",
      "object-fit:contain;filter:drop-shadow(0 18px 22px rgba(93,35,42,.06));}",
      ".maint-site__foot{display:flex;align-items:center;justify-content:space-between;",
      "gap:20px;padding-top:12px;border-top:1px solid #e7dcd2;color:#8a7879;",
      "font-size:11px;font-weight:600;letter-spacing:.02em;}",
      ".maint-site__foot strong{color:#642532;font-weight:800;letter-spacing:.06em;}",
      "@media(max-width:860px){",
      ".maint-site__shell{padding:calc(clamp(18px,3dvh,28px) + env(safe-area-inset-top)) ",
      "max(25px,env(safe-area-inset-right)) calc(18px + env(safe-area-inset-bottom)) ",
      "max(25px,env(safe-area-inset-left));}",
      "#fmrcSiteMaintenance main.maint-site__content{grid-template-columns:minmax(0,1fr);",
      "grid-template-rows:minmax(0,1.14fr) minmax(0,1fr);gap:8px;padding:0 0 16px;}",
      ".maint-site__copy{max-width:660px;padding:28px 38px;}",
      ".maint-site__title{font-size:clamp(36px,8vw,60px);}",
      ".maint-site__art img{width:min(100%,520px);}",
      "}",
      "@media(max-width:520px){",
      ".maint-site__shell{padding:calc(18px + env(safe-area-inset-top)) ",
      "max(18px,env(safe-area-inset-right)) calc(16px + env(safe-area-inset-bottom)) ",
      "max(18px,env(safe-area-inset-left));}",
      ".maint-site__copy{padding:24px 26px;}",
      ".maint-site__copy:before{border-radius:32% 35% 30% 30% / 10% 16% 15% 13%;",
      "transform:rotate(-2deg);}",
      ".maint-site__eyebrow{font-size:10px;margin-bottom:15px;}",
      ".maint-site__title{font-size:clamp(34px,9.5vw,45px);}",
      ".maint-site__message{margin-top:18px;font-size:14px;line-height:1.65;}",
      ".maint-site__rule{margin-top:23px;font-size:11px;}",
      ".maint-site__foot{font-size:9px;gap:8px;}",
      "}",
      "@media(max-height:540px) and (min-width:521px){",
      ".maint-site__shell{padding:calc(12px + env(safe-area-inset-top)) ",
      "max(22px,env(safe-area-inset-right)) calc(10px + env(safe-area-inset-bottom)) ",
      "max(22px,env(safe-area-inset-left));}",
      "#fmrcSiteMaintenance main.maint-site__content{grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);",
      "grid-template-rows:minmax(0,1fr);gap:12px;padding-bottom:10px;}",
      ".maint-site__copy{padding:20px 25px;}",
      ".maint-site__eyebrow{font-size:9px;margin-bottom:10px;letter-spacing:.12em;}",
      ".maint-site__title{font-size:clamp(29px,4.1vw,44px);}",
      ".maint-site__message{margin-top:14px;font-size:12px;line-height:1.5;}",
      ".maint-site__rule{margin-top:16px;font-size:10px;gap:8px;}",
      ".maint-site__rule svg{width:16px;height:16px;flex-basis:16px;}",
      ".maint-site__foot{font-size:9px;padding-top:8px;}",
      "}",
    ].join("");
  }

  /**
   * The four customer pages borrow main.js's own dialog. The auth pages do not
   * load main.js and their sheets do not style .ux-dlg, so the fallback card
   * below carries its own look — deliberately the same maroon language.
   *
   * Radii and neutrals track the customer site by hand here because this string
   * cannot see main.css's tokens: 8px is `--ux-dlg-radius` (the card corner the
   * whole site's buttons now repeat), #fdfaf6 / #f7f2ec are the paper ladder,
   * and the shadow is warm-tinted rather than neutral black.
   */
  function fallbackDialogCss() {
    return [
      ".maint-dlg{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;",
      "justify-content:center;padding:18px;background:var(--ux-dlg-scrim,rgba(15,23,42,0.55));",
      "font-family:'Montserrat',sans-serif;}",
      ".maint-dlg__card{width:100%;max-width:400px;box-sizing:border-box;background:#fdfaf6;",
      "border-radius:8px;padding:26px 22px;text-align:left;",
      "box-shadow:0 18px 44px rgba(45,12,12,0.28);}",
      ".maint-dlg__icon{width:52px;height:52px;margin:0 0 14px;border-radius:50%;",
      "display:flex;align-items:center;justify-content:center;background:#fdf1e3;color:#b45309;}",
      ".maint-dlg__icon svg{width:26px;height:26px;}",
      ".maint-dlg__title{margin:0 0 8px;font-size:1.12rem;font-weight:800;color:var(--customer-wine,#5f0d0d);}",
      ".maint-dlg__text{margin:0 0 20px;font-size:0.92rem;line-height:1.55;color:#4b3a34;}",
      ".maint-dlg__btn{width:100%;min-height:44px;border:0;border-radius:8px;cursor:pointer;",
      "background:var(--customer-wine,#5f0d0d);color:#f7f2ec;font-family:inherit;font-size:0.95rem;font-weight:700;",
      "transform:none;transition:background-color .18s ease;}",
      ".maint-dlg__btn:hover{background:var(--customer-wine-hover,#4a0808);transform:none;}",
      ".maint-dlg__btn:active{background:var(--customer-wine-hover,#3d0606);transform:scale(0.97);}",
    ].join("");
  }

  // Lucide wrench (ISC); copyright and permission notice: maintenance-assets.md.
  var MAINT_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"></path></svg>';

  /* ------------------------------------------------------- site-wide screen */

  function markSiteBackgroundInert(node) {
    if (!node || node.nodeType !== 1 || node.id === SITE_ID) return;
    if (siteInertNodes.some(function (entry) { return entry.node === node; })) return;
    siteInertNodes.push({
      node: node,
      inert: node.hasAttribute("inert"),
      ariaHidden: node.getAttribute("aria-hidden"),
    });
    node.setAttribute("inert", "");
    node.setAttribute("aria-hidden", "true");
  }

  function restoreSiteBackground() {
    if (siteBodyObserver) siteBodyObserver.disconnect();
    siteBodyObserver = null;
    siteInertNodes.forEach(function (entry) {
      if (!entry.inert) entry.node.removeAttribute("inert");
      if (entry.ariaHidden === null) entry.node.removeAttribute("aria-hidden");
      else entry.node.setAttribute("aria-hidden", entry.ariaHidden);
    });
    siteInertNodes = [];
  }

  function makeSiteScreen() {
    var screen = document.createElement("div");
    screen.id = SITE_ID;
    screen.className = "maint-site";
    screen.innerHTML =
      '<div class="maint-site__shell">' +
      '<main class="maint-site__content" tabindex="-1" ' +
      'aria-labelledby="fmrcSiteMaintenanceTitle">' +
      '<div class="maint-site__copy-frame">' +
      '<div class="maint-site__copy">' +
      '<p class="maint-site__eyebrow">A little work in progress</p>' +
      '<h1 class="maint-site__title" id="fmrcSiteMaintenanceTitle">' +
      '<span class="maint-site__title-primary"></span> ' +
      '<span class="maint-site__title-accent"></span></h1>' +
      '<p class="maint-site__message" role="status" aria-live="polite"></p>' +
      '<p class="maint-site__rule">' + MAINT_SVG +
      '<span>Thank you for your patience.</span></p>' +
      '</div></div>' +
      '<div class="maint-site__art"><img alt="Technician maintaining a website server" /></div>' +
      '</main>' +
      '<div class="maint-site__foot"><span>University of Camarines Norte</span>' +
      '<strong>UCN–FMRC</strong></div>' +
      '</div>';
    syncSiteCopy(screen);
    return screen;
  }

  function siteImageUrl() {
    if (!sitePage.image_url) return illustrationUrl;
    try {
      var url = new URL(sitePage.image_url, window.location.href);
      if (url.protocol === "http:" || url.protocol === "https:") return url.href;
    } catch (e) {
      // A malformed saved URL falls back to the bundled illustration.
    }
    return illustrationUrl;
  }

  function syncSiteCopy(screen) {
    var eyebrow = screen.querySelector(".maint-site__eyebrow");
    eyebrow.textContent = sitePage.eyebrow;
    eyebrow.hidden = !sitePage.eyebrow;
    screen.querySelector(".maint-site__title-primary").textContent = sitePage.headline;
    var accent = screen.querySelector(".maint-site__title-accent");
    accent.textContent = sitePage.headline_accent;
    accent.hidden = !sitePage.headline_accent;
    screen.querySelector(".maint-site__message").textContent = message("site_portal");
    var supporting = screen.querySelector(".maint-site__rule");
    supporting.querySelector("span").textContent = sitePage.supporting_line;
    supporting.hidden = !sitePage.supporting_line;
    var illustration = screen.querySelector(".maint-site__art img");
    var src = siteImageUrl();
    if (illustration.src !== src) illustration.src = src;
    illustration.alt = sitePage.image_alt;
    screen.className = "maint-site maint-site--" + sitePage.theme;
    scheduleSiteFit();
  }

  // Long saved copy and short landscape viewports still fit without scrolling
  // or truncating the administrator's message. Layout remains unscaled unless
  // its natural text height exceeds the available copy frame.
  function fitSiteScreen() {
    siteFitFrame = null;
    var screen = document.getElementById(SITE_ID);
    if (!screen) return;
    var frame = screen.querySelector(".maint-site__copy-frame");
    var copy = screen.querySelector(".maint-site__copy");
    var availableHeight = frame.clientHeight - 8;
    if (availableHeight <= 0 || !copy.offsetHeight) return;
    var scale = Math.min(1, availableHeight / copy.offsetHeight);
    copy.style.setProperty("--ms-fit", String(scale));
  }

  function scheduleSiteFit() {
    if (siteFitFrame !== null) return;
    siteFitFrame = window.requestAnimationFrame(fitSiteScreen);
  }

  function emitSiteState(active) {
    try {
      window.dispatchEvent(new CustomEvent(SITE_EVENT, { detail: { active: active } }));
    } catch (e) {
      // The screen itself is authoritative even if CustomEvent is unavailable.
    }
  }

  function syncSiteScreen(active) {
    if (!document.body) return;
    var screen = document.getElementById(SITE_ID);
    if (active) {
      ensureStyles();
      if (!screen) {
        sitePreviousFocus = document.activeElement;
        sitePreviousTitle = document.title;
        screen = makeSiteScreen();
        document.body.appendChild(screen);
      }
      syncSiteCopy(screen);
      if (!siteResizeObserver && typeof ResizeObserver === "function") {
        siteResizeObserver = new ResizeObserver(scheduleSiteFit);
        siteResizeObserver.observe(screen.querySelector(".maint-site__copy-frame"));
        siteResizeObserver.observe(screen.querySelector(".maint-site__copy"));
      }
      document.body.classList.add("maint-site-visible");
      document.documentElement.classList.add("maint-site-visible");
      document.title = "Website Maintenance | UCN-FMRC";
      Array.prototype.forEach.call(document.body.children, markSiteBackgroundInert);
      if (!siteBodyObserver && typeof MutationObserver === "function") {
        siteBodyObserver = new MutationObserver(function (records) {
          records.forEach(function (record) {
            Array.prototype.forEach.call(record.addedNodes, markSiteBackgroundInert);
          });
        });
        siteBodyObserver.observe(document.body, { childList: true });
      }
      if (!siteVisible) {
        siteVisible = true;
        screen.querySelector("main").focus({ preventScroll: true });
        emitSiteState(true);
      }
      return;
    }
    if (!siteVisible && !screen) return;
    if (siteResizeObserver) siteResizeObserver.disconnect();
    siteResizeObserver = null;
    if (siteFitFrame !== null) window.cancelAnimationFrame(siteFitFrame);
    siteFitFrame = null;
    restoreSiteBackground();
    document.body.classList.remove("maint-site-visible");
    document.documentElement.classList.remove("maint-site-visible");
    if (screen && screen.parentNode) screen.parentNode.removeChild(screen);
    if (sitePreviousTitle !== null) document.title = sitePreviousTitle;
    if (sitePreviousFocus && sitePreviousFocus.isConnected && sitePreviousFocus.focus) {
      sitePreviousFocus.focus({ preventScroll: true });
    }
    sitePreviousTitle = null;
    sitePreviousFocus = null;
    siteVisible = false;
    emitSiteState(false);
  }

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
      MAINT_SVG +
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

  function syncRibbonHeight() {
    var ribbon = document.getElementById(RIBBON_ID);
    if (!document.body) return;
    if (!ribbon) {
      document.body.classList.remove("maint-ribbon-visible");
      document.documentElement.style.removeProperty("--maint-ribbon-height");
      return;
    }
    document.body.classList.add("maint-ribbon-visible");
    document.documentElement.style.setProperty(
      "--maint-ribbon-height",
      Math.ceil(ribbon.getBoundingClientRect().height) + "px",
    );
  }

  function hideRibbon() {
    if (ribbonResizeObserver) ribbonResizeObserver.disconnect();
    var ribbon = document.getElementById(RIBBON_ID);
    if (ribbon && ribbon.parentNode) ribbon.parentNode.removeChild(ribbon);
    syncRibbonHeight();
  }

  function showRibbon(scope) {
    if (!document.body || activePageScope !== scope || !isActive(scope)) return;
    var ribbon = document.getElementById(RIBBON_ID);
    if (!ribbon) {
      ribbon = document.createElement("aside");
      ribbon.id = RIBBON_ID;
      ribbon.className = "maint-ribbon";
      ribbon.setAttribute("role", "status");
      ribbon.setAttribute("aria-live", "polite");
      ribbon.innerHTML =
        '<div class="maint-ribbon__inner">' +
        '<button type="button" class="maint-ribbon__heading" ' +
        'aria-label="Under Maintenance: read the full notice" title="Read the full maintenance notice">' +
        '<span class="maint-ribbon__icon">' + MAINT_SVG + "</span>" +
        '<strong>Under Maintenance</strong></button>' +
        '<span class="maint-ribbon__text"></span></div>';
      ribbon.querySelector(".maint-ribbon__heading").addEventListener("click", function () {
        if (activePageScope && isActive(activePageScope)) void notify(activePageScope);
      });
      document.body.appendChild(ribbon);
      if (typeof ResizeObserver === "function") {
        ribbonResizeObserver = new ResizeObserver(syncRibbonHeight);
        ribbonResizeObserver.observe(ribbon);
      }
    }
    ribbon.querySelector(".maint-ribbon__text").textContent = message(scope);
    syncRibbonHeight();
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
    var sitewide = !!(isActive("site_portal") && map.site_portal);
    if (sitewide) syncSiteScreen(true);
    var pageScope = null;
    if (!sitewide) {
      Object.keys(map).forEach(function (scope) {
        if (!pageScope && map[scope].kind === "page" && isActive(scope)) pageScope = scope;
      });
    }
    activePageScope = pageScope;
    if (dismissedScope !== pageScope) hideRibbon();
    if (!pageScope) {
      announcedScope = null;
      dismissedScope = null;
    }

    // A page-level outage supersedes its own sections: one panel, not five.
    // Resolved up front because the union below has to know the final answer.
    var on = {};
    Object.keys(map).forEach(function (scope) {
      on[scope] =
        !sitewide && isActive(scope) &&
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
    if (!sitewide) syncSiteScreen(false);
    if (pageScope) announce(pageScope);
    if (pageScope && dismissedScope === pageScope) showRibbon(pageScope);
  }

  /** The page-level dialog, once per load, and never before main.js has run. */
  function announce(scope) {
    if (announcedScope === scope) return;
    if (document.readyState === "loading") return;
    announcedScope = scope;
    window.setTimeout(function () {
      if (activePageScope !== scope || !isActive(scope)) return;
      Promise.resolve(notify(scope)).then(function () {
        if (activePageScope !== scope || !isActive(scope)) return;
        dismissedScope = scope;
        showRibbon(scope);
      });
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
    if (siteVisible) return Promise.resolve();
    var key = typeof scopeOrText === "string" ? scopeOrText : "";
    var text = Object.prototype.hasOwnProperty.call(DEFAULTS, key)
      ? message(key)
      : key.trim();
    if (!text) return Promise.resolve();

    try {
      if (typeof showCustomerPopup === "function") {
        var done = showCustomerPopup(text, {
          title: "Under Maintenance",
          tone: "warning",
          eyebrow: "Site maintenance",
          okText: "Okay",
        });
        var popup = document.getElementById("customerSystemPopup");
        if (popup) {
          popup.classList.add("maint-system-popup");
          var badge = popup.querySelector("#customerSystemPopupBadge");
          if (badge) badge.innerHTML = MAINT_SVG;
        }
        return Promise.resolve(done).then(function (result) {
          if (popup) popup.classList.remove("maint-system-popup");
          return result;
        });
      }
    } catch (e) {
      // main.js not evaluated yet, or not on this page.
    }
    return fallbackDialog(text);
  }

  var openFallback = null;
  var openFallbackPromise = null;

  function fallbackDialog(text) {
    ensureStyles();
    if (!document.body) return Promise.resolve();
    if (openFallback && openFallback.parentNode) {
      var live = openFallback.querySelector(".maint-dlg__text");
      if (live) live.textContent = text;
      return openFallbackPromise;
    }

    openFallbackPromise = new Promise(function (resolve) {
      var overlay = document.createElement("div");
      overlay.className = "maint-dlg";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.innerHTML =
        '<div class="maint-dlg__card">' +
        '<div class="maint-dlg__icon">' +
        MAINT_SVG +
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
        openFallbackPromise = null;
        resolve();
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
    });
    return openFallbackPromise;
  }

  /* ------------------------------------------------------------ interception */

  function stopCapturedEvent(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
  }

  function beginInteractionRefresh() {
    if (siteVisible) return null;
    if (interactionRefresh) return interactionRefresh;
    var now = Date.now();
    if (now - lastInteractionRefresh < INTERACTION_REFRESH_INTERVAL) return null;
    lastInteractionRefresh = now;
    var check = refresh();
    interactionRefresh = check;
    Promise.resolve(check).then(function () {
      if (interactionRefresh === check) interactionRefresh = null;
    });
    return check;
  }

  function afterInteractionCheck(check, callback) {
    var finished = false;
    var timer = window.setTimeout(finish, 4000);
    function finish() {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      callback();
    }
    Promise.resolve(check).then(finish, finish);
  }

  function refreshOnInteraction(ev) {
    if (!ev.isTrusted || siteVisible) return;
    if (ev.type === "keydown" && ev.key !== "Enter" && ev.key !== " ") return;
    void beginInteractionRefresh();
  }

  /** Page destinations remain reachable; their own gate explains the outage. */
  function isCustomerPageNavigation(href) {
    var raw = (href || "").trim();
    if (!raw || raw.charAt(0) === "#") return false;
    try {
      var url = new URL(raw, window.location.href);
      if (url.origin !== window.location.origin) return false;
      var path = url.pathname.toLowerCase().replace(/\/+$/, "").replace(/\.html$/, "");
      return ["/home-page/main", "/about-page/about", "/services-page/service",
        "/products-page/product", "/contact-page/contact"].indexOf(path) !== -1;
    } catch (e) {
      return false;
    }
  }

  /** An unavailable inline section can still explain itself before scrolling. */
  function scopeForLink(href) {
    var h = (href || "").toLowerCase();
    if (!h || h === "#" || h.indexOf("javascript:") === 0) return null;

    if (h.indexOf("#about") !== -1 && isActive("home_about")) return "home_about";
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
    if (siteVisible) {
      if (!origin.closest("#" + SITE_ID)) stopCapturedEvent(ev);
      return;
    }
    if (!replayingClick && ev.isTrusted) {
      var check = beginInteractionRefresh();
      if (check) {
        stopCapturedEvent(ev);
        var target = origin;
        afterInteractionCheck(check, function () {
          if (siteVisible || !target.isConnected) return;
          replayingClick = true;
          try {
            if (typeof target.click === "function") target.click();
            else target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
          } finally {
            replayingClick = false;
          }
        });
        return;
      }
    }
    if (origin.closest("footer.site-footer, .site-footer")) return;
    if (origin.closest(".maint-panel, .maint-dlg")) return;

    var pageLink = origin.closest("a[href]");
    if (pageLink && !origin.closest(".btn-appointment, #viewOrdersBtn, .cart-icon-container") &&
        pageLink.getAttribute("data-maint-gate") !== "page_appointment" &&
        isCustomerPageNavigation(pageLink.getAttribute("href"))) return;

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
    if (siteVisible) {
      stopCapturedEvent(ev);
      return;
    }
    if (ev.isTrusted && interactionRefresh) {
      stopCapturedEvent(ev);
      var check = interactionRefresh;
      var submitter = ev.submitter;
      afterInteractionCheck(check, function () {
        if (siteVisible || !form.isConnected) return;
        if (typeof form.requestSubmit === "function") form.requestSubmit(submitter || undefined);
      });
      return;
    }
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
    if (inFlight && pendingRefresh) return pendingRefresh;
    inFlight = true;

    pendingRefresh = fetch(API + "/maintenance", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (json) {
        snapshot = normalise(json && json.data);
        sitePage = normaliseSitePage(json && json.site_page);
        writeCache(snapshot);
        writeSitePageCache(sitePage);
        apply();
      })
      .catch(function () {
        // Offline or backend down: the cached snapshot already on screen is the
        // best answer available, and the server still refuses any real submit.
      })
      .then(function () {
        inFlight = false;
        pendingRefresh = null;
      });
    return pendingRefresh;
  }

  /* -------------------------------------------------------------------- boot */

  var cached = readCache();
  if (cached) snapshot = normalise(cached);
  var cachedSitePage = readSitePageCache();
  if (cachedSitePage) sitePage = normaliseSitePage(cachedSitePage);

  document.addEventListener("click", onCaptureClick, true);
  document.addEventListener("submit", onCaptureSubmit, true);
  document.addEventListener("pointerdown", refreshOnInteraction, true);
  document.addEventListener("keydown", refreshOnInteraction, true);

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
    if (event.key === STAMP_KEY || event.key === CACHE_KEY || event.key === SITE_PAGE_CACHE_KEY)
      void refresh();
  });

  window.addEventListener("focus", function () {
    void refresh();
  });

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) void refresh();
  });

  window.addEventListener("pageshow", function () {
    void refresh();
  });

  window.setInterval(function () {
    if (!document.hidden) void refresh();
  }, SITE_REFRESH_INTERVAL);

  window.addEventListener("resize", syncRibbonHeight);

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
