-- Hostinger: set the fallback for new preference rows to Light.
-- Re-running is safe. Existing saved appearance choices remain unchanged.
ALTER TABLE `u799987132_ucn_fmrc_db`.`user_portal_preferences`
  ALTER COLUMN `theme` SET DEFAULT 'light';

SHOW COLUMNS FROM `u799987132_ucn_fmrc_db`.`user_portal_preferences`
  LIKE 'theme';
