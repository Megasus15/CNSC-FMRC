# Admin and Staff report refresh

Both Reports pages use the canonical `admin-page/reports.js` implementation. Deploy the script and its updated cache references in both Reports and Inventory pages together; Inventory shares the document renderer.

## Automatic reads

- The visible Reports page reads the active category and period 30 seconds after the previous request settles. Quiet reads keep the loaded report, controls, selected detail table, and table page available.
- Relevant order, appointment, custom-product, stock, and shared live-data change signals trigger a debounced read. Signals arriving during a request are retained for one follow-up read. These reads use `GET /api/admin/reports`; they do not create generation audit entries.
- Polling pauses while the page is hidden or offline. Returning resumes the normal interval, or processes a retained change. Reconnecting triggers a fresh read.
- The 20-second deadline covers both response headers and the JSON body. Invalid or incomplete successful responses are treated as failures and cannot replace a good report with empty data.
- Failed reads retain the last successful report and show a warning. Retries back off from 30 seconds to a five-minute cap, respecting a longer server `Retry-After`. The initial selection is retained for retry even when the first load fails.
- **Refresh** retries immediately and takes priority over a pending quiet read. Superseded results cannot replace a newer report. Explicit refresh retains its existing reset to the first table page.
- **Last updated** shows the data snapshot time. The audited report identity and original generation timestamp remain separate. Preview, print, and exports are protected from concurrent background replacement while preparing a document.

## Verification

From the repository root:

```powershell
node --test backend/tests/Frontend/reports-refresh.browser.cjs backend/tests/Frontend/tab-return-refresh.test.cjs
node --test backend/tests/Frontend/reports.browser.cjs backend/tests/Frontend/report-excel.test.cjs
```

From `backend`:

```powershell
php artisan test --compact --filter="AdminReportsTest|AdminReportGenerationTest|CustomProductReportsTest|ProductInventoryReportTest|AdminPortalConsistencyTest"
```

The browser fixtures exercise canonical Admin and Staff scripts with isolated API data, including interrupted reads and retry recovery. Hosted checks must still confirm authenticated report reads and changes from actual production records after deployment.
