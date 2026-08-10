document.addEventListener("DOMContentLoaded", () => {
  const resolveApiBaseUrl = () => {
    if (window.APP_API_BASE_URL)
      return window.APP_API_BASE_URL.replace(/\/+$/, "");
    const protocol = String(window.location.protocol || "").toLowerCase();
    const hostname = String(
      window.location.hostname || "127.0.0.1",
    ).toLowerCase();
    if (!/^https?:$/.test(protocol) || !hostname)
      return "http://127.0.0.1:8000/api";
    const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1";
    if (isLocalHost) return `${protocol}//${hostname}:8000/api`;
    return `${window.location.origin.replace(/\/+$/, "")}/api`;
  };

  const API = resolveApiBaseUrl();
  const token =
    (window.AdminSession && window.AdminSession.getToken()) ||
    localStorage.getItem("admin_auth_token") ||
    localStorage.getItem("staff_auth_token") ||
    localStorage.getItem("auth_token");
  if (!token) {
    window.location.href = "../admin-auth/auth.html";
    return;
  }
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const $ = (id) => document.getElementById(id);
  const SCHEDULE_TIME_ZONE = "Asia/Manila";
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>\"]/g,
      (char) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char],
    );
  const localDate = (value) => {
    if (!value) return "";

    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: SCHEDULE_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(value));
    const values = Object.fromEntries(
      parts
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );
    return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
  };

  const toScheduleApiValue = (value) => {
    const normalized = String(value || "").trim();
    if (!normalized) return null;
    return `${normalized.length === 16 ? `${normalized}:00` : normalized}+08:00`;
  };

  const prettyDate = (value) =>
    value
      ? new Date(value).toLocaleString("en-PH", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: SCHEDULE_TIME_ZONE,
        })
      : "No limit";

  let products = [];
  let promotions = [];
  let announcements = [];
  let previewItems = [];
  let previewIndex = 0;

  let promotionPage = 1;
  const PROMOTIONS_PER_PAGE = 5;
  let announcementPage = 1;
  const ANNOUNCEMENTS_PER_PAGE = 5;
  let promotionBulkController = null;
  let announcementBulkController = null;
  let campaignRefreshTimer = null;
  const PROMOTIONS_REALTIME_CHANNEL = "fmrc-promotions-realtime";
  const promotionsChannel =
    typeof window.BroadcastChannel === "function"
      ? new window.BroadcastChannel(PROMOTIONS_REALTIME_CHANNEL)
      : null;

  function broadcastCampaignChange(type, id = null) {
    const detail = { type, id };
    window.dispatchEvent(
      new CustomEvent("fmrc:promotions-updated", { detail }),
    );
    promotionsChannel?.postMessage({ ...detail, source: "campaign-workspace" });
  }

  // ── Modal Helpers ────────────────────────────────────────────────────────
  function openModal(modalId) {
    const modal = $(modalId);
    if (modal) {
      modal.classList.add("show");
      renderLivePreview();
    }
  }

  function closeModal(modalId) {
    const modal = $(modalId);
    if (modal) {
      modal.classList.remove("show");
      renderLivePreview();
    }
  }

  // ── Skeleton Loader ───────────────────────────────────────────────────────
  function renderSkeletons() {
    const skeletonRow = `
      <tr>
        <td colspan="8" style="padding:14px;">
          <div style="height:14px;width:75%;background:#e2e8f0;border-radius:4px;animation:campaignPulse 1.2s infinite ease-in-out;"></div>
        </td>
      </tr>
    `;
    if ($("promotionTableBody"))
      $("promotionTableBody").innerHTML = skeletonRow + skeletonRow;
    if ($("announcementTableBody"))
      $("announcementTableBody").innerHTML = skeletonRow + skeletonRow;
    if ($("promotionProductPicker"))
      $("promotionProductPicker").innerHTML =
        '<span class="field-hint">Loading products picker...</span>';

    if (!document.getElementById("campaignSkeletonStyle")) {
      const style = document.createElement("style");
      style.id = "campaignSkeletonStyle";
      style.textContent = `@keyframes campaignPulse { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }`;
      document.head.appendChild(style);
    }
  }

  async function request(url, options = {}) {
    const response = await fetch(`${API}${url}`, {
      ...options,
      headers: { ...headers, ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        payload.message ||
          Object.values(payload.errors || {}).flat()[0] ||
          "Request failed.",
      );
    return payload;
  }

  function showError(error) {
    if (typeof window.showAdminPopup === "function") {
      window.showAdminPopup(
        error.message || "Something went wrong. Please try again.",
        { title: "Error" },
      );
    } else {
      window.alert(error.message || "Something went wrong. Please try again.");
    }
  }

  function selectedProductIds() {
    return [
      ...document.querySelectorAll("#promotionProductPicker input:checked"),
    ].map((box) => Number(box.value));
  }

  function renderProductPicker(selected = []) {
    if (!$("promotionProductPicker")) return;
    $("promotionProductPicker").innerHTML = products.length
      ? products
          .map(
            (product) =>
              `<label style="display:flex; align-items:center; gap:8px; padding:6px; font-size:0.8rem; cursor:pointer;"><input type="checkbox" value="${product.id}" ${selected.includes(Number(product.id)) ? "checked" : ""} /> ${esc(product.name)} <span style="margin-left:auto;color:#8892a1;font-size:0.75rem">${esc(product.code || "")}</span></label>`,
          )
          .join("")
      : '<span class="field-hint">No products are available yet.</span>';
  }

  function statusName(item) {
    const now = Date.now();
    const endsAt = item?.ends_at ? Date.parse(item.ends_at) : NaN;
    const startsAt = item?.starts_at ? Date.parse(item.starts_at) : NaN;

    if (Number.isFinite(endsAt) && endsAt <= now) return "FINISHED";
    if (item?.is_enabled === false) return "PAUSED";
    if (Number.isFinite(startsAt) && startsAt > now) return "SCHEDULED";
    return "LIVE";
  }

  function status(item) {
    const name = statusName(item);
    const className =
      name === "LIVE" ? "live" : name === "PAUSED" ? "off" : name.toLowerCase();
    return `<span class="campaign-status ${className}">${name}</span>`;
  }

  function renderPromotions() {
    const tbody = $("promotionTableBody");
    if (!tbody) return;

    const total = promotions.length;
    const maxPages = Math.ceil(total / PROMOTIONS_PER_PAGE) || 1;
    if (promotionPage > maxPages) promotionPage = maxPages;
    if (promotionPage < 1) promotionPage = 1;

    const startIdx = (promotionPage - 1) * PROMOTIONS_PER_PAGE;
    const pageItems = promotions.slice(
      startIdx,
      startIdx + PROMOTIONS_PER_PAGE,
    );

    if (!total) {
      tbody.innerHTML = `<tr><td colspan="8" class="campaign-empty" style="text-align:center;padding:24px;color:#798395;">No promotions yet. Click "+ Add Promotion" to create one.</td></tr>`;
    } else {
      tbody.innerHTML = pageItems
        .map((promotion, index) => {
          const rowNum = startIdx + index + 1;
          const scopeText =
            promotion.scope === "all_products"
              ? "All products"
              : `${(promotion.product_ids || []).length} selected product(s)`;
          const scheduleText = `From ${prettyDate(promotion.starts_at)}<br>to ${prettyDate(promotion.ends_at)}`;
          return `
          <tr>
            <td class="admin-bulk-select-cell"><input type="checkbox" data-admin-bulk-row="promotions" value="${promotion.id}" aria-label="Select ${esc(promotion.title)}" /></td>
            <td style="font-weight:600;color:#6b7280;">${rowNum}</td>
            <td style="font-weight:600;color:#1e293b;">${esc(promotion.title)}</td>
            <td><span style="font-weight:700;color:#800000;">${promotion.discount_percent}% OFF</span></td>
            <td style="font-size:0.82rem;color:#475569;">${scopeText}</td>
            <td style="font-size:0.78rem;color:#64748b;">${scheduleText}</td>
            <td>${status(promotion)}</td>
            <td class="action-icons sticky-action">
              <button type="button" data-tooltip="Edit Promotion" data-edit-promotion="${promotion.id}"><i class="fa-solid fa-pen-to-square"></i></button>
              <button type="button" data-tooltip="Archive Promotion" data-archive-promotion="${promotion.id}"><i class="fa-solid fa-box-archive"></i></button>
            </td>
          </tr>
        `;
        })
        .join("");
    }

    const endCount = Math.min(startIdx + pageItems.length, total);
    const metaText = total
      ? `Showing ${startIdx + 1}-${endCount} of ${total} promotions`
      : "Showing 0 of 0 promotions";
    if ($("promotionTableMeta")) $("promotionTableMeta").textContent = metaText;
    if ($("promotionCurrentPage"))
      $("promotionCurrentPage").textContent = promotionPage;
    if ($("promotionPrevPage"))
      $("promotionPrevPage").disabled = promotionPage <= 1;
    if ($("promotionNextPage"))
      $("promotionNextPage").disabled = promotionPage >= maxPages;
    promotionBulkController?.sync();
  }

  function renderAnnouncements() {
    const tbody = $("announcementTableBody");
    if (!tbody) return;

    const total = announcements.length;
    const maxPages = Math.ceil(total / ANNOUNCEMENTS_PER_PAGE) || 1;
    if (announcementPage > maxPages) announcementPage = maxPages;
    if (announcementPage < 1) announcementPage = 1;

    const startIdx = (announcementPage - 1) * ANNOUNCEMENTS_PER_PAGE;
    const pageItems = announcements.slice(
      startIdx,
      startIdx + ANNOUNCEMENTS_PER_PAGE,
    );

    const placementLabels = {
      site: "Main website",
      products: "Products page",
      both: "Everywhere",
    };

    if (!total) {
      tbody.innerHTML = `<tr><td colspan="7" class="campaign-empty" style="text-align:center;padding:24px;color:#798395;">No announcements yet. Click "+ Add Announcement" to publish one.</td></tr>`;
    } else {
      tbody.innerHTML = pageItems
        .map((announcement, index) => {
          const rowNum = startIdx + index + 1;
          const placementText =
            placementLabels[announcement.placement] || announcement.placement;
          const scheduleText = `From ${prettyDate(announcement.starts_at)}<br>to ${prettyDate(announcement.ends_at)}`;

          return `
          <tr>
            <td class="admin-bulk-select-cell"><input type="checkbox" data-admin-bulk-row="announcements" value="${announcement.id}" aria-label="Select ${esc(announcement.title)}" /></td>
            <td style="font-weight:600;color:#6b7280;">${rowNum}</td>
            <td style="font-weight:600;color:#1e293b;">${esc(announcement.title)}</td>
            <td style="font-size:0.82rem;color:#475569;">${esc(placementText)}</td>
            <td style="font-size:0.78rem;color:#64748b;">${scheduleText}</td>
            <td>${status(announcement)}</td>
            <td class="action-icons sticky-action">
              <button type="button" data-tooltip="Edit Announcement" data-edit-announcement="${announcement.id}"><i class="fa-solid fa-pen-to-square"></i></button>
              <button type="button" data-tooltip="Archive Announcement" data-archive-announcement="${announcement.id}"><i class="fa-solid fa-box-archive"></i></button>
            </td>
          </tr>
        `;
        })
        .join("");
    }

    const endCount = Math.min(startIdx + pageItems.length, total);
    const metaText = total
      ? `Showing ${startIdx + 1}-${endCount} of ${total} announcements`
      : "Showing 0 of 0 announcements";
    if ($("announcementTableMeta"))
      $("announcementTableMeta").textContent = metaText;
    if ($("announcementCurrentPage"))
      $("announcementCurrentPage").textContent = announcementPage;
    if ($("announcementPrevPage"))
      $("announcementPrevPage").disabled = announcementPage <= 1;
    if ($("announcementNextPage"))
      $("announcementNextPage").disabled = announcementPage >= maxPages;
    announcementBulkController?.sync();
  }

  function archiveCampaigns(kind, ids, controller) {
    const isPromotion = kind === "promotions";
    const tableLabel = isPromotion
      ? "Saved Product Promotions records"
      : "Saved Visitor Announcements records";
    window.runAdminBulkAction?.({
      controller,
      ids,
      action: "archive",
      tableLabel,
      loadingText: "Archiving...",
      execute: (selectedIds) =>
        request(`/admin/${kind}/archive-bulk`, {
          method: "PATCH",
          body: JSON.stringify({ ids: selectedIds }),
        }),
      afterSuccess: async (payload) => {
        broadcastCampaignChange("archived-bulk", payload?.processed_ids);
        await load();
      },
    });
  }

  function setupCampaignBulkSelections() {
    promotionBulkController = window.AdminBulkSelection?.create({
      key: "promotions",
      table: $("promotionTable"),
      footer: $("promotionTableFooter"),
      tableLabel: "Saved Product Promotions",
      getEligibleRows: () => promotions,
      getPageRows: () => {
        const start = (promotionPage - 1) * PROMOTIONS_PER_PAGE;
        return promotions.slice(start, start + PROMOTIONS_PER_PAGE);
      },
      idleAction: { label: "Select promotions to archive", icon: "fa-box-archive" },
      actions: [
        {
          key: "archive",
          label: "Archive selected promotions",
          icon: "fa-box-archive",
          onClick: (ids, controller) => archiveCampaigns("promotions", ids, controller),
        },
      ],
    });

    announcementBulkController = window.AdminBulkSelection?.create({
      key: "announcements",
      table: $("announcementTable"),
      footer: $("announcementTableFooter"),
      tableLabel: "Saved Visitor Announcements",
      getEligibleRows: () => announcements,
      getPageRows: () => {
        const start = (announcementPage - 1) * ANNOUNCEMENTS_PER_PAGE;
        return announcements.slice(start, start + ANNOUNCEMENTS_PER_PAGE);
      },
      idleAction: { label: "Select announcements to archive", icon: "fa-box-archive" },
      actions: [
        {
          key: "archive",
          label: "Archive selected announcements",
          icon: "fa-box-archive",
          onClick: (ids, controller) => archiveCampaigns("announcements", ids, controller),
        },
      ],
    });
  }

  function scheduleNextCampaignBoundary() {
    if (campaignRefreshTimer) {
      window.clearTimeout(campaignRefreshTimer);
      campaignRefreshTimer = null;
    }

    const now = Date.now();
    const boundaries = [...promotions, ...announcements]
      .flatMap((item) => [item?.starts_at, item?.ends_at])
      .map((value) => Date.parse(value))
      .filter((timestamp) => Number.isFinite(timestamp) && timestamp > now);

    if (!boundaries.length) return;

    const nextBoundary = Math.min(...boundaries);
    campaignRefreshTimer = window.setTimeout(() => {
      campaignRefreshTimer = null;
      void load();
    }, Math.max(50, nextBoundary - now + 25));
  }

  function getAdminProductNamesText(productIds) {
    if (!Array.isArray(productIds) || !productIds.length) return "selected products";
    const names = productIds
      .map((id) => {
        const p = products.find((prod) => Number(prod.id) === Number(id));
        return p ? p.name : null;
      })
      .filter(Boolean);
    return names.length
      ? names.join(", ")
      : `${productIds.length} selected product(s)`;
  }

  // ── Live FMRC Announcement Card Preview Renderer ────────────────────────
  function updatePreviewItems() {
    const list = [];
    announcements.forEach((a) => {
      list.push({
        title: a.title,
        message: a.message,
        cta_label: a.cta_label,
        cta_url: a.cta_url,
        badge_text: "VISITOR ANNOUNCEMENT",
      });
    });
    promotions.forEach((p) => {
      const appliesToDetail = p.scope === "all_products"
        ? "all products in our store"
        : getAdminProductNamesText(p.product_ids);
      list.push({
        title: `🎉 ${p.title} (${p.discount_percent}% OFF)`,
        message: `Special Product Promotion: Enjoy ${p.discount_percent}% OFF on ${appliesToDetail}!\n\nLimited-time campaign. Don't miss out on these savings!`,
        cta_label: "Shop Sale Items",
        cta_url: "/products-page/product.html",
        badge_text: "SPECIAL PROMOTION",
      });
    });

    if (!list.length) {
      list.push({
        title: "Announcements",
        message: "There are no active announcements right now.",
        cta_label: "",
        cta_url: "",
        badge_text: "FMRC ANNOUNCEMENT",
      });
    }
    previewItems = list;
  }

  function renderLivePreview() {
    const cardContainer = $("liveCustomerModalCard");
    if (!cardContainer) return;

    const isAnnouncementModalOpen = $("modalAddAnnouncement")?.classList.contains("show");
    const isPromotionModalOpen = $("modalAddPromotion")?.classList.contains("show");

    let currentItem = null;
    let counterLabel = "";

    if (isAnnouncementModalOpen) {
      currentItem = {
        title: $("announcementTitle")?.value.trim() || "New Announcement",
        message: $("announcementMessage")?.value.trim() || "Your message preview appears here in real-time.",
        cta_label: $("announcementCtaLabel")?.value.trim() || "",
        cta_url: $("announcementCtaUrl")?.value.trim() || "#",
        badge_text: "VISITOR ANNOUNCEMENT",
      };
      counterLabel = "Drafting Visitor Announcement";
    } else if (isPromotionModalOpen) {
      const pTitle = $("promotionTitle")?.value.trim() || "National Tech Week Sale";
      const pDiscount = $("promotionDiscount")?.value || 10;
      const pScope = $("promotionScope")?.value;
      const selectedIds = selectedProductIds();
      const appliesToDetail = pScope === "all_products"
        ? "all products in our store"
        : getAdminProductNamesText(selectedIds);

      currentItem = {
        title: `🎉 ${pTitle} (${pDiscount}% OFF)`,
        message: `Special Product Promotion: Enjoy ${pDiscount}% OFF on ${appliesToDetail}!\n\nLimited-time campaign. Don't miss out on these savings!`,
        cta_label: "Shop Sale Items",
        cta_url: "/products-page/product.html",
        badge_text: "LIVE DRAFT PROMOTION",
      };
      counterLabel = "Drafting Product Promotion";
    } else {
      if (previewIndex >= previewItems.length) previewIndex = 0;
      if (previewIndex < 0) previewIndex = 0;
      currentItem = previewItems[previewIndex];
      counterLabel = `${previewIndex + 1} of ${previewItems.length}`;
    }

    if ($("previewCounterText")) $("previewCounterText").textContent = counterLabel;

    if (typeof window.renderFMRCAnnouncementPreviewCard === "function") {
      window.renderFMRCAnnouncementPreviewCard(cardContainer, currentItem, counterLabel);
    }
  }

  function clearPromotion() {
    $("promotionForm")?.reset();
    $("promotionId").value = "";
    $("promotionDiscount").value = 10;
    $("promotionEnabled").checked = true;
    $("specificProductsField")?.classList.remove("show");
    renderProductPicker();
    renderLivePreview();
  }

  function clearAnnouncement() {
    $("announcementForm")?.reset();
    $("announcementId").value = "";
    $("announcementEnabled").checked = true;
    renderLivePreview();
  }

  function editPromotion(id) {
    const item = promotions.find((entry) => entry.id === Number(id));
    if (!item) return;
    $("promotionId").value = item.id;
    $("promotionTitle").value = item.title;
    $("promotionDiscount").value = item.discount_percent;
    $("promotionScope").value = item.scope;
    $("promotionStart").value = localDate(item.starts_at);
    $("promotionEnd").value = localDate(item.ends_at);
    $("promotionEnabled").checked = item.is_enabled;
    $("specificProductsField")?.classList.toggle(
      "show",
      item.scope === "specific_products",
    );
    renderProductPicker(item.product_ids || []);

    if ($("promotionModalTitle")) {
      $("promotionModalTitle").innerHTML = `<i class="fa-solid fa-pen-to-square" style="margin-right: 8px; color:#800000;"></i>Edit Promotion`;
    }
    openModal("modalAddPromotion");
  }

  function editAnnouncement(id) {
    const item = announcements.find((entry) => entry.id === Number(id));
    if (!item) return;
    $("announcementId").value = item.id;
    $("announcementTitle").value = item.title;
    $("announcementMessage").value = item.message;
    $("announcementPlacement").value = item.placement;
    $("announcementCtaLabel").value = item.cta_label || "";
    $("announcementCtaUrl").value = item.cta_url || "";
    $("announcementStart").value = localDate(item.starts_at);
    $("announcementEnd").value = localDate(item.ends_at);
    $("announcementEnabled").checked = item.is_enabled;

    if ($("announcementModalTitle")) {
      $("announcementModalTitle").innerHTML = `<i class="fa-solid fa-pen-to-square" style="margin-right: 8px; color:#800000;"></i>Edit Announcement`;
    }
    openModal("modalAddAnnouncement");
  }

  async function load() {
    renderSkeletons();
    try {
      const [productData, promotionData, announcementData] = await Promise.all([
        request("/admin/products/promotion-options"),
        request("/admin/promotions"),
        request("/admin/announcements"),
      ]);
      products = productData.data || [];
      promotions = promotionData.data || [];
      announcements = announcementData.data || [];

      renderProductPicker();
      renderPromotions();
      renderAnnouncements();
      updatePreviewItems();
      renderLivePreview();
      scheduleNextCampaignBoundary();
    } catch (error) {
      showError(error);
    }
  }

  // ────────────── Action Event Listeners ──────────────
  $("btnOpenAddPromotion")?.addEventListener("click", () => {
    clearPromotion();
    if ($("promotionModalTitle")) {
      $("promotionModalTitle").innerHTML = `<i class="fa-solid fa-tags" style="margin-right: 8px; color:#800000;"></i>Add New Promotion`;
    }
    openModal("modalAddPromotion");
  });

  $("btnOpenAddAnnouncement")?.addEventListener("click", () => {
    clearAnnouncement();
    if ($("announcementModalTitle")) {
      $("announcementModalTitle").innerHTML = `<i class="fa-solid fa-bullhorn" style="margin-right: 8px; color:#800000;"></i>Add New Announcement`;
    }
    openModal("modalAddAnnouncement");
  });

  $("btnOpenCustomizeModal")?.addEventListener("click", () => {
    const theme = typeof window.getGlobalFMRCTheme === "function" ? window.getGlobalFMRCTheme() : { primary: "#c0392b", secondary: "#800000" };
    if ($("themePrimaryColor")) $("themePrimaryColor").value = theme.primary;
    if ($("themeSecondaryColor")) $("themeSecondaryColor").value = theme.secondary;
    openModal("modalCustomizeTheme");
  });

  $("btnCancelThemeModal")?.addEventListener("click", () => closeModal("modalCustomizeTheme"));

  // Preset Theme Cards selection
  document.querySelectorAll("#themePresetsGrid .preset-theme-card").forEach((card) => {
    card.addEventListener("click", () => {
      document.querySelectorAll("#themePresetsGrid .preset-theme-card").forEach((c) => {
        c.classList.remove("active");
        c.style.border = "1px solid #e2e8f0";
      });
      card.classList.add("active");
      card.style.border = "2px solid #800000";

      const p = card.dataset.primary;
      const s = card.dataset.secondary;
      if ($("themePrimaryColor")) $("themePrimaryColor").value = p;
      if ($("themeSecondaryColor")) $("themeSecondaryColor").value = s;

      if (typeof window.setGlobalFMRCTheme === "function") {
        window.setGlobalFMRCTheme(p, s);
      }
      renderLivePreview();
    });
  });

  [$("themePrimaryColor"), $("themeSecondaryColor")].forEach((input) => {
    input?.addEventListener("input", () => {
      const p = $("themePrimaryColor")?.value || "#c0392b";
      const s = $("themeSecondaryColor")?.value || "#800000";
      if (typeof window.setGlobalFMRCTheme === "function") {
        window.setGlobalFMRCTheme(p, s);
      }
      renderLivePreview();
    });
  });

  $("btnSaveThemeModal")?.addEventListener("click", () => {
    const p = $("themePrimaryColor")?.value || "#c0392b";
    const s = $("themeSecondaryColor")?.value || "#800000";
    if (typeof window.setGlobalFMRCTheme === "function") {
      window.setGlobalFMRCTheme(p, s);
    }
    closeModal("modalCustomizeTheme");
    if (typeof window.showAdminPopup === "function") {
      window.showAdminPopup("Announcement modal theme saved and applied globally across customer website!", {
        title: "Theme Applied ✓",
      });
    }
    renderLivePreview();
  });

  $("promotionReset")?.addEventListener("click", () => {
    clearPromotion();
    closeModal("modalAddPromotion");
  });

  $("announcementReset")?.addEventListener("click", () => {
    clearAnnouncement();
    closeModal("modalAddAnnouncement");
  });

  // Live preview navigation arrow buttons (placed inside preview panel right below card)
  $("btnPrevPreview")?.addEventListener("click", () => {
    if (previewItems.length) {
      previewIndex = (previewIndex - 1 + previewItems.length) % previewItems.length;
      renderLivePreview();
    }
  });

  $("btnNextPreview")?.addEventListener("click", () => {
    if (previewItems.length) {
      previewIndex = (previewIndex + 1) % previewItems.length;
      renderLivePreview();
    }
  });

  // Pagination Listeners
  $("promotionPrevPage")?.addEventListener("click", () => {
    if (promotionPage > 1) {
      promotionPage--;
      renderPromotions();
    }
  });
  $("promotionNextPage")?.addEventListener("click", () => {
    const maxPages = Math.ceil(promotions.length / PROMOTIONS_PER_PAGE) || 1;
    if (promotionPage < maxPages) {
      promotionPage++;
      renderPromotions();
    }
  });

  $("announcementPrevPage")?.addEventListener("click", () => {
    if (announcementPage > 1) {
      announcementPage--;
      renderAnnouncements();
    }
  });
  $("announcementNextPage")?.addEventListener("click", () => {
    const maxPages = Math.ceil(announcements.length / ANNOUNCEMENTS_PER_PAGE) || 1;
    if (announcementPage < maxPages) {
      announcementPage++;
      renderAnnouncements();
    }
  });

  $("promotionScope")?.addEventListener("change", () => {
    $("specificProductsField")?.classList.toggle(
      "show",
      $("promotionScope").value === "specific_products",
    );
    renderLivePreview();
  });

  // Input listeners for real-time live preview update while typing in form modals
  [
    "promotionTitle",
    "promotionDiscount",
    "announcementTitle",
    "announcementMessage",
    "announcementCtaLabel",
    "announcementCtaUrl",
  ].forEach((id) => {
    $(id)?.addEventListener("input", renderLivePreview);
    $(id)?.addEventListener("change", renderLivePreview);
  });

  // ────────────── Save Promotion Submit ──────────────
  $("promotionForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitBtn = $("btnSavePromotion") || $("promotionForm")?.querySelector('button[type="submit"]');
    const originalBtnHtml = submitBtn ? submitBtn.innerHTML : "";

    const scope = $("promotionScope").value;
    const payload = {
      title: $("promotionTitle").value.trim(),
      discount_percent: Number($("promotionDiscount").value),
      scope,
      product_ids: scope === "specific_products" ? selectedProductIds() : [],
      starts_at: toScheduleApiValue($("promotionStart").value),
      ends_at: toScheduleApiValue($("promotionEnd").value),
      is_enabled: $("promotionEnabled").checked,
    };

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving promotion...';
    }

    try {
      const id = $("promotionId").value;
      await request(id ? `/admin/promotions/${id}` : "/admin/promotions", {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      broadcastCampaignChange(id ? "updated" : "created", id ? Number(id) : null);
      closeModal("modalAddPromotion");
      clearPromotion();
      promotionPage = 1;
      if (typeof window.showAdminPopup === "function") {
        window.showAdminPopup(
          id
            ? "Promotion updated successfully!"
            : "Promotion created successfully!",
          { title: "Saved ✓" },
        );
      }
      await load();
    } catch (error) {
      showError(error);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML =
          originalBtnHtml || '<i class="fa-solid fa-floppy-disk"></i> Save Promotion';
      }
    }
  });

  // ────────────── Save Announcement Submit ──────────────
  $("announcementForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitBtn = $("btnSaveAnnouncement") || $("announcementForm")?.querySelector('button[type="submit"]');
    const originalBtnHtml = submitBtn ? submitBtn.innerHTML : "";

    const theme = typeof window.getGlobalFMRCTheme === "function" ? window.getGlobalFMRCTheme() : { primary: "#c0392b", secondary: "#800000" };

    const payload = {
      title: $("announcementTitle").value.trim(),
      message: $("announcementMessage").value.trim(),
      placement: $("announcementPlacement").value,
      accent_color: theme.primary,
      secondary_color: theme.secondary,
      cta_label: $("announcementCtaLabel").value.trim() || null,
      cta_url: $("announcementCtaUrl").value.trim() || null,
      starts_at: toScheduleApiValue($("announcementStart").value),
      ends_at: toScheduleApiValue($("announcementEnd").value),
      is_enabled: $("announcementEnabled").checked,
    };

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving announcement...';
    }

    try {
      const id = $("announcementId").value;
      await request(
        id ? `/admin/announcements/${id}` : "/admin/announcements",
        {
          method: id ? "PUT" : "POST",
          body: JSON.stringify(payload),
        },
      );
      broadcastCampaignChange(id ? "updated" : "created", id ? Number(id) : null);
      closeModal("modalAddAnnouncement");
      clearAnnouncement();
      announcementPage = 1;
      if (typeof window.showAdminPopup === "function") {
        window.showAdminPopup(
          id
            ? "Announcement updated successfully!"
            : "Announcement published successfully!",
          { title: "Published ✓" },
        );
      }
      await load();
    } catch (error) {
      showError(error);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML =
          originalBtnHtml || '<i class="fa-solid fa-paper-plane"></i> Save Announcement';
      }
    }
  });

  // ────────────── Table Action Listeners ──────────────
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;

    if (button.dataset.editPromotion)
      editPromotion(button.dataset.editPromotion);
    if (button.dataset.editAnnouncement)
      editAnnouncement(button.dataset.editAnnouncement);

    if (button.dataset.archivePromotion) {
      archiveCampaigns(
        "promotions",
        [Number(button.dataset.archivePromotion)],
        promotionBulkController,
      );
    }

    if (button.dataset.archiveAnnouncement) {
      archiveCampaigns(
        "announcements",
        [Number(button.dataset.archiveAnnouncement)],
        announcementBulkController,
      );
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void load();
  });

  clearPromotion();
  clearAnnouncement();
  setupCampaignBulkSelections();
  load();
});
