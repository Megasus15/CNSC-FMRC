/* Admin Login Portals appearance editor; authentication controls are fixed. */
(() => {
  "use strict";

  const PORTALS = ["customer", "admin"];
  const CHANNEL = "fmrc-site-settings-realtime";
  const STAMP = "fmrc_site_content_updated_at";
  const LABELS = { customer: "Customer Portal", admin: "Admin / Staff Portal" };
  const resolveApi = () => {
    const configured = window.APP_API_BASE_URL || document.querySelector('meta[name="api-base-url"]')?.content || "";
    if (configured.trim()) return configured.replace(/\/+$/, "");
    const { protocol, hostname, origin, port } = window.location;
    if (!/^https?:$/.test(protocol) || !hostname) return "http://127.0.0.1:8000/api";
    if (["localhost", "127.0.0.1"].includes(hostname) && port !== "8000") return `${protocol}//${hostname}:8000/api`;
    return `${origin}/api`;
  };

  document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("portalSettingsForm");
    if (!form) return;
    const appearance = window.FMRC_PORTAL_APPEARANCE;
    const errorBox = document.getElementById("portalSettingsError");
    const errorText = document.getElementById("portalSettingsErrorText");
    const retry = document.getElementById("retryPortalSettings");
    if (!appearance) {
      errorText.textContent = "The portal editor could not start. Refresh the page to try again.";
      errorBox.hidden = false;
      retry.addEventListener("click", () => window.location.reload());
      return;
    }

    const api = resolveApi();
    const fields = appearance.fields;
    const fieldset = document.getElementById("portalSettingsFields");
    const preview = document.getElementById("portalPreview");
    const save = document.getElementById("savePortalSettings");
    const discard = document.getElementById("discardPortalSettings");
    const refresh = document.getElementById("refreshPortalSettings");
    const status = document.getElementById("portalSaveStatus");
    const updated = document.getElementById("portalSettingsUpdated");
    const reload = document.getElementById("reloadPortalSettings");
    const imageInput = document.getElementById("portalImageInput");
    const tabs = [...document.querySelectorAll(".portal-tab")];
    const controls = [...fieldset.querySelectorAll("[name]")];
    const states = Object.fromEntries(PORTALS.map((portal) => [portal, { saved: null, draft: null, latest: null, savedRecently: false, refreshPending: false }]));
    let active = "customer";
    let loading = false;
    let saving = false;
    let uploading = false;
    let queuedLoad = false;
    let uploadTarget = null;
    let channel = null;
    const isBusy = () => loading || saving || uploading;
    const same = (left, right) => fields.every((field) => left?.[field] === right?.[field]);
    const dirty = (portal) => !!states[portal].saved && !same(states[portal].saved, states[portal].draft);
    const anyDirty = () => PORTALS.some(dirty);
    const resolved = (draft, portal) => appearance.read(Object.fromEntries(fields.map((field) => [appearance.key(portal, field), draft[field]])), portal);
    const showError = (message, canRetry = false) => {
      errorText.textContent = message;
      errorBox.hidden = false;
      retry.hidden = !canRetry;
    };
    const isDefault = (field, value) => !value || value === appearance.defaults[active][field];

    const render = (fillControls = false) => {
      const state = states[active];
      const current = state.draft || appearance.defaults[active];
      const config = resolved(current, active);
      fieldset.disabled = isBusy() || !state.draft;
      form.setAttribute("aria-busy", String(isBusy() || !state.draft));
      save.disabled = isBusy() || !dirty(active);
      discard.disabled = isBusy() || !dirty(active);
      refresh.disabled = isBusy();
      retry.disabled = isBusy();
      reload.disabled = isBusy();
      updated.hidden = !state.refreshPending && (!state.latest || same(state.saved, state.latest));
      tabs.forEach((tab) => {
        const selected = tab.dataset.portal === active;
        tab.classList.toggle("is-active", selected);
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
        tab.disabled = saving || uploading;
        tab.querySelector(".portal-tab-dirty").hidden = !dirty(tab.dataset.portal);
      });
      document.getElementById("portalEditorPanel").setAttribute("aria-labelledby", active === "customer" ? "customerPortalTab" : "adminPortalTab");
      document.getElementById("portalEditorTitle").textContent = LABELS[active];
      document.getElementById("portalSaveLabel").textContent = LABELS[active];
      const link = document.getElementById("openPortalLink");
      link.href = active === "customer" ? "../customer-auth/auth.html" : "../admin-auth/auth.html";
      link.setAttribute("aria-label", `View ${LABELS[active]} in a new tab`);
      if (fillControls) {
        controls.forEach((control) => {
          if (control.type === "radio") control.checked = current[control.name] === control.value;
          else control.value = current[control.name] ?? "";
        });
      }
      document.getElementById("portalOverlayValue").value = `${Math.round(Number(current.overlay_opacity) * 100)}%`;
      controls.filter((control) => control.maxLength > 0).forEach((control) => {
        const counter = document.querySelector(`[data-counter="${control.name}"]`);
        if (counter) counter.textContent = `${String(current[control.name] || "").length} / ${control.maxLength}`;
      });
      appearance.apply(preview, config);
      preview.querySelector("[data-portal-photo-brand]").textContent = config.brand_name;
      preview.querySelector(".portal-preview-submit").textContent = active === "customer" ? "Sign in" : "Enter Workspace";
      preview.querySelector(".portal-preview-return").hidden = active !== "customer";
      document.getElementById("portalPreviewCaption").textContent = active === "customer" ? "UCN-FMRC Customer Portal" : "UCN-FMRC Admin / Staff Portal";
      document.getElementById("portalPhotoThumbnail").src = config.background_image;
      document.getElementById("portalPhotoThumbnail").style.objectPosition = config.image_position;
      document.getElementById("portalPrimaryLogoThumbnail").src = config.logo_primary_image;
      document.getElementById("portalSecondaryLogoThumbnail").src = config.logo_secondary_image;
      document.getElementById("portalPhotoState").textContent = isDefault("background_image", current.background_image) ? "Default image" : "Custom image";
      document.getElementById("portalPrimaryLogoState").textContent = isDefault("logo_primary_image", current.logo_primary_image) ? "Default logo" : "Custom logo";
      document.getElementById("portalSecondaryLogoState").textContent = isDefault("logo_secondary_image", current.logo_secondary_image) ? "Default logo" : "Custom logo";
      fieldset.querySelectorAll("[data-reset]").forEach((button) => { button.disabled = isDefault(button.dataset.reset, current[button.dataset.reset]); });
      document.getElementById("portalPreviewState").textContent = dirty(active) ? "Draft appearance" : "Saved appearance";
      status.textContent = uploading ? "Preparing your image..." : saving ? "Saving portal appearance..." : loading && !state.saved ? "Loading saved appearance..." : dirty(active) ? "You have unsaved changes to this portal." : state.saved ? (state.savedRecently ? "Portal appearance saved." : "All changes saved.") : "Load the saved settings before editing.";
      save.innerHTML = saving ? '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Saving...' : '<i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Save portal';
    };

    const request = async (path, options = {}) => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetch(`${api}${path}`, { cache: "no-store", ...options, signal: controller.signal });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 401) throw new Error("Your session has expired. Sign in again to save the portal appearance.");
          if (response.status === 403) throw new Error("Your account cannot update the portal appearance.");
          const validation = Object.values(json.errors || {}).flat().find((message) => typeof message === "string");
          throw new Error(validation || json.message || "The portal appearance could not be saved. Please try again.");
        }
        return json;
      } catch (error) {
        if (error.name === "AbortError") throw new Error("The request took too long. Please try again.");
        if (error instanceof TypeError) throw new Error("The server could not be reached. Your draft is kept here. Please try again.");
        throw error;
      } finally { window.clearTimeout(timeout); }
    };

    const load = async ({ replacePortal = null } = {}) => {
      if (isBusy()) { queuedLoad = true; return; }
      loading = true;
      render();
      try {
        const json = await request("/site-settings", { headers: { Accept: "application/json" } });
        if (!json.data || typeof json.data !== "object" || Array.isArray(json.data)) throw new Error("The saved portal appearance could not be loaded. Please try again.");
        PORTALS.forEach((portal) => {
          const incoming = appearance.read(json.data, portal);
          const state = states[portal];
          state.refreshPending = false;
          if (dirty(portal) && replacePortal !== portal) state.latest = same(state.saved, incoming) ? null : incoming;
          else {
            state.saved = { ...incoming };
            state.draft = { ...incoming };
            state.latest = null;
          }
        });
        errorBox.hidden = true;
      } catch (error) {
        showError(error.message || "The saved portal appearance could not be loaded. Please try again.", true);
      } finally {
        loading = false;
        render(true);
        if (queuedLoad) { queuedLoad = false; void load(); }
      }
    };

    const confirmDiscard = (action, message) => {
      if (typeof window.showAdminConfirmPopup === "function") {
        window.showAdminConfirmPopup(message, { title: "Discard changes?", confirmText: "Discard changes", cancelText: "Keep editing", onConfirm: action });
      } else if (window.confirm(message)) action();
    };
    const notifyPortals = () => {
      try { channel?.postMessage({ type: "updated", source: "login-portals" }); } catch { /* Storage also notifies open portals. */ }
      try { localStorage.setItem(STAMP, String(Date.now())); } catch { /* The next page load reads saved appearance. */ }
    };

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (isBusy() || !dirty(active) || !form.reportValidity()) return;
      const portal = active;
      const state = states[portal];
      const submitted = { ...state.draft };
      // This request contains only changes to the selected portal; unrelated
      // Website Configuration settings and the other portal cannot be overwritten.
      const changedFields = fields.filter((field) => submitted[field] !== state.saved[field]);
      const payload = Object.fromEntries(changedFields.map((field) => [appearance.key(portal, field), submitted[field]]));
      saving = true;
      errorBox.hidden = true;
      render();
      try {
        const token = window.AdminSession?.getToken() || localStorage.getItem("auth_token") || "";
        await request("/admin/site-settings", { method: "PUT", headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
        const applied = { ...(state.latest || state.saved), ...Object.fromEntries(changedFields.map((field) => [field, submitted[field]])) };
        state.saved = resolved(applied, portal);
        state.draft = { ...state.saved };
        state.latest = null;
        state.savedRecently = true;
        notifyPortals();
        window.showAdminPopup?.(`${LABELS[portal]} appearance saved.`, { title: "Saved!" });
      } catch (error) { showError(error.message || "Your portal appearance could not be saved. Your draft is kept here."); }
      finally {
        saving = false;
        render(true);
        if (queuedLoad) { queuedLoad = false; void load(); }
      }
    });

    controls.forEach((control) => control.addEventListener("input", () => {
      if (isBusy() || !states[active].draft || (control.type === "radio" && !control.checked)) return;
      states[active].draft[control.name] = control.name === "overlay_opacity" ? Number(control.value) : control.value;
      states[active].savedRecently = false;
      render();
    }));
    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => {
        if (saving || uploading) return;
        active = tab.dataset.portal;
        errorBox.hidden = !!states[active].saved;
        render(true);
      });
      tab.addEventListener("keydown", (event) => {
        let target = null;
        if (["ArrowRight", "ArrowDown"].includes(event.key)) target = tabs[(index + 1) % tabs.length];
        else if (["ArrowLeft", "ArrowUp"].includes(event.key)) target = tabs[(index - 1 + tabs.length) % tabs.length];
        else if (event.key === "Home") target = tabs[0];
        else if (event.key === "End") target = tabs[tabs.length - 1];
        if (!target || target.disabled) return;
        event.preventDefault();
        target.click();
        target.focus();
      });
    });
    discard.addEventListener("click", () => {
      if (isBusy() || !dirty(active)) return;
      const portal = active;
      confirmDiscard(() => {
        states[portal].draft = { ...states[portal].saved };
        states[portal].savedRecently = false;
        errorBox.hidden = true;
        render(true);
        void load();
      }, `Discard your unsaved appearance changes to the ${LABELS[portal]}?`);
    });
    reload.addEventListener("click", () => {
      if (isBusy()) return;
      const portal = active;
      const reloadSaved = () => void load({ replacePortal: portal });
      if (dirty(portal)) confirmDiscard(reloadSaved, `Load the latest ${LABELS[portal]} appearance and discard its unsaved changes?`);
      else reloadSaved();
    });
    retry.addEventListener("click", () => void load());
    refresh.addEventListener("click", () => void load());

    fieldset.querySelectorAll("[data-reset]").forEach((button) => button.addEventListener("click", () => {
      if (isBusy() || !states[active].draft) return;
      states[active].draft[button.dataset.reset] = "";
      states[active].savedRecently = false;
      render(true);
    }));
    fieldset.querySelectorAll("[data-upload]").forEach((button) => button.addEventListener("click", () => {
      if (isBusy() || !states[active].draft) return;
      uploadTarget = { portal: active, field: button.dataset.upload };
      imageInput.value = "";
      imageInput.click();
    }));
    imageInput.addEventListener("change", async () => {
      const file = imageInput.files?.[0];
      const target = uploadTarget;
      uploadTarget = null;
      if (!file || !target) return;
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { showError("Choose a PNG, JPG, or WebP image."); return; }
      if (file.size > 10 * 1024 * 1024) { showError("Choose an image smaller than 10 MB."); return; }
      uploading = true;
      errorBox.hidden = true;
      render();
      try {
        const imageData = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error("The image could not be read. Choose it again."));
          reader.readAsDataURL(file);
        });
        const image = await new Promise((resolve, reject) => {
          const candidate = new Image();
          candidate.onload = () => resolve(candidate);
          candidate.onerror = () => reject(new Error("The selected file is not a readable image. Choose another image."));
          candidate.src = imageData;
        });
        if (!image.naturalWidth || !image.naturalHeight) throw new Error("The image has no usable dimensions. Choose another image.");
        // Store the same optimized data-image format used by Home's media editor.
        // Logos retain their full artwork and transparency instead of being cropped.
        const isPhoto = target.field === "background_image";
        const max = isPhoto ? 1920 : 420;
        const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("The image could not be prepared in this browser. Try another browser.");
        if (isPhoto) { context.fillStyle = "#fdfaf6"; context.fillRect(0, 0, canvas.width, canvas.height); }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        states[target.portal].draft[target.field] = canvas.toDataURL(isPhoto ? "image/jpeg" : "image/png", .86);
        states[target.portal].savedRecently = false;
      } catch (error) { showError(error.message || "The image could not be prepared. Choose another image."); }
      finally {
        uploading = false;
        render(true);
        if (queuedLoad) { queuedLoad = false; void load(); }
      }
    });

    window.addEventListener("beforeunload", (event) => {
      if (!anyDirty() && !saving && !uploading) return;
      event.preventDefault();
      event.returnValue = "";
    });
    document.addEventListener("click", (event) => {
      const link = event.target.closest?.("a[href]");
      if (!link || link.target === "_blank" || link.getAttribute("href").startsWith("#") || event.defaultPrevented || !anyDirty() || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      const href = link.href;
      confirmDiscard(() => {
        PORTALS.forEach((portal) => { if (states[portal].saved) states[portal].draft = { ...states[portal].saved }; });
        window.location.assign(href);
      }, "Leave Login Portals and discard your unsaved appearance changes?");
    });
    // The editor loads on entry or an explicit Refresh/Retry. Returning to the
    // browser tab must leave the current preview, controls, and drafts in place.
    const markUpdated = () => {
      PORTALS.forEach((portal) => { states[portal].refreshPending = true; });
      render();
    };
    window.addEventListener("storage", (event) => { if (event.key === STAMP) markUpdated(); });
    try {
      if (typeof window.BroadcastChannel === "function") {
        channel = new window.BroadcastChannel(CHANNEL);
        channel.addEventListener("message", markUpdated);
      }
    } catch { /* Storage still publishes saves to the live portals. */ }
    render(true);
    void load();
  });
})();
