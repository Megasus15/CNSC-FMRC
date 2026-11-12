<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->unsignedBigInteger('cover_media_id')->nullable();
            $table->unsignedInteger('media_revision')->default(0);
            $table->boolean('media_managed')->default(false);
        });
        Schema::create('product_media', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('owner_id')->nullable()->constrained('users')->nullOnDelete();
            $table->uuid('upload_token')->nullable()->unique();
            $table->string('path')->nullable();
            $table->text('source_url')->nullable();
            $table->string('name');
            $table->string('mime', 80);
            $table->string('type', 10);
            $table->unsignedBigInteger('size')->default(0);
            $table->unsignedInteger('position')->default(0);
            $table->timestamp('published_at')->nullable();
            $table->timestamp('expires_at')->nullable()->index();
            $table->timestamps();
            $table->index(['product_id', 'position']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('product_media');
        Schema::table('products', fn (Blueprint $table) => $table->dropColumn(['cover_media_id', 'media_revision', 'media_managed']));
    }
};
