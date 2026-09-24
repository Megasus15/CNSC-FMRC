const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../../..");
const context = vm.createContext({ window: {} });
vm.runInContext(
  fs.readFileSync(path.join(root, "admin-page/inventory-report.js"), "utf8"),
  context,
  { filename: "inventory-report.js" },
);
const build = (input) => JSON.parse(JSON.stringify(context.window.FMRCInventoryReport.build(input)));
const generatedAt = "2026-09-24T04:30:00.000Z";

const fixture = () => ({
  generatedAt,
  items: [
    {
      id: 1,
      category: "Materials",
      item_name: "Steel plate",
      description: "Mild steel, 3 mm",
      unit: "sheets",
      last_invent: "12",
      on_hand: "7",
      status: "Low Stock",
      remarks: "Store flat",
    },
    {
      id: 2,
      category: "Tools",
      item_name: "Drill bit",
      unit: "pieces",
      last_invent: 500,
      on_hand: 500,
      variants: [
        { id: 21, name: "6 mm", description: "HSS", unit: "sets", initial_on_hand: "10", on_hand: "6", status: "Good", remarks: "Cabinet A" },
        { id: 22, name: "8 mm", description: "Cobalt", initial_on_hand: 0, on_hand: "2", status: "Low Stock", remarks: "Cabinet B" },
      ],
    },
    { id: 3, category: "Tools", item_name: "Retired vise", is_archived: true, on_hand: 40 },
  ],
  transactions: [
    {
      id: 101,
      inventory_item_id: "1",
      type: "out",
      amount: "5",
      created_at: "2026-09-23T03:00:00.000Z",
      item_name: "Steel plate",
      description: "Issued 3 mm sheets",
      name: "University workshop",
      purpose: "Student fabrication",
      remarks: "Issued by storekeeper",
    },
    {
      id: 102,
      inventory_item_id: 2,
      variant_id: "21",
      type: "in",
      signed_amount: "4",
      created_at: "2026-09-23T02:00:00.000Z",
      item_name: "Drill bit - 6 mm",
      description: "Replacement stock",
      name: "Procurement office",
      purpose: "Replenishment",
      remarks: "Delivery checked",
    },
    { id: 103, inventory_item_id: 3, type: "out", amount: 1 },
    { id: 104, inventory_item_id: 999, type: "in", amount: 100 },
  ],
});

test("stock and movements exclude archived items and records outside the supplied inventory", () => {
  const input = fixture();
  const report = build(input);

  assert.equal(report.table.rows.length, 3);
  assert.equal(report.additional_tables[0].rows.length, 2);
  assert.equal(report.table.rows.some((row) => row.item === "Retired vise"), false);
  assert.equal(report.metrics.find((metric) => metric.key === "items").value, 2);
  assert.equal(report.metrics.find((metric) => metric.key === "movements").value, 2);

  const categoryReport = build({ ...input, items: [input.items[0]], scope: "Materials" });
  assert.equal(categoryReport.table.rows.length, 1);
  assert.equal(categoryReport.additional_tables[0].rows.length, 1);
  assert.equal(categoryReport.additional_tables[0].rows[0].item, "Steel plate");
});

test("variant stock replaces the parent total and keeps each variant's quantity and unit", () => {
  const report = build(fixture());

  assert.deepEqual(report.table.rows.map((row) => row.item), [
    "Steel plate", "Drill bit — 6 mm", "Drill bit — 8 mm",
  ]);
  assert.deepEqual(report.table.rows.map((row) => row.on_hand), [7, 6, 2]);
  assert.deepEqual(report.table.rows.map((row) => row.unit), ["sheets", "sets", "pieces"]);
  assert.equal(report.metrics.find((metric) => metric.key === "records").value, 3);
  assert.equal(report.metrics.find((metric) => metric.key === "low").value, 2);
  assert.deepEqual(report.chart.labels, ["Materials", "Tools"]);
  assert.deepEqual(report.chart.series[0].values, [1, 2]);
});

test("initial baselines remain distinct from current stock and preserve an explicit zero", () => {
  const report = build(fixture());
  assert.deepEqual(report.table.rows.map((row) => row.initial), [12, 10, 0]);
  assert.deepEqual(report.table.rows.map((row) => row.on_hand), [7, 6, 2]);

  const fallback = build({ items: [
    { id: 10, item_name: "Uncounted item", on_hand: "3" },
    { id: 11, item_name: "Uncounted variants", variants: [{ id: 111, name: "Standard", on_hand: "4" }] },
  ] });
  assert.deepEqual(fallback.table.rows.map((row) => row.initial), [3, 4]);
  assert.match(report.report.scope_note, /Initial quantities are recorded baselines, not stock receipts/);
});

test("stock movements retain direction while exporting positive quantities", () => {
  const input = fixture();
  input.transactions.push({ inventory_item_id: 1, type: "out", signed_amount: "-2" });
  const report = build(input);
  const movements = report.additional_tables[0].rows;

  assert.deepEqual(movements.map((row) => row.movement), ["Stock Out", "Stock In", "Stock Out"]);
  assert.deepEqual(movements.map((row) => row.quantity), [5, 4, 2]);
  assert.deepEqual(movements.map((row) => row.unit), ["sheets", "sets", "sheets"]);
});

test("official report payload preserves the stock and transaction detail fields without modifying input", () => {
  const input = fixture();
  const before = JSON.stringify(input);
  const report = build(input);

  assert.deepEqual(report.table.rows[0], {
    category: "Materials", item: "Steel plate", description: "Mild steel, 3 mm",
    unit: "sheets", initial: 12, on_hand: 7, status: "Low Stock", remarks: "Store flat",
  });
  assert.deepEqual(report.table.rows[1], {
    category: "Tools", item: "Drill bit — 6 mm", description: "HSS",
    unit: "sets", initial: 10, on_hand: 6, status: "Good", remarks: "Cabinet A",
  });
  assert.deepEqual(report.additional_tables[0].rows[0], {
    date: "2026-09-23T03:00:00.000Z", item: "Steel plate", description: "Issued 3 mm sheets",
    movement: "Stock Out", quantity: 5, unit: "sheets", by: "University workshop",
    purpose: "Student fabrication", remarks: "Issued by storekeeper",
  });
  for (const table of [report.table, ...report.additional_tables]) {
    assert.deepEqual(Object.keys(table.rows[0]), table.columns.map((column) => column.key));
    assert.ok(table.columns.every((column) => column.label && column.type));
  }
  assert.equal(JSON.stringify(input), before);
});

test("snapshot metadata identifies current inventory rather than a historical reporting period", () => {
  const report = build({ ...fixture(), scope: "Tools / Drill bit", user: { name: "Inventory Staff", role: "staff" } });

  assert.equal(report.report.scope, "current_snapshot");
  assert.equal(report.report.period, "current");
  assert.equal(report.report.period_label, "Tools / Drill bit");
  assert.equal(report.report.snapshot_at, generatedAt);
  assert.equal(report.report.generated_at, generatedAt);
  assert.equal(report.report.timezone, "Asia/Manila");
  assert.equal(report.report.generated_by, "Inventory Staff");
  assert.equal(report.report.generated_by_role, "staff");
  assert.match(report.report.scope_note, /^Tools \/ Drill bit\. Current active stock/);

  const empty = build({ generatedAt });
  assert.deepEqual(empty.table.rows, []);
  assert.deepEqual(empty.additional_tables[0].rows, []);
  assert.ok(empty.metrics.every((metric) => metric.value === 0));
});
