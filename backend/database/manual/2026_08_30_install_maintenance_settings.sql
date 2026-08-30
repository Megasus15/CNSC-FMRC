-- =====================================================================
--  FMRC production - install Maintenance Mode - 2026-08-30
-- =====================================================================
--  WHAT THIS IS FOR
--
--  The admin panel at /admin-page/website-maintenance reports
--
--      "Maintenance Mode is not installed on this server yet."
--
--  and keeps all 11 switches locked. That banner is correct, and it is
--  not a frontend bug: GET https://ucn-fabmanlab.com/api/maintenance
--  answers {"installed":false}, which is the flag the API sets when the
--  `maintenance_settings` table is absent. A Hostinger deploy copies
--  files but never runs migrations, so the PHP for the feature is live
--  while its one table has never been created.
--
--  Nothing is broken in the meantime. Every read fails OPEN, so the
--  customer site behaves as if nothing were under maintenance -- which
--  is exactly what the live payload shows (11 scopes, all inactive,
--  default messages). Only the ability to TURN something off is
--  missing, because a write has nowhere to be recorded.
--
--  This script is the hand-run equivalent of
--      php artisan migrate --force
--  for the single migration
--      2027_01_02_000000_create_maintenance_settings_table
--  and it records that migration as run afterwards, so a later
--  `artisan migrate` will not try to apply it a second time.
--
--  HOW TO RUN IT
--
--  Hostinger hPanel -> Databases -> phpMyAdmin -> pick the FMRC
--  database (u799987132_ucn_fmrc_db) -> SQL tab -> paste this whole
--  file -> Go. Then reload the admin page and click Refresh.
--
--  SAFETY
--
--  Additive only. It creates one new table, seeds 11 rows into it, and
--  adds one row to `migrations`. No existing table is altered, no data
--  is rewritten, nothing is dropped. Re-running the whole file is safe:
--  the table is created only if absent, each scope is inserted only if
--  its key is missing, and the `migrations` row only if it is not there
--  already -- so a second run will not overwrite a message you have
--  customised, nor switch a scope back on or off. Works on MySQL 8 and
--  MariaDB, which is why the existence checks are written out by hand.
-- =====================================================================

-- ---------------------------------------------------------------------
--  Helpers. Dropped again at the bottom of the file.
-- ---------------------------------------------------------------------
DELIMITER $$

DROP PROCEDURE IF EXISTS fmrc_seed_scope $$
DROP PROCEDURE IF EXISTS fmrc_mark_migration $$

