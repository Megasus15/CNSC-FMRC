<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('product_ratings', function (Blueprint $table) {
            $table->text('admin_reply')->nullable()->after('feedback');
            $table->timestamp('replied_at')->nullable()->after('admin_reply');
        });
    }

    public function down(): void
    {
        Schema::table('product_ratings', function (Blueprint $table) {
            $table->dropColumn(['admin_reply', 'replied_at']);
        });
    }
};
