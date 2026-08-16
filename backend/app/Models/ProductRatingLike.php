<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ProductRatingLike extends Model
{
    protected $fillable = [
        'product_rating_id',
        'user_id',
    ];

    public function rating(): BelongsTo
    {
        return $this->belongsTo(ProductRating::class, 'product_rating_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
