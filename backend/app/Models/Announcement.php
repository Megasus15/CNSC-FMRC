<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Announcement extends Model
{
    protected $fillable = ['title','message','cta_label','cta_url','placement','accent_color','secondary_color','starts_at','ends_at','is_enabled','created_by'];
    protected $casts = ['starts_at' => 'datetime', 'ends_at' => 'datetime', 'is_enabled' => 'boolean'];

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