/* ==========================================================================
   fmrc-loader.js — the UCN-FMRC action curtain
   FMRC-MARK v2 — the approved 3D hero-logo medallion

   One object, three methods:

     FMRCLoader.show(caption, hint)          raise the curtain
     FMRCLoader.hide()                       lower it
     FMRCLoader.during(work, caption, hint)  raise it, await work, always lower

   Every curtain raise enforces a minimum display floor of 700–900 ms
   (randomised so the timing never looks mechanical) so the page underneath
   has time to settle before the visitor sees it. The floor is capped at
   1 500 ms — if the actual work takes longer than 1.5 s the curtain lifts
   immediately when the work finishes, never adding extra idle time on top
   of an already-long wait.

   Calls nest. A flow that already raised the curtain and then calls a helper
   that raises it again keeps one curtain, and it only comes down when the
   outermost call finishes — so a nested helper returning early can never
   unveil a page that is still working. Copy nests with it: the innermost
   caption shows while it is active, then the outer one is restored.

   The boot curtain is NOT handled here. Each page's inline <head> script owns
   it, so a page whose fmrc-loader.js request fails can never be left stranded
   behind a curtain with nothing left to lift it.

   Depends on nothing — no main.js, no auth.js, no library. customer-auth
   loads this file and main.js does not exist on that page.
   ========================================================================== */

