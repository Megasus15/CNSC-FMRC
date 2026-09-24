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
            ticks: { font: { family: FONT, size: 11 }, color: "#6b7280" },
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
    return new window.Chart(ctx, {
      type: "doughnut",
      data: {
        labels: c.labels || [],
        datasets: [
          {
            data,
            backgroundColor: colorsFor(data.length, c.colors),
            borderWidth: 2,
            borderColor: "#fff",
            hoverOffset: 8,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: c.cutout || "62%",
        plugins: {
          legend: { display: false },
          tooltip: Object.assign({}, TOOLTIP, {
            callbacks: {
              label: (item) => {
                const val = item.parsed || 0;
                const share = total > 0 ? (val / total) * 100 : 0;
                return `${item.label}: ${peso(val)} (${share.toFixed(1)}%)`;
              },
            },
          }),
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
            label: c.label || "Total",
            data: c.data || [],
            borderColor: MAROON,
            backgroundColor: "rgba(128,0,0,0.08)",
            fill: c.area !== false,
            tension: 0.4,
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
        plugins: {
          legend: { display: false },
          tooltip: Object.assign({}, TOOLTIP, {
            callbacks: currency ? { label: (item) => peso(item.parsed.y) } : {},
          }),
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { family: FONT, size: 10 }, color: "#9ca3af" },
          },
          y: {
            grid: { color: "#f3f4f6" },
            ticks: {
              font: { family: FONT, size: 10 },
              color: "#6b7280",
              callback: currency
                ? (v) => "₱" + (v / 1000).toFixed(0) + "k"
                : undefined,
            },
          },
        },
      },
    });
  }

  /* A tiny axis-less line for the revenue hero — no grid, no points, no
     animation, so it reads as a trend glyph beside the big figure, not a chart. */
  function sparkline(ctx, cfg) {
    if (!ctx || !hasChart()) return null;
    const c = cfg || {};
    return new window.Chart(ctx, {
      type: "line",
      data: {
        labels: (c.data || []).map((_, i) => i),
        datasets: [
          {
            data: c.data || [],
            borderColor: c.color || MAROON,
            backgroundColor: "rgba(128,0,0,0.10)",
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false } },
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
