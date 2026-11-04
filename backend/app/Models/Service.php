<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Service extends Model
{
    protected $fillable = [
        'accepts_custom_requests',
        'title',
        'category',
        'description',
        'image_data',
        'modal_description',
        'modal_features',
        'modal_materials',
        'modal_best_for',
        'sort_order',
    ];

    protected $casts = [
        'accepts_custom_requests' => 'boolean',
        'modal_features'  => 'array',
        'modal_materials' => 'array',
        'modal_best_for'  => 'array',
    ];
}
