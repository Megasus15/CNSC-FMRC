/* One appearance contract for the live portals and Website Configuration preview. */
(function () {
  "use strict";
  const fields = [
    "background_image", "image_side", "image_position", "overlay_opacity",
    "logo_primary_image", "logo_secondary_image", "brand_name", "portal_name",
    "university_name", "image_kicker", "image_title", "image_description", "center_name",
  ];
  const common = {
    background_image: "/images/auth-fabrication.jpg",
    image_side: "left",
    image_position: "center",
    overlay_opacity: 0.55,
    logo_primary_image: "/images/UCN Logo.png",
    logo_secondary_image: "/images/FMRC Brand Logo.png",
    brand_name: "UCN\u2013FMRC",
    university_name: "University of Camarines Norte",
    center_name: "Fabrication & Manufacturing Research Center",
  };
  const defaults = {
    customer: {
      ...common, portal_name: "Customer Portal", image_kicker: "Create. Collaborate. Make.",
      image_title: "Ideas take\nshape here.",
      image_description: "From a first idea to a finished piece, connect with the people and tools that make it possible.",
    },
    admin: {
      ...common, portal_name: "Admin / Staff Portal", image_kicker: "Coordinate. Deliver. Grow.",
      image_title: "Good work starts\nwith a clear view.",
      image_description: "One workspace for the people, projects, and everyday work that keep FMRC moving.",
    },
  };
  const limits = {
    brand_name: 80, portal_name: 80, university_name: 120, image_kicker: 80,
    image_title: 160, image_description: 320, center_name: 160,
  };
  const key = (portal, field) => `portal_${portal === "admin" ? "admin" : "customer"}_${field}`;
  const has = (object, field) => Object.prototype.hasOwnProperty.call(object, field);

  function safeImage(value, fallback = "") {
    if (typeof value !== "string") return fallback;
    const image = value.trim();
    if (!image || /[\x00-\x1f\x7f<>"'`\\]/.test(image)) return fallback;
    const data = image.match(/^data:image\/(?:png|jpe?g|gif|webp);base64,([a-z0-9+/]+={0,2})$/i);
    if (data) {
      if (data[1].length % 4 === 1 || (data[1].includes("=") && data[1].length % 4 !== 0)) return fallback;
      try { if (typeof atob === "function") atob(data[1]); return image; }
      catch (_) { return fallback; }
    }
    if (/^https?:\/\//i.test(image)) {
      try { return ["http:", "https:"].includes(new URL(image).protocol) ? image : fallback; }
      catch (_) { return fallback; }
    }
    if (!/^[a-z][a-z0-9+.-]*:/i.test(image) && !image.startsWith("//") && !image.startsWith("#")) return image;
    return fallback;
  }

  function read(settings = {}, portal = "customer") {
    portal = portal === "admin" ? "admin" : "customer";
    const base = defaults[portal];
    const config = { portal, ...base };
    fields.forEach(field => {
      const settingKey = key(portal, field);
      let value = settings[settingKey];
      if (field === "logo_primary_image" && !has(settings, settingKey)) value = settings.portal_logo_primary_image;
      if (field === "logo_secondary_image" && !has(settings, settingKey)) value = settings.portal_logo_secondary_image;
      if (field.endsWith("_image")) config[field] = safeImage(value, base[field]);
      else if (field === "image_side") config[field] = ["left", "right"].includes(value) ? value : base[field];
      else if (field === "image_position") config[field] = ["top", "center", "bottom"].includes(value) ? value : base[field];
      else if (field === "overlay_opacity") {
        const numeric = typeof value === "number" || (typeof value === "string" && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()));
        const opacity = numeric ? Number(value) : NaN;
        config[field] = Number.isFinite(opacity) && opacity >= 0 && opacity <= 0.9 ? opacity : base[field];
      } else if (has(settings, settingKey) && value === null) {
        config[field] = ["brand_name", "portal_name"].includes(field) ? base[field] : "";
      } else if (typeof value === "string") {
        config[field] = value.slice(0, limits[field]);
        if (["brand_name", "portal_name"].includes(field) && !config[field].trim()) config[field] = base[field];
      }
    });
    return config;
  }

  function apply(root, config) {
    if (!root || !config) return;
    const setText = (selector, value) => root.querySelectorAll(selector).forEach(node => { node.textContent = value; });
    root.dataset.portalImageSide = config.image_side;
    const bundled = config.background_image === defaults[config.portal].background_image;
    root.dataset.portalCustomImage = String(!bundled);
    root.style.setProperty("--auth-photo", `url(${JSON.stringify(config.background_image)})`);
    root.style.setProperty("--auth-overlay-opacity", String(config.overlay_opacity));
    // Preserve the original framing and clear center. The maroon veil deepens
    // gradually toward both ends, also concealing the showcase's top graphics.
    root.style.setProperty("--auth-image-position", bundled && config.image_position === "center" ? "58%" : config.image_position);
    root.style.setProperty("--auth-image-size", bundled ? "auto 115%" : "cover");
    root.style.setProperty("--auth-image-overlay", "linear-gradient(180deg, #2f0d17 0%, rgb(47 13 23 / 98%) 15%, rgb(55 18 28 / 82%) 24%, rgb(69 21 31 / 36%) 36%, rgb(69 21 31 / 24%) 44%, rgb(55 15 24 / 56%) 60%, rgb(47 13 23 / 88%) 80%, #2f0d17 100%)");
    root.style.setProperty("--auth-image-overlay-strength", String(bundled ? Math.min(1, config.overlay_opacity + 0.45) : config.overlay_opacity));
    setText("[data-portal-brand-name]", config.brand_name);
    setText("[data-portal-name]", config.portal_name);
    setText("[data-portal-university-name]", config.university_name);
    setText("[data-portal-image-kicker]", config.image_kicker);
    setText("[data-portal-image-title]", config.image_title);
    setText("[data-portal-image-description]", config.image_description);
    setText("[data-portal-center-name]", config.center_name);
    ["primary", "secondary"].forEach(slot => {
      root.querySelectorAll(`[data-portal-logo="${slot}"]`).forEach(img => {
        const next = config[`logo_${slot}_image`];
        if (img.getAttribute("src") === next) return;
        img.style.display = "";
        img.src = next;
        img.onerror = () => {
          img.onerror = null;
          img.src = defaults[config.portal][`logo_${slot}_image`];
        };
      });
    });
  }

  window.FMRC_PORTAL_APPEARANCE = { defaults, fields, key, read, apply, safeImage };
})();
