# Reports workspace and modal refinements

Release assets: **2026.1114.9**. Frontend-only rollout for Admin and Staff Reports.
Report calculations, categories, reporting-period parameters, permissions,
generation auditing, financial records and export payloads are unchanged.

## Workspace

Both Reports shells opt into the shared popup presentation with
`data-portal-popups="refined"` and context `Reports`. The new, screen-only
`admin-page/reports-ui.css` adopts the cream surface, 12px corners, neutral
borders, maroon icon tiles, portal font and theme tokens.

- Category, current-report, trend, breakdown and transaction-table cards have
  persistent SVG heading icons and maroon headings. Dynamic report titles can
  refresh without deleting the icon.
- All seven category values and their API mappings remain. The two long order
  labels are shortened to **Completed** and **In Progress**. Desktop uses a
  balanced 4+3 arrangement, tablets 3+2+2, and phones full-width compact rows.
  Product Stock no longer sits alone beneath six desktop buttons.
- Filters, generation/export controls and section selection retain their IDs,
  behavior and values, with consistent spacing and 44px controls. Reports has
  no existing search or row-delete workflow; this rollout does not add one.
- Six summary metrics use three columns/two rows on desktop, two columns on
  tablets and full-width phone cards. Other metric counts remain supported.
  Values retain the existing complete currency/integer formatting. A resize-
  and font-aware fitting helper reduces the 26px value to a readable 16px
  floor; exceptionally long values wrap instead of being replaced by dots.
  Negative amounts, zero, labels and precise values remain available.

## Dashboard chart parity

Reports loads the same pinned **Chart.js 4.4.7** and
`analytics-charts.js?v=1.4` already used by Dashboard. No package installation
or shared chart-factory change is needed.

The screen trend calls the existing line factory, preserving every series and
signed point supplied by the report response. The breakdown calls the existing
horizontal-bar factory and retains the complete label/value list below it.
Reports applies the current portal theme to its own instances; swatches match
the Dashboard palette. Tooltips show exact formatted values. Theme changes,
report refresh and restored browser pages rebuild the owned charts, destroying
previous instances. Page exit cleans them up.

Accessible trend data and the exact breakdown list remain available without
relying on canvas or hovering. If the remote chart runtime fails to load, the
existing report chart and breakdown markup remains as a data-complete fallback.
The **official document renderer continues using its original self-contained
charts**; screen chart styling does not alter report-sheet measurements.

## Dialogs and popups

Edit Letterhead uses the shared 800px full-modal frame with guarded X, fixed
header/footer and a scrollable body. Restore defaults sits beside the guidance
above the fields and uses the existing styled confirmation, with no X. The
existing immediate save after confirmation is retained. Save/cancel labels,
field groups, limits and default resolution remain. Empty/hidden errors have
no layout footprint; actual failures remain accessible and retain the draft.

The shared editor now preserves typed values during delayed/realtime settings
reads and prevents a closed or superseded editor from taking focus. While a
save is pending, adopted editors disable Close/Cancel and make fields inert;
existing duplicate-write and close guards remain. Inventory reuses this owner,
so its existing editor receives the same draft/pending protections.

Preview / Print retains its 1120px document-preview width within the viewport,
using the shared frame, icon tile and full-modal X. Header/footer stay visible;
only the document body pans/scrolls. Short landscape and zoomed layouts wrap
the PDF guidance and purchase-free print actions without crowding the body.
The shared controller owns page locking, scrollbar compensation, focus and
inertness on adopted previews, replacing the legacy preview lock there. Legacy
unadopted document hosts retain their original handling.

Confirmation/error/export feedback, logout/session notices and success
notifications inherit the page opt-in. Compact popups have no X or horizontal
message rules; full modals retain X. Existing callbacks, action labels, pending
guards and success timing remain. No delete/archive action is introduced.

## Verification

```powershell
node --check admin-page/reports.js
node --test backend/tests/Frontend/reports-ui.browser.cjs
node --test backend/tests/Frontend/reports-refresh.browser.cjs
node --test backend/tests/Frontend/reports.browser.cjs
node --test backend/tests/Frontend/report-excel.test.cjs
node --test backend/tests/Frontend/inventory-forms.browser.cjs
git diff --check
```

The focused UI suite uses the real pinned chart runtime. Set
`FMRC_BROWSER_CHARTJS` to a local copy of Dashboard's Chart.js 4.4.7 runtime, or
use the temporary default `fmrc-chart-4.4.7-test.js` under the system temp
directory. The suite skips its canvas checks if that fixture runtime is absent.
`FMRC_BROWSER_POPPINS` can point to the local preview font used for screenshots.
Neither test fixture is deployed as a new application dependency.

Local browser fixtures cover both roles, 320/390/768/1024/1440px, light/dark
themes, short landscape and an equivalent 200% zoom viewport. Checks cover
large/negative/zero values, balanced rows, exact chart data/tooltips, chart
cleanup, all categories, table pagination, safe text, shared letterhead
readback, delayed-read draft protection, pending/error recovery, reset, preview
scroll/focus restoration and the unchanged report refresh recovery paths.

The existing print suite generates empty/short/full/long/multi-section/custom
reports and validates final-sheet certification and record coverage in both
portals. Excel checks preserve full worksheets and signed amounts. Rendered
test PDF pages are visually inspected for header/footer, tables and signatures.
These checks use fixture records, not hosted financial or customer data.

## Deployment

Release matching Reports shells, `reports-ui.css`, and `reports.js` through
**commit → push → online deployment**. Inventory's two script references also
update to **2026.1114.9** because it shares the document/editor owner. Other
portal pages keep their current assets and presentation. No ZIP, migration,
Composer install, report recalculation or provider operation is required.

Verify hosted public file equality and both Reports shells after deployment.
That confirms asset delivery separately from authenticated live report
generation, letterhead writes or private financial-data verification.
