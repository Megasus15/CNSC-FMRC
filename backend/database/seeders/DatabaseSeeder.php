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
            'password' => bcrypt('admin123'),
            'role' => 'admin',
        ]);

        // Cashier Account
        User::factory()->create([
            'name' => 'Cashier User',
            'username' => 'cashier',
            'email' => 'cashier@cnsc.edu.ph',
            'password' => bcrypt('cashier123'),
            'role' => 'cashier',
        ]);
    }
}
