-- Hostinger / phpMyAdmin installer for per-account Admin and Staff preferences.
-- Includes the appearance table and the sidebar workspace migration.
-- Run from phpMyAdmin's SQL tab. Database qualification prevents installing
-- the table into phpMyAdmin's currently selected system database by mistake.
-- Re-running this creates no duplicates and changes no existing accounts,
-- passwords, saved preferences, or other application tables.
-- A later targeted Artisan migration safely records the existing table.

CREATE TABLE IF NOT EXISTS `u799987132_ucn_fmrc_db`.`user_portal_preferences` (
  `user_id` BIGINT UNSIGNED NOT NULL,
  `theme` VARCHAR(10) NOT NULL DEFAULT 'light',
  `compact` TINYINT(1) NOT NULL DEFAULT 0,
  `reduced_motion` TINYINT(1) NOT NULL DEFAULT 0,
  `workspace` JSON NULL,
  `created_at` TIMESTAMP NULL DEFAULT NULL,
  `updated_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `user_portal_preferences_user_id_foreign`
    FOREIGN KEY (`user_id`) REFERENCES `u799987132_ucn_fmrc_db`.`users` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A fresh installation has seven columns, including workspace.
-- If an older table has six columns, run the workspace upgrade SQL separately.
SHOW TABLES FROM `u799987132_ucn_fmrc_db` LIKE 'user_portal_preferences';
SHOW COLUMNS FROM `u799987132_ucn_fmrc_db`.`user_portal_preferences`;
