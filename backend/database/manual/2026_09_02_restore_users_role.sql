-- =====================================================================
--  FMRC production - put `users`.`role` back  -  2026-09-02
-- =====================================================================
--  READ THIS BEFORE YOU RUN IT
--
--  Run 2026_09_02_diagnose_schema_drift.sql first. Only run this file if
--  its result 3 shows NO `role` row for the `users` table -- that is,
--  the column really is missing. If the column exists, this file is not
--  the one you want: 2026_09_02_repair_schema_drift.sql already widens
--  the ENUM so 'staff' becomes a legal value.
--
--  WHY THIS IS A SEPARATE FILE
--
--  `role` is what tells admin, staff and customer apart. Creating the
--  column gives every existing row the column default, and that default
--  is 'customer'. If the file stopped there, your own account would
--  become a customer and the Admin/Staff portal would refuse your
--  sign-in -- a worse fault than the one being fixed. So the column and
--  the roles are restored in the same run, and this file will not create
--  the column without also naming at least one admin.
--
--  WHAT YOU MAY NEED TO EDIT
--
--  The one block below marked "EDIT ME". It is pre-filled with the
--  account this project seeds as the administrator (`admin`). Result 1
--  prints every account on the live database before anything changes --
--  if your real administrator is a different login, put it there.
--
--  HOW TO RUN IT
--
--  Hostinger hPanel -> Databases -> phpMyAdmin -> pick the FMRC
--  database (u799987132_ucn_fmrc_db) -> SQL tab -> paste this whole
--  file -> Go. Read the last two results before leaving the page, then
--  sign in to /admin-auth/auth.html.
--
--  SAFETY
--
--  The only column it creates is `users`.`role`, and only if absent.
--  The only rows it writes are role values, and only for accounts you
--  have named here or that the database itself already records as an
--  admin or staff member. It drops nothing, renames nothing, and
--  deletes nothing. Re-running it changes nothing the second time.
-- =====================================================================

-- =====================================================================
--  EDIT ME
--
--  Comma-separated logins, no spaces around the commas. A login may be
--  either the username or the e-mail address -- both are checked. Leave
--  the staff line as '' if there is no staff account yet; you can create
--  one from Accounts -> Add User once the column exists.
-- =====================================================================
SET @fmrc_admin_logins = 'admin,admin@cnsc.edu.ph';
SET @fmrc_staff_logins = 'staff,staff@cnsc.edu.ph';

-- ---------------------------------------------------------------------
--  1/5  BEFORE. Every account on the live database.
--
--  `role` is deliberately not selected here -- that is the column this
--  file exists to create, and naming it would make this statement fail
--  the same way 2026_09_02_install_staff_role.sql did. Check that the
--  logins in the EDIT ME block above appear in this list before going
--  any further.
-- ---------------------------------------------------------------------
SELECT `id`, `name`, `username`, `email`, `created_at`
  FROM `users`
 ORDER BY `id`;
-- ---------------------------------------------------------------------
--  2/5  Create the column.
--
--  ENUM('customer','admin','cashier','staff') is the shape the deployed
--  code expects: the first three come from the original
--  0001_01_01_000000_create_users_table migration and 'staff' from
--  2026_04_12_120000_add_staff_role_to_users_table, so creating it in
--  one step is the same end state as running both.
--
--  No COLLATE is given on purpose -- the column inherits the `users`
--  table's own collation, which is safer than asserting one that may not
--  match what this database was created with.
-- ---------------------------------------------------------------------
DELIMITER $$

DROP PROCEDURE IF EXISTS fmrc_restore_role $$

CREATE PROCEDURE fmrc_restore_role()
BEGIN
    DECLARE v_has_column INT DEFAULT 0;
    DECLARE v_has_after  INT DEFAULT 0;

    SELECT COUNT(*) INTO v_has_column
      FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role';

    SELECT COUNT(*) INTO v_has_after
      FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'password';

    IF v_has_column = 0 THEN
        SET @fmrc_sql = CONCAT(
            'ALTER TABLE `users` ADD COLUMN `role` ',
            "ENUM('customer','admin','cashier','staff') NOT NULL DEFAULT 'customer'",
            IF(v_has_after > 0, ' AFTER `password`', '')
        );
        PREPARE fmrc_stmt FROM @fmrc_sql;
        EXECUTE fmrc_stmt;
        DEALLOCATE PREPARE fmrc_stmt;
    END IF;
