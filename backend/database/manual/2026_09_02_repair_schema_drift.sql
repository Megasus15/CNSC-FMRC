-- =====================================================================
--  FMRC production - repair the schema drift  -  2026-09-02
-- =====================================================================
--  WHAT THIS IS FOR
--
--  The live database is missing columns that the deployed PHP already
--  knows about. Two are already doing visible damage:
--
--    * `products`.`category` is the one thing the Dashboard's "Sales by
--      Category" card reads that its working neighbours do not, which is
--      why that single card reports itself unavailable while every other
--      figure on the page is live.
--
--    * `users`.`role` is what tells admin, staff and customer apart. A
--      `SELECT role FROM users` on the live database answered
--      "#1054 - Unknown column 'role'", which is how this was found.
--
--  Rather than chase them one at a time, this script brings all eleven
--  tables the back office reads up to the shape the deployed code was
--  written against: 240 columns, each added only if it is absent.
--
--  HOW TO RUN IT
--
--  1. Run 2026_09_02_diagnose_schema_drift.sql first and keep its
--     result 6 -- that is the list this script is going to fix.
--  2. Hostinger hPanel -> Databases -> phpMyAdmin -> pick the FMRC
--     database (u799987132_ucn_fmrc_db) -> SQL tab -> paste this whole
--     file -> Go.
--  3. Read the two reports at the bottom before leaving the page.
--
--  `users`.`role` IS DELIBERATELY NOT CREATED HERE
--
--  If that column is absent, adding it would give every existing
--  account the column default -- 'customer' -- including yours, and the
--  Admin/Staff portal would then refuse your own sign-in. Creating it
--  safely means deciding which accounts are admin and staff in the same
--  breath, so it lives in its own file:
--      2026_09_02_restore_users_role.sql
--  This script only widens the ENUM when the column already exists but
--  has no 'staff' value, which is the harmless half of that job. The
--  final report says plainly which case you are in.
--
--  SAFETY
--
--  Additive only. It creates columns; it never drops or renames one,
--  never changes the type of an existing column, and writes no row of
--  data. Every step checks INFORMATION_SCHEMA first, so re-running the
--  whole file changes nothing the second time. A table that does not
--  exist at all is skipped rather than erroring. The checks are written
--  out by hand instead of using ADD COLUMN IF NOT EXISTS so the file
--  works on both MySQL 8 and MariaDB.
-- =====================================================================
-- ---------------------------------------------------------------------
--  BEFORE. Read from the catalogue, so it cannot fail on a broken
--  table. `missing` is what this script is about to add.
-- ---------------------------------------------------------------------
SELECT
    w.`table_name`                                            AS `table_name`,
    w.`expected`                                              AS `expected`,
    IFNULL(a.`present`, 0)                                    AS `present_before`,
    w.`expected` - IFNULL(a.`present`, 0)                     AS `missing`
FROM (
              SELECT 'users'             AS `table_name`, 21 AS `expected`
    UNION ALL SELECT 'products',            23
    UNION ALL SELECT 'orders',              49
    UNION ALL SELECT 'order_items',         11
    UNION ALL SELECT 'payments',            14
    UNION ALL SELECT 'walk_in_orders',      25
    UNION ALL SELECT 'order_returns',       43
    UNION ALL SELECT 'inventory_items',     15
    UNION ALL SELECT 'customer_messages',   12
    UNION ALL SELECT 'appointments',        26
    UNION ALL SELECT 'report_generations',  13
) AS w
LEFT JOIN (
    SELECT c.TABLE_NAME AS `table_name`, COUNT(*) AS `present`
      FROM INFORMATION_SCHEMA.COLUMNS c
     WHERE c.TABLE_SCHEMA = DATABASE()
     GROUP BY c.TABLE_NAME
) AS a ON a.`table_name` = w.`table_name`
ORDER BY `missing` DESC, w.`table_name`;
-- ---------------------------------------------------------------------
--  Helpers. Dropped again at the bottom of the file.
--
--  `fmrc_add_column` is the same procedure 2026_08_24 used to add 32
--  columns to this database, unchanged.
-- ---------------------------------------------------------------------
DELIMITER $$

DROP PROCEDURE IF EXISTS fmrc_add_column $$
DROP PROCEDURE IF EXISTS fmrc_widen_enum $$

CREATE PROCEDURE fmrc_add_column(
    IN p_table      VARCHAR(64),
    IN p_column     VARCHAR(64),
    IN p_definition TEXT,
    IN p_after      VARCHAR(64)
)
BEGIN
    DECLARE v_has_table  INT DEFAULT 0;
    DECLARE v_has_column INT DEFAULT 0;
    DECLARE v_has_after  INT DEFAULT 0;

    SELECT COUNT(*) INTO v_has_table
      FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table;

    SELECT COUNT(*) INTO v_has_column
      FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_column;

    -- Column order is cosmetic, so a missing AFTER target must not abort the
    -- run: the column is simply appended at the end of the table instead.
    SELECT COUNT(*) INTO v_has_after
      FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_after;

    IF v_has_table > 0 AND v_has_column = 0 THEN
        SET @fmrc_sql = CONCAT(
            'ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition,
            IF(v_has_after > 0, CONCAT(' AFTER `', p_after, '`'), '')
        );
        PREPARE fmrc_stmt FROM @fmrc_sql;
        EXECUTE fmrc_stmt;
        DEALLOCATE PREPARE fmrc_stmt;
    END IF;
