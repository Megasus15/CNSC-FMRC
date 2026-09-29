<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Separate presentation settings from the maintenance scope switches. Existing
 * maintenance installations retain every scope and message unchanged.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('maintenance_settings')) {
            Schema::table('maintenance_settings', function (Blueprint $table) {
                // The site-wide page has room for a short paragraph. All other
                // maintenance notices keep their 75-character API limit.
                $table->string('message', 255)->nullable()->change();
            });
        }

        if (Schema::hasTable('maintenance_page_settings')) {
            return;
        }

        Schema::create('maintenance_page_settings', function (Blueprint $table) {
            $table->id();
            $table->string('eyebrow', 80)->nullable();
            $table->string('headline', 120)->nullable();
            $table->string('headline_accent', 80)->nullable();
            $table->string('supporting_line', 160)->nullable();
            $table->string('image_path', 255)->nullable();
            $table->string('image_alt', 120)->nullable();
            $table->string('theme', 32)->nullable();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('maintenance_page_settings');
        // Retain the widened message column: narrowing it could truncate a
        // site-wide notice an administrator has already published.
    }
};
