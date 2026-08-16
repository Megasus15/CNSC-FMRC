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
  const authToken =
    (window.AdminSession && window.AdminSession.getToken()) ||
    localStorage.getItem("auth_token");
  const PHILIPPINES_TIME_ZONE = "Asia/Manila";
  const REQUEST_TIMEOUT_MS = 25000; // Increased to 25s because local Laravel SMTP blocking causes long load times
  const ORDERS_REALTIME_CHANNEL = "fmrc-orders-realtime";
  const MIN_SYNC_GAP_MS = 2500;

  let ordersRealtimeChannel = null;

  const getOrdersRealtimeChannel = () => {
    if (typeof window.BroadcastChannel !== "function") return null;
    if (!ordersRealtimeChannel) {
      ordersRealtimeChannel = new window.BroadcastChannel(
        ORDERS_REALTIME_CHANNEL,
      );
    }
    return ordersRealtimeChannel;
  };

  const incomingOrdersTable = document.getElementById("incomingOrdersTable");
  const incomingOrdersTbody = incomingOrdersTable?.querySelector("tbody");
  const incomingOrdersFooter = document.getElementById("incomingOrdersFooter");

  const ordersDirectoryTbody = document.querySelector(
    "#ordersDirectoryTable tbody",
  );
  const ordersDirectoryFooter = document.getElementById(
    "ordersDirectoryFooter",
  );
  const directoryStatusFilter = document.getElementById(
    "ordersDirectoryStatusFilter",
  );
  const directorySearch = document.getElementById("ordersDirectorySearch");

  const paymentsHistoryTbody = document.querySelector(
    "#paymentsHistoryTable tbody",
  );
  const paymentsHistoryTable = document.getElementById("paymentsHistoryTable");
  const paymentsHistoryFooter = document.getElementById(
    "paymentsHistoryFooter",
  );
  const paymentsMethodFilter = document.getElementById("paymentsMethodFilter");

  const rejectedOrdersTbody = document.querySelector(
    "#rejectedOrdersTable tbody",
  );
  const rejectedOrdersTable = document.getElementById("rejectedOrdersTable");
  const rejectedOrdersFooter = document.getElementById("rejectedOrdersFooter");

  const walkInOrdersTbody = document.querySelector("#walkInOrdersTable tbody");
  const walkInOrdersFooter = document.getElementById("walkInOrdersFooter");
  const openWalkInOrderModalBtn = document.getElementById(
    "openWalkInOrderModalBtn",
  );
  const modalAddWalkInOrder = document.getElementById("modalAddWalkInOrder");
  const modalWalkInDetails = document.getElementById("modalWalkInDetails");
  const walkInOrderNoInput = document.getElementById("walkInOrderNoInput");
  const walkInCustomerNameInput = document.getElementById(
    "walkInCustomerNameInput",
  );
  const walkInAddressInput = document.getElementById("walkInAddressInput");
  const walkInContactNumberInput = document.getElementById(
    "walkInContactNumberInput",
  );
  const walkInClientTypeInput = document.getElementById(
    "walkInClientTypeInput",
  );
  const walkInClientTypeOtherInput = document.getElementById(
    "walkInClientTypeOtherInput",
  );
  const walkInClientTypeOtherWrap = document.getElementById(
    "walkInClientTypeOtherWrap",
  );
  const walkInAgencyOrganizationInput = document.getElementById(
    "walkInAgencyOrganizationInput",
  );
  const walkInProjectDescriptionInput = document.getElementById(
    "walkInProjectDescriptionInput",
  );
  const walkInProjectDescriptionOtherInput = document.getElementById(
    "walkInProjectDescriptionOtherInput",
  );
  const walkInProjectDescriptionOtherWrap = document.getElementById(
    "walkInProjectDescriptionOtherWrap",
  );
  const walkInItemDetailInput = document.getElementById(
    "walkInItemDetailInput",
  );
  const walkInItemDetailWrap = document.getElementById("walkInItemDetailWrap");
  const walkInItemDetailList = document.getElementById("walkInItemDetailList");
  const walkInUnitInput = document.getElementById("walkInUnitInput");
  const walkInSubtotalCostInput = document.getElementById(
    "walkInSubtotalCostInput",
  );
  const walkInPaymentMethodInput = document.getElementById(
    "walkInPaymentMethodInput",
  );
  const walkInTotalInput = document.getElementById("walkInTotalInput");
  const cancelWalkInOrderBtn = document.getElementById("cancelWalkInOrderBtn");
  const saveWalkInOrderBtn = document.getElementById("saveWalkInOrderBtn");
  const btnCloseWalkInDetails = document.getElementById(
    "btnCloseWalkInDetails",
  );

  const walkInDetailOrderNo = document.getElementById("walkInDetailOrderNo");
  const walkInDetailName = document.getElementById("walkInDetailName");
  const walkInDetailAddress = document.getElementById("walkInDetailAddress");
  const walkInDetailContact = document.getElementById("walkInDetailContact");
  const walkInDetailClientType = document.getElementById(
    "walkInDetailClientType",
  );
  const walkInDetailAgency = document.getElementById("walkInDetailAgency");
  const walkInDetailProject = document.getElementById("walkInDetailProject");
  const walkInDetailItem = document.getElementById("walkInDetailItem");
  const walkInDetailUnit = document.getElementById("walkInDetailUnit");
  const walkInDetailSubtotal = document.getElementById("walkInDetailSubtotal");
  const walkInDetailTotal = document.getElementById("walkInDetailTotal");
  const walkInDetailPayment = document.getElementById("walkInDetailPayment");
  const walkInDetailDate = document.getElementById("walkInDetailDate");
  const btnEditWalkInFromView = document.getElementById(
    "btnEditWalkInFromView",
  );

  const modalDeletePaymentHistory = document.getElementById(
    "modalArchivePaymentHistory",
  );
  const paymentDeleteTargetLabel = document.getElementById(
    "paymentArchiveTargetLabel",
  );
  const btnCancelDeletePaymentHistory = document.getElementById(
    "btnCancelArchivePaymentHistory",
  );
  const btnConfirmDeletePaymentHistory = document.getElementById(
    "btnConfirmArchivePaymentHistory",
  );

  const refreshBtn = document.getElementById("ordersRefreshBtn");

  const modalOrderDetails = document.getElementById("modalOrderDetails");
  const modalTrackingUpdate = document.getElementById("modalTrackingUpdate");

  const trackingOrderId = document.getElementById("trackingOrderId");
  const trackingOrderNo = document.getElementById("trackingOrderNo");
  const trackingStage = document.getElementById("trackingStage");
  const trackingEventTitle = document.getElementById("trackingEventTitle");
  const trackingEventDescription = document.getElementById(
    "trackingEventDescription",
  );
  const trackingCourierName = document.getElementById("trackingCourierName");
  const trackingCourierNo = document.getElementById("trackingCourierNo");
  const trackingLocationName = document.getElementById("trackingLocationName");
  const btnCancelTrackingUpdate = document.getElementById(
    "btnCancelTrackingUpdate",
  );
  const btnSaveTrackingUpdate = document.getElementById(
    "btnSaveTrackingUpdate",
  );

  const state = {
    incoming: [],
    directory: [],
    payments: [],
    walkIn: [],
    ordersById: new Map(),
    incomingPage: 1,
    directoryPage: 1,
    paymentsPage: 1,
    walkInPage: 1,
    rejectedPage: 1,
    isSyncing: false,
    syncController: null,
    syncRequestId: 0,
    lastSyncAt: 0,
    pendingForceSync: false,
    lastRealtimeSignalTs: 0,
  };

  let viewingWalkInOrderId = null;
  let deletingPaymentOrderId = null;
  let incomingBulkController = null;
  let rejectedBulkController = null;
  let paymentBulkController = null;
  let trackingDiscardGuard = null;
  let walkInDiscardGuard = null;
  let walkInFormInteracted = false;

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

    window.dispatchEvent(
      new CustomEvent("fmrc:orders-updated", { detail: payload }),
    );

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

  // Returns the list of individual order items for an order/payment row.
  // Falls back to a single synthetic item from the collapsed product_name
  // label when the backend did not provide an items array (older records).
  const getOrderItemsList = (order) => {
    const items = Array.isArray(order?.items) ? order.items : [];
    if (items.length > 0) return items;

    const fallbackName = order?.product_name || "Custom Order";
    return [
      {
        product_name: fallbackName,
        quantity: order?.quantity || 1,
      },
    ];
  };

  // Renders each product item individually as an inline, comma-free stacked
  // label (e.g. "CSS Box ×2", "Acrylic Sheet ×1") for use inside table cells
  // and cards, instead of the collapsed "First Item (+N more)" text.
  const renderOrderItemsInline = (order) => {
    const items = getOrderItemsList(order);
    return items
      .map((item) => {
        const name = escapeHtml(item.product_name || "Custom Order");
        const qty = Math.max(1, Number.parseInt(item.quantity || "1", 10) || 1);
        return `<div class="order-item-line">${name} <span class="order-item-qty">×${qty}</span></div>`;
      })
      .join("");
  };


  const getFooterControls = (footer) => {
    const buttons = footer?.querySelectorAll(".page-btn") || [];
    return {
      prev: buttons[0] || null,
      next: buttons[1] || null,
      pageNumber: footer?.querySelector(".page-number") || null,
      pageMeta: footer?.querySelector(".table-footer-meta") || null,
    };
  };

  const incomingPager = getFooterControls(incomingOrdersFooter);
  const directoryPager = getFooterControls(ordersDirectoryFooter);
  const paymentsPager = getFooterControls(paymentsHistoryFooter);
  const walkInPager = getFooterControls(walkInOrdersFooter);

  const rejectedPager = getFooterControls(rejectedOrdersFooter);

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

  const sortWalkInByDateDesc = (rows) =>
    [...(Array.isArray(rows) ? rows : [])].sort(
      (a, b) =>
        toTimestamp(b?.order_date || b?.created_at) -
          toTimestamp(a?.order_date || a?.created_at) ||
        toNumericId(b?.id || b?.order_no) - toNumericId(a?.id || a?.order_no),
    );

  const normalizeStateOrdering = () => {
    state.incoming = sortOrdersByCreatedAsc(state.incoming);
    state.directory = sortOrdersByCreatedAsc(state.directory);
    state.walkIn = sortWalkInByDateDesc(state.walkIn);
  };

  const getCompletedDirectoryRows = () =>
    state.directory.filter(
      (order) =>
        String(order?.lifecycle_status || "").toLowerCase() === "completed",
    );

  const refreshPaymentsFromDirectory = () => {
    state.payments = sortPaymentsByOrderAsc(getCompletedDirectoryRows());
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

  const ORDERS_SUCCESS_FLASH_KEY = "fmrc_orders_success_flash";

  const queueSuccessFlash = (message, title = "Success") => {
    try {
      sessionStorage.setItem(
        ORDERS_SUCCESS_FLASH_KEY,
        JSON.stringify({
          message: String(message || "Success"),
          title: String(title || "Success"),
        }),
      );
    } catch {
      // Ignore storage failures (private mode/quota).
    }
  };

  const showQueuedSuccess = () => {
    let payload = null;
    try {
      payload = JSON.parse(
        sessionStorage.getItem(ORDERS_SUCCESS_FLASH_KEY) || "null",
      );
    } catch {
      payload = null;
    }

    if (!payload?.message) return;

    try {
      sessionStorage.removeItem(ORDERS_SUCCESS_FLASH_KEY);
    } catch {
      // Ignore storage failures.
    }

    window.setTimeout(() => {
      showPopup(payload.message, { title: payload.title || "Success" });
    }, 0);
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
        externalSignal.addEventListener("abort", abortFromExternal, {
          once: true,
        });
      }
    }

    const timeoutId = window.setTimeout(
      () => timeoutController.abort(),
      REQUEST_TIMEOUT_MS,
    );

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

        throw new Error(
          "Request timed out. Please check your connection and try again.",
        );
      }

      throw error;
    } finally {
      window.clearTimeout(timeoutId);
      if (externalSignal) {
        externalSignal.removeEventListener("abort", abortFromExternal);
      }
    }

    if (!response.ok) {
      const message =
        data.message || `Request failed with status ${response.status}.`;
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
      if (controls.pageNumber) {
        controls.pageNumber.value = String(safePage);
        controls.pageNumber.max = String(totalPages);
      }
      if (controls.pageMeta)
        controls.pageMeta.textContent = `Page ${safePage} of ${totalPages}`;
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

    const idx = next.findIndex(
      (entry) => String(entry?.[idField] || "") === rowId,
    );
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

    state.incoming = state.incoming.filter(
      (order) => String(order?.id || "") !== key,
    );
    state.directory = state.directory.filter(
      (order) => String(order?.id || "") !== key,
    );
    normalizeStateOrdering();
    refreshPaymentsFromDirectory();
    mapOrderById();
  };

  const upsertOrderSummaryInState = (summary) => {
    const orderId = String(summary?.id || "");
    if (!orderId) return;

    state.incoming = state.incoming.filter(
      (order) => String(order?.id || "") !== orderId,
    );
    state.directory = state.directory.filter(
      (order) => String(order?.id || "") !== orderId,
    );

    const lifecycle = String(summary.lifecycle_status || "").toLowerCase();
    if (lifecycle === "incoming") {
      state.incoming.push(summary);
    } else {
      state.directory.push(summary);
    }

    normalizeStateOrdering();
    refreshPaymentsFromDirectory();
    mapOrderById();
  };

  const populateOrderDetailsModal = (order) => {
    if (!order || !modalOrderDetails) return;

    const setInput = (id, value) => {
      const input = document.getElementById(id);
      if (!input) return;
      input.value = value || "-";
    };

    setInput(
      "modalOrderNo",
      order.order_no_display || `#${order.order_no || order.id}`,
    );
    setInput(
      "modalOrderDate",
      formatDateLabel(order.created_at || order.created_at_label),
    );
    const itemsSummary = getOrderItemsList(order)
      .map((item) => {
        const qty = Math.max(
          1,
          Number.parseInt(item.quantity || "1", 10) || 1,
        );
        return `${item.product_name || "Custom Order"} (x${qty})`;
      })
      .join(", ");
    setInput("modalOrderItem", itemsSummary || order.product_name || "Custom Order");

    setInput("modalOrderCustomer", order.customer_name || "Customer");
    setInput("modalOrderContact", order.customer_contact || "N/A");
    setInput(
      "modalOrderAddress",
      order.customer_address ||
        [order.location_name, order.customer_address_details]
          .filter(Boolean)
          .join("\n") ||
        "-",
    );
    setInput("modalOrderPayment", order.payment_method || "N/A");
    setInput(
      "modalOrderReference",
      order.payment_reference || "Pending reference",
    );
    setInput("modalOrderQty", formatQuantity(order.quantity));
    setInput(
      "modalOrderTotal",
      order.total_label || formatMoney(order.total_amount),
    );

    const statusLabel = order.lifecycle_status_label || "Pending";
    const stageLabel = order.customer_stage_label
      ? ` | ${order.customer_stage_label}`
      : "";
    setInput("modalOrderStatus", `${statusLabel}${stageLabel}`);

    const notesInput = document.getElementById("modalOrderNotes");
    if (notesInput) {
      const courierLine =
        order.courier_name || order.courier_tracking_no
          ? `Courier: ${order.courier_name || "N/A"} ${order.courier_tracking_no ? `(${order.courier_tracking_no})` : ""}`
          : "";
      const locationLine = order.location_name
        ? `Location: ${order.location_name}`
        : "";
      notesInput.value =
        [order.notes, courierLine, locationLine].filter(Boolean).join("\n") ||
        "-";
    }

    modalOrderDetails.classList.add("show");
  };

  const getRejectedRows = () =>
    state.directory.filter(
      (order) =>
        String(order?.lifecycle_status || "").toLowerCase() === "rejected",
    );

  const getDirectoryRows = () => {
    const statusFilter = (directoryStatusFilter?.value || "all")
      .trim()
      .toLowerCase();
    const search = (directorySearch?.value || "").trim().toLowerCase();

    return state.directory.filter((order) => {
      const ls = String(order.lifecycle_status || "").toLowerCase();
      if (ls === "completed") return false;
      if (ls === "rejected") return false; // shown only in Rejected Orders panel
      const statusOk = statusFilter === "all" || ls === statusFilter;
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
    const methodFilter = (paymentsMethodFilter?.value || "all")
      .trim()
      .toLowerCase();

    return state.payments.filter((payment) => {
      if (methodFilter === "all") return true;
      return (
        String(payment.payment_method || payment.method || "").toLowerCase() ===
        methodFilter
      );
    });
  };

  const renderIncomingTable = () => {
    state.incomingPage = renderPagedRows({
      rows: state.incoming,
      tbody: incomingOrdersTbody,
      colCount: 10,
      footer: incomingOrdersFooter,
      currentPage: state.incomingPage,
      pageSize: 5,
      emptyMessage: "No incoming orders found.",
      renderRow: (order) => {
        const statusClass = lifecycleClass("incoming");
        return `
          <tr>
            <td class="admin-bulk-select-cell"><input type="checkbox" data-admin-bulk-row="incoming-orders" value="${order.id}" aria-label="Select ${escapeHtml(order.order_no_display || `order ${order.order_no || order.id}`)}" /></td>
            <td>${escapeHtml(order.order_no_display || `#${order.order_no || order.id}`)}</td>
            <td>${escapeHtml(order.customer_name || "Customer")}</td>
            <td class="order-items-cell">${renderOrderItemsInline(order)}</td>
            <td>${escapeHtml(formatQuantity(order.quantity))}</td>
            <td>${escapeHtml(order.payment_method || "N/A")}</td>
            <td>${escapeHtml(order.total_label || formatMoney(order.total_amount))}</td>
            <td>${escapeHtml(formatDateLabel(order.created_at))}</td>
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
    incomingBulkController?.sync();
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
        const lifecycle = String(
          order.lifecycle_status || "pending",
        ).toLowerCase();
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
              <button data-tooltip="Update Tracking" data-order-track="${order.id}" ${canTrack ? "" : 'disabled class="is-disabled"'}><i class="fa-solid fa-route"></i></button>
            </td>
          </tr>
        `;
      },
    });
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
        const orderId = payment.id || payment.order_id || "";
        const orderNo =
          payment.order_no_display ||
          `#${payment.order_no || payment.order_id || payment.id}`;
        const paymentId = payment.payment_id || payment.payment_no || orderNo;
        const paidAt =
          payment.date_paid ||
          payment.completed_at ||
          payment.updated_at ||
          payment.created_at;
        const paymentMethod = payment.payment_method || payment.method || "N/A";
        const paymentAmountLabel =
          payment.total_label ||
          payment.amount_label ||
          formatMoney(payment.total_amount || payment.amount);
        return `
          <tr>
            <td class="admin-bulk-select-cell"><input type="checkbox" data-admin-bulk-row="payment-orders" value="${orderId}" aria-label="Select payment for ${escapeHtml(orderNo)}" /></td>
            <td>${escapeHtml(paymentId)}</td>
            <td>${escapeHtml(orderNo)}</td>
            <td>${escapeHtml(payment.customer_name || "Customer")}</td>
            <td>${escapeHtml(paymentMethod)}</td>
            <td>${escapeHtml(paymentAmountLabel)}</td>
            <td><span class="status-pill status-green">Completed</span></td>
            <td>${escapeHtml(paidAt ? formatDateLabel(paidAt) : "-")}</td>
            <td class="action-icons sticky-action">
              <button data-tooltip="View Order Info" data-order-view="${orderId}"><i class="fa-regular fa-eye"></i></button>
              <button data-tooltip="Archive Payment" data-payment-archive="${orderId}"><i class="fa-solid fa-box-archive"></i></button>
            </td>
          </tr>
        `;
      },
    });
    paymentBulkController?.sync();
  };

  const renderWalkInTable = () => {
    state.walkInPage = renderPagedRows({
      rows: state.walkIn,
      tbody: walkInOrdersTbody,
      colCount: 13,
      footer: walkInOrdersFooter,
      currentPage: state.walkInPage,
      pageSize: 5,
      emptyMessage: "No walk-in orders available.",
      renderRow: (row) => `
        <tr>
          <td>${escapeHtml(row.order_no || "-")}</td>
          <td>${escapeHtml(row.customer_name || row.customer || "-")}</td>
          <td title="${escapeHtml(row.address || "-")}">${escapeHtml(row.address || "-")}</td>
          <td>${escapeHtml(row.contact_number || "-")}</td>
          <td>${escapeHtml(row.client_type || "-")}${row.client_type_other ? `: ${escapeHtml(row.client_type_other)}` : ""}</td>
          <td>${escapeHtml(row.agency_organization || "-")}</td>
          <td>${escapeHtml(row.project_description || "-")}${row.project_description_other ? `: ${escapeHtml(row.project_description_other)}` : ""}</td>
          <td title="${escapeHtml(row.item_detail || row.order_item || "-")}">${escapeHtml(row.item_detail || row.order_item || "-")}</td>
          <td>${escapeHtml(row.unit || "-")}</td>
          <td>${escapeHtml(row.subtotal_cost_label || formatMoney(row.subtotal_cost))}</td>
          <td>${escapeHtml(row.total_label || formatMoney(row.total))}</td>
          <td>${escapeHtml(row.payment || row.payment_method || "WALKIN VIA CASHIER")}</td>
          <td class="action-icons sticky-action">
            <button data-tooltip="View Order Info" data-walkin-view="${row.id}"><i class="fa-regular fa-eye"></i></button>
          </td>
        </tr>
      `,
    });
  };

  const renderRejectedTable = () => {
    const rows = getRejectedRows();

    state.rejectedPage = renderPagedRows({
      rows,
      tbody: rejectedOrdersTbody,
      colCount: 9,
      footer: rejectedOrdersFooter,
      currentPage: state.rejectedPage,
      pageSize: 5,
      emptyMessage: "No rejected orders found.",
      renderRow: (order) => {
        const orderNo = escapeHtml(
          order.order_no_display || `#${order.order_no || order.id}`,
        );
        return `
          <tr>
            <td class="admin-bulk-select-cell"><input type="checkbox" data-admin-bulk-row="rejected-orders" value="${order.id}" aria-label="Select ${orderNo}" /></td>
            <td>${orderNo}</td>
            <td>${escapeHtml(order.product_name || "Custom Order")}</td>
            <td>${escapeHtml(formatDateShort(order.created_at))}</td>
            <td>${escapeHtml(order.customer_name || "Customer")}</td>
            <td>${escapeHtml(order.payment_method || "N/A")}</td>
            <td>${escapeHtml(order.total_label || formatMoney(order.total_amount))}</td>
            <td><span class="status-pill status-red">Rejected</span></td>
            <td class="action-icons sticky-action">
              <button data-tooltip="View Order Info" data-order-view="${order.id}"><i class="fa-regular fa-eye"></i></button>
              <button data-tooltip="Archive Order" data-rejected-archive="${order.id}" data-rejected-label="${orderNo}"><i class="fa-solid fa-box-archive"></i></button>
            </td>
          </tr>
        `;
      },
    });
    rejectedBulkController?.sync();
  };

  const runOrdersBulkAction = ({
    ids,
    controller,
    action,
    endpoint,
    method = "POST",
    tableLabel,
    body = {},
    confirmMessage,
  }) => {
    window.runAdminBulkAction?.({
      controller,
      ids,
      action,
      tableLabel,
      confirmMessage,
      loadingText:
        {
          approve: "Approving...",
          archive: "Archiving...",
          reject: "Rejecting...",
        }[action] || "Processing...",
      execute: (selectedIds) =>
        request(endpoint, {
          method,
          body: { ids: selectedIds, ...body },
        }),
      afterSuccess: async (payload) => {
        notifyOrdersRealtimeUpdate({
          type: `orders-${action}-bulk`,
          processedIds: payload?.processed_ids || [],
        });
        await syncOrders(true, { force: true, source: "action" });
      },
    });
  };

  const setupOrderBulkSelections = () => {
    incomingBulkController = window.AdminBulkSelection?.create({
      key: "incoming-orders",
      table: incomingOrdersTable,
      footer: incomingOrdersFooter,
      tableLabel: "Incoming Orders",
      getEligibleRows: () =>
        state.incoming.filter(
          (order) =>
            String(order?.lifecycle_status || "incoming").toLowerCase() ===
            "incoming",
        ),
      getPageRows: () => {
        const start = (state.incomingPage - 1) * 5;
        return state.incoming.slice(start, start + 5);
      },
      idleAction: {
        label: "Select incoming orders for a mass action",
        icon: "fa-list-check",
        className: "admin-bulk-neutral",
      },
      actions: [
        {
          key: "approve",
          label: "Approve selected incoming orders",
          icon: "fa-check",
          className: "admin-bulk-approve",
          onClick: (ids, controller) =>
            runOrdersBulkAction({
              ids,
              controller,
              action: "approve",
              endpoint: "/admin/orders/approve-bulk",
              tableLabel: "Incoming Orders records",
            }),
        },
        {
          key: "reject",
          label: "Reject selected incoming orders",
          icon: "fa-xmark",
          className: "admin-bulk-reject",
          onClick: (ids, controller) =>
            runOrdersBulkAction({
              ids,
              controller,
              action: "reject",
              endpoint: "/admin/orders/reject-bulk",
              tableLabel: "Incoming Orders records",
            }),
        },
      ],
    });

    rejectedBulkController = window.AdminBulkSelection?.create({
      key: "rejected-orders",
      table: rejectedOrdersTable,
      footer: rejectedOrdersFooter,
      tableLabel: "Rejected Orders",
      getEligibleRows: getRejectedRows,
      getPageRows: () => {
        const start = (state.rejectedPage - 1) * 5;
        return getRejectedRows().slice(start, start + 5);
      },
      idleAction: {
        label: "Select rejected orders to archive",
        icon: "fa-box-archive",
      },
      actions: [
        {
          key: "archive",
          label: "Archive selected rejected orders",
          icon: "fa-box-archive",
          onClick: (ids, controller) =>
            runOrdersBulkAction({
              ids,
              controller,
              action: "archive",
              endpoint: "/admin/orders/archive-bulk",
              method: "PATCH",
              body: { source: "rejected" },
              tableLabel: "Rejected Orders records",
            }),
        },
      ],
    });

    paymentBulkController = window.AdminBulkSelection?.create({
      key: "payment-orders",
      table: paymentsHistoryTable,
      footer: paymentsHistoryFooter,
      tableLabel: "Payments History",
      getId: (payment) => payment?.id || payment?.order_id,
      getEligibleRows: getPaymentRows,
      getPageRows: () => {
        const start = (state.paymentsPage - 1) * 5;
        return getPaymentRows().slice(start, start + 5);
      },
      idleAction: {
        label: "Select payments to archive their associated orders",
        icon: "fa-box-archive",
      },
      actions: [
        {
          key: "archive",
          label: "Archive selected associated orders",
          icon: "fa-box-archive",
          onClick: (ids, controller) =>
            runOrdersBulkAction({
              ids,
              controller,
              action: "archive",
              endpoint: "/admin/orders/archive-bulk",
              method: "PATCH",
              body: { source: "payments" },
              tableLabel: "Payments History records",
              confirmMessage: `Archive ${ids.length} selected Payments History record(s)? Each associated whole order will move to Orders Archived Items.`,
            }),
        },
      ],
    });
  };

  const renderAll = () => {
    renderIncomingTable();
    renderDirectoryTable();
    renderRejectedTable();
    renderPaymentsTable();
    renderWalkInTable();
  };

  const renderOrdersLoading = () => {
    const showSkeletons = (target, columns) => {
      if (!target) return;
      const usedSharedSkeleton = window.AdminTableSkeleton?.show(target, {
        rows: 3,
        columns,
      });
      if (usedSharedSkeleton) return;

      const cells = Array.from(
        { length: columns },
        () => '<td><span class="admin-table-skeleton-bar"></span></td>',
      ).join("");
      target.innerHTML = `<tr class="admin-table-skeleton-row" aria-hidden="true">${cells}</tr>`.repeat(
        3,
      );
    };
    if (
      incomingOrdersTbody &&
      (!incomingOrdersTbody.children.length ||
        incomingOrdersTbody.querySelector(".table-empty-state"))
    ) {
      showSkeletons(incomingOrdersTbody, 10);
    }
    if (
      ordersDirectoryTbody &&
      (!ordersDirectoryTbody.children.length ||
        ordersDirectoryTbody.querySelector(".table-empty-state"))
    ) {
      showSkeletons(ordersDirectoryTbody, 8);
    }
    if (
      rejectedOrdersTbody &&
      (!rejectedOrdersTbody.children.length ||
        rejectedOrdersTbody.querySelector(".table-empty-state"))
    ) {
      showSkeletons(rejectedOrdersTbody, 9);
    }
    if (
      paymentsHistoryTbody &&
      (!paymentsHistoryTbody.children.length ||
        paymentsHistoryTbody.querySelector(".table-empty-state"))
    ) {
      showSkeletons(paymentsHistoryTbody, 9);
    }
    if (
      walkInOrdersTbody &&
      (!walkInOrdersTbody.children.length ||
        walkInOrdersTbody.querySelector(".table-empty-state"))
    ) {
      showSkeletons(walkInOrdersTbody, 13);
    }
  };

  const syncOrders = async (showErrorPopup = true, options = {}) => {
    const force = Boolean(options.force);
    const source = options.source || "auto";
    const now = Date.now();

    if (
      !force &&
      source === "auto" &&
      now - state.lastSyncAt < MIN_SYNC_GAP_MS
    ) {
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
    if (source === "manual") renderOrdersLoading();

    try {
      const [response, walkInResponse] = await Promise.all([
        request("/admin/orders", {
          signal: syncController.signal,
        }),
        request("/admin/walkin-orders", {
          signal: syncController.signal,
        }),
      ]);

      state.incoming = Array.isArray(response.incoming)
        ? response.incoming
        : [];
      state.directory = Array.isArray(response.directory)
        ? response.directory
        : [];
      state.walkIn = Array.isArray(walkInResponse?.data)
        ? walkInResponse.data
        : [];
      normalizeStateOrdering();
      refreshPaymentsFromDirectory();
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

      if (showErrorPopup && source === "manual") {
        showPopup(error.message || "Unable to load orders from the server.", {
          title: "Sync Failed",
        });
      } else {
        console.warn(
          "[Orders] Background sync failed:",
          error?.message || error,
        );
      }

      renderEmptyTable(
        incomingOrdersTbody,
        10,
        "Unable to load incoming orders.",
      );
      renderEmptyTable(
        ordersDirectoryTbody,
        8,
        "Unable to load orders directory.",
      );
      renderEmptyTable(
        paymentsHistoryTbody,
        9,
        "Unable to load payments history.",
      );
      renderEmptyTable(
        rejectedOrdersTbody,
        9,
        "Unable to load rejected orders.",
      );
      renderEmptyTable(walkInOrdersTbody, 13, "Unable to load walk-in orders.");
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
    if (trackingOrderNo)
      trackingOrderNo.value =
        order.order_no_display || `#${order.order_no || order.id}`;
    if (trackingStage) trackingStage.value = order.customer_stage || "to_pay";
    if (trackingEventTitle) trackingEventTitle.value = "";
    if (trackingEventDescription) trackingEventDescription.value = "";
    if (trackingCourierName)
      trackingCourierName.value = order.courier_name || "J&T Express";
    if (trackingCourierNo)
      trackingCourierNo.value = order.courier_tracking_no || "";
    if (trackingLocationName)
      trackingLocationName.value = order.location_name || "";

    trackingDiscardGuard?.capture();
    modalTrackingUpdate.classList.add("show");
  };

  const closeTrackingModal = () => {
    modalTrackingUpdate?.classList.remove("show");
  };

  const getTrackingFormSnapshot = () => ({
    orderId: String(trackingOrderId?.value || "").trim(),
    stage: String(trackingStage?.value || "").trim(),
    title: String(trackingEventTitle?.value || "").trim(),
    description: String(trackingEventDescription?.value || "").trim(),
    courierName: String(trackingCourierName?.value || "").trim(),
    courierNo: String(trackingCourierNo?.value || "").trim(),
    locationName: String(trackingLocationName?.value || "").trim(),
  });

  trackingDiscardGuard = window.createAdminFormDiscardGuard?.({
    getSnapshot: getTrackingFormSnapshot,
    close: closeTrackingModal,
  });

  const mutateOrder = async (orderId, action) => {
    const actionMap = {
      approve: {
        path: `/admin/orders/${orderId}/approve`,
        method: "POST",
        title: "Approve Incoming Order",
        message: "Approve this incoming order and move it to pending?",
        confirmText: "Approve",
        loadingText: "Approving...",
        success: "Order approved and moved to pending.",
      },
      reject: {
        path: `/admin/orders/${orderId}/reject`,
        method: "POST",
        title: "Reject Incoming Order",
        message: "Reject this incoming order?",
        confirmText: "Reject",
        loadingText: "Rejecting...",
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

    if (action === "approve" || action === "reject") {
      window.showAdminConfirmPopup?.(config.message, {
        title: config.title,
        confirmText: config.confirmText,
        cancelText: "Cancel",
        loadingText: config.loadingText,
        keepOpenWhilePending: true,
        onConfirm: async () => {
          const payload = await request(config.path, {
            method: config.method || "POST",
            body: action === "reject" ? { reason: null } : undefined,
          });

          if (payload?.data) {
            upsertOrderSummaryInState(payload.data);
          }

          renderAll();
          notifyOrdersRealtimeUpdate({
            type: `order-${action}`,
            orderId: String(orderId),
          });
          window.setTimeout(() => {
            showPopup(config.success, { title: "Success" });
          }, 150);
        },
        onError: (error) => {
          showPopup(error?.message || "Action failed.", {
            title: "Action Failed",
          });
        },
      });
      return;
    }

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
      notifyOrdersRealtimeUpdate({
        type: `order-${action}`,
        orderId: String(orderId),
      });
      queueSuccessFlash(config.success, "Success");
    } catch (error) {
      showPopup(error.message || "Action failed.", { title: "Action Failed" });
    }
  };

  const openRejectedArchiveModal = (orderId, label) => {
    const modal = document.getElementById("modalArchiveRejectedOrder");
    if (!modal) return;
    const labelEl = document.getElementById("rejectedArchiveTargetLabel");
    if (labelEl) labelEl.textContent = label || orderId;
    modal._pendingOrderId = orderId;
    modal.classList.add("show");
  };

  const closeRejectedArchiveModal = () => {
    const modal = document.getElementById("modalArchiveRejectedOrder");
    modal?.classList.remove("show");
    if (modal) modal._pendingOrderId = null;
  };

  document
    .getElementById("btnCancelArchiveRejectedOrder")
    ?.addEventListener("click", closeRejectedArchiveModal);

  document
    .getElementById("btnConfirmArchiveRejectedOrder")
    ?.addEventListener("click", async () => {
      const modal = document.getElementById("modalArchiveRejectedOrder");
      const orderId = modal?._pendingOrderId;
      if (!orderId) return;

      const btn = document.getElementById("btnConfirmArchiveRejectedOrder");
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Archiving...";
      }

      try {
        await request(`/admin/orders/${orderId}/archive`, { method: "PATCH" });
        removeOrderFromState(orderId);
        renderAll();
        notifyOrdersRealtimeUpdate({
          type: "rejected-archived",
          orderId: String(orderId),
        });
        closeRejectedArchiveModal();
        showPopup("Rejected order archived successfully.", {
          title: "Archived ✓",
        });
      } catch (error) {
        showPopup(error.message || "Unable to archive rejected order.", {
          title: "Archive Failed",
        });
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML =
            '<i class="fa-solid fa-box-archive"></i> Archive Order';
        }
      }
    });

  const openPaymentDeleteModal = (payment) => {
    if (!modalDeletePaymentHistory || !payment) return;

    deletingPaymentOrderId = String(payment.id || payment.order_id || "");
    if (paymentDeleteTargetLabel) {
      paymentDeleteTargetLabel.textContent =
        payment.order_no_display ||
        `#${payment.order_no || payment.id || payment.order_id}`;
    }

    modalDeletePaymentHistory.classList.add("show");
  };

  const closePaymentDeleteModal = () => {
    modalDeletePaymentHistory?.classList.remove("show");
    deletingPaymentOrderId = null;
  };

  const deletePayment = async (orderId) => {
    const key = String(orderId || "");
    if (!key) return;

    try {
      await request(`/admin/orders/${key}/archive-payment`, {
        method: "PATCH",
      });

      notifyOrdersRealtimeUpdate({ type: "payment-archived", orderId: key });
      showPopup("Payment record archived successfully and moved to Archives.", {
        title: "Archived ✓",
      });
      void syncOrders(true, { force: true, source: "manual" });
    } catch (error) {
      showPopup(error.message || "Unable to archive payment record.", {
        title: "Archive Failed",
      });
    }
  };

  const getCurrentDateTimeLocal = () => {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  };

  const normalizePhoneDigits = (raw) =>
    String(raw || "")
      .replace(/\D/g, "")
      .slice(0, 12);

  const formatPhoneDisplay = (raw) => {
    const digits = normalizePhoneDigits(raw);
    if (!digits) return "";

    if (digits.startsWith("63")) {
      const local = digits.slice(2);
      return `+63 ${local.slice(0, 3)}${local.length > 3 ? ` ${local.slice(3, 6)}` : ""}${local.length > 6 ? ` ${local.slice(6, 10)}` : ""}`.trim();
    }

    if (digits.startsWith("0")) {
      return `${digits.slice(0, 4)}${digits.length > 4 ? ` ${digits.slice(4, 7)}` : ""}${digits.length > 7 ? ` ${digits.slice(7, 11)}` : ""}`.trim();
    }

    return `${digits.slice(0, 3)}${digits.length > 3 ? ` ${digits.slice(3, 6)}` : ""}${digits.length > 6 ? ` ${digits.slice(6, 10)}` : ""}`.trim();
  };

  const isValidContactNumber = (value) => {
    const digits = normalizePhoneDigits(value);
    return digits.length >= 10 && digits.length <= 12;
  };

  const parseUnitQuantity = (unitText) => {
    const match = String(unitText || "").match(/\d+(\.\d+)?/);
    if (!match) return 1;
    const qty = Number(match[0]);
    if (!Number.isFinite(qty) || qty <= 0) return 1;
    return qty;
  };

  const findWalkInProductByName = (name) => {
    const normalizedName = String(name || "")
      .trim()
      .toLowerCase();
    if (!normalizedName) return null;
    return (
      _comboboxAllProducts.find(
        (product) =>
          String(product?.name || "")
            .trim()
            .toLowerCase() === normalizedName,
      ) || null
    );
  };

  const syncWalkInCalculatedFields = () => {
    if (!walkInSubtotalCostInput || !walkInTotalInput) return;

    const quantityValue = Math.max(
      1,
      Number.parseInt(String(walkInUnitInput?.value || "1"), 10) || 1,
    );
    const subtotalValue = Number(walkInSubtotalCostInput.value || 0);

    if (!Number.isFinite(subtotalValue) || subtotalValue < 0) {
      walkInTotalInput.value = "";
      return;
    }

    const subtotalCost = Math.round(subtotalValue * quantityValue * 100) / 100;
    const formatted = subtotalCost.toFixed(2);
    walkInTotalInput.value = formatted;
  };

  const syncWalkInProductSelection = (itemName) => {
    walkInSelectedProduct = findWalkInProductByName(itemName);

    if (walkInSelectedProduct && walkInSubtotalCostInput) {
      walkInSubtotalCostInput.value = String(
        Number(walkInSelectedProduct.price || 0).toFixed(2),
      );
    }

    syncWalkInCalculatedFields();
  };

  const calculateWalkInTotalFromInputs = () => {
    syncWalkInCalculatedFields();
  };

  const setDetailInput = (input, value) => {
    if (!input) return;
    input.value = value || "-";
  };

  const openWalkInDetailsModal = (row) => {
    if (!row || !modalWalkInDetails) return;

    viewingWalkInOrderId = row.id;

    setDetailInput(walkInDetailOrderNo, row.order_no);
    setDetailInput(walkInDetailName, row.customer_name || row.customer);
    setDetailInput(walkInDetailAddress, row.address);
    setDetailInput(walkInDetailContact, row.contact_number);
    setDetailInput(
      walkInDetailClientType,
      row.client_type_other
        ? `${row.client_type || ""}: ${row.client_type_other}`
        : row.client_type,
    );
    setDetailInput(walkInDetailAgency, row.agency_organization);
    setDetailInput(
      walkInDetailProject,
      row.project_description_other
        ? `${row.project_description || ""}: ${row.project_description_other}`
        : row.project_description,
    );
    setDetailInput(walkInDetailItem, row.item_detail || row.order_item);
    setDetailInput(walkInDetailUnit, row.unit);
    setDetailInput(
      walkInDetailSubtotal,
      row.subtotal_cost_label || formatMoney(row.subtotal_cost),
    );
    setDetailInput(
      walkInDetailTotal,
      row.total_label || formatMoney(row.total),
    );
    setDetailInput(
      walkInDetailPayment,
      row.payment || row.payment_method || "WALKIN VIA CASHIER",
    );
    setDetailInput(
      walkInDetailDate,
      row.order_date_label || formatDateLabel(row.order_date),
    );

    modalWalkInDetails.classList.add("show");
  };

  let activeWalkInOrderId = null;

  const toggleWalkInOtherFields = () => {
    const isClientOther =
      (walkInClientTypeInput?.value || "") === "OTHERS (SPECIFY)";
    const isProjectOther =
      (walkInProjectDescriptionInput?.value || "") === "OTHERS (SPECIFY)";

    if (walkInClientTypeOtherWrap)
      walkInClientTypeOtherWrap.style.display = isClientOther ? "" : "none";
    if (!isClientOther && walkInClientTypeOtherInput)
      walkInClientTypeOtherInput.value = "";

    if (walkInProjectDescriptionOtherWrap)
      walkInProjectDescriptionOtherWrap.style.display = isProjectOther
        ? ""
        : "none";
    if (!isProjectOther && walkInProjectDescriptionOtherInput)
      walkInProjectDescriptionOtherInput.value = "";
  };

  // ── Item Detail Combobox ─────────────────────────────────────────────────────

  let _comboboxAllProducts = [];
  let _comboboxActiveIdx = -1;
  let walkInSelectedProduct = null;

  const closeItemDetailCombobox = () => {
    if (walkInItemDetailWrap) walkInItemDetailWrap.classList.remove("open");
    _comboboxActiveIdx = -1;
  };

  const openItemDetailCombobox = () => {
    if (walkInItemDetailWrap) walkInItemDetailWrap.classList.add("open");
  };

  const renderComboboxList = (filterText) => {
    if (!walkInItemDetailList) return;
    const filter = String(filterText || "")
      .toLowerCase()
      .trim();
    const matches = filter
      ? _comboboxAllProducts.filter((product) =>
          String(product?.name || "")
            .toLowerCase()
            .includes(filter),
        )
      : _comboboxAllProducts;

    if (!matches.length) {
      walkInItemDetailList.innerHTML = `<li class="combobox-no-results">No products found. Your typed entry will be used.</li>`;
    } else {
      walkInItemDetailList.innerHTML = matches
        .map(
          (product) =>
            `<li role="option" data-value="${escapeHtml(product.name)}">${escapeHtml(product.name)}</li>`,
        )
        .join("");
    }
    _comboboxActiveIdx = -1;
  };

  const setComboboxActiveItem = (idx) => {
    if (!walkInItemDetailList) return;
    const items = walkInItemDetailList.querySelectorAll(
      "li:not(.combobox-no-results)",
    );
    items.forEach((li, i) => li.classList.toggle("combobox-active", i === idx));
    if (idx >= 0 && idx < items.length) {
      items[idx].scrollIntoView({ block: "nearest" });
    }
    _comboboxActiveIdx = idx;
  };

  const initItemDetailCombobox = () => {
    if (
      !walkInItemDetailInput ||
      !walkInItemDetailList ||
      !walkInItemDetailWrap
    )
      return;

    // Open on focus / click
    walkInItemDetailInput.addEventListener("focus", () => {
      renderComboboxList(walkInItemDetailInput.value);
      syncWalkInProductSelection(walkInItemDetailInput.value);
      openItemDetailCombobox();
    });

    walkInItemDetailInput.addEventListener("click", () => {
      renderComboboxList(walkInItemDetailInput.value);
      syncWalkInProductSelection(walkInItemDetailInput.value);
      openItemDetailCombobox();
    });

    // Caret button toggles the dropdown open / closed
    const caretBtn = document.getElementById("walkInItemDetailCaretBtn");
    if (caretBtn) {
      caretBtn.addEventListener("mousedown", (e) => {
        e.preventDefault(); // Prevent input blur before toggle
        if (walkInItemDetailWrap.classList.contains("open")) {
          closeItemDetailCombobox();
        } else {
          renderComboboxList(walkInItemDetailInput.value);
          syncWalkInProductSelection(walkInItemDetailInput.value);
          openItemDetailCombobox();
          walkInItemDetailInput.focus();
        }
      });
    }

    // Filter as user types
    walkInItemDetailInput.addEventListener("input", () => {
      renderComboboxList(walkInItemDetailInput.value);
      syncWalkInProductSelection(walkInItemDetailInput.value);
      openItemDetailCombobox();
    });

    // Keyboard navigation
    walkInItemDetailInput.addEventListener("keydown", (e) => {
      const items = walkInItemDetailList.querySelectorAll(
        "li:not(.combobox-no-results)",
      );
      if (!walkInItemDetailWrap.classList.contains("open")) {
        if (e.key === "ArrowDown" || e.key === "Enter") {
          renderComboboxList(walkInItemDetailInput.value);
          openItemDetailCombobox();
        }
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setComboboxActiveItem(
          Math.min(_comboboxActiveIdx + 1, items.length - 1),
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setComboboxActiveItem(Math.max(_comboboxActiveIdx - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (_comboboxActiveIdx >= 0 && _comboboxActiveIdx < items.length) {
          walkInFormInteracted = true;
          walkInItemDetailInput.value =
            items[_comboboxActiveIdx].dataset.value || "";
          syncWalkInProductSelection(walkInItemDetailInput.value);
          closeItemDetailCombobox();
        } else {
          closeItemDetailCombobox();
        }
      } else if (e.key === "Escape") {
        closeItemDetailCombobox();
      }
    });

    // Click on list item
    walkInItemDetailList.addEventListener("mousedown", (e) => {
      const li = e.target.closest("li:not(.combobox-no-results)");
      if (!li) return;
      e.preventDefault();
      walkInFormInteracted = true;
      walkInItemDetailInput.value = li.dataset.value || "";
      syncWalkInProductSelection(walkInItemDetailInput.value);
      closeItemDetailCombobox();
    });

    // Close when clicking outside
    document.addEventListener(
      "click",
      (e) => {
        if (walkInItemDetailWrap && !walkInItemDetailWrap.contains(e.target)) {
          closeItemDetailCombobox();
        }
      },
      true,
    );
  };

  const fetchProductNamesAndInitCombobox = async () => {
    try {
      const data = await request("/admin/products");
      _comboboxAllProducts = Array.isArray(data?.data)
        ? data.data
            .map((product) => ({
              id: product?.id ?? null,
              name: String(product?.name || "").trim(),
              price: Number(product?.price || 0),
            }))
            .filter((product) => product.name)
        : [];
    } catch {
      _comboboxAllProducts = [];
    }
    // Render the list now with current input value
    renderComboboxList(walkInItemDetailInput?.value || "");
    syncWalkInProductSelection(walkInItemDetailInput?.value || "");
    if (!walkInFormInteracted) {
      walkInDiscardGuard?.capture();
    }
  };

  // Initialise combobox event listeners once on page load
  initItemDetailCombobox();

  const resetWalkInOrderForm = () => {
    activeWalkInOrderId = null;
    const title = document.getElementById("walkInModalTitle");
    if (title) title.textContent = "Add Walk-in Customer";
    if (saveWalkInOrderBtn)
      saveWalkInOrderBtn.innerText = "Save Walk-in Customer";

    if (walkInOrderNoInput) walkInOrderNoInput.value = "";
    if (walkInCustomerNameInput) walkInCustomerNameInput.value = "";
    if (walkInAddressInput) walkInAddressInput.value = "";
    if (walkInContactNumberInput) walkInContactNumberInput.value = "";
    if (walkInClientTypeInput) walkInClientTypeInput.value = "MSME/ENTREP";
    if (walkInClientTypeOtherInput) walkInClientTypeOtherInput.value = "";
    if (walkInAgencyOrganizationInput) walkInAgencyOrganizationInput.value = "";
    if (walkInProjectDescriptionInput)
      walkInProjectDescriptionInput.value = "PRODUCT LABELING AND DESIGNING";
    if (walkInProjectDescriptionOtherInput)
      walkInProjectDescriptionOtherInput.value = "";
    if (walkInItemDetailInput) walkInItemDetailInput.value = "";
    if (walkInUnitInput) walkInUnitInput.value = "1";
    if (walkInSubtotalCostInput) walkInSubtotalCostInput.value = "";
    if (walkInTotalInput) walkInTotalInput.value = "";
    if (walkInPaymentMethodInput)
      walkInPaymentMethodInput.value = "WALKIN VIA CASHIER";
    walkInSelectedProduct = null;

    // Reset combobox
    closeItemDetailCombobox();

    toggleWalkInOtherFields();
  };

  const openWalkInOrderModal = (order = null) => {
    walkInFormInteracted = false;
    resetWalkInOrderForm();
    if (order) {
      activeWalkInOrderId = order.id;
      const title = document.getElementById("walkInModalTitle");
      if (title) title.textContent = "Edit Walk-in Customer";
      if (saveWalkInOrderBtn)
        saveWalkInOrderBtn.innerText = "Update Walk-in Customer";

      if (walkInOrderNoInput) walkInOrderNoInput.value = order.order_no || "";
      if (walkInCustomerNameInput)
        walkInCustomerNameInput.value =
          order.customer_name || order.customer || "";
      if (walkInAddressInput) walkInAddressInput.value = order.address || "";
      if (walkInContactNumberInput)
        walkInContactNumberInput.value = order.contact_number || "";
      if (walkInClientTypeInput)
        walkInClientTypeInput.value = order.client_type || "MSME/ENTREP";
      if (walkInClientTypeOtherInput)
        walkInClientTypeOtherInput.value = order.client_type_other || "";
      if (walkInAgencyOrganizationInput)
        walkInAgencyOrganizationInput.value = order.agency_organization || "";
      if (walkInProjectDescriptionInput)
        walkInProjectDescriptionInput.value =
          order.project_description || "PRODUCT LABELING AND DESIGNING";
      if (walkInProjectDescriptionOtherInput)
        walkInProjectDescriptionOtherInput.value =
          order.project_description_other || "";
      // Set combobox value (the input acts as both textbox and display)
      if (walkInItemDetailInput)
        walkInItemDetailInput.value =
          order.item_detail || order.order_item || "";
      if (walkInUnitInput) walkInUnitInput.value = order.unit || "1";
      if (walkInSubtotalCostInput)
        walkInSubtotalCostInput.value = order.subtotal_cost ?? "";
      if (walkInTotalInput) walkInTotalInput.value = order.total || "";
      if (walkInPaymentMethodInput)
        walkInPaymentMethodInput.value =
          order.payment || order.payment_method || "WALKIN VIA CASHIER";

      syncWalkInProductSelection(walkInItemDetailInput?.value || "");
      toggleWalkInOtherFields();
    }
    walkInDiscardGuard?.capture();
    // Fetch products every time the modal opens to ensure fresh data
    void fetchProductNamesAndInitCombobox();
    modalAddWalkInOrder?.classList.add("show");
  };

  const openWalkInOrderModalFromView = () => {
    const order = state.walkIn.find(
      (item) => String(item.id) === String(viewingWalkInOrderId || ""),
    );
    if (!order) return;

    modalWalkInDetails?.classList.remove("show");
    requestAnimationFrame(() => {
      openWalkInOrderModal(order);
    });
  };

  const closeWalkInOrderModal = () => {
    modalAddWalkInOrder?.classList.remove("show");
    activeWalkInOrderId = null;
  };

  const getWalkInFormSnapshot = () => ({
    orderNo: String(walkInOrderNoInput?.value || "").trim(),
    customerName: String(walkInCustomerNameInput?.value || "").trim(),
    address: String(walkInAddressInput?.value || "").trim(),
    contactNumber: String(walkInContactNumberInput?.value || "").trim(),
    clientType: String(walkInClientTypeInput?.value || "").trim(),
    clientTypeOther: String(
      walkInClientTypeOtherInput?.value || "",
    ).trim(),
    agencyOrganization: String(
      walkInAgencyOrganizationInput?.value || "",
    ).trim(),
    projectDescription: String(
      walkInProjectDescriptionInput?.value || "",
    ).trim(),
    projectDescriptionOther: String(
      walkInProjectDescriptionOtherInput?.value || "",
    ).trim(),
    itemDetail: String(walkInItemDetailInput?.value || "").trim(),
    quantity: String(walkInUnitInput?.value || "").trim(),
    subtotalCost: String(walkInSubtotalCostInput?.value || "").trim(),
    total: String(walkInTotalInput?.value || "").trim(),
    paymentMethod: String(walkInPaymentMethodInput?.value || "").trim(),
    selectedProductId: String(walkInSelectedProduct?.id || ""),
  });

  walkInDiscardGuard = window.createAdminFormDiscardGuard?.({
    getSnapshot: getWalkInFormSnapshot,
    close: closeWalkInOrderModal,
  });

  modalAddWalkInOrder?.addEventListener("input", () => {
    walkInFormInteracted = true;
  });
  modalAddWalkInOrder?.addEventListener("change", () => {
    walkInFormInteracted = true;
  });

  const saveWalkInOrder = async () => {
    const orderNo = String(walkInOrderNoInput?.value || "").trim();
    const customerName = String(walkInCustomerNameInput?.value || "").trim();
    const address = String(walkInAddressInput?.value || "").trim();
    const contactNumber = normalizePhoneDigits(
      walkInContactNumberInput?.value || "",
    );
    const clientType = String(walkInClientTypeInput?.value || "").trim();
    const clientTypeOther = String(
      walkInClientTypeOtherInput?.value || "",
    ).trim();
    const agencyOrganization = String(
      walkInAgencyOrganizationInput?.value || "",
    ).trim();
    const projectDescription = String(
      walkInProjectDescriptionInput?.value || "",
    ).trim();
    const projectDescriptionOther = String(
      walkInProjectDescriptionOtherInput?.value || "",
    ).trim();
    const itemDetail = String(walkInItemDetailInput?.value || "").trim();
    const quantity = Math.max(
      1,
      Number.parseInt(String(walkInUnitInput?.value || "1"), 10) || 1,
    );
    const subtotalRaw = String(walkInSubtotalCostInput?.value || "").trim();
    const totalRaw = String(walkInTotalInput?.value || "").trim();
    const paymentMethod = "WALKIN VIA CASHIER";

    if (
      !orderNo ||
      !customerName ||
      !address ||
      !contactNumber ||
      !clientType ||
      !agencyOrganization ||
      !projectDescription ||
      !itemDetail ||
      !quantity ||
      !subtotalRaw ||
      !totalRaw
    ) {
      showPopup("Please complete all walk-in order fields.", {
        title: "Validation",
      });
      return;
    }

    if (!walkInSelectedProduct) {
      showPopup(
        "Please select a product from the list so the quantity and subtotal can be calculated.",
        { title: "Validation" },
      );
      return;
    }

    if (walkInSubtotalCostInput && walkInSubtotalCostInput.value !== "") {
      const subtotalNumeric = Number(walkInSubtotalCostInput.value);
      if (Number.isFinite(subtotalNumeric) && subtotalNumeric >= 0) {
        walkInSubtotalCostInput.value = String(subtotalNumeric.toFixed(2));
      }
    }

    if (!isValidContactNumber(contactNumber)) {
      showPopup("Contact Number must be a valid PH mobile/phone format.", {
        title: "Validation",
      });
      walkInContactNumberInput?.focus();
      return;
    }

    if (clientType === "OTHERS (SPECIFY)" && !clientTypeOther) {
      showPopup("Please specify the client type.", { title: "Validation" });
      return;
    }

    if (projectDescription === "OTHERS (SPECIFY)" && !projectDescriptionOther) {
      showPopup("Please specify the project description.", {
        title: "Validation",
      });
      return;
    }

    const subtotalCost = Number(subtotalRaw);
    const total = Number(totalRaw);
    if (!Number.isFinite(subtotalCost) || subtotalCost < 0) {
      showPopup(
        "Subtotal Cost must be a valid number greater than or equal to 0.",
        { title: "Validation" },
      );
      return;
    }

    if (!Number.isFinite(total) || total < 0) {
      showPopup("Total must be a valid number greater than or equal to 0.", {
        title: "Validation",
      });
      return;
    }

    if (saveWalkInOrderBtn) {
      saveWalkInOrderBtn.disabled = true;
      saveWalkInOrderBtn.innerText = activeWalkInOrderId
        ? "Updating..."
        : "Saving...";
    }

    try {
      const url = activeWalkInOrderId
        ? `/admin/walkin-orders/${activeWalkInOrderId}`
        : "/admin/walkin-orders";
      const method = activeWalkInOrderId ? "PUT" : "POST";

      const payload = await request(url, {
        method,
        body: {
          order_no: orderNo,
          customer_name: customerName,
          address,
          contact_number: contactNumber,
          client_type: clientType,
          client_type_other:
            clientType === "OTHERS (SPECIFY)" ? clientTypeOther : null,
          agency_organization: agencyOrganization,
          project_description: projectDescription,
          project_description_other:
            projectDescription === "OTHERS (SPECIFY)"
              ? projectDescriptionOther
              : null,
          item_detail: itemDetail,
          // Send product_id so backend can reduce the product stock
          product_id: walkInSelectedProduct?.id ?? null,
          unit: String(quantity),
          subtotal_cost: subtotalCost,
          payment_method: paymentMethod,
          total,
          order_date: getCurrentDateTimeLocal(),
          status: "Pending",
        },
      });

      if (payload?.data) {
        state.walkIn = replaceOrAppendById(state.walkIn, payload.data, "id");
        normalizeStateOrdering();
        if (!activeWalkInOrderId) state.walkInPage = 1;
        renderWalkInTable();
      }

      closeWalkInOrderModal();
      walkInDiscardGuard?.clear();
      notifyOrdersRealtimeUpdate({
        type: activeWalkInOrderId ? "walkin-updated" : "walkin-created",
      });
      queueSuccessFlash(
        payload?.message ||
          (activeWalkInOrderId
            ? "Walk-in customer record updated successfully."
            : "Walk-in customer record added successfully."),
        "Success",
      );
      window.location.reload();
    } catch (error) {
      showPopup(
        error.message ||
          (activeWalkInOrderId
            ? "Unable to update walk-in customer record."
            : "Unable to add walk-in customer record."),
        { title: "Save Failed" },
      );
    } finally {
      if (saveWalkInOrderBtn) {
        const isUpdating = !!activeWalkInOrderId;
        saveWalkInOrderBtn.disabled = false;
        saveWalkInOrderBtn.innerText = isUpdating
          ? "Update Walk-in Customer"
          : "Save Walk-in Customer";
      }
    }
  };

  walkInClientTypeInput?.addEventListener("change", toggleWalkInOtherFields);
  walkInProjectDescriptionInput?.addEventListener(
    "change",
    toggleWalkInOtherFields,
  );

  walkInSubtotalCostInput?.addEventListener("input", () => {
    calculateWalkInTotalFromInputs();
  });

  walkInUnitInput?.addEventListener("input", () => {
    calculateWalkInTotalFromInputs();
  });

  walkInContactNumberInput?.addEventListener("input", () => {
    walkInContactNumberInput.value = formatPhoneDisplay(
      walkInContactNumberInput.value || "",
    );
  });

  walkInContactNumberInput?.addEventListener("blur", () => {
    const value = String(walkInContactNumberInput.value || "").trim();
    if (value && !isValidContactNumber(value)) {
      showPopup("Contact Number format looks invalid. Use a valid PH number.", {
        title: "Validation",
      });
      walkInContactNumberInput.focus();
    }
  });

  openWalkInOrderModalBtn?.addEventListener("click", () => {
    openWalkInOrderModal();
  });

  cancelWalkInOrderBtn?.addEventListener("click", () => {
    if (walkInDiscardGuard) {
      walkInDiscardGuard.cancel();
      return;
    }
    closeWalkInOrderModal();
  });

  btnCloseWalkInDetails?.addEventListener("click", () => {
    modalWalkInDetails?.classList.remove("show");
    viewingWalkInOrderId = null;
  });

  btnEditWalkInFromView?.addEventListener("click", () => {
    openWalkInOrderModalFromView();
  });

  modalWalkInDetails?.addEventListener("click", (event) => {
    if (event.target === modalWalkInDetails) {
      modalWalkInDetails.classList.remove("show");
      viewingWalkInOrderId = null;
    }
  });

  saveWalkInOrderBtn?.addEventListener("click", () => {
    void saveWalkInOrder();
  });

  incomingPager.prev?.addEventListener("click", () => {
    if (state.incomingPage <= 1) return;
    state.incomingPage -= 1;
    renderIncomingTable();
  });

  incomingPager.next?.addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(state.incoming.length / 5));
    if (state.incomingPage >= totalPages) return;
    state.incomingPage += 1;
    renderIncomingTable();
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

  walkInPager.prev?.addEventListener("click", () => {
    if (state.walkInPage <= 1) return;
    state.walkInPage -= 1;
    renderWalkInTable();
  });

  walkInPager.next?.addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(state.walkIn.length / 5));
    if (state.walkInPage >= totalPages) return;
    state.walkInPage += 1;
    renderWalkInTable();
  });

  rejectedPager.prev?.addEventListener("click", () => {
    if (state.rejectedPage <= 1) return;
    state.rejectedPage -= 1;
    renderRejectedTable();
  });

  rejectedPager.next?.addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(getRejectedRows().length / 5));
    if (state.rejectedPage >= totalPages) return;
    state.rejectedPage += 1;
    renderRejectedTable();
  });

  window.AdminPageNumberInput?.bind(incomingPager.pageNumber, {
    getPage: () => state.incomingPage,
    getTotalPages: () => Math.max(1, Math.ceil(state.incoming.length / 5)),
    onChange: (page) => {
      state.incomingPage = page;
      renderIncomingTable();
    },
  });

  window.AdminPageNumberInput?.bind(directoryPager.pageNumber, {
    getPage: () => state.directoryPage,
    getTotalPages: () => Math.max(1, Math.ceil(getDirectoryRows().length / 5)),
    onChange: (page) => {
      state.directoryPage = page;
      renderDirectoryTable();
    },
  });

  window.AdminPageNumberInput?.bind(paymentsPager.pageNumber, {
    getPage: () => state.paymentsPage,
    getTotalPages: () => Math.max(1, Math.ceil(getPaymentRows().length / 5)),
    onChange: (page) => {
      state.paymentsPage = page;
      renderPaymentsTable();
    },
  });

  window.AdminPageNumberInput?.bind(walkInPager.pageNumber, {
    getPage: () => state.walkInPage,
    getTotalPages: () => Math.max(1, Math.ceil(state.walkIn.length / 5)),
    onChange: (page) => {
      state.walkInPage = page;
      renderWalkInTable();
    },
  });

  window.AdminPageNumberInput?.bind(rejectedPager.pageNumber, {
    getPage: () => state.rejectedPage,
    getTotalPages: () => Math.max(1, Math.ceil(getRejectedRows().length / 5)),
    onChange: (page) => {
      state.rejectedPage = page;
      renderRejectedTable();
    },
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

  btnCancelDeletePaymentHistory?.addEventListener("click", () => {
    closePaymentDeleteModal();
  });

  btnConfirmDeletePaymentHistory?.addEventListener("click", () => {
    if (!deletingPaymentOrderId) return;
    btnConfirmDeletePaymentHistory.disabled = true;
    btnConfirmDeletePaymentHistory.textContent = "Deleting...";

    void deletePayment(deletingPaymentOrderId).finally(() => {
      btnConfirmDeletePaymentHistory.disabled = false;
      btnConfirmDeletePaymentHistory.textContent = "Delete Payment";
      closePaymentDeleteModal();
    });
  });

  btnCancelTrackingUpdate?.addEventListener("click", () => {
    if (trackingDiscardGuard) {
      trackingDiscardGuard.cancel();
      return;
    }
    closeTrackingModal();
  });

  btnSaveTrackingUpdate?.addEventListener("click", async () => {
    const orderId = trackingOrderId?.value || "";
    if (!orderId) {
      showPopup("No order selected for tracking update.", {
        title: "Update Failed",
      });
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
    };

    const shouldSave = await askConfirm("Save this tracking update?", {
      title: "Confirm Tracking Update",
      confirmText: "Save",
    });

    if (!shouldSave) return;

    const originalSaveHtml = btnSaveTrackingUpdate.innerHTML;
    btnSaveTrackingUpdate.disabled = true;
    btnSaveTrackingUpdate.innerHTML =
      '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
    if (btnCancelTrackingUpdate) btnCancelTrackingUpdate.disabled = true;

    try {
      const response = await request(`/admin/orders/${orderId}/tracking`, {
        method: "PATCH",
        body: payload,
      });

      if (response?.data) {
        upsertOrderSummaryInState(response.data);
        renderAll();
      }

      closeTrackingModal();
      trackingDiscardGuard?.clear();
      notifyOrdersRealtimeUpdate({
        type: "tracking-updated",
        orderId: String(orderId),
      });
      queueSuccessFlash("Tracking update saved successfully.", "Success");
      window.location.reload();
    } catch (error) {
      showPopup(error.message || "Unable to save tracking update.", {
        title: "Update Failed",
      });
    } finally {
      btnSaveTrackingUpdate.disabled = false;
      btnSaveTrackingUpdate.innerHTML = originalSaveHtml;
      if (btnCancelTrackingUpdate) btnCancelTrackingUpdate.disabled = false;
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
      const orderId = String(
        approveBtn.getAttribute("data-order-approve") || "",
      );
      void mutateOrder(orderId, "approve");
      return;
    }

    const rejectBtn = target.closest("[data-order-reject]");
    if (rejectBtn) {
      const orderId = String(rejectBtn.getAttribute("data-order-reject") || "");
      void mutateOrder(orderId, "reject");
      return;
    }

    // Archive rejected order
    const rejectedArchiveBtn = target.closest("[data-rejected-archive]");
    if (rejectedArchiveBtn) {
      const orderId = String(
        rejectedArchiveBtn.getAttribute("data-rejected-archive") || "",
      );
      const label = String(
        rejectedArchiveBtn.getAttribute("data-rejected-label") || orderId,
      );
      openRejectedArchiveModal(orderId, label);
      return;
    }

    const deletePaymentBtn = target.closest("[data-payment-archive]");
    if (deletePaymentBtn) {
      const orderId = String(
        deletePaymentBtn.getAttribute("data-payment-archive") || "",
      );
      const payment = state.payments.find(
        (item) => String(item.id || item.order_id || "") === orderId,
      );
      if (payment) openPaymentDeleteModal(payment);
      return;
    }

    const editWalkInBtn = target.closest("[data-walkin-edit]");
    const viewWalkInBtn = target.closest("[data-walkin-view]");
    if (viewWalkInBtn) {
      const id = viewWalkInBtn.getAttribute("data-walkin-view");
      const order = state.walkIn.find((o) => String(o.id) === String(id));
      if (order) {
        openWalkInDetailsModal(order);
      }
      return;
    }

    if (editWalkInBtn) {
      const id = editWalkInBtn.getAttribute("data-walkin-edit");
      const order = state.walkIn.find((o) => String(o.id) === String(id));
      if (order) {
        openWalkInOrderModal(order);
      }
      return;
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

  setupOrderBulkSelections();
  showQueuedSuccess();

  const isPopupVisible = () => {
    const popup = document.getElementById("adminSystemPopup");
    return popup && popup.classList.contains("show");
  };

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
    if (isPopupVisible()) return;

    void syncOrders(false, { force: true, source: "realtime" });
  });

  window.addEventListener("fmrc:orders-updated", (event) => {
    const payload = event?.detail || {};
    if (payload?.source === "admin-orders") return;
    if (document.hidden) return;
    if (!shouldProcessRealtimeSignal(payload)) return;
    if (isPopupVisible()) return;
    void syncOrders(false, { force: true, source: "realtime" });
  });

  const realtimeChannel = getOrdersRealtimeChannel();
  realtimeChannel?.addEventListener("message", (event) => {
    const payload = event?.data || {};
    if (payload?.source === "admin-orders") return;
    if (document.hidden) return;
    if (!shouldProcessRealtimeSignal(payload)) return;
    if (isPopupVisible()) return;
    void syncOrders(false, { force: true, source: "realtime" });
  });

  void syncOrders(true, { force: true, source: "manual" });
});
