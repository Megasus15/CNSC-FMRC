-- =====================================================================
--  FMRC production - install the three missing tables - 2026-08-31
-- =====================================================================
--  WHAT THIS IS FOR
--
--  Three migrations exist in the codebase but have never run against
--  the live database, because a Hostinger deploy copies files and
--  never runs `php artisan migrate`. Each one powers a feature whose
--  PHP is already deployed but inert:
--
--    1. staff_account_requests  -> the "Request access" form on the
--       Admin/Staff sign-in page and the Account Requests queue on
--       /admin-page/accounts. Without the table the form answers 503
--       "not installed yet" and the queue shows a neutral notice.
--
--    2. admin_recovery_codes    -> the 10 one-time recovery codes on
--       My Account, and the "Use a recovery code instead" branch of
--       Forgot Password. Without the table the panel reads
--       supported:false and the branch refuses every code.
--
--    3. email_change_requests   -> the OTP-verified change of the
--       admin's own Gmail address. Without the table the new address
--       cannot be staged, so the change never commits.
--
--  Nothing is broken in the meantime: all three features probe for
--  their table first and degrade to "not installed" rather than 500.
--  Running this script switches all three on at once.
--
--  This is the hand-run equivalent of `php artisan migrate --force`
--  for exactly these three migrations:
--      2027_01_03_000000_create_admin_recovery_codes_table
--      2027_01_03_000001_create_email_change_requests_table
--      2027_01_04_000000_create_staff_account_requests_table
--  and it records all three as run afterwards, so a later
--  `artisan migrate` will not try to apply them a second time.
--
--  HOW TO RUN IT
--
--  Hostinger hPanel -> Databases -> phpMyAdmin -> pick the FMRC
--  database (u799987132_ucn_fmrc_db) -> SQL tab -> paste this whole
--  file -> Go. Read all three verification results at the bottom
--  before leaving the page, then reload the admin portal.
--
--  SAFETY
--
--  Additive only. It creates three new tables and adds three rows to
--  `migrations`. No existing table is altered, no row is rewritten,
--  nothing is dropped, and nothing is seeded -- all three tables
--  start empty, which is their correct initial state. Re-running the
--  whole file is safe: each table is created only if it is absent and
--  each `migrations` row inserted only if it is missing. Written for
--  both MySQL 8 and MariaDB, which is why the existence checks are
--  spelled out by hand instead of using CREATE OR REPLACE.
-- =====================================================================
-- ---------------------------------------------------------------------
--  Helper. Dropped again at the bottom of the file.
--
--  `migrations` has no unique key on `migration`, so an INSERT IGNORE
--  would not protect a re-run. This checks first instead.
-- ---------------------------------------------------------------------
DELIMITER $$

