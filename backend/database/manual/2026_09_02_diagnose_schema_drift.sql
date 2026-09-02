-- =====================================================================
--  FMRC production - full schema drift report
--  Read-only diagnostic - 2026-09-02
-- =====================================================================
--  WHY THIS EXISTS
--
--  2026_09_02_install_staff_role.sql stopped with
--
--      #1054 - Unknown column 'role' in 'SELECT'
--
--  on this statement:
--
--      SELECT `role`, COUNT(*) FROM `users` GROUP BY `role`;
--
--  That is a much bigger finding than the one that script was written
--  for. `users`.`role` is created by the very FIRST migration this
--  project has ever had (0001_01_01_000000_create_users_table), so a
--  database that is missing it was not built by running the migrations
--  in order -- it was assembled some other way, and other columns that
--  later migrations added are probably missing too.
--
--  One of them is already visible on the live Dashboard: "Sales by
--  Category" is the only card that reports itself unavailable, and the
--  only thing that card reads which its working neighbours do not is
--  `products`.`category`.
--
--  So instead of guessing one column at a time, this script compares
--  the live database against the eleven tables the back office actually
--  reads and lists EVERY column that is missing, once.
--
--  HOW TO RUN IT
--
--  Hostinger hPanel -> Databases -> phpMyAdmin -> pick the FMRC
--  database (u799987132_ucn_fmrc_db) -> SQL tab -> paste this whole
--  file -> Go. Send back all six results.
--
--  THE THREE FILES, IN ORDER
--
--    1. THIS FILE                              read-only, changes nothing
--    2. 2026_09_02_repair_schema_drift.sql     adds every missing column
--                                              except `users`.`role`
--    3. 2026_09_02_restore_users_role.sql      only if result 3 below has
--                                              no `role` row, or step 2
--                                              ends in "MISSING"
--
--  2026_09_02_install_staff_role.sql is the file that failed. Do not run
--  it again -- steps 2 and 3 replace it.
--
--  SAFETY
--
--  Read-only. No CREATE, ALTER, INSERT, UPDATE or DELETE anywhere in
--  the file, and no table is named in a FROM clause -- every answer is
--  read from the INFORMATION_SCHEMA catalogue. A database missing ten
--  of the eleven tables still produces a clean report instead of an
--  error, and the file can be run as many times as you like.
-- =====================================================================
-- ---------------------------------------------------------------------
--  1/6  Which database is this SQL tab actually pointed at?
-- ---------------------------------------------------------------------
SELECT DATABASE() AS `connected_database`;
-- ---------------------------------------------------------------------
--  2/6  Every database on this account that has a `users` table.
--
--  If more than one row comes back, the site may be reading a different
--  database than the one being repaired -- which would explain a
--  `users` table with no `role` column while admin sign-in still works.
--  `has_role_column` is 1 for yes, 0 for no.
-- ---------------------------------------------------------------------
SELECT
    c.TABLE_SCHEMA                                            AS `schema_name`,
    COUNT(*)                                                  AS `users_columns`,
    MAX(c.COLUMN_NAME = 'role')                               AS `has_role_column`,
    IF(c.TABLE_SCHEMA = DATABASE(),
       'this is the one the SQL tab is pointed at', '')        AS `note`
FROM INFORMATION_SCHEMA.COLUMNS c
WHERE c.TABLE_NAME = 'users'
GROUP BY c.TABLE_SCHEMA
ORDER BY c.TABLE_SCHEMA;
-- ---------------------------------------------------------------------
--  3/6  Every column the live `users` table really has, in order.
--
--  This is the list the failing statement disagreed with. `role` should
--  appear right after `password`.
-- ---------------------------------------------------------------------
SELECT
    c.ORDINAL_POSITION                                        AS `pos`,
    c.COLUMN_NAME                                             AS `column_name`,
    c.COLUMN_TYPE                                             AS `type`,
    c.IS_NULLABLE                                             AS `nullable`,
    c.COLUMN_DEFAULT                                          AS `default_value`
FROM INFORMATION_SCHEMA.COLUMNS c
WHERE c.TABLE_SCHEMA = DATABASE()
  AND c.TABLE_NAME   = 'users'
ORDER BY c.ORDINAL_POSITION;
-- ---------------------------------------------------------------------
--  4/6  Every column the live `products` table really has, in order.
--
--  `category` is what "Sales by Category" needs.
-- ---------------------------------------------------------------------
SELECT
    c.ORDINAL_POSITION                                        AS `pos`,
    c.COLUMN_NAME                                             AS `column_name`,
    c.COLUMN_TYPE                                             AS `type`,
    c.IS_NULLABLE                                             AS `nullable`,
    c.COLUMN_DEFAULT                                          AS `default_value`
