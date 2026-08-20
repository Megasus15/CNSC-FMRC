/*
 * Shared Cloudflare Turnstile loader.
 *
 * The widget is only rendered when the Laravel API reports that production
 * Turnstile keys are configured. This keeps local development and existing
 * deployments working until the feature is deliberately enabled.
 */
(() => {
  const resolveApiBaseUrl = () => {
    const configured = String(window.APP_API_BASE_URL || "").trim();
    if (configured) return configured.replace(/\/+$/, "");

    const protocol = String(window.location.protocol || "").toLowerCase();
    const hostname = String(window.location.hostname || "").toLowerCase();
    const origin = String(window.location.origin || "");
    const port = String(window.location.port || "");

    if (!/^https?:$/.test(protocol) || !hostname) {
      return "http://127.0.0.1:8000/api";
    }

    if (port === "8000") return `${origin.replace(/\/+$/, "")}/api`;

    const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1";
    if (isLocalHost) return `${protocol}//${hostname}:8000/api`;

    return `${origin.replace(/\/+$/, "")}/api`;
  };

  const API_BASE_URL = resolveApiBaseUrl();
  let readyPromise = null;

  const resolveWidget = (target) => {
    if (!target) return null;
    if (typeof target === "string") return document.getElementById(target);
    return target instanceof Element ? target : null;
  };

  const getToken = (target) => {
    const widget = resolveWidget(target);
    if (!widget) return "";

    const hiddenInput = widget.querySelector(
      'input[name="cf-turnstile-response"]',
    );
    return String(hiddenInput?.value || widget.dataset.token || "").trim();
  };

  const markWidgetError = (widget, message) => {
    if (!widget) return;
    widget.dataset.error = message;
    widget.setAttribute("aria-label", message);
  };

  const loadTurnstileApi = () => {
    if (window.turnstile) return Promise.resolve();

    const existing = document.querySelector(
      'script[data-fmrc-turnstile-api="true"]',
    );
    if (existing) {
      return new Promise((resolve, reject) => {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
      });
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      script.async = true;
      script.defer = true;
      script.dataset.fmrcTurnstileApi = "true";
      script.addEventListener("load", resolve, { once: true });
      script.addEventListener("error", reject, { once: true });
      document.head.appendChild(script);
    });
  };

  const renderWidgets = async () => {
    const widgets = Array.from(
      document.querySelectorAll("[data-fmrc-turnstile]"),
    );

    if (!widgets.length) {
      return { enabled: false, error: null };
    }

    let config;
    try {
      const response = await fetch(`${API_BASE_URL}/security-config`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`Security config HTTP ${response.status}`);
      config = await response.json();
    } catch (error) {
      const message =
        "The security check could not be loaded. Please refresh and try again.";
      widgets.forEach((widget) => markWidgetError(widget, message));
      return { enabled: false, error: true };
    }

    const turnstileConfig = config?.turnstile || {};
    const siteKey = String(turnstileConfig.site_key || "").trim();
    if (!turnstileConfig.enabled || !siteKey) {
      widgets.forEach((widget) => {
        widget.hidden = true;
        widget.setAttribute("aria-hidden", "true");
      });
      return { enabled: false, error: null };
    }

    try {
      await loadTurnstileApi();
      if (!window.turnstile || typeof window.turnstile.render !== "function") {
        throw new Error("Turnstile API did not initialize.");
      }

      widgets.forEach((widget) => {
        widget.hidden = false;
        widget.removeAttribute("aria-hidden");
        if (widget.dataset.widgetId !== undefined) return;

        const widgetId = window.turnstile.render(widget, {
          sitekey: siteKey,
          theme: widget.dataset.theme || "auto",
          size: widget.dataset.size || "flexible",
          callback: (token) => {
            widget.dataset.token = String(token || "");
            widget.dispatchEvent(
              new CustomEvent("fmrc:turnstile-token", {
                bubbles: true,
                detail: { token: widget.dataset.token },
              }),
            );
          },
          "expired-callback": () => {
            widget.dataset.token = "";
            widget.dispatchEvent(
              new CustomEvent("fmrc:turnstile-expired", { bubbles: true }),
            );
          },
          "error-callback": () => {
            widget.dataset.token = "";
            widget.dispatchEvent(
              new CustomEvent("fmrc:turnstile-error", { bubbles: true }),
            );
          },
        });

        widget.dataset.widgetId = String(widgetId);
      });

      return { enabled: true, error: null };
    } catch (error) {
      const message =
        "The security check could not be initialized. Please refresh and try again.";
      widgets.forEach((widget) => markWidgetError(widget, message));
      return { enabled: false, error: true };
    }
  };

  const start = () => {
    if (!readyPromise) readyPromise = renderWidgets();
    return readyPromise;
  };

  window.FMRC_TURNSTILE = {
    ready: start,
    getToken,
    reset(target) {
      const widget = resolveWidget(target);
      if (!widget) return;

      widget.dataset.token = "";
      const widgetId = widget.dataset.widgetId;
      if (widgetId !== undefined && window.turnstile?.reset) {
        window.turnstile.reset(widgetId);
      }
    },
    async requireToken(target) {
      const state = await start();
      if (state.error) {
        const error = new Error(
          "The security check is unavailable. Please refresh and try again.",
        );
        error.code = "TURNSTILE_UNAVAILABLE";
        throw error;
      }

      if (!state.enabled) return "";

      const token = getToken(target);
      if (!token) {
        const error = new Error(
          "Please complete the security check before continuing.",
        );
        error.code = "TURNSTILE_REQUIRED";
        throw error;
      }

      return token;
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    void start();
  }
})();
