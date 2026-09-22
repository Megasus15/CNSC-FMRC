<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class AdminSpectator extends Command
{
    protected $signature = 'admin:spectator
        {--expires= : Last access date in YYYY-MM-DD, Philippine time; updates an existing account without changing its password}
        {--remove : Delete the presentation account and revoke its sessions}';

    protected $description = 'Create, extend or remove the built-in view-only presentation account';

    private const USERNAME = 'presentation';

    private const EMAIL = 'presentation@fmrc.invalid';

    private const DEFAULT_EXPIRY_DATE = '2026-10-05';

    public function handle(): int
    {
        // User's compatibility trait skips missing columns. Never provision an
        // admin before confirming that the restriction can actually be stored.
        if (! Schema::hasColumns('users', ['is_spectator', 'spectator_expires_at'])) {
            $this->error('Run the spectator migration before creating this account.');
            return self::FAILURE;
        }

        $matches = User::query()->where('username', self::USERNAME)->orWhere('email', self::EMAIL)->get();
        $user = $matches->first();

        if ($matches->count() > 1 || ($user && (! $user->isSpectator()
            || $user->username !== self::USERNAME || $user->email !== self::EMAIL))) {
            $this->error('The presentation username or email belongs to another account. No accounts were changed.');
            return self::FAILURE;
        }

        if ($this->option('remove')) {
            if ($user) {
                DB::transaction(function () use ($user): void {
                    $user->tokens()->delete();
                    $user->delete();
                });
                $this->info('Presentation account removed and its tokens revoked.');
            } else {
                $this->info('No presentation account exists.');
            }
            return self::SUCCESS;
        }

        if ($user && $this->option('expires') === null) {
            $this->info('The presentation account already exists. Its password and expiry were not changed.');
            $this->line('Expires: '.($user->spectator_expires_at?->toIso8601String() ?? 'disabled'));
            return self::SUCCESS;
        }

        $date = (string) ($this->option('expires') ?? self::DEFAULT_EXPIRY_DATE);
        try {
            $expiresAt = Carbon::createFromFormat('!Y-m-d', $date, 'Asia/Manila');
            if (! preg_match('/^\d{4}-\d{2}-\d{2}$/D', $date) || $expiresAt->format('Y-m-d') !== $date) {
                throw new \InvalidArgumentException('Invalid date.');
            }
            $expiresAt = $expiresAt->endOfDay()->setMicrosecond(0)->utc();
            if (! $expiresAt->isFuture()) {
                throw new \InvalidArgumentException('Expiry must be in the future.');
            }
        } catch (\Throwable $error) {
            $this->error('Use a valid future expiry date in YYYY-MM-DD (Philippine time). No accounts were changed.');
            return self::FAILURE;
        }

        if ($user) {
            User::forgetSchemaColumnCache();
            $user->forceFill(['spectator_expires_at' => $expiresAt])->save();
            $this->info('Presentation expiry updated. Its password and view-only permissions were not changed.');
            $this->line('Expires: '.$user->fresh()->spectator_expires_at->toIso8601String());
            return self::SUCCESS;
        }

        $password = Str::password(20, symbols: false);
        User::forgetSchemaColumnCache();
        $user = DB::transaction(function () use ($password, $expiresAt): User {
            $user = new User;
            $user->forceFill([
                'name' => 'Presentation Spectator',
                'username' => self::USERNAME,
                'email' => self::EMAIL,
                'email_verified_at' => now(),
                'password' => $password,
                'role' => 'admin',
                'is_spectator' => true,
                'spectator_expires_at' => $expiresAt,
            ])->save();

            $user->refresh();
            if (! $user->isSpectator() || $user->spectatorHasExpired()) {
                throw new \RuntimeException('Spectator restrictions could not be stored. Account creation was rolled back.');
            }

            return $user;
        });

        $this->info('View-only presentation account created. Save this password; it is displayed only once.');
        $this->line('Username: '.self::USERNAME);
        $this->line('Password: '.$password);
        $this->line('Expires: '.$user->spectator_expires_at->toIso8601String());
        return self::SUCCESS;
    }
}
