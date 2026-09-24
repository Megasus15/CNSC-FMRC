const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { inflateRawSync } = require("node:zlib");

const projectRoot = path.resolve(__dirname, "../../..");
global.ExcelJS = require(path.join(projectRoot, "admin-page/assets/lib/exceljs-4.4.0.min.js"));
require(path.join(projectRoot, "admin-page/report-excel.js"));
const { createWorkbook } = global.FMRCReportExcel;

const letterhead = {
  republic: "Republic of the Philippines", university: "UNIVERSITY OF CAMARINES NORTE",
  unitName: "FABRICATION AND MANUFACTURING RESEARCH CENTER", documentCode: "CNSC-SP-QMS-05F5",
  revision: "1", preparedByName: "Test Records Officer",
};
const sample = () => ({
  report: { id: "INV-TEST", title: "Inventory Report", period_label: "September 2026", timezone: "Asia/Manila",
    generated_at: "2026-09-24T00:15:00Z", generated_by: "Test Administrator" },
  metrics: [{ label: "Available stock", value: "12", format: "integer" }, { label: "Stock value", value: 1250.5, format: "currency" }],
  table: { title: "Current Stock", columns: [{ key: "name", label: "Product", type: "text" },
    { key: "stock", label: "Stock", type: "integer" }, { key: "price", label: "Unit price", type: "currency" },
    { key: "updated", label: "Updated", type: "datetime" }],
    rows: [{ name: "Training product", stock: "12", price: 1250.5, updated: "2026-09-24T00:15:00Z" }] },
});
const reopen = async (data, tables) => {
  const built = createWorkbook({ data, letterhead, ...(tables ? { tables } : {}) });
  const bytes = await built.xlsx.writeBuffer();
  const workbook = new global.ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  return workbook;
};
const labeledValue = (sheet, label) => {
  let found;
  sheet.eachRow((row) => {
    if (row.getCell(1).value === label) found = row.getCell(2).value === label ? row.getCell(3).value : row.getCell(2).value;
    if (row.getCell(4).value === label) found = row.getCell(5).value;
  });
  return found;
};
// Inspect written Open XML parts for features ExcelJS does not read back.
const zipTextPart = (bytes, name) => {
  const buffer = Buffer.from(bytes);
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end -= 1;
  assert.ok(end >= 0, "XLSX ZIP central directory exists");
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  for (let index = 0; index < count; index += 1) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
    const filenameLength = buffer.readUInt16LE(offset + 28);
    const filename = buffer.subarray(offset + 46, offset + 46 + filenameLength).toString();
    if (filename === name) {
      const local = buffer.readUInt32LE(offset + 42);
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      const compressed = buffer.subarray(start, start + buffer.readUInt32LE(offset + 20));
      const method = buffer.readUInt16LE(offset + 10);
      assert.ok(method === 0 || method === 8);
      return (method === 8 ? inflateRawSync(compressed) : compressed).toString();
    }
    offset += 46 + filenameLength + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
  throw new Error(`Missing XLSX part: ${name}`);
};

test("XLSX round trip retains professional styles, typed cells, and print/navigation controls", async () => {
  const workbook = await reopen(sample());
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["Summary", "Current Stock"]);
  const details = workbook.getWorksheet("Current Stock");
  assert.equal(details.getCell("B13").value, "Training product");
  assert.equal(details.getCell("C13").value, 12);
  assert.equal(details.getCell("D13").value, 1250.5);
  assert.match(details.getCell("D13").numFmt, /PHP/);
  assert.ok(details.getCell("E13").value instanceof Date);
  assert.equal(details.getCell("E13").value.toISOString(), "2026-09-24T08:15:00.000Z");
  assert.equal(details.getCell("B13").font.name, "Arial");
  assert.equal(details.getCell("B12").fill.fgColor.argb, "FF800000");
  assert.equal(details.getCell("B13").alignment.wrapText, true);
  assert.equal(details.pageSetup.paperSize, 9);
  assert.equal(details.pageSetup.fitToWidth, 1);
  assert.equal(details.pageSetup.printTitlesRow, "1:12");
  assert.equal(details.views[0].state, "frozen");
  assert.equal(details.views[0].ySplit, 12);
  assert.equal(details.autoFilter, "A12:E13");
  assert.equal(labeledValue(workbook.getWorksheet("Summary"), "Coverage"), "September 2026");
});

test("snapshot coverage and certification use snapshot_at while generation time stays distinct", async () => {
  const data = sample();
  Object.assign(data.report, { scope: "current_snapshot", snapshot_at: "2026-09-24T02:00:00Z", period_label: "January 2020", scope_note: "Active products as currently recorded." });
  const workbook = await reopen(data);
  const summary = workbook.getWorksheet("Summary");
  assert.equal(labeledValue(summary, "Coverage"), "Current inventory snapshot");
  assert.equal(labeledValue(summary, "Stock as of").toISOString(), "2026-09-24T10:00:00.000Z");
  assert.equal(labeledValue(summary, "Records as of").toISOString(), "2026-09-24T10:00:00.000Z");
  assert.equal(labeledValue(summary, "Generated on").toISOString(), "2026-09-24T08:15:00.000Z");
  assert.equal(JSON.stringify(summary.model).includes("January 2020"), false);
});

