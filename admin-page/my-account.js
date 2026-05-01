(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const emailInput = document.getElementById('emailInput');
    const currentPasswordInput = document.getElementById('currentPassword');
    const newPasswordInput = document.getElementById('newPassword');
    const confirmPasswordInput = document.getElementById('confirmPassword');
    const saveBtn = document.getElementById('saveCredentialsBtn');
    const cancelBtn = document.getElementById('cancelCredentialsBtn');
    let successModal = document.getElementById('credSuccessModal');
    let successMessageEl = document.getElementById('credSuccessMessage');
    let successOk = document.getElementById('credSuccessOk');
    const currentGmailEl = document.getElementById('currentGmailValue');
    const popupIdentity = document.querySelector('.popup-identity');
    const usernameInput = document.getElementById('usernameInput');
    const fullNameInput = document.getElementById('fullNameInput');
    const currentUsernameEl = document.getElementById('currentUsernameValue');
    const currentFullnameEl = document.getElementById('currentFullnameValue');

    const API_BASE = (() => {
      const configured = window.APP_API_BASE_URL || document.querySelector('meta[name="api-base-url"]')?.getAttribute('content') || '';
      if (configured.trim()) return configured.replace(/\/+$/, '');
      const proto = window.location.protocol;
      const host = window.location.hostname;
      const port = window.location.port;
      if (port === '8000') return `${proto}//${host}:${port}/api`;
      if (host === 'localhost' || host === '127.0.0.1') return `${proto}//${host}:8000/api`;
      return `${proto}//${host}/api`;
    })();

    const getToken = () => localStorage.getItem('auth_token') || '';

    const setLoadingLocal = (active) => {
      const loader = document.getElementById('global-loader') || document.querySelector('.global-loader-overlay');
      if (loader) loader.classList.toggle('active', !!active);
    };

    const showStatusLocal = (message) => {
      const authStatusModal = document.getElementById('authStatusModal');
      const authStatusText = document.getElementById('authStatusText');
      if (authStatusModal && authStatusText) {
        authStatusText.textContent = message;
        authStatusModal.classList.add('show');
        setTimeout(() => authStatusModal.classList.remove('show'), 3000);
      } else {
        alert(message);
      }
    };

    const showSuccessModal = (message, newEmail) => {
      if (successMessageEl) successMessageEl.textContent = message || 'Updated successfully.';
      if (typeof newEmail === 'string' && newEmail) {
        // update small card and header popup immediately
        if (currentGmailEl) currentGmailEl.textContent = newEmail;
        document.querySelectorAll('.profile-initial').forEach((el) => {
          el.dataset.email = newEmail;
          el.textContent = newEmail.trim().charAt(0).toUpperCase();
        });
        if (popupIdentity) popupIdentity.textContent = newEmail;
        try {
          const raw = localStorage.getItem('user_info');
          if (raw) {
            const info = JSON.parse(raw);
            info.email = newEmail;
            localStorage.setItem('user_info', JSON.stringify(info));
          }
        } catch (e) { /* ignore */ }
      }
      if (successModal) {
        successModal.classList.add('show');
      } else {
        alert(message || 'Updated successfully.');
      }
    };

    const createOrEnsureSuccessModal = () => {
      // If markup not present on page, create a minimal success modal
      if (!document.getElementById('credSuccessModal')) {
        const modal = document.createElement('div');
        modal.id = 'credSuccessModal';
        modal.className = 'success-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'credSuccessTitle');
        modal.innerHTML = `
          <div class="success-box">
            <div class="success-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            </div>
            <h3 id="credSuccessTitle">Success</h3>
            <p id="credSuccessMessage">Credentials updated successfully.</p>
            <button id="credSuccessOk" class="btn-admin" type="button">Okay</button>
          </div>
        `;
        document.body.appendChild(modal);
      }

      successModal = document.getElementById('credSuccessModal');
      successMessageEl = document.getElementById('credSuccessMessage');
      successOk = document.getElementById('credSuccessOk');

      if (successOk && !successOk.dataset.bound) {
        successOk.addEventListener('click', async () => {
          if (successModal) successModal.classList.remove('show');
          try { await fetchAndPopulateUser(); } catch (e) { /* ignore */ }
        });
        successOk.dataset.bound = '1';
      }
    };

    const bindToggle = (inputEl, btnEl) => {
      if (!inputEl || !btnEl) return;
      btnEl.addEventListener('click', () => {
        const icon = btnEl.querySelector('i');
        if (inputEl.type === 'password') {
          inputEl.type = 'text';
          if (icon) icon.className = 'fa-solid fa-eye';
        } else {
          inputEl.type = 'password';
          if (icon) icon.className = 'fa-solid fa-eye-slash';
        }
      });
    };

    bindToggle(currentPasswordInput, document.getElementById('toggleCurrentPassword'));
    bindToggle(newPasswordInput, document.getElementById('toggleNewPassword'));
    bindToggle(confirmPasswordInput, document.getElementById('toggleConfirmPassword'));

    // Ensure a success modal exists and is bound (creates one if missing).
    // Also, if we reloaded after a save, show the success modal now.
    try {
      createOrEnsureSuccessModal();
      try {
        const pending = sessionStorage.getItem('account_update_success');
        if (pending) {
          const parsed = JSON.parse(pending || '{}');
          sessionStorage.removeItem('account_update_success');
          showSuccessModal(parsed.message || 'Credentials updated successfully.', parsed.email || '');
        }
      } catch (e) { /* ignore */ }
    } catch (e) { /* ignore */ }

    // Fetch the current authenticated user from backend and populate UI (fallback to localStorage)
    const fetchAndPopulateUser = async () => {
      let user = null;
      const token = getToken();
      if (token) {
        try {
          setLoadingLocal(true);
          const res = await fetch(`${API_BASE}/user`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
          if (res.status === 401 || res.status === 403) {
            // Unauthorized - clear session and redirect to login to avoid stale cached user info
            try { localStorage.removeItem('auth_token'); localStorage.removeItem('user_info'); } catch (e) { /* ignore */ }
            showStatusLocal('Session expired. Please sign in again.');
            window.location.href = '../admin-auth/auth.html';
            return;
          }
          if (res.ok) {
            const payload = await res.json();
            user = payload?.data || payload;
            try { localStorage.setItem('user_info', JSON.stringify(payload)); } catch (e) { /* ignore */ }
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
          const raw = localStorage.getItem('user_info');
          if (raw) {
            const parsed = JSON.parse(raw);
            user = parsed?.data || parsed;
          }
        } catch (e) { /* ignore */ }
      }

      if (!user) return;

      const emailVal = user.email || '';
      const usernameVal = user.username || user.user_name || user.username || '';
      const fullnameVal = user.full_name || user.name || ((user.first_name && user.last_name) ? `${user.first_name} ${user.last_name}` : '') || '';

      if (currentGmailEl) currentGmailEl.textContent = emailVal || currentGmailEl.textContent;
      if (emailInput && emailVal) emailInput.value = emailVal;
      if (popupIdentity && emailVal) popupIdentity.textContent = emailVal;
      document.querySelectorAll('.profile-initial').forEach((el) => {
        if (emailVal) { el.dataset.email = emailVal; el.textContent = emailVal.trim().charAt(0).toUpperCase(); }
      });

      if (usernameInput) usernameInput.value = usernameVal || usernameInput.value || '';
      if (currentUsernameEl) currentUsernameEl.textContent = usernameVal || currentUsernameEl.textContent || '';

      if (fullNameInput) {
        fullNameInput.value = fullnameVal || fullNameInput.value || '';
        fullNameInput.disabled = true;
      }
      if (currentFullnameEl) currentFullnameEl.textContent = fullnameVal || currentFullnameEl.textContent || '';
    };

    // initial load
    fetchAndPopulateUser();

    // Refresh button (page-level)
    // If user clicks the toolbar Refresh (#accountRefreshBtn) behave like the Dashboard: perform a full reload.
    // Support a fallback data-action for non-reload refreshes.
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('#accountRefreshBtn, [data-action="account-refresh"]');
      if (!btn) return;
      e.preventDefault();
      if (btn.matches && btn.matches('#accountRefreshBtn')) {
        try {
          btn.disabled = true;
          window.location.reload();
        } finally {
          // re-enable if reload is blocked
          window.setTimeout(() => { try { btn.disabled = false; } catch (e) {} }, 900);
        }
        return;
      }
      try { fetchAndPopulateUser(); } catch (err) { /* ignore */ }
    });

    const extractError = async (res) => {
      try {
        const payload = await res.json();
        if (payload?.message) return payload.message;
        if (payload?.errors) {
          const key = Object.keys(payload.errors)[0];
          return Array.isArray(payload.errors[key]) ? payload.errors[key][0] : String(payload.errors[key]);
        }
      } catch (e) {
        // ignore
      }
      return res.statusText || 'Request failed';
    };

    saveBtn?.addEventListener('click', async (e) => {
      e.preventDefault();
      const email = (emailInput?.value || '').trim();
      const current = currentPasswordInput?.value || '';
      const newpw = newPasswordInput?.value || '';
      const confirm = confirmPasswordInput?.value || '';

      const gmailRegex = /^[A-Za-z0-9._%+-]+@gmail\.com$/i;
      if (!email || !gmailRegex.test(email)) {
        showStatusLocal('Please enter a valid Gmail address.');
        return;
      }

      setLoadingLocal(true);
      try {
        const token = getToken();

        // Update profile (email and optional username)
        const updatePayload = {};
        if (email) updatePayload.email = email;
        if (usernameInput && usernameInput.value && usernameInput.value.trim()) updatePayload.username = usernameInput.value.trim();

        const emailRes = await fetch(`${API_BASE}/user`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(updatePayload),
        });

        if (!emailRes.ok) {
          const msg = await extractError(emailRes);
          setLoadingLocal(false);
          showStatusLocal(msg || 'Failed to update email.');
          return;
        }

        // If user provided password fields, attempt password change
        if (newpw || confirm) {
          if (!current) {
            setLoadingLocal(false);
            showStatusLocal('Current password is required to change password.');
            return;
          }
          if (newpw !== confirm) {
            setLoadingLocal(false);
            showStatusLocal('New password and confirmation do not match.');
            return;
          }

          const pwdRes = await fetch(`${API_BASE}/change-password`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ current_password: current, new_password: newpw, new_password_confirmation: confirm }),
          });

            if (!pwdRes.ok) {
            const msg = await extractError(pwdRes);
            setLoadingLocal(false);
            showStatusLocal(msg || 'Failed to change password.');
            return;
          }
        }

        // Persist a success marker and reload the page so the authoritative backend state is shown.
        try {
          sessionStorage.setItem('account_update_success', JSON.stringify({ message: 'Credentials updated successfully.', email }));
        } catch (e) { /* ignore */ }

        setLoadingLocal(false);
        try {
          if (saveBtn) saveBtn.disabled = true;
          window.location.reload();
        } finally {
          if (saveBtn) window.setTimeout(() => { try { saveBtn.disabled = false; } catch (e) {} }, 900);
        }
      } catch (err) {
        setLoadingLocal(false);
        showStatusLocal('Network error. Please try again.');
      }
    });

    cancelBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      if (emailInput) emailInput.value = '';
      if (currentPasswordInput) currentPasswordInput.value = '';
      if (newPasswordInput) newPasswordInput.value = '';
      if (confirmPasswordInput) confirmPasswordInput.value = '';
    });
  });
})();
