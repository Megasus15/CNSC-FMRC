<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('appointments', function (Blueprint $table) {
            $table->string('appointment_method', 20)->nullable();
            $table->timestamp('appointment_starts_at')->nullable();
            $table->string('meeting_platform', 60)->nullable();
            $table->text('meeting_url')->nullable();
            $table->unsignedInteger('schedule_version')->default(0);
            $table->index(['user_id', 'appointment_date']);
        });
        Schema::create('appointment_schedule_locks', function (Blueprint $table) {
            $table->unsignedInteger('id')->primary();
        });
        DB::table('appointment_schedule_locks')->insert(['id' => 1]);
        Schema::create('appointment_attachments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('appointment_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('path');
            $table->string('mime', 150);
            $table->unsignedBigInteger('size');
            $table->timestamp('created_at');
        });
        Schema::create('appointment_schedule_history', function (Blueprint $table) {
            $table->id();
            $table->foreignId('appointment_id')->constrained()->cascadeOnDelete();
            $table->foreignId('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->date('previous_date');
            $table->string('previous_time', 60);
            $table->date('appointment_date');
            $table->string('appointment_time', 60);
            $table->timestamp('created_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('appointment_schedule_history');
        Schema::dropIfExists('appointment_attachments');
        Schema::dropIfExists('appointment_schedule_locks');
        Schema::table('appointments', function (Blueprint $table) {
            $table->dropIndex(['user_id', 'appointment_date']);
            $table->dropColumn(['appointment_method', 'appointment_starts_at', 'meeting_platform', 'meeting_url', 'schedule_version']);
        });
    }
};
