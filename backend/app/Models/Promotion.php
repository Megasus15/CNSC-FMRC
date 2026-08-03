<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

class Promotion extends Model
{
    protected $fillable = ['title','discount_percent','scope','product_ids','starts_at','ends_at','is_enabled','created_by'];
    protected $casts = ['product_ids' => 'array', 'starts_at' => 'datetime', 'ends_at' => 'datetime', 'is_enabled' => 'boolean'];

    public function appliesTo(Product $product, ?Carbon $now = null): bool
    {
        $now ??= now();
        if (!$this->is_enabled || ($this->starts_at && $this->starts_at->gt($now)) || ($this->ends_at && $this->ends_at->lt($now))) return false;
        return $this->scope === 'all_products' || in_array((int) $product->id, array_map('intval', $this->product_ids ?? []), true);
    }

    public function isLive(): bool
    {
        if (!$this->is_enabled) {
            return false;
        }
        $now = now();
        $hasStarted = !$this->starts_at || $this->starts_at->lte($now->copy()->addHours(24));
        $hasNotEnded = !$this->ends_at || $this->ends_at->gte($now->copy()->subHours(24));

        return $hasStarted && $hasNotEnded;
    }
}