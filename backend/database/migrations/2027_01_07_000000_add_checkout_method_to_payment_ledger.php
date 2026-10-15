<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        // Existing attempts were GCash-only. Never reinterpret them when config changes.
        Schema::table('payment_attempts', fn (Blueprint $table) => $table->string('checkout_method', 20)->default('gcash'));
        Schema::table('payment_receipts', fn (Blueprint $table) => $table->string('source_type', 20)->default('gcash'));
    }

    public function down(): void {
        Schema::table('payment_receipts', fn (Blueprint $table) => $table->dropColumn('source_type'));
        Schema::table('payment_attempts', fn (Blueprint $table) => $table->dropColumn('checkout_method'));
    }
};
