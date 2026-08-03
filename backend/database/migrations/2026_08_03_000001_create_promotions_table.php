<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('promotions', function (Blueprint $table) {
            $table->id();
            $table->string('title', 120);
            $table->unsignedTinyInteger('discount_percent');
            $table->enum('scope', ['all_products', 'specific_products'])->default('all_products');
            $table->json('product_ids')->nullable();
            $table->timestamp('starts_at')->nullable();
            $table->timestamp('ends_at')->nullable();
            $table->boolean('is_enabled')->default(true);
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->index(['is_enabled', 'starts_at', 'ends_at']);
        });
    }

    public function down(): void { Schema::dropIfExists('promotions'); }
};