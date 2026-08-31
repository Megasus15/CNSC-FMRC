document.addEventListener("DOMContentLoaded", () => {
  // ── API Base URL (works on localhost AND production) ──────────────────────
  const API_BASE_URL = (() => {
    const proto = window.location.protocol;
    const host = window.location.hostname;
    const port = window.location.port;
    if (port === "8000") return `${proto}//${host}:${port}/api`;
    if (host === "localhost" || host === "127.0.0.1")
      return `${proto}//${host}:8000/api`;
    return `${proto}//${host}/api`;
  })();

  const loginForm = document.getElementById("loginForm");
  const authStatusModal = document.getElementById("authStatusModal");
  const authStatusText = document.getElementById("authStatusText");

  /*
   * Cloudflare Turnstile gate.
   *
   * Signing in requires all three of: a known email/username, the matching
   * password, and a completed security check. The submit button therefore stays
   * locked until Cloudflare hands us a token, and requireToken() throws (rather
   * than resolving with "") whenever the challenge has not been solved, so the
   * request is never sent without one.
   *
   * The one case that does not lock the button is a deployment where Turnstile
   * is switched off (no site/secret key in .env): there is no widget to click,
   * so the check reports itself disabled and the form behaves as before.
   */
  const TURNSTILE_WIDGET_ID = "adminLoginTurnstile";
  const turnstileWidget = document.getElementById(TURNSTILE_WIDGET_ID);
  const turnstileNote = document.getElementById("adminTurnstileNote");
  const loginSubmitBtn = loginForm?.querySelector('button[type="submit"]');
  let turnstileRequired = false;

  const PROMPT_COMPLETE = "Complete the security check to continue.";
  const PROMPT_EXPIRED =
    "The security check expired. Please complete it again.";
  const PROMPT_FAILED =
    "The security check could not be completed. Refresh the page and try again.";

  const showTurnstileNote = (message) => {
    if (!turnstileNote) return;
    turnstileNote.textContent = message || "";
    turnstileNote.hidden = !message;
  };

  const setSubmitLocked = (locked) => {
    if (!loginSubmitBtn) return;
    loginSubmitBtn.disabled = locked;
    loginSubmitBtn.setAttribute("aria-disabled", locked ? "true" : "false");
  };

  const lockUntilChallengeSolved = (message) => {
    if (!turnstileRequired) return;
    setSubmitLocked(true);
    showTurnstileNote(message);
  };

  // Same re-lock, but keeps a message the API already produced (for example the
  // 422 from a token Cloudflare rejected) instead of overwriting it.
  const relockAfterAttempt = () => {
    if (!turnstileRequired) return;
    setSubmitLocked(true);
    if (!turnstileNote || turnstileNote.hidden) showTurnstileNote(PROMPT_COMPLETE);
  };

  const revealChallenge = () => {
    turnstileWidget?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  // Used when a submit is blocked by the security check. The message joins the
  // floating alert so the check reports through the same surface as the fields,
  // and the slot is ringed so it is still obvious which control is being asked
  // for. The inline note is cleared first so the sentence is not shown twice.
  const blockSubmitOnChallenge = (message) => {
    setSubmitLocked(true);
    showTurnstileNote("");
    turnstileWidget?.classList.add("has-error");
    pushAlertMessage(TURNSTILE_WIDGET_ID, message, revealChallenge);
    revealChallenge();
  };

  const initTurnstileGate = async () => {
    const api = window.FMRC_TURNSTILE;
    if (!turnstileWidget || typeof api?.ready !== "function") return;

    const state = await api.ready().catch(() => ({
      enabled: false,
      error: true,
    }));

    if (!state?.enabled) {
      // Either the challenge is not configured for this deployment (nothing to
      // click) or /api/security-config could not be reached. In the second case
      // requireToken() will refuse the submit, so say why up front.
      if (state?.error) {
        setSubmitLocked(true);
        showTurnstileNote(
          "The security check could not be loaded. Refresh the page and try again.",
        );
      }
      return;
    }

    turnstileRequired = true;
    lockUntilChallengeSolved(PROMPT_COMPLETE);

    turnstileWidget.addEventListener("fmrc:turnstile-token", () => {
      setSubmitLocked(false);
      showTurnstileNote("");
      turnstileWidget.classList.remove("has-error");
      dropAlertMessage(TURNSTILE_WIDGET_ID);
    });
    turnstileWidget.addEventListener("fmrc:turnstile-expired", () =>
      lockUntilChallengeSolved(PROMPT_EXPIRED),
    );
    turnstileWidget.addEventListener("fmrc:turnstile-error", () =>
      lockUntilChallengeSolved(PROMPT_FAILED),
    );
  };

  void initTurnstileGate();

  const toggleLoader = (show) => {
    let loader = document.getElementById("global-loader");
    if (!loader) {
      loader = document.createElement("div");
      loader.id = "global-loader";
      loader.className = "global-loader-overlay";
      loader.innerHTML = '<div class="laravel-spinner"></div>';
      document.body.appendChild(loader);
    }
    loader.classList.toggle("active", show);
  };

  const showStatus = (message) => {
    if (!authStatusModal || !authStatusText) return;
    authStatusText.textContent = message;
    authStatusModal.classList.add("show");
  };

  // ── Floating error alert ───────────────────────────────────────────────────
  // Every field message collects in one alert pinned to the top of the screen.
  // The old bubble was appended inside the field box, so on phones it dropped
  // into the flow and grew the field by ~39px: each error shifted the rest of the
  // form, and a full-width message landed on the next label. A fixed alert cannot
  // move a field, and it renders above the dialogs as well.
  const errorAlert = { el: null, title: null, list: null };

  // A programmatic focus must not wipe the message just written for the field it
  // is focusing, so that one focusin is exempt from the dismiss handler.
  let focusExemptFromDismiss = null;

  // The alert takes itself off the screen 5s after the last message landed.
  // Two timers, never `transitionend`: a transition does not advance while the
  // tab is hidden, so a removal that waited on the fade to finish would leave
  // the alert parked on top of the form at an invisible frame. The class is for
  // the visual; these timers are what actually remove the node.
  const DISMISS_AFTER = 5000;
  const DISMISS_FADE = 260;
  let dismissTimer = null;
  let dismissRemoveTimer = null;

  const stopDismissTimer = () => {
    clearTimeout(dismissTimer);
    clearTimeout(dismissRemoveTimer);
    dismissTimer = null;
    dismissRemoveTimer = null;
    errorAlert.el?.classList.remove("is-leaving");
  };

  const startDismissTimer = () => {
    stopDismissTimer();
    dismissTimer = setTimeout(() => {
      if (!errorAlert.el) return;
      errorAlert.el.classList.add("is-leaving");
      dismissRemoveTimer = setTimeout(() => clearAllErrors(), DISMISS_FADE);
    }, DISMISS_AFTER);
  };

  const syncErrorAlert = () => {
    if (!errorAlert.el) return;

    const count = errorAlert.list.children.length;
    if (!count) {
      // Nothing left to say: drop the node so it cannot intercept a tap.
      stopDismissTimer();
      errorAlert.el.remove();
      errorAlert.el = null;
      errorAlert.title = null;
      errorAlert.list = null;
      return;
    }

    errorAlert.title.hidden = count < 2;
  };

  const ensureErrorAlert = () => {
    if (errorAlert.el?.isConnected) return errorAlert;

    const alert = document.createElement("div");
    alert.id = "authErrorAlert";
    alert.className = "auth-error-alert";
    alert.setAttribute("role", "alert");
    alert.setAttribute("aria-live", "assertive");
    alert.innerHTML =
      '<span class="auth-error-mark" aria-hidden="true">!</span>' +
      '<div class="auth-error-body">' +
      '<p class="auth-error-title" hidden>Please check these fields</p>' +
      '<ul class="auth-error-list"></ul>' +
      "</div>" +
      '<button class="auth-error-close" type="button" aria-label="Dismiss messages">&times;</button>';

    alert
      .querySelector(".auth-error-close")
      .addEventListener("click", () => clearAllErrors());

    // Someone reading the list should not be racing the 5s clock: hovering it
    // or tabbing into it holds the alert, and leaving restarts the countdown.
    alert.addEventListener("pointerenter", stopDismissTimer);
    alert.addEventListener("pointerleave", startDismissTimer);
    alert.addEventListener("focusin", stopDismissTimer);
    alert.addEventListener("focusout", startDismissTimer);

    document.body.appendChild(alert);
    errorAlert.el = alert;
    errorAlert.title = alert.querySelector(".auth-error-title");
    errorAlert.list = alert.querySelector(".auth-error-list");
    return errorAlert;
  };

  const focusFieldFromAlert = (inputId) => {
    const input = document.getElementById(inputId);
    if (!input) return;

    // The focus is what the message asked for, so it must not dismiss it.
    focusExemptFromDismiss = input;
    input.focus({ preventScroll: true });
    focusExemptFromDismiss = null;
    input.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  // One line per key, so re-validating the same field rewrites its message
  // instead of stacking duplicates.
  const pushAlertMessage = (key, message, onSelect) => {
    const { list } = ensureErrorAlert();

    let item = list.querySelector(`[data-error-for="${key}"]`);
    if (!item) {
      item = document.createElement("li");
      item.className = "auth-error-item";
      item.dataset.errorFor = key;

      const line = document.createElement("button");
      line.type = "button";
      line.className = "auth-error-link";
      line.addEventListener("click", () => onSelect(key));
      item.appendChild(line);
      list.appendChild(item);
    }

    item.querySelector(".auth-error-link").textContent = message;
    syncErrorAlert();
    // Restarted, not merely started: a second field failing in the same submit
    // gives the whole alert a fresh 5s rather than inheriting the first one's.
    startDismissTimer();
  };

  const dropAlertMessage = (key) => {
    if (!key || !errorAlert.list) return;
    errorAlert.list.querySelector(`[data-error-for="${key}"]`)?.remove();
    syncErrorAlert();
  };

  const setFieldError = (inputId, message) => {
    const input = document.getElementById(inputId);
    if (!input) return;

    const wrapper = input.closest(".input-wrapper");
    if (!wrapper) return;

    wrapper.classList.add("has-error");
    input.setAttribute("aria-invalid", "true");
    pushAlertMessage(inputId, message, focusFieldFromAlert);
  };

  const clearFieldError = (inputId) => {
    const input = document.getElementById(inputId);
    if (!input) return;

    const wrapper = input.closest(".input-wrapper");
    if (!wrapper) return;

    wrapper.classList.remove("has-error");
    input.removeAttribute("aria-invalid");
    dropAlertMessage(inputId);
  };

  const clearFormErrors = (form) => {
    form.querySelectorAll(".input-wrapper").forEach((wrapper) => {
      wrapper.classList.remove("has-error");
      const input = wrapper.querySelector("input");
      if (input) {
        input.removeAttribute("aria-invalid");
        dropAlertMessage(input.id);
      }
    });
  };

  // The alert's dismiss button clears every message and every ring at once.
  const clearAllErrors = () => {
    // First, so the close button and the auto-dismiss cannot both fire.
    stopDismissTimer();
    document.querySelectorAll(".input-wrapper.has-error").forEach((wrapper) => {
      wrapper.classList.remove("has-error");
      wrapper
        .querySelectorAll("[aria-invalid]")
        .forEach((field) => field.removeAttribute("aria-invalid"));
    });
    document
      .querySelectorAll(".fmrc-turnstile-slot.has-error")
      .forEach((slot) => slot.classList.remove("has-error"));

    errorAlert.list?.replaceChildren();
    syncErrorAlert();
  };

  // Touching a field dismisses its own message — a click or tap anywhere in the
  // wrapper (input, label, password toggle) and keyboard focus both count.
  // Delegated from the document so the forgot-password modal is covered too.
  const dismissErrorFrom = (event) => {
    const wrapper = event.target?.closest?.(".input-wrapper.has-error");
    if (!wrapper) return;

    if (event.type === "focusin" && event.target === focusExemptFromDismiss) {
      return;
    }

    wrapper.classList.remove("has-error");
    wrapper
      .querySelectorAll("[aria-invalid]")
      .forEach((field) => field.removeAttribute("aria-invalid"));
    wrapper
      .querySelectorAll("input[id]")
      .forEach((field) => dropAlertMessage(field.id));
  };

  document.addEventListener("pointerdown", dismissErrorFrom);
  document.addEventListener("focusin", dismissErrorFrom);

  // Sending focus to the first invalid field must not wipe the message that was
  // just written there, so that one programmatic focus is exempt.
  const focusWithoutDismissing = (field) => {
    if (!field) return;
    focusExemptFromDismiss = field;
    field.focus();
    focusExemptFromDismiss = null;
  };

  // Password Toggle Logic with SVG swapping
  const eyeOpenSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
  const eyeClosedSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

  document.querySelectorAll(".toggle-pass").forEach((toggleBtn) => {
    toggleBtn.addEventListener("click", () => {
      const targetId = toggleBtn.getAttribute("data-target");
      const input = targetId ? document.getElementById(targetId) : null;
      if (!input) return;

      const isPassword = input.type === "password";
      input.type = isPassword ? "text" : "password";

      // Swap the SVG inside the button — CORRECTED:
      // isPassword=true means we're revealing it → show OPEN eye
      // isPassword=false means we're hiding it again → show CLOSED eye
      toggleBtn.innerHTML = isPassword ? eyeOpenSVG : eyeClosedSVG;
      toggleBtn.setAttribute(
        "aria-label",
        isPassword ? "Hide password" : "Show password",
      );
    });
  });

  // Live validation feedback while typing.
  ["loginUser", "loginPass"].forEach((inputId) => {
    const input = document.getElementById(inputId);
    if (!input) return;

    input.addEventListener("input", () => {
      if (input.value.trim()) {
        clearFieldError(inputId);
      }
    });
  });

  // Handle Login Submit
  if (loginForm) {
    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      clearFormErrors(loginForm);

      const user = document.getElementById("loginUser").value.trim();
      const pass = document.getElementById("loginPass").value;

      let hasError = false;

      if (!user) {
        setFieldError(
          "loginUser",
          "Please enter your email or username before logging in.",
        );
        hasError = true;
      }

      if (!pass) {
        setFieldError(
          "loginPass",
          "Password cannot be empty. Please enter your password.",
        );
        hasError = true;
      }

      if (hasError) {
        const firstErrorInput = loginForm.querySelector(
          ".input-wrapper.has-error input",
        );
        focusWithoutDismissing(firstErrorInput);
        return;
      }

      // Gates the submit: without a verified Cloudflare token the request is
      // never sent, so correct credentials on their own cannot sign anyone in.
      let turnstileToken = "";
      try {
        turnstileToken =
          (await window.FMRC_TURNSTILE?.requireToken(TURNSTILE_WIDGET_ID)) || "";
      } catch (error) {
        const message =
          error?.code === "TURNSTILE_UNAVAILABLE"
            ? "The security check could not be loaded. Refresh the page and try again."
            : PROMPT_COMPLETE;
        blockSubmitOnChallenge(message);
        return;
      }

      toggleLoader(true);
      try {
        const payload = {
          login: user,
          password: pass,
        };
        if (turnstileToken) {
          payload["cf-turnstile-response"] = turnstileToken;
        }

        const response = await fetch(`${API_BASE_URL}/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (response.ok) {
          // Store token under role-specific keys so admin & staff sessions don't collide.
          const userRole = (data.user.role || "").toLowerCase();
          if (userRole === "staff") {
            localStorage.setItem("staff_auth_token", data.access_token);
            localStorage.setItem("staff_user_info", JSON.stringify(data.user));
          } else {
            localStorage.setItem("admin_auth_token", data.access_token);
            localStorage.setItem("admin_user_info", JSON.stringify(data.user));
          }
          // Remove any legacy keys to prevent conflicts
          localStorage.removeItem("auth_token");
          localStorage.removeItem("user_info");

          showStatus("Login successful. Opening dashboard...");

          if (data.user.role === "admin") {
            window.location.href = "../admin-page/dashboard.html";
          } else if (data.user.role === "staff") {
            window.location.href = "../staff-page/dashboard.html";
          } else {
            setFieldError(
              "loginUser",
              "Unauthorized access. This portal is for Admin and Staff only.",
            );
          }
        } else if (response.status === 422 && data.errors) {
          if (data.errors["cf-turnstile-response"]?.[0]) {
            showTurnstileNote(data.errors["cf-turnstile-response"][0]);
          }
          if (data.errors.login?.[0]) {
            setFieldError("loginUser", data.errors.login[0]);
          }
          if (data.errors.password?.[0]) {
            setFieldError("loginPass", data.errors.password[0]);
          }
        } else if (
          data.message &&
          /invalid|incorrect|credentials/i.test(data.message)
        ) {
          setFieldError("loginPass", "Password is incorrect.");
        } else {
          setFieldError(
            "loginUser",
            data.message || "Unable to log in with the provided details.",
          );
        }
      } catch {
        setFieldError(
          "loginUser",
          "Cannot connect to server. Ensure Laravel is running (php artisan serve).",
        );
      } finally {
        // A token is single-use: clear it and re-lock so the next attempt has to
        // pass a fresh challenge. Cloudflare reissues one automatically when the
        // widget is not interactive.
        window.FMRC_TURNSTILE?.reset(TURNSTILE_WIDGET_ID);
        relockAfterAttempt();
        toggleLoader(false);
      }
    });
  }

  // ── OTP-based Forgot Password Flow (Admin & Staff) ──
  const forgotPasswordModal = document.getElementById("forgotPasswordModal");
  const forgotPasswordLink = document.getElementById("forgotPasswordLink");
  const forgotCloseBtn = document.getElementById("forgotCloseBtn");
  const forgotDoneBtn = document.getElementById("forgotDoneBtn");
  const forgotBackToLogin = document.getElementById("forgotBackToLogin");
  const forgotRequestStep = document.getElementById("forgotRequestStep");
  const forgotVerifyStep = document.getElementById("forgotVerifyStep");
  const forgotSuccessStep = document.getElementById("forgotSuccessStep");
  const forgotForm = document.getElementById("forgotForm");
  const forgotEmail = document.getElementById("forgotEmail");
  const btnSendOtp = document.getElementById("btnSendOtp");
  const otpLockoutBanner = document.getElementById("otpLockoutBanner");
  const otpLockoutMessage = document.getElementById("otpLockoutMessage");
  const otpTargetEmail = document.getElementById("otpTargetEmail");
  const otpInfoPill = document.getElementById("otpInfoPill");
  const otpVerifyForm = document.getElementById("otpVerifyForm");
  const otpCodeInput = document.getElementById("otpCodeInput");
  const otpNewPassword = document.getElementById("otpNewPassword");
  const otpConfirmPassword = document.getElementById("otpConfirmPassword");
  const btnVerifyOtp = document.getElementById("btnVerifyOtp");
  const btnResendOtp = document.getElementById("btnResendOtp");
  const resendCountdownText = document.getElementById("resendCountdownText");
  const resendSeconds = document.getElementById("resendSeconds");
  const btnChangeOtpEmail = document.getElementById("btnChangeOtpEmail");

  // ── Recovery-code step (Administrator only) ──
  // The markup ships on this one page for both roles, but only the admin holds
  // codes: the backend answers a staff/customer login with the very same
  // message as a wrong code, so nothing here can be used to probe accounts.
  const forgotRecoveryStep = document.getElementById("forgotRecoveryStep");
  const forgotSuccessText = document.getElementById("forgotSuccessText");
  const useRecoveryCodeLink = document.getElementById("useRecoveryCodeLink");
  const recoveryCodeForm = document.getElementById("recoveryCodeForm");
  const recoveryLogin = document.getElementById("recoveryLogin");
  const recoveryCodeInput = document.getElementById("recoveryCodeInput");
  const recoveryNewPassword = document.getElementById("recoveryNewPassword");
  const recoveryConfirmNewPassword = document.getElementById(
    "recoveryConfirmNewPassword",
  );
  const btnRedeemRecovery = document.getElementById("btnRedeemRecovery");
  const recoveryBackToOtp = document.getElementById("recoveryBackToOtp");
  const recoveryStepHint = document.getElementById("recoveryStepHint");

  // Captured once so the shared success step can be put back to the emailed-OTP
  // wording after a recovery-code reset has rewritten it.
  const forgotSuccessDefaultText = forgotSuccessText?.textContent?.trim() || "";

  const setRecoveryHint = (text) => {
    if (recoveryStepHint) recoveryStepHint.textContent = text || "";
  };

  const clearRecoveryErrors = () => {
    clearFieldError("recoveryLogin");
    clearFieldError("recoveryCodeInput");
    clearFieldError("recoveryNewPassword");
    clearFieldError("recoveryConfirmNewPassword");
  };

  const resetRecoveryStep = () => {
    clearRecoveryErrors();
    setRecoveryHint("");
    if (recoveryLogin) recoveryLogin.value = "";
    if (recoveryCodeInput) recoveryCodeInput.value = "";
    if (recoveryNewPassword) recoveryNewPassword.value = "";
    if (recoveryConfirmNewPassword) recoveryConfirmNewPassword.value = "";
  };

  // Codes are stored without the dash and case-folded, so any of
  // "abcde-fghij", "ABCDEFGHIJ" or "abcde fghij" resolves to the same value.
  const maskRecoveryCode = (raw) =>
    String(raw || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 10)
      .replace(/^(.{5})(.+)$/, "$1-$2");

  let currentOtpEmail = "";
  let resendTimerInterval = null;
  let lockoutTimerInterval = null;

  const formatSecondsReadable = (totalSeconds) => {
    if (totalSeconds < 60) {
      return `${totalSeconds}s`;
    }
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 && hours === 0) parts.push(`${seconds}s`);
    return parts.join(" ") || "0s";
  };

  const startResendCooldown = (duration = 60) => {
    if (resendTimerInterval) clearInterval(resendTimerInterval);
    if (!btnResendOtp || !resendCountdownText || !resendSeconds) return;

    let remaining = duration;
    btnResendOtp.style.display = "none";
    resendCountdownText.style.display = "inline";
    resendSeconds.textContent = remaining;

    resendTimerInterval = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(resendTimerInterval);
        resendCountdownText.style.display = "none";
        btnResendOtp.style.display = "inline";
        btnResendOtp.disabled = false;
      } else {
        resendSeconds.textContent = remaining;
      }
    }, 1000);
  };

  const showLockoutAlert = (remainingSecs, customMessage = "") => {
    if (lockoutTimerInterval) clearInterval(lockoutTimerInterval);
    if (!otpLockoutBanner || !otpLockoutMessage) return;

    let remaining = remainingSecs;
    otpLockoutBanner.style.display = "flex";
    if (btnSendOtp) btnSendOtp.disabled = true;

    const updateMsg = () => {
      const timeStr = formatSecondsReadable(remaining);
      otpLockoutMessage.innerHTML = customMessage
        ? `<strong>Rate Limit:</strong> ${customMessage} (Cooldown: <strong>${timeStr}</strong>)`
        : `<strong>5-Attempt Limit Reached:</strong> Please wait <strong>${timeStr}</strong> before requesting another OTP for this email.`;
    };

    updateMsg();

    lockoutTimerInterval = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(lockoutTimerInterval);
        otpLockoutBanner.style.display = "none";
        if (btnSendOtp) btnSendOtp.disabled = false;
      } else {
        updateMsg();
      }
    }, 1000);
  };

  const openForgotModal = (event) => {
    if (event) event.preventDefault();
    if (!forgotPasswordModal) return;

    forgotRequestStep?.removeAttribute("hidden");
    forgotVerifyStep?.setAttribute("hidden", "");
    forgotRecoveryStep?.setAttribute("hidden", "");
    forgotSuccessStep?.setAttribute("hidden", "");

    // The success step is shared, so the recovery wording must not leak into a
    // later emailed-OTP reset.
    if (forgotSuccessText && forgotSuccessDefaultText) {
      forgotSuccessText.textContent = forgotSuccessDefaultText;
    }

    if (otpLockoutBanner) otpLockoutBanner.style.display = "none";
    if (lockoutTimerInterval) clearInterval(lockoutTimerInterval);
    if (resendTimerInterval) clearInterval(resendTimerInterval);

    clearFieldError("forgotEmail");
    clearFieldError("otpCodeInput");
    clearFieldError("otpNewPassword");
    clearFieldError("otpConfirmPassword");

    if (forgotEmail) forgotEmail.value = "";
    if (otpCodeInput) otpCodeInput.value = "";
    if (otpNewPassword) otpNewPassword.value = "";
    if (otpConfirmPassword) otpConfirmPassword.value = "";
    resetRecoveryStep();

    forgotPasswordModal.classList.add("show");
    document.body.style.overflow = "hidden";
    setTimeout(() => forgotEmail?.focus(), 120);
  };

  const closeForgotModal = () => {
    if (!forgotPasswordModal) return;
    forgotPasswordModal.classList.remove("show");
    document.body.style.overflow = "";
    if (lockoutTimerInterval) clearInterval(lockoutTimerInterval);
    if (resendTimerInterval) clearInterval(resendTimerInterval);

    // The alert is fixed to the page, not to the dialog, so a message about a
    // field inside the dialog has to leave with it.
    clearFieldError("forgotEmail");
    clearFieldError("otpCodeInput");
    clearFieldError("otpNewPassword");
    clearFieldError("otpConfirmPassword");
    clearRecoveryErrors();
  };

  forgotPasswordLink?.addEventListener("click", openForgotModal);
  forgotCloseBtn?.addEventListener("click", closeForgotModal);

  forgotDoneBtn?.addEventListener("click", () => {
    closeForgotModal();
    const loginUser = document.getElementById("loginUser");
    if (loginUser && currentOtpEmail) {
      loginUser.value = currentOtpEmail;
      const loginPass = document.getElementById("loginPass");
      loginPass?.focus();
    }
  });

  forgotBackToLogin?.addEventListener("click", (event) => {
    event.preventDefault();
    closeForgotModal();
  });

  btnChangeOtpEmail?.addEventListener("click", (event) => {
    event.preventDefault();
    forgotVerifyStep?.setAttribute("hidden", "");
    forgotRequestStep?.removeAttribute("hidden");
    clearFieldError("forgotEmail");
    setTimeout(() => forgotEmail?.focus(), 100);
  });

  // Close on Escape key
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      forgotPasswordModal?.classList.contains("show")
    ) {
      closeForgotModal();
    }
  });

  // Step 1 → Step 2b: the admin has the codes but not the inbox. Whatever was
  // already typed as the email carries over, since it is a valid admin login.
  useRecoveryCodeLink?.addEventListener("click", (event) => {
    event.preventDefault();
    const typed = forgotEmail?.value.trim() || "";
    clearFieldError("forgotEmail");
    resetRecoveryStep();
    if (recoveryLogin) recoveryLogin.value = typed;
    forgotRequestStep?.setAttribute("hidden", "");
    forgotRecoveryStep?.removeAttribute("hidden");
    setRecoveryHint("Each code works once.");
    setTimeout(() => {
      if (typed) recoveryCodeInput?.focus();
      else recoveryLogin?.focus();
    }, 120);
  });

  recoveryBackToOtp?.addEventListener("click", (event) => {
    event.preventDefault();
    clearRecoveryErrors();
    forgotRecoveryStep?.setAttribute("hidden", "");
    forgotRequestStep?.removeAttribute("hidden");
    setTimeout(() => forgotEmail?.focus(), 100);
  });

  // Auto-format to xxxxx-xxxxx while typing, so a code read off paper lands the
  // same way whether or not the dash is typed.
  recoveryCodeInput?.addEventListener("input", () => {
    const atEnd =
      recoveryCodeInput.selectionStart === recoveryCodeInput.value.length;
    recoveryCodeInput.value = maskRecoveryCode(recoveryCodeInput.value);
    if (atEnd) {
      const end = recoveryCodeInput.value.length;
      recoveryCodeInput.setSelectionRange(end, end);
    }
    if (recoveryCodeInput.value.length === 11) {
      clearFieldError("recoveryCodeInput");
    }
  });

  // Format OTP code input (digits only)
  otpCodeInput?.addEventListener("input", () => {
    otpCodeInput.value = otpCodeInput.value.replace(/\D/g, "").slice(0, 6);
    if (otpCodeInput.value.length === 6) {
      clearFieldError("otpCodeInput");
    }
  });

  // Step 1: Send OTP
  if (forgotForm) {
    forgotForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearFieldError("forgotEmail");
      if (otpLockoutBanner) otpLockoutBanner.style.display = "none";

      const email = forgotEmail.value.trim();

      if (!email) {
        setFieldError("forgotEmail", "Email address is required.");
        return;
      }
      if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) {
        setFieldError("forgotEmail", "Please enter a valid email address.");
        return;
      }

      toggleLoader(true);
      try {
        const response = await fetch(`${API_BASE_URL}/forgot-password/send-otp`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ email, portal: "admin_staff" }),
        });

        const data = await response.json().catch(() => ({}));

        if (response.status === 429) {
          showLockoutAlert(data.remaining_seconds || 600, data.message);
          return;
        }

        if (response.status === 403 || response.status === 404) {
          setFieldError(
            "forgotEmail",
            data.message || "We could not find an Admin or Staff account registered with that email.",
          );
          return;
        }

        if (!response.ok) {
          setFieldError(
            "forgotEmail",
            data.errors?.email?.[0] || data.message || "Unable to send OTP. Please try again.",
          );
          return;
        }

        // Successfully sent OTP
        currentOtpEmail = email;
        if (otpTargetEmail) otpTargetEmail.textContent = email;

        if (otpInfoPill) {
          otpInfoPill.style.display = "inline-flex";
          otpInfoPill.innerHTML = `<i class="fa-solid fa-shield-halved"></i> Request ${data.send_count} of 5 &bull; Valid for 15 mins`;
        }

        forgotRequestStep?.setAttribute("hidden", "");
        forgotVerifyStep?.removeAttribute("hidden");
        clearFieldError("otpCodeInput");
        if (otpCodeInput) otpCodeInput.value = "";
        setTimeout(() => otpCodeInput?.focus(), 120);

        startResendCooldown(60);
      } catch {
        setFieldError("forgotEmail", "Cannot connect to server. Please try again.");
      } finally {
        toggleLoader(false);
      }
    });
  }

  // Resend OTP
  btnResendOtp?.addEventListener("click", async () => {
    if (!currentOtpEmail) return;
    btnResendOtp.disabled = true;
    toggleLoader(true);

    try {
      const response = await fetch(`${API_BASE_URL}/forgot-password/resend-otp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ email: currentOtpEmail, portal: "admin_staff" }),
      });

      const data = await response.json().catch(() => ({}));

      if (response.status === 429) {
        forgotVerifyStep?.setAttribute("hidden", "");
        forgotRequestStep?.removeAttribute("hidden");
        showLockoutAlert(data.remaining_seconds || 600, data.message);
        return;
      }

      if (response.ok) {
        if (otpInfoPill) {
          otpInfoPill.style.display = "inline-flex";
          otpInfoPill.innerHTML = `<i class="fa-solid fa-shield-halved"></i> Request ${data.send_count} of 5 &bull; Valid for 15 mins`;
        }
        showStatus("A new 6-digit OTP has been sent to your email!");
        startResendCooldown(60);
      } else {
        setFieldError("otpCodeInput", data.message || "Could not resend OTP. Please try again.");
      }
    } catch {
      setFieldError("otpCodeInput", "Cannot connect to server for OTP resend.");
    } finally {
      toggleLoader(false);
    }
  });

  // Step 2: Verify OTP & Reset Password
  if (otpVerifyForm) {
    otpVerifyForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearFieldError("otpCodeInput");
      clearFieldError("otpNewPassword");
      clearFieldError("otpConfirmPassword");

      const otp = otpCodeInput?.value.trim() || "";
      const password = otpNewPassword?.value || "";
      const passwordConfirmation = otpConfirmPassword?.value || "";

      let hasError = false;

      if (!otp || otp.length !== 6) {
        setFieldError("otpCodeInput", "Please enter the complete 6-digit OTP code.");
        hasError = true;
      }

      if (!password) {
        setFieldError("otpNewPassword", "New password is required.");
        hasError = true;
      } else if (password.length < 8) {
        setFieldError("otpNewPassword", "Password must be at least 8 characters.");
        hasError = true;
      }

      if (!passwordConfirmation) {
        setFieldError("otpConfirmPassword", "Please confirm your new password.");
        hasError = true;
      } else if (password !== passwordConfirmation) {
        setFieldError("otpConfirmPassword", "Password confirmation does not match.");
        hasError = true;
      }

      if (hasError) return;

      toggleLoader(true);
      try {
        const response = await fetch(`${API_BASE_URL}/forgot-password/verify-otp`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            email: currentOtpEmail,
            otp,
            password,
            password_confirmation: passwordConfirmation,
            portal: "admin_staff",
          }),
        });

        const data = await response.json().catch(() => ({}));

        if (response.ok) {
          forgotVerifyStep?.setAttribute("hidden", "");
          forgotSuccessStep?.removeAttribute("hidden");
          return;
        }

        if (response.status === 403) {
          setFieldError("otpCodeInput", data.message || "Unauthorized portal request.");
          return;
        }

        if (response.status === 422) {
          if (data.errors?.otp?.[0]) {
            setFieldError("otpCodeInput", data.errors.otp[0]);
          } else if (data.errors?.password?.[0]) {
            setFieldError("otpNewPassword", data.errors.password[0]);
          } else {
            setFieldError("otpCodeInput", data.message || "Invalid OTP code or password.");
          }
          return;
        }

        setFieldError("otpCodeInput", data.message || "Password reset failed. Please try again.");
      } catch {
        setFieldError("otpCodeInput", "Cannot connect to server. Please try again.");
      } finally {
        toggleLoader(false);
      }
    });
  }

  // Step 2b: trade one recovery code for a new admin password. No email is
  // involved, which is the whole point — this is the way back in when the
  // account Gmail is unreachable.
  if (recoveryCodeForm) {
    recoveryCodeForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearRecoveryErrors();
      setRecoveryHint("Each code works once.");
      const login = recoveryLogin?.value.trim() || "";
      const code = maskRecoveryCode(recoveryCodeInput?.value || "");
      const password = recoveryNewPassword?.value || "";
      const passwordConfirmation = recoveryConfirmNewPassword?.value || "";

      let hasError = false;

      if (!login) {
        setFieldError("recoveryLogin", "Enter the admin username or email.");
        hasError = true;
      }

      if (code.replace("-", "").length !== 10) {
        setFieldError(
          "recoveryCodeInput",
          "Enter the full 10-character recovery code (xxxxx-xxxxx).",
        );
        hasError = true;
      }

      if (!password) {
        setFieldError("recoveryNewPassword", "New password is required.");
        hasError = true;
      } else if (password.length < 8) {
        setFieldError(
          "recoveryNewPassword",
          "Password must be at least 8 characters.",
        );
        hasError = true;
      }

      if (!passwordConfirmation) {
        setFieldError(
          "recoveryConfirmNewPassword",
          "Please confirm your new password.",
        );
        hasError = true;
      } else if (password !== passwordConfirmation) {
        setFieldError(
          "recoveryConfirmNewPassword",
          "Password confirmation does not match.",
        );
        hasError = true;
      }

      if (hasError) return;
      toggleLoader(true);
      if (btnRedeemRecovery) btnRedeemRecovery.disabled = true;
      try {
        const response = await fetch(
          `${API_BASE_URL}/forgot-password/recovery-code`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              login,
              recovery_code: code,
              new_password: password,
              new_password_confirmation: passwordConfirmation,
            }),
          },
        );

        const data = await response.json().catch(() => ({}));

        if (response.status === 429) {
          const wait = Number(data.retry_after_seconds);
          const waitText =
            Number.isFinite(wait) && wait > 0
              ? ` Try again in about ${Math.ceil(wait / 60)} minute(s).`
              : "";
          setFieldError(
            "recoveryCodeInput",
            `${data.message || "Too many incorrect attempts."}${waitText}`,
          );
          return;
        }
        if (response.ok) {
          // Reuse the shared success step, and prefill the sign-in field the
          // same way the emailed-OTP path does.
          currentOtpEmail = login;
          if (forgotSuccessText) {
            const left = Number(data.remaining);
            forgotSuccessText.textContent = data.exhausted
              ? "Your admin password has been updated, and that was your last recovery code. Sign in, open My Account and generate a fresh set of ten right away."
              : `Your admin password has been updated with a recovery code. That code is now used up${
                  Number.isFinite(left)
                    ? ` — ${left} code${left === 1 ? "" : "s"} left`
                    : ""
                }. You can log in with your new password.`;
          }
          if (recoveryCodeInput) recoveryCodeInput.value = "";
          if (recoveryNewPassword) recoveryNewPassword.value = "";
          if (recoveryConfirmNewPassword) recoveryConfirmNewPassword.value = "";
          setRecoveryHint("");
          forgotRecoveryStep?.setAttribute("hidden", "");
          forgotSuccessStep?.removeAttribute("hidden");
          return;
        }

        if (response.status === 422) {
          if (data.errors?.login?.[0]) {
            setFieldError("recoveryLogin", data.errors.login[0]);
          } else if (data.errors?.new_password?.[0]) {
            setFieldError("recoveryNewPassword", data.errors.new_password[0]);
          } else if (data.errors?.recovery_code?.[0]) {
            setFieldError("recoveryCodeInput", data.errors.recovery_code[0]);
          } else {
            setFieldError(
              "recoveryCodeInput",
              data.message ||
                "That recovery code is not valid, or it has already been used.",
            );
          }
          // The server answers a wrong code, a used code and a non-admin login
          // identically, so say plainly that a fresh code is the next step.
          setRecoveryHint("Try the next unused code on your saved list.");
          return;
        }

        setFieldError(
          "recoveryCodeInput",
          data.message || "Could not reset the password. Please try again.",
        );
      } catch {
        setFieldError(
          "recoveryCodeInput",
          "Cannot connect to server. Please try again.",
        );
      } finally {
        if (btnRedeemRecovery) btnRedeemRecovery.disabled = false;
        toggleLoader(false);
      }
    });
  }

  // ── Staff Account Request (public form, administrator approval) ────────────
  // Modelled on the forgot-password block above: the same open/close contract
  // with the body-scroll lock and the 120ms focus, the same floating-alert field
  // errors, and the same 429 / 503 / network branches. On success the page's own
  // `.success-modal` takes over, so no copy is written into the form itself.
  const requestAccountModal = document.getElementById("requestAccountModal");
  const requestAccountLink = document.getElementById("requestAccountLink");
  const requestCloseBtn = document.getElementById("requestCloseBtn");
  const requestBackToLogin = document.getElementById("requestBackToLogin");
  const requestAccountForm = document.getElementById("requestAccountForm");
  const requestName = document.getElementById("requestName");
  const btnSubmitAccountRequest = document.getElementById(
    "btnSubmitAccountRequest",
  );
  const requestSuccessModal = document.getElementById("requestSuccessModal");
  const requestSuccessEmail = document.getElementById("requestSuccessEmail");
  const requestSuccessContinueBtn = document.getElementById(
    "requestSuccessContinueBtn",
  );
  const REQUEST_TURNSTILE_ID = "requestAccountTurnstile";
  const requestTurnstileWidget = document.getElementById(REQUEST_TURNSTILE_ID);
  const requestTurnstileNote = document.getElementById("requestTurnstileNote");

  const REQUEST_FIELD_IDS = [
    "requestName",
    "requestUsername",
    "requestEmail",
    "requestPassword",
    "requestConfirmPassword",
  ];

  // Laravel answers with its own field names; each maps back onto the input that
  // produced it so a 422 message lands under the field it is about.
  const REQUEST_ERROR_FIELDS = {
    name: "requestName",
    username: "requestUsername",
    email: "requestEmail",
    password: "requestPassword",
  };
  const showRequestTurnstileNote = (message) => {
    if (!requestTurnstileNote) return;
    requestTurnstileNote.textContent = message || "";
    requestTurnstileNote.hidden = !message;
  };

  // The floating alert is fixed to the page rather than to the dialog, so every
  // message raised from inside this modal has to be taken down with it.
  const clearRequestErrors = () => {
    REQUEST_FIELD_IDS.forEach((id) => clearFieldError(id));
    showRequestTurnstileNote("");
    requestTurnstileWidget?.classList.remove("has-error");
    dropAlertMessage(REQUEST_TURNSTILE_ID);
  };

  // The card pins its head and foot and scrolls only the middle. Whether the
  // middle can scroll at all depends on the viewport, so the seam hairlines are
  // switched on here rather than in CSS: a card that fits shows none of them and
  // reads as one plain dialog, which is how it looks on every desktop.
  const requestPaneBox = requestAccountModal?.querySelector(".forgot-box");
  const requestPaneBody = requestAccountModal?.querySelector(".dlg-pane-body");

  const syncRequestPaneScroll = () => {
    if (!requestPaneBox || !requestPaneBody) return;
    // A 2px slack keeps sub-pixel rounding from flashing the hairlines on a
    // card that visually fits exactly.
    const overflows =
      requestPaneBody.scrollHeight - requestPaneBody.clientHeight > 2;
    requestPaneBox.classList.toggle("is-scrollable", overflows);
  };

  window.addEventListener("resize", () => {
    if (requestAccountModal?.classList.contains("show")) {
      syncRequestPaneScroll();
    }
  });

  const openRequestModal = (event) => {
    if (event) event.preventDefault();
    if (!requestAccountModal) return;

    clearRequestErrors();
    if (requestAccountForm) {
      clearFormErrors(requestAccountForm);
      requestAccountForm.reset();
    }

    requestAccountModal.classList.add("show");
    document.body.style.overflow = "hidden";
    setTimeout(() => requestName?.focus(), 120);
    syncRequestPaneScroll();
  };

  const closeRequestModal = () => {
    if (!requestAccountModal) return;
    requestAccountModal.classList.remove("show");
    document.body.style.overflow = "";
    clearRequestErrors();
  };

  requestAccountLink?.addEventListener("click", openRequestModal);
  requestCloseBtn?.addEventListener("click", closeRequestModal);
  requestBackToLogin?.addEventListener("click", (event) => {
    event.preventDefault();
    closeRequestModal();
  });

  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      requestAccountModal?.classList.contains("show")
    ) {
      closeRequestModal();
    }
  });
  // Typing in a field takes its own message down, the same courtesy the two
  // login fields already get.
  REQUEST_FIELD_IDS.forEach((inputId) => {
    const input = document.getElementById(inputId);
    input?.addEventListener("input", () => {
      if (input.value.trim()) clearFieldError(inputId);
    });
  });

  const showRequestSuccess = (email) => {
    if (requestSuccessEmail) {
      requestSuccessEmail.textContent = email || "your Gmail address";
    }
    if (!requestSuccessModal) return;

    requestSuccessModal.classList.add("show");
    document.body.style.overflow = "hidden";
    setTimeout(() => requestSuccessContinueBtn?.focus(), 120);
  };

  requestSuccessContinueBtn?.addEventListener("click", () => {
    requestSuccessModal?.classList.remove("show");
    document.body.style.overflow = "";
    document.getElementById("loginUser")?.focus();
  });
  if (requestAccountForm) {
    requestAccountForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearRequestErrors();
      clearFormErrors(requestAccountForm);

      const name = requestName?.value.trim() || "";
      const username =
        document.getElementById("requestUsername")?.value.trim() || "";
      const email = document.getElementById("requestEmail")?.value.trim() || "";
      const password = document.getElementById("requestPassword")?.value || "";
      const confirmation =
        document.getElementById("requestConfirmPassword")?.value || "";

      // Checked here as well as on the server so an obvious slip is answered
      // without a round trip; the API remains the authority either way.
      let hasError = false;

      if (!name) {
        setFieldError("requestName", "Please enter your full name.");
        hasError = true;
      }

      if (!username) {
        setFieldError("requestUsername", "Please choose a username.");
        hasError = true;
      } else if (!/^[A-Za-z0-9_-]{3,50}$/.test(username)) {
        setFieldError(
          "requestUsername",
          "Use 3 to 50 letters, numbers, dashes or underscores only.",
        );
        hasError = true;
      }

      if (!email) {
        setFieldError("requestEmail", "Please enter your Gmail address.");
        hasError = true;
      } else if (!/^[A-Za-z0-9._%+-]+@gmail\.com$/i.test(email)) {
        setFieldError(
          "requestEmail",
          "Please use a Gmail address, for example yourname@gmail.com.",
        );
        hasError = true;
      }
      if (!password) {
        setFieldError("requestPassword", "Please choose a password.");
        hasError = true;
      } else if (password.length < 8) {
        setFieldError(
          "requestPassword",
          "Password must be at least 8 characters long.",
        );
        hasError = true;
      }

      if (!confirmation) {
        setFieldError("requestConfirmPassword", "Please confirm your password.");
        hasError = true;
      } else if (password !== confirmation) {
        setFieldError(
          "requestConfirmPassword",
          "Password confirmation does not match.",
        );
        hasError = true;
      }

      if (hasError) {
        focusWithoutDismissing(
          requestAccountForm.querySelector(".input-wrapper.has-error input"),
        );
        return;
      }

      // Resolves to "" while Turnstile is switched off for this deployment, so
      // the payload simply carries no token and the middleware waves it through.
      let turnstileToken = "";
      try {
        turnstileToken =
          (await window.FMRC_TURNSTILE?.requireToken(REQUEST_TURNSTILE_ID)) ||
          "";
      } catch (error) {
        const message =
          error?.code === "TURNSTILE_UNAVAILABLE"
            ? "The security check could not be loaded. Refresh the page and try again."
            : PROMPT_COMPLETE;
        requestTurnstileWidget?.classList.add("has-error");
        showRequestTurnstileNote("");
        pushAlertMessage(REQUEST_TURNSTILE_ID, message, () =>
          requestTurnstileWidget?.scrollIntoView({
            block: "center",
            behavior: "smooth",
          }),
        );
        return;
      }
      toggleLoader(true);
      if (btnSubmitAccountRequest) btnSubmitAccountRequest.disabled = true;

      try {
        const payload = {
          name,
          username,
          email,
          password,
          password_confirmation: confirmation,
        };
        if (turnstileToken) {
          payload["cf-turnstile-response"] = turnstileToken;
        }

        const response = await fetch(`${API_BASE_URL}/staff-account-requests`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(payload),
        });

        const data = await response.json().catch(() => ({}));

        if (response.ok) {
          requestAccountForm.reset();
          closeRequestModal();
          showRequestSuccess(email);
          return;
        }
        if (response.status === 429) {
          const wait = Number(data.retry_after_seconds);
          const waitText =
            Number.isFinite(wait) && wait > 0
              ? ` Please try again in about ${Math.ceil(wait / 60)} minute(s).`
              : "";
          setFieldError(
            "requestEmail",
            `${
              data.message ||
              "Too many requests have been submitted from this connection."
            }${waitText}`,
          );
          return;
        }

        // The table ships as a hand-run install script, so a server where it has
        // not been created yet says so plainly instead of reporting an error.
        if (response.status === 503 || data.installed === false) {
          setFieldError(
            "requestEmail",
            data.message ||
              "Account requests are not enabled on this server yet. Please contact the FMRC office.",
          );
          return;
        }

        if (response.status === 422 && data.errors) {
          if (data.errors["cf-turnstile-response"]?.[0]) {
            requestTurnstileWidget?.classList.add("has-error");
            showRequestTurnstileNote(data.errors["cf-turnstile-response"][0]);
          }
          Object.entries(REQUEST_ERROR_FIELDS).forEach(([key, inputId]) => {
            const message = data.errors[key]?.[0];
            if (message) setFieldError(inputId, message);
          });
          focusWithoutDismissing(
            requestAccountForm.querySelector(".input-wrapper.has-error input"),
          );
          return;
        }

        setFieldError(
          "requestEmail",
          data.message ||
            "Your request could not be submitted. Please try again.",
        );
      } catch {
        setFieldError(
          "requestEmail",
          "Cannot connect to server. Please check your connection and try again.",
        );
      } finally {
        // A token is single-use, so the widget is re-armed for the next attempt.
        window.FMRC_TURNSTILE?.reset(REQUEST_TURNSTILE_ID);
        if (btnSubmitAccountRequest) btnSubmitAccountRequest.disabled = false;
        toggleLoader(false);
      }
    });
  }
});


