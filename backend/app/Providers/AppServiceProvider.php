<?php

namespace App\Providers;

use App\Support\Branding;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // The sender NAME shown in the recipient's inbox. Five mailables in app/Mail
        // never set `from:` on their envelope, so they inherit this value, and five
        // inline builders read `config('mail.from.name', ...)` directly - normalising
        // it here fixes all ten without touching a single envelope.
        //
        // `app.name` is deliberately left alone: Laravel derives the session cookie
        // name from it, so overriding it would sign every logged-in user out.
        config(['mail.from.name' => Branding::mailFromName()]);
    }
}
