<?php

namespace App\Support;

/**
 * The one place the public brand name lives.
 *
 * Every email used to read `config('app.name')` and fall back to 'UCN-FMRC' only when
 * the value was the literal string "laravel". The live `.env` says
 * `APP_NAME=CNSC-FMRC`, which is neither empty nor "laravel", so the old institution
 * name flowed straight into every header and footer that customers and staff read.
 *
 * Editing `.env` on the production host is not a reliable fix (the deploy copies files
 * and the hPanel terminal cannot be driven interactively), so branding no longer reads
 * environment configuration at all. These constants are the source of truth.
 *
 * Note what is deliberately NOT here: email addresses. `cnscfmrc@gmail.com`,
 * `fmrc@cnsc.edu.ph` and the `noreply@cnsc-fmrc.edu.ph` default are real, working
 * mailboxes and keep their spelling until the accounts themselves are migrated.
 */
final class Branding
{
    /** Public-facing short name, as it appears in email headers and footers. */
    public const NAME = 'UCN-FMRC';

    /** The institution the laboratory belongs to. */
    public const INSTITUTION = 'University of Camarines Norte';

    /**
     * Display name for outgoing mail — what the recipient sees as the sender.
     *
     * Kept as a method because `AppServiceProvider::boot()` pushes it into
     * `mail.from.name`, and a named call site is easier to trace than a bare constant.
     */
    public static function mailFromName(): string
    {
        return self::NAME;
    }

    /**
     * Footer copyright line, e.g. "© 2026 UCN-FMRC".
     *
     * The year is resolved at render time; one template had 2025 frozen into a string
     * literal, which would have quietly aged for as long as the site ran.
     */
    public static function copyright(): string
    {
        return '&copy; ' . date('Y') . ' ' . self::NAME;
    }
}
