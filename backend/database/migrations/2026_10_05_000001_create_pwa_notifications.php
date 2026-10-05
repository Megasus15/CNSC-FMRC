<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pwa_subscriptions', function (Blueprint $table) {
            $table->id();
            $table->string('app', 16);
            $table->foreignId('user_id')->nullable()->constrained()->cascadeOnDelete();
            $table->string('role', 16)->nullable();
            $table->char('endpoint_hash', 64)->unique();
            $table->text('endpoint');
            $table->text('p256dh');
            $table->text('auth');
            $table->char('credential_hash', 64);
            $table->boolean('public_alerts')->default(false);
            $table->boolean('account_alerts')->default(false);
            $table->timestamp('last_seen_at');
            $table->timestamps();
            $table->index(['app', 'user_id']);
        });
        Schema::create('customer_notifications', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained()->cascadeOnDelete();
            $table->string('type', 32);
            $table->string('title');
            $table->text('message');
            $table->string('target', 255);
            $table->string('event_key', 191)->unique();
            $table->timestamp('published_at')->index();
            $table->timestamps();
            $table->index(['user_id', 'id']);
        });
        Schema::create('customer_notification_reads', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('notification_id')->constrained('customer_notifications')->cascadeOnDelete();
            $table->timestamp('read_at');
            $table->unique(['user_id', 'notification_id']);
        });
        Schema::create('pwa_delivery_outbox', function (Blueprint $table) {
            $table->id();
            $table->foreignId('subscription_id')->constrained('pwa_subscriptions')->cascadeOnDelete();
            $table->string('event_key', 191);
            $table->string('audience', 32);
            $table->unsignedBigInteger('audience_user_id')->nullable();
            $table->json('payload');
            $table->unsignedSmallInteger('attempts')->default(0);
            $table->timestamp('available_at')->index();
            $table->timestamp('claimed_at')->nullable();
            $table->timestamp('delivered_at')->nullable();
            $table->timestamp('discarded_at')->nullable();
            $table->string('last_error', 80)->nullable();
            $table->timestamps();
            $table->unique(['subscription_id', 'event_key']);
        });
        Schema::create('pwa_runtime', function (Blueprint $table) {
            $table->string('key')->primary();
            $table->timestamp('value');
        });
    }

    public function down(): void
    {
        foreach (['pwa_runtime', 'pwa_delivery_outbox', 'customer_notification_reads', 'customer_notifications', 'pwa_subscriptions'] as $table) {
            Schema::dropIfExists($table);
        }
    }
};
