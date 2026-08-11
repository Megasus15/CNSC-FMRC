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
    localStorage.getItem("auth_token") ||
    "";
  const REALTIME_SIGNAL_KEY = "fmrc_customer_msgs_updated_at";
  const REALTIME_CHANNEL_KEY = "fmrc-customer-messages-realtime";
  const MANILA_TZ = "Asia/Manila";
  const PAGE_SIZE = 8;

  const tableBody = document.getElementById("inquiriesTableBody");
  const inquiriesTable = document.getElementById("inquiriesTable");
  const inquiriesFooter = document.getElementById("inquiriesFooter");
  const statusFilter = document.getElementById("inquiryStatusFilter");
  const searchInput = document.getElementById("inquirySearchInput");
  const refreshBtn = document.getElementById("inquiriesRefreshBtn");

  const statTotal = document.getElementById("statTotal");
  const statNew = document.getElementById("statNew");
  const statUnread = document.getElementById("statUnread");
  const statResolved = document.getElementById("statResolved");

  const pageMeta = document.getElementById("inquiriesMeta");
  const pageNumber = document.getElementById("inquiriesPageNumber");
  const prevBtn = document.getElementById("inquiriesPrevBtn");
  const nextBtn = document.getElementById("inquiriesNextBtn");

  const detailModal = document.getElementById("inquiryDetailModal");
  const detailSenderName = document.getElementById("detailSenderName");
  const detailSenderEmail = document.getElementById("detailSenderEmail");
  const detailSubmittedAt = document.getElementById("detailSubmittedAt");
  const detailStatus = document.getElementById("detailStatus");
  const detailMessage = document.getElementById("detailMessage");
  const detailResolveBtn = document.getElementById("detailResolveBtn");

  const state = {
    rows: [],
    summary: { total: 0, new: 0, unread: 0, resolved: 0 },
    currentPage: 1,
    isLoading: false,
    selectedId: null,
    lastSignalTs: 0,
    realtimeChannel: null,
  };
  let inquiryBulkController = null;

  if (!tableBody) return;

  const escapeHtml = (value) =>
    String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const formatDateTime = (value) => {
    const date = new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString("en-PH", {
      timeZone: MANILA_TZ,
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const renderSkeletonRows = (columns, rows = 3) => {
    if (window.AdminTableSkeleton) {
      return window.AdminTableSkeleton.build(tableBody, { rows, columns });
    }
    const cells = Array.from(
      { length: columns },
      () => '<td><span class="admin-table-skeleton-bar"></span></td>',
    ).join("");
    return `<tr class="admin-table-skeleton-row" aria-hidden="true">${cells}</tr>`.repeat(
      rows,
    );
  };

  const getRealtimeChannel = () => {
    if (typeof window.BroadcastChannel !== "function") return null;
    if (!state.realtimeChannel) {
      state.realtimeChannel = new window.BroadcastChannel(REALTIME_CHANNEL_KEY);
    }
    return state.realtimeChannel;
  };

  const emitRealtimeUpdate = (detail = {}) => {
    const payload = {
      timestamp: Date.now(),
      source: "customer-inquiries",
      ...detail,
    };

    window.dispatchEvent(
      new CustomEvent("fmrc:customer-messages-updated", { detail: payload }),
    );

    try {
      localStorage.setItem(REALTIME_SIGNAL_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage issues.
    }

    getRealtimeChannel()?.postMessage(payload);
  };

  const shouldProcessSignal = (payload = {}) => {
    const ts = Number(payload.timestamp || 0);
    if (!Number.isFinite(ts) || ts <= 0) return true;
    if (ts <= state.lastSignalTs) return false;
    state.lastSignalTs = ts;
    return true;
  };

  const showPopup = (message, options = {}) => {
    if (typeof window.showAdminPopup === "function") {
      window.showAdminPopup(message, options);
      return;
    }
    window.alert(message);
  };

  const askConfirm = (message, options = {}) =>
    new Promise((resolve) => {
      if (typeof window.showAdminConfirmPopup === "function") {
        window.showAdminConfirmPopup(message, {
          title: options.title || "Please Confirm",
          confirmText: options.confirmText || "Confirm",
          cancelText: options.cancelText || "Cancel",
          onConfirm: () => resolve(true),
          onCancel: () => resolve(false),
        });
        return;
      }
      resolve(window.confirm(message));
    });

  const request = async (path, options = {}) => {
    const headers = {
      Accept: "application/json",
      ...(options.headers || {}),
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    if (Object.prototype.hasOwnProperty.call(options, "body")) {
      headers["Content-Type"] = "application/json";
    }

    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method || "GET",
      headers,
      body: Object.prototype.hasOwnProperty.call(options, "body")
        ? JSON.stringify(options.body)
        : undefined,
      cache: "no-store",
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(
        data.message || `Request failed with status ${res.status}.`,
      );
      err.status = res.status;
      throw err;
    }

    return data;
  };

  const setLoadingState = (active) => {
    state.isLoading = active;
    if (refreshBtn) {
      refreshBtn.disabled = active;
      refreshBtn.classList.toggle("is-disabled", active);
    }

    if (active) {
      const usedSharedSkeleton = window.AdminTableSkeleton?.show(tableBody, {
        rows: 3,
        columns: 7,
      });
      if (!usedSharedSkeleton) tableBody.innerHTML = renderSkeletonRows(7);
      pageMeta.textContent = "Loading…";
      pageNumber.value = "1";
      pageNumber.max = "1";
      prevBtn.disabled = true;
      nextBtn.disabled = true;
    } else {
      window.AdminTableSkeleton?.finish(tableBody);
    }
  };

  const updateStats = () => {
    statTotal.textContent = String(state.summary.total || 0);
    statNew.textContent = String(state.summary.new || 0);
    statUnread.textContent = String(state.summary.unread || 0);
    statResolved.textContent = String(state.summary.resolved || 0);
  };

  const renderEmpty = (message) => {
    tableBody.innerHTML = `
      <tr class="table-empty-row">
        <td colspan="7">
          <div class="table-empty-state">
            <i class="fa-regular fa-folder-open"></i>
            <span>${escapeHtml(message)}</span>
          </div>
        </td>
      </tr>
    `;
    pageMeta.textContent = "Page 1 of 1";
    pageNumber.value = "1";
    pageNumber.max = "1";
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    inquiryBulkController?.sync();
  };

  const renderRows = () => {
    const rows = Array.isArray(state.rows) ? state.rows : [];

    if (!rows.length) {
      renderEmpty("No customer inquiries found.");
      return;
    }

    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    state.currentPage = Math.min(Math.max(state.currentPage, 1), totalPages);

    const start = (state.currentPage - 1) * PAGE_SIZE;
    const pageRows = rows.slice(start, start + PAGE_SIZE);

    tableBody.innerHTML = pageRows
      .map((row) => {
        const statusClass =
          row.status === "resolved" ? "inq-status-resolved" : "inq-status-new";
        const statusText = row.status === "resolved" ? "Resolved" : "New";
        const readClass = row.is_read ? "read" : "unread";
        const readText = row.is_read ? "Read" : "Unread";

        return `
          <tr data-row-id="${row.id}">
            <td class="admin-bulk-select-cell"><input type="checkbox" data-admin-bulk-row="inquiries" value="${row.id}" aria-label="Select inquiry from ${escapeHtml(row.sender_name)}" /></td>
            <td class="inq-name-cell">
              <div><strong>${escapeHtml(row.sender_name)}</strong></div>
              <div class="inq-text-muted">${escapeHtml(row.sender_email)}</div>
            </td>
            <td><div class="inq-message-preview">${escapeHtml(row.message)}</div></td>
            <td>${escapeHtml(formatDateTime(row.created_at))}</td>
            <td><span class="inq-status-pill ${statusClass}">${statusText}</span></td>
            <td><span class="inq-read-badge ${readClass}">${readText}</span></td>
            <td class="sticky-action">
              <div class="inquiry-table-actions">
                <button type="button" class="btn-compact" data-action="view" data-id="${row.id}" title="View details"><i class="fa-regular fa-eye"></i></button>
                <button type="button" class="btn-compact" data-action="read" data-id="${row.id}" title="Mark as read" ${row.is_read ? "disabled" : ""}><i class="fa-solid fa-envelope-open-text"></i></button>
                <button type="button" class="btn-compact" data-action="resolve" data-id="${row.id}" title="Resolve message" ${row.status === "resolved" ? "disabled" : ""}><i class="fa-solid fa-check"></i></button>
                <button type="button" class="btn-compact btn-danger" data-action="delete" data-id="${row.id}" title="Delete message"><i class="fa-regular fa-trash-can"></i></button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");

    pageMeta.textContent = `Page ${state.currentPage} of ${totalPages}`;
    pageNumber.value = String(state.currentPage);
    pageNumber.max = String(totalPages);
    prevBtn.disabled = state.currentPage <= 1;
    nextBtn.disabled = state.currentPage >= totalPages;
    inquiryBulkController?.sync();
  };

  const setupInquiryBulkSelection = () => {
    inquiryBulkController = window.AdminBulkSelection?.create({
      key: "inquiries",
      table: inquiriesTable,
      footer: inquiriesFooter,
      tableLabel: "Inbox Directory",
      getEligibleRows: () => state.rows,
      getPageRows: () => {
        const start = (state.currentPage - 1) * PAGE_SIZE;
        return state.rows.slice(start, start + PAGE_SIZE);
      },
      idleAction: {
        label: "Select inquiries to delete",
        icon: "fa-trash-can",
        className: "admin-bulk-delete",
      },
      actions: [
        {
          key: "delete",
          label: "Permanently delete selected inquiries",
          icon: "fa-trash-can",
          className: "admin-bulk-delete",
          onClick: (ids, controller) => {
            window.runAdminBulkAction?.({
              controller,
              ids,
              action: "delete",
              tableLabel: "Inbox Directory records",
              irreversible: true,
              loadingText: "Deleting...",
              execute: (selectedIds) =>
                request("/admin/customer-messages/delete-bulk", {
                  method: "DELETE",
                  body: { ids: selectedIds },
                }),
              afterSuccess: async (payload) => {
                emitRealtimeUpdate({
                  action: "delete-bulk",
                  ids: payload?.processed_ids || [],
                });
                await syncData(true);
              },
            });
          },
        },
      ],
    });
  };

  const openDetail = (id) => {
    const row = state.rows.find((item) => String(item.id) === String(id));
    if (!row) return;

    state.selectedId = row.id;
    detailSenderName.textContent = row.sender_name || "-";
    detailSenderEmail.textContent = row.sender_email || "-";
    detailSubmittedAt.textContent = formatDateTime(row.created_at);
    detailStatus.textContent = row.status === "resolved" ? "Resolved" : "New";
    detailMessage.textContent = row.message || "-";
    detailResolveBtn.disabled = row.status === "resolved";

    detailModal.classList.add("show");
  };

  const closeDetail = () => {
    detailModal.classList.remove("show");
  };

  const syncData = async (isSilent = false) => {
    if (!token) {
      if (!isSilent) {
        showPopup("Session not found. Please log in again.", {
          title: "Authentication Required",
        });
      }
      return;
    }

    if (!isSilent) setLoadingState(true);

    try {
      const status = encodeURIComponent(statusFilter?.value || "all");
      const search = encodeURIComponent((searchInput?.value || "").trim());
      const query = `/admin/customer-messages?status=${status}&search=${search}`;
      const payload = await request(query);

      state.rows = Array.isArray(payload.data) ? payload.data : [];
      state.summary = payload.summary || {
        total: 0,
        new: 0,
        unread: 0,
        resolved: 0,
      };
      updateStats();
      renderRows();
    } catch (error) {
      if (!isSilent) {
        renderEmpty("Unable to load customer inquiries. Please try again.");
        showPopup(error.message || "Failed to load customer inquiries.", {
          title: "Load Failed",
        });
      }
    } finally {
      if (!isSilent) setLoadingState(false);
    }
  };

  const markRead = async (id, silent = false) => {
    try {
      await request(`/admin/customer-messages/${id}/read`, { method: "PATCH" });
      emitRealtimeUpdate({ action: "read", id });
      await syncData(true);
      if (!silent) {
        showPopup("Inquiry marked as read.", { title: "Updated" });
      }
    } catch (error) {
      if (!silent) {
        showPopup(error.message || "Unable to mark inquiry as read.", {
          title: "Update Failed",
        });
      }
    }
  };

  const resolveInquiry = async (id, silent = false) => {
    try {
      await request(`/admin/customer-messages/${id}/resolve`, {
        method: "PATCH",
      });
      emitRealtimeUpdate({ action: "resolve", id });
      await syncData(true);
      if (!silent) {
        showPopup("Inquiry marked as resolved.", { title: "Resolved" });
      }
    } catch (error) {
      if (!silent) {
        showPopup(error.message || "Unable to resolve inquiry.", {
          title: "Update Failed",
        });
      }
    }
  };

  const deleteInquiry = async (id) => {
    try {
      await request(`/admin/customer-messages/${id}`, { method: "DELETE" });
      emitRealtimeUpdate({ action: "delete", id });
      await syncData(true);
      showPopup("Inquiry deleted successfully.", { title: "Deleted" });
    } catch (error) {
      showPopup(error.message || "Unable to delete inquiry.", {
        title: "Delete Failed",
      });
    }
  };

  const onTableAction = async (event) => {
    const btn = event.target.closest("button[data-action]");
    if (!btn) return;

    const action = btn.dataset.action;
    const id = btn.dataset.id;
    if (!action || !id) return;

    if (action === "view") {
      openDetail(id);
      return;
    }

    if (action === "read") {
      await markRead(id);
      return;
    }

    if (action === "resolve") {
      const ok = await askConfirm("Mark this inquiry as resolved?", {
        title: "Resolve Inquiry",
        confirmText: "Resolve",
      });
      if (!ok) return;
      await resolveInquiry(id);
      return;
    }

    if (action === "delete") {
      const ok = await askConfirm(
        "Delete this inquiry? This cannot be undone.",
        {
          title: "Delete Inquiry",
          confirmText: "Delete",
        },
      );
      if (!ok) return;
      await deleteInquiry(id);
    }
  };

  statusFilter?.addEventListener("change", async () => {
    state.currentPage = 1;
    await syncData();
  });

  searchInput?.addEventListener("input", () => {
    state.currentPage = 1;
    window.clearTimeout(searchInput._debounceTimer);
    searchInput._debounceTimer = window.setTimeout(() => {
      void syncData();
    }, 320);
  });

  refreshBtn?.addEventListener("click", () => {
    window.location.reload();
  });

  prevBtn?.addEventListener("click", () => {
    state.currentPage = Math.max(1, state.currentPage - 1);
    renderRows();
  });

  nextBtn?.addEventListener("click", () => {
    const maxPage = Math.max(1, Math.ceil(state.rows.length / PAGE_SIZE));
    state.currentPage = Math.min(maxPage, state.currentPage + 1);
    renderRows();
  });

  window.AdminPageNumberInput?.bind(pageNumber, {
    getPage: () => state.currentPage,
    getTotalPages: () => Math.max(1, Math.ceil(state.rows.length / PAGE_SIZE)),
    onChange: (page) => {
      state.currentPage = page;
      renderRows();
    },
  });

  tableBody.addEventListener("click", (event) => {
    void onTableAction(event);
  });

  detailResolveBtn?.addEventListener("click", async () => {
    const id = state.selectedId;
    if (!id) return;

    const ok = await askConfirm("Mark this inquiry as resolved?", {
      title: "Resolve Inquiry",
      confirmText: "Resolve",
    });
    if (!ok) return;

    await resolveInquiry(id, true);
    closeDetail();
    showPopup("Inquiry marked as resolved.", { title: "Resolved" });
  });

  detailModal
    ?.querySelectorAll('[data-modal-close="#inquiryDetailModal"]')
    .forEach((btn) => {
      btn.addEventListener("click", closeDetail);
    });

  detailModal?.addEventListener("click", (event) => {
    if (
      event.target === detailModal &&
      detailModal.dataset.backdropClose !== "false"
    ) {
      closeDetail();
    }
  });

  window.addEventListener("fmrc:customer-messages-updated", (event) => {
    if (!shouldProcessSignal(event.detail)) return;
    void syncData(true);
  });

  window.addEventListener("storage", (event) => {
    if (event.key !== REALTIME_SIGNAL_KEY || !event.newValue) return;
    try {
      const payload = JSON.parse(event.newValue);
      if (!shouldProcessSignal(payload)) return;
      void syncData(true);
    } catch {
      // Ignore malformed payloads.
    }
  });

  getRealtimeChannel()?.addEventListener("message", (event) => {
    if (!shouldProcessSignal(event.data)) return;
    void syncData(true);
  });

  setupInquiryBulkSelection();
  void syncData();
});
