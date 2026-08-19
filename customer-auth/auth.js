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
              "Admins and cashiers must use the admin login page.",
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

  /* ---------- Forgot Password ---------- */
  const forgotPasswordLink = document.getElementById("forgotPasswordLink");
  const forgotPasswordModal = document.getElementById("forgotPasswordModal");
  const forgotForm = document.getElementById("forgotForm");
  const forgotEmail = document.getElementById("forgotEmail");
  const forgotCloseBtn = document.getElementById("forgotCloseBtn");
  const forgotBackToLogin = document.getElementById("forgotBackToLogin");
  const forgotDoneBtn = document.getElementById("forgotDoneBtn");
  const forgotRequestStep = document.getElementById("forgotRequestStep");
  const forgotSentStep = document.getElementById("forgotSentStep");
  const forgotSentEmail = document.getElementById("forgotSentEmail");

  const openForgotModal = (event) => {
    if (event) event.preventDefault();
    if (!forgotPasswordModal) return;
    // Always start on the request step
    forgotRequestStep?.removeAttribute("hidden");
    forgotSentStep?.setAttribute("hidden", "");
    clearFieldError("forgotEmail");
    if (forgotEmail) forgotEmail.value = "";
    forgotPasswordModal.classList.add("show");
    document.body.style.overflow = "hidden";
    setTimeout(() => forgotEmail?.focus(), 120);
  };

  const closeForgotModal = () => {
    if (!forgotPasswordModal) return;
    forgotPasswordModal.classList.remove("show");
    document.body.style.overflow = "";
  };

  forgotPasswordLink?.addEventListener("click", openForgotModal);
  forgotCloseBtn?.addEventListener("click", closeForgotModal);
  forgotDoneBtn?.addEventListener("click", closeForgotModal);

  forgotBackToLogin?.addEventListener("click", (event) => {
    event.preventDefault();
    closeForgotModal();
  });

  // Close when clicking the dark backdrop (outside the box)
  forgotPasswordModal?.addEventListener("click", (event) => {
    if (event.target === forgotPasswordModal) closeForgotModal();
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

  // Clear error while typing
  forgotEmail?.addEventListener("input", () => {
    if (forgotEmail.value.trim()) clearFieldError("forgotEmail");
  });

  if (forgotForm) {
    forgotForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearFieldError("forgotEmail");

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
        // Ask the Laravel backend to email a real reset link.
        const response = await fetch(
          `${API_BASE_URL}/forgot-password`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({ email }),
          },
        );

        if (response.status === 422) {
          const data = await response.json().catch(() => ({}));
          setFieldError(
            "forgotEmail",
            data.errors?.email?.[0] ||
              data.message ||
              "Please enter a valid email address.",
          );
          return;
        }

        // For security the backend always returns the same generic message,
        // whether or not the email exists — so we always show confirmation.
        if (forgotSentEmail) forgotSentEmail.textContent = email;
        forgotRequestStep?.setAttribute("hidden", "");
        forgotSentStep?.removeAttribute("hidden");
      } catch {
        setFieldError(
          "forgotEmail",
          "Cannot connect to server. Ensure Laravel is running.",
        );
      } finally {
        toggleLoader(false);
      }
    });
  }

  // ── Google Sign-In Integration (Google Identity Services) ──
  const GOOGLE_CLIENT_ID = "55704463190-43888rtrprqlb7drpkmq52h5bhpr5p9u.apps.googleusercontent.com";

  const handleGoogleCredentialResponse = async (response) => {
    if (!response || !response.credential) {
      showStatus("Google authentication did not return a credential.");
      return;
    }

    toggleLoader(true);
    hideStatus();
    try {
      const res = await fetch(`${API_BASE_URL}/auth/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ id_token: response.credential }),
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
        }, 300);
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

  const initGoogleAuth = () => {
    if (typeof window.google === "undefined" || !window.google.accounts || !window.google.accounts.id) {
      setTimeout(initGoogleAuth, 300);
      return;
    }

    try {
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleCredentialResponse,
        auto_select: false,
        cancel_on_tap_outside: true,
      });

      const hiddenContainer = document.getElementById("googleHiddenBtnContainer");
      if (hiddenContainer) {
        window.google.accounts.id.renderButton(hiddenContainer, {
          theme: "outline",
          size: "large",
          type: "standard",
        });
      }

      document.querySelectorAll(".google-auth-btn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          hideStatus();
          if (loginForm) clearFormErrors(loginForm);
          if (signupForm) clearFormErrors(signupForm);

          const hiddenBtn = hiddenContainer?.querySelector('div[role="button"]');
          if (hiddenBtn) {
            hiddenBtn.click();
          } else {
            window.google.accounts.id.prompt();
          }
        });
      });
    } catch (e) {
      console.warn("Google Auth Init Warning:", e);
    }
  };

  initGoogleAuth();
});
