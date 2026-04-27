<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('walk_in_orders', function (Blueprint $table) {
            $table->id();
            $table->string('order_no', 80)->unique();
            $table->string('order_item', 180);
            $table->dateTime('order_date');
            $table->string('customer', 160);
            $table->string('payment_method', 30);
            $table->decimal('total', 10, 2)->default(0);
            $table->string('status', 40)->default('Pending');
            $table->foreignId('created_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('walk_in_orders');
    }
};
