<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        // Admin Account
        User::factory()->create([
            'name' => 'Admin User',
            'username' => 'admin',
            'email' => 'admin@cnsc.edu.ph',
            'password' => bcrypt('#admin_2026!'),
            'role' => 'admin',
        ]);

        // Staff Account
        User::factory()->create([
            'name' => 'Staff User',
            'username' => 'staff',
            'email' => 'staff@cnsc.edu.ph',
            'password' => bcrypt('staff123!'),
            'role' => 'staff',
        ]);

        // Test Customer Account (for order testing)
        User::factory()->create([
            'name' => 'Test Customer',
            'username' => 'kevinarevaio',
            'email' => 'arevalokevin9696@gmail.com',
            'password' => bcrypt('thekevin146'),
            'role' => 'customer',
        ]);

        // Site Settings & Services
        $this->call(SiteSettingSeeder::class);
    }
}
