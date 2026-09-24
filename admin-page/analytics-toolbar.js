/*
 * analytics-toolbar.js — AnalyticsToolbar.mount(selector, opts)
 *
 * The single reporting-period control behind both the dashboard revenue hero
 * and the three product-analytics cards, on the admin and staff portals alike.
 * It renders Today / This Week / This Month / This Year / All-time plus a
 * Custom range (keys day/week/month/year/all/custom — the exact keys
 * App\Support\AnalyticsPeriod resolves on the backend). Custom reveals native
 * <input type="date"> From/To fields (iOS-friendly) in a panel inline to the
 * RIGHT of the pill strip, on one row; on modern-iPhone widths the strip and
 * panel scroll together as a single row. The choice — and any custom range — persists per page to
 * localStorage, and onChange fires only on a real user change:
 *   onChange({ period })                       for a preset
 *   onChange({ period: "custom", from, to })   for a custom range (YYYY-MM-DD)
 * The page owns its initial load: read getState() after mount and fetch once
 * yourself, so mounting never double-fires a request.
 *
 * Exposed as a global (window.AnalyticsToolbar) because the pages load it as a
 * plain <script>, and because the staff products loader injects module markup
 * after admin-common.js has run and must be able to re-mount on demand.
 */
(function () {
  "use strict";

  const PERIODS = [
    { key: "day", label: "Today" },
    { key: "week", label: "This Week" },
    { key: "month", label: "This Month" },
    { key: "year", label: "This Year" },
    { key: "all", label: "All-time" },
  ];
  const PRESET_KEYS = new Set(PERIODS.map((p) => p.key));
  const DEFAULT_PERIOD = "month";
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

  const isIsoDate = (v) => typeof v === "string" && ISO_DATE.test(v);
  const rangeOk = (from, to) => isIsoDate(from) && isIsoDate(to) && from <= to;

  function todayIso() {
    const n = new Date();
    const m = String(n.getMonth() + 1).padStart(2, "0");
    const d = String(n.getDate()).padStart(2, "0");
    return `${n.getFullYear()}-${m}-${d}`;
  }

  function fmtShort(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }
  const rangeLabel = (from, to) =>
    from === to ? fmtShort(from) : `${fmtShort(from)} – ${fmtShort(to)}`;

  function readStored(storageKey) {
    if (!storageKey) return null;
    try {
      const v = localStorage.getItem(storageKey);
      return PRESET_KEYS.has(v) || v === "custom" ? v : null;
    } catch (_) {
      return null;
    }
  }
  function readRange(storageKey, part) {
    if (!storageKey) return "";
    try {
      const v = localStorage.getItem(`${storageKey}:${part}`);
      return isIsoDate(v) ? v : "";
    } catch (_) {
      return "";
    }
  }
  function write(storageKey, suffix, value) {
    if (!storageKey) return;
    try {
      localStorage.setItem(suffix ? `${storageKey}:${suffix}` : storageKey, value);
    } catch (_) {
      /* private mode / quota — the control still works in-memory */
    }
  }
  function mount(target, opts) {
    const options = opts || {};
    const host =
      typeof target === "string" ? document.querySelector(target) : target;
    if (!host) return null;

    const storageKey = options.storageKey || "";
    const onChange =
      typeof options.onChange === "function" ? options.onChange : function () {};

    // Restore prior selection. A stored "custom" is only honoured if its saved
    // range is still valid; otherwise fall back to the initial/default preset.
    let customFrom = readRange(storageKey, "from");
    let customTo = readRange(storageKey, "to");
    let current = readStored(storageKey);
    if (current === "custom" && !rangeOk(customFrom, customTo)) current = null;
    if (!current)
      current = PRESET_KEYS.has(options.initialPeriod)
        ? options.initialPeriod
        : DEFAULT_PERIOD;

    host.classList.add("analytics-toolbar");
    host.innerHTML = "";

    // The custom panel is a SIBLING of the pill strip (not inside its
    // overflow-x box), so it sits inline to the strip's right and is never
    // swallowed by the strip's own horizontal scroll.
    const segments = document.createElement("div");
    segments.className = "analytics-toolbar__segments";
    segments.setAttribute("role", "tablist");
    segments.setAttribute(
      "aria-label",
      options.ariaLabel || "Select reporting period",
    );
    host.appendChild(segments);

    const order = [...PERIODS.map((p) => p.key), "custom"];
    const buttons = [];
    const makeBtn = (key, label) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "analytics-toolbar__btn";
      btn.dataset.period = key;
      btn.textContent = label;
      btn.setAttribute("role", "tab");
      segments.appendChild(btn);
      buttons.push(btn);
      return btn;
    };
    PERIODS.forEach((p) => makeBtn(p.key, p.label));
    const customBtn = makeBtn("custom", "Custom");
    customBtn.classList.add("analytics-toolbar__btn--custom");
    customBtn.setAttribute("aria-haspopup", "true");
    customBtn.setAttribute("aria-expanded", "false");
    const panel = document.createElement("div");
    panel.className = "analytics-toolbar__custom";
    panel.hidden = true;
    panel.innerHTML =
      '<label class="analytics-toolbar__field"><span class="analytics-toolbar__field-label">From</span>' +
      '<input type="date" class="analytics-toolbar__date" data-role="from" aria-label="From date" /></label>' +
      '<span class="analytics-toolbar__range-sep" aria-hidden="true">–</span>' +
      '<label class="analytics-toolbar__field"><span class="analytics-toolbar__field-label">To</span>' +
      '<input type="date" class="analytics-toolbar__date" data-role="to" aria-label="To date" /></label>' +
      '<button type="button" class="analytics-toolbar__apply">Apply</button>';
    host.appendChild(panel);

    const fromInput = panel.querySelector('[data-role="from"]');
    const toInput = panel.querySelector('[data-role="to"]');
    const applyBtn = panel.querySelector(".analytics-toolbar__apply");
    if (isIsoDate(customFrom)) fromInput.value = customFrom;
    if (isIsoDate(customTo)) toInput.value = customTo;

    function paint() {
      const activeKey = current === "custom" ? "custom" : current;
      buttons.forEach((b) => {
        const on = b.dataset.period === activeKey;
        b.setAttribute("aria-selected", String(on));
        b.tabIndex = on ? 0 : -1;
      });
      customBtn.textContent =
        current === "custom" && rangeOk(customFrom, customTo)
          ? rangeLabel(customFrom, customTo)
          : "Custom";
    }

    function openPanel(open) {
      panel.hidden = !open;
      customBtn.setAttribute("aria-expanded", String(open));
      host.classList.toggle("is-custom-open", open);
      if (open) {
        const max = todayIso();
        fromInput.max = max;
        toInput.max = max;
        panel.classList.remove("is-invalid");
        (fromInput.value ? toInput : fromInput).focus({ preventScroll: true });
        // On narrow (iPhone) widths the strip + panel form one scrolling row.
        // Bring the panel's LEFT edge (the From field) to the visible left so the
        // user meets From → To → Apply in reading order; scrolling to the far
        // right instead would open on Apply with From off-screen. The tightened
        // panel fits one phone viewport, so this reveals every control at once.
        // Instant (not smooth): a smooth scroll is dropped under
        // prefers-reduced-motion and in headless/automated engines, which would
        // leave the panel stranded off-screen — the reveal must always land.
        if (host.scrollWidth > host.clientWidth) {
          const delta =
            panel.getBoundingClientRect().left -
            host.getBoundingClientRect().left;
          host.scrollTo({ left: host.scrollLeft + delta, behavior: "auto" });
        }
      }
    }

    function selectPreset(key, fire) {
      openPanel(false);
      if (!PRESET_KEYS.has(key) || key === current) return;
      current = key;
      write(storageKey, "", key);
      paint();
      if (fire) onChange({ period: current });
    }
    function applyCustom() {
      const from = fromInput.value;
      const to = toInput.value;
      if (!rangeOk(from, to)) {
        panel.classList.add("is-invalid");
        (isIsoDate(from) ? toInput : fromInput).focus();
        return;
      }
      customFrom = from;
      customTo = to;
      current = "custom";
      write(storageKey, "", "custom");
      write(storageKey, "from", from);
      write(storageKey, "to", to);
      openPanel(false);
      paint();
      onChange({ period: "custom", from, to });
    }

    segments.addEventListener("click", (e) => {
      const btn = e.target.closest(".analytics-toolbar__btn");
      if (!btn || !segments.contains(btn)) return;
      if (btn.dataset.period === "custom") openPanel(panel.hidden);
      else selectPreset(btn.dataset.period, true);
    });

    // Roving focus across the pills; arrowing onto a preset applies it (as the
    // old control did), while arrowing onto Custom only focuses it — a range
    // isn't chosen until Apply.
    segments.addEventListener("keydown", (e) => {
      const activeKey = current === "custom" ? "custom" : current;
      let idx = order.indexOf(activeKey);
      const focused = document.activeElement;
      const fIdx = buttons.indexOf(focused);
      if (fIdx !== -1) idx = fIdx;
      let next = -1;
      if (e.key === "ArrowRight" || e.key === "ArrowDown")
        next = (idx + 1) % order.length;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
        next = (idx - 1 + order.length) % order.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = order.length - 1;
      else return;
      e.preventDefault();
      buttons[next].focus();
      if (order[next] !== "custom") selectPreset(order[next], true);
    });

    applyBtn.addEventListener("click", applyCustom);
    panel.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        applyCustom();
      } else if (e.key === "Escape") {
        openPanel(false);
        customBtn.focus();
      }
      if (e.target.classList.contains("analytics-toolbar__date"))
        panel.classList.remove("is-invalid");
    });
    document.addEventListener("click", (e) => {
      if (!host.contains(e.target)) openPanel(false);
    });

    paint();

    return {
      el: host,
      getState: () =>
        current === "custom" && rangeOk(customFrom, customTo)
          ? { period: "custom", from: customFrom, to: customTo }
          : { period: current },
      getPeriod: () => current,
      setPeriod: (key, fire) => selectPreset(key, fire === true),
      setBusy: (busy) => host.setAttribute("aria-busy", busy ? "true" : "false"),
    };

  }

  window.AnalyticsToolbar = { mount, PERIODS };
})();