CREATE PROCEDURE fmrc_seed_scope(
    IN p_scope   VARCHAR(40),
    IN p_message VARCHAR(75)
)
BEGIN
    DECLARE v_count INT DEFAULT 0;

    SELECT COUNT(*) INTO v_count
      FROM `maintenance_settings`
     WHERE `scope` = p_scope;

    -- Only a MISSING scope is inserted. A scope that is already there is
    -- left exactly as it is, so a message the admin has customised and a
    -- switch they have already thrown both survive a re-run. This is the
    -- same rule the migration's own seeding loop follows.
    IF v_count = 0 THEN
        INSERT INTO `maintenance_settings`
            (`scope`, `is_active`, `message`, `updated_by`, `created_at`, `updated_at`)
        VALUES
            (p_scope, 0, p_message, NULL, NOW(), NOW());
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
--  1/2  The table. One row per gate-able scope.
--
--  This is what `Schema::create()` in the migration produces on MySQL:
--  `id()` is BIGINT UNSIGNED AUTO_INCREMENT, `boolean()` is TINYINT(1),
--  `string('scope', 40)->unique()` is the VARCHAR plus the named unique
--  key, `timestamps()` are both NULLable, and
--  `foreignId('updated_by')->nullable()->constrained('users')
--  ->nullOnDelete()` is the BIGINT UNSIGNED column plus the constraint
--  at the bottom. The index and constraint names are the ones Laravel
--  generates, so `migrate:status` and any future migration that renames
--  or drops them will still find them.
--
--  `scope` is a plain VARCHAR rather than an ENUM on purpose: widening
--  an ENUM needs a driver-specific ALTER, and that is the pattern that
--  has already stranded this project's test schema twice.
--
--  `updated_by` records which admin threw the switch, and survives that
--  admin's account being deleted -- the column simply goes NULL rather
--  than blocking the delete.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `maintenance_settings` (
    `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `scope`      VARCHAR(40)     NOT NULL,
    `is_active`  TINYINT(1)      NOT NULL DEFAULT 0,
    `message`    VARCHAR(75)         NULL DEFAULT NULL,
    `updated_by` BIGINT UNSIGNED     NULL DEFAULT NULL,
    `created_at` TIMESTAMP           NULL DEFAULT NULL,
    `updated_at` TIMESTAMP           NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `maintenance_settings_scope_unique` (`scope`),
    KEY `maintenance_settings_updated_by_foreign` (`updated_by`),
    CONSTRAINT `maintenance_settings_updated_by_foreign`
        FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
--  2/2  The 11 scopes, in the order the admin screen lists them: two
--       customer account gates, five customer pages, four Home-page
--       sections.
--
--  Every message is <= 75 characters -- the same ceiling the admin UI
--  counter and the API validator enforce, and the same column width
--  above. The copy is identical to MaintenanceSetting::DEFAULTS, so a
--  row seeded here and a row the PHP falls back to read the same.
--
--  All 11 arrive with is_active = 0. Installing the feature must not
--  take anything offline.
-- ---------------------------------------------------------------------
CALL fmrc_seed_scope('customer_register', 'Account registration is temporarily closed for scheduled maintenance.');
CALL fmrc_seed_scope('customer_login',    'Customer sign-in is temporarily unavailable while we perform maintenance.');

CALL fmrc_seed_scope('page_home',        'Our home page is briefly offline for maintenance. Please check back soon.');
CALL fmrc_seed_scope('page_services',    'The Services page is under maintenance. It will be back shortly.');
CALL fmrc_seed_scope('page_products',    'The Products page is under maintenance. Orders will reopen shortly.');
CALL fmrc_seed_scope('page_contact',     'Our contact form is under maintenance. Please reach us again later.');
CALL fmrc_seed_scope('page_appointment', 'Appointment booking is paused for maintenance. Please try again later.');

CALL fmrc_seed_scope('home_about',   'The About Us section is being updated. Please check back shortly.');
CALL fmrc_seed_scope('home_mission', 'The Mission section is being updated. Please check back shortly.');
CALL fmrc_seed_scope('home_vision',  'The Vision section is being updated. Please check back shortly.');
CALL fmrc_seed_scope('home_offer',   'What We Offer is being updated. Please check back shortly.');

-- ---------------------------------------------------------------------
--  Record the migration as run, in a new batch, so a later
--  `php artisan migrate` skips it instead of re-applying it. (The
--  migration guards itself with Schema::hasTable and seeds row by row,
--  so even a double run would be harmless -- this just keeps
--  `migrate:status` honest.)
-- ---------------------------------------------------------------------
SET @fmrc_batch := (SELECT COALESCE(MAX(`batch`), 0) + 1 FROM `migrations`);

CALL fmrc_mark_migration('2027_01_02_000000_create_maintenance_settings_table', @fmrc_batch);

-- ---------------------------------------------------------------------
--  Clean up the helpers. Nothing this script created stays behind except
--  the table, its 11 rows, and the one `migrations` row.
-- ---------------------------------------------------------------------
DROP PROCEDURE IF EXISTS fmrc_seed_scope;
DROP PROCEDURE IF EXISTS fmrc_mark_migration;

-- ---------------------------------------------------------------------
--  Verification. Read all three results before leaving phpMyAdmin.
--
--    1. scope_rows must be 11, active_rows must be 0, foreign_keys 1,
--       migration_recorded 1.
--    2. Every expected column must read OK.
--    3. The 11 scopes with their default copy.
--
--  Then reload /admin-page/website-maintenance and click Refresh: the red
--  banner disappears, the chip reads "Everything online", and the
--  switches unlock.
-- ---------------------------------------------------------------------
SELECT
    (SELECT COUNT(*) FROM `maintenance_settings`)                        AS scope_rows,
    (SELECT COUNT(*) FROM `maintenance_settings` WHERE `is_active` = 1)  AS active_rows,
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND TABLE_NAME        = 'maintenance_settings'
        AND CONSTRAINT_TYPE   = 'FOREIGN KEY')                           AS foreign_keys,
    (SELECT COUNT(*) FROM `migrations`
      WHERE `migration` = '2027_01_02_000000_create_maintenance_settings_table')
                                                                         AS migration_recorded;

SELECT
    t.expected_column AS `column`,
    IF(c.COLUMN_NAME IS NULL, 'MISSING', 'OK') AS `state`,
    c.COLUMN_TYPE AS `type`
FROM (
              SELECT 'id' AS expected_column
    UNION ALL SELECT 'scope'
    UNION ALL SELECT 'is_active'
    UNION ALL SELECT 'message'
    UNION ALL SELECT 'updated_by'
    UNION ALL SELECT 'created_at'
    UNION ALL SELECT 'updated_at'
) AS t
LEFT JOIN INFORMATION_SCHEMA.COLUMNS c
       ON c.TABLE_SCHEMA = DATABASE()
      AND c.TABLE_NAME   = 'maintenance_settings'
      AND c.COLUMN_NAME  = t.expected_column
ORDER BY t.expected_column;

SELECT `id`, `scope`, `is_active`, `message` FROM `maintenance_settings` ORDER BY `id`;
