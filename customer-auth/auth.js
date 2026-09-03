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
  const signupForm = document.getElementById("signupForm");
  const openSignupFromLogin = document.getElementById("openSignupFromLogin");
  const openLoginFromSignup = document.getElementById("openLoginFromSignup");
  const signupSuccessModal = document.getElementById("signupSuccessModal");
  const successContinueBtn = document.getElementById("successContinueBtn");
  const authStatusModal = document.getElementById("authStatusModal");
  const authStatusText = document.getElementById("authStatusText");
  const authTitle = document.querySelector(".auth-title");
  const authCaption = document.querySelector(".auth-caption");

  const getTurnstileToken = async (widgetId) => {
    if (typeof window.FMRC_TURNSTILE?.requireToken !== "function") return "";
    return window.FMRC_TURNSTILE.requireToken(widgetId);
  };

  // ── Cloudflare security-check gate ─────────────────────────────────────────
  // A message about the security check belongs under the widget it is about, not
  // pinned to the username field, which was never the problem. Each slot owns
  // its own note element and locks its own form's submit button; the page has
  // two forms, so the gate is a factory over a widget id rather than the single
  // set of module-level helpers the admin portal uses.
  const TURNSTILE_PROMPTS = {
    complete: "Please complete the security check before continuing.",
    expired: "The security check expired. Please complete it again.",
    failed:
      "The security check could not be completed. Refresh the page and try again.",
    unavailable:
      "The security check could not be loaded. Refresh the page and try again.",
  };

  const createTurnstileGate = (widgetId, noteId, form) => {
    const widget = document.getElementById(widgetId);
    const note = document.getElementById(noteId);
    const submitBtn = form?.querySelector('button[type="submit"]');
    let required = false;

    const showNote = (message) => {
      if (!note) return;
      note.textContent = message || "";
      note.hidden = !message;
    };

    const setSubmitLocked = (locked) => {
      if (!submitBtn) return;
      submitBtn.disabled = locked;
      submitBtn.setAttribute("aria-disabled", locked ? "true" : "false");
    };

    // Only re-lock while the challenge is actually in play — with Turnstile
    // switched off server-side the button has to stay usable.
    const lockUntilSolved = (message) => {
      if (!required) return;
      setSubmitLocked(true);
      showNote(message);
    };

    // Same re-lock after a submit, but keeps a message the API already produced
    // (for example a 422 from a token Cloudflare rejected) instead of it.
    const relockAfterAttempt = () => {
      if (!required) return;
      setSubmitLocked(true);
      if (!note || note.hidden) showNote(TURNSTILE_PROMPTS.complete);
    };

    const revealChallenge = () => {
      widget?.scrollIntoView({ block: "center", behavior: "smooth" });
    };

    // Used when a submit is blocked. The message joins the floating alert so the
    // security check reports through the same surface as the fields, and the slot
    // is ringed so it is still obvious which control is being asked for. The
    // inline note is cleared first so the same sentence is not shown twice.
    const focusChallenge = (message) => {
      setSubmitLocked(true);
      showNote("");
      widget?.classList.add("has-error");
      pushAlertMessage(widgetId, message, revealChallenge);
      revealChallenge();
    };

    const init = async () => {
      const api = window.FMRC_TURNSTILE;
      if (!widget || typeof api?.ready !== "function") return;

      const state = await api
        .ready()
        .catch(() => ({ enabled: false, error: true }));

      if (!state?.enabled) {
        if (state?.error) {
          setSubmitLocked(true);
          showNote(TURNSTILE_PROMPTS.unavailable);
        }
        return;
      }

      required = true;
      lockUntilSolved(TURNSTILE_PROMPTS.complete);
      widget.addEventListener("fmrc:turnstile-token", () => {
        setSubmitLocked(false);
        showNote("");
        widget.classList.remove("has-error");
        dropAlertMessage(widgetId);
      });
      widget.addEventListener("fmrc:turnstile-expired", () =>
        lockUntilSolved(TURNSTILE_PROMPTS.expired),
      );
      widget.addEventListener("fmrc:turnstile-error", () =>
        lockUntilSolved(TURNSTILE_PROMPTS.failed),
      );
    };

    void init();

    return { showNote, focusChallenge, relockAfterAttempt };
  };

  const loginTurnstileGate = createTurnstileGate(
    "loginTurnstile",
    "loginTurnstileNote",
    loginForm,
  );
  const signupTurnstileGate = createTurnstileGate(
    "signupTurnstile",
    "signupTurnstileNote",
    signupForm,
  );

  const setHeroText = (title, caption) => {
    if (authTitle) authTitle.textContent = title;
    if (authCaption) authCaption.textContent = caption;
  };

  /* Was a white scrim with a rotating ring; now it raises the site-wide
     UCN-FMRC curtain, whose mark is the same tile as the `.portal-mark` beside
     this form. The name and the `(true)` / `(false)` calling convention are kept
     exactly as they were so every call site below is untouched apart from the
     one line of wording each now passes.

     `caption` is optional: an older call that passes nothing still gets a
     curtain, just a generically worded one. Written with `?.` so a page where
     fmrc-loader.js failed to arrive silently keeps today's behaviour — the
     submit button is disabled either way — instead of throwing inside a
     request. */
  const toggleLoader = (show, caption) => {
    if (show) window.FMRCLoader?.show(caption || "Just a moment");
    else window.FMRCLoader?.hide();
  };

  const showStatus = (message) => {
    if (!authStatusModal || !authStatusText) return;
    authStatusText.textContent = message;
    authStatusModal.classList.add("show");
  };

  const hideStatus = () => {
    authStatusModal?.classList.remove("show");
  };

  // ── Maintenance Mode notices ──────────────────────────────────────────────
  // A 503 from the server means the admin has taken customer sign-up or sign-in
  // offline. That is not a problem with anything the visitor typed, so it must
  // not render as a field error under the username box. maintenance-gate.js owns
  // the dialog (it is loaded just before this file); showStatus is the fallback
  // if the gate script ever fails to load.
  const showMaintenanceNotice = (text) => {
    const msg =
      (text || "").trim() ||
      "This service is temporarily unavailable for maintenance.";
    hideStatus();
    try {
      if (typeof window.FMRC_MAINTENANCE?.notify === "function") {
        window.FMRC_MAINTENANCE.notify(msg);
        return;
      }
    } catch {
      /* fall through to the status modal */
    }
    showStatus(msg);
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

  const showLogin = (event) => {
    if (event) event.preventDefault();
    setHeroText("Welcome Back", "UCN-FMRC Customer Portal");
    loginForm.style.display = "";
    loginForm.classList.add("active");
    signupForm.style.display = "none";
    signupForm.classList.remove("active");
    clearFormErrors(signupForm);
  };

  const showSignup = (event) => {
    if (event) event.preventDefault();
    setHeroText("Create Your Pass", "Join the UCN-FMRC customer portal");
    signupForm.style.display = "";
    signupForm.classList.add("active");
    loginForm.style.display = "none";
    loginForm.classList.remove("active");
    clearFormErrors(loginForm);
  };

  openSignupFromLogin?.addEventListener("click", showSignup);
  openLoginFromSignup?.addEventListener("click", showLogin);

  const initialHash = (window.location.hash || "").toLowerCase();
  if (initialHash === "#signup") {
    showSignup();
  } else {
    showLogin();
  }

  const eyeOpenSvg =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
  const eyeClosedSvg =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';

  document.querySelectorAll(".toggle-pass").forEach((toggleBtn) => {
    toggleBtn.addEventListener("click", () => {
      const targetId = toggleBtn.getAttribute("data-target");
      const input = targetId ? document.getElementById(targetId) : null;
      if (!input) return;

      const isPassword = input.type === "password";
      input.type = isPassword ? "text" : "password";
      // CORRECTED: showing password → open eye; hiding → closed eye
      toggleBtn.innerHTML = isPassword ? eyeOpenSvg : eyeClosedSvg;
      toggleBtn.setAttribute(
        "aria-label",
        isPassword ? "Hide password" : "Show password",
      );
    });
  });

  [
    "loginUser",
    "loginPass",
    "signupName",
    "signupUser",
    "signupEmail",
    "signupPass",
    "signupConfirm",
  ].forEach((inputId) => {
    const input = document.getElementById(inputId);
    if (!input) return;

    input.addEventListener("input", () => {
      if (input.value.trim()) {
        clearFieldError(inputId);
      }
    });
  });

  const mapLaravelSignupErrors = (errors) => {
    if (!errors) return;
    if (errors.name?.[0]) setFieldError("signupName", errors.name[0]);
    if (errors.username?.[0]) setFieldError("signupUser", errors.username[0]);
    if (errors.email?.[0]) setFieldError("signupEmail", errors.email[0]);
    if (errors.password?.[0]) setFieldError("signupPass", errors.password[0]);
  };

  if (signupForm) {
    signupForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      hideStatus();
      clearFormErrors(signupForm);

      const name = document.getElementById("signupName").value.trim();
      const username = document.getElementById("signupUser").value.trim();
      const email = document.getElementById("signupEmail").value.trim();
      const password = document.getElementById("signupPass").value;
      const passwordConfirmation =
        document.getElementById("signupConfirm").value;

      let hasError = false;

      if (!name) {
        setFieldError("signupName", "Full name is required.");
        hasError = true;
      } else if (!/^[A-Za-z][A-Za-z\s.'-]{1,}$/.test(name)) {
        setFieldError("signupName", "Full name must contain letters only.");
        hasError = true;
      }

      if (!username) {
        setFieldError("signupUser", "Username is required.");
        hasError = true;
      } else if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
        setFieldError(
          "signupUser",
          "Username must be 3-20 characters and use only letters, numbers, or underscores.",
        );
        hasError = true;
      }

      if (!email) {
        setFieldError("signupEmail", "Gmail address is required.");
        hasError = true;
      } else if (!/^[A-Za-z0-9._%+-]+@gmail\.com$/i.test(email)) {
        setFieldError(
          "signupEmail",
          "Email must be a valid @gmail.com address.",
        );
        hasError = true;
      }

      if (!password) {
        setFieldError("signupPass", "Password is required.");
        hasError = true;
      } else if (password.length < 8) {
        setFieldError("signupPass", "Password must be at least 8 characters.");
        hasError = true;
      } else if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
        setFieldError(
          "signupPass",
          "Password must include at least one letter and one number.",
        );
        hasError = true;
      }

      if (!passwordConfirmation) {
        setFieldError("signupConfirm", "Please confirm your password.");
        hasError = true;
      } else if (password !== passwordConfirmation) {
        setFieldError("signupConfirm", "Confirm password does not match.");
        hasError = true;
      }

      if (hasError) return;

      let turnstileToken = "";
      try {
        turnstileToken = await getTurnstileToken("signupTurnstile");
      } catch (error) {
        signupTurnstileGate.focusChallenge(
          error?.code === "TURNSTILE_UNAVAILABLE"
            ? TURNSTILE_PROMPTS.unavailable
            : error?.message || TURNSTILE_PROMPTS.complete,
        );
        return;
      }

      toggleLoader(true, "Creating your account");
      try {
        const response = await fetch(`${API_BASE_URL}/register`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            name,
            username,
            email,
            password,
            password_confirmation: passwordConfirmation,
            "cf-turnstile-response": turnstileToken,
          }),
        });

        const data = await response.json();

        if (response.ok) {
          signupSuccessModal.classList.add("show");
          document.body.style.overflow = "hidden";
          signupForm.reset();
        } else if (response.status === 503 && data.maintenance) {
          // Maintenance Mode: an outage notice does not belong under a field.
          showMaintenanceNotice(data.message);
        } else if (response.status === 422) {
          const errors = data.errors || {};
          // A rejected token is the widget's problem, not the username's.
          if (errors["cf-turnstile-response"]?.[0]) {
            signupTurnstileGate.showNote(errors["cf-turnstile-response"][0]);
          }
          mapLaravelSignupErrors(errors);
        } else if (data.message) {
          setFieldError("signupUser", data.message);
        } else {
          setFieldError(
            "signupUser",
            "Registration failed. Please check your details.",
          );
        }
      } catch {
        setFieldError(
          "signupName",
          "Cannot connect to server. Ensure Laravel is running.",
        );
      } finally {
        window.FMRC_TURNSTILE?.reset("signupTurnstile");
        // The token was single-use: re-lock so the next attempt has to pass a
        // fresh challenge (Cloudflare reissues one on its own when the widget is
        // not interactive).
        signupTurnstileGate.relockAfterAttempt();
        toggleLoader(false);
      }
    });
  }

  successContinueBtn?.addEventListener("click", () => {
    signupSuccessModal.classList.remove("show");
    document.body.style.overflow = "";
    showLogin();
  });

  if (loginForm) {
    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      hideStatus();
      clearFormErrors(loginForm);

      const login = document.getElementById("loginUser").value.trim();
      const password = document.getElementById("loginPass").value;

      let hasError = false;

      if (!login) {
        setFieldError("loginUser", "Email or username is required.");
        hasError = true;
      }

      if (!password) {
        setFieldError("loginPass", "Password is required.");
        hasError = true;
      }

      if (hasError) return;

      let turnstileToken = "";
      try {
        turnstileToken = await getTurnstileToken("loginTurnstile");
      } catch (error) {
        loginTurnstileGate.focusChallenge(
          error?.code === "TURNSTILE_UNAVAILABLE"
            ? TURNSTILE_PROMPTS.unavailable
            : error?.message || TURNSTILE_PROMPTS.complete,
        );
        return;
      }

      toggleLoader(true, "Signing you in");
      try {
        const response = await fetch(`${API_BASE_URL}/customer/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            login,
            password,
            "cf-turnstile-response": turnstileToken,
          }),
        });

        const data = await response.json();

        if (response.ok) {
          if (data.user.role !== "customer") {
            setFieldError(
              "loginUser",
              "Admins and Staff must use the Admin/Staff login portal.",
            );
            return;
          }

          localStorage.setItem("customer_token", data.access_token);
          if (data.user) {
            data.user.has_custom_password = true;
          }
          localStorage.setItem("customer_info", JSON.stringify(data.user));
          localStorage.setItem("customer_auth_method", "password");
          showStatus("Login successful. Redirecting to your account...");
          window.location.href = "../home-page/main.html";
          return;
        }

        if (response.status === 503 && data.maintenance) {
          // Maintenance Mode: an outage notice does not belong under a field.
          showMaintenanceNotice(data.message);
          return;
        }

        if (response.status === 422 && data.errors) {
          // A rejected token is the widget's problem, not the username's.
          if (data.errors["cf-turnstile-response"]?.[0])
            loginTurnstileGate.showNote(data.errors["cf-turnstile-response"][0]);
          if (data.errors.login?.[0])
            setFieldError("loginUser", data.errors.login[0]);
          if (data.errors.password?.[0])
            setFieldError("loginPass", data.errors.password[0]);
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
          "Cannot connect to server. Ensure Laravel is running.",
        );
      } finally {
        window.FMRC_TURNSTILE?.reset("loginTurnstile");
        // The token was single-use: re-lock so the next attempt has to pass a
        // fresh challenge (Cloudflare reissues one on its own when the widget is
        // not interactive).
        loginTurnstileGate.relockAfterAttempt();
        toggleLoader(false);
      }
    });
  }



  // ── OTP-based Forgot Password Flow ──
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
        : `<strong>5-Attempt Limit Reached:</strong> Please wait <strong>${timeStr}</strong> before requesting another OTP for this Gmail.`;
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
    forgotSuccessStep?.setAttribute("hidden", "");

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
  };

  forgotPasswordLink?.addEventListener("click", openForgotModal);
  forgotCloseBtn?.addEventListener("click", closeForgotModal);

  forgotDoneBtn?.addEventListener("click", () => {
    closeForgotModal();
    if (openLoginFromSignup) openLoginFromSignup.click();
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
        setFieldError("forgotEmail", "Gmail address is required.");
        return;
      }
      if (!/^[A-Za-z0-9._%+-]+@gmail\.com$/i.test(email)) {
        setFieldError("forgotEmail", "Please enter a valid @gmail.com address.");
        return;
      }

      toggleLoader(true, "Sending your code");
      try {
        const response = await fetch(`${API_BASE_URL}/forgot-password/send-otp`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ email, portal: "customer" }),
        });

        const data = await response.json().catch(() => ({}));

        if (response.status === 429) {
          // Locked out due to 5-attempt limit
          showLockoutAlert(data.remaining_seconds || 600, data.message);
          return;
        }

        if (response.status === 403 || response.status === 404) {
          setFieldError(
            "forgotEmail",
            data.message || "We could not find a customer account registered with that Gmail.",
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
    toggleLoader(true, "Sending a new code");

    try {
      const response = await fetch(`${API_BASE_URL}/forgot-password/resend-otp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ email: currentOtpEmail, portal: "customer" }),
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
        showStatus("A new 6-digit OTP has been sent to your Gmail!");
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

      toggleLoader(true, "Updating your password");
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
            portal: "customer",
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

  // ── Google Sign-In Integration (Google Identity Services OAuth 2.0) ──
  const GOOGLE_CLIENT_ID = "55704463190-43888rtrprqlb7drpkmq52h5bhpr5p9u.apps.googleusercontent.com";
  let googleTokenClient = null;

  const processGoogleAuthPayload = async (payload) => {
    toggleLoader(true, "Signing you in");
    hideStatus();
    try {
      const res = await fetch(`${API_BASE_URL}/auth/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (res.ok) {
        if (data.user && data.user.role !== "customer") {
          const isLogin = loginForm?.classList.contains("active");
          setFieldError(
            isLogin ? "loginUser" : "signupName",
            "Staff and Admin accounts must use the admin login portal.",
          );
          return;
        }

        localStorage.setItem("customer_token", data.access_token);
        if (data.user) {
          // The server is the source of truth for this state. Do not infer a
          // Google account or password status from the email address or this browser.
          data.user.signed_with_google = data.user.signed_with_google === true;
          data.user.has_custom_password = data.user.has_custom_password === true;
        }
        localStorage.setItem("customer_info", JSON.stringify(data.user));
        localStorage.setItem("customer_auth_method", "google");
        showStatus("Signed in with Google! Redirecting to your account...");
        setTimeout(() => {
          window.location.href = "../home-page/main.html";
        }, 400);
        return;
      }

      if (res.status === 503 && data.maintenance) {
        // Maintenance Mode: an outage notice does not belong under a field.
        showMaintenanceNotice(data.message);
        return;
      }

      const errorMessage = data.message || "Google sign-in failed. Please try again.";
      const isLogin = loginForm?.classList.contains("active");
      if (isLogin) {
        setFieldError("loginUser", errorMessage);
      } else {
        setFieldError("signupName", errorMessage);
      }
    } catch {
      const isLogin = loginForm?.classList.contains("active");
      setFieldError(
        isLogin ? "loginUser" : "signupName",
        "Cannot connect to server for Google Sign-In. Please try again.",
      );
    } finally {
      toggleLoader(false);
    }
  };

  const handleGoogleCredentialResponse = async (response) => {
    if (!response || !response.credential) return;
    await processGoogleAuthPayload({ id_token: response.credential });
  };

  const handleGoogleTokenResponse = async (tokenResponse) => {
    if (tokenResponse.error) {
      console.warn("Google OAuth Error:", tokenResponse.error);
      return;
    }
    if (!tokenResponse.access_token) return;
    await processGoogleAuthPayload({ access_token: tokenResponse.access_token });
  };

  const initGoogleAuth = () => {
    if (typeof window.google === "undefined" || !window.google.accounts) {
      setTimeout(initGoogleAuth, 200);
      return;
    }

    try {
      // 1. Initialize Token Client for instant browser popup on click
      if (window.google.accounts.oauth2) {
        googleTokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: "openid email profile",
          callback: handleGoogleTokenResponse,
        });
      }

      // 2. Initialize ID token provider
      if (window.google.accounts.id) {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleGoogleCredentialResponse,
          auto_select: false,
          cancel_on_tap_outside: true,
        });
      }

      // Attach click listeners to both Login & Signup Google buttons
      document.querySelectorAll(".google-auth-btn").forEach((btn) => {
        btn.onclick = (e) => {
          e.preventDefault();
          hideStatus();
          if (loginForm) clearFormErrors(loginForm);
          if (signupForm) clearFormErrors(signupForm);

          if (googleTokenClient) {
            googleTokenClient.requestAccessToken({ prompt: "" });
          } else if (window.google?.accounts?.id) {
            window.google.accounts.id.prompt();
          }
        };
      });
    } catch (e) {
      console.warn("Google Auth Init Error:", e);
    }
  };

  initGoogleAuth();
});