FROM INFORMATION_SCHEMA.COLUMNS c
WHERE c.TABLE_SCHEMA = DATABASE()
  AND c.TABLE_NAME   = 'products'
ORDER BY c.ORDINAL_POSITION;
-- ---------------------------------------------------------------------
--  5/6  Table-level summary: how many columns should be there, and how
--       many are.
--
--  `expected` is what the same table has on the development database,
--  which is the schema the deployed PHP was written against. Any row
--  where `missing` is not 0 is drift; `present` = 0 means the whole
--  table is absent.
-- ---------------------------------------------------------------------
SELECT
    w.`table_name`                                            AS `table_name`,
    w.`expected`                                              AS `expected`,
    IFNULL(a.`present`, 0)                                    AS `present`,
    w.`expected` - IFNULL(a.`present`, 0)                     AS `missing`,
    CASE
        WHEN IFNULL(a.`present`, 0) = 0            THEN 'TABLE MISSING'
        WHEN a.`present` >= w.`expected`           THEN 'ok'
        ELSE 'DRIFT - see result 6'
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
ORDER BY `missing` DESC, w.`table_name`;
-- ---------------------------------------------------------------------
--  6/6  The drift itself: every column that should exist and does not.
--
--  An empty result here is the good answer. Anything listed is a column
--  the deployed PHP will name in a query sooner or later, and each one
--  is a "Server Error" waiting to happen on whichever page reaches it
--  first. 2026_09_02_repair_schema_drift.sql adds exactly these.
-- ---------------------------------------------------------------------
WITH `expected` (`t`, `c`) AS (
              SELECT 'users',               'id'
    UNION ALL SELECT 'users',               'name'
    UNION ALL SELECT 'users',               'username'
    UNION ALL SELECT 'users',               'email'
    UNION ALL SELECT 'users',               'email_verified_at'
    UNION ALL SELECT 'users',               'password'
    UNION ALL SELECT 'users',               'role'
    UNION ALL SELECT 'users',               'phone_number'
    UNION ALL SELECT 'users',               'address_line'
    UNION ALL SELECT 'users',               'address_details'
    UNION ALL SELECT 'users',               'barangay'
    UNION ALL SELECT 'users',               'city_municipality'
    UNION ALL SELECT 'users',               'province'
    UNION ALL SELECT 'users',               'postal_code'
    UNION ALL SELECT 'users',               'department'
    UNION ALL SELECT 'users',               'customer_type'
    UNION ALL SELECT 'users',               'remember_token'
    UNION ALL SELECT 'users',               'created_at'
    UNION ALL SELECT 'users',               'updated_at'
    UNION ALL SELECT 'users',               'signed_with_google'
    UNION ALL SELECT 'users',               'has_custom_password'
    UNION ALL SELECT 'products',            'id'
    UNION ALL SELECT 'products',            'sku'
    UNION ALL SELECT 'products',            'name'
    UNION ALL SELECT 'products',            'category'
    UNION ALL SELECT 'products',            'code'
    UNION ALL SELECT 'products',            'description'
    UNION ALL SELECT 'products',            'image_url'
    UNION ALL SELECT 'products',            'stock'
    UNION ALL SELECT 'products',            'price'
    UNION ALL SELECT 'products',            'stock_status'
    UNION ALL SELECT 'products',            'unit_price'
    UNION ALL SELECT 'products',            'is_active'
    UNION ALL SELECT 'products',            'is_blocked'
    UNION ALL SELECT 'products',            'image_data'
    UNION ALL SELECT 'products',            'summary'
    UNION ALL SELECT 'products',            'details_chips'
    UNION ALL SELECT 'products',            'availability'
    UNION ALL SELECT 'products',            'detail_summary'
    UNION ALL SELECT 'products',            'availability_notes'
    UNION ALL SELECT 'products',            'recommended_for'
    UNION ALL SELECT 'products',            'rating'
    UNION ALL SELECT 'products',            'created_at'
    UNION ALL SELECT 'products',            'updated_at'
    UNION ALL SELECT 'orders',              'id'
    UNION ALL SELECT 'orders',              'order_no'
    UNION ALL SELECT 'orders',              'customer_id'
    UNION ALL SELECT 'orders',              'customer_name'
    UNION ALL SELECT 'orders',              'customer_contact'
    UNION ALL SELECT 'orders',              'quantity'
    UNION ALL SELECT 'orders',              'subtotal'
    UNION ALL SELECT 'orders',              'total'
    UNION ALL SELECT 'orders',              'payment_method'
    UNION ALL SELECT 'orders',              'payment_reference'
    UNION ALL SELECT 'orders',              'payment_due_at'
    UNION ALL SELECT 'orders',              'fulfillment_type'
    UNION ALL SELECT 'orders',              'delivery_recipient_name'
    UNION ALL SELECT 'orders',              'delivery_contact_no'
    UNION ALL SELECT 'orders',              'delivery_street'
    UNION ALL SELECT 'orders',              'delivery_barangay'
    UNION ALL SELECT 'orders',              'delivery_city'
    UNION ALL SELECT 'orders',              'delivery_province'
    UNION ALL SELECT 'orders',              'delivery_postal_code'
    UNION ALL SELECT 'orders',              'delivery_landmark'
    UNION ALL SELECT 'orders',              'delivery_lat'
    UNION ALL SELECT 'orders',              'delivery_lng'
    UNION ALL SELECT 'orders',              'pickup_code'
    UNION ALL SELECT 'orders',              'pickup_ready_at'
    UNION ALL SELECT 'orders',              'picked_up_at'
    UNION ALL SELECT 'orders',              'lifecycle_status'
    UNION ALL SELECT 'orders',              'customer_stage'
    UNION ALL SELECT 'orders',              'cancel_state'
    UNION ALL SELECT 'orders',              'cancel_reason'
    UNION ALL SELECT 'orders',              'cancel_reason_detail'
    UNION ALL SELECT 'orders',              'cancel_requested_at'
    UNION ALL SELECT 'orders',              'cancelled_at'
    UNION ALL SELECT 'orders',              'cancel_decided_at'
    UNION ALL SELECT 'orders',              'cancel_decided_by_user_id'
    UNION ALL SELECT 'orders',              'cancel_decision_note'
    UNION ALL SELECT 'orders',              'cancel_refund_due'
    UNION ALL SELECT 'orders',              'notes'
    UNION ALL SELECT 'orders',              'is_archived'
    UNION ALL SELECT 'orders',              'archived_at'
    UNION ALL SELECT 'orders',              'courier_name'
    UNION ALL SELECT 'orders',              'courier_tracking_no'
    UNION ALL SELECT 'orders',              'location_name'
    UNION ALL SELECT 'orders',              'last_known_lat'
    UNION ALL SELECT 'orders',              'last_known_lng'
    UNION ALL SELECT 'orders',              'approved_at'
    UNION ALL SELECT 'orders',              'rejected_at'
    UNION ALL SELECT 'orders',              'completed_at'
    UNION ALL SELECT 'orders',              'created_at'
    UNION ALL SELECT 'orders',              'updated_at'
    UNION ALL SELECT 'order_items',         'id'
    UNION ALL SELECT 'order_items',         'order_id'
    UNION ALL SELECT 'order_items',         'product_id'
    UNION ALL SELECT 'order_items',         'product_name'
    UNION ALL SELECT 'order_items',         'product_image_reference'
    UNION ALL SELECT 'order_items',         'product_image'
    UNION ALL SELECT 'order_items',         'unit_price'
    UNION ALL SELECT 'order_items',         'quantity'
    UNION ALL SELECT 'order_items',         'line_total'
    UNION ALL SELECT 'order_items',         'created_at'
    UNION ALL SELECT 'order_items',         'updated_at'
    UNION ALL SELECT 'payments',            'id'
    UNION ALL SELECT 'payments',            'order_id'
    UNION ALL SELECT 'payments',            'payment_no'
    UNION ALL SELECT 'payments',            'method'
    UNION ALL SELECT 'payments',            'reference'
    UNION ALL SELECT 'payments',            'amount'
    UNION ALL SELECT 'payments',            'status'
    UNION ALL SELECT 'payments',            'submitted_at'
    UNION ALL SELECT 'payments',            'proof_path'
    UNION ALL SELECT 'payments',            'paid_at'
    UNION ALL SELECT 'payments',            'refunded_at'
    UNION ALL SELECT 'payments',            'refund_reference'
    UNION ALL SELECT 'payments',            'created_at'
    UNION ALL SELECT 'payments',            'updated_at'
    UNION ALL SELECT 'walk_in_orders',      'id'
    UNION ALL SELECT 'walk_in_orders',      'order_no'
    UNION ALL SELECT 'walk_in_orders',      'customer_name'
    UNION ALL SELECT 'walk_in_orders',      'address'
    UNION ALL SELECT 'walk_in_orders',      'contact_number'
    UNION ALL SELECT 'walk_in_orders',      'client_type'
    UNION ALL SELECT 'walk_in_orders',      'client_type_other'
    UNION ALL SELECT 'walk_in_orders',      'agency_organization'
    UNION ALL SELECT 'walk_in_orders',      'project_description'
    UNION ALL SELECT 'walk_in_orders',      'project_description_other'
    UNION ALL SELECT 'walk_in_orders',      'item_detail'
    UNION ALL SELECT 'walk_in_orders',      'product_id'
    UNION ALL SELECT 'walk_in_orders',      'unit'
    UNION ALL SELECT 'walk_in_orders',      'subtotal_cost'
    UNION ALL SELECT 'walk_in_orders',      'order_item'
    UNION ALL SELECT 'walk_in_orders',      'order_date'
    UNION ALL SELECT 'walk_in_orders',      'customer'
    UNION ALL SELECT 'walk_in_orders',      'payment_method'
    UNION ALL SELECT 'walk_in_orders',      'total'
    UNION ALL SELECT 'walk_in_orders',      'status'
    UNION ALL SELECT 'walk_in_orders',      'created_by_user_id'
    UNION ALL SELECT 'walk_in_orders',      'created_at'
    UNION ALL SELECT 'walk_in_orders',      'updated_at'
    UNION ALL SELECT 'walk_in_orders',      'is_archived'
    UNION ALL SELECT 'walk_in_orders',      'archived_at'
    UNION ALL SELECT 'order_returns',       'id'
    UNION ALL SELECT 'order_returns',       'return_no'
    UNION ALL SELECT 'order_returns',       'order_id'
    UNION ALL SELECT 'order_returns',       'order_item_id'
    UNION ALL SELECT 'order_returns',       'customer_id'
    UNION ALL SELECT 'order_returns',       'product_id'
    UNION ALL SELECT 'order_returns',       'product_name'
    UNION ALL SELECT 'order_returns',       'quantity'
    UNION ALL SELECT 'order_returns',       'unit_price'
    UNION ALL SELECT 'order_returns',       'refund_amount'
    UNION ALL SELECT 'order_returns',       'approved_amount'
    UNION ALL SELECT 'order_returns',       'status'
    UNION ALL SELECT 'order_returns',       'resolution'
    UNION ALL SELECT 'order_returns',       'reason'
    UNION ALL SELECT 'order_returns',       'reason_details'
    UNION ALL SELECT 'order_returns',       'media'
    UNION ALL SELECT 'order_returns',       'courier_name'
    UNION ALL SELECT 'order_returns',       'courier_tracking_no'
    UNION ALL SELECT 'order_returns',       'refund_method'
    UNION ALL SELECT 'order_returns',       'refund_reference'
    UNION ALL SELECT 'order_returns',       'admin_note'
    UNION ALL SELECT 'order_returns',       'rejection_reason'
    UNION ALL SELECT 'order_returns',       'handled_by_user_id'
    UNION ALL SELECT 'order_returns',       'requested_at'
    UNION ALL SELECT 'order_returns',       'approved_at'
    UNION ALL SELECT 'order_returns',       'rejected_at'
    UNION ALL SELECT 'order_returns',       'shipped_at'
    UNION ALL SELECT 'order_returns',       'received_at'
    UNION ALL SELECT 'order_returns',       'refunded_at'
    UNION ALL SELECT 'order_returns',       'cancelled_at'
    UNION ALL SELECT 'order_returns',       'is_archived'
    UNION ALL SELECT 'order_returns',       'archived_at'
    UNION ALL SELECT 'order_returns',       'created_at'
    UNION ALL SELECT 'order_returns',       'updated_at'
    UNION ALL SELECT 'order_returns',       'reason_detail'
    UNION ALL SELECT 'order_returns',       'customer_note'
    UNION ALL SELECT 'order_returns',       'requested_amount'
    UNION ALL SELECT 'order_returns',       'refunded_amount'
    UNION ALL SELECT 'order_returns',       'decision_note'
    UNION ALL SELECT 'order_returns',       'return_courier_name'
    UNION ALL SELECT 'order_returns',       'return_tracking_no'
    UNION ALL SELECT 'order_returns',       'decided_at'
    UNION ALL SELECT 'order_returns',       'item_received_at'
    UNION ALL SELECT 'inventory_items',     'id'
    UNION ALL SELECT 'inventory_items',     'category'
    UNION ALL SELECT 'inventory_items',     'item_name'
    UNION ALL SELECT 'inventory_items',     'description'
    UNION ALL SELECT 'inventory_items',     'unit'
    UNION ALL SELECT 'inventory_items',     'last_invent'
    UNION ALL SELECT 'inventory_items',     'on_hand'
    UNION ALL SELECT 'inventory_items',     'status'
    UNION ALL SELECT 'inventory_items',     'remarks'
    UNION ALL SELECT 'inventory_items',     'is_archived'
    UNION ALL SELECT 'inventory_items',     'archived_at'
    UNION ALL SELECT 'inventory_items',     'variants'
    UNION ALL SELECT 'inventory_items',     'created_by_user_id'
    UNION ALL SELECT 'inventory_items',     'created_at'
    UNION ALL SELECT 'inventory_items',     'updated_at'
    UNION ALL SELECT 'customer_messages',   'id'
    UNION ALL SELECT 'customer_messages',   'user_id'
    UNION ALL SELECT 'customer_messages',   'sender_name'
    UNION ALL SELECT 'customer_messages',   'sender_email'
    UNION ALL SELECT 'customer_messages',   'message'
    UNION ALL SELECT 'customer_messages',   'is_read'
    UNION ALL SELECT 'customer_messages',   'read_at'
    UNION ALL SELECT 'customer_messages',   'status'
    UNION ALL SELECT 'customer_messages',   'resolved_at'
    UNION ALL SELECT 'customer_messages',   'resolved_by_user_id'
    UNION ALL SELECT 'customer_messages',   'created_at'
    UNION ALL SELECT 'customer_messages',   'updated_at'
    UNION ALL SELECT 'appointments',        'id'
    UNION ALL SELECT 'appointments',        'reference_no'
    UNION ALL SELECT 'appointments',        'created_at'
    UNION ALL SELECT 'appointments',        'updated_at'
    UNION ALL SELECT 'appointments',        'user_id'
    UNION ALL SELECT 'appointments',        'first_name'
    UNION ALL SELECT 'appointments',        'last_name'
    UNION ALL SELECT 'appointments',        'middle_initial'
    UNION ALL SELECT 'appointments',        'contact_number'
    UNION ALL SELECT 'appointments',        'email'
    UNION ALL SELECT 'appointments',        'country'
    UNION ALL SELECT 'appointments',        'region'
    UNION ALL SELECT 'appointments',        'province'
    UNION ALL SELECT 'appointments',        'municipality'
    UNION ALL SELECT 'appointments',        'barangay'
    UNION ALL SELECT 'appointments',        'intl_address'
    UNION ALL SELECT 'appointments',        'full_address'
    UNION ALL SELECT 'appointments',        'client_type'
    UNION ALL SELECT 'appointments',        'purpose'
    UNION ALL SELECT 'appointments',        'additional_notes'
    UNION ALL SELECT 'appointments',        'appointment_date'
    UNION ALL SELECT 'appointments',        'appointment_time'
    UNION ALL SELECT 'appointments',        'attachment_name'
    UNION ALL SELECT 'appointments',        'attachment_path'
    UNION ALL SELECT 'appointments',        'status'
    UNION ALL SELECT 'appointments',        'qr_payload'
    UNION ALL SELECT 'report_generations',  'id'
    UNION ALL SELECT 'report_generations',  'generation_key'
    UNION ALL SELECT 'report_generations',  'generated_by_user_id'
    UNION ALL SELECT 'report_generations',  'generated_by_name'
    UNION ALL SELECT 'report_generations',  'generated_by_role'
    UNION ALL SELECT 'report_generations',  'report_code'
    UNION ALL SELECT 'report_generations',  'category'
    UNION ALL SELECT 'report_generations',  'period'
    UNION ALL SELECT 'report_generations',  'year'
    UNION ALL SELECT 'report_generations',  'month'
    UNION ALL SELECT 'report_generations',  'quarter'
    UNION ALL SELECT 'report_generations',  'created_at'
    UNION ALL SELECT 'report_generations',  'updated_at'
)
SELECT
    e.`t`                                                     AS `table_name`,
    e.`c`                                                     AS `column_name`,
    'MISSING'                                                 AS `status`
FROM `expected` e
LEFT JOIN INFORMATION_SCHEMA.COLUMNS c
       ON c.TABLE_SCHEMA = DATABASE()
      AND c.TABLE_NAME   = e.`t`
      AND c.COLUMN_NAME  = e.`c`
WHERE c.COLUMN_NAME IS NULL
ORDER BY e.`t`, e.`c`;
