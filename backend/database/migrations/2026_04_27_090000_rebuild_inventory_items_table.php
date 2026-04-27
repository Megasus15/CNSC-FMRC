<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::dropIfExists('inventory_items');

        Schema::create('inventory_items', function (Blueprint $table) {
            $table->id();
            $table->string('category', 100);  // Consumable Materials, Office Supplies, Inventory Tools, Electronics and Electrical Equipments
            $table->string('item_name', 255);
            $table->string('description', 500)->nullable();
            $table->string('unit', 50)->default('pcs');
            $table->integer('last_invent')->default(0);
            $table->integer('on_hand')->default(0);
            $table->string('status', 40)->default('Good'); // Good, Low Stock, Out of Stock
            $table->string('remarks', 100)->nullable(); // Recently Acquired, Recently Included in the Inventory, Need to Restock
            $table->unsignedBigInteger('created_by_user_id')->nullable();
            $table->timestamps();

            $table->foreign('created_by_user_id')->references('id')->on('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_items');
    }
};
