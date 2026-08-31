document.addEventListener("DOMContentLoaded", () => {
  // Header notifications deep-link here for both orders and returns. Claim the
  // kinds up front so the generic scroll-and-flash fallback waits for the first
  // sync instead of firing before the tables exist.
  window.AdminNotifFocus?.expect(["order", "return"]);

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
  const PAGE_SIZE = window.AdminTablePagination?.PAGE_SIZE || 10;

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

  // ── Returns & Refunds ──────────────────────────────────────────────────
  const returnsRefundsTbody = document.querySelector(
    "#returnsRefundsTable tbody",
  );
  const returnsRefundsTable = document.getElementById("returnsRefundsTable");
  const returnsRefundsFooter = document.getElementById("returnsRefundsFooter");
  const returnsStatusFilter = document.getElementById("returnsStatusFilter");
  const returnsSearch = document.getElementById("returnsSearch");
  const returnsSummaryStrip = document.getElementById("returnsSummaryStrip");
  const cancellationAlert = document.getElementById("cancellationAlert");

  const modalReturnDetails = document.getElementById("modalReturnDetails");
  const returnDetailsBody = document.getElementById("returnDetailsBody");
  const returnDetailsSubtitle = document.getElementById(
    "returnDetailsSubtitle",
  );

  const modalReturnAction = document.getElementById("modalReturnAction");
  const returnActionTitle = document.getElementById("returnActionTitle");
  const returnActionSubtitle = document.getElementById("returnActionSubtitle");
  const returnActionId = document.getElementById("returnActionId");
  const returnActionKind = document.getElementById("returnActionKind");
  const returnActionNo = document.getElementById("returnActionNo");
  const returnActionRequested = document.getElementById(
    "returnActionRequested",
  );
  const returnDecisionSelect = document.getElementById("returnDecisionSelect");
  const returnApprovedAmount = document.getElementById("returnApprovedAmount");
  const returnDecisionNote = document.getElementById("returnDecisionNote");
  const returnReceivedNote = document.getElementById("returnReceivedNote");
  const returnRefundStage = document.getElementById("returnRefundStage");
  const returnRefundMethod = document.getElementById("returnRefundMethod");
  const returnRefundAmount = document.getElementById("returnRefundAmount");
  const returnRefundReference = document.getElementById(
    "returnRefundReference",
  );
  const returnRefundNote = document.getElementById("returnRefundNote");
  const btnCancelReturnAction = document.getElementById(
    "btnCancelReturnAction",
  );
  const btnSubmitReturnAction = document.getElementById(
    "btnSubmitReturnAction",
  );

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
  const trackingCourierSelect = document.getElementById(
    "trackingCourierSelect",
  );
  const trackingCourierOtherWrap = document.getElementById(
    "trackingCourierOtherWrap",
  );
  const trackingCourierNo = document.getElementById("trackingCourierNo");
  const trackingLocationName = document.getElementById("trackingLocationName");
  const trackingLatitude = document.getElementById("trackingLatitude");
  const trackingLongitude = document.getElementById("trackingLongitude");
  // Phase 3 of tracking: the same seven checkpoints get relayed every day, so
  // they are picked from a list instead of retyped, and the two coordinates FMRC
  // already knows are one button each.
  const trackingPresetSelect = document.getElementById("trackingPresetSelect");
  const trackingLatLngOrigin = document.getElementById("trackingLatLngOrigin");
  const trackingLatLngDestination = document.getElementById(
    "trackingLatLngDestination",
  );
  const trackingLatLngClear = document.getElementById("trackingLatLngClear");
  const trackingMapPreview = document.getElementById("trackingMapPreview");
  const trackingLatLngHint = document.getElementById("trackingLatLngHint");
  const modalPaymentVerifyBlock = document.getElementById(
    "modalPaymentVerifyBlock",
  );
  const modalPaymentVerifyHint = document.getElementById(
    "modalPaymentVerifyHint",
  );
  const btnMarkPaymentPaid = document.getElementById("btnMarkPaymentPaid");
  const btnMarkPaymentPending = document.getElementById(
    "btnMarkPaymentPending",
  );
  // Stage 3: the reference, the amount and the receipt shown together, so a
  // payment can be matched against the FMRC GCash app without leaving the modal.
  const modalPaymentClaim = document.getElementById("modalPaymentClaim");
  const modalPaymentClaimRef = document.getElementById("modalPaymentClaimRef");
  const btnCopyPaymentRef = document.getElementById("btnCopyPaymentRef");
  const modalPaymentClaimAmount = document.getElementById(
    "modalPaymentClaimAmount",
  );
  const modalPaymentClaimSubmitted = document.getElementById(
    "modalPaymentClaimSubmitted",
  );
  const modalPaymentClaimDeadlineRow = document.getElementById(
    "modalPaymentClaimDeadlineRow",
  );
  const modalPaymentClaimDeadline = document.getElementById(
    "modalPaymentClaimDeadline",
  );
  const modalPaymentProofLink = document.getElementById(
    "modalPaymentProofLink",
  );
  const modalPaymentProofImg = document.getElementById("modalPaymentProofImg");
  const modalPaymentProofEmpty = document.getElementById(
    "modalPaymentProofEmpty",
  );
  const btnRecordRefund = document.getElementById("btnRecordRefund");
  const modalRefundRefWrap = document.getElementById("modalRefundRefWrap");
  const modalRefundReference = document.getElementById("modalRefundReference");
  const modalCancellationBlock = document.getElementById(
    "modalCancellationBlock",
  );
  const modalCancellationCard = document.getElementById(
    "modalCancellationCard",
  );
  const modalCancellationTitle = document.getElementById(
    "modalCancellationTitle",
  );
  const modalCancellationReason = document.getElementById(
    "modalCancellationReason",
  );
  const modalCancellationDetail = document.getElementById(
    "modalCancellationDetail",
  );
  const modalCancellationMoney = document.getElementById(
    "modalCancellationMoney",
  );
  const modalCancellationActions = document.getElementById(
    "modalCancellationActions",
  );
  const modalCancellationNoteWrap = document.getElementById(
    "modalCancellationNoteWrap",
  );
  const modalCancellationNote = document.getElementById(
    "modalCancellationNote",
  );
  const btnApproveCancellation = document.getElementById(
    "btnApproveCancellation",
  );
  const btnDeclineCancellation = document.getElementById(
    "btnDeclineCancellation",
  );
  const btnCancelTrackingUpdate = document.getElementById(
    "btnCancelTrackingUpdate",
  );
  const btnSaveTrackingUpdate = document.getElementById(
    "btnSaveTrackingUpdate",
  );
  const modalGcashSettings = document.getElementById("modalGcashSettings");
  const btnOpenGcashSettings = document.getElementById("btnOpenGcashSettings");
  const gcashSettingName = document.getElementById("gcashSettingName");
  const gcashSettingNumber = document.getElementById("gcashSettingNumber");
  const gcashSettingQrInput = document.getElementById("gcashSettingQrInput");
  const gcashSettingQrPreview = document.getElementById(
    "gcashSettingQrPreview",
  );
  const gcashSettingQrPlaceholder = document.getElementById(
    "gcashSettingQrPlaceholder",
  );
  const btnGcashUploadQr = document.getElementById("btnGcashUploadQr");
  const btnGcashRemoveQr = document.getElementById("btnGcashRemoveQr");
  const btnCancelGcashSettings = document.getElementById(
    "btnCancelGcashSettings",
  );
  const btnSaveGcashSettings = document.getElementById("btnSaveGcashSettings");

  const state = {
    incoming: [],
    directory: [],
    payments: [],
    walkIn: [],
    returns: [],
    returnsSummary: {},
    // {pending, cancelled, refund_due} straight from the payload. Only used
    // before the first rows arrive - after that the alert strip counts the rows
    // themselves so it reacts to a decision without waiting for a poll.
    cancellationsSummary: {},
    returnDetailsById: new Map(),
    ordersById: new Map(),
    incomingPage: 1,
    directoryPage: 1,
    paymentsPage: 1,
    walkInPage: 1,
    rejectedPage: 1,
    returnsPage: 1,
    returnItemsPage: 1,
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
  let returnsBulkController = null;
  let activeReturnId = null;
  let returnActionBusy = false;
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
  const returnsPager = getFooterControls(returnsRefundsFooter);

  const toTimestamp = (value) => {
    const ts = Date.parse(String(value || ""));
    return Number.isFinite(ts) ? ts : 0;
  };

  const toNumericId = (value) => {
    const parsed = Number(String(value ?? "").replace(/[^0-9]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  // Every table in the Admin and Staff portals puts the newest record in the
  // first row of page 1 — the same contract the Inventory tables already
  // follow — so a record that was just created is never buried on the last
  // page. Walk-ins were already newest-first; incoming, the directory (which
  // also feeds Rejected Orders) and payment history now match them.
  const sortOrdersByCreatedDesc = (rows) =>
    [...(Array.isArray(rows) ? rows : [])].sort(
      (a, b) =>
        toTimestamp(b?.created_at || b?.created_at_label) -
          toTimestamp(a?.created_at || a?.created_at_label) ||
        toNumericId(b?.id || b?.order_id || b?.order_no) -
          toNumericId(a?.id || a?.order_id || a?.order_no),
    );

  // Payment rows are completed directory orders, so the most recent settlement
  // is whichever timestamp the row actually carries.
  const paymentTimestamp = (row) =>
    toTimestamp(
      row?.date_paid || row?.completed_at || row?.updated_at || row?.created_at,
    );

  const sortPaymentsByPaidDesc = (rows) =>
    [...(Array.isArray(rows) ? rows : [])].sort(
      (a, b) =>
        paymentTimestamp(b) - paymentTimestamp(a) ||
        toNumericId(b?.order_id || b?.order_no || b?.payment_id || b?.id) -
          toNumericId(a?.order_id || a?.order_no || a?.payment_id || a?.id),
    );

  const sortWalkInByDateDesc = (rows) =>
    [...(Array.isArray(rows) ? rows : [])].sort(
      (a, b) =>
        toTimestamp(b?.order_date || b?.created_at) -
          toTimestamp(a?.order_date || a?.created_at) ||
        toNumericId(b?.id || b?.order_no) - toNumericId(a?.id || a?.order_no),
    );

  const normalizeStateOrdering = () => {
    state.incoming = sortOrdersByCreatedDesc(state.incoming);
    state.directory = sortOrdersByCreatedDesc(state.directory);
    state.walkIn = sortWalkInByDateDesc(state.walkIn);
  };

  const getCompletedDirectoryRows = () =>
    state.directory.filter(
      (order) =>
        String(order?.lifecycle_status || "").toLowerCase() === "completed",
    );

  const refreshPaymentsFromDirectory = () => {
    state.payments = sortPaymentsByPaidDesc(getCompletedDirectoryRows());
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
      // A customer calling off an order is not a failure on FMRC's part, so it
      // must not borrow the red "Rejected" pill.
      case "cancelled":
        return "status-grey";
      default:
        return "status-blue";
    }
  };

  // The two things about a cancellation that change what staff do next: a
  // request still waiting on a decision, and a refund still owed. Both ride
  // beside the status pill so they are visible without opening the order.
  const cancellationFlags = (order) => {
    const flags = [];
    if (order?.cancel_pending === true) {
      flags.push(
        `<span class="row-flag row-flag-cancel" title="The customer asked to cancel this order and is waiting on a decision."><i class="fa-regular fa-circle-xmark"></i> Cancel requested</span>`,
      );
    }
    if (order?.cancel_refund_due === true) {
      // The row does not know whether the payment was ever verified, so the flag
      // has to read as "check this", not "pay this out".
      flags.push(
        `<span class="row-flag row-flag-refund" title="This order was cancelled with money possibly already sent. Open it: confirm the payment in the FMRC GCash app, refund it if it arrived, then record the reference."><i class="fa-solid fa-rotate-left"></i> Refund to check</span>`,
      );
    }
    return flags.join("");
  };

  // ── Returns & Refunds helpers ──────────────────────────────────────────

  // Return status → the pill palette already used by every other status
  // column on this page, so nothing new is invented visually.
  const RETURN_STATUS_PILL_CLASS = {
    requested: "status-yellow",
    approved: "status-blue",
    item_in_transit: "status-blue",
    item_received: "status-blue",
    refund_processing: "status-blue",
    refunded: "status-green",
    rejected: "status-red",
    cancelled: "status-red",
  };

  const RETURN_STATUS_FALLBACK_LABELS = {
    requested: "Return Requested",
    approved: "Return Approved",
    item_in_transit: "Item In Transit",
    item_received: "Item Received",
    refund_processing: "Refund Processing",
    refunded: "Refunded",
    rejected: "Request Rejected",
    cancelled: "Request Cancelled",
  };

  const returnStatusClass = (status) =>
    RETURN_STATUS_PILL_CLASS[String(status || "").toLowerCase()] ||
    "status-blue";

  const returnStatusLabel = (row) =>
    row?.status_label ||
    RETURN_STATUS_FALLBACK_LABELS[String(row?.status || "").toLowerCase()] ||
    "Return Update";

  // Evidence paths come back relative to the API host, exactly like rating
  // media, so they need the same absolute-URL resolution.
  const resolveMediaUrl = (value) => {
    if (!value) return "";
    try {
      return new URL(value, API_BASE_URL).href;
    } catch {
      return String(value);
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
      let message =
        data.message || `Request failed with status ${response.status}.`;

      // Laravel answers a 500 with a bare {"message":"Server Error"} whenever
      // APP_DEBUG is off, which is what this modal used to show - a string that
      // tells whoever is reading it nothing at all. The usual cause is deployed
      // code running ahead of the database, so point at that instead of leaving
      // the reader with two words.
      if (response.status >= 500) {
        message = `${message} (HTTP ${response.status}) — the server could not build this response. If the site was updated recently, its database migrations may still be pending.`;
      }

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

    renderPaymentVerification(order);
    renderCancellationPanel(order);

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

  // ── Payment verification ───────────────────────────────────────────────────
  // A GCash reference is the customer's word, not a receipt: nothing in this
  // system can see the FMRC GCash account. So the order waits at "To Pay" until
  // someone opens the GCash app, finds that reference, and confirms it here.
  // Cash orders are paid in person, so the same control settles those too.
  //
  // Stage 3 puts the three things that match have to be compared side by side -
  // the reference, the amount, and the receipt the customer uploaded - because
  // the alternative is staff flipping between this modal and a screenshot.
  const renderPaymentVerification = (order) => {
    if (!modalPaymentVerifyBlock) return;

    const status = String(order?.payment_status || "pending").toLowerCase();
    const method = String(order?.payment_method || "").trim();
    const rawReference = String(order?.payment_reference || "").trim();
    // Every order is seeded with a placeholder like "Awaiting GCash reference",
    // so a reference is only real once it is all digits - the same test the API
    // uses to decide whether the customer has actually claimed a payment.
    const reference = /^\d+$/.test(rawReference) ? rawReference : "";
    const isGcash = method.toLowerCase() === "gcash";
    const isCancelled = order?.is_cancelled === true;
    const refundDue = order?.cancel_refund_due === true;

    // A refunded payment is settled: there is nothing left to confirm. It still
    // shows here so the reference of the money sent back stays readable.
    const canVerify = status === "paid" || status === "pending";
    const showBlock = canVerify || status === "refunded";
    modalPaymentVerifyBlock.hidden = !showBlock;
    modalPaymentVerifyBlock.dataset.orderId = String(order?.id || "");

    if (!showBlock) return;

    // ── The claim, laid out for matching ──
    // Only GCash has a claim to match; cash changes hands at the counter.
    if (modalPaymentClaim) {
      modalPaymentClaim.hidden = !isGcash;
    }

    if (modalPaymentClaimRef) {
      modalPaymentClaimRef.textContent = reference || "Not supplied yet";
      modalPaymentClaimRef.classList.toggle("is-empty", !reference);
    }
    if (btnCopyPaymentRef) btnCopyPaymentRef.hidden = !reference;

    if (modalPaymentClaimAmount) {
      modalPaymentClaimAmount.textContent =
        order?.payment_amount_label || formatMoney(order?.total_amount);
    }
    if (modalPaymentClaimSubmitted) {
      modalPaymentClaimSubmitted.textContent =
        order?.payment_submitted_label ||
        (reference ? "Date not recorded" : "Nothing submitted yet");
    }
    if (modalPaymentClaimDeadlineRow) {
      // The deadline only matters while FMRC is still waiting: nothing cancels
      // automatically, so showing it after payment would just be noise.
      modalPaymentClaimDeadlineRow.hidden =
        status === "paid" || status === "refunded" || !order?.payment_due_label;
    }
    if (modalPaymentClaimDeadline) {
      modalPaymentClaimDeadline.textContent = order?.payment_is_overdue
        ? `${order.payment_due_label} — overdue`
        : order?.payment_due_label || "-";
      modalPaymentClaimDeadline.classList.toggle(
        "is-overdue",
        Boolean(order?.payment_is_overdue),
      );
    }

    const proofUrl = resolveMediaUrl(order?.payment_proof_url);
    if (modalPaymentProofLink) {
      modalPaymentProofLink.hidden = !proofUrl;
      if (proofUrl) modalPaymentProofLink.href = proofUrl;
    }
    if (modalPaymentProofImg && proofUrl) {
      modalPaymentProofImg.src = proofUrl;
    }
    if (modalPaymentProofEmpty) {
      modalPaymentProofEmpty.hidden = Boolean(proofUrl);
    }

    // ── The hint, and the buttons it describes ──
    if (modalPaymentVerifyHint) {
      if (status === "refunded") {
        modalPaymentVerifyHint.textContent = order?.payment_refund_reference
          ? `Refunded${order.payment_refunded_label ? ` on ${order.payment_refunded_label}` : ""} — GCash ref. ${order.payment_refund_reference}. Nothing further is owed on this order.`
          : "This payment is recorded as refunded. Nothing further is owed on this order.";
      } else if (refundDue) {
        // `cancel_refund_due` is also raised when the customer typed a reference
        // nobody verified, so the money may never have arrived. Telling staff to
        // "send it back" in that case invites paying out on a claim that was
        // never checked - the wording has to send them to the app first.
        modalPaymentVerifyHint.textContent =
          status === "paid"
            ? `This order was cancelled after the money arrived, so FMRC owes ${order?.payment_amount_label || formatMoney(order?.total_amount)} back. Send it through GCash, then record the reference here so the refund is on file.`
            : `This order was cancelled while the customer's ${order?.payment_amount_label || formatMoney(order?.total_amount)} claim was still unverified. Search ${reference || "their reference"} in the FMRC GCash app: if the money is there, send it back and record the reference here. If it never arrived, nothing is owed.`;
      } else if (isCancelled) {
        modalPaymentVerifyHint.textContent =
          "This order is cancelled. Nothing is owed, so no payment should be confirmed against it.";
      } else if (status === "paid") {
        modalPaymentVerifyHint.textContent =
          "This payment is already marked as received. Only set it back to unpaid if it was confirmed by mistake.";
      } else if (isGcash) {
        modalPaymentVerifyHint.textContent = reference
          ? `Search reference ${reference} in the FMRC GCash app. Confirm only if the amount and time match — this releases the order to the shipping queue.`
          : "This GCash order has no reference number, so there is nothing to match. Ask the customer for the Ref. No. on their receipt before confirming.";
      } else {
        modalPaymentVerifyHint.textContent =
          "Cash is collected in person. Confirm once the money is actually in hand.";
      }
    }

    // A cancelled order must never be confirmed as paid - the API refuses it
    // anyway, so offering the button would only produce an error popup.
    if (btnMarkPaymentPaid) {
      btnMarkPaymentPaid.hidden =
        status === "paid" || status === "refunded" || isCancelled;
    }
    if (btnMarkPaymentPending) {
      btnMarkPaymentPending.hidden = status !== "paid" || isCancelled;
    }
    if (btnRecordRefund) btnRecordRefund.hidden = !refundDue;
    if (modalRefundRefWrap) modalRefundRefWrap.hidden = !refundDue;
    if (modalRefundReference && !refundDue) modalRefundReference.value = "";
  };

  btnCopyPaymentRef?.addEventListener("click", async () => {
    const value = String(modalPaymentClaimRef?.textContent || "").trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      btnCopyPaymentRef.textContent = "Copied";
      window.setTimeout(() => {
        btnCopyPaymentRef.textContent = "Copy";
      }, 1400);
    } catch {
      // Clipboard access can be blocked; the number is still on screen.
      showPopup(`Reference number: ${value}`, { title: "Copy Manually" });
    }
  });

  const setPaymentStatus = async (nextStatus) => {
    const orderId = String(modalPaymentVerifyBlock?.dataset.orderId || "");
    if (!orderId) return;

    const order = state.ordersById.get(orderId);
    // Recording a refund is the third state this control has to reach. It needs
    // the reference of the money staff sent BACK, which the API stores next to
    // the original payment - so the refund is auditable rather than a status
    // somebody flipped.
    const refundReference = String(modalRefundReference?.value || "").trim();
    if (nextStatus === "refunded" && !refundReference) {
      showPopup(
        "Enter the GCash reference number of the refund you sent, so the customer can be shown proof it went out.",
        { title: "Reference Required" },
      );
      modalRefundReference?.focus();
      return;
    }

    const confirmMessage =
      nextStatus === "paid"
        ? `Confirm that ${formatMoney(order?.total_amount)} was actually received for ${order?.order_no_display || `#${orderId}`}? The order moves to the shipping queue and the customer is emailed.`
        : nextStatus === "refunded"
          ? `Record that ${formatMoney(order?.total_amount)} was refunded to the customer under reference ${refundReference}? Only do this after the money has actually left the FMRC GCash account.`
          : `Set this payment back to unpaid? The customer's order returns to "To Pay".`;

    const proceed = await askConfirm(confirmMessage, {
      title:
        nextStatus === "paid"
          ? "Confirm Payment Received"
          : nextStatus === "refunded"
            ? "Record Refund Sent"
            : "Mark Unpaid",
      confirmText:
        nextStatus === "paid"
          ? "Payment received"
          : nextStatus === "refunded"
            ? "Refund sent"
            : "Set unpaid",
    });
    if (!proceed) return;

    const buttons = [btnMarkPaymentPaid, btnMarkPaymentPending, btnRecordRefund];
    buttons.forEach((button) => {
      if (button) button.disabled = true;
    });

    try {
      const response = await request(
        `/admin/orders/${orderId}/payment-status`,
        {
          method: "PATCH",
          body: {
            status: nextStatus,
            ...(nextStatus === "refunded"
              ? { refund_reference: refundReference }
              : {}),
          },
        },
      );

      // This endpoint answers with `order`, not `data`, so the modal repaints
      // from the server's own copy instead of an optimistic guess.
      const updated = response?.order || response?.data || null;
      if (updated) {
        upsertOrderSummaryInState(updated);
        refreshPaymentsFromDirectory();
        renderAll();
        renderPaymentVerification(updated);
        renderCancellationPanel(updated);
      }

      notifyOrdersRealtimeUpdate({
        type: "payment-updated",
        orderId: String(orderId),
      });
      showPopup(
        nextStatus === "paid"
          ? "Payment confirmed. The order is now in the shipping queue and the customer has been notified."
          : nextStatus === "refunded"
            ? "Refund recorded. The customer's order now shows the refund reference."
            : "Payment set back to unpaid.",
        { title: "Success" },
      );
    } catch (error) {
      showPopup(error.message || "Unable to update the payment status.", {
        title: "Update Failed",
      });
    } finally {
      buttons.forEach((button) => {
        if (button) button.disabled = false;
      });
    }
  };

  btnMarkPaymentPaid?.addEventListener("click", () => {
    void setPaymentStatus("paid");
  });
  btnMarkPaymentPending?.addEventListener("click", () => {
    void setPaymentStatus("pending");
  });
  btnRecordRefund?.addEventListener("click", () => {
    void setPaymentStatus("refunded");
  });

  // ── Cancellation requests ──────────────────────────────────────────────────
  // Shopee and Lazada both let a customer call off an order the seller has not
  // handed over yet, and both make the seller sign off once the order is paid or
  // packed. FMRC follows the same split, so this panel is only ever a decision
  // on a request the server already judged reviewable - the instant kind never
  // reaches here, it is already cancelled by the time staff see it.
  const renderCancellationPanel = (order) => {
    if (!modalCancellationBlock) return;

    const cancelState = String(order?.cancel_state || "none").toLowerCase();
    const pending = order?.cancel_pending === true;
    const isCancelled = order?.is_cancelled === true;
    const refundDue = order?.cancel_refund_due === true;
    const amountLabel =
      order?.payment_amount_label || formatMoney(order?.total_amount);

    // Nothing was ever requested: no banner at all.
    if (cancelState === "none") {
      modalCancellationBlock.hidden = true;
      return;
    }

    modalCancellationBlock.hidden = false;
    modalCancellationBlock.dataset.orderId = String(order?.id || "");

    if (modalCancellationCard) {
      modalCancellationCard.classList.toggle("is-pending", pending);
      modalCancellationCard.classList.toggle("is-cancelled", isCancelled);
      modalCancellationCard.classList.toggle(
        "is-declined",
        cancelState === "declined",
      );
    }

    if (modalCancellationTitle) {
      modalCancellationTitle.textContent = pending
        ? `Customer asked to cancel this order${order?.cancel_requested_label ? ` — ${order.cancel_requested_label}` : ""}`
        : isCancelled
          ? `Cancelled${order?.cancelled_at_label ? ` on ${order.cancelled_at_label}` : ""}`
          : `Request declined${order?.cancel_decided_label ? ` on ${order.cancel_decided_label}` : ""}`;
    }

    if (modalCancellationReason) {
      modalCancellationReason.textContent = order?.cancel_reason_label
        ? `Reason: ${order.cancel_reason_label}`
        : "No reason was recorded.";
    }

    if (modalCancellationDetail) {
      const detail = String(order?.cancel_reason_detail || "").trim();
      modalCancellationDetail.hidden = detail === "";
      modalCancellationDetail.textContent = detail ? `“${detail}”` : "";
    }

    if (modalCancellationMoney) {
      modalCancellationMoney.textContent = pending
        ? order?.payment_is_confirmed
          ? `The ${amountLabel} GCash payment is already confirmed. Approving means FMRC has to send that money back by hand — decline instead if the job is already underway.`
          : order?.payment_under_review
            ? `The customer submitted a GCash reference for ${amountLabel} that nobody has verified yet. Check the FMRC GCash account before deciding, and send the money back if it arrived.`
            : "No money has been received on this order, so approving costs nothing but the stock going back on the shelf."
        : isCancelled
          ? refundDue
            ? order?.payment_is_confirmed
              ? `A refund of ${amountLabel} is still owed. Send it through GCash, then record the reference in Payment Verification above.`
              : `The customer's ${amountLabel} claim was never verified. Check the FMRC GCash account: refund it there and record the reference above if the money arrived, otherwise nothing is owed.`
            : order?.payment_is_refunded
              ? `Refunded${order?.payment_refunded_label ? ` on ${order.payment_refunded_label}` : ""}${order?.payment_refund_reference ? ` — GCash ref. ${order.payment_refund_reference}` : ""}. Nothing further is owed.`
              : "No money was collected on this order, so nothing is owed."
          : `The order carried on as normal.${order?.cancel_decision_note ? ` Reason given: ${order.cancel_decision_note}` : ""}`;
    }

    if (modalCancellationNoteWrap) modalCancellationNoteWrap.hidden = !pending;
    if (modalCancellationNote && !pending) modalCancellationNote.value = "";
    if (modalCancellationActions) modalCancellationActions.hidden = !pending;
  };

  const decideCancellation = async (decision) => {
    const orderId = String(modalCancellationBlock?.dataset.orderId || "");
    if (!orderId) return;

    const approve = decision === "approve";
    const order = state.ordersById.get(orderId);
    const note = String(modalCancellationNote?.value || "").trim();

    // The API rejects a noteless decline outright; catching it here saves the
    // round trip and puts the cursor where the answer goes.
    if (!approve && !note) {
      showPopup(
        "Tell the customer why FMRC cannot cancel this order. The note is sent to them with the decision.",
        { title: "Note Required" },
      );
      modalCancellationNote?.focus();
      return;
    }

    const refundWarning =
      approve && order?.payment_is_confirmed
        ? ` FMRC still has to send the ${order?.payment_amount_label || formatMoney(order?.total_amount)} back through GCash by hand afterwards.`
        : "";

    const proceed = await askConfirm(
      approve
        ? `Cancel ${order?.order_no_display || `#${orderId}`} as the customer asked? The items go back into stock and the customer is emailed.${refundWarning}`
        : `Decline the cancellation for ${order?.order_no_display || `#${orderId}`}? The order continues and the customer is emailed your note.`,
      {
        title: approve ? "Approve Cancellation" : "Decline Cancellation",
        confirmText: approve ? "Cancel the order" : "Decline request",
      },
    );
    if (!proceed) return;

    const buttons = [btnApproveCancellation, btnDeclineCancellation];
    buttons.forEach((button) => {
      if (button) button.disabled = true;
    });

    try {
      const response = await request(`/admin/orders/${orderId}/cancellation`, {
        method: "POST",
        body: { decision, ...(note ? { note } : {}) },
      });

      // Same shape as the payment endpoint: `order`, not `data`.
      const updated = response?.order || response?.data || null;
      if (updated) {
        upsertOrderSummaryInState(updated);
        refreshPaymentsFromDirectory();
        renderAll();
        renderPaymentVerification(updated);
        renderCancellationPanel(updated);
      }

      notifyOrdersRealtimeUpdate({
        type: approve ? "order-cancelled" : "cancellation-declined",
        orderId: String(orderId),
      });
      showPopup(
        response?.message ||
          (approve
            ? "Order cancelled. The customer has been notified."
            : "Cancellation declined. The customer has been notified."),
        { title: "Success" },
      );
    } catch (error) {
      showPopup(error.message || "Unable to record the cancellation decision.", {
        title: "Update Failed",
      });
    } finally {
      buttons.forEach((button) => {
        if (button) button.disabled = false;
      });
    }
  };

  btnApproveCancellation?.addEventListener("click", () => {
    void decideCancellation("approve");
  });
  btnDeclineCancellation?.addEventListener("click", () => {
    void decideCancellation("decline");
  });

  // ── GCash collection details ───────────────────────────────────────────────
  // The three values the checkout page shows a GCash customer. They live in
  // site_settings, which is a plain key/value store, so this needs no new
  // endpoint: `PUT /admin/site-settings` upserts whatever keys it is handed.
  const GCASH_QR_MAX_BYTES = 2 * 1024 * 1024;
  const GCASH_SETTING_KEYS = {
    name: "gcash_account_name",
    number: "gcash_account_number",
    qr: "gcash_qr_image",
  };
  let gcashQrData = "";

  const setGcashQrPreview = (dataUrl) => {
    gcashQrData = String(dataUrl || "");
    if (gcashSettingQrPreview) {
      gcashSettingQrPreview.src = gcashQrData;
      gcashSettingQrPreview.hidden = !gcashQrData;
    }
    if (gcashSettingQrPlaceholder) {
      gcashSettingQrPlaceholder.hidden = Boolean(gcashQrData);
    }
  };

  // "09171234567", "+639171234567" and "0917 123 4567" are the same number, and
  // the customer has to be able to type it into GCash exactly as shown.
  const normalizeGcashNumber = (raw) => {
    const digits = String(raw || "").replace(/\D/g, "");
    if (/^639\d{9}$/.test(digits)) return `0${digits.slice(2)}`;
    if (/^9\d{9}$/.test(digits)) return `0${digits}`;
    return digits;
  };

  const loadGcashSettings = async () => {
    try {
      const response = await request("/site-settings");
      const settings = response?.data || {};
      if (gcashSettingName) {
        gcashSettingName.value = String(
          settings[GCASH_SETTING_KEYS.name] || "",
        );
      }
      if (gcashSettingNumber) {
        gcashSettingNumber.value = String(
          settings[GCASH_SETTING_KEYS.number] || "",
        );
      }
      setGcashQrPreview(settings[GCASH_SETTING_KEYS.qr] || "");
      return true;
    } catch (error) {
      showPopup(
        error.message || "Unable to load the saved GCash details.",
        { title: "Load Failed" },
      );
      return false;
    }
  };

  const openGcashSettingsModal = async () => {
    if (!modalGcashSettings) return;
    if (btnOpenGcashSettings) btnOpenGcashSettings.disabled = true;
    const loaded = await loadGcashSettings();
    if (btnOpenGcashSettings) btnOpenGcashSettings.disabled = false;
    if (!loaded) return;
    modalGcashSettings.classList.add("show");
  };

  const saveGcashSettings = async () => {
    const name = String(gcashSettingName?.value || "").trim();
    const number = normalizeGcashNumber(gcashSettingNumber?.value);

    if (number && !/^09\d{9}$/.test(number)) {
      showPopup(
        "A GCash number is 11 digits starting with 09, like 09171234567.",
        { title: "Check the Number" },
      );
      gcashSettingNumber?.focus();
      return;
    }

    // Without a number or a QR the checkout page has nothing to show, so it
    // falls back to "FMRC has not published its GCash details yet".
    if (!number && !gcashQrData) {
      const proceed = await askConfirm(
        "No number and no QR means customers cannot pay by GCash at all — the checkout will tell them GCash is unavailable. Save anyway?",
        { title: "GCash Will Be Unavailable", confirmText: "Save anyway" },
      );
      if (!proceed) return;
    }

    if (btnSaveGcashSettings) btnSaveGcashSettings.disabled = true;
    try {
      await request("/admin/site-settings", {
        method: "PUT",
        body: {
          [GCASH_SETTING_KEYS.name]: name,
          [GCASH_SETTING_KEYS.number]: number,
          [GCASH_SETTING_KEYS.qr]: gcashQrData,
        },
      });

      if (gcashSettingNumber) gcashSettingNumber.value = number;
      broadcastSiteSettingsUpdate();
      modalGcashSettings?.classList.remove("show");
      showPopup(
        "GCash details saved. Open checkout tabs pick this up within 20 seconds.",
        { title: "Saved" },
      );
    } catch (error) {
      showPopup(error.message || "Unable to save the GCash details.", {
        title: "Save Failed",
      });
    } finally {
      if (btnSaveGcashSettings) btnSaveGcashSettings.disabled = false;
    }
  };

  // Same signal the Website Management pages send, so a customer tab already
  // open on the products page re-reads /site-settings instead of waiting out
  // the 20-second poll.
  const broadcastSiteSettingsUpdate = () => {
    try {
      if ("BroadcastChannel" in window) {
        const channel = new BroadcastChannel("fmrc-site-settings-realtime");
        channel.postMessage({ type: "updated", at: Date.now() });
        channel.close();
      }
    } catch {
      /* BroadcastChannel unsupported — the storage stamp below still fires. */
    }
    try {
      localStorage.setItem("fmrc_site_content_updated_at", String(Date.now()));
    } catch {
      /* storage blocked — the customer page's ETag poll still catches it */
    }
  };

  btnOpenGcashSettings?.addEventListener("click", () => {
    void openGcashSettingsModal();
  });
  btnCancelGcashSettings?.addEventListener("click", () => {
    modalGcashSettings?.classList.remove("show");
  });
  btnSaveGcashSettings?.addEventListener("click", () => {
    void saveGcashSettings();
  });
  btnGcashUploadQr?.addEventListener("click", () => {
    gcashSettingQrInput?.click();
  });
  btnGcashRemoveQr?.addEventListener("click", () => {
    setGcashQrPreview("");
  });
  gcashSettingQrInput?.addEventListener("change", function () {
    const file = this.files?.[0];
    this.value = "";
    if (!file) return;

    if (!/^image\/(png|jpeg|webp)$/.test(String(file.type || ""))) {
      showPopup("Upload the QR as a PNG, JPG or WebP image.", {
        title: "Unsupported File",
      });
      return;
    }
    // The QR is stored inline in site_settings and shipped to every customer
    // page load, so an unresized phone screenshot would bloat the payload.
    if (file.size > GCASH_QR_MAX_BYTES) {
      showPopup(
        "That image is over 2 MB. Crop it to just the QR square and try again.",
        { title: "Image Too Large" },
      );
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => setGcashQrPreview(event.target?.result || "");
    reader.onerror = () =>
      showPopup("Could not read that image file.", { title: "Upload Failed" });
    reader.readAsDataURL(file);
  });

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
      pageSize: PAGE_SIZE,
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
            <td><span class="status-pill ${statusClass}">Incoming</span>${cancellationFlags(order)}</td>
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
      pageSize: PAGE_SIZE,
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
            <td>${statusCell}${cancellationFlags(order)}</td>
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
      pageSize: PAGE_SIZE,
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
        // Completed orders can now be refunded, so this column has to call out a
        // reversed payment instead of reporting every row as Completed.
        const isRefunded =
          String(payment.payment_status || payment.status || "").toLowerCase() ===
          "refunded";
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
            <td><span class="status-pill ${isRefunded ? "status-red" : "status-green"}">${isRefunded ? "Refunded" : "Completed"}</span>${cancellationFlags(payment)}</td>
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

  // Walk-in `status` is free text (default "Pending"), so it is matched
  // case-insensitively against the same three terminal words the appointment
  // table uses.
  const WALKIN_STATUS_PILL_CLASS = {
    completed: "status-green",
    cancelled: "status-red",
    archived: "status-red",
  };

  const walkInStatusLabel = (row) => String(row?.status || "Pending").trim() || "Pending";

  const walkInStatusClass = (row) =>
    WALKIN_STATUS_PILL_CLASS[walkInStatusLabel(row).toLowerCase()] ||
    "status-yellow";

  const isWalkInCompleted = (row) =>
    walkInStatusLabel(row).toLowerCase() === "completed";

  const renderWalkInTable = () => {
    state.walkInPage = renderPagedRows({
      rows: state.walkIn,
      tbody: walkInOrdersTbody,
      colCount: 14,
      footer: walkInOrdersFooter,
      currentPage: state.walkInPage,
      pageSize: PAGE_SIZE,
      emptyMessage: "No walk-in orders available.",
      renderRow: (row) => {
        const canArchive = isWalkInCompleted(row);
        const isSettled = ["completed", "cancelled", "archived"].includes(
          walkInStatusLabel(row).toLowerCase(),
        );

        return `
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
          <td><span class="status-pill ${walkInStatusClass(row)}">${escapeHtml(walkInStatusLabel(row))}</span></td>
          <td class="action-icons sticky-action">
            <button type="button" data-tooltip="View Order Info" data-walkin-view="${row.id}"><i class="fa-regular fa-eye"></i></button>
            ${isSettled ? "" : `<button type="button" data-tooltip="Mark as Done" data-walkin-complete="${row.id}"><i class="fa-solid fa-circle-check"></i></button>`}
            <button
              type="button"
              class="${canArchive ? "" : "is-disabled"}"
              data-tooltip="${canArchive ? "Archive Walk-in Order" : "Mark walk-in order as Done before archiving"}"
              data-walkin-archive="${row.id}"
              ${canArchive ? "" : 'disabled aria-disabled="true"'}
            ><i class="fa-solid fa-box-archive"></i></button>
          </td>
        </tr>
      `;
      },
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
      pageSize: PAGE_SIZE,
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

  // Returns arrive whole in the /admin/orders payload, so the status filter
  // and search box run client-side like the Orders Directory ones.
  const getReturnRows = () => {
    const statusFilter = (returnsStatusFilter?.value || "all")
      .trim()
      .toLowerCase();
    const search = (returnsSearch?.value || "").trim().toLowerCase();

    return state.returns.filter((row) => {
      const status = String(row?.status || "").toLowerCase();
      if (statusFilter === "open") {
        if (String(row?.status_group || "open") !== "open") return false;
      } else if (statusFilter !== "all" && status !== statusFilter) {
        return false;
      }

      if (!search) return true;
      const haystack = [
        row.return_no,
        row.return_no_display,
        row.order_no,
        row.order_no_display,
        row.customer_name,
        row.customer_email,
        row.product_name,
        row.reason_label,
        row.resolution_label,
        row.refund_reference,
        row.return_tracking_no,
        ...(Array.isArray(row.items)
          ? row.items.map((item) => item?.product_name)
          : []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(search);
    });
  };

  const renderReturnsSummary = () => {
    if (!returnsSummaryStrip) return;

    const summary = state.returnsSummary || {};
    const chips = [
      {
        label: "Awaiting review",
        value: Number(summary.requested || 0),
        cls: "status-yellow",
      },
      {
        label: "In progress",
        value: Number(summary.in_progress || 0),
        cls: "status-blue",
      },
      {
        label: "Refunded",
        value: Number(summary.refunded || 0),
        cls: "status-green",
      },
      {
        label: "Closed without refund",
        value: Number(summary.rejected || 0) + Number(summary.cancelled || 0),
        cls: "status-red",
      },
    ];

    returnsSummaryStrip.innerHTML = `
      ${chips
        .map(
          (chip) => `
            <span class="returns-summary-chip ${chip.cls}">
              <strong>${chip.value}</strong> ${escapeHtml(chip.label)}
            </span>`,
        )
        .join("")}
      <span class="returns-summary-total">
        Total refunded
        <strong>${escapeHtml(formatMoney(summary.refunded_amount || 0))}</strong>
      </span>
    `;
  };

  // Which amount matters depends on how far the return has travelled:
  // refunded beats approved beats requested.
  const resolveReturnAmount = (row) => {
    if (row?.refunded_amount !== null && row?.refunded_amount !== undefined) {
      return {
        label: row.refunded_amount_label || formatMoney(row.refunded_amount),
        caption: "Refunded",
      };
    }
    if (row?.approved_amount !== null && row?.approved_amount !== undefined) {
      return {
        label: row.approved_amount_label || formatMoney(row.approved_amount),
        caption: "Approved",
      };
    }
    return {
      label: row?.requested_amount_label || formatMoney(row?.requested_amount),
      caption: "Requested",
    };
  };

  // Every row shows the full action set so the icon column never changes shape
  // between rows; the stages that are not reachable yet render inert with a
  // tooltip that says what unlocks them.
  const returnActionIcon = ({
    icon,
    label,
    enabled,
    attrs = "",
    lockedHint = "",
  }) => {
    if (enabled) {
      return `<button type="button" data-tooltip="${escapeHtml(label)}" ${attrs}><i class="${icon}" aria-hidden="true"></i></button>`;
    }
    const tooltip = lockedHint ? `${label} — ${lockedHint}` : label;
    return `<button type="button" class="is-disabled" aria-disabled="true" tabindex="-1" data-tooltip="${escapeHtml(tooltip)}"><i class="${icon}" aria-hidden="true"></i></button>`;
  };

  const renderReturnActionIcons = (row, returnNo) => {
    const id = row.id;
    return [
      returnActionIcon({
        icon: "fa-regular fa-eye",
        label: "View Return Details",
        enabled: true,
        attrs: `data-return-view="${id}"`,
      }),
      returnActionIcon({
        icon: "fa-solid fa-gavel",
        label: "Review Request",
        enabled: Boolean(row.can_decide),
        attrs: `data-return-action="${id}" data-return-mode="decision"`,
        lockedHint: "already decided",
      }),
      returnActionIcon({
        icon: "fa-solid fa-box-open",
        label: "Confirm Item Received",
        enabled: Boolean(row.can_receive),
        attrs: `data-return-action="${id}" data-return-mode="received"`,
        lockedHint: "available once the request is approved",
      }),
      returnActionIcon({
        icon: "fa-solid fa-peso-sign",
        label: "Release Refund",
        enabled: Boolean(row.can_refund),
        attrs: `data-return-action="${id}" data-return-mode="refund"`,
        lockedHint: "available once the return is approved",
      }),
      returnActionIcon({
        icon: "fa-solid fa-box-archive",
        label: "Archive Return",
        enabled: Boolean(row.can_archive),
        attrs: `data-return-archive="${id}" data-return-label="${returnNo}"`,
        lockedHint: "available once the return is closed",
      }),
    ].join("");
  };

  const renderReturnsTable = () => {
    const rows = getReturnRows();

    state.returnsPage = renderPagedRows({
      rows,
      tbody: returnsRefundsTbody,
      colCount: 11,
      footer: returnsRefundsFooter,
      currentPage: state.returnsPage,
      pageSize: PAGE_SIZE,
      emptyMessage: "No return requests found.",
      renderRow: (row) => {
        const returnNo = escapeHtml(
          row.return_no_display || `#${row.return_no || row.id}`,
        );
        const amount = resolveReturnAmount(row);
        const evidenceBadge = Number(row.media_count || 0)
          ? `<span class="return-evidence-badge" title="${row.media_count} evidence file(s)"><i class="fa-solid fa-paperclip"></i>${row.media_count}</span>`
          : "";

        return `
          <tr>
            <td class="admin-bulk-select-cell"><input type="checkbox" data-admin-bulk-row="order-returns" value="${row.id}" aria-label="Select return ${returnNo}" ${row.can_archive ? "" : "disabled"} /></td>
            <td>${returnNo}${evidenceBadge}</td>
            <td>${escapeHtml(row.order_no_display || `#${row.order_no || row.order_id}`)}</td>
            <td>${escapeHtml(formatDateShort(row.requested_at || row.created_at))}</td>
            <td>${escapeHtml(row.customer_name || "Customer")}</td>
            <td class="order-items-cell">${renderOrderItemsInline(row)}</td>
            <td>${escapeHtml(row.reason_label || "-")}</td>
            <td>${escapeHtml(row.resolution_label || "-")}</td>
            <td>
              <div>${escapeHtml(amount.label)}</div>
              <div class="return-amount-caption">${amount.caption}</div>
            </td>
            <td><span class="status-pill ${returnStatusClass(row.status)}">${escapeHtml(returnStatusLabel(row))}</span></td>
            <td class="action-icons sticky-action">${renderReturnActionIcons(row, returnNo)}</td>
          </tr>
        `;
      },
    });

    returnsBulkController?.sync();
    renderReturnsSummary();
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
        const start = (state.incomingPage - 1) * PAGE_SIZE;
        return state.incoming.slice(start, start + PAGE_SIZE);
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
        const start = (state.rejectedPage - 1) * PAGE_SIZE;
        return getRejectedRows().slice(start, start + PAGE_SIZE);
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
        const start = (state.paymentsPage - 1) * PAGE_SIZE;
        return getPaymentRows().slice(start, start + PAGE_SIZE);
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

    returnsBulkController = window.AdminBulkSelection?.create({
      key: "order-returns",
      table: returnsRefundsTable,
      footer: returnsRefundsFooter,
      tableLabel: "Returns & Refunds",
      // Only closed returns may leave the queue — an open request still needs
      // someone to act on it, which the backend also enforces.
      getEligibleRows: () => getReturnRows().filter((row) => row.can_archive),
      getPageRows: () => {
        const start = (state.returnsPage - 1) * PAGE_SIZE;
        return getReturnRows()
          .slice(start, start + PAGE_SIZE)
          .filter((row) => row.can_archive);
      },
      idleAction: {
        label: "Select closed returns to archive",
        icon: "fa-box-archive",
      },
      actions: [
        {
          key: "archive",
          label: "Archive selected returns",
          icon: "fa-box-archive",
          onClick: (ids, controller) =>
            runOrdersBulkAction({
              ids,
              controller,
              action: "archive",
              endpoint: "/admin/returns/archive-bulk",
              method: "PATCH",
              tableLabel: "Returns & Refunds records",
              confirmMessage: `Archive ${ids.length} selected return(s)? They will move to the Archives page.`,
            }),
        },
      ],
    });
  };

  // Two counts, two very different jobs: a pending request is a decision owed
  // to a customer who is waiting, and a refund due is money FMRC is holding
  // that is no longer its own. Nothing here auto-resolves - shared hosting has
  // no cron - so the strip stays up until a human clears it.
  const renderCancellationAlert = () => {
    if (!cancellationAlert) return;

    // Counted from the rows already on screen rather than from the payload's
    // summary, so approving something in the modal clears the strip immediately
    // instead of waiting for the next poll. Incoming orders live in their own
    // array, so both lists have to be walked.
    const seen = new Set();
    let pending = 0;
    let refundDue = 0;
    [...(state.incoming || []), ...(state.directory || [])].forEach((order) => {
      const key = String(order?.id ?? "");
      if (!key || seen.has(key)) return;
      seen.add(key);
      if (order?.cancel_pending === true) pending += 1;
      if (order?.cancel_refund_due === true) refundDue += 1;
    });

    // Before the first payload lands there are no rows to count, so fall back to
    // the server's own tally rather than claiming there is nothing to do.
    if (!seen.size) {
      const summary = state.cancellationsSummary || {};
      pending = Number(summary.pending || 0);
      refundDue = Number(summary.refund_due || 0);
    }

    if (!pending && !refundDue) {
      cancellationAlert.hidden = true;
      cancellationAlert.innerHTML = "";
      return;
    }

    const parts = [];
    if (pending) {
      parts.push(`
        <span class="cancellation-alert-chip is-pending">
          <i class="fa-regular fa-circle-xmark" aria-hidden="true"></i>
          <strong>${pending}</strong>
          ${pending === 1 ? "cancellation waiting on a decision" : "cancellations waiting on a decision"}
        </span>`);
    }
    if (refundDue) {
      parts.push(`
        <span class="cancellation-alert-chip is-refund">
          <i class="fa-solid fa-rotate-left" aria-hidden="true"></i>
          <strong>${refundDue}</strong>
          ${refundDue === 1 ? "cancelled order to settle" : "cancelled orders to settle"}
        </span>`);
    }

    cancellationAlert.hidden = false;
    cancellationAlert.innerHTML = `
      ${parts.join("")}
      <span class="cancellation-alert-hint">
        Open the order and use the Cancellation panel. Check the FMRC GCash app
        first — refunds are only owed on money that actually arrived, and are sent
        by hand, then recorded against the payment.
      </span>
    `;
  };

  // The three section chips above the stack. Chip 1 covers the panels in
  // #sectionOrders, chip 2 the three record panels, chip 3 the walk-ins - so the
  // number on a chip always matches what opening it reveals.
  const ordersTabCountEls = {
    main: document.getElementById("tabCountOrdersMain"),
    records: document.getElementById("tabCountOrdersRecords"),
    walkin: document.getElementById("tabCountOrdersWalkin"),
  };

  const renderOrdersTabCounts = () => {
    const setCount = (el, value) => {
      if (!el) return;
      el.textContent = String(value);
    };
    setCount(
      ordersTabCountEls.main,
      state.incoming.length + state.directory.length,
    );
    setCount(
      ordersTabCountEls.records,
      getRejectedRows().length + state.returns.length + state.payments.length,
    );
    setCount(ordersTabCountEls.walkin, state.walkIn.length);
  };

  const renderAll = () => {
    renderIncomingTable();
    renderDirectoryTable();
    renderRejectedTable();
    renderReturnsTable();
    renderPaymentsTable();
    renderWalkInTable();
    renderCancellationAlert();
    renderOrdersTabCounts();
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
      returnsRefundsTbody &&
      (!returnsRefundsTbody.children.length ||
        returnsRefundsTbody.querySelector(".table-empty-state"))
    ) {
      showSkeletons(returnsRefundsTbody, 11);
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
      showSkeletons(walkInOrdersTbody, 14);
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
      // Returns ride in the same payload, so the Returns & Refunds panel
      // refreshes on the very same poll as every other table here.
      state.returns = Array.isArray(response.returns) ? response.returns : [];
      state.returnsSummary =
        response.returns_summary && typeof response.returns_summary === "object"
          ? response.returns_summary
          : {};
      state.cancellationsSummary =
        response.cancellations_summary &&
        typeof response.cancellations_summary === "object"
          ? response.cancellations_summary
          : {};
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
      renderEmptyTable(
        returnsRefundsTbody,
        11,
        "Unable to load return requests.",
      );
      renderEmptyTable(walkInOrdersTbody, 14, "Unable to load walk-in orders.");
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

  // ── Courier registry ───────────────────────────────────────────────────────
  // FMRC ships through third-party couriers and has no API contract with any of
  // them, so a "courier" here is only a name plus whatever waybill number staff
  // were given. config/couriers.php holds the list and /couriers serves it, so
  // this dropdown and the link printed on the customer's order always agree.
  const COURIER_OTHER_KEY = "other";
  const courierRegistry = { options: [], default: "jnt", loaded: false };

  const findCourierOption = (key) =>
    courierRegistry.options.find((option) => option.key === key) || null;

  const findCourierKeyByLabel = (label) => {
    const needle = String(label || "")
      .trim()
      .toLowerCase();
    if (!needle) return "";
    const match = courierRegistry.options.find(
      (option) => option.label.trim().toLowerCase() === needle,
    );
    return match ? match.key : "";
  };

  const renderCourierOptions = () => {
    if (!trackingCourierSelect) return;
    const previous = trackingCourierSelect.value;
    trackingCourierSelect.innerHTML = courierRegistry.options
      .map(
        (option) =>
          `<option value="${escapeHtml(option.key)}">${escapeHtml(option.label)}</option>`,
      )
      .join("");
    if (previous && findCourierOption(previous)) {
      trackingCourierSelect.value = previous;
    }
  };

  const loadCourierRegistry = async () => {
    if (courierRegistry.loaded) return;

    try {
      const payload = await request("/couriers");
      const options = (Array.isArray(payload?.data) ? payload.data : [])
        .map((option) => ({
          key: String(option?.key || ""),
          label: String(option?.label || option?.key || ""),
          acceptsTrackingNo: option?.accepts_tracking_no !== false,
        }))
        .filter((option) => option.key && option.label);

      if (options.length) {
        courierRegistry.options = options;
        courierRegistry.default = findCourierOption(String(payload?.default || ""))
          ? String(payload.default)
          : options[0].key;
        courierRegistry.loaded = true;
      }
    } catch {
      // Offline, or a backend that predates the registry. Falling back keeps the
      // dropdown usable instead of empty; "Other courier" still takes any name.
      courierRegistry.options = [
        { key: "jnt", label: "J&T Express", acceptsTrackingNo: true },
        {
          key: COURIER_OTHER_KEY,
          label: "Other courier",
          acceptsTrackingNo: true,
        },
      ];
      courierRegistry.default = "jnt";
    }

    renderCourierOptions();
  };

  /**
   * Keep the two courier fields honest about the chosen company: a name box only
   * for "Other", and no waybill box for pickup, which never gets one.
   */
  const syncCourierFields = () => {
    if (!trackingCourierSelect) return;

    const key = trackingCourierSelect.value;
    const isOther = key === COURIER_OTHER_KEY;
    if (trackingCourierOtherWrap) trackingCourierOtherWrap.hidden = !isOther;

    const acceptsTrackingNo = findCourierOption(key)?.acceptsTrackingNo !== false;
    if (trackingCourierNo) {
      trackingCourierNo.disabled = !acceptsTrackingNo;
      if (!acceptsTrackingNo) trackingCourierNo.value = "";
      trackingCourierNo.placeholder = acceptsTrackingNo
        ? "ex. JT123456789PH"
        : "No waybill for a counter pickup";
    }
  };

  trackingCourierSelect?.addEventListener("change", syncCourierFields);

  /**
   * The courier name to save: the dropdown's own label, or whatever staff typed
   * when they picked "Other".
   */
  const getSelectedCourierName = () => {
    const key = String(trackingCourierSelect?.value || "");
    if (key === COURIER_OTHER_KEY) {
      return String(trackingCourierName?.value || "").trim();
    }
    return findCourierOption(key)?.label || "";
  };

  /**
   * A coordinate box, read as a number. Blank stays blank - an empty box means
   * "the courier did not say", not "0, 0" in the Gulf of Guinea.
   */
  const readCoordinate = (input, min, max) => {
    const raw = String(input?.value || "").trim();
    if (raw === "") return { ok: true, value: null };

    const value = Number(raw);
    if (!Number.isFinite(value) || value < min || value > max) {
      return { ok: false, value: null };
    }
    return { ok: true, value };
  };

  const TRACKING_LATLNG_HINT_DEFAULT = String(
    trackingLatLngHint?.textContent || "",
  ).trim();

  const setTrackingCoordHint = (message) => {
    if (!trackingLatLngHint) return;
    trackingLatLngHint.textContent = message || TRACKING_LATLNG_HINT_DEFAULT;
    trackingLatLngHint.classList.toggle("field-hint--warn", Boolean(message));
  };

  /**
   * "Check on map" appears only once both boxes hold a usable coordinate, so it
   * can never open a map of the middle of the Atlantic. It is how staff confirm
   * a pasted number is the hub they meant before the customer sees the pin.
   */
  const syncTrackingMapPreview = () => {
    if (!trackingMapPreview) return;

    const lat = readCoordinate(trackingLatitude, -90, 90);
    const lng = readCoordinate(trackingLongitude, -180, 180);
    const usable = lat.ok && lng.ok && lat.value !== null && lng.value !== null;

    trackingMapPreview.hidden = !usable;
    trackingMapPreview.href = usable
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          `${lat.value},${lng.value}`,
        )}`
      : "#";
  };

  const setCheckpointCoordinates = (lat, lng) => {
    if (trackingLatitude)
      trackingLatitude.value =
        lat === null || lat === undefined ? "" : String(lat);
    if (trackingLongitude)
      trackingLongitude.value =
        lng === null || lng === undefined ? "" : String(lng);
    syncTrackingMapPreview();
  };

  /**
   * Pull a lat/lng out of a Google Maps URL.
   *
   * A staff member who wants the exact spot of a hub finds it in Maps and copies
   * the address bar, so the address bar has to work as an input. Returns null for
   * a link with no numbers in it - a shortened maps.app.goo.gl, for instance,
   * where only Google's own server knows where it points.
   */
  const parseGoogleMapsCoordinates = (raw) => {
    const text = String(raw || "").trim();
    if (!/^https?:\/\//i.test(text)) return null;

    let url = text;
    try {
      url = decodeURIComponent(text);
    } catch {
      // A half-encoded paste. The raw text still holds the numbers.
    }

    // `!3d`/`!4d` is the pin Google itself resolved, so it is tried before the
    // `@` segment, which is only wherever the camera happened to be sitting.
    const patterns = [
      /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
      /[?&](?:q|query|ll|daddr|destination)=(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/,
      /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return { lat: match[1], lng: match[2] };
    }

    return null;
  };

  // Couriers and staff quote a checkpoint as one "lat, lng" string; Google Maps
  // hands it over as a URL. Both paste into either box and sort themselves out
  // rather than being rejected - which is the difference between a checkpoint
  // that lands on the customer's map and one posted with no coordinates because
  // typing them was fiddly.
  const wireCoordinateInput = (input) => {
    input?.addEventListener("input", () => {
      const raw = String(input.value || "");

      const fromUrl = parseGoogleMapsCoordinates(raw);
      if (fromUrl) {
        setCheckpointCoordinates(fromUrl.lat, fromUrl.lng);
        setTrackingCoordHint("");
        return;
      }

      if (/^https?:\/\//i.test(raw.trim())) {
        setTrackingCoordHint(
          "That link has no coordinates in it. Open it in Google Maps, right-click the pin, click the numbers that appear to copy them, then paste those here.",
        );
        return;
      }

      const parts = raw.split(/[,;\s]+/).filter(Boolean);
      if (parts.length >= 2) {
        setCheckpointCoordinates(parts[0], parts[1]);
      }
      setTrackingCoordHint("");
      syncTrackingMapPreview();
    });
  };
  wireCoordinateInput(trackingLatitude);
  wireCoordinateInput(trackingLongitude);

  // ── Checkpoint presets ─────────────────────────────────────────────────────
  // Still a manual relay: this only means the checkpoint FMRC posts twenty times
  // a week is picked instead of retyped, coordinates included. Nothing here
  // talks to a courier. config/tracking_checkpoints.php holds the list.
  const checkpointPresets = { items: [], origin: null, loaded: false };

  // The order the modal is currently open on, so "Use delivery address" has an
  // address to reach for.
  let trackingModalOrder = null;

  const toPresetCoordinate = (value, limit) => {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
  };

  const loadCheckpointPresets = async () => {
    if (checkpointPresets.loaded) return;

    try {
      const payload = await request("/admin/tracking/checkpoint-presets");
      const items = (Array.isArray(payload?.data) ? payload.data : [])
        .map((preset) => ({
          key: String(preset?.key || ""),
          label: String(preset?.label || preset?.title || ""),
          fulfillment: ["pickup", "delivery", "both"].includes(
            preset?.fulfillment,
          )
            ? preset.fulfillment
            : "both",
          stage: ["to_pay", "to_ship", "to_receive", "completed"].includes(
            preset?.stage,
          )
            ? preset.stage
            : "",
          title: String(preset?.title || ""),
          description: String(preset?.description || ""),
          locationName: String(preset?.location_name || ""),
          lat: toPresetCoordinate(preset?.lat, 90),
          lng: toPresetCoordinate(preset?.lng, 180),
        }))
        .filter((preset) => preset.key && preset.title);

      const origin = payload?.origin;
      checkpointPresets.items = items;
      checkpointPresets.origin =
        origin && typeof origin === "object"
          ? {
              locationName: String(origin.location_name || ""),
              lat: toPresetCoordinate(origin.lat, 90),
              lng: toPresetCoordinate(origin.lng, 180),
            }
          : null;
      checkpointPresets.loaded = items.length > 0;
    } catch {
      // Offline, or a backend that predates the presets. Every field a preset
      // would have filled is a field staff can type, so the modal still works -
      // the dropdown just stays empty and hides itself.
      checkpointPresets.items = [];
      checkpointPresets.origin = null;
    }

    renderCheckpointPresetOptions(trackingModalOrder);
  };

  /**
   * List the presets that make sense for this order. A pickup order never ships,
   * so offering "Out for delivery" on one is how a wrong checkpoint gets posted.
   */
  const renderCheckpointPresetOptions = (order) => {
    if (!trackingPresetSelect) return;

    const wrap = trackingPresetSelect.closest(".field-stack");
    if (!checkpointPresets.items.length) {
      if (wrap) wrap.hidden = true;
      return;
    }
    if (wrap) wrap.hidden = false;

    const isPickup = Boolean(
      order && (order.is_pickup || order.fulfillment_type === "pickup"),
    );
    const wanted = isPickup ? "pickup" : "delivery";

    trackingPresetSelect.innerHTML = [
      '<option value="">Type it myself</option>',
      ...checkpointPresets.items
        .filter(
          (preset) =>
            preset.fulfillment === "both" || preset.fulfillment === wanted,
        )
        .map(
          (preset) =>
            `<option value="${escapeHtml(preset.key)}">${escapeHtml(
              preset.label,
            )}</option>`,
        ),
    ].join("");
    trackingPresetSelect.value = "";
  };

  /**
   * Fill the checkpoint fields from a preset. `{courier}` becomes the company
   * chosen in the dropdown, so one preset covers J&T, LBC and the rest.
   *
   * Coordinates are only written when the preset actually has them: a parcel
   * that is out for delivery is somewhere in the customer's own street, and
   * blanking the boxes would throw away the last pin the customer saw.
   */
  const applyCheckpointPreset = (key) => {
    const preset = checkpointPresets.items.find((item) => item.key === key);
    if (!preset) return;

    const courier = getSelectedCourierName() || "the courier";
    const fill = (text) => String(text || "").replaceAll("{courier}", courier);

    if (trackingEventTitle) trackingEventTitle.value = fill(preset.title);
    if (trackingEventDescription)
      trackingEventDescription.value = fill(preset.description);
    if (preset.locationName && trackingLocationName)
      trackingLocationName.value = preset.locationName;
    if (preset.lat !== null && preset.lng !== null)
      setCheckpointCoordinates(preset.lat, preset.lng);

    // A staff member posting "Out for delivery" always means the order is now To
    // Receive, so the stage follows the checkpoint instead of being a second
    // thing to remember. Still a dropdown they can override.
    if (preset.stage && trackingStage) trackingStage.value = preset.stage;

    setTrackingCoordHint("");
  };

  trackingPresetSelect?.addEventListener("change", () => {
    const key = String(trackingPresetSelect.value || "");
    if (key) applyCheckpointPreset(key);
  });

  // Re-fill the wording when the courier changes after a preset was picked -
  // otherwise a title still reads "Handed over to J&T Express" on an LBC parcel.
  trackingCourierSelect?.addEventListener("change", () => {
    const key = String(trackingPresetSelect?.value || "");
    if (key) applyCheckpointPreset(key);
  });

  trackingLatLngOrigin?.addEventListener("click", () => {
    const origin = checkpointPresets.origin;
    if (!origin || origin.lat === null || origin.lng === null) {
      setTrackingCoordHint(
        "The FMRC office coordinates are not configured yet. Type them in, or paste them from Google Maps.",
      );
      return;
    }
    setCheckpointCoordinates(origin.lat, origin.lng);
    if (trackingLocationName && !trackingLocationName.value.trim())
      trackingLocationName.value = origin.locationName;
    setTrackingCoordHint("");
  });

  trackingLatLngDestination?.addEventListener("click", () => {
    const order = trackingModalOrder;
    const lat = toPresetCoordinate(
      order?.destination_latitude ?? order?.delivery_latitude,
      90,
    );
    const lng = toPresetCoordinate(
      order?.destination_longitude ?? order?.delivery_longitude,
      180,
    );

    if (lat === null || lng === null) {
      // Checkout only pins a map when the customer drops one, so plenty of real
      // orders have an address in words and no coordinates at all.
      setTrackingCoordHint(
        "This order has no map pin on its delivery address, so there is nothing to copy. Paste the rider's location from Google Maps instead.",
      );
      return;
    }

    setCheckpointCoordinates(lat, lng);
    if (trackingLocationName && !trackingLocationName.value.trim())
      trackingLocationName.value = String(
        order?.destination_label || order?.delivery_address_line || "",
      );
    setTrackingCoordHint("");
  });

  trackingLatLngClear?.addEventListener("click", () => {
    setCheckpointCoordinates(null, null);
    setTrackingCoordHint("");
  });

  /**
   * A pickup order has no delivery address, and `destination_*` on one points at
   * the FMRC office - the very thing the other button already does. Offering both
   * would be two buttons doing the same job under different names.
   */
  const syncCoordinateButtons = (order) => {
    const isPickup = Boolean(
      order && (order.is_pickup || order.fulfillment_type === "pickup"),
    );
    if (trackingLatLngDestination) trackingLatLngDestination.hidden = isPickup;
  };

  /**
   * Rewrite a stage <select>'s option text from the labels the server sent with
   * this order, keeping every option's `value` untouched - those are the four
   * stage keys the API validates against, and they must not change with the
   * wording. Each option remembers its original text, so reopening the modal on
   * a delivery order after a pickup one restores the delivery wording instead of
   * leaving "Ready for Pickup" behind.
   */
  const applyStageLabelsToSelect = (selectEl, labels) => {
    if (!selectEl) return;

    Array.from(selectEl.options).forEach((option) => {
      if (option.dataset.defaultLabel === undefined) {
        option.dataset.defaultLabel = option.textContent || "";
      }
      const sent = labels && typeof labels === "object" ? labels[option.value] : "";
      option.textContent = sent || option.dataset.defaultLabel;
    });
  };

  const openTrackingModal = (order) => {
    if (!order || !modalTrackingUpdate) return;

    // Remembered for "Use delivery address" and for filtering the checkpoint
    // presets down to the ones this kind of order can actually reach.
    trackingModalOrder = order;
    renderCheckpointPresetOptions(order);
    syncCoordinateButtons(order);
    setTrackingCoordHint("");

    if (trackingOrderId) trackingOrderId.value = String(order.id || "");
    if (trackingOrderNo)
      trackingOrderNo.value =
        order.order_no_display || `#${order.order_no || order.id}`;
    if (trackingStage) {
      // Relabel the stage options for the order being edited. A pickup order is
      // never shipped or delivered, so leaving the delivery wording here is how
      // staff end up posting "Out for delivery" on an order the customer is
      // coming to collect. The server sends the wording it also shows the
      // customer, so both sides read the same words.
      applyStageLabelsToSelect(trackingStage, order.stage_labels);
      trackingStage.value = order.customer_stage || "to_pay";
    }
    if (trackingEventTitle) {
      trackingEventTitle.value = "";
      // The example has to be something staff would actually type for this
      // order: a pickup order has no shipping step to prepare for.
      trackingEventTitle.placeholder =
        order.fulfillment_type === "pickup" || order.is_pickup
          ? "ex. Order is ready for pickup at the FMRC office"
          : "ex. Order prepared for shipping";
    }
    if (trackingEventDescription) trackingEventDescription.value = "";

    // Pickup orders never travel, so the courier defaults to the counter rather
    // than to a shipping company nobody booked.
    const savedCourierName = String(order.courier_name || "").trim();
    const savedCourierKey =
      findCourierKeyByLabel(savedCourierName) ||
      (order.fulfillment_type === "pickup" ? "pickup" : "") ||
      (savedCourierName ? COURIER_OTHER_KEY : courierRegistry.default);

    if (trackingCourierSelect) {
      trackingCourierSelect.value = findCourierOption(savedCourierKey)
        ? savedCourierKey
        : courierRegistry.default;
    }
    if (trackingCourierName) {
      trackingCourierName.value =
        trackingCourierSelect?.value === COURIER_OTHER_KEY
          ? savedCourierName
          : "";
    }
    syncCourierFields();

    if (trackingCourierNo)
      trackingCourierNo.value = order.courier_tracking_no || "";
    if (trackingLocationName)
      trackingLocationName.value = order.location_name || "";
    if (trackingLatitude)
      trackingLatitude.value =
        order.latitude === null || order.latitude === undefined
          ? ""
          : String(order.latitude);
    if (trackingLongitude)
      trackingLongitude.value =
        order.longitude === null || order.longitude === undefined
          ? ""
          : String(order.longitude);
    syncTrackingMapPreview();

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
    courierKey: String(trackingCourierSelect?.value || "").trim(),
    courierName: String(trackingCourierName?.value || "").trim(),
    courierNo: String(trackingCourierNo?.value || "").trim(),
    locationName: String(trackingLocationName?.value || "").trim(),
    latitude: String(trackingLatitude?.value || "").trim(),
    longitude: String(trackingLongitude?.value || "").trim(),
  });

  trackingDiscardGuard = window.createAdminFormDiscardGuard?.({
    getSnapshot: getTrackingFormSnapshot,
    close: closeTrackingModal,
  });

  // ── Returns & Refunds modals ───────────────────────────────────────────

  const RETURN_ACTOR_LABELS = {
    customer: "Customer",
    admin: "Admin",
    staff: "Staff",
    system: "System",
  };

  // Read-only field rendered with the very same markup #modalOrderDetails
  // uses, so the two detail modals are indistinguishable in style.
  const returnField = (label, value, options = {}) => {
    const raw =
      value === null || value === undefined || String(value).trim() === ""
        ? "-"
        : value;
    const safe = escapeHtml(raw);
    return `
      <div class="field-stack${options.full ? " full" : ""}">
        <label>${escapeHtml(label)}</label>
        ${
          options.textarea
            ? `<textarea class="textarea-field" readonly>${safe}</textarea>`
            : `<input class="input-field" value="${safe}" readonly />`
        }
      </div>`;
  };

  const renderReturnEvidence = (media) => {
    const list = Array.isArray(media) ? media : [];
    if (!list.length) {
      return `<span class="return-empty-note">No photos or videos were uploaded.</span>`;
    }

    return `
      <div class="return-evidence-grid">
        ${list
          .map((item) => {
            const url = resolveMediaUrl(item?.url);
            if (!url) return "";
            const src = escapeHtml(url);
            const kind =
              window.AdminMediaViewer?.resolveType(url, item?.name || "", item?.type) ||
              (String(item?.type) === "video" ? "video" : "image");
            const isVideo = kind === "video";
            const label = isVideo
              ? "Play return evidence video"
              : "View return evidence photo";
            const inner = isVideo
              ? `<video src="${src}" preload="metadata" muted playsinline tabindex="-1" aria-hidden="true"></video><span class="return-evidence-play" aria-hidden="true"><i class="fa-solid fa-circle-play"></i></span>`
              : `<img src="${src}" alt="Return evidence photo" loading="lazy" />`;
            return `<button type="button" class="return-evidence-item" data-media-url="${src}" data-media-type="${kind}" data-media-name="${escapeHtml(item?.name || label)}" title="${label}" aria-label="${label}">${inner}</button>`;
          })
          .join("")}
      </div>`;
  };

  const renderReturnItemsTable = (items) => {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) {
      return `<span class="return-empty-note">No item lines recorded.</span>`;
    }

    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    state.returnItemsPage = Math.min(
      Math.max(Number(state.returnItemsPage || 1), 1),
      totalPages,
    );
    const start = (state.returnItemsPage - 1) * PAGE_SIZE;
    const pageItems = list.slice(start, start + PAGE_SIZE);

    return `
      <div class="return-items-scroll">
        <table class="return-items-table">
          <thead>
            <tr><th>Item</th><th>Qty</th><th>Unit Price</th><th>Line Total</th></tr>
          </thead>
          <tbody>
            ${pageItems
              .map(
                (item) => `
                  <tr>
                    <td>${escapeHtml(item?.product_name || "Returned item")}</td>
                    <td>${escapeHtml(String(item?.quantity ?? 1))}</td>
                    <td>${escapeHtml(item?.unit_price_label || formatMoney(item?.unit_price))}</td>
                    <td>${escapeHtml(item?.line_total_label || formatMoney(item?.line_total))}</td>
                  </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>
      ${
        list.length > PAGE_SIZE
          ? `<div class="table-footer" style="padding:10px 0 0;background:transparent;border:0;">
               <div class="table-footer-meta">Showing ${start + 1}&ndash;${Math.min(start + PAGE_SIZE, list.length)} of ${list.length} returned items</div>
               <div class="table-pagination" aria-label="Returned item pages">
                 <button type="button" class="page-btn" data-return-items-prev ${state.returnItemsPage <= 1 ? "disabled" : ""} aria-label="Previous returned item page"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button>
                 <input class="page-number" data-return-items-page type="number" min="1" max="${totalPages}" value="${state.returnItemsPage}" inputmode="numeric" aria-label="Go to returned item page">
                 <button type="button" class="page-btn" data-return-items-next ${state.returnItemsPage >= totalPages ? "disabled" : ""} aria-label="Next returned item page"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
               </div>
             </div>`
          : ""
      }`;
  };

  const renderReturnTimeline = (timeline) => {
    const list = Array.isArray(timeline) ? timeline : [];
    if (!list.length) {
      return `<span class="return-empty-note">No timeline events yet.</span>`;
    }

    return `
      <ol class="return-timeline">
        ${list
          .map((event, index) => {
            const actor =
              RETURN_ACTOR_LABELS[String(event?.actor_role || "").toLowerCase()] ||
              "System";
            return `
              <li class="return-timeline-item${index === 0 ? " is-latest" : ""}">
                <span class="return-timeline-dot ${returnStatusClass(event?.status)}"></span>
                <div class="return-timeline-body">
                  <p class="return-timeline-title">${escapeHtml(event?.title || event?.status_label || "Return update")}</p>
                  ${event?.description ? `<p class="return-timeline-desc">${escapeHtml(event.description)}</p>` : ""}
                  <p class="return-timeline-meta">${escapeHtml(actor)} · ${escapeHtml(event?.occurred_at_label || "-")}</p>
                </div>
              </li>`;
          })
          .join("")}
      </ol>`;
  };

  const renderReturnDetailsBody = (detail) => {
    const amount = resolveReturnAmount(detail);
    const shipped = detail?.return_courier_name || detail?.return_tracking_no;
    const refunded =
      detail?.refunded_amount !== null && detail?.refunded_amount !== undefined;

    return `
      <div class="form-grid">
        ${returnField("Return No.", detail?.return_no_display)}
        ${returnField("Status", returnStatusLabel(detail))}
        ${returnField("Order No.", detail?.order_no_display)}
        ${returnField("Date Requested", detail?.requested_at_label)}
        ${returnField("Customer", detail?.customer_name)}
        ${returnField("Contact", detail?.customer_contact || detail?.customer_email)}
        ${returnField("Reason", detail?.reason_label)}
        ${returnField("Preferred Resolution", detail?.resolution_label)}
        ${returnField(`${amount.caption} Amount`, amount.label)}
        ${returnField("Order Total", detail?.order?.total_label || formatMoney(detail?.order_total))}
        ${detail?.reason_detail ? returnField("Reason Detail", detail.reason_detail, { full: true, textarea: true }) : ""}
        ${detail?.customer_note ? returnField("Customer Note", detail.customer_note, { full: true, textarea: true }) : ""}
        ${detail?.decision_note ? returnField("Decision Note", detail.decision_note, { full: true, textarea: true }) : ""}
        ${detail?.handled_by ? returnField("Handled By", `${detail.handled_by}${detail.handled_by_role ? ` (${detail.handled_by_role})` : ""}`) : ""}
        ${detail?.decided_at_label ? returnField("Decision Date", detail.decided_at_label) : ""}
        ${shipped ? returnField("Return Courier", detail?.return_courier_name) : ""}
        ${shipped ? returnField("Return Tracking No.", detail?.return_tracking_no) : ""}
        ${detail?.item_received_at_label ? returnField("Item Received", detail.item_received_at_label) : ""}

        <div class="field-stack full">
          <label>Returned Item(s)</label>
          ${renderReturnItemsTable(detail?.items)}
        </div>

        ${
          refunded
            ? `<div class="field-stack full">
                 <label>Refund Receipt</label>
                 <div class="return-receipt">
                   <p><span>Amount refunded</span><strong>${escapeHtml(detail.refunded_amount_label || formatMoney(detail.refunded_amount))}</strong></p>
                   <p><span>Method</span><strong>${escapeHtml(detail.refund_method_label || "-")}</strong></p>
                   <p><span>Reference</span><strong>${escapeHtml(detail.refund_reference || "-")}</strong></p>
                   <p><span>Released on</span><strong>${escapeHtml(detail.refunded_at_label || "-")}</strong></p>
                 </div>
               </div>`
            : ""
        }

        <div class="field-stack full">
          <label>Customer Evidence${detail?.media_count ? ` (${detail.media_count})` : ""}</label>
          ${renderReturnEvidence(detail?.media)}
        </div>

        <div class="field-stack full">
          <label>Return Timeline</label>
          ${renderReturnTimeline(detail?.timeline)}
        </div>
      </div>`;
  };

  const goToReturnItemsPage = (rawPage) => {
    const detail =
      state.returnDetailsById.get(String(activeReturnId || "")) ||
      state.returns.find(
        (row) => String(row?.id) === String(activeReturnId || ""),
      );
    if (!detail || !returnDetailsBody) return;

    const list = Array.isArray(detail.items) ? detail.items : [];
    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    const raw = String(rawPage ?? "").trim();
    const requestedPage = /^\d+$/.test(raw)
      ? Number(raw)
      : state.returnItemsPage;
    state.returnItemsPage = Math.min(
      Math.max(requestedPage, 1),
      totalPages,
    );
    returnDetailsBody.innerHTML = renderReturnDetailsBody(detail);
    window.AdminPageNumberInput?.upgrade(returnDetailsBody);
  };

  returnDetailsBody?.addEventListener("click", (event) => {
    if (event.target.closest("[data-return-items-prev]")) {
      goToReturnItemsPage(state.returnItemsPage - 1);
      return;
    }
    if (event.target.closest("[data-return-items-next]")) {
      goToReturnItemsPage(state.returnItemsPage + 1);
    }
  });

  returnDetailsBody?.addEventListener("change", (event) => {
    const input = event.target.closest("[data-return-items-page]");
    if (input) goToReturnItemsPage(input.value);
  });

  returnDetailsBody?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const input = event.target.closest("[data-return-items-page]");
    if (!input) return;
    event.preventDefault();
    goToReturnItemsPage(input.value);
  });

  modalReturnDetails
    ?.querySelector('[data-modal-close="#modalReturnDetails"]')
    ?.addEventListener("click", () => {
      activeReturnId = null;
      state.returnItemsPage = 1;
    });

  const upsertReturnInState = (record) => {
    if (!record || record.id === undefined || record.id === null) return;
    const key = String(record.id);
    state.returnDetailsById.set(key, record);

    const index = state.returns.findIndex((row) => String(row?.id) === key);
    if (index >= 0) {
      state.returns[index] = { ...state.returns[index], ...record };
    } else {
      state.returns.unshift(record);
    }
  };

  const openReturnDetailsModal = async (returnId) => {
    if (!modalReturnDetails || !returnDetailsBody) return;

    const key = String(returnId || "");
    if (!key) return;
    if (activeReturnId !== key) state.returnItemsPage = 1;
    activeReturnId = key;

    const cached =
      state.returnDetailsById.get(key) ||
      state.returns.find((row) => String(row?.id) === key) ||
      null;

    if (returnDetailsSubtitle) {
      returnDetailsSubtitle.textContent = cached
        ? `${cached.return_no_display || `#${cached.return_no || key}`} · ${returnStatusLabel(cached)}`
        : "Loading return request...";
    }

    // Paint what is already known, then let the detail request fill in the
    // timeline and the order snapshot the summary row does not carry.
    returnDetailsBody.innerHTML = cached
      ? renderReturnDetailsBody(cached)
      : `<div class="return-empty-note">Loading return details...</div>`;
    window.AdminPageNumberInput?.upgrade(returnDetailsBody);
    modalReturnDetails.classList.add("show");

    try {
      const response = await request(`/admin/returns/${key}`);
      if (!response?.data) return;
      upsertReturnInState(response.data);
      // A second return may have been opened while this was in flight.
      if (activeReturnId !== key) return;
      returnDetailsBody.innerHTML = renderReturnDetailsBody(response.data);
      window.AdminPageNumberInput?.upgrade(returnDetailsBody);
      if (returnDetailsSubtitle) {
        returnDetailsSubtitle.textContent = `${response.data.return_no_display || `#${key}`} · ${returnStatusLabel(response.data)}`;
      }
      renderReturnsTable();
    } catch (error) {
      if (error?.isCancelled) return;
      if (activeReturnId !== key) return;
      if (!cached) {
        returnDetailsBody.innerHTML = `<div class="return-empty-note">${escapeHtml(error.message || "Unable to load this return request.")}</div>`;
      }
    }
  };

  const resolveReturnActionKind = (row) => {
    if (row?.can_decide) return "decision";
    if (row?.can_receive) return "received";
    if (row?.can_refund) return "refund";
    return "";
  };

  // `approved` unlocks both "Confirm Item Received" and "Release Refund", so the
  // clicked icon decides which form opens instead of the stage order.
  const isReturnActionKindAllowed = (row, kind) =>
    (kind === "decision" && Boolean(row?.can_decide)) ||
    (kind === "received" && Boolean(row?.can_receive)) ||
    (kind === "refund" && Boolean(row?.can_refund));

  const setReturnActionSections = (kind) => {
    modalReturnAction
      ?.querySelectorAll("[data-return-section]")
      .forEach((node) => {
        node.style.display =
          node.getAttribute("data-return-section") === kind ? "" : "none";
      });
  };

  const closeReturnActionModal = () => {
    modalReturnAction?.classList.remove("show");
  };

  const getReturnActionSnapshot = () => ({
    id: String(returnActionId?.value || ""),
    kind: String(returnActionKind?.value || ""),
    decision: String(returnDecisionSelect?.value || ""),
    approvedAmount: String(returnApprovedAmount?.value || ""),
    decisionNote: String(returnDecisionNote?.value || "").trim(),
    receivedNote: String(returnReceivedNote?.value || "").trim(),
    refundStage: String(returnRefundStage?.value || ""),
    refundMethod: String(returnRefundMethod?.value || ""),
    refundAmount: String(returnRefundAmount?.value || ""),
    refundReference: String(returnRefundReference?.value || "").trim(),
    refundNote: String(returnRefundNote?.value || "").trim(),
  });

  const returnActionDiscardGuard = window.createAdminFormDiscardGuard?.({
    getSnapshot: getReturnActionSnapshot,
    close: closeReturnActionModal,
  });

  const RETURN_ACTION_COPY = {
    decision: {
      title: "Review Return Request",
      subtitle:
        "Approve to issue return instructions, or reject with a reason. The customer is emailed either way.",
      submit: "Save Decision",
    },
    received: {
      title: "Confirm Item Received",
      subtitle:
        "Mark the returned item as arrived and inspected. The refund can be released next.",
      submit: "Confirm Received",
    },
    refund: {
      title: "Release Refund",
      subtitle:
        "Releasing the refund also marks the order payment as refunded in Payments History.",
      submit: "Save Refund",
    },
  };

  // A return filed against a zero-priced order has nothing to pay back, so the
  // amount guards below have to know whether money is actually at stake before
  // they refuse a 0.00 figure.
  let returnActionRequestedAmount = 0;
  let returnActionCeilingAmount = 0;

  const openReturnActionModal = (row, requestedKind = "") => {
    if (!modalReturnAction || !row) return;

    const kind = isReturnActionKindAllowed(row, requestedKind)
      ? requestedKind
      : resolveReturnActionKind(row);
    if (!kind) {
      showPopup("This return has no pending action left.", {
        title: "Nothing To Do",
      });
      return;
    }

    const copy = RETURN_ACTION_COPY[kind];
    const returnNo = row.return_no_display || `#${row.return_no || row.id}`;
    const requested = Number(row.requested_amount || 0);
    const ceiling = Number(
      row.approved_amount !== null && row.approved_amount !== undefined
        ? row.approved_amount
        : requested,
    );
    returnActionRequestedAmount = Number.isFinite(requested) ? requested : 0;
    returnActionCeilingAmount = Number.isFinite(ceiling) ? ceiling : 0;

    if (returnActionId) returnActionId.value = String(row.id || "");
    if (returnActionKind) returnActionKind.value = kind;
    if (returnActionNo) returnActionNo.value = returnNo;
    if (returnActionRequested) {
      returnActionRequested.value =
        row.requested_amount_label || formatMoney(requested);
    }
    if (returnActionTitle) returnActionTitle.textContent = copy.title;
    if (returnActionSubtitle) {
      returnActionSubtitle.textContent = `${returnNo} · ${copy.subtitle}`;
    }
    if (btnSubmitReturnAction) btnSubmitReturnAction.textContent = copy.submit;

    if (returnDecisionSelect) returnDecisionSelect.value = "approve";
    if (returnApprovedAmount) returnApprovedAmount.value = requested.toFixed(2);
    if (returnDecisionNote) returnDecisionNote.value = "";
    if (returnReceivedNote) returnReceivedNote.value = "";
    if (returnRefundStage) returnRefundStage.value = "released";
    if (returnRefundMethod) {
      returnRefundMethod.value = row.refund_method || "gcash";
    }
    if (returnRefundAmount) returnRefundAmount.value = ceiling.toFixed(2);
    if (returnRefundReference) {
      returnRefundReference.value = row.refund_reference || "";
    }
    if (returnRefundNote) returnRefundNote.value = "";

    setReturnActionSections(kind);
    returnActionDiscardGuard?.capture();
    modalReturnAction.classList.add("show");
  };

  // Turns the visible section of the action form into one API call. Amounts
  // are still re-clamped server-side, so this only has to be reasonable.
  const buildReturnActionRequest = (kind) => {
    if (kind === "decision") {
      const decision = String(returnDecisionSelect?.value || "approve");
      const note = String(returnDecisionNote?.value || "").trim();
      if (decision === "reject" && !note) {
        return {
          error: "Tell the customer why the request was rejected.",
          focus: returnDecisionNote,
        };
      }

      const body = { decision, decision_note: note || null };
      const rawApproved = String(returnApprovedAmount?.value || "").trim();
      const amount = Number(rawApproved);
      if (decision === "approve" && rawApproved) {
        // Blank means "approve the full requested amount" — the server fills it
        // in. A typed value still has to be a real peso figure, and it may only
        // be 0.00 when the request itself is worth nothing.
        if (!Number.isFinite(amount) || amount < 0) {
          return {
            error: "Enter a valid approved amount.",
            focus: returnApprovedAmount,
          };
        }
        if (amount <= 0 && returnActionRequestedAmount > 0) {
          return {
            error: "Approved amount must be greater than zero.",
            focus: returnApprovedAmount,
          };
        }
        body.approved_amount = amount;
      }

      return {
        path: `/admin/returns/{id}/decision`,
        body,
        confirmTitle: decision === "approve" ? "Approve Return" : "Reject Return",
        confirmText: decision === "approve" ? "Approve" : "Reject",
        confirmMessage:
          decision === "approve"
            ? "Approve this return request? The customer will be asked to send the item back."
            : "Reject this return request? The customer will see your reason and may file again while the window is open.",
        success: "Return decision saved.",
      };
    }

    if (kind === "received") {
      return {
        path: `/admin/returns/{id}/received`,
        body: { note: String(returnReceivedNote?.value || "").trim() || null },
        confirmTitle: "Confirm Item Received",
        confirmText: "Confirm",
        confirmMessage:
          "Mark the returned item as received and inspected? The customer will be notified.",
        success: "Returned item marked as received.",
      };
    }

    const method = String(returnRefundMethod?.value || "gcash");
    const stage = String(returnRefundStage?.value || "released");
    const rawAmount = String(returnRefundAmount?.value || "").trim();
    const amount = Number(rawAmount);
    // A blank field must not read as zero here: Number("") is 0, which would
    // otherwise happily release a ₱ 0.00 refund and close the return. A real
    // 0.00 is only legitimate when the return itself is worth nothing.
    if (!rawAmount || !Number.isFinite(amount) || amount < 0) {
      return {
        error: rawAmount
          ? "Enter a valid refund amount."
          : "Enter the refund amount before saving.",
        focus: returnRefundAmount,
      };
    }
    if (amount <= 0 && returnActionCeilingAmount > 0) {
      return {
        error: "Refund amount must be greater than zero.",
        focus: returnRefundAmount,
      };
    }

    return {
      path: `/admin/returns/{id}/refund`,
      body: {
        stage,
        refund_method: method,
        amount,
        refund_reference:
          String(returnRefundReference?.value || "").trim() || null,
        note: String(returnRefundNote?.value || "").trim() || null,
      },
      confirmTitle: stage === "released" ? "Release Refund" : "Mark Refund Processing",
      confirmText: stage === "released" ? "Release" : "Save",
      confirmMessage:
        stage === "released"
          ? `Release ${formatMoney(amount)} to this customer? The order payment will be marked as refunded.`
          : `Mark this return as refund processing for ${formatMoney(amount)}?`,
      success:
        stage === "released"
          ? "Refund released successfully."
          : "Return marked as refund processing.",
    };
  };

  // Repaints an open Return Details modal after a mutation so the admin never
  // has to close and reopen it to see the status they just saved.
  const refreshOpenReturnDetails = (id, record) => {
    if (!record || !returnDetailsBody) return;
    if (activeReturnId !== String(id)) return;
    if (!modalReturnDetails?.classList.contains("show")) return;

    returnDetailsBody.innerHTML = renderReturnDetailsBody(record);
    window.AdminPageNumberInput?.upgrade(returnDetailsBody);
    if (returnDetailsSubtitle) {
      returnDetailsSubtitle.textContent = `${
        record.return_no_display || `#${record.return_no || id}`
      } · ${returnStatusLabel(record)}`;
    }
  };

  const submitReturnAction = async () => {
    if (returnActionBusy) return;

    const id = String(returnActionId?.value || "");
    const kind = String(returnActionKind?.value || "");
    if (!id || !RETURN_ACTION_COPY[kind]) {
      showPopup("No return request selected.", { title: "Action Failed" });
      return;
    }

    const plan = buildReturnActionRequest(kind);
    if (plan.error) {
      showPopup(plan.error, { title: "Missing Details" });
      plan.focus?.focus();
      return;
    }

    const shouldContinue = await askConfirm(plan.confirmMessage, {
      title: plan.confirmTitle,
      confirmText: plan.confirmText,
    });

    if (!shouldContinue) return;

    returnActionBusy = true;
    const originalSubmitHtml = btnSubmitReturnAction?.innerHTML || "";
    if (btnSubmitReturnAction) {
      btnSubmitReturnAction.disabled = true;
      btnSubmitReturnAction.innerHTML =
        '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
    }
    if (btnCancelReturnAction) btnCancelReturnAction.disabled = true;

    try {
      const response = await request(plan.path.replace("{id}", id), {
        method: "POST",
        body: plan.body,
      });

      if (response?.data) {
        upsertReturnInState(response.data);
      }

      closeReturnActionModal();
      returnActionDiscardGuard?.clear();
      renderReturnsTable();
      refreshOpenReturnDetails(id, response?.data);

      notifyOrdersRealtimeUpdate({
        type: "return-updated",
        returnId: id,
        orderId: String(response?.data?.order_id || ""),
      });
      showPopup(plan.success, { title: "Success" });
      void syncOrders(false, { force: true, source: "action" });
    } catch (error) {
      showPopup(error.message || "Unable to save this return update.", {
        title: "Action Failed",
      });
    } finally {
      returnActionBusy = false;
      if (btnSubmitReturnAction) {
        btnSubmitReturnAction.disabled = false;
        btnSubmitReturnAction.innerHTML = originalSubmitHtml;
      }
      if (btnCancelReturnAction) btnCancelReturnAction.disabled = false;
    }
  };

  // Single-row archive. It rides the same bulk endpoint the header checkbox
  // uses, so eligibility stays decided in exactly one place server-side.
  const archiveReturn = async (returnId, label) => {
    const id = String(returnId || "");
    if (!id) return;

    const shouldArchive = await askConfirm(
      `Archive ${label || `return #${id}`}? It moves to Archives and leaves this panel.`,
      { title: "Archive Return", confirmText: "Archive" },
    );

    if (!shouldArchive) return;

    try {
      const response = await request("/admin/returns/archive-bulk", {
        method: "PATCH",
        body: { ids: [id] },
      });

      state.returns = state.returns.filter((row) => String(row?.id) !== id);
      state.returnDetailsById.delete(id);
      if (activeReturnId === id) {
        modalReturnDetails?.classList.remove("show");
        activeReturnId = null;
      }
      renderReturnsTable();

      notifyOrdersRealtimeUpdate({ type: "return-archived", returnId: id });
      showPopup(response?.message || "Return record archived successfully.", {
        title: "Archived ✓",
      });
      void syncOrders(false, { force: true, source: "action" });
    } catch (error) {
      showPopup(error.message || "Unable to archive this return record.", {
        title: "Archive Failed",
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

  // ── Walk-in: Mark as Done + Archive ────────────────────────────────────
  // Same two-step contract as appointments: a walk-in has to be Completed
  // before it can leave the live table, so an in-progress sale can never be
  // filed away by accident.

  const openWalkInCompleteModal = (id, label) => {
    const modal = document.getElementById("modalCompleteWalkInOrder");
    if (!modal) return;
    const labelEl = document.getElementById("completeWalkInTargetLabel");
    if (labelEl) labelEl.textContent = label || `#${id}`;
    modal._pendingWalkInId = id;
    modal.classList.add("show");
  };

  const closeWalkInCompleteModal = () => {
    const modal = document.getElementById("modalCompleteWalkInOrder");
    modal?.classList.remove("show");
    if (modal) modal._pendingWalkInId = null;
  };

  const openWalkInArchiveModal = (id, label) => {
    const modal = document.getElementById("modalArchiveWalkInOrder");
    if (!modal) return;
    const labelEl = document.getElementById("walkInArchiveTargetLabel");
    if (labelEl) labelEl.textContent = label || `#${id}`;
    modal._pendingWalkInId = id;
    modal.classList.add("show");
  };

  const closeWalkInArchiveModal = () => {
    const modal = document.getElementById("modalArchiveWalkInOrder");
    modal?.classList.remove("show");
    if (modal) modal._pendingWalkInId = null;
  };

  document
    .getElementById("btnCancelCompleteWalkIn")
    ?.addEventListener("click", closeWalkInCompleteModal);

  document
    .getElementById("btnCancelArchiveWalkIn")
    ?.addEventListener("click", closeWalkInArchiveModal);

  document
    .getElementById("btnConfirmCompleteWalkIn")
    ?.addEventListener("click", async () => {
      const modal = document.getElementById("modalCompleteWalkInOrder");
      const id = modal?._pendingWalkInId;
      if (!id) return;

      const btn = document.getElementById("btnConfirmCompleteWalkIn");
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Saving...";
      }

      try {
        const response = await request(`/admin/walkin-orders/${id}/complete`, {
          method: "PATCH",
        });
        const updated = response?.data;
        const index = state.walkIn.findIndex(
          (row) => String(row.id) === String(id),
        );
        if (index >= 0) {
          state.walkIn[index] = updated
            ? { ...state.walkIn[index], ...updated }
            : { ...state.walkIn[index], status: "Completed" };
        }
        renderAll();
        notifyOrdersRealtimeUpdate({
          type: "walkin-completed",
          walkInId: String(id),
        });
        closeWalkInCompleteModal();
        showPopup("Walk-in order marked as done.", { title: "Updated ✓" });
      } catch (error) {
        showPopup(error.message || "Unable to mark walk-in order as done.", {
          title: "Action Failed",
        });
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Mark as Done';
        }
      }
    });

  document
    .getElementById("btnConfirmArchiveWalkIn")
    ?.addEventListener("click", async () => {
      const modal = document.getElementById("modalArchiveWalkInOrder");
      const id = modal?._pendingWalkInId;
      if (!id) return;

      const btn = document.getElementById("btnConfirmArchiveWalkIn");
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Archiving...";
      }

      try {
        await request(`/admin/walkin-orders/${id}/archive`, {
          method: "PATCH",
        });
        state.walkIn = state.walkIn.filter(
          (row) => String(row.id) !== String(id),
        );
        renderAll();
        notifyOrdersRealtimeUpdate({
          type: "walkin-archived",
          walkInId: String(id),
        });
        closeWalkInArchiveModal();
        showPopup("Walk-in order archived successfully.", {
          title: "Archived ✓",
        });
      } catch (error) {
        showPopup(error.message || "Unable to archive walk-in order.", {
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
    const totalPages = Math.max(1, Math.ceil(state.incoming.length / PAGE_SIZE));
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
    const totalPages = Math.max(
      1,
      Math.ceil(getDirectoryRows().length / PAGE_SIZE),
    );
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
    const totalPages = Math.max(
      1,
      Math.ceil(getPaymentRows().length / PAGE_SIZE),
    );
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
    const totalPages = Math.max(1, Math.ceil(state.walkIn.length / PAGE_SIZE));
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
    const totalPages = Math.max(
      1,
      Math.ceil(getRejectedRows().length / PAGE_SIZE),
    );
    if (state.rejectedPage >= totalPages) return;
    state.rejectedPage += 1;
    renderRejectedTable();
  });

  returnsPager.prev?.addEventListener("click", () => {
    if (state.returnsPage <= 1) return;
    state.returnsPage -= 1;
    renderReturnsTable();
  });

  returnsPager.next?.addEventListener("click", () => {
    const totalPages = Math.max(
      1,
      Math.ceil(getReturnRows().length / PAGE_SIZE),
    );
    if (state.returnsPage >= totalPages) return;
    state.returnsPage += 1;
    renderReturnsTable();
  });

  window.AdminPageNumberInput?.bind(incomingPager.pageNumber, {
    getPage: () => state.incomingPage,
    getTotalPages: () =>
      Math.max(1, Math.ceil(state.incoming.length / PAGE_SIZE)),
    onChange: (page) => {
      state.incomingPage = page;
      renderIncomingTable();
    },
  });

  window.AdminPageNumberInput?.bind(directoryPager.pageNumber, {
    getPage: () => state.directoryPage,
    getTotalPages: () =>
      Math.max(1, Math.ceil(getDirectoryRows().length / PAGE_SIZE)),
    onChange: (page) => {
      state.directoryPage = page;
      renderDirectoryTable();
    },
  });

  window.AdminPageNumberInput?.bind(paymentsPager.pageNumber, {
    getPage: () => state.paymentsPage,
    getTotalPages: () =>
      Math.max(1, Math.ceil(getPaymentRows().length / PAGE_SIZE)),
    onChange: (page) => {
      state.paymentsPage = page;
      renderPaymentsTable();
    },
  });

  window.AdminPageNumberInput?.bind(walkInPager.pageNumber, {
    getPage: () => state.walkInPage,
    getTotalPages: () =>
      Math.max(1, Math.ceil(state.walkIn.length / PAGE_SIZE)),
    onChange: (page) => {
      state.walkInPage = page;
      renderWalkInTable();
    },
  });

  window.AdminPageNumberInput?.bind(rejectedPager.pageNumber, {
    getPage: () => state.rejectedPage,
    getTotalPages: () =>
      Math.max(1, Math.ceil(getRejectedRows().length / PAGE_SIZE)),
    onChange: (page) => {
      state.rejectedPage = page;
      renderRejectedTable();
    },
  });

  window.AdminPageNumberInput?.bind(returnsPager.pageNumber, {
    getPage: () => state.returnsPage,
    getTotalPages: () =>
      Math.max(1, Math.ceil(getReturnRows().length / PAGE_SIZE)),
    onChange: (page) => {
      state.returnsPage = page;
      renderReturnsTable();
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

  returnsStatusFilter?.addEventListener("change", () => {
    state.returnsPage = 1;
    renderReturnsTable();
  });

  returnsSearch?.addEventListener("input", () => {
    state.returnsPage = 1;
    renderReturnsTable();
  });

  btnCancelReturnAction?.addEventListener("click", () => {
    if (returnActionDiscardGuard) {
      returnActionDiscardGuard.cancel();
      return;
    }
    closeReturnActionModal();
  });

  btnSubmitReturnAction?.addEventListener("click", () => {
    void submitReturnAction();
  });

  // Section switcher - same behaviour as the Archives page tabs. Guarded so this
  // file keeps working on a page that ships the stack without the chip strip.
  const ordersTabButtons = Array.from(
    document.querySelectorAll("#ordersModuleTabs .archive-tab-btn"),
  );
  if (ordersTabButtons.length) {
    const ordersSections = Array.from(
      document.querySelectorAll(".orders-layout-stack .archive-section"),
    );
    ordersTabButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const tab = String(button.dataset.tab || "");
        ordersTabButtons.forEach((candidate) => {
          candidate.classList.toggle("active", candidate === button);
        });
        ordersSections.forEach((section) => {
          section.classList.toggle(
            "active",
            section.id.toLowerCase() === `section${tab}`.toLowerCase(),
          );
        });
        // A table that was display:none is skipped by the column sizer, so the
        // one that just became visible needs a pass.
        window.AdminTableResize?.refresh?.();
      });
    });
  }

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

    // A bad coordinate would silently drop the checkpoint pin somewhere wrong,
    // so it is rejected here rather than saved and puzzled over later.
    const latitude = readCoordinate(trackingLatitude, -90, 90);
    const longitude = readCoordinate(trackingLongitude, -180, 180);
    if (!latitude.ok || !longitude.ok) {
      showPopup(
        "Check the checkpoint coordinates: latitude must be between -90 and 90, longitude between -180 and 180. Leave both blank if the courier did not give a location.",
        { title: "Invalid Coordinates" },
      );
      (!latitude.ok ? trackingLatitude : trackingLongitude)?.focus();
      return;
    }
    if ((latitude.value === null) !== (longitude.value === null)) {
      showPopup(
        "A checkpoint needs both latitude and longitude, or neither.",
        { title: "Incomplete Coordinates" },
      );
      (latitude.value === null ? trackingLatitude : trackingLongitude)?.focus();
      return;
    }

    const courierName = getSelectedCourierName();
    if (trackingCourierSelect?.value === COURIER_OTHER_KEY && !courierName) {
      showPopup("Type the courier's name, or pick one from the list.", {
        title: "Courier Needed",
      });
      trackingCourierName?.focus();
      return;
    }

    const payload = {
      stage,
      title: trackingEventTitle?.value?.trim() || null,
      description: trackingEventDescription?.value?.trim() || null,
      courier_name: courierName || null,
      courier_tracking_no: trackingCourierNo?.value?.trim() || null,
      location_name: trackingLocationName?.value?.trim() || null,
      latitude: latitude.value,
      longitude: longitude.value,
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

    const returnViewBtn = target.closest("[data-return-view]");
    if (returnViewBtn) {
      const returnId = String(
        returnViewBtn.getAttribute("data-return-view") || "",
      );
      void openReturnDetailsModal(returnId);
      return;
    }

    const returnActionBtn = target.closest("[data-return-action]");
    if (returnActionBtn) {
      const returnId = String(
        returnActionBtn.getAttribute("data-return-action") || "",
      );
      const row =
        state.returnDetailsById.get(returnId) ||
        state.returns.find((item) => String(item?.id) === returnId);
      if (row) {
        openReturnActionModal(
          row,
          String(returnActionBtn.getAttribute("data-return-mode") || ""),
        );
      }
      return;
    }

    const returnArchiveBtn = target.closest("[data-return-archive]");
    if (returnArchiveBtn) {
      const returnId = String(
        returnArchiveBtn.getAttribute("data-return-archive") || "",
      );
      const label = String(
        returnArchiveBtn.getAttribute("data-return-label") || "",
      );
      void archiveReturn(returnId, label);
      return;
    }

    const editWalkInBtn = target.closest("[data-walkin-edit]");
    const viewWalkInBtn = target.closest("[data-walkin-view]");
    const completeWalkInBtn = target.closest("[data-walkin-complete]");
    const archiveWalkInBtn = target.closest("[data-walkin-archive]");
    if (viewWalkInBtn) {
      const id = viewWalkInBtn.getAttribute("data-walkin-view");
      const order = state.walkIn.find((o) => String(o.id) === String(id));
      if (order) {
        openWalkInDetailsModal(order);
      }
      return;
    }

    if (completeWalkInBtn) {
      const id = completeWalkInBtn.getAttribute("data-walkin-complete");
      const order = state.walkIn.find((o) => String(o.id) === String(id));
      openWalkInCompleteModal(id, order?.order_no);
      return;
    }

    if (archiveWalkInBtn) {
      if (archiveWalkInBtn.disabled) return;
      const id = archiveWalkInBtn.getAttribute("data-walkin-archive");
      const order = state.walkIn.find((o) => String(o.id) === String(id));
      openWalkInArchiveModal(id, order?.order_no);
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
  // Fill the tracking modal's courier dropdown before anyone can open it.
  void loadCourierRegistry();
  // Same for the ready-made checkpoints. Both are small config reads, and both
  // fail soft into a still-usable modal.
  void loadCheckpointPresets();

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

  // Open the record a header notification points at. Registered only after the
  // first sync resolves, because the order branch reads `state.ordersById`;
  // returns are fetched by id, so that branch works from any table page.
  const focusOrderFromNotification = (intent) => {
    const orderId = String(intent?.id || "");
    if (!orderId) return false;

    const order = state.ordersById.get(orderId);
    if (!order) {
      const label = intent?.ref ? `Order ${intent.ref}` : "That order";
      showPopup(
        `${label} is no longer in the active order list. It may have been archived or deleted.`,
        { title: "Order Not Found" },
      );
      return true;
    }

    populateOrderDetailsModal(order);
    const row = document.querySelector(`[data-order-view="${orderId}"]`);
    if (row) window.AdminNotifFocus?.flash(row);
    return true;
  };

  const focusReturnFromNotification = (intent) => {
    const returnId = String(intent?.id || "");
    if (!returnId) return false;

    void openReturnDetailsModal(returnId);
    const row = document.querySelector(`[data-return-view="${returnId}"]`);
    if (row) window.AdminNotifFocus?.flash(row);
    return true;
  };

  void syncOrders(true, { force: true, source: "manual" }).finally(() => {
    window.AdminNotifFocus?.onFocus(["order", "return"], (intent) =>
      intent?.kind === "return"
        ? focusReturnFromNotification(intent)
        : focusOrderFromNotification(intent),
    );
  });
});
