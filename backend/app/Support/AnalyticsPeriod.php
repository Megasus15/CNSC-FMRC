<?php

namespace App\Support;

use Illuminate\Support\Carbon;

/**
 * The single source of truth for what "This Week" (and every other period)
 * means across the back office. The dashboard revenue hero and the three
 * product-analytics cards both resolve their window here, so a period button
 * lands them on the same calendar range — no more a "This Day" bar chart beside
 * an all-time donut.
 *
 * Everything is Asia/Manila: the shop's day rolls over at local midnight, not
 * UTC. `all` yields null bounds, meaning "no date predicate" — the lifetime
 * figure the dashboard has always shown.
 */
class AnalyticsPeriod
{
    public const TIMEZONE = 'Asia/Manila';

    /**
     * @return array{key:string,label:string,start:?Carbon,end:?Carbon}
     */
    public static function resolve(?string $period, ?string $from = null, ?string $to = null): array
    {
        $now = Carbon::now(self::TIMEZONE);
        $key = strtolower(trim((string) ($period ?: 'month')));

        return match ($key) {
            'day' => [
                'key' => 'day',
                'label' => 'Today',
                'start' => $now->copy()->startOfDay(),
                'end' => $now->copy()->endOfDay(),
            ],
            'week' => [
                'key' => 'week',
                'label' => 'This Week',
                'start' => $now->copy()->startOfWeek(Carbon::SUNDAY),
                'end' => $now->copy()->endOfWeek(Carbon::SATURDAY)->endOfDay(),
            ],
            'year' => [
                'key' => 'year',
                'label' => 'This Year',
                'start' => $now->copy()->startOfYear(),
                'end' => $now->copy()->endOfYear()->endOfDay(),
            ],
            'all' => [
                'key' => 'all',
                'label' => 'All Time',
                'start' => null,
                'end' => null,
            ],
            'custom' => self::resolveCustom($from, $to, $now),
            default => [
                'key' => 'month',
                'label' => 'This Month',
                'start' => $now->copy()->startOfMonth(),
                'end' => $now->copy()->endOfMonth()->endOfDay(),
            ],
        };
    }

    /**
     * The equal-length window immediately before a resolved period — the
     * baseline the hero's ▲/▼ delta compares against. `all` (null bounds) has no
     * "previous", so it returns null and the hero shows no delta.
     *
     * @param  array{key:string,label:string,start:?Carbon,end:?Carbon}  $current
     * @return array{label:string,start:Carbon,end:Carbon}|null
     */
    public static function previous(array $current): ?array
    {
        $start = $current['start'] ?? null;
        $end = $current['end'] ?? null;
        if (! $start instanceof Carbon || ! $end instanceof Carbon) {
            return null;
        }

        $key = $current['key'] ?? 'month';
        $prevEnd = $start->copy()->subSecond();
        $prevStart = match ($key) {
            'day' => $start->copy()->subDay(),
            'week' => $start->copy()->subWeek(),
            'year' => $start->copy()->subYear(),
            // A custom window has no natural unit, so step back by its own
            // length. endOfDay() carries microseconds, so diffInSeconds returns
            // a fraction (…59.999999) — floor it to whole seconds or the
            // previous window lands a second early.
            'custom' => $start->copy()->subSeconds((int) $start->diffInSeconds($end) + 1),
            default => $start->copy()->subMonthNoOverflow(),
        };

        return [
            'label' => match ($key) {
                'day' => 'Yesterday',
                'week' => 'Last Week',
                'year' => 'Last Year',
                'custom' => 'Previous Period',
                default => 'Last Month',
            },
            'start' => $prevStart,
            'end' => $prevEnd,
        ];
    }

    /**
     * @return array{key:string,label:string,start:?Carbon,end:?Carbon}
     */
    private static function resolveCustom(?string $from, ?string $to, Carbon $now): array
    {
        try {
            $start = $from ? Carbon::parse($from, self::TIMEZONE)->startOfDay() : null;
            $end = $to ? Carbon::parse($to, self::TIMEZONE)->endOfDay() : null;
        } catch (\Throwable) {
            $start = $end = null;
        }

        // A half-open or unparseable custom range is meaningless — fall back to
        // the month so a bad querystring never blanks the card.
        if (! $start || ! $end || $end->lessThan($start)) {
            return [
                'key' => 'month',
                'label' => 'This Month',
                'start' => $now->copy()->startOfMonth(),
                'end' => $now->copy()->endOfMonth()->endOfDay(),
            ];
        }

        return [
            'key' => 'custom',
            'label' => $start->isSameDay($end)
                ? $start->format('M j, Y')
                : $start->format('M j').' – '.$end->format('M j, Y'),
            'start' => $start,
            'end' => $end,
        ];
    }
}
