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
        if (Schema::hasTable('products')) {
            Schema::table('products', function (Blueprint $table) {
                if (!Schema::hasColumn('products', 'sku')) {
                    $table->string('sku', 80)->nullable()->unique()->after('id');
                }
                if (!Schema::hasColumn('products', 'name')) {
                    $table->string('name', 180)->nullable()->after('sku');
                }
                if (!Schema::hasColumn('products', 'description')) {
                    $table->text('description')->nullable()->after('name');
                }
                if (!Schema::hasColumn('products', 'image_url')) {
                    $table->string('image_url', 600)->nullable()->after('description');
                }
                if (!Schema::hasColumn('products', 'unit_price')) {
                    $table->decimal('unit_price', 12, 2)->default(0)->after('image_url');
                }
                if (!Schema::hasColumn('products', 'is_active')) {
                    $table->boolean('is_active')->default(true)->after('unit_price');
                }
            });
        }

        if (Schema::hasTable('orders')) {
            Schema::table('orders', function (Blueprint $table) {
                if (!Schema::hasColumn('orders', 'order_no')) {
                    $table->string('order_no', 40)->nullable()->unique()->after('id');
                }
                if (!Schema::hasColumn('orders', 'customer_id')) {
                    $table->foreignId('customer_id')->nullable()->after('order_no')->constrained('users')->nullOnDelete();
                }
                if (!Schema::hasColumn('orders', 'customer_name')) {
                    $table->string('customer_name', 160)->nullable()->after('customer_id');
                }
                if (!Schema::hasColumn('orders', 'customer_contact')) {
                    $table->string('customer_contact', 180)->nullable()->after('customer_name');
                }
                if (!Schema::hasColumn('orders', 'quantity')) {
                    $table->unsignedInteger('quantity')->default(1)->after('customer_contact');
                }
                if (!Schema::hasColumn('orders', 'subtotal')) {
                    $table->decimal('subtotal', 12, 2)->default(0)->after('quantity');
                }
                if (!Schema::hasColumn('orders', 'total')) {
                    $table->decimal('total', 12, 2)->default(0)->after('subtotal');
                }
                if (!Schema::hasColumn('orders', 'payment_method')) {
                    $table->string('payment_method', 30)->nullable()->after('total');
                }
                if (!Schema::hasColumn('orders', 'payment_reference')) {
                    $table->string('payment_reference', 180)->nullable()->after('payment_method');
                }
                if (!Schema::hasColumn('orders', 'lifecycle_status')) {
                    $table->enum('lifecycle_status', ['incoming', 'pending', 'rejected', 'completed'])->default('incoming')->after('payment_reference');
                }
                if (!Schema::hasColumn('orders', 'customer_stage')) {
                    $table->enum('customer_stage', ['to_pay', 'to_ship', 'to_receive', 'completed'])->default('to_pay')->after('lifecycle_status');
                }
                if (!Schema::hasColumn('orders', 'notes')) {
                    $table->text('notes')->nullable()->after('customer_stage');
                }
                if (!Schema::hasColumn('orders', 'courier_name')) {
                    $table->string('courier_name', 120)->nullable()->after('notes');
                }
                if (!Schema::hasColumn('orders', 'courier_tracking_no')) {
                    $table->string('courier_tracking_no', 140)->nullable()->after('courier_name');
                }
                if (!Schema::hasColumn('orders', 'location_name')) {
                    $table->string('location_name', 160)->nullable()->after('courier_tracking_no');
                }
                if (!Schema::hasColumn('orders', 'last_known_lat')) {
                    $table->decimal('last_known_lat', 10, 7)->nullable()->after('location_name');
                }
                if (!Schema::hasColumn('orders', 'last_known_lng')) {
                    $table->decimal('last_known_lng', 10, 7)->nullable()->after('last_known_lat');
                }
                if (!Schema::hasColumn('orders', 'approved_at')) {
                    $table->timestamp('approved_at')->nullable()->after('last_known_lng');
                }
                if (!Schema::hasColumn('orders', 'rejected_at')) {
                    $table->timestamp('rejected_at')->nullable()->after('approved_at');
                }
                if (!Schema::hasColumn('orders', 'completed_at')) {
                    $table->timestamp('completed_at')->nullable()->after('rejected_at');
                }
            });
        }

        if (Schema::hasTable('order_items')) {
            Schema::table('order_items', function (Blueprint $table) {
                if (!Schema::hasColumn('order_items', 'order_id')) {
                    $table->foreignId('order_id')->nullable()->after('id')->constrained('orders')->cascadeOnDelete();
                }
                if (!Schema::hasColumn('order_items', 'product_id')) {
                    $table->foreignId('product_id')->nullable()->after('order_id')->constrained('products')->nullOnDelete();
                }
                if (!Schema::hasColumn('order_items', 'product_name')) {
                    $table->string('product_name', 180)->nullable()->after('product_id');
                }
                if (!Schema::hasColumn('order_items', 'product_image')) {
                    $table->string('product_image', 600)->nullable()->after('product_name');
                }
                if (!Schema::hasColumn('order_items', 'unit_price')) {
                    $table->decimal('unit_price', 12, 2)->default(0)->after('product_image');
                }
                if (!Schema::hasColumn('order_items', 'quantity')) {
                    $table->unsignedInteger('quantity')->default(1)->after('unit_price');
                }
                if (!Schema::hasColumn('order_items', 'line_total')) {
                    $table->decimal('line_total', 12, 2)->default(0)->after('quantity');
                }
            });
        }

        if (Schema::hasTable('payments')) {
            Schema::table('payments', function (Blueprint $table) {
                if (!Schema::hasColumn('payments', 'order_id')) {
                    $table->foreignId('order_id')->nullable()->after('id')->constrained('orders')->cascadeOnDelete();
                }
                if (!Schema::hasColumn('payments', 'payment_no')) {
                    $table->string('payment_no', 40)->nullable()->unique()->after('order_id');
                }
                if (!Schema::hasColumn('payments', 'method')) {
                    $table->string('method', 30)->nullable()->after('payment_no');
                }
                if (!Schema::hasColumn('payments', 'reference')) {
                    $table->string('reference', 180)->nullable()->after('method');
                }
                if (!Schema::hasColumn('payments', 'amount')) {
                    $table->decimal('amount', 12, 2)->default(0)->after('reference');
                }
                if (!Schema::hasColumn('payments', 'status')) {
                    $table->enum('status', ['paid', 'pending', 'refunded'])->default('pending')->after('amount');
                }
                if (!Schema::hasColumn('payments', 'paid_at')) {
                    $table->timestamp('paid_at')->nullable()->after('status');
                }
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        // Intentionally left as a no-op to avoid destructive rollback of live commerce data.
    }
};
