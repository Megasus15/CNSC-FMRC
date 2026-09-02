-- #####################################################################
--  DO NOT RUN THIS FILE. SUPERSEDED 2026-09-02.
--
--  It was run on production and stopped at its first statement with
--  "#1054 - Unknown column 'role' in 'SELECT'". Nothing was changed:
--  phpMyAdmin aborts at the first failing statement, so neither the
--  ALTER nor the `migrations` INSERT below was ever reached.
--
--  It failed because it assumed `users`.`role` exists. On that database
--  the column is absent, which means the schema was not built by running
--  the migrations in order -- so other columns are missing too. Run these
--  three instead, in this order:
--
--    1. 2026_09_02_diagnose_schema_drift.sql   (read-only, changes nothing)
--    2. 2026_09_02_repair_schema_drift.sql     (adds every missing column)
--    3. 2026_09_02_restore_users_role.sql      (only if step 1 or 2 says
--                                               `role` is MISSING)
--
--  Kept only as a record of the original diagnosis, below.
-- #####################################################################
-- =====================================================================
--  FMRC production - let `users`.`role` hold 'staff' - 2026-09-02
-- =====================================================================
--  WHAT THIS IS FOR
--
--  Staff cannot sign in to the Admin/Staff portal on the live site.
--  The cause is not the sign-in code -- it is the shape of one column.
--
--  `users`.`role` was created as ENUM('customer','admin','cashier')
--  by 0001_01_01_000000_create_users_table. The staff portal came
--  later, and the migration that widens the ENUM to include 'staff'
--  is 2026_04_12_120000_add_staff_role_to_users_table. A Hostinger
--  deploy copies files and never runs `php artisan migrate`, so that
--  ALTER may never have reached the live database.
--
--  While 'staff' is not a legal value:
--
--    * Accounts -> Add User with Role = Staff fails. MySQL runs with
--      STRICT_TRANS_TABLES, so the INSERT is rejected outright
--      (error 1265, "Data truncated for column 'role'") and the
--      request answers 500. No account is created.
--
--    * Approving a staff account request fails the same way, for the
--      same reason.
--
--    * Sign-in for that person therefore answers 401 "Invalid login
--      credentials" -- the portal says the password is wrong, because
--      the account genuinely does not exist. That is the whole of the
--      reported bug.
--
--  Nothing else is affected: admin and customer are already legal
--  values, which is why admin sign-in has always worked.
--
--  This is the hand-run equivalent of `php artisan migrate --force`
--  for exactly one migration:
--      2026_04_12_120000_add_staff_role_to_users_table
--  and it records that migration as run afterwards, so a later
--  `artisan migrate` will not try to apply it a second time.
--
--  HOW TO RUN IT
--
--  Hostinger hPanel -> Databases -> phpMyAdmin -> pick the FMRC
--  database (u799987132_ucn_fmrc_db) -> SQL tab -> paste this whole
--  file -> Go. Read the three verification results at the bottom
--  before leaving the page, then create the staff account again from
--  /admin-page/accounts.html.
--
--  SAFETY
--
--  Additive only, and it rewrites no rows. The new value is appended
--  to the END of the ENUM list, which MySQL 8 applies as a metadata
--  change: existing 'customer', 'admin' and 'cashier' rows keep both
--  their stored value and their numeric index. NULLability, DEFAULT
--  and COLLATE are read back from the live column and restored
--  verbatim, so this script cannot quietly change them.
--
--  Re-running the whole file is safe. The ALTER is skipped when
--  'staff' is already present, skipped when the column is not an
--  ENUM at all (a VARCHAR already accepts 'staff'), and the
--  `migrations` row is inserted only if it is missing.
-- =====================================================================
-- ---------------------------------------------------------------------
--  0/3  BEFORE. What the column looks like right now, and who exists.
--
--  Read this first. If `role_type` already contains 'staff' the rest
--  of the file is a no-op and the account problem is somewhere else --
--  say so rather than running anything further.
-- ---------------------------------------------------------------------
SELECT
    c.COLUMN_TYPE                                             AS `role_type_before`,
    c.IS_NULLABLE                                             AS `nullable`,
    c.COLUMN_DEFAULT                                          AS `default_value`,
    c.COLLATION_NAME                                          AS `collation`,
    IF(LOCATE('''staff''', LOWER(c.COLUMN_TYPE)) > 0,
       'staff already allowed - this script will change nothing',
       'staff NOT allowed - this script will add it')          AS `verdict`
FROM INFORMATION_SCHEMA.COLUMNS c
WHERE c.TABLE_SCHEMA = DATABASE()
  AND c.TABLE_NAME   = 'users'
  AND c.COLUMN_NAME  = 'role';

