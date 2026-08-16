<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('product_rating_likes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_rating_id')->constrained('product_ratings')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['product_rating_id', 'user_id'], 'product_rating_likes_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('product_rating_likes');
    }
};
