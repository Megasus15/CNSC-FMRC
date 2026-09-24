(() => {
  "use strict";

  // One payload supplies both the official PDF renderer and the shared workbook.
  const build = ({ items = [], transactions = [], scope = "All inventory", user = {}, generatedAt = new Date().toISOString() }) => {
    const activeItems = items.filter((item) => !item.is_archived);
    const itemIndex = new Map(activeItems.map((item) => [Number(item.id), item]));
    const stockRows = activeItems.flatMap((item) => {
      const variants = Array.isArray(item.variants) ? item.variants : [];
      return (variants.length ? variants : [null]).map((variant) => {
        const stock = variant || item;
        return {
          category: item.category,
          item: variant ? `${item.item_name} — ${variant.name || "Variant"}` : item.item_name,
          description: stock.description || "",
          unit: stock.unit || item.unit || "",
          initial: Number(variant ? (variant.initial_on_hand ?? variant.on_hand ?? 0) : (item.last_invent ?? item.on_hand ?? 0)),
          on_hand: Number(stock.on_hand ?? 0),
          status: stock.status || (Number(stock.on_hand) <= 0 ? "Out of Stock" : "Good"),
          remarks: stock.remarks || "",
        };
      });
    });
    const movementRows = transactions.filter((tx) => itemIndex.has(Number(tx.inventory_item_id))).map((tx) => {
      const item = itemIndex.get(Number(tx.inventory_item_id));
      const variant = (item.variants || []).find((entry) => Number(entry.id) === Number(tx.variant_id));
      return {
        date: tx.created_at,
        item: tx.item_name || item.item_name,
        description: tx.description || "",
        movement: tx.type === "out" ? "Stock Out" : "Stock In",
        quantity: Math.abs(Number(tx.amount ?? tx.signed_amount ?? 0)),
        unit: variant?.unit || item.unit || "",
        by: tx.name || "",
        purpose: tx.purpose || "",
        remarks: tx.remarks || "",
      };
    });
    const column = (key, label, type = "text") => ({ key, label, type });
    const categoryCounts = new Map();
    stockRows.forEach((row) => categoryCounts.set(row.category, (categoryCounts.get(row.category) || 0) + 1));
    const statuses = ["Good", "Low Stock", "Out of Stock"];
    const stamp = generatedAt.replace(/[^0-9]/g, "").slice(0, 14);
    return {
      report: {
        id: `INV-${stamp}`,
        title: "Inventory Stock Report",
        category: "inventory",
        period: "current",
        period_label: scope,
        scope: "current_snapshot",
        snapshot_at: generatedAt,
        scope_note: `${scope}. Current active stock and all recorded stock movements for these items. Initial quantities are recorded baselines, not stock receipts. Quantities retain their individual units.`,
        timezone: "Asia/Manila",
        generated_at: generatedAt,
        generated_by: user.name || "System user",
        generated_by_role: user.role || "admin/staff",
      },
      metrics: [
        { key: "items", label: "Inventory Items", value: activeItems.length, format: "integer" },
        { key: "records", label: "Stock Records", value: stockRows.length, format: "integer" },
        { key: "low", label: "Low / Out of Stock", value: stockRows.filter((row) => ["Low Stock", "Out of Stock"].includes(row.status)).length, format: "integer" },
        { key: "movements", label: "Recorded Movements", value: movementRows.length, format: "integer" },
      ],
      chart: {
        title: "Stock Records by Category", value_type: "integer",
        labels: [...categoryCounts.keys()],
        series: [{ name: "Stock records", values: [...categoryCounts.values()] }],
      },
      breakdown: {
        title: "Current Stock Status", value_type: "integer",
        items: statuses.map((label) => ({ label, value: stockRows.filter((row) => row.status === label).length })),
      },
      table: {
        title: "Current Stock",
        columns: [column("category", "Category"), column("item", "Item / Variant"), column("description", "Description"), column("unit", "Unit"), column("initial", "Initial Qty", "integer"), column("on_hand", "On Hand", "integer"), column("status", "Status", "status"), column("remarks", "Remarks")],
        rows: stockRows,
      },
      additional_tables: [{
        title: "Stock Movements",
        columns: [column("date", "Date / Time", "datetime"), column("item", "Item / Variant"), column("description", "Description"), column("movement", "Movement"), column("quantity", "Quantity", "integer"), column("unit", "Unit"), column("by", "Recorded For"), column("purpose", "Purpose"), column("remarks", "Remarks")],
        rows: movementRows,
      }],
    };
  };
  window.FMRCInventoryReport = Object.freeze({ build });
})();
