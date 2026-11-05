<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Log;
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

    /**
     * Make the audit table usable, creating it on first use if the deployment
     * has not run `php artisan migrate` yet.
     *
     * The Hostinger deploy copies files only, so a released build can reach
     * production before its migration is executed by hand. Without this the
     * generate endpoint silently skipped the audit row and the dashboard
     * "Generated Reports" card stayed at zero with no visible error. The
     * definition mirrors 2026_08_21_000001_create_report_generations_table
     * exactly, so running the migration afterwards is a no-op.
     *
     * An existing table with missing columns is left untouched: altering a
     * table that some other migration owns is riskier than declining the audit
     * row, which is the behaviour callers already tolerate.
     */
    public static function ensureSchema(): bool
    {
        try {
            if (Schema::hasTable('report_generations')) {
                return Schema::hasColumns('report_generations', self::REQUIRED_COLUMNS);
            }

            Schema::create('report_generations', function (Blueprint $table) {
                $table->id();
                $table->string('generation_key', 100)->unique();
                $table->foreignId('generated_by_user_id')->nullable()->constrained('users')->nullOnDelete();
                $table->string('generated_by_name');
                $table->string('generated_by_role', 20);
                $table->string('report_code', 100)->unique();
                $table->string('category', 40);
                $table->string('period', 20);
                $table->unsignedSmallInteger('year');
                $table->unsignedTinyInteger('month')->nullable();
                $table->unsignedTinyInteger('quarter')->nullable();
                $table->timestamps();

                $table->index(['category', 'created_at']);
                $table->index('created_at');
            });

            return Schema::hasColumns('report_generations', self::REQUIRED_COLUMNS);
        } catch (\Throwable $exception) {
            Log::warning('Unable to prepare the report_generations audit table.', [
                'message' => $exception->getMessage(),
            ]);

            return self::schemaAvailable();
        }
    }
}
