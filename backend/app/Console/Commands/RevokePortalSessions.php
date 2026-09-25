<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Laravel\Sanctum\PersonalAccessToken;

class RevokePortalSessions extends Command
{
    protected $signature = 'admin:revoke-sessions {--force : Revoke existing Admin and Staff API tokens}';

    protected $description = 'Show or revoke Admin and Staff API sessions for a security-policy rollout';

    public function handle(): int
    {
        $query = PersonalAccessToken::query()
            ->where('tokenable_type', (new User)->getMorphClass())
            ->whereIn('tokenable_id', User::query()->whereIn('role', ['admin', 'staff'])->select('id'));

        $count = (clone $query)->count();
        if (! $this->option('force')) {
            $this->line("{$count} Admin/Staff session(s) would be revoked. Run with --force during the release to apply.");

            return self::SUCCESS;
        }

        $revoked = $query->delete();
        $this->info("{$revoked} Admin/Staff session(s) revoked. Customer sessions were not changed.");

        return self::SUCCESS;
    }
}
