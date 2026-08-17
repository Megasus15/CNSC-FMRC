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
    return: { all: [], page: 1, controller: null },
    rating: { all: [], page: 1, controller: null },
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
    return: {
      payloadKey: "returns",
      tableId: "returnArchiveTable",
      tbodyId: "returnArchiveTbody",
      footerId: "returnArchiveFooter",
      metaId: "returnArchiveMeta",
      pageId: "returnArchiveCurrentPage",
      prevId: "returnArchivePrevBtn",
      nextId: "returnArchiveNextBtn",
      countId: "tabCountReturn",
      colCount: 11,
      tableLabel: "Returns & Refunds Archived Items",
      emptyMessage: "No archived return or refund records found.",
      searchFields: [
        "return_no",
        "order_no",
        "customer_name",
        "customer_email",
        "product_name",
        "reason_label",
        "resolution_label",
        "status_label",
        "refund_method_label",
        "refund_reference",
        "handled_by",
      ],
    },
    rating: {
      payloadKey: "ratings",
      tableId: "ratingArchiveTable",
      tbodyId: "ratingArchiveTbody",
      footerId: "ratingArchiveFooter",
      metaId: "ratingArchiveMeta",
      pageId: "ratingArchiveCurrentPage",
      prevId: "ratingArchivePrevBtn",
      nextId: "ratingArchiveNextBtn",
      countId: "tabCountRating",
      colCount: 10,
      tableLabel: "Product Review Archived Items",
      emptyMessage: "No archived product reviews found.",
      searchFields: [
        "customer_name",
        "customer_email",
        "product_name",
        "order_no",
        "feedback",
        "admin_reply",
        "stars",
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

  const deleteButton = (module, row, name) => `
    <button type="button" class="archive-delete-action" data-tooltip="Delete Permanently" data-archive-delete="${module}" data-id="${row.source_id}" aria-label="Delete ${esc(name)}">
      <i class="fa-solid fa-trash"></i>
    </button>`;

  const rowCheckbox = (module, row, label) => `
    <td class="admin-bulk-select-cell">
      <input type="checkbox" data-admin-bulk-row="archive-${module}" value="${row.source_id}" aria-label="Select ${esc(label)}" />
    </td>`;

  const renderInventoryRow = (item, index) => {
    const onHand = Number(item.on_hand || 0);
    const status =
      item.status || (onHand <= 0 ? "Critical" : onHand <= 5 ? "Low" : "Good");
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
      <td class="action-icons sticky-action">${restoreButton("inventory", item, item.item_name)}${deleteButton("inventory", item, item.item_name)}</td>
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
        <td class="action-icons sticky-action">${restoreButton(module, row, row.reference_no)}${deleteButton(module, row, row.reference_no)}</td>
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
        <td class="action-icons sticky-action">${restoreButton(module, row, row.order_no)}${deleteButton(module, row, row.order_no)}</td>
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
        <td class="action-icons sticky-action">${restoreButton(module, row, row.title)}${deleteButton(module, row, row.title)}</td>
        </tr>`;
    }

    if (module === "return") {
      const customer = row.customer_name || row.customer_email || "Unknown";
      const status = String(row.status || "");
      // Same palette the Returns & Refunds panel uses on the Orders page.
      const statusClass =
        status === "refunded"
          ? "status-green"
          : status === "rejected" || status === "cancelled"
            ? "status-red"
            : "status-blue";
      const quantity = Number(row.quantity || 0);
      const itemsCount = Number(row.items_count || 0);
      const itemsLine = `${itemsCount} item${itemsCount === 1 ? "" : "s"} • ${quantity} pc${quantity === 1 ? "" : "s"}`;
      return `<tr>
        ${rowCheckbox(module, row, row.return_no)}
        <td style="font-weight:700;color:#800000;">${esc(row.return_no)}<div style="font-size:0.74rem;color:#64748b;font-weight:600;">${esc(row.order_no)}</div></td>
        <td>
          <strong>${esc(customer)}</strong>
          ${row.customer_email ? `<div style="font-size:0.74rem;color:#64748b;">${esc(row.customer_email)}</div>` : ""}
        </td>
        <td><strong>${esc(row.product_name)}</strong><div style="font-size:0.74rem;color:#64748b;">${esc(itemsLine)}</div></td>
        <td style="min-width:180px;white-space:normal;">${esc(row.reason_label)}<div style="font-size:0.74rem;color:#64748b;">${esc(row.resolution_label)}</div></td>
        <td style="font-weight:700;">${esc(row.amount_label)}${row.refund_method_label ? `<div style="font-size:0.74rem;color:#64748b;font-weight:600;">${esc(row.refund_method_label)}</div>` : ""}</td>
        <td><span class="status-pill ${statusClass}">${esc(row.status_label)}</span></td>
        <td>${esc(row.handled_by || "—")}<div style="font-size:0.74rem;color:#64748b;">${esc(row.media_count || 0)} evidence</div></td>
        <td style="color:#64748b;font-size:0.82rem;">${fmtDate(row.created_at)}</td>
        <td style="color:#64748b;font-size:0.82rem;">${fmtDate(row.archived_at)}</td>
        <td class="action-icons sticky-action">${restoreButton(module, row, row.return_no)}${deleteButton(module, row, row.return_no)}</td>
      </tr>`;
    }

    if (module === "rating") {
      const customer = row.customer_name || row.customer_email || "Unknown";
      const orderLabel = row.order_no ? `Order ${row.order_no}` : "Order";
      const stars = Math.min(5, Math.max(0, Number(row.stars) || 0));
      const starMarkup = `${"★".repeat(stars)}${"☆".repeat(5 - stars)}`;
      const replyLabel = row.admin_reply ? "Replied" : "No reply";
      const replyClass = row.admin_reply ? "status-green" : "status-yellow";
      const feedback = row.feedback || "No feedback";
      return `<tr>
        ${rowCheckbox(module, row, customer)}
        <td>
          <strong>${esc(customer)}</strong>
          ${row.customer_email ? `<div style="font-size:0.74rem;color:#64748b;">${esc(row.customer_email)}</div>` : ""}
          ${row.is_anonymous ? `<div style="font-size:0.7rem;color:#92400e;margin-top:3px;"><i class="fa-solid fa-user-secret"></i> Anonymous on product page</div>` : ""}
        </td>
        <td><strong>${esc(row.product_name || "Custom Order")}</strong><div style="font-size:0.74rem;color:#64748b;">${esc(orderLabel)}</div></td>
        <td><span style="color:#f59e0b;letter-spacing:1px;white-space:nowrap;">${starMarkup}</span><div style="font-size:0.74rem;color:#64748b;">${stars}/5</div></td>
        <td style="min-width:220px;max-width:300px;white-space:normal;">${esc(feedback)}</td>
        <td>${statusPill(replyLabel).replace("status-gray", replyClass)}</td>
        <td>${esc(row.media_count || 0)} media<div style="font-size:0.74rem;color:#64748b;"><i class="fa-regular fa-thumbs-up"></i> ${esc(row.likes_count || 0)} likes</div></td>
        <td style="color:#64748b;font-size:0.82rem;">${fmtDate(row.created_at)}</td>
        <td style="color:#64748b;font-size:0.82rem;">${fmtDate(row.archived_at)}</td>
        <td class="action-icons sticky-action">${restoreButton(module, row, customer)}${deleteButton(module, row, customer)}</td>
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
      <td class="action-icons sticky-action">${restoreButton(module, row, row.title)}${deleteButton(module, row, row.title)}</td>
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
    if (config.count)
      config.count.textContent = String(state[module].all.length);
    state[module].controller?.sync();
  };

  const renderAll = () => {
    Object.keys(moduleConfig).forEach(renderModule);
  };

  const requestRestore = async (module, ids) => {
    const response = await fetch(
      `${API_BASE_URL}/admin/archives/restore-bulk`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${getToken()}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ module, ids }),
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        payload?.message || "Failed to restore selected records.",
      );
    }
    return payload;
  };

  const requestDelete = async (module, ids) => {
    const response = await fetch(
      `${API_BASE_URL}/admin/archives/delete-bulk`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${getToken()}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ module, ids }),
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        payload?.message || "Failed to permanently delete selected records.",
      );
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

  const deleteSelected = (module, ids, controller) => {
    const config = moduleConfig[module];
    window.runAdminBulkAction?.({
      controller,
      ids,
      action: "delete",
      tableLabel: config.tableLabel,
      irreversible: true,
      confirmTitle: "Delete Selected Permanently",
      confirmText: "Delete Permanently",
      loadingText: "Deleting...",
      successTitle: "Deleted Successfully",
      execute: (selectedIds) => requestDelete(module, selectedIds),
      afterSuccess: async (payload) => {
        window.dispatchEvent(
          new CustomEvent("fmrc:archives-updated", {
            detail: {
              module,
              action: "delete-bulk",
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
        selectionModes: [
          {
            key: "restore",
            label: `Bulk restore ${config.tableLabel}`,
            icon: "fa-rotate-left",
            className: "admin-bulk-restore",
          },
          {
            key: "delete",
            label: `Bulk delete ${config.tableLabel} permanently`,
            icon: "fa-trash",
            className: "admin-bulk-delete",
          },
        ],
        actions: [
          {
            key: "restore",
            label: `Restore selected ${config.tableLabel}`,
            icon: "fa-rotate-left",
            className: "admin-bulk-restore",
            onClick: (ids, controller) =>
              restoreSelected(module, ids, controller),
          },
          {
            key: "delete",
            label: `Permanently delete selected ${config.tableLabel}`,
            icon: "fa-trash",
            className: "admin-bulk-delete",
            onClick: (ids, controller) =>
              deleteSelected(module, ids, controller),
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

  document
    .getElementById("archiveSearchInput")
    ?.addEventListener("input", (event) => {
      searchQuery = String(event.target?.value || "")
        .trim()
        .toLowerCase();
      Object.values(state).forEach((moduleState) => {
        moduleState.page = 1;
      });
      renderAll();
    });

  document
    .getElementById("archivesRefreshBtn")
    ?.addEventListener("click", () => {
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
    if (restore) {
      const module = restore.getAttribute("data-archive-restore");
      const id = Number(restore.getAttribute("data-id") || 0);
      if (!moduleConfig[module] || !id) return;
      restoreSelected(module, [id], state[module].controller);
      return;
    }

    // ─── Delete single archive ──────────────────────────────────────────────
    const deleteBtn = target.closest("[data-archive-delete]");
    if (deleteBtn) {
      const module = deleteBtn.getAttribute("data-archive-delete");
      const id = Number(deleteBtn.getAttribute("data-id") || 0);
      if (!moduleConfig[module] || !id) return;
      openDeleteConfirmModal(module, id);
      return;
    }
  });

  // ─── Delete Confirmation Modal ──────────────────────────────────────────────
  let pendingDeleteModule = null;
  let pendingDeleteId = null;

  const openDeleteConfirmModal = (module, id) => {
    pendingDeleteModule = module;
    pendingDeleteId = id;
    const rows = state[module]?.all || [];
    const row = rows.find((r) => r.source_id === id);
    const label =
      row?.item_name ||
      row?.reference_no ||
      row?.return_no ||
      row?.order_no ||
      row?.product_name ||
      row?.customer_name ||
      row?.title ||
      `ID ${id}`;
    const labelEl = document.getElementById("deleteArchiveTargetLabel");
    if (labelEl) labelEl.textContent = label;
    document.getElementById("modalDeleteArchive")?.classList.add("show");
  };

  document
    .getElementById("btnCancelDeleteArchive")
    ?.addEventListener("click", () => {
      document.getElementById("modalDeleteArchive")?.classList.remove("show");
      pendingDeleteModule = null;
      pendingDeleteId = null;
    });

  document
    .getElementById("btnConfirmDeleteArchive")
    ?.addEventListener("click", async () => {
      if (!pendingDeleteModule || !pendingDeleteId) return;

      const confirmBtn = document.getElementById("btnConfirmDeleteArchive");
      if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML =
          '<i class="fa-solid fa-spinner fa-spin"></i> Deleting\u2026';
      }

      try {
        const response = await fetch(
          `${API_BASE_URL}/admin/archives/delete-bulk`,
          {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${getToken()}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              module: pendingDeleteModule,
              ids: [pendingDeleteId],
            }),
          },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.message || "Failed to delete record.");
        }

        document.getElementById("modalDeleteArchive")?.classList.remove("show");
        pendingDeleteModule = null;
        pendingDeleteId = null;
        await loadArchives();
        window.showAdminPopup?.("Archived record permanently deleted.", {
          title: "Deleted \u2713",
        });
      } catch (error) {
        window.showAdminPopup?.(error?.message || "Unable to delete record.", {
          title: "Delete Failed",
        });
      } finally {
        if (confirmBtn) {
          confirmBtn.disabled = false;
          confirmBtn.innerHTML =
            '<i class="fa-solid fa-trash"></i> Delete Permanently';
        }
      }
    });

  // ─── Auto-Delete Settings Modal ─────────────────────────────────────────────
  const AUTO_DELETE_KEY = "fmrc_archive_retention_days";

  const getRetentionDays = () => {
    const stored = localStorage.getItem(AUTO_DELETE_KEY);
    const parsed = Number(stored);
    if ([30, 60, 90].includes(parsed)) return parsed;
    return 60; // default
  };

  const saveRetentionDays = (days) => {
    localStorage.setItem(AUTO_DELETE_KEY, String(days));
  };

  const openAutoDeleteModal = () => {
    const modal = document.getElementById("modalAutoDeleteSettings");
    if (!modal) return;
    const current = getRetentionDays();
    modal.querySelectorAll("input[name=retentionDays]").forEach((radio) => {
      radio.checked = Number(radio.value) === current;
    });
    modal.classList.add("show");
  };

  document
    .getElementById("btnOpenAutoDeleteSettings")
    ?.addEventListener("click", openAutoDeleteModal);

  document
    .getElementById("btnCancelAutoDelete")
    ?.addEventListener("click", () => {
      document
        .getElementById("modalAutoDeleteSettings")
        ?.classList.remove("show");
    });

  document
    .getElementById("btnSaveAutoDelete")
    ?.addEventListener("click", async () => {
      const modal = document.getElementById("modalAutoDeleteSettings");
      const selected = modal?.querySelector(
        "input[name=retentionDays]:checked",
      );
      if (!selected) return;

      const days = Number(selected.value);
      saveRetentionDays(days);

      const saveBtn = document.getElementById("btnSaveAutoDelete");
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML =
          '<i class="fa-solid fa-spinner fa-spin"></i> Saving\u2026';
      }

      try {
        const response = await fetch(
          `${API_BASE_URL}/admin/archives/auto-delete`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${getToken()}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ retention_days: days }),
          },
        );
        const payload = await response.json().catch(() => ({}));

        modal?.classList.remove("show");

        if (payload?.deleted_count > 0) {
          await loadArchives();
          window.showAdminPopup?.(
            `Auto-delete setting saved (${days} days). ${payload.deleted_count} expired record(s) were removed.`,
            { title: "Settings Saved \u2713" },
          );
        } else {
          window.showAdminPopup?.(
            `Auto-delete setting saved to ${days} days. No expired records found.`,
            { title: "Settings Saved \u2713" },
          );
        }
      } catch (error) {
        window.showAdminPopup?.(
          error?.message || "Unable to save auto-delete settings.",
          { title: "Save Failed" },
        );
      } finally {
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.innerHTML = '<i class="fa-solid fa-check"></i> Save';
        }
      }
    });

  // Run auto-delete silently on page load
  const runAutoDeleteOnLoad = async () => {
    const token = getToken();
    if (!token) return;
    const days = getRetentionDays();
    try {
      await fetch(`${API_BASE_URL}/admin/archives/auto-delete`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ retention_days: days }),
      });
    } catch {
      // silent fail — auto-delete is best-effort
    }
  };

  setupBulkSelections();
  // Load archives first so users can see and restore data, then run auto-delete silently
  loadArchives().then(() => void runAutoDeleteOnLoad());
});
