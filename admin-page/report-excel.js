/* Shared, styled XLSX documents for Admin and Staff Reports and Inventory. */
(() => {
  "use strict";

  const root = typeof window !== "undefined" ? window : globalThis;
  const COLORS = Object.freeze({ ink: "FF252525", muted: "FF626262", maroon: "FF800000", line: "FFD9D9D9", paper: "FFF7F4F0", white: "FFFFFFFF" });
  const FONT = Object.freeze({ name: "Arial", size: 10, color: { argb: COLORS.ink } });
  const NUMBER_TYPES = new Set(["currency", "money", "amount", "sales", "integer", "count", "quantity", "number", "decimal", "percent", "percentage"]);
  const DATE_TYPES = new Set(["date", "datetime", "date_time", "timestamp"]);
  const array = (value) => Array.isArray(value) ? value : [];
  const text = (value) => {
    if (value === null || value === undefined) return "";
    if (typeof value === "object") {
      try { return JSON.stringify(value); } catch { return String(value); }
    }
    return String(value);
  };
  const typeOf = (value) => String(value || "text").toLowerCase();
  const border = () => ({ bottom: { style: "thin", color: { argb: COLORS.line } } });

  // XLSX dates have no timezone. Store the report's local wall-clock time, not
  // the browser's timezone, so its timestamp matches the official PDF.
  const excelDate = (value, type, timezone) => {
    if (value === null || value === undefined || value === "") return null;
    if (type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return Number.isNaN(parsed.getTime()) ? text(value) : parsed;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return text(value);
    try {
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
      }).formatToParts(parsed);
      const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      return new Date(Date.UTC(+fields.year, +fields.month - 1, +fields.day,
        type === "date" ? 0 : +fields.hour, type === "date" ? 0 : +fields.minute,
        type === "date" ? 0 : +fields.second));
    } catch { return parsed; }
  };

  const setValue = (cell, value, type, timezone) => {
    const kind = typeOf(type);
    cell.font = { ...FONT };
    cell.alignment = { vertical: "top", horizontal: "left", wrapText: true };
    if (value === null || value === undefined || value === "") {
      cell.value = null;
      return;
    }
    if (NUMBER_TYPES.has(kind)) {
      const raw = typeof value === "number" ? value : text(value).trim();
      const numeric = typeof raw === "number" || /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw);
      const number = numeric ? Number(raw) : NaN;
      if (Number.isFinite(number)) {
        cell.value = ["percent", "percentage"].includes(kind) ? number / 100 : number;
        cell.alignment.horizontal = "right";
        cell.numFmt = ["currency", "money", "amount", "sales"].includes(kind)
          ? '"PHP "#,##0.00;[Red]("PHP "#,##0.00)'
          : ["percent", "percentage"].includes(kind) ? "0.##%"
          : ["integer", "count", "quantity"].includes(kind) ? "#,##0;[Red](#,##0)" : "#,##0.##;[Red](#,##0.##)";
        return;
      }
    }
    if (DATE_TYPES.has(kind)) {
      cell.value = excelDate(value, kind, timezone);
      cell.numFmt = kind === "date" ? "dd mmm yyyy" : "dd mmm yyyy hh:mm";
      return;
    }
    if (kind === "boolean") {
      cell.value = value === true || value === 1 || value === "1" || value === "true" ? "Yes" : "No";
      return;
    }
    // Assign only strings, never ExcelJS formula/hyperlink objects. Values
    // beginning =, +, -, or @ remain literal strings without changing content.
    cell.value = text(value);
    cell.numFmt = "@";
  };

  const merged = (sheet, row, start, end, value, options = {}) => {
    if (end > start) sheet.mergeCells(row, start, row, end);
    const cell = sheet.getCell(row, start);
    setValue(cell, value, options.type, options.timezone);
    cell.font = { ...FONT, ...(options.font || {}) };
    cell.alignment = { vertical: "middle", horizontal: options.align || "left", wrapText: true };
    if (options.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: options.fill } };
    sheet.getRow(row).height = options.height || 22;
    return cell;
  };

  const configure = (sheet, report, letterhead, landscape = false) => {
    sheet.properties.defaultRowHeight = 22;
    sheet.views = [{ showGridLines: false }];
    sheet.pageSetup = {
      paperSize: 9, orientation: landscape ? "landscape" : "portrait",
      fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.35, right: 0.35, top: 0.45, bottom: 0.45, header: 0.15, footer: 0.2 },
    };
    const footerText = (value) => text(value).replace(/&/g, "&&").replace(/[\r\n]+/g, " ").slice(0, 80);
    sheet.headerFooter.oddFooter = `&L&"Arial,Regular"&8${footerText(letterhead.documentCode)} | Revision: ${footerText(letterhead.revision)}&C${footerText(report.id)}&RPage &P of &N`;
  };

  const heading = (sheet, width, report, letterhead, subtitle) => {
    merged(sheet, 1, 1, width, letterhead.republic || "Republic of the Philippines", { align: "center", height: 19, font: { size: 9 } });
    merged(sheet, 2, 1, width, letterhead.university || "UNIVERSITY OF CAMARINES NORTE", { align: "center", height: 25, font: { bold: true, size: 14, color: { argb: COLORS.maroon } } });
    merged(sheet, 3, 1, width, letterhead.formerName || "", { align: "center", height: 18, font: { size: 9, italic: true } });
    merged(sheet, 4, 1, width, letterhead.address || "", { align: "center", height: 22, font: { size: 9 } });
    merged(sheet, 5, 1, width, letterhead.unitName || "FABRICATION AND MANUFACTURING RESEARCH CENTER", { align: "center", height: 27, font: { bold: true, size: 10 } });
    merged(sheet, 6, 1, width, letterhead.unitContact || [letterhead.email, letterhead.website].filter(Boolean).join(" | "), { align: "center", height: 21, font: { size: 9, color: { argb: COLORS.muted } } });
    sheet.getRow(7).height = 9;
    merged(sheet, 8, 1, width, report.title || "Generated Report", { align: "center", height: 30, font: { size: 13, bold: true, color: { argb: COLORS.maroon } } });
    merged(sheet, 9, 1, width, subtitle, { align: "center", height: 24, font: { size: 10 } });
  };

  const section = (sheet, row, width, title) => merged(sheet, row, 1, width, title, {
    height: 26, fill: COLORS.maroon, font: { bold: true, color: { argb: COLORS.white } },
  });
  const normalizeTable = (table) => {
    const rows = array(table?.rows).filter((row) => row && typeof row === "object");
    let columns = array(table?.columns).filter((column) => column?.key);
    if (!columns.length && rows.length) columns = Object.keys(rows[0]).map((key) => ({ key, label: key.replace(/_/g, " "), type: "text" }));
    return { title: text(table?.title) || "Report Details", columns, rows };
  };
  const sheetName = (title, taken) => {
    const base = (text(title).replace(/[\\/*?:\[\]\x00-\x1f]/g, " ").replace(/^'+|'+$/g, "").trim() || "Details").slice(0, 31);
    let name = base;
    for (let i = 2; taken.has(name.toLowerCase()); i += 1) name = `${base.slice(0, 31 - String(i).length - 1)} ${i}`;
    taken.add(name.toLowerCase());
    return name;
  };

  const createWorkbook = ({ data = {}, letterhead = {}, tables } = {}) => {
    if (!root.ExcelJS?.Workbook) throw new Error("Excel export is unavailable. Refresh the page and try again.");
    const report = data.report || {};
    const timezone = report.timezone || "Asia/Manila";
    const isSnapshot = report.scope === "current_snapshot";
    const asOf = isSnapshot ? report.snapshot_at || report.generated_at : report.generated_at;
    const coverage = isSnapshot ? "Current inventory snapshot" : report.period_label || "Selected period";
    const detailTables = (tables || [data.table, ...array(data.additional_tables)]).filter(Boolean).map(normalizeTable);
    const workbook = new root.ExcelJS.Workbook();
    workbook.creator = text(report.generated_by) || "FMRC";
    workbook.subject = text(report.title);
    workbook.title = text(report.title) || "FMRC Report";
    workbook.company = text(letterhead.university) || "University of Camarines Norte";
    const generated = new Date(report.generated_at || Date.now());
    workbook.created = Number.isNaN(generated.getTime()) ? new Date() : generated;
    workbook.modified = workbook.created;
    const summary = workbook.addWorksheet("Summary");
    const takenNames = new Set(["summary"]);
    summary.columns = Array.from({ length: 6 }, () => ({ width: 15 }));
    configure(summary, report, letterhead);
    heading(summary, 6, report, letterhead, coverage);
    let row = 11;
    section(summary, row++, 6, "REPORT INFORMATION");
    const metadata = [
      ["Report ID", report.id], ["Coverage", coverage],
      ...(isSnapshot ? [["Stock as of", asOf, "datetime"]] : []),
      ["Generated on", report.generated_at, "datetime"], ["Timezone", timezone],
      ["Generated by", report.generated_by], ["Document code", letterhead.documentCode],
      ["Revision", letterhead.revision],
    ];
    metadata.forEach(([label, value, type], index) => {
      const first = index % 2 === 0 ? 1 : 4;
      merged(summary, row, first, first, label, { font: { bold: true, size: 9 }, height: 30 });
      merged(summary, row, first + 1, first + 2, value, { type, timezone, height: 30 });
      if (index % 2 === 1 || index === metadata.length - 1) row += 1;
    });
    if (report.scope_note) merged(summary, row++, 1, 6, report.scope_note, { height: Math.max(34, Math.ceil(text(report.scope_note).length / 95) * 14), font: { size: 9, italic: true } });
    row += 1;
    section(summary, row++, 6, "SUMMARY");
    if (!array(data.metrics).length) merged(summary, row++, 1, 6, "No summary metrics are available.", { height: 26 });
    array(data.metrics).forEach((metric, index) => {
      const fill = index % 2 === 0 ? COLORS.paper : COLORS.white;
      merged(summary, row, 1, 4, metric.label, { height: 27, fill });
      merged(summary, row++, 5, 6, metric.value, { type: metric.format, timezone, height: 27, fill, align: NUMBER_TYPES.has(typeOf(metric.format)) ? "right" : "left", font: { bold: true } });
    });
    if (array(data.breakdown?.items).length) {
      row += 1;
      section(summary, row++, 6, data.breakdown.title || "BREAKDOWN");
      data.breakdown.items.forEach((item) => {
        merged(summary, row, 1, 4, item.label);
        merged(summary, row++, 5, 6, item.value, { type: data.breakdown.value_type, timezone, align: "right" });
      });
    }
    row += 1;
    section(summary, row++, 6, "INCLUDED RECORDS");
    detailTables.forEach((table) => {
      merged(summary, row, 1, 4, table.title, { height: 25 });
      merged(summary, row++, 5, 6, table.rows.length, { type: "integer", align: "right", height: 25 });
    });
    row += 2;
    const certificationStart = row;
    section(summary, row++, 6, "CERTIFICATION");
    merged(summary, row++, 1, 6, `Certified true and correct based on the verified electronic records of the ${letterhead.unitName || "FMRC"}.`, { height: 40, font: { size: 9 } });
    merged(summary, row, 1, 2, "Records as of", { font: { bold: true } });
    merged(summary, row++, 3, 6, asOf, { type: "datetime", timezone });
    row += 1;
    const generatedRole = text(report.generated_by_role || root.AdminSession?.role || "System user");
    const preparedRole = generatedRole.charAt(0).toUpperCase() + generatedRole.slice(1);
    [["Prepared by", letterhead.preparedByName || report.generated_by, letterhead.preparedByPosition || preparedRole],
      ["Reviewed by", letterhead.reviewedByName, letterhead.reviewedByPosition || ""],
      ["Approved by", letterhead.approvedByName, letterhead.approvedByPosition || ""]].forEach(([label, name, position], index) => {
      const first = index * 2 + 1;
      merged(summary, row, first, first + 1, label, { font: { size: 9 } });
      const signature = merged(summary, row + 1, first, first + 1, name || "", { height: 35, font: { bold: true } });
      signature.border = border();
      merged(summary, row + 2, first, first + 1, position, { height: 32, font: { size: 9 } });
    });
    summary.pageSetup.printArea = `A1:F${row + 2}`;
    summary.pageSetup.printTitlesRow = "1:6";
    // Excel ignores manual page breaks in Fit To mode. This compact sheet fits
    // A4 at 100%; keep the breaks that protect its certification block.
    summary.pageSetup.fitToPage = false;
    summary.pageSetup.scale = 100;
    // Explicit A4 breaks protect the entire certification/signature block.
    // At 90 character widths the sheet fits portrait A4 without needing a
    // height fit; the conservative point budget allows for printer rounding.
    const rowHeight = (index) => summary.getRow(index).height || 22;
    const repeatedHeight = Array.from({ length: 6 }, (_, index) => rowHeight(index + 1)).reduce((a, b) => a + b, 0);
    const certificationHeight = Array.from({ length: row + 3 - certificationStart }, (_, index) => rowHeight(certificationStart + index)).reduce((a, b) => a + b, 0);
    let pageHeight = repeatedHeight;
    for (let index = 7; index <= row + 2; index += 1) {
      const isSection = summary.getCell(index, 1).fill?.fgColor?.argb === COLORS.maroon;
      const required = index === certificationStart ? certificationHeight : rowHeight(index) + (isSection ? rowHeight(index + 1) : 0);
      if (pageHeight + required > 750 && index <= certificationStart) {
        summary.getRow(index - 1).addPageBreak();
        pageHeight = repeatedHeight;
      }
      pageHeight += rowHeight(index);
    }

    detailTables.forEach((table) => {
        const columns = table.columns;
        const sheet = workbook.addWorksheet(sheetName(table.title, takenNames));
        const width = Math.max(3, columns.length + 1);
        const widths = [6, ...columns.map((column) => {
          const kind = typeOf(column.type);
          if (DATE_TYPES.has(kind)) return kind === "date" ? 17 : 23;
          if (NUMBER_TYPES.has(kind)) return ["currency", "money", "amount", "sales"].includes(kind) ? 19 : 14;
          const maximum = table.rows.reduce((length, record) => Math.max(length, Math.min(32, text(record[column.key]).length + 2)), text(column.label || column.key).length + 3);
          return Math.max(18, Math.min(32, maximum));
        })];
        while (widths.length < width) widths.push(22);
        // Keep related columns in one filterable table. Rebalance wider tables
        // to the landscape page width and let longer text wrap vertically.
        const totalWidth = widths.reduce((total, value) => total + value, 0);
        const targetWidth = columns.length > 4 ? 145 : 95;
        if (totalWidth > targetWidth) {
          const factor = (targetWidth - widths[0]) / (totalWidth - widths[0]);
          for (let index = 1; index < widths.length; index += 1) widths[index] = Math.max(10, Math.round(widths[index] * factor * 10) / 10);
        }
        sheet.columns = widths.map((value) => ({ width: value }));
        configure(sheet, report, letterhead, columns.length > 4);
        heading(sheet, width, report, letterhead, `${table.title} | ${coverage}`);
        merged(sheet, 10, 1, width, `Report ID: ${text(report.id)} | Records: ${table.rows.length} | Timezone: ${timezone}`, { height: 24, font: { size: 9, color: { argb: COLORS.muted } } });
        const headerRow = 12;
        ["#", ...columns.map((column) => text(column.label || column.key))].forEach((label, index) => {
          const cell = sheet.getCell(headerRow, index + 1);
          setValue(cell, label, "text", timezone);
          cell.font = { ...FONT, bold: true, color: { argb: COLORS.white } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.maroon } };
          cell.alignment = { vertical: "middle", wrapText: true, horizontal: "left" };
        });
        const headerLines = columns.reduce((maximum, column, index) => Math.max(maximum, Math.ceil(text(column.label || column.key).length / Math.max(8, widths[index + 1] - 3))), 1);
        sheet.getRow(headerRow).height = Math.max(34, headerLines * 14 + 8);
        table.rows.forEach((record, index) => {
          const recordRow = sheet.getRow(headerRow + index + 1);
          const values = [index + 1, ...columns.map((column) => record[column.key])];
          let lines = 1;
          values.forEach((value, columnIndex) => {
            const cell = recordRow.getCell(columnIndex + 1);
            setValue(cell, value, columnIndex === 0 ? "integer" : columns[columnIndex - 1].type, timezone);
            cell.border = border();
            if (index % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.paper } };
            const textLines = text(value).split(/\r?\n/).reduce((total, line) => total + Math.max(1, Math.ceil(line.length / Math.max(8, widths[columnIndex] - 3))), 0);
            lines = Math.max(lines, textLines);
          });
          recordRow.height = Math.min(409, Math.max(25, lines * 14 + 9));
        });
        if (!table.rows.length) merged(sheet, headerRow + 1, 1, width, "No records available for this report.", { height: 30, font: { italic: true, color: { argb: COLORS.muted } } });
        if (columns.length) sheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow + table.rows.length, column: columns.length + 1 } };
        sheet.views = [{ state: "frozen", xSplit: 1, ySplit: headerRow, topLeftCell: `B${headerRow + 1}`, showGridLines: false }];
        sheet.pageSetup.printTitlesRow = `1:${headerRow}`;
        sheet.pageSetup.printArea = `A1:${sheet.getColumn(width).letter}${headerRow + Math.max(1, table.rows.length)}`;
    });
    return workbook;
  };

  const download = async (options = {}) => {
    const workbook = createWorkbook(options);
    const bytes = await workbook.xlsx.writeBuffer();
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = root.URL.createObjectURL(blob);
    const anchor = root.document.createElement("a");
    const filename = text(options.filename || options.data?.report?.id || "UCN-FMRC_Report").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\.(xlsx|csv|xls)$/i, "").slice(0, 160);
    anchor.href = url;
    anchor.download = `${filename || "UCN-FMRC_Report"}.xlsx`;
    anchor.hidden = true;
    root.document.body.appendChild(anchor);
    try { anchor.click(); } finally {
      anchor.remove();
      root.setTimeout(() => root.URL.revokeObjectURL(url), 30_000);
    }
  };

  root.FMRCReportExcel = Object.freeze({ createWorkbook, download });
})();