DROP PROCEDURE IF EXISTS fmrc_mark_migration $$

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
--  1/3  staff_account_requests
--
--  One row per staff-account application. This is what Schema::create()
--  in 2027_01_04_000000 produces on MySQL: `id()` is BIGINT UNSIGNED
--  AUTO_INCREMENT, every `string()` is VARCHAR of the stated length (255
--  when unstated), `timestamps()` are both NULLable, and each
--  `foreignId(...)->nullable()->constrained('users')->nullOnDelete()`
--  is a BIGINT UNSIGNED column plus the constraint at the bottom. The
--  index and constraint names are the ones Laravel generates, so
--  `migrate:status` and any future migration that touches them will
--  still find them.
--
--  `password_hash` holds a bcrypt hash and NOTHING else -- never the
--  applicant's plaintext password. It is set to NULL the moment a
--  decision is made, so a long queue of decided rows is not a pile of
--  reusable credentials.
--
--  `status` is a plain VARCHAR, not an ENUM: widening an ENUM needs a
--  driver-specific ALTER, and that is the pattern that has already
--  stranded this project's test schema twice.
--
--  There is deliberately NO unique key on `email` or `username`. A
--  rejected applicant must be able to apply again, so uniqueness is
--  "one PENDING row per address", which the controller enforces where
--  it can return a readable message. Both columns are still indexed
--  because that check runs on every submission.
--
--  `reviewed_by` and `created_user_id` survive the referenced admin or
--  staff account being deleted: the column goes NULL rather than
--  blocking the delete, so the audit trail never becomes undeletable.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `staff_account_requests` (
    `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name`            VARCHAR(255)    NOT NULL,
    `username`        VARCHAR(50)     NOT NULL,
    `email`           VARCHAR(255)    NOT NULL,
    `password_hash`   VARCHAR(255)        NULL DEFAULT NULL,
    `status`          VARCHAR(20)     NOT NULL DEFAULT 'pending',
    `decision_note`   VARCHAR(300)        NULL DEFAULT NULL,
    `reviewed_by`     BIGINT UNSIGNED     NULL DEFAULT NULL,
    `reviewed_at`     TIMESTAMP           NULL DEFAULT NULL,
    `created_user_id` BIGINT UNSIGNED     NULL DEFAULT NULL,
    `request_ip`      VARCHAR(45)         NULL DEFAULT NULL,
    `created_at`      TIMESTAMP           NULL DEFAULT NULL,
    `updated_at`      TIMESTAMP           NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `staff_account_requests_status_created_at_index` (`status`, `created_at`),
    KEY `staff_account_requests_email_index` (`email`),
    KEY `staff_account_requests_username_index` (`username`),
    KEY `staff_account_requests_reviewed_by_foreign` (`reviewed_by`),
    KEY `staff_account_requests_created_user_id_foreign` (`created_user_id`),
    CONSTRAINT `staff_account_requests_reviewed_by_foreign`
        FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
    CONSTRAINT `staff_account_requests_created_user_id_foreign`
        FOREIGN KEY (`created_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
-- ---------------------------------------------------------------------
--  2/3  admin_recovery_codes
--
--  Ten rows per generated set; only the bcrypt hash of a code is ever
--  stored, so a database leak cannot be replayed as a login. `used_at`
--  going non-NULL is what burns a code, and `used_ip` is kept for
--  forensics if one is ever used by someone who should not have it.
--
--  Matches 2027_01_03_000000 exactly, including the absence of a
--  foreign key: that migration uses `unsignedBigInteger('user_id')`
--  rather than `foreignId()`, so no constraint is created here either.
--  Adding one would make this script and a future `artisan migrate` on
--  a fresh database produce different schemas.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `admin_recovery_codes` (
    `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id`    BIGINT UNSIGNED NOT NULL,
    `code_hash`  VARCHAR(255)    NOT NULL,
    `used_at`    TIMESTAMP           NULL DEFAULT NULL,
    `used_ip`    VARCHAR(45)         NULL DEFAULT NULL,
    `created_at` TIMESTAMP           NULL DEFAULT NULL,
    `updated_at` TIMESTAMP           NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `admin_recovery_codes_user_id_used_at_index` (`user_id`, `used_at`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
--  3/3  email_change_requests
--
--  Holds a proposed admin Gmail address until the 6-digit code mailed
--  to that NEW address is entered. Without this staging row a mistyped
--  address would instantly become the only password-reset destination
--  and lock the single admin account out for good.
--
--  `attempts` is the per-request wrong-code counter; `expires_at` is
--  what makes an abandoned request harmless. Matches 2027_01_03_000001
--  exactly, again with no foreign key on `user_id`.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `email_change_requests` (
    `id`         BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    `user_id`    BIGINT UNSIGNED  NOT NULL,
    `new_email`  VARCHAR(255)     NOT NULL,
    `otp_hash`   VARCHAR(255)     NOT NULL,
    `attempts`   TINYINT UNSIGNED NOT NULL DEFAULT 0,
    `expires_at` TIMESTAMP            NULL DEFAULT NULL,
    `created_at` TIMESTAMP            NULL DEFAULT NULL,
    `updated_at` TIMESTAMP            NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `email_change_requests_user_id_index` (`user_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
-- ---------------------------------------------------------------------
--  Record all three migrations as run, in one new batch, so a later
--  `php artisan migrate` skips them instead of re-applying them. (All
--  three guard themselves with Schema::hasTable, so even a double run
--  would be harmless -- this just keeps `migrate:status` honest.)
-- ---------------------------------------------------------------------
SET @fmrc_batch := (SELECT COALESCE(MAX(`batch`), 0) + 1 FROM `migrations`);

CALL fmrc_mark_migration('2027_01_03_000000_create_admin_recovery_codes_table',   @fmrc_batch);
CALL fmrc_mark_migration('2027_01_03_000001_create_email_change_requests_table',  @fmrc_batch);
CALL fmrc_mark_migration('2027_01_04_000000_create_staff_account_requests_table', @fmrc_batch);

-- ---------------------------------------------------------------------
--  Clean up the helper. Nothing this script created stays behind except
--  the three tables and the three `migrations` rows.
-- ---------------------------------------------------------------------
DROP PROCEDURE IF EXISTS fmrc_mark_migration;

-- ---------------------------------------------------------------------
--  Verification. Read all three results before leaving phpMyAdmin.
--
--    1. All three *_table values must read 1, foreign_keys must be 2
--       (both on staff_account_requests), and migrations_recorded 3.
--       Every *_rows value should be 0 on a first run.
--    2. Every expected column must read OK. A MISSING row means the
--       table already existed in an older shape -- add that one column
--       by hand before using the feature.
--    3. The three `migrations` rows, with the batch they landed in.
--
--  Then reload /admin-page/accounts: the Account Requests panel stops
--  saying "not installed", and the Request access form on the sign-in
--  page starts accepting submissions.
-- ---------------------------------------------------------------------
SELECT
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME   = 'staff_account_requests')      AS staff_account_requests_table,
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME   = 'admin_recovery_codes')        AS admin_recovery_codes_table,
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME   = 'email_change_requests')       AS email_change_requests_table,
    (SELECT COUNT(*) FROM `staff_account_requests`)       AS request_rows,
    (SELECT COUNT(*) FROM `admin_recovery_codes`)         AS recovery_code_rows,
    (SELECT COUNT(*) FROM `email_change_requests`)        AS email_change_rows,
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND TABLE_NAME        = 'staff_account_requests'
        AND CONSTRAINT_TYPE   = 'FOREIGN KEY')            AS foreign_keys,
    (SELECT COUNT(*) FROM `migrations` WHERE `migration` IN (
        '2027_01_03_000000_create_admin_recovery_codes_table',
        '2027_01_03_000001_create_email_change_requests_table',
        '2027_01_04_000000_create_staff_account_requests_table'
     ))                                                   AS migrations_recorded;
