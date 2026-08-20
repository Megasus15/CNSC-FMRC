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

  const getTurnstileToken = async (widgetId) => {
    if (typeof window.FMRC_TURNSTILE?.requireToken !== "function") return "";
    return window.FMRC_TURNSTILE.requireToken(widgetId);
  };

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

  const setFieldError = (inputId, message) => {
    const input = document.getElementById(inputId);
    if (!input) return;

    const wrapper = input.closest(".input-wrapper");
    if (!wrapper) return;

    let bubble = wrapper.querySelector(".field-error-bubble");
    if (!bubble) {
      bubble = document.createElement("div");
      bubble.className = "field-error-bubble";
      bubble.setAttribute("role", "alert");
      wrapper.appendChild(bubble);
    }

    bubble.textContent = message;
    wrapper.classList.add("has-error");
    input.setAttribute("aria-invalid", "true");
  };

  const clearFieldError = (inputId) => {
    const input = document.getElementById(inputId);
    if (!input) return;

    const wrapper = input.closest(".input-wrapper");
    if (!wrapper) return;

    wrapper.classList.remove("has-error");
    input.removeAttribute("aria-invalid");
  };

  const clearFormErrors = (form) => {
    form.querySelectorAll(".input-wrapper").forEach((wrapper) => {
      wrapper.classList.remove("has-error");
      const input = wrapper.querySelector("input");
      if (input) {
        input.removeAttribute("aria-invalid");
      }
    });
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
        if (firstErrorInput) firstErrorInput.focus();
        return;
      }

      let turnstileToken = "";
      try {
        turnstileToken = await getTurnstileToken("adminLoginTurnstile");
      } catch (turnstileError) {
        showStatus(turnstileError.message || "Please complete the security check.");
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
        } else {
          window.FMRC_TURNSTILE?.reset("adminLoginTurnstile");
          if (response.status === 422 && data.errors) {
            if (data.errors["cf-turnstile-response"]?.[0]) {
              showStatus(data.errors["cf-turnstile-response"][0]);
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
        }
      } catch {
        window.FMRC_TURNSTILE?.reset("adminLoginTurnstile");
        setFieldError(
          "loginUser",
          "Cannot connect to server. Ensure Laravel is running (php artisan serve).",
        );
      } finally {
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
});


