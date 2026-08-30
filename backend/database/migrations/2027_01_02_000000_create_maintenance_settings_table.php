<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Maintenance Mode (STEP 11, Part B).
 *
 * One row per gate-able scope: two customer-account gates, five customer pages
 * and four home-page sections. `scope` is a plain string, not an enum, on
 * purpose -- an enum column has to be widened with a driver-specific ALTER, and
 * that is exactly the pattern that has already left the SQLite test schema
 * behind twice in this project.
 */
return new class extends Migration
{
    /**
     * scope => default message. Every message is <= 75 characters, which is the
     * same ceiling the admin UI and the API validator enforce.
     */
    private const DEFAULTS = [
        'customer_register' => 'Account registration is temporarily closed for scheduled maintenance.',
        'customer_login'    => 'Customer sign-in is temporarily unavailable while we perform maintenance.',
        'page_home'         => 'Our home page is briefly offline for maintenance. Please check back soon.',
        'page_services'     => 'The Services page is under maintenance. It will be back shortly.',
        'page_products'     => 'The Products page is under maintenance. Orders will reopen shortly.',
        'page_contact'      => 'Our contact form is under maintenance. Please reach us again later.',
        'page_appointment'  => 'Appointment booking is paused for maintenance. Please try again later.',
        'home_about'        => 'The About Us section is being updated. Please check back shortly.',
        'home_mission'      => 'The Mission section is being updated. Please check back shortly.',
        'home_vision'       => 'The Vision section is being updated. Please check back shortly.',
        'home_offer'        => 'What We Offer is being updated. Please check back shortly.',
    ];

    public function up(): void
    {
        if (!Schema::hasTable('maintenance_settings')) {
            Schema::create('maintenance_settings', function (Blueprint $table) {
                $table->id();
                $table->string('scope', 40)->unique();
                $table->boolean('is_active')->default(false);
                $table->string('message', 75)->nullable();
                $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamps();
            });
        }

        // Seeded here rather than in DatabaseSeeder so the rows arrive with the
        // table on every environment. Each row is inserted only when its scope
        // is missing, which makes a re-run idempotent AND leaves a message the
        // admin has since customised (or a scope they have switched on) alone.
        $now = now();

        foreach (self::DEFAULTS as $scope => $message) {
            $exists = DB::table('maintenance_settings')->where('scope', $scope)->exists();

            if ($exists) {
                continue;
            }

            DB::table('maintenance_settings')->insert([
                'scope'      => $scope,
                'is_active'  => false,
                'message'    => $message,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('maintenance_settings');
    }
};
