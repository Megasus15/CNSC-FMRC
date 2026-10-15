-- STAGING ONLY: UCN-FMRC payment ledger deployment.
-- Export a full database backup first. Keep PAYMONGO_ENABLED=false.
-- Adds payment ledger schema; does not modify existing payment records.
-- Migration history will be recorded separately after successful verification.
USE `u799987132_fmrc_staging`;

ALTER TABLE `u799987132_fmrc_staging`.`payments`
  ADD COLUMN IF NOT EXISTS `gateway` VARCHAR(255) NULL,
  ADD INDEX IF NOT EXISTS `payments_gateway_index` (`gateway`);

CREATE TABLE IF NOT EXISTS `u799987132_fmrc_staging`.`payment_submissions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `customer_id` BIGINT UNSIGNED NOT NULL,
  `request_key` VARCHAR(80) NOT NULL,
  `payload_hash` VARCHAR(64) NOT NULL,
  `order_id` BIGINT UNSIGNED NOT NULL,
  `created_at` TIMESTAMP NULL DEFAULT NULL,
  `updated_at` TIMESTAMP NULL DEFAULT NULL,
  UNIQUE KEY `payment_submissions_customer_id_request_key_unique` (`customer_id`, `request_key`),
  CONSTRAINT `payment_submissions_customer_id_foreign` FOREIGN KEY (`customer_id`) REFERENCES `u799987132_fmrc_staging`.`users` (`id`),
  CONSTRAINT `payment_submissions_order_id_foreign` FOREIGN KEY (`order_id`) REFERENCES `u799987132_fmrc_staging`.`orders` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `u799987132_fmrc_staging`.`payment_attempts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `payment_id` BIGINT UNSIGNED NOT NULL,
  `token` CHAR(36) NOT NULL,
  `checkout_id` VARCHAR(255) NULL,
  `provider_payment_id` VARCHAR(255) NULL,
  `checkout_url` TEXT NULL,
  `api_version` VARCHAR(255) NOT NULL DEFAULT 'v2',
  `livemode` TINYINT(1) NOT NULL,
  `amount_centavos` BIGINT UNSIGNED NOT NULL,
  `currency` VARCHAR(3) NOT NULL DEFAULT 'PHP',
  `app_context` VARCHAR(255) NOT NULL DEFAULT '',
  `status` VARCHAR(255) NOT NULL DEFAULT 'creating',
  `exception` VARCHAR(255) NULL,
  `expires_at` TIMESTAMP NULL DEFAULT NULL,
  `confirmed_at` TIMESTAMP NULL DEFAULT NULL,
  `checked_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT NULL,
  `updated_at` TIMESTAMP NULL DEFAULT NULL,
  `checkout_method` VARCHAR(20) NOT NULL DEFAULT 'gcash',
  UNIQUE KEY `payment_attempts_token_unique` (`token`),
  UNIQUE KEY `payment_attempts_checkout_id_unique` (`checkout_id`),
  UNIQUE KEY `payment_attempts_provider_payment_id_unique` (`provider_payment_id`),
  KEY `payment_attempts_status_index` (`status`),
  CONSTRAINT `payment_attempts_payment_id_foreign` FOREIGN KEY (`payment_id`) REFERENCES `u799987132_fmrc_staging`.`payments` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `u799987132_fmrc_staging`.`payment_receipts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `payment_id` BIGINT UNSIGNED NOT NULL,
  `attempt_id` BIGINT UNSIGNED NOT NULL,
  `provider_payment_id` VARCHAR(255) NOT NULL,
  `amount_centavos` BIGINT UNSIGNED NOT NULL,
  `livemode` TINYINT(1) NOT NULL,
  `confirmed_at` TIMESTAMP NOT NULL,
  `created_at` TIMESTAMP NULL DEFAULT NULL,
  `updated_at` TIMESTAMP NULL DEFAULT NULL,
  `source_type` VARCHAR(20) NOT NULL DEFAULT 'gcash',
  UNIQUE KEY `payment_receipts_provider_payment_id_unique` (`provider_payment_id`),
  CONSTRAINT `payment_receipts_payment_id_foreign` FOREIGN KEY (`payment_id`) REFERENCES `u799987132_fmrc_staging`.`payments` (`id`),
  CONSTRAINT `payment_receipts_attempt_id_foreign` FOREIGN KEY (`attempt_id`) REFERENCES `u799987132_fmrc_staging`.`payment_attempts` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `u799987132_fmrc_staging`.`payment_webhook_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `event_key` VARCHAR(100) NOT NULL,
  `event_type` VARCHAR(255) NOT NULL,
  `resource_id` VARCHAR(255) NULL,
  `attempt_token` VARCHAR(255) NULL,
  `livemode` TINYINT(1) NOT NULL,
  `status` VARCHAR(255) NOT NULL DEFAULT 'pending',
  `tries` INT UNSIGNED NOT NULL DEFAULT 0,
  `processed_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT NULL,
  `updated_at` TIMESTAMP NULL DEFAULT NULL,
  UNIQUE KEY `payment_webhook_events_event_key_unique` (`event_key`),
  KEY `payment_webhook_events_status_index` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `u799987132_fmrc_staging`.`payment_refunds` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `payment_id` BIGINT UNSIGNED NOT NULL,
  `token` CHAR(36) NOT NULL,
  `provider_payment_id` VARCHAR(255) NOT NULL,
  `order_return_id` BIGINT UNSIGNED NULL,
  `checked_at` TIMESTAMP NULL DEFAULT NULL,
  `requested_by` BIGINT UNSIGNED NOT NULL,
  `approved_by` BIGINT UNSIGNED NULL,
  `amount_centavos` BIGINT UNSIGNED NOT NULL,
  `reason` VARCHAR(500) NOT NULL,
  `livemode` TINYINT(1) NOT NULL,
  `provider_refund_id` VARCHAR(255) NULL,
  `status` VARCHAR(255) NOT NULL DEFAULT 'requested',
  `confirmed_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT NULL,
  `updated_at` TIMESTAMP NULL DEFAULT NULL,
  UNIQUE KEY `payment_refunds_token_unique` (`token`),
  UNIQUE KEY `payment_refunds_provider_refund_id_unique` (`provider_refund_id`),
  KEY `payment_refunds_status_index` (`status`),
  CONSTRAINT `payment_refunds_payment_id_foreign` FOREIGN KEY (`payment_id`) REFERENCES `u799987132_fmrc_staging`.`payments` (`id`),
  CONSTRAINT `payment_refunds_order_return_id_foreign` FOREIGN KEY (`order_return_id`) REFERENCES `u799987132_fmrc_staging`.`order_returns` (`id`),
  CONSTRAINT `payment_refunds_requested_by_foreign` FOREIGN KEY (`requested_by`) REFERENCES `u799987132_fmrc_staging`.`users` (`id`),
  CONSTRAINT `payment_refunds_approved_by_foreign` FOREIGN KEY (`approved_by`) REFERENCES `u799987132_fmrc_staging`.`users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Read-only final verification. Expect six tables including the existing payments table.
SHOW TABLES FROM `u799987132_fmrc_staging` LIKE 'payment%';
SHOW COLUMNS FROM `u799987132_fmrc_staging`.`payments` LIKE 'gateway';
SHOW COLUMNS FROM `u799987132_fmrc_staging`.`payment_attempts` LIKE 'checkout_method';
SHOW COLUMNS FROM `u799987132_fmrc_staging`.`payment_receipts` LIKE 'source_type';
