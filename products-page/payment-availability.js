/* New-order payment availability. Existing order payments are independent. */
(() => {
  const settingKeys = {
    "Cash on Pickup": "payment_cash_on_pickup_enabled",
    "Cash on Delivery": "payment_cash_on_delivery_enabled",
    GCash: "payment_gcash_enabled",
  };
  let methods = null;
  let submitting = false;
  let selectionRemoved = false;
  let loadFailed = false;

  const isEnabled = (method) => Boolean(methods && methods[method]);
  const sync = () => {
    const list = document.getElementById("tiktokPaymentList");
    const select = document.getElementById("hiddenPaymentSelect");
    if (!list || !select) return;

    list.setAttribute("aria-busy", String(!methods && !loadFailed));
    list.querySelectorAll(".tiktok-pm-item").forEach((item) => {
      const enabled = isEnabled(item.dataset.method);
      const interactive = enabled && !submitting;
      item.hidden = Boolean(methods && !enabled);
      item.setAttribute("aria-disabled", String(!interactive));
      item.tabIndex = interactive ? 0 : -1;
      item.classList.toggle("selected", enabled && select.value === item.dataset.method);
      item.setAttribute("aria-pressed", String(enabled && select.value === item.dataset.method));
      item.querySelectorAll("button").forEach((button) => { button.disabled = !interactive; });
    });
    Array.from(select.options).forEach((option) => {
      if (option.value) option.disabled = !isEnabled(option.value);
    });
    if (select.value && !isEnabled(select.value)) {
      selectionRemoved = Boolean(methods);
      select.value = "";
      select.dispatchEvent(new Event("change"));
    }

    const available = methods && Object.values(methods).some(Boolean);
    const notice = document.getElementById("checkoutPaymentNotice");
    const message = document.getElementById("checkoutPaymentMessage");
    const retry = document.getElementById("checkoutPaymentRetry");
    if (message) {
      message.textContent = !methods
        ? (loadFailed ? "Payment methods could not be loaded. Please try again." : "Checking available payment methods…")
        : !available
          ? "Ordering is temporarily unavailable because all payment methods are disabled. Please check back later."
          : selectionRemoved
            ? "Your selected payment method is no longer available. Please choose another method."
            : "";
    }
    if (notice) notice.hidden = Boolean(methods && available && !selectionRemoved);
    if (retry) retry.hidden = Boolean(methods || !loadFailed);
    const submit = document.getElementById("submitOrderBtn");
    if (submit) submit.disabled = submitting || !available || !isEnabled(select.value);
  };

  const applySettings = (settings) => {
    methods = Object.fromEntries(Object.entries(settingKeys).map(([method, key]) => {
      const value = settings[key];
      return [method, value === undefined || value === true || value === 1 || value === "1"];
    }));
    loadFailed = false;
    sync();
  };
  window.FMRC_PAYMENT_METHODS = {
    applySettings,
    isEnabled,
    sync,
    rejectMethod(method) {
      if (methods && Object.hasOwn(settingKeys, method)) methods[method] = false;
      sync();
    },
    loadFailed() { loadFailed = true; sync(); },
    setSubmitting(value) { submitting = Boolean(value); sync(); },
  };
  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("hiddenPaymentSelect")?.addEventListener("change", () => {
      if (isEnabled(document.getElementById("hiddenPaymentSelect")?.value)) selectionRemoved = false;
      sync();
    });
    document.getElementById("checkoutPaymentRetry")?.addEventListener("click", async () => {
      loadFailed = false;
      sync();
      await window.FMRC_REFRESH_SITE_SETTINGS?.();
    });
    sync();
  });
})();
