# Custom Products workflow report

Admin and Staff can select **Reports → Custom Products**, choose a month, quarter, or year, and generate the report using the existing preview, print/PDF, Excel, and letterhead controls.

## Coverage

The period uses Asia/Manila calendar boundaries: inclusive start and exclusive next-period start, converted to UTC for stored timestamps. Booked requests appear when they have recorded consultation, quotation, production, fulfillment, cancellation, return, or confirmed financial activity in that period. Older requests can therefore appear. Unbooked drafts and archived orders are excluded; a generic `updated_at` edit does not count as workflow activity.

The request summary shows the **current status at generation time**, latest quotation, linked orders, and latest activity within the period. **Status as of** identifies the fresh data snapshot separately from the audited report's original generation time. The Report section selector also exposes current linked-order details and confirmed financial entries. Each section uses the existing ten-row pagination. Preview/PDF and **Export Excel** include all sections independently of the selected table or page; **Export CSV** exports the selected section.

Quoted values and pending payments are separate from collections. Online receipts use their recorded QR Ph/GCash source; successful refunds use the original receipt source. Confirmed cash receipts increase collections; receipt reversals reduce cash collections; confirmed refunds reduce net collections. All amounts derive from the existing ledgers without changing payment, refund, order, or shipment state.

## API and deployment

Existing authenticated endpoints accept `category=custom_products`:

- `GET /api/admin/reports` previews/refreshes data.
- `POST /api/admin/reports/generate` uses the existing generation key, role checks, and audit record, with report prefix `CUP`.
- The response retains the existing report contract and passes detail sections through `additional_tables`.

Deploy backend application changes and the versioned canonical Customer/Admin/Staff assets together. This update adds no database migration. Existing appointment-product and payment-ledger migrations must already be installed. Total Revenue retains its established neutral surface and maroon figure/chart; Custom Product Work follows the summary cards.

## Local checks

```powershell
# From backend:
php artisan test --compact --filter="CustomProductReportsTest|OptionalAppointmentProductsTest"
php artisan test --compact
# From the repository root:
node --test backend/tests/Frontend/appointment-products.browser.cjs
node --test backend/tests/Frontend/dashboard-custom-work.browser.cjs
node --test backend/tests/Frontend/reports.browser.cjs backend/tests/Frontend/report-excel.test.cjs
```

Browser fixtures use canonical scripts with isolated API data. They cover draft restoration, field visibility, retained notes/finish, responsive portal themes, workload refresh/focus, table switching/pagination, complete report records, final-sheet signatories, PDF generation, and typed Excel values. The dashboard fixture checks Chart configuration without a live Chart.js CDN. Hosted smoke checks should confirm booking save/readback, dashboard counts, and a generated custom report after deployment.
