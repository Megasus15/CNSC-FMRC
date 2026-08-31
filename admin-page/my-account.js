(() => {
  document.addEventListener("DOMContentLoaded", () => {
    const emailInput = document.getElementById("emailInput");
    const currentPasswordInput = document.getElementById("currentPassword");
    const newPasswordInput = document.getElementById("newPassword");
    const confirmPasswordInput = document.getElementById("confirmPassword");
    const saveBtn = document.getElementById("saveCredentialsBtn");
    const cancelBtn = document.getElementById("cancelCredentialsBtn");
    const currentGmailEl = document.getElementById("currentGmailValue");
    const popupIdentity = document.querySelector(".popup-identity");
    const usernameInput = document.getElementById("usernameInput");
    const fullNameInput = document.getElementById("fullNameInput");
    const currentUsernameEl = document.getElementById("currentUsernameValue");
    const currentFullnameEl = document.getElementById("currentFullnameValue");

    const API_BASE = (() => {
      const configured =
        window.APP_API_BASE_URL ||
        document
          .querySelector('meta[name="api-base-url"]')
          ?.getAttribute("content") ||
        "";
      if (configured.trim()) return configured.replace(/\/+$/, "");
      const proto = window.location.protocol;
      const host = window.location.hostname;
      const port = window.location.port;
      if (port === "8000") return `${proto}//${host}:${port}/api`;
      if (host === "localhost" || host === "127.0.0.1")
        return `${proto}//${host}:8000/api`;
      return `${proto}//${host}/api`;
    })();

    const getToken = () =>
      (window.AdminSession && window.AdminSession.getToken()) ||
      localStorage.getItem("auth_token") ||
      "";

    const setLoadingLocal = (active) => {
      const loader =
        document.getElementById("global-loader") ||
        document.querySelector(".global-loader-overlay");
      if (loader) loader.classList.toggle("active", !!active);
    };

    const showStatusLocal = (message) => {
      const authStatusModal = document.getElementById("authStatusModal");
      const authStatusText = document.getElementById("authStatusText");
      if (authStatusModal && authStatusText) {
        authStatusText.textContent = message;
        authStatusModal.classList.add("show");
        setTimeout(() => authStatusModal.classList.remove("show"), 3000);
      } else {
        alert(message);
      }
    };

    const showSuccessNotification = (message, newEmail) => {
      if (typeof newEmail === "string" && newEmail) {
        // update small card and header popup immediately
        if (currentGmailEl) currentGmailEl.textContent = newEmail;
        document.querySelectorAll(".profile-initial").forEach((el) => {
          el.dataset.email = newEmail;
          el.textContent = newEmail.trim().charAt(0).toUpperCase();
        });
        if (popupIdentity) popupIdentity.textContent = newEmail;
        try {
          const raw =
            window.AdminSession && window.AdminSession.getUserInfo()
              ? JSON.stringify(window.AdminSession.getUserInfo())
              : localStorage.getItem("user_info");
          if (raw) {
            const info = typeof raw === "string" ? JSON.parse(raw) : raw;
            info.email = newEmail;
            if (window.AdminSession) {
              window.AdminSession.setUserInfo(info);
            } else {
              localStorage.setItem("user_info", JSON.stringify(info));
            }
          }
        } catch (e) {
          /* ignore */
        }
      }
      const successMessage = message || "Updated successfully.";
      if (typeof window.showAdminSuccessNotification === "function") {
        window.showAdminSuccessNotification(successMessage);
      } else if (typeof window.showAdminPopup === "function") {
        window.showAdminPopup(successMessage, { type: "success" });
      } else {
        alert(successMessage);
      }
    };

    const bindToggle = (inputEl, btnEl) => {
      if (!inputEl || !btnEl) return;
      btnEl.addEventListener("click", () => {
        const icon = btnEl.querySelector("i");
        if (inputEl.type === "password") {
          inputEl.type = "text";
          if (icon) icon.className = "fa-solid fa-eye";
        } else {
          inputEl.type = "password";
          if (icon) icon.className = "fa-solid fa-eye-slash";
        }
      });
    };

    bindToggle(
      currentPasswordInput,
      document.getElementById("toggleCurrentPassword"),
    );
    bindToggle(newPasswordInput, document.getElementById("toggleNewPassword"));
    bindToggle(
      confirmPasswordInput,
      document.getElementById("toggleConfirmPassword"),
    );

    // Show the saved success flash after the authoritative account reload.
    try {
      const pending = sessionStorage.getItem("account_update_success");
      if (pending) {
        const parsed = JSON.parse(pending || "{}");
        sessionStorage.removeItem("account_update_success");
        showSuccessNotification(
          parsed.message || "Credentials updated successfully.",
          parsed.email || "",
        );
      }
    } catch (e) {
      /* ignore */
    }

    // Fetch the current authenticated user from backend and populate UI (fallback to localStorage)
    const fetchAndPopulateUser = async () => {
      let user = null;
      const token = getToken();
      if (token) {
        try {
          setLoadingLocal(true);
          const res = await fetch(`${API_BASE}/user`, {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
            },
          });
          if (res.status === 401 || res.status === 403) {
            // Unauthorized - clear session and redirect to login to avoid stale cached user info
            try {
              if (window.AdminSession) {
                window.AdminSession.clearSession();
              }
              localStorage.removeItem("auth_token");
              localStorage.removeItem("user_info");
            } catch (e) {
              /* ignore */
            }
            showStatusLocal("Session expired. Please sign in again.");
            window.location.href = "../admin-auth/auth.html";
            return;
          }
          if (res.ok) {
            const payload = await res.json();
            user = payload?.data || payload;
            try {
              if (window.AdminSession) {
                window.AdminSession.setUserInfo(payload);
              } else {
                localStorage.setItem("user_info", JSON.stringify(payload));
              }
            } catch (e) {
              /* ignore */
            }
          }
        } catch (e) {
          // network error, will try fallback below
        } finally {
          setLoadingLocal(false);
        }
      }

      // Fallback to cached user_info when API not available or not authorized
      if (!user) {
        try {
          let raw;
          if (window.AdminSession) {
            raw = window.AdminSession.getUserInfo();
            if (raw) raw = typeof raw === "string" ? JSON.parse(raw) : raw;
          } else {
            const rawStr = localStorage.getItem("user_info");
            if (rawStr) raw = JSON.parse(rawStr);
          }
          if (raw) {
            user = raw?.data || raw;
          }
        } catch (e) {
          /* ignore */
        }
      }

      if (!user) return;

      const emailVal = user.email || "";
      const usernameVal =
        user.username || user.user_name || user.username || "";
      const fullnameVal =
        user.full_name ||
        user.name ||
        (user.first_name && user.last_name
          ? `${user.first_name} ${user.last_name}`
          : "") ||
        "";

      if (currentGmailEl)
        currentGmailEl.textContent = emailVal || currentGmailEl.textContent;
      if (emailInput && emailVal) emailInput.value = emailVal;
      if (popupIdentity && emailVal) popupIdentity.textContent = emailVal;
      document.querySelectorAll(".profile-initial").forEach((el) => {
        if (emailVal) {
          el.dataset.email = emailVal;
          el.textContent = emailVal.trim().charAt(0).toUpperCase();
        }
      });

      if (usernameInput)
        usernameInput.value = usernameVal || usernameInput.value || "";
      if (currentUsernameEl)
        currentUsernameEl.textContent =
          usernameVal || currentUsernameEl.textContent || "";

      if (fullNameInput) {
        fullNameInput.value = fullnameVal || fullNameInput.value || "";
        fullNameInput.disabled = true;
      }
      if (currentFullnameEl)
        currentFullnameEl.textContent =
          fullnameVal || currentFullnameEl.textContent || "";
    };

    // initial load
    fetchAndPopulateUser();

    // Refresh button (page-level)
    // If user clicks the toolbar Refresh (#accountRefreshBtn) behave like the Dashboard: perform a full reload.
    // Support a fallback data-action for non-reload refreshes.
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(
        '#accountRefreshBtn, [data-action="account-refresh"]',
      );
      if (!btn) return;
      e.preventDefault();
      if (btn.matches && btn.matches("#accountRefreshBtn")) {
        try {
          btn.disabled = true;
          window.location.reload();
        } finally {
          // re-enable if reload is blocked
          window.setTimeout(() => {
            try {
              btn.disabled = false;
            } catch (e) {}
          }, 900);
        }
        return;
      }
      try {
        fetchAndPopulateUser();
      } catch (err) {
        /* ignore */
      }
    });

    const extractError = async (res) => {
      try {
        const payload = await res.json();
        if (payload?.message) return payload.message;
        if (payload?.errors) {
          const key = Object.keys(payload.errors)[0];
          return Array.isArray(payload.errors[key])
            ? payload.errors[key][0]
            : String(payload.errors[key]);
        }
      } catch (e) {
        // ignore
      }
      return res.statusText || "Request failed";
    };

    /* ---------------- Pending Gmail verification (admin only) ----------------
       An admin Gmail change is parked until the 6-digit code mailed to the NEW
       address is entered, so a typo can never become the only password-reset
       destination. Staff and customers keep the immediate-apply path and never
       render this strip. */

    const emailPendingStrip = document.getElementById("emailPendingStrip");
    const emailPendingAddress = document.getElementById("emailPendingAddress");
    const emailPendingOtp = document.getElementById("emailPendingOtp");
    const emailPendingVerifyBtn = document.getElementById(
      "emailPendingVerifyBtn",
    );
    const emailPendingCancelBtn = document.getElementById(
      "emailPendingCancelBtn",
    );
    const emailPendingHint = document.getElementById("emailPendingHint");

    const setPendingHint = (text, tone) => {
      if (!emailPendingHint) return;
      emailPendingHint.textContent = text || "";
      emailPendingHint.style.color = tone === "danger" ? "#a3382b" : "";
    };

    const renderEmailPending = (state) => {
      if (!emailPendingStrip) return;
      if (!state || !state.pending) {
        emailPendingStrip.classList.remove("show");
        if (emailPendingOtp) emailPendingOtp.value = "";
        setPendingHint("");
        return;
      }
      if (emailPendingAddress) {
        emailPendingAddress.textContent =
          state.pending_email || "the new address";
      }
      emailPendingStrip.classList.add("show");
      const left = Number(state.attempts_left);
      setPendingHint(
        Number.isFinite(left) && left >= 0
          ? `${left} attempt${left === 1 ? "" : "s"} left. The code expires 15 minutes after it was sent.`
          : "The code expires 15 minutes after it was sent.",
      );
    };

    const loadEmailPending = async () => {
      if (!emailPendingStrip) return;
      const token = getToken();
      if (!token) return;
      try {
        const res = await fetch(`${API_BASE}/user/email-change`, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        });
        if (!res.ok) return;
        renderEmailPending(await res.json());
      } catch (e) {
        /* offline: leave the strip alone rather than hiding a real change */
      }
    };

    loadEmailPending();

    // Digits only: the field takes a 6-digit code, not free text.
    emailPendingOtp?.addEventListener("input", () => {
      const digits = emailPendingOtp.value.replace(/\D+/g, "").slice(0, 6);
      if (digits !== emailPendingOtp.value) emailPendingOtp.value = digits;
    });

    emailPendingOtp?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        emailPendingVerifyBtn?.click();
      }
    });

    emailPendingVerifyBtn?.addEventListener("click", async () => {
      const otp = (emailPendingOtp?.value || "").trim();
      if (!/^\d{6}$/.test(otp)) {
        setPendingHint("Enter the 6 digits from the email.", "danger");
        emailPendingOtp?.focus();
        return;
      }
      const originalVerifyHtml = emailPendingVerifyBtn.innerHTML;
      emailPendingVerifyBtn.disabled = true;
      emailPendingVerifyBtn.innerHTML =
        '<i class="fa-solid fa-spinner fa-spin"></i> Verifying...';
      try {
        const res = await fetch(`${API_BASE}/user/email-change/confirm`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${getToken()}`,
          },
          body: JSON.stringify({ otp }),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok) {
          // pending stays true only while the request survives the wrong code.
          const stillPending = !!payload?.pending;
          const reason = payload?.message || "That code is not correct.";
          renderEmailPending({
            pending: stillPending,
            pending_email: emailPendingAddress?.textContent || "",
            attempts_left: payload?.attempts_left,
          });
          if (stillPending) {
            setPendingHint(reason, "danger");
          } else {
            // The strip has just been hidden, so an inline hint would vanish with
            // it and the disappearance would read as success. Say it out loud.
            showStatusLocal(reason);
          }
          if (emailPendingOtp) {
            emailPendingOtp.value = "";
            if (stillPending) emailPendingOtp.focus();
          }
          return;
        }
        renderEmailPending({ pending: false });
        try {
          sessionStorage.setItem(
            "account_update_success",
            JSON.stringify({
              message:
                payload?.message ||
                "Gmail address updated. Password resets will now go to your new address.",
              email: payload?.data?.email || "",
            }),
          );
        } catch (e) {
          /* ignore */
        }
        // The address only moves here, so reload for the authoritative record.
        window.location.reload();
      } catch (err) {
        setPendingHint("Network error. Please try again.", "danger");
      } finally {
        emailPendingVerifyBtn.disabled = false;
        emailPendingVerifyBtn.innerHTML = originalVerifyHtml;
      }
    });

    emailPendingCancelBtn?.addEventListener("click", async () => {
      const originalCancelHtml = emailPendingCancelBtn.innerHTML;
      emailPendingCancelBtn.disabled = true;
      emailPendingCancelBtn.innerHTML =
        '<i class="fa-solid fa-spinner fa-spin"></i> Cancelling...';
      try {
        const res = await fetch(`${API_BASE}/user/email-change/cancel`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${getToken()}`,
          },
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok) {
          setPendingHint(
            payload?.message || "Could not cancel the change.",
            "danger",
          );
          return;
        }
        renderEmailPending({ pending: false });
        // Put the live address back in the field so a later save is a no-op.
        const liveEmail = payload?.data?.email || "";
        if (emailInput && liveEmail) emailInput.value = liveEmail;
        showSuccessNotification(
          payload?.message ||
            "Gmail change cancelled. Your account still uses your current address.",
        );
      } catch (err) {
        setPendingHint("Network error. Please try again.", "danger");
      } finally {
        emailPendingCancelBtn.disabled = false;
        emailPendingCancelBtn.innerHTML = originalCancelHtml;
      }
    });

    saveBtn?.addEventListener("click", async (e) => {
      e.preventDefault();
      const email = (emailInput?.value || "").trim();
      const current = currentPasswordInput?.value || "";
      const newpw = newPasswordInput?.value || "";
      const confirm = confirmPasswordInput?.value || "";

      const gmailRegex = /^[A-Za-z0-9._%+-]+@gmail\.com$/i;
      if (!email || !gmailRegex.test(email)) {
        showStatusLocal("Please enter a valid Gmail address.");
        return;
      }

      const originalSaveButtonHtml = saveBtn?.innerHTML || "";
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML =
          '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
      }

      let reloadRequested = false;
      setLoadingLocal(true);
      try {
        const token = getToken();

        // Update profile (email and optional username)
        const updatePayload = {};
        if (email) updatePayload.email = email;
        if (usernameInput && usernameInput.value && usernameInput.value.trim())
          updatePayload.username = usernameInput.value.trim();

        const emailRes = await fetch(`${API_BASE}/user`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(updatePayload),
        });

        if (!emailRes.ok) {
          const msg = await extractError(emailRes);
          setLoadingLocal(false);
          showStatusLocal(msg || "Failed to update email.");
          return;
        }

        // An admin Gmail change is parked until it is verified, so the response
        // is what says whether the address actually moved.
        let emailPayload = null;
        try {
          emailPayload = await emailRes.json();
        } catch (e) {
          /* ignore */
        }
        const verificationRequired = !!emailPayload?.email_verification_required;

        // If user provided password fields, attempt password change
        if (newpw || confirm) {
          if (!current) {
            setLoadingLocal(false);
            showStatusLocal("Current password is required to change password.");
            return;
          }
          if (newpw !== confirm) {
            setLoadingLocal(false);
            showStatusLocal("New password and confirmation do not match.");
            return;
          }

          const pwdRes = await fetch(`${API_BASE}/change-password`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              current_password: current,
              new_password: newpw,
              new_password_confirmation: confirm,
            }),
          });

          if (!pwdRes.ok) {
            const msg = await extractError(pwdRes);
            setLoadingLocal(false);
            showStatusLocal(msg || "Failed to change password.");
            return;
          }
        }

        // A parked Gmail change must not claim the address was updated: the old
        // one stays live until the code is entered, so show the strip instead of
        // the success flash and keep the page as it is.
        if (verificationRequired) {
          setLoadingLocal(false);
          if (currentPasswordInput) currentPasswordInput.value = "";
          if (newPasswordInput) newPasswordInput.value = "";
          if (confirmPasswordInput) confirmPasswordInput.value = "";
          renderEmailPending({
            pending: true,
            pending_email: emailPayload?.pending_email || "",
            attempts_left: 5,
          });
          const passwordAlsoChanged = !!(newpw || confirm);
          const pendingMessage =
            (passwordAlsoChanged ? "Password updated. " : "") +
            (emailPayload?.message ||
              "Enter the 6-digit code we sent to the new Gmail address to finish the change.");
          // The shared helper would read "sent" as a success and flash a green
          // "Success!" toast — but the Gmail has NOT moved yet, and the old
          // address is still the only reset destination. type:"modal" forces the
          // acknowledge-me dialog instead, so the remaining step cannot be missed.
          if (typeof window.showAdminPopup === "function") {
            window.showAdminPopup(pendingMessage, {
              type: "modal",
              title: "One more step",
              onOk: () => emailPendingOtp?.focus(),
            });
          } else {
            showStatusLocal(pendingMessage);
          }
          emailPendingOtp?.focus();
          return;
        }

        // Persist a success marker and reload the page so the authoritative backend state is shown.
        try {
          sessionStorage.setItem(
            "account_update_success",
            JSON.stringify({
              message: "Credentials updated successfully.",
              email,
            }),
          );
        } catch (e) {
          /* ignore */
        }

        setLoadingLocal(false);
        window.location.reload();
        reloadRequested = true;
      } catch (err) {
        showStatusLocal("Network error. Please try again.");
      } finally {
        setLoadingLocal(false);
        const restoreSaveButton = () => {
          if (!saveBtn) return;
          saveBtn.disabled = false;
          saveBtn.innerHTML =
            originalSaveButtonHtml ||
            '<i class="fa-solid fa-floppy-disk"></i> Save Changes';
        };
        if (reloadRequested) {
          window.setTimeout(restoreSaveButton, 900);
        } else {
          restoreSaveButton();
        }
      }
    });

    cancelBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      if (emailInput) emailInput.value = "";
      if (currentPasswordInput) currentPasswordInput.value = "";
      if (newPasswordInput) newPasswordInput.value = "";
      if (confirmPasswordInput) confirmPasswordInput.value = "";
    });

    /* -------------------- Recovery codes (admin only) --------------------
       staff-page/my-account.html loads this very file, so everything below is
       gated on the card that only the admin page renders. Ten single-use codes
       are the way back in when the Gmail is unreachable, so the card states
       plainly how many are left and when they were issued. */

    const recoveryCard = document.getElementById("recoveryCodesCard");
    if (!recoveryCard) return;

    const recoveryRemainingEl = document.getElementById("recoveryRemaining");
    const recoveryGeneratedAtEl = document.getElementById(
      "recoveryGeneratedAt",
    );
    const recoveryLastUsedAtEl = document.getElementById("recoveryLastUsedAt");
    const recoveryMeterFill = document.getElementById("recoveryMeterFill");
    const recoveryNote = document.getElementById("recoveryNote");
    const recoveryGenerateBtn = document.getElementById("recoveryGenerateBtn");
    const recoveryGenerateLabel = document.getElementById(
      "recoveryGenerateLabel",
    );
    const recoveryRevealPanel = document.getElementById("recoveryRevealPanel");
    const recoveryPrintHead = document.getElementById("recoveryPrintHead");
    const recoveryCodesList = document.getElementById("recoveryCodesList");
    const recoveryCopyBtn = document.getElementById("recoveryCopyBtn");
    const recoveryDownloadBtn = document.getElementById("recoveryDownloadBtn");
    const recoveryPrintBtn = document.getElementById("recoveryPrintBtn");
    const recoveryDoneBtn = document.getElementById("recoveryDoneBtn");
    const recoveryAckCheck = document.getElementById("recoveryAckCheck");
    const recoveryConfirmModal =
      document.getElementById("recoveryConfirmModal");
    const recoveryConfirmTitle =
      document.getElementById("recoveryConfirmTitle");
    const recoveryConfirmText = document.getElementById("recoveryConfirmText");
    const recoveryConfirmPassword = document.getElementById(
      "recoveryConfirmPassword",
    );
    const recoveryConfirmCancel =
      document.getElementById("recoveryConfirmCancel");
    const recoveryConfirmSubmit =
      document.getElementById("recoveryConfirmSubmit");

    bindToggle(
      recoveryConfirmPassword,
      document.getElementById("toggleRecoveryPassword"),
    );

    const recoveryState = { supported: null, total: 0, remaining: 0 };
    let revealedCodes = [];

    const formatStamp = (iso) => {
      if (!iso) return "—";
      const when = new Date(iso);
      if (Number.isNaN(when.getTime())) return "—";
      return when.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    };

    const setRecoveryNote = (html, tone) => {
      if (!recoveryNote) return;
      recoveryNote.innerHTML = html;
      recoveryNote.classList.remove(
        "recovery-note--warn",
        "recovery-note--danger",
      );
      if (tone) recoveryNote.classList.add(`recovery-note--${tone}`);
    };

    const setRecoveryMeter = (remaining, total) => {
      if (!recoveryMeterFill) return;
      const pct = total > 0 ? Math.round((remaining / total) * 100) : 0;
      recoveryMeterFill.style.width = `${pct}%`;
      recoveryMeterFill.classList.remove(
        "recovery-meter__fill--low",
        "recovery-meter__fill--empty",
      );
      if (remaining === 0) {
        recoveryMeterFill.classList.add("recovery-meter__fill--empty");
      } else if (remaining <= 3) {
        recoveryMeterFill.classList.add("recovery-meter__fill--low");
      }
    };

    const renderRecoveryStatus = (data) => {
      const supported = data?.supported !== false;
      recoveryState.supported = supported;
      recoveryState.total = Number(data?.total) || 0;
      recoveryState.remaining = Number(data?.remaining) || 0;

      if (recoveryGeneratedAtEl)
        recoveryGeneratedAtEl.textContent = formatStamp(data?.generated_at);
      if (recoveryLastUsedAtEl)
        recoveryLastUsedAtEl.textContent = formatStamp(data?.last_used_at);

      if (!supported) {
        if (recoveryRemainingEl) recoveryRemainingEl.textContent = "—";
        setRecoveryMeter(0, 0);
        if (recoveryGenerateBtn) recoveryGenerateBtn.disabled = true;
        setRecoveryNote(
          "Recovery codes are not installed on this server yet — run the pending migration (<strong>php artisan migrate --force</strong>), then refresh this page.",
          "danger",
        );
        return;
      }

      if (recoveryGenerateBtn) recoveryGenerateBtn.disabled = false;
      const total = recoveryState.total;
      const remaining = recoveryState.remaining;
      if (recoveryRemainingEl) {
        recoveryRemainingEl.textContent =
          total > 0 ? `${remaining} of ${total}` : "—";
      }
      setRecoveryMeter(remaining, total);
      if (recoveryGenerateLabel) {
        recoveryGenerateLabel.textContent =
          total > 0 ? "Regenerate Codes" : "Generate Codes";
      }
      if (total === 0) {
        setRecoveryNote(
          "You have <strong>no recovery codes yet</strong>. Generate a set and keep it offline — it is the only way back into this account if the Gmail address ever becomes unreachable.",
          "warn",
        );
      } else if (remaining === 0) {
        setRecoveryNote(
          "<strong>Every code has been used.</strong> Generate a new set now so the account keeps a way back in that does not depend on the Gmail address.",
          "danger",
        );
      } else if (remaining <= 3) {
        setRecoveryNote(
          `Only <strong>${remaining}</strong> of ${total} codes are left. Generate a new set soon — regenerating always issues ten fresh codes.`,
          "warn",
        );
      } else {
        setRecoveryNote(
          `<strong>${remaining}</strong> of ${total} codes are unused. Each one works once, in any order, and can set a new password without the Gmail code.`,
        );
      }
    };

    const loadRecoveryStatus = async () => {
      const token = getToken();
      if (!token) return;
      try {
        const res = await fetch(`${API_BASE}/admin/recovery-codes`, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        });
        if (res.status === 403) {
          // Not an admin: hide the card rather than showing a dead panel.
          recoveryCard.style.display = "none";
          return;
        }
        if (!res.ok) {
          setRecoveryNote(
            "Could not read the recovery-code status. Use Refresh to try again.",
            "warn",
          );
          return;
        }
        renderRecoveryStatus(await res.json());
      } catch (e) {
        setRecoveryNote(
          "Could not reach the server to read the recovery-code status.",
          "warn",
        );
      }
    };

    loadRecoveryStatus();

    const openRecoveryConfirm = () => {
      if (!recoveryConfirmModal) return;
      const regenerating = recoveryState.total > 0;
      if (recoveryConfirmTitle) {
        recoveryConfirmTitle.textContent = regenerating
          ? "Regenerate Recovery Codes"
          : "Generate Recovery Codes";
      }
      if (recoveryConfirmText) {
        recoveryConfirmText.innerHTML = regenerating
          ? "Confirm your current password to issue ten new codes. <strong>Every code from the previous set stops working immediately</strong>, including the ones you never used."
          : "Confirm your current password to issue ten single-use codes. They are shown once, so save them before you close the panel.";
      }
      if (recoveryConfirmSubmit) {
        recoveryConfirmSubmit.textContent = regenerating
          ? "Regenerate"
          : "Generate";
      }
      if (recoveryConfirmPassword) {
        recoveryConfirmPassword.value = "";
        recoveryConfirmPassword.type = "password";
      }
      const eyeIcon = document.querySelector("#toggleRecoveryPassword i");
      if (eyeIcon) eyeIcon.className = "fa-solid fa-eye-slash";
      recoveryConfirmModal.classList.add("show");
      window.setTimeout(() => recoveryConfirmPassword?.focus(), 50);
    };

    const closeRecoveryConfirm = () => {
      recoveryConfirmModal?.classList.remove("show");
      if (recoveryConfirmPassword) recoveryConfirmPassword.value = "";
    };

    recoveryGenerateBtn?.addEventListener("click", openRecoveryConfirm);
    recoveryConfirmCancel?.addEventListener("click", closeRecoveryConfirm);
    recoveryConfirmModal?.addEventListener("click", (ev) => {
      if (ev.target === recoveryConfirmModal) closeRecoveryConfirm();
    });
    recoveryConfirmPassword?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        recoveryConfirmSubmit?.click();
      }
    });

    const escapeHtml = (value) =>
      String(value ?? "").replace(
        /[&<>"']/g,
        (ch) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[ch],
      );

    const renderRevealedCodes = (codes) => {
      revealedCodes = Array.isArray(codes) ? codes.slice() : [];
      if (recoveryCodesList) {
        recoveryCodesList.innerHTML = revealedCodes
          .map(
            (code, index) =>
              `<div class="recovery-code"><span class="recovery-code__index">${
                index + 1
              }.</span><span class="recovery-code__value">${escapeHtml(
                code,
              )}</span></div>`,
          )
          .join("");
      }
      if (recoveryPrintHead) {
        recoveryPrintHead.innerHTML = `<strong>UCN-FMRC admin recovery codes</strong><br />${escapeHtml(
          currentGmailEl?.textContent || "",
        )} &middot; issued ${escapeHtml(
          formatStamp(new Date().toISOString()),
        )}<br />Each code works once. Keep this sheet somewhere locked.`;
      }
      if (recoveryAckCheck) recoveryAckCheck.checked = false;
      if (recoveryDoneBtn) recoveryDoneBtn.disabled = true;
      recoveryRevealPanel?.classList.add("show");
      recoveryRevealPanel?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    };

    const hideRecoveryReveal = () => {
      revealedCodes = [];
      recoveryRevealPanel?.classList.remove("show");
      if (recoveryCodesList) recoveryCodesList.innerHTML = "";
      if (recoveryAckCheck) recoveryAckCheck.checked = false;
      if (recoveryDoneBtn) recoveryDoneBtn.disabled = true;
    };

    recoveryConfirmSubmit?.addEventListener("click", async () => {
      const password = recoveryConfirmPassword?.value || "";
      if (!password) {
        showStatusLocal("Enter your current password to continue.");
        recoveryConfirmPassword?.focus();
        return;
      }
      const originalSubmitHtml = recoveryConfirmSubmit.innerHTML;
      recoveryConfirmSubmit.disabled = true;
      recoveryConfirmSubmit.innerHTML =
        '<i class="fa-solid fa-spinner fa-spin"></i> Working...';
      try {
        const res = await fetch(`${API_BASE}/admin/recovery-codes/generate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${getToken()}`,
          },
          body: JSON.stringify({ current_password: password }),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok) {
          let message = payload?.message || "Could not generate the codes.";
          const wait = Number(payload?.retry_after_seconds);
          if (res.status === 429 && Number.isFinite(wait) && wait > 0) {
            message += ` Try again in about ${Math.ceil(wait / 60)} minute(s).`;
          }
          showStatusLocal(message);
          if (payload?.supported === false) renderRecoveryStatus(payload);
          return;
        }
        closeRecoveryConfirm();
        renderRevealedCodes(payload?.codes);
        renderRecoveryStatus({
          supported: true,
          total: payload?.total,
          remaining: payload?.remaining,
          generated_at: payload?.generated_at,
          last_used_at: null,
        });
        showSuccessNotification(
          payload?.message ||
            "Save these codes now. They will not be shown again.",
        );
      } catch (e) {
        showStatusLocal("Network error. Please try again.");
      } finally {
        recoveryConfirmSubmit.disabled = false;
        recoveryConfirmSubmit.innerHTML = originalSubmitHtml;
      }
    });

    const codesAsText = () =>
      [
        "UCN-FMRC — Admin recovery codes",
        `Account: ${currentGmailEl?.textContent || "admin"}`,
        `Issued: ${formatStamp(new Date().toISOString())}`,
        "",
        "Each code works once, in any order. Type it with or without the dash.",
        "Keep this offline: anyone holding a code can set a new admin password.",
        "",
        ...revealedCodes.map(
          (code, index) => `${String(index + 1).padStart(2, "0")}. ${code}`,
        ),
        "",
      ].join("\r\n");

    recoveryCopyBtn?.addEventListener("click", async () => {
      if (!revealedCodes.length) return;
      const text = revealedCodes.join("\n");
      let copied = false;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
          copied = true;
        }
      } catch (e) {
        /* fall through to the textarea path */
      }
      if (!copied) {
        // The Clipboard API needs a secure context; this path works on plain http.
        try {
          const scratch = document.createElement("textarea");
          scratch.value = text;
          scratch.setAttribute("readonly", "readonly");
          scratch.style.position = "fixed";
          scratch.style.top = "-1000px";
          document.body.appendChild(scratch);
          scratch.select();
          copied = document.execCommand("copy");
          document.body.removeChild(scratch);
        } catch (e) {
          copied = false;
        }
      }
      if (copied) {
        showSuccessNotification("All ten codes copied to the clipboard.");
      } else {
        showStatusLocal("Could not copy automatically — copy them by hand.");
      }
    });

    recoveryDownloadBtn?.addEventListener("click", () => {
      if (!revealedCodes.length) return;
      try {
        const blob = new Blob([codesAsText()], {
          type: "text/plain;charset=utf-8",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `ucn-fmrc-recovery-codes-${new Date()
          .toISOString()
          .slice(0, 10)}.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (e) {
        showStatusLocal("Could not build the download. Copy the codes instead.");
      }
    });

    recoveryPrintBtn?.addEventListener("click", () => {
      if (!revealedCodes.length) return;
      // Only this class is printed; the report print rules key off a different
      // one and stay untouched.
      document.body.classList.add("recovery-printing");
      const cleanup = () => document.body.classList.remove("recovery-printing");
      window.addEventListener("afterprint", cleanup, { once: true });
      try {
        window.print();
      } finally {
        // afterprint is unreliable on iOS Safari, so drop the class either way.
        window.setTimeout(cleanup, 1500);
      }
    });

    recoveryAckCheck?.addEventListener("change", () => {
      if (recoveryDoneBtn) recoveryDoneBtn.disabled = !recoveryAckCheck.checked;
    });

    recoveryDoneBtn?.addEventListener("click", () => {
      hideRecoveryReveal();
      loadRecoveryStatus();
    });
  });
})();
