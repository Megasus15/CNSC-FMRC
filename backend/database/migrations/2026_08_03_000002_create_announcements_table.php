<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('announcements', function (Blueprint $table) {
            $table->id();
            $table->string('title', 140);
            $table->text('message');
            $table->string('cta_label', 60)->nullable();
            $table->string('cta_url', 500)->nullable();
            $table->enum('placement', ['site', 'products', 'both'])->default('site');
            $table->string('accent_color', 20)->default('#f59e0b');
            $table->timestamp('starts_at')->nullable();
            $table->timestamp('ends_at')->nullable();
            $table->boolean('is_enabled')->default(true);
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->index(['is_enabled', 'placement', 'starts_at', 'ends_at']);
        });
    }

    public function down(): void { Schema::dropIfExists('announcements'); }
};