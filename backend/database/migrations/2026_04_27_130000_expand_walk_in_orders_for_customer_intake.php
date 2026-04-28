<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        if (!Schema::hasTable('walk_in_orders')) {
            return;
        }

        Schema::table('walk_in_orders', function (Blueprint $table) {
            if (!Schema::hasColumn('walk_in_orders', 'customer_name')) {
                $table->string('customer_name', 160)->nullable()->after('order_no');
            }
            if (!Schema::hasColumn('walk_in_orders', 'address')) {
                $table->string('address', 255)->nullable()->after('customer_name');
            }
            if (!Schema::hasColumn('walk_in_orders', 'contact_number')) {
                $table->string('contact_number', 40)->nullable()->after('address');
            }
            if (!Schema::hasColumn('walk_in_orders', 'client_type')) {
                $table->string('client_type', 80)->nullable()->after('contact_number');
            }
            if (!Schema::hasColumn('walk_in_orders', 'client_type_other')) {
                $table->string('client_type_other', 180)->nullable()->after('client_type');
            }
            if (!Schema::hasColumn('walk_in_orders', 'agency_organization')) {
                $table->string('agency_organization', 180)->nullable()->after('client_type_other');
            }
            if (!Schema::hasColumn('walk_in_orders', 'project_description')) {
                $table->string('project_description', 180)->nullable()->after('agency_organization');
            }
            if (!Schema::hasColumn('walk_in_orders', 'project_description_other')) {
                $table->string('project_description_other', 180)->nullable()->after('project_description');
            }
            if (!Schema::hasColumn('walk_in_orders', 'item_detail')) {
                $table->string('item_detail', 300)->nullable()->after('project_description_other');
            }
            if (!Schema::hasColumn('walk_in_orders', 'unit')) {
                $table->string('unit', 50)->nullable()->after('item_detail');
            }
            if (!Schema::hasColumn('walk_in_orders', 'subtotal_cost')) {
                $table->decimal('subtotal_cost', 12, 2)->default(0)->after('unit');
            }
        });

        DB::table('walk_in_orders')
            ->whereNull('customer_name')
            ->update([
                'customer_name' => DB::raw("COALESCE(customer, 'Walk-in Customer')"),
                'item_detail' => DB::raw("COALESCE(order_item, '')"),
                'subtotal_cost' => DB::raw("COALESCE(total, 0)"),
                'payment_method' => 'WALKIN VIA CASHIER',
            ]);
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        if (!Schema::hasTable('walk_in_orders')) {
            return;
        }

        Schema::table('walk_in_orders', function (Blueprint $table) {
            if (Schema::hasColumn('walk_in_orders', 'subtotal_cost')) {
                $table->dropColumn('subtotal_cost');
            }
            if (Schema::hasColumn('walk_in_orders', 'unit')) {
                $table->dropColumn('unit');
            }
            if (Schema::hasColumn('walk_in_orders', 'item_detail')) {
                $table->dropColumn('item_detail');
            }
            if (Schema::hasColumn('walk_in_orders', 'project_description_other')) {
                $table->dropColumn('project_description_other');
            }
            if (Schema::hasColumn('walk_in_orders', 'project_description')) {
                $table->dropColumn('project_description');
            }
            if (Schema::hasColumn('walk_in_orders', 'agency_organization')) {
                $table->dropColumn('agency_organization');
            }
            if (Schema::hasColumn('walk_in_orders', 'client_type_other')) {
                $table->dropColumn('client_type_other');
            }
            if (Schema::hasColumn('walk_in_orders', 'client_type')) {
                $table->dropColumn('client_type');
            }
            if (Schema::hasColumn('walk_in_orders', 'contact_number')) {
                $table->dropColumn('contact_number');
            }
            if (Schema::hasColumn('walk_in_orders', 'address')) {
                $table->dropColumn('address');
            }
            if (Schema::hasColumn('walk_in_orders', 'customer_name')) {
                $table->dropColumn('customer_name');
            }
        });
    }
};
