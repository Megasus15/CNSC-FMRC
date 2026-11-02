<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('commerce_policies', function (Blueprint $table) {
            $table->uuid('version')->primary();
            $table->string('title', 180);
            $table->longText('terms_text');
            $table->longText('refund_text');
            $table->unsignedBigInteger('published_by');
            $table->timestamp('published_at');
        });
        Schema::create('commerce_policy_settings', function (Blueprint $table) {
            $table->unsignedTinyInteger('id')->primary();
            $table->unsignedInteger('revision')->default(0);
            $table->json('draft')->nullable();
            $table->uuid('published_version')->nullable();
        });
        DB::table('commerce_policy_settings')->insert(['id' => 1, 'revision' => 0]);
        Schema::table('orders', function (Blueprint $table) {
            $table->uuid('accepted_policy_version')->nullable();
            $table->json('accepted_policy_text')->nullable();
            $table->timestamp('policy_accepted_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('orders', fn (Blueprint $table) => $table->dropColumn(['accepted_policy_version', 'accepted_policy_text', 'policy_accepted_at']));
        Schema::dropIfExists('commerce_policy_settings');
        Schema::dropIfExists('commerce_policies');
    }
};
