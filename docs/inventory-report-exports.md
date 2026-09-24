# Inventory and product stock reports

Admin and Staff use the same report renderer, editable letterhead and Excel
writer. Deploy both portal HTML files with the shared files below:

- `admin-page/reports.js`, `report-document.css`, and `report-excel.js`
- `admin-page/inventory.js`, `inventory-report.js`, and `inventory-layout.css`
- `admin-page/assets/report-template/` and `admin-page/assets/lib/`
- `admin-page/dashboard.css` and the HTML files with its updated cache version
- `backend/app/Http/Controllers/Api/ReportController.php`

Inventory offers Excel and PDF forms for one item, one category, or all active
inventory. Each action refreshes stock and movement data. Variant stock replaces
the parent grouping row, so quantities are not counted twice. Initial quantities
are recorded baselines; the separate movement table identifies stock in/out and
retains dates, quantities, units, purpose, and remarks. Excel uses a summary plus
filterable detail sheets. PDF uses the Reports page's A4 layout and shared
letterhead; use **Print / Save PDF**, A4, 100%, with browser headers/footers off.

Reports retains CSV and adds the same styled Excel export. **Product Stocks**
reports current Products-page quantities, including blocked products. It is a
snapshot as of the displayed timestamp, independent of period filters. Stock
value means quantity multiplied by listed selling price, not cost or revenue.
Report generation and exported Reports documents retain the existing audit flow.

No new database migration is required for product stock reporting. This does
not deploy the changes. After deployment, verify item/category/all-inventory
downloads, multi-page PDF headers/footers, edited letterhead, and toolbar layout
at 320, 375, 390, 430 pixels and desktop widths in both portals. Browser and
physical iPhone visual checks remain necessary; DOM and workbook read-back tests
do not establish visual layout fidelity.
