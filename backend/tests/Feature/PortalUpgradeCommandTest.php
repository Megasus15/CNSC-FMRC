<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class PortalUpgradeCommandTest extends TestCase
{
    use RefreshDatabase;

    public function test_installs_all_four_upgrades_and_can_be_repeated_without_publishing_or_enabling_couriers(): void
    {
        $user = User::factory()->create();
        $paths = glob(database_path('migrations/2026_11_02_00000*.php'));
        foreach (array_reverse($paths) as $path) {
            (require $path)->down();
            DB::table('migrations')->where('migration', basename($path, '.php'))->delete();
        }
        $this->artisan('portal:upgrade', ['--check' => true])->assertFailed();
        $this->assertFalse(Schema::hasTable('shipping_settings'));
        $this->artisan('portal:upgrade', ['--force' => true])->assertSuccessful();
        $this->artisan('portal:upgrade', ['--force' => true])->assertSuccessful();
        $this->artisan('portal:upgrade', ['--check' => true])->assertSuccessful();
        $this->assertDatabaseHas('users', ['id' => $user->id, 'email' => $user->email]);
        $this->assertDatabaseCount('shipping_settings', 1);
        $this->assertDatabaseCount('commerce_policy_settings', 1);
        $this->assertDatabaseCount('appointment_schedule_locks', 1);
        $this->assertDatabaseCount('commerce_policies', 0);
        $this->assertDatabaseCount('courier_shipments', 0);
        $this->assertNull(DB::table('shipping_settings')->value('published_version'));
        $this->assertFalse(config('ninjavan.enabled'));
        $this->getJson('/api/commerce/policy')->assertOk()->assertJsonPath('data', null);
    }

    public function test_check_detects_missing_initial_records_without_recreating_them(): void
    {
        DB::table('appointment_schedule_locks')->delete();
        $this->artisan('portal:upgrade', ['--check' => true])
            ->expectsOutputToContain('appointment_schedule_locks initial record')->assertFailed();
        $this->assertDatabaseCount('appointment_schedule_locks', 0);
    }

    public function test_production_requires_explicit_force_but_allows_read_only_checks(): void
    {
        $this->app['env'] = 'production';
        try {
            $this->artisan('portal:upgrade')->assertFailed();
            $this->artisan('portal:upgrade', ['--check' => true])->assertSuccessful();
        } finally {
            $this->app['env'] = 'testing';
        }
    }
}
