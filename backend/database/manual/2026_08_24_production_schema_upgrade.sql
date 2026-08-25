-- =====================================================================
--  FMRC production schema upgrade - 2026-08-24
-- =====================================================================
--  WHAT THIS IS FOR
--
--  The live site was throwing
--      SQLSTATE[42S22]: Unknown column 'payment_due_at' in 'INSERT INTO'
--  on every checkout. The reason is not a bug in the PHP: a Hostinger
--  deploy copies files but does not run migrations, so the code knew
--  about 32 columns the live database had never been given.
--
--  This script adds them. It is the hand-run equivalent of
--      php artisan migrate --force
--  for these four migrations:
--      2026_08_23_000001_add_fulfillment_and_delivery_address_to_orders
--      2026_08_23_000002_add_structured_address_to_users_table
--      2026_08_24_000001_add_gcash_payment_proof_and_deadline
--      2026_08_24_000002_add_customer_cancellation_to_orders
--  and it records them in the `migrations` table afterwards, so a later
--  `artisan migrate` will not try to run them a second time.
--
--  HOW TO RUN IT
--
--  Hostinger hPanel -> Databases -> phpMyAdmin -> pick the FMRC database
--  (u799987132_ucn_fmrc_db) -> SQL tab -> paste this whole file -> Go.
--
--  SAFETY
--
--  Additive only. It creates columns and one index; it never drops,
--  renames, or rewrites a column, and the only UPDATEs are the two
--  backfills the original migrations perform, each restricted so a second
--  run changes nothing. Re-running the whole file is safe: every step
--  checks INFORMATION_SCHEMA first and skips what is already there.
--  It works on both MySQL 8 and MariaDB, which is why the checks are
--  written out by hand instead of using ADD COLUMN IF NOT EXISTS.
-- =====================================================================

-- ---------------------------------------------------------------------
--  Helpers. Dropped again at the bottom of the file.
-- ---------------------------------------------------------------------
DELIMITER $$

DROP PROCEDURE IF EXISTS fmrc_add_column $$
DROP PROCEDURE IF EXISTS fmrc_add_index $$
DROP PROCEDURE IF EXISTS fmrc_mark_migration $$

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

CREATE PROCEDURE fmrc_add_index(
    IN p_table   VARCHAR(64),
    IN p_index   VARCHAR(64),
    IN p_columns VARCHAR(255)
)
BEGIN
    DECLARE v_has_index INT DEFAULT 0;

    SELECT COUNT(*) INTO v_has_index
      FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND INDEX_NAME = p_index;

    IF v_has_index = 0 THEN
        SET @fmrc_sql = CONCAT('ALTER TABLE `', p_table, '` ADD INDEX `', p_index, '` (', p_columns, ')');
        PREPARE fmrc_stmt FROM @fmrc_sql;
        EXECUTE fmrc_stmt;
        DEALLOCATE PREPARE fmrc_stmt;
    END IF;
END $$

CREATE PROCEDURE fmrc_mark_migration(
    IN p_name  VARCHAR(255),
    IN p_batch INT
)
BEGIN
    DECLARE v_count INT DEFAULT 0;

    SELECT COUNT(*) INTO v_count FROM `migrations` WHERE `migration` = p_name;

    IF v_count = 0 THEN
        INSERT INTO `migrations` (`migration`, `batch`) VALUES (p_name, p_batch);
    END IF;
END $$

DELIMITER ;

-- ---------------------------------------------------------------------
--  1/4  orders: how the order is received, and where it is going
--       (2026_08_23_000001)
--
--  `fulfillment_type` splits pickup from delivery. The delivery_* columns
--  are a snapshot of the destination taken at checkout - the customer may
--  edit their saved address later, but the parcel that shipped was
--  addressed to whoever is recorded here.
-- ---------------------------------------------------------------------
CALL fmrc_add_column('orders', 'fulfillment_type',        "ENUM('pickup','delivery') NOT NULL DEFAULT 'delivery'", 'payment_reference');
CALL fmrc_add_column('orders', 'delivery_recipient_name', 'VARCHAR(160) NULL DEFAULT NULL', 'fulfillment_type');
CALL fmrc_add_column('orders', 'delivery_contact_no',     'VARCHAR(40) NULL DEFAULT NULL',  'delivery_recipient_name');
CALL fmrc_add_column('orders', 'delivery_street',         'VARCHAR(255) NULL DEFAULT NULL', 'delivery_contact_no');
CALL fmrc_add_column('orders', 'delivery_barangay',       'VARCHAR(120) NULL DEFAULT NULL', 'delivery_street');
CALL fmrc_add_column('orders', 'delivery_city',           'VARCHAR(120) NULL DEFAULT NULL', 'delivery_barangay');
CALL fmrc_add_column('orders', 'delivery_province',       'VARCHAR(120) NULL DEFAULT NULL', 'delivery_city');
CALL fmrc_add_column('orders', 'delivery_postal_code',    'VARCHAR(10) NULL DEFAULT NULL',  'delivery_province');
CALL fmrc_add_column('orders', 'delivery_landmark',       'VARCHAR(255) NULL DEFAULT NULL', 'delivery_postal_code');

