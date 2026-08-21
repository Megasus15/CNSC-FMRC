<?php

namespace App\Support;

use App\Models\Announcement;
use App\Models\Appointment;
use App\Models\InventoryItem;
use App\Models\Order;
use App\Models\OrderReturn;
use App\Models\ProductRating;
use App\Models\Promotion;
use Illuminate\Database\Eloquent\Builder;

class AdminArchiveRecords
{
    public const MODULES = [
        'inventory',
        'appointments',
        'orders',
        'returns',
        'ratings',
        'promotions',
        'announcements',
    ];

    public static function query(string $module): Builder
    {
        return match ($module) {
            'inventory' => InventoryItem::query()->where('is_archived', true),
            'appointments' => Appointment::query()->where('status', 'Archived'),
            'orders' => Order::query()->where('is_archived', true),
            'returns' => OrderReturn::query()->where('is_archived', true),
            'ratings' => ProductRating::query()->where('is_archived', true),
            'promotions' => Promotion::query()->where('is_archived', true),
            'announcements' => Announcement::query()->where('is_archived', true),
            default => throw new \InvalidArgumentException("Unknown archive module [{$module}]."),
        };
    }

    /**
     * Return the exact seven module counts used by the unified Archives page.
     * Missing or partially deployed schemas degrade to zero for that module.
     *
     * @return array{counts: array<string, int>, availability: array<string, bool>, total: int}
     */
    public static function snapshot(): array
    {
        $counts = [];
        $availability = [];

        foreach (self::MODULES as $module) {
            try {
                $counts[$module] = self::query($module)->count();
                $availability[$module] = true;
            } catch (\Throwable) {
                $counts[$module] = 0;
                $availability[$module] = false;
            }
        }

        return [
            'counts' => $counts,
            'availability' => $availability,
            'total' => array_sum($counts),
        ];
    }
}