test("multi-table exports include every stock movement and its full description", async () => {
  const data = sample();
  const description = "Multi-line description\n" + "Detailed stock movement note. ".repeat(30);
  const movements = { title: "Stock Movements", columns: [{ key: "item", label: "Item", type: "text" },
    { key: "quantity", label: "Quantity", type: "integer" }, { key: "description", label: "Description", type: "text" }],
    rows: Array.from({ length: 125 }, (_, index) => ({ item: `Item ${index + 1}`, quantity: index + 1, description })) };
  data.additional_tables = [movements];
  const workbook = await reopen(data);
  const details = workbook.getWorksheet("Stock Movements");
  assert.equal(workbook.worksheets.length, 3);
  assert.equal(details.getCell("A137").value, 125);
  assert.equal(details.getCell("C137").value, 125);
  assert.equal(details.getCell("D137").value, description);
  assert.equal(details.autoFilter, "A12:D137");
  const explicit = await reopen(data, [data.table, movements]);
  assert.equal(explicit.worksheets.length, 3, "explicit tables replace inferred tables without duplicates");
});

test("empty tables remain readable and formula-like values stay literal strings", async () => {
  const data = sample();
  data.table.rows = [];
  const empty = await reopen(data);
  assert.equal(empty.getWorksheet("Current Stock").getCell("A13").value, "No records available for this report.");
  data.table.columns = [{ key: "text", label: "Text", type: "text" }, { key: "numeric", label: "Numeric", type: "number" }];
  data.table.rows = ["=SUM(1,2)", "+cmd", "-cmd", "@SUM(A1:A3)", "0000123"].map((value) => ({ text: value, numeric: value }));
  const workbook = await reopen(data);
  const details = workbook.getWorksheet("Current Stock");
  data.table.rows.forEach((record, index) => {
    const value = details.getCell(index + 13, 2);
    assert.equal(value.type, global.ExcelJS.ValueType.String);
    assert.equal(value.value, record.text);
    assert.equal(value.formula, undefined);
  });
  assert.equal(details.getCell("C13").value, "=SUM(1,2)");
});

test("wide tables remain complete on one filterable landscape sheet", async () => {
  const data = sample();
  data.table.columns = Array.from({ length: 19 }, (_, index) => ({ key: `field${index}`, label: `Field ${index}`, type: "text" }));
  data.table.rows = [Object.fromEntries(data.table.columns.map((column) => [column.key, column.key]))];
  const workbook = await reopen(data);
  const detailSheets = workbook.worksheets.slice(1);
  assert.equal(detailSheets.length, 1);
  const recovered = new Set();
  detailSheets.forEach((sheet) => {
    assert.equal(sheet.columnCount, 20);
    assert.equal(sheet.pageSetup.orientation, "landscape");
    assert.equal(sheet.getCell("A13").value, 1);
    assert.equal(sheet.getCell("B13").value, "field0");
    sheet.getRow(13).eachCell((cell) => { if (typeof cell.value === "string") recovered.add(cell.value); });
  });
  assert.equal(recovered.size, 19);
});

test("percentages, nulls, date-only values, and unsafe worksheet names survive the round trip", async () => {
  const data = sample();
  data.table = { title: "'Invalid:/[]?* sheet'", columns: [
    { key: "rate", label: "Rate", type: "percent" }, { key: "empty", label: "Missing value", type: "integer" },
    { key: "day", label: "Date", type: "date" }, { key: "object", label: "Metadata", type: "text" },
  ], rows: [{ rate: 25, empty: null, day: "2026-09-24", object: { formula: "1+1" } }] };
  const workbook = await reopen(data, [data.table, data.table]);
  assert.notEqual(workbook.worksheets[1].name, workbook.worksheets[2].name);
  const details = workbook.worksheets[1];
  assert.equal(details.getCell("B13").value, 0.25);
  assert.equal(details.getCell("B13").numFmt, "0.##%");
  assert.equal(details.getCell("C13").value, null);
  assert.equal(details.getCell("D13").value.toISOString(), "2026-09-24T00:00:00.000Z");
  assert.equal(details.getCell("E13").value, '{"formula":"1+1"}');
  assert.equal(details.getCell("E13").formula, undefined);
});

test("long summaries keep certification together and unconfigured signatory roles stay blank", async () => {
  const data = sample();
  data.report.generated_by_role = "staff";
  data.metrics = Array.from({ length: 15 }, (_, index) => ({ label: `Metric ${index}`, value: index, format: "integer" }));
  // ExcelJS writes rowBreaks but does not restore them when reading XLSX.
  const original = createWorkbook({ data, letterhead });
  const summaryXml = zipTextPart(await original.xlsx.writeBuffer(), "xl/worksheets/sheet1.xml");
  const workbook = await reopen(data);
  const summary = workbook.getWorksheet("Summary");
  let certificationRow, preparedRow;
  summary.eachRow((row) => {
    if (row.getCell(1).value === "CERTIFICATION") certificationRow = row.number;
    if (row.getCell(1).value === "Prepared by") preparedRow = row.number;
  });
  assert.match(summaryXml, /<rowBreaks\b/);
  const breaks = Array.from(summaryXml.matchAll(/<brk\b[^>]*\bid="(\d+)"/g), (match) => Number(match[1]));
  assert.ok(breaks.length > 0);
  assert.ok(breaks.every((pageBreak) => pageBreak < certificationRow), "no serialized break splits the certification or signatures");
  assert.equal(summary.getCell(preparedRow + 2, 1).value, "Staff");
  assert.ok(!summary.getCell(preparedRow + 2, 3).value);
  assert.ok(!summary.getCell(preparedRow + 2, 5).value);
});
