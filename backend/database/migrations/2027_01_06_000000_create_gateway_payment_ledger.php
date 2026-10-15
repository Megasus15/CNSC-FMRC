<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        Schema::table('payments', function (Blueprint $t) { $t->string('gateway')->nullable()->index(); });
        Schema::create('payment_submissions', function (Blueprint $t) {
            $t->id(); $t->foreignId('customer_id')->constrained('users'); $t->string('request_key', 80);
            $t->string('payload_hash', 64); $t->foreignId('order_id')->constrained(); $t->timestamps();
            $t->unique(['customer_id','request_key']);
        });
        Schema::create('payment_attempts', function (Blueprint $t) {
            $t->id(); $t->foreignId('payment_id')->constrained(); $t->uuid('token')->unique();
            $t->string('checkout_id')->nullable()->unique(); $t->string('provider_payment_id')->nullable()->unique();
            $t->text('checkout_url')->nullable(); $t->string('api_version')->default('v2');
            $t->boolean('livemode'); $t->unsignedBigInteger('amount_centavos'); $t->string('currency',3)->default('PHP');
            $t->string('app_context')->default(''); $t->string('status')->default('creating')->index(); $t->string('exception')->nullable();
            $t->timestamp('expires_at')->nullable(); $t->timestamp('confirmed_at')->nullable();
            $t->timestamp('checked_at')->nullable(); $t->timestamps();
        });
        Schema::create('payment_receipts', function (Blueprint $t) {
            $t->id(); $t->foreignId('payment_id')->constrained(); $t->foreignId('attempt_id')->constrained('payment_attempts');
            $t->string('provider_payment_id')->unique(); $t->unsignedBigInteger('amount_centavos'); $t->boolean('livemode');
            $t->timestamp('confirmed_at'); $t->timestamps();
        });
        Schema::create('payment_webhook_events', function (Blueprint $t) {
            $t->id(); $t->string('event_key', 100)->unique(); $t->string('event_type');
            $t->string('resource_id')->nullable(); $t->string('attempt_token')->nullable(); $t->boolean('livemode');
            $t->string('status')->default('pending')->index(); $t->unsignedInteger('tries')->default(0);
            $t->timestamp('processed_at')->nullable(); $t->timestamps();
        });
        Schema::create('payment_refunds', function (Blueprint $t) {
            $t->id(); $t->foreignId('payment_id')->constrained(); $t->uuid('token')->unique();
            $t->string('provider_payment_id'); $t->foreignId('order_return_id')->nullable()->constrained('order_returns'); $t->timestamp('checked_at')->nullable();
            $t->foreignId('requested_by')->constrained('users'); $t->foreignId('approved_by')->nullable()->constrained('users');
            $t->unsignedBigInteger('amount_centavos'); $t->string('reason',500); $t->boolean('livemode');
            $t->string('provider_refund_id')->nullable()->unique(); $t->string('status')->default('requested')->index();
            $t->timestamp('confirmed_at')->nullable(); $t->timestamps();
        });
    }
    public function down(): void {
        Schema::dropIfExists('payment_refunds'); Schema::dropIfExists('payment_webhook_events');
        Schema::dropIfExists('payment_receipts'); Schema::dropIfExists('payment_attempts'); Schema::dropIfExists('payment_submissions');
        Schema::table('payments', fn(Blueprint $t) => $t->dropColumn('gateway'));
    }
};
