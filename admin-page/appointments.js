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
  let archivingAppointmentId = null;
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

  const prettyDate = (isoDate) => {
    const m = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return safe(isoDate);
    return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
  };

  const formatApNo = (referenceNo) => {
    const digits = String(referenceNo || "").replace(/\D/g, "");
    if (!digits) return safe(referenceNo);
    return `AP-${digits.slice(-3).padStart(3, "0")}`;
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
    const response = await fetch(`${API_BASE_URL}/appointments`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("Failed to fetch appointments");
    const payload = await response.json();
    const appointments = Array.isArray(payload?.data) ? payload.data : [];
    state.appointments = [...appointments].sort(
      (a, b) =>
        toTimestamp(a?.created_at || a?.created_at_label) -
          toTimestamp(b?.created_at || b?.created_at_label) ||
        toNumericId(a?.id || a?.reference_no) -
          toNumericId(b?.id || b?.reference_no),
    );
  };

  const fetchCalendar = async () => {
    const response = await fetch(`${API_BASE_URL}/appointments/calendar`, {
      headers: { Accept: "application/json" },
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
    if (!query) return state.appointments;

    return state.appointments.filter((item) => {
      const haystack = [
        item.reference_no,
        item.client_name,
        item.contact_number,
        item.email,
        item.full_address,
        item.client_type,
        item.purpose,
        item.additional_notes,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  };

  const calculateRowsPerPage = () => {
    return 5;
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
        const fileName = safe(item.attachment_name);
        const fileUrl = String(item.attachment_url || "").trim();
        const fileCell =
          fileName === "N/A"
            ? "N/A"
            : fileUrl
              ? `<a href="${fileUrl}" download="${fileName}" target="_blank" rel="noopener" class="photo-link">${fileName}</a>`
              : `<span class="photo-link">${fileName}</span>`;

        return `<tr>
          <td class="admin-bulk-select-cell"><input type="checkbox" data-admin-bulk-row="appointments" value="${item.id}" aria-label="Select ${formatApNo(item.reference_no)}" /></td>
          <td>${formatApNo(item.reference_no)}</td>
          <td title="${safe(item.client_name)}">${safe(item.client_name)}</td>
          <td>${safe(item.contact_number)}</td>
          <td>${safe(item.email)}</td>
          <td title="${safe(item.full_address)}">${safe(item.full_address)}</td>
          <td>${safe(item.client_type)}</td>
          <td>${safe(item.purpose)}</td>
          <td>${fileCell}</td>
          <td title="${safe(item.additional_notes)}">${safe(item.additional_notes)}</td>
          <td>${prettyDate(item.appointment_date)}</td>
          <td>${safe(item.appointment_time)}</td>
          <td><span class="status-pill ${statusClass(item.status)}">${safe(item.status)}</span></td>
          <td class="action-icons sticky-action">
            <button type="button" data-tooltip="View Appointment" data-view-id="${item.id}"><i class="fa-regular fa-eye"></i></button>
            <button type="button" data-tooltip="Archive Appointment" data-archive-id="${item.id}"><i class="fa-solid fa-box-archive"></i></button>
          </td>
        </tr>`;
      })
      .join("");

    if (!pagedItems.length) {
      tableBody.innerHTML = `<tr class="table-empty-row"><td colspan="14"><div class="table-empty-state"><i class="fa-regular fa-folder-open"></i><span>No appointment records found.</span></div></td></tr>`;
    }

    if (tableMeta) {
      const from = source.length ? start + 1 : 0;
      const to = source.length
        ? Math.min(source.length, start + rowsPerPage)
        : 0;
      tableMeta.textContent = `Page ${currentPage} of ${pageCount} • Showing ${from}-${to} of ${source.length}`;
    }

    if (currentPageEl) {
      currentPageEl.value = String(currentPage);
      currentPageEl.max = String(pageCount);
    }
    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= pageCount;
    appointmentBulkController?.sync();
  };

  const appointmentIsArchiveEligible = (item) =>
    !["cancelled", "archived"].includes(
      String(item?.status || "").toLowerCase(),
    );

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
  const openAppointmentViewModal = (appt) => {
    viewingAppointment = appt;
    const modal = document.getElementById("modalViewAppointment");
    if (!modal) return;

    const fullName = safe(appt.client_name);
    const apNo = formatApNo(appt.reference_no);
    const status = safe(appt.status);
    const statusCls = statusClass(status);
    const fileUrl = String(appt.attachment_url || "").trim();
    const fileName = safe(appt.attachment_name);
    const fileHtml =
      fileName === "N/A"
        ? '<span style="color:#9ca3af;">No file attached</span>'
        : fileUrl
          ? `<a href="${fileUrl}" download="${fileName}" target="_blank" rel="noopener" class="photo-link">${fileName}</a>`
          : `<span class="photo-link">${fileName}</span>`;

    const body = document.getElementById("apptViewBody");
    if (body) {
      body.innerHTML = `
        <div class="appt-view-header-row">
          <div class="appt-view-avatar">${fullName.charAt(0).toUpperCase()}</div>
          <div class="appt-view-title-block">
            <h4 class="appt-view-name">${fullName}</h4>
            <span class="appt-view-ref">${apNo}</span>
            <span class="status-pill ${statusCls}" style="margin-left:8px;">${status}</span>
          </div>
        </div>
        <hr class="confirm-separator" style="margin:12px 0;" />
        <div class="appt-view-grid">
          <div class="appt-view-field">
            <div class="inv-view-label"><i class="fa-solid fa-phone" style="margin-right:6px;color:#800000;"></i>Contact Number</div>
            <div class="inv-view-value">${safe(appt.contact_number)}</div>
          </div>
          <div class="appt-view-field">
            <div class="inv-view-label"><i class="fa-regular fa-envelope" style="margin-right:6px;color:#800000;"></i>Email Address</div>
            <div class="inv-view-value">${safe(appt.email)}</div>
          </div>
          <div class="appt-view-field full">
            <div class="inv-view-label"><i class="fa-solid fa-location-dot" style="margin-right:6px;color:#800000;"></i>Address</div>
            <div class="inv-view-value">${safe(appt.full_address)}</div>
          </div>
          <div class="appt-view-field">
            <div class="inv-view-label"><i class="fa-solid fa-user-tag" style="margin-right:6px;color:#800000;"></i>Client Type</div>
            <div class="inv-view-value">${safe(appt.client_type)}</div>
          </div>
          <div class="appt-view-field">
            <div class="inv-view-label"><i class="fa-solid fa-calendar-day" style="margin-right:6px;color:#800000;"></i>Appointment Date</div>
            <div class="inv-view-value">${prettyDate(appt.appointment_date)}</div>
          </div>
          <div class="appt-view-field">
            <div class="inv-view-label"><i class="fa-regular fa-clock" style="margin-right:6px;color:#800000;"></i>Appointment Time</div>
            <div class="inv-view-value">${safe(appt.appointment_time)}</div>
          </div>
          <div class="appt-view-field full">
            <div class="inv-view-label"><i class="fa-solid fa-bullseye" style="margin-right:6px;color:#800000;"></i>Purpose / Service</div>
            <div class="inv-view-value">${safe(appt.purpose)}</div>
          </div>
          <div class="appt-view-field full">
            <div class="inv-view-label"><i class="fa-regular fa-note-sticky" style="margin-right:6px;color:#800000;"></i>Additional Notes</div>
            <div class="inv-view-value">${safe(appt.additional_notes)}</div>
          </div>
          <div class="appt-view-field full">
            <div class="inv-view-label"><i class="fa-solid fa-paperclip" style="margin-right:6px;color:#800000;"></i>Attached File</div>
            <div class="inv-view-value">${fileHtml}</div>
          </div>
        </div>`;
    }

    modal.classList.add("show");
  };

  document.getElementById("btnCloseApptView")?.addEventListener("click", () => {
    document.getElementById("modalViewAppointment")?.classList.remove("show");
    viewingAppointment = null;
  });

  document
    .getElementById("btnArchiveFromView")
    ?.addEventListener("click", () => {
      document.getElementById("modalViewAppointment")?.classList.remove("show");
      if (viewingAppointment) openAppointmentArchiveModal(viewingAppointment);
    });

  // ─── Appointment Archive Modal ──────────────────────────────────────────────
  const openAppointmentArchiveModal = (appt) => {
    archivingAppointmentId = appt.id;
    const labelEl = document.getElementById("archiveAppointmentTargetLabel");
    if (labelEl)
      labelEl.textContent = `${formatApNo(appt.reference_no)} – ${safe(appt.client_name)}`;
    document.getElementById("modalArchiveAppointment")?.classList.add("show");
  };

  document
    .getElementById("btnCancelArchiveAppt")
    ?.addEventListener("click", () => {
      document
        .getElementById("modalArchiveAppointment")
        ?.classList.remove("show");
      archivingAppointmentId = null;
    });

  document
    .getElementById("btnConfirmArchiveAppt")
    ?.addEventListener("click", async () => {
      if (!archivingAppointmentId) return;

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
          `${API_BASE_URL}/appointments/${archivingAppointmentId}/archive`,
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
        await refreshAll();
        setTimeout(() => {
          window.showAdminPopup?.(
            "Appointment has been archived and moved to the Archives page.",
            { title: "Archived ✓" },
          );
        }, 200);
      } catch (err) {
        console.error("Archive appointment error:", err);
        window.showAdminPopup?.("Cannot connect to server.", {
          title: "Error",
        });
      } finally {
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
          tableBody.innerHTML = `<tr class="admin-table-skeleton-row" aria-hidden="true">${cells}</tr>`.repeat(
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
        error?.message || "Unable to load appointments from the server.",
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
      Math.max(1, Math.ceil(filteredAppointments().length / calculateRowsPerPage())),
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

  void refreshAll();
});
