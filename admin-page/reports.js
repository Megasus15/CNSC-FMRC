(() => {
  "use strict";

  const REPORT_PAGE_SIZE = 10;
  // Only a fallback. How many detail rows a printed sheet really holds is
  // measured from the rendered sheet (see `measureDetailGroups`); this flat
  // count is used when that measurement cannot run.
  const REPORT_ROWS_PER_SHEET_FALLBACK = 10;
  const REPORT_POLL_INTERVAL_MS = 30_000;
  const REPORT_REQUEST_TIMEOUT_MS = 20_000;
  const SITE_SETTINGS_REQUEST_TIMEOUT_MS = 8_000;
  const REPORT_ASSET_TIMEOUT_MS = 10_000;
  // Cap on the best-effort decode of one letterhead image (see
  // `waitForDocumentAssets`); a hidden tab can leave decode() unsettled.
  const IMAGE_DECODE_BUDGET_MS = 1_500;
  const REPORT_REALTIME_DEBOUNCE_MS = 550;
  // Last-resort restore of the print-only geometry when a browser never fires
  // afterprint and never flips the print media query back. Deliberately longer
  // than any realistic print dialog, including choosing a folder in the
  // Save as PDF flow, so it can never strip the sheets while they are still
  // being measured; it exists only so the page cannot stay print-only forever.
  const PRINT_RESTORE_FALLBACK_MS = 300_000;
  const ORDERS_REALTIME_CHANNEL = "fmrc-orders-realtime";
  const ORDERS_STORAGE_KEY = "fmrc_orders_updated_at";
  const SITE_SETTINGS_REALTIME_CHANNEL = "fmrc-site-settings-realtime";
  const REPORT_TEMPLATE_ASSET_BASE =
    "../admin-page/assets/report-template";
  const REPORT_CONTACT_FALLBACK = Object.freeze({
    email: "cnscfmrc@gmail.com",
    phone: "0909-099-0000",
  });
  // Every editable text line of the official UCN letterhead, in editor order.
  // One list drives the defaults, the rendered header/footer, the Edit
  // Letterhead modal and the CSV export, so the four can never drift apart.
  // `setting` is the site_settings key; blank stored values fall back to
  // `value`, which is the official template wording.
  const REPORT_LETTERHEAD_FIELDS = Object.freeze([
    {
      key: "republic",
      setting: "report_letterhead_republic",
      group: "Header · University",
      label: "Republic line",
      value: "Republic of the Philippines",
      max: 90,
    },
    {
      key: "university",
      setting: "report_letterhead_university",
      group: "Header · University",
      label: "University name",
      value: "UNIVERSITY OF CAMARINES NORTE",
      max: 90,
    },
    {
      key: "formerName",
      setting: "report_letterhead_former_name",
      group: "Header · University",
      label: "Former name line",
      value: "(formerly Camarines Norte State College)",
      max: 90,
    },
    {
      key: "address",
      setting: "report_letterhead_address",
      group: "Header · University",
      label: "Address line",
      value:
        "F. Pimentel Ave., Brgy. II, Daet, Camarines Norte – 4600, Philippines",
      max: 140,
    },
    {
      key: "website",
      setting: "report_letterhead_website",
      group: "Header · Contacts",
      label: "Website",
      value: "https://www.ucn.edu.ph",
      max: 90,
    },
    {
      key: "email",
      setting: "report_letterhead_email",
      group: "Header · Contacts",
      label: "Email",
      value: "president@ucn.edu.ph",
      max: 90,
    },
    {
      key: "facebook",
      setting: "report_letterhead_facebook",
      group: "Header · Contacts",
      label: "Facebook page",
      value: "https://www.facebook.com/UCNofficial",
      max: 120,
    },
    {
      key: "unitName",
      setting: "report_letterhead_unit_name",
      group: "Header · Issuing unit",
      label: "Unit name",
      value: "FABRICATION AND MANUFACTURING RESEARCH CENTER",
      max: 90,
    },
    {
      key: "unitContact",
      setting: "report_letterhead_unit_contact",
      group: "Header · Issuing unit",
      label: "Unit contact line",
      value: "",
      max: 120,
      contactFallback: true,
      hint: "Leave blank to use the contact email and phone from Website Contact.",
    },
    {
      key: "qmsTitle",
      setting: "report_letterhead_qms_title",
      group: "Footer · ISO certification",
      label: "Line 1 (bold)",
      value: "Quality Management System",
      max: 60,
    },
    {
      key: "qmsStandard",
      setting: "report_letterhead_qms_standard",
      group: "Footer · ISO certification",
      label: "Line 2",
      value: "ISO 9001:2015 Certified",
      max: 60,
    },
    {
      key: "certificateLabel",
      setting: "report_letterhead_certificate_label",
      group: "Footer · ISO certification",
      label: "Line 3 (small)",
      value: "Certificate Registration",
      max: 60,
    },
    {
      key: "certificateNo",
      setting: "report_letterhead_certificate_no",
      group: "Footer · ISO certification",
      label: "Certificate number",
      value: "01 100 1834850",
      max: 40,
    },
    {
      key: "pqaTitle",
      setting: "report_letterhead_pqa_title",
      group: "Footer · Philippine Quality Award",
      label: "Line 1 (bold)",
      value: "Philippine Quality Award",
      max: 60,
    },
    {
      key: "pqaLineOne",
      setting: "report_letterhead_pqa_line_one",
      group: "Footer · Philippine Quality Award",
      label: "Line 2",
      value: "Recognition for Commitment in",
      max: 60,
    },
    {
      key: "pqaLineTwo",
      setting: "report_letterhead_pqa_line_two",
      group: "Footer · Philippine Quality Award",
      label: "Line 3",
      value: "Quality Management",
      max: 60,
    },
    {
      key: "pqaNote",
      setting: "report_letterhead_pqa_note",
      group: "Footer · Philippine Quality Award",
      label: "Line 4 (small)",
      value: "Main Campus",
      max: 40,
    },
    {
      key: "primeTitle",
      setting: "report_letterhead_prime_title",
      group: "Footer · PRIME-HRM",
      label: "Line 1 (bold)",
      value: "PRIME - HRM",
      max: 60,
    },
    {
      key: "primeLevel",
      setting: "report_letterhead_prime_level",
      group: "Footer · PRIME-HRM",
      label: "Line 2",
      value: "Maturity Level II",
      max: 60,
    },
    {
      key: "primeNote",
      setting: "report_letterhead_prime_note",
      group: "Footer · PRIME-HRM",
      label: "Line 3 (small)",
      value: "Bronze Award",
      max: 40,
    },
    {
      key: "documentCode",
      setting: "report_letterhead_document_code",
      group: "Footer · Document control",
      label: "Form code",
      value: "CNSC-SP-QMS-05F5",
      max: 40,
    },
    {
      key: "revision",
      setting: "report_letterhead_revision",
      group: "Footer · Document control",
      label: "Revision",
      value: "1",
      max: 20,
    },
    {
      key: "preparedByName",
      setting: "report_letterhead_prepared_by_name",
      group: "Certification · Signatories",
      label: "Prepared by (name)",
      value: "",
      max: 80,
      hint: "Leave blank to print the account that generated the report.",
    },
    {
      key: "preparedByPosition",
      setting: "report_letterhead_prepared_by_position",
      group: "Certification · Signatories",
      label: "Prepared by (position)",
      value: "FMRC Records Officer",
      max: 80,
    },
    {
      key: "reviewedByName",
      setting: "report_letterhead_reviewed_by_name",
      group: "Certification · Signatories",
      label: "Reviewed by (name)",
      value: "",
      max: 80,
    },
    {
      key: "reviewedByPosition",
      setting: "report_letterhead_reviewed_by_position",
      group: "Certification · Signatories",
      label: "Reviewed by (position)",
      value: "FMRC Coordinator",
      max: 80,
    },
    {
      key: "approvedByName",
      setting: "report_letterhead_approved_by_name",
      group: "Certification · Signatories",
      label: "Approved by (name)",
      value: "",
      max: 80,
    },
    {
      key: "approvedByPosition",
      setting: "report_letterhead_approved_by_position",
      group: "Certification · Signatories",
      label: "Approved by (position)",
      value: "Center Director",
      max: 80,
    },
  ]);
  const REPORT_LETTERHEAD_DEFAULTS = Object.freeze(
    Object.fromEntries(
      REPORT_LETTERHEAD_FIELDS.map((field) => [field.key, field.value]),
    ),
  );
  const ORDER_DRIVEN_CATEGORIES = new Set([
    "sales",
    "completed_orders",
    "processing_orders",
    "inventory",
  ]);
  const CATEGORY_LABELS = {
    sales: "Overall Sales",
    completed_orders: "Completed Orders",
    processing_orders: "Processing Orders",
    appointments: "Appointments",
    inventory: "Inventory Stocks",
  };
  const SERIES_COLORS = [
    "#800000",
    "#d49a16",
    "#2777ad",
    "#2f8b57",
    "#7a55a3",
    "#c65f32",
  ];

  const resolveApiBaseUrl = () => {
    const configured =
      window.APP_API_BASE_URL ||
      document
        .querySelector('meta[name="api-base-url"]')
        ?.getAttribute("content") ||
      "";
    if (configured.trim()) return configured.trim().replace(/\/+$/, "");

    const { protocol, hostname, port } = window.location;
    if (port === "8000") return `${protocol}//${hostname}:${port}/api`;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return `${protocol}//${hostname}:8000/api`;
    }
    return `${protocol}//${hostname}/api`;
  };

  const API_BASE_URL = resolveApiBaseUrl();
  const currencyFormatter = new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const integerFormatter = new Intl.NumberFormat("en-PH", {
    maximumFractionDigits: 0,
  });
  const decimalFormatter = new Intl.NumberFormat("en-PH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  const dateFormatter = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

  const asArray = (value) => (Array.isArray(value) ? value : []);

  const asDisplayText = (value, fallback = "—") => {
    if (value === null || value === undefined || value === "") return fallback;
    if (typeof value === "object") {
      return String(
        value.name || value.email || value.label || value.title || fallback,
      );
    }
    return String(value);
  };

  const asFiniteNumber = (value) => {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    const normalized = String(value ?? "")
      .replace(/[^0-9+\-.]/g, "")
      .trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const normalizeType = (value) => String(value || "text").toLowerCase();

  const formatDateValue = (value, includeTime = false) => {
    if (value === null || value === undefined || value === "") return "—";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return includeTime
      ? dateTimeFormatter.format(parsed)
      : dateFormatter.format(parsed);
  };

  const formatValue = (value, type = "text") => {
    if (value === null || value === undefined || value === "") return "—";

    const normalizedType = normalizeType(type);
    if (["currency", "money", "amount", "sales"].includes(normalizedType)) {
      return currencyFormatter.format(asFiniteNumber(value));
    }
    if (["integer", "count", "quantity"].includes(normalizedType)) {
      return integerFormatter.format(asFiniteNumber(value));
    }
    if (["number", "decimal"].includes(normalizedType)) {
      return decimalFormatter.format(asFiniteNumber(value));
    }
    if (["percent", "percentage"].includes(normalizedType)) {
      return `${decimalFormatter.format(asFiniteNumber(value))}%`;
    }
    if (normalizedType === "date") return formatDateValue(value, false);
    if (["datetime", "date_time", "timestamp"].includes(normalizedType)) {
      return formatDateValue(value, true);
    }
    if (normalizedType === "boolean") return value ? "Yes" : "No";
    if (typeof value === "number") return decimalFormatter.format(value);
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch {
        return asDisplayText(value);
      }
    }
    return String(value);
  };

  const metricIcon = (key, label) => {
    const value = `${key || ""} ${label || ""}`.toLowerCase();
    if (/(revenue|sales|amount|value|total paid)/.test(value)) {
      return "fa-solid fa-peso-sign";
    }
    if (/(appointment|schedule|booking)/.test(value)) {
      return "fa-regular fa-calendar-check";
    }
    if (/(inventory|stock|item|material)/.test(value)) {
      return "fa-solid fa-boxes-stacked";
    }
    if (/(complete|fulfilled|done)/.test(value)) {
      return "fa-solid fa-circle-check";
    }
    if (/(process|pending|progress)/.test(value)) {
      return "fa-solid fa-gears";
    }
    if (/(order|transaction)/.test(value)) return "fa-solid fa-box-open";
    if (/(percent|rate|share)/.test(value)) return "fa-solid fa-percent";
    return "fa-solid fa-chart-column";
  };

  const statusClass = (value) => {
    const status = String(value || "").toLowerCase();
    if (/(complete|completed|paid|done|good|available|approved|success)/.test(status)) {
      return "status-green";
    }
    if (/(process|processing|progress|scheduled|active|confirmed)/.test(status)) {
      return "status-blue";
    }
    if (/(pending|incoming|low|warning|review|reserved)/.test(status)) {
      return "status-yellow";
    }
    if (/(cancel|rejected|failed|out of stock|critical|overdue)/.test(status)) {
      return "status-red";
    }
    return "status-blue";
  };

  const renderFormattedCell = (value, type) => {
    const normalizedType = normalizeType(type);
    const formatted = formatValue(value, normalizedType);
    if (normalizedType === "status") {
      return `<span class="status-pill ${statusClass(value)}">${escapeHtml(formatted)}</span>`;
    }
    return escapeHtml(formatted);
  };

  const normalizeReportPayload = (payload) => {
    const source =
      payload?.data && typeof payload.data === "object" && !Array.isArray(payload.data)
        ? payload.data
        : payload || {};
    const report =
      source.report && typeof source.report === "object" ? source.report : {};

    let metrics = source.metrics;
    if (!Array.isArray(metrics) && metrics && typeof metrics === "object") {
      metrics = Object.entries(metrics).map(([key, value]) => ({
        key,
        label: key.replace(/_/g, " "),
        value,
        format: "number",
      }));
    }
    metrics = asArray(metrics).map((metric, index) => ({
      key: String(metric?.key || `metric_${index + 1}`),
      label: asDisplayText(metric?.label, `Metric ${index + 1}`),
      value: metric?.value,
      format: normalizeType(metric?.format || "number"),
    }));

    const chartSource =
      source.chart && typeof source.chart === "object" ? source.chart : {};
    const labels = asArray(chartSource.labels).map((label) => asDisplayText(label));
    const chartSeries = asArray(chartSource.series).map((series, index) => ({
      name: asDisplayText(series?.name, `Series ${index + 1}`),
      values: labels.map((_, labelIndex) =>
        asFiniteNumber(asArray(series?.values)[labelIndex]),
      ),
    }));

    const breakdownSource =
      source.breakdown && typeof source.breakdown === "object"
        ? source.breakdown
        : {};
    const breakdownItems = asArray(breakdownSource.items).map((item) => ({
      label: asDisplayText(item?.label),
      value: item?.value,
    }));

    const tableSource =
      source.table && typeof source.table === "object" ? source.table : {};
    const rows = asArray(tableSource.rows).filter(
      (row) => row && typeof row === "object" && !Array.isArray(row),
    );
    let columns = asArray(tableSource.columns)
      .filter((column) => column && column.key)
      .map((column) => ({
        key: String(column.key),
        label: asDisplayText(column.label, String(column.key).replace(/_/g, " ")),
        type: normalizeType(column.type || "text"),
      }));
    if (!columns.length && rows.length) {
      columns = Object.keys(rows[0]).map((key) => ({
        key,
        label: key.replace(/_/g, " "),
        type: "text",
      }));
    }

    return {
      report: {
        id: asDisplayText(report.id, "Not assigned"),
        title: asDisplayText(report.title, "Generated Report"),
        category: String(report.category || ""),
        period: String(report.period || ""),
        period_label: asDisplayText(report.period_label, "Selected period"),
        start_date: report.start_date || "",
        end_date: report.end_date || "",
        timezone: asDisplayText(report.timezone, "Asia/Manila"),
        generated_at: report.generated_at || new Date().toISOString(),
        generated_by: asDisplayText(report.generated_by, "System user"),
        generated_by_role: asDisplayText(report.generated_by_role, ""),
      },
      metrics,
      chart: {
        title: asDisplayText(chartSource.title, "Report Trend"),
        value_type: normalizeType(chartSource.value_type || "number"),
        labels,
        series: chartSeries,
      },
      breakdown: {
        title: asDisplayText(breakdownSource.title, "Report Breakdown"),
        value_type: normalizeType(breakdownSource.value_type || "number"),
        items: breakdownItems,
      },
      table: {
        title: asDisplayText(tableSource.title, "Report Details"),
        columns,
        rows,
      },
    };
  };

  const getPhilippineDateParts = () => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "numeric",
    }).formatToParts(new Date());
    const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
      year: Number.parseInt(lookup.year, 10) || new Date().getFullYear(),
      month: Number.parseInt(lookup.month, 10) || new Date().getMonth() + 1,
    };
  };

  // One paint tick, used between building a sheet and measuring it. Browsers
  // stop firing requestAnimationFrame while the tab is hidden, so awaiting a
  // bare rAF can park the whole pagination pass - and with it the print flow -
  // until the tab comes back. Race it against a short timer instead: the
  // measurements that follow read layout properties, which force the layout
  // to flush on their own, so a tick without an actual paint still measures
  // correctly.
  const PAINT_TICK_FALLBACK_MS = 40;
  const nextPaint = () =>
    new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve();
      };
      const timer = window.setTimeout(finish, PAINT_TICK_FALLBACK_MS);
      window.requestAnimationFrame(finish);
    });

  const init = () => {
    const elements = {
      categoryButtons: Array.from(
        document.querySelectorAll("[data-report-category]"),
      ),
      period: document.getElementById("reportPeriodSelect"),
      year: document.getElementById("reportYearSelect"),
      month: document.getElementById("reportMonthSelect"),
      quarter: document.getElementById("reportQuarterSelect"),
      monthControl: document.getElementById("reportMonthControl"),
      quarterControl: document.getElementById("reportQuarterControl"),
      generate: document.getElementById("reportGenerateBtn"),
      refresh: document.getElementById("reportRefreshBtn"),
      lastUpdated: document.getElementById("reportLastUpdated"),
      selectionSummary: document.getElementById("reportSelectionSummary"),
      pageMessage: document.getElementById("reportPageMessage"),
      resultBanner: document.getElementById("reportResultBanner"),
      resultTitle: document.getElementById("reportResultTitle"),
      resultPeriod: document.getElementById("reportResultPeriod"),
      resultMeta: document.getElementById("reportResultMeta"),
      metrics: document.getElementById("reportMetrics"),
      chartTitle: document.getElementById("reportChartTitle"),
      chart: document.getElementById("reportChart"),
      breakdownTitle: document.getElementById("reportBreakdownTitle"),
      breakdown: document.getElementById("reportBreakdown"),
      tableTitle: document.getElementById("reportTableTitle"),
      tableSubtitle: document.getElementById("reportTableSubtitle"),
      table: document.getElementById("reportDataTable"),
      tableHead: document.getElementById("reportTableHead"),
      tableBody: document.getElementById("reportTableBody"),
      tableMeta: document.getElementById("reportTableMeta"),
      pageNumber: document.getElementById("reportPageNumber"),
      prevPage: document.getElementById("reportPrevPage"),
      nextPage: document.getElementById("reportNextPage"),
      preview: document.getElementById("reportPreviewBtn"),
      csv: document.getElementById("reportExportCsvBtn"),
      previewModal: document.getElementById("reportPreviewModal"),
      previewTitle: document.getElementById("reportPreviewTitle"),
      previewContent: document.getElementById("reportPreviewContent"),
      previewCloseIcon: document.getElementById("reportPreviewCloseIcon"),
      previewClose: document.getElementById("reportPreviewCloseBtn"),
      print: document.getElementById("reportPrintBtn"),
      letterheadBtn: document.getElementById("reportLetterheadBtn"),
      letterheadModal: document.getElementById("reportLetterheadModal"),
      letterheadFields: document.getElementById("reportLetterheadFields"),
      letterheadError: document.getElementById("reportLetterheadError"),
      letterheadReset: document.getElementById("reportLetterheadResetBtn"),
      letterheadCancel: document.getElementById("reportLetterheadCancelBtn"),
      letterheadCloseIcon: document.getElementById("reportLetterheadCloseIcon"),
      letterheadSave: document.getElementById("reportLetterheadSaveBtn"),
    };

    if (
      !elements.period ||
      !elements.year ||
      !elements.generate ||
      !elements.metrics ||
      !elements.tableBody
    ) {
      return;
    }

    const state = {
      selectedCategory: "sales",
      activeParams: null,
      auditedReport: null,
      reportData: null,
      currentPage: 1,
      isLoading: false,
      lastGoodSyncAt: 0,
      pollTimer: 0,
      realtimeTimer: 0,
      ordersChannel: null,
      siteSettingsChannel: null,
      letterhead: { ...REPORT_LETTERHEAD_DEFAULTS },
      letterheadStored: {},
      letterheadPromise: null,
      letterheadSaving: false,
      letterheadFormBuilt: false,
      letterheadPreviousFocus: null,
      previousFocus: null,
      deferredFocusRestore: null,
      previewScrollLock: null,
      previewTouchStartedInside: false,
    };

    const getToken = () =>
      window.AdminSession?.getToken?.() ||
      localStorage.getItem("auth_token") ||
      "";

    const setButtonPending = (button, active, label) => {
      if (!button) return;
      if (active) {
        if (!button.dataset.reportOriginalHtml) {
          button.dataset.reportOriginalHtml = button.innerHTML;
        }
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>${escapeHtml(label)}</span>`;
        return;
      }

      if (button.dataset.reportOriginalHtml) {
        button.innerHTML = button.dataset.reportOriginalHtml;
        delete button.dataset.reportOriginalHtml;
      }
      button.removeAttribute("aria-busy");
      button.disabled = false;
    };

    const syncActionButtons = () => {
      const isPending = (button) => button?.getAttribute("aria-busy") === "true";
      if (elements.generate) {
        elements.generate.disabled = state.isLoading || isPending(elements.generate);
      }
      if (elements.refresh) {
        elements.refresh.disabled = state.isLoading || isPending(elements.refresh);
      }
      if (elements.preview) {
        elements.preview.disabled =
          !state.reportData || isPending(elements.preview);
      }
      if (elements.csv) {
        elements.csv.disabled = !state.reportData || isPending(elements.csv);
      }
    };

    const showPageMessage = (message, type = "warning") => {
      if (!elements.pageMessage) return;
      elements.pageMessage.hidden = false;
      elements.pageMessage.classList.toggle("is-error", type === "error");
      const icon = type === "error" ? "fa-circle-exclamation" : "fa-triangle-exclamation";
      elements.pageMessage.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i><span>${escapeHtml(message)}</span>`;
    };

    const hidePageMessage = () => {
      if (!elements.pageMessage) return;
      elements.pageMessage.hidden = true;
      elements.pageMessage.classList.remove("is-error");
      elements.pageMessage.textContent = "";
    };

    const surfaceState = (message, icon = "fa-chart-column", type = "") =>
      `<div class="report-surface-state${type ? ` ${type}` : ""}"><i class="fa-solid ${icon}" aria-hidden="true"></i><span>${escapeHtml(message)}</span></div>`;

    const renderLoadingState = () => {
      if (state.reportData) return;
      elements.metrics.setAttribute("aria-busy", "true");
      elements.metrics.innerHTML = Array.from(
        { length: 4 },
        () => `
          <div class="report-loading-card" aria-hidden="true">
            <div class="report-loading-lines">
              <span class="report-loading-line"></span>
              <span class="report-loading-line"></span>
            </div>
          </div>`,
      ).join("");
      elements.chart.innerHTML = surfaceState(
        "Loading report trend…",
        "fa-spinner fa-spin",
      );
      elements.breakdown.innerHTML = surfaceState(
        "Loading report breakdown…",
        "fa-spinner fa-spin",
      );
      elements.tableHead.innerHTML = "<tr><th>Report data</th></tr>";
      elements.tableBody.innerHTML = `
        <tr class="table-empty-row">
          <td><div class="table-empty-state"><i class="fa-solid fa-spinner fa-spin"></i><span>Loading report records…</span></div></td>
        </tr>`;
      elements.tableMeta.textContent = "Loading report data…";
      elements.pageNumber.value = "1";
      elements.pageNumber.max = "1";
      elements.prevPage.disabled = true;
      elements.nextPage.disabled = true;
      syncActionButtons();
    };

    const renderInitialError = (message) => {
      elements.metrics.setAttribute("aria-busy", "false");
      elements.metrics.innerHTML = surfaceState(
        message,
        "fa-circle-exclamation",
        "is-error",
      );
      elements.chart.innerHTML = surfaceState(
        "Trend data is unavailable.",
        "fa-chart-column",
        "is-error",
      );
      elements.breakdown.innerHTML = surfaceState(
        "Breakdown data is unavailable.",
        "fa-list",
        "is-error",
      );
      elements.tableHead.innerHTML = "<tr><th>Report data</th></tr>";
      elements.tableBody.innerHTML = `
        <tr class="table-empty-row">
          <td><div class="table-empty-state"><i class="fa-solid fa-circle-exclamation"></i><span>${escapeHtml(message)}</span></div></td>
        </tr>`;
      elements.tableMeta.textContent = "Page 1 of 1";
      elements.resultBanner.hidden = true;
      syncActionButtons();
    };

    const readFilterParams = () => {
      const period = ["monthly", "quarterly", "yearly"].includes(
        elements.period.value,
      )
        ? elements.period.value
        : "monthly";
      const currentParts = getPhilippineDateParts();
      const year = Number.parseInt(elements.year.value, 10) || currentParts.year;
      const params = {
        category: state.selectedCategory,
        period,
        year,
      };
      if (period === "monthly") {
        params.month = Number.parseInt(elements.month.value, 10) || currentParts.month;
      }
      if (period === "quarterly") {
        params.quarter = Number.parseInt(elements.quarter.value, 10) || 1;
      }
      return params;
    };

    const reportFilterKey = (params = {}) =>
      [
        String(params.category || ""),
        String(params.period || ""),
        String(params.year || ""),
        params.period === "monthly" ? String(params.month || "") : "",
        params.period === "quarterly" ? String(params.quarter || "") : "",
      ].join("|");

    const copyReportFilters = (params = {}) => {
      const filters = {
        category: params.category,
        period: params.period,
        year: params.year,
      };
      if (params.period === "monthly") filters.month = params.month;
      if (params.period === "quarterly") filters.quarter = params.quarter;
      return filters;
    };

    const periodSelectionLabel = (params) => {
      if (params.period === "monthly") {
        const monthName = elements.month.options[elements.month.selectedIndex]?.text || "Month";
        return `${monthName} ${params.year}`;
      }
      if (params.period === "quarterly") return `Quarter ${params.quarter}, ${params.year}`;
      return `Year ${params.year}`;
    };

    const updateSelectionSummary = () => {
      const params = readFilterParams();
      const category = CATEGORY_LABELS[params.category] || "Report";
      const period = params.period.charAt(0).toUpperCase() + params.period.slice(1);
      elements.selectionSummary.textContent = `${category} · ${period} · ${periodSelectionLabel(params)}`;
    };

    const syncPeriodControls = () => {
      const period = elements.period.value;
      const showMonth = period === "monthly";
      const showQuarter = period === "quarterly";
      elements.monthControl.hidden = !showMonth;
      elements.month.disabled = !showMonth;
      elements.quarterControl.hidden = !showQuarter;
      elements.quarter.disabled = !showQuarter;
      updateSelectionSummary();
    };

    const buildChartMarkup = (chart) => {
      const labels = asArray(chart?.labels);
      const series = asArray(chart?.series);
      if (!labels.length || !series.length) {
        return surfaceState(
          "No chart data is available for this report period.",
          "fa-chart-column",
        );
      }

      const allValues = series.flatMap((entry) => asArray(entry.values));
      const maxValue = Math.max(1, ...allValues.map((value) => Math.abs(asFiniteNumber(value))));
      const legend = series
        .map((entry, index) => {
          const color = SERIES_COLORS[index % SERIES_COLORS.length];
          return `<span class="report-chart-legend-item"><span class="report-chart-swatch" style="--report-series-color:${color}"></span>${escapeHtml(entry.name)}</span>`;
        })
        .join("");

      const groups = labels
        .map((label, labelIndex) => {
          const bars = series
            .map((entry, seriesIndex) => {
              const rawValue = asFiniteNumber(entry.values[labelIndex]);
              const height = Math.max(0, Math.min(100, (Math.abs(rawValue) / maxValue) * 100));
              const color = SERIES_COLORS[seriesIndex % SERIES_COLORS.length];
              const accessibleLabel = `${label}, ${entry.name}: ${formatValue(rawValue, chart.value_type)}`;
              return `<span class="report-chart-bar${rawValue === 0 ? " is-zero" : ""}" role="img" tabindex="0" aria-label="${escapeHtml(accessibleLabel)}" title="${escapeHtml(accessibleLabel)}" style="--report-series-color:${color};--report-bar-height:${height.toFixed(2)}%"></span>`;
            })
            .join("");
          return `<div class="report-chart-group"><div class="report-chart-bars" style="--report-series-count:${series.length}">${bars}</div><span class="report-chart-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span></div>`;
        })
        .join("");

      const accessibleItems = labels
        .map((label, labelIndex) => {
          const values = series
            .map(
              (entry) =>
                `${entry.name}: ${formatValue(entry.values[labelIndex], chart.value_type)}`,
            )
            .join("; ");
          return `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(values)}</li>`;
        })
        .join("");

      return `
        <div class="report-chart-legend" aria-hidden="true">${legend}</div>
        <div class="report-chart-viewport">
          <div class="report-bar-chart" style="--report-point-count:${labels.length}">
            <div class="report-chart-groups">${groups}</div>
          </div>
        </div>
        <div class="admin-loading-sr-only" role="group" aria-label="${escapeHtml(chart.title)} data">
          <p>${escapeHtml(chart.title)}</p>
          <ul>${accessibleItems}</ul>
        </div>`;
    };

    const renderMetrics = (metrics) => {
      elements.metrics.setAttribute("aria-busy", "false");
      if (!metrics.length) {
        elements.metrics.innerHTML = surfaceState(
          "No summary metrics are available for this report period.",
          "fa-chart-simple",
        );
        return;
      }
      elements.metrics.innerHTML = metrics
        .map(
          (metric) => `
            <article class="report-metric-card">
              <span class="report-metric-icon" aria-hidden="true"><i class="${metricIcon(metric.key, metric.label)}"></i></span>
              <div class="report-metric-copy">
                <strong class="report-metric-value">${escapeHtml(formatValue(metric.value, metric.format))}</strong>
                <span class="report-metric-label">${escapeHtml(metric.label)}</span>
              </div>
            </article>`,
        )
        .join("");
    };

    const renderBreakdown = (breakdown) => {
      elements.breakdownTitle.textContent = breakdown.title;
      if (!breakdown.items.length) {
        elements.breakdown.innerHTML = surfaceState(
          "No breakdown data is available for this report period.",
          "fa-list",
        );
        return;
      }

      const maxValue = Math.max(
        1,
        ...breakdown.items.map((item) => Math.abs(asFiniteNumber(item.value))),
      );
      elements.breakdown.innerHTML = breakdown.items
        .map((item) => {
          const width = Math.max(
            0,
            Math.min(100, (Math.abs(asFiniteNumber(item.value)) / maxValue) * 100),
          );
          return `
            <div class="report-breakdown-item">
              <div class="report-breakdown-copy">
                <span class="report-breakdown-label" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</span>
                <strong class="report-breakdown-value">${escapeHtml(formatValue(item.value, breakdown.value_type))}</strong>
              </div>
              <div class="report-breakdown-track" aria-hidden="true">
                <span class="report-breakdown-fill" style="--report-breakdown-width:${width.toFixed(2)}%"></span>
              </div>
            </div>`;
        })
        .join("");
    };

    const renderTablePage = () => {
      const tableData = state.reportData?.table || {
        columns: [],
        rows: [],
      };
      const columns = tableData.columns;
      const rows = tableData.rows;
      const columnCount = Math.max(1, columns.length);
      const totalPages = Math.max(1, Math.ceil(rows.length / REPORT_PAGE_SIZE));
      state.currentPage = Math.max(1, Math.min(state.currentPage, totalPages));
      const start = (state.currentPage - 1) * REPORT_PAGE_SIZE;
      const visibleRows = rows.slice(start, start + REPORT_PAGE_SIZE);

      elements.tableHead.innerHTML = columns.length
        ? `<tr>${columns.map((column) => `<th scope="col">${escapeHtml(column.label)}</th>`).join("")}</tr>`
        : "<tr><th scope=\"col\">Report data</th></tr>";

      if (!visibleRows.length) {
        elements.tableBody.innerHTML = `
          <tr class="table-empty-row">
            <td colspan="${columnCount}">
              <div class="table-empty-state"><i class="fa-regular fa-folder-open"></i><span>No records found for this report period.</span></div>
            </td>
          </tr>`;
      } else {
        elements.tableBody.innerHTML = visibleRows
          .map(
            (row) => `<tr>${columns
              .map(
                (column) => `<td data-cell-type="${escapeHtml(column.type)}">${renderFormattedCell(row[column.key], column.type)}</td>`,
              )
              .join("")}</tr>`,
          )
          .join("");
      }

      const firstShown = rows.length ? start + 1 : 0;
      const lastShown = Math.min(start + REPORT_PAGE_SIZE, rows.length);
      elements.tableMeta.textContent = `Page ${state.currentPage} of ${totalPages} · Showing ${firstShown}–${lastShown} of ${rows.length} records`;
      elements.pageNumber.value = String(state.currentPage);
      elements.pageNumber.max = String(totalPages);
      elements.prevPage.disabled = state.currentPage <= 1;
      elements.nextPage.disabled = state.currentPage >= totalPages;
    };

    const renderResultHeader = (report) => {
      elements.resultBanner.hidden = false;
      elements.resultTitle.textContent = report.title;
      const dateRange =
        report.start_date && report.end_date
          ? `${formatDateValue(report.start_date)} – ${formatDateValue(report.end_date)}`
          : report.period_label;
      elements.resultPeriod.textContent = `${report.period_label} · ${dateRange}`;
      elements.resultMeta.innerHTML = `
        <div><dt>Report ID</dt><dd>${escapeHtml(report.id)}</dd></div>
        <div><dt>Generated by</dt><dd>${escapeHtml(report.generated_by)}</dd></div>
        <div><dt>Time zone</dt><dd>${escapeHtml(report.timezone)}</dd></div>`;
    };

    const renderReport = (options = {}) => {
      if (!state.reportData) return;
      const data = state.reportData;
      renderResultHeader(data.report);
      renderMetrics(data.metrics);
      elements.chartTitle.textContent = data.chart.title;
      elements.chart.innerHTML = buildChartMarkup(data.chart);
      renderBreakdown(data.breakdown);
      elements.tableTitle.textContent = data.table.title;
      elements.tableSubtitle.textContent = `Up to 10 records are shown per page · ${data.table.rows.length} total record${data.table.rows.length === 1 ? "" : "s"}.`;
      renderTablePage();
      syncActionButtons();
      if (
        options.refreshPreview !== false &&
        elements.previewModal?.classList.contains("show")
      ) {
        void refreshPreviewSnapshot(true).catch(showPreviewRefreshError);
      }
    };

    const createGenerationKey = () => {
      if (typeof window.crypto?.randomUUID === "function") {
        return window.crypto.randomUUID();
      }
      const random = window.crypto?.getRandomValues
        ? Array.from(window.crypto.getRandomValues(new Uint32Array(2)))
            .map((value) => value.toString(36))
            .join("")
        : Math.random().toString(36).slice(2);
      return `report-${Date.now().toString(36)}-${random}`;
    };

    const requestReport = async (params, source = "refresh") => {
      const token = getToken();
      if (!token) {
        const error = new Error("Please sign in again to access live reports.");
        error.status = 401;
        throw error;
      }

      const query = new URLSearchParams({
        category: params.category,
        period: params.period,
        year: String(params.year),
      });
      if (params.period === "monthly") query.set("month", String(params.month));
      if (params.period === "quarterly") {
        query.set("quarter", String(params.quarter));
      }

      const controller = new AbortController();
      const timeoutId = window.setTimeout(
        () => controller.abort(),
        REPORT_REQUEST_TIMEOUT_MS,
      );
      let response;
      let payload = {};
      const isIntentionalGeneration = source === "generate";
      const requestUrl = isIntentionalGeneration
        ? `${API_BASE_URL}/admin/reports/generate`
        : `${API_BASE_URL}/admin/reports?${query.toString()}`;
      const requestBody = isIntentionalGeneration
        ? JSON.stringify({
            category: params.category,
            period: params.period,
            year: params.year,
            month: params.period === "monthly" ? params.month : null,
            quarter: params.period === "quarterly" ? params.quarter : null,
            generation_key: params.generationKey,
          })
        : undefined;
      try {
        response = await fetch(requestUrl, {
          method: isIntentionalGeneration ? "POST" : "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
            ...(isIntentionalGeneration
              ? { "Content-Type": "application/json" }
              : {}),
          },
          body: requestBody,
          cache: "no-store",
          signal: controller.signal,
        });
        payload = await response.json().catch(() => ({}));
      } catch (error) {
        if (error?.name === "AbortError") {
          throw new Error("The reports request timed out. Please try again.");
        }
        throw error;
      } finally {
        window.clearTimeout(timeoutId);
      }

      if (!response.ok) {
        const error = new Error(
          payload?.message || "Unable to load this report from the server.",
        );
        error.status = response.status;
        error.code = payload?.code || payload?.error?.code || "";
        throw error;
      }
      return normalizeReportPayload(payload);
    };

    const loadReport = async (params, source = "refresh") => {
      if (state.isLoading) return false;
      state.isLoading = true;
      const hadGoodData = Boolean(state.reportData);
      const initiatingButton =
        source === "generate"
          ? elements.generate
          : source === "refresh"
            ? elements.refresh
            : null;
      const pendingText = source === "generate" ? "Generating…" : "Refreshing…";

      setButtonPending(initiatingButton, true, pendingText);
      syncActionButtons();
      if (!hadGoodData) renderLoadingState();

      try {
        const data = await requestReport(params, source);
        const synchronizedAt =
          data.report.generated_at || new Date().toISOString();
        const filterKey = reportFilterKey(params);
        if (source === "generate") {
          state.auditedReport = {
            filterKey,
            metadata: {
              id: data.report.id,
              generated_at: data.report.generated_at,
              generated_by: data.report.generated_by,
              generated_by_role: data.report.generated_by_role,
            },
          };
        } else if (state.auditedReport?.filterKey === filterKey) {
          // Polling and Refresh update the live figures without inventing a
          // second, non-audited identity for the generated document.
          data.report = {
            ...data.report,
            ...state.auditedReport.metadata,
          };
        }
        state.reportData = data;
        state.activeParams = copyReportFilters(params);
        state.currentPage = 1;
        state.lastGoodSyncAt = Date.now();
        window.AdminLiveData?.setAvailability?.("reports-data", true);
        hidePageMessage();
        renderReport();
        elements.lastUpdated.textContent = formatDateValue(synchronizedAt, true);
        elements.lastUpdated.dateTime = String(synchronizedAt);

        if (source === "generate") {
          window.dispatchEvent(
            new CustomEvent("fmrc:reports-updated", {
              detail: {
                type: "generated",
                reportId: data.report.id,
                generatedAt: data.report.generated_at,
              },
            }),
          );
          window.showAdminSuccessNotification?.(
            `${data.report.title} generated successfully.`,
            { title: "Report Ready" },
          );
        }
        return true;
      } catch (error) {
        const message = error?.message || "Unable to synchronize report data.";
        if (![400, 409, 422].includes(Number(error?.status))) {
          window.AdminLiveData?.setAvailability?.("reports-data", false);
        }
        if (hadGoodData) {
          showPageMessage(`${message} Showing the last successfully loaded report.`);
        } else {
          showPageMessage(message, "error");
          renderInitialError(message);
        }

        if (source === "generate" || source === "refresh") {
          window.showAdminPopup?.(message, {
            title:
              Number(error?.status) === 401 || Number(error?.status) === 403
                ? "Access Required"
                : "Report Sync Failed",
          });
        }
        return false;
      } finally {
        state.isLoading = false;
        setButtonPending(initiatingButton, false);
        syncActionButtons();
      }
    };

    /**
     * Record the audited generation behind an official artifact.
     *
     * Print / Save PDF and Export CSV both hand a finished document to the
     * operator, so the report_generations audit trail has to record them even
     * when the page was opened, auto-synchronised and printed without pressing
     * Generate Report first. The audited identity is reused for the active
     * filter set for as long as the page stays open, so printing and exporting
     * the same report add one record between them, and Refresh and the
     * 30-second poll stay read-only.
     */
    const recordArtifactGeneration = async (options = {}) => {
      const params = state.activeParams || readFilterParams();
      if (!state.reportData || !params) return;
      const filterKey = reportFilterKey(params);
      if (state.auditedReport?.filterKey === filterKey) return;

      let data;
      try {
        data = await requestReport(
          { ...params, generationKey: createGenerationKey() },
          "generate",
        );
      } catch {
        // Never hold an official document hostage to its audit row. The
        // artifact is produced from the data already on screen and the next
        // Generate Report or artifact retries the record.
        return;
      }

      state.auditedReport = {
        filterKey,
        metadata: {
          id: data.report.id,
          generated_at: data.report.generated_at,
          generated_by: data.report.generated_by,
          generated_by_role: data.report.generated_by_role,
        },
      };
      state.reportData = data;
      state.activeParams = copyReportFilters(params);
      renderReport({ refreshPreview: options.refreshPreview !== false });
      window.dispatchEvent(
        new CustomEvent("fmrc:reports-updated", {
          detail: {
            type: "generated",
            reportId: data.report.id,
            generatedAt: data.report.generated_at,
          },
        }),
      );
    };

    const getPreviewFocusableElements = () =>
      Array.from(
        elements.previewModal?.querySelectorAll(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) || [],
      ).filter((element) => element.getAttribute("aria-hidden") !== "true");

    const getPreparedRole = () => {
      const role = String(
        state.reportData?.report?.generated_by_role ||
          window.AdminSession?.role ||
          "System user",
      );
      return role.charAt(0).toUpperCase() + role.slice(1);
    };

    /**
     * Resolve one editable letterhead line: the stored site_settings value wins,
     * otherwise the official template wording is printed. The unit contact line
     * additionally falls back to the Website Contact email/phone pair so the two
     * places an operator can edit a contact stay in agreement.
     */
    const resolveLetterheadField = (field, settings) => {
      const stored = String(settings[field.setting] ?? "").trim();
      if (stored) return stored;
      if (field.contactFallback) {
        const email =
          String(settings.contact_email || settings.footer_contact_email || "").trim() ||
          REPORT_CONTACT_FALLBACK.email;
        const phone =
          String(settings.contact_phone || settings.footer_contact_phone || "").trim() ||
          REPORT_CONTACT_FALLBACK.phone;
        return `${email} / ${phone}`;
      }
      return field.value;
    };

    const applyLetterheadSettings = (settings) => {
      const source = settings && typeof settings === "object" ? settings : {};
      state.letterheadStored = Object.fromEntries(
        REPORT_LETTERHEAD_FIELDS.map((field) => [
          field.key,
          String(source[field.setting] ?? ""),
        ]),
      );
      state.letterhead = Object.fromEntries(
        REPORT_LETTERHEAD_FIELDS.map((field) => [
          field.key,
          resolveLetterheadField(field, source),
        ]),
      );
      return state.letterhead;
    };

    const loadLetterhead = (refreshOpenPreview = true) => {
      if (state.letterheadPromise) return state.letterheadPromise;
      state.letterheadPromise = (async () => {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(
          () => controller.abort(),
          SITE_SETTINGS_REQUEST_TIMEOUT_MS,
        );
        try {
          const response = await fetch(`${API_BASE_URL}/site-settings`, {
            headers: { Accept: "application/json", "Cache-Control": "no-cache" },
            cache: "no-store",
            signal: controller.signal,
          });
          if (!response.ok) return state.letterhead;
          const payload = await response.json().catch(() => ({}));
          applyLetterheadSettings(payload?.data || {});
          syncLetterheadForm();
          if (
            refreshOpenPreview &&
            elements.previewModal?.classList.contains("show")
          ) {
            void refreshPreviewSnapshot(true).catch(showPreviewRefreshError);
          }
          return state.letterhead;
        } catch {
          return state.letterhead;
        } finally {
          window.clearTimeout(timeoutId);
          state.letterheadPromise = null;
        }
      })();
      return state.letterheadPromise;
    };

    /**
     * Placeholder text for one editor input: exactly what the printed page falls
     * back to when the field is cleared, so an operator can see the official
     * wording without having to delete their own text first.
     */
    const letterheadPlaceholder = (field) => {
      if (field.contactFallback) return "Website Contact email / phone";
      if (field.value) return field.value;
      if (field.key === "preparedByName") {
        return "Account that generated the report";
      }
      return "Blank line for a handwritten signature";
    };

    /** Build the grouped editor inputs once, in REPORT_LETTERHEAD_FIELDS order. */
    const buildLetterheadForm = () => {
      if (state.letterheadFormBuilt || !elements.letterheadFields) return;
      const groups = [];
      REPORT_LETTERHEAD_FIELDS.forEach((field) => {
        const last = groups[groups.length - 1];
        if (last && last.title === field.group) last.fields.push(field);
        else groups.push({ title: field.group, fields: [field] });
      });

      elements.letterheadFields.innerHTML = groups
        .map(
          (group) => `
            <fieldset class="report-letterhead-group">
              <legend>${escapeHtml(group.title)}</legend>
              <div class="report-letterhead-grid">
                ${group.fields
                  .map(
                    (field) => `
                      <label class="report-letterhead-field" for="letterhead-${escapeHtml(field.key)}">
                        <span class="report-letterhead-label">${escapeHtml(field.label)}</span>
                        <input
                          type="text"
                          id="letterhead-${escapeHtml(field.key)}"
                          data-letterhead-key="${escapeHtml(field.key)}"
                          maxlength="${Number(field.max) || 120}"
                          autocomplete="off"
                          spellcheck="false"
                          placeholder="${escapeHtml(letterheadPlaceholder(field))}"
                        />
                        ${
                          field.hint
                            ? `<small class="report-letterhead-hint">${escapeHtml(field.hint)}</small>`
                            : ""
                        }
                      </label>`,
                  )
                  .join("")}
              </div>
            </fieldset>`,
        )
        .join("");
      state.letterheadFormBuilt = true;
    };

    /** Mirror the stored (not resolved) values back into the editor inputs. */
    const syncLetterheadForm = () => {
      if (!state.letterheadFormBuilt || !elements.letterheadFields) return;
      REPORT_LETTERHEAD_FIELDS.forEach((field) => {
        const input = elements.letterheadFields.querySelector(
          `[data-letterhead-key="${field.key}"]`,
        );
        if (input) input.value = String(state.letterheadStored[field.key] ?? "");
      });
    };

    const setLetterheadError = (message) => {
      if (!elements.letterheadError) return;
      if (!message) {
        elements.letterheadError.hidden = true;
        elements.letterheadError.textContent = "";
        return;
      }
      elements.letterheadError.textContent = message;
      elements.letterheadError.hidden = false;
    };

    const getLetterheadFocusableElements = () =>
      Array.from(
        elements.letterheadModal?.querySelectorAll(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) || [],
      ).filter((element) => element.getAttribute("aria-hidden") !== "true");

    const openLetterheadEditor = async () => {
      if (!elements.letterheadModal) return;
      state.letterheadPreviousFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : elements.letterheadBtn;
      buildLetterheadForm();
      setLetterheadError("");
      elements.letterheadModal.classList.add("show");
      elements.letterheadModal.setAttribute("aria-hidden", "false");
      syncLetterheadForm();
      await loadLetterhead(false);
      syncLetterheadForm();
      const firstInput = elements.letterheadFields?.querySelector("input");
      try {
        firstInput?.focus({ preventScroll: true });
      } catch {
        firstInput?.focus();
      }
    };

    const closeLetterheadEditor = () => {
      if (!elements.letterheadModal?.classList.contains("show")) return;
      if (state.letterheadSaving) return;
      elements.letterheadModal.classList.remove("show");
      elements.letterheadModal.setAttribute("aria-hidden", "true");
      setLetterheadError("");
      if (state.letterheadPreviousFocus instanceof HTMLElement) {
        try {
          state.letterheadPreviousFocus.focus({ preventScroll: true });
        } catch {
          state.letterheadPreviousFocus.focus();
        }
      }
      state.letterheadPreviousFocus = null;
    };

    /**
     * Persist the letterhead into site_settings. `clearAll` sends every key as an
     * empty string, which is how "Restore official defaults" works: the resolver
     * then falls back to the official template wording for every line.
     */
    const saveLetterhead = async (clearAll = false) => {
      if (state.letterheadSaving) return;
      const token = getToken();
      if (!token) {
        setLetterheadError("Your session expired. Sign in again to save the letterhead.");
        return;
      }

      const payload = {};
      REPORT_LETTERHEAD_FIELDS.forEach((field) => {
        if (clearAll) {
          payload[field.setting] = "";
          return;
        }
        const input = elements.letterheadFields?.querySelector(
          `[data-letterhead-key="${field.key}"]`,
        );
        payload[field.setting] = String(input?.value ?? "")
          .trim()
          .slice(0, Number(field.max) || 120);
      });

      const button = clearAll ? elements.letterheadReset : elements.letterheadSave;
      state.letterheadSaving = true;
      setLetterheadError("");
      setButtonPending(button, true, clearAll ? "Restoring..." : "Saving...");
      if (elements.letterheadSave) elements.letterheadSave.disabled = true;
      if (elements.letterheadReset) elements.letterheadReset.disabled = true;
      try {
        const response = await fetch(`${API_BASE_URL}/admin/site-settings`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(
            body?.message ||
              (response.status === 403
                ? "Only admin or staff accounts can edit the official letterhead."
                : "The letterhead could not be saved. Try again."),
          );
        }

        // Reflect the write locally first so the preview is correct even if the
        // GET is served from a cached ETag, then reload for anything the backend
        // normalised and tell the other open tabs.
        applyLetterheadSettings(
          Object.fromEntries(
            REPORT_LETTERHEAD_FIELDS.map((field) => [
              field.setting,
              payload[field.setting],
            ]),
          ),
        );
        syncLetterheadForm();
        await loadLetterhead(false);
        if (typeof window.BroadcastChannel === "function") {
          try {
            const channel = new window.BroadcastChannel(
              SITE_SETTINGS_REALTIME_CHANNEL,
            );
            channel.postMessage({ type: "updated" });
            channel.close();
          } catch {
            /* best effort only */
          }
        }
        if (elements.previewModal?.classList.contains("show")) {
          void refreshPreviewSnapshot(true).catch(showPreviewRefreshError);
        }
        window.showAdminPopup?.(
          clearAll
            ? "The official UCN letterhead has been restored."
            : "Letterhead saved. Every new report and CSV will use it.",
          { title: "Saved!" },
        );
        state.letterheadSaving = false;
        closeLetterheadEditor();
      } catch (error) {
        setLetterheadError(
          error?.message || "The letterhead could not be saved. Try again.",
        );
      } finally {
        state.letterheadSaving = false;
        setButtonPending(button, false);
        if (elements.letterheadSave) elements.letterheadSave.disabled = false;
        if (elements.letterheadReset) elements.letterheadReset.disabled = false;
      }
    };

    const templateAsset = (name) => `${REPORT_TEMPLATE_ASSET_BASE}/${name}`;

    /** Editable letterhead line, HTML-escaped for the printed page. */
    const head = (key) => escapeHtml(state.letterhead[key] ?? "");

    const buildOfficialHeader = () => `
      <header class="official-report-header" aria-label="University of Camarines Norte official report header">
        <img class="official-header-ucn-mark" src="${templateAsset("ucn-mark.png")}" alt="University of Camarines Norte mark" />
        <div class="official-header-copy">
          <span>${head("republic")}</span>
          <strong>${head("university")}</strong>
          <em>${head("formerName")}</em>
          <span>${head("address")}</span>
        </div>
        <img class="official-header-bagong" src="${templateAsset("bagong-pilipinas.png")}" alt="Bagong Pilipinas" />
        <div class="official-header-contacts" aria-label="University contact information">
          <span><img src="${templateAsset("web-icon.jpeg")}" alt="" />${head("website")}</span>
          <span><img src="${templateAsset("email-icon.png")}" alt="" />${head("email")}</span>
          <span><img src="${templateAsset("facebook-icon.png")}" alt="" />${head("facebook")}</span>
        </div>
        <span class="official-header-rule" aria-hidden="true"></span>
        <div class="official-header-unit">
          <strong>${head("unitName")}</strong>
          <span>${head("unitContact")}</span>
        </div>
      </header>`;

    const buildOfficialFooter = (pageNumber, totalPages) => `
      <footer class="official-report-footer" aria-label="University of Camarines Norte official report footer">
        <span class="official-footer-rule" aria-hidden="true"></span>
        <img class="official-footer-sdg" src="${templateAsset("sustainable-development-goals.png")}" alt="Sustainable Development Goals" />
        <div class="official-footer-iso" aria-label="ISO 9001:2015 certification">
          <span class="official-footer-iso-mark"><img src="${templateAsset("iso-certification.jpeg")}" alt="TUV Rheinland certified" /></span>
          <img class="official-footer-iso-qr" src="${templateAsset("iso-qr.png")}" alt="ISO certification QR code" />
          <span class="official-footer-iso-copy"><strong>${head("qmsTitle")}</strong><br />${head("qmsStandard")}<br /><small>${head("certificateLabel")}<br />No.: ${head("certificateNo")}</small></span>
        </div>
        <div class="official-footer-pqa">
          <img src="${templateAsset("philippine-quality-award.png")}" alt="Philippine Quality Award" />
          <span><strong>${head("pqaTitle")}</strong><br />${head("pqaLineOne")}<br />${head("pqaLineTwo")}<br /><small>${head("pqaNote")}</small></span>
        </div>
        <div class="official-footer-csc">
          <img src="${templateAsset("csc-prime.png")}" alt="Civil Service Commission and PRIME-HRM" />
          <span><strong>${head("primeTitle")}</strong><br />${head("primeLevel")}<br /><small>${head("primeNote")}</small></span>
        </div>
        <img class="official-footer-wuri" src="${templateAsset("wuri.jpeg")}" alt="World University Rankings for Innovation" />
        <span class="official-footer-code"><strong>${head("documentCode")}</strong><br />Revision: ${head("revision")}</span>
        <span class="official-footer-page">Page ${pageNumber} of ${totalPages}</span>
      </footer>`;

    const buildOfficialPage = (body, pageNumber, totalPages, className = "") => `
      <article class="official-report-page ${className}" data-report-page="${pageNumber}" aria-label="Report page ${pageNumber} of ${totalPages}">
        ${buildOfficialHeader()}
        ${body}
        ${buildOfficialFooter(pageNumber, totalPages)}
      </article>`;

    const reportCoverageLabel = (report) =>
      report.start_date && report.end_date
        ? `${formatDateValue(report.start_date)} - ${formatDateValue(report.end_date)}`
        : report.period_label;

    const buildSummaryBody = (data) => {
      const report = data.report;
      const metrics = data.metrics.length
        ? data.metrics
            .map(
              (metric) => `<div class="official-summary-metric"><strong>${escapeHtml(formatValue(metric.value, metric.format))}</strong><span>${escapeHtml(metric.label)}</span></div>`,
            )
            .join("")
        : `<div class="official-summary-empty">No summary metrics are available for this period.</div>`;
      const breakdown = data.breakdown.items.length
        ? data.breakdown.items
            .map((item) => {
              const maxValue = Math.max(
                1,
                ...data.breakdown.items.map((entry) =>
                  Math.abs(asFiniteNumber(entry.value)),
                ),
              );
              const width = Math.min(
                100,
                (Math.abs(asFiniteNumber(item.value)) / maxValue) * 100,
              );
              return `<li><div><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(formatValue(item.value, data.breakdown.value_type))}</strong></div><span class="official-breakdown-track" aria-hidden="true"><span style="--report-breakdown-width:${width.toFixed(2)}%"></span></span></li>`;
            })
            .join("")
        : `<li class="official-summary-empty">No breakdown data is available for this period.</li>`;
      const emptyDetails = data.table.rows.length
        ? ""
        : `<div class="official-report-empty"><strong>No detailed records found</strong><span>The summary above reflects the selected period, but no detail transactions matched it.</span></div>`;

      return `
        <main class="official-report-body official-report-summary-content">
          <div class="official-report-title-block">
            <span>OFFICIAL SYSTEM REPORT</span>
            <h1>${escapeHtml(report.title)}</h1>
            <p>${escapeHtml(report.period_label)} &middot; ${escapeHtml(reportCoverageLabel(report))}</p>
          </div>
          <dl class="official-report-metadata">
            <div><dt>Report ID</dt><dd>${escapeHtml(report.id)}</dd></div>
            <div><dt>Category</dt><dd>${escapeHtml(CATEGORY_LABELS[report.category] || report.category || "System report")}</dd></div>
            <div><dt>Coverage</dt><dd>${escapeHtml(reportCoverageLabel(report))}</dd></div>
            <div><dt>Reporting period</dt><dd>${escapeHtml(report.period_label)}</dd></div>
            <div><dt>Prepared by</dt><dd>${escapeHtml(report.generated_by)}</dd></div>
            <div><dt>Role</dt><dd>${escapeHtml(getPreparedRole())}</dd></div>
            <div><dt>Generated</dt><dd>${escapeHtml(formatDateValue(report.generated_at, true))}</dd></div>
            <div><dt>Time zone</dt><dd>${escapeHtml(report.timezone || "Asia/Manila")}</dd></div>
          </dl>
          <section class="official-summary-section">
            <h2>Summary Metrics</h2>
            <div class="official-summary-metrics">${metrics}</div>
          </section>
          <div class="official-summary-insights">
            <section class="official-summary-section official-summary-chart">
              <h2>${escapeHtml(data.chart.title)}</h2>
              ${buildChartMarkup(data.chart)}
            </section>
            <section class="official-summary-section official-summary-breakdown">
              <h2>${escapeHtml(data.breakdown.title)}</h2>
              <ul>${breakdown}</ul>
            </section>
          </div>
          ${emptyDetails}
          ${buildCertificationBlock(data)}
        </main>`;
    };

    /**
     * Certification footer for the summary sheet: the three signatories every
     * official UCN document carries, plus the document-control line. Names are
     * editable; a blank Prepared by falls back to the account that generated the
     * report so the sheet is never unsigned.
     */
    const buildCertificationBlock = (data) => {
      const report = data.report;
      const signatories = [
        {
          role: "Prepared by",
          name: state.letterhead.preparedByName || report.generated_by || "",
          position: state.letterhead.preparedByPosition || getPreparedRole(),
        },
        {
          role: "Reviewed by",
          name: state.letterhead.reviewedByName || "",
          position: state.letterhead.reviewedByPosition || "",
        },
        {
          role: "Approved by",
          name: state.letterhead.approvedByName || "",
          position: state.letterhead.approvedByPosition || "",
        },
      ]
        .map(
          (person) => `<div class="official-certification-signatory">
            <span class="official-certification-role">${escapeHtml(person.role)}</span>
            <span class="official-certification-name">${escapeHtml(person.name || " ")}</span>
            <span class="official-certification-rule" aria-hidden="true"></span>
            <span class="official-certification-position">${escapeHtml(person.position || " ")}</span>
          </div>`,
        )
        .join("");

      const recordCount = data.table.rows.length;
      return `
        <section class="official-report-certification" aria-label="Report certification">
          <p class="official-certification-note">Certified true and correct based on the verified electronic records of the ${escapeHtml(state.letterhead.unitName)} as of ${escapeHtml(formatDateValue(report.generated_at, true))} (${escapeHtml(report.timezone || "Asia/Manila")}).</p>
          <div class="official-certification-signatories">${signatories}</div>
          <p class="official-certification-control"><span>${escapeHtml(state.letterhead.documentCode)}</span><span>Revision: ${escapeHtml(state.letterhead.revision)}</span><span>Records included: ${recordCount}</span></p>
        </section>`;
    };

    const fragmentDisplayValue = (fragment, column) => {
      if (
        fragment.displayValues &&
        Object.prototype.hasOwnProperty.call(fragment.displayValues, column.key)
      ) {
        return escapeHtml(fragment.displayValues[column.key]);
      }
      return renderFormattedCell(fragment.row[column.key], column.type);
    };

    const buildDetailBody = (data, fragments) => {
      const table = data.table;
      const header = table.columns
        .map((column) => `<th scope="col">${escapeHtml(column.label)}</th>`)
        .join("");
      const recordNumbers = Array.from(
        new Set(fragments.map((fragment) => fragment.recordNumber)),
      );
      const firstRecordNumber = recordNumbers[0] || 1;
      const lastRecordNumber = recordNumbers[recordNumbers.length - 1] || firstRecordNumber;
      const bodyRows = fragments
        .map(
          (fragment) => `<tr ${
            fragment.continuation
              ? `data-report-continuation-for="${fragment.recordNumber}" class="official-row-continuation"`
              : `data-report-record="${fragment.recordNumber}"`
          }>
            <th class="official-row-number" scope="row" aria-label="Record ${fragment.recordNumber}${fragment.continuation ? ", continued" : ""}">${fragment.recordNumber}${fragment.continuation ? "*" : ""}</th>
            ${table.columns
              .map(
                (column) => `<td data-cell-type="${escapeHtml(column.type)}">${fragmentDisplayValue(fragment, column)}</td>`,
              )
              .join("")}
          </tr>`,
        )
        .join("");
      return `
        <main class="official-report-body official-report-detail-content${table.columns.length > 6 ? " is-wide-table" : ""}">
          <div class="official-detail-heading">
            <div><span>DETAILED RECORDS</span><h1>${escapeHtml(table.title)}</h1></div>
            <p>${escapeHtml(data.report.id)}<br />Records ${firstRecordNumber}-${lastRecordNumber} of ${table.rows.length}${fragments.some((fragment) => fragment.continuation) ? " &middot; * continued" : ""}</p>
          </div>
          <table class="official-detail-table">
            <caption>${escapeHtml(table.title)} - ${escapeHtml(data.report.period_label)}</caption>
            <thead><tr><th class="official-row-number" scope="col">#</th>${header}</tr></thead>
            <tbody>${bodyRows}</tbody>
          </table>
        </main>`;
    };

    const createDetailFragments = (rows) =>
      rows.map((row, index) => ({
        row,
        recordNumber: index + 1,
        continuation: false,
        displayValues: null,
      }));

    const chunkFragments = (fragments, size) => {
      const step = Math.max(1, size);
      const groups = [];
      for (let index = 0; index < fragments.length; index += step) {
        groups.push(fragments.slice(index, index + step));
      }
      return groups;
    };

    const splitDisplayedText = (value) => {
      const text = String(value ?? "");
      if (text.length < 2) return null;
      const midpoint = Math.floor(text.length / 2);
      let splitAt = midpoint;
      const searchDistance = Math.min(80, Math.max(midpoint - 1, 0));
      for (let offset = 0; offset <= searchDistance; offset += 1) {
        const after = midpoint + offset;
        const before = midpoint - offset;
        if (after > 0 && after < text.length && /\s/u.test(text[after])) {
          splitAt = after;
          break;
        }
        if (before > 0 && before < text.length && /\s/u.test(text[before])) {
          splitAt = before;
          break;
        }
      }
      if (splitAt <= 0 || splitAt >= text.length) return null;
      return [text.slice(0, splitAt), text.slice(splitAt)];
    };

    const splitDetailFragment = (data, fragment) => {
      const displayValues = fragment.displayValues ||
        Object.fromEntries(
          data.table.columns.map((column) => [
            column.key,
            formatValue(fragment.row[column.key], column.type),
          ]),
        );
      const longestLength = Math.max(
        0,
        ...Object.values(displayValues).map((value) => String(value ?? "").length),
      );
      if (longestLength < 24) return null;

      const firstValues = {};
      const continuationValues = {};
      const splitThreshold = Math.max(24, Math.floor(longestLength * 0.42));
      let didSplit = false;
      data.table.columns.forEach((column) => {
        const text = String(displayValues[column.key] ?? "");
        const parts = text.length >= splitThreshold ? splitDisplayedText(text) : null;
        if (parts) {
          [firstValues[column.key], continuationValues[column.key]] = parts;
          didSplit = true;
        } else {
          firstValues[column.key] = text;
          continuationValues[column.key] = "";
        }
      });
      if (!didSplit) return null;

      return [
        {
          ...fragment,
          displayValues: firstValues,
        },
        {
          ...fragment,
          continuation: true,
          displayValues: continuationValues,
        },
      ];
    };

    const buildPreviewMarkup = (data, detailGroups) => {
      const totalPages = 1 + detailGroups.length;
      const pages = [
        buildOfficialPage(
          buildSummaryBody(data),
          1,
          totalPages,
          "official-report-summary-page",
        ),
      ];
      detailGroups.forEach((fragments, index) => {
        const pageNumber = index + 2;
        pages.push(
          buildOfficialPage(
            buildDetailBody(data, fragments),
            pageNumber,
            totalPages,
            "official-report-detail-page",
          ),
        );
      });
      return `<div class="report-document-stack">${pages.join("")}</div>`;
    };

    const waitForDocumentAssets = async (root) => {
      const waitForImage = async (image) => {
        if (!image.complete) {
          await new Promise((resolve, reject) => {
            image.addEventListener("load", resolve, { once: true });
            image.addEventListener(
              "error",
              () => reject(new Error(`Official artwork failed to load: ${image.getAttribute("src") || "unknown asset"}`)),
              { once: true },
            );
          });
        }
        if (!image.naturalWidth || !image.naturalHeight) {
          throw new Error(
            `Official artwork is unavailable: ${image.getAttribute("src") || "unknown asset"}`,
          );
        }
        // The checks above are what decide whether the artwork is really there.
        // decode() only pre-rasterises it so the first paint of the sheet is
        // not janky, and its promise can sit unsettled in a tab that is not
        // being rendered - which would fail the whole preview over a detail
        // that does not affect the sheet. Best effort, capped, never fatal.
        if (typeof image.decode === "function") {
          await Promise.race([
            image.decode().catch(() => {}),
            new Promise((resolve) =>
              window.setTimeout(resolve, IMAGE_DECODE_BUDGET_MS),
            ),
          ]);
        }
      };

      let timeoutId = 0;
      const timeout = new Promise((_, reject) => {
        timeoutId = window.setTimeout(
          () => reject(new Error("Official report artwork or fonts did not finish loading. Please try again.")),
          REPORT_ASSET_TIMEOUT_MS,
        );
      });
      try {
        await Promise.race([
          Promise.all([
            ...Array.from(root?.querySelectorAll("img") || []).map(waitForImage),
            document.fonts?.ready || Promise.resolve(),
          ]),
          timeout,
        ]);
      } finally {
        window.clearTimeout(timeoutId);
      }
    };

    const scalePageBodyToFit = (body) => {
      const page = body?.closest(".official-report-page");
      if (!body || !page || body.scrollHeight <= body.clientHeight + 1) return;
      const scale = Math.max(
        0.05,
        Math.min(0.99, (body.clientHeight - 2) / body.scrollHeight),
      );
      page.style.setProperty("--report-page-scale", scale.toFixed(4));
      page.style.setProperty("--report-page-body-width", `${(6.5 / scale).toFixed(4)}in`);
      page.style.setProperty("--report-page-body-height", `${(7.74 / scale).toFixed(4)}in`);
      page.classList.add("is-scaled-to-fit");
    };

    /**
     * Work out how many detail rows one sheet actually holds, by measuring
     * instead of guessing.
     *
     * The preview used to cut every sheet at a flat ten rows, which left a wide
     * band of blank paper above the footer on every page and spread short
     * reports over more sheets than they needed. This renders one probe sheet
     * carrying every row, reads the real height of each row and of the fixed
     * furniture around them (the detail heading, the caption and the table
     * head), then fills each sheet down to the footer and starts a new one only
     * when the next row would not fit.
     *
     * Row heights are read from `offsetTop`/`offsetHeight`, which are layout
     * pixels and so ignore the print-fit transform; the probe is measured
     * before `is-scaled-to-fit` is ever applied, and the sheet is a fixed
     * 8.5in x 11in box in both the modal and the print layout, so one
     * measurement is valid for both.
     *
     * The measured pass in `renderMeasuredPreview` still has the last word: a
     * row can wrap differently once the columns are laid out for a subset of
     * the data, so whatever still overflows is moved down there.
     *
     * @returns {Promise<Array<Array<object>>>} one array of fragments per sheet
     */
    const measureDetailGroups = async (data) => {
      const fragments = createDetailFragments(data.table.rows);
      if (!fragments.length) return [];

      elements.previewContent.innerHTML = buildPreviewMarkup(data, [fragments]);
      await waitForDocumentAssets(elements.previewContent);
      await nextPaint();

      const content = elements.previewContent.querySelector(
        ".official-report-detail-content",
      );
      const rowNodes = Array.from(
        content?.querySelectorAll(".official-detail-table tbody tr") || [],
      );
      // Anything unexpected about the probe (no sheet, a row count that does
      // not match) means the measurement cannot be trusted, so fall back to the
      // old flat chunk rather than paginate on bad numbers.
      if (!content || rowNodes.length !== fragments.length) {
        return chunkFragments(fragments, REPORT_ROWS_PER_SHEET_FALLBACK);
      }

      const tops = rowNodes.map((row) => row.offsetTop);
      const bottoms = rowNodes.map((row) => row.offsetTop + row.offsetHeight);
      const furniture = content.scrollHeight - (bottoms[bottoms.length - 1] - tops[0]);
      const available = content.clientHeight - furniture;
      if (!(available > 0)) {
        return chunkFragments(fragments, REPORT_ROWS_PER_SHEET_FALLBACK);
      }

      const groups = [];
      let current = [];
      let groupTop = tops[0];
      fragments.forEach((fragment, index) => {
        // Always keep at least one row on a sheet, even a row taller than the
        // sheet itself - `splitDetailFragment` is what deals with that.
        if (current.length && bottoms[index] - groupTop > available) {
          groups.push(current);
          current = [];
          groupTop = tops[index];
        }
        current.push(fragment);
      });
      if (current.length) groups.push(current);
      return groups;
    };

    const renderMeasuredPreview = async (data) => {
      const detailGroups = await measureDetailGroups(data);
      const maximumPasses = Math.min(
        2000,
        Math.max(40, data.table.rows.length * 4 + 40),
      );

      for (let pass = 0; pass < maximumPasses; pass += 1) {
        elements.previewContent.innerHTML = buildPreviewMarkup(data, detailGroups);
        await waitForDocumentAssets(elements.previewContent);
        await nextPaint();

        const pageNodes = Array.from(
          elements.previewContent.querySelectorAll(".official-report-detail-page"),
        );
        let paginationChanged = false;
        for (let pageIndex = 0; pageIndex < pageNodes.length; pageIndex += 1) {
          const content = pageNodes[pageIndex].querySelector(
            ".official-report-detail-content",
          );
          if (!content) continue;
          const overflows = content.scrollHeight > content.clientHeight + 1;
          if (!overflows) continue;
          if (detailGroups[pageIndex]?.length > 1) {
            const moved = detailGroups[pageIndex].pop();
            if (detailGroups[pageIndex + 1]) {
              detailGroups[pageIndex + 1].unshift(moved);
            } else {
              detailGroups.push([moved]);
            }
            paginationChanged = true;
            break;
          }
          const splitFragments = splitDetailFragment(
            data,
            detailGroups[pageIndex][0],
          );
          if (splitFragments) {
            detailGroups[pageIndex] = [splitFragments[0]];
            if (detailGroups[pageIndex + 1]) {
              detailGroups[pageIndex + 1].unshift(splitFragments[1]);
            } else {
              detailGroups.push([splitFragments[1]]);
            }
            paginationChanged = true;
            break;
          }
        }
        if (!paginationChanged) break;
      }

      elements.previewContent.innerHTML = buildPreviewMarkup(data, detailGroups);
      await waitForDocumentAssets(elements.previewContent);
      await nextPaint();
      const summaryBody = elements.previewContent.querySelector(
        ".official-report-summary-content",
      );
      const summaryPage = summaryBody?.closest(".official-report-page");
      if (summaryBody && summaryPage && summaryBody.scrollHeight > summaryBody.clientHeight + 1) {
        summaryPage.classList.add("is-summary-condensed");
        await nextPaint();
        scalePageBodyToFit(summaryBody);
      }
      elements.previewContent
        .querySelectorAll(".official-report-detail-content")
        .forEach(scalePageBodyToFit);
    };

    async function refreshPreviewSnapshot(preserveFocus = false) {
      if (!state.reportData || !elements.previewContent) return;

      const activeElement = document.activeElement;
      const focusWasPreviewBody = activeElement === elements.previewContent;
      const focusWasInPreviewBody = Boolean(
        preserveFocus &&
          activeElement instanceof HTMLElement &&
          elements.previewContent.contains(activeElement),
      );
      const previousScrollTop = elements.previewContent.scrollTop;
      const previousScrollLeft = elements.previewContent.scrollLeft;
      const focusableSelector =
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
      const previousFocusable = focusWasInPreviewBody
        ? Array.from(elements.previewContent.querySelectorAll(focusableSelector))
        : [];
      const previousFocusIndex = focusWasInPreviewBody
        ? previousFocusable.indexOf(activeElement)
        : -1;
      const previousAriaLabel = focusWasInPreviewBody
        ? activeElement.getAttribute("aria-label")
        : "";

      elements.previewTitle.textContent = state.reportData.report.title;
      await renderMeasuredPreview(state.reportData);
      elements.previewContent.scrollTop = previousScrollTop;
      elements.previewContent.scrollLeft = previousScrollLeft;

      if (focusWasPreviewBody) {
        try {
          elements.previewContent.focus({ preventScroll: true });
        } catch {
          elements.previewContent.focus();
        }
        return;
      }
      if (!focusWasInPreviewBody) return;
      const nextFocusable = Array.from(
        elements.previewContent.querySelectorAll(focusableSelector),
      );
      const matchingFocus =
        (previousAriaLabel
          ? nextFocusable.find(
              (element) => element.getAttribute("aria-label") === previousAriaLabel,
            )
          : null) ||
        nextFocusable[Math.min(Math.max(previousFocusIndex, 0), nextFocusable.length - 1)];
      if (!(matchingFocus instanceof HTMLElement)) return;
      try {
        matchingFocus.focus({ preventScroll: true });
      } catch {
        matchingFocus.focus();
      }
    }

    function showPreviewRefreshError(error) {
      if (!elements.previewModal?.classList.contains("show")) return;
      elements.previewContent.innerHTML = surfaceState(
        error?.message || "The official preview could not be refreshed.",
        "fa-circle-exclamation",
        "is-error",
      );
    }

    const captureInlineStyles = (element, properties) =>
      Object.fromEntries(
        properties.map((property) => [
          property,
          {
            value: element.style.getPropertyValue(property),
            priority: element.style.getPropertyPriority(property),
          },
        ]),
      );

    const restoreInlineStyles = (element, snapshot) => {
      Object.entries(snapshot || {}).forEach(([property, saved]) => {
        if (saved.value) {
          element.style.setProperty(property, saved.value, saved.priority);
        } else {
          element.style.removeProperty(property);
        }
      });
    };

    const lockPreviewEnvironment = () => {
      if (state.previewScrollLock) return;
      const html = document.documentElement;
      const body = document.body;
      const htmlProperties = ["overflow", "overscroll-behavior"];
      const bodyProperties = [
        "position",
        "top",
        "left",
        "right",
        "width",
        "overflow",
        "overscroll-behavior",
      ];
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;
      const lock = {
        scrollX,
        scrollY,
        html,
        body,
        htmlStyles: captureInlineStyles(html, htmlProperties),
        bodyStyles: captureInlineStyles(body, bodyProperties),
        backgroundEntries: new Map(),
        backgroundObserver: null,
      };
      state.previewScrollLock = lock;

      const makeBackgroundInert = (node) => {
        if (
          !(node instanceof HTMLElement) ||
          node === elements.previewModal ||
          elements.previewModal?.contains(node) ||
          ["SCRIPT", "NOSCRIPT"].includes(node.tagName) ||
          lock.backgroundEntries.has(node)
        ) {
          return;
        }
        lock.backgroundEntries.set(node, {
          wasInert: Boolean(node.inert),
          hadInertAttribute: node.hasAttribute("inert"),
          ariaHidden: node.getAttribute("aria-hidden"),
        });
        node.inert = true;
        node.setAttribute("inert", "");
        node.setAttribute("aria-hidden", "true");
      };

      Array.from(body.children).forEach(makeBackgroundInert);
      lock.backgroundObserver = new MutationObserver((records) => {
        records.forEach((record) => {
          record.addedNodes.forEach(makeBackgroundInert);
        });
      });
      lock.backgroundObserver.observe(body, { childList: true });

      html.classList.add("report-modal-open-root");
      body.classList.add("report-modal-open");
      html.style.setProperty("overflow", "hidden");
      html.style.setProperty("overscroll-behavior", "none");
      body.style.setProperty("position", "fixed");
      body.style.setProperty("top", `-${scrollY}px`);
      body.style.setProperty("left", `-${scrollX}px`);
      body.style.setProperty("right", "0");
      body.style.setProperty("width", "100%");
      body.style.setProperty("overflow", "hidden");
      body.style.setProperty("overscroll-behavior", "none");
    };

    const unlockPreviewEnvironment = () => {
      const lock = state.previewScrollLock;
      if (!lock) return;
      state.previewScrollLock = null;
      lock.html.classList.remove("report-modal-open-root", "report-printing-root");
      lock.body.classList.remove("report-modal-open", "report-printing");
      restoreInlineStyles(lock.html, lock.htmlStyles);
      restoreInlineStyles(lock.body, lock.bodyStyles);
      lock.backgroundObserver?.disconnect();
      lock.backgroundEntries.forEach((snapshot, node) => {
        node.inert = snapshot.wasInert;
        if (snapshot.hadInertAttribute) {
          node.setAttribute("inert", "");
        } else {
          node.removeAttribute("inert");
        }
        if (snapshot.ariaHidden === null) node.removeAttribute("aria-hidden");
        else node.setAttribute("aria-hidden", snapshot.ariaHidden);
      });
      window.scrollTo(lock.scrollX, lock.scrollY);
    };

    const openPreview = async () => {
      if (!state.reportData || !elements.previewModal) return;
      state.deferredFocusRestore = null;
      state.previousFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : elements.preview;
      setButtonPending(elements.preview, true, "Preparing...");
      syncActionButtons();
      elements.previewModal.classList.add("show");
      elements.previewModal.setAttribute("aria-hidden", "false");
      elements.previewContent.innerHTML = surfaceState(
        "Preparing the official report pages...",
        "fa-spinner fa-spin",
      );
      lockPreviewEnvironment();
      elements.previewCloseIcon?.focus();
      try {
        await loadLetterhead(false);
        await refreshPreviewSnapshot(false);
      } catch (error) {
        const message =
          error?.message || "The official report preview could not be prepared.";
        elements.previewContent.innerHTML = surfaceState(
          message,
          "fa-circle-exclamation",
          "is-error",
        );
      } finally {
        setButtonPending(elements.preview, false);
        syncActionButtons();
        if (
          !elements.previewModal.classList.contains("show") &&
          state.deferredFocusRestore instanceof HTMLElement
        ) {
          try {
            state.deferredFocusRestore.focus({ preventScroll: true });
          } catch {
            state.deferredFocusRestore.focus();
          }
          state.deferredFocusRestore = null;
        }
      }
    };

    const closePreview = () => {
      if (!elements.previewModal?.classList.contains("show")) return;
      elements.previewModal.classList.remove("show");
      elements.previewModal.setAttribute("aria-hidden", "true");
      unlockPreviewEnvironment();
      if (state.previousFocus instanceof HTMLElement) {
        if (
          "disabled" in state.previousFocus &&
          Boolean(state.previousFocus.disabled)
        ) {
          state.deferredFocusRestore = state.previousFocus;
        } else {
          try {
            state.previousFocus.focus({ preventScroll: true });
          } catch {
            state.previousFocus.focus();
          }
        }
      }
      state.previousFocus = null;
    };

    const printReport = async () => {
      if (!state.reportData) return;
      setButtonPending(elements.print, true, "Preparing...");
      const previousTitle = document.title;
      let cleanedUp = false;
      let releaseWatchers = () => {};
      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        releaseWatchers();
        document.documentElement.classList.remove("report-printing-root");
        document.body.classList.remove("report-printing");
        document.title = previousTitle;
        setButtonPending(elements.print, false);
        syncActionButtons();
      };
      try {
        // Printing an official document is an audited generation. Record it
        // once for these filters before the sheet leaves the system. The
        // preview is re-rendered by the snapshot refresh below, so the audited
        // report ID reaches the printed pages without a second render pass.
        await recordArtifactGeneration({ refreshPreview: false });
        await refreshPreviewSnapshot(true);
        await waitForDocumentAssets(elements.previewContent);
        document.documentElement.classList.add("report-printing-root");
        document.body.classList.add("report-printing");
        document.title = `UCN-FMRC ${state.reportData.report.id} - ${state.reportData.report.title}`;
        await nextPaint();
        await nextPaint();

        // The print classes must survive for as long as the browser is
        // measuring the sheets. Cleaning up in a finally block races browsers
        // whose window.print() returns before the print layout is captured,
        // which strips the print geometry mid-render and prints the on-screen
        // modal instead of the official pages. Only print-lifecycle signals may
        // restore the page — afterprint, the print media query switching back,
        // or a last-resort timer. Restoring on a stray pointer or wheel event
        // would reintroduce the same race in exactly the browsers whose
        // window.print() does not block.
        const printMedia = window.matchMedia?.("print") || null;
        const onMediaChange = (event) => {
          if (!event.matches) cleanup();
        };
        const fallbackTimer = window.setTimeout(
          cleanup,
          PRINT_RESTORE_FALLBACK_MS,
        );
        releaseWatchers = () => {
          window.clearTimeout(fallbackTimer);
          window.removeEventListener("afterprint", cleanup);
          printMedia?.removeEventListener?.("change", onMediaChange);
        };
        window.addEventListener("afterprint", cleanup, { once: true });
        printMedia?.addEventListener?.("change", onMediaChange);
        window.print();
      } catch (error) {
        cleanup();
        showPreviewRefreshError(
          new Error(
            error?.message ||
              "The official report could not be prepared for printing.",
          ),
        );
      }
    };

    const rawCsvValue = (value, type = "text") => {
      if (value === null || value === undefined) return "";
      const normalizedType = normalizeType(type);
      if (normalizedType === "date" && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
        return String(value);
      }
      if (["datetime", "date_time", "timestamp"].includes(normalizedType)) {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
      }
      if (typeof value === "object") {
        try {
          return JSON.stringify(value);
        } catch {
          return asDisplayText(value, "");
        }
      }
      return String(value);
    };

    const csvCell = (value, type = "text") => {
      let text = rawCsvValue(value, type);
      const isNumericPrimitive =
        typeof value === "number" && Number.isFinite(value);
      if (isNumericPrimitive) return String(value);
      // Spreadsheet programs may ignore leading whitespace/control characters
      // before a formula marker. Prefix the complete original text so those
      // characters are preserved while the cell is forced to remain text.
      if (
        !isNumericPrimitive &&
        /^[\s\u0000-\u001f]*[=+\-@]/u.test(text)
      ) {
        text = `'${text}`;
      }
      return `"${text.replace(/"/g, '""')}"`;
    };

    /**
     * Sortable, spreadsheet-friendly stamp in the report time zone.
     * "2026-08-21" / "2026-08-21 14:05" are parsed by Excel and LibreOffice as
     * real dates, so date columns right-align and sort with the other records
     * instead of arriving as long ISO strings with an offset.
     */
    const csvDateStamp = (value, withTime) => {
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return String(value);
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Manila",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
          .formatToParts(parsed)
          .map((part) => [part.type, part.value]),
      );
      const date = `${parts.year}-${parts.month}-${parts.day}`;
      if (!withTime) return date;
      return `${date} ${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`;
    };

    /**
     * One data cell of the exported sheet. Numeric columns are written as bare
     * numbers so the spreadsheet stores them as numbers — right-aligned and
     * ready for its own totals — while text keeps the quoting and
     * formula-injection guard.
     */
    const csvDataCell = (value, type = "text") => {
      if (value === null || value === undefined || value === "") return "";
      const normalizedType = normalizeType(type);
      if (
        [
          "currency",
          "money",
          "amount",
          "sales",
          "integer",
          "count",
          "quantity",
          "number",
          "decimal",
          "percent",
          "percentage",
        ].includes(normalizedType)
      ) {
        const numeric =
          typeof value === "number"
            ? value
            : Number(String(value).replace(/[^0-9+\-.]/g, ""));
        if (Number.isFinite(numeric)) return String(numeric);
      }
      if (normalizedType === "boolean") return csvCell(value ? "Yes" : "No");
      if (normalizedType === "date") return csvCell(csvDateStamp(value, false));
      if (["datetime", "date_time", "timestamp"].includes(normalizedType)) {
        return csvCell(csvDateStamp(value, true));
      }
      if (typeof value === "object") return csvCell(asDisplayText(value, ""));
      return csvCell(value, normalizedType);
    };

    /**
     * Export the records only: one header row of column labels followed by one
     * row per record, every row carrying the same number of cells so the sheet
     * opens as a single aligned table. Letterhead, metadata, metrics, breakdown
     * and certification prose belong to the printed document, not to the
     * spreadsheet the operator filters and pivots.
     */
    const exportCsv = async () => {
      const data = state.reportData;
      if (!data) return;
      setButtonPending(elements.csv, true, "Exporting...");
      syncActionButtons();
      try {
        // Exporting is an audited generation for the same reason printing is:
        // finished records leave the system.
        await recordArtifactGeneration();
        const report = state.reportData?.report || data.report;
        const table = state.reportData?.table || data.table;
        const lines = [
          table.columns.map((column) => csvCell(column.label)).join(","),
          ...table.rows.map((row) =>
            table.columns
              .map((column) => csvDataCell(row[column.key], column.type))
              .join(","),
          ),
        ];
        const csv = `\uFEFF${lines.join("\r\n")}`;
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const fileDateParts = new Intl.DateTimeFormat("en-US", {
          timeZone: "Asia/Manila",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).formatToParts(new Date(report.generated_at || Date.now()));
        const fileDateLookup = Object.fromEntries(
          fileDateParts.map((part) => [part.type, part.value]),
        );
        const fileDate = `${fileDateLookup.year}-${fileDateLookup.month}-${fileDateLookup.day}`;
        const safeSegment = (value, fallback) =>
          String(value || fallback)
            .replace(/[^a-z0-9_-]+/gi, "-")
            .replace(/^-+|-+$/g, "") || fallback;
        const filename = [
          "UCN-FMRC",
          safeSegment(report.id, "Report"),
          safeSegment(report.category || state.activeParams?.category, "Category"),
          safeSegment(report.period || state.activeParams?.period, "Period"),
          fileDate,
        ].join("_");
        link.href = url;
        link.download = `${filename}.csv`;
        link.hidden = true;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
        window.showAdminSuccessNotification?.("Report CSV exported successfully.", {
          title: "Export Complete",
        });
      } catch (error) {
        window.showAdminPopup?.(error?.message || "Unable to export this report.", {
          title: "Export Failed",
        });
      } finally {
        setButtonPending(elements.csv, false);
        syncActionButtons();
      }
    };

    const refreshActiveReport = (source) => {
      if (!state.activeParams || state.isLoading) return;
      void loadReport({ ...state.activeParams }, source);
    };

    const scheduleOrdersRealtimeRefresh = () => {
      if (
        document.visibilityState !== "visible" ||
        !state.activeParams ||
        !ORDER_DRIVEN_CATEGORIES.has(state.activeParams.category)
      ) {
        return;
      }
      window.clearTimeout(state.realtimeTimer);
      state.realtimeTimer = window.setTimeout(
        () => refreshActiveReport("realtime"),
        REPORT_REALTIME_DEBOUNCE_MS,
      );
    };

    const setupRealtime = () => {
      window.addEventListener("fmrc:orders-updated", scheduleOrdersRealtimeRefresh);
      window.addEventListener("storage", (event) => {
        if (event.key === ORDERS_STORAGE_KEY) scheduleOrdersRealtimeRefresh();
      });
      if (typeof window.BroadcastChannel === "function") {
        try {
          state.ordersChannel = new window.BroadcastChannel(
            ORDERS_REALTIME_CHANNEL,
          );
          state.ordersChannel.addEventListener(
            "message",
            scheduleOrdersRealtimeRefresh,
          );
        } catch {
          state.ordersChannel = null;
        }
        try {
          state.siteSettingsChannel = new window.BroadcastChannel(
            SITE_SETTINGS_REALTIME_CHANNEL,
          );
          state.siteSettingsChannel.addEventListener("message", (event) => {
            if (event?.data?.type === "updated") void loadLetterhead();
          });
        } catch {
          state.siteSettingsChannel = null;
        }
      }

      state.pollTimer = window.setInterval(() => {
        if (document.visibilityState === "visible") {
          refreshActiveReport("poll");
        }
      }, REPORT_POLL_INTERVAL_MS);

      document.addEventListener("visibilitychange", () => {
        if (
          document.visibilityState === "visible" &&
          state.activeParams &&
          Date.now() - state.lastGoodSyncAt >= REPORT_POLL_INTERVAL_MS
        ) {
          refreshActiveReport("visible");
        }
      });

      window.addEventListener(
        "beforeunload",
        () => {
          window.clearInterval(state.pollTimer);
          window.clearTimeout(state.realtimeTimer);
          state.ordersChannel?.close?.();
          state.siteSettingsChannel?.close?.();
          unlockPreviewEnvironment();
        },
        { once: true },
      );
    };

    const currentParts = getPhilippineDateParts();
    const validReportYears = [];
    for (let year = currentParts.year + 1; year >= 2000; year -= 1) {
      validReportYears.push(year);
    }
    elements.year.innerHTML = validReportYears
      .map((year) => `<option value="${year}">${year}</option>`)
      .join("");
    elements.year.value = String(currentParts.year);
    elements.month.value = String(currentParts.month);
    elements.quarter.value = String(Math.ceil(currentParts.month / 3));

    elements.categoryButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const category = String(button.dataset.reportCategory || "");
        if (!CATEGORY_LABELS[category]) return;
        state.selectedCategory = category;
        elements.categoryButtons.forEach((candidate) => {
          const isActive = candidate === button;
          candidate.classList.toggle("is-active", isActive);
          candidate.setAttribute("aria-pressed", isActive ? "true" : "false");
        });
        updateSelectionSummary();
      });
    });

    elements.period.addEventListener("change", syncPeriodControls);
    elements.year.addEventListener("change", updateSelectionSummary);
    elements.month.addEventListener("change", updateSelectionSummary);
    elements.quarter.addEventListener("change", updateSelectionSummary);

    elements.generate.addEventListener("click", () => {
      const params = readFilterParams();
      params.generationKey = createGenerationKey();
      void loadReport(params, "generate");
    });
    elements.refresh.addEventListener("click", () => {
      const params = state.activeParams || readFilterParams();
      void loadReport({ ...params }, "refresh");
    });
    elements.prevPage.addEventListener("click", () => {
      if (state.currentPage <= 1) return;
      state.currentPage -= 1;
      renderTablePage();
    });
    elements.nextPage.addEventListener("click", () => {
      const rowCount = state.reportData?.table.rows.length || 0;
      const totalPages = Math.max(1, Math.ceil(rowCount / REPORT_PAGE_SIZE));
      if (state.currentPage >= totalPages) return;
      state.currentPage += 1;
      renderTablePage();
    });

    if (window.AdminPageNumberInput?.bind) {
      window.AdminPageNumberInput.bind(elements.pageNumber, {
        getPage: () => state.currentPage,
        getTotalPages: () =>
          Math.max(
            1,
            Math.ceil(
              (state.reportData?.table.rows.length || 0) / REPORT_PAGE_SIZE,
            ),
          ),
        onChange: (page) => {
          state.currentPage = page;
          renderTablePage();
        },
      });
    } else {
      elements.pageNumber.addEventListener("change", () => {
        const totalPages = Math.max(
          1,
          Math.ceil(
            (state.reportData?.table.rows.length || 0) / REPORT_PAGE_SIZE,
          ),
        );
        state.currentPage = Math.max(
          1,
          Math.min(Number.parseInt(elements.pageNumber.value, 10) || 1, totalPages),
        );
        renderTablePage();
      });
    }

    const preventOutsidePreviewWheel = (event) => {
      if (!elements.previewModal?.classList.contains("show")) return;
      if (!elements.previewContent?.contains(event.target)) event.preventDefault();
    };
    const rememberPreviewTouchOrigin = (event) => {
      state.previewTouchStartedInside = Boolean(
        elements.previewContent?.contains(event.target),
      );
    };
    const preventOutsidePreviewTouchMove = (event) => {
      if (
        elements.previewModal?.classList.contains("show") &&
        !state.previewTouchStartedInside
      ) {
        event.preventDefault();
      }
    };
    const clearPreviewTouchOrigin = () => {
      state.previewTouchStartedInside = false;
    };
    elements.previewModal?.addEventListener("wheel", preventOutsidePreviewWheel, {
      passive: false,
    });
    elements.previewModal?.addEventListener("touchstart", rememberPreviewTouchOrigin, {
      passive: true,
    });
    elements.previewModal?.addEventListener(
      "touchmove",
      preventOutsidePreviewTouchMove,
      { passive: false },
    );
    elements.previewModal?.addEventListener("touchend", clearPreviewTouchOrigin, {
      passive: true,
    });
    elements.previewModal?.addEventListener("touchcancel", clearPreviewTouchOrigin, {
      passive: true,
    });

    elements.preview?.addEventListener("click", () => void openPreview());
    elements.csv?.addEventListener("click", () => void exportCsv());
    elements.previewCloseIcon?.addEventListener("click", closePreview);
    elements.previewClose?.addEventListener("click", closePreview);
    elements.print?.addEventListener("click", () => void printReport());
    elements.letterheadBtn?.addEventListener("click", () =>
      void openLetterheadEditor(),
    );
    elements.letterheadCloseIcon?.addEventListener("click", closeLetterheadEditor);
    elements.letterheadCancel?.addEventListener("click", closeLetterheadEditor);
    elements.letterheadSave?.addEventListener("click", () => void saveLetterhead(false));
    elements.letterheadReset?.addEventListener("click", () => {
      const confirmed = window.confirm(
        "Restore every letterhead line to the official UCN template? Your custom wording will be cleared.",
      );
      if (confirmed) void saveLetterhead(true);
    });
    elements.letterheadFields?.addEventListener("input", () => setLetterheadError(""));
    elements.letterheadFields?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void saveLetterhead(false);
      }
    });
    document.addEventListener("keydown", (event) => {
      if (!elements.letterheadModal?.classList.contains("show")) return;
      if (event.key === "Escape") {
        closeLetterheadEditor();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = getLetterheadFocusableElements();
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (
        event.shiftKey &&
        (active === first || !elements.letterheadModal.contains(active))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (active === last || !elements.letterheadModal.contains(active))
      ) {
        event.preventDefault();
        first.focus();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (!elements.previewModal?.classList.contains("show")) return;
      if (event.key === "Escape") {
        closePreview();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = getPreviewFocusableElements();
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !elements.previewModal.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !elements.previewModal.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    });

    syncPeriodControls();
    state.activeParams = readFilterParams();
    renderLoadingState();
    void loadLetterhead();
    setupRealtime();
    void loadReport({ ...state.activeParams }, "initial");
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
