<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Add the whole-site and standalone About Us gates to existing installations.
 * The original maintenance migration seeds fresh installations first; this one
 * leaves any scope already configured by an administrator untouched.
 */
return new class extends Migration
{
    private const DEFAULTS = [
        'site_portal' => 'The FMRC website is temporarily unavailable. Please check back soon.',
        'page_about' => 'The About Us page is under maintenance. Please check back shortly.',
    ];

    public function up(): void
    {
        if (! Schema::hasTable('maintenance_settings')) {
            return;
        }

        $now = now();
        foreach (self::DEFAULTS as $scope => $message) {
            if (DB::table('maintenance_settings')->where('scope', $scope)->exists()) {
                continue;
            }

            DB::table('maintenance_settings')->insert([
                'scope' => $scope,
                'is_active' => false,
                'message' => $message,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('maintenance_settings')) {
            DB::table('maintenance_settings')->whereIn('scope', array_keys(self::DEFAULTS))->delete();
        }
    }
};