-- Where the parcel is headed. Kept apart from last_known_lat/lng, which is
-- where the parcel currently is.
CALL fmrc_add_column('orders', 'delivery_lat', 'DECIMAL(10,7) NULL DEFAULT NULL', 'delivery_landmark');
CALL fmrc_add_column('orders', 'delivery_lng', 'DECIMAL(10,7) NULL DEFAULT NULL', 'delivery_lat');

-- A pickup never travels, so it gets a handover code at the counter instead
-- of a courier and a tracking number.
CALL fmrc_add_column('orders', 'pickup_code',     'VARCHAR(12) NULL DEFAULT NULL',   'delivery_lng');
CALL fmrc_add_column('orders', 'pickup_ready_at', 'TIMESTAMP NULL DEFAULT NULL',     'pickup_code');
CALL fmrc_add_column('orders', 'picked_up_at',    'TIMESTAMP NULL DEFAULT NULL',     'pickup_ready_at');

-- ---------------------------------------------------------------------
--  2/4  users: the saved address, split into the parts a courier needs
--       (2026_08_23_000002)
--
--  `address_line` keeps its original meaning (house/unit number and
--  street). This is what the checkout "Edit Details" sheet writes, and
--  writing it was the "Server Error" bubble next to the phone field.
-- ---------------------------------------------------------------------
CALL fmrc_add_column('users', 'barangay',          'VARCHAR(120) NULL DEFAULT NULL', 'address_details');
CALL fmrc_add_column('users', 'city_municipality', 'VARCHAR(120) NULL DEFAULT NULL', 'barangay');
CALL fmrc_add_column('users', 'province',          'VARCHAR(120) NULL DEFAULT NULL', 'city_municipality');
CALL fmrc_add_column('users', 'postal_code',       'VARCHAR(10) NULL DEFAULT NULL',  'province');

-- ---------------------------------------------------------------------
--  3/4  Pay-after-placing for GCash  (2026_08_24_000001)
--
--  `orders.payment_due_at` is the deadline shown on an unpaid GCash order.
--  It is stamped on at checkout so the countdown the customer was promised
--  never moves, even if the configured window changes later. This is the
--  exact column named in the error the live site was throwing.
--
--  On the payment row, `submitted_at` is when the customer handed over
--  their reference number and `proof_path` is the receipt screenshot.
--  Both are claims - they stay separate from `paid_at`, which only staff
--  set once the money has been found in the FMRC GCash account.
-- ---------------------------------------------------------------------
CALL fmrc_add_column('orders',   'payment_due_at', 'TIMESTAMP NULL DEFAULT NULL',    'payment_reference');
CALL fmrc_add_column('payments', 'submitted_at',   'TIMESTAMP NULL DEFAULT NULL',    'status');
CALL fmrc_add_column('payments', 'proof_path',     'VARCHAR(255) NULL DEFAULT NULL', 'submitted_at');

-- ---------------------------------------------------------------------
--  4/4  Customer-initiated cancellation  (2026_08_24_000002)
--
--  First the lifecycle enum has to accept 'cancelled'. The existing member
--  list is read back out of INFORMATION_SCHEMA and re-stated verbatim with
--  the new value appended, so nothing that is already in there can be
--  dropped by a hard-coded guess. Adding a member to an ENUM rewrites no
--  rows.
-- ---------------------------------------------------------------------
SET @fmrc_enum := (
    SELECT CAST(COLUMN_TYPE AS CHAR)
      FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'orders'
       AND COLUMN_NAME  = 'lifecycle_status'
);

