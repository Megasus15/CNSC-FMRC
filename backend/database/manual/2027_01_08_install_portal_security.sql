-- Import with phpMyAdmin into the LIVE Laravel database before uploading the
-- portal-security application files. Keep this SQL outside public_html.
-- The two DDL operations and migration registrations can be run again safely.
-- Back up the live database first. No account or session rows are changed here.
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS `login_failure_states` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `scope_key` VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` BIGINT UNSIGNED NULL,
  `failed_attempts` INT UNSIGNED NOT NULL DEFAULT 0,
  `lockout_count` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `locked_until` TIMESTAMP NULL DEFAULT NULL,
  `ticket_hash` VARCHAR(64) COLLATE utf8mb4_unicode_ci NULL,
  `ticket_ciphertext` TEXT COLLATE utf8mb4_unicode_ci NULL,
  `last_failed_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT NULL,
  `updated_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `login_failure_states_scope_key_unique` (`scope_key`),
  UNIQUE KEY `login_failure_states_ticket_hash_unique` (`ticket_hash`),
  KEY `login_failure_states_user_id_index` (`user_id`),
  KEY `login_failure_states_user_id_last_failed_at_index` (`user_id`, `last_failed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @fmrc_sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'personal_access_tokens'
      AND column_name = 'last_interaction_at'
  ),
  'SELECT ''last_interaction_at already installed'' AS status',
  'ALTER TABLE `personal_access_tokens` ADD COLUMN `last_interaction_at` TIMESTAMP NULL DEFAULT NULL AFTER `last_used_at`'
);
PREPARE fmrc_stmt FROM @fmrc_sql;
EXECUTE fmrc_stmt;
DEALLOCATE PREPARE fmrc_stmt;

-- Register exactly these two migrations only after their schema is present.
-- This avoids Laravel trying to recreate the table/column on a later migrate.
SET @fmrc_login_schema_ready = (
  SELECT COUNT(*) = 11 FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'login_failure_states'
    AND column_name IN ('id', 'scope_key', 'user_id', 'failed_attempts',
      'lockout_count', 'locked_until', 'ticket_hash', 'ticket_ciphertext',
      'last_failed_at', 'created_at', 'updated_at')
);
SET @fmrc_token_schema_ready = (
  SELECT COUNT(*) = 1 FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'personal_access_tokens'
    AND column_name = 'last_interaction_at'
);
SET @fmrc_batch = (SELECT COALESCE(MAX(`batch`), 0) + 1 FROM `migrations`);
INSERT INTO `migrations` (`migration`, `batch`)
SELECT '2027_01_08_000000_create_login_failure_states_table', @fmrc_batch
WHERE @fmrc_login_schema_ready = 1
  AND NOT EXISTS (
    SELECT 1 FROM `migrations`
    WHERE `migration` = '2027_01_08_000000_create_login_failure_states_table'
  );
INSERT INTO `migrations` (`migration`, `batch`)
SELECT '2027_01_08_000001_add_last_interaction_at_to_personal_access_tokens_table', @fmrc_batch
WHERE @fmrc_token_schema_ready = 1
  AND NOT EXISTS (
    SELECT 1 FROM `migrations`
    WHERE `migration` = '2027_01_08_000001_add_last_interaction_at_to_personal_access_tokens_table'
  );

SELECT CASE
  WHEN @fmrc_login_schema_ready = 1 AND @fmrc_token_schema_ready = 1
    AND (SELECT COUNT(*) FROM `migrations` WHERE `migration` IN (
      '2027_01_08_000000_create_login_failure_states_table',
      '2027_01_08_000001_add_last_interaction_at_to_personal_access_tokens_table'
    )) = 2
  THEN 'READY: both portal-security migrations installed'
  ELSE 'STOP: inspect the schema and migrations before uploading code'
END AS release_status;

SELECT `migration`, `batch` FROM `migrations`
WHERE `migration` IN (
  '2027_01_08_000000_create_login_failure_states_table',
  '2027_01_08_000001_add_last_interaction_at_to_personal_access_tokens_table'
)
ORDER BY `migration`;
