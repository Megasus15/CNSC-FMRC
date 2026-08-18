<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class HomeSdg extends Model
{
    /**
     * The customer hero renders two rows of four badges, so the strip holds
     * at most eight records. Enforced in HomeSdgController::store().
     */
    public const MAX_SLOTS = 8;

    protected $fillable = [
        'title',
        'description',
        'image_data',
        'sort_order',
        'is_visible',
    ];

    protected $casts = [
        'is_visible' => 'boolean',
        'sort_order' => 'integer',
    ];
}
