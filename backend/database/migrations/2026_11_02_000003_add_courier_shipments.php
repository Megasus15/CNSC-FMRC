<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('courier_shipments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('order_id')->constrained('orders')->cascadeOnDelete();
            $table->unsignedBigInteger('active_order_id')->nullable()->unique();
            $table->string('environment', 20);
            $table->string('reference', 80)->unique();
            $table->string('requested_tracking_number', 40)->unique();
            $table->string('tracking_number', 100)->nullable();
            $table->unique(['environment', 'tracking_number']);
            $table->string('status', 40);
            $table->string('provider_status', 160)->nullable();
            $table->json('parcel');
            $table->json('booking_payload');
            $table->char('payload_hash', 64);
            $table->decimal('actual_booking_cost', 12, 2)->nullable();
            $table->unsignedBigInteger('created_by');
            $table->timestamp('booked_at')->nullable();
            $table->timestamp('last_event_at')->nullable();
            $table->string('last_error_code', 80)->nullable();
            $table->timestamps();
        });
        Schema::create('shipment_booking_attempts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('shipment_id')->constrained('courier_shipments')->cascadeOnDelete();
            $table->uuid('request_key')->unique();
            $table->unsignedBigInteger('actor_id')->nullable();
            $table->string('action', 16);
            $table->string('status', 24);
            $table->char('payload_hash', 64);
            $table->unsignedSmallInteger('http_status')->nullable();
            $table->string('provider_code', 80)->nullable();
            $table->timestamps();
        });
        Schema::create('courier_webhook_events', function (Blueprint $table) {
            $table->id();
            $table->char('event_key', 64)->unique();
            $table->foreignId('shipment_id')->nullable()->constrained('courier_shipments')->nullOnDelete();
            $table->string('tracking_number', 100);
            $table->string('reference', 100)->nullable();
            $table->string('status', 160);
            $table->string('source', 20)->default('webhook');
            $table->unsignedBigInteger('created_by')->nullable();
            $table->string('location', 200)->nullable();
            $table->boolean('return_trip')->default(false);
            $table->timestamp('occurred_at');
            $table->timestamp('received_at');
        });
        Schema::table('orders', fn (Blueprint $table) => $table->unsignedBigInteger('courier_history_version')->default(0));
    }

    public function down(): void
    {
        Schema::table('orders', fn (Blueprint $table) => $table->dropColumn('courier_history_version'));
        Schema::dropIfExists('courier_webhook_events');
        Schema::dropIfExists('shipment_booking_attempts');
        Schema::dropIfExists('courier_shipments');
    }
};
