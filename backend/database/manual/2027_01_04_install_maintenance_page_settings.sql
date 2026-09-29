-- Install the full-screen maintenance page customization on an existing site.
-- In Hostinger phpMyAdmin, select the application's database, then run this
-- file from the SQL tab (or import it). Export the database first.
-- Matches 2027_01_04_000000_create_maintenance_page_settings_table.php.
-- Existing switches, messages, and saved appearance values are preserved.
-- No default row is needed: the application supplies defaults until first save.
-- Leave Laravel's migrations ledger untouched; a later targeted Artisan run
-- safely skips the existing table and records the migration itself.

-- Every table name is qualified so phpMyAdmin cannot change the target database.
-- After the previous information_schema permission error, first run the final
-- SHOW TABLES statement alone: the CREATE may already have succeeded. If the
-- table is present, refresh the admin page before re-running this installer.

ALTER TABLE `u799987132_ucn_fmrc_db`.`maintenance_settings`
  MODIFY `message` VARCHAR(255) NULL DEFAULT NULL;

CREATE TABLE IF NOT EXISTS `u799987132_ucn_fmrc_db`.`maintenance_page_settings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `eyebrow` VARCHAR(80) NULL DEFAULT NULL,
  `headline` VARCHAR(120) NULL DEFAULT NULL,
  `headline_accent` VARCHAR(80) NULL DEFAULT NULL,
  `supporting_line` VARCHAR(160) NULL DEFAULT NULL,
  `image_path` VARCHAR(255) NULL DEFAULT NULL,
  `image_alt` VARCHAR(120) NULL DEFAULT NULL,
  `theme` VARCHAR(32) NULL DEFAULT NULL,
  `updated_by` BIGINT UNSIGNED NULL DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT NULL,
  `updated_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `maintenance_page_settings_updated_by_foreign` (`updated_by`),
  CONSTRAINT `maintenance_page_settings_updated_by_foreign`
    FOREIGN KEY (`updated_by`) REFERENCES `u799987132_ucn_fmrc_db`.`users` (`id`)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The result must include maintenance_page_settings after successful install.
SHOW TABLES FROM `u799987132_ucn_fmrc_db` LIKE 'maintenance_page_settings';