END $$

-- Append one value to the END of an existing ENUM. MySQL 8 treats that as a
-- metadata-only change: stored rows keep both their value and their numeric
-- index, so nothing is rewritten. The new type is built FROM the live one and
-- COLLATE, nullability and DEFAULT are copied back verbatim, so this cannot
-- quietly alter anything it was not asked to.
--
-- Skipped when the column is absent, when it is not an ENUM (a VARCHAR
-- already accepts any string), or when the value is already listed.
CREATE PROCEDURE fmrc_widen_enum(
    IN p_table  VARCHAR(64),
    IN p_column VARCHAR(64),
    IN p_value  VARCHAR(64)
)
BEGIN
    DECLARE v_type      TEXT    DEFAULT NULL;
    DECLARE v_nullable  VARCHAR(3) DEFAULT NULL;
    DECLARE v_default   TEXT    DEFAULT NULL;
    DECLARE v_collate   VARCHAR(64) DEFAULT NULL;

    SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLLATION_NAME
      INTO v_type, v_nullable, v_default, v_collate
      FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_column;

    IF v_type IS NOT NULL
       AND LOWER(LEFT(v_type, 5)) = 'enum('
       AND LOCATE(CONCAT('''', LOWER(p_value), ''''), LOWER(v_type)) = 0 THEN
        SET @fmrc_sql = CONCAT(
            'ALTER TABLE `', p_table, '` MODIFY `', p_column, '` ',
            LEFT(v_type, CHAR_LENGTH(v_type) - 1), ',''', p_value, ''')',
            IFNULL(CONCAT(' COLLATE ', v_collate), ''),
            IF(v_nullable = 'YES', ' NULL', ' NOT NULL'),
            IFNULL(CONCAT(' DEFAULT ''', v_default, ''''), '')
        );
        PREPARE fmrc_stmt FROM @fmrc_sql;
        EXECUTE fmrc_stmt;
        DEALLOCATE PREPARE fmrc_stmt;
    END IF;
END $$

DELIMITER ;

-- =====================================================================
--  The columns. Each line adds one column if it is absent and does
--  nothing if it is already there.
-- =====================================================================
-- ---------------------------------------------------------------------
--  `users`
-- ---------------------------------------------------------------------
CALL fmrc_add_column('users', 'name', 'varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL', 'id');
CALL fmrc_add_column('users', 'username', 'varchar(255) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'name');
CALL fmrc_add_column('users', 'email', 'varchar(255) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'username');
CALL fmrc_add_column('users', 'email_verified_at', 'timestamp NULL DEFAULT NULL', 'email');
CALL fmrc_add_column('users', 'password', 'varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL', 'email_verified_at');
CALL fmrc_add_column('users', 'phone_number', 'varchar(30) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'role');
CALL fmrc_add_column('users', 'address_line', 'varchar(500) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'phone_number');
CALL fmrc_add_column('users', 'address_details', 'varchar(255) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'address_line');
CALL fmrc_add_column('users', 'barangay', 'varchar(120) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'address_details');
CALL fmrc_add_column('users', 'city_municipality', 'varchar(120) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'barangay');
CALL fmrc_add_column('users', 'province', 'varchar(120) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'city_municipality');
CALL fmrc_add_column('users', 'postal_code', 'varchar(10) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'province');
CALL fmrc_add_column('users', 'department', 'varchar(120) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'postal_code');
CALL fmrc_add_column('users', 'customer_type', 'varchar(120) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'department');
CALL fmrc_add_column('users', 'remember_token', 'varchar(100) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'customer_type');
CALL fmrc_add_column('users', 'created_at', 'timestamp NULL DEFAULT NULL', 'remember_token');
CALL fmrc_add_column('users', 'updated_at', 'timestamp NULL DEFAULT NULL', 'created_at');
CALL fmrc_add_column('users', 'signed_with_google', 'tinyint(1) NOT NULL DEFAULT ''0''', 'updated_at');
CALL fmrc_add_column('users', 'has_custom_password', 'tinyint(1) NOT NULL DEFAULT ''1''', 'signed_with_google');

-- ---------------------------------------------------------------------
--  `products`
-- ---------------------------------------------------------------------
CALL fmrc_add_column('products', 'sku', 'varchar(80) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'id');
CALL fmrc_add_column('products', 'name', 'varchar(180) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'sku');
CALL fmrc_add_column('products', 'category', 'varchar(120) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'name');
CALL fmrc_add_column('products', 'code', 'varchar(255) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'category');
CALL fmrc_add_column('products', 'description', 'text COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'code');
CALL fmrc_add_column('products', 'image_url', 'longtext COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'description');
CALL fmrc_add_column('products', 'stock', 'int unsigned NOT NULL DEFAULT ''0''', 'image_url');
CALL fmrc_add_column('products', 'price', 'decimal(10,2) NOT NULL DEFAULT ''0.00''', 'stock');
CALL fmrc_add_column('products', 'stock_status', 'enum(''in_stock'',''out_of_stock'') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''in_stock''', 'price');
CALL fmrc_add_column('products', 'unit_price', 'decimal(12,2) NOT NULL DEFAULT ''0.00''', 'stock_status');
CALL fmrc_add_column('products', 'is_active', 'tinyint(1) NOT NULL DEFAULT ''1''', 'unit_price');
CALL fmrc_add_column('products', 'is_blocked', 'tinyint(1) NOT NULL DEFAULT ''0''', 'is_active');
CALL fmrc_add_column('products', 'image_data', 'longtext COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'is_blocked');
CALL fmrc_add_column('products', 'summary', 'text COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'image_data');
CALL fmrc_add_column('products', 'details_chips', 'json NULL DEFAULT NULL', 'summary');
CALL fmrc_add_column('products', 'availability', 'json NULL DEFAULT NULL', 'details_chips');
CALL fmrc_add_column('products', 'detail_summary', 'text COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'availability');
CALL fmrc_add_column('products', 'availability_notes', 'text COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'detail_summary');
CALL fmrc_add_column('products', 'recommended_for', 'text COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'availability_notes');
CALL fmrc_add_column('products', 'rating', 'decimal(3,1) NULL DEFAULT ''0.0''', 'recommended_for');
CALL fmrc_add_column('products', 'created_at', 'timestamp NULL DEFAULT NULL', 'rating');
CALL fmrc_add_column('products', 'updated_at', 'timestamp NULL DEFAULT NULL', 'created_at');

-- ---------------------------------------------------------------------
--  `orders`
-- ---------------------------------------------------------------------
CALL fmrc_add_column('orders', 'order_no', 'varchar(40) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'id');
CALL fmrc_add_column('orders', 'customer_id', 'bigint unsigned NULL DEFAULT NULL', 'order_no');
CALL fmrc_add_column('orders', 'customer_name', 'varchar(160) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'customer_id');
CALL fmrc_add_column('orders', 'customer_contact', 'varchar(180) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'customer_name');
CALL fmrc_add_column('orders', 'quantity', 'int unsigned NOT NULL DEFAULT ''1''', 'customer_contact');
CALL fmrc_add_column('orders', 'subtotal', 'decimal(12,2) NOT NULL DEFAULT ''0.00''', 'quantity');
CALL fmrc_add_column('orders', 'total', 'decimal(12,2) NOT NULL DEFAULT ''0.00''', 'subtotal');
CALL fmrc_add_column('orders', 'payment_method', 'varchar(30) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'total');
CALL fmrc_add_column('orders', 'payment_reference', 'varchar(180) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'payment_method');
CALL fmrc_add_column('orders', 'payment_due_at', 'timestamp NULL DEFAULT NULL', 'payment_reference');
CALL fmrc_add_column('orders', 'fulfillment_type', 'enum(''pickup'',''delivery'') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''delivery''', 'payment_due_at');
CALL fmrc_add_column('orders', 'delivery_recipient_name', 'varchar(160) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'fulfillment_type');
CALL fmrc_add_column('orders', 'delivery_contact_no', 'varchar(40) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'delivery_recipient_name');
CALL fmrc_add_column('orders', 'delivery_street', 'varchar(255) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'delivery_contact_no');
CALL fmrc_add_column('orders', 'delivery_barangay', 'varchar(120) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'delivery_street');
CALL fmrc_add_column('orders', 'delivery_city', 'varchar(120) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'delivery_barangay');
CALL fmrc_add_column('orders', 'delivery_province', 'varchar(120) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'delivery_city');
CALL fmrc_add_column('orders', 'delivery_postal_code', 'varchar(10) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'delivery_province');
CALL fmrc_add_column('orders', 'delivery_landmark', 'varchar(255) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'delivery_postal_code');
CALL fmrc_add_column('orders', 'delivery_lat', 'decimal(10,7) NULL DEFAULT NULL', 'delivery_landmark');
CALL fmrc_add_column('orders', 'delivery_lng', 'decimal(10,7) NULL DEFAULT NULL', 'delivery_lat');
CALL fmrc_add_column('orders', 'pickup_code', 'varchar(12) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'delivery_lng');
CALL fmrc_add_column('orders', 'pickup_ready_at', 'timestamp NULL DEFAULT NULL', 'pickup_code');
CALL fmrc_add_column('orders', 'picked_up_at', 'timestamp NULL DEFAULT NULL', 'pickup_ready_at');
CALL fmrc_add_column('orders', 'lifecycle_status', 'enum(''incoming'',''pending'',''rejected'',''completed'',''cancelled'') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''incoming''', 'picked_up_at');
CALL fmrc_add_column('orders', 'customer_stage', 'enum(''to_pay'',''to_ship'',''to_receive'',''completed'') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''to_pay''', 'lifecycle_status');
CALL fmrc_add_column('orders', 'cancel_state', 'enum(''none'',''requested'',''approved'',''declined'') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''none''', 'customer_stage');
CALL fmrc_add_column('orders', 'cancel_reason', 'varchar(40) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'cancel_state');
CALL fmrc_add_column('orders', 'cancel_reason_detail', 'varchar(600) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'cancel_reason');
CALL fmrc_add_column('orders', 'cancel_requested_at', 'timestamp NULL DEFAULT NULL', 'cancel_reason_detail');
CALL fmrc_add_column('orders', 'cancelled_at', 'timestamp NULL DEFAULT NULL', 'cancel_requested_at');
CALL fmrc_add_column('orders', 'cancel_decided_at', 'timestamp NULL DEFAULT NULL', 'cancelled_at');
CALL fmrc_add_column('orders', 'cancel_decided_by_user_id', 'bigint unsigned NULL DEFAULT NULL', 'cancel_decided_at');
CALL fmrc_add_column('orders', 'cancel_decision_note', 'varchar(600) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'cancel_decided_by_user_id');
CALL fmrc_add_column('orders', 'cancel_refund_due', 'tinyint(1) NOT NULL DEFAULT ''0''', 'cancel_decision_note');
CALL fmrc_add_column('orders', 'notes', 'text COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'cancel_refund_due');
CALL fmrc_add_column('orders', 'is_archived', 'tinyint(1) NOT NULL DEFAULT ''0''', 'notes');
CALL fmrc_add_column('orders', 'archived_at', 'timestamp NULL DEFAULT NULL', 'is_archived');
CALL fmrc_add_column('orders', 'courier_name', 'varchar(120) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'archived_at');
CALL fmrc_add_column('orders', 'courier_tracking_no', 'varchar(140) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'courier_name');
CALL fmrc_add_column('orders', 'location_name', 'varchar(160) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'courier_tracking_no');
CALL fmrc_add_column('orders', 'last_known_lat', 'decimal(10,7) NULL DEFAULT NULL', 'location_name');
CALL fmrc_add_column('orders', 'last_known_lng', 'decimal(10,7) NULL DEFAULT NULL', 'last_known_lat');
CALL fmrc_add_column('orders', 'approved_at', 'timestamp NULL DEFAULT NULL', 'last_known_lng');
CALL fmrc_add_column('orders', 'rejected_at', 'timestamp NULL DEFAULT NULL', 'approved_at');
CALL fmrc_add_column('orders', 'completed_at', 'timestamp NULL DEFAULT NULL', 'rejected_at');
CALL fmrc_add_column('orders', 'created_at', 'timestamp NULL DEFAULT NULL', 'completed_at');
CALL fmrc_add_column('orders', 'updated_at', 'timestamp NULL DEFAULT NULL', 'created_at');

-- ---------------------------------------------------------------------
--  `order_items`
-- ---------------------------------------------------------------------
CALL fmrc_add_column('order_items', 'order_id', 'bigint unsigned NULL DEFAULT NULL', 'id');
CALL fmrc_add_column('order_items', 'product_id', 'bigint unsigned NULL DEFAULT NULL', 'order_id');
CALL fmrc_add_column('order_items', 'product_name', 'varchar(180) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'product_id');
CALL fmrc_add_column('order_items', 'product_image_reference', 'varchar(2048) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'product_name');
CALL fmrc_add_column('order_items', 'product_image', 'longtext COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'product_image_reference');
CALL fmrc_add_column('order_items', 'unit_price', 'decimal(12,2) NOT NULL DEFAULT ''0.00''', 'product_image');
CALL fmrc_add_column('order_items', 'quantity', 'int unsigned NOT NULL DEFAULT ''1''', 'unit_price');
CALL fmrc_add_column('order_items', 'line_total', 'decimal(12,2) NOT NULL DEFAULT ''0.00''', 'quantity');
CALL fmrc_add_column('order_items', 'created_at', 'timestamp NULL DEFAULT NULL', 'line_total');
CALL fmrc_add_column('order_items', 'updated_at', 'timestamp NULL DEFAULT NULL', 'created_at');

-- ---------------------------------------------------------------------
--  `payments`
-- ---------------------------------------------------------------------
CALL fmrc_add_column('payments', 'order_id', 'bigint unsigned NULL DEFAULT NULL', 'id');
CALL fmrc_add_column('payments', 'payment_no', 'varchar(40) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'order_id');
CALL fmrc_add_column('payments', 'method', 'varchar(30) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'payment_no');
CALL fmrc_add_column('payments', 'reference', 'varchar(180) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'method');
CALL fmrc_add_column('payments', 'amount', 'decimal(12,2) NOT NULL DEFAULT ''0.00''', 'reference');
CALL fmrc_add_column('payments', 'status', 'enum(''paid'',''pending'',''refunded'') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''pending''', 'amount');
CALL fmrc_add_column('payments', 'submitted_at', 'timestamp NULL DEFAULT NULL', 'status');
CALL fmrc_add_column('payments', 'proof_path', 'varchar(255) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'submitted_at');
CALL fmrc_add_column('payments', 'paid_at', 'timestamp NULL DEFAULT NULL', 'proof_path');
CALL fmrc_add_column('payments', 'refunded_at', 'timestamp NULL DEFAULT NULL', 'paid_at');
CALL fmrc_add_column('payments', 'refund_reference', 'varchar(64) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'refunded_at');
CALL fmrc_add_column('payments', 'created_at', 'timestamp NULL DEFAULT NULL', 'refund_reference');
CALL fmrc_add_column('payments', 'updated_at', 'timestamp NULL DEFAULT NULL', 'created_at');

-- ---------------------------------------------------------------------
--  `walk_in_orders`
-- ---------------------------------------------------------------------
CALL fmrc_add_column('walk_in_orders', 'order_no', 'varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL', 'id');
CALL fmrc_add_column('walk_in_orders', 'customer_name', 'varchar(160) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'order_no');
CALL fmrc_add_column('walk_in_orders', 'address', 'varchar(255) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'customer_name');
CALL fmrc_add_column('walk_in_orders', 'contact_number', 'varchar(40) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'address');
CALL fmrc_add_column('walk_in_orders', 'client_type', 'varchar(80) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'contact_number');
CALL fmrc_add_column('walk_in_orders', 'client_type_other', 'varchar(180) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'client_type');
CALL fmrc_add_column('walk_in_orders', 'agency_organization', 'varchar(180) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'client_type_other');
CALL fmrc_add_column('walk_in_orders', 'project_description', 'varchar(180) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'agency_organization');
CALL fmrc_add_column('walk_in_orders', 'project_description_other', 'varchar(180) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'project_description');
CALL fmrc_add_column('walk_in_orders', 'item_detail', 'varchar(300) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'project_description_other');
CALL fmrc_add_column('walk_in_orders', 'product_id', 'bigint unsigned NULL DEFAULT NULL', 'item_detail');
CALL fmrc_add_column('walk_in_orders', 'unit', 'varchar(50) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'product_id');
CALL fmrc_add_column('walk_in_orders', 'subtotal_cost', 'decimal(12,2) NOT NULL DEFAULT ''0.00''', 'unit');
CALL fmrc_add_column('walk_in_orders', 'order_item', 'varchar(180) COLLATE utf8mb4_unicode_ci NOT NULL', 'subtotal_cost');
CALL fmrc_add_column('walk_in_orders', 'order_date', 'datetime NOT NULL', 'order_item');
CALL fmrc_add_column('walk_in_orders', 'customer', 'varchar(160) COLLATE utf8mb4_unicode_ci NOT NULL', 'order_date');
CALL fmrc_add_column('walk_in_orders', 'payment_method', 'varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL', 'customer');
CALL fmrc_add_column('walk_in_orders', 'total', 'decimal(10,2) NOT NULL DEFAULT ''0.00''', 'payment_method');
CALL fmrc_add_column('walk_in_orders', 'status', 'varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''Pending''', 'total');
CALL fmrc_add_column('walk_in_orders', 'created_by_user_id', 'bigint unsigned NULL DEFAULT NULL', 'status');
CALL fmrc_add_column('walk_in_orders', 'created_at', 'timestamp NULL DEFAULT NULL', 'created_by_user_id');
CALL fmrc_add_column('walk_in_orders', 'updated_at', 'timestamp NULL DEFAULT NULL', 'created_at');
CALL fmrc_add_column('walk_in_orders', 'is_archived', 'tinyint(1) NOT NULL DEFAULT ''0''', 'updated_at');
CALL fmrc_add_column('walk_in_orders', 'archived_at', 'timestamp NULL DEFAULT NULL', 'is_archived');

-- ---------------------------------------------------------------------
--  `order_returns`
-- ---------------------------------------------------------------------
CALL fmrc_add_column('order_returns', 'return_no', 'varchar(40) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'id');
CALL fmrc_add_column('order_returns', 'order_id', 'bigint unsigned NOT NULL', 'return_no');
CALL fmrc_add_column('order_returns', 'order_item_id', 'bigint unsigned NULL DEFAULT NULL', 'order_id');
CALL fmrc_add_column('order_returns', 'customer_id', 'bigint unsigned NULL DEFAULT NULL', 'order_item_id');
CALL fmrc_add_column('order_returns', 'product_id', 'bigint unsigned NULL DEFAULT NULL', 'customer_id');
CALL fmrc_add_column('order_returns', 'product_name', 'varchar(180) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'product_id');
CALL fmrc_add_column('order_returns', 'quantity', 'int unsigned NOT NULL DEFAULT ''1''', 'product_name');
CALL fmrc_add_column('order_returns', 'unit_price', 'decimal(12,2) NOT NULL DEFAULT ''0.00''', 'quantity');
CALL fmrc_add_column('order_returns', 'refund_amount', 'decimal(12,2) NOT NULL DEFAULT ''0.00''', 'unit_price');
CALL fmrc_add_column('order_returns', 'approved_amount', 'decimal(12,2) NULL DEFAULT NULL', 'refund_amount');
CALL fmrc_add_column('order_returns', 'status', 'varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''requested''', 'approved_amount');
CALL fmrc_add_column('order_returns', 'resolution', 'varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''refund_only''', 'status');
CALL fmrc_add_column('order_returns', 'reason', 'varchar(60) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'resolution');
CALL fmrc_add_column('order_returns', 'reason_details', 'text COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'reason');
CALL fmrc_add_column('order_returns', 'media', 'json NULL DEFAULT NULL', 'reason_details');
CALL fmrc_add_column('order_returns', 'courier_name', 'varchar(120) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'media');
CALL fmrc_add_column('order_returns', 'courier_tracking_no', 'varchar(120) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'courier_name');
CALL fmrc_add_column('order_returns', 'refund_method', 'varchar(60) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'courier_tracking_no');
CALL fmrc_add_column('order_returns', 'refund_reference', 'varchar(120) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'refund_method');
CALL fmrc_add_column('order_returns', 'admin_note', 'text COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'refund_reference');
CALL fmrc_add_column('order_returns', 'rejection_reason', 'text COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'admin_note');
CALL fmrc_add_column('order_returns', 'handled_by_user_id', 'bigint unsigned NULL DEFAULT NULL', 'rejection_reason');
CALL fmrc_add_column('order_returns', 'requested_at', 'timestamp NULL DEFAULT NULL', 'handled_by_user_id');
CALL fmrc_add_column('order_returns', 'approved_at', 'timestamp NULL DEFAULT NULL', 'requested_at');
CALL fmrc_add_column('order_returns', 'rejected_at', 'timestamp NULL DEFAULT NULL', 'approved_at');
CALL fmrc_add_column('order_returns', 'shipped_at', 'timestamp NULL DEFAULT NULL', 'rejected_at');
CALL fmrc_add_column('order_returns', 'received_at', 'timestamp NULL DEFAULT NULL', 'shipped_at');
CALL fmrc_add_column('order_returns', 'refunded_at', 'timestamp NULL DEFAULT NULL', 'received_at');
CALL fmrc_add_column('order_returns', 'cancelled_at', 'timestamp NULL DEFAULT NULL', 'refunded_at');
CALL fmrc_add_column('order_returns', 'is_archived', 'tinyint(1) NOT NULL DEFAULT ''0''', 'cancelled_at');
CALL fmrc_add_column('order_returns', 'archived_at', 'timestamp NULL DEFAULT NULL', 'is_archived');
CALL fmrc_add_column('order_returns', 'created_at', 'timestamp NULL DEFAULT NULL', 'archived_at');
CALL fmrc_add_column('order_returns', 'updated_at', 'timestamp NULL DEFAULT NULL', 'created_at');
CALL fmrc_add_column('order_returns', 'reason_detail', 'text COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'updated_at');
CALL fmrc_add_column('order_returns', 'customer_note', 'text COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'reason_detail');
CALL fmrc_add_column('order_returns', 'requested_amount', 'decimal(12,2) NOT NULL DEFAULT ''0.00''', 'customer_note');
CALL fmrc_add_column('order_returns', 'refunded_amount', 'decimal(12,2) NULL DEFAULT NULL', 'requested_amount');
CALL fmrc_add_column('order_returns', 'decision_note', 'text COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'refunded_amount');
CALL fmrc_add_column('order_returns', 'return_courier_name', 'varchar(120) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'decision_note');
CALL fmrc_add_column('order_returns', 'return_tracking_no', 'varchar(140) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'return_courier_name');
CALL fmrc_add_column('order_returns', 'decided_at', 'timestamp NULL DEFAULT NULL', 'return_tracking_no');
CALL fmrc_add_column('order_returns', 'item_received_at', 'timestamp NULL DEFAULT NULL', 'decided_at');

-- ---------------------------------------------------------------------
--  `inventory_items`
-- ---------------------------------------------------------------------
CALL fmrc_add_column('inventory_items', 'category', 'varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL', 'id');
CALL fmrc_add_column('inventory_items', 'item_name', 'varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL', 'category');
CALL fmrc_add_column('inventory_items', 'description', 'varchar(500) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'item_name');
CALL fmrc_add_column('inventory_items', 'unit', 'varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''pcs''', 'description');
CALL fmrc_add_column('inventory_items', 'last_invent', 'int NOT NULL DEFAULT ''0''', 'unit');
CALL fmrc_add_column('inventory_items', 'on_hand', 'int NOT NULL DEFAULT ''0''', 'last_invent');
CALL fmrc_add_column('inventory_items', 'status', 'varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''Good''', 'on_hand');
CALL fmrc_add_column('inventory_items', 'remarks', 'varchar(100) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'status');
CALL fmrc_add_column('inventory_items', 'is_archived', 'tinyint(1) NOT NULL DEFAULT ''0''', 'remarks');
CALL fmrc_add_column('inventory_items', 'archived_at', 'timestamp NULL DEFAULT NULL', 'is_archived');
CALL fmrc_add_column('inventory_items', 'variants', 'json NULL DEFAULT NULL', 'archived_at');
CALL fmrc_add_column('inventory_items', 'created_by_user_id', 'bigint unsigned NULL DEFAULT NULL', 'variants');
CALL fmrc_add_column('inventory_items', 'created_at', 'timestamp NULL DEFAULT NULL', 'created_by_user_id');
CALL fmrc_add_column('inventory_items', 'updated_at', 'timestamp NULL DEFAULT NULL', 'created_at');

-- ---------------------------------------------------------------------
--  `customer_messages`
-- ---------------------------------------------------------------------
CALL fmrc_add_column('customer_messages', 'user_id', 'bigint unsigned NULL DEFAULT NULL', 'id');
CALL fmrc_add_column('customer_messages', 'sender_name', 'varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL', 'user_id');
CALL fmrc_add_column('customer_messages', 'sender_email', 'varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL', 'sender_name');
CALL fmrc_add_column('customer_messages', 'message', 'text COLLATE utf8mb4_unicode_ci NOT NULL', 'sender_email');
CALL fmrc_add_column('customer_messages', 'is_read', 'tinyint(1) NOT NULL DEFAULT ''0''', 'message');
CALL fmrc_add_column('customer_messages', 'read_at', 'timestamp NULL DEFAULT NULL', 'is_read');
CALL fmrc_add_column('customer_messages', 'status', 'varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''new''', 'read_at');
CALL fmrc_add_column('customer_messages', 'resolved_at', 'timestamp NULL DEFAULT NULL', 'status');
CALL fmrc_add_column('customer_messages', 'resolved_by_user_id', 'bigint unsigned NULL DEFAULT NULL', 'resolved_at');
CALL fmrc_add_column('customer_messages', 'created_at', 'timestamp NULL DEFAULT NULL', 'resolved_by_user_id');
CALL fmrc_add_column('customer_messages', 'updated_at', 'timestamp NULL DEFAULT NULL', 'created_at');

-- ---------------------------------------------------------------------
--  `appointments`
-- ---------------------------------------------------------------------
CALL fmrc_add_column('appointments', 'reference_no', 'varchar(255) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'id');
CALL fmrc_add_column('appointments', 'created_at', 'timestamp NULL DEFAULT NULL', 'reference_no');
CALL fmrc_add_column('appointments', 'updated_at', 'timestamp NULL DEFAULT NULL', 'created_at');
CALL fmrc_add_column('appointments', 'user_id', 'bigint unsigned NULL DEFAULT NULL', 'updated_at');
CALL fmrc_add_column('appointments', 'first_name', 'varchar(255) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'user_id');
CALL fmrc_add_column('appointments', 'last_name', 'varchar(255) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'first_name');
CALL fmrc_add_column('appointments', 'middle_initial', 'varchar(5) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'last_name');
CALL fmrc_add_column('appointments', 'contact_number', 'varchar(20) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'middle_initial');
CALL fmrc_add_column('appointments', 'email', 'varchar(255) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'contact_number');
CALL fmrc_add_column('appointments', 'country', 'varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''Philippines''', 'email');
CALL fmrc_add_column('appointments', 'region', 'varchar(255) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'country');
CALL fmrc_add_column('appointments', 'province', 'varchar(255) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'region');
CALL fmrc_add_column('appointments', 'municipality', 'varchar(255) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'province');
CALL fmrc_add_column('appointments', 'barangay', 'varchar(255) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'municipality');
CALL fmrc_add_column('appointments', 'intl_address', 'text COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'barangay');
CALL fmrc_add_column('appointments', 'full_address', 'text COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'intl_address');
CALL fmrc_add_column('appointments', 'client_type', 'varchar(255) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'full_address');
CALL fmrc_add_column('appointments', 'purpose', 'varchar(255) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'client_type');
CALL fmrc_add_column('appointments', 'additional_notes', 'text COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'purpose');
CALL fmrc_add_column('appointments', 'appointment_date', 'date NULL DEFAULT NULL', 'additional_notes');
CALL fmrc_add_column('appointments', 'appointment_time', 'varchar(60) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'appointment_date');
CALL fmrc_add_column('appointments', 'attachment_name', 'varchar(255) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'appointment_time');
CALL fmrc_add_column('appointments', 'attachment_path', 'varchar(255) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'attachment_name');
CALL fmrc_add_column('appointments', 'status', 'varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''Scheduled''', 'attachment_path');
CALL fmrc_add_column('appointments', 'qr_payload', 'text COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL', 'status');

-- ---------------------------------------------------------------------
--  `report_generations`
-- ---------------------------------------------------------------------
CALL fmrc_add_column('report_generations', 'generation_key', 'varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL', 'id');
CALL fmrc_add_column('report_generations', 'generated_by_user_id', 'bigint unsigned NULL DEFAULT NULL', 'generation_key');
CALL fmrc_add_column('report_generations', 'generated_by_name', 'varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL', 'generated_by_user_id');
CALL fmrc_add_column('report_generations', 'generated_by_role', 'varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL', 'generated_by_name');
CALL fmrc_add_column('report_generations', 'report_code', 'varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL', 'generated_by_role');
CALL fmrc_add_column('report_generations', 'category', 'varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL', 'report_code');
CALL fmrc_add_column('report_generations', 'period', 'varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL', 'category');
CALL fmrc_add_column('report_generations', 'year', 'smallint unsigned NOT NULL', 'period');
CALL fmrc_add_column('report_generations', 'month', 'tinyint unsigned NULL DEFAULT NULL', 'year');
CALL fmrc_add_column('report_generations', 'quarter', 'tinyint unsigned NULL DEFAULT NULL', 'month');
CALL fmrc_add_column('report_generations', 'created_at', 'timestamp NULL DEFAULT NULL', 'quarter');
CALL fmrc_add_column('report_generations', 'updated_at', 'timestamp NULL DEFAULT NULL', 'created_at');

-- ---------------------------------------------------------------------
--  `users`.`role` - widen the ENUM, do not create it.
--
--  Skipped entirely when the column is absent: see the header, and use
--  2026_09_02_restore_users_role.sql for that case. When the column IS
--  there but was created as ENUM('customer','admin','cashier'), this is
--  the one step that lets a staff account be saved at all -- without it
--  Accounts -> Add User -> Role: Staff is rejected by MySQL with
--  "Data truncated for column 'role'" and no account is created, which
--  is why staff sign-in then reports the password as wrong.
-- ---------------------------------------------------------------------
CALL fmrc_widen_enum('users', 'role', 'staff');

-- ---------------------------------------------------------------------
--  Clean up the helpers.
-- ---------------------------------------------------------------------
DROP PROCEDURE IF EXISTS fmrc_add_column;
DROP PROCEDURE IF EXISTS fmrc_widen_enum;
-- ---------------------------------------------------------------------
--  AFTER 1/3  Every table should now read `ok`.
-- ---------------------------------------------------------------------
SELECT
    w.`table_name`                                            AS `table_name`,
    w.`expected`                                              AS `expected`,
    IFNULL(a.`present`, 0)                                    AS `present_after`,
    CASE
        WHEN IFNULL(a.`present`, 0) = 0  THEN 'TABLE MISSING - send this row back'
        WHEN a.`present` >= w.`expected` THEN 'ok'
        WHEN w.`table_name` = 'users'
                                         THEN 'only `role` left - run 2026_09_02_restore_users_role.sql'
        ELSE 'STILL SHORT - send this row back'
    END                                                       AS `status`
FROM (
              SELECT 'users'             AS `table_name`, 21 AS `expected`
    UNION ALL SELECT 'products',            23
    UNION ALL SELECT 'orders',              49
    UNION ALL SELECT 'order_items',         11
    UNION ALL SELECT 'payments',            14
    UNION ALL SELECT 'walk_in_orders',      25
    UNION ALL SELECT 'order_returns',       43
    UNION ALL SELECT 'inventory_items',     15
    UNION ALL SELECT 'customer_messages',   12
    UNION ALL SELECT 'appointments',        26
    UNION ALL SELECT 'report_generations',  13
) AS w
LEFT JOIN (
    SELECT c.TABLE_NAME AS `table_name`, COUNT(*) AS `present`
      FROM INFORMATION_SCHEMA.COLUMNS c
     WHERE c.TABLE_SCHEMA = DATABASE()
     GROUP BY c.TABLE_NAME
) AS a ON a.`table_name` = w.`table_name`
ORDER BY `status`, w.`table_name`;
-- ---------------------------------------------------------------------
--  AFTER 2/3  The Dashboard card that was reporting itself unavailable.
--
--  `products`.`category` is the whole of that fault. Once this says
--  'present', reload the Dashboard: the amber notice goes away and
--  "Sales by Category" fills in.
-- ---------------------------------------------------------------------
SELECT
    'products.category'                                       AS `dashboard_needs`,
    IF(COUNT(*) > 0, 'present', 'MISSING')                     AS `status`,
    IF(COUNT(*) > 0,
       'OK - Sales by Category can be read now',
       'STILL BLOCKED - is the `products` table there at all?')  AS `verdict`
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME   = 'products'
  AND COLUMN_NAME  = 'category';
-- ---------------------------------------------------------------------
--  AFTER 3/3  What state `users`.`role` is in, and therefore what is
--             left to do about staff sign-in.
-- ---------------------------------------------------------------------
SELECT
    IFNULL(MAX(c.COLUMN_TYPE), '(the column does not exist)')  AS `role_type_after`,
    MAX(c.IS_NULLABLE)                                        AS `nullable`,
    MAX(c.COLUMN_DEFAULT)                                     AS `default_value`,
    MAX(c.COLLATION_NAME)                                     AS `collation`,
    CASE
        WHEN COUNT(*) = 0
            THEN 'MISSING - run 2026_09_02_restore_users_role.sql next'
        WHEN LOCATE('''staff''', LOWER(MAX(c.COLUMN_TYPE))) > 0
            THEN 'OK - staff accounts can be created'
        WHEN LOWER(LEFT(MAX(c.COLUMN_TYPE), 5)) <> 'enum('
            THEN 'OK - not an ENUM, so it already accepts staff'
        ELSE 'STILL BLOCKED - send this row back'
    END                                                       AS `verdict`
FROM INFORMATION_SCHEMA.COLUMNS c
WHERE c.TABLE_SCHEMA = DATABASE()
  AND c.TABLE_NAME   = 'users'
  AND c.COLUMN_NAME  = 'role';
