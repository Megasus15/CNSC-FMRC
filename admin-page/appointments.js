document.addEventListener("DOMContentLoaded", () => {
  // Appointment notifications in the header deep-link here, so claim the kind
  // before the fallback timer is armed and register the opener after the load.
  window.AdminNotifFocus?.expect(["appointment"]);

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

  const tableBody = document.getElementById("appointmentsTableBody");
  const tableMeta = document.getElementById("appointmentsTableMeta");
  const currentPageEl = document.getElementById("appointmentsCurrentPage");
  const prevBtn = document.getElementById("appointmentsPrevPage");
  const nextBtn = document.getElementById("appointmentsNextPage");
  const searchInput = document.getElementById("appointmentSearchInput");
  const appointmentsTable = document.getElementById("appointmentsTable");
  const appointmentsTableFooter = document.getElementById(
    "appointmentsTableFooter",
  );

  const tableWrapper = document.querySelector(".table-wrapper");

  const calGrid = document.getElementById("adminCalDaysGrid");
  const monthDisplay = document.getElementById("adminCalMonthYear");
  const calPrevBtn = document.getElementById("adminCalPrevBtn");
  const calNextBtn = document.getElementById("adminCalNextBtn");
  const selectedDateDisplay = document.getElementById(
    "adminSelectedDateDisplay",
  );
  const timeSlotsContainer = document.getElementById("adminTimeSlotsContainer");
  const btnToggleBlockDay = document.getElementById("btnToggleBlockDay");
  const btnClearDayBlocks = document.getElementById("btnClearDayBlocks");
  const adminEventInput = document.getElementById("adminEventInput");
  const btnAddStaticEvent = document.getElementById("btnAddStaticEvent");
  const adminEventList = document.getElementById("adminEventList");
  const btnOpenDayTimePicker = document.getElementById("btnOpenDayTimePicker");
  const adminDaySlotLabel = document.getElementById("adminDaySlotLabel");
  const adminDaySlotType = document.getElementById("adminDaySlotType");
  const btnAddDaySlot = document.getElementById("btnAddDaySlot");
  const adminDaySlotList = document.getElementById("adminDaySlotList");
  const btnSaveCalendarChanges = document.getElementById(
    "btnSaveCalendarChanges",
  );
  const btnOpenCalendar = document.querySelector(
    '[data-modal-open="#modalCalendar"]',
  );
  const modalCalendar = document.getElementById("modalCalendar");
  const modalTimePicker = document.getElementById("modalTimePicker");
  const timePickerTitle = document.getElementById("timePickerTitle");
  const pickerStartHour = document.getElementById("pickerStartHour");
  const pickerStartMinute = document.getElementById("pickerStartMinute");
  const pickerEndHour = document.getElementById("pickerEndHour");
  const pickerEndMinute = document.getElementById("pickerEndMinute");
  const pickerPeriod = document.getElementById("pickerPeriod");
  const timePickerPreview = document.getElementById("timePickerPreview");
  const btnConfirmTimePicker = document.getElementById("btnConfirmTimePicker");

  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const today = new Date();
  const normalizedToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  let currentMonth = normalizedToday.getMonth();
  let currentYear = normalizedToday.getFullYear();
  let selectedDateKey = null;
  let currentPage = 1;

  let editingSlotId = null;
  let activeTimePickerContext = null;
  let viewingAppointment = null;
  let completingAppointment = null;
  let consultationRequestPending = false;
  let archivingAppointmentId = null;
  let archiveRequestPending = false;
  let appointmentReadVersion = 0;
  const forgetArchivedAppointments = (ids) => {
    ++appointmentReadVersion; // Invalidate reads started before the mutation completed.
    const removed = new Set(ids.map(String));
    state.appointments = state.appointments.filter(item => !removed.has(String(item.id)));
    renderTable();
  };
  let appointmentBulkController = null;

  const state = {
    appointments: [],
    calendar: {
      time_slots: [],
      day_settings: {},
      booked_slots: {},
    },
  };

  const defaultSlots = [
    { label: "9:00 - 10:00 AM", type: "AM", sort_order: 1, is_active: true },
    { label: "10:00 - 11:00 AM", type: "AM", sort_order: 2, is_active: true },
    { label: "11:00 - 12:00", type: "AM", sort_order: 3, is_active: true },
    { label: "1:00 - 2:00 PM", type: "PM", sort_order: 4, is_active: true },
    { label: "2:00 - 3:00 PM", type: "PM", sort_order: 5, is_active: true },
    { label: "3:00 - 4:00 PM", type: "PM", sort_order: 6, is_active: true },
  ];

  const safe = (value) => {
    if (value === undefined || value === null || String(value).trim() === "")
      return "N/A";
    return String(value);
  };

  /** Escape a value that is about to be written into an HTML attribute. */
  const escapeAttribute = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const prettyDate = (isoDate) => {
    const m = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return safe(isoDate);
    return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
  };

  const formatApNo = (referenceNo) => {
    return safe(referenceNo || "Not recorded");
  };

  const toTimestamp = (value) => {
    const ts = Date.parse(String(value || ""));
    return Number.isFinite(ts) ? ts : 0;
  };

  const toNumericId = (value) => {
    const parsed = Number(String(value ?? "").replace(/[^0-9]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const parseStartTimeInMinutes = (label, fallbackType = "AM") => {
    const source = String(label || "").trim();
    const startRaw = source.split("-")[0].trim();
    const meridiemMatch = source.match(/\b(AM|PM)\b/i);
    const meridiem = (fallbackType || meridiemMatch?.[1] || "AM").toUpperCase();

    let hour = 0;
    let minute = 0;
    if (/^\d{3,4}$/.test(startRaw)) {
      const padded = startRaw.padStart(4, "0");
      hour = Number(padded.slice(0, 2));
      minute = Number(padded.slice(2, 4));
    } else {
      const match = startRaw.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
      if (!match) return Number.MAX_SAFE_INTEGER;
      hour = Number(match[1]);
      minute = Number(match[2] || "0");
    }

    if (
      Number.isNaN(hour) ||
      Number.isNaN(minute) ||
      minute > 59 ||
      hour < 1 ||
      hour > 12
    ) {
      return Number.MAX_SAFE_INTEGER;
    }

    if (meridiem === "AM") {
      if (hour === 12) hour = 0;
    } else if (hour < 12) {
      hour += 12;
    }

    return hour * 60 + minute;
  };

  const slotSortComparator = (a, b) => {
    const aTime = parseStartTimeInMinutes(a?.label, a?.type);
    const bTime = parseStartTimeInMinutes(b?.label, b?.type);
    if (aTime !== bTime) return aTime - bTime;
    return String(a?.label || "").localeCompare(String(b?.label || ""));
  };

  const formatSlotLabel = (
    startHour,
    startMinute,
    endHour,
    endMinute,
    period,
  ) => {
    const start = `${startHour}:${String(startMinute).padStart(2, "0")}`;
    const end = `${endHour}:${String(endMinute).padStart(2, "0")}`;
    const meridiem = period === "PM" ? "PM" : "AM";
    return `${start} - ${end} ${meridiem}`;
  };

  const parsePickerValue = (label, fallbackType = "AM") => {
    const parsed = String(label || "")
      .trim()
      .match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);

    if (!parsed) {
      return {
        startHour: 9,
        startMinute: "00",
        endHour: 10,
        endMinute: "00",
        period: fallbackType === "PM" ? "PM" : "AM",
      };
    }

    return {
      startHour: Number(parsed[1]),
      startMinute: parsed[2],
      endHour: Number(parsed[3]),
      endMinute: parsed[4],
      period:
        (parsed[5] || fallbackType || "AM").toUpperCase() === "PM"
          ? "PM"
          : "AM",
    };
  };

  const updateTimePickerButton = (buttonId, label) => {
    const button = document.getElementById(buttonId);
    if (!button) return;
    button.textContent = label || "Choose Time Slot";
  };

  const ensureTimePickerOptions = () => {
    if (!pickerStartHour || pickerStartHour.options.length) return;

    const createOptions = (select, values) => {
      select.innerHTML = values
        .map((value) => `<option value="${value}">${value}</option>`)
        .join("");
    };

    createOptions(
      pickerStartHour,
      Array.from({ length: 12 }, (_, i) => String(i + 1)),
    );
    createOptions(
      pickerEndHour,
      Array.from({ length: 12 }, (_, i) => String(i + 1)),
    );
    createOptions(pickerStartMinute, [
      "00",
      "05",
      "10",
      "15",
      "20",
      "25",
      "30",
      "35",
      "40",
      "45",
      "50",
      "55",
    ]);
    createOptions(pickerEndMinute, [
      "00",
      "05",
      "10",
      "15",
      "20",
      "25",
      "30",
      "35",
      "40",
      "45",
      "50",
      "55",
    ]);
    if (pickerPeriod && !pickerPeriod.value) pickerPeriod.value = "AM";
  };

  const centerPickerSelect = (select, smooth = true) => {
    if (!select || !select.options.length) return;
    const optionHeight = select.options[0]?.offsetHeight || 22;
    const centerOffset = (select.clientHeight - optionHeight) / 2;
    const target = Math.max(
      0,
      select.selectedIndex * optionHeight - centerOffset,
    );
    select.scrollTo({ top: target, behavior: smooth ? "smooth" : "auto" });
  };

  const syncActiveWheel = (activeSelect) => {
    document
      .querySelectorAll(".time-wheel")
      .forEach((wheel) => wheel.classList.remove("is-active-wheel"));
    activeSelect?.closest(".time-wheel")?.classList.add("is-active-wheel");
  };

  const centerAllPickers = (smooth = true) => {
    [
      pickerStartHour,
      pickerStartMinute,
      pickerEndHour,
      pickerEndMinute,
      pickerPeriod,
    ].forEach((select) => centerPickerSelect(select, smooth));
  };

  const updateTimePickerPreview = () => {
    if (!timePickerPreview) return;
    const label = formatSlotLabel(
      Number(pickerStartHour?.value || 9),
      Number(pickerStartMinute?.value || 0),
      Number(pickerEndHour?.value || 10),
      Number(pickerEndMinute?.value || 0),
      pickerPeriod?.value || "AM",
    );
    timePickerPreview.textContent = `Selected: ${label}`;
  };

  const openTimePicker = ({ context, title, label, type }) => {
    ensureTimePickerOptions();
    activeTimePickerContext = context;
    if (timePickerTitle)
      timePickerTitle.textContent = title || "Choose Time Slot";

    const picked = parsePickerValue(label, type || "AM");
    if (pickerStartHour) pickerStartHour.value = String(picked.startHour);
    if (pickerStartMinute) pickerStartMinute.value = picked.startMinute;
    if (pickerEndHour) pickerEndHour.value = String(picked.endHour);
    if (pickerEndMinute) pickerEndMinute.value = picked.endMinute;
    if (pickerPeriod) pickerPeriod.value = picked.period;

    updateTimePickerPreview();
    modalTimePicker?.classList.add("show");
    setTimeout(() => {
      centerAllPickers(false);
      syncActiveWheel(pickerStartHour);
      pickerStartHour?.focus();
    }, 40);
  };

  const applySelectedTimeSlot = () => {
    const startHour = Number(pickerStartHour?.value || 0);
    const startMinute = Number(pickerStartMinute?.value || 0);
    const endHour = Number(pickerEndHour?.value || 0);
    const endMinute = Number(pickerEndMinute?.value || 0);
    const period = pickerPeriod?.value === "PM" ? "PM" : "AM";

    const startTotal = startHour * 60 + startMinute;
    const endTotal = endHour * 60 + endMinute;
    if (endTotal <= startTotal) {
      alert("End time must be later than start time.");
      return;
    }

    const label = formatSlotLabel(
      startHour,
      startMinute,
      endHour,
      endMinute,
      period,
    );

    if (activeTimePickerContext === "day") {
      if (adminDaySlotLabel) adminDaySlotLabel.value = label;
      if (adminDaySlotType) adminDaySlotType.value = period;
      updateTimePickerButton("btnOpenDayTimePicker", label);
    } else if (activeTimePickerContext === "global") {
      const labelInput = document.getElementById("adminSlotLabel");
      const typeInput = document.getElementById("adminSlotType");
      if (labelInput) labelInput.value = label;
      if (typeInput) typeInput.value = period;
      updateTimePickerButton("btnOpenGlobalTimePicker", label);
    }

    activeTimePickerContext = null;
    modalTimePicker?.classList.remove("show");
  };

  const statusClass = (status) => {
    if (status === "Completed" || status === "Approved") return "status-green";
    if (status === "Scheduled") return "status-yellow";
    if (status === "Cancelled" || status === "Archived") return "status-red";
    return "status-yellow";
  };

  const appointmentIsArchiveEligible = (appointment) => appointment?.can_archive === true;
  const archiveReason = (appointment) => appointment?.archive_blocked_reason || "Finish the appointment work first.";
  const sortAppointments = (appointments) => [...appointments].sort((a, b) => {
    const closed = item => item.list_group === 'closed';
    const group = Number(closed(a)) - Number(closed(b));
    if (group) return group;
    const stamp = item => toTimestamp((closed(item) && item.work_closed_at) || item.created_at || item.created_at_label);
    return stamp(b) - stamp(a) || toNumericId(b.id || b.reference_no) - toNumericId(a.id || a.reference_no);
  });

  const getDateKey = (year, month, day) =>
    `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const isPastDate = (year, month, day) => {
    const candidate = new Date(year, month, day);
    return candidate < normalizedToday;
  };

  const ensureDayState = (dateKey) => {
    if (!dateKey) return null;
    const day =
      state.calendar.day_settings[dateKey] ||
      (state.calendar.day_settings[dateKey] = {
        date: dateKey,
        is_blocked: false,
        blocked_slots: [],
        events: [],
        custom_slots: [],
      });

    day.blocked_slots = Array.isArray(day.blocked_slots)
      ? day.blocked_slots
      : [];
    day.events = Array.isArray(day.events) ? day.events : [];
    day.custom_slots = Array.isArray(day.custom_slots) ? day.custom_slots : [];
    return day;
  };

  const getMergedSlotsForSelectedDate = () => {
    const globalSlots = [...state.calendar.time_slots];
    if (!selectedDateKey) return globalSlots;

    const day = ensureDayState(selectedDateKey);
    const customSlots = (day?.custom_slots || [])
      .map((slot) => ({
        id: null,
        label: String(slot?.label || "").trim(),
        type: slot?.type === "PM" ? "PM" : "AM",
        sort_order: 999,
        isCustom: true,
      }))
      .filter((slot) => slot.label);

    const seen = new Set(
      globalSlots.map((slot) => `${slot.label}|${slot.type}`),
    );
    customSlots.forEach((slot) => {
      const key = `${slot.label}|${slot.type}`;
      if (!seen.has(key)) {
        globalSlots.push(slot);
        seen.add(key);
      }
    });

    return globalSlots.sort(slotSortComparator);
  };

  const ensureSlotManagerUi = () => {
    if (document.getElementById("adminSlotManager")) return;

    const container = document.createElement("div");
    container.id = "adminSlotManager";
    container.className = "admin-slot-manager";
    container.innerHTML = `
      <label class="admin-slot-manager-label">Global Default System Time Slots: (Affects All Dates)</label>
      <div class="admin-slot-manager-row" style="display: flex; gap: 8px;">
        <button id="btnOpenGlobalTimePicker" type="button" class="btn-admin btn-secondary btn-open-time-picker">Choose Time Slot</button>
        <input id="adminSlotLabel" type="hidden" value="" />
        <input id="adminSlotType" type="hidden" value="AM" />
        <button id="btnSaveSlot" type="button" class="btn-admin" style="white-space: nowrap;">Add Default Slot</button>
      </div>
      <div id="adminSlotList" class="admin-slot-list"></div>
    `;

    const rightPane = document.querySelector(".admin-calendar-right");
    rightPane?.appendChild(container);
  };

  const fetchAppointments = async () => {
    const readVersion = ++appointmentReadVersion;
    const response = await fetch(`${API_BASE_URL}/appointments`, {
      cache: 'no-store',
      headers: { Accept: "application/json",Authorization:"Bearer "+(window.AdminSession?.getToken()||"") },
    });
    if (!response.ok) throw new Error("Failed to fetch appointments");
    const payload = await response.json();
    if (readVersion !== appointmentReadVersion) return;
    const appointments = (Array.isArray(payload?.data) ? payload.data : [])
      .filter(item => String(item.status).toLowerCase() !== 'archived').map(appointment => {
      const savedAppointment = state.appointments.find(item => item.id === appointment.id);
      const saved = savedAppointment?.custom_product;
      const incoming = appointment.custom_product;
      // A list request may have started before an outcome or quotation was saved.
      const olderJob = saved && incoming?.id === saved.id && Number(incoming.revision) < Number(saved.revision);
      const next = olderJob ? { ...appointment, custom_product: saved } : appointment;
      if (olderJob) for (const key of ['list_group', 'work_closed_at', 'can_archive', 'archive_blocked_reason', 'can_confirm_consultation']) next[key] = savedAppointment[key];
      // A delayed list read must not restore a removed link or an older schedule.
      if (savedAppointment && Number(appointment.schedule_version) < Number(savedAppointment.schedule_version)) {
        for (const key of ['appointment_method', 'appointment_date', 'appointment_time', 'meeting_platform', 'meeting_url', 'meeting_status', 'schedule_version', 'can_edit_meeting_link', 'can_remove_meeting_link', 'can_reschedule', 'schedule_history']) next[key] = savedAppointment[key];
      }
      return next;
    });
    // A completed consultation can still have active quotation/product work.
    state.appointments = sortAppointments(appointments);
  };

  const fetchCalendar = async () => {
    const headers = { Accept: "application/json" };
    // This public GET can seed calendar slots. Identify presentation reads so
    // the server can skip that initialization for the spectator account.
    if (window.AdminSession?.isSpectator?.()) {
      const token = window.AdminSession.getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(`${API_BASE_URL}/appointments/calendar`, {
      headers,
    });
    if (!response.ok) throw new Error("Failed to fetch calendar");

    const payload = await response.json();
    const timeSlots = Array.isArray(payload?.time_slots)
      ? payload.time_slots
      : [];
    state.calendar.time_slots = (timeSlots.length ? timeSlots : defaultSlots)
      .map((slot, idx) => ({
        id: slot.id || null,
        label: String(slot.label || ""),
        type: slot.type === "PM" ? "PM" : "AM",
        sort_order: Number(slot.sort_order || idx + 1),
        is_active: slot.is_active !== false,
      }))
      .filter((slot) => slot.label)
      .sort(slotSortComparator)
      .map((slot, index) => ({ ...slot, sort_order: index + 1 }));

    const daySettings = {};
    (Array.isArray(payload?.day_settings) ? payload.day_settings : []).forEach(
      (day) => {
        if (!day?.date) return;
        daySettings[day.date] = {
          date: day.date,
          is_blocked: Boolean(day.is_blocked),
          blocked_slots: Array.isArray(day.blocked_slots)
            ? day.blocked_slots
            : [],
          events: Array.isArray(day.events) ? day.events : [],
          custom_slots: Array.isArray(day.custom_slots) ? day.custom_slots : [],
        };
      },
    );
    state.calendar.day_settings = daySettings;

    state.calendar.booked_slots =
      payload?.booked_slots && typeof payload.booked_slots === "object"
        ? payload.booked_slots
        : {};
  };

  const filteredAppointments = () => {
    const query = (searchInput?.value || "").trim().toLowerCase();
    let source=state.appointments.filter(item => String(item.status).toLowerCase() !== "archived");
    if(document.getElementById('appointmentWorkFilter')?.value==='custom') {
      source=source.filter(a=>!!a.custom_product);
      const service=new URLSearchParams(location.search).get('custom_service');if(service)source=source.filter(a=>a.custom_product.service_name===service);
      const stage=document.getElementById('appointmentProductStageFilter')?.value;
      if(stage&&stage!=='all')source=source.filter(a=>(a.custom_product.progress||a.custom_product.state)===stage);
    }
    if (!query) return source;
    return source.filter((item) => {
      const referenceQuery=query.match(/^#?ap[-\s]*0*(\d+)$/i);
      if(referenceQuery&&Number(referenceQuery[1])===Number(String(item.reference_no||'').replace(/^AP-0*/i,'')))return true;
      const haystack = [
        item.reference_no,
        item.client_name,
        item.contact_number,
        item.email,
        item.full_address,
        item.client_type, item.university_department, item.university_department_label,
        item.purpose,
        item.additional_notes,
        item.custom_product?.requirements?.name,item.custom_product?.service_name,item.custom_product?.stage,
        ...(item.custom_product?.orders||[]).map(order=>order.order_no),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  };

  for(const id of ['appointmentWorkFilter','appointmentProductStageFilter'])document.getElementById(id)?.addEventListener('change',()=>{
    document.getElementById('appointmentProductStageFilter').hidden=document.getElementById('appointmentWorkFilter').value!=='custom';
    searchInput?.dispatchEvent(new Event('input',{bubbles:true}));
  });
  window.addEventListener('fmrc:custom-product-updated',event=>{
    const job=event.detail?.job;if(!job)return;state.appointments=state.appointments.map(a=>a.id===job.appointment_id||a.custom_product?.id===job.id?{...a,custom_product:job}:a);renderTable();
  });
  const calculateRowsPerPage = () => {
    return window.AdminTablePagination?.PAGE_SIZE || 10;
  };

  /**
   * File Attach cell/field. Images and videos open in the shared
   * AdminMediaViewer; PDFs and documents open in a new tab. Never forces a
   * download — clicking should show the file.
   *
   * @param {object} appointment
   * @param {{emptyHtml?: string, withThumb?: boolean}} [options]
   */
  const attachmentHtml = (appointment, options = {}) => {
    const emptyHtml = options.emptyHtml ?? "--";
    if(appointment.attachments?.length)return window.AdminAppointmentDetails?.files(appointment, options)||emptyHtml;
    const fileName = safe(appointment.attachment_name);
    const fileUrl = String(appointment.attachment_url || "").trim();

    if (window.AdminTableValue.missing(appointment.attachment_name)) return emptyHtml;
    if (!fileUrl) return `<span class="photo-link">${fileName}</span>`;

    const kind =
      window.AdminMediaViewer?.resolveType(fileUrl, fileName) || "file";
    const safeUrl = escapeAttribute(fileUrl);
    const safeName = escapeAttribute(fileName);

    if (kind === "file") {
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="photo-link" title="Open ${safeName}">${fileName}</a>`;
    }

    const preview =
      kind === "image" && options.withThumb !== false
        ? `<img src="${safeUrl}" alt="" loading="lazy" />`
        : `<span class="admin-media-thumb-icon" aria-hidden="true"><i class="fa-solid fa-${kind === "video" ? "circle-play" : "image"}"></i></span>`;

    return `<button type="button" class="admin-media-thumb" data-media-url="${safeUrl}" data-media-name="${safeName}" data-media-type="${kind}" title="View ${safeName}">
        ${preview}<span class="admin-media-thumb-name">${fileName}</span>
      </button>`;
  };

  const renderTable = () => {
    if (!tableBody) return;

    const source = filteredAppointments();
    const rowsPerPage = calculateRowsPerPage();
    const pageCount = Math.max(1, Math.ceil(source.length / rowsPerPage));
    if (currentPage > pageCount) currentPage = pageCount;

    const start = (currentPage - 1) * rowsPerPage;
    const pagedItems = source.slice(start, start + rowsPerPage);

    tableBody.innerHTML = pagedItems
      .map((item) => {
        const fileCell = attachmentHtml(item);

        const canArchive = appointmentIsArchiveEligible(item);
        const archiveTitle = canArchive
          ? "Archive Appointment"
          : escapeAttribute(archiveReason(item));
        const archiveButton = `<button
              type="button"
              class="${canArchive ? "" : "is-disabled"}"
              data-tooltip="${archiveTitle}"
              data-archive-id="${item.id}"
              ${canArchive ? "" : 'disabled aria-disabled="true"'}
            ><i class="fa-solid fa-box-archive"></i></button>`;

        return `<tr>
          <td class="admin-bulk-select-cell"><input type="checkbox" data-admin-bulk-row="appointments" value="${item.id}" aria-label="Select ${formatApNo(item.reference_no)}" /></td>
          <td>${window.AdminTableValue.html(item.reference_no)}</td>
          <td title="${window.AdminTableValue.html(item.client_name)}">${window.AdminTableValue.html(item.client_name)}</td>
          <td>${window.AdminTableValue.html(item.contact_number)}</td>
          <td>${window.AdminTableValue.html(item.email)}</td>
          <td title="${window.AdminTableValue.html(item.full_address)}">${window.AdminTableValue.html(item.full_address)}</td>
          <td>${window.AdminTableValue.html(item.client_type)}</td>
          <td>${window.AdminTableValue.html(item.purpose)}</td>
          <td>${fileCell}</td>
          <td title="${window.AdminTableValue.html(item.additional_notes)}">${window.AdminTableValue.html(item.additional_notes)}</td>
          <td>${window.AdminTableValue.missing(item.appointment_date) ? "--" : prettyDate(item.appointment_date)}</td>
          <td>${window.AdminTableValue.html(item.appointment_time)}</td>
          <td><span class="status-pill ${statusClass(item.status)}">${item.custom_product?'Consultation: ':''}${window.AdminTableValue.html(item.status)}</span></td>
          <td class="action-icons sticky-action">
            <button type="button" data-tooltip="View Appointment" data-view-id="${item.id}"><i class="fa-regular fa-eye"></i></button>
            ${archiveButton}
          </td>
        </tr>`;
      })
      .join("");

    if (!pagedItems.length) {
      tableBody.innerHTML = `<tr class="table-empty-row"><td colspan="14"><div class="table-empty-state"><i class="fa-regular fa-folder-open"></i><span>No appointment records found.</span></div></td></tr>`;
    }

    if (tableMeta) {
      tableMeta.textContent = window.AdminTablePagination.label(currentPage, source.length, rowsPerPage);
    }

    if (currentPageEl) {
      currentPageEl.value = String(currentPage);
      currentPageEl.max = String(pageCount);
    }
    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= pageCount;
    appointmentBulkController?.sync();
  };

  const setupAppointmentBulkSelection = () => {
    appointmentBulkController = window.AdminBulkSelection?.create({
      key: "appointments",
      table: appointmentsTable,
      footer: appointmentsTableFooter,
      tableLabel: "Client Appointments",
      getEligibleRows: () =>
        filteredAppointments().filter(appointmentIsArchiveEligible),
      getPageRows: () => {
        const rowsPerPage = calculateRowsPerPage();
        const start = (currentPage - 1) * rowsPerPage;
        return filteredAppointments().slice(start, start + rowsPerPage);
      },
      idleAction: {
        label: "Select appointments to archive",
        icon: "fa-box-archive",
      },
      actions: [
        {
          key: "archive",
          label: "Archive selected appointments",
          icon: "fa-box-archive",
          onClick: (ids, controller) => {
            window.runAdminBulkAction?.({
              controller,
              ids,
              action: "archive",
              tableLabel: "Client Appointments records",
              loadingText: "Archiving...",
              execute: async (selectedIds) => {
                const authToken =
                  window.AdminSession?.getToken?.() ||
                  localStorage.getItem("auth_token") ||
                  localStorage.getItem("admin_auth_token") ||
                  localStorage.getItem("staff_auth_token") ||
                  "";
                const response = await fetch(
                  `${API_BASE_URL}/appointments/archive-bulk`,
                  {
                    method: "PATCH",
                    headers: {
                      Authorization: `Bearer ${authToken}`,
                      Accept: "application/json",
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ ids: selectedIds }),
                  },
                );
                const payload = await response.json().catch(() => ({}));
                if (!response.ok) {
                  throw new Error(
                    payload?.message ||
                      "Failed to archive selected appointments.",
                  );
                }
                forgetArchivedAppointments(payload.processed_ids || []);
                return payload;
              },
              afterSuccess: async () => {
                window.dispatchEvent(
                  new CustomEvent("fmrc:appointments-updated", {
                    detail: { type: "archived-bulk" },
                  }),
                );
                await refreshAll();
              },
            });
          },
        },
      ],
    });
  };

  const updateDayButtonState = () => {
    if (!btnToggleBlockDay) return;
    if (!selectedDateKey) {
      btnToggleBlockDay.disabled = true;
      btnToggleBlockDay.textContent = "Block Whole Day";
      return;
    }

    const day = state.calendar.day_settings[selectedDateKey];
    btnToggleBlockDay.disabled = false;
    btnToggleBlockDay.textContent = day?.is_blocked
      ? "Unblock Whole Day"
      : "Block Whole Day";
  };

  const updateDateIndicators = (cell, dateKey) => {
    const day = state.calendar.day_settings[dateKey] || {
      is_blocked: false,
      blocked_slots: [],
      events: [],
    };

    const bookedSlots = state.calendar.booked_slots[dateKey] || [];
    const totalSlots = [
      ...new Set([...(day.blocked_slots || []), ...bookedSlots]),
    ];
    const hasAM = totalSlots.some((slot) => String(slot).includes("AM"));
    const hasPM = totalSlots.some((slot) => String(slot).includes("PM"));

    cell.classList.remove("has-am", "has-pm", "has-full", "admin-blocked-day");

    if (day.is_blocked) {
      cell.classList.add("admin-blocked-day", "has-full");
      cell.setAttribute("title", "Blocked whole day by admin");
      return;
    }

    if (hasAM && hasPM) {
      cell.classList.add("has-full");
      cell.setAttribute("title", "AM and PM have blocked/booked slots");
    } else if (hasAM) {
      cell.classList.add("has-am");
      cell.setAttribute("title", "AM has blocked/booked slots");
    } else if (hasPM) {
      cell.classList.add("has-pm");
      cell.setAttribute("title", "PM has blocked/booked slots");
    } else if (day.events.length) {
      cell.setAttribute("title", `Event: ${day.events.join(", ")}`);
    } else {
      cell.setAttribute("title", "Available");
    }
  };

  const renderCalendar = () => {
    if (!calGrid || !monthDisplay) return;

    calGrid.innerHTML = "";
    monthDisplay.textContent = `${months[currentMonth]} ${currentYear}`;

    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

    for (let i = 0; i < firstDay; i += 1) {
      const emptyCell = document.createElement("div");
      calGrid.appendChild(emptyCell);
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const cell = document.createElement("div");
      cell.classList.add("cal-day-cell");
      cell.textContent = String(day);

      const dateKey = getDateKey(currentYear, currentMonth, day);
      const dateObj = new Date(currentYear, currentMonth, day);
      const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;

      if (isWeekend || isPastDate(currentYear, currentMonth, day)) {
        cell.classList.add("disabled", "unavailable");
        cell.setAttribute(
          "title",
          isWeekend ? "Unavailable: Weekend" : "Unavailable: Past Date",
        );
      } else {
        cell.addEventListener("click", () => {
          selectedDateKey = dateKey;
          selectedDateDisplay.textContent = `${months[currentMonth]} ${day}, ${currentYear}`;
          renderCalendar();
          renderTimeSlots();
          renderEvents();
          renderDaySlotList();
        });
      }

      if (dateKey === selectedDateKey) cell.classList.add("selected");
      updateDateIndicators(cell, dateKey);
      calGrid.appendChild(cell);
    }

    updateDayButtonState();
  };

  const renderTimeSlots = () => {
    if (!timeSlotsContainer) return;
    const summaryContainer = document.getElementById("adminDateSummary");

    if (!selectedDateKey) {
      timeSlotsContainer.innerHTML =
        '<p class="time-placeholder">Please pick a date first.</p>';
      if (summaryContainer) {
        summaryContainer.style.display = "none";
        summaryContainer.innerHTML = "";
      }
      updateDayButtonState();
      return;
    }

    const day = ensureDayState(selectedDateKey);

    timeSlotsContainer.innerHTML = "";
    const sortedSlots = getMergedSlotsForSelectedDate();

    // For date summary
    let summaryHtml = `<strong>Current Time Slots for ${selectedDateKey}:</strong><ul style="margin: 5px 0 0 15px; padding: 0;">`;
    const bookedForDay = state.calendar.booked_slots
      ? state.calendar.booked_slots[selectedDateKey] || []
      : [];

    if (day.is_blocked) {
      summaryHtml += `<li><span style="color: #b01c1c;">Whole day is blocked.</span></li>`;
    }

    sortedSlots.forEach((slot) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "time-slot-btn";
      button.innerHTML = `<span>${slot.label}</span><span class="time-slot-label">${slot.type}</span>`;

      const isBlocked = day.blocked_slots.includes(slot.label);
      const isBooked = bookedForDay.includes(slot.label);

      let statusText = "Available";
      if (day.is_blocked || isBlocked)
        statusText = '<span style="color: #b01c1c;">Admin Blocked</span>';
      else if (isBooked)
        statusText =
          '<strong style="color: #0f7b35;">Booked by Client</strong>';

      if (!day.is_blocked) {
        summaryHtml += `<li>${slot.label} (${slot.type}) - ${statusText}</li>`;
      }

      if (isBlocked) button.classList.add("selected");
      if (isBooked) button.classList.add("disabled", "admin-forced-disabled");
      if (day.is_blocked) {
        button.disabled = true;
        button.classList.add("disabled", "admin-forced-disabled");
      }

      if (!day.is_blocked && !isBooked) {
        button.addEventListener("click", () => {
          const daySettings = ensureDayState(selectedDateKey);

          if (daySettings.blocked_slots.includes(slot.label)) {
            daySettings.blocked_slots = daySettings.blocked_slots.filter(
              (s) => s !== slot.label,
            );
          } else {
            daySettings.blocked_slots.push(slot.label);
          }

          renderCalendar();
          renderTimeSlots();
        });
      }

      timeSlotsContainer.appendChild(button);
    });

    summaryHtml += `</ul>`;
    if (summaryContainer) {
      summaryContainer.style.display = "block";
      summaryContainer.innerHTML = summaryHtml;
    }

    updateDayButtonState();
  };

  const renderEvents = () => {
    if (!adminEventList) return;
    adminEventList.innerHTML = "";
    if (!selectedDateKey) return;

    const daySettings = ensureDayState(selectedDateKey);

    daySettings.events.forEach((eventText, index) => {
      const item = document.createElement("div");
      item.className = "admin-event-item";
      item.innerHTML = `<span>${eventText}</span><button type="button" class="admin-event-remove">X</button>`;
      item.querySelector("button")?.addEventListener("click", () => {
        daySettings.events.splice(index, 1);
        state.calendar.day_settings[selectedDateKey] = daySettings;
        renderEvents();
        renderCalendar();
      });
      adminEventList.appendChild(item);
    });
  };

  const collectCalendarPayload = () => {
    const sortedSlots = [...state.calendar.time_slots]
      .filter((slot) => String(slot.label || "").trim())
      .sort(slotSortComparator)
      .map((slot, index) => ({
        id: slot.id || null,
        label: String(slot.label).trim(),
        type: slot.type === "PM" ? "PM" : "AM",
        sort_order: index + 1,
        is_active: slot.is_active !== false,
      }));

    const daySettings = Object.keys(state.calendar.day_settings)
      .sort()
      .map((date) => {
        const day = state.calendar.day_settings[date];
        return {
          date,
          is_blocked: Boolean(day?.is_blocked),
          blocked_slots: Array.isArray(day?.blocked_slots)
            ? day.blocked_slots
            : [],
          events: Array.isArray(day?.events) ? day.events : [],
          custom_slots: Array.isArray(day?.custom_slots)
            ? day.custom_slots
                .map((slot) => ({
                  label: String(slot?.label || "").trim(),
                  type: slot?.type === "PM" ? "PM" : "AM",
                }))
                .filter((slot) => slot.label)
            : [],
        };
      })
      .filter(
        (day) =>
          day.is_blocked ||
          day.blocked_slots.length ||
          day.events.length ||
          day.custom_slots.length,
      );

    return {
      time_slots: sortedSlots,
      day_settings: daySettings,
    };
  };

  const saveCalendarChanges = async () => {
    const payload = collectCalendarPayload();

    const response = await fetch(`${API_BASE_URL}/appointments/calendar`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = result?.message || "Unable to save calendar changes.";
      window.showAdminPopup?.(message, { title: "Save Failed" });
      return;
    }

    window.showAdminPopup?.("Calendar changes saved successfully.", {
      title: "Saved",
      onOk: () => {
        modalCalendar?.classList.remove("show");
      },
    });
    await fetchCalendar();
    renderCalendar();
    renderTimeSlots();
    renderEvents();
    renderDaySlotList();
    renderSlotManager();
  };

  // ─── Appointment View Modal ─────────────────────────────────────────────────
  // A nested confirmation must not unlock the page beneath Appointment details.
  let lockedPagePosition = null;
  const syncAppointmentScrollLock = () => {
    const detailsOpen = document.getElementById('modalViewAppointment')?.classList.contains('show');
    const nestedOpen = ['modalCompleteAppointment', 'modalArchiveAppointment'].some(id => document.getElementById(id)?.classList.contains('show'));
    if (detailsOpen && !lockedPagePosition) {
      lockedPagePosition = { x: window.scrollX, y: window.scrollY };
      document.documentElement.classList.add('appointment-details-open');
    } else if (lockedPagePosition && !detailsOpen && !nestedOpen) {
      const position = lockedPagePosition;
      lockedPagePosition = null;
      document.documentElement.classList.remove('appointment-details-open');
      window.scrollTo({ left: position.x, top: position.y, behavior: 'instant' });
    }
  };
  const appointmentScrollObserver = new MutationObserver(syncAppointmentScrollLock);
  for (const id of ['modalViewAppointment', 'modalCompleteAppointment', 'modalArchiveAppointment']) {
    const overlay = document.getElementById(id);
    if (overlay) appointmentScrollObserver.observe(overlay, { attributes: true, attributeFilter: ['class'] });
  }
  window.addEventListener('scroll', () => {
    if (lockedPagePosition && (window.scrollX !== lockedPagePosition.x || window.scrollY !== lockedPagePosition.y)) {
      window.scrollTo({ left: lockedPagePosition.x, top: lockedPagePosition.y, behavior: 'instant' });
    }
  }, { passive: true });

  const openAppointmentViewModal = (appt) => {
    const modal = document.getElementById("modalViewAppointment");
    if (!modal) return;
    const body = document.getElementById("apptViewBody");
    const sameAppointment = viewingAppointment?.id === appt.id && modal.classList.contains("show");
    if(sameAppointment && window.FMRCAppointmentProducts?.isDirty(body))return;
    if(sameAppointment && JSON.stringify(viewingAppointment)===JSON.stringify(appt))return;
    const productPanel = sameAppointment ? body?.querySelector("[data-ap-appointment]") : null;
    const conversationLog = productPanel?.querySelector('[data-ap-chat-log]');
    const conversationTop = conversationLog?.scrollTop;
    const conversationAtBottom = conversationLog && conversationLog.scrollHeight-conversationLog.clientHeight-conversationTop<64;
    const scrollTop = sameAppointment ? body?.scrollTop || 0 : 0;
    const focused = sameAppointment && body?.contains(document.activeElement) ? document.activeElement : null;
    const focusForm = focused?.closest("[data-ap-form]")?.dataset.apForm;
    const focusName = focused?.getAttribute("name");
    const selection = focused && typeof focused.selectionStart === "number" ? [focused.selectionStart,focused.selectionEnd] : null;
    viewingAppointment = appt;

    const archiveFromViewButton = document.getElementById("btnArchiveFromView");
    const canArchive = appointmentIsArchiveEligible(appt);
    const archiveHelp = document.getElementById('appointmentArchiveReason');
    if (archiveHelp) archiveHelp.textContent = canArchive || appt.status === 'Archived' ? '' : archiveReason(appt);
    if (archiveFromViewButton) {
      archiveFromViewButton.disabled = !canArchive;
      archiveFromViewButton.setAttribute("aria-disabled", String(!canArchive));
      archiveFromViewButton.title = canArchive
        ? "Archive appointment"
        : archiveReason(appt);
    }

    const display = (value, fallback = "Not provided") => escapeAttribute(String(value ?? "").trim() || fallback);
    const fullName = display(appt.client_name);
    const apNo = display(appt.reference_no, formatApNo(appt.reference_no));
    const status = safe(appt.status);
    const statusCls = statusClass(status);
    const fileHtml = attachmentHtml(appt, {
      emptyHtml: '<p class="appt-view-empty">No design files were submitted.</p>',
      detailed: true,
    });

    if (body) {
      body.innerHTML = `
        <div class="appt-view-header-row">
          <div class="appt-view-avatar" aria-hidden="true">${escapeAttribute(String(appt.client_name || "?").trim().charAt(0).toUpperCase())}</div>
          <div class="appt-view-title-block">
            <h4 class="appt-view-name">${fullName}</h4>
            <span class="appt-view-ref">${apNo}</span>
          </div>
          <span class="status-pill ${statusCls}">${display(status)}</span>
        </div>
        <section class="appt-details-section">
          <div class="appt-details-section-heading"><h4>Appointment schedule</h4><p>All schedules use Philippine time (UTC+8).</p></div>
          <dl class="appt-view-grid">
          <div class="appt-view-field">
            <dt>Date</dt><dd>${display(prettyDate(appt.appointment_date))}</dd>
          </div>
          <div class="appt-view-field">
            <dt>Time</dt><dd>${display(appt.appointment_time)}</dd>
          </div>
          <div class="appt-view-field full">
            <dt>Purpose / service</dt><dd>${display(appt.purpose)}</dd>
          </div>
          </dl>
        </section>
        ${!appt.custom_product ? `<section class="appt-details-section appt-consultation-section">
          <div class="appt-details-section-heading"><h4>Confirm consultation</h4>
            <p>${appt.status === 'Completed' || appt.status === 'Archived' ? 'This consultation is complete.' : appt.status === 'Cancelled' ? 'This consultation was cancelled.' : 'Confirm after the meeting has taken place.'}</p></div>
          ${appt.can_confirm_consultation === true ? '<div class="appointment-meeting-actions"><button class="btn-admin" type="button" data-confirm-consultation>Confirm consultation</button></div>' : ''}
        </section>` : ''}
        <section class="appt-details-section">
          <div class="appt-details-section-heading"><h4>Client information</h4></div>
          <dl class="appt-view-grid">
          <div class="appt-view-field">
            <dt>Contact number</dt><dd>${display(appt.contact_number)}</dd>
          </div>
          <div class="appt-view-field">
            <dt>Email address</dt><dd>${display(appt.email)}</dd>
          </div>
          <div class="appt-view-field">
            <dt>Client type</dt><dd>${display(appt.client_type)}</dd>
          </div>
          ${appt.client_type==='UCN College / Department'?`<div class="appt-view-field full"><dt>College / Department</dt><dd>${display(appt.university_department_label)}</dd></div>`:''}
          <div class="appt-view-field full">
            <dt>Address</dt><dd>${display(appt.full_address)}</dd>
          </div>
          </dl>
        </section>
        <section class="appt-details-section">
          <div class="appt-details-section-heading"><h4>Additional notes</h4></div>
          <p class="appt-view-notes">${display(appt.additional_notes, "No additional notes were provided.")}</p>
        </section>
        ${appt.client_type==='UCN College / Department'?`<section class="appt-details-section"><div class="appt-details-section-heading"><h4>Purchase Request (PR)</h4><p>Private request document submitted by the college or department.</p></div><div class="appt-view-files">${window.AdminAppointmentDetails?.files(appt,{detailed:true,kind:'purchase_request'})||'<p class="appt-view-empty">No PR submitted.</p>'}</div></section>`:''}
        <section class="appt-details-section">
          <div class="appt-details-section-heading"><h4>Supporting design files</h4><p>Private files submitted for this appointment.</p></div>
          <div class="appt-view-files">${fileHtml}</div>
        </section>`;
      // Reuse the live editor so polling retains its tabs, disclosures and files.
      if(productPanel)body.querySelector(".appt-view-header-row").after(productPanel);
    }

    window.AdminAppointmentDetails?.render(appt,body);
    modal.classList.add("show");
    syncAppointmentScrollLock();
    if(sameAppointment && body){
      const target=focused?.isConnected ? focused : focusForm && focusName ? body.querySelector(`[data-ap-form="${CSS.escape(focusForm)}"] [name="${CSS.escape(focusName)}"]`) : null;
      target?.focus({preventScroll:true});
      if(target && selection && typeof target.setSelectionRange === "function")target.setSelectionRange(...selection);
      body.scrollTop=scrollTop;
      if(conversationLog?.isConnected)conversationLog.scrollTo({top:conversationAtBottom?conversationLog.scrollHeight:conversationTop,behavior:'instant'});
    }
  };

  window.addEventListener("fmrc:appointment-updated",event=>{const item=event.detail?.appointment;if(!item)return;++appointmentReadVersion;state.appointments=sortAppointments(state.appointments.map(row=>row.id===item.id?item:row));renderTable();if(viewingAppointment?.id===item.id)openAppointmentViewModal(item);});

  ["btnCloseApptView", "btnCloseApptView2"].forEach(id => document.getElementById(id)?.addEventListener("click", async () => {
    if(window.FMRCAppointmentProducts&&!await window.FMRCAppointmentProducts.allowLeave(document.getElementById("apptViewBody")))return;
    document.getElementById("modalViewAppointment")?.classList.remove("show");
    viewingAppointment = null;
  }));

  document
    .getElementById("btnArchiveFromView")
    ?.addEventListener("click", () => {
      if (viewingAppointment && appointmentIsArchiveEligible(viewingAppointment)) {
        document.getElementById("modalViewAppointment")?.classList.remove("show");
        openAppointmentArchiveModal(viewingAppointment);
      }
    });

  // ─── Appointment Archive Modal ──────────────────────────────────────────────
  const openAppointmentArchiveModal = (appt) => {
    if (archiveRequestPending || archivingAppointmentId !== null) return;
    if (!appointmentIsArchiveEligible(appt)) {
      window.showAdminPopup?.(
        archiveReason(appt),
        { title: "Archive Unavailable" },
      );
      return;
    }
    archivingAppointmentId = appt.id;
    const labelEl = document.getElementById("archiveAppointmentTargetLabel");
    if (labelEl)
      labelEl.textContent = `${formatApNo(appt.reference_no)} – ${safe(appt.client_name)}`;
    document.getElementById("modalArchiveAppointment")?.classList.add("show");
  };

  document
    .getElementById("btnCancelArchiveAppt")
    ?.addEventListener("click", () => {
      if (archiveRequestPending) return;
      document
        .getElementById("modalArchiveAppointment")
        ?.classList.remove("show");
      archivingAppointmentId = null;
    });

  document
    .getElementById("btnConfirmArchiveAppt")
    ?.addEventListener("click", async () => {
      if (!archivingAppointmentId || archiveRequestPending) return;
      const appointmentId = archivingAppointmentId;
      archiveRequestPending = true;
      const cancelBtn = document.getElementById("btnCancelArchiveAppt");
      if (cancelBtn) cancelBtn.disabled = true;

      const confirmBtn = document.getElementById("btnConfirmArchiveAppt");
      if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML =
          '<i class="fa-solid fa-spinner fa-spin"></i> Archiving…';
      }

      const token =
        (window.AdminSession && window.AdminSession.getToken()) ||
        localStorage.getItem("auth_token") ||
        localStorage.getItem("admin_auth_token") ||
        "";

      try {
        const res = await fetch(
          `${API_BASE_URL}/appointments/${appointmentId}/archive`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
            },
          },
        );

        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          window.showAdminPopup?.(
            payload?.message || "Failed to archive appointment.",
            { title: "Archive Failed" },
          );
          return;
        }

        document
          .getElementById("modalArchiveAppointment")
          ?.classList.remove("show");
        archivingAppointmentId = null;
        forgetArchivedAppointments([appointmentId]);
        await refreshAll();
        setTimeout(() => {
          window.showAdminPopup?.(
            "Appointment has been archived and moved to the Archives page.",
            { title: "Archived ✓" },
          );
        }, 200);
      } catch (err) {
        console.error("Archive appointment error:", err);
        window.showAdminPopup?.("Connection lost. Please try again.", {
          title: "Error",
        });
      } finally {
        archiveRequestPending = false;
        if (cancelBtn) cancelBtn.disabled = false;
        if (confirmBtn) {
          confirmBtn.disabled = false;
          confirmBtn.innerHTML =
            '<i class="fa-solid fa-box-archive"></i> Archive';
        }
      }
    });

  const refreshAll = async () => {
    try {
      const isCalendarOpen = modalCalendar?.classList.contains("show");

      if (
        tableBody &&
        (!tableBody.children.length ||
          tableBody.querySelector(".table-empty-state"))
      ) {
        const usedSharedSkeleton = window.AdminTableSkeleton?.show(tableBody, {
          rows: 3,
          columns: 14,
        });
        if (!usedSharedSkeleton) {
          const cells = Array.from(
            { length: 14 },
            () => '<td><span class="admin-table-skeleton-bar"></span></td>',
          ).join("");
          tableBody.innerHTML =
            `<tr class="admin-table-skeleton-row" aria-hidden="true">${cells}</tr>`.repeat(
              3,
            );
        }
      }

      const tasks = [fetchAppointments()];
      if (!isCalendarOpen) {
        tasks.push(fetchCalendar());
      }

      await Promise.all(tasks);
      renderTable();
      const linkedId=new URLSearchParams(location.search).get('appointment_id');
      if(linkedId&&!state.productDeepLinkOpened){
        let linked=state.appointments.find(a=>String(a.id)===linkedId);
        if(!linked){const result=await fetch(`${API_BASE_URL}/admin/appointments/${encodeURIComponent(linkedId)}`,{cache:'no-store',headers:{Accept:'application/json',Authorization:'Bearer '+(window.AdminSession?.getToken()||'')}});if(!result.ok)throw Error('The linked appointment could not be opened.');linked=(await result.json()).data;}
        if(linked){state.productDeepLinkOpened=true;openAppointmentViewModal(linked);}
      }

      if (!isCalendarOpen) {
        renderCalendar();
        renderTimeSlots();
        renderEvents();
        renderSlotManager();
      }
    } catch (error) {
      if (tableBody?.querySelector(".admin-table-skeleton-row")) {
        tableBody.innerHTML = `
          <tr class="table-empty-row">
            <td colspan="14">
              <div class="table-empty-state">
                <i class="fa-solid fa-triangle-exclamation"></i>
                <span>Unable to load appointments. Please try again.</span>
              </div>
            </td>
          </tr>`;
      }
      window.AdminTableSkeleton?.finish(tableBody);
      if (tableMeta) tableMeta.textContent = "Unable to load appointments.";
      window.showAdminPopup?.(
        error?.message || "Unable to load appointments. Please try again.",
        { title: "Load Failed" },
      );
    }
  };

  const renderSlotManager = () => {
    const list = document.getElementById("adminSlotList");
    if (!list) return;

    const slots = [...state.calendar.time_slots].sort(slotSortComparator);

    list.innerHTML = slots
      .map((slot) => {
        const key = slot.id || slot.sort_order;
        return `<div class="admin-slot-list-item">
          <span class="admin-slot-list-text">${slot.label} <strong class="admin-slot-list-type">${slot.type}</strong></span>
          <span class="admin-slot-list-actions">
            <button type="button" class="btn-admin btn-secondary admin-slot-inline-btn" data-slot-edit="${key}">Edit</button>
            <button type="button" class="btn-admin admin-slot-inline-btn admin-slot-remove-btn" data-slot-remove="${key}">Remove</button>
          </span>
        </div>`;
      })
      .join("");
  };

  const renderDaySlotList = () => {
    if (!adminDaySlotList) return;
    if (!selectedDateKey) {
      adminDaySlotList.innerHTML =
        '<p class="field-hint">Select a date first.</p>';
      return;
    }

    const day = ensureDayState(selectedDateKey);
    const slots = day.custom_slots || [];

    if (!slots.length) {
      adminDaySlotList.innerHTML =
        '<p class="field-hint">No day-specific slots yet.</p>';
      return;
    }

    adminDaySlotList.innerHTML = slots
      .map(
        (slot, index) => `
          <div class="admin-slot-list-item">
            <span class="admin-slot-list-text">${slot.label} <strong class="admin-slot-list-type">${slot.type}</strong></span>
            <span class="admin-slot-list-actions">
              <button type="button" class="btn-admin admin-slot-inline-btn admin-slot-remove-btn" data-day-slot-remove="${index}">Remove</button>
            </span>
          </div>`,
      )
      .join("");
  };

  const resetSlotForm = () => {
    editingSlotId = null;
    const label = document.getElementById("adminSlotLabel");
    const type = document.getElementById("adminSlotType");
    if (label) label.value = "";
    if (type) type.value = "AM";
    updateTimePickerButton("btnOpenGlobalTimePicker", "Choose Time Slot");
  };

  const saveSlotFromForm = () => {
    const labelInput = document.getElementById("adminSlotLabel");
    const typeInput = document.getElementById("adminSlotType");
    const label = labelInput?.value?.trim() || "";
    const type = typeInput?.value === "PM" ? "PM" : "AM";

    if (!label) {
      alert("Please choose a time slot first.");
      return;
    }

    if (editingSlotId) {
      const slot = state.calendar.time_slots.find(
        (item) => String(item.id || item.sort_order) === String(editingSlotId),
      );
      if (slot) {
        slot.label = label;
        slot.type = type;
      }
    } else {
      state.calendar.time_slots.push({
        id: null,
        label,
        type,
        sort_order: state.calendar.time_slots.length + 1,
        is_active: true,
      });
    }

    state.calendar.time_slots = state.calendar.time_slots
      .sort(slotSortComparator)
      .map((slot, index) => ({ ...slot, sort_order: index + 1 }));

    resetSlotForm();
    renderSlotManager();
    renderTimeSlots();
    renderCalendar();
  };

  const removeSlot = (slotKey) => {
    const toRemove = state.calendar.time_slots.find(
      (slot) => String(slot.id || slot.sort_order) === String(slotKey),
    );
    if (!toRemove) return;

    state.calendar.time_slots = state.calendar.time_slots
      .filter((slot) => String(slot.id || slot.sort_order) !== String(slotKey))
      .map((slot, index) => ({ ...slot, sort_order: index + 1 }));

    Object.keys(state.calendar.day_settings).forEach((date) => {
      const day = state.calendar.day_settings[date];
      day.blocked_slots = (day.blocked_slots || []).filter(
        (slot) => slot !== toRemove.label,
      );
      state.calendar.day_settings[date] = day;
    });

    if (editingSlotId && String(editingSlotId) === String(slotKey)) {
      resetSlotForm();
    }

    renderSlotManager();
    renderTimeSlots();
    renderCalendar();
  };

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const editBtn = target.closest("[data-slot-edit]");
    if (editBtn) {
      const key = String(editBtn.getAttribute("data-slot-edit") || "");
      const slot = state.calendar.time_slots.find(
        (item) => String(item.id || item.sort_order) === key,
      );
      if (!slot) return;
      editingSlotId = key;
      openTimePicker({
        context: "global",
        title: "Edit Global Time Slot",
        label: slot.label,
        type: slot.type,
      });
      return;
    }

    const removeBtn = target.closest("[data-slot-remove]");
    if (removeBtn) {
      const key = String(removeBtn.getAttribute("data-slot-remove") || "");
      removeSlot(key);
      return;
    }

    const removeDayBtn = target.closest("[data-day-slot-remove]");
    if (removeDayBtn && selectedDateKey) {
      const index = Number(removeDayBtn.getAttribute("data-day-slot-remove"));
      const day = ensureDayState(selectedDateKey);
      day.custom_slots.splice(index, 1);
      renderDaySlotList();
      renderTimeSlots();
      renderCalendar();
    }

    // ─── View Appointment ────────────────────────────────────────────────────
    const viewBtn = target.closest("[data-view-id]");
    if (viewBtn) {
      const id = viewBtn.getAttribute("data-view-id");
      const appt = state.appointments.find((a) => String(a.id) === String(id));
      if (appt) openAppointmentViewModal(appt);
      return;
    }

    // Ordinary consultations are confirmed from their open details only.
    if (target.closest("[data-confirm-consultation]")) {
      if (viewingAppointment?.can_confirm_consultation === true && !viewingAppointment.custom_product) openConfirmConsultation(viewingAppointment);
      return;
    }

    // ─── Archive Appointment ─────────────────────────────────────────────────
    const archiveBtn = target.closest("[data-archive-id]");
    if (archiveBtn) {
      const id = archiveBtn.getAttribute("data-archive-id");
      const appt = state.appointments.find((a) => String(a.id) === String(id));
      if (appt) openAppointmentArchiveModal(appt);
      return;
    }
  });

  prevBtn?.addEventListener("click", () => {
    if (currentPage <= 1) return;
    currentPage -= 1;
    renderTable();
  });

  nextBtn?.addEventListener("click", () => {
    currentPage += 1;
    renderTable();
  });

  window.AdminPageNumberInput?.bind(currentPageEl, {
    getPage: () => currentPage,
    getTotalPages: () =>
      Math.max(
        1,
        Math.ceil(filteredAppointments().length / calculateRowsPerPage()),
      ),
    onChange: (page) => {
      currentPage = page;
      renderTable();
    },
  });

  searchInput?.addEventListener("input", () => {
    currentPage = 1;
    renderTable();
  });

  btnToggleBlockDay?.addEventListener("click", () => {
    if (!selectedDateKey) return;
    const day = ensureDayState(selectedDateKey);

    day.is_blocked = !day.is_blocked;
    state.calendar.day_settings[selectedDateKey] = day;
    renderCalendar();
    renderTimeSlots();
    renderEvents();
  });

  btnClearDayBlocks?.addEventListener("click", () => {
    if (!selectedDateKey) return;
    const day = ensureDayState(selectedDateKey);

    day.is_blocked = false;
    day.blocked_slots = [];
    day.events = [];
    day.custom_slots = [];
    state.calendar.day_settings[selectedDateKey] = day;

    renderCalendar();
    renderTimeSlots();
    renderEvents();
    renderDaySlotList();
  });

  btnAddStaticEvent?.addEventListener("click", () => {
    if (!selectedDateKey) {
      alert("Please pick a date first.");
      return;
    }

    const eventText = adminEventInput?.value?.trim() || "";
    if (!eventText) return;

    const day = ensureDayState(selectedDateKey);

    day.events.push(eventText);
    state.calendar.day_settings[selectedDateKey] = day;
    if (adminEventInput) adminEventInput.value = "";
    renderEvents();
    renderCalendar();
    renderTimeSlots();
  });

  btnAddDaySlot?.addEventListener("click", () => {
    if (!selectedDateKey) {
      alert("Please pick a date first.");
      return;
    }

    const label = String(adminDaySlotLabel?.value || "").trim();
    const type = adminDaySlotType?.value === "PM" ? "PM" : "AM";
    if (!label) {
      alert("Please choose a day-specific time slot first.");
      return;
    }

    const day = ensureDayState(selectedDateKey);
    const duplicate = day.custom_slots.some(
      (slot) =>
        String(slot?.label || "") === label &&
        String(slot?.type || "AM") === type,
    );
    if (duplicate) {
      alert("This day-specific time slot already exists.");
      return;
    }

    day.custom_slots.push({ label, type });
    day.custom_slots.sort(slotSortComparator);
    if (adminDaySlotLabel) adminDaySlotLabel.value = "";
    if (adminDaySlotType) adminDaySlotType.value = "AM";
    updateTimePickerButton("btnOpenDayTimePicker", "Choose Time Slot");

    renderDaySlotList();
    renderTimeSlots();
    renderCalendar();
  });

  btnOpenDayTimePicker?.addEventListener("click", () => {
    if (!selectedDateKey) {
      alert("Please pick a date first.");
      return;
    }

    openTimePicker({
      context: "day",
      title: "Choose Day-Specific Slot",
      label: adminDaySlotLabel?.value,
      type: adminDaySlotType?.value,
    });
  });

  btnConfirmTimePicker?.addEventListener("click", applySelectedTimeSlot);
  [
    pickerStartHour,
    pickerStartMinute,
    pickerEndHour,
    pickerEndMinute,
    pickerPeriod,
  ].forEach((picker) => {
    picker?.addEventListener("change", () => {
      updateTimePickerPreview();
      centerPickerSelect(picker, true);
      syncActiveWheel(picker);
    });
    picker?.addEventListener("focus", () => syncActiveWheel(picker));
    picker?.addEventListener("click", () => syncActiveWheel(picker));
  });

  calPrevBtn?.addEventListener("click", () => {
    currentMonth -= 1;
    if (currentMonth < 0) {
      currentMonth = 11;
      currentYear -= 1;
    }
    renderCalendar();
  });

  calNextBtn?.addEventListener("click", () => {
    currentMonth += 1;
    if (currentMonth > 11) {
      currentMonth = 0;
      currentYear += 1;
    }
    renderCalendar();
  });

  btnSaveCalendarChanges?.addEventListener("click", () => {
    void saveCalendarChanges();
  });

  btnOpenCalendar?.addEventListener("click", async () => {
    selectedDateKey = null;
    if (selectedDateDisplay) selectedDateDisplay.textContent = "Select a Date";
    await fetchCalendar();
    renderCalendar();
    renderTimeSlots();
    renderEvents();
    renderDaySlotList();
    renderSlotManager();
  });

  ensureSlotManagerUi();
  setupAppointmentBulkSelection();
  const btnSaveSlot = document.getElementById("btnSaveSlot");
  const btnOpenGlobalTimePicker = document.getElementById(
    "btnOpenGlobalTimePicker",
  );
  ensureTimePickerOptions();
  updateTimePickerPreview();
  btnSaveSlot?.addEventListener("click", saveSlotFromForm);
  btnOpenGlobalTimePicker?.addEventListener("click", () => {
    const labelInput = document.getElementById("adminSlotLabel");
    const typeInput = document.getElementById("adminSlotType");
    openTimePicker({
      context: "global",
      title: editingSlotId
        ? "Edit Global Time Slot"
        : "Choose Global Time Slot",
      label: labelInput?.value,
      type: typeInput?.value,
    });
  });
  modalTimePicker?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.matches('[data-modal-close="#modalTimePicker"]')) {
      activeTimePickerContext = null;
    }
  });

  // Keep the ordinary consultation action tied to the record confirmed here.
  const openConfirmConsultation = (appt) => {
    if (completingAppointment || consultationRequestPending || appt.custom_product || appt.can_confirm_consultation !== true) return;
    completingAppointment = Object.freeze({ id: appt.id, schedule_version: Number(appt.schedule_version) || 0 });
    const labelEl = document.getElementById("completeAppointmentTargetLabel");
    if (labelEl)
      labelEl.textContent = `${formatApNo(appt.reference_no)} – ${safe(appt.client_name)}`;
    const attendance = document.getElementById("confirmConsultationAttendance");
    if (attendance) attendance.checked = false;
    const confirm = document.getElementById("btnConfirmCompleteAppt");
    if (confirm) confirm.disabled = true;
    document.getElementById("modalCompleteAppointment")?.classList.add("show");
    attendance?.focus({ preventScroll: true });
  };

  document.getElementById("confirmConsultationAttendance")?.addEventListener("change", event => {
    const confirm = document.getElementById("btnConfirmCompleteAppt");
    if (confirm) confirm.disabled = consultationRequestPending || !event.target.checked;
  });

  document
    .getElementById("btnCancelCompleteAppt")
    ?.addEventListener("click", () => {
      if (consultationRequestPending) return;
      document
        .getElementById("modalCompleteAppointment")
        ?.classList.remove("show");
      completingAppointment = null;
      document.querySelector('[data-confirm-consultation]')?.focus({ preventScroll: true });
    });

  document
    .getElementById("btnConfirmCompleteAppt")
    ?.addEventListener("click", async () => {
      if (!completingAppointment || consultationRequestPending || !document.getElementById("confirmConsultationAttendance")?.checked) return;
      const appointment = completingAppointment;
      consultationRequestPending = true;
      const cancelBtn = document.getElementById("btnCancelCompleteAppt");
      if (cancelBtn) cancelBtn.disabled = true;

      const confirmBtn = document.getElementById("btnConfirmCompleteAppt");
      if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML =
          '<i class="fa-solid fa-spinner fa-spin"></i> Confirming…';
      }

      const token =
        (window.AdminSession && window.AdminSession.getToken()) ||
        localStorage.getItem("auth_token") ||
        localStorage.getItem("admin_auth_token") ||
        localStorage.getItem("staff_auth_token") ||
        "";

      try {
        const res = await fetch(
          `${API_BASE_URL}/appointments/${appointment.id}/complete`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ expected_schedule_version: appointment.schedule_version }),
          },
        );

        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          window.showAdminPopup?.(
            payload?.message || "The consultation could not be confirmed.",
            { title: "Action Failed" },
          );
          return;
        }

        const payload = await res.json();
        ++appointmentReadVersion;
        if (payload.data) window.dispatchEvent(new CustomEvent('fmrc:appointment-updated', { detail: { appointment: payload.data } }));
        document
          .getElementById("modalCompleteAppointment")
          ?.classList.remove("show");
        completingAppointment = null;
        await refreshAll();
        if (viewingAppointment?.id === appointment.id && document.getElementById('modalViewAppointment')?.classList.contains('show')) {
          openAppointmentViewModal(state.appointments.find(row => row.id === appointment.id) || payload.data);
          document.getElementById('btnCloseApptView')?.focus({ preventScroll: true });
        }
      } catch (err) {
        console.error("Mark complete error:", err);
        window.showAdminPopup?.("Connection lost. Please try again.", {
          title: "Error",
        });
      } finally {
        consultationRequestPending = false;
        if (cancelBtn) cancelBtn.disabled = false;
        if (confirmBtn) {
          confirmBtn.disabled = !completingAppointment || !document.getElementById("confirmConsultationAttendance")?.checked;
          confirmBtn.innerHTML =
            '<i class="fa-solid fa-circle-check"></i> Confirm consultation';
        }
      }
    });

  if(new URLSearchParams(location.search).get('custom_products')==='1'){
    const filter=document.getElementById('appointmentWorkFilter');if(filter)filter.value='custom';
    const progress=document.getElementById('appointmentProductStageFilter');if(progress)progress.hidden=false;
  }
  // Only the optional workflow adds quiet progress refresh; schedule drafts stay untouched.
  let productPollFailures=0;
  const pollProductProgress=()=>setTimeout(async()=>{
    try {
      if(!document.hidden && !consultationRequestPending && !archiveRequestPending && !document.querySelector('#adminSystemPopup.show') && !tableBody?.querySelector('input:checked') && !modalCalendar?.classList.contains('show')) {
        await fetchAppointments();renderTable();
        const current=state.appointments.find(a=>a.id===viewingAppointment?.id);
        if(current&&document.getElementById('modalViewAppointment')?.classList.contains('show'))openAppointmentViewModal(current);
      }
      productPollFailures=0;
    }catch{productPollFailures=Math.min(3,productPollFailures+1);}pollProductProgress();
  },Math.min(30000,5000*2**productPollFailures));
  fetch(API_BASE_URL+'/appointment-products/availability').then(r=>r.json()).then(json=>{
    if(json.data?.enabled || state.appointments.some(a=>a.custom_product))pollProductProgress();
  }).catch(()=>{});

  void refreshAll().finally(() => {
    // Open the booking a header notification points at; matching on the
    // reference number too keeps older notifications working. Returning false
    // hands the intent back so the shared fallback flashes the table instead.
    window.AdminNotifFocus?.onFocus(["appointment"], (intent) => {
      const id = String(intent?.id || "");
      const ref = String(intent?.ref || "");
      const appt = state.appointments.find(
        (item) =>
          (id && String(item?.id) === id) ||
          (ref && String(item?.reference_no || "") === ref),
      );
      if (!appt) return false;

      openAppointmentViewModal(appt);
      const row = document.querySelector(`[data-view-id="${appt.id}"]`);
      if (row) window.AdminNotifFocus?.flash(row);
      return true;
    });
  });
});
