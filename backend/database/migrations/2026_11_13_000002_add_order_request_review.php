<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            // Null deliberately keeps orders placed before this release on their existing workflow.
            $table->string('review_status', 20)->nullable()->index();
            $table->unsignedBigInteger('reviewed_by_user_id')->nullable();
            $table->timestamp('reviewed_at')->nullable();
            $table->text('review_reason')->nullable();
            $table->timestamp('stock_reserved_at')->nullable();
            $table->timestamp('stock_released_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropIndex(['review_status']);
            $table->dropColumn(['review_status', 'reviewed_by_user_id', 'reviewed_at', 'review_reason', 'stock_reserved_at', 'stock_released_at']);
        });
    }
};
