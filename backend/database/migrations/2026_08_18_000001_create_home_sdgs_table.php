<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('home_sdgs')) {
            return;
        }

        Schema::create('home_sdgs', function (Blueprint $table) {
            $table->id();
            $table->string('title');
            $table->text('description')->nullable();
            // Base64 data URL of the circle-cropped badge. longText matches the
            // established storage for site imagery (services.image_data,
            // site_settings.value).
            $table->longText('image_data')->nullable();
            $table->integer('sort_order')->default(0);
            $table->boolean('is_visible')->default(true);
            $table->timestamps();
        });

        try {
            Schema::table('home_sdgs', function (Blueprint $table) {
                $table->index(['is_visible', 'sort_order']);
            });
        } catch (\Throwable) {
            // Index already present or unsupported by the driver.
        }
    }

    public function down(): void
    {
        // Intentionally non-destructive: rolling back must never discard
        // uploaded SDG artwork.
    }
};
