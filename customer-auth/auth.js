document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("loginForm");
  const signupForm = document.getElementById("signupForm");
  const openSignupFromLogin = document.getElementById("openSignupFromLogin");
  const openLoginFromSignup = document.getElementById("openLoginFromSignup");
  const signupSuccessModal = document.getElementById("signupSuccessModal");
  const successContinueBtn = document.getElementById("successContinueBtn");
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
    loginForm.style.display = "";
    loginForm.classList.add("active");
    signupForm.style.display = "none";
    signupForm.classList.remove("active");
    clearFormErrors(signupForm);
  };

  const showSignup = (event) => {
    if (event) event.preventDefault();
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
      toggleBtn.setAttribute("aria-label", isPassword ? "Hide password" : "Show password");
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
      const passwordConfirmation = document.getElementById("signupConfirm").value;

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
        setFieldError("signupEmail", "Email must be a valid @gmail.com address.");
        hasError = true;
      }

      if (!password) {
        setFieldError("signupPass", "Password is required.");
        hasError = true;
      } else if (password.length < 8) {
        setFieldError("signupPass", "Password must be at least 8 characters.");
        hasError = true;
      } else if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
        setFieldError("signupPass", "Password must include at least one letter and one number.");
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
        const response = await fetch("http://127.0.0.1:8000/api/register", {
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
          setFieldError("signupUser", "Registration failed. Please check your details.");
        }
      } catch {
        setFieldError("signupName", "Cannot connect to server. Ensure Laravel is running.");
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

  signupSuccessModal?.addEventListener("click", (event) => {
    if (event.target === signupSuccessModal) {
      signupSuccessModal.classList.remove("show");
      document.body.style.overflow = "";
      showLogin();
    }
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
        const response = await fetch("http://127.0.0.1:8000/api/login", {
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
            setFieldError("loginUser", "Admins and cashiers must use the admin login page.");
            return;
          }

          localStorage.setItem("customer_token", data.access_token);
          localStorage.setItem("customer_info", JSON.stringify(data.user));
          showStatus("Login successful. Redirecting to your account...");
          window.location.href = "../home-page/main.html";
          return;
        }

        if (response.status === 422 && data.errors) {
          if (data.errors.login?.[0]) setFieldError("loginUser", data.errors.login[0]);
          if (data.errors.password?.[0]) setFieldError("loginPass", data.errors.password[0]);
        } else if (data.message && /invalid|incorrect|credentials/i.test(data.message)) {
          setFieldError("loginPass", "Password is incorrect.");
        } else {
          setFieldError("loginUser", data.message || "Unable to log in with the provided details.");
        }
      } catch {
        setFieldError("loginUser", "Cannot connect to server. Ensure Laravel is running.");
      } finally {
        toggleLoader(false);
      }
    });
  }
});
