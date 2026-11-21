<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('order_payment_receipts', function (Blueprint $table) {
            $table->id();
            // Retain the issued record even if the order is later removed from the portal.
            $table->unsignedBigInteger('order_id')->index();
            $table->unsignedBigInteger('customer_id');
            $table->unsignedBigInteger('payment_id')->index();
            $table->string('confirmation_key', 150)->unique();
            $table->json('snapshot');
            $table->timestamp('pdf_ready_at')->nullable();
            $table->timestamp('voided_at')->nullable();
            $table->string('delivery_state', 24)->default('pending');
            $table->unsignedSmallInteger('attempts')->default(0);
            $table->timestamp('next_attempt_at')->nullable();
            $table->timestamp('sent_at')->nullable();
            $table->timestamps();
            $table->index(['delivery_state', 'next_attempt_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('order_payment_receipts');
    }
};
