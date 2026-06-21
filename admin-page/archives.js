/**
 * archives.js — Dynamic Archives Page
 * Handles Inventory, Appointment, and Orders archive tables.
 * Shared between admin-page/archives.html and staff-page/archives.html.
 */
document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  // ─── API Base URL ────────────────────────────────────────────────────────────
  const resolveApiBaseUrl = () => {
    const configured =
      window.APP_API_BASE_URL ||
      document
        .querySelector('meta[name="api-base-url"]')
        ?.getAttribute("content") ||
      "";
    if (configured.trim()) return configured.replace(/\/+$/, "");
    const proto = window.location.protocol;
    const hostname = window.location.hostname;
    const port = window.location.port;
    if (port === "8000") return `${proto}//${hostname}:8000/api`;
    if (hostname === "localhost" || hostname === "127.0.0.1")
      return `${proto}//${hostname}:8000/api`;
    return `${proto}//${hostname}/api`;
  };

  const API_BASE_URL = resolveApiBaseUrl();

  // Token — try every key used across the app
  const getToken = () =>
    (window.AdminSession && window.AdminSession.getToken()) ||
    localStorage.getItem("auth_token") ||
    localStorage.getItem("admin_auth_token") ||
    localStorage.getItem("staff_auth_token") ||
    "";

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  const esc = (str) => {
    const d = document.createElement("div");
    d.textContent = String(str ?? "—");
    return d.innerHTML || "—";
  };

  const fmtDate = (isoStr) => {
    if (!isoStr) return "—";
    const d = new Date(isoStr);
    if (isNaN(d)) return String(isoStr);
    return d.toLocaleDateString("en-PH", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const statusPill = (text) => {
    const s = String(text || "—").toLowerCase();
    let cls = "status-gray";
    if (["good", "active", "completed", "confirmed", "paid"].includes(s))
      cls = "status-green";
    else if (["low", "pending", "incoming"].includes(s)) cls = "status-yellow";
    else if (["critical", "rejected", "cancelled", "archived"].includes(s))
      cls = "status-red";
    return `<span class="status-pill ${cls}">${esc(text)}</span>`;
  };

  // ─── State ───────────────────────────────────────────────────────────────────
  const PAGE_SIZE = 10;
  const state = {
    inventory: { all: [], page: 1 },
    appointment: { all: [], page: 1 },
    order: { all: [], page: 1 },
  };
  let searchQuery = "";
  let activeTab = "inventory";

  // ─── DOM refs ────────────────────────────────────────────────────────────────
  const searchInput = document.getElementById("archiveSearchInput");
  const refreshBtn = document.getElementById("archivesRefreshBtn");
  const tabBtns = document.querySelectorAll(".archive-tab-btn");
  const sections = document.querySelectorAll(".archive-section");

  const invTbody = document.getElementById("invArchiveTbody");
  const invMeta = document.getElementById("invArchiveMeta");
  const invCurPage = document.getElementById("invCurrentPage");
  const invPrev = document.getElementById("invPrevBtn");
  const invNext = document.getElementById("invNextBtn");

  const apptTbody = document.getElementById("apptArchiveTbody");
  const apptMeta = document.getElementById("apptArchiveMeta");
  const apptCurPage = document.getElementById("apptCurrentPage");
  const apptPrev = document.getElementById("apptPrevBtn");
  const apptNext = document.getElementById("apptNextBtn");

  const orderTbody = document.getElementById("orderArchiveTbody");
  const orderMeta = document.getElementById("orderArchiveMeta");
  const orderCurPage = document.getElementById("orderCurrentPage");
  const orderPrev = document.getElementById("orderPrevBtn");
  const orderNext = document.getElementById("orderNextBtn");

  const tabCountInv = document.getElementById("tabCountInventory");
  const tabCountAppt = document.getElementById("tabCountAppointment");
  const tabCountOrder = document.getElementById("tabCountOrder");

  // ─── Tab Switching ───────────────────────────────────────────────────────────
  const switchTab = (tab) => {
    activeTab = tab;
    tabBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    });
    sections.forEach((sec) => {
      const id = sec.id.replace("section", "").toLowerCase();
      sec.classList.toggle("active", id === tab);
    });
  };

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  // ─── Filter helper ───────────────────────────────────────────────────────────
  const filterRecords = (records, fields) => {
    if (!searchQuery) return records;
    return records.filter((r) =>
      fields.some((f) =>
        String(r[f] || "")
          .toLowerCase()
          .includes(searchQuery),
      ),
    );
  };

  // ─── Pagination helpers ──────────────────────────────────────────────────────
  const paginate = (arr, page) =>
    arr.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = (arr) => Math.max(1, Math.ceil(arr.length / PAGE_SIZE));

  const updatePagination = (meta, curPageEl, prevBtn, nextBtn, arr, page) => {
    const tp = totalPages(arr);
    const from = arr.length ? (page - 1) * PAGE_SIZE + 1 : 0;
    const to = Math.min(arr.length, page * PAGE_SIZE);
    if (meta)
      meta.textContent = `Page ${page} of ${tp} • Showing ${from}–${to} of ${arr.length}`;
    if (curPageEl) curPageEl.textContent = String(page);
    if (prevBtn) prevBtn.disabled = page <= 1;
    if (nextBtn) nextBtn.disabled = page >= tp;
  };

  // ─── RENDER: INVENTORY ───────────────────────────────────────────────────────
  const renderInventory = () => {
    const filtered = filterRecords(state.inventory.all, [
      "item_name",
      "description",
      "category",
      "unit",
      "status",
      "remarks",
    ]);
    const paged = paginate(filtered, state.inventory.page);
    updatePagination(
      invMeta,
      invCurPage,
      invPrev,
      invNext,
      filtered,
      state.inventory.page,
    );
    if (tabCountInv) tabCountInv.textContent = state.inventory.all.length;

    if (!invTbody) return;
    if (!paged.length) {
      invTbody.innerHTML = `<tr><td colspan="9"><div class="table-empty-state"><i class="fa-regular fa-folder-open"></i><span>No archived inventory items found.</span></div></td></tr>`;
      return;
    }

    invTbody.innerHTML = paged
      .map((item, idx) => {
        const rowNum = (state.inventory.page - 1) * PAGE_SIZE + idx + 1;
        const onHand = item.on_hand ?? 0;
        const statusText =
          onHand <= 0 ? "Critical" : onHand <= 5 ? "Low" : "Good";
        const statusHtml = statusPill(item.status || statusText);
        const variants = Array.isArray(item.variants) ? item.variants : [];
        const hasVariants = Boolean(item.has_variants || variants.length > 0);

        const remarksHtml = item.remarks
          ? `<span class="remarks-pill bg-gray-100 text-gray-500">${esc(item.remarks)}</span>`
          : `<span style="color:#9ca3af;font-size:0.75rem;">—</span>`;
        const baseDescriptionHtml = hasVariants
          ? ""
          : esc(item.description || "—");
        const baseUnitHtml = hasVariants ? "" : esc(item.unit || "—");
        const baseOnHandHtml = hasVariants ? "" : esc(onHand);
        const baseStatusHtml = hasVariants ? "" : statusHtml;
        const baseRemarksHtml = hasVariants ? "" : remarksHtml;

        const toggleHtml = hasVariants
          ? `<button type="button" class="inv-variant-toggle" data-inv-toggle="${item.source_id}" aria-expanded="false" title="Toggle variants">
            <i class="fa-solid fa-chevron-right"></i>
          </button>`
          : "";

        const itemNameHtml = hasVariants
          ? `<div class="inv-name-cell">${toggleHtml}<span>${esc(item.item_name)}</span><span class="inv-variant-count">${variants.length} variant${variants.length !== 1 ? "s" : ""}</span></div>`
          : esc(item.item_name);

        let rowHtml = `<tr${hasVariants ? ' class="inv-has-variants"' : ""}>
        <td>${rowNum}</td>
        <td style="font-weight:600;">${itemNameHtml}</td>
        <td style="color:#64748b;">${baseDescriptionHtml}</td>
        <td>${baseUnitHtml}</td>
        <td>${baseOnHandHtml}</td>
        <td>${baseStatusHtml}</td>
        <td>${baseRemarksHtml}</td>
        <td><span style="font-size:0.75rem;background:#f0f2f5;padding:2px 8px;border-radius:99px;font-weight:600;">${esc(item.category)}</span></td>
        <td style="color:#64748b;font-size:0.82rem;">${fmtDate(item.archived_at)}</td>
        <td class="action-icons sticky-action">
          <button type="button" data-tooltip="Restore Record" data-restore="inventory" data-id="${item.source_id}" data-name="${esc(item.item_name)}">
            <i class="fa-solid fa-rotate-left"></i>
          </button>
        </td>
      </tr>`;

        if (hasVariants) {
          variants.forEach((variant) => {
            const vOnHand = variant.on_hand ?? 0;
            const vStatus =
              variant.status ||
              (vOnHand <= 0 ? "Critical" : vOnHand <= 5 ? "Low" : "Good");
            rowHtml += `<tr class="inv-variant-row" data-parent-inv="${item.source_id}" style="display:none;">
            <td></td>
            <td><div class="inv-variant-indent"><span class="inv-variant-name">${esc(variant.name)}</span></div></td>
            <td style="color:#64748b;">${esc(variant.description || "—")}</td>
            <td>${esc(variant.unit)}</td>
            <td>${esc(vOnHand)}</td>
            <td>${statusPill(vStatus)}</td>
            <td>${variant.remarks ? `<span class="remarks-pill bg-gray-100 text-gray-500">${esc(variant.remarks)}</span>` : `<span style="color:#9ca3af;font-size:0.75rem;">—</span>`}</td>
            <td></td>
            <td></td>
            <td class="sticky-action"></td>
          </tr>`;
          });
        }

        return rowHtml;
      })
      .join("");
  };

  // ─── RENDER: APPOINTMENTS ────────────────────────────────────────────────────
  const renderAppointments = () => {
    const filtered = filterRecords(state.appointment.all, [
      "reference_no",
      "client_name",
      "contact_number",
      "email",
      "client_type",
      "purpose",
      "status",
    ]);
    const paged = paginate(filtered, state.appointment.page);
    updatePagination(
      apptMeta,
      apptCurPage,
      apptPrev,
      apptNext,
      filtered,
      state.appointment.page,
    );
    if (tabCountAppt) tabCountAppt.textContent = state.appointment.all.length;

    if (!apptTbody) return;
    if (!paged.length) {
      apptTbody.innerHTML = `<tr><td colspan="11"><div class="table-empty-state"><i class="fa-regular fa-folder-open"></i><span>No archived appointments found.</span></div></td></tr>`;
      return;
    }

    apptTbody.innerHTML = paged
      .map(
        (a) => `<tr>
      <td style="font-weight:700;color:#800000;">${esc(a.reference_no)}</td>
      <td style="font-weight:600;">${esc(a.client_name)}</td>
      <td>${esc(a.contact_number)}</td>
      <td style="color:#64748b;">${esc(a.email)}</td>
      <td style="color:#64748b;font-size:0.8rem;">${esc(a.full_address || "—")}</td>
      <td>${esc(a.client_type)}</td>
      <td>${esc(a.purpose)}</td>
      <td>${esc(a.appointment_date)}</td>
      <td>${esc(a.appointment_time)}</td>
      <td>${statusPill(a.status)}</td>
      <td style="color:#64748b;font-size:0.82rem;">${fmtDate(a.archived_at)}</td>
      <td class="action-icons sticky-action">
        <button type="button" data-tooltip="Restore Record" data-restore="appointments" data-id="${a.source_id}" data-name="${esc(a.reference_no)}">
          <i class="fa-solid fa-rotate-left"></i>
        </button>
      </td>
    </tr>`,
      )
      .join("");
  };

  // ─── RENDER: ORDERS ──────────────────────────────────────────────────────────
  const renderOrders = () => {
    const filtered = filterRecords(state.order.all, [
      "order_no",
      "order_item",
      "customer_name",
      "payment_method",
      "lifecycle_status",
    ]);
    const paged = paginate(filtered, state.order.page);
    updatePagination(
      orderMeta,
      orderCurPage,
      orderPrev,
      orderNext,
      filtered,
      state.order.page,
    );
    if (tabCountOrder) tabCountOrder.textContent = state.order.all.length;

    if (!orderTbody) return;
    if (!paged.length) {
      orderTbody.innerHTML = `<tr><td colspan="8"><div class="table-empty-state"><i class="fa-regular fa-folder-open"></i><span>No archived orders found.</span></div></td></tr>`;
      return;
    }

    orderTbody.innerHTML = paged
      .map(
        (o) => `<tr>
      <td style="font-weight:700;color:#800000;">${esc(o.order_no)}</td>
      <td style="font-weight:600;">${esc(o.order_item)}</td>
      <td>${esc(o.date)}</td>
      <td>${esc(o.customer_name)}</td>
      <td>${esc(o.payment_method)}</td>
      <td style="font-weight:700;">${esc(o.total_label)}</td>
      <td>${statusPill(o.lifecycle_status)}</td>
      <td style="color:#64748b;font-size:0.82rem;">${fmtDate(o.archived_at)}</td>
      <td class="action-icons sticky-action">
        <button type="button" data-tooltip="Restore Record" data-restore="orders" data-id="${o.source_id}" data-name="${esc(o.order_no)}">
          <i class="fa-solid fa-rotate-left"></i>
        </button>
      </td>
    </tr>`,
      )
      .join("");
  };

  const renderAll = () => {
    renderInventory();
    renderAppointments();
    renderOrders();
  };

  // ─── Fetch from Backend ──────────────────────────────────────────────────────
  const buildSkeletonRows = (cols) => {
    const widths = [90, 80, 70, 65, 55, 75, 45, 60, 85, 50, 40];
    return Array.from({ length: PAGE_SIZE }, () => {
      return `<tr>${Array.from({ length: cols }, (_, index) => `<td><div class="skeleton-text" style="width:${widths[index % widths.length]}%;min-height:14px;"></div></td>`).join("")}</tr>`;
    }).join("");
  };

  const setLoading = () => {
    if (invTbody) invTbody.innerHTML = buildSkeletonRows(9);
    if (apptTbody) apptTbody.innerHTML = buildSkeletonRows(11);
    if (orderTbody) orderTbody.innerHTML = buildSkeletonRows(8);

    if (invMeta) invMeta.textContent = "Loading…";
    if (apptMeta) apptMeta.textContent = "Loading…";
    if (orderMeta) orderMeta.textContent = "Loading…";

    if (invPrev) invPrev.disabled = true;
    if (invNext) invNext.disabled = true;
    if (apptPrev) apptPrev.disabled = true;
    if (apptNext) apptNext.disabled = true;
    if (orderPrev) orderPrev.disabled = true;
    if (orderNext) orderNext.disabled = true;
  };

  const setError = (msg) => {
    const html = (cols) =>
      `<tr><td colspan="${cols}"><div class="table-empty-state"><i class="fa-solid fa-triangle-exclamation" style="color:#ef4444;"></i><span style="color:#ef4444;">${msg}</span></div></td></tr>`;
    if (invTbody) invTbody.innerHTML = html(9);
    if (apptTbody) apptTbody.innerHTML = html(11);
    if (orderTbody) orderTbody.innerHTML = html(8);
  };

  const loadArchives = async () => {
    const token = getToken();
    if (!token) {
      window.showAdminPopup?.("Please login first.", {
        title: "Session Required",
        onOk: () => {
          window.location.href = "../admin-auth/auth.html";
        },
      });
      return;
    }

    setLoading();

    try {
      const res = await fetch(`${API_BASE_URL}/admin/archives`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });

      if (res.status === 401 || res.status === 403) {
        window.showAdminPopup?.(
          "Your session has expired. Please login again.",
          {
            title: "Session Expired",
            onOk: () => {
              window.location.href = "../admin-auth/auth.html";
            },
          },
        );
        return;
      }

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody?.message || `Server error ${res.status}`);
      }

      const payload = await res.json();

      // New API returns { inventory: [], appointments: [], orders: [] }
      state.inventory.all = Array.isArray(payload?.inventory)
        ? payload.inventory
        : [];
      state.appointment.all = Array.isArray(payload?.appointments)
        ? payload.appointments
        : [];
      state.order.all = Array.isArray(payload?.orders) ? payload.orders : [];

      // Reset pages on fresh load
      state.inventory.page = 1;
      state.appointment.page = 1;
      state.order.page = 1;

      renderAll();
    } catch (err) {
      console.error("[Archives] Fetch error:", err);
      setError(`Failed to load archives: ${err.message}. Please try again.`);
    }
  };

  // ─── Pagination event listeners ──────────────────────────────────────────────
  invPrev?.addEventListener("click", () => {
    if (state.inventory.page > 1) {
      state.inventory.page--;
      renderInventory();
    }
  });
  invNext?.addEventListener("click", () => {
    const filtered = filterRecords(state.inventory.all, [
      "item_name",
      "description",
      "category",
      "unit",
      "status",
      "remarks",
    ]);
    if (state.inventory.page < totalPages(filtered)) {
      state.inventory.page++;
      renderInventory();
    }
  });

  apptPrev?.addEventListener("click", () => {
    if (state.appointment.page > 1) {
      state.appointment.page--;
      renderAppointments();
    }
  });
  apptNext?.addEventListener("click", () => {
    const filtered = filterRecords(state.appointment.all, [
      "reference_no",
      "client_name",
      "contact_number",
      "email",
      "client_type",
      "purpose",
      "status",
    ]);
    if (state.appointment.page < totalPages(filtered)) {
      state.appointment.page++;
      renderAppointments();
    }
  });

  orderPrev?.addEventListener("click", () => {
    if (state.order.page > 1) {
      state.order.page--;
      renderOrders();
    }
  });
  orderNext?.addEventListener("click", () => {
    const filtered = filterRecords(state.order.all, [
      "order_no",
      "order_item",
      "customer_name",
      "payment_method",
      "lifecycle_status",
    ]);
    if (state.order.page < totalPages(filtered)) {
      state.order.page++;
      renderOrders();
    }
  });

  // ─── Search ──────────────────────────────────────────────────────────────────
  searchInput?.addEventListener("input", () => {
    searchQuery = (searchInput.value || "").trim().toLowerCase();
    state.inventory.page = 1;
    state.appointment.page = 1;
    state.order.page = 1;
    renderAll();
  });

  // ─── Restore Logic & Variant Toggling ────────────────────────────────────────
  let restoreTarget = null;
  const modalRestore = document.getElementById("modalRestoreRecord");
  const restoreTargetLabel = document.getElementById("restoreTargetLabel");
  const btnConfirmRestore = document.getElementById("btnConfirmRestore");

  document.body.addEventListener("click", (e) => {
    // Variant Toggle
    const toggleBtn = e.target.closest(".inv-variant-toggle");
    if (toggleBtn) {
      const parentId = toggleBtn.getAttribute("data-inv-toggle");
      const isExpanded = toggleBtn.getAttribute("aria-expanded") === "true";
      toggleBtn.setAttribute("aria-expanded", !isExpanded);
      const childRows = document.querySelectorAll(
        `.inv-variant-row[data-parent-inv="${parentId}"]`,
      );
      childRows.forEach((row) => {
        row.style.display = isExpanded ? "none" : "table-row";
      });
      return;
    }

    // Restore Button Click
    const restoreBtn = e.target.closest("[data-restore]");
    if (restoreBtn) {
      const module = restoreBtn.getAttribute("data-restore");
      const id = restoreBtn.getAttribute("data-id");
      const name = restoreBtn.getAttribute("data-name");
      restoreTarget = { module, id, name };
      if (restoreTargetLabel) restoreTargetLabel.textContent = name || "record";
      if (modalRestore) modalRestore.classList.add("show");
    }
  });

  // Restore API Call
  btnConfirmRestore?.addEventListener("click", async () => {
    if (!restoreTarget) return;
    const { module, id } = restoreTarget;

    let endpoint = "";
    if (module === "inventory") endpoint = `/admin/inventory/${id}/unarchive`;
    else if (module === "appointments")
      endpoint = `/appointments/${id}/unarchive`;
    else if (module === "orders") endpoint = `/admin/orders/${id}/unarchive`;

    if (!endpoint) return;

    btnConfirmRestore.disabled = true;
    const originalText = btnConfirmRestore.innerHTML;
    btnConfirmRestore.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Restoring...`;

    try {
      const token = getToken();
      const res = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed to restore record.");
      }

      window.showAdminPopup?.("Record restored successfully.", {
        title: "Success",
      });
      if (modalRestore) modalRestore.classList.remove("show");
      loadArchives(); // reload table data
    } catch (error) {
      window.showAdminPopup?.(error.message, { title: "Error", isError: true });
    } finally {
      btnConfirmRestore.disabled = false;
      btnConfirmRestore.innerHTML = originalText;
    }
  });

  // ─── Refresh ─────────────────────────────────────────────────────────────────
  refreshBtn?.addEventListener("click", () => void loadArchives());

  // ─── Init ────────────────────────────────────────────────────────────────────
  void loadArchives();
});
