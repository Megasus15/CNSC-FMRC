document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("loginForm");
  const authStatusModal = document.getElementById("authStatusModal");
  const authStatusText = document.getElementById("authStatusText");

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

      toggleLoader(true);
      try {
        const response = await fetch("http://127.0.0.1:8000/api/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            login: user,
            password: pass,
          }),
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
          } else if (data.user.role === "cashier") {
            window.location.href = "../cashier-page/dashboard.html";
          } else {
            setFieldError(
              "loginUser",
              "Unauthorized access. This area is for Admin/Cashier/Staff only.",
            );
          }
        } else if (response.status === 422 && data.errors) {
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
        toggleLoader(false);
      }
    });
  }

  // ── Forgot Password flow ──────────────────────────────────────────────
  // Reuses the same Laravel backend endpoint as the customer portal. The
  // backend looks the account up by email, so admins are covered too.
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
          "http://127.0.0.1:8000/api/forgot-password",
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
});


