document.addEventListener("DOMContentLoaded", () => {
  const resolveApiBaseUrl = () => {
    const configured = window.APP_API_BASE_URL || document.querySelector('meta[name="api-base-url"]')?.getAttribute("content") || "";
    if (configured.trim()) return configured.replace(/\/+$/, "");
    const protocol = String(window.location.protocol || "").toLowerCase();
    const hostname = String(window.location.hostname || "").toLowerCase();
    const origin = String(window.location.origin || "");
    const port = String(window.location.port || "");
    if (!/^https?:$/.test(protocol) || !hostname) return "http://127.0.0.1:8000/api";
    const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1";
    const isPort8000 = port === "8000";
    const isStandardWebPort = port === "" || port === "80" || port === "443";
    if (isPort8000 || (!isLocalHost && isStandardWebPort)) return `${origin.replace(/\/+$/, "")}/api`;
    if (isLocalHost) return `${protocol}//${hostname}:8000/api`;
    return `${origin.replace(/\/+$/, "")}/api`;
  };

  const API_BASE_URL = resolveApiBaseUrl();
  const token = (window.AdminSession && window.AdminSession.getToken()) || localStorage.getItem("auth_token") || "";
  const POLL_INTERVAL_MS = 12000;
  const MANILA_TZ = "Asia/Manila";
  const PAGE_SIZE = 10;

  const tableBody = document.getElementById("ratingsTableBody");
  const starFilter = document.getElementById("ratingsStarFilter");
  const replyFilter = document.getElementById("ratingsReplyFilter");
  const searchInput = document.getElementById("ratingsSearchInput");
  const refreshBtn = document.getElementById("ratingsRefreshBtn");
  const pageMeta = document.getElementById("ratingsMeta");
  const pageNumber = document.getElementById("ratingsPageNumber");
  const prevBtn = document.getElementById("ratingsPrevBtn");
  const nextBtn = document.getElementById("ratingsNextBtn");

  const statTotal = document.getElementById("statTotalRatings");
  const statAvg = document.getElementById("statAvgScore");
  const statFive = document.getElementById("statFiveStar");
  const statFeedback = document.getElementById("statWithFeedback");

  const detailModal = document.getElementById("ratingDetailModal");
  const detailCustomerName = document.getElementById("detailCustomerName");
  const detailCustomerEmail = document.getElementById("detailCustomerEmail");
  const detailProductName = document.getElementById("detailProductName");
  const detailSubmittedAt = document.getElementById("detailSubmittedAt");
  const detailStars = document.getElementById("detailStars");
  const detailFeedback = document.getElementById("detailFeedback");
  const detailExistingReply = document.getElementById("detailExistingReply");
  const detailExistingReplyText = document.getElementById("detailExistingReplyText");
  const detailExistingReplyDate = document.getElementById("detailExistingReplyDate");
  const detailReplyInput = document.getElementById("detailReplyInput");
  const detailReplyCount = document.getElementById("detailReplyCount");
  const detailReplyBtn = document.getElementById("detailReplyBtn");

  const state = { rows: [], currentPage: 1, isLoading: false, pollTimer: null, lastPage: 1, totalRows: 0, activeRatingId: null };

  if (!tableBody) return;

  const escapeHtml = (v) => String(v || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  const formatDateTime = (value) => {
    const date = new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString("en-PH", { timeZone: MANILA_TZ, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  };

  const renderStars = (stars, size = "sm") => {
    const n = Math.min(5, Math.max(0, Number(stars) || 0));
    return Array.from({ length: 5 }, (_, i) =>
      `<span class="${size === "lg" ? "star-lg" : ""}${i < n ? "" : " star-empty"}">★</span>`
    ).join("");
  };

  const renderSkeletonRows = (cols, rows = PAGE_SIZE) => {
    const widths = [90, 75, 55, 80, 65, 50, 40];
    return Array.from({ length: rows }, () =>
      `<tr>${Array.from({ length: cols }, (_, i) => `<td><div class="skeleton-text" style="width:${widths[i % widths.length]}%;min-height:14px;"></div></td>`).join("")}</tr>`
    ).join("");
  };

  const showPopup = (message, options = {}) => {
    if (typeof window.showAdminPopup === "function") { window.showAdminPopup(message, options); return; }
    window.alert(message);
  };

  const request = async (path, options = {}) => {
    const headers = { Accept: "application/json", ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (Object.prototype.hasOwnProperty.call(options, "body")) headers["Content-Type"] = "application/json";
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method || "GET",
      headers,
      body: Object.prototype.hasOwnProperty.call(options, "body") ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const err = new Error(data.message || `Request failed with status ${res.status}.`); err.status = res.status; throw err; }
    return data;
  };

  const updateStats = (summary) => {
    if (statTotal) statTotal.textContent = String(summary.total || 0);
    if (statAvg) statAvg.textContent = String(summary.avg ?? "0.0");
    if (statFive) statFive.textContent = String(summary.five || 0);
    if (statFeedback) statFeedback.textContent = String(summary.with_feedback || 0);
  };

  const renderEmpty = (message) => {
    tableBody.innerHTML = `<tr class="table-empty-row"><td colspan="7"><div class="table-empty-state"><i class="fa-regular fa-folder-open"></i><span>${escapeHtml(message)}</span></div></td></tr>`;
    if (pageMeta) pageMeta.textContent = "Page 1 of 1";
    if (pageNumber) pageNumber.textContent = "1";
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
  };

  const renderRows = () => {
    const rows = Array.isArray(state.rows) ? state.rows : [];
    if (!rows.length) { renderEmpty("No ratings found."); return; }

    tableBody.innerHTML = rows.map((row) => {
      const customerName = escapeHtml(row.user?.name || row.user?.email || "Unknown");
      const customerEmail = escapeHtml(row.user?.email || "");
      const productName = escapeHtml(row.product_name || "Custom Order");
      const stars = Number(row.stars) || 0;
      const feedback = row.feedback ? escapeHtml(row.feedback) : null;
      const hasReply = Boolean(row.admin_reply);

      return `
        <tr data-row-id="${row.id}" class="${hasReply ? "row-replied" : ""}">
          <td>
            <div><strong>${customerName}</strong></div>
            <div style="font-size:0.73rem;color:#6b7280">${customerEmail}</div>
          </td>
          <td>${productName}</td>
          <td><span class="star-display">${renderStars(stars)}</span> <span style="font-size:0.75rem;color:#6b7280;margin-left:4px">${stars}/5</span></td>
          <td>${feedback ? `<div class="rating-feedback-preview">${feedback}</div>` : `<span class="rating-no-feedback">No feedback</span>`}</td>
          <td>
            ${hasReply
              ? `<span class="rating-reply-status replied"><i class="fa-solid fa-check-circle"></i> Replied</span>`
              : `<span class="rating-reply-status pending"><i class="fa-regular fa-clock"></i> No reply</span>`
            }
          </td>
          <td style="font-size:0.78rem;color:#6b7280">${escapeHtml(formatDateTime(row.created_at))}</td>
          <td class="sticky-action">
            <div class="ratings-table-actions">
              <button type="button" class="btn-compact" data-action="view" data-id="${row.id}" title="View &amp; Reply"><i class="fa-regular fa-eye"></i></button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    const totalPages = Math.max(1, state.lastPage);
    if (pageMeta) pageMeta.textContent = `Page ${state.currentPage} of ${totalPages} (${state.totalRows} total)`;
    if (pageNumber) pageNumber.textContent = String(state.currentPage);
    if (prevBtn) prevBtn.disabled = state.currentPage <= 1;
    if (nextBtn) nextBtn.disabled = state.currentPage >= totalPages;
  };

  const openDetail = (id) => {
    const row = state.rows.find((r) => String(r.id) === String(id));
    if (!row || !detailModal) return;

    state.activeRatingId = row.id;

    if (detailCustomerName) detailCustomerName.textContent = row.user?.name || row.user?.email || "Unknown";
    if (detailCustomerEmail) detailCustomerEmail.textContent = row.user?.email || "";
    if (detailProductName) detailProductName.textContent = row.product_name || "Custom Order";
    if (detailSubmittedAt) detailSubmittedAt.textContent = formatDateTime(row.created_at);
    if (detailStars) {
      const n = Number(row.stars) || 0;
      detailStars.innerHTML = `${renderStars(n, "lg")}<span class="score-label">${n} / 5</span>`;
    }
    if (detailFeedback) detailFeedback.textContent = row.feedback || "No feedback provided.";

    if (detailExistingReply) {
      if (row.admin_reply) {
        detailExistingReply.style.display = "block";
        if (detailExistingReplyText) detailExistingReplyText.textContent = row.admin_reply;
        if (detailExistingReplyDate) detailExistingReplyDate.textContent = row.replied_at ? `Replied on ${formatDateTime(row.replied_at)}` : "";
      } else {
        detailExistingReply.style.display = "none";
      }
    }
    if (detailReplyInput) {
      detailReplyInput.value = row.admin_reply || "";
      if (detailReplyCount) detailReplyCount.textContent = String((row.admin_reply || "").length);
    }
    if (detailReplyBtn) {
      detailReplyBtn.textContent = row.admin_reply ? "Update Reply" : "Send Reply";
    }

    detailModal.classList.add("show");
  };

  const closeDetail = () => { detailModal?.classList.remove("show"); state.activeRatingId = null; };

  const submitReply = async () => {
    if (!state.activeRatingId) return;
    const replyText = (detailReplyInput?.value || "").trim();
    if (!replyText) { showPopup("Please enter a reply before submitting.", { title: "Reply Required" }); return; }
    if (detailReplyBtn) { detailReplyBtn.disabled = true; detailReplyBtn.textContent = "Sending…"; }
    try {
      await request(`/admin/ratings/${state.activeRatingId}/reply`, { method: "POST", body: { admin_reply: replyText } });
      showPopup("Reply sent successfully.", { title: "Reply Sent" });
      const row = state.rows.find((r) => String(r.id) === String(state.activeRatingId));
      if (row) {
        row.admin_reply = replyText;
        row.replied_at = new Date().toISOString();
      }
      if (detailExistingReply) {
        detailExistingReply.style.display = "block";
        if (detailExistingReplyText) detailExistingReplyText.textContent = replyText;
        if (detailExistingReplyDate) detailExistingReplyDate.textContent = "Replied just now";
      }
      if (detailReplyBtn) detailReplyBtn.textContent = "Update Reply";
      // Update table row visually
      renderRows();
    } catch (err) {
      showPopup(err.message || "Failed to send reply.", { title: "Error" });
    } finally {
      if (detailReplyBtn) { detailReplyBtn.disabled = false; }
    }
  };

  const syncData = async (isSilent = false) => {
    if (!token) {
      if (!isSilent) showPopup("Session not found. Please log in again.", { title: "Authentication Required" });
      return;
    }

    if (!isSilent) {
      state.isLoading = true;
      if (refreshBtn) { refreshBtn.disabled = true; refreshBtn.classList.add("is-disabled"); }
      tableBody.innerHTML = renderSkeletonRows(7);
      if (pageMeta) pageMeta.textContent = "Loading…";
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
    }

    try {
      const stars = starFilter?.value && starFilter.value !== "all" ? `&stars=${encodeURIComponent(starFilter.value)}` : "";
      const reply = replyFilter?.value && replyFilter.value !== "all" ? `&replied=${encodeURIComponent(replyFilter.value)}` : "";
      const search = encodeURIComponent((searchInput?.value || "").trim());
      const payload = await request(`/admin/ratings?page=${state.currentPage}&search=${search}${stars}${reply}`);

      state.rows = Array.isArray(payload.data) ? payload.data : [];
      state.lastPage = payload.meta?.last_page || 1;
      state.totalRows = payload.meta?.total || state.rows.length;
      updateStats(payload.summary || {});
      renderRows();
    } catch (error) {
      if (!isSilent) showPopup(error.message || "Failed to load ratings.", { title: "Load Failed" });
      renderEmpty("Unable to load ratings. Please try again.");
    } finally {
      state.isLoading = false;
      if (refreshBtn) { refreshBtn.disabled = false; refreshBtn.classList.remove("is-disabled"); }
    }
  };

  const scheduleSilentSync = () => {
    if (state.pollTimer) window.clearTimeout(state.pollTimer);
    state.pollTimer = window.setTimeout(async () => { await syncData(true); scheduleSilentSync(); }, POLL_INTERVAL_MS);
  };

  starFilter?.addEventListener("change", () => { state.currentPage = 1; void syncData(); });
  replyFilter?.addEventListener("change", () => { state.currentPage = 1; void syncData(); });

  searchInput?.addEventListener("input", () => {
    state.currentPage = 1;
    window.clearTimeout(searchInput._debounceTimer);
    searchInput._debounceTimer = window.setTimeout(() => void syncData(), 320);
  });

  refreshBtn?.addEventListener("click", () => { state.currentPage = 1; void syncData(); });

  prevBtn?.addEventListener("click", () => { if (state.currentPage > 1) { state.currentPage--; void syncData(); } });
  nextBtn?.addEventListener("click", () => { if (state.currentPage < state.lastPage) { state.currentPage++; void syncData(); } });

  tableBody.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-action]");
    if (!btn) return;
    if (btn.dataset.action === "view") openDetail(btn.dataset.id);
  });

  detailModal?.querySelectorAll('[data-modal-close="#ratingDetailModal"]').forEach((btn) => btn.addEventListener("click", closeDetail));
  detailModal?.addEventListener("click", (event) => { if (event.target === detailModal) closeDetail(); });
  detailReplyInput?.addEventListener("input", () => { if (detailReplyCount) detailReplyCount.textContent = String(detailReplyInput.value.length); });
  detailReplyBtn?.addEventListener("click", () => void submitReply());

  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && detailModal?.classList.contains("show")) closeDetail(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void syncData(true); });

  tableBody.innerHTML = renderSkeletonRows(7);
  void syncData();
  scheduleSilentSync();
});
