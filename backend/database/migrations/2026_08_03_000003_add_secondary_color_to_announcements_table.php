<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('announcements', function (Blueprint $table) {
            $table->string('secondary_color', 20)->nullable()->default('#800000')->after('accent_color');
        });
    }

    public function down(): void
    {
        Schema::table('announcements', function (Blueprint $table) {
            $table->dropColumn('secondary_color');
        });
    }
};