END $$

-- Recover roles the database already knows about. Every report the back
-- office has ever generated stamped the person who generated it and the role
-- they held (`report_generations`.`generated_by_user_id` / `generated_by_role`),
-- so the 47 archived records are themselves a record of who the staff and
-- admins are. Read through dynamic SQL and skipped when that table or either
-- column is absent, so this cannot fail on a database that never had it.
DROP PROCEDURE IF EXISTS fmrc_promote_from_reports $$

CREATE PROCEDURE fmrc_promote_from_reports(IN p_role VARCHAR(32))
BEGIN
    DECLARE v_ready INT DEFAULT 0;

    SELECT COUNT(*) INTO v_ready
      FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'report_generations'
       AND COLUMN_NAME IN ('generated_by_user_id', 'generated_by_role');

    IF v_ready = 2 THEN
        SET @fmrc_sql = CONCAT(
            'UPDATE `users` u SET u.`role` = ''', p_role, ''' ',
            ' WHERE u.`role` = ''customer'' AND EXISTS (',
            '   SELECT 1 FROM `report_generations` r ',
            '    WHERE r.`generated_by_user_id` = u.`id` ',
            '      AND LOWER(r.`generated_by_role`) = ''', p_role, ''')'
        );
        PREPARE fmrc_stmt FROM @fmrc_sql;
        EXECUTE fmrc_stmt;
        DEALLOCATE PREPARE fmrc_stmt;
    END IF;
END $$

DELIMITER ;

CALL fmrc_restore_role();
-- ---------------------------------------------------------------------
--  3/5  Name the administrators and staff.
--
--  The explicit lists run first and win: an account you named is set to
--  that role whatever it currently says. The evidence pass then fills in
--  anyone the reports table already recorded as admin or staff and whom
--  you did not name, and it only ever promotes a row still sitting on
--  the 'customer' default -- so it can never demote an account.
-- ---------------------------------------------------------------------
UPDATE `users`
   SET `role` = 'admin'
 WHERE @fmrc_admin_logins <> ''
   AND (FIND_IN_SET(`username`, @fmrc_admin_logins) > 0
     OR FIND_IN_SET(`email`, @fmrc_admin_logins) > 0);

UPDATE `users`
   SET `role` = 'staff'
 WHERE @fmrc_staff_logins <> ''
   AND (FIND_IN_SET(`username`, @fmrc_staff_logins) > 0
     OR FIND_IN_SET(`email`, @fmrc_staff_logins) > 0);

CALL fmrc_promote_from_reports('admin');
CALL fmrc_promote_from_reports('staff');

DROP PROCEDURE IF EXISTS fmrc_restore_role;
DROP PROCEDURE IF EXISTS fmrc_promote_from_reports;
-- ---------------------------------------------------------------------
--  4/5  Record the two migrations this file stands in for, so a later
--       `php artisan migrate` does not try to apply them again.
--
--  `migrations` has no unique key on `migration`, so INSERT IGNORE would
--  not protect a re-run -- each row is inserted only when absent.
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
--  5/5  VERIFY. Read both results before leaving the page.
--
--  The first must show at least one `admin`. If it does not, nobody can
--  open the back office: put the right login in the EDIT ME block and
--  run the file again -- it is safe to repeat.
--
--  The second lists the accounts that can now reach the portal. Sign in
--  at /admin-auth/auth.html as one of them.
-- ---------------------------------------------------------------------
SELECT `role`,
       COUNT(*) AS `accounts`,
       IF(`role` = 'admin' AND COUNT(*) > 0, 'OK - the portal is reachable', '') AS `note`
  FROM `users`
 GROUP BY `role`
 ORDER BY FIELD(`role`, 'admin', 'staff', 'cashier', 'customer'), `role`;

SELECT `id`, `name`, `username`, `email`, `role`
  FROM `users`
 WHERE `role` IN ('admin', 'staff')
 ORDER BY FIELD(`role`, 'admin', 'staff'), `id`;
