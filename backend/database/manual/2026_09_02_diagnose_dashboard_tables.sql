-- =====================================================================
--  FMRC production - what the Dashboard needs, and what is there
--  Read-only diagnostic - 2026-09-02
-- =====================================================================
--  WHAT THIS IS FOR
--
--  Total Revenue, Total Inventory Items, the four Product Analytics
--  cards and Recent Customer Inquiries sit on grey loading blocks
--  forever on the live site, while Total Products, Total Appointments,
--  Total Accounts, Total Orders and Archived Records all render.
--
--  Those two groups come from two different endpoints. The cards that
--  work are served by /api/admin/dashboard/live-counts; every card
--  that hangs is served by /api/admin/dashboard/summary, which reads
--  eleven tables. If any ONE of them is missing -- or is present but
--  missing a column -- the whole endpoint used to fail, which is why a
--  single gap silences that entire group at once.
--
--  This script does not change anything. It runs SELECTs against the
--  catalogue (INFORMATION_SCHEMA) and prints two lists: which of the
--  eleven tables exist, and which of the columns the dashboard reads
--  exist. Copy both results back and the missing pieces can be
--  installed the same way the other scripts in this folder install
--  theirs.
--
--  HOW TO RUN IT
--
--  Hostinger hPanel -> Databases -> phpMyAdmin -> pick the FMRC
--  database (u799987132_ucn_fmrc_db) -> SQL tab -> paste this whole
--  file -> Go.
--
--  SAFETY
--
--  Read-only. No CREATE, no ALTER, no INSERT, no UPDATE, no DELETE.
--  No table is even named in a FROM clause -- everything is read from
--  the catalogue -- so a missing table cannot make this script fail.
--  It can be run as many times as you like.
-- =====================================================================
-- ---------------------------------------------------------------------
--  1/2  The eleven tables the Dashboard summary reads.
--
--  `approx_rows` is InnoDB's estimate, not an exact count -- it is here
--  only to tell "table is missing" apart from "table is empty". A
--  present-but-empty table is fine; the dashboard shows a real zero.
-- ---------------------------------------------------------------------
SELECT
    w.`table_name`                                            AS `needs`,
    w.`feeds`                                                 AS `dashboard_card`,
    IF(t.TABLE_NAME IS NULL, 'MISSING', 'present')            AS `status`,
    t.TABLE_ROWS                                              AS `approx_rows`
FROM (
              SELECT 'orders'             AS `table_name`, 'Total Revenue, Recent Orders, all analytics' AS `feeds`
    UNION ALL SELECT 'payments',            'Total Revenue (verified GCash term)'
    UNION ALL SELECT 'walk_in_orders',      'Total Revenue (counter sales term)'
    UNION ALL SELECT 'order_returns',       'Total Revenue (refunds term)'
    UNION ALL SELECT 'order_items',         'Sales by Category, Product Performance, Recent Orders'
    UNION ALL SELECT 'inventory_items',     'Total Inventory Items'
    UNION ALL SELECT 'customer_messages',   'Recent Customer Inquiries'
    UNION ALL SELECT 'products',            'Total Products, Product Performance'
    UNION ALL SELECT 'appointments',        'Total Appointments, Recent Appointments'
    UNION ALL SELECT 'users',               'Total Accounts'
    UNION ALL SELECT 'report_generations',  'Archived Records'
) AS w
LEFT JOIN INFORMATION_SCHEMA.TABLES t
       ON t.TABLE_SCHEMA = DATABASE()
      AND t.TABLE_NAME   = w.`table_name`
ORDER BY `status`, w.`table_name`;
-- ---------------------------------------------------------------------
--  2/2  The individual columns each figure reads.
--
--  A table can be present and still break one card, because the column
--  a later migration added never arrived. `orders`.`is_archived` and
--  `orders`.`archived_at` are the newest of these, and every revenue
--  term now reads them.
--
--  Anything that comes back MISSING is the reason the card above it is
--  blank. A row whose table is missing entirely shows MISSING here too
--  -- fix the table first, from list 1.
-- ---------------------------------------------------------------------
SELECT
    n.`t`                                                     AS `table_name`,
    n.`c`                                                     AS `column_name`,
    IF(c.COLUMN_NAME IS NULL, 'MISSING', 'present')            AS `status`,
    c.COLUMN_TYPE                                             AS `type`,
    n.`used_by`                                               AS `used_by`
FROM (
              SELECT 'orders'           AS `t`, 'total'            AS `c`, 'Total Revenue'          AS `used_by`
    UNION ALL SELECT 'orders',            'lifecycle_status',  'Total Revenue'
    UNION ALL SELECT 'orders',            'payment_method',    'Total Revenue (GCash term)'
    UNION ALL SELECT 'orders',            'is_archived',       'Total Revenue, all analytics'
    UNION ALL SELECT 'orders',            'archived_at',       'Archived Records'
    UNION ALL SELECT 'orders',            'completed_at',      'Top Selling, Yearly Sales Trend'
    UNION ALL SELECT 'payments',          'order_id',          'Total Revenue (GCash term)'
    UNION ALL SELECT 'payments',          'status',            'Total Revenue (GCash term)'
    UNION ALL SELECT 'walk_in_orders',    'total',             'Total Revenue (counter sales)'
    UNION ALL SELECT 'walk_in_orders',    'status',            'Total Revenue (counter sales)'
    UNION ALL SELECT 'walk_in_orders',    'is_archived',       'Total Revenue (counter sales)'
    UNION ALL SELECT 'order_returns',     'status',            'Total Revenue (refunds)'
    UNION ALL SELECT 'order_returns',     'resolution',        'Total Revenue (refunds)'
    UNION ALL SELECT 'order_returns',     'refunded_amount',   'Total Revenue (refunds)'
    UNION ALL SELECT 'order_returns',     'approved_amount',   'Total Revenue (refunds)'
    UNION ALL SELECT 'order_items',       'line_total',        'Sales by Category, Product Performance'
    UNION ALL SELECT 'order_items',       'product_name',      'Sales by Category, Recent Orders'
    UNION ALL SELECT 'inventory_items',   'id',                'Total Inventory Items'
    UNION ALL SELECT 'customer_messages', 'is_read',           'Recent Customer Inquiries'
    UNION ALL SELECT 'products',          'category',          'Sales by Category'
    UNION ALL SELECT 'users',             'role',              'Total Accounts, staff sign-in'
) AS n
LEFT JOIN INFORMATION_SCHEMA.COLUMNS c
       ON c.TABLE_SCHEMA = DATABASE()
      AND c.TABLE_NAME   = n.`t`
      AND c.COLUMN_NAME  = n.`c`
ORDER BY IF(c.COLUMN_NAME IS NULL, 0, 1), n.`t`, n.`c`;
