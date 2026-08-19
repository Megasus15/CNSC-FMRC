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

  const setHeroText = (title, caption) => {
    if (authTitle) authTitle.textContent = title;
    if (authCaption) authCaption.textContent = caption;
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

  const hideStatus = () => {
    authStatusModal?.classList.remove("show");
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

      toggleLoader(true);
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
          }),
        });

        const data = await response.json();

        if (response.ok) {
          signupSuccessModal.classList.add("show");
          document.body.style.overflow = "hidden";
          signupForm.reset();
        } else if (response.status === 422) {
          mapLaravelSignupErrors(data.errors || {});
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

      toggleLoader(true);
      try {
        const response = await fetch(`${API_BASE_URL}/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ login, password }),
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
          localStorage.setItem("customer_info", JSON.stringify(data.user));
          showStatus("Login successful. Redirecting to your account...");
          window.location.href = "../home-page/main.html";
          return;
        }

        if (response.status === 422 && data.errors) {
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

      toggleLoader(true);
      try {
        const response = await fetch(`${API_BASE_URL}/forgot-password/send-otp`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ email }),
        });

        const data = await response.json().catch(() => ({}));

        if (response.status === 429) {
          // Locked out due to 5-attempt limit
          showLockoutAlert(data.remaining_seconds || 600, data.message);
          return;
        }

        if (response.status === 404) {
          setFieldError(
            "forgotEmail",
            data.message || "We could not find an account registered with that Gmail.",
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
        body: JSON.stringify({ email: currentOtpEmail }),
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
          }),
        });

        const data = await response.json().catch(() => ({}));

        if (response.ok) {
          forgotVerifyStep?.setAttribute("hidden", "");
          forgotSuccessStep?.removeAttribute("hidden");
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
    toggleLoader(true);
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
        localStorage.setItem("customer_info", JSON.stringify(data.user));
        showStatus("Signed in with Google! Redirecting to your account...");
        setTimeout(() => {
          window.location.href = "../home-page/main.html";
        }, 400);
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
