/* The artwork and its motion share one projection and one layer toolpath.
   Keep the bundled image as a fallback and the FMRC mark editable in Home. */
(function () {
  "use strict";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const artwork = new Map();

  function loadArtwork(url) {
    if (!artwork.has(url.href)) {
      artwork.set(url.href, fetch(url.href, { credentials: "same-origin" })
        .then((response) => {
          if (!response.ok) throw new Error("Printer artwork unavailable");
          return response.text();
        })
        .then((source) => {
          const document = new DOMParser().parseFromString(source, "image/svg+xml");
          const svg = document.documentElement;
          if (document.querySelector("parsererror") || svg.localName !== "svg" ||
              svg.getAttribute("viewBox") !== "0 0 960 760") {
            throw new Error("Invalid printer artwork");
          }
          return svg;
        }));
    }
    return artwork.get(url.href);
  }

  async function enhance(scene) {
    const fallback = scene.querySelector("img.hero-printer-art");
    if (!fallback || scene.dataset.mechanism) return;
    const url = new URL(fallback.src, location.href);
    // Only our bundled asset is imported into the document.
    if (url.origin !== location.origin || !url.pathname.endsWith("/assets/hero-printer-scene.svg")) return;
    scene.dataset.mechanism = "loading";
    try {
      const svg = document.importNode(await loadArtwork(url), true);
      svg.setAttribute("class", "hero-printer-mechanism");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
      const head = svg.querySelector(".hp-printhead");
      const gantry = svg.querySelector(".hp-gantry");
      const tubes = svg.querySelectorAll(".hp-filament-flex");
      const trail = svg.querySelector(".hp-deposition-path");
      const progressReadout = svg.querySelector(".hp-screen-progress");
      const progressFill = svg.querySelector(".hp-screen-fill");
      const phaseReadout = svg.querySelector(".hp-screen-phase");
      const traceCursor = svg.querySelector(".hp-screen-cursor");
      const mechanics = JSON.parse(svg.querySelector("#hp-mechanics")?.textContent || "null");
      const pair = (value) => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
      if (!head || !gantry || !tubes.length || !trail || !mechanics ||
          !pair(mechanics.projection?.xAxis) || !pair(mechanics.projection?.yAxis) ||
          !pair(mechanics.nozzle) || !pair(mechanics.feed?.start) || !pair(mechanics.feed?.end) ||
          !pair(mechanics.feed?.control1) || !pair(mechanics.feed?.control2) ||
          !Array.isArray(mechanics.toolpath) || mechanics.toolpath.length < 2 ||
          !mechanics.toolpath.every(pair)) throw new Error("Printer mechanism missing");

      const { xAxis, yAxis } = mechanics.projection;
      const project = ([x, y]) => [x * xAxis[0] + y * yAxis[0], x * xAxis[1] + y * yAxis[1]];
      const segments = [];
      let length = 0;
      let projectedLength = 0;
      mechanics.toolpath.slice(1).forEach((point, index) => {
        const start = mechanics.toolpath[index];
        const distance = Math.hypot(point[0] - start[0], point[1] - start[1]);
        if (distance > 0) {
          const projectedDelta = project([point[0] - start[0], point[1] - start[1]]);
          const projectedDistance = Math.hypot(...projectedDelta);
          segments.push({ start, end: point, from: length, length: distance,
            projectedFrom: projectedLength, projectedLength: projectedDistance });
          length += distance;
          projectedLength += projectedDistance;
        }
      });
      if (!length) throw new Error("Printer toolpath missing");

      // Use the same projected vertices for the visible material and head path.
      trail.setAttribute("d", mechanics.toolpath.map((point, index) => {
        const [x, y] = project(point);
        return `${index ? "L" : "M"}${(mechanics.nozzle[0] + x).toFixed(2)} ${(mechanics.nozzle[1] + y).toFixed(2)}`;
      }).join(" "));
      trail.setAttribute("pathLength", "100");
      trail.style.strokeDasharray = "100 100";

      const logo = mechanics.logo;
      if (logo && [logo.x, logo.y, logo.width, logo.height, logo.skewY].every(Number.isFinite)) {
        scene.style.setProperty("--hero-logo-x", `${logo.x / 960 * 100}%`);
        scene.style.setProperty("--hero-logo-y", `${logo.y / 760 * 100}%`);
        scene.style.setProperty("--hero-logo-width", `${logo.width / 960 * 100}%`);
        scene.style.setProperty("--hero-logo-height", `${logo.height / 760 * 100}%`);
        const matrix = Array.isArray(logo.matrix) && logo.matrix.length === 6 && logo.matrix.every(Number.isFinite)
          ? `matrix(${logo.matrix.join(",")})` : `skewY(${logo.skewY}deg)`;
        scene.style.setProperty("--hero-logo-perspective", matrix);
      }
      scene.insertBefore(svg, fallback);
      scene.dataset.mechanism = "ready";

      let frame = 0;
      let elapsed = 0;
      let previous = 0;
      let visible = true;
      const duration = 12000;
      const paint = (time) => {
        const cycle = Math.floor(time / duration);
        const progress = (time % duration) / duration;
        const distance = progress * length;
        const segment = segments.find((item) => distance <= item.from + item.length) || segments[segments.length - 1];
        const fraction = Math.min(1, Math.max(0, (distance - segment.from) / segment.length));
        const point = [
          segment.start[0] + (segment.end[0] - segment.start[0]) * fraction,
          segment.start[1] + (segment.end[1] - segment.start[1]) * fraction,
        ];
        const [x, y] = project(point);
        const [gantryX, gantryY] = project([0, point[1]]);
        head.setAttribute("transform", `translate(${x.toFixed(3)} ${y.toFixed(3)})`);
        gantry.setAttribute("transform", `translate(${gantryX.toFixed(3)} ${gantryY.toFixed(3)})`);
        // A fixed frame guide feeds a flexible loop. Both its end and the head
        // follow the same XY pose, so the tube cannot detach at a corner.
        const { start, end, control1, control2 } = mechanics.feed;
        const tubePath = `M${start[0]} ${start[1]} C${control1[0]} ${control1[1]} ${
          (control2[0] + x * 0.6).toFixed(3)} ${(control2[1] + y * 0.6).toFixed(3)} ${
          (end[0] + x).toFixed(3)} ${(end[1] + y).toFixed(3)}`;
        tubes.forEach((tube) => tube.setAttribute("d", tubePath));
        // SVG dash lengths are measured after projection. Use that distance so
        // the fresh filament ends exactly at the nozzle on both axes.
        const reveal = (segment.projectedFrom + segment.projectedLength * fraction) / projectedLength;
        trail.style.strokeDashoffset = String((1 - reveal) * 100);
        scene.dataset.printCycle = String(cycle);
        scene.dataset.printProgress = progress.toFixed(5);
        scene.dataset.printX = point[0].toFixed(3);
        scene.dataset.printY = point[1].toFixed(3);
        const percent = Math.floor(progress * 100);
        if (progressReadout && progressReadout.textContent !== `${percent}%`) {
          progressReadout.textContent = `${percent}%`;
        }
        if (progressFill) progressFill.setAttribute("width", (104 * progress).toFixed(2));
        if (phaseReadout) {
          const phase = distance <= 282 ? "PERIMETER" : "INFILL";
          if (phaseReadout.textContent !== phase) phaseReadout.textContent = phase;
        }
        if (traceCursor) {
          traceCursor.setAttribute("cx", (13 + point[0] / 78 * 59).toFixed(2));
          traceCursor.setAttribute("cy", (55 + point[1] / 63 * 28).toFixed(2));
        }
      };
      const active = () => scene.dataset.motion === "on" && !reducedMotion.matches &&
        !document.hidden && visible && scene.isConnected;
      const tick = (now) => {
        frame = 0;
        if (!active()) return;
        if (previous) elapsed += Math.min(now - previous, 64);
        previous = now;
        paint(elapsed);
        frame = requestAnimationFrame(tick);
      };
      const sync = () => {
        cancelAnimationFrame(frame);
        frame = 0;
        previous = 0;
        if (scene.dataset.motion !== "on" || reducedMotion.matches) {
          elapsed = 0;
          paint(0);
        }
        if (active()) frame = requestAnimationFrame(tick);
      };
      paint(0);
      new MutationObserver(sync).observe(scene, { attributes: true, attributeFilter: ["data-motion"] });
      reducedMotion.addEventListener("change", sync);
      document.addEventListener("visibilitychange", sync);
      if ("IntersectionObserver" in window) {
        new IntersectionObserver(([entry]) => {
          visible = entry.isIntersecting;
          sync();
        }).observe(scene);
      }
      sync();
    } catch {
      scene.dataset.mechanism = "fallback";
    }
  }

  function initialize() {
    document.querySelectorAll(".fmrc-hero-scene").forEach(enhance);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
