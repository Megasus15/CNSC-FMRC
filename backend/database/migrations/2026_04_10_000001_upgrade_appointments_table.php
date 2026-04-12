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
        Schema::table('appointments', function (Blueprint $table) {
            if (!Schema::hasColumn('appointments', 'reference_no')) {
                $table->string('reference_no')->nullable()->unique()->after('id');
            }
            if (!Schema::hasColumn('appointments', 'user_id')) {
                $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete()->after('reference_no');
            }
            if (!Schema::hasColumn('appointments', 'first_name')) {
                $table->string('first_name')->nullable()->after('user_id');
            }
            if (!Schema::hasColumn('appointments', 'last_name')) {
                $table->string('last_name')->nullable()->after('first_name');
            }
            if (!Schema::hasColumn('appointments', 'middle_initial')) {
                $table->string('middle_initial', 5)->nullable()->after('last_name');
            }
            if (!Schema::hasColumn('appointments', 'contact_number')) {
                $table->string('contact_number', 20)->nullable()->after('middle_initial');
            }
            if (!Schema::hasColumn('appointments', 'email')) {
                $table->string('email')->nullable()->after('contact_number');
            }
            if (!Schema::hasColumn('appointments', 'country')) {
                $table->string('country')->default('Philippines')->after('email');
            }
            if (!Schema::hasColumn('appointments', 'region')) {
                $table->string('region')->nullable()->after('country');
            }
            if (!Schema::hasColumn('appointments', 'province')) {
                $table->string('province')->nullable()->after('region');
            }
            if (!Schema::hasColumn('appointments', 'municipality')) {
                $table->string('municipality')->nullable()->after('province');
            }
            if (!Schema::hasColumn('appointments', 'barangay')) {
                $table->string('barangay')->nullable()->after('municipality');
            }
            if (!Schema::hasColumn('appointments', 'intl_address')) {
                $table->text('intl_address')->nullable()->after('barangay');
            }
            if (!Schema::hasColumn('appointments', 'full_address')) {
                $table->text('full_address')->nullable()->after('intl_address');
            }
            if (!Schema::hasColumn('appointments', 'client_type')) {
                $table->string('client_type')->nullable()->after('full_address');
            }
            if (!Schema::hasColumn('appointments', 'purpose')) {
                $table->string('purpose')->nullable()->after('client_type');
            }
            if (!Schema::hasColumn('appointments', 'additional_notes')) {
                $table->text('additional_notes')->nullable()->after('purpose');
            }
            if (!Schema::hasColumn('appointments', 'appointment_date')) {
                $table->date('appointment_date')->nullable()->after('additional_notes');
            }
            if (!Schema::hasColumn('appointments', 'appointment_time')) {
                $table->string('appointment_time', 60)->nullable()->after('appointment_date');
            }
            if (!Schema::hasColumn('appointments', 'attachment_name')) {
                $table->string('attachment_name')->nullable()->after('appointment_time');
            }
            if (!Schema::hasColumn('appointments', 'attachment_path')) {
                $table->string('attachment_path')->nullable()->after('attachment_name');
            }
            if (!Schema::hasColumn('appointments', 'status')) {
                $table->string('status', 40)->default('Scheduled')->after('attachment_path');
            }
            if (!Schema::hasColumn('appointments', 'qr_payload')) {
                $table->text('qr_payload')->nullable()->after('status');
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('appointments', function (Blueprint $table) {
            if (Schema::hasColumn('appointments', 'user_id')) {
                $table->dropConstrainedForeignId('user_id');
            }

            $columns = [
                'reference_no',
                'first_name',
                'last_name',
                'middle_initial',
                'contact_number',
                'email',
                'country',
                'region',
                'province',
                'municipality',
                'barangay',
                'intl_address',
                'full_address',
                'client_type',
                'purpose',
                'additional_notes',
                'appointment_date',
                'appointment_time',
                'attachment_name',
                'attachment_path',
                'status',
                'qr_payload',
            ];

            foreach ($columns as $column) {
                if (Schema::hasColumn('appointments', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
