document.addEventListener("DOMContentLoaded", () => {
  const resolveApiBaseUrl = () => {
    const configured =
      window.APP_API_BASE_URL ||
      document.querySelector('meta[name="api-base-url"]')?.getAttribute("content") ||
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
  const authToken = localStorage.getItem("auth_token");
  const PHILIPPINES_TIME_ZONE = "Asia/Manila";
  const REQUEST_TIMEOUT_MS = 15000;
  const ORDERS_REALTIME_CHANNEL = "fmrc-orders-realtime";
  const ORDERS_BACKGROUND_SYNC_MS = 6000;
  const MIN_SYNC_GAP_MS = 2500;

  let ordersRealtimeChannel = null;

  const getOrdersRealtimeChannel = () => {
    if (typeof window.BroadcastChannel !== "function") return null;
    if (!ordersRealtimeChannel) {
      ordersRealtimeChannel = new window.BroadcastChannel(ORDERS_REALTIME_CHANNEL);
    }
    return ordersRealtimeChannel;
  };

  const incomingCardsWrap = document.getElementById("incomingOrdersCards");
  const incomingCardsPagination = document.getElementById("incomingCardsPagination");
  const incomingPrevBtn = document.getElementById("incomingPrevBtn");
  const incomingNextBtn = document.getElementById("incomingNextBtn");
  const incomingPageNumber = document.getElementById("incomingPageNumber");

  const incomingCompactTbody = document.querySelector("#incomingCompactTable tbody");
  const incomingCompactFooter = document.getElementById("incomingCompactFooter");

  const ordersDirectoryTbody = document.querySelector("#ordersDirectoryTable tbody");
  const ordersDirectoryFooter = document.getElementById("ordersDirectoryFooter");
  const directoryStatusFilter = document.getElementById("ordersDirectoryStatusFilter");
  const directorySearch = document.getElementById("ordersDirectorySearch");

  const paymentsHistoryTbody = document.querySelector("#paymentsHistoryTable tbody");
  const paymentsHistoryFooter = document.getElementById("paymentsHistoryFooter");
  const paymentsMethodFilter = document.getElementById("paymentsMethodFilter");

  const refreshBtn = document.getElementById("ordersRefreshBtn");

  const modalOrderDetails = document.getElementById("modalOrderDetails");
  const modalTrackingUpdate = document.getElementById("modalTrackingUpdate");

  const trackingOrderId = document.getElementById("trackingOrderId");
  const trackingOrderNo = document.getElementById("trackingOrderNo");
  const trackingStage = document.getElementById("trackingStage");
  const trackingEventTitle = document.getElementById("trackingEventTitle");
  const trackingEventDescription = document.getElementById("trackingEventDescription");
  const trackingCourierName = document.getElementById("trackingCourierName");
  const trackingCourierNo = document.getElementById("trackingCourierNo");
  const trackingLocationName = document.getElementById("trackingLocationName");
  const trackingLatitude = document.getElementById("trackingLatitude");
  const trackingLongitude = document.getElementById("trackingLongitude");
  const btnSaveTrackingUpdate = document.getElementById("btnSaveTrackingUpdate");

  const state = {
    incoming: [],
    directory: [],
    payments: [],
    ordersById: new Map(),
    incomingCardsPage: 1,
    incomingCompactPage: 1,
    directoryPage: 1,
    paymentsPage: 1,
    isSyncing: false,
    syncController: null,
    pollTimer: null,
    syncRequestId: 0,
    lastSyncAt: 0,
    pendingForceSync: false,
    lastRealtimeSignalTs: 0,
  };

  const shouldProcessRealtimeSignal = (payload = {}) => {
    const ts = Number(payload?.timestamp || 0);
    if (!Number.isFinite(ts) || ts <= 0) return true;
    if (ts <= state.lastRealtimeSignalTs) return false;
    state.lastRealtimeSignalTs = ts;
    return true;
  };

  const notifyOrdersRealtimeUpdate = (detail = {}) => {
    const payload = {
      source: "admin-orders",
      timestamp: Date.now(),
      ...detail,
    };

    window.dispatchEvent(new CustomEvent("fmrc:orders-updated", { detail: payload }));

    try {
      localStorage.setItem("fmrc_orders_updated_at", JSON.stringify(payload));
    } catch {
      // Ignore storage write issues (private mode/quota).
    }

    const realtimeChannel = getOrdersRealtimeChannel();
    realtimeChannel?.postMessage(payload);
  };

  const escapeHtml = (value) =>
    String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const getFooterControls = (footer) => {
    const buttons = footer?.querySelectorAll(".page-btn") || [];
    return {
      prev: buttons[0] || null,
      next: buttons[1] || null,
      pageNumber: footer?.querySelector(".page-number") || null,
      pageMeta: footer?.querySelector(".table-footer-meta") || null,
    };
  };

  const incomingCompactPager = getFooterControls(incomingCompactFooter);
  const directoryPager = getFooterControls(ordersDirectoryFooter);
  const paymentsPager = getFooterControls(paymentsHistoryFooter);

  const toTimestamp = (value) => {
    const ts = Date.parse(String(value || ""));
    return Number.isFinite(ts) ? ts : 0;
  };

  const toNumericId = (value) => {
    const parsed = Number(String(value ?? "").replace(/[^0-9]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const sortOrdersByCreatedAsc = (rows) =>
    [...(Array.isArray(rows) ? rows : [])].sort(
      (a, b) =>
        toTimestamp(a?.created_at || a?.created_at_label) -
          toTimestamp(b?.created_at || b?.created_at_label) ||
        toNumericId(a?.id || a?.order_id || a?.order_no) -
          toNumericId(b?.id || b?.order_id || b?.order_no),
    );

  const sortPaymentsByOrderAsc = (rows) =>
    [...(Array.isArray(rows) ? rows : [])].sort(
      (a, b) =>
        toNumericId(a?.order_id || a?.order_no || a?.payment_id) -
          toNumericId(b?.order_id || b?.order_no || b?.payment_id),
    );

  const normalizeStateOrdering = () => {
    state.incoming = sortOrdersByCreatedAsc(state.incoming);
    state.directory = sortOrdersByCreatedAsc(state.directory);
    state.payments = sortPaymentsByOrderAsc(state.payments);
  };

  const formatMoney = (amount) => {
    const parsed = Number(amount || 0);
    const safe = Number.isFinite(parsed) ? parsed : 0;
    return `₱ ${safe.toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const formatDateLabel = (value) => {
    const date = new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString("en-PH", {
      timeZone: PHILIPPINES_TIME_ZONE,
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const formatDateShort = (value) => {
    const date = new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleDateString("en-PH", {
      timeZone: PHILIPPINES_TIME_ZONE,
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatQuantity = (qty) => {
    const quantity = Math.max(1, Number.parseInt(String(qty || "1"), 10) || 1);
    return `${quantity} Item${quantity > 1 ? "s" : ""}`;
  };

  const lifecycleClass = (status) => {
    switch (String(status || "").toLowerCase()) {
      case "completed":
        return "status-green";
      case "rejected":
        return "status-red";
      case "incoming":
        return "status-yellow";
      default:
        return "status-blue";
    }
  };

  const paymentStatusClass = (status) => {
    switch (String(status || "").toLowerCase()) {
      case "paid":
        return "status-green";
      case "refunded":
        return "status-red";
      default:
        return "status-blue";
    }
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

    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    const hasBody = Object.prototype.hasOwnProperty.call(options, "body");
    if (hasBody) {
      headers["Content-Type"] = "application/json";
    }

    headers["Cache-Control"] = "no-cache";
    headers.Pragma = "no-cache";

    const timeoutController = new AbortController();
    const externalSignal = options.signal;

    const abortFromExternal = () => timeoutController.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        timeoutController.abort();
      } else {
        externalSignal.addEventListener("abort", abortFromExternal, { once: true });
      }
    }

    const timeoutId = window.setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS);

    let response;
    let data = {};

    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        method: options.method || "GET",
        headers,
        body: hasBody ? JSON.stringify(options.body) : undefined,
        cache: options.cache || "no-store",
        signal: timeoutController.signal,
      });

      data = await response.json().catch(() => ({}));
    } catch (error) {
      if (error?.name === "AbortError") {
        if (externalSignal?.aborted) {
          const cancelled = new Error("Request cancelled.");
          cancelled.isCancelled = true;
          throw cancelled;
        }

        throw new Error("Request timed out. Please check your connection and try again.");
      }

      throw error;
    } finally {
      window.clearTimeout(timeoutId);
      if (externalSignal) {
        externalSignal.removeEventListener("abort", abortFromExternal);
      }
    }

    if (!response.ok) {
      const message = data.message || `Request failed with status ${response.status}.`;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }

    return data;
  };

  const setRefreshLoading = (active, source = "auto") => {
    if (!refreshBtn) return;
    const isManualUiAction = source === "manual" || source === "action";
    if (isManualUiAction) {
      refreshBtn.disabled = active;
      refreshBtn.classList.toggle("is-disabled", active);
    } else if (!active) {
      refreshBtn.disabled = false;
      refreshBtn.classList.remove("is-disabled");
    }
  };

  const renderEmptyTable = (tbody, colCount, message) => {
    if (!tbody) return;
    tbody.innerHTML = `
      <tr class="table-empty-row">
        <td colspan="${colCount}">
          <div class="table-empty-state">
            <i class="fa-regular fa-folder-open"></i>
            <span>${escapeHtml(message)}</span>
          </div>
        </td>
      </tr>
    `;
  };

  const renderPagedRows = ({
    rows,
    tbody,
    colCount,
    footer,
    currentPage,
    pageSize,
    emptyMessage,
    renderRow,
  }) => {
    if (!tbody) {
      return currentPage;
    }

    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    const safePage = Math.min(Math.max(currentPage, 1), totalPages);
    const start = (safePage - 1) * pageSize;
    const scoped = rows.slice(start, start + pageSize);

    if (!rows.length) {
      renderEmptyTable(tbody, colCount, emptyMessage);
    } else {
      tbody.innerHTML = scoped.map(renderRow).join("");
    }

    if (footer) {
      const controls = getFooterControls(footer);
      if (controls.pageNumber) controls.pageNumber.textContent = String(safePage);
      if (controls.pageMeta) controls.pageMeta.textContent = `Page ${safePage} of ${totalPages}`;
      if (controls.prev) controls.prev.disabled = safePage <= 1;
      if (controls.next) controls.next.disabled = safePage >= totalPages;
    }

    return safePage;
  };

  const mapOrderById = () => {
    state.ordersById.clear();
    [...state.incoming, ...state.directory].forEach((order) => {
      if (order?.id) {
        state.ordersById.set(String(order.id), order);
      }
    });
  };

  const replaceOrAppendById = (rows, incomingRow, idField = "id") => {
    const next = Array.isArray(rows) ? [...rows] : [];
    const rowId = String(incomingRow?.[idField] || "");
    if (!rowId) return next;

    const idx = next.findIndex((entry) => String(entry?.[idField] || "") === rowId);
    if (idx >= 0) {
      next[idx] = {
        ...next[idx],
        ...incomingRow,
      };
    } else {
      next.push(incomingRow);
    }

    return next;
  };

  const removeOrderFromState = (orderId) => {
    const key = String(orderId || "");
    if (!key) return;

    state.incoming = state.incoming.filter((order) => String(order?.id || "") !== key);
    state.directory = state.directory.filter((order) => String(order?.id || "") !== key);
    state.payments = state.payments.filter((payment) => String(payment?.order_id || "") !== key);
    normalizeStateOrdering();
    mapOrderById();
  };

  const upsertOrderSummaryInState = (summary) => {
    const orderId = String(summary?.id || "");
    if (!orderId) return;

    state.incoming = state.incoming.filter((order) => String(order?.id || "") !== orderId);
    state.directory = state.directory.filter((order) => String(order?.id || "") !== orderId);

    const lifecycle = String(summary.lifecycle_status || "").toLowerCase();
    if (lifecycle === "incoming") {
      state.incoming.push(summary);
    } else {
      state.directory.push(summary);
    }

    normalizeStateOrdering();
    mapOrderById();
  };

  const upsertPaymentInState = (paymentRow) => {
    if (!paymentRow?.order_id) return;
    state.payments = replaceOrAppendById(state.payments, paymentRow, "order_id");
    normalizeStateOrdering();
  };

  const removePaymentFromState = (orderId) => {
    const key = String(orderId || "");
    if (!key) return;
    state.payments = state.payments.filter((payment) => String(payment?.order_id || "") !== key);
    normalizeStateOrdering();
  };

  const populateOrderDetailsModal = (order) => {
    if (!order || !modalOrderDetails) return;

    const setInput = (id, value) => {
      const input = document.getElementById(id);
      if (!input) return;
      input.value = value || "-";
    };

    setInput("modalOrderNo", order.order_no_display || `#${order.order_no || order.id}`);
    setInput("modalOrderDate", formatDateLabel(order.created_at || order.created_at_label));
    setInput("modalOrderItem", order.product_name || "Custom Order");
    setInput("modalOrderCustomer", order.customer_name || "Customer");
    setInput("modalOrderContact", order.customer_contact || "N/A");
    setInput(
      "modalOrderAddress",
      order.customer_address ||
        [order.location_name, order.customer_address_details].filter(Boolean).join("\n") ||
        "-",
    );
    setInput("modalOrderPayment", order.payment_method || "N/A");
    setInput("modalOrderReference", order.payment_reference || "Pending reference");
    setInput("modalOrderQty", formatQuantity(order.quantity));
    setInput("modalOrderTotal", order.total_label || formatMoney(order.total_amount));

    const statusLabel = order.lifecycle_status_label || "Pending";
    const stageLabel = order.customer_stage_label ? ` | ${order.customer_stage_label}` : "";
    setInput("modalOrderStatus", `${statusLabel}${stageLabel}`);

    const notesInput = document.getElementById("modalOrderNotes");
    if (notesInput) {
      const courierLine =
        order.courier_name || order.courier_tracking_no
          ? `Courier: ${order.courier_name || "N/A"} ${order.courier_tracking_no ? `(${order.courier_tracking_no})` : ""}`
          : "";
      const locationLine = order.location_name ? `Location: ${order.location_name}` : "";
      notesInput.value = [order.notes, courierLine, locationLine].filter(Boolean).join("\n") || "-";
    }

    modalOrderDetails.classList.add("show");
  };

  const renderIncomingCards = () => {
    if (!incomingCardsWrap) return;

    const pageSize = 6;
    const totalPages = Math.max(1, Math.ceil(state.incoming.length / pageSize));
    state.incomingCardsPage = Math.min(Math.max(state.incomingCardsPage, 1), totalPages);

    if (!state.incoming.length) {
      incomingCardsWrap.innerHTML = `
        <div class="incoming-order-card incoming-empty-card">
          <div class="table-empty-state">
            <i class="fa-regular fa-folder-open"></i>
            <span>No incoming orders found.</span>
          </div>
        </div>
      `;
      if (incomingCardsPagination) incomingCardsPagination.style.display = "none";
      if (incomingPageNumber) incomingPageNumber.textContent = "1";
      if (incomingPrevBtn) incomingPrevBtn.disabled = true;
      if (incomingNextBtn) incomingNextBtn.disabled = true;
      return;
    }

    const start = (state.incomingCardsPage - 1) * pageSize;
    const scoped = state.incoming.slice(start, start + pageSize);

    incomingCardsWrap.innerHTML = scoped
      .map((order) => {
        const orderNo = escapeHtml(order.order_no_display || `#${order.order_no || order.id}`);
        return `
          <div class="incoming-order-card">
            <div class="incoming-order-top">
              <strong>${orderNo}</strong>
            </div>
            <h4>${escapeHtml(order.product_name || "Custom Order")}</h4>
            <div class="incoming-meta-grid">
              <span><i class="fa-regular fa-user"></i> ${escapeHtml(order.customer_name || "Customer")}</span>
              <span><i class="fa-regular fa-calendar"></i> ${escapeHtml(formatDateShort(order.created_at))}</span>
              <span><i class="fa-solid fa-wallet"></i> ${escapeHtml(order.payment_method || "N/A")}</span>
              <span><i class="fa-solid fa-cubes"></i> ${escapeHtml(formatQuantity(order.quantity))}</span>
            </div>
            <div class="incoming-order-actions">
              <button type="button" data-order-view="${order.id}"><i class="fa-regular fa-eye"></i> View</button>
              <button type="button" class="btn-approve" data-order-approve="${order.id}"><i class="fa-solid fa-check"></i> Approve</button>
              <button type="button" class="btn-reject" data-order-reject="${order.id}"><i class="fa-solid fa-xmark"></i> Reject</button>
            </div>
          </div>
        `;
      })
      .join("");

    if (incomingCardsPagination) {
      incomingCardsPagination.style.display = state.incoming.length > pageSize ? "flex" : "none";
    }

    if (incomingPageNumber) incomingPageNumber.textContent = String(state.incomingCardsPage);
    if (incomingPrevBtn) incomingPrevBtn.disabled = state.incomingCardsPage <= 1;
    if (incomingNextBtn) incomingNextBtn.disabled = state.incomingCardsPage >= totalPages;
  };

  const getDirectoryRows = () => {
    const statusFilter = (directoryStatusFilter?.value || "all").trim().toLowerCase();
    const search = (directorySearch?.value || "").trim().toLowerCase();

    return state.directory.filter((order) => {
      const statusOk = statusFilter === "all" || String(order.lifecycle_status || "").toLowerCase() === statusFilter;
      if (!statusOk) return false;

      if (!search) return true;
      const haystack = [
        order.order_no_display,
        order.order_no,
        order.customer_name,
        order.product_name,
        order.payment_method,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(search);
    });
  };

  const getPaymentRows = () => {
    const methodFilter = (paymentsMethodFilter?.value || "all").trim().toLowerCase();

    return state.payments.filter((payment) => {
      if (methodFilter === "all") return true;
      return String(payment.method || "").toLowerCase() === methodFilter;
    });
  };

  const renderIncomingCompactTable = () => {
    state.incomingCompactPage = renderPagedRows({
      rows: state.incoming,
      tbody: incomingCompactTbody,
      colCount: 7,
      footer: incomingCompactFooter,
      currentPage: state.incomingCompactPage,
      pageSize: 5,
      emptyMessage: "No incoming orders found.",
      renderRow: (order) => {
        const statusClass = lifecycleClass("incoming");
        return `
          <tr>
            <td>${escapeHtml(order.order_no_display || `#${order.order_no || order.id}`)}</td>
            <td>${escapeHtml(order.customer_name || "Customer")}</td>
            <td>${escapeHtml(order.product_name || "Custom Order")}</td>
            <td>${escapeHtml(order.payment_method || "N/A")}</td>
            <td>${escapeHtml(formatDateShort(order.created_at))}</td>
            <td><span class="status-pill ${statusClass}">Incoming</span></td>
            <td class="action-icons sticky-action">
              <button data-tooltip="View Order Info" data-order-view="${order.id}"><i class="fa-regular fa-eye"></i></button>
              <button data-tooltip="Approve Order" data-order-approve="${order.id}"><i class="fa-solid fa-check"></i></button>
              <button data-tooltip="Reject Order" data-order-reject="${order.id}"><i class="fa-solid fa-xmark"></i></button>
            </td>
          </tr>
        `;
      },
    });
  };

  const renderDirectoryTable = () => {
    const rows = getDirectoryRows();

    state.directoryPage = renderPagedRows({
      rows,
      tbody: ordersDirectoryTbody,
      colCount: 8,
      footer: ordersDirectoryFooter,
      currentPage: state.directoryPage,
      pageSize: 5,
      emptyMessage: "No orders available.",
      renderRow: (order) => {
        const lifecycle = String(order.lifecycle_status || "pending").toLowerCase();
        const statusClass = lifecycleClass(lifecycle);
        const canTrack = lifecycle === "pending";

        const statusCell = canTrack
          ? `<button type="button" class="status-pill ${statusClass} status-pill-action" data-order-track="${order.id}">${escapeHtml(order.lifecycle_status_label || "Pending")}</button>`
          : `<span class="status-pill ${statusClass}">${escapeHtml(order.lifecycle_status_label || "Pending")}</span>`;

        return `
          <tr>
            <td>${escapeHtml(order.order_no_display || `#${order.order_no || order.id}`)}</td>
            <td>${escapeHtml(order.product_name || "Custom Order")}</td>
            <td>${escapeHtml(formatDateShort(order.created_at))}</td>
            <td>${escapeHtml(order.customer_name || "Customer")}</td>
            <td>${escapeHtml(order.payment_method || "N/A")}</td>
            <td>${escapeHtml(order.total_label || formatMoney(order.total_amount))}</td>
            <td>${statusCell}</td>
            <td class="action-icons sticky-action">
              <button data-tooltip="View Order Info" data-order-view="${order.id}"><i class="fa-regular fa-eye"></i></button>
              <button data-tooltip="Update Tracking" data-order-track="${order.id}" ${canTrack ? "" : "disabled class=\"is-disabled\""}><i class="fa-solid fa-route"></i></button>
              <button data-tooltip="Delete Order" data-order-delete="${order.id}"><i class="fa-regular fa-trash-can"></i></button>
            </td>
          </tr>
        `;
      },
    });
  };

  const applyPaymentSelectStyle = (select) => {
    if (!(select instanceof HTMLSelectElement)) return;
    select.classList.remove("status-green", "status-blue", "status-red");
    select.classList.add(paymentStatusClass(select.value));
  };

  const renderPaymentsTable = () => {
    const rows = getPaymentRows();

    state.paymentsPage = renderPagedRows({
      rows,
      tbody: paymentsHistoryTbody,
      colCount: 9,
      footer: paymentsHistoryFooter,
      currentPage: state.paymentsPage,
      pageSize: 5,
      emptyMessage: "No payments available.",
      renderRow: (payment) => {
        return `
          <tr>
            <td>${escapeHtml(payment.payment_id || "-")}</td>
            <td>${escapeHtml(payment.order_no_display || `#${payment.order_no || payment.order_id}`)}</td>
            <td>${escapeHtml(payment.customer_name || "Customer")}</td>
            <td>${escapeHtml(payment.method || "N/A")}</td>
            <td>${escapeHtml(payment.reference || "Pending reference")}</td>
            <td>${escapeHtml(payment.amount_label || formatMoney(payment.amount))}</td>
            <td>
              <select class="filter-select payment-status-select" data-payment-status-select="1" data-order-id="${payment.order_id}" data-previous-value="${escapeHtml(payment.status || "pending")}">
                <option value="paid" ${payment.status === "paid" ? "selected" : ""}>Paid</option>
                <option value="pending" ${payment.status === "pending" ? "selected" : ""}>Pending</option>
                <option value="refunded" ${payment.status === "refunded" ? "selected" : ""}>Refunded</option>
              </select>
            </td>
            <td>${escapeHtml(payment.date_paid ? formatDateLabel(payment.date_paid) : "-")}</td>
            <td class="action-icons sticky-action">
              <button data-tooltip="View Order Info" data-order-view="${payment.order_id}"><i class="fa-regular fa-eye"></i></button>
              <button data-tooltip="Delete Payment" data-payment-delete="${payment.order_id}"><i class="fa-regular fa-trash-can"></i></button>
            </td>
          </tr>
        `;
      },
    });

    paymentsHistoryTbody
      ?.querySelectorAll('select[data-payment-status-select="1"]')
      .forEach((select) => applyPaymentSelectStyle(select));
  };

  const renderAll = () => {
    renderIncomingCards();
    renderIncomingCompactTable();
    renderDirectoryTable();
    renderPaymentsTable();
  };

  const syncOrders = async (showErrorPopup = true, options = {}) => {
    const force = Boolean(options.force);
    const source = options.source || "auto";
    const now = Date.now();

    if (!force && source === "auto" && now - state.lastSyncAt < MIN_SYNC_GAP_MS) {
      return;
    }

    if (state.isSyncing) {
      if (force) {
        state.pendingForceSync = true;
        if (source !== "realtime" && state.syncController) {
          state.syncController.abort();
        }
      }
      return;
    }

    const requestId = state.syncRequestId + 1;
    state.syncRequestId = requestId;

    const syncController = new AbortController();
    state.syncController = syncController;
    state.isSyncing = true;
    setRefreshLoading(true, source);

    try {
      const response = await request("/admin/orders", {
        signal: syncController.signal,
      });
      state.incoming = Array.isArray(response.incoming) ? response.incoming : [];
      state.directory = Array.isArray(response.directory) ? response.directory : [];
      state.payments = Array.isArray(response.payments) ? response.payments : [];
      normalizeStateOrdering();
      mapOrderById();
      renderAll();
      state.lastSyncAt = Date.now();
    } catch (error) {
      if (error?.isCancelled) {
        return;
      }

      const status = Number(error?.status || 0);
      if (status === 401 || status === 403) {
        showPopup("Session expired or unauthorized. Please login again.", {
          title: "Access Required",
          onOk: () => {
            window.location.href = "../admin-auth/auth.html";
          },
        });
        return;
      }

      if (showErrorPopup) {
        showPopup(error.message || "Unable to load orders from the server.", {
          title: "Sync Failed",
        });
      }

      renderEmptyTable(incomingCompactTbody, 7, "Unable to load incoming orders.");
      renderEmptyTable(ordersDirectoryTbody, 8, "Unable to load orders directory.");
      renderEmptyTable(paymentsHistoryTbody, 9, "Unable to load payments history.");

      if (incomingCardsWrap) {
        incomingCardsWrap.innerHTML = `
          <div class="incoming-order-card incoming-empty-card">
            <div class="table-empty-state">
              <i class="fa-regular fa-folder-open"></i>
              <span>Unable to load incoming orders.</span>
            </div>
          </div>
        `;
      }
    } finally {
      if (state.syncController === syncController) {
        state.syncController = null;
      }
      if (requestId === state.syncRequestId) {
        state.isSyncing = false;
        setRefreshLoading(false, source);
      }

      if (state.pendingForceSync) {
        state.pendingForceSync = false;
        window.setTimeout(() => {
          void syncOrders(false, { force: true, source: "realtime" });
        }, 180);
      }
    }
  };

  const openTrackingModal = (order) => {
    if (!order || !modalTrackingUpdate) return;

    if (trackingOrderId) trackingOrderId.value = String(order.id || "");
    if (trackingOrderNo) trackingOrderNo.value = order.order_no_display || `#${order.order_no || order.id}`;
    if (trackingStage) trackingStage.value = order.customer_stage || "to_pay";
    if (trackingEventTitle) trackingEventTitle.value = "";
    if (trackingEventDescription) trackingEventDescription.value = "";
    if (trackingCourierName) trackingCourierName.value = order.courier_name || "J&T Express";
    if (trackingCourierNo) trackingCourierNo.value = order.courier_tracking_no || "";
    if (trackingLocationName) trackingLocationName.value = order.location_name || "";
    if (trackingLatitude) trackingLatitude.value = order.latitude ?? "";
    if (trackingLongitude) trackingLongitude.value = order.longitude ?? "";

    modalTrackingUpdate.classList.add("show");
  };

  const updatePaymentStatus = async (orderId, status, selectElement) => {
    if (!orderId || !status) return;

    const previousValue = selectElement.dataset.previousValue || "pending";

    try {
      const payload = await request(`/admin/orders/${orderId}/payment-status`, {
        method: "PATCH",
        body: { status },
      });

      selectElement.dataset.previousValue = status;
      applyPaymentSelectStyle(selectElement);

      if (payload?.payment) {
        upsertPaymentInState(payload.payment);
      }

      if (payload?.order) {
        upsertOrderSummaryInState(payload.order);
      }

      renderAll();
      notifyOrdersRealtimeUpdate({
        type: "payment-status-updated",
        orderId: String(orderId),
      });
      void syncOrders(false, { force: true, source: "action" });
    } catch (error) {
      selectElement.value = previousValue;
      applyPaymentSelectStyle(selectElement);
      showPopup(error.message || "Unable to update payment status.", { title: "Update Failed" });
    }
  };

  const deletePayment = async (orderId) => {
    const key = String(orderId || "");
    if (!key) return;

    const shouldContinue = await askConfirm("Delete this payment record from history?", {
      title: "Delete Payment Record",
      confirmText: "Delete",
      cancelText: "Cancel",
    });

    if (!shouldContinue) return;

    try {
      await request(`/admin/orders/${key}/payment`, {
        method: "DELETE",
      });

      removePaymentFromState(key);
      renderPaymentsTable();
      showPopup("Payment record deleted successfully.", { title: "Deleted" });
      notifyOrdersRealtimeUpdate({ type: "payment-deleted", orderId: key });
      void syncOrders(false, { force: true, source: "action" });
    } catch (error) {
      showPopup(error.message || "Unable to delete payment record.", {
        title: "Delete Failed",
      });
    }
  };

  const mutateOrder = async (orderId, action) => {
    const actionMap = {
      approve: {
        path: `/admin/orders/${orderId}/approve`,
        method: "POST",
        title: "Approve Incoming Order",
        message: "Approve this incoming order and move it to pending?",
        confirmText: "Approve",
        success: "Order approved and moved to pending.",
      },
      reject: {
        path: `/admin/orders/${orderId}/reject`,
        method: "POST",
        title: "Reject Incoming Order",
        message: "Reject this incoming order?",
        confirmText: "Reject",
        success: "Order rejected.",
      },
      delete: {
        path: `/admin/orders/${orderId}`,
        method: "DELETE",
        title: "Delete Order",
        message: "Delete this order permanently? This action cannot be undone.",
        confirmText: "Delete",
        success: "Order deleted successfully.",
      },
    };

    const config = actionMap[action];
    if (!config) return;

    const shouldContinue = await askConfirm(config.message, {
      title: config.title,
      confirmText: config.confirmText,
    });

    if (!shouldContinue) return;

    try {
      const payload = await request(config.path, {
        method: config.method || "POST",
        body: action === "reject" ? { reason: null } : undefined,
      });

      if (action === "delete") {
        removeOrderFromState(orderId);
      } else if (payload?.data) {
        upsertOrderSummaryInState(payload.data);
      }

      renderAll();
      showPopup(config.success, { title: "Success" });
      notifyOrdersRealtimeUpdate({ type: `order-${action}`, orderId: String(orderId) });
      void syncOrders(false, { force: true, source: "action" });
    } catch (error) {
      showPopup(error.message || "Action failed.", { title: "Action Failed" });
    }
  };

  incomingPrevBtn?.addEventListener("click", () => {
    if (state.incomingCardsPage <= 1) return;
    state.incomingCardsPage -= 1;
    renderIncomingCards();
  });

  incomingNextBtn?.addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(state.incoming.length / 6));
    if (state.incomingCardsPage >= totalPages) return;
    state.incomingCardsPage += 1;
    renderIncomingCards();
  });

  incomingCompactPager.prev?.addEventListener("click", () => {
    if (state.incomingCompactPage <= 1) return;
    state.incomingCompactPage -= 1;
    renderIncomingCompactTable();
  });

  incomingCompactPager.next?.addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(state.incoming.length / 5));
    if (state.incomingCompactPage >= totalPages) return;
    state.incomingCompactPage += 1;
    renderIncomingCompactTable();
  });

  directoryPager.prev?.addEventListener("click", () => {
    if (state.directoryPage <= 1) return;
    state.directoryPage -= 1;
    renderDirectoryTable();
  });

  directoryPager.next?.addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(getDirectoryRows().length / 5));
    if (state.directoryPage >= totalPages) return;
    state.directoryPage += 1;
    renderDirectoryTable();
  });

  paymentsPager.prev?.addEventListener("click", () => {
    if (state.paymentsPage <= 1) return;
    state.paymentsPage -= 1;
    renderPaymentsTable();
  });

  paymentsPager.next?.addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(getPaymentRows().length / 5));
    if (state.paymentsPage >= totalPages) return;
    state.paymentsPage += 1;
    renderPaymentsTable();
  });

  directoryStatusFilter?.addEventListener("change", () => {
    state.directoryPage = 1;
    renderDirectoryTable();
  });

  directorySearch?.addEventListener("input", () => {
    state.directoryPage = 1;
    renderDirectoryTable();
  });

  paymentsMethodFilter?.addEventListener("change", () => {
    state.paymentsPage = 1;
    renderPaymentsTable();
  });

  refreshBtn?.addEventListener("click", () => {
    refreshBtn.disabled = true;
    window.location.reload();
  });

  btnSaveTrackingUpdate?.addEventListener("click", async () => {
    const orderId = trackingOrderId?.value || "";
    if (!orderId) {
      showPopup("No order selected for tracking update.", { title: "Update Failed" });
      return;
    }

    const stage = trackingStage?.value || "to_pay";
    const payload = {
      stage,
      title: trackingEventTitle?.value?.trim() || null,
      description: trackingEventDescription?.value?.trim() || null,
      courier_name: trackingCourierName?.value?.trim() || null,
      courier_tracking_no: trackingCourierNo?.value?.trim() || null,
      location_name: trackingLocationName?.value?.trim() || null,
      latitude: trackingLatitude?.value ? Number(trackingLatitude.value) : null,
      longitude: trackingLongitude?.value ? Number(trackingLongitude.value) : null,
    };

    if (payload.latitude !== null && !Number.isFinite(payload.latitude)) {
      showPopup("Latitude must be a valid number.", { title: "Validation Error" });
      return;
    }

    if (payload.longitude !== null && !Number.isFinite(payload.longitude)) {
      showPopup("Longitude must be a valid number.", { title: "Validation Error" });
      return;
    }

    const shouldSave = await askConfirm("Save this tracking update?", {
      title: "Confirm Tracking Update",
      confirmText: "Save",
    });

    if (!shouldSave) return;

    try {
      const response = await request(`/admin/orders/${orderId}/tracking`, {
        method: "PATCH",
        body: payload,
      });

      if (response?.data) {
        upsertOrderSummaryInState(response.data);
        renderAll();
      }

      modalTrackingUpdate?.classList.remove("show");
      showPopup("Tracking update saved successfully.", { title: "Success" });
      notifyOrdersRealtimeUpdate({ type: "tracking-updated", orderId: String(orderId) });
      void syncOrders(false, { force: true, source: "action" });
    } catch (error) {
      showPopup(error.message || "Unable to save tracking update.", {
        title: "Update Failed",
      });
    }
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const viewBtn = target.closest("[data-order-view]");
    if (viewBtn) {
      const orderId = String(viewBtn.getAttribute("data-order-view") || "");
      const order = state.ordersById.get(orderId);
      if (order) {
        populateOrderDetailsModal(order);
      }
      return;
    }

    const trackBtn = target.closest("[data-order-track]");
    if (trackBtn) {
      const orderId = String(trackBtn.getAttribute("data-order-track") || "");
      const order = state.ordersById.get(orderId);
      if (order) {
        openTrackingModal(order);
      }
      return;
    }

    const approveBtn = target.closest("[data-order-approve]");
    if (approveBtn) {
      const orderId = String(approveBtn.getAttribute("data-order-approve") || "");
      void mutateOrder(orderId, "approve");
      return;
    }

    const rejectBtn = target.closest("[data-order-reject]");
    if (rejectBtn) {
      const orderId = String(rejectBtn.getAttribute("data-order-reject") || "");
      void mutateOrder(orderId, "reject");
      return;
    }

    const deleteBtn = target.closest("[data-order-delete]");
    if (deleteBtn) {
      const orderId = String(deleteBtn.getAttribute("data-order-delete") || "");
      if (!orderId) return;
      void mutateOrder(orderId, "delete");
      return;
    }

    const deletePaymentBtn = target.closest("[data-payment-delete]");
    if (deletePaymentBtn) {
      const orderId = String(deletePaymentBtn.getAttribute("data-payment-delete") || "");
      if (!orderId) return;
      void deletePayment(orderId);
    }
  });

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;

    if (target.matches('select[data-payment-status-select="1"]')) {
      const orderId = target.getAttribute("data-order-id") || "";
      const status = target.value || "pending";
      applyPaymentSelectStyle(target);
      void updatePaymentStatus(orderId, status, target);
    }
  });

  if (!authToken) {
    showPopup("Please login first to access order management.", {
      title: "Session Required",
      onOk: () => {
        window.location.href = "../admin-auth/auth.html";
      },
    });
    return;
  }

  state.pollTimer = window.setInterval(() => {
    if (document.hidden) return;
    void syncOrders(false, { source: "auto" });
  }, ORDERS_BACKGROUND_SYNC_MS);

  window.addEventListener("storage", (event) => {
    if (event.key !== "fmrc_orders_updated_at") return;
    if (document.hidden) return;

    let payload = {};
    try {
      payload = JSON.parse(event.newValue || "{}");
    } catch {
      payload = {};
    }
    if (!shouldProcessRealtimeSignal(payload)) return;

    void syncOrders(false, { force: true, source: "realtime" });
  });

  window.addEventListener("fmrc:orders-updated", (event) => {
    const payload = event?.detail || {};
    if (payload?.source === "admin-orders") return;
    if (document.hidden) return;
    if (!shouldProcessRealtimeSignal(payload)) return;
    void syncOrders(false, { force: true, source: "realtime" });
  });

  const realtimeChannel = getOrdersRealtimeChannel();
  realtimeChannel?.addEventListener("message", (event) => {
    const payload = event?.data || {};
    if (payload?.source === "admin-orders") return;
    if (document.hidden) return;
    if (!shouldProcessRealtimeSignal(payload)) return;
    void syncOrders(false, { force: true, source: "realtime" });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    void syncOrders(false, { force: true, source: "realtime" });
  });

  window.addEventListener("focus", () => {
    if (document.hidden) return;
    void syncOrders(false, { force: true, source: "realtime" });
  });

  window.addEventListener("beforeunload", () => {
    if (state.pollTimer) {
      window.clearInterval(state.pollTimer);
    }
  });

  void syncOrders(true, { force: true, source: "manual" });
});
