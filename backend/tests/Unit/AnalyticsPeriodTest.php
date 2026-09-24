<?php

namespace Tests\Unit;

use App\Support\AnalyticsPeriod;
use Illuminate\Support\Carbon;
use PHPUnit\Framework\TestCase;

/**
 * AnalyticsPeriod is the single source of truth for what "This Week" means
 * across the back office — the revenue hero and all three product-analytics
 * cards resolve their window here. These pin each key's bounds (Asia/Manila)
 * and the equal-length "previous" window behind the hero's ▲/▼ delta.
 */
class AnalyticsPeriodTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        // A fixed Wednesday afternoon in Manila, mid-month, mid-year — so every
        // boundary below is unambiguous.
        Carbon::setTestNow(Carbon::create(2026, 9, 23, 14, 30, 0, AnalyticsPeriod::TIMEZONE));
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_day_is_the_local_calendar_day(): void
    {
        $period = AnalyticsPeriod::resolve('day');

        $this->assertSame('day', $period['key']);
        $this->assertSame('Today', $period['label']);
        $this->assertSame('2026-09-23 00:00:00', $period['start']->format('Y-m-d H:i:s'));
        $this->assertSame('2026-09-23 23:59:59', $period['end']->format('Y-m-d H:i:s'));
        $this->assertSame(AnalyticsPeriod::TIMEZONE, $period['start']->timezoneName);
    }

    public function test_week_runs_sunday_to_saturday(): void
    {
        $period = AnalyticsPeriod::resolve('week');

        // 2026-09-23 is a Wednesday, so the week is Sun 20th → Sat 26th.
        $this->assertSame('2026-09-20 00:00:00', $period['start']->format('Y-m-d H:i:s'));
        $this->assertSame('2026-09-26 23:59:59', $period['end']->format('Y-m-d H:i:s'));
    }

    public function test_month_is_the_default_and_spans_the_calendar_month(): void
    {
        $fromBlank = AnalyticsPeriod::resolve(null);
        $fromGarbage = AnalyticsPeriod::resolve('not-a-period');

        foreach ([$fromBlank, $fromGarbage] as $period) {
            $this->assertSame('month', $period['key']);
            $this->assertSame('2026-09-01 00:00:00', $period['start']->format('Y-m-d H:i:s'));
            $this->assertSame('2026-09-30 23:59:59', $period['end']->format('Y-m-d H:i:s'));
        }
    }

    public function test_year_spans_the_calendar_year(): void
    {
        $period = AnalyticsPeriod::resolve('year');

        $this->assertSame('year', $period['key']);
        $this->assertSame('2026-01-01 00:00:00', $period['start']->format('Y-m-d H:i:s'));
        $this->assertSame('2026-12-31 23:59:59', $period['end']->format('Y-m-d H:i:s'));
    }

    public function test_all_has_null_bounds_meaning_no_date_predicate(): void
    {
        $period = AnalyticsPeriod::resolve('all');

        $this->assertSame('all', $period['key']);
        $this->assertNull($period['start']);
        $this->assertNull($period['end']);
    }

    public function test_custom_range_is_parsed_and_clamped_to_day_edges(): void
    {
        $period = AnalyticsPeriod::resolve('custom', '2026-03-05', '2026-03-09');

        $this->assertSame('custom', $period['key']);
        $this->assertSame('2026-03-05 00:00:00', $period['start']->format('Y-m-d H:i:s'));
        $this->assertSame('2026-03-09 23:59:59', $period['end']->format('Y-m-d H:i:s'));
    }

    public function test_a_reversed_or_half_open_custom_range_falls_back_to_month(): void
    {
        foreach ([
            ['2026-03-09', '2026-03-05'], // reversed
            ['2026-03-09', null],         // half-open
            ['nonsense', 'also-bad'],     // unparseable
        ] as [$from, $to]) {
            $period = AnalyticsPeriod::resolve('custom', $from, $to);
            $this->assertSame('month', $period['key'], "range [{$from}, {$to}] should have fallen back to month");
        }
    }

    public function test_previous_window_is_the_immediately_preceding_equal_length_span(): void
    {
        $cases = [
            'day' => ['Yesterday', '2026-09-22 00:00:00', '2026-09-22 23:59:59'],
            'week' => ['Last Week', '2026-09-13 00:00:00', '2026-09-19 23:59:59'],
            'year' => ['Last Year', '2025-01-01 00:00:00', '2025-12-31 23:59:59'],
        ];

        foreach ($cases as $key => [$label, $start, $end]) {
            $previous = AnalyticsPeriod::previous(AnalyticsPeriod::resolve($key));
            $this->assertSame($label, $previous['label'], "{$key} previous label");
            $this->assertSame($start, $previous['start']->format('Y-m-d H:i:s'), "{$key} previous start");
            $this->assertSame($end, $previous['end']->format('Y-m-d H:i:s'), "{$key} previous end");
        }
    }

    public function test_previous_month_ends_the_instant_before_the_current_month(): void
    {
        $previous = AnalyticsPeriod::previous(AnalyticsPeriod::resolve('month'));

        $this->assertSame('Last Month', $previous['label']);
        $this->assertSame('2026-08-01 00:00:00', $previous['start']->format('Y-m-d H:i:s'));
        // Ends one second before this month's 00:00:00 start.
        $this->assertSame('2026-08-31 23:59:59', $previous['end']->format('Y-m-d H:i:s'));
    }

    public function test_all_time_has_no_previous_window(): void
    {
        $this->assertNull(AnalyticsPeriod::previous(AnalyticsPeriod::resolve('all')));
    }

    public function test_previous_custom_steps_back_by_the_range_length(): void
    {
        // A 5-day window (Mar 5–9 inclusive) steps back to the 5 days before it.
        $previous = AnalyticsPeriod::previous(AnalyticsPeriod::resolve('custom', '2026-03-05', '2026-03-09'));

        $this->assertSame('Previous Period', $previous['label']);
        $this->assertSame('2026-02-28 00:00:00', $previous['start']->format('Y-m-d H:i:s'));
        $this->assertSame('2026-03-04 23:59:59', $previous['end']->format('Y-m-d H:i:s'));
    }
}
