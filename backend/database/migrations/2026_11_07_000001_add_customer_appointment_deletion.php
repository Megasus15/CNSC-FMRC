<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('appointments', 'customer_deleted_at')) {
            Schema::table('appointments', fn (Blueprint $table) => $table->timestamp('customer_deleted_at')->nullable());
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('appointments', 'customer_deleted_at')) {
            Schema::table('appointments', fn (Blueprint $table) => $table->dropColumn('customer_deleted_at'));
        }
    }
};