SET @fmrc_sql := IF(
    @fmrc_enum IS NULL
        OR @fmrc_enum NOT LIKE 'enum(%'
        OR @fmrc_enum LIKE CONCAT('%', QUOTE('cancelled'), '%'),
    "SELECT 'lifecycle_status already accepts cancelled - nothing to do' AS notice",
    CONCAT(
        'ALTER TABLE `orders` MODIFY COLUMN `lifecycle_status` ',
        LEFT(@fmrc_enum, CHAR_LENGTH(@fmrc_enum) - 1),
        ",", QUOTE('cancelled'), ") NOT NULL DEFAULT ", QUOTE('incoming')
    )
);

PREPARE fmrc_stmt FROM @fmrc_sql;
EXECUTE fmrc_stmt;
DEALLOCATE PREPARE fmrc_stmt;

-- `cancel_state` is the request itself, and it is what the admin queue
-- reads. It stays 'none' for an order nobody has asked to cancel, so
-- existing rows need no backfill.
CALL fmrc_add_column('orders', 'cancel_state',              "ENUM('none','requested','approved','declined') NOT NULL DEFAULT 'none'", 'customer_stage');
CALL fmrc_add_column('orders', 'cancel_reason',             'VARCHAR(40) NULL DEFAULT NULL',  'cancel_state');
CALL fmrc_add_column('orders', 'cancel_reason_detail',      'VARCHAR(600) NULL DEFAULT NULL', 'cancel_reason');
CALL fmrc_add_column('orders', 'cancel_requested_at',       'TIMESTAMP NULL DEFAULT NULL',    'cancel_reason_detail');
CALL fmrc_add_column('orders', 'cancelled_at',              'TIMESTAMP NULL DEFAULT NULL',    'cancel_requested_at');
CALL fmrc_add_column('orders', 'cancel_decided_at',         'TIMESTAMP NULL DEFAULT NULL',    'cancelled_at');
CALL fmrc_add_column('orders', 'cancel_decided_by_user_id', 'BIGINT UNSIGNED NULL DEFAULT NULL', 'cancel_decided_at');
CALL fmrc_add_column('orders', 'cancel_decision_note',      'VARCHAR(600) NULL DEFAULT NULL', 'cancel_decided_by_user_id');

-- Set when an order is cancelled after its payment was already confirmed.
-- Nothing here moves money: it is the flag that tells staff a GCash
-- send-back is outstanding, and what the customer's "refund on the way"
-- line reads.
CALL fmrc_add_column('orders', 'cancel_refund_due', 'TINYINT(1) NOT NULL DEFAULT 0', 'cancel_decision_note');

-- The admin queue asks "which orders are waiting on a cancellation
-- decision" - a single-column lookup over a mostly-'none' set.
CALL fmrc_add_index('orders', 'orders_cancel_state_idx', '`cancel_state`');

-- `paid_at` is when the money arrived; these two are when it went back and
-- under which GCash reference, so a refund is auditable without reading
-- the order notes.
CALL fmrc_add_column('payments', 'refunded_at',      'TIMESTAMP NULL DEFAULT NULL',   'paid_at');
CALL fmrc_add_column('payments', 'refund_reference', 'VARCHAR(64) NULL DEFAULT NULL', 'refunded_at');

-- ---------------------------------------------------------------------
--  Backfills. Both are the ones the original migrations perform, each
--  narrowed so a second run of this file changes nothing.
-- ---------------------------------------------------------------------

-- Rows that predate `fulfillment_type` are classified from the payment
-- method recorded at the time: Cash-on-Pickup never shipped.
UPDATE `orders`
   SET `fulfillment_type` = 'pickup'
 WHERE `payment_method` = 'COP'
   AND `fulfillment_type` <> 'pickup';

-- GCash orders already waiting to be paid predate the deadline, so give
-- them one measured from when they were placed rather than leaving it
-- blank. 48 hours matches config/payments.php -> gcash.payment_window_hours;
-- change the number here if GCASH_PAYMENT_WINDOW_HOURS is set in .env.
UPDATE `orders`
   SET `payment_due_at` = DATE_ADD(`created_at`, INTERVAL 48 HOUR)
 WHERE `payment_method` = 'GCash'
   AND `customer_stage` = 'to_pay'
   AND `payment_due_at` IS NULL;

-- ---------------------------------------------------------------------
--  Record the four migrations as run, all in one new batch, so a later
--  `php artisan migrate` skips them instead of re-applying them. (They
--  are individually idempotent, so even a double run would be harmless -
--  this just keeps `migrate:status` honest.)
-- ---------------------------------------------------------------------
SET @fmrc_batch := (SELECT COALESCE(MAX(`batch`), 0) + 1 FROM `migrations`);

