/* Shared Home/About copy schema. The customer pages and both editors use the
   same keys and defaults; existing profile, gallery and service keys stay intact. */
(function () {
  "use strict";

  const sections = [
    ["Home: Hero Buttons", "home", [
      ["hero_browse", "Browse button text", "Browse Products", 28],
      ["hero_appointment", "Appointment button text", "Appoint Now!", 28],
      ["hero_scroll", "Scroll hint", "Scroll Down", 20],
    ]],
    ["Home: Introduction", "home", [
      ["intro_kicker", "Eyebrow", "WELCOME TO UCN-FMRC"],
      ["intro_title", "Heading", "A place to bring ideas to life."],
      ["intro_copy", "Introduction", "FMRC connects students, educators, researchers, and businesses with fabrication and manufacturing services. Explore the support available for your next prototype, research project, or business idea."],
      ["intro_audience", "Audience line", "For students, educators, researchers & businesses."],
      ["intro_link", "About link text", "About FMRC"],
    ]],
    ["Home: What We Offer", "home", [
      ["services_kicker", "Eyebrow", "OUR CAPABILITIES"],
      ["services_title", "Heading", "What We Offer"],
      ["services_copy", "Description", "Discover the tools and expertise for your next project."],
      ["services_link", "Services link text", "View all services"],
      ["services_empty", "Empty services message", "Our services will be available here soon.", 160],
      ["services_error", "Request error message", "We couldn't load our services right now.", 180],
      ["services_retry", "Retry button text", "Try again", 28],
    ]],
    ["Home: Getting Started", "home", [
      ["steps_kicker", "Eyebrow", "FROM IDEA TO NEXT STEP"],
      ["steps_title", "Heading", "Start your project"],
      ["steps_copy", "Introduction", "A little preparation helps us understand what you need."],
      ["step_1_title", "Step 1 heading", "Explore our services"],
      ["step_1_copy", "Step 1 description", "Find a service that fits your idea. Check its features, supported materials, and typical uses."],
      ["step_1_link", "Step 1 link text", "Explore services"],
      ["step_2_title", "Step 2 heading", "Prepare your project details"],
      ["step_2_copy", "Step 2 description", "Have a short description of your project ready. You can also attach a reference file when requesting an appointment."],
      ["step_3_title", "Step 3 heading", "Request an appointment"],
      ["step_3_copy", "Step 3 description", "Sign in, choose an available date and time, and submit your request for the FMRC team to review."],
    ]],
    ["Home: Project Invitation", "home", [
      ["cta_kicker", "Eyebrow", "LET'S GET STARTED"],
      ["cta_title", "Heading", "Have a project in mind?"],
      ["cta_copy", "Description", "Take the next step with FMRC. Request an appointment or get in touch with our team."],
      ["cta_button", "Appointment button text", "Set an appointment"],
      ["cta_contact", "Contact link text", "Contact us"],
    ]],
    ["About Us: Introduction", "about", [
      ["page_kicker", "Page eyebrow", "THE CENTER & ITS PURPOSE"],
      ["page_copy", "Page introduction", "Bringing creativity, technology, and opportunity together."],
      ["profile_kicker", "Profile eyebrow", "UCN · FABRICATION AND MANUFACTURING RESEARCH CENTER"],
      ["profile_title", "Profile heading", "Where creativity meets technology."],
    ]],
    ["About Us: Purpose", "about", [
      ["purpose_kicker", "Eyebrow", "WHAT GUIDES US"],
      ["purpose_title", "Heading", "Our purpose. Our direction."],
      ["purpose_copy", "Introduction", "A shared commitment to creativity, innovation, and practical possibilities."],
    ]],
    ["About Us: Who We Support", "about", [
      ["audiences_kicker", "Eyebrow", "A SHARED SPACE FOR IDEAS"],
      ["audiences_title", "Heading", "Who We Support"],
      ["audiences_copy", "Introduction", "Connecting people with the tools to turn ideas into practical outputs."],
      ["audience_1_title", "Audience 1 heading", "Students & educators"],
      ["audience_1_copy", "Audience 1 description", "A place to connect learning and creative thinking with hands-on fabrication and design."],
      ["audience_2_title", "Audience 2 heading", "Researchers"],
      ["audience_2_copy", "Audience 2 description", "Fabrication and manufacturing support for exploring ideas and developing practical project outputs."],
      ["audience_3_title", "Audience 3 heading", "Businesses & MSMEs"],
      ["audience_3_copy", "Audience 3 description", "Shared facilities that support creativity, product design, business innovation, and productivity."],
    ]],
    ["About Us: Explore FMRC", "about", [
      ["cta_kicker", "Eyebrow", "TAKE A CLOSER LOOK"],
      ["cta_title", "Heading", "Explore FMRC"],
      ["cta_copy", "Description", "Discover our services or talk with our team about your next project."],
      ["cta_button", "Services button text", "Explore services"],
      ["cta_contact", "Contact link text", "Contact us"],
    ]],
    ["Services: Page Copy", "services", [
      ["kicker", "Eyebrow", "EXPERTISE & CAPABILITIES", 48],
      ["title", "Page title", "Our Services", 48],
      ["subtitle", "Introduction", "Explore fabrication and manufacturing services for your next project.", 150],
      ["learn_more", "Details button text", "Learn more", 28],
      ["image_placeholder", "Missing image text", "Image coming soon", 48],
      ["details_kicker", "Details eyebrow", "Service details", 40],
      ["features_heading", "Features heading", "Key Features", 48],
      ["materials_heading", "Materials heading", "Supported Materials", 48],
      ["best_for_heading", "Best for heading", "Best For", 48],
      ["empty_message", "Empty results message", "No services found matching your search.", 160],
      ["error_message", "Request error message", "Unable to load services right now. Please refresh and try again.", 180],
    ]],
  ];
  function copyLimit(name) {
    if (name.endsWith("_kicker")) return 64;
    if (name === "intro_audience") return 120;
    if (/^(?:step|audience)_\d_title$/.test(name)) return 70;
    if (/^(?:step|audience)_\d_copy$/.test(name)) return 280;
    if (name === "intro_title" || name === "cta_title") return 80;
    if (name.endsWith("_title")) return 100;
    if (name.endsWith("_copy")) return 500;
    return 32;
  }
  const fields = sections.flatMap(([group, page, entries]) =>
    entries.map(([name, label, defaultValue, limit]) => Object.freeze({
      key: `editorial_${page}_${name}`,
      page,
      group,
      label,
      default: defaultValue,
      maxLength: limit || copyLimit(name),
      multiline: name.endsWith("_copy") || name.endsWith("_message") || name === "subtitle",
    })),
  );
  const byKey = new Map(fields.map((field) => [field.key, field]));
  let snapshot = {};

  function valueFor(settings, field) {
    return Object.prototype.hasOwnProperty.call(settings || {}, field.key)
      ? String(settings[field.key] ?? "")
      : field.default;
  }

  function apply(settings) {
    if (settings && typeof settings === "object") snapshot = settings;
    document.querySelectorAll("[data-editorial-copy]").forEach((element) => {
      const field = byKey.get(element.dataset.editorialCopy);
      if (!field) return;
      if (element.dataset.editorialAttribute === "placeholder") {
        element.setAttribute("placeholder", valueFor(snapshot, field));
      } else {
        const value = valueFor(snapshot, field);
        element.textContent = value;
        const control = element.closest?.("a, button");
        // Keep editable action labels accessible even when the visible wording
        // is intentionally cleared. Service buttons retain their full title.
        if (control && field.page !== "services") {
          control.setAttribute("aria-label", value.trim() || field.default);
        }
      }
    });
    document.querySelectorAll("[data-editorial-placeholder]").forEach((element) => {
      const field = byKey.get(element.dataset.editorialPlaceholder);
      if (field) element.setAttribute("placeholder", valueFor(snapshot, field));
    });
    document.dispatchEvent(new CustomEvent("fmrc-page-content-applied"));
  }

  function get(key) {
    const field = byKey.get(key);
    return field ? valueFor(snapshot, field) : "";
  }

  function bindCounter(input, limit) {
    if (!input || !Number.isFinite(limit)) return;
    input.maxLength = limit;
    let counter = document.getElementById(input.id + "CharacterCount");
    if (!counter) {
      counter = document.createElement("span");
      counter.id = input.id + "CharacterCount";
      counter.className = "field-hint wm-character-count";
      input.insertAdjacentElement("afterend", counter);
      input.setAttribute("aria-describedby", [input.getAttribute("aria-describedby"), counter.id].filter(Boolean).join(" "));
    }
    function update() {
      const length = String(input.value || "").length;
      const over = length > limit;
      counter.textContent = `${length} / ${limit} characters`;
      counter.style.color = over ? "#b91c1c" : "";
      input.setCustomValidity(over ? `Use no more than ${limit} characters.` : "");
    }
    if (!input.dataset.counterBound) {
      input.addEventListener("input", update);
      input.dataset.counterBound = "true";
    }
    input._fmrcUpdateCounter = update;
    update();
  }

  function renderEditor(container, page) {
    if (!container || container.dataset.editorialReady === "true") return;
    const activePage = page || document.body.dataset.configPage || "home";
    container.replaceChildren();
    sections.filter((section) => section[1] === activePage).forEach(([name], index) => {
      const group = document.createElement("details");
      group.className = "wm-editorial-group";
      group.open = index === 0;
      const summary = document.createElement("summary");
      summary.textContent = name;
      group.appendChild(summary);
      const grid = document.createElement("div");
      grid.className = "wm-form-grid";
      fields.filter((field) => field.group === name).forEach((field) => {
        const wrapper = document.createElement("div");
        wrapper.className = "field-stack" + (field.multiline ? " full" : "");
        const label = document.createElement("label");
        label.htmlFor = field.key;
        label.textContent = field.label;
        const input = document.createElement(field.multiline ? "textarea" : "input");
        input.id = field.key;
        input.maxLength = field.maxLength;
        input.dataset.editorialSetting = field.key;
        input.className = field.multiline ? "wm-textarea" : "wm-input";
        if (field.multiline) input.rows = 3;
        else input.type = "text";
        input.disabled = true;
        wrapper.append(label, input);
        grid.appendChild(wrapper);
        bindCounter(input, field.maxLength);
      });
      group.appendChild(grid);
      container.appendChild(group);
    });
    container.dataset.editorialReady = "true";
  }

  function populate(settings) {
    fields.forEach((field) => {
      const input = document.getElementById(field.key);
      if (input) {
        input.value = valueFor(settings, field);
        input._fmrcUpdateCounter?.();
      }
    });
  }

  function collect() {
    const payload = {};
    fields.forEach((field) => {
      const input = document.getElementById(field.key);
      // An unavailable editor must never overwrite existing settings with blanks.
      if (input) payload[field.key] = input.value;
    });
    return payload;
  }

  window.FMRC_PAGE_CONTENT = Object.freeze({
    fields: Object.freeze(fields), apply, get, renderEditor, populate, collect, bindCounter,
  });
})();
