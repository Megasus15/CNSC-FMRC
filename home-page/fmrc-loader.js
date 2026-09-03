/* ==========================================================================
   fmrc-loader.js — the UCN-FMRC action curtain
   FMRC-MARK v1

   One object, three methods:

     FMRCLoader.show(caption, hint)          raise the curtain
     FMRCLoader.hide()                       lower it
     FMRCLoader.during(work, caption, hint)  raise it, await work, always lower

   `during` is the one to reach for. The curtain's lifetime is the promise's
   lifetime and nothing else: there is no setTimeout, no setInterval and no
   duration anywhere in this file. If the request takes 400 ms the curtain is up
   for 400 ms; if it takes 40 s the curtain is up for 40 s.

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

    /* The mark is decoration: it says what the caption already says, so a
       screen reader is told once instead of twice. */
    var mark = document.createElement("div");
    mark.className = "fmrc-load-mark";
    mark.setAttribute("aria-hidden", "true");

    var word = document.createElement("span");
    word.className = "fmrc-load-word";
    word.textContent = "FMRC";

    var grid = document.createElement("span");
    grid.className = "fmrc-load-grid";

    captionEl = document.createElement("p");
    captionEl.className = "fmrc-load-caption";

    hintEl = document.createElement("p");
    hintEl.className = "fmrc-load-hint";

    var rail = document.createElement("div");
    rail.className = "fmrc-load-rail";
    rail.setAttribute("aria-hidden", "true");
    rail.appendChild(document.createElement("span"));

    mark.appendChild(word);
    mark.appendChild(grid);
    core.appendChild(mark);
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
     the optional second line, used only by the two genuinely long waits. */
  function show(caption, hint) {
    build();
    var text = typeof caption === "string" ? caption.trim() : "";
    stack.push({
      caption: text || DEFAULT_CAPTION,
      hint: typeof hint === "string" ? hint.trim() : ""
    });
    render();
    veil.classList.add("is-on");
    /* Tells assistive tech the page is mid-update; cleared again in hide(). */
    document.documentElement.setAttribute("aria-busy", "true");
  }

  /* Lower it — or, if an outer operation is still running, just hand the
     curtain back to that operation's copy. */
  function hide() {
    if (stack.length) stack.pop();
    if (stack.length) {
      render();
      return;
    }
    if (veil) veil.classList.remove("is-on");
    document.documentElement.removeAttribute("aria-busy");
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
  async function during(work, caption, hint) {
    show(caption, hint);
    try {
      return await (typeof work === "function" ? work() : work);
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
