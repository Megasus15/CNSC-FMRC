<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('report_generations')) {
            return;
        }

        Schema::create('report_generations', function (Blueprint $table): void {
            $table->id();
            $table->string('generation_key', 100)->unique();
            $table->foreignId('generated_by_user_id')
                ->nullable()
                ->constrained('users')
                ->nullOnDelete();
            $table->string('generated_by_name');
            $table->string('generated_by_role', 20);
            $table->string('report_code', 100)->unique();
            $table->string('category', 40);
            $table->string('period', 20);
            $table->unsignedSmallInteger('year');
            $table->unsignedTinyInteger('month')->nullable();
            $table->unsignedTinyInteger('quarter')->nullable();
            $table->timestamps();

            $table->index(['category', 'period', 'year']);
            $table->index(['generated_by_user_id', 'created_at']);
        });
    }

    public function down(): void
    {
        // Report-generation records are an audit trail. Keep them intact if
        // application code is rolled back after a production deployment.
    }
};
