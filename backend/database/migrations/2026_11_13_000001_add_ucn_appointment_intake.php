<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('appointments', fn (Blueprint $table) => $table->string('university_department', 20)->nullable());
        foreach (['appointment_attachments', 'appointment_product_files'] as $name) {
            Schema::table($name, fn (Blueprint $table) => $table->string('kind', 30)->default('design'));
        }
    }

    public function down(): void
    {
        foreach (['appointment_attachments', 'appointment_product_files'] as $name) {
            Schema::table($name, fn (Blueprint $table) => $table->dropColumn('kind'));
        }
        Schema::table('appointments', fn (Blueprint $table) => $table->dropColumn('university_department'));
    }
};
