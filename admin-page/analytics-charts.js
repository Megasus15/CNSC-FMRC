/*
 * analytics-charts.js — AnalyticsCharts.{renderBar,renderDonut,renderLine,sparkline}
 *
 * One Chart.js theme, shared by the dashboard Analytics Overview and the
 * Products page, so a bar on one page is the exact same bar on the other:
 * the CHART_PALETTE hues, Poppins ticks, light #f3f4f6 gridlines, the maroon
 * #800000 line with its faint fill, and the one dark unified tooltip. Every
 * factory no-ops to null when Chart.js has not loaded, so a missing CDN
 * degrades a card to its empty state instead of throwing.
 */
(function () {
  "use strict";

  const PALETTE = [
    "#800000", "#d4a017", "#0284c7", "#16a34a", "#7c3aed",
    "#db2777", "#ea580c", "#0d9488", "#6366f1", "#94a3b8",
  ];
  const FONT = "Poppins";
  const MAROON = "#800000";

  const hasChart = () => typeof window.Chart !== "undefined";

  const peso = (v) =>
    "₱" + Number(v || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 });

  const TOOLTIP = {
    backgroundColor: "#1a1a2e",
    titleFont: { family: FONT, size: 12 },
    bodyFont: { family: FONT, size: 11 },
    padding: 10,
    cornerRadius: 8,
  };

  const colorsFor = (n, override) => {
    if (Array.isArray(override) && override.length) return override;
    const out = [];
    for (let i = 0; i < n; i++) out.push(PALETTE[i % PALETTE.length]);
    return out;
  };

  // Canvas tooltips are clipped by the responsive analytics cards. Keep the
  // category tooltip in the page layer, and remove it with its chart.
  function categoryTooltip(total) {
    let popup = null;
    let title = null;
    let detail = null;
    const hide = () => { if (popup) popup.style.display = "none"; };

    const ensurePopup = () => {
      if (popup) return;
      popup = document.createElement("div");
      popup.setAttribute("role", "tooltip");
      popup.style.cssText = "position:fixed;z-index:2147483647;display:none;pointer-events:none;box-sizing:border-box;max-width:min(280px,calc(100vw - 16px));padding:10px 12px;border-radius:8px;background:#1a1a2e;color:#fff;box-shadow:0 10px 28px rgba(18,18,32,.2);font:500 11px/1.45 Poppins,sans-serif;overflow-wrap:anywhere";
      title = document.createElement("strong");
      title.style.cssText = "display:block;font-size:12px;line-height:1.4";
      detail = document.createElement("span");
      detail.style.cssText = "display:block;margin-top:3px";
      popup.append(title, detail);
      document.body.appendChild(popup);
      window.addEventListener("scroll", hide, true);
      window.addEventListener("resize", hide);
    };

    return {
      external({ chart, tooltip }) {
        const point = tooltip?.dataPoints?.[0];
        if (!tooltip?.opacity || !point) { hide(); return; }
        ensurePopup();
        const value = Number(point.parsed || 0);
        const share = total > 0 ? (value / total) * 100 : 0;
        title.textContent = point.label || "Uncategorized";
        detail.textContent = `${peso(value)} · ${share.toFixed(1)}% of sales`;
        popup.style.display = "block";

        const rect = chart.canvas.getBoundingClientRect();
        const anchorX = rect.left + tooltip.caretX * rect.width / chart.width;
        const anchorY = rect.top + tooltip.caretY * rect.height / chart.height;
        const width = popup.offsetWidth;
        const height = popup.offsetHeight;
        const left = Math.max(8, Math.min(anchorX + 12, window.innerWidth - width - 8));
        let top = anchorY + 12;
        if (top + height > window.innerHeight - 8) top = anchorY - height - 12;
        popup.style.left = `${left}px`;
        popup.style.top = `${Math.max(8, Math.min(top, window.innerHeight - height - 8))}px`;
      },
      cleanup: {
        id: "categoryTooltipCleanup",
        afterDestroy() {
          window.removeEventListener("scroll", hide, true);
          window.removeEventListener("resize", hide);
          popup?.remove();
          popup = null;
        },
      },
    };
  }

  function renderBar(ctx, cfg) {
    if (!ctx || !hasChart()) return null;
    const c = cfg || {};
    const data = c.data || [];
    const horizontal = c.horizontal === true;
    return new window.Chart(ctx, {
      type: "bar",
      data: {
        labels: c.labels || [],
        datasets: [
          {
            label: c.label || "Qty",
            data,
            backgroundColor: colorsFor(data.length, c.colors),
            borderRadius: 6,
            barThickness: c.barThickness || 22,
            maxBarThickness: 44,
          },
        ],
      },
      options: {
        indexAxis: horizontal ? "y" : "x",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: Object.assign({}, TOOLTIP, c.tooltip || {}),
        },
        scales: {
          x: {
            grid: { display: horizontal },
            ticks: {
              font: { family: FONT, size: 10 },
              color: "#374151",
              maxRotation: 45,
              minRotation: 0,
            },
          },
          y: {
            beginAtZero: true,
            grid: { color: "#f3f4f6" },
            ticks: {
              font: { family: FONT, size: 11 }, color: "#6b7280",
              callback: horizontal ? (value) => {
                const label = String((c.labels || [])[Number(value)] || "");
                return label.length > 18 ? `${label.slice(0, 17)}…` : label;
              } : undefined,
            },
          },
        },
      },
    });
  }

  function renderDonut(ctx, cfg) {
    if (!ctx || !hasChart()) return null;
    const c = cfg || {};
    const data = c.data || [];
    const total =
      c.total != null ? c.total : data.reduce((s, v) => s + Number(v || 0), 0);
    const floatingTooltip = categoryTooltip(total);
    return new window.Chart(ctx, {
      type: "doughnut",
      plugins: [floatingTooltip.cleanup],
      data: {
        labels: c.labels || [],
        datasets: [
          {
            data,
            backgroundColor: colorsFor(data.length, c.colors),
            borderWidth: 2,
            borderColor: "#fff",
            hoverOffset: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: c.cutout || "62%",
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false, external: floatingTooltip.external },
        },
      },
    });
  }

  function renderLine(ctx, cfg) {
    if (!ctx || !hasChart()) return null;
    const c = cfg || {};
    const currency = c.currency !== false;
    return new window.Chart(ctx, {
      type: "line",
      data: {
        labels: c.labels || [],
        datasets: [
          {
            label: c.label || "Sales before returns",
            data: c.data || [],
            borderColor: MAROON,
            backgroundColor: "rgba(128,0,0,0.08)",
            fill: c.area !== false,
            tension: 0,
            pointBackgroundColor: MAROON,
            pointBorderColor: "#fff",
            pointBorderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: Object.assign({}, TOOLTIP, {
            displayColors: false,
            callbacks: {
              title: (items) => {
                const item = items[0];
                return item ? (c.tooltipLabels || [])[item.dataIndex] || item.label : "";
              },
              label: (item) => currency
                ? `${c.label || "Sales"}: ${peso(item.parsed.y)}`
                : `${c.label || "Total"}: ${item.parsed.y}`,
            },
          }),
        },
        scales: {
          x: {
            border: { display: false },
            grid: { display: false },
            ticks: {
              font: { family: FONT, size: 9 }, color: "#6b7280",
              maxTicksLimit: 12, maxRotation: 0, minRotation: 0,
              autoSkip: false, padding: 2,
            },
          },
          y: {
            beginAtZero: true,
            border: { display: false },
            grid: { color: "rgba(107,114,128,0.12)", drawTicks: false },
            ticks: {
              font: { family: FONT, size: 10 },
              color: "#6b7280",
              maxTicksLimit: 4,
              padding: 8,
              callback: currency
                ? (v) => "₱" + Number(v).toLocaleString("en-PH", {
                  notation: "compact", maximumFractionDigits: 1,
                })
                : undefined,
            },
          },
        },
      },
    });
  }

  /* Compact revenue trend with dates, peso values and exact point details. */
  function sparkline(ctx, cfg) {
    if (!ctx || !hasChart()) return null;
    const c = cfg || {};
    return new window.Chart(ctx, {
      type: "line",
      data: {
        labels: c.labels || [],
        datasets: [
          {
            label: "Revenue",
            data: c.data || [],
            borderColor: c.color || MAROON,
            backgroundColor: "rgba(128,0,0,0.10)",
            fill: true,
            tension: 0,
            borderWidth: 2,
            pointRadius: (c.data || []).length === 1 ? 3 : 0,
            pointHoverRadius: 4,
            pointHitRadius: 12,
            pointBackgroundColor: c.color || MAROON,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: Object.assign({}, TOOLTIP, {
            displayColors: false,
            callbacks: {
              title: (items) => {
                const item = items[0];
                return item ? (c.tooltipLabels || [])[item.dataIndex] || item.label : "";
              },
              label: (item) => `Revenue: ${peso(item.parsed.y)}`,
            },
          }),
        },
        scales: {
          x: {
            offset: (c.data || []).length === 1,
            border: { display: false },
            grid: { display: false },
            ticks: {
              font: { family: FONT, size: 10 },
              color: "#6b7280",
              maxTicksLimit: 4,
              maxRotation: 0,
              autoSkip: true,
            },
          },
          y: {
            beginAtZero: true,
            border: { display: false },
            grid: { color: "rgba(107,114,128,0.12)", drawTicks: false },
            ticks: {
              font: { family: FONT, size: 10 },
              color: "#6b7280",
              maxTicksLimit: 3,
              padding: 8,
              callback: (value) => "₱" + Number(value).toLocaleString("en-PH", {
                notation: "compact", maximumFractionDigits: 1,
              }),
            },
          },
        },
      },
    });
  }

  window.AnalyticsCharts = {
    PALETTE,
    peso,
    renderBar,
    renderDonut,
    renderLine,
    sparkline,
  };
})();
