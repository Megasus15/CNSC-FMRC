<?php

use Illuminate\Database\Migrations\Migration;

/**
 * This migration does NOT change the database schema.
 *
 * It serves as a documentation anchor for the Gmail SMTP configuration
 * required for customer order email notifications.
 *
 * Add the following to your .env file to enable Gmail sending:
 *
 *   MAIL_MAILER=smtp
 *   MAIL_HOST=smtp.gmail.com
 *   MAIL_PORT=587
 *   MAIL_USERNAME=your-gmail@gmail.com
 *   MAIL_PASSWORD=your-app-password        # Google App Password (not your real password)
 *   MAIL_ENCRYPTION=tls
 *   MAIL_FROM_ADDRESS=your-gmail@gmail.com
 *   MAIL_FROM_NAME="UCN-FMRC"
 *
 * Steps to generate a Google App Password:
 *  1. Go to myaccount.google.com → Security → 2-Step Verification (must be enabled)
 *  2. Search for "App passwords" → Create one for "Mail"
 *  3. Use that 16-character password as MAIL_PASSWORD
 *
 * Without this configuration, emails are logged to storage/logs/laravel.log (MAIL_MAILER=log).
 */
return new class extends Migration
{
    public function up(): void
    {
        // No schema changes — see docblock above.
    }

    public function down(): void
    {
        // No schema changes to reverse.
    }
};
