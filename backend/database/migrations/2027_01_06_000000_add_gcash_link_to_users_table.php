<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Adds GCash account linking fields to users table so customers can
     * bind their GCash account for 1-click repeat purchases like TikTok Shop.
     */
    public function up(): void
    {
        if (Schema::hasTable('users')) {
            Schema::table('users', function (Blueprint $table) {
                if (!Schema::hasColumn('users', 'gcash_phone')) {
                    $table->string('gcash_phone', 20)->nullable()->after('phone_number')
                        ->comment('Linked GCash mobile number for 1-click checkout');
                }

                if (!Schema::hasColumn('users', 'gcash_linked_at')) {
                    $table->timestamp('gcash_linked_at')->nullable()->after('gcash_phone')
                        ->comment('When the customer authorized and linked their GCash account');
                }
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        if (Schema::hasTable('users')) {
            Schema::table('users', function (Blueprint $table) {
                if (Schema::hasColumn('users', 'gcash_linked_at')) {
                    $table->dropColumn('gcash_linked_at');
                }
                if (Schema::hasColumn('users', 'gcash_phone')) {
                    $table->dropColumn('gcash_phone');
                }
            });
        }
    }
};
