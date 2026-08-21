<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Schema;

class ReportGeneration extends Model
{
    public const REQUIRED_COLUMNS = [
        'generation_key',
        'generated_by_user_id',
        'generated_by_name',
        'generated_by_role',
        'report_code',
        'category',
        'period',
        'year',
        'month',
        'quarter',
        'created_at',
        'updated_at',
    ];

    protected $fillable = [
        'generation_key',
        'generated_by_user_id',
        'generated_by_name',
        'generated_by_role',
        'report_code',
        'category',
        'period',
        'year',
        'month',
        'quarter',
    ];

    protected $casts = [
        'generated_by_user_id' => 'integer',
        'year' => 'integer',
        'month' => 'integer',
        'quarter' => 'integer',
    ];

    public function generatedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'generated_by_user_id');
    }

    public static function schemaAvailable(): bool
    {
        try {
            if (! Schema::hasTable('report_generations')) {
                return false;
            }

            return Schema::hasColumns('report_generations', self::REQUIRED_COLUMNS);
        } catch (\Throwable) {
            return false;
        }
    }
}
