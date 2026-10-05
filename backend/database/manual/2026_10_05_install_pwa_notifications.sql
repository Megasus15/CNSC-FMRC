-- FMRC apps: additive installer for the existing Hostinger database shown in hPanel.
-- Export a database backup first. Paste this entire file into phpMyAdmin's SQL tab.
-- Do not import a local database dump or replace existing FMRC tables.
-- For staging, replace every occurrence of u799987132_ucn_fmrc_db with its database name.
-- Existing PWA tables are retained; this installer does not repair partial/older schemas.
-- Leave phpMyAdmin's stop-on-error setting enabled; do not record a failed installation.

CREATE TABLE IF NOT EXISTS `u799987132_ucn_fmrc_db`.`pwa_subscriptions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `app` VARCHAR(16) NOT NULL,
  `user_id` BIGINT UNSIGNED NULL,
  `role` VARCHAR(16) NULL,
  `endpoint_hash` CHAR(64) NOT NULL,
  `endpoint` TEXT NOT NULL,
  `p256dh` TEXT NOT NULL,
  `auth` TEXT NOT NULL,
  `credential_hash` CHAR(64) NOT NULL,
  `public_alerts` TINYINT(1) NOT NULL DEFAULT 0,
  `account_alerts` TINYINT(1) NOT NULL DEFAULT 0,
  `last_seen_at` TIMESTAMP NOT NULL,
  `created_at` TIMESTAMP NULL,
  `updated_at` TIMESTAMP NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `pwa_subscriptions_endpoint_hash_unique` (`endpoint_hash`),
  KEY `pwa_subscriptions_app_user_id_index` (`app`, `user_id`),
  CONSTRAINT `pwa_subscriptions_user_id_foreign` FOREIGN KEY (`user_id`)
    REFERENCES `u799987132_ucn_fmrc_db`.`users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `u799987132_ucn_fmrc_db`.`customer_notifications` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NULL,
  `type` VARCHAR(32) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `message` TEXT NOT NULL,
  `target` VARCHAR(255) NOT NULL,
  `event_key` VARCHAR(191) NOT NULL,
  `published_at` TIMESTAMP NOT NULL,
  `created_at` TIMESTAMP NULL,
  `updated_at` TIMESTAMP NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `customer_notifications_event_key_unique` (`event_key`),
  KEY `customer_notifications_published_at_index` (`published_at`),
  KEY `customer_notifications_user_id_id_index` (`user_id`, `id`),
  CONSTRAINT `customer_notifications_user_id_foreign` FOREIGN KEY (`user_id`)
    REFERENCES `u799987132_ucn_fmrc_db`.`users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `u799987132_ucn_fmrc_db`.`customer_notification_reads` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `notification_id` BIGINT UNSIGNED NOT NULL,
  `read_at` TIMESTAMP NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `customer_notification_reads_user_id_notification_id_unique` (`user_id`, `notification_id`),
  CONSTRAINT `customer_notification_reads_user_id_foreign` FOREIGN KEY (`user_id`)
    REFERENCES `u799987132_ucn_fmrc_db`.`users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `customer_notification_reads_notification_id_foreign` FOREIGN KEY (`notification_id`)
    REFERENCES `u799987132_ucn_fmrc_db`.`customer_notifications` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `u799987132_ucn_fmrc_db`.`pwa_delivery_outbox` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `subscription_id` BIGINT UNSIGNED NOT NULL,
  `event_key` VARCHAR(191) NOT NULL,
  `audience` VARCHAR(32) NOT NULL,
  `audience_user_id` BIGINT UNSIGNED NULL,
  `payload` JSON NOT NULL,
  `attempts` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `available_at` TIMESTAMP NOT NULL,
  `claimed_at` TIMESTAMP NULL,
  `delivered_at` TIMESTAMP NULL,
  `discarded_at` TIMESTAMP NULL,
  `last_error` VARCHAR(80) NULL,
  `created_at` TIMESTAMP NULL,
  `updated_at` TIMESTAMP NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `pwa_delivery_outbox_subscription_id_event_key_unique` (`subscription_id`, `event_key`),
  KEY `pwa_delivery_outbox_available_at_index` (`available_at`),
  CONSTRAINT `pwa_delivery_outbox_subscription_id_foreign` FOREIGN KEY (`subscription_id`)
    REFERENCES `u799987132_ucn_fmrc_db`.`pwa_subscriptions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `u799987132_ucn_fmrc_db`.`pwa_runtime` (
  `key` VARCHAR(255) NOT NULL,
  `value` TIMESTAMP NOT NULL,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Record this migration only after all five CREATE statements finish successfully.
INSERT INTO `u799987132_ucn_fmrc_db`.`migrations` (`migration`, `batch`)
SELECT '2026_10_05_000001_create_pwa_notifications',
       COALESCE((SELECT MAX(`batch`) FROM `u799987132_ucn_fmrc_db`.`migrations`), 0) + 1
WHERE NOT EXISTS (
  SELECT 1 FROM `u799987132_ucn_fmrc_db`.`migrations`
  WHERE `migration` = '2026_10_05_000001_create_pwa_notifications'
);

-- Expected: five rows. No keys, subscriptions or phone delivery are enabled here.
SELECT `TABLE_NAME` FROM `information_schema`.`TABLES`
WHERE `TABLE_SCHEMA` = 'u799987132_ucn_fmrc_db'
  AND `TABLE_NAME` IN ('pwa_runtime', 'pwa_subscriptions', 'customer_notifications',
                      'customer_notification_reads', 'pwa_delivery_outbox')
ORDER BY `TABLE_NAME`;
