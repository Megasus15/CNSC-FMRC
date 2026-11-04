<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('services', fn (Blueprint $table) => $table->boolean('accepts_custom_requests')->default(false));
        if (!Schema::hasColumn('report_generations','sales_type')) Schema::table('report_generations', fn (Blueprint $table) => $table->string('sales_type', 15)->default('all'));
        Schema::create('custom_product_requests', function (Blueprint $table) {
            $table->id();
            $table->foreignId('customer_id')->constrained('users');
            $table->uuid('creation_key');
            $table->foreignId('service_id')->nullable()->constrained('services')->nullOnDelete();
            $table->json('service_snapshot')->nullable();
            $table->json('specifications');
            $table->string('status', 40)->default('draft')->index();
            $table->unsignedInteger('revision')->default(0);
            $table->timestamp('submitted_at')->nullable();
            $table->timestamps();
            $table->unique(['customer_id', 'creation_key']);
            $table->index(['customer_id', 'updated_at']);
        });
        Schema::create('custom_product_quotes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('custom_product_request_id')->constrained();
            $table->foreignId('author_id')->constrained('users');
            $table->unsignedInteger('version');
            $table->string('status', 32)->default('draft')->index();
            $table->json('snapshot');
            $table->unsignedBigInteger('unit_price_centavos');
            $table->unsignedBigInteger('subtotal_centavos');
            $table->unsignedBigInteger('shipping_centavos');
            $table->unsignedBigInteger('total_centavos');
            $table->timestamp('sent_at')->nullable();
            $table->timestamp('expires_at')->nullable()->index();
            $table->timestamp('accepted_at')->nullable();
            $table->timestamps();
            $table->unique(['custom_product_request_id', 'version']);
        });
        Schema::create('custom_product_messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('custom_product_request_id')->constrained();
            $table->foreignId('author_id')->constrained('users');
            $table->text('body');
            $table->timestamps();
        });
        Schema::create('custom_product_attachments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('custom_product_request_id')->constrained();
            $table->foreignId('message_id')->nullable()->constrained('custom_product_messages');
            $table->foreignId('author_id')->constrained('users');
            $table->string('name', 200);
            $table->string('path');
            $table->string('mime', 150);
            $table->unsignedBigInteger('size');
            $table->timestamps();
        });
        Schema::create('custom_product_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('custom_product_request_id')->constrained();
            $table->foreignId('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->uuid('request_key');
            $table->string('action', 40);
            $table->string('payload_hash', 64);
            $table->string('description', 1000);
            $table->timestamps();
            $table->unique(['custom_product_request_id', 'request_key'], 'custom_event_idempotency');
        });
        Schema::table('orders', function (Blueprint $table) {
            $table->foreignId('custom_product_quote_id')->nullable()->unique()->constrained('custom_product_quotes');
            $table->string('production_status', 30)->nullable();
            $table->timestamp('production_started_at')->nullable();
            $table->timestamp('production_ready_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropConstrainedForeignId('custom_product_quote_id');
            $table->dropColumn(['production_status', 'production_started_at', 'production_ready_at']);
        });
        foreach (['custom_product_events', 'custom_product_attachments', 'custom_product_messages', 'custom_product_quotes', 'custom_product_requests'] as $table) Schema::dropIfExists($table);
        Schema::table('services', fn (Blueprint $table) => $table->dropColumn('accepts_custom_requests'));
        Schema::table('report_generations', fn (Blueprint $table) => $table->dropColumn('sales_type'));
    }
};
