/* jshint esversion: 9 */
/**
 * Hero headline — one renderer, plus a local snapshot for the first frame.
 *
 * The customer home page ships an empty <h2>: the wording lives in
 * site_settings.hero_title and is edited from Website Management → Home, so a
 * hardcoded copy in the markup would flash outdated text for as long as
 * /api/site-settings takes to answer. Instead the last title the visitor saw is
 * kept in localStorage and painted by an inline call before the first paint,
 * and the API response overwrites it when it lands.
 *
 * Loaded ahead of the hero markup in home-page/main.html; main.js reuses the
 * same render() so the pre-paint markup and the realtime one cannot drift.
 */
(function () {
  "use strict";

  var CACHE_KEY = "fmrc_hero_title";

  function esc(str) {
    var d = document.createElement("div");
    d.textContent = str === null || str === undefined ? "" : String(str);
    return d.innerHTML;
  }

  /**
   * Markup for a multi-line title. The last line keeps .hero-research-line so
   * it stays on a single row the way the design calls for.
   */
  function render(title) {
    var lines = String(title || "").split("\n");
    return lines
      .map(function (line, i) {
        return i === lines.length - 1
          ? '<span class="hero-research-line">' + esc(line) + "</span>"
          : esc(line) + "<br />";
      })
      .join("");
  }

  /** Last title this browser saw, or "" on a first visit. */
  function read() {
    try {
      return localStorage.getItem(CACHE_KEY) || "";
    } catch (e) {
      return ""; // storage blocked (private mode) — the API still fills it in
    }
  }

  function write(title) {
    try {
      if (title) localStorage.setItem(CACHE_KEY, title);
      else localStorage.removeItem(CACHE_KEY);
    } catch (e) {
      /* not fatal: the next load just waits for the API instead */
    }
  }

  /**
   * Write the title into the heading. The raw value is mirrored on the element
   * so a realtime re-apply of an unchanged snapshot costs no DOM work, and
   * aria-busy stays on while the heading is still empty.
   */
  function paint(el, title) {
    if (!el) return;
    var next = title ? String(title) : "";
    if (el.getAttribute("data-hero-title") === next) return;
    el.innerHTML = next ? render(next) : "";
    el.setAttribute("data-hero-title", next);
    if (next) el.removeAttribute("aria-busy");
    else el.setAttribute("aria-busy", "true");
  }

  /** First-frame paint from the snapshot; a no-op on a first visit. */
  function paintCached(el) {
    var cached = read();
    if (cached) paint(el, cached);
  }

  window.FMRC_HERO_TITLE = {
    CACHE_KEY: CACHE_KEY,
    render: render,
    read: read,
    write: write,
    paint: paint,
    paintCached: paintCached,
  };
})();
