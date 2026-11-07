<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('shipment_tracking_subscriptions', fn (Blueprint $table) => $table->json('latest_result')->nullable());
        Schema::table('orders', fn (Blueprint $table) => $table->foreignId('tracking_test_subscription_id')->nullable()->constrained('shipment_tracking_subscriptions')->nullOnDelete());
    }

    public function down(): void
    {
        Schema::table('orders', fn (Blueprint $table) => $table->dropConstrainedForeignId('tracking_test_subscription_id'));
        Schema::table('shipment_tracking_subscriptions', fn (Blueprint $table) => $table->dropColumn('latest_result'));
    }
};
