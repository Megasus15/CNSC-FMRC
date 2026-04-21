document.addEventListener("DOMContentLoaded", () => {
  const API_BASE_URL =
    window.APP_API_BASE_URL ||
    document.querySelector('meta[name="api-base-url"]')?.getAttribute("content") ||
    `${window.location.protocol}//${window.location.hostname}:8000/api`;

  const token = localStorage.getItem("auth_token");
  if (!token) {
    window.location.href = "../admin-auth/auth.html";
    return;
  }

  const tableBody = document.getElementById("accountsTableBody");
  const tableMeta = document.getElementById("accountsTableMeta");
  const currentPageEl = document.getElementById("accountsCurrentPage");
  const prevBtn = document.getElementById("accountsPrevPage");
  const nextBtn = document.getElementById("accountsNextPage");
  const roleFilter = document.getElementById("accountsRoleFilter");
  const searchInput = document.getElementById("accountsSearchInput");
  const modalDeleteAccount = document.getElementById("modalDeleteAccount");
  const deleteAccountTargetLabel = document.getElementById("deleteAccountTargetLabel");
  const btnConfirmDeleteAccount = document.getElementById("btnConfirmDeleteAccount");

  const createForm = document.getElementById("adminCreateUserForm");
  const createName = document.getElementById("createUserName");
  const createRole = document.getElementById("createUserRole");
  const createUsername = document.getElementById("createUserUsername");
  const createEmail = document.getElementById("createUserEmail");
  const createPassword = document.getElementById("createUserPassword");
  const createPasswordConfirm = document.getElementById("createUserPasswordConfirm");
  const formStatus = document.getElementById("accountsFormStatus");

  const state = {
    users: [],
    currentPage: 1,
    pageSize: 5,
    activeDeleteId: 0,
  };

  const setFieldError = (input, message) => {
    if (!input) return;
    const field = input.closest(".field-stack");
    if (!field) return;

    let bubble = field.querySelector(".field-error-bubble");
    if (!bubble) {
      bubble = document.createElement("div");
      bubble.className = "field-error-bubble";
      bubble.setAttribute("role", "alert");
      field.appendChild(bubble);
    }

    bubble.textContent = message;
    field.classList.add("has-error");
    input.setAttribute("aria-invalid", "true");
  };

  const clearFieldError = (input) => {
    if (!input) return;
    const field = input.closest(".field-stack");
    if (!field) return;

    field.classList.remove("has-error");
    input.removeAttribute("aria-invalid");
    const bubble = field.querySelector(".field-error-bubble");
    if (bubble) bubble.remove();
  };

  const clearCreateFormErrors = () => {
    [createName, createRole, createUsername, createEmail, createPassword, createPasswordConfirm].forEach(
      (input) => clearFieldError(input)
    );
  };

  const toTitleCase = (value) => {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) return "N/A";
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  };

  const formatDate = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "N/A";
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const toTimestamp = (value) => {
    const ts = Date.parse(String(value || ""));
    return Number.isFinite(ts) ? ts : 0;
  };

  const toNumericId = (value) => {
    const parsed = Number(String(value ?? "").replace(/[^0-9]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");

  const getFilteredUsers = () => {
    const role = String(roleFilter?.value || "all").toLowerCase();
    const query = String(searchInput?.value || "").trim().toLowerCase();

    return state.users.filter((user) => {
      const userRole = String(user?.role || "").toLowerCase();
      if (role !== "all" && userRole !== role) return false;

      if (!query) return true;
      const haystack = [user?.name, user?.username, user?.email, user?.role]
        .map((value) => String(value || "").toLowerCase())
        .join(" ");
      return haystack.includes(query);
    });
  };

  const renderTable = () => {
    if (!tableBody) return;

    const users = getFilteredUsers();
    const totalRows = users.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / state.pageSize));
    state.currentPage = Math.min(Math.max(1, state.currentPage), totalPages);

    const start = (state.currentPage - 1) * state.pageSize;
    const paged = users.slice(start, start + state.pageSize);

    if (!paged.length) {
      tableBody.innerHTML =
        "<tr><td colspan='7' style='text-align:center;'>No user accounts found for this filter.</td></tr>";
    } else {
      tableBody.innerHTML = paged
        .map((user, idx) => {
          const displayIndex = String(start + idx + 1).padStart(3, "0");
          const displayUsername = user?.username ? escapeHtml(user.username) : "N/A";
          const displayEmail = user?.email ? escapeHtml(user.email) : "N/A";
          const displayRole = toTitleCase(user?.role);
          const roleClass = `role-tag-${String(user?.role || "customer").toLowerCase()}`;

          return `
            <tr>
              <td>${displayIndex}</td>
              <td>${escapeHtml(user?.name || "N/A")}</td>
              <td>${displayUsername}</td>
              <td>${displayEmail}</td>
              <td><span class="role-tag ${roleClass}">${displayRole}</span></td>
              <td>${formatDate(user?.created_at)}</td>
              <td class="action-icons sticky-action">
                <button type="button" data-tooltip="View User" data-user-view="${user.id}"><i class="fa-regular fa-eye"></i></button>
                <button type="button" data-tooltip="Delete User" data-user-delete="${user.id}"><i class="fa-regular fa-trash-can"></i></button>
              </td>
            </tr>
          `;
        })
        .join("");
    }

    if (tableMeta) {
      const startIndex = totalRows ? start + 1 : 0;
      const endIndex = Math.min(start + state.pageSize, totalRows);
      tableMeta.textContent = `Showing ${startIndex}-${endIndex} of ${totalRows} users`;
    }

    if (currentPageEl) currentPageEl.textContent = String(state.currentPage);
    if (prevBtn) prevBtn.disabled = state.currentPage <= 1;
    if (nextBtn) nextBtn.disabled = state.currentPage >= totalPages;
  };

  const setUnauthorizedState = () => {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("user_info");
    window.location.href = "../admin-auth/auth.html";
  };

  const loadAccounts = async () => {
    try {
      if (tableBody && (!tableBody.children.length || tableBody.querySelector(".table-empty-state"))) {
        tableBody.innerHTML = `<tr>
          <td><div class="skeleton-text" style="width:20px;"></div></td>
          <td>
            <div style="display:flex;align-items:center;gap:12px;">
              <div class="skeleton-avatar" style="width:36px;height:36px;border-radius:50%;"></div>
              <div style="flex:1;">
                <div class="skeleton-text" style="width:120px;margin-bottom:6px;"></div>
                <div class="skeleton-text" style="width:100px;"></div>
              </div>
            </div>
          </td>
          <td><div class="skeleton-text" style="width:90px;"></div></td>
          <td><div class="skeleton-text" style="width:70px;"></div></td>
          <td><div class="skeleton-text" style="width:140px;"></div></td>
          <td><div class="skeleton-text" style="width:120px;"></div></td>
          <td><div class="skeleton-avatar" style="width:24px;height:24px;"></div></td>
        </tr>`.repeat(4);
      }

      const response = await fetch(`${API_BASE_URL}/users`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });

      if (response.status === 401 || response.status === 403) {
        setUnauthorizedState();
        return;
      }

      if (!response.ok) {
        throw new Error("Unable to fetch users.");
      }

      const payload = await response.json();
      const fetchedUsers = Array.isArray(payload?.data) ? payload.data : [];
      state.users = [...fetchedUsers].sort(
        (a, b) =>
          toTimestamp(a?.created_at) - toTimestamp(b?.created_at) ||
          toNumericId(a?.id) - toNumericId(b?.id),
      );
      state.currentPage = 1;
      renderTable();
    } catch (error) {
      console.error("Failed to load accounts:", error);
      if (tableBody) {
        tableBody.innerHTML =
          "<tr><td colspan='7' style='text-align:center;color:#991b1b;'>Could not load accounts. Ensure Laravel server is running.</td></tr>";
      }
      if (tableMeta) tableMeta.textContent = "Unable to fetch account data.";
    }
  };

  const removeAccount = async (userId) => {
    const response = await fetch(`${API_BASE_URL}/users/${userId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (response.status === 401 || response.status === 403) {
      setUnauthorizedState();
      return false;
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      window.showAdminPopup?.(payload?.message || "Unable to delete account.", {
        title: "Delete Failed",
      });
      return false;
    }

    return true;
  };

  const updateFormStatus = (message, isError = false) => {
    if (!formStatus) return;
    formStatus.textContent = message || "";
    formStatus.style.color = isError ? "#991b1b" : "#475569";
  };

  const createAccount = async (event) => {
    event.preventDefault();
    clearCreateFormErrors();

    const name = String(createName?.value || "").trim();
    const role = String(createRole?.value || "customer").trim().toLowerCase();
    const username = String(createUsername?.value || "").trim();
    const email = String(createEmail?.value || "").trim();
    const password = String(createPassword?.value || "");
    const passwordConfirmation = String(createPasswordConfirm?.value || "");

    let hasError = false;

    if (!name) {
      setFieldError(createName, "Full Name is required.");
      updateFormStatus("Full Name is required.", true);
      hasError = true;
    }
    if (!username && !email) {
      setFieldError(createUsername, "Provide username or Gmail.");
      setFieldError(createEmail, "Provide username or Gmail.");
      updateFormStatus("Please provide at least a Username or Gmail.", true);
      hasError = true;
    }
    if (email && !/^[A-Za-z0-9._%+-]+@gmail\.com$/i.test(email)) {
      setFieldError(createEmail, "Use a valid @gmail.com address.");
      updateFormStatus("Gmail must be a valid @gmail.com address.", true);
      hasError = true;
    }
    if (password.length < 8) {
      setFieldError(createPassword, "Password must be at least 8 characters.");
      updateFormStatus("Password must be at least 8 characters.", true);
      hasError = true;
    }
    if (password !== passwordConfirmation) {
      setFieldError(createPasswordConfirm, "Confirm Password does not match.");
      updateFormStatus("Confirm Password does not match.", true);
      hasError = true;
    }

    if (hasError) {
      const firstErrorInput = createForm?.querySelector(".field-stack.has-error input, .field-stack.has-error select");
      if (firstErrorInput instanceof HTMLElement) firstErrorInput.focus();
      return;
    }

    updateFormStatus("Creating account...");

    try {
      const response = await fetch(`${API_BASE_URL}/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        body: JSON.stringify({
          name,
          role,
          username: username || null,
          email: email || null,
          password,
          password_confirmation: passwordConfirmation,
        }),
      });

      if (response.status === 401 || response.status === 403) {
        setUnauthorizedState();
        return;
      }

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (response.status === 422 && payload?.errors) {
          const errors = payload.errors;
          if (errors.name?.[0]) setFieldError(createName, String(errors.name[0]));
          if (errors.role?.[0]) setFieldError(createRole, String(errors.role[0]));
          if (errors.username?.[0]) setFieldError(createUsername, String(errors.username[0]));
          if (errors.email?.[0]) setFieldError(createEmail, String(errors.email[0]));
          if (errors.password?.[0]) setFieldError(createPassword, String(errors.password[0]));
          const firstError = Object.values(errors)[0]?.[0];
          updateFormStatus(String(firstError || "Please review your input."), true);
        } else {
          updateFormStatus(payload?.message || "Unable to create account right now.", true);
        }
        return;
      }

      createForm?.reset();
      clearCreateFormErrors();
      updateFormStatus("Account created successfully.");
      window.showAdminPopup?.("New user account created successfully.", { title: "Account Created" });
      await loadAccounts();
    } catch (error) {
      console.error("Failed to create account:", error);
      updateFormStatus("Unable to connect to server. Ensure Laravel is running.", true);
    }
  };

  prevBtn?.addEventListener("click", () => {
    state.currentPage -= 1;
    renderTable();
  });

  tableBody?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const viewBtn = target.closest("[data-user-view]");
    if (viewBtn) {
      const userId = Number(viewBtn.getAttribute("data-user-view") || 0);
      const user = state.users.find((u) => Number(u.id) === userId);
      if (!user) return;
      const viewTitle = document.getElementById("viewUserTitle");
      const viewContent = document.getElementById("viewUserContent");
      const modalViewUser = document.getElementById("modalViewUser");
      if (viewTitle) viewTitle.textContent = escapeHtml(user?.name || "User Details");
      if (viewContent) {
        const roleClass = `role-tag-${String(user?.role || "customer").toLowerCase()}`;
        viewContent.innerHTML = `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 18px;">
            <div><div style="font-size:.73rem;color:#9ca3af;font-weight:700;text-transform:uppercase;">Full Name</div><div style="font-size:.88rem;color:#111827;font-weight:500;">${escapeHtml(user?.name || "N/A")}</div></div>
            <div><div style="font-size:.73rem;color:#9ca3af;font-weight:700;text-transform:uppercase;">Role</div><div><span class="role-tag ${roleClass}">${toTitleCase(user?.role)}</span></div></div>
            <div><div style="font-size:.73rem;color:#9ca3af;font-weight:700;text-transform:uppercase;">Username</div><div style="font-size:.88rem;color:#111827;">${escapeHtml(user?.username || 'N/A')}</div></div>
            <div><div style="font-size:.73rem;color:#9ca3af;font-weight:700;text-transform:uppercase;">Email</div><div style="font-size:.88rem;color:#111827;word-break:break-word;">${escapeHtml(user?.email || 'N/A')}</div></div>
            <div style="grid-column:1/-1;"><div style="font-size:.73rem;color:#9ca3af;font-weight:700;text-transform:uppercase;">Date Created</div><div style="font-size:.88rem;color:#111827;">${formatDate(user?.created_at)}</div></div>
          </div>`;
      }
      modalViewUser?.classList.add("show");
      document.getElementById("btnCloseViewUser")?.addEventListener("click", () => {
        modalViewUser?.classList.remove("show");
      }, { once: true });
      return;
    }

    const editBtn = target.closest("[data-user-edit]");
    if (editBtn) {
      window.showAdminPopup?.("Edit action will be added soon.", { title: "Coming Soon" });
      return;
    }

    const deleteBtn = target.closest("[data-user-delete]");
    if (!deleteBtn) return;

    const userId = Number(deleteBtn.getAttribute("data-user-delete") || 0);
    if (!userId) return;
    state.activeDeleteId = userId;

    const selected = state.users.find((user) => Number(user.id) === userId);
    if (deleteAccountTargetLabel) {
      deleteAccountTargetLabel.textContent = selected?.name || "this account";
    }

    modalDeleteAccount?.classList.add("show");
  });

  nextBtn?.addEventListener("click", () => {
    state.currentPage += 1;
    renderTable();
  });

  btnConfirmDeleteAccount?.addEventListener("click", async () => {
    if (!state.activeDeleteId) return;

    const deleted = await removeAccount(state.activeDeleteId);
    if (!deleted) return;

    state.activeDeleteId = 0;
    modalDeleteAccount?.classList.remove("show");
    await loadAccounts();
    window.showAdminPopup?.("Account deleted successfully.", { title: "Deleted" });
  });

  roleFilter?.addEventListener("change", () => {
    state.currentPage = 1;
    renderTable();
  });

  searchInput?.addEventListener("input", () => {
    state.currentPage = 1;
    renderTable();
  });

  [createName, createRole, createUsername, createEmail, createPassword, createPasswordConfirm].forEach(
    (input) => {
      input?.addEventListener("input", () => {
        clearFieldError(input);
      });
      input?.addEventListener("change", () => {
        clearFieldError(input);
      });
    }
  );

  createForm?.addEventListener("submit", createAccount);

  void loadAccounts();
});