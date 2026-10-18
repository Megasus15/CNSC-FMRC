<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        // Hostinger may have received the equivalent phpMyAdmin SQL patch first.
        if (!Schema::hasColumn('payments', 'online_refund_archived_at')) {
            Schema::table('payments', fn (Blueprint $table) => $table->timestamp('online_refund_archived_at')->nullable()->index());
        }
        if (!Schema::hasColumn('payments', 'online_refund_archived_by')) {
            Schema::table('payments', fn (Blueprint $table) => $table->foreignId('online_refund_archived_by')->nullable()->constrained('users')->nullOnDelete());
        }
    }

    public function down(): void
    {
        Schema::table('payments', function (Blueprint $table) {
            $table->dropConstrainedForeignId('online_refund_archived_by');
            $table->dropColumn('online_refund_archived_at');
        });
    }
};
