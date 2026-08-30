-- =====================================================================
--  FMRC production - install the Google password reminder - 2026-08-30
-- =====================================================================
--  WHAT THIS IS FOR
--
--  The "Account Tip / Create a password first!" popover under the
--  profile avatar never appears on the live site, at ANY screen size.
--  That is not a CSS or a responsive bug -- the card is styled with no
--  media query at all and it has been measured rendering correctly at
--  1440x900, 410x886 and 356x819. The gate is the DATA.
--
--  AuthController decides whether the feature exists at all:
--
--      private function supportsGooglePasswordState(): bool
--      {
--          return $this->googlePasswordStateSupported ??=
--                 Schema::hasColumn('users', 'signed_with_google')
--              && Schema::hasColumn('users', 'has_custom_password');
--      }
--
--  and when the two columns are absent it deliberately fails soft
--  (exposeGooglePasswordStateFallback):
--
--      $user->setAttribute('signed_with_google', false);
--      $user->setAttribute('has_custom_password', true);
--
--  So /api/customer/profile answers "not a Google account, already has a
--  password" for everybody, and the frontend correctly draws nothing.
--  The columns come from the migration
--      2026_08_20_000001_add_google_password_state_to_users_table
--  and a Hostinger deploy copies files but never runs migrations -- the
--  same reason Maintenance Mode needed a hand-run script this week. The
--  PHP for the reminder is live; its two columns have never been created.
--
--  This script is the hand-run equivalent of
--      php artisan migrate --force
--  for that one migration, and it records the migration as run
--  afterwards so a later `artisan migrate` will not re-apply it.
--
--  HOW TO RUN IT
--
--  Hostinger hPanel -> Databases -> phpMyAdmin -> pick the FMRC
--  database (u799987132_ucn_fmrc_db) -> SQL tab -> paste this whole
--  file -> Go. Nothing needs restarting: Schema::hasColumn is asked per
--  request, so the very next sign-in already sees the feature.
--
--  SAFETY
--
--  Additive only. Two new columns on `users` and one row in
--  `migrations`. No existing column is altered, no row is rewritten,
--  nothing is dropped, no password is touched. Re-running the whole file
--  is safe: each column is added only if it is missing and the
--  `migrations` row only if it is not already there. Works on MySQL 8
--  and MariaDB, which is why the existence checks are written out by
--  hand instead of using ADD COLUMN IF NOT EXISTS.
--
--  WHAT EXISTING ACCOUNTS WILL DO  (read this - it is deliberate)
--
--  Every row already in `users` takes the defaults below, i.e.
--  "not a Google sign-in, already has a password", so nobody is nagged
--  the moment the script runs. That is the migration's own stated
--  intent, and it is the only honest choice: a Google-created account is
--  given Hash::make(Str::random(32)) as its password, which is
--  byte-for-byte indistinguishable from a password the customer chose,
--  so there is no marker in the schema to backfill from. Guessing would
--  pester customers who already have a password.
--
--  The reminder then fills in on its own, with no further SQL:
--
--    * A NEW Google sign-up is created with signed_with_google = 1 and
--      has_custom_password = 0 (AuthController::googleAuth), so it gets
--      the tip immediately.
--    * An EXISTING customer who signs in with Google again is flipped to
--      signed_with_google = 1 and saved on that request (same method).
--      They keep has_custom_password = 1, so they are not nagged -- and
--      the moment they do set a password through My Account the flag is
--      already correct.
--
--  If you want to test the popover on a real account right now, the
--  optional statement at the bottom of this file does that for one named
--  email and is commented out on purpose.
-- =====================================================================

-- ---------------------------------------------------------------------
--  Helpers. Dropped again at the bottom of the file. Same shape as the
--  2026_08_24 production upgrade, so the two scripts read alike.
-- ---------------------------------------------------------------------
DELIMITER $$

DROP PROCEDURE IF EXISTS fmrc_add_column $$
DROP PROCEDURE IF EXISTS fmrc_mark_migration $$

CREATE PROCEDURE fmrc_add_column(
    IN p_table      VARCHAR(64),
    IN p_column     VARCHAR(64),
    IN p_definition VARCHAR(255),
    IN p_after      VARCHAR(64)
)
BEGIN
    DECLARE v_has_table  INT DEFAULT 0;
    DECLARE v_has_column INT DEFAULT 0;
    DECLARE v_has_after  INT DEFAULT 0;

    SELECT COUNT(*) INTO v_has_table
      FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table;

    SELECT COUNT(*) INTO v_has_column
      FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_column;

    -- Column order is cosmetic, so a missing AFTER target must not abort the
    -- run: the column is simply appended at the end of the table instead.
    SELECT COUNT(*) INTO v_has_after
      FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_after;

    IF v_has_table > 0 AND v_has_column = 0 THEN
        SET @fmrc_sql = CONCAT(
            'ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition,
            IF(v_has_after > 0, CONCAT(' AFTER `', p_after, '`'), '')
        );
        PREPARE fmrc_stmt FROM @fmrc_sql;
        EXECUTE fmrc_stmt;
        DEALLOCATE PREPARE fmrc_stmt;
    END IF;
