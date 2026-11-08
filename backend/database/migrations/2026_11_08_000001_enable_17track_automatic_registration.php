<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('shipment_tracking_numbers', function (Blueprint $table) {
            $table->string('tracking_number', 50)->primary();
            $table->foreignId('order_id')->nullable()->constrained('orders')->nullOnDelete();
            $table->foreignId('tracker_id')->nullable()->constrained('shipment_trackers')->nullOnDelete();
            $table->timestamps();
        });
        // Keep every historical assignment reserved, including completed orders
        // and corrected numbers. Preserve legacy duplicate history for review.
        DB::table('shipment_trackers')->orderBy('id')->chunkById(100, function ($trackers) {
            foreach ($trackers as $tracker) {
                $number = strtoupper(trim($tracker->tracking_number));
                $inserted = DB::table('shipment_tracking_numbers')->insertOrIgnore([
                    'tracking_number' => $number, 'order_id' => $tracker->order_id, 'tracker_id' => $tracker->id,
                    'created_at' => now(), 'updated_at' => now(),
                ]);
                if (! $inserted) {
                    DB::table('shipment_trackers')->where('id', $tracker->id)->update([
                        'needs_review' => true, 'last_error_code' => 'tracking_number_in_use', 'updated_at' => now(),
                    ]);
                }
            }
        });
        DB::table('orders')->whereNotNull('tracking_test_subscription_id')->orderBy('id')->chunkById(100, function ($orders) {
            foreach ($orders as $order) {
                $number = DB::table('shipment_tracking_subscriptions')->where('id', $order->tracking_test_subscription_id)->value('tracking_number');
                if ($number) {
                    DB::table('shipment_tracking_numbers')->insertOrIgnore([
                        'tracking_number' => strtoupper(trim($number)), 'order_id' => $order->id,
                        'created_at' => now(), 'updated_at' => now(),
                    ]);
                }
            }
        });
        // Retire the old first-parcel activation gate. The environment switch
        // still controls rollout; subsequent explicit Admin pauses are preserved.
        DB::table('shipment_tracking_settings')->where('provider', '17track')->update([
            'enabled' => true, 'revision' => DB::raw('revision + 1'), 'updated_at' => now(),
        ]);
        DB::table('shipment_tracking_subscriptions')->where('provider', '17track')->whereNull('registered_at')
            ->where('registration_state', 'failed')->where('last_error_code', 'response_mismatch')->update([
                'registration_state' => 'pending', 'last_error_code' => null, 'next_attempt_at' => now(), 'attempts' => 0, 'updated_at' => now(),
            ]);
    }

    public function down(): void
    {
        Schema::dropIfExists('shipment_tracking_numbers');
        DB::table('shipment_tracking_settings')->where('provider', '17track')->update([
            'enabled' => false, 'revision' => DB::raw('revision + 1'), 'updated_at' => now(),
        ]);
    }
};