CALL fmrc_mark_migration('2026_08_23_000001_add_fulfillment_and_delivery_address_to_orders', @fmrc_batch);
CALL fmrc_mark_migration('2026_08_23_000002_add_structured_address_to_users_table',           @fmrc_batch);
CALL fmrc_mark_migration('2026_08_24_000001_add_gcash_payment_proof_and_deadline',            @fmrc_batch);
CALL fmrc_mark_migration('2026_08_24_000002_add_customer_cancellation_to_orders',             @fmrc_batch);

-- ---------------------------------------------------------------------
--  Clean up the helpers. Nothing this script created stays behind except
--  the columns, the index and the four `migrations` rows.
-- ---------------------------------------------------------------------
DROP PROCEDURE IF EXISTS fmrc_add_column;
DROP PROCEDURE IF EXISTS fmrc_add_index;
DROP PROCEDURE IF EXISTS fmrc_mark_migration;

-- ---------------------------------------------------------------------
--  Verification. Every row must read "OK". Anything reading "MISSING"
--  means that step did not apply - copy the result and report it.
-- ---------------------------------------------------------------------
SELECT
    t.expected_table AS `table`,
    t.expected_column AS `column`,
    IF(c.COLUMN_NAME IS NULL, 'MISSING', 'OK') AS `state`
FROM (
              SELECT 'orders' AS expected_table, 'fulfillment_type' AS expected_column
    UNION ALL SELECT 'orders', 'delivery_recipient_name'
    UNION ALL SELECT 'orders', 'delivery_contact_no'
    UNION ALL SELECT 'orders', 'delivery_street'
    UNION ALL SELECT 'orders', 'delivery_barangay'
    UNION ALL SELECT 'orders', 'delivery_city'
    UNION ALL SELECT 'orders', 'delivery_province'
    UNION ALL SELECT 'orders', 'delivery_postal_code'
    UNION ALL SELECT 'orders', 'delivery_landmark'
    UNION ALL SELECT 'orders', 'delivery_lat'
    UNION ALL SELECT 'orders', 'delivery_lng'
    UNION ALL SELECT 'orders', 'pickup_code'
    UNION ALL SELECT 'orders', 'pickup_ready_at'
    UNION ALL SELECT 'orders', 'picked_up_at'
    UNION ALL SELECT 'orders', 'payment_due_at'
    UNION ALL SELECT 'orders', 'cancel_state'
    UNION ALL SELECT 'orders', 'cancel_reason'
    UNION ALL SELECT 'orders', 'cancel_reason_detail'
    UNION ALL SELECT 'orders', 'cancel_requested_at'
    UNION ALL SELECT 'orders', 'cancelled_at'
    UNION ALL SELECT 'orders', 'cancel_decided_at'
    UNION ALL SELECT 'orders', 'cancel_decided_by_user_id'
    UNION ALL SELECT 'orders', 'cancel_decision_note'
    UNION ALL SELECT 'orders', 'cancel_refund_due'
    UNION ALL SELECT 'users',  'barangay'
    UNION ALL SELECT 'users',  'city_municipality'
    UNION ALL SELECT 'users',  'province'
    UNION ALL SELECT 'users',  'postal_code'
    UNION ALL SELECT 'payments', 'submitted_at'
    UNION ALL SELECT 'payments', 'proof_path'
    UNION ALL SELECT 'payments', 'refunded_at'
    UNION ALL SELECT 'payments', 'refund_reference'
) AS t
LEFT JOIN INFORMATION_SCHEMA.COLUMNS c
       ON c.TABLE_SCHEMA = DATABASE()
      AND c.TABLE_NAME   = t.expected_table
      AND c.COLUMN_NAME  = t.expected_column
ORDER BY t.expected_table, t.expected_column;

-- The enum must now list 'cancelled', and the index must exist.
SELECT
    (SELECT CAST(COLUMN_TYPE AS CHAR) FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
        AND COLUMN_NAME = 'lifecycle_status')                    AS lifecycle_status_enum,
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
        AND INDEX_NAME = 'orders_cancel_state_idx')              AS cancel_state_index_parts,
    (SELECT COUNT(*) FROM `migrations`
      WHERE `migration` IN (
        '2026_08_23_000001_add_fulfillment_and_delivery_address_to_orders',
        '2026_08_23_000002_add_structured_address_to_users_table',
        '2026_08_24_000001_add_gcash_payment_proof_and_deadline',
        '2026_08_24_000002_add_customer_cancellation_to_orders'
      ))                                                       AS migration_rows_recorded;

