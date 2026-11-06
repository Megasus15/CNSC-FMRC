<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('services', fn (Blueprint $t) => $t->boolean('accepts_appointment_products')->default(false));
        Schema::create('appointment_product_jobs', function (Blueprint $t) {
            $t->id();
            $t->foreignId('customer_id')->constrained('users')->restrictOnDelete();
            $t->foreignId('appointment_id')->nullable()->unique()->constrained('appointments')->restrictOnDelete();
            $t->foreignId('service_id')->nullable()->constrained('services')->nullOnDelete();
            $t->string('service_name');
            $t->string('request_key', 80);
            $t->string('state', 30)->default('draft')->index();
            $t->unsignedInteger('revision')->default(0);
            $t->json('requirements');
            $t->json('booking')->nullable();
            $t->foreignId('discussed_appointment_id')->nullable()->constrained('appointments')->restrictOnDelete();
            $t->timestamp('discussed_at')->nullable();
            $t->foreignId('discussed_by')->nullable()->constrained('users')->nullOnDelete();
            $t->text('outcome_note')->nullable();
            $t->timestamps();
            $t->unique(['customer_id', 'request_key']);
        });
        Schema::table('appointments', fn (Blueprint $t) => $t->foreignId('product_job_id')->nullable()->constrained('appointment_product_jobs')->restrictOnDelete());
        Schema::create('appointment_product_quotes', function (Blueprint $t) {
            $t->id();
            $t->foreignId('job_id')->constrained('appointment_product_jobs')->restrictOnDelete();
            $t->unsignedInteger('version');
            $t->string('state', 25)->default('sent')->index();
            $t->string('request_key', 80);
            $t->unique(['job_id', 'request_key']);
            $t->json('agreement');
            $t->unsignedBigInteger('total_centavos');
            $t->timestamp('sent_at');
            $t->timestamp('expires_at')->index();
            $t->timestamp('accepted_at')->nullable();
            $t->foreignId('created_by')->constrained('users')->restrictOnDelete();
            $t->timestamps();
            $t->unique(['job_id', 'version']);
        });
        Schema::create('appointment_product_messages', function (Blueprint $t) {
            $t->id();
            $t->foreignId('job_id')->constrained('appointment_product_jobs')->restrictOnDelete();
            $t->foreignId('sender_id')->constrained('users')->restrictOnDelete();
            $t->string('sender_name');
            $t->string('sender_role', 20);
            $t->text('body');
            $t->string('request_key', 80);
            $t->timestamps();
            $t->unique(['job_id', 'sender_id', 'request_key']);
        });
        Schema::create('appointment_product_files', function (Blueprint $t) {
            $t->id();
            $t->foreignId('job_id')->constrained('appointment_product_jobs')->restrictOnDelete();
            $t->foreignId('message_id')->nullable()->constrained('appointment_product_messages')->restrictOnDelete();
            $t->string('name');
            $t->string('path');
            $t->string('mime', 150);
            $t->unsignedBigInteger('size');
            $t->timestamp('created_at');
        });
        Schema::create('appointment_product_events', function (Blueprint $t) {
            $t->id();
            $t->foreignId('job_id')->constrained('appointment_product_jobs')->restrictOnDelete();
            $t->foreignId('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $t->string('action', 60);
            $t->text('description');
            $t->json('metadata')->nullable();
            $t->timestamp('created_at');
        });
        Schema::create('appointment_product_claims', function (Blueprint $t) {
            $t->id();
            $t->foreignId('appointment_id')->constrained('appointments')->cascadeOnDelete();
            $t->string('token_hash', 64)->unique();
            $t->timestamp('expires_at');
            $t->timestamp('used_at')->nullable();
            $t->timestamp('created_at');
        });
        Schema::table('orders', function (Blueprint $t) {
            $t->foreignId('appointment_product_job_id')->nullable()->constrained('appointment_product_jobs')->restrictOnDelete();
            $t->foreignId('appointment_product_quote_id')->nullable()->unique()->constrained('appointment_product_quotes')->restrictOnDelete();
            $t->string('appointment_production_status', 30)->nullable();
            $t->unsignedInteger('production_revision')->default(0);
            $t->string('collection_hold', 40)->nullable();
        });
        Schema::create('appointment_cash_entries', function (Blueprint $t) {
            $t->id();
            $t->foreignId('payment_id')->constrained('payments')->restrictOnDelete();
            $t->string('kind', 20);
            $t->unsignedBigInteger('amount_centavos');
            $t->string('receipt_reference', 100);
            $t->string('request_key', 80)->unique();
            $t->foreignId('actor_id')->constrained('users')->restrictOnDelete();
            $t->text('note')->nullable();
            $t->timestamp('confirmed_at');
            $t->timestamp('created_at');
            $t->unique(['kind', 'receipt_reference']);
        });
    }

    public function down(): void
    {
        // Agreements and money cannot be safely erased by rolling back a release.
        throw new RuntimeException('Disable APPOINTMENT_PRODUCTS_ENABLED to roll back the feature. Retain its agreements and financial history.');
    }
};
