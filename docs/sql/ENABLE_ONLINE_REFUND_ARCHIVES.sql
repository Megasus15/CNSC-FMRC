-- In phpMyAdmin, select the FMRC application's database before importing this file.
-- Additive MySQL/MariaDB patch; safe to repeat after a partial import.
-- Only nullable archive metadata is added. Payment/refund values and statuses stay intact.
-- This file does not write to Laravel's migrations table.

SET @fmrc_archive_database = DATABASE();
SELECT @fmrc_archive_database AS selected_database;

SET @fmrc_archive_sql = IF(
    EXISTS (SELECT 1 FROM information_schema.COLUMNS
        WHERE BINARY TABLE_SCHEMA = BINARY @fmrc_archive_database AND TABLE_NAME = 'payments'
            AND COLUMN_NAME = 'online_refund_archived_at'),
    'SELECT ''Archive date column already exists'' AS archive_setup',
    'ALTER TABLE `payments` ADD COLUMN `online_refund_archived_at` TIMESTAMP NULL DEFAULT NULL'
);
PREPARE fmrc_archive_statement FROM @fmrc_archive_sql;
EXECUTE fmrc_archive_statement;
DEALLOCATE PREPARE fmrc_archive_statement;

SET @fmrc_archive_sql = IF(
    EXISTS (SELECT 1 FROM information_schema.COLUMNS
        WHERE BINARY TABLE_SCHEMA = BINARY @fmrc_archive_database AND TABLE_NAME = 'payments'
            AND COLUMN_NAME = 'online_refund_archived_by'),
    'SELECT ''Archive actor column already exists'' AS archive_setup',
    'ALTER TABLE `payments` ADD COLUMN `online_refund_archived_by` BIGINT UNSIGNED NULL DEFAULT NULL'
);
PREPARE fmrc_archive_statement FROM @fmrc_archive_sql;
EXECUTE fmrc_archive_statement;
DEALLOCATE PREPARE fmrc_archive_statement;

SET @fmrc_archive_sql = IF(
    EXISTS (SELECT 1 FROM information_schema.STATISTICS
        WHERE BINARY TABLE_SCHEMA = BINARY @fmrc_archive_database AND TABLE_NAME = 'payments'
            AND COLUMN_NAME = 'online_refund_archived_at' AND SEQ_IN_INDEX = 1),
    'SELECT ''Archive date index already exists'' AS archive_setup',
    'ALTER TABLE `payments` ADD INDEX `payments_online_refund_archived_at_index` (`online_refund_archived_at`)'
);
PREPARE fmrc_archive_statement FROM @fmrc_archive_sql;
EXECUTE fmrc_archive_statement;
DEALLOCATE PREPARE fmrc_archive_statement;

SET @fmrc_archive_sql = IF(
    EXISTS (SELECT 1 FROM information_schema.STATISTICS
        WHERE BINARY TABLE_SCHEMA = BINARY @fmrc_archive_database AND TABLE_NAME = 'payments'
            AND COLUMN_NAME = 'online_refund_archived_by' AND SEQ_IN_INDEX = 1),
    'SELECT ''Archive actor index already exists'' AS archive_setup',
    'ALTER TABLE `payments` ADD INDEX `payments_online_refund_archived_by_foreign` (`online_refund_archived_by`)'
);
PREPARE fmrc_archive_statement FROM @fmrc_archive_sql;
EXECUTE fmrc_archive_statement;
DEALLOCATE PREPARE fmrc_archive_statement;

SET @fmrc_archive_sql = IF(
    EXISTS (SELECT 1 FROM information_schema.KEY_COLUMN_USAGE
        WHERE BINARY TABLE_SCHEMA = BINARY @fmrc_archive_database AND TABLE_NAME = 'payments'
            AND COLUMN_NAME = 'online_refund_archived_by'
            AND BINARY REFERENCED_TABLE_SCHEMA = BINARY @fmrc_archive_database
            AND REFERENCED_TABLE_NAME = 'users' AND REFERENCED_COLUMN_NAME = 'id'),
    'SELECT ''Archive actor reference already exists'' AS archive_setup',
    'ALTER TABLE `payments` ADD CONSTRAINT `payments_online_refund_archived_by_foreign` FOREIGN KEY (`online_refund_archived_by`) REFERENCES `users` (`id`) ON DELETE SET NULL'
);
PREPARE fmrc_archive_statement FROM @fmrc_archive_sql;
EXECUTE fmrc_archive_statement;
DEALLOCATE PREPARE fmrc_archive_statement;

SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
FROM information_schema.COLUMNS
WHERE BINARY TABLE_SCHEMA = BINARY @fmrc_archive_database AND TABLE_NAME = 'payments'
    AND COLUMN_NAME IN ('online_refund_archived_at', 'online_refund_archived_by')
ORDER BY COLUMN_NAME;

-- After uploading PHP files, clear Laravel caches when Terminal/SSH is available:
-- php artisan optimize:clear
-- Reload Admin/Staff Orders to load the matching frontend/API release.