SELECT `role`, COUNT(*) AS `accounts`
  FROM `users`
 GROUP BY `role`
 ORDER BY `role`;
-- ---------------------------------------------------------------------
--  1/3  Append 'staff' to the ENUM, preserving everything else.
--
--  The new column type is built FROM the live one -- the closing
--  bracket is replaced with ",'staff')" -- so any value this file does
--  not know about survives, and 'staff' lands at the end of the list
--  where adding it costs no row rewrite. NULLability, DEFAULT and
--  COLLATE are copied back verbatim for the same reason.
--
--  Three cases end in a no-op instead of an ALTER:
--    * 'staff' is already in the list (the script has already run),
--    * the column is not an ENUM (a VARCHAR needs no widening),
--    * the column is missing entirely (nothing to widen).
-- ---------------------------------------------------------------------
SET @fmrc_role_type = (
    SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'
);

SET @fmrc_role_null = (
    SELECT IF(IS_NULLABLE = 'YES', 'NULL', 'NOT NULL') FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'
);

SET @fmrc_role_default = (
    SELECT COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'
);

SET @fmrc_role_collate = (
    SELECT COLLATION_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'
);

SET @fmrc_needs_staff = (
    @fmrc_role_type IS NOT NULL
    AND LOWER(LEFT(@fmrc_role_type, 5)) = 'enum('
    AND LOCATE('''staff''', LOWER(@fmrc_role_type)) = 0
);

SET @fmrc_sql = IF(
    @fmrc_needs_staff,
    CONCAT(
        'ALTER TABLE `users` MODIFY `role` ',
        LEFT(@fmrc_role_type, CHAR_LENGTH(@fmrc_role_type) - 1), ',''staff'')',
        IFNULL(CONCAT(' COLLATE ', @fmrc_role_collate), ''),
        ' ', @fmrc_role_null,
        IFNULL(CONCAT(' DEFAULT ''', @fmrc_role_default, ''''), '')
    ),
    'DO 0'
);

PREPARE fmrc_widen_role FROM @fmrc_sql;
EXECUTE fmrc_widen_role;
DEALLOCATE PREPARE fmrc_widen_role;
-- ---------------------------------------------------------------------
--  2/3  Record the migration as run.
--
--  `migrations` has no unique key on `migration`, so INSERT IGNORE
--  would not protect a re-run -- the row is inserted only when it is
--  absent. The batch number is one past the highest already present,
--  which is what `artisan migrate` would have used.
-- ---------------------------------------------------------------------
SET @fmrc_batch = (SELECT IFNULL(MAX(`batch`), 0) + 1 FROM `migrations`);

INSERT INTO `migrations` (`migration`, `batch`)
SELECT '2026_04_12_120000_add_staff_role_to_users_table', @fmrc_batch
  FROM DUAL
 WHERE NOT EXISTS (
        SELECT 1 FROM `migrations`
         WHERE `migration` = '2026_04_12_120000_add_staff_role_to_users_table'
 );
-- ---------------------------------------------------------------------
--  3/3  VERIFY. Read all three results before leaving the page.
--
--  1. `role_type_after` must now contain 'staff', and `nullable`,
--     `default_value` and `collation` must match what 0/3 reported.
--  2. The `migrations` row must exist exactly once.
--  3. The account list is unchanged -- this script creates no user.
--     Creating the staff account is the next step, from
--     /admin-page/accounts.html -> Add User -> Role: Staff.
-- ---------------------------------------------------------------------
SELECT
    c.COLUMN_TYPE                                             AS `role_type_after`,
    c.IS_NULLABLE                                             AS `nullable`,
    c.COLUMN_DEFAULT                                          AS `default_value`,
    c.COLLATION_NAME                                          AS `collation`,
    IF(LOCATE('''staff''', LOWER(c.COLUMN_TYPE)) > 0,
       'OK - staff accounts can now be created',
       'STILL BLOCKED - send this row back before trying again')  AS `verdict`
FROM INFORMATION_SCHEMA.COLUMNS c
WHERE c.TABLE_SCHEMA = DATABASE()
  AND c.TABLE_NAME   = 'users'
  AND c.COLUMN_NAME  = 'role';

SELECT COUNT(*) AS `migration_rows`,
       IF(COUNT(*) = 1, 'OK', 'CHECK THIS - expected exactly 1') AS `verdict`
  FROM `migrations`
 WHERE `migration` = '2026_04_12_120000_add_staff_role_to_users_table';

SELECT `role`, COUNT(*) AS `accounts`
  FROM `users`
 GROUP BY `role`
 ORDER BY `role`;
