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
        Schema::create('appointment_calendar_days', function (Blueprint $table) {
            $table->id();
            $table->date('date')->unique();
            $table->boolean('is_blocked')->default(false);
            $table->json('blocked_slots')->nullable();
            $table->json('events')->nullable();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('appointment_calendar_days');
    }
};
