<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Hostinger releases may install this table through phpMyAdmin first.
        // Record the migration later without replacing personal preferences.
        if (Schema::hasTable('user_portal_preferences')) {
            return;
        }

        Schema::create('user_portal_preferences', function (Blueprint $table) {
            $table->foreignId('user_id')->primary()->constrained('users')->cascadeOnDelete();
            $table->string('theme', 10)->default('light');
            $table->boolean('compact')->default(false);
            $table->boolean('reduced_motion')->default(false);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_portal_preferences');
    }
};
