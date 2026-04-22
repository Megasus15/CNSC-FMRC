<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('services', function (Blueprint $table) {
            $table->id();
            $table->string('title');
            $table->string('category')->default('Prototyping');
            $table->text('description')->nullable();
            $table->longText('image_data')->nullable();
            $table->text('modal_description')->nullable();
            $table->json('modal_features')->nullable();
            $table->json('modal_materials')->nullable();
            $table->json('modal_best_for')->nullable();
            $table->integer('sort_order')->default(0);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('services');
    }
};