SELECT
    t.expected_table  AS `table`,
    t.expected_column AS `column`,
    IF(c.COLUMN_NAME IS NULL, 'MISSING', 'OK') AS `state`,
    c.COLUMN_TYPE AS `type`
FROM (
              SELECT 'staff_account_requests' AS expected_table, 'id'              AS expected_column
    UNION ALL SELECT 'staff_account_requests', 'name'
    UNION ALL SELECT 'staff_account_requests', 'username'
    UNION ALL SELECT 'staff_account_requests', 'email'
    UNION ALL SELECT 'staff_account_requests', 'password_hash'
    UNION ALL SELECT 'staff_account_requests', 'status'
    UNION ALL SELECT 'staff_account_requests', 'decision_note'
    UNION ALL SELECT 'staff_account_requests', 'reviewed_by'
    UNION ALL SELECT 'staff_account_requests', 'reviewed_at'
    UNION ALL SELECT 'staff_account_requests', 'created_user_id'
    UNION ALL SELECT 'staff_account_requests', 'request_ip'
    UNION ALL SELECT 'staff_account_requests', 'created_at'
    UNION ALL SELECT 'staff_account_requests', 'updated_at'
    UNION ALL SELECT 'admin_recovery_codes',   'id'
    UNION ALL SELECT 'admin_recovery_codes',   'user_id'
    UNION ALL SELECT 'admin_recovery_codes',   'code_hash'
    UNION ALL SELECT 'admin_recovery_codes',   'used_at'
    UNION ALL SELECT 'admin_recovery_codes',   'used_ip'
    UNION ALL SELECT 'admin_recovery_codes',   'created_at'
    UNION ALL SELECT 'admin_recovery_codes',   'updated_at'
    UNION ALL SELECT 'email_change_requests',  'id'
    UNION ALL SELECT 'email_change_requests',  'user_id'
    UNION ALL SELECT 'email_change_requests',  'new_email'
    UNION ALL SELECT 'email_change_requests',  'otp_hash'
    UNION ALL SELECT 'email_change_requests',  'attempts'
    UNION ALL SELECT 'email_change_requests',  'expires_at'
    UNION ALL SELECT 'email_change_requests',  'created_at'
    UNION ALL SELECT 'email_change_requests',  'updated_at'
) AS t
LEFT JOIN INFORMATION_SCHEMA.COLUMNS c
       ON c.TABLE_SCHEMA = DATABASE()
      AND c.TABLE_NAME   = t.expected_table
      AND c.COLUMN_NAME  = t.expected_column
ORDER BY t.expected_table, t.expected_column;

SELECT `id`, `migration`, `batch`
  FROM `migrations`
 WHERE `migration` IN (
        '2027_01_03_000000_create_admin_recovery_codes_table',
        '2027_01_03_000001_create_email_change_requests_table',
        '2027_01_04_000000_create_staff_account_requests_table'
 )
 ORDER BY `migration`;
