document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("loginForm");
  const signupForm = document.getElementById("signupForm");
  const openSignupFromLogin = document.getElementById("openSignupFromLogin");
  const openLoginFromSignup = document.getElementById("openLoginFromSignup");

  const signupSuccessModal = document.getElementById("signupSuccessModal");
  const successContinueBtn = document.getElementById("successContinueBtn");

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

  const showLogin = () => {
    loginForm.classList.add("active");
    signupForm.classList.remove("active");
    clearFormErrors(signupForm);
  };

  const showSignup = () => {
    signupForm.classList.add("active");
    loginForm.classList.remove("active");
    clearFormErrors(loginForm);
  };

  openSignupFromLogin.addEventListener("click", showSignup);
  openLoginFromSignup.addEventListener("click", showLogin);

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

      // Swap the SVG inside the button
      toggleBtn.innerHTML = isPassword ? eyeClosedSVG : eyeOpenSVG;
      toggleBtn.setAttribute(
        "aria-label",
        isPassword ? "Hide password" : "Show password",
      );
    });
  });

  // Live validation feedback while typing.
  [
    "loginUser",
    "loginPass",
    "signupUser",
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

  // Handle Signup Submit
  signupForm.addEventListener("submit", (event) => {
    event.preventDefault();

    clearFormErrors(signupForm);

    const user = document.getElementById("signupUser").value.trim();
    const pass = document.getElementById("signupPass").value;
    const confirm = document.getElementById("signupConfirm").value;

    let hasError = false;

    if (!user) {
      setFieldError(
        "signupUser",
        "Please enter your email or username so we know who this account is for.",
      );
      hasError = true;
    } else if (user.length < 4) {
      setFieldError(
        "signupUser",
        "Username or email is too short. Please enter at least 4 characters.",
      );
      hasError = true;
    }

    if (!pass) {
      setFieldError(
        "signupPass",
        "Password is required. Please create a secure password.",
      );
      hasError = true;
    } else if (pass.length < 8) {
      setFieldError(
        "signupPass",
        "Password is too short. Use at least 8 characters.",
      );
      hasError = true;
    }

    if (!confirm) {
      setFieldError(
        "signupConfirm",
        "Please confirm your password by typing it again.",
      );
      hasError = true;
    } else if (pass && pass !== confirm) {
      setFieldError(
        "signupConfirm",
        "The confirmation password does not match your password.",
      );
      hasError = true;
    }

    if (hasError) {
      const firstErrorInput = signupForm.querySelector(".input-wrapper.has-error input");
      if (firstErrorInput) firstErrorInput.focus();
      return;
    }

    signupSuccessModal.classList.add("show");
    document.body.style.overflow = "hidden";
    signupForm.reset();
    clearFormErrors(signupForm);
  });

  // Handle Modal Continue
  successContinueBtn.addEventListener("click", () => {
    signupSuccessModal.classList.remove("show");
    document.body.style.overflow = "";
    showLogin();
  });

  // Close modal on background click
  signupSuccessModal.addEventListener("click", (event) => {
    if (event.target === signupSuccessModal) {
      signupSuccessModal.classList.remove("show");
      document.body.style.overflow = "";
      showLogin();
    }
  });

  // Handle Login Submit
  loginForm.addEventListener("submit", (event) => {
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
      const firstErrorInput = loginForm.querySelector(".input-wrapper.has-error input");
      if (firstErrorInput) firstErrorInput.focus();
      return;
    }

    // Design-only routing to dashboard placeholder page.
    window.location.href = "../admin-page/dashboard.html";
  });
});
