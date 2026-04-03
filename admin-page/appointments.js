document.addEventListener("DOMContentLoaded", () => {
  const APPOINTMENTS_STORAGE_KEY = "fmrcAppointments";
  const CALENDAR_BLOCKS_STORAGE_KEY = "fmrcAppointmentCalendarBlocks";

  const ALLOWED_TYPES = [
    "Student",
    "Researchers",
    "Business",
    "Association",
    "Educators",
  ];

  const ALLOWED_PURPOSES = [
    "Product labelling and designing",
    "3D Printing",
    "3D Scanning",
    "Laser-cutting/engraving",
    "Large Format printing & cutting",
    "CNC Milling",
    "Inquiries",
  ];

  const tableBody = document.getElementById("appointmentsTableBody");
  const tableMeta = document.getElementById("appointmentsTableMeta");
  const currentPageEl = document.getElementById("appointmentsCurrentPage");
  const prevBtn = document.getElementById("appointmentsPrevPage");
  const nextBtn = document.getElementById("appointmentsNextPage");
  const searchInput = document.getElementById("appointmentSearchInput");
  const deleteAppointmentTargetLabel = document.getElementById(
    "deleteAppointmentTargetLabel"
  );
  const archiveAppointmentTargetLabel = document.getElementById(
    "archiveAppointmentTargetLabel"
  );
  const btnConfirmDeleteAppointment = document.getElementById(
    "btnConfirmDeleteAppointment"
  );
  const btnConfirmArchiveAppointment = document.getElementById(
    "btnConfirmArchiveAppointment"
  );
  const tableWrapper = document.querySelector(".table-wrapper");

  const calGrid = document.getElementById("adminCalDaysGrid");
  const monthDisplay = document.getElementById("adminCalMonthYear");
  const calPrevBtn = document.getElementById("adminCalPrevBtn");
  const calNextBtn = document.getElementById("adminCalNextBtn");
  const selectedDateDisplay = document.getElementById("adminSelectedDateDisplay");
  const timeSlotsContainer = document.getElementById("adminTimeSlotsContainer");
  const btnToggleBlockDay = document.getElementById("btnToggleBlockDay");
  const btnClearDayBlocks = document.getElementById("btnClearDayBlocks");

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

  const timeSlots = [
    { label: "9:00 - 10:00 AM", type: "AM" },
    { label: "10:00 - 11:00 AM", type: "AM" },
    { label: "11:00 - 12:00 AM", type: "AM" },
    { label: "1:00 - 2:00 PM", type: "PM" },
    { label: "2:00 - 3:00 PM", type: "PM" },
    { label: "3:00 - 4:00 PM", type: "PM" },
  ];

  const defaultAppointments = [
    {
      apNo: "AP-00176",
      clientName: "Vear Carl T. Marasigan",
      contactNumber: "09123456789",
      email: "client@email.com",
      address: "Vinzons, Camarines Norte",
      type: "Student",
      purpose: "3D Printing",
      fileAttach: { name: "prototype-v1.stl", dataUrl: "" },
      notes: "For capstone prototype fitting.",
      date: "2026-03-30",
      time: "10:00 AM",
      status: "Scheduled",
    },
    {
      apNo: "AP-00177",
      clientName: "Wern Cris C. Bustamante",
      contactNumber: "09911223344",
      email: "wern@email.com",
      address: "Daet, Camarines Norte",
      type: "Researchers",
      purpose: "CNC Milling",
      fileAttach: { name: "fixture-layout.pdf", dataUrl: "" },
      notes: "Need milling consultation before production.",
      date: "2026-04-01",
      time: "9:30 AM",
      status: "Scheduled",
    },
    {
      apNo: "AP-00178",
      clientName: "Kevin S. Arvalo",
      contactNumber: "09888776655",
      email: "kevin@email.com",
      address: "Basud, Camarines Norte",
      type: "Business",
      purpose: "Laser-cutting/engraving",
      fileAttach: { name: "panel-engrave.ai", dataUrl: "" },
      notes: "Customer logo engraving request.",
      date: "2026-04-03",
      time: "2:00 PM",
      status: "Scheduled",
    },
  ];

  let currentPage = 1;
  let activeDeleteApNo = "";

  const fixedToday = new Date(2026, 2, 23);
  let currentMonth = fixedToday.getMonth();
  let currentYear = fixedToday.getFullYear();
  let selectedDateKey = null;

  const readAppointments = () => {
    try {
      const raw = localStorage.getItem(APPOINTMENTS_STORAGE_KEY);
      if (!raw) return [...defaultAppointments];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [...defaultAppointments];

      return parsed.map((entry, index) => {
        const safeType = ALLOWED_TYPES.includes(entry?.type)
          ? entry.type
          : "Student";

        const safePurpose = ALLOWED_PURPOSES.includes(entry?.purpose)
          ? entry.purpose
          : "Inquiries";

        const fileAttach =
          entry?.fileAttach && typeof entry.fileAttach === "object"
            ? {
                name: String(entry.fileAttach.name || "N/A"),
                dataUrl: String(entry.fileAttach.dataUrl || ""),
              }
            : { name: String(entry?.fileAttachName || "N/A"), dataUrl: "" };

        return {
          apNo: String(entry?.apNo || `AP-${String(index + 1).padStart(5, "0")}`),
          clientName: String(entry?.clientName || "N/A"),
          contactNumber: String(entry?.contactNumber || "N/A"),
          email: String(entry?.email || "N/A"),
          address: String(entry?.address || "N/A"),
          type: safeType,
          purpose: safePurpose,
          fileAttach,
          notes: String(entry?.notes || "N/A"),
          date: String(entry?.date || "N/A"),
          time: String(entry?.time || "N/A"),
          status: String(entry?.status || "Scheduled"),
        };
      });
    } catch {
      return [...defaultAppointments];
    }
  };

      const readCalendarBlocks = () => {
    try {
      const raw = localStorage.getItem(CALENDAR_BLOCKS_STORAGE_KEY);
      if (!raw) return { blockedDays: [], blockedSlots: {}, events: {} };

      const parsed = JSON.parse(raw);
      const blockedDays = Array.isArray(parsed?.blockedDays) ? parsed.blockedDays.filter(d => typeof d === "string") : [];
      const blockedSlots = (parsed && typeof parsed.blockedSlots === "object" && !Array.isArray(parsed.blockedSlots)) ? parsed.blockedSlots : {};
      const events = (parsed && typeof parsed.events === "object" && !Array.isArray(parsed.events)) ? parsed.events : {};

      Object.keys(blockedSlots).forEach(k => { if(!Array.isArray(blockedSlots[k])) delete blockedSlots[k]; });
      Object.keys(events).forEach(k => { if(!Array.isArray(events[k])) delete events[k]; });

      return { blockedDays, blockedSlots, events };
    } catch {
      return { blockedDays: [], blockedSlots: {}, events: {} };
    }
  };
let calendarBlocks = readCalendarBlocks();

  const writeCalendarBlocks = () => {
    localStorage.setItem(CALENDAR_BLOCKS_STORAGE_KEY, JSON.stringify(calendarBlocks));
  };

  const appointments = readAppointments();

  const statusClass = (status) => {
    if (status === "Completed") return "status-green";
    if (status === "Approved") return "status-green";
    if (status === "Scheduled") return "status-yellow";
    if (status === "Cancelled") return "status-red";
    return "status-yellow";
  };

  const safe = (value) => {
    if (value === undefined || value === null || String(value).trim() === "") {
      return "N/A";
    }
    return String(value);
  };

  const prettyDate = (isoDate) => {
    const m = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return safe(isoDate);
    const year = Number(m[1]);
    const month = Number(m[2]) - 1;
    const day = Number(m[3]);
    return `${months[month]} ${day}, ${year}`;
  };

  const filteredAppointments = () => {
    const query = (searchInput?.value || "").trim().toLowerCase();
    if (!query) return appointments;

    return appointments.filter((item) => {
      const haystack = [
        item.apNo,
        item.clientName,
        item.contactNumber,
        item.email,
        item.address,
        item.type,
        item.purpose,
        item.notes,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  };

  const calculateRowsPerPage = () => {
    const firstRow = tableBody?.querySelector("tr");
    const rowHeight = firstRow?.offsetHeight || 42;

    const sidebarFooter = document.querySelector(".sidebar-footer");
    const footerTop = sidebarFooter
      ? sidebarFooter.getBoundingClientRect().top
      : window.innerHeight - 70;

    const tableTop = tableWrapper?.getBoundingClientRect().top || 200;
    const available = Math.max(180, footerTop - tableTop - 70);
    const rows = Math.floor(available / rowHeight);
    return Math.max(5, rows);
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
        const fileName = safe(item.fileAttach?.name);
        const fileUrl = String(item.fileAttach?.dataUrl || "").trim();
        const fileCell =
          fileName === "N/A"
            ? "N/A"
            : fileUrl
              ? `<a href="${fileUrl}" target="_blank" rel="noopener" class="photo-link">${fileName}</a>`
              : `<a href="#" class="photo-link" data-tooltip="No preview available">${fileName}</a>`;

        return `<tr>
          <td>${safe(item.apNo)}</td>
          <td title="${safe(item.clientName)}">${safe(item.clientName)}</td>
          <td>${safe(item.contactNumber)}</td>
          <td>${safe(item.email)}</td>
          <td title="${safe(item.address)}">${safe(item.address)}</td>
          <td>${safe(item.type)}</td>
          <td>${safe(item.purpose)}</td>
          <td>${fileCell}</td>
          <td title="${safe(item.notes)}">${safe(item.notes)}</td>
          <td>${prettyDate(item.date)}</td>
          <td>${safe(item.time)}</td>
          <td><span class="status-pill ${statusClass(item.status)}">${safe(item.status)}</span></td>
          <td class="action-icons sticky-action">
            <button type="button" data-tooltip="Edit Appointment" data-edit-id="${item.apNo}"><i class="fa-regular fa-pen-to-square"></i></button>
            <button type="button" data-tooltip="View Appointment" data-view-id="${item.apNo}"><i class="fa-regular fa-eye"></i></button>
            <button type="button" data-tooltip="Move to Archives" data-archive-id="${item.apNo}"><i class="fa-solid fa-box-archive"></i></button>
            <button type="button" data-tooltip="Delete Appointment" data-delete-id="${item.apNo}"><i class="fa-regular fa-trash-can"></i></button>
          </td>
        </tr>`;
      })
      .join("");

    if (!pagedItems.length) {
      tableBody.innerHTML = `<tr><td colspan="13">No appointment records found.</td></tr>`;
    }

    if (tableMeta) {
      tableMeta.textContent = `Page ${currentPage} of ${pageCount} • Showing ${Math.min(
        source.length,
        start + 1
      )}-${Math.min(source.length, start + rowsPerPage)} of ${source.length}`;
    }

    if (currentPageEl) currentPageEl.textContent = String(currentPage);
    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= pageCount;
  };

  tableBody?.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    const editBtn = target.closest("[data-edit-id]");
    if (editBtn) {
      return;
    }

    const viewBtn = target.closest("[data-view-id]");
    if (viewBtn) {
      return;
    }

    const archiveBtn = target.closest("[data-archive-id]");
    if (archiveBtn) {
      const apNo = archiveBtn.getAttribute("data-archive-id") || "";
      const selected = appointments.find((item) => item.apNo === apNo);
      if (archiveAppointmentTargetLabel) {
        archiveAppointmentTargetLabel.textContent = selected?.clientName || apNo || "this appointment";
      }
      const modal = document.getElementById("modalArchiveAppointment");
      modal?.classList.add("show");
      return;
    }

    const deleteBtn = target.closest("[data-delete-id]");
    if (deleteBtn) {
      const apNo = deleteBtn.getAttribute("data-delete-id") || "";
      activeDeleteApNo = apNo;
      const selected = appointments.find((item) => item.apNo === apNo);
      if (deleteAppointmentTargetLabel) {
        deleteAppointmentTargetLabel.textContent = selected?.clientName || apNo || "this appointment";
      }
      const modal = document.getElementById("modalDeleteAppointment");
      modal?.classList.add("show");
    }
  });

  btnConfirmDeleteAppointment?.addEventListener("click", (e) => {
    e.preventDefault();
    void activeDeleteApNo;
  });

  btnConfirmArchiveAppointment?.addEventListener("click", (e) => {
    e.preventDefault();
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

  searchInput?.addEventListener("input", () => {
    currentPage = 1;
    renderTable();
  });

  const getDateKey = (year, month, day) =>
    `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const isPastDate = (year, month, day) => {
    const candidate = new Date(year, month, day);
    const normalizedToday = new Date(
      fixedToday.getFullYear(),
      fixedToday.getMonth(),
      fixedToday.getDate()
    );
    return candidate < normalizedToday;
  };

  const isBlockedDay = (dateKey) => calendarBlocks.blockedDays.includes(dateKey);

  const updateDayButtonState = () => {
    if (!btnToggleBlockDay) return;
    if (!selectedDateKey) {
      btnToggleBlockDay.disabled = true;
      btnToggleBlockDay.textContent = "Block Whole Day";
      return;
    }

    btnToggleBlockDay.disabled = false;
    btnToggleBlockDay.textContent = isBlockedDay(selectedDateKey)
      ? "Unblock Whole Day"
      : "Block Whole Day";
  };

    const updateDateIndicators = (cell, dateKey) => {
    cell.querySelectorAll('.event-dot').forEach(el => el.remove());
    if (calendarBlocks.events && calendarBlocks.events[dateKey] && calendarBlocks.events[dateKey].length) {
      const dot = document.createElement('div');
      dot.className = 'event-dot';
      dot.style.cssText = 'width:6px;height:6px;background:#e67e22;border-radius:50%;margin-top:2px;';
      cell.appendChild(dot);
    }
    const blockedSlots = calendarBlocks.blockedSlots[dateKey] || [];
    const hasAM = blockedSlots.some((slot) => slot.includes("AM"));
    const hasPM = blockedSlots.some((slot) => slot.includes("PM"));

    cell.classList.remove("has-am", "has-pm", "has-full", "admin-blocked-day");

    if (isBlockedDay(dateKey)) {
      cell.classList.add("admin-blocked-day", "has-full");
      cell.setAttribute("title", "Blocked whole day by admin");
      return;
    }

    if (hasAM && hasPM) {
      cell.classList.add("has-full");
      cell.setAttribute("title", "AM and PM have blocked slots");
    } else if (hasAM) {
      cell.classList.add("has-am");
      cell.setAttribute("title", "AM has blocked slots");
    } else if (hasPM) {
      cell.classList.add("has-pm");
      cell.setAttribute("title", "PM has blocked slots");
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
          isWeekend ? "Unavailable: Weekend" : "Unavailable: Past Date"
        );
      } else {
        cell.addEventListener("click", () => {
          selectedDateKey = dateKey;
          selectedDateDisplay.textContent = `${months[currentMonth]} ${day}, ${currentYear}`;
          renderCalendar();
          renderTimeSlots(); if(typeof renderEvents === 'function') renderEvents();
        });
      }

      if (dateKey === selectedDateKey) {
        cell.classList.add("selected");
      }

      updateDateIndicators(cell, dateKey);
      calGrid.appendChild(cell);
    }

    updateDayButtonState();
  };

  const toggleSlot = (slotLabel) => {
    if (!selectedDateKey) return;

    const daySlots = calendarBlocks.blockedSlots[selectedDateKey] || [];
    const exists = daySlots.includes(slotLabel);
    const updated = exists
      ? daySlots.filter((slot) => slot !== slotLabel)
      : [...daySlots, slotLabel];

    calendarBlocks.blockedSlots[selectedDateKey] = updated;
    if (!updated.length) {
      delete calendarBlocks.blockedSlots[selectedDateKey];
    }

    writeCalendarBlocks();
    renderCalendar();
    renderTimeSlots(); if(typeof renderEvents === 'function') renderEvents();
  };

  const renderTimeSlots = () => {
    if (!timeSlotsContainer) return;
    if (!selectedDateKey) {
      timeSlotsContainer.innerHTML = '<p class="time-placeholder">Please pick a date first.</p>';
      updateDayButtonState();
      return;
    }

    const dayBlocked = isBlockedDay(selectedDateKey);
    const blockedSlots = calendarBlocks.blockedSlots[selectedDateKey] || [];

    timeSlotsContainer.innerHTML = "";

    timeSlots.forEach((slot) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "time-slot-btn";
      button.innerHTML = `<span>${slot.label}</span><span class="time-slot-label">${slot.type}</span>`;

      const slotBlocked = blockedSlots.includes(slot.label);
      if (slotBlocked) button.classList.add("selected");
      if (dayBlocked) button.classList.add("disabled", "admin-forced-disabled");

      if (dayBlocked) {
        button.disabled = true;
        button.title = "This date is blocked for the entire day.";
      } else {
        button.addEventListener("click", () => toggleSlot(slot.label));
      }

      timeSlotsContainer.appendChild(button);
    });

    updateDayButtonState();
  };

  btnToggleBlockDay?.addEventListener("click", () => {
    if (!selectedDateKey) return;

    const currentlyBlocked = isBlockedDay(selectedDateKey);
    if (currentlyBlocked) {
      calendarBlocks.blockedDays = calendarBlocks.blockedDays.filter(
        (day) => day !== selectedDateKey
      );
    } else {
      calendarBlocks.blockedDays.push(selectedDateKey);
      calendarBlocks.blockedDays = [...new Set(calendarBlocks.blockedDays)];
    }

    writeCalendarBlocks();
    renderCalendar();
    renderTimeSlots(); if(typeof renderEvents === 'function') renderEvents();
  });

  btnClearDayBlocks?.addEventListener("click", () => {
    if (!selectedDateKey) return;

    calendarBlocks.blockedDays = calendarBlocks.blockedDays.filter(
      (day) => day !== selectedDateKey
    );
    delete calendarBlocks.blockedSlots[selectedDateKey];

    writeCalendarBlocks();
    renderCalendar();
    renderTimeSlots(); if(typeof renderEvents === 'function') renderEvents();
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

  window.addEventListener("resize", renderTable);

    // Add Event Logic
  const adminEventInput = document.getElementById("adminEventInput");
  const btnAddStaticEvent = document.getElementById("btnAddStaticEvent");
  const adminEventList = document.getElementById("adminEventList");
  const btnSaveCalendarChanges = document.getElementById("btnSaveCalendarChanges");

  const renderEvents = () => {
    if (!adminEventList) return;
    adminEventList.innerHTML = "";
    if (!selectedDateKey) return;
    
    if(!calendarBlocks.events) calendarBlocks.events = {};
    const dayEvents = calendarBlocks.events[selectedDateKey] || [];
    dayEvents.forEach((evText, i) => {
      const item = document.createElement("div");
      item.style.cssText = "display: flex; justify-content: space-between; background: #fdf2e9; border: 1px solid #f8c471; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; align-items: center; color: #d35400;";
      item.innerHTML = `<span>${evText}</span><button type="button" style="background: none; border: none; color: #e74c3c; cursor: pointer; font-weight: bold;">X</button>`;
      item.querySelector("button").addEventListener("click", () => {
        calendarBlocks.events[selectedDateKey].splice(i, 1);
        if(calendarBlocks.events[selectedDateKey].length === 0) delete calendarBlocks.events[selectedDateKey];
        writeCalendarBlocks();
        renderEvents();
        renderCalendar();
      });
      adminEventList.appendChild(item);
    });
  };

  

  btnAddStaticEvent?.addEventListener("click", () => {
    if (!selectedDateKey) { alert("Please pick a date first."); return; }
    const ev = adminEventInput.value.trim();
    if (!ev) return;
    if(!calendarBlocks.events) calendarBlocks.events = {};
    if(!calendarBlocks.events[selectedDateKey]) calendarBlocks.events[selectedDateKey] = [];
    calendarBlocks.events[selectedDateKey].push(ev);
    adminEventInput.value = "";
    writeCalendarBlocks();
    renderEvents();
    renderCalendar();
  });

  btnSaveCalendarChanges?.addEventListener("click", () => {
    writeCalendarBlocks();
    alert("Calendar changes saved successfully!");
    const modal = document.querySelector("#modalCalendar");
    if(modal) {
      // standard close modal logic for this project by clicking the closest dismiss overlay or removing show
      document.body.classList.remove('modal-open');
      modal.classList.remove('show');
    }
  });

  renderTable();
  renderCalendar();
  renderTimeSlots(); if(typeof renderEvents === 'function') renderEvents();
});