(function () {
  "use strict";

  /* A page that somehow includes this file twice keeps the first instance, so
     the reference count can never be split across two objects. */
  if (window.FMRCLoader) return;

  var veil = null; /* built on first show(), then reused for the page's life */
  var captionEl = null;
  var hintEl = null;
  var stack = []; /* one entry per live show(); the last entry is what shows */

  var DEFAULT_CAPTION = "Working on it";

  /* Minimum-display-floor bookkeeping. Only the *outermost* show/hide pair
     owns the timer — nested calls inherit the outer one's clock. */
  var FLOOR_MIN = 700;
  var FLOOR_MAX = 900;
  var FLOOR_CAP = 1500;
  var showStart = 0;      /* performance.now() recorded by the outermost show */
  var floorMs   = 0;      /* random value between FLOOR_MIN and FLOOR_MAX     */
  var floorCap  = FLOOR_CAP;
  var hideTimer = 0;      /* id of a pending delayed-hide setTimeout           */

  function randomFloor(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  function resolveTiming(options) {
    if (!options || typeof options !== "object") {
      return { min: FLOOR_MIN, max: FLOOR_MAX, cap: FLOOR_CAP };
    }

    var cap = Number.isFinite(options.cap) ? Math.max(0, options.cap) : FLOOR_CAP;
    var min = Number.isFinite(options.min) ? Math.max(0, options.min) : FLOOR_MIN;
    var max = Number.isFinite(options.max) ? Math.max(min, options.max) : FLOOR_MAX;
    min = Math.min(min, cap);
    max = Math.min(max, cap);
    return { min: min, max: Math.max(min, max), cap: cap };
  }

  function part(className, parent, tagName) {
    var node = document.createElement(tagName || "span");
    if (className) node.className = className;
    if (parent) parent.appendChild(node);
    return node;
  }

  /* Mirrors the static boot markup, which can render without this script.
     The shared stylesheet owns the artwork, scale, material and all motion. */
  function createMark() {
    var mark = part("fmrc-load-mark", null, "div");
    mark.setAttribute("aria-hidden", "true");
    part("fmrc-load-shadow", mark);
    var floating = part("fmrc-load-float", mark);
    var assembly = part("fmrc-load-assembly", floating);
    part("", part("fmrc-load-satellite", assembly));
    part("fmrc-load-orbit-track", part("fmrc-load-orbit", assembly));
    for (var layer = -7; layer <= 7; layer += 1) {
      part("fmrc-load-edge", assembly).style.setProperty("--layer", String(layer));
    }
    var face = part("fmrc-load-face", assembly);
    part("fmrc-load-logo", part("fmrc-load-logo-bed", face));
    return mark;
  }

  /* Builds the curtain the first time something asks for it — the same lazy
     convention as ensureCustomerSystemPopup() in main.js. A page where nobody
     ever submits anything never gets an extra node.

     Appended straight to <body> so no transformed or filtered ancestor can
     break `position: fixed`. The mark, caption, hint and rail are the exact
     classes the boot curtain uses, so the two curtains are one component with
     two backdrops rather than two components that resemble each other. */
  function build() {
    if (veil) return;

    veil = document.createElement("div");
    veil.className = "fmrc-load-veil";
    veil.setAttribute("role", "status");
    veil.setAttribute("aria-live", "polite");
    veil.setAttribute("aria-atomic", "true");

    var core = document.createElement("div");
    core.className = "fmrc-load-core";

    core.appendChild(createMark());
    var brand = part("fmrc-load-brand", core, "p");
    brand.textContent = "UCN–FMRC";
    var name = part("fmrc-load-name", core, "p");
    name.appendChild(document.createTextNode("Fabrication & Manufacturing"));
    name.appendChild(document.createElement("br"));
    name.appendChild(document.createTextNode("Research Center"));

    captionEl = document.createElement("p");
    captionEl.className = "fmrc-load-caption";

    hintEl = document.createElement("p");
    hintEl.className = "fmrc-load-hint";

    var rail = document.createElement("div");
    rail.className = "fmrc-load-rail";
    rail.setAttribute("aria-hidden", "true");
    rail.appendChild(document.createElement("span"));

    core.appendChild(captionEl);
    core.appendChild(hintEl);
    core.appendChild(rail);
    veil.appendChild(core);
    (document.body || document.documentElement).appendChild(veil);

    /* One synchronous style flush, so the browser has an "off" state to
       transition away from on this very first raise. A layout read, not a
       timer: the class goes on later in this same task. */
    void veil.offsetWidth;
  }

  /* Renders whatever sits on top of the stack. An empty hint removes the line
     rather than blanking it — `.fmrc-load-hint:empty` is display:none, so the
     layout reserves no space for a sentence that is not there. */
  function render() {
    var top = stack[stack.length - 1];
    if (!top || !captionEl) return;
    captionEl.textContent = top.caption;
    hintEl.textContent = top.hint;
  }

  /* Raise the curtain. `caption` is the one line the visitor reads; `hint` is
     the optional second line, used only by the two genuinely long waits.
     The outermost call starts the display-floor clock; nested calls leave it
     alone so the floor is measured from the first raise. */
  function show(caption, hint, options) {
    build();
    /* Cancel any pending delayed hide from a previous cycle — a new show()
       arriving before the delayed hide fires means the curtain stays up. */
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = 0; }
    var text = typeof caption === "string" ? caption.trim() : "";
    stack.push({
      caption: text || DEFAULT_CAPTION,
      hint: typeof hint === "string" ? hint.trim() : ""
    });
    /* Only the outermost call starts the clock. */
    if (stack.length === 1) {
      var timing = resolveTiming(options);
      showStart = performance.now();
      floorMs = randomFloor(timing.min, timing.max);
      floorCap = timing.cap;
    }
    render();
    veil.classList.add("is-on");
    /* Tells assistive tech the page is mid-update; cleared again in hide(). */
    document.documentElement.setAttribute("aria-busy", "true");
  }

  /* The real DOM work of lowering the curtain: remove the class, clear
     aria-busy, and reset the clock so the next show() gets a fresh floor. */
  function dismiss() {
    hideTimer = 0;
    if (veil) veil.classList.remove("is-on");
    document.documentElement.removeAttribute("aria-busy");
  }

  /* Lower it — or, if an outer operation is still running, just hand the
     curtain back to that operation's copy.

     When the outermost call finishes and the stack empties, the floor is
     checked: if the curtain has been up for less than `floorMs` the dismiss
     is delayed by the remainder, but never more than `FLOOR_CAP` total. */
  function hide() {
    if (stack.length) stack.pop();
    if (stack.length) {
      render();
      return;
    }
    var elapsed = performance.now() - showStart;
    var remaining = Math.max(0, Math.min(floorMs - elapsed, floorCap - elapsed));
    if (remaining > 0) {
      hideTimer = setTimeout(dismiss, remaining);
    } else {
      dismiss();
    }
  }

  /* show → run → always hide, whatever happens.

     `work` is usually an async function; a plain promise and a synchronous
     function are both accepted too, so no call site has to be reshaped to use
     this. The resolved value and any thrown error pass straight through, which
     is what makes wrapping an existing call in `during` unable to change what
     that call does.

     One rule for callers: never reach this through `window.FMRCLoader?.during(…)`.
     Optional chaining is right for `show` and `hide` — a page that never
     received this file just goes without a curtain — but on `during` it would
     evaluate to `undefined` and never run `work` at all, silently skipping the
     request it was wrapping. That is why every call site in this project uses
     the explicit `?.show(…)` / `?.hide()` pair instead. */
  async function during(work, caption, hint, options) {
    show(caption, hint, options);
    try {
      var result = await (typeof work === "function" ? work() : work);
      /* If the outermost call is about to empty the stack, honour the floor
         inline so the caller's `await` does not resolve until the curtain
         has actually come down. */
      if (stack.length === 1) {
        var elapsed = performance.now() - showStart;
        var remaining = Math.max(0, Math.min(floorMs - elapsed, floorCap - elapsed));
        if (remaining > 0) {
          await new Promise(function (r) { setTimeout(r, remaining); });
        }
      }
      return result;
    } finally {
      hide();
    }
  }

  /* One navigation can leave a curtain up with nothing left to lower it: a
     successful login or signup navigates away while the curtain is still up,
     the browser freezes the page into the back/forward cache exactly as it was,
     and a later Back restores it — curtain and all — without re-firing
     DOMContentLoaded or re-running a single line of script.

     `pageshow` with `event.persisted` is the browser telling us it just
     restored a frozen page. It is an event, not a timer, so resetting on it
     keeps the "no fixed time" rule intact. Note this listener deliberately
     does not use `unload`, which would make the page ineligible for that cache
     in the first place. */
  window.addEventListener("pageshow", function (event) {
    if (!event.persisted) return;
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = 0; }
    stack.length = 0;
    if (veil) veil.classList.remove("is-on");
    document.documentElement.removeAttribute("aria-busy");
  });

  window.FMRCLoader = {
    show: show,
    hide: hide,
    during: during,
    /* Read-only view of the nesting depth, for checking from the console that
       a flow balanced its calls. Nothing on the site reads it. */
    get depth() {
      return stack.length;
    }
  };
})();
