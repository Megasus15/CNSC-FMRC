/* Shared by the Admin and Staff Payment Methods pages. */
(() => {
  "use strict";

  const METHODS = [
    "payment_cash_on_pickup_enabled",
    "payment_cash_on_delivery_enabled",
    "payment_gcash_enabled",
  ];
  const CHANNEL = "fmrc-site-settings-realtime";
  const STAMP = "fmrc_site_content_updated_at";
  const resolveApi = () => {
    const configured = window.APP_API_BASE_URL || document.querySelector('meta[name="api-base-url"]')?.content || "";
    if (configured.trim()) return configured.replace(/\/+$/, "");
    const { protocol, hostname, origin, port } = window.location;
    if (!/^https?:$/.test(protocol) || !hostname) return "http://127.0.0.1:8000/api";
    if (["localhost", "127.0.0.1"].includes(hostname) && port !== "8000") return `${protocol}//${hostname}:8000/api`;
    return `${origin}/api`;
  };
  const parseSettings = (data) => Object.fromEntries(METHODS.map((key) => [
    key, data[key] === undefined || [true, 1, "1"].includes(data[key]),
  ]));
  const same = (left, right) => METHODS.every((key) => left?.[key] === right?.[key]);

  document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("paymentSettingsForm");
    if (!form) return;
    const api = resolveApi();
    const fieldset = document.getElementById("paymentSettingsFields");
    const save = document.getElementById("savePaymentSettings");
    const discard = document.getElementById("discardPaymentSettings");
    const status = document.getElementById("paymentSaveStatus");
    const errorBox = document.getElementById("paymentSettingsError");
    const errorText = document.getElementById("paymentSettingsErrorText");
    const retry = document.getElementById("retryPaymentSettings");
    const changedElsewhere = document.getElementById("paymentSettingsUpdated");
    const summary = document.getElementById("paymentSettingsSummary");
    const note = document.getElementById("paymentSettingsNote");
    const noteTitle = document.getElementById("paymentSettingsNoteTitle");
    const enableAll = document.getElementById("enableAllPayments");
    const disableAll = document.getElementById("disableAllPayments");
    let saved = null;
    let draft = null;
    let busy = false;
    let refreshing = false;
    let refreshQueued = false;
    let lastSaveSucceeded = false;
    let channel = null;
    const isDirty = () => !!saved && !same(saved, draft);

    const render = () => {
      const count = draft ? METHODS.filter((key) => draft[key]).length : 0;
      fieldset.disabled = busy || refreshing || !draft;
      save.disabled = busy || refreshing || !isDirty();
      discard.disabled = busy || refreshing || !isDirty();
      retry.disabled = busy || refreshing;
      document.getElementById("refreshPaymentSettings").disabled = busy || refreshing;
      enableAll.disabled = count === METHODS.length;
      disableAll.disabled = count === 0;
      form.setAttribute("aria-busy", String(busy || refreshing));
      document.getElementById("reloadPaymentSettings").disabled = busy || refreshing;
      METHODS.forEach((key) => {
        document.getElementById(key).checked = !!draft?.[key];
        document.getElementById(`${key}_state`).textContent = !draft ? "Loading" : draft[key] ? "Enabled" : "Disabled";
      });
      summary.textContent = !draft ? "Loading saved payment methods…" : `${count} of 3 methods ${isDirty() ? "selected" : "enabled"}`;
      note.classList.toggle("is-paused", !!draft && count === 0);
      noteTitle.textContent = !draft || count > 0 ? "Availability applies to new product orders" : isDirty() ? "Saving will pause new product orders" : "New product orders are paused";
      status.textContent = refreshing ? "Loading payment methods…" : busy ? "Saving payment methods…" : isDirty() ? "You have unsaved changes." : saved ? (lastSaveSucceeded ? "Payment methods saved." : "All changes saved.") : "Load the saved settings before making changes.";
      save.innerHTML = busy && saved ? '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Saving…' : '<i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Save changes';
    };

    const request = async (path, options = {}) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetch(`${api}${path}`, { cache: "no-store", ...options, signal: controller.signal });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 401) throw new Error("Your session has expired. Sign in again to save payment methods.");
          if (response.status === 403) throw new Error("Your account cannot update payment methods.");
          throw new Error(json.message || "Unable to reach the payment settings. Please try again.");
        }
        return json;
      } catch (error) {
        if (error.name === "AbortError") throw new Error("The request took too long. Please try again.");
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    };

    const showError = (message, canRetry) => {
      errorText.textContent = message;
      errorBox.hidden = false;
      retry.hidden = !canRetry;
    };

    const load = async ({ replaceDraft = false } = {}) => {
      if (busy || refreshing) { refreshQueued = true; return; }
      refreshing = true;
      if (!saved) busy = true;
      render();
      try {
        const json = await request("/site-settings", { headers: { Accept: "application/json" } });
        if (!json.data || typeof json.data !== "object" || Array.isArray(json.data)) throw new Error("Payment settings could not be loaded. Please try again.");
        const incoming = parseSettings(json.data);
        if (isDirty() && !replaceDraft) {
          changedElsewhere.hidden = same(saved, incoming);
        } else {
          saved = incoming;
          draft = { ...incoming };
          changedElsewhere.hidden = true;
        }
        errorBox.hidden = true;
      } catch (error) {
        showError(saved ? "Could not refresh saved payment methods. Your selections are still here. Please try again." : error.message, true);
      } finally {
        busy = false;
        refreshing = false;
        render();
        if (refreshQueued) { refreshQueued = false; void load(); }
      }
    };

    const notifyCustomers = () => {
      try { channel?.postMessage({ type: "updated", source: "payment-methods" }); } catch { /* Storage also notifies open tabs. */ }
      try { localStorage.setItem(STAMP, String(Date.now())); } catch { /* Refresh on focus still works. */ }
    };

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy || refreshing || !isDirty()) return;
      const submitted = { ...draft };
      busy = true;
      errorBox.hidden = true;
      render();
      try {
        const authToken = window.AdminSession?.getToken() || localStorage.getItem("auth_token") || "";
        await request("/admin/site-settings", {
          method: "PUT",
          headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
          body: JSON.stringify(Object.fromEntries(METHODS.map((key) => [key, submitted[key] ? "1" : "0"]))),
        });
        saved = submitted;
        draft = { ...submitted };
        changedElsewhere.hidden = true;
        lastSaveSucceeded = true;
        notifyCustomers();
        window.showAdminPopup?.("Payment methods saved.", { title: "Saved!" });
      } catch (error) {
        showError(error.message || "Payment methods could not be saved. Please try again.", false);
      } finally {
        busy = false;
        render();
        if (refreshQueued) { refreshQueued = false; void load(); }
      }
    });

    METHODS.forEach((key) => document.getElementById(key).addEventListener("change", (event) => {
      if (!draft || busy || refreshing) return;
      draft[key] = event.target.checked;
      lastSaveSucceeded = false;
      render();
    }));
    const setAll = (enabled) => {
      if (!draft || busy || refreshing) return;
      METHODS.forEach((key) => { draft[key] = enabled; });
      lastSaveSucceeded = false;
      render();
    };
    enableAll.addEventListener("click", () => setAll(true));
    disableAll.addEventListener("click", () => setAll(false));
    discard.addEventListener("click", () => {
      if (busy || refreshing || !saved) return;
      draft = { ...saved };
      lastSaveSucceeded = false;
      errorBox.hidden = true;
      render();
      void load();
    });
    document.getElementById("reloadPaymentSettings").addEventListener("click", () => void load({ replaceDraft: true }));
    retry.addEventListener("click", () => void load());
    window.addEventListener("beforeunload", (event) => {
      if (!isDirty()) return;
      event.preventDefault();
      event.returnValue = "";
    });
    window.addEventListener("focus", () => void load());
    document.addEventListener("visibilitychange", () => { if (!document.hidden) void load(); });
    window.addEventListener("storage", (event) => { if (event.key === STAMP) void load(); });
    try {
      if (typeof window.BroadcastChannel === "function") {
        channel = new window.BroadcastChannel(CHANNEL);
        channel.addEventListener("message", () => void load());
      }
    } catch { /* The focus and storage fallbacks remain available. */ }
    void load();
  });
})();
