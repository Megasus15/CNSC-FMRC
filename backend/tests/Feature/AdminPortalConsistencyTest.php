<?php

namespace Tests\Feature;

use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class AdminPortalConsistencyTest extends TestCase
{
    /** @return array<int, array{string}> */
    public static function portalHtmlProvider(): array
    {
        $root = dirname(__DIR__, 3);
        $files = array_merge(
            glob($root.DIRECTORY_SEPARATOR.'admin-page'.DIRECTORY_SEPARATOR.'*.html') ?: [],
            glob($root.DIRECTORY_SEPARATOR.'staff-page'.DIRECTORY_SEPARATOR.'*.html') ?: [],
        );
        sort($files);

        return array_map(static fn (string $file): array => [$file], $files);
    }

    public function test_portal_has_the_expected_31_admin_and_staff_pages(): void
    {
        $this->assertCount(31, self::portalHtmlProvider());
    }

    #[DataProvider('portalHtmlProvider')]
    public function test_every_portal_page_uses_the_versioned_shared_live_ui(string $file): void
    {
        $html = (string) file_get_contents($file);

        $this->assertSame(1, preg_match('/dashboard\.css\?v=5\.1/', $html), $file);
        $this->assertSame(1, preg_match('/admin-common\.js\?v=5\.1/', $html), $file);
        $this->assertStringNotContainsString('<h3>24</h3>', $html, $file);

        // The green "Live data" chip was removed from every toolbar; the silent
        // AdminLiveData bridge (publish/subscribe/trackedFetch) stays behind it.
        $this->assertStringNotContainsString('admin-live-data', $html, $file);

        preg_match_all('/\sid="([^"]+)"/', $html, $matches);
        $ids = $matches[1] ?? [];
        $this->assertSame(count($ids), count(array_unique($ids)), "Duplicate HTML id in {$file}");

        libxml_use_internal_errors(true);
        $document = new \DOMDocument;
        $this->assertTrue($document->loadHTML($html, LIBXML_NOWARNING | LIBXML_NOERROR), $file);
        $fatalErrors = array_filter(
            libxml_get_errors(),
            static fn (\LibXMLError $error): bool => $error->level >= LIBXML_ERR_FATAL,
        );
        libxml_clear_errors();
        $this->assertSame([], array_values($fatalErrors), "Fatal HTML parse error in {$file}");
    }

    public function test_all_affected_page_scripts_are_cache_versioned(): void
    {
        $html = $this->allPortalHtml();
        $affected = [
            'accounts.js',
            'appointments.js',
            'archives.js',
            'customer-inquiries.js',
            'dashboard.js',
            'inventory.js',
            'orders.js',
            'products.js',
            'products-loader.js',
            'promotions.js',
            'ratings.js',
            'reports.js',
        ];

        foreach ($affected as $script) {
            $quoted = preg_quote($script, '/');
            $this->assertStringContainsString("{$script}?v=5.1", $html);
            $this->assertDoesNotMatchRegularExpression(
                "/{$quoted}(?!\\?v=5\\.1)/",
                $html,
                "Unversioned affected script: {$script}",
            );
        }
    }

    public function test_the_green_live_data_chip_is_gone_from_the_shared_ui(): void
    {
        $root = dirname(__DIR__, 3);
        $adminCommon = (string) file_get_contents($root.'/admin-page/admin-common.js');
        $dashboardCss = (string) file_get_contents($root.'/admin-page/dashboard.css');
        $productsLoader = (string) file_get_contents($root.'/staff-page/products-loader.js');

        // No chip markup, styles or mounting anywhere.
        $this->assertStringNotContainsString('admin-live-data-chip', $adminCommon);
        $this->assertStringNotContainsString('admin-live-data', $dashboardCss);
        $this->assertStringNotContainsString('AdminLiveData?.mount', $productsLoader);
        $this->assertStringNotContainsString('admin-live-data', $this->allPortalHtml());

        // The invisible cross-tab bridge that keeps the dashboard Archived
        // Records card realtime must survive, and mount() must stay callable
        // for month-cached copies of products-loader.js.
        foreach (['trackedFetch', 'publish', 'subscribe', 'setAvailability', 'mount: () => []'] as $needle) {
            $this->assertStringContainsString($needle, $adminCommon);
        }
    }

    public function test_the_dashboard_reports_tile_is_a_quick_action_not_a_counter(): void
    {
        $root = dirname(__DIR__, 3);
        $dashboardJs = (string) file_get_contents($root.'/admin-page/dashboard.js');
        $dashboardCss = (string) file_get_contents($root.'/admin-page/dashboard.css');

        foreach (['admin-page', 'staff-page'] as $portal) {
            $html = (string) file_get_contents($root.'/'.$portal.'/dashboard.html');

            // Counting generated reports on the dashboard carried no decision,
            // so the tile is now a call to action that opens the Reports page.
            $this->assertStringNotContainsString('dashboardReportsCount', $html, $portal);
            $this->assertStringNotContainsString('Generated Reports', $html, $portal);

            $this->assertStringContainsString('class="card card-link card-action"', $html, $portal);
            $this->assertStringContainsString('href="reports.html"', $html, $portal);
            $this->assertStringContainsString('class="card-action-title"', $html, $portal);
            $this->assertStringContainsString('Generate Report', $html, $portal);
            $this->assertStringContainsString('Turn records into official reports.', $html, $portal);
        }

        // Nothing renders the count any more; the API keeps returning it for the
        // report_generations audit trail.
        $this->assertStringNotContainsString('dashboardReportsCount', $dashboardJs);

        // The tile is styled by tint, icon and arrow only: a coloured left edge
        // was explicitly rejected.
        $this->assertSame(
            1,
            preg_match_all('/^\.card-action \{$/m', $dashboardCss),
            'The quick-action tile needs exactly one base rule.',
        );
        preg_match_all('/\.card-action[^{}]*\{[^}]*\}/', $dashboardCss, $blocks);
        $this->assertNotEmpty($blocks[0]);
        foreach ($blocks[0] as $block) {
            $this->assertStringNotContainsString('border-left', $block);
            $this->assertStringNotContainsString('border-inline-start', $block);
        }
    }

    public function test_every_portal_table_puts_the_newest_record_in_the_first_row(): void
    {
        $root = dirname(__DIR__, 3);
        $ordersJs = (string) file_get_contents($root.'/admin-page/orders.js');
        $accountsJs = (string) file_get_contents($root.'/admin-page/accounts.js');
        $appointmentsJs = (string) file_get_contents($root.'/admin-page/appointments.js');

        // Orders: incoming, the directory (which also feeds Rejected Orders),
        // walk-ins and payment history are all newest-first, and the realtime
        // upserts re-apply that order instead of appending.
        foreach ([
            'const sortOrdersByCreatedDesc',
            'const sortPaymentsByPaidDesc',
            'const sortWalkInByDateDesc',
            'state.incoming = sortOrdersByCreatedDesc(state.incoming);',
            'state.directory = sortOrdersByCreatedDesc(state.directory);',
            'state.payments = sortPaymentsByPaidDesc(getCompletedDirectoryRows());',
        ] as $needle) {
            $this->assertStringContainsString($needle, $ordersJs, $needle);
        }
        $this->assertGreaterThanOrEqual(
            4,
            preg_match_all('/normalizeStateOrdering\(\);/', $ordersJs),
            'Every state mutation must re-apply the newest-first order.',
        );
        foreach (['sortOrdersByCreatedAsc', 'sortPaymentsByOrderAsc'] as $obsolete) {
            $this->assertStringNotContainsString($obsolete, $ordersJs, $obsolete);
        }

        // User Management is the one exception: the founding Admin stays No. 001
        // and a newly created account lands in row 2 of page 1.
        $this->assertStringContainsString('const isAdminAccount', $accountsJs);
        $this->assertStringContainsString('const sortAccountsForTable', $accountsJs);
        $this->assertStringContainsString('state.users = sortAccountsForTable(', $accountsJs);

        // Appointments keeps Completed grouped last, newest-first within groups.
        $this->assertStringContainsString('const tsB = toTimestamp(b?.created_at', $appointmentsJs);
    }

    public function test_the_official_letterhead_is_editable_from_both_reports_pages(): void
    {
        $root = dirname(__DIR__, 3);
        $reportsJs = (string) file_get_contents($root.'/admin-page/reports.js');

        foreach (['admin-page', 'staff-page'] as $portal) {
            $html = (string) file_get_contents($root.'/'.$portal.'/reports.html');
            $this->assertStringContainsString('id="reportLetterheadBtn"', $html, $portal);
            $this->assertStringContainsString('id="reportLetterheadModal"', $html, $portal);
            $this->assertStringContainsString('id="reportLetterheadFields"', $html, $portal);
            $this->assertStringContainsString('id="reportLetterheadSaveBtn"', $html, $portal);
            $this->assertStringContainsString('id="reportLetterheadResetBtn"', $html, $portal);
        }

        // Every letterhead line is resolved through site_settings with the
        // official template wording as the fallback, and the write path is the
        // role-guarded bulk upsert.
        $this->assertStringContainsString('report_letterhead_', $reportsJs);
        $this->assertStringContainsString('const REPORT_LETTERHEAD_DEFAULTS', $reportsJs);
        $this->assertStringContainsString('/admin/site-settings', $reportsJs);
        $this->assertStringContainsString('CNSC-SP-QMS-05F5', $reportsJs);
        $this->assertStringContainsString('buildCertificationBlock', $reportsJs);

        // No hardcoded institution line may remain in the rendered letterhead.
        $this->assertStringNotContainsString('<strong>UNIVERSITY OF CAMARINES NORTE</strong>', $reportsJs);
    }

    public function test_ten_row_contract_has_no_obsolete_page_sizes(): void
    {
        $root = dirname(__DIR__, 3);
        $sources = [];
        foreach (['admin-page', 'staff-page'] as $directory) {
            foreach (['*.html', '*.js'] as $pattern) {
                $sources = array_merge(
                    $sources,
                    glob($root.DIRECTORY_SEPARATOR.$directory.DIRECTORY_SEPARATOR.$pattern) ?: [],
                );
            }
        }

        foreach ($sources as $file) {
            $source = (string) file_get_contents($file);
            $this->assertDoesNotMatchRegularExpression(
                '/data-page-size=["\'](?:5|8)["\']|(?:PAGE_SIZE|PER_PAGE)\s*=\s*(?:5|8)\b|slice\([^\r\n]*\+\s*(?:5|8)\s*\)/',
                $source,
                $file,
            );
        }
    }

    public function test_reports_and_dynamic_staff_products_keep_the_shared_contract(): void
    {
        $root = dirname(__DIR__, 3);
        $reportsJs = (string) file_get_contents($root.'/admin-page/reports.js');
        $adminReports = (string) file_get_contents($root.'/admin-page/reports.html');
        $staffReports = (string) file_get_contents($root.'/staff-page/reports.html');
        $productsLoader = (string) file_get_contents($root.'/staff-page/products-loader.js');

        foreach ([$adminReports, $staffReports] as $html) {
            $this->assertStringContainsString(
                '<mark class="report-generate-highlight">Generate Report</mark>',
                $html,
            );
            $this->assertStringContainsString('data-page-size="10"', $html);
            $this->assertStringNotContainsString('border-left:', $html);
        }

        $this->assertStringContainsString('const REPORT_ROWS_PER_SHEET = 10;', $reportsJs);
        $this->assertStringContainsString('/admin/reports/generate', $reportsJs);
        $this->assertStringContainsString('generation_key:', $reportsJs);
        $this->assertStringNotContainsString('LegacyPreview', $reportsJs);
        $this->assertStringNotContainsString('exportLegacyCsv', $reportsJs);
        $this->assertStringContainsString('<ul>${accessibleItems}</ul>', $reportsJs);
        $this->assertStringContainsString('/^[\\s\\u0000-\\u001f]*[=+\\-@]/u', $reportsJs);
        $this->assertStringContainsString('`\\uFEFF${lines.join("\\r\\n")}`', $reportsJs);
        $this->assertStringContainsString('"UCN-FMRC"', $reportsJs);
        $this->assertStringNotContainsString('window.AdminLiveData?.mount(moduleHost);', $productsLoader);
        $this->assertStringContainsString('window.AdminPageNumberInput?.upgrade(moduleHost);', $productsLoader);
    }

    public function test_the_csv_export_is_a_single_horizontal_data_table(): void
    {
        $root = dirname(__DIR__, 3);
        $reportsJs = (string) file_get_contents($root.'/admin-page/reports.js');

        // The spreadsheet carries the records only: one header row of column
        // labels, then one row per record. The letterhead, metadata pairs,
        // summary metrics, breakdown and certification prose belong to the
        // printed document, and a vertical "Field,Value" block would break the
        // operator's own filtering and pivoting.
        foreach ([
            'csvCell("REPORT METADATA")',
            'csvCell("SUMMARY METRICS")',
            'csvCell("CERTIFICATION")',
            'csvCell("Report ID")',
            'csvCell("Official contact")',
            'csvCell(state.letterhead.republic)',
            'data.breakdown.title.toUpperCase()',
            'data.table.title.toUpperCase()',
        ] as $removed) {
            $this->assertStringNotContainsString($removed, $reportsJs, $removed);
        }

        // Header row, typed data cells, and the preserved BOM / CRLF / formula
        // guard so Excel still opens it as UTF-8 and never evaluates a cell.
        $this->assertStringContainsString(
            'table.columns.map((column) => csvCell(column.label)).join(",")',
            $reportsJs,
        );
        $this->assertStringContainsString('const csvDataCell', $reportsJs);
        $this->assertStringContainsString('const csvDateStamp', $reportsJs);
        $this->assertStringContainsString('csvDataCell(row[column.key], column.type)', $reportsJs);
    }

    public function test_print_and_export_record_one_audited_generation(): void
    {
        $root = dirname(__DIR__, 3);
        $reportsJs = (string) file_get_contents($root.'/admin-page/reports.js');
        $modulesCss = (string) file_get_contents($root.'/admin-page/admin-modules.css');

        // Handing a finished document to the operator is a generation, so the
        // report_generations audit trail records printing and exporting even
        // when the auto-loaded report was never explicitly generated. Refresh
        // and the poll stay read-only.
        $this->assertStringContainsString('const recordArtifactGeneration', $reportsJs);
        $this->assertSame(
            2,
            preg_match_all('/await recordArtifactGeneration\(/', $reportsJs),
            'Print and Export CSV must each record the audited generation.',
        );

        // Print geometry: an 11in page box that fragments across two sheets
        // drops its absolutely positioned footer band mid-sheet and carries the
        // next header onto the same sheet.
        $this->assertStringContainsString('break-inside: avoid;', $modulesCss);
        $this->assertStringContainsString('page-break-inside: avoid;', $modulesCss);
        $this->assertStringContainsString('body.report-printing .official-report-header,', $modulesCss);
    }

    private function allPortalHtml(): string
    {
        return implode("\n", array_map(
            static fn (array $entry): string => (string) file_get_contents($entry[0]),
            self::portalHtmlProvider(),
        ));
    }
}
