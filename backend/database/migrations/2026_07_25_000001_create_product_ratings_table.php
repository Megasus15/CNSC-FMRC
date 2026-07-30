<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('product_ratings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('order_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('product_id')->nullable();
            $table->string('product_name', 180);
            $table->unsignedTinyInteger('stars')->default(5); // 1-5
            $table->string('feedback', 75)->nullable();
            $table->timestamps();

            $table->unique(['user_id', 'order_id']); // one rating per order
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('product_ratings');
    }
};