END $$

CREATE PROCEDURE fmrc_mark_migration(
    IN p_name  VARCHAR(255),
    IN p_batch INT
)
BEGIN
    DECLARE v_count INT DEFAULT 0;

    SELECT COUNT(*) INTO v_count FROM `migrations` WHERE `migration` = p_name;

    IF v_count = 0 THEN
        INSERT INTO `migrations` (`migration`, `batch`) VALUES (p_name, p_batch);
    END IF;
END $$

DELIMITER ;

-- ---------------------------------------------------------------------
--  1/1  The two columns.  (2026_08_20_000001)
--
--  These are exactly what the migration's Blueprint produces on MySQL:
--  $table->boolean(...) is TINYINT(1) NOT NULL, and the defaults are the
--  ones written there -- signed_with_google false, has_custom_password
--  true. Matching them matters: User.php casts both to 'boolean', and
--  AuthController reads them with (bool), so a NULL-able column would
--  read as false for has_custom_password and show the tip to every
--  existing customer on the site.
--
--  Placed AFTER `password` because that is what they describe. If your
--  `users` table has no `password` column under that name the helper
--  appends them at the end instead, which is equally fine.
-- ---------------------------------------------------------------------
CALL fmrc_add_column('users', 'signed_with_google',  'TINYINT(1) NOT NULL DEFAULT 0', 'password');
CALL fmrc_add_column('users', 'has_custom_password', 'TINYINT(1) NOT NULL DEFAULT 1', 'signed_with_google');

-- ---------------------------------------------------------------------
--  Record the migration as run, in a new batch, so a later
--  `php artisan migrate` skips it instead of re-applying it. (The
--  migration guards each column with Schema::hasColumn, so even a double
--  run would be harmless -- this just keeps `migrate:status` honest.)
-- ---------------------------------------------------------------------
SET @fmrc_batch := (SELECT COALESCE(MAX(`batch`), 0) + 1 FROM `migrations`);

CALL fmrc_mark_migration('2026_08_20_000001_add_google_password_state_to_users_table', @fmrc_batch);

-- ---------------------------------------------------------------------
--  Clean up the helpers. Nothing this script created stays behind except
--  the two columns and the one `migrations` row.
-- ---------------------------------------------------------------------
DROP PROCEDURE IF EXISTS fmrc_add_column;
DROP PROCEDURE IF EXISTS fmrc_mark_migration;

-- ---------------------------------------------------------------------
--  Verification. Read both results before leaving phpMyAdmin.
--
--    1. Both columns must read OK, with type tinyint(1), NOT NULL, and
--       default 0 then 1. migration_recorded must be 1.
--    2. accounts_flagged_google starts at 0 and grows on its own as
--       customers sign in with Google again; accounts_needing_password
--       starts at 0 by design (see the note at the top).
--
--  Then sign in on https://ucn-fabmanlab.com with a Google account. The
--  "Account Tip" popover appears under the avatar on desktop and on
--  phone alike -- there is no width condition anywhere in its CSS or JS.
-- ---------------------------------------------------------------------
SELECT
    t.expected_column AS `column`,
    IF(c.COLUMN_NAME IS NULL, 'MISSING', 'OK') AS `state`,
    c.COLUMN_TYPE     AS `type`,
    c.IS_NULLABLE     AS `nullable`,
    c.COLUMN_DEFAULT  AS `default`
FROM (
              SELECT 'signed_with_google' AS expected_column
    UNION ALL SELECT 'has_custom_password'
) AS t
LEFT JOIN INFORMATION_SCHEMA.COLUMNS c
       ON c.TABLE_SCHEMA = DATABASE()
      AND c.TABLE_NAME   = 'users'
      AND c.COLUMN_NAME  = t.expected_column
ORDER BY t.expected_column DESC;

SELECT
    (SELECT COUNT(*) FROM `migrations`
      WHERE `migration` = '2026_08_20_000001_add_google_password_state_to_users_table')
                                                                     AS migration_recorded,
    (SELECT COUNT(*) FROM `users` WHERE `role` = 'customer')          AS customer_accounts,
    (SELECT COUNT(*) FROM `users` WHERE `signed_with_google` = 1)     AS accounts_flagged_google,
    (SELECT COUNT(*) FROM `users` WHERE `has_custom_password` = 0)    AS accounts_needing_password;

-- ---------------------------------------------------------------------
--  OPTIONAL, and commented out on purpose.
--
--  Uncomment and put your own address in to make ONE existing account
--  behave like a fresh Google sign-up, so you can see the popover
--  without waiting for a new registration. It only flips the two flags;
--  the account's real password is untouched, and setting a password
--  through My Account flips has_custom_password back to 1 by itself.
--
--  Do not run this across the whole table -- see the note at the top.
-- ---------------------------------------------------------------------
-- UPDATE `users`
--    SET `signed_with_google` = 1,
--        `has_custom_password` = 0
--  WHERE `email` = 'put.your.address@gmail.com'
--    AND `role`  = 'customer'
--  LIMIT 1;
