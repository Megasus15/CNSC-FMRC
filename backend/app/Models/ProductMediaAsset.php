<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ProductMediaAsset extends Model
{
    protected $table = 'product_media';

    protected $guarded = ['id'];

    protected $casts = ['published_at' => 'datetime', 'expires_at' => 'datetime', 'size' => 'integer', 'position' => 'integer', 'owner_id' => 'integer', 'product_id' => 'integer'];
}
