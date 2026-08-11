/**
 * Shared Admin/Staff Archives workspace.
 * Every section owns its own selection Set through AdminBulkSelection.
 */
document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const resolveApiBaseUrl = () => {
    const configured =
      window.APP_API_BASE_URL ||
      document
        .querySelector('meta[name="api-base-url"]')
        ?.getAttribute("content") ||
      "";
    if (configured.trim()) return configured.replace(/\/+$/, "");

    const protocol = String(window.location.protocol || "").toLowerCase();
    const hostname = String(window.location.hostname || "").toLowerCase();
    const origin = String(window.location.origin || "");
    const port = String(window.location.port || "");
    if (!/^https?:$/.test(protocol) || !hostname) {
      return "http://127.0.0.1:8000/api";
    }
    if (port === "8000") return `${origin.replace(/\/+$/, "")}/api`;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return `${protocol}//${hostname}:8000/api`;
    }
    return `${origin.replace(/\/+$/, "")}/api`;
  };

  const API_BASE_URL = resolveApiBaseUrl();
  const PAGE_SIZE = 10;
  const getToken = () =>
    window.AdminSession?.getToken?.() ||
    localStorage.getItem("auth_token") ||
    localStorage.getItem("admin_auth_token") ||
    localStorage.getItem("staff_auth_token") ||
    "";

  const esc = (value) =>
    String(value ?? "—")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const fmtDate = (value, withTime = false) => {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return esc(value);
    const options = {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "short",
      day: "numeric",
    };
    if (withTime) {
      options.hour = "numeric";
      options.minute = "2-digit";
    }
    return date.toLocaleString("en-PH", options);
  };

  const statusPill = (text) => {
    const normalized = String(text || "—").toLowerCase();
    let className = "status-gray";
    if (
      ["good", "active", "completed", "confirmed", "paid", "enabled"].includes(
        normalized,
      )
    ) {
      className = "status-green";
    } else if (["low", "pending", "incoming", "paused"].includes(normalized)) {
      className = "status-yellow";
    } else if (
      ["critical", "rejected", "cancelled", "archived"].includes(normalized)
    ) {
      className = "status-red";
    }
    return `<span class="status-pill ${className}">${esc(text)}</span>`;
  };

  const scheduleLabel = (row) => {
    const start = row?.starts_at ? fmtDate(row.starts_at, true) : "No start";
    const end = row?.ends_at ? fmtDate(row.ends_at, true) : "No end";
    return `${start}<br />to ${end}`;
  };

  const state = {
    inventory: { all: [], page: 1, controller: null },
    appointment: { all: [], page: 1, controller: null },
    order: { all: [], page: 1, controller: null },
    promotion: { all: [], page: 1, controller: null },
    announcement: { all: [], page: 1, controller: null },
  };
  let searchQuery = "";

  const moduleConfig = {
    inventory: {
      payloadKey: "inventory",
      tableId: "inventoryArchiveTable",
      tbodyId: "invArchiveTbody",
      footerId: "invArchiveFooter",
      metaId: "invArchiveMeta",
      pageId: "invCurrentPage",
      prevId: "invPrevBtn",
      nextId: "invNextBtn",
      countId: "tabCountInventory",
      colCount: 11,
      tableLabel: "Inventory Archived Items",
      emptyMessage: "No archived inventory items found.",
      searchFields: [
        "item_name",
        "description",
        "category",
        "unit",
        "status",
        "remarks",
      ],
    },
    appointment: {
      payloadKey: "appointments",
      tableId: "appointmentArchiveTable",
      tbodyId: "apptArchiveTbody",
      footerId: "apptArchiveFooter",
      metaId: "apptArchiveMeta",
      pageId: "apptCurrentPage",
      prevId: "apptPrevBtn",
      nextId: "apptNextBtn",
      countId: "tabCountAppointment",
      colCount: 13,
      tableLabel: "Appointment Archived Items",
      emptyMessage: "No archived appointments found.",
      searchFields: [
        "reference_no",
        "client_name",
        "contact_number",
        "email",
        "client_type",
        "purpose",
        "status",
      ],
    },
    order: {
      payloadKey: "orders",
      tableId: "orderArchiveTable",
      tbodyId: "orderArchiveTbody",
      footerId: "orderArchiveFooter",
      metaId: "orderArchiveMeta",
      pageId: "orderCurrentPage",
      prevId: "orderPrevBtn",
      nextId: "orderNextBtn",
      countId: "tabCountOrder",
      colCount: 10,
      tableLabel: "Orders Archived Items",
      emptyMessage: "No archived orders found.",
      searchFields: [
        "order_no",
        "order_item",
        "customer_name",
        "payment_method",
        "lifecycle_status",
      ],
    },
    promotion: {
      payloadKey: "promotions",
      tableId: "promotionArchiveTable",
      tbodyId: "promotionArchiveTbody",
      footerId: "promotionArchiveFooter",
      metaId: "promotionArchiveMeta",
      pageId: "promotionArchiveCurrentPage",
      prevId: "promotionArchivePrevBtn",
      nextId: "promotionArchiveNextBtn",
      countId: "tabCountPromotion",
      colCount: 8,
      tableLabel: "Promotion Archived Items",
      emptyMessage: "No archived promotions found.",
      searchFields: ["title", "scope", "status", "discount_percent"],
    },
    announcement: {
      payloadKey: "announcements",
      tableId: "announcementArchiveTable",
      tbodyId: "announcementArchiveTbody",
      footerId: "announcementArchiveFooter",
      metaId: "announcementArchiveMeta",
      pageId: "announcementArchiveCurrentPage",
      prevId: "announcementArchivePrevBtn",
      nextId: "announcementArchiveNextBtn",
      countId: "tabCountAnnouncement",
      colCount: 8,
      tableLabel: "Announcement Archived Items",
      emptyMessage: "No archived announcements found.",
      searchFields: ["title", "message", "placement", "status"],
    },
  };

  Object.values(moduleConfig).forEach((config) => {
    config.table = document.getElementById(config.tableId);
    config.tbody = document.getElementById(config.tbodyId);
    config.footer = document.getElementById(config.footerId);
    config.meta = document.getElementById(config.metaId);
    config.pageNumber = document.getElementById(config.pageId);
    config.prev = document.getElementById(config.prevId);
    config.next = document.getElementById(config.nextId);
    config.count = document.getElementById(config.countId);
  });

  const filteredRows = (module) => {
    const config = moduleConfig[module];
    const rows = state[module].all;
    if (!searchQuery) return rows;
    return rows.filter((row) =>
      config.searchFields.some((field) =>
        String(row?.[field] ?? "")
          .toLowerCase()
          .includes(searchQuery),
      ),
    );
  };

  const pageRows = (module) => {
    const rows = filteredRows(module);
    const page = state[module].page;
    return rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  };

  const restoreButton = (module, row, name) => `
    <button type="button" data-tooltip="Restore Record" data-archive-restore="${module}" data-id="${row.source_id}" aria-label="Restore ${esc(name)}">
      <i class="fa-solid fa-rotate-left"></i>
    </button>`;

  const rowCheckbox = (module, row, label) => `
    <td class="admin-bulk-select-cell">
      <input type="checkbox" data-admin-bulk-row="archive-${module}" value="${row.source_id}" aria-label="Select ${esc(label)}" />
    </td>`;

  const renderInventoryRow = (item, index) => {
    const onHand = Number(item.on_hand || 0);
    const status = item.status || (onHand <= 0 ? "Critical" : onHand <= 5 ? "Low" : "Good");
    const variants = Array.isArray(item.variants) ? item.variants : [];
    const hasVariants = Boolean(item.has_variants || variants.length);
    const rowNumber = (state.inventory.page - 1) * PAGE_SIZE + index + 1;
    const toggle = hasVariants
      ? `<button type="button" class="inv-variant-toggle" data-inv-toggle="${item.source_id}" aria-expanded="false" title="Toggle variants"><i class="fa-solid fa-chevron-right"></i></button>`
      : "";
    const itemName = hasVariants
      ? `<div class="inv-name-cell">${toggle}<span>${esc(item.item_name)}</span><span class="inv-variant-count">${variants.length} variant${variants.length === 1 ? "" : "s"}</span></div>`
      : esc(item.item_name);
    const blankWhenVariants = (value) => (hasVariants ? "" : value);

    let html = `<tr${hasVariants ? ' class="inv-has-variants"' : ""}>
      ${rowCheckbox("inventory", item, item.item_name)}
      <td>${rowNumber}</td>
      <td style="font-weight:600;">${itemName}</td>
      <td style="color:#64748b;">${blankWhenVariants(esc(item.description || "—"))}</td>
      <td>${blankWhenVariants(esc(item.unit || "—"))}</td>
      <td>${blankWhenVariants(esc(onHand))}</td>
      <td>${blankWhenVariants(statusPill(status))}</td>
      <td>${blankWhenVariants(esc(item.remarks || "—"))}</td>
      <td><span style="font-size:0.75rem;background:#f0f2f5;padding:2px 8px;border-radius:99px;font-weight:600;">${esc(item.category)}</span></td>
      <td style="color:#64748b;font-size:0.82rem;">${fmtDate(item.archived_at)}</td>
      <td class="action-icons sticky-action">${restoreButton("inventory", item, item.item_name)}</td>
    </tr>`;

    variants.forEach((variant) => {
      const variantOnHand = Number(variant.on_hand || 0);
      const variantStatus =
        variant.status ||
        (variantOnHand <= 0 ? "Critical" : variantOnHand <= 5 ? "Low" : "Good");
      html += `<tr class="inv-variant-row" data-parent-inv="${item.source_id}" style="display:none;">
        <td class="admin-bulk-select-cell"></td>
        <td></td>
        <td><div class="inv-variant-indent"><span class="inv-variant-name">${esc(variant.name)}</span></div></td>
        <td style="color:#64748b;">${esc(variant.description || "—")}</td>
        <td>${esc(variant.unit || "—")}</td>
        <td>${esc(variantOnHand)}</td>
        <td>${statusPill(variantStatus)}</td>
        <td>${esc(variant.remarks || "—")}</td>
        <td></td>
        <td></td>
        <td class="sticky-action"></td>
      </tr>`;
    });

    return html;
  };

  const renderRow = (module, row, index) => {
    if (module === "inventory") return renderInventoryRow(row, index);
    if (module === "appointment") {
      return `<tr>
        ${rowCheckbox(module, row, row.reference_no)}
        <td style="font-weight:700;color:#800000;">${esc(row.reference_no)}</td>
        <td style="font-weight:600;">${esc(row.client_name)}</td>
        <td>${esc(row.contact_number)}</td>
        <td style="color:#64748b;">${esc(row.email)}</td>
        <td style="color:#64748b;font-size:0.8rem;">${esc(row.full_address || "—")}</td>
        <td>${esc(row.client_type)}</td>
        <td>${esc(row.purpose)}</td>
        <td>${esc(row.appointment_date)}</td>
        <td>${esc(row.appointment_time)}</td>
        <td>${statusPill(row.status)}</td>
        <td style="color:#64748b;font-size:0.82rem;">${fmtDate(row.archived_at)}</td>
        <td class="action-icons sticky-action">${restoreButton(module, row, row.reference_no)}</td>
      </tr>`;
    }
    if (module === "order") {
      return `<tr>
        ${rowCheckbox(module, row, row.order_no)}
        <td style="font-weight:700;color:#800000;">${esc(row.order_no)}</td>
        <td style="font-weight:600;">${esc(row.order_item)}</td>
        <td>${esc(row.date)}</td>
        <td>${esc(row.customer_name)}</td>
        <td>${esc(row.payment_method)}</td>
        <td style="font-weight:700;">${esc(row.total_label)}</td>
        <td>${statusPill(row.lifecycle_status)}</td>
        <td style="color:#64748b;font-size:0.82rem;">${fmtDate(row.archived_at)}</td>
        <td class="action-icons sticky-action">${restoreButton(module, row, row.order_no)}</td>
      </tr>`;
    }
    if (module === "promotion") {
      const scope =
        row.scope === "all_products"
          ? "All products"
          : `${Array.isArray(row.product_ids) ? row.product_ids.length : 0} selected product(s)`;
      return `<tr>
        ${rowCheckbox(module, row, row.title)}
        <td style="font-weight:600;">${esc(row.title)}</td>
        <td><strong style="color:#800000;">${esc(row.discount_percent)}% OFF</strong></td>
        <td>${esc(scope)}</td>
        <td style="font-size:0.78rem;color:#64748b;">${scheduleLabel(row)}</td>
        <td>${statusPill(row.is_enabled ? "Enabled" : "Paused")}</td>
        <td style="color:#64748b;font-size:0.82rem;">${fmtDate(row.archived_at)}</td>
        <td class="action-icons sticky-action">${restoreButton(module, row, row.title)}</td>
      </tr>`;
    }

    return `<tr>
      ${rowCheckbox(module, row, row.title)}
      <td style="font-weight:600;">${esc(row.title)}</td>
      <td>${esc(row.placement || "Everywhere")}</td>
      <td style="min-width:220px;white-space:normal;">${esc(row.message)}</td>
      <td style="font-size:0.78rem;color:#64748b;">${scheduleLabel(row)}</td>
      <td>${statusPill(row.is_enabled ? "Enabled" : "Paused")}</td>
      <td style="color:#64748b;font-size:0.82rem;">${fmtDate(row.archived_at)}</td>
      <td class="action-icons sticky-action">${restoreButton(module, row, row.title)}</td>
    </tr>`;
  };

  const renderModule = (module) => {
    const config = moduleConfig[module];
    const rows = filteredRows(module);
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    state[module].page = Math.min(Math.max(1, state[module].page), pages);
    const scoped = pageRows(module);

    if (config.tbody) {
      config.tbody.innerHTML = scoped.length
        ? scoped.map((row, index) => renderRow(module, row, index)).join("")
        : `<tr><td colspan="${config.colCount}"><div class="table-empty-state"><i class="fa-regular fa-folder-open"></i><span>${esc(config.emptyMessage)}</span></div></td></tr>`;
    }

    const from = rows.length ? (state[module].page - 1) * PAGE_SIZE + 1 : 0;
    const to = Math.min(rows.length, state[module].page * PAGE_SIZE);
    if (config.meta) {
      config.meta.textContent = `Page ${state[module].page} of ${pages} • Showing ${from}–${to} of ${rows.length}`;
    }
    if (config.pageNumber) {
      config.pageNumber.value = String(state[module].page);
      config.pageNumber.max = String(pages);
    }
    if (config.prev) config.prev.disabled = state[module].page <= 1;
    if (config.next) config.next.disabled = state[module].page >= pages;
    if (config.count) config.count.textContent = String(state[module].all.length);
    state[module].controller?.sync();
  };

  const renderAll = () => {
    Object.keys(moduleConfig).forEach(renderModule);
  };

  const requestRestore = async (module, ids) => {
    const response = await fetch(`${API_BASE_URL}/admin/archives/restore-bulk`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${getToken()}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ module, ids }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.message || "Failed to restore selected records.");
    }
    return payload;
  };

  const restoreSelected = (module, ids, controller) => {
    const config = moduleConfig[module];
    window.runAdminBulkAction?.({
      controller,
      ids,
      action: "restore",
      tableLabel: config.tableLabel,
      loadingText: "Restoring...",
      execute: (selectedIds) => requestRestore(module, selectedIds),
      afterSuccess: async (payload) => {
        window.dispatchEvent(
          new CustomEvent("fmrc:archives-updated", {
            detail: {
              module,
              action: "restore-bulk",
              ids: payload?.processed_ids || [],
            },
          }),
        );
        await loadArchives();
      },
    });
  };

  const setupBulkSelections = () => {
    Object.entries(moduleConfig).forEach(([module, config]) => {
      state[module].controller = window.AdminBulkSelection?.create({
        key: `archive-${module}`,
        table: config.table,
        footer: config.footer,
        tableLabel: config.tableLabel,
        getId: (row) => row?.source_id,
        getEligibleRows: () => filteredRows(module),
        getPageRows: () => pageRows(module),
        idleAction: {
          label: `Select ${config.tableLabel} to restore`,
          icon: "fa-rotate-left",
          className: "admin-bulk-restore",
        },
        actions: [
          {
            key: "restore",
            label: `Restore selected ${config.tableLabel}`,
            icon: "fa-rotate-left",
            className: "admin-bulk-restore",
            onClick: (ids, controller) =>
              restoreSelected(module, ids, controller),
          },
        ],
      });
    });
  };

  const buildSkeletonRows = (target, columns) => {
    if (window.AdminTableSkeleton) {
      return window.AdminTableSkeleton.build(target, { rows: 3, columns });
    }
    const cells = Array.from(
      { length: columns },
      () => '<td><span class="admin-table-skeleton-bar"></span></td>',
    ).join("");
    return `<tr class="admin-table-skeleton-row" aria-hidden="true">${cells}</tr>`.repeat(
      3,
    );
  };

  const setLoading = () => {
    Object.values(moduleConfig).forEach((config) => {
      if (config.tbody) {
        const usedSharedSkeleton = window.AdminTableSkeleton?.show(
          config.tbody,
          { rows: 3, columns: config.colCount },
        );
        if (!usedSharedSkeleton) {
          config.tbody.innerHTML = buildSkeletonRows(
            config.tbody,
            config.colCount,
          );
        }
      }
      if (config.meta) config.meta.textContent = "Loading…";
      if (config.prev) config.prev.disabled = true;
      if (config.next) config.next.disabled = true;
    });
  };

  const setError = (message) => {
    Object.values(moduleConfig).forEach((config) => {
      if (!config.tbody) return;
      config.tbody.innerHTML = `<tr><td colspan="${config.colCount}"><div class="table-empty-state"><i class="fa-solid fa-triangle-exclamation" style="color:#ef4444;"></i><span style="color:#ef4444;">${esc(message)}</span></div></td></tr>`;
    });
  };

  const loadArchives = async () => {
    const token = getToken();
    if (!token) {
      window.showAdminPopup?.("Please log in before opening Archives.", {
        title: "Session Required",
      });
      return;
    }

    const refreshButton = document.getElementById("archivesRefreshBtn");
    if (refreshButton) refreshButton.disabled = true;
    setLoading();
    try {
      const response = await fetch(`${API_BASE_URL}/admin/archives`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || "Unable to load archived records.");
      }

      Object.entries(moduleConfig).forEach(([module, config]) => {
        state[module].all = Array.isArray(payload?.[config.payloadKey])
          ? payload[config.payloadKey]
          : [];
        state[module].page = 1;
      });
      renderAll();
    } catch (error) {
      setError(error?.message || "Unable to load archived records.");
      window.showAdminPopup?.(
        error?.message || "Unable to load archived records.",
        { title: "Load Failed" },
      );
    } finally {
      if (refreshButton) refreshButton.disabled = false;
    }
  };

  document.querySelectorAll(".archive-tab-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = String(button.dataset.tab || "");
      document.querySelectorAll(".archive-tab-btn").forEach((candidate) => {
        candidate.classList.toggle("active", candidate === button);
      });
      document.querySelectorAll(".archive-section").forEach((section) => {
        section.classList.toggle(
          "active",
          section.id.toLowerCase() === `section${tab}`.toLowerCase(),
        );
      });
    });
  });

  Object.entries(moduleConfig).forEach(([module, config]) => {
    config.prev?.addEventListener("click", () => {
      if (state[module].page <= 1) return;
      state[module].page -= 1;
      renderModule(module);
    });
    config.next?.addEventListener("click", () => {
      const pages = Math.max(
        1,
        Math.ceil(filteredRows(module).length / PAGE_SIZE),
      );
      if (state[module].page >= pages) return;
      state[module].page += 1;
      renderModule(module);
    });

    window.AdminPageNumberInput?.bind(config.pageNumber, {
      getPage: () => state[module].page,
      getTotalPages: () =>
        Math.max(1, Math.ceil(filteredRows(module).length / PAGE_SIZE)),
      onChange: (page) => {
        state[module].page = page;
        renderModule(module);
      },
    });
  });

  document.getElementById("archiveSearchInput")?.addEventListener("input", (event) => {
    searchQuery = String(event.target?.value || "")
      .trim()
      .toLowerCase();
    Object.values(state).forEach((moduleState) => {
      moduleState.page = 1;
    });
    renderAll();
  });

  document.getElementById("archivesRefreshBtn")?.addEventListener("click", () => {
    void loadArchives();
  });

  document.body.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const toggle = target.closest("[data-inv-toggle]");
    if (toggle) {
      const parentId = toggle.getAttribute("data-inv-toggle");
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!expanded));
      document
        .querySelectorAll(`.inv-variant-row[data-parent-inv="${parentId}"]`)
        .forEach((row) => {
          row.style.display = expanded ? "none" : "table-row";
        });
      return;
    }

    const restore = target.closest("[data-archive-restore]");
    if (!restore) return;
    const module = restore.getAttribute("data-archive-restore");
    const id = Number(restore.getAttribute("data-id") || 0);
    if (!moduleConfig[module] || !id) return;
    restoreSelected(module, [id], state[module].controller);
  });

  setupBulkSelections();
  void loadArchives();
});
