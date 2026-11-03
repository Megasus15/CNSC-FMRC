<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', fn (Blueprint $table) => $table->string('shipment_tracking_mode', 24)->nullable());
        Schema::create('shipment_tracking_settings', function (Blueprint $table) {
            $table->unsignedTinyInteger('id')->primary();
            $table->boolean('enabled')->default(false);
            $table->unsignedInteger('revision')->default(0);
            $table->string('carrier_code', 100)->nullable();
            $table->json('carrier_requirements')->nullable();
            $table->char('account_fingerprint', 64)->nullable();
            $table->timestamp('carrier_verified_at')->nullable();
            $table->timestamp('waybill_verified_at')->nullable();
            $table->unsignedBigInteger('verified_tracker_id')->nullable();
            $table->timestamp('quota_retry_at')->nullable();
            $table->timestamp('last_processed_at')->nullable();
            $table->timestamp('last_webhook_at')->nullable();
            $table->timestamps();
        });
        DB::table('shipment_tracking_settings')->insert(['id' => 1, 'created_at' => now(), 'updated_at' => now()]);
        Schema::create('shipment_trackers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('order_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('active_order_id')->nullable()->unique();
            $table->string('active_waybill', 100)->nullable()->unique();
            $table->uuid('request_key')->unique();
            $table->char('request_hash', 64);
            $table->uuid('client_tracker_id')->unique();
            $table->string('provider_tracker_id', 100)->nullable()->unique();
            $table->char('account_fingerprint', 64)->nullable();
            $table->string('carrier_code', 100)->nullable();
            $table->string('tracking_number', 50);
            $table->json('registration_payload')->nullable();
            $table->string('registration_state', 24)->default('pending');
            $table->string('status', 32)->default('pending');
            $table->string('provider_status', 500)->nullable();
            $table->string('location', 160)->nullable();
            $table->boolean('demo')->default(false);
            $table->boolean('needs_review')->default(false);
            $table->boolean('unsubscribe_pending')->default(false);
            $table->unsignedInteger('version')->default(1);
            $table->unsignedBigInteger('created_by');
            $table->text('correction_reason')->nullable();
            $table->timestamp('handed_over_at');
            $table->decimal('actual_shipping_cost', 12, 2)->nullable();
            $table->timestamp('registered_at')->nullable();
            $table->timestamp('registration_requested_at')->nullable();
            $table->timestamp('last_event_at')->nullable();
            $table->integer('last_event_order')->default(-1);
            $table->json('last_event_time')->nullable();
            $table->timestamp('last_checked_at')->nullable();
            $table->timestamp('last_refresh_requested_at')->nullable();
            $table->timestamp('next_attempt_at')->nullable()->index();
            $table->unsignedInteger('attempts')->default(0);
            $table->string('last_error_code', 80)->nullable();
            $table->timestamps();
        });
        Schema::create('shipment_webhook_inbox', function (Blueprint $table) {
            $table->id();
            $table->char('message_key', 64)->unique();
            $table->char('account_fingerprint', 64);
            $table->json('payload');
            $table->string('state', 20)->default('pending')->index();
            $table->unsignedInteger('attempts')->default(0);
            $table->timestamp('next_attempt_at')->nullable();
            $table->timestamp('processed_at')->nullable();
            $table->timestamps();
        });
        Schema::table('order_tracking_events', function (Blueprint $table) {
            $table->foreignId('shipment_tracker_id')->nullable()->constrained('shipment_trackers')->nullOnDelete();
            $table->string('provider_event_id', 100)->nullable();
            $table->unique(['shipment_tracker_id', 'provider_event_id'], 'tracking_provider_event_unique');
        });
        Schema::create('shipment_notification_outbox', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tracker_id')->constrained('shipment_trackers')->cascadeOnDelete();
            $table->string('milestone', 32);
            $table->unique(['tracker_id', 'milestone']);
            $table->timestamp('sent_at')->nullable();
            $table->timestamp('in_app_sent_at')->nullable();
            $table->unsignedInteger('attempts')->default(0);
            $table->timestamp('next_attempt_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('shipment_notification_outbox');
        Schema::table('order_tracking_events', function (Blueprint $table) {
            $table->dropUnique('tracking_provider_event_unique');
            $table->dropConstrainedForeignId('shipment_tracker_id');
            $table->dropColumn('provider_event_id');
        });
        Schema::dropIfExists('shipment_webhook_inbox');
        Schema::dropIfExists('shipment_trackers');
        Schema::dropIfExists('shipment_tracking_settings');
        Schema::table('orders', fn (Blueprint $table) => $table->dropColumn('shipment_tracking_mode'));
    }
};
