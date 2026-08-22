document.addEventListener("DOMContentLoaded", () => {
  const resolveApiBaseUrl = () => {
    const configured =
      window.APP_API_BASE_URL ||
      document
        .querySelector('meta[name="api-base-url"]')
        ?.getAttribute("content") ||
      "";

    if (configured.trim()) {
      return configured.replace(/\/+$/, "");
    }

    const protocol = String(window.location.protocol || "").toLowerCase();
    const hostname = String(window.location.hostname || "").toLowerCase();
    const origin = String(window.location.origin || "");
    const port = String(window.location.port || "");

    if (!/^https?:$/.test(protocol) || !hostname) {
      return "http://127.0.0.1:8000/api";
    }

    const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1";
    const isPort8000 = port === "8000";
    const isStandardWebPort = port === "" || port === "80" || port === "443";

    if (isPort8000 || (!isLocalHost && isStandardWebPort)) {
      return `${origin.replace(/\/+$/, "")}/api`;
    }

    if (isLocalHost) {
      return `${protocol}//${hostname}:8000/api`;
    }

    return `${origin.replace(/\/+$/, "")}/api`;
  };

  const API_BASE_URL = resolveApiBaseUrl();

  const token =
    (window.AdminSession && window.AdminSession.getToken()) ||
    localStorage.getItem("auth_token");
  if (!token) {
    window.location.href = "../admin-auth/auth.html";
    return;
  }

  // ── Staff guard: only admin may access User Management ──
  const cachedUser = window.AdminSession
    ? window.AdminSession.getUserInfo()
    : null;
  const currentRole = (
    cachedUser?.role ||
    cachedUser?.data?.role ||
    ""
  ).toLowerCase();
  if (currentRole === "staff") {
    // Staff should never see User Management — redirect to their dashboard.
    window.location.href = "../staff-page/dashboard.html";
    return;
  }

  const tableBody = document.getElementById("accountsTableBody");
  const tableMeta = document.getElementById("accountsTableMeta");
  const currentPageEl = document.getElementById("accountsCurrentPage");
  const prevBtn = document.getElementById("accountsPrevPage");
  const nextBtn = document.getElementById("accountsNextPage");
  const roleFilter = document.getElementById("accountsRoleFilter");
  const searchInput = document.getElementById("accountsSearchInput");
  const accountsTable = document.getElementById("accountsTable");
  const accountsTableFooter = document.getElementById("accountsTableFooter");
  const modalDeleteAccount = document.getElementById("modalDeleteAccount");
  const deleteAccountTargetLabel = document.getElementById(
    "deleteAccountTargetLabel",
  );
  const btnConfirmDeleteAccount = document.getElementById(
    "btnConfirmDeleteAccount",
  );

  const createForm = document.getElementById("adminCreateUserForm");
  const btnCreateUser = document.getElementById("btnCreateUser");
  const createName = document.getElementById("createUserName");
  const createRole = document.getElementById("createUserRole");
  const createUsername = document.getElementById("createUserUsername");
  const createUsernameSelect = document.getElementById(
    "createUserUsernameSelect",
  );
  const createEmail = document.getElementById("createUserEmail");
  const createPassword = document.getElementById("createUserPassword");
  const createPasswordConfirm = document.getElementById(
    "createUserPasswordConfirm",
  );
  const formStatus = document.getElementById("accountsFormStatus");

  const state = {
    users: [],
    currentPage: 1,
    pageSize: window.AdminTablePagination?.PAGE_SIZE || 10,
    activeDeleteId: 0,
  };
  let userBulkController = null;

  const getCurrentAdminId = () => {
    const directId = Number(cachedUser?.id || cachedUser?.data?.id || 0);
    if (directId) return directId;
    const email = String(cachedUser?.email || cachedUser?.data?.email || "")
      .trim()
      .toLowerCase();
    const username = String(
      cachedUser?.username || cachedUser?.data?.username || "",
    )
      .trim()
      .toLowerCase();
    const match = state.users.find(
      (user) =>
        (email && String(user?.email || "").toLowerCase() === email) ||
        (username &&
          String(user?.username || "").toLowerCase() === username),
    );
    return Number(match?.id || 0);
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
    [
      createName,
      createRole,
      createUsername,
      createUsernameSelect,
      createEmail,
      createPassword,
      createPasswordConfirm,
    ].forEach((input) => clearFieldError(input));
  };

  const toTitleCase = (value) => {
    const raw = String(value || "")
      .trim()
      .toLowerCase();
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

  // The signed-up-first Admin row is the portal's anchor: it must stay No. 001
  // on page 1. Every other account is newest-first, so a freshly created user
  // lands in row 2 instead of on the last page.
  const isAdminAccount = (user) =>
    String(user?.role || "").toLowerCase() === "admin";

  const sortAccountsForTable = (users) =>
    [...(Array.isArray(users) ? users : [])].sort((a, b) => {
      const adminRank = Number(isAdminAccount(b)) - Number(isAdminAccount(a));
      if (adminRank !== 0) return adminRank;

      const oldestFirst =
        toTimestamp(a?.created_at) - toTimestamp(b?.created_at) ||
        toNumericId(a?.id) - toNumericId(b?.id);

      // Admins keep their original order so the founding Admin stays first even
      // when a second Admin exists; everyone else is reversed.
      return isAdminAccount(a) ? oldestFirst : -oldestFirst;
    });

  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");

  const getFilteredUsers = () => {
    const role = String(roleFilter?.value || "all").toLowerCase();
    const query = String(searchInput?.value || "")
      .trim()
      .toLowerCase();

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
        "<tr><td colspan='8' style='text-align:center;'>No user accounts found for this filter.</td></tr>";
    } else {
      tableBody.innerHTML = paged
        .map((user, idx) => {
          const displayIndex = String(start + idx + 1).padStart(3, "0");
          const displayUsername = user?.username
            ? escapeHtml(user.username)
            : "N/A";
          const displayEmail = user?.email ? escapeHtml(user.email) : "N/A";
          const displayRole = toTitleCase(user?.role);
          const roleClass = `role-tag-${String(user?.role || "customer").toLowerCase()}`;
          const isCurrentAdmin = Number(user?.id) === getCurrentAdminId();

          return `
            <tr>
              <td class="admin-bulk-select-cell"><input type="checkbox" data-admin-bulk-row="users" value="${user.id}" aria-label="Select ${escapeHtml(user?.name || "user")}" ${isCurrentAdmin ? 'title="Your signed-in account cannot be deleted"' : ""} /></td>
              <td>${displayIndex}</td>
              <td>${escapeHtml(user?.name || "N/A")}</td>
              <td>${displayUsername}</td>
              <td>${displayEmail}</td>
              <td><span class="role-tag ${roleClass}">${displayRole}</span></td>
              <td>${formatDate(user?.created_at)}</td>
              <td class="action-icons sticky-action">
                <button type="button" data-tooltip="View User" data-user-view="${user.id}"><i class="fa-regular fa-eye"></i></button>
                <button type="button" data-tooltip="${isCurrentAdmin ? "Signed-in Admin cannot be deleted" : "Delete User"}" data-user-delete="${user.id}" ${isCurrentAdmin ? "disabled" : ""}><i class="fa-regular fa-trash-can"></i></button>
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

    if (currentPageEl) {
      currentPageEl.value = String(state.currentPage);
      currentPageEl.max = String(totalPages);
    }
    if (prevBtn) prevBtn.disabled = state.currentPage <= 1;
    if (nextBtn) nextBtn.disabled = state.currentPage >= totalPages;
    userBulkController?.sync();
  };

  const setupUserBulkSelection = () => {
    userBulkController = window.AdminBulkSelection?.create({
      key: "users",
      table: accountsTable,
      footer: accountsTableFooter,
      tableLabel: "User Directory",
      getEligibleRows: () =>
        getFilteredUsers().filter(
          (user) => Number(user?.id) !== getCurrentAdminId(),
        ),
      getPageRows: () => {
        const users = getFilteredUsers();
        const start = (state.currentPage - 1) * state.pageSize;
        return users.slice(start, start + state.pageSize);
      },
      idleAction: {
        label: "Select users to delete",
        icon: "fa-trash-can",
        className: "admin-bulk-delete",
      },
      actions: [
        {
          key: "delete",
          label: "Permanently delete selected users",
          icon: "fa-trash-can",
          className: "admin-bulk-delete",
          onClick: (ids, controller) => {
            window.runAdminBulkAction?.({
              controller,
              ids,
              action: "delete",
              tableLabel: "User Directory records",
              irreversible: true,
              loadingText: "Deleting...",
              execute: async (selectedIds) => {
                const response = await fetch(
                  `${API_BASE_URL}/users/delete-bulk`,
                  {
                    method: "DELETE",
                    headers: {
                      Authorization: `Bearer ${token}`,
                      Accept: "application/json",
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ ids: selectedIds }),
                  },
                );
                if (response.status === 401 || response.status === 403) {
                  setUnauthorizedState();
                }
                const payload = await response.json().catch(() => ({}));
                if (!response.ok) {
                  throw new Error(
                    payload?.message || "Unable to delete selected users.",
                  );
                }
                return payload;
              },
              afterSuccess: loadAccounts,
            });
          },
        },
      ],
    });
  };

  const setUnauthorizedState = () => {
    if (window.AdminSession) {
      window.AdminSession.clearSession();
    }
    localStorage.removeItem("auth_token");
    localStorage.removeItem("user_info");
    window.location.href = "../admin-auth/auth.html";
  };

  const loadAccounts = async () => {
    try {
      if (
        tableBody &&
        (!tableBody.children.length ||
          tableBody.querySelector(".table-empty-state"))
      ) {
        const usedSharedSkeleton = window.AdminTableSkeleton?.show(tableBody, {
          rows: 3,
          columns: 7,
        });
        if (!usedSharedSkeleton) {
          const cells = Array.from(
            { length: 7 },
            () => '<td><span class="admin-table-skeleton-bar"></span></td>',
          ).join("");
          tableBody.innerHTML = `<tr class="admin-table-skeleton-row" aria-hidden="true">${cells}</tr>`.repeat(
            3,
          );
        }
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
      state.users = sortAccountsForTable(fetchedUsers);
      state.currentPage = 1;
      renderTable();
    } catch (error) {
      console.error("Failed to load accounts:", error);
      if (tableBody) {
        tableBody.innerHTML =
          "<tr><td colspan='8' style='text-align:center;color:#991b1b;'>Could not load account data. Please refresh the page.</td></tr>";
      }
      if (tableMeta) tableMeta.textContent = "Account data is temporarily unavailable.";
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

  // Password Toggle Logic with SVG swapping
  const eyeOpenSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
  const eyeClosedSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

  // Setup password visibility toggles
  const setupPasswordToggles = () => {
    document.querySelectorAll(".toggle-pass").forEach((toggleBtn) => {
      toggleBtn.addEventListener("click", (event) => {
        event.preventDefault();
        const targetId = toggleBtn.getAttribute("data-target");
        const input = targetId ? document.getElementById(targetId) : null;
        if (!input) return;

        const isPassword = input.type === "password";
        input.type = isPassword ? "text" : "password";

        toggleBtn.innerHTML = isPassword ? eyeOpenSVG : eyeClosedSVG;
        toggleBtn.setAttribute(
          "aria-label",
          isPassword ? "Hide password" : "Show password",
        );
      });
    });
  };

  // Fetch staff members from backend
  const fetchStaffMembers = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/staff`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });

      if (response.ok) {
        const payload = await response.json();
        return Array.isArray(payload?.data) ? payload.data : [];
      }
    } catch (error) {
      console.error("Failed to fetch staff members:", error);
    }
    return [];
  };

  // Handle role change to show/hide Staff username selector
  const handleRoleChange = async (event) => {
    const selectedRole = String(createRole?.value || "customer").toLowerCase();
    if (selectedRole === "staff") {
      // Attempt to load staff members silently; do not block the form if none exist.
      const staffMembers = await fetchStaffMembers();

      if (Array.isArray(staffMembers) && staffMembers.length > 0) {
        // Populate the username select with available staff usernames
        if (createUsernameSelect) {
          createUsernameSelect.innerHTML = staffMembers
            .map(
              (s) =>
                `<option value="${escapeHtml(s.username || "")}">${escapeHtml(s.name || s.username || "")} (${escapeHtml(s.username || "")})</option>`,
            )
            .join("");
          createUsernameSelect.style.display = "block";
          createUsernameSelect.removeAttribute("aria-hidden");
        }
        if (createUsername) createUsername.style.display = "none";
      } else {
        // No staff available — show the manual username input so admin can type one.
        if (createUsernameSelect) {
          createUsernameSelect.style.display = "none";
          createUsernameSelect.setAttribute("aria-hidden", "true");
          createUsernameSelect.innerHTML = "";
        }
        if (createUsername) {
          createUsername.style.display = "block";
          createUsername.readOnly = false;
          createUsername.placeholder = "e.g. staff_jane";
        }
      }
    } else {
      // For customer role, username is editable
      if (createUsernameSelect) {
        createUsernameSelect.style.display = "none";
        createUsernameSelect.setAttribute("aria-hidden", "true");
        createUsernameSelect.innerHTML = "";
      }
      if (createUsername) {
        createUsername.style.display = "block";
        createUsername.readOnly = false;
        createUsername.placeholder = "e.g. customer_name";
      }
    }
  };

  const getUsernameValue = () => {
    const sel = document.getElementById("createUserUsernameSelect");
    if (sel && sel.style.display !== "none")
      return String(sel.value || "").trim();
    const inp = document.getElementById("createUserUsername");
    return String(inp?.value || "").trim();
  };

  const getUsernameElementForValidation = () => {
    const sel = document.getElementById("createUserUsernameSelect");
    if (sel && sel.style.display !== "none") return sel;
    return document.getElementById("createUserUsername");
  };

  const createAccount = async (event) => {
    event.preventDefault();
    clearCreateFormErrors();

    const name = String(createName?.value || "").trim();
    const role = String(createRole?.value || "customer")
      .trim()
      .toLowerCase();
    const username = getUsernameValue();
    const email = String(createEmail?.value || "").trim();
    const password = String(createPassword?.value || "");
    const passwordConfirmation = String(createPasswordConfirm?.value || "");

    let hasError = false;

    if (!name) {
      setFieldError(createName, "Full Name is required.");
      updateFormStatus("Full Name is required.", true);
      hasError = true;
    }

    // Both Username and Gmail are now required
    if (!username) {
      setFieldError(getUsernameElementForValidation(), "Username is required.");
      updateFormStatus("Username is required.", true);
      hasError = true;
    }

    if (!email) {
      setFieldError(createEmail, "Gmail is required.");
      updateFormStatus("Gmail is required.", true);
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
      const firstErrorInput = createForm?.querySelector(
        ".field-stack.has-error input, .field-stack.has-error select",
      );
      if (firstErrorInput instanceof HTMLElement) firstErrorInput.focus();
      return;
    }

    const originalCreateButtonHtml = btnCreateUser?.innerHTML || "";
    if (btnCreateUser) {
      btnCreateUser.disabled = true;
      btnCreateUser.innerHTML =
        '<i class="fa-solid fa-spinner fa-spin"></i> Creating Account...';
    }

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
          username,
          email,
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
          if (errors.name?.[0])
            setFieldError(createName, String(errors.name[0]));
          if (errors.role?.[0])
            setFieldError(createRole, String(errors.role[0]));
          if (errors.username?.[0])
            setFieldError(createUsername, String(errors.username[0]));
          if (errors.email?.[0])
            setFieldError(createEmail, String(errors.email[0]));
          if (errors.password?.[0])
            setFieldError(createPassword, String(errors.password[0]));
          const firstError = Object.values(errors)[0]?.[0];
          updateFormStatus(
            String(firstError || "Please review your input."),
            true,
          );
        } else {
          updateFormStatus(
            payload?.message || "Unable to create account right now.",
            true,
          );
        }
        return;
      }

      createForm?.reset();
      clearCreateFormErrors();
      window.showAdminPopup?.("New user account created successfully.", {
        title: "Account Created",
      });
      await loadAccounts();
    } catch (error) {
      console.error("Failed to create account:", error);
      updateFormStatus(
        "Unable to connect to server. Ensure Laravel is running.",
        true,
      );
    } finally {
      if (btnCreateUser) {
        btnCreateUser.disabled = false;
        btnCreateUser.innerHTML = originalCreateButtonHtml ||
          '<i class="fa-solid fa-user-plus"></i> Create Account';
      }
    }
  };

  prevBtn?.addEventListener("click", () => {
    state.currentPage -= 1;
    renderTable();
  });

  window.AdminPageNumberInput?.bind(currentPageEl, {
    getPage: () => state.currentPage,
    getTotalPages: () =>
      Math.max(1, Math.ceil(getFilteredUsers().length / state.pageSize)),
    onChange: (page) => {
      state.currentPage = page;
      renderTable();
    },
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
      if (viewTitle)
        viewTitle.textContent = escapeHtml(user?.name || "User Details");
      if (viewContent) {
        const roleClass = `role-tag-${String(user?.role || "customer").toLowerCase()}`;
        const hasCustomPassword = user?.has_custom_password !== false;
        const passwordStatusClass = hasCustomPassword
          ? "password-status-set"
          : "password-status-pending";
        const passwordStatusLabel = hasCustomPassword ? "Set" : "Not set";
        viewContent.innerHTML = `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 18px;">
            <div><div style="font-size:.73rem;color:#9ca3af;font-weight:700;text-transform:uppercase;">Full Name</div><div style="font-size:.88rem;color:#111827;font-weight:500;">${escapeHtml(user?.name || "N/A")}</div></div>
            <div><div style="font-size:.73rem;color:#9ca3af;font-weight:700;text-transform:uppercase;">Role</div><div><span class="role-tag ${roleClass}">${toTitleCase(user?.role)}</span></div></div>
            <div><div style="font-size:.73rem;color:#9ca3af;font-weight:700;text-transform:uppercase;">Username</div><div style="font-size:.88rem;color:#111827;">${escapeHtml(user?.username || "N/A")}</div></div>
            <div><div style="font-size:.73rem;color:#9ca3af;font-weight:700;text-transform:uppercase;">Email</div><div style="font-size:.88rem;color:#111827;word-break:break-word;">${escapeHtml(user?.email || "N/A")}</div></div>
            <div><div style="font-size:.73rem;color:#9ca3af;font-weight:700;text-transform:uppercase;">Password Sign-in</div><div><span class="password-status ${passwordStatusClass}">${passwordStatusLabel}</span></div></div>
            <div><div style="font-size:.73rem;color:#9ca3af;font-weight:700;text-transform:uppercase;">Google Sign-in</div><div style="font-size:.88rem;color:#111827;">${user?.signed_with_google === true ? "Enabled" : "Not used"}</div></div>
            <div style="grid-column:1/-1;"><div style="font-size:.73rem;color:#9ca3af;font-weight:700;text-transform:uppercase;">Date Created</div><div style="font-size:.88rem;color:#111827;">${formatDate(user?.created_at)}</div></div>
          </div>`;
      }
      modalViewUser?.classList.add("show");
      document.getElementById("btnCloseViewUser")?.addEventListener(
        "click",
        () => {
          modalViewUser?.classList.remove("show");
        },
        { once: true },
      );
      return;
    }

    const editBtn = target.closest("[data-user-edit]");
    if (editBtn) {
      window.showAdminPopup?.("Edit action will be added soon.", {
        title: "Coming Soon",
      });
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

    const originalDeleteButtonHtml = btnConfirmDeleteAccount.innerHTML;
    btnConfirmDeleteAccount.disabled = true;
    btnConfirmDeleteAccount.innerHTML =
      '<i class="fa-solid fa-spinner fa-spin"></i> Deleting...';

    try {
      const deleted = await removeAccount(state.activeDeleteId);
      if (!deleted) return;

      state.activeDeleteId = 0;
      modalDeleteAccount?.classList.remove("show");
      await loadAccounts();
      window.showAdminPopup?.("Account deleted successfully.", {
        title: "Deleted",
      });
    } finally {
      btnConfirmDeleteAccount.disabled = false;
      btnConfirmDeleteAccount.innerHTML = originalDeleteButtonHtml;
    }
  });

  roleFilter?.addEventListener("change", () => {
    state.currentPage = 1;
    renderTable();
  });

  searchInput?.addEventListener("input", () => {
    state.currentPage = 1;
    renderTable();
  });

  [
    createName,
    createRole,
    createUsername,
    createUsernameSelect,
    createEmail,
    createPassword,
    createPasswordConfirm,
  ].forEach((input) => {
    input?.addEventListener("input", () => {
      clearFieldError(input);
    });
    input?.addEventListener("change", () => {
      clearFieldError(input);
    });
  });

  // Add event listener for role changes to handle Staff username behavior
  createRole?.addEventListener("change", handleRoleChange);

  createForm?.addEventListener("submit", createAccount);

  // Initialize password toggles on page load
  setupPasswordToggles();
  setupUserBulkSelection();

  void loadAccounts();
});
