<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('appointment_calendar_days', function (Blueprint $table) {
            if (!Schema::hasColumn('appointment_calendar_days', 'custom_slots')) {
                $table->json('custom_slots')->nullable()->after('events');
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('appointment_calendar_days', function (Blueprint $table) {
            if (Schema::hasColumn('appointment_calendar_days', 'custom_slots')) {
                $table->dropColumn('custom_slots');
            }
        });
    }
};
