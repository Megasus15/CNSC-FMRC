<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('appointments', function (Blueprint $table) {
            $table->timestamp('consultation_completed_at')->nullable();
            $table->string('archived_from_status', 30)->nullable();
        });
        // Historical updated_at values also include link edits and archiving.
        // Leave unknown completion times empty instead of inventing evidence.
    }

    public function down(): void
    {
        Schema::table('appointments', fn (Blueprint $table) => $table->dropColumn(['consultation_completed_at', 'archived_from_status']));
    }
};
