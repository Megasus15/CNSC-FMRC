<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('shipment_tracking_settings', function (Blueprint $table) {
            $table->string('provider', 24)->default('ship24')->unique();
            $table->timestamp('last_test_webhook_at')->nullable();
        });
        // Preserve the retired account's evidence, but it can never run or activate again.
        DB::table('shipment_tracking_settings')->where('id', 1)->update(['enabled' => false, 'updated_at' => now()]);
        DB::table('shipment_tracking_settings')->insert(['id' => 2, 'provider' => '17track', 'enabled' => false, 'created_at' => now(), 'updated_at' => now()]);
        Schema::table('shipment_webhook_inbox', fn (Blueprint $table) => $table->string('provider', 24)->default('ship24')->index());
        Schema::create('shipment_tracking_subscriptions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tracker_id')->nullable()->constrained('shipment_trackers')->cascadeOnDelete();
            $table->unsignedBigInteger('active_tracker_id')->nullable()->unique();
            $table->string('provider', 24)->index();
            $table->uuid('tag')->unique();
            $table->string('tracking_number', 50);
            $table->string('carrier_code', 100)->nullable();
            $table->string('provider_tracker_id', 100)->nullable();
            $table->char('account_fingerprint', 64)->nullable();
            $table->json('registration_payload')->nullable();
            $table->string('registration_state', 24)->default('pending');
            $table->boolean('diagnostic')->default(false);
            $table->boolean('stop_pending')->default(false);
            $table->timestamp('registration_requested_at')->nullable();
            $table->timestamp('registered_at')->nullable();
            $table->timestamp('last_checked_at')->nullable();
            $table->timestamp('last_webhook_at')->nullable();
            $table->timestamp('last_event_at')->nullable();
            $table->timestamp('next_attempt_at')->nullable()->index();
            $table->unsignedInteger('attempts')->default(0);
            $table->string('last_error_code', 80)->nullable();
            $table->timestamps();
            $table->unique(['provider', 'account_fingerprint', 'provider_tracker_id'], 'subscription_provider_identity');
        });
        DB::table('shipment_trackers')->orderBy('id')->chunkById(100, function ($trackers) {
            foreach ($trackers as $tracker) {
                DB::table('shipment_tracking_subscriptions')->insert([
                    'tracker_id' => $tracker->id, 'active_tracker_id' => $tracker->active_order_id ? $tracker->id : null,
                    'provider' => 'ship24', 'tag' => $tracker->client_tracker_id, 'tracking_number' => $tracker->tracking_number,
                    'carrier_code' => $tracker->carrier_code, 'provider_tracker_id' => $tracker->provider_tracker_id,
                    'account_fingerprint' => $tracker->account_fingerprint, 'registration_payload' => $tracker->registration_payload,
                    'registration_state' => $tracker->registration_state, 'registration_requested_at' => $tracker->registration_requested_at,
                    'registered_at' => $tracker->registered_at, 'last_checked_at' => $tracker->last_checked_at,
                    'last_event_at' => $tracker->last_event_at, 'stop_pending' => $tracker->unsubscribe_pending,
                    'created_at' => $tracker->created_at, 'updated_at' => $tracker->updated_at,
                ]);
            }
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('shipment_tracking_subscriptions');
        Schema::table('shipment_webhook_inbox', function (Blueprint $table) {
            $table->dropIndex(['provider']);
            $table->dropColumn('provider');
        });
        DB::table('shipment_tracking_settings')->where('provider', '17track')->delete();
        Schema::table('shipment_tracking_settings', function (Blueprint $table) {
            $table->dropUnique(['provider']);
            $table->dropColumn(['provider', 'last_test_webhook_at']);
        });
    }
};
