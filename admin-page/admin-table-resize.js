/* ==========================================================================
   admin-table-resize.js — Excel-style column widths for the back-office tables
   --------------------------------------------------------------------------
   Presentation only: this module reads layout and writes widths. It never
   touches data, requests, polling, auth or any renderer's state, and it holds
   no reference to anything but the <table> elements already on the page.

   What it does, on phones only:
     - freezes each table to `table-layout: fixed` with an explicit width per
       column, clamped to [64, 200]px, so a long value can no longer stretch its
       column and leave the short ones swimming in gaps (10.6d clips the
       overflow with an ellipsis);
     - pins the Action column at exactly 96px — the two-icons-per-line contract
       from 10.6b — and the checkbox column at 40px;
     - puts a 12px drag handle on the left and right edge of every data column's
       header. Dragging either edge resizes that one column, Excel-style; the
       neighbours never move. Double-tapping a handle auto-fits the column;
     - remembers the widths per page + table in `localStorage`.

   Above the phone band it does nothing at all, and `teardown()` restores the
   table to exactly its pre-module rendering, so desktop is untouched.
   ========================================================================== */
(function () {
  "use strict";

  const TABLES =
    "table.admin-table, table.inv-table, table.inv-variant-table, table.analytics-perf-table";

  /* The same union every table band in admin-responsive.css uses: phone widths
     OR a short landscape viewport. A finger does not change size on rotate. */
  const PHONE_QUERY =
    "(max-width: 720px), (orientation: landscape) and (max-height: 520px) and (max-width: 1024px)";

  const MIN_WIDTH = 64;
  const MAX_WIDTH = 200;
  const ACTION_WIDTH = 96;
  const SELECT_WIDTH = 40;
  const READY_CLASS = "atr-ready";
  const STORE_PREFIX = "fmrc.colw.";
  const SIG_DEBOUNCE = 120;
  const SCAN_DEBOUNCE = 250;
  const DOUBLE_TAP_MS = 320;
  const REFIT_GUARD_MS = 350;

  const states = new Map();
  const handleStates = new WeakMap();

  let media = null;
  let domObserver = null;
  let scanTimer = null;
  let drag = null;

  const clampWidth = (px) =>
    !isFinite(px) ? MIN_WIDTH : Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(px)));

  /* `getClientRects()` is the only reliable "is this cell in the layout" test
     here: both bulk mechanisms hide their checkbox column with `display: none`
     (admin-modules.css:468 and :384), and a `display: none` cell is removed
     from the table's column grid — so the widths must be mapped against the
     cells that are actually rendered, never against the DOM order. */
  const isVisible = (cell) => !!cell && cell.getClientRects().length > 0;

  /* Same expression admin-common.js:726 uses: the last <thead> row is the one
     carrying the real column headers. */
  const headerRow = (table) => {
    const head = table.tHead;
    return head && head.rows.length ? head.rows[head.rows.length - 1] : null;
  };

  const kindOf = (cell) => {
    if (cell.matches(".sticky-action, .action-icons")) return "action";
    if (cell.matches(".admin-bulk-select-cell, .inv-select-cell")) return "select";
    return "data";
  };

  const visibleCells = (table) => {
    const row = headerRow(table);
    if (!row) return null;
    const cells = [];
    for (let i = 0; i < row.cells.length; i += 1) {
      const cell = row.cells[i];
      /* A merged header cannot be mapped one-to-one onto a column, so those
         tables are left on the browser's auto layout. */
      if ((cell.colSpan || 1) > 1) return null;
      if (isVisible(cell)) cells.push(cell);
    }
    /* A single rendered column has nothing to resize and cannot open a gap, so
       freezing it would only trade the table's `width: 100%` for a 200px table
       in a wider card. `#reportDataTable` renders exactly that between report
       runs (`<tr><th>Report data</th></tr>`, reports.js:998): measured 200px of
       table in a 270px box at 320. Those stay on the browser's auto layout. */
    if (cells.length < 2) return null;
    if (!cells.some((cell) => kindOf(cell) === "data")) return null;
    return cells;
  };

  /* One character per rendered column ("d" data, "a" action, "s" select). It is
     both the re-entry trigger and part of the storage key, so selection mode
     keeps its own remembered widths instead of invalidating the normal ones. */
  const signature = (cells) => cells.map((cell) => kindOf(cell).charAt(0)).join("");

  const storageKey = (state) =>
    `${STORE_PREFIX}${location.pathname}#${state.table.id || state.index}:${state.sig}`;

  const readStored = (state) => {
    try {
      const raw = window.localStorage.getItem(storageKey(state));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.length === state.sig.length ? parsed : null;
    } catch (err) {
      return null;
    }
  };

  const writeStored = (state) => {
    try {
      window.localStorage.setItem(storageKey(state), JSON.stringify(state.widths));
    } catch (err) {
      /* Private mode or a full quota: the widths simply stay session-only. */
    }
  };

  /* Width of the box the table sits in, so a short table still fills its card
     instead of leaving a white strip down the right-hand side. */
  const hostWidth = (table) => {
    const host = table.parentElement;
    if (!host) return 0;
    const cs = window.getComputedStyle(host);
    const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    return Math.max(0, host.clientWidth - pad);
  };

  /* Hand any leftover space to the data columns, proportionally, and never past
     the 200px cap. With two or more data columns on a phone there is no leftover
     space at all (2 x 200 + 96 already exceeds a 320px screen), so this only
     ever fires on the very narrow tables. */
  const fillSlack = (widths, kinds, avail) => {
    let sum = widths.reduce((a, b) => a + b, 0);
    if (!avail || sum >= avail) return widths.map((w) => Math.round(w));

    let slack = avail - sum;
    let growable = widths
      .map((w, i) => i)
      .filter((i) => kinds[i] === "data" && widths[i] < MAX_WIDTH);

    for (let pass = 0; pass < 8 && slack >= 1 && growable.length; pass += 1) {
      const share = slack / growable.length;
      const next = [];
      growable.forEach((i) => {
        const add = Math.min(MAX_WIDTH - widths[i], share);
        widths[i] += add;
        slack -= add;
        if (widths[i] < MAX_WIDTH - 0.5) next.push(i);
      });
      growable = next;
    }
    /* Still slack: every data column already sits on the 200px cap and the table
       would render narrower than its card — the white strip down the right-hand
       side that `width: 100%` never had. It only happens near the top of the
       phone band (three data columns cap at 600px inside a ~660px card at
       720px wide). The cap is a *drag* clamp, so hand the remainder over anyway;
       the first drag pulls that column back inside [64, 200]. */
    if (slack >= 1) {
      const data = widths.map((w, i) => i).filter((i) => kinds[i] === "data");
      if (data.length) {
        const share = slack / data.length;
        data.forEach((i) => {
          widths[i] += share;
        });
      }
    }
    return widths.map((w) => Math.round(w));
  };

  const resolveWidths = (state, stored) => {
    const natural = state.cells.map((cell) => cell.getBoundingClientRect().width);
    const widths = state.cells.map((cell, i) => {
      if (state.kinds[i] === "action") return ACTION_WIDTH;
      if (state.kinds[i] === "select") return SELECT_WIDTH;
      return clampWidth(stored ? stored[i] : natural[i]);
    });
    return fillSlack(widths, state.kinds, hostWidth(state.table));
  };

  const applyWidths = (state) => {
    let total = 0;
    state.cells.forEach((cell, i) => {
      cell.style.width = `${state.widths[i]}px`;
      total += state.widths[i];
    });
    /* Inline, and all three properties, deliberately: the per-table floors and
       the `table-layout: auto` list are ID selectors (`#appointmentsTable`,
       admin-responsive.css:467-490) that no class rule can outrank, and under
       `table-layout: fixed` a surviving floor hands the slack straight back to
       the columns — the gaps this module exists to remove. `.atr-ready`'s own
       `table-layout` in 10.6d stays as the documented default for any table the
       ID list does not name. All three are cleared again on teardown. */
    state.table.style.tableLayout = "fixed";
    state.table.style.minWidth = "0px";
    state.table.style.width = `${total}px`;
  };

  /* Two handles per data column, one on each edge of its header, so "left side
     and right of each column" is literally true. The left handle of column i
     drives column i-1, which is Excel's boundary semantics. The Action column
     gets none (its 96px is a contract), and neither does the 40px checkbox
     column — two 12px strips there would swallow the checkbox itself. */
  const addHandle = (state, cell, target, side) => {
    const handle = document.createElement("span");
    handle.className = `atr-handle atr-handle--${side}`;
    handle.setAttribute("aria-hidden", "true");
    handle.dataset.atrTarget = String(target);
    handle.addEventListener("pointerdown", onPointerDown);
    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", onPointerUp);
    handle.addEventListener("pointercancel", onPointerUp);
    handle.addEventListener("click", swallow);
    handle.addEventListener("dblclick", onDoubleClick);
    handleStates.set(handle, state);
    cell.appendChild(handle);
    state.handles.push(handle);
  };

  const addHandles = (state) => {
    state.cells.forEach((cell, i) => {
      if (state.kinds[i] === "data") addHandle(state, cell, i, "right");
      if (i > 0 && state.kinds[i - 1] === "data") addHandle(state, cell, i - 1, "left");
    });
  };

  function swallow(event) {
    /* A tap that ends on a handle must not reach the row's click handler. */
    event.preventDefault();
    event.stopPropagation();
  }

  function onPointerDown(event) {
    const handle = event.currentTarget;
    const state = handleStates.get(handle);
    if (!state || drag) return;
    const idx = Number(handle.dataset.atrTarget);
    if (!state.cells[idx]) return;

    drag = {
      state,
      idx,
      handle,
      startX: event.clientX,
      startWidth: state.widths[idx],
      moved: false,
    };
    try {
      handle.setPointerCapture(event.pointerId);
    } catch (err) {
      /* Capture is a nicety; the listeners still work without it. */
    }
    handle.classList.add("is-active");
    document.body.classList.add("atr-dragging");
    event.preventDefault();
    event.stopPropagation();
  }

  function onPointerMove(event) {
    if (!drag || event.currentTarget !== drag.handle) return;
    const dx = event.clientX - drag.startX;
    if (Math.abs(dx) > 2) drag.moved = true;
    drag.state.widths[drag.idx] = clampWidth(drag.startWidth + dx);
    applyWidths(drag.state);
    event.preventDefault();
    event.stopPropagation();
  }

  function onPointerUp(event) {
    if (!drag) return;
    const current = drag;
    drag = null;
    current.handle.classList.remove("is-active");
    document.body.classList.remove("atr-dragging");
    try {
      current.handle.releasePointerCapture(event.pointerId);
    } catch (err) {
      /* Already released with the pointer. */
    }
    event.preventDefault();
    event.stopPropagation();

    if (current.moved) {
      writeStored(current.state);
      return;
    }
    /* A tap that never moved: a second one inside 320ms is the touch equivalent
       of a double-click, which desktop pointers get from `dblclick` below. */
    const now = Date.now();
    if (current.handle.atrLastTap && now - current.handle.atrLastTap < DOUBLE_TAP_MS) {
      current.handle.atrLastTap = 0;
      autoFit(current.state, current.idx);
    } else {
      current.handle.atrLastTap = now;
    }
  }

  function onDoubleClick(event) {
    const state = handleStates.get(event.currentTarget);
    event.preventDefault();
    event.stopPropagation();
    if (state) autoFit(state, Number(event.currentTarget.dataset.atrTarget));
  }

  /* Auto-fit: measure the column the way the browser would with no constraints
     (`max-content` on the table, every explicit width dropped), then clamp back
     into [64, 200]. `REFIT_GUARD_MS` stops the synthetic double-tap and a real
     `dblclick` from both firing on the same gesture. */
  function autoFit(state, idx) {
    const now = Date.now();
    if (!state.cells[idx] || now - (state.lastFit || 0) < REFIT_GUARD_MS) return;
    state.lastFit = now;
    state.applying = true;
    try {
      const saved = state.cells.map((cell) => cell.style.width);
      const savedTableWidth = state.table.style.width;
      state.cells.forEach((cell) => {
        cell.style.width = "";
      });
      state.table.classList.remove(READY_CLASS);
      state.table.style.tableLayout = "";
      state.table.style.width = "max-content";
      const natural = state.cells[idx].getBoundingClientRect().width;
      state.table.classList.add(READY_CLASS);
      state.table.style.width = savedTableWidth;
      state.cells.forEach((cell, i) => {
        cell.style.width = saved[i];
      });
      state.widths[idx] = clampWidth(natural);
      applyWidths(state);
      writeStored(state);
    } finally {
      state.applying = false;
    }
  }

  /* Re-entry. A renderer rewriting <tbody> changes nothing here — the widths
     live on the header cells and the table itself. What does matter is the
     header changing shape: reports.js swaps `#reportDataTable`'s <thead> between
     1 and 8 columns, and both bulk mechanisms toggle a class on the <table> that
     shows or hides the checkbox column. Both move the signature, and only a
     moved signature re-freezes. */
  const observe = (state) => {
    if (typeof MutationObserver !== "function") return;
    state.observer = new MutationObserver(() => {
      if (state.applying) return;
      if (state.timer) clearTimeout(state.timer);
      state.timer = setTimeout(() => {
        state.timer = null;
        if (!state.table.isConnected) {
          unfreeze(state.table);
          return;
        }
        const cells = visibleCells(state.table);
        const sig = cells ? signature(cells) : "";
        /* Identity, not just shape: reports.js rebuilds `#reportDataTable`'s
           <thead> with `innerHTML` (reports.js:996-998), so the header cells this
           state points at can be swapped for an identically-shaped set. The
           signature matches while the widths and every handle leave with the old
           cells — measured on reports.html: `.atr-ready` and a 200px inline width
           still on the table, zero handles, no width on the live <th>. So compare
           the cells themselves, and re-freeze whenever they are not the same
           elements. A renderer that only rewrites <tbody> returns the very same
           header cells, so this stays a no-op on every polling tick. */
        const same =
          !!cells &&
          sig === state.sig &&
          cells.length === state.cells.length &&
          cells.every((cell, i) => cell === state.cells[i]);
        if (same) return;
        const { index } = state;
        unfreeze(state.table);
        if (sig) {
          try {
            freeze(state.table, index);
          } catch (err) {
            /* One malformed table must never break the page. */
          }
        }
      }, SIG_DEBOUNCE);
    });
    state.observer.observe(state.table, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  };

  function freeze(table, index) {
    const cells = visibleCells(table);
    if (!cells) return false;

    const state = {
      table,
      index,
      cells,
      kinds: cells.map(kindOf),
      sig: signature(cells),
      handles: [],
      observer: null,
      timer: null,
      lastFit: 0,
      applying: true,
    };
    state.widths = resolveWidths(state, readStored(state));
    states.set(table, state);

    table.classList.add(READY_CLASS);
    applyWidths(state);
    addHandles(state);
    state.applying = false;
    observe(state);
    return true;
  }

  function unfreeze(table) {
    const state = states.get(table);
    if (!state) return;
    state.applying = true;
    if (state.observer) state.observer.disconnect();
    if (state.timer) clearTimeout(state.timer);
    state.handles.forEach((handle) => {
      handleStates.delete(handle);
      if (handle.parentNode) handle.parentNode.removeChild(handle);
    });
    state.cells.forEach((cell) => {
      cell.style.width = "";
    });
    table.classList.remove(READY_CLASS);
    table.style.width = "";
    table.style.minWidth = "";
    table.style.tableLayout = "";
    states.delete(table);
  }

  const scan = () => {
    if (!media || !media.matches) return;
    const tables = document.querySelectorAll(TABLES);
    tables.forEach((table, i) => {
      if (states.has(table)) return;
      try {
        freeze(table, i);
      } catch (err) {
        states.delete(table);
      }
    });
    /* Tables a renderer replaced wholesale (inventory rebuilds its category
       cards) leave a detached entry behind. */
    Array.from(states.keys()).forEach((table) => {
      if (!table.isConnected) unfreeze(table);
    });
  };

  /* One document-level watcher so the module never has to care about load order
     relative to the renderers, or about tables that only exist once a modal has
     been opened. */
  const watchDocument = () => {
    if (domObserver || typeof MutationObserver !== "function") return;
    domObserver = new MutationObserver(() => {
      if (scanTimer) clearTimeout(scanTimer);
      scanTimer = setTimeout(() => {
        scanTimer = null;
        scan();
      }, SCAN_DEBOUNCE);
    });
    domObserver.observe(document.body, { childList: true, subtree: true });
  };

  const init = () => {
    watchDocument();
    scan();
  };

  const teardown = () => {
    if (domObserver) {
      domObserver.disconnect();
      domObserver = null;
    }
    if (scanTimer) {
      clearTimeout(scanTimer);
      scanTimer = null;
    }
    Array.from(states.keys()).forEach(unfreeze);
  };

  const refresh = () => {
    if (!media || !media.matches) return;
    Array.from(states.keys()).forEach(unfreeze);
    scan();
  };

  const onMediaChange = () => {
    if (media.matches) init();
    else teardown();
  };

  const boot = () => {
    if (!window.matchMedia || !document.body) return;
    media = window.matchMedia(PHONE_QUERY);
    if (media.addEventListener) media.addEventListener("change", onMediaChange);
    else if (media.addListener) media.addListener(onMediaChange);
    if (media.matches) init();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  window.AdminTableResize = { init, refresh, teardown };
})();
