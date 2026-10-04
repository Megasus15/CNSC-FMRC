-- Hostinger: run once in phpMyAdmin after installing user_portal_preferences.
-- Adds storage for each account's sidebar width, title, and fitted logo.
-- Existing accounts and appearance preferences are retained.
-- If workspace already appears in SHOW COLUMNS, skip the ALTER statement.

ALTER TABLE `u799987132_ucn_fmrc_db`.`user_portal_preferences`
  ADD COLUMN `workspace` JSON NULL;

SHOW COLUMNS FROM `u799987132_ucn_fmrc_db`.`user_portal_preferences`
  LIKE 'workspace';
