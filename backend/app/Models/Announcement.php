<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

class Announcement extends Model
{
    private const SCHEDULE_TIME_ZONE = 'Asia/Manila';

    protected $fillable = ['title','message','cta_label','cta_url','placement','accent_color','secondary_color','starts_at','ends_at','is_enabled','is_archived','archived_at','created_by'];
    protected $casts = ['starts_at' => 'datetime', 'ends_at' => 'datetime', 'is_enabled' => 'boolean', 'is_archived' => 'boolean', 'archived_at' => 'datetime'];

    public function isLive(?Carbon $now = null): bool
    {
        $now ??= now(self::SCHEDULE_TIME_ZONE);

        return !$this->is_archived
            && (bool) $this->is_enabled
            && (!$this->starts_at || $this->starts_at->lte($now))
            && (!$this->ends_at || $this->ends_at->gt($now));
    }

    public function status(?Carbon $now = null): string
    {
        $now ??= now(self::SCHEDULE_TIME_ZONE);

        if ($this->is_archived) {
            return 'ARCHIVED';
        }

        if ($this->ends_at && $this->ends_at->lte($now)) {
            return 'FINISHED';
        }

        if (!$this->is_enabled) {
            return 'PAUSED';
        }

        if ($this->starts_at && $this->starts_at->gt($now)) {
            return 'SCHEDULED';
        }

        return 'LIVE';
    }
}
